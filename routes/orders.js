const express = require('express');
const QRCode = require('qrcode');
const { pool, withTransaction } = require('../db/pool');
const { requireRole } = require('../lib/auth');
const { HttpError, asyncHandler, getSettings, generateOrderCode, TZ } = require('../lib/util');

const router = express.Router();
router.use(requireRole('student'));

const MAX_QTY_PER_ITEM = 10;

const ORDER_SELECT = `
  SELECT o.id, o.order_code, o.status, o.total_cents, o.order_date, o.payment_method, o.is_walk_in,
         o.placed_at, o.cancel_deadline, o.locked_at, o.lock_method, o.ready_at,
         o.completed_at, o.cancelled_at, o.no_show_at,
         s.label AS slot_label,
         to_char(s.start_time, 'HH24:MI') AS slot_start,
         to_char(s.end_time, 'HH24:MI')   AS slot_end,
         COALESCE(json_agg(json_build_object(
           'name', oi.item_name, 'quantity', oi.quantity,
           'unit_price_cents', oi.unit_price_cents, 'line_total_cents', oi.line_total_cents
         ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM orders o
    LEFT JOIN time_slots s ON s.id = o.slot_id
    LEFT JOIN order_items oi ON oi.order_id = o.id`;

// ---------- Place order (Workflow steps 3–4) ----------
router.post('/', asyncHandler(async (req, res) => {
  const slotId = Number(req.body.slot_id);
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!slotId) throw new HttpError(400, 'Please choose a pickup time slot.');
  if (!rawItems.length) throw new HttpError(400, 'Your cart is empty.');

  // Merge duplicate items and validate quantities.
  const qtyById = new Map();
  for (const it of rawItems) {
    const id = Number(it.menu_item_id);
    const q = Number(it.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1) throw new HttpError(400, 'Invalid item in cart.');
    qtyById.set(id, (qtyById.get(id) || 0) + q);
  }
  for (const q of qtyById.values()) {
    if (q > MAX_QTY_PER_ITEM) throw new HttpError(400, `Maximum of ${MAX_QTY_PER_ITEM} per item.`);
  }

  const settings = await getSettings();

  const order = await withTransaction(async (db) => {
    // Lock the student row so two orders at once can't overspend the wallet.
    const { rows: [student] } = await db.query(
      'SELECT id, balance_cents, suspended_until FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    if (student.suspended_until && new Date(student.suspended_until) > new Date()) {
      throw new HttpError(403,
        `Pre-ordering is suspended until ${new Date(student.suspended_until).toLocaleString('en-PH', { timeZone: TZ })} ` +
        'because of repeated no-shows. You can still buy in person at the canteen counter.');
    }

    // Slot must be active and before its ordering cutoff (Philippine time).
    const { rows: [slot] } = await db.query(
      `SELECT id, label,
              (now() AT TIME ZONE $2)::time < (start_time - make_interval(mins => cutoff_minutes)) AS is_open,
              (now() AT TIME ZONE $2)::date AS today
         FROM time_slots WHERE id = $1 AND is_active = TRUE`,
      [slotId, TZ]
    );
    if (!slot) throw new HttpError(400, 'That pickup slot is not available.');
    if (!slot.is_open) throw new HttpError(400, `Ordering for ${slot.label} has closed. Please pick a later slot.`);

    // Lock menu rows in id order (avoids deadlocks) and check stock.
    const ids = [...qtyById.keys()].sort((a, b) => a - b);
    const { rows: items } = await db.query(
      `SELECT id, name, price_cents, stock, is_active FROM menu_items
        WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
      [ids]
    );
    if (items.length !== ids.length || items.some((i) => !i.is_active)) {
      throw new HttpError(400, 'An item in your cart is no longer available. Please refresh the menu.');
    }
    let total = 0;
    for (const it of items) {
      const q = qtyById.get(it.id);
      if (it.stock < q) {
        throw new HttpError(409, it.stock === 0
          ? `${it.name} is now out of stock.`
          : `Only ${it.stock} left of ${it.name}. Please lower the quantity.`);
      }
      total += it.price_cents * q;
    }

    if (student.balance_cents < total) {
      throw new HttpError(402, 'Insufficient balance: please top up at the school cashier.');
    }

    // Reserve stock immediately (prevents overselling).
    for (const it of items) {
      await db.query('UPDATE menu_items SET stock = stock - $1, updated_at = now() WHERE id = $2', [qtyById.get(it.id), it.id]);
    }

    // Deduct wallet immediately.
    const { rows: [bal] } = await db.query(
      'UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2 RETURNING balance_cents',
      [total, student.id]
    );

    // Create the order with a unique code (retry on the rare collision).
    let created;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = generateOrderCode();
      const r = await db.query(
        `INSERT INTO orders (order_code, student_id, slot_id, order_date, total_cents, status,
                             payment_method, placed_at, cancel_deadline)
         VALUES ($1, $2, $3, $4, $5, 'placed', 'wallet', now(), now() + make_interval(mins => $6))
         ON CONFLICT (order_code) DO NOTHING
         RETURNING id, order_code`,
        [code, student.id, slot.id, slot.today, total, settings.cancel_window_minutes]
      );
      created = r.rows[0];
    }
    if (!created) throw new Error('Could not generate order code');

    for (const it of items) {
      const q = qtyById.get(it.id);
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price_cents, quantity, line_total_cents)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [created.id, it.id, it.name, it.price_cents, q, it.price_cents * q]
      );
    }

    await db.query(
      `INSERT INTO wallet_transactions (student_id, type, amount_cents, balance_after_cents, order_id, reason)
       VALUES ($1, 'purchase', $2, $3, $4, $5)`,
      [student.id, -total, bal.balance_cents, created.id, `Pre-order ${created.order_code}`]
    );

    return created;
  });

  res.status(201).json(order);
}));

// ---------- My orders ----------
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `${ORDER_SELECT}
      WHERE o.student_id = $1
      GROUP BY o.id, s.id
      ORDER BY o.placed_at DESC
      LIMIT 50`,
    [req.user.id]
  );
  res.json({ server_time: new Date().toISOString(), orders: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `${ORDER_SELECT} WHERE o.id = $1 AND o.student_id = $2 GROUP BY o.id, s.id`,
    [Number(req.params.id), req.user.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Order not found.');
  res.json({ server_time: new Date().toISOString(), order: rows[0] });
}));

// QR code image for pickup (encodes the order code).
router.get('/:id/qr', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT order_code FROM orders WHERE id = $1 AND student_id = $2',
    [Number(req.params.id), req.user.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Order not found.');
  const dataUrl = await QRCode.toDataURL(rows[0].order_code, { width: 280, margin: 1 });
  res.json({ order_code: rows[0].order_code, qr: dataUrl });
}));

// ---------- Cancel within the window (Workflow step 5) ----------
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const result = await withTransaction(async (db) => {
    // Atomic: only succeeds if still "placed" AND before the deadline.
    const { rows: [order] } = await db.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1 AND student_id = $2 AND status = 'placed' AND cancel_deadline > now()
        RETURNING id, order_code, total_cents`,
      [Number(req.params.id), req.user.id]
    );
    if (!order) throw new HttpError(409, 'This order can no longer be cancelled (the cancellation window has ended or it was already confirmed).');

    // Release reserved stock.
    await db.query(
      `UPDATE menu_items m SET stock = m.stock + oi.quantity, updated_at = now()
         FROM order_items oi WHERE oi.order_id = $1 AND oi.menu_item_id = m.id`,
      [order.id]
    );

    // Full refund to wallet.
    const { rows: [bal] } = await db.query(
      'UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2 RETURNING balance_cents',
      [order.total_cents, req.user.id]
    );
    await db.query(
      `INSERT INTO wallet_transactions (student_id, type, amount_cents, balance_after_cents, order_id, reason)
       VALUES ($1, 'refund', $2, $3, $4, $5)`,
      [req.user.id, order.total_cents, bal.balance_cents, order.id, `Cancelled order ${order.order_code}`]
    );
    return { ok: true, refunded_cents: order.total_cents, balance_cents: bal.balance_cents };
  });
  res.json(result);
}));

// ---------- Confirm Now: skip the rest of the window ----------
router.post('/:id/confirm-now', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE orders SET status = 'preparing', locked_at = now(), lock_method = 'confirm_now'
      WHERE id = $1 AND student_id = $2 AND status = 'placed' AND cancel_deadline > now()
      RETURNING id`,
    [Number(req.params.id), req.user.id]
  );
  if (!rows[0]) throw new HttpError(409, 'This order is already locked in.');
  res.json({ ok: true });
}));

module.exports = router;

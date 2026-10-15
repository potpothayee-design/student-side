const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../lib/auth');
const { asyncHandler } = require('../lib/util');

const router = express.Router();

// Wallet balance and transaction history.
router.get('/', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.type, t.amount_cents, t.balance_after_cents, t.receipt_no, t.reason, t.created_at,
            o.order_code
       FROM wallet_transactions t
       LEFT JOIN orders o ON o.id = t.order_id
      WHERE t.student_id = $1
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 200`,
    [req.user.id]
  );
  res.json({ balance_cents: req.user.balance_cents, transactions: rows });
}));

module.exports = router;

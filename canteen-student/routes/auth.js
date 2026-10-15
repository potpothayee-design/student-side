const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db/pool');
const { setSessionCookie, clearSessionCookie, requireRole, verifyLogin } = require('../lib/auth');
const { HttpError, asyncHandler, getSettings, requireFields } = require('../lib/util');

const router = express.Router();

// Register a new student account (self-registration with school ID).
router.post('/register', asyncHandler(async (req, res) => {
  requireFields(req.body, ['school_id', 'full_name', 'password']);
  const schoolId = String(req.body.school_id).trim();
  const fullName = String(req.body.full_name).trim();
  const password = String(req.body.password);

  if (!/^[A-Za-z0-9-]{4,30}$/.test(schoolId)) {
    throw new HttpError(400, 'School ID must be 4–30 letters, numbers or dashes (e.g. 2026-0123).');
  }
  if (fullName.length < 2 || fullName.length > 120) throw new HttpError(400, 'Please enter your full name.');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');

  const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(login_id) = LOWER($1)', [schoolId]);
  if (exists.rowCount) throw new HttpError(409, 'An account with this School ID already exists.');

  // Every new student account starts with the starting balance (₱1,000.00 by default).
  const settings = await getSettings();
  const startCents = Number(settings.starting_balance_cents) || 0;
  const hash = await bcrypt.hash(password, 10);
  const user = await withTransaction(async (db) => {
    const { rows: [u] } = await db.query(
      `INSERT INTO users (login_id, full_name, role, password_hash, balance_cents)
       VALUES ($1, $2, 'student', $3, $4) RETURNING id, role`,
      [schoolId, fullName, hash, startCents]
    );
    if (startCents > 0) {
      await db.query(
        `INSERT INTO wallet_transactions (student_id, type, amount_cents, balance_after_cents, reason)
         VALUES ($1, 'adjustment', $2, $2, 'Starting balance')`,
        [u.id, startCents]
      );
    }
    return u;
  });
  setSessionCookie(res, user);
  res.status(201).json({ ok: true });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const user = await verifyLogin(req.body.login_id, req.body.password, ['student']);
  setSessionCookie(res, user);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Current student + the rules the UI needs to display.
router.get('/me', requireRole('student'), asyncHandler(async (req, res) => {
  const s = await getSettings();
  const u = req.user;
  res.json({
    id: u.id,
    login_id: u.login_id,
    full_name: u.full_name,
    balance_cents: u.balance_cents,
    consecutive_no_shows: u.consecutive_no_shows,
    total_no_shows: u.total_no_shows,
    suspended_until: u.suspended_until,
    is_suspended: !!(u.suspended_until && new Date(u.suspended_until) > new Date()),
    is_demo: u.is_demo,
    settings: {
      cancel_window_minutes: s.cancel_window_minutes,
      no_show_limit: s.no_show_limit,
      suspension_days: s.suspension_days,
      lunch_end_time: s.lunch_end_time,
    },
  });
}));

router.post('/change-password', requireRole('student'), asyncHandler(async (req, res) => {
  requireFields(req.body, ['current_password', 'new_password']);
  if (String(req.body.new_password).length < 6) throw new HttpError(400, 'New password must be at least 6 characters.');
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current_password), rows[0].password_hash))) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    await bcrypt.hash(String(req.body.new_password), 10), req.user.id,
  ]);
  res.json({ ok: true });
}));

module.exports = router;

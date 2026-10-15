const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db/pool');
const { setSessionCookie, clearSessionCookie, requireRole, verifyLogin } = require('../lib/auth');
const { HttpError, asyncHandler, getSettings } = require('../lib/util');
const { MIN_PASSWORD, PASSWORD_CHANGE_DAYS, nextPasswordChangeAt } = require('../lib/accounts');

const router = express.Router();

// Students can no longer create their own accounts: the School Cashier creates them after
// checking the school ID card (prevents fake/multiple accounts and abuse of the starting balance).
router.post('/register', (req, res) => {
  res.status(403).json({ error: 'Accounts are created by the school cashier. Please bring your school ID card to the cashier.' });
});

router.post('/login', asyncHandler(async (req, res) => {
  const user = await verifyLogin(req.body.login_id, req.body.password, ['student']);
  setSessionCookie(res, user);
  res.json({ ok: true, must_change_password: user.must_change_password });
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
    must_change_password: u.must_change_password,
    next_password_change_at: nextPasswordChangeAt(u),
    settings: {
      cancel_window_minutes: s.cancel_window_minutes,
      no_show_limit: s.no_show_limit,
      suspension_days: s.suspension_days,
      lunch_end_time: s.lunch_end_time,
    },
  });
}));

// Change password.
// - First login (temporary password): required; the current password is not asked again.
// - Afterwards: allowed once every 7 days. Forgot it? The school cashier can reset it.
router.post('/change-password', requireRole('student'), asyncHandler(async (req, res) => {
  const u = req.user;
  const newPw = String(req.body.new_password || '');
  if (newPw.length < MIN_PASSWORD) throw new HttpError(400, `New password must be at least ${MIN_PASSWORD} characters.`);

  const { rows: [row] } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!u.must_change_password) {
    const next = nextPasswordChangeAt(u);
    if (next) {
      const when = next.toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      throw new HttpError(429, `You can only change your password once every ${PASSWORD_CHANGE_DAYS} days. Next change: ${when}. Forgot it? Ask the school cashier to reset it.`);
    }
    if (!(await bcrypt.compare(String(req.body.current_password || ''), row.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
  }
  if (await bcrypt.compare(newPw, row.password_hash)) {
    throw new HttpError(400, u.must_change_password ? 'Choose a new password, not the temporary one.' : 'The new password must be different from the current one.');
  }
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE, password_changed_at = now() WHERE id = $2',
    [await bcrypt.hash(newPw, 10), u.id]
  );
  res.json({ ok: true });
}));

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db/pool');
const { setSessionCookie, clearSessionCookie, requireRole, verifyLogin } = require('../lib/auth');
const { HttpError, asyncHandler, getSettings, requireFields } = require('../lib/util');

const router = express.Router();

// ---------- Registration rules ----------
// School ID format: NN-NN-NNNN (e.g. 04-23-0006).
const SCHOOL_ID_RE = /^\d{2}-\d{2}-\d{4}$/;
// Names: letters (incl. ñ, accents), spaces, dot, apostrophe, dash.
const NAME_RE = /^[\p{L}][\p{L} .'\-]*$/u;

// Trim, collapse spaces; Title-Case it if typed in all lower or all upper case.
function cleanName(v) {
  let s = String(v || '').trim().replace(/\s+/g, ' ');
  if (s && (s === s.toLowerCase() || s === s.toUpperCase())) {
    s = s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  return s;
}
// Comparison key: lowercase, no dots, single spaces.
const nameKey = (v) => String(v || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

// Same middle name? Empty middle names match anything (so "Juan Cruz" can't duplicate "Juan Reyes Cruz"),
// and an initial matches the full name ("R" = "Reyes").
function middleMatches(a, b) {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return false;
}

// Register a new student account (self-registration with school ID).
router.post('/register', asyncHandler(async (req, res) => {
  const schoolId = String(req.body.school_id || '').trim();
  const first = cleanName(req.body.first_name);
  const noMiddle = req.body.no_middle_name === true;
  const middle = noMiddle ? '' : cleanName(req.body.middle_name);
  const last = cleanName(req.body.last_name);
  const password = String(req.body.password || '');

  if (req.body.full_name && !req.body.first_name) {
    throw new HttpError(400, 'Please refresh the page (Ctrl + F5) and try again.');
  }
  if (!SCHOOL_ID_RE.test(schoolId)) {
    throw new HttpError(400, 'School ID must look like 04-23-0006 (2 digits, 2 digits, 4 digits).');
  }
  for (const [label, v] of [['First name', first], ['Last name', last]]) {
    if (!v) throw new HttpError(400, `${label} is required.`);
    if (v.length > 40 || !NAME_RE.test(v)) throw new HttpError(400, `${label} can only contain letters, spaces, dots, apostrophes and dashes.`);
  }
  if (!noMiddle) {
    if (!middle) throw new HttpError(400, 'Middle name is required. If you have none, tick "I have no middle name".');
    if (middle.length > 40 || !NAME_RE.test(middle)) throw new HttpError(400, 'Middle name can only contain letters, spaces, dots, apostrophes and dashes.');
  }
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');

  const fullName = [first, middle, last].filter(Boolean).join(' ');
  const fKey = nameKey(first), mKey = nameKey(middle), lKey = nameKey(last);

  // Every new student account starts with the starting balance (₱1,000.00 by default).
  const settings = await getSettings();
  const startCents = Number(settings.starting_balance_cents) || 0;
  const hash = await bcrypt.hash(password, 10);

  const user = await withTransaction(async (db) => {
    // One registration at a time, so two people can't slip in the same name/ID simultaneously.
    await db.query('SELECT pg_advisory_xact_lock(7240001)');

    const idTaken = await db.query('SELECT 1 FROM users WHERE LOWER(login_id) = LOWER($1)', [schoolId]);
    if (idTaken.rowCount) throw new HttpError(409, 'An account with this School ID already exists.');

    // Duplicate name check against active student accounts whose name starts with the
    // same first name and ends with the same last name.
    const { rows: candidates } = await db.query(
      `SELECT full_name FROM users
        WHERE role = 'student' AND is_active
          AND LOWER(REGEXP_REPLACE(REPLACE(full_name, '.', ''), '\\s+', ' ', 'g')) LIKE $1`,
      [`${fKey}%${lKey}`]
    );
    const dup = candidates.some((c) => {
      const k = nameKey(c.full_name);
      if (k === `${fKey} ${lKey}`) return middleMatches('', mKey);
      if (!k.startsWith(`${fKey} `) || !k.endsWith(` ${lKey}`)) return false;
      const existingMiddle = k.slice(fKey.length + 1, k.length - lKey.length - 1).trim();
      return middleMatches(existingMiddle, mKey);
    });
    if (dup) {
      throw new HttpError(409, 'A student with this name is already registered. If this is not you, please see the canteen admin.');
    }

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

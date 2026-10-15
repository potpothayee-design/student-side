const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { HttpError, asyncHandler } = require('./util');

const COOKIE_NAME = process.env.COOKIE_NAME || 'canteen_student';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function sessionSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set. See .env.example.');
  return process.env.JWT_SECRET;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, sessionSecret(), {
    algorithm: 'HS256',
    expiresIn: SESSION_SECONDS,
  });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_SECONDS * 1000 });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

async function verifyLogin(loginId, password, roles = []) {
  if (typeof loginId !== 'string' || typeof password !== 'string' || !loginId.trim() || !password) {
    throw new HttpError(400, 'Please enter your School ID and password.');
  }
  const { rows: [user] } = await pool.query(
    'SELECT * FROM users WHERE LOWER(login_id) = LOWER($1)',
    [loginId.trim()]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Incorrect School ID or password.');
  }
  if (!user.is_active || (roles.length && !roles.includes(user.role))) {
    throw new HttpError(403, 'This account cannot access the student app.');
  }
  return user;
}

function requireRole(...roles) {
  return asyncHandler(async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) throw new HttpError(401, 'Please log in.');
    let payload;
    // Read configuration outside the catch: configuration failures are not invalid sessions.
    const secret = sessionSecret();
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (!/^\d+$/.test(payload.sub)) throw new Error('Invalid subject');
    } catch {
      throw new HttpError(401, 'Your session has expired. Please log in again.');
    }
    const { rows: [user] } = await pool.query(
      `SELECT id, login_id, full_name, role, balance_cents, consecutive_no_shows,
              total_no_shows, suspended_until, is_demo, is_active
         FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!user || !user.is_active) throw new HttpError(401, 'Please log in.');
    if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'Access denied.');
    req.user = user;
    next();
  });
}

module.exports = { setSessionCookie, clearSessionCookie, verifyLogin, requireRole };

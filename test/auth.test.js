const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-session-secret';
process.env.COOKIE_NAME = 'canteen_student';
process.env.NODE_ENV = 'test';

// Stub only the database boundary. Authentication still uses real bcrypt/JWT,
// cookies and Express middleware; no running PostgreSQL service is needed.
const user = {
  id: 1, login_id: '2026-0001', full_name: 'Test Student', role: 'student',
  is_active: true, password_hash: bcrypt.hashSync('student123', 4),
};
let currentUser = user;
const poolPath = require.resolve('../db/pool');
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: { pool: { query: async () => ({ rows: currentUser ? [currentUser] : [] }) } },
};
const { verifyLogin, setSessionCookie, clearSessionCookie, requireRole } = require('../lib/auth');
const { errorHandler } = require('../lib/util');

let server;
let base;
test.before(async () => {
  const app = express();
  app.use(cookieParser());
  app.get('/private', requireRole('student'), (req, res) => res.json({ id: req.user.id }));
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { currentUser = { ...user }; });

function tokenCookie(payload = { sub: '1' }, options = {}) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', ...options });
  return `canteen_student=${token}`;
}

test('login verifies password and enforces account role and activation', async () => {
  assert.equal((await verifyLogin('2026-0001', 'student123', ['student'])).id, 1);
  await assert.rejects(verifyLogin('', '', ['student']), { status: 400 });
  await assert.rejects(verifyLogin('2026-0001', 'wrong', ['student']), { status: 401 });
  currentUser.role = 'staff';
  await assert.rejects(verifyLogin('2026-0001', 'student123', ['student']), { status: 403 });
  currentUser.role = 'student';
  currentUser.is_active = false;
  await assert.rejects(verifyLogin('2026-0001', 'student123', ['student']), { status: 403 });
});

test('session cookies are HTTP-only and production cookies require HTTPS', () => {
  const res = {
    cookie(name, value, options) {
      assert.equal(name, 'canteen_student');
      assert.equal(jwt.verify(value, process.env.JWT_SECRET).sub, '1');
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, 'lax');
      assert.equal(options.secure, true);
    },
    clearCookie(name, options) {
      assert.equal(name, 'canteen_student');
      assert.equal(options.path, '/');
      assert.equal(options.secure, true);
    },
  };
  process.env.NODE_ENV = 'production';
  try {
    setSessionCookie(res, user);
    clearSessionCookie(res);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('protected routes reject missing, invalid and expired tokens', async () => {
  for (const cookie of ['', 'canteen_student=invalid', tokenCookie({ sub: '1' }, { expiresIn: -1 })]) {
    const response = await fetch(`${base}/private`, { headers: { cookie } });
    assert.equal(response.status, 401);
  }
});

test('protected routes load the current user and reject inactive or wrong-role users', async () => {
  const headers = { cookie: tokenCookie() };
  let response = await fetch(`${base}/private`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 1 });
  currentUser.role = 'admin';
  response = await fetch(`${base}/private`, { headers });
  assert.equal(response.status, 403);
  currentUser.is_active = false;
  response = await fetch(`${base}/private`, { headers });
  assert.equal(response.status, 401);
  currentUser = null;
  response = await fetch(`${base}/private`, { headers });
  assert.equal(response.status, 401);
});

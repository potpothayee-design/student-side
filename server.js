// Canteen Pre-Order System: STUDENT APP
// Students register/login, browse the menu, order and pay from their wallet,
// cancel within the window or "Confirm Now", track status and view wallet history.
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initDatabase } = require('./db/init');
const { pool } = require('./db/pool');
const { errorHandler } = require('./lib/util');
const { sweepMiddleware, startSweepTimer } = require('./lib/maintenance');

const app = express();
app.set('trust proxy', 1); // Render runs behind a proxy (needed for secure cookies)
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Health check for Render
app.get('/healthz', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

// API
app.use('/api', sweepMiddleware);
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Frontend (static HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
initDatabase()
  .then(() => {
    startSweepTimer();
    app.listen(PORT, '0.0.0.0', () => console.log(`Student app running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });

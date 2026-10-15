const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../lib/auth');
const { asyncHandler, TZ } = require('../lib/util');

const router = express.Router();

// Available menu items with live stock.
router.get('/menu', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, category, price_cents, photo, stock
       FROM menu_items
      WHERE is_active = TRUE
      ORDER BY category, name`
  );
  res.json(rows);
}));

// Today's pickup slots and whether ordering is still open for each.
router.get('/slots', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, label,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI')   AS end_time,
            cutoff_minutes,
            to_char(start_time - make_interval(mins => cutoff_minutes), 'HH24:MI') AS order_by,
            (now() AT TIME ZONE $1)::time < (start_time - make_interval(mins => cutoff_minutes)) AS is_open
       FROM time_slots
      WHERE is_active = TRUE
      ORDER BY start_time`,
    [TZ]
  );
  res.json(rows);
}));

module.exports = router;

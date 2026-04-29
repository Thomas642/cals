const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { checkGeofences } = require('../services/geofence');

const router = express.Router();

// POST /api/positions  — receive own GPS position
router.post('/', authenticate, async (req, res) => {
    const { latitude, longitude, battery, speed, accuracy } = req.body;

    if (latitude == null || longitude == null) {
        return res.status(400).json({ error: 'latitude and longitude are required' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const point = `POINT(${longitude} ${latitude})`;

    const { rows } = await pool.query(
        `INSERT INTO positions (user_id, location, battery, speed, accuracy)
         VALUES ($1, ST_GeogFromText($2), $3, $4, $5)
         RETURNING id, recorded_at`,
        [req.user.id, point, battery ?? null, speed ?? 0, accuracy ?? null]
    );

    // Async geofence check — don't block the response
    checkGeofences(req.user.id, latitude, longitude, req.app.get('io')).catch(console.error);

    res.status(201).json(rows[0]);
});

// GET /api/positions  — latest position of all active members
router.get('/', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT
            user_id AS id,
            name,
            color,
            avatar_url,
            user_status AS status,
            battery,
            speed,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            recorded_at
         FROM latest_positions`
    );
    res.json(rows);
});

// GET /api/positions/:userId  — latest position of a specific member
router.get('/:userId', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT
            p.user_id AS id,
            u.name,
            u.color,
            u.avatar_url,
            p.battery,
            p.speed,
            ST_Y(p.location::geometry) AS latitude,
            ST_X(p.location::geometry) AS longitude,
            p.recorded_at
         FROM positions p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1
         ORDER BY p.recorded_at DESC
         LIMIT 1`,
        [req.params.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No position found' });
    res.json(rows[0]);
});

module.exports = router;

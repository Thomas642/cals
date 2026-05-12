const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/schedule — list all schedule alerts
router.get('/', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT sa.id, sa.label, sa.expected_time, sa.tolerance_min, sa.days, sa.active,
                    sa.created_at,
                    u.id AS member_id, u.name AS member_name, u.color AS member_color,
                    z.id AS zone_id,   z.name AS zone_name
             FROM schedule_alerts sa
             JOIN users u ON u.id = sa.member_id
             JOIN zones z ON z.id = sa.zone_id
             ORDER BY sa.expected_time ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error('[schedule/list]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/schedule — create a new schedule alert
router.post('/', authenticate, async (req, res) => {
    try {
        const { member_id, zone_id, label, expected_time, tolerance_min = 15, days = [1,2,3,4,5] } = req.body;
        if (!member_id || !zone_id || !expected_time) {
            return res.status(400).json({ error: 'member_id, zone_id and expected_time are required' });
        }

        const { rows } = await pool.query(
            `INSERT INTO schedule_alerts (member_id, zone_id, label, expected_time, tolerance_min, days)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [member_id, zone_id, label || '', expected_time, tolerance_min, days]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('[schedule/create]', err);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/schedule/:id/toggle — toggle active state
router.patch('/:id/toggle', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE schedule_alerts SET active = NOT active WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/schedule/:id
router.delete('/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM schedule_alerts WHERE id = $1', [req.params.id]);
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

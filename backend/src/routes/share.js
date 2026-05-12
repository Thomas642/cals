const express = require('express');
const crypto  = require('crypto');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/share — generate share link (auth required)
router.post('/', authenticate, async (req, res) => {
    try {
        const token      = crypto.randomBytes(20).toString('hex');
        const hoursValid = Math.min(Math.max(parseInt(req.body.hours) || 24, 1), 72);

        await pool.query(
            `INSERT INTO share_tokens (token, user_id, label, expires_at)
             VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)`,
            [token, req.user.id, req.body.label || '', hoursValid]
        );
        res.json({
            token,
            expires_in: `${hoursValid}h`,
            url: `/share.html?token=${token}`,
        });
    } catch (err) {
        console.error('[share POST]', err);
        res.status(500).json({ error: 'Failed to create share link' });
    }
});

// GET /api/share/:token — public, no auth required
router.get('/:token', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.name, u.color, u.avatar_url, st.label, st.expires_at,
                    ST_Y(p.location::geometry) AS latitude,
                    ST_X(p.location::geometry) AS longitude,
                    p.battery, p.speed, p.recorded_at
             FROM share_tokens st
             JOIN users u ON u.id = st.user_id
             LEFT JOIN LATERAL (
                 SELECT location, battery, speed, recorded_at
                 FROM positions
                 WHERE user_id = st.user_id
                 ORDER BY recorded_at DESC LIMIT 1
             ) p ON TRUE
             WHERE st.token = $1 AND st.expires_at > NOW()`,
            [req.params.token]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Lien expiré ou invalide' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[share GET]', err);
        res.status(500).json({ error: 'Failed to load share data' });
    }
});

// GET /api/share — list my active share links (auth required)
router.get('/', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT token, label, expires_at, created_at
             FROM share_tokens
             WHERE user_id = $1 AND expires_at > NOW()
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/share/:token — revoke (auth required)
router.delete('/:token', authenticate, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM share_tokens WHERE token = $1 AND user_id = $2',
            [req.params.token, req.user.id]
        );
        res.sendStatus(204);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

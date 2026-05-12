const express = require('express');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/zones
router.get('/', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT
            id, name, radius, address,
            ST_Y(center::geometry) AS latitude,
            ST_X(center::geometry) AS longitude,
            created_by, notify_members, is_active, created_at
         FROM zones
         ORDER BY created_at DESC`
    );
    res.json(rows);
});

// POST /api/zones
router.post('/', authenticate, async (req, res) => {
    const { name, latitude, longitude, radius, notify_members, address } = req.body;
    if (!name || latitude == null || longitude == null || !radius) {
        return res.status(400).json({ error: 'name, latitude, longitude and radius are required' });
    }

    const point = `POINT(${longitude} ${latitude})`;
    const members = Array.isArray(notify_members) ? notify_members : [];

    const { rows } = await pool.query(
        `INSERT INTO zones (name, center, radius, created_by, notify_members, address)
         VALUES ($1, ST_GeogFromText($2), $3, $4, $5, $6)
         RETURNING id, name, radius, address, created_at,
                   ST_Y(center::geometry) AS latitude,
                   ST_X(center::geometry) AS longitude`,
        [name.trim(), point, radius, req.user.id, members, (address || '').toString().slice(0, 500)]
    );
    res.status(201).json(rows[0]);
});

// PUT /api/zones/:id
router.put('/:id', authenticate, async (req, res) => {
    const { name, latitude, longitude, radius, notify_members, is_active, address } = req.body;

    const { rows: existing } = await pool.query('SELECT * FROM zones WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Zone not found' });

    if (existing[0].created_by !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const zone = existing[0];
    const newPoint = latitude != null && longitude != null
        ? `POINT(${longitude} ${latitude})`
        : null;

    const { rows } = await pool.query(
        `UPDATE zones SET
            name           = COALESCE($1, name),
            center         = COALESCE(ST_GeogFromText($2), center),
            radius         = COALESCE($3, radius),
            notify_members = COALESCE($4, notify_members),
            is_active      = COALESCE($5, is_active),
            address        = COALESCE($7, address)
         WHERE id = $6
         RETURNING id, name, radius, address, is_active, created_at,
                   ST_Y(center::geometry) AS latitude,
                   ST_X(center::geometry) AS longitude`,
        [
            name ?? null,
            newPoint,
            radius ?? null,
            Array.isArray(notify_members) ? notify_members : null,
            is_active ?? null,
            req.params.id,
            address != null ? address.toString().slice(0, 500) : null,
        ]
    );
    res.json(rows[0]);
});

// PATCH /api/zones/:id/notify-toggle — toggle current user in/out of zone notify_members
// Empty array = everyone notified (default). Non-empty = only listed users get push.
router.patch('/:id/notify-toggle', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT notify_members FROM zones WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Zone not found' });

        const current = rows[0].notify_members || [];
        const uid = req.user.id;
        let updated;

        if (current.length === 0) {
            // Was "everyone" — get all active users except this one (they are opting out)
            const { rows: allUsers } = await pool.query(
                'SELECT id FROM users WHERE is_active = TRUE AND id != $1', [uid]
            );
            updated = allUsers.map((u) => u.id);
        } else if (current.includes(uid)) {
            updated = current.filter((id) => id !== uid);
            // If list becomes empty → revert to "everyone"
        } else {
            updated = [...current, uid];
        }

        const { rows: saved } = await pool.query(
            `UPDATE zones SET notify_members = $1 WHERE id = $2
             RETURNING id, name, notify_members`,
            [updated, req.params.id]
        );
        res.json(saved[0]);
    } catch (err) {
        console.error('[zones/notify-toggle]', err);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/zones/:id/zone-type — set zone_type and curfew hours
router.patch('/:id/zone-type', authenticate, async (req, res) => {
    try {
        const { zone_type, curfew_start, curfew_end } = req.body;
        const { rows } = await pool.query(
            `UPDATE zones SET zone_type=COALESCE($1,zone_type), curfew_start=COALESCE($2,curfew_start), curfew_end=COALESCE($3,curfew_end)
             WHERE id=$4 RETURNING id, name, zone_type, curfew_start, curfew_end`,
            [zone_type||null, curfew_start||null, curfew_end||null, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Zone not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[zones/zone-type]', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/zones/:id
router.delete('/:id', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT created_by FROM zones WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Zone not found' });

    if (rows[0].created_by !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query('DELETE FROM zones WHERE id = $1', [req.params.id]);
    res.status(204).end();
});

module.exports = router;

const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM places ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', authenticate, async (req, res) => {
    const { name, icon, latitude, longitude } = req.body;
    if (!name || latitude == null || longitude == null) {
        return res.status(400).json({ error: 'name, latitude et longitude requis' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO places (name, icon, latitude, longitude, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name.trim(), icon || 'home', parseFloat(latitude), parseFloat(longitude), req.user.id]
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM places WHERE id = $1', [req.params.id]);
        res.sendStatus(204);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

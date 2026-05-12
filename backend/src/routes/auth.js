const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function signToken(userId) {
    return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    });
}

// POST /api/auth/register  — via invitation token
router.post('/register', async (req, res) => {
    const { token, name, email, password } = req.body;
    if (!token || !name || !email || !password) {
        return res.status(400).json({ error: 'token, name, email and password are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: invRows } = await client.query(
            `SELECT * FROM invitations
             WHERE token = $1 AND used_by IS NULL AND expires_at > NOW()`,
            [token]
        );
        if (!invRows[0]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid or expired invitation' });
        }

        const { rows: existing } = await client.query(
            'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
        );
        if (existing[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already in use' });
        }

        const hash = await bcrypt.hash(password, 12);
        const colors = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#8B5CF6','#EC4899'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const { rows: userRows } = await client.query(
            `INSERT INTO users (name, email, password_hash, color)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [name.trim(), email.toLowerCase(), hash, color]
        );
        const userId = userRows[0].id;

        await client.query(
            `UPDATE invitations SET used_by = $1, used_at = NOW() WHERE id = $2`,
            [userId, invRows[0].id]
        );

        await client.query('COMMIT');
        res.status(201).json({ token: signToken(userId) });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Registration failed' });
    } finally {
        client.release();
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await pool.query(
        'SELECT id, password_hash, is_active FROM users WHERE email = $1',
        [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ token: signToken(user.id) });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
    res.json(req.user);
});

// POST /api/auth/invite  — admin only, creates an invitation link
router.post('/invite', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }

    const token = uuidv4().replace(/-/g, '');
    await pool.query(
        'INSERT INTO invitations (token, created_by) VALUES ($1, $2)',
        [token, req.user.id]
    );

    try { require('./admin').audit(req.user.id, 'invite_create', null, { token_prefix: token.slice(0, 8) }); } catch {}
    res.status(201).json({ token, url: `/register?token=${token}` });
});

// POST /api/auth/guest-invite — admin creates a temporary guest access link (no password required)
router.post('/guest-invite', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    try {
        const { name, duration_hours = 24 } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

        const colors     = ['#EF4444','#F97316','#22C55E','#3B82F6','#8B5CF6','#EC4899'];
        const color      = colors[Math.floor(Math.random() * colors.length)];
        const expiresAt  = new Date(Date.now() + Math.min(parseInt(duration_hours) || 24, 168) * 3_600_000);

        const { rows } = await pool.query(
            `INSERT INTO users (name, email, password_hash, color, role, guest_expires_at, is_active)
             VALUES ($1, $2, '$invalid$', $3, 'guest', $4, TRUE) RETURNING id`,
            [name.trim(), `guest_${Date.now()}@temp.local`, color, expiresAt]
        );

        const guestToken = signToken(rows[0].id);
        const origin     = req.headers.origin || `${req.protocol}://${req.headers.host}`;
        const url        = `${origin}/login.html?auto_token=${guestToken}`;

        res.status(201).json({ token: guestToken, url, expires_at: expiresAt, name: name.trim() });
    } catch (err) {
        console.error('[guest-invite]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/invitations  — admin: list pending invitations
router.get('/invitations', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }

    const { rows } = await pool.query(
        `SELECT i.id, i.token, i.expires_at, i.created_at,
                u.name AS used_by_name
         FROM invitations i
         LEFT JOIN users u ON u.id = i.used_by
         ORDER BY i.created_at DESC`
    );
    res.json(rows);
});

module.exports = router;

const jwt = require('jsonwebtoken');
const pool = require('../config/database');

async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing token' });
    }

    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const { rows } = await pool.query(
            'SELECT id, name, email, role, color, avatar_url, status, is_active, guest_expires_at FROM users WHERE id = $1',
            [payload.sub]
        );
        if (!rows[0] || !rows[0].is_active) {
            return res.status(401).json({ error: 'Account inactive or not found' });
        }
        if (rows[0].role === 'guest' && rows[0].guest_expires_at) {
            if (new Date(rows[0].guest_expires_at) < new Date()) {
                await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [rows[0].id]);
                return res.status(401).json({ error: 'Accès temporaire expiré' });
            }
        }
        req.user = rows[0];
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = { authenticate, requireAdmin };

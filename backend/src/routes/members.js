const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { audit } = require('./admin');

const router = express.Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${req.user.id}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    },
});

// GET /api/members
router.get('/', authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const adminCols = isAdmin ? ', rate_limit_positions_day, rate_limit_messages_day' : '';
    const { rows } = await pool.query(
        `SELECT id, name, email, color, avatar_url, role, status, is_active, created_at${adminCols}
         FROM users
         ORDER BY created_at ASC`
    );
    res.json(rows);
});

// GET /api/members/:id
router.get('/:id', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, name, email, color, avatar_url, role, status, is_active, created_at
         FROM users WHERE id = $1`,
        [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
});

// PATCH /api/members/:id  — update own profile (or admin for any)
router.patch('/:id', authenticate, async (req, res) => {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, color, status } = req.body;
    const { rows } = await pool.query(
        `UPDATE users SET
            name   = COALESCE($1, name),
            color  = COALESCE($2, color),
            status = COALESCE($3, status)
         WHERE id = $4
         RETURNING id, name, color, avatar_url, status, role`,
        [name ?? null, color ?? null, status ?? null, req.params.id]
    );
    res.json(rows[0]);
});

// PATCH /api/members/:id/password
router.patch('/:id/password', authenticate, async (req, res) => {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    // Admin can change without current password, regular user must provide it
    if (req.user.role !== 'admin') {
        const valid = await bcrypt.compare(current_password || '', rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect current password' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    res.json({ message: 'Password updated' });
});

// POST /api/members/:id/avatar
router.post('/:id/avatar', authenticate, upload.single('avatar'), async (req, res) => {
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const avatarUrl = `/api/uploads/${req.file.filename}`;
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.params.id]);
    res.json({ avatar_url: avatarUrl });
});

// POST /api/members/:id/push-subscription
router.post('/:id/push-subscription', authenticate, async (req, res) => {
    if (req.params.id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    await pool.query('UPDATE users SET push_subscription = $1 WHERE id = $2', [
        req.body.subscription ?? null,
        req.user.id,
    ]);
    res.json({ message: 'Push subscription saved' });
});

// ── Admin endpoints ──────────────────────────────────────────────────────────

// PATCH /api/members/:id/activate  — admin: enable/disable account
router.patch('/:id/activate', authenticate, requireAdmin, async (req, res) => {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active (boolean) is required' });
    }
    await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active, req.params.id]);
    audit(req.user.id, is_active ? 'user_enable' : 'user_disable', req.params.id, {}).catch(() => {});
    res.json({ message: `Account ${is_active ? 'enabled' : 'disabled'}` });
});

// DELETE /api/members/:id  — admin only
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const { rows } = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    audit(req.user.id, 'user_delete', req.params.id, { name: rows[0]?.name, email: rows[0]?.email }).catch(() => {});
    res.status(204).end();
});

// GET /api/members/stats/global  — admin dashboard stats
router.get('/stats/global', authenticate, requireAdmin, async (req, res) => {
    try {
        const [memberCount, posCount, distRow] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users WHERE is_active = TRUE'),
            pool.query('SELECT COUNT(*) FROM positions'),
            // Subquery required: window function (LAG) can't be nested inside aggregate (SUM)
            pool.query(`
                SELECT user_id, name,
                    COALESCE(SUM(step_dist) / 1000, 0) AS distance_km
                FROM (
                    SELECT p.user_id, u.name,
                        ST_Distance(
                            location::geometry,
                            LAG(location::geometry) OVER (PARTITION BY p.user_id ORDER BY recorded_at)
                        ) AS step_dist
                    FROM positions p
                    JOIN users u ON u.id = p.user_id
                ) sub
                GROUP BY user_id, name
                ORDER BY distance_km DESC NULLS LAST
                LIMIT 5
            `),
        ]);

        res.json({
            active_members: parseInt(memberCount.rows[0].count),
            total_positions: parseInt(posCount.rows[0].count),
            top_members: distRow.rows,
        });
    } catch (err) {
        console.error('[stats/global]', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

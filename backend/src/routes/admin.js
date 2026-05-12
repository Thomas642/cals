const express = require('express');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { execSync } = require('child_process');

const router = express.Router();

const OSRM_URL = process.env.OSRM_URL || 'http://osrm:5000';

// ── GET /api/admin/health ───────────────────────────────────────────────────
// Live server status: DB, OSRM, disk, memory, table counts.
router.get('/health', authenticate, requireAdmin, async (req, res) => {
    const out = {
        timestamp: new Date().toISOString(),
        db:        { status: 'unknown' },
        osrm:      { status: 'unknown' },
        disk:      null,
        memory:    null,
        uptime_s:  Math.round(process.uptime()),
        counts:    {},
    };

    // DB ping + size + counts
    try {
        await pool.query('SELECT 1');
        const { rows: sizeRows } = await pool.query(
            `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
        );
        const counts = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS n FROM users WHERE is_active = TRUE'),
            pool.query('SELECT COUNT(*)::int AS n FROM positions'),
            pool.query('SELECT COUNT(*)::int AS n FROM messages'),
            pool.query('SELECT COUNT(*)::int AS n FROM zones WHERE is_active = TRUE'),
            pool.query("SELECT COUNT(*)::int AS n FROM share_tokens WHERE expires_at > NOW()"),
            pool.query("SELECT COUNT(*)::int AS n FROM positions WHERE recorded_at > NOW() - INTERVAL '24 hours'"),
        ]);
        out.db = { status: 'ok', size: sizeRows[0].size };
        out.counts = {
            users:          counts[0].rows[0].n,
            positions:      counts[1].rows[0].n,
            messages:       counts[2].rows[0].n,
            zones:          counts[3].rows[0].n,
            active_shares:  counts[4].rows[0].n,
            positions_24h:  counts[5].rows[0].n,
        };
    } catch (err) {
        out.db = { status: 'error', error: err.message };
    }

    // OSRM ping (Aquitaine route — trivial query)
    try {
        const r = await fetch(`${OSRM_URL}/route/v1/driving/-0.624,43.700;-0.611,43.704`, {
            signal: AbortSignal.timeout(3000),
        });
        out.osrm = { status: r.ok ? 'ok' : 'error', http: r.status };
    } catch {
        out.osrm = { status: 'unavailable' };
    }

    // Disk usage on /
    try {
        const df = execSync('df -h --output=size,used,avail,pcent /').toString().trim().split('\n')[1].trim().split(/\s+/);
        out.disk = { size: df[0], used: df[1], avail: df[2], use_pct: df[3] };
    } catch {}

    // Memory (Node process)
    const m = process.memoryUsage();
    out.memory = {
        rss_mb:        Math.round(m.rss / 1024 / 1024),
        heap_used_mb:  Math.round(m.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(m.heapTotal / 1024 / 1024),
    };

    res.json(out);
});

// ── GET /api/admin/audit ────────────────────────────────────────────────────
router.get('/audit', authenticate, requireAdmin, async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await pool.query(
        `SELECT
            a.id, a.action, a.details, a.created_at,
            u.id AS actor_id, u.name AS actor_name,
            t.id AS target_id, t.name AS target_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN users t ON t.id = a.target_id
         ORDER BY a.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    res.json(rows);
});

// ── PUT /api/admin/limits/:userId ──────────────────────────────────────────
// Body: { positions_per_day, messages_per_day }   — null = unlimited
router.put('/limits/:userId', authenticate, requireAdmin, async (req, res) => {
    const { positions_per_day, messages_per_day } = req.body || {};
    const pos = positions_per_day === null ? null : (parseInt(positions_per_day) || null);
    const msg = messages_per_day  === null ? null : (parseInt(messages_per_day)  || null);

    const { rows } = await pool.query(
        `UPDATE users
            SET rate_limit_positions_day = $1,
                rate_limit_messages_day  = $2
          WHERE id = $3
          RETURNING id, name, rate_limit_positions_day, rate_limit_messages_day`,
        [pos, msg, req.params.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    audit(req.user.id, 'limits_update', req.params.userId, { pos, msg }).catch(() => {});
    res.json(rows[0]);
});

// ── Helper exported for other routes to log audit events ────────────────────
async function audit(actorId, action, targetId, details) {
    try {
        await pool.query(
            `INSERT INTO audit_log (actor_id, action, target_id, details)
             VALUES ($1, $2, $3, $4)`,
            [actorId || null, action, targetId || null, details || {}]
        );
    } catch (err) {
        console.warn('[audit] failed:', err.message);
    }
}

module.exports = router;
module.exports.audit = audit;

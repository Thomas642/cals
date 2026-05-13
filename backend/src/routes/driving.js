const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/driving/report?period=week|month ───────────────────────────────
// Returns Life360-style driving report : per-member incident counts + global
// stats (max speed, trips, km, etc.) over the period.
router.get('/report', authenticate, async (req, res) => {
    const period = req.query.period === 'month' ? 'month' : 'week';
    const days   = period === 'month' ? 30 : 7;

    try {
        // Per-member incident counts
        const { rows: byMember } = await pool.query(
            `SELECT u.id AS user_id, u.name, u.color, u.avatar_url,
                COUNT(*) FILTER (WHERE i.incident_type = 'hard_brake')  AS hard_brake,
                COUNT(*) FILTER (WHERE i.incident_type = 'hard_accel')  AS hard_accel,
                COUNT(*) FILTER (WHERE i.incident_type = 'speeding')    AS speeding,
                COUNT(*) FILTER (WHERE i.incident_type = 'sharp_turn')  AS sharp_turn,
                COUNT(*)                                                 AS total_incidents
             FROM users u
             LEFT JOIN driving_incidents i
                ON i.user_id = u.id
               AND i.recorded_at > NOW() - ($1 || ' days')::INTERVAL
             WHERE u.is_active = TRUE
             GROUP BY u.id, u.name, u.color, u.avatar_url
             ORDER BY total_incidents DESC, u.name`,
            [days]
        );

        // Global stats : km parcourus + trajets + vitesse max (haversine sum
        // from positions, same approach as history/stats endpoints)
        const { rows: [globalRow] } = await pool.query(`
            WITH pts AS (
                SELECT user_id,
                       location,
                       speed,
                       recorded_at,
                       LAG(location)    OVER (PARTITION BY user_id ORDER BY recorded_at) AS prev_loc,
                       LAG(recorded_at) OVER (PARTITION BY user_id ORDER BY recorded_at) AS prev_at
                FROM positions
                WHERE recorded_at > NOW() - ($1 || ' days')::INTERVAL
            ),
            steps AS (
                SELECT user_id, speed,
                    ST_Distance(location, prev_loc) / 1000.0 AS step_km,
                    EXTRACT(EPOCH FROM (recorded_at - prev_at)) AS step_s
                FROM pts
                WHERE prev_loc IS NOT NULL
                  AND EXTRACT(EPOCH FROM (recorded_at - prev_at)) BETWEEN 1 AND 1800
            )
            SELECT
                COALESCE(ROUND(SUM(step_km)::numeric, 1), 0) AS total_km,
                COALESCE(ROUND(MAX(speed)::numeric, 0), 0)   AS max_speed_kmh,
                COUNT(DISTINCT user_id)                       AS active_drivers
            FROM steps
        `, [days]);

        res.json({
            period,
            days,
            global: {
                total_km:       parseFloat(globalRow.total_km),
                max_speed_kmh:  parseInt(globalRow.max_speed_kmh),
                active_drivers: parseInt(globalRow.active_drivers),
            },
            members: byMember.map((m) => ({
                user_id:        m.user_id,
                name:           m.name,
                color:          m.color,
                avatar_url:     m.avatar_url,
                hard_brake:     parseInt(m.hard_brake),
                hard_accel:     parseInt(m.hard_accel),
                speeding:       parseInt(m.speeding),
                sharp_turn:     parseInt(m.sharp_turn),
                total_incidents: parseInt(m.total_incidents),
            })),
        });
    } catch (err) {
        console.error('[driving/report]', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Internal helper : detect and store incidents from a new position ───────
// Called from positions.js after each POST /api/positions insert.
// Compares the new fix against the user's previous 2 fixes to compute
// acceleration, deceleration and bearing change, and inserts incidents
// when thresholds are crossed. CPU-light : single query, single insert.
const SPEEDING_KMH = 110;

async function detectIncidents(userId, currentSpeedKmh, currentLat, currentLng, recordedAt) {
    try {
        const { rows: prev } = await pool.query(
            `SELECT speed, recorded_at,
                    ST_Y(location::geometry) AS lat,
                    ST_X(location::geometry) AS lng
             FROM positions
             WHERE user_id = $1 AND recorded_at < $2
             ORDER BY recorded_at DESC
             LIMIT 2`,
            [userId, recordedAt]
        );
        if (!prev.length) return;

        const p1 = prev[0];
        const dt = (new Date(recordedAt) - new Date(p1.recorded_at)) / 1000; // seconds
        if (dt < 1 || dt > 60) return;   // ignore stale or duplicate fixes

        const currentMs = (currentSpeedKmh || 0) / 3.6;
        const prevMs    = (p1.speed || 0) / 3.6;
        const accelMs2  = (currentMs - prevMs) / dt;       // positive = accelerating

        const incidents = [];

        // Hard braking : sustained decel > 4 m/s² (≈ 0.4 g)
        if (accelMs2 < -4 && prevMs > 5) {
            incidents.push({ type: 'hard_brake', severity: accelMs2 < -6 ? 3 : 2 });
        }
        // Hard acceleration : > 4 m/s²
        if (accelMs2 > 4 && currentMs > 3) {
            incidents.push({ type: 'hard_accel', severity: accelMs2 > 6 ? 3 : 2 });
        }
        // Speeding (single-fix detection — coarse but consistent with Life360)
        if (currentSpeedKmh > SPEEDING_KMH) {
            incidents.push({ type: 'speeding', severity: currentSpeedKmh > 140 ? 3 : currentSpeedKmh > 125 ? 2 : 1 });
        }
        // Sharp turn : bearing change > 45° with ≥ 2 prior fixes and decent speed
        if (prev.length === 2 && currentSpeedKmh > 30) {
            const p2 = prev[1];
            const b1 = bearing(p2.lat, p2.lng, p1.lat, p1.lng);
            const b2 = bearing(p1.lat, p1.lng, currentLat, currentLng);
            const delta = Math.abs(((b2 - b1 + 540) % 360) - 180);  // 0..180
            if (delta > 45) {
                incidents.push({ type: 'sharp_turn', severity: delta > 80 ? 2 : 1 });
            }
        }

        for (const inc of incidents) {
            await pool.query(
                `INSERT INTO driving_incidents (user_id, incident_type, severity, speed_kmh, location, recorded_at)
                 VALUES ($1, $2, $3, $4, ST_GeogFromText($5), $6)`,
                [userId, inc.type, inc.severity, currentSpeedKmh, `POINT(${currentLng} ${currentLat})`, recordedAt]
            );
        }
    } catch (err) {
        console.warn('[driving] detection failed:', err.message);
    }
}

function bearing(lat1, lng1, lat2, lng2) {
    const toRad = (d) => d * Math.PI / 180;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

module.exports = router;
module.exports.detectIncidents = detectIncidents;

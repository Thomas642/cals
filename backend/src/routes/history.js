const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/history  — list trips for a member within a date range
// Query params: userId, from (ISO date), to (ISO date)
router.get('/', authenticate, async (req, res) => {
    const { userId, from, to } = req.query;
    const targetId = userId || req.user.id;

    const params = [targetId];
    const conditions = ['user_id = $1'];

    if (from) {
        params.push(new Date(from));
        conditions.push(`recorded_at >= $${params.length}`);
    }
    if (to) {
        const toDate = new Date(to);
        toDate.setDate(toDate.getDate() + 1); // inclusive end
        params.push(toDate);
        conditions.push(`recorded_at < $${params.length}`);
    }

    const { rows } = await pool.query(
        `SELECT
            id,
            battery,
            speed,
            accuracy,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            recorded_at
         FROM positions
         WHERE ${conditions.join(' AND ')}
         ORDER BY recorded_at ASC`,
        params
    );

    // Group into trips: a new trip starts if gap > 10 minutes
    const GAP_MS = 10 * 60 * 1000;
    const trips = [];
    let current = null;

    for (const pt of rows) {
        if (!current) {
            current = { points: [pt], started_at: pt.recorded_at };
        } else {
            const gap = new Date(pt.recorded_at) - new Date(current.points.at(-1).recorded_at);
            if (gap > GAP_MS) {
                trips.push(summariseTrip(current));
                current = { points: [pt], started_at: pt.recorded_at };
            } else {
                current.points.push(pt);
            }
        }
    }
    if (current) trips.push(summariseTrip(current));

    res.json(trips);
});

// GET /api/history/stats/week — per-member summary for the last 7 days
router.get('/stats/week', authenticate, async (req, res) => {
    try {
        // Compute Haversine sum of consecutive positions per user over 7 days
        // Uses a window function to get step distances, then sums them per user
        const { rows } = await pool.query(`
            SELECT user_id, name, color,
                   COALESCE(ROUND(CAST(SUM(step_km) AS NUMERIC), 1), 0)  AS distance_km,
                   COUNT(DISTINCT day)                                     AS active_days,
                   COUNT(*)                                                AS position_count,
                   COALESCE(ROUND(CAST(AVG(NULLIF(speed, 0)) AS NUMERIC), 0), 0) AS avg_speed_kmh
            FROM (
                SELECT p.user_id, u.name, u.color, p.speed,
                       DATE_TRUNC('day', p.recorded_at) AS day,
                       COALESCE(
                           ST_Distance(
                               p.location::geometry,
                               LAG(p.location::geometry) OVER (PARTITION BY p.user_id ORDER BY p.recorded_at)
                           ) / 1000, 0
                       ) AS step_km
                FROM positions p
                JOIN users u ON u.id = p.user_id
                WHERE u.is_active = TRUE
                  AND p.recorded_at >= NOW() - INTERVAL '7 days'
            ) sub
            GROUP BY user_id, name, color
            ORDER BY distance_km DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('[history/stats/week]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/history/stats/month — per-member summary for the last 30 days
router.get('/stats/month', authenticate, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT user_id, name, color,
                   COALESCE(ROUND(CAST(SUM(step_km) AS NUMERIC), 1), 0)                    AS distance_km,
                   COUNT(DISTINCT day)                                                       AS active_days,
                   COUNT(*)                                                                  AS position_count,
                   COALESCE(ROUND(CAST(AVG(NULLIF(speed, 0)) AS NUMERIC), 0), 0)            AS avg_speed_kmh,
                   COALESCE(ROUND(CAST(MAX(speed) AS NUMERIC), 0), 0)                       AS max_speed_kmh,
                   COALESCE(ROUND(CAST(
                       SUM(CASE WHEN speed >= 30 THEN step_km ELSE 0 END) AS NUMERIC
                   ), 1), 0)                                                                 AS driving_km
            FROM (
                SELECT p.user_id, u.name, u.color, p.speed,
                       DATE_TRUNC('day', p.recorded_at) AS day,
                       COALESCE(
                           ST_Distance(
                               p.location::geometry,
                               LAG(p.location::geometry) OVER (PARTITION BY p.user_id ORDER BY p.recorded_at)
                           ) / 1000, 0
                       ) AS step_km
                FROM positions p
                JOIN users u ON u.id = p.user_id
                WHERE u.is_active = TRUE
                  AND p.recorded_at >= NOW() - INTERVAL '30 days'
            ) sub
            GROUP BY user_id, name, color
            ORDER BY distance_km DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('[history/stats/month]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/history/timeline — chronological day view (stays + trips)
router.get('/timeline', authenticate, async (req, res) => {
    try {
        const { userId, date } = req.query;
        if (!date) return res.status(400).json({ error: 'date is required' });

        const targetId = userId || req.user.id;
        const dayStart = new Date(date);
        const dayEnd   = new Date(date);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const [posResult, placesResult, zonesResult] = await Promise.all([
            pool.query(
                `SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                        speed, recorded_at
                 FROM positions WHERE user_id=$1 AND recorded_at BETWEEN $2 AND $3
                 ORDER BY recorded_at ASC`,
                [targetId, dayStart, dayEnd]
            ),
            pool.query(`SELECT id, name, icon, latitude, longitude FROM places`),
            pool.query(`SELECT id, name, radius, ST_Y(center::geometry) AS latitude, ST_X(center::geometry) AS longitude FROM zones WHERE is_active=TRUE`),
        ]);

        const pts    = posResult.rows;
        const places = placesResult.rows;
        const zones  = zonesResult.rows;

        if (!pts.length) return res.json([]);

        // Group by 5-min gaps, then classify stays vs trips
        const GAP_MS    = 5 * 60_000;
        const STAY_M    = 200; // < 200m total movement = stay

        const segments = [];
        let seg = { points: [pts[0]], started_at: pts[0].recorded_at };

        for (let i = 1; i < pts.length; i++) {
            const gap = new Date(pts[i].recorded_at) - new Date(pts[i - 1].recorded_at);
            if (gap > GAP_MS) {
                segments.push(seg);
                seg = { points: [pts[i]], started_at: pts[i].recorded_at };
            } else {
                seg.points.push(pts[i]);
            }
        }
        segments.push(seg);

        const events = segments.map((s) => {
            const first     = s.points[0];
            const last      = s.points[s.points.length - 1];
            const ended_at  = last.recorded_at;
            const durationMs = new Date(ended_at) - new Date(s.started_at);

            // Compute bounding-box diagonal = how far did the segment travel
            let maxDist = 0;
            for (let i = 1; i < s.points.length; i++) {
                maxDist += haversine(s.points[i-1].latitude, s.points[i-1].longitude,
                                     s.points[i].latitude,   s.points[i].longitude) * 1000;
            }

            const isStay    = maxDist < STAY_M;
            const centerLat = first.latitude;
            const centerLon = first.longitude;

            let label    = null;
            let icon     = null;
            let matchId  = null;

            if (isStay) {
                // Match against known places first, then zones
                for (const p of places) {
                    const d = haversine(centerLat, centerLon, p.latitude, p.longitude) * 1000;
                    if (d < 300) { label = p.name; icon = p.icon; matchId = p.id; break; }
                }
                if (!label) {
                    for (const z of zones) {
                        const d = haversine(centerLat, centerLon, z.latitude, z.longitude) * 1000;
                        if (d < z.radius + 100) { label = z.name; icon = 'zone'; matchId = z.id; break; }
                    }
                }
            }

            const avgSpeed = s.points.reduce((s, p) => s + (p.speed || 0), 0) / s.points.length;

            return {
                type:        isStay ? 'stay' : 'trip',
                started_at:  s.started_at,
                ended_at,
                duration_ms: durationMs,
                latitude:    centerLat,
                longitude:   centerLon,
                label,
                icon,
                match_id:    matchId,
                distance_m:  Math.round(maxDist),
                avg_speed:   Math.round(avgSpeed),
            };
        });

        res.json(events);
    } catch (err) {
        console.error('[history/timeline]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/history/raw — raw points for a time range (used by GPX export)
router.get('/raw', authenticate, async (req, res) => {
    const { userId, from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

    const targetId = userId || req.user.id;
    const { rows } = await pool.query(
        `SELECT
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            battery, speed, recorded_at
         FROM positions
         WHERE user_id = $1 AND recorded_at BETWEEN $2 AND $3
         ORDER BY recorded_at ASC`,
        [targetId, new Date(from), new Date(to)]
    );
    res.json(rows);
});

function summariseTrip(trip) {
    const pts = trip.points;
    const ended_at = pts.at(-1).recorded_at;

    // Distance using Haversine
    let distanceKm = 0;
    for (let i = 1; i < pts.length; i++) {
        distanceKm += haversine(
            pts[i - 1].latitude, pts[i - 1].longitude,
            pts[i].latitude, pts[i].longitude
        );
    }

    const durationMs = new Date(ended_at) - new Date(trip.started_at);
    const avgSpeed = durationMs > 0
        ? (distanceKm / (durationMs / 3_600_000))
        : 0;

    const maxSpeed = pts.reduce((mx, p) => Math.max(mx, p.speed || 0), 0);

    return {
        started_at: trip.started_at,
        ended_at,
        point_count: pts.length,
        distance_km: Math.round(distanceKm * 100) / 100,
        avg_speed_kmh: Math.round(avgSpeed * 10) / 10,
        max_speed_kmh: Math.round(maxSpeed),
        points: pts,
    };
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const toRad = (d) => (d * Math.PI) / 180;

module.exports = router;

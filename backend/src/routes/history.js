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

// GET /api/history/:tripId/points  — raw points for a specific trip
// We encode trips as "userId_from_to" for simplicity
router.get('/points', authenticate, async (req, res) => {
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

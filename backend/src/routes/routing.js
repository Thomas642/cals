const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── Internal config ─────────────────────────────────────────────────────────
const OSRM_URL = process.env.OSRM_URL || 'http://osrm:5000';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const UA = 'FamilyTracker/1.0 (self-hosted, contact admin)';

// Short in-memory cache for Nominatim to respect their fair-use policy
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheGet(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.data;
    cache.delete(key);
    return null;
}

function cacheSet(key, data) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 500) {
        // Drop oldest entries
        const cutoff = Date.now() - CACHE_TTL_MS;
        for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
    }
}

// ── POST /api/routing/route ─────────────────────────────────────────────────
// Body: { from: {lat, lng}, to: {lat, lng}, alternatives?: bool, steps?: bool }
// Returns: { distance_m, duration_s, geometry, steps?: [...], alternatives: [...] }
router.post('/route', authenticate, async (req, res) => {
    const { from, to, alternatives, steps } = req.body || {};
    if (!from || !to || from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
        return res.status(400).json({ error: 'from and to (with lat & lng) required' });
    }

    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=${alternatives ? 'true' : 'false'}&steps=${steps ? 'true' : 'false'}`;

    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) {
            return res.status(503).json({ error: 'Routing service error', status: r.status });
        }
        const data = await r.json();
        if (data.code !== 'Ok' || !data.routes?.length) {
            return res.status(404).json({ error: 'No route found' });
        }

        const mapRoute = (route) => {
            const out = {
                distance_m: Math.round(route.distance),
                duration_s: Math.round(route.duration),
                geometry: route.geometry,
            };
            if (steps) {
                // Flatten all leg steps into a single array (we only request a single leg anyway)
                out.steps = (route.legs || []).flatMap((leg) =>
                    (leg.steps || []).map((s) => ({
                        distance_m: Math.round(s.distance),
                        duration_s: Math.round(s.duration),
                        name: s.name || '',
                        ref: s.ref || '',
                        maneuver: {
                            type: s.maneuver?.type || '',
                            modifier: s.maneuver?.modifier || '',
                            location: s.maneuver?.location || null,
                            exit: s.maneuver?.exit || null,
                            bearing_after: s.maneuver?.bearing_after,
                        },
                        geometry: s.geometry,
                    }))
                );
            }
            return out;
        };

        const main = mapRoute(data.routes[0]);
        const alts = data.routes.slice(1).map(mapRoute);

        res.json({ ...main, alternatives: alts });
    } catch (err) {
        console.warn('[routing] OSRM error:', err.message);
        res.status(503).json({ error: 'Routing service unavailable' });
    }
});

// ── GET /api/routing/geocode?q=... ──────────────────────────────────────────
// Forward geocoding: address → coordinates
router.get('/geocode', authenticate, async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q || q.length < 3) return res.status(400).json({ error: 'q must be at least 3 chars' });

    const key = `g:${q.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const url = `${NOMINATIM_URL}/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1&accept-language=fr`;

    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!r.ok) return res.status(503).json({ error: 'Geocoding service error' });
        const data = await r.json();
        const results = (data || []).map((row) => ({
            display_name: row.display_name,
            latitude: parseFloat(row.lat),
            longitude: parseFloat(row.lon),
            type: row.type,
            address: row.address || {},
        }));
        cacheSet(key, results);
        res.json(results);
    } catch (err) {
        console.warn('[routing] Geocode error:', err.message);
        res.status(503).json({ error: 'Geocoding unavailable' });
    }
});

// ── GET /api/routing/reverse?lat=X&lng=Y ────────────────────────────────────
// Reverse geocoding: coordinates → address
router.get('/reverse', authenticate, async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'lat and lng required' });
    }

    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const url = `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=fr`;

    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!r.ok) return res.status(503).json({ error: 'Geocoding service error' });
        const data = await r.json();
        const out = {
            display_name: data.display_name || '',
            address: data.address || {},
            latitude: lat,
            longitude: lng,
        };
        cacheSet(key, out);
        res.json(out);
    } catch (err) {
        console.warn('[routing] Reverse error:', err.message);
        res.status(503).json({ error: 'Geocoding unavailable' });
    }
});

module.exports = router;

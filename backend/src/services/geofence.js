const pool = require('../config/database');
const webpush = require('web-push');

async function checkGeofences(userId, latitude, longitude, io) {
    // Get all active zones
    const { rows: zones } = await pool.query(
        `SELECT id, name, radius, notify_members,
                ST_Y(center::geometry) AS lat,
                ST_X(center::geometry) AS lon
         FROM zones WHERE is_active = TRUE`
    );

    for (const zone of zones) {
        const dist = haversineMeters(latitude, longitude, zone.lat, zone.lon);
        const inside = dist <= zone.radius;

        // Check current presence record
        const { rows: presence } = await pool.query(
            'SELECT 1 FROM zone_presence WHERE zone_id = $1 AND user_id = $2',
            [zone.id, userId]
        );
        const wasInside = presence.length > 0;

        if (inside && !wasInside) {
            await pool.query(
                'INSERT INTO zone_presence (zone_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [zone.id, userId]
            );
            await triggerZoneEvent('geofence_enter', userId, zone, io);
        } else if (!inside && wasInside) {
            await pool.query(
                'DELETE FROM zone_presence WHERE zone_id = $1 AND user_id = $2',
                [zone.id, userId]
            );
            await triggerZoneEvent('geofence_exit', userId, zone, io);
        }
    }
}

async function triggerZoneEvent(type, userId, zone, io) {
    const { rows: userRows } = await pool.query(
        'SELECT name, color FROM users WHERE id = $1', [userId]
    );
    const user = userRows[0];
    if (!user) return;

    const payload = {
        type,
        zone: { id: zone.id, name: zone.name },
        member: { id: userId, name: user.name, color: user.color },
        sent_at: new Date().toISOString(),
    };

    await pool.query(
        `INSERT INTO notifications_log (type, triggered_by, payload) VALUES ($1, $2, $3)`,
        [type, userId, payload]
    );

    // WebSocket broadcast
    if (io) io.emit(type, payload);

    // Push: use notify_members list if set, otherwise broadcast to all family (except triggering user)
    const action = type === 'geofence_enter' ? 'est arrivé(e) à' : 'a quitté';
    const pushBody = JSON.stringify({
        title: `📍 ${user.name} ${action} "${zone.name}"`,
        body:  new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        icon:  '/icons/icon-192.png',
        data:  payload,
    });

    let subsQuery, subsParams;
    if (zone.notify_members?.length) {
        subsQuery  = 'SELECT push_subscription FROM users WHERE id = ANY($1) AND push_subscription IS NOT NULL';
        subsParams = [zone.notify_members];
    } else {
        subsQuery  = 'SELECT push_subscription FROM users WHERE is_active = TRUE AND id != $1 AND push_subscription IS NOT NULL';
        subsParams = [userId];
    }

    const { rows } = await pool.query(subsQuery, subsParams);
    await Promise.allSettled(
        rows.map((r) => webpush.sendNotification(r.push_subscription, pushBody))
    );
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6_371_000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const toRad = (d) => (d * Math.PI) / 180;

module.exports = { checkGeofences };

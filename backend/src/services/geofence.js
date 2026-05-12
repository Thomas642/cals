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

// Map zone name to auto-status
function getAutoStatus(zoneName) {
    const n = zoneName.toLowerCase();
    if (/maison|home/.test(n))              return '🏠 À la maison';
    if (/école|ecole|school/.test(n))       return '🏫 À l\'école';
    if (/travail|work|bureau/.test(n))      return '💼 Au travail';
    if (/sport|gym/.test(n))                return '🏋️ Au sport';
    if (/courses|shop/.test(n))             return '🛒 Aux courses';
    return null;
}

async function triggerZoneEvent(type, userId, zone, io) {
    const { rows: userRows } = await pool.query(
        'SELECT name, color, status FROM users WHERE id = $1', [userId]
    );
    const user = userRows[0];
    if (!user) return;

    const action = type === 'geofence_enter' ? 'est arrivé(e) à' : 'a quitté';
    const emoji  = type === 'geofence_enter' ? '✅' : '👋';

    // Auto-status based on zone name
    const autoStatus = getAutoStatus(zone.name);
    if (autoStatus) {
        if (type === 'geofence_enter') {
            await pool.query('UPDATE users SET status = $1 WHERE id = $2', [autoStatus, userId]);
            if (io) io.emit('status_update', { user_id: userId, status: autoStatus });
        } else if (type === 'geofence_exit' && user.status === autoStatus) {
            await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['', userId]);
            if (io) io.emit('status_update', { user_id: userId, status: '' });
        }
    }

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

    // Auto check-in: post a chat message visible to the whole family
    const chatText = `${emoji} ${user.name} ${action} « ${zone.name} »`;
    const { rows: msgRows } = await pool.query(
        `INSERT INTO messages (user_id, text) VALUES ($1, $2) RETURNING id, user_id, text, sent_at`,
        [userId, chatText]
    );
    const msg = msgRows[0];

    // WebSocket broadcast — zone event + auto chat message
    if (io) {
        io.emit(type, payload);
        io.emit('chat_message', {
            id:      msg.id,
            user_id: userId,
            name:    user.name,
            color:   user.color,
            text:    msg.text,
            sent_at: msg.sent_at,
            auto:    true,
        });
    }

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

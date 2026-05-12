const pool = require('../config/database');
const webpush = require('web-push');

const DISCONNECT_THRESHOLD_MIN = parseInt(process.env.DISCONNECT_THRESHOLD_MIN) || 15;
const BATTERY_WARN_THRESHOLD   = 15;
const INACTIVITY_HOURS         = parseInt(process.env.INACTIVITY_HOURS) || 4;
const ALERT_COOLDOWN_MS        = 30 * 60 * 1000; // 30 min

// In-memory cooldown maps
const batteryCooldown   = new Map(); // userId → timestamp
const offlineCooldown   = new Map(); // userId → timestamp
const inactivityCooldown = new Map(); // userId → timestamp
// Track last known position for inactivity: userId → {lat, lon, since}
const lastMovedPos      = new Map();

async function runWatchdog(io) {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (user_id)
                p.user_id, u.name, u.color,
                p.battery, p.recorded_at,
                ST_Y(p.location::geometry) AS latitude,
                ST_X(p.location::geometry) AS longitude
             FROM positions p
             JOIN users u ON u.id = p.user_id
             WHERE u.is_active = TRUE
             ORDER BY user_id, recorded_at DESC`
        );

        const now = Date.now();

        for (const row of rows) {
            const ageMin = (now - new Date(row.recorded_at).getTime()) / 60_000;
            const member = { id: row.user_id, name: row.name, color: row.color };

            // ── Offline check ───────────────────────────────────────────────────
            if (ageMin > DISCONNECT_THRESHOLD_MIN) {
                const last = offlineCooldown.get(row.user_id) || 0;
                if (now - last > ALERT_COOLDOWN_MS) {
                    offlineCooldown.set(row.user_id, now);
                    await notifyFamily(io, row.user_id, 'member_offline',
                        { type: 'member_offline', member, sent_at: new Date().toISOString() },
                        {
                            title: `⚠️ ${row.name} est déconnecté(e)`,
                            body:  `Aucune position depuis ${Math.floor(ageMin)} min`,
                        }
                    );
                }
            } else {
                offlineCooldown.delete(row.user_id);
            }

            // ── Battery check ───────────────────────────────────────────────────
            if (row.battery != null && row.battery < BATTERY_WARN_THRESHOLD) {
                const last = batteryCooldown.get(row.user_id) || 0;
                if (now - last > ALERT_COOLDOWN_MS) {
                    batteryCooldown.set(row.user_id, now);
                    await notifyFamily(io, row.user_id, 'battery',
                        { type: 'battery', member, battery: row.battery, sent_at: new Date().toISOString() },
                        {
                            title: `🔋 Batterie critique — ${row.name}`,
                            body:  `La batterie de ${row.name} est à ${row.battery}%`,
                        }
                    );
                }
            } else if (row.battery != null && row.battery >= BATTERY_WARN_THRESHOLD + 10) {
                batteryCooldown.delete(row.user_id);
            }

            // ── Inactivity check (active but not moving) ────────────────────────
            if (ageMin <= DISCONNECT_THRESHOLD_MIN && row.latitude && row.longitude) {
                const prev = lastMovedPos.get(row.user_id);
                const distM = prev ? haversineM(prev.lat, prev.lon, row.latitude, row.longitude) : Infinity;

                if (!prev || distM > 50) {
                    // User moved — reset inactivity clock
                    lastMovedPos.set(row.user_id, { lat: row.latitude, lon: row.longitude, since: now });
                    inactivityCooldown.delete(row.user_id);
                } else {
                    // Still in same spot — check if threshold exceeded
                    const stationarySec = (now - prev.since) / 1000;
                    const last = inactivityCooldown.get(row.user_id) || 0;
                    if (stationarySec > INACTIVITY_HOURS * 3600 && now - last > ALERT_COOLDOWN_MS) {
                        inactivityCooldown.set(row.user_id, now);
                        const hours = Math.round(stationarySec / 3600);
                        await notifyFamily(io, row.user_id, 'inactivity',
                            { type: 'inactivity', member, sent_at: new Date().toISOString() },
                            {
                                title: `🔔 ${row.name} n'a pas bougé`,
                                body:  `Aucun déplacement depuis ${hours}h`,
                            }
                        );
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Watchdog]', err);
    }
}

async function notifyFamily(io, excludeUserId, eventType, socketPayload, pushContent) {
    if (io) io.emit(eventType, socketPayload);

    const { rows } = await pool.query(
        `SELECT push_subscription FROM users
         WHERE is_active = TRUE AND id != $1 AND push_subscription IS NOT NULL`,
        [excludeUserId]
    );

    await Promise.allSettled(
        rows.map((r) =>
            webpush.sendNotification(
                r.push_subscription,
                JSON.stringify({
                    title: pushContent.title,
                    body:  pushContent.body,
                    icon:  '/icons/icon-192.png',
                    data:  socketPayload,
                })
            )
        )
    );
}

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6_371_000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startWatchdog(io) {
    const intervalMs = Math.max((DISCONNECT_THRESHOLD_MIN / 2) * 60_000, 60_000);
    setInterval(() => runWatchdog(io), intervalMs);
}

module.exports = { startWatchdog };

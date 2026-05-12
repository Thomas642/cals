const pool = require('../config/database');
const webpush = require('web-push');

const DISCONNECT_THRESHOLD_MIN = parseInt(process.env.DISCONNECT_THRESHOLD_MIN) || 15;
const BATTERY_WARN_THRESHOLD   = 15;
const ALERT_COOLDOWN_MS        = 30 * 60 * 1000; // 30 min between same alert

// In-memory cooldown maps to avoid spamming
const batteryCooldown  = new Map(); // userId → timestamp
const offlineCooldown  = new Map(); // userId → timestamp

async function runWatchdog(io) {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (user_id)
                p.user_id, u.name, u.color, p.battery, p.recorded_at
             FROM positions p
             JOIN users u ON u.id = p.user_id
             WHERE u.is_active = TRUE
             ORDER BY user_id, recorded_at DESC`
        );

        const now = Date.now();

        for (const row of rows) {
            const ageMin = (now - new Date(row.recorded_at).getTime()) / 60_000;

            if (ageMin > DISCONNECT_THRESHOLD_MIN) {
                const last = offlineCooldown.get(row.user_id) || 0;
                if (now - last > ALERT_COOLDOWN_MS) {
                    offlineCooldown.set(row.user_id, now);
                    await notifyFamily(io, row.user_id, 'member_offline', {
                        type:   'member_offline',
                        member: { id: row.user_id, name: row.name, color: row.color },
                        sent_at: new Date().toISOString(),
                    }, {
                        title: `⚠️ ${row.name} est déconnecté(e)`,
                        body:  `Aucune position depuis ${Math.floor(ageMin)} min`,
                    });
                }
            } else {
                // Back online — reset cooldown so next offline triggers immediately
                offlineCooldown.delete(row.user_id);
            }

            if (row.battery != null && row.battery < BATTERY_WARN_THRESHOLD) {
                const last = batteryCooldown.get(row.user_id) || 0;
                if (now - last > ALERT_COOLDOWN_MS) {
                    batteryCooldown.set(row.user_id, now);
                    await notifyFamily(io, row.user_id, 'battery', {
                        type:   'battery',
                        member: { id: row.user_id, name: row.name, color: row.color },
                        battery: row.battery,
                        sent_at: new Date().toISOString(),
                    }, {
                        title: `🔋 Batterie critique — ${row.name}`,
                        body:  `La batterie de ${row.name} est à ${row.battery}%`,
                    });
                }
            } else if (row.battery != null && row.battery >= BATTERY_WARN_THRESHOLD + 10) {
                batteryCooldown.delete(row.user_id);
            }
        }
    } catch (err) {
        console.error('[Watchdog]', err);
    }
}

// Broadcast socket event + push to ALL active family members (except the member themselves)
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

function startWatchdog(io) {
    const intervalMs = Math.max((DISCONNECT_THRESHOLD_MIN / 2) * 60_000, 60_000);
    setInterval(() => runWatchdog(io), intervalMs);
}

module.exports = { startWatchdog };

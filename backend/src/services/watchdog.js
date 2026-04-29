// Periodically checks for members with low battery or who went offline
const pool = require('../config/database');
const webpush = require('web-push');

const DISCONNECT_THRESHOLD_MIN = parseInt(process.env.DISCONNECT_THRESHOLD_MIN) || 15;
const BATTERY_WARN_THRESHOLD = 10;

async function runWatchdog(io) {
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (user_id)
                p.user_id, u.name, u.color, p.battery, p.recorded_at,
                u.push_subscription
             FROM positions p
             JOIN users u ON u.id = p.user_id
             WHERE u.is_active = TRUE
             ORDER BY user_id, recorded_at DESC`
        );

        const now = Date.now();
        for (const row of rows) {
            const ageMin = (now - new Date(row.recorded_at).getTime()) / 60_000;

            if (ageMin > DISCONNECT_THRESHOLD_MIN) {
                await notify(io, row, 'disconnect', {
                    title: `⚠️ ${row.name} est déconnecté(e)`,
                    body: `Aucune position depuis ${Math.floor(ageMin)} min`,
                });
            } else if (row.battery != null && row.battery < BATTERY_WARN_THRESHOLD) {
                await notify(io, row, 'battery', {
                    title: `🔋 Batterie faible — ${row.name}`,
                    body: `Batterie à ${row.battery}%`,
                });
            }
        }
    } catch (err) {
        console.error('Watchdog error:', err);
    }
}

async function notify(io, member, type, { title, body }) {
    const payload = { type, member: { id: member.user_id, name: member.name }, sent_at: new Date().toISOString() };

    if (io) io.emit(type, payload);

    if (member.push_subscription) {
        try {
            await webpush.sendNotification(
                member.push_subscription,
                JSON.stringify({ title, body, icon: '/icons/icon-192.png', data: payload })
            );
        } catch {}
    }
}

function startWatchdog(io) {
    const interval = (DISCONNECT_THRESHOLD_MIN / 2) * 60_000;
    setInterval(() => runWatchdog(io), Math.max(interval, 60_000));
}

module.exports = { startWatchdog };

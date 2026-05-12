const pool = require('../config/database');
const webpush = require('web-push');

const DISCONNECT_THRESHOLD_MIN = parseInt(process.env.DISCONNECT_THRESHOLD_MIN) || 15;
const BATTERY_WARN_THRESHOLD   = 15;
const INACTIVITY_HOURS         = parseInt(process.env.INACTIVITY_HOURS) || 4;
const ALERT_COOLDOWN_MS        = 30 * 60 * 1000; // 30 min

// In-memory cooldown maps
const batteryCooldown    = new Map(); // userId → timestamp
const offlineCooldown    = new Map(); // userId → timestamp
const inactivityCooldown = new Map(); // userId → timestamp
const scheduleCooldown   = new Map(); // alertId_date → boolean
const lastMovedPos       = new Map(); // userId → {lat, lon, since}

let weeklyReportDate = null;  // last date weekly report was sent (YYYY-MM-DD)
let noneHomeSentDate = null;  // last date none-home alert was sent

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

            // ── Inactivity check ────────────────────────────────────────────────
            if (ageMin <= DISCONNECT_THRESHOLD_MIN && row.latitude && row.longitude) {
                const prev  = lastMovedPos.get(row.user_id);
                const distM = prev ? haversineM(prev.lat, prev.lon, row.latitude, row.longitude) : Infinity;

                if (!prev || distM > 50) {
                    lastMovedPos.set(row.user_id, { lat: row.latitude, lon: row.longitude, since: now });
                    inactivityCooldown.delete(row.user_id);
                } else {
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

        // ── Combined alert: nobody home after 23:00 ─────────────────────────────
        await checkNoneHome(io, rows);

        // ── Schedule alerts ─────────────────────────────────────────────────────
        await checkScheduleAlerts(io, rows);

        // ── Weekly driving report (Sunday 20:00) ────────────────────────────────
        await checkWeeklyReport(io);

    } catch (err) {
        console.error('[Watchdog]', err);
    }
}

// ── None-home combined alert ─────────────────────────────────────────────────
async function checkNoneHome(io, positions) {
    const now  = new Date();
    const hour = now.getHours();
    if (hour < 23 && hour >= 3) return; // only 23:00–03:00

    const { rows: homeZones } = await pool.query(
        `SELECT id, radius, ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lon
         FROM zones WHERE is_active=TRUE AND LOWER(name) LIKE '%maison%' LIMIT 1`
    );
    if (!homeZones.length) return;
    const home = homeZones[0];

    const anyoneHome = positions.some((p) => {
        if (!p.latitude || !p.longitude) return false;
        return haversineM(p.latitude, p.longitude, home.lat, home.lon) <= home.radius;
    });

    if (!anyoneHome) {
        const today = now.toISOString().slice(0, 10);
        if (noneHomeSentDate === today) return;
        noneHomeSentDate = today;

        await notifyAll(io, 'none_home',
            { type: 'none_home', sent_at: new Date().toISOString() },
            {
                title: '🏠 Personne à la maison',
                body:  `Aucun membre n'est rentré (${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`,
            }
        );
    }
}

// ── Schedule alerts ───────────────────────────────────────────────────────────
async function checkScheduleAlerts(io, latestPositions) {
    const { rows: alerts } = await pool.query(
        `SELECT sa.id, sa.label, sa.expected_time, sa.tolerance_min, sa.days,
                sa.member_id,
                u.name AS member_name, u.color AS member_color,
                z.id   AS zone_id,
                ST_Y(z.center::geometry) AS zone_lat,
                ST_X(z.center::geometry) AS zone_lon,
                z.radius AS zone_radius, z.name AS zone_name
         FROM schedule_alerts sa
         JOIN users u ON u.id = sa.member_id
         JOIN zones z ON z.id = sa.zone_id
         WHERE sa.active = TRUE`
    );

    if (!alerts.length) return;

    const now  = new Date();
    const dow  = now.getDay() === 0 ? 7 : now.getDay(); // ISO weekday 1=Mon 7=Sun
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);

    for (const alert of alerts) {
        if (!alert.days.includes(String(dow)) && !alert.days.includes(dow)) continue;

        const [eh, em] = alert.expected_time.slice(0, 5).split(':').map(Number);
        const expectedMin = eh * 60 + em;
        const nowMin      = now.getHours() * 60 + now.getMinutes();
        const diff        = nowMin - expectedMin;

        // Fire within the tolerance window after expected_time
        if (diff < 0 || diff > alert.tolerance_min) continue;

        const cooldownKey = `${alert.id}_${today}`;
        if (scheduleCooldown.has(cooldownKey)) continue;

        // Check if member is in zone
        const pos = latestPositions.find((p) => p.user_id === alert.member_id);
        if (!pos?.latitude) continue;

        const dist = haversineM(pos.latitude, pos.longitude, alert.zone_lat, alert.zone_lon);
        if (dist <= alert.zone_radius) continue; // already there — all good

        scheduleCooldown.set(cooldownKey, true);
        const label = alert.label || `${alert.member_name} → ${alert.zone_name}`;
        await notifyAll(io, 'schedule_alert',
            {
                type: 'schedule_alert',
                member: { id: alert.member_id, name: alert.member_name, color: alert.member_color },
                zone:   { id: alert.zone_id, name: alert.zone_name },
                sent_at: new Date().toISOString(),
            },
            {
                title: `⏰ ${label}`,
                body:  `${alert.member_name} n'est pas encore à « ${alert.zone_name} » (attendu à ${alert.expected_time.slice(0, 5)})`,
            }
        );
    }
}

// ── Weekly driving report ─────────────────────────────────────────────────────
async function checkWeeklyReport(io) {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() !== 20) return; // Sunday 20:xx only
    const today = now.toISOString().slice(0, 10);
    if (weeklyReportDate === today) return;
    weeklyReportDate = today;

    try {
        const { rows } = await pool.query(`
            SELECT user_id, name,
                   COALESCE(ROUND(CAST(SUM(step_km) AS NUMERIC), 1), 0) AS distance_km,
                   COALESCE(ROUND(CAST(MAX(speed) AS NUMERIC), 0), 0)   AS max_speed_kmh,
                   COUNT(DISTINCT DATE_TRUNC('day', recorded_at))        AS active_days
            FROM (
                SELECT p.user_id, u.name, p.speed, p.recorded_at,
                       COALESCE(ST_Distance(
                           p.location::geometry,
                           LAG(p.location::geometry) OVER (PARTITION BY p.user_id ORDER BY p.recorded_at)
                       ) / 1000, 0) AS step_km
                FROM positions p JOIN users u ON u.id = p.user_id
                WHERE u.is_active=TRUE AND p.recorded_at >= NOW() - INTERVAL '7 days'
            ) sub
            GROUP BY user_id, name ORDER BY distance_km DESC
        `);

        if (!rows.length) return;

        const lines = rows.map((r) => `${r.name}: ${r.distance_km} km, ${r.active_days}j, max ${r.max_speed_kmh} km/h`).join('\n');
        await notifyAll(io, 'weekly_report',
            { type: 'weekly_report', stats: rows, sent_at: new Date().toISOString() },
            {
                title: '📊 Bilan hebdo Family Tracker',
                body:  lines,
            }
        );
    } catch (err) {
        console.error('[Watchdog/weeklyReport]', err);
    }
}

// ── Notify helpers ────────────────────────────────────────────────────────────
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

async function notifyAll(io, eventType, socketPayload, pushContent) {
    if (io) io.emit(eventType, socketPayload);

    const { rows } = await pool.query(
        `SELECT push_subscription FROM users WHERE is_active=TRUE AND push_subscription IS NOT NULL`
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
    // Run every minute for schedule precision
    setInterval(() => runWatchdog(io), 60_000);
}

module.exports = { startWatchdog };

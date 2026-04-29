const express = require('express');
const webpush = require('web-push');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/notify/sos  — SOS button (3-second press handled client-side)
router.post('/sos', authenticate, async (req, res) => {
    const { latitude, longitude } = req.body;
    if (latitude == null || longitude == null) {
        return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const payload = {
        type: 'sos',
        member: { id: req.user.id, name: req.user.name, color: req.user.color },
        latitude,
        longitude,
        sent_at: new Date().toISOString(),
    };

    await pool.query(
        `INSERT INTO notifications_log (type, triggered_by, payload)
         VALUES ('sos', $1, $2)`,
        [req.user.id, payload]
    );

    // Broadcast via WebSocket
    const io = req.app.get('io');
    if (io) io.emit('sos', payload);

    // Send push to all active members
    await broadcastPush(payload, req.user.id);

    res.json({ message: 'SOS sent' });
});

// POST /api/notify/test  — send a test push to self
router.post('/test', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT push_subscription FROM users WHERE id = $1', [req.user.id]
    );
    const sub = rows[0]?.push_subscription;
    if (!sub) return res.status(400).json({ error: 'No push subscription registered' });

    try {
        await webpush.sendNotification(sub, JSON.stringify({
            title: 'Family Tracker',
            body: 'Push notifications are working!',
            icon: '/icons/icon-192.png',
        }));
        res.json({ message: 'Test push sent' });
    } catch (err) {
        console.error('Push error:', err);
        res.status(500).json({ error: 'Failed to send push notification' });
    }
});

async function broadcastPush(payload, excludeUserId = null) {
    const query = excludeUserId
        ? 'SELECT push_subscription FROM users WHERE is_active = TRUE AND id != $1 AND push_subscription IS NOT NULL'
        : 'SELECT push_subscription FROM users WHERE is_active = TRUE AND push_subscription IS NOT NULL';

    const { rows } = await pool.query(query, excludeUserId ? [excludeUserId] : []);

    const title = payload.type === 'sos'
        ? `🆘 SOS — ${payload.member?.name}`
        : payload.title || 'Family Tracker';
    const body = payload.body || '';

    const pushPayload = JSON.stringify({ title, body, data: payload, icon: '/icons/icon-192.png' });

    await Promise.allSettled(
        rows.map((r) => webpush.sendNotification(r.push_subscription, pushPayload))
    );
}

module.exports = router;
module.exports.broadcastPush = broadcastPush;

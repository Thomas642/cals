const express = require('express');
const webpush = require('web-push');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/notify/sos  — SOS button (3-second press handled client-side)
router.post('/sos', authenticate, async (req, res) => {
    const { latitude, longitude } = req.body;

    const payload = {
        type: 'sos',
        member: { id: req.user.id, name: req.user.name, color: req.user.color },
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        sent_at: new Date().toISOString(),
    };

    await pool.query(
        `INSERT INTO notifications_log (type, triggered_by, payload)
         VALUES ('sos', $1, $2)`,
        [req.user.id, payload]
    );

    const io = req.app.get('io');
    if (io) io.emit('sos', payload);

    await broadcastPush({
        ...payload,
        title: `🆘 SOS — ${req.user.name}`,
        body: latitude ? `Position partagée` : 'Position inconnue',
    }, req.user.id);

    res.json({ message: 'SOS sent' });
});

// POST /api/notify/ok  — "Je suis OK" reassurance signal
router.post('/ok', authenticate, async (req, res) => {
    const payload = {
        type: 'ok_signal',
        member: { id: req.user.id, name: req.user.name, color: req.user.color },
        sent_at: new Date().toISOString(),
    };

    await pool.query(
        `INSERT INTO notifications_log (type, triggered_by, payload)
         VALUES ('ok_signal', $1, $2)`,
        [req.user.id, payload]
    );

    const io = req.app.get('io');
    if (io) io.emit('ok_signal', payload);

    await broadcastPush({
        ...payload,
        title: `✅ ${req.user.name} est OK`,
        body: 'Signal de sécurité reçu',
    }, req.user.id);

    res.json({ message: 'OK signal sent' });
});

// POST /api/notify/message  — quick pre-defined message to the family
router.post('/message', authenticate, async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text is required' });
    }
    const trimmed = text.trim().slice(0, 200);

    const payload = {
        type: 'quick_message',
        member: { id: req.user.id, name: req.user.name, color: req.user.color },
        text: trimmed,
        sent_at: new Date().toISOString(),
    };

    await pool.query(
        `INSERT INTO notifications_log (type, triggered_by, payload)
         VALUES ('quick_message', $1, $2)`,
        [req.user.id, payload]
    );

    const io = req.app.get('io');
    if (io) io.emit('quick_message', payload);

    await broadcastPush({
        ...payload,
        title: `💬 ${req.user.name}`,
        body: trimmed,
    }, req.user.id);

    res.json({ message: 'Message sent' });
});

// GET /api/notify/history  — recent notifications log (SOS by default)
router.get('/history', authenticate, async (req, res) => {
    const type  = ['sos', 'ok_signal', 'quick_message'].includes(req.query.type)
        ? req.query.type : 'sos';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { rows } = await pool.query(
        `SELECT nl.id, nl.type, nl.sent_at, nl.payload,
                u.name  AS sender_name,
                u.color AS sender_color
         FROM notifications_log nl
         LEFT JOIN users u ON nl.triggered_by = u.id
         WHERE nl.type = $1
         ORDER BY nl.sent_at DESC
         LIMIT $2`,
        [type, limit]
    );
    res.json(rows);
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

    const pushPayload = JSON.stringify({
        title: payload.title || 'Family Tracker',
        body:  payload.body  || '',
        data:  payload,
        icon:  '/icons/icon-192.png',
    });

    await Promise.allSettled(
        rows.map((r) => webpush.sendNotification(r.push_subscription, pushPayload))
    );
}

module.exports = router;
module.exports.broadcastPush = broadcastPush;

const express = require('express');
const webpush = require('web-push');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/chat?limit=50&before=ISO_DATE
router.get('/', authenticate, async (req, res) => {
    try {
        const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
        const before = req.query.before ? new Date(req.query.before) : new Date();

        const { rows } = await pool.query(
            `SELECT m.id, m.text, m.sent_at,
                    u.id AS user_id, u.name, u.color, u.avatar_url,
                    COALESCE(
                        json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id, 'name', ru.name))
                        FILTER (WHERE r.emoji IS NOT NULL), '[]'
                    ) AS reactions
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN message_reactions r ON r.message_id = m.id
             LEFT JOIN users ru ON ru.id = r.user_id
             WHERE m.sent_at <= $1
             GROUP BY m.id, u.id, u.name, u.color, u.avatar_url
             ORDER BY m.sent_at DESC
             LIMIT $2`,
            [before, limit]
        );
        res.json(rows.reverse());
    } catch (err) {
        console.error('[chat GET]', err);
        res.status(500).json({ error: 'Failed to load messages' });
    }
});

// POST /api/chat
router.post('/', authenticate, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text?.trim()) return res.status(400).json({ error: 'text required' });
        const trimmed = text.trim().slice(0, 1000);

        const { rows } = await pool.query(
            `INSERT INTO messages (user_id, text) VALUES ($1, $2)
             RETURNING id, text, sent_at`,
            [req.user.id, trimmed]
        );

        const message = {
            ...rows[0],
            user_id:    req.user.id,
            name:       req.user.name,
            color:      req.user.color,
            avatar_url: req.user.avatar_url,
        };

        const io = req.app.get('io');
        if (io) io.emit('chat_message', message);

        // Push to other family members
        const { rows: subs } = await pool.query(
            `SELECT push_subscription FROM users
             WHERE is_active = TRUE AND id != $1 AND push_subscription IS NOT NULL`,
            [req.user.id]
        );
        const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
        await Promise.allSettled(
            subs.map((r) =>
                webpush.sendNotification(
                    r.push_subscription,
                    JSON.stringify({
                        title: `💬 ${req.user.name}`,
                        body:  preview,
                        icon:  '/icons/icon-192.png',
                        data:  message,
                    })
                )
            )
        );

        res.json(message);
    } catch (err) {
        console.error('[chat POST]', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// POST /api/chat/:id/react — add/update reaction
router.post('/:id/react', authenticate, async (req, res) => {
    try {
        const { emoji } = req.body;
        if (!emoji) return res.status(400).json({ error: 'emoji required' });

        await pool.query(
            `INSERT INTO message_reactions (message_id, user_id, emoji)
             VALUES ($1, $2, $3)
             ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = $3, created_at = NOW()`,
            [req.params.id, req.user.id, emoji]
        );

        const reaction = { message_id: req.params.id, user_id: req.user.id, name: req.user.name, emoji };
        const io = req.app.get('io');
        if (io) io.emit('chat_reaction', { type: 'add', ...reaction });

        res.json(reaction);
    } catch (err) {
        console.error('[chat/react POST]', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/chat/:id/react — remove own reaction
router.delete('/:id/react', authenticate, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );

        const io = req.app.get('io');
        if (io) io.emit('chat_reaction', { type: 'remove', message_id: req.params.id, user_id: req.user.id });

        res.status(204).end();
    } catch (err) {
        console.error('[chat/react DELETE]', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/chat/:id — delete own message
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM messages WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!rowCount) return res.status(404).json({ error: 'Message not found or not yours' });
        const io = req.app.get('io');
        if (io) io.emit('chat_delete', { id: req.params.id });
        res.status(204).end();
    } catch (err) {
        console.error('[chat DELETE]', err);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

module.exports = router;

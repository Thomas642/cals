require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');

const pool = require('./config/database');
const authRoutes = require('./routes/auth');
const positionsRoutes = require('./routes/positions');
const historyRoutes = require('./routes/history');
const zonesRoutes = require('./routes/zones');
const membersRoutes = require('./routes/members');
const notifyRoutes = require('./routes/notify');
const { startWatchdog } = require('./services/watchdog');

// ── Web Push setup ───────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    },
});

// Authenticate socket connections with JWT
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Missing token'));
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const { rows } = await pool.query(
            'SELECT id, name, role FROM users WHERE id = $1 AND is_active = TRUE', [payload.sub]
        );
        if (!rows[0]) return next(new Error('Unauthorized'));
        socket.user = rows[0];
        next();
    } catch {
        next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    console.log(`[WS] ${socket.user.name} connected`);
    socket.join('family');

    socket.on('disconnect', () => {
        console.log(`[WS] ${socket.user.name} disconnected`);
    });
});

app.set('io', io);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // handled by Nginx
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Static uploads ───────────────────────────────────────────────────────────
const uploadDir = path.resolve(process.env.UPLOAD_DIR || '../uploads');
app.use('/uploads', express.static(uploadDir));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/positions', apiLimiter, positionsRoutes);
app.use('/api/history', apiLimiter, historyRoutes);
app.use('/api/zones', apiLimiter, zonesRoutes);
app.use('/api/members', apiLimiter, membersRoutes);
app.use('/api/notify', apiLimiter, notifyRoutes);

// VAPID public key (needed by the frontend to subscribe to push)
app.get('/api/push-key', (_, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Health check
app.get('/api/health', async (_, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Family Tracker API running on port ${PORT}`);
    startWatchdog(io);
});

module.exports = app;

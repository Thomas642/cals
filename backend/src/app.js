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
const chatRoutes   = require('./routes/chat');
const shareRoutes    = require('./routes/share');
const scheduleRoutes = require('./routes/schedule');
const { startWatchdog } = require('./services/watchdog');
const placesRoutes = require('./routes/places');

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
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (_allowedOrigins.has(origin)) return cb(null, true);
            if (!process.env.FRONTEND_URL) return cb(null, true);
            cb(new Error(`CORS blocked: ${origin}`));
        },
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

// Trust the first proxy (nginx) so rate-limiter reads the real client IP
app.set('trust proxy', 1);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // handled by Nginx
}));

// Accept both the web origin and the Capacitor native app origins
const _allowedOrigins = new Set([
    process.env.FRONTEND_URL,
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
].filter(Boolean));

app.use(cors({
    origin: (origin, cb) => {
        // No origin = server-to-server or same-origin — allow
        if (!origin) return cb(null, true);
        if (_allowedOrigins.has(origin)) return cb(null, true);
        // Fallback: allow everything if no FRONTEND_URL configured
        if (!process.env.FRONTEND_URL) return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, réessayez dans quelques minutes.' },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
});

// ── Static uploads (served under /api/uploads so nginx proxy covers it) ──────
const uploadDir = path.resolve(process.env.UPLOAD_DIR || '../uploads');
app.use('/api/uploads', express.static(uploadDir));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/positions', apiLimiter, positionsRoutes);
app.use('/api/history', apiLimiter, historyRoutes);
app.use('/api/zones', apiLimiter, zonesRoutes);
app.use('/api/members', apiLimiter, membersRoutes);
app.use('/api/notify', apiLimiter, notifyRoutes);
app.use('/api/chat',   apiLimiter, chatRoutes);
app.use('/api/share',    apiLimiter, shareRoutes);
app.use('/api/places',   apiLimiter, placesRoutes);
app.use('/api/schedule', apiLimiter, scheduleRoutes);

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

// ── Migrations ───────────────────────────────────────────────────────────────
async function runMigrations() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS places (
            id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name       VARCHAR(100) NOT NULL,
            icon       VARCHAR(20)  NOT NULL DEFAULT 'home',
            latitude   DOUBLE PRECISION NOT NULL,
            longitude  DOUBLE PRECISION NOT NULL,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Ensure notifications_log exists with the full type set
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications_log (
            id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            type         VARCHAR(20) NOT NULL,
            triggered_by UUID        REFERENCES users(id) ON DELETE SET NULL,
            sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            payload      JSONB       NOT NULL DEFAULT '{}'
        )
    `);
    // Drop old restrictive CHECK constraint if present, then add the full one
    await pool.query(`
        ALTER TABLE notifications_log
            DROP CONSTRAINT IF EXISTS notifications_log_type_check
    `);
    await pool.query(`
        ALTER TABLE notifications_log
            ADD CONSTRAINT notifications_log_type_check
            CHECK (type IN ('sos','ok_signal','quick_message','speed_alert',
                            'geofence_enter','geofence_exit','battery','disconnect'))
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS notifications_log_sent_at_idx
            ON notifications_log(sent_at DESC)
    `);

    // Chat messages
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text    VARCHAR(1000) NOT NULL,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS messages_sent_at_idx ON messages(sent_at DESC)
    `);

    // Notes on places
    await pool.query(`ALTER TABLE places ADD COLUMN IF NOT EXISTS notes VARCHAR(500) NOT NULL DEFAULT ''`);

    // Share tokens (temporary public tracking links)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS share_tokens (
            id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            token      VARCHAR(64) NOT NULL UNIQUE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            label      VARCHAR(100) NOT NULL DEFAULT '',
            expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS share_tokens_token_idx ON share_tokens(token)`);

    // Cleanup expired share tokens
    await pool.query(`DELETE FROM share_tokens WHERE expires_at < NOW()`);

    // Zone presence tracking (for auto check-in)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS zone_presence (
            zone_id    UUID NOT NULL REFERENCES zones(id)  ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
            entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (zone_id, user_id)
        )
    `);

    // Guest users expiry column
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_expires_at TIMESTAMPTZ`);

    // Schedule alerts (planning + alertes horaires)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_alerts (
            id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            member_id     UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
            zone_id       UUID NOT NULL REFERENCES zones(id)  ON DELETE CASCADE,
            label         VARCHAR(100) NOT NULL DEFAULT '',
            expected_time TIME NOT NULL,
            tolerance_min INT  NOT NULL DEFAULT 15,
            days          TEXT[] NOT NULL DEFAULT '{1,2,3,4,5}',
            active        BOOL NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Zones: type + curfew
    await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS zone_type VARCHAR(20) NOT NULL DEFAULT 'standard'`);
    await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS curfew_start TIME`);
    await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS curfew_end TIME`);

    // Users: check-in support
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_interval_min INT`);

    // Chat reactions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS message_reactions (
            message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            emoji      VARCHAR(10) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, user_id)
        )
    `);
}

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
runMigrations()
    .then(() => server.listen(PORT, () => {
        console.log(`Family Tracker API running on port ${PORT}`);
        startWatchdog(io);
    }))
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });

module.exports = app;

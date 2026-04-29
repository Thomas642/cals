-- Family Tracker — Database Schema
-- Requires PostgreSQL + PostGIS extension

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(255)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    color         VARCHAR(7)    NOT NULL DEFAULT '#3B82F6',
    avatar_url    VARCHAR(500),
    role          VARCHAR(10)   NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    status        VARCHAR(100)  DEFAULT '',
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
    push_subscription JSONB,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INVITATIONS
-- ─────────────────────────────────────────
CREATE TABLE invitations (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token      VARCHAR(64)  NOT NULL UNIQUE,
    created_by UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_by    UUID         REFERENCES users(id),
    used_at    TIMESTAMPTZ,
    expires_at TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- POSITIONS
-- ─────────────────────────────────────────
CREATE TABLE positions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location    GEOGRAPHY(Point, 4326) NOT NULL,
    battery     SMALLINT    CHECK (battery BETWEEN 0 AND 100),
    speed       FLOAT       DEFAULT 0,
    accuracy    FLOAT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX positions_user_id_idx     ON positions(user_id);
CREATE INDEX positions_recorded_at_idx ON positions(recorded_at DESC);
CREATE INDEX positions_location_idx    ON positions USING GIST(location);

-- Latest position per user (view for convenience)
CREATE VIEW latest_positions AS
    SELECT DISTINCT ON (user_id)
        p.*,
        u.name,
        u.color,
        u.avatar_url,
        u.status AS user_status
    FROM positions p
    JOIN users u ON u.id = p.user_id
    WHERE u.is_active = TRUE
    ORDER BY user_id, recorded_at DESC;

-- ─────────────────────────────────────────
-- ZONES (Géofencing)
-- ─────────────────────────────────────────
CREATE TABLE zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    center          GEOGRAPHY(Point, 4326) NOT NULL,
    radius          INTEGER      NOT NULL CHECK (radius > 0),
    created_by      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notify_members  UUID[]       NOT NULL DEFAULT '{}',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX zones_center_idx ON zones USING GIST(center);

-- Track who is currently inside which zone
CREATE TABLE zone_presence (
    zone_id    UUID        NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (zone_id, user_id)
);

-- ─────────────────────────────────────────
-- NOTIFICATIONS LOG
-- ─────────────────────────────────────────
CREATE TABLE notifications_log (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type         VARCHAR(20) NOT NULL CHECK (type IN ('sos', 'geofence_enter', 'geofence_exit', 'battery', 'disconnect')),
    triggered_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload      JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX notifications_log_sent_at_idx ON notifications_log(sent_at DESC);

const { Pool } = require('pg');

// Build connection string with proper URL-encoding to handle special characters
// in passwords. Falls back to individual env vars if DATABASE_URL is not set.
function buildConnectionString() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const user = encodeURIComponent(process.env.DB_USER     || 'familytracker');
    const pass = encodeURIComponent(process.env.DB_PASSWORD || '');
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const db   = process.env.DB_NAME || 'familytracker';
    return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT     ? parseInt(process.env.DB_PORT) : undefined,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionString: process.env.DB_HOST ? undefined : buildConnectionString(),
    ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected DB client error:', err);
});

module.exports = pool;

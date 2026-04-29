#!/usr/bin/env node
// Create the first admin account
// Usage: node scripts/create-admin.js <name> <email> <password>
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const pool   = require('../src/config/database');

async function main() {
  const [, , name, email, password] = process.argv;
  if (!name || !email || !password) {
    console.error('Usage: node create-admin.js <name> <email> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, color)
     VALUES ($1, $2, $3, 'admin', '#3B82F6')
     ON CONFLICT (email) DO UPDATE SET role = 'admin'
     RETURNING id, name, email, role`,
    [name, email.toLowerCase(), hash]
  );

  console.log('Admin account created:', rows[0]);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

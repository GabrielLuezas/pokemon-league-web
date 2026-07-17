const { Pool } = require('pg');
const path = require('path');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

module.exports = pool;


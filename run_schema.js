const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.gtmuzqyqiylqnwsyznwf:HeLZxNIPQrGYkVnB@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT current_user');
        console.log('✅ Conectado a Supabase');
        const sqlPath = path.join(__dirname, 'supabase_schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await client.query(sql);
        console.log('✅ Schema creado en Supabase correctamente');
    } catch (err) {
        console.error('❌ Error:', err.message);
        if (err.detail) console.error('   Detalle:', err.detail);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}
run();


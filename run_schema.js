const { Pool } = require('pg');
const fs = require('fs');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Supabase pooler requiere el punto en el usuario — debe ir en la connection string
// Para evitar conflicto SSL: pasar ssl como objeto y NO incluir sslmode en la URL
const TARGET = {
    host: 'aws-1-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.qxcfcidomzhfpgmmtdwj',
    password: 'PokemonEspectralLeague2265',
    ssl: { rejectUnauthorized: false },
    // Parámetro extra que fuerza el nombre de usuario con el punto
    application_name: 'migration'
};

const pool = new Pool(TARGET);

async function run() {
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT current_user');
        console.log('✅ Conectado a Supabase');
        const sql = fs.readFileSync('./supabase_schema.sql', 'utf8');
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

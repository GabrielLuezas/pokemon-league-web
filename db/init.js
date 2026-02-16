const pool = require('./index');

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS save_data (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                party JSONB DEFAULT '[]',
                boxes JSONB DEFAULT '[]',
                nuzlocke JSONB DEFAULT '{"deaths":[],"enabled":true}',
                trainer JSONB DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add trainer column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS trainer JSONB DEFAULT '{}';
        `);

        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = initDB;

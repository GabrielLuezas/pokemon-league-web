const pool = require('./index');

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                avatar_url TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add avatar_url column if table already exists without it
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;
        `);

        // Add stream columns if they don't exist
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_platform VARCHAR(50) DEFAULT NULL;
        `);
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_channel VARCHAR(100) DEFAULT NULL;
        `);
        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE;
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS save_data (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                party JSONB DEFAULT '[]',
                boxes JSONB DEFAULT '[]',
                nuzlocke JSONB DEFAULT '{"deaths":[],"enabled":true}',
                trainer JSONB DEFAULT '{}',
                nuzlocke_points INTEGER DEFAULT 0,
                nuzlocke_points_earned INTEGER DEFAULT 0,
                nuzlocke_points_spent INTEGER DEFAULT 0,
                nuzlocke_points_deaths INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add trainer column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS trainer JSONB DEFAULT '{}';
        `);

        // Add nuzlocke_points column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS nuzlocke_points INTEGER DEFAULT 0;
        `);

        // Add nuzlocke_points_earned column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS nuzlocke_points_earned INTEGER DEFAULT 0;
        `);

        // Add nuzlocke_points_spent column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS nuzlocke_points_spent INTEGER DEFAULT 0;
        `);

        // Add nuzlocke_points_deaths column if table already exists without it
        await client.query(`
            ALTER TABLE save_data ADD COLUMN IF NOT EXISTS nuzlocke_points_deaths INTEGER DEFAULT 0;
        `);

        // Add tournament table for the Triple Elimination Bracket
        await client.query(`
            CREATE TABLE IF NOT EXISTS tournament (
                id SERIAL PRIMARY KEY,
                state JSONB DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Initialize with empty state if it doesn't exist
        const tournamentCheck = await client.query('SELECT id FROM tournament LIMIT 1');
        if (tournamentCheck.rows.length === 0) {
            await client.query(`INSERT INTO tournament (state) VALUES ('{}')`);
        }

        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = initDB;

/**
 * migrate_to_supabase.js
 * Lee todos los datos de Neon y los importa en Supabase.
 */
const { Pool } = require('pg');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// ─── ORIGEN: Neon ─────────────────────────────────────────────
const source = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_WuaiNr3mdXc7@ep-orange-dream-abp4o9yu-pooler.eu-west-2.aws.neon.tech/pokemonleague?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

// ─── DESTINO: Supabase ────────────────────────────────────────
const target = new Pool({
    host: 'aws-1-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.qxcfcidomzhfpgmmtdwj',
    password: 'PokemonEspectralLeague2265',
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('🔄 Iniciando migración Neon → Supabase...\n');

    const srcClient = await source.connect();
    const tgtClient = await target.connect();

    try {
        // ── 1. Leer usuarios ──
        console.log('📦 Exportando usuarios...');
        const { rows: users } = await srcClient.query(
            'SELECT id, username, password, avatar_url, created_at FROM users ORDER BY id'
        );
        console.log(`   → ${users.length} usuario(s)`);

        // ── 2. Leer save_data ──
        console.log('📦 Exportando save_data...');
        const { rows: saves } = await srcClient.query(
            `SELECT id, user_id, party, boxes, nuzlocke, trainer,
                    nuzlocke_points, nuzlocke_points_earned, nuzlocke_points_spent, updated_at
             FROM save_data ORDER BY id`
        );
        console.log(`   → ${saves.length} save(s)`);

        // ── 3. Leer tournament ──
        console.log('📦 Exportando tournament...');
        const { rows: tournaments } = await srcClient.query(
            'SELECT id, state, updated_at FROM tournament ORDER BY id'
        );
        console.log(`   → ${tournaments.length} torneo(s)`);

        console.log('\n🚀 Importando en Supabase...\n');
        await tgtClient.query('BEGIN');

        // ── Insertar usuarios ──
        console.log('👤 Insertando usuarios...');
        for (const u of users) {
            await tgtClient.query(
                `INSERT INTO users (id, username, password, avatar_url, created_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET
                     username = EXCLUDED.username, password = EXCLUDED.password,
                     avatar_url = EXCLUDED.avatar_url, created_at = EXCLUDED.created_at`,
                [u.id, u.username, u.password, u.avatar_url, u.created_at]
            );
            console.log(`   ✓ ${u.username}`);
        }
        if (users.length > 0) {
            const maxId = Math.max(...users.map(u => u.id));
            await tgtClient.query(`SELECT setval('users_id_seq', $1)`, [maxId]);
        }

        // ── Insertar save_data ──
        console.log('\n💾 Insertando save_data...');
        for (const s of saves) {
            await tgtClient.query(
                `INSERT INTO save_data (id, user_id, party, boxes, nuzlocke, trainer,
                                        nuzlocke_points, nuzlocke_points_earned, nuzlocke_points_spent, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 ON CONFLICT (id) DO UPDATE SET
                     user_id=EXCLUDED.user_id, party=EXCLUDED.party, boxes=EXCLUDED.boxes,
                     nuzlocke=EXCLUDED.nuzlocke, trainer=EXCLUDED.trainer,
                     nuzlocke_points=EXCLUDED.nuzlocke_points,
                     nuzlocke_points_earned=EXCLUDED.nuzlocke_points_earned,
                     nuzlocke_points_spent=EXCLUDED.nuzlocke_points_spent,
                     updated_at=EXCLUDED.updated_at`,
                [s.id, s.user_id,
                 JSON.stringify(s.party), JSON.stringify(s.boxes),
                 JSON.stringify(s.nuzlocke), JSON.stringify(s.trainer),
                 s.nuzlocke_points, s.nuzlocke_points_earned, s.nuzlocke_points_spent,
                 s.updated_at]
            );
            console.log(`   ✓ Save usuario ID: ${s.user_id}`);
        }
        if (saves.length > 0) {
            const maxId = Math.max(...saves.map(s => s.id));
            await tgtClient.query(`SELECT setval('save_data_id_seq', $1)`, [maxId]);
        }

        // ── Insertar tournament ──
        console.log('\n🏆 Insertando torneo...');
        await tgtClient.query('DELETE FROM tournament');
        for (const t of tournaments) {
            await tgtClient.query(
                `INSERT INTO tournament (id, state, updated_at) VALUES ($1,$2,$3)`,
                [t.id, JSON.stringify(t.state), t.updated_at]
            );
            console.log(`   ✓ Torneo ID: ${t.id}`);
        }
        if (tournaments.length > 0) {
            const maxId = Math.max(...tournaments.map(t => t.id));
            await tgtClient.query(`SELECT setval('tournament_id_seq', $1)`, [maxId]);
        }

        await tgtClient.query('COMMIT');

        console.log('\n✅ Migración completada con éxito');
        console.log(`   Usuarios: ${users.length} | Saves: ${saves.length} | Torneos: ${tournaments.length}`);

    } catch (err) {
        await tgtClient.query('ROLLBACK');
        console.error('\n❌ Error (ROLLBACK):', err.message);
        process.exit(1);
    } finally {
        srcClient.release();
        tgtClient.release();
        await source.end();
        await target.end();
    }
}

migrate();

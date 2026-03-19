require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const initDB = require('./db/init');
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournament');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes
app.use('/api/auth', authRoutes);

// Tournament routes
app.use('/api/tournament', tournamentRoutes);

// ===================== SYNC ENDPOINT =====================
// Desktop app sends parsed save data here on every file change

app.post('/api/sync', authMiddleware, async (req, res) => {
    try {
        const { party, boxes, nuzlocke, trainer, nuzlockePoints, nuzlockePointsEarned, nuzlockePointsDeath, nuzlockePointsSpent } = req.body;
        console.log(`[DEBUG] Syncing points -> Earned: ${nuzlockePointsEarned}, Deaths: ${nuzlockePointsDeath}, Spent: ${nuzlockePointsSpent}, Total: ${nuzlockePoints}`);

        if (!party && !boxes) {
            return res.status(400).json({ error: 'No save data provided' });
        }

        // Protección: si el sync llega con 0 earned pero la BD ya tenía puntos mayores,
        // significa que nuzlocke.json se perdió (ej: reinstalación) y no debemos reducir puntos.
        let finalPoints = nuzlockePoints ?? 0;
        let finalEarned = nuzlockePointsEarned ?? 0;
        let finalDeath  = nuzlockePointsDeath  ?? 0;
        let finalSpent  = nuzlockePointsSpent  ?? 0;

        if (finalEarned === 0) {
            const prev = await pool.query(
                'SELECT nuzlocke_points, nuzlocke_points_earned, nuzlocke_points_deaths, nuzlocke_points_spent FROM save_data WHERE user_id = $1',
                [req.userId]
            );
            if (prev.rows.length > 0 && (prev.rows[0].nuzlocke_points_earned || 0) > 0) {
                console.log(`[SYNC GUARD] ${req.username}: earned=0 pero BD tiene ${prev.rows[0].nuzlocke_points_earned} — conservando puntos de BD`);
                finalPoints = prev.rows[0].nuzlocke_points;
                finalEarned = prev.rows[0].nuzlocke_points_earned;
                finalDeath  = prev.rows[0].nuzlocke_points_deaths;
                finalSpent  = prev.rows[0].nuzlocke_points_spent;
            }
        }

        await pool.query(
            `INSERT INTO save_data (user_id, party, boxes, nuzlocke, trainer, nuzlocke_points, nuzlocke_points_earned, nuzlocke_points_deaths, nuzlocke_points_spent, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET
                party = COALESCE($2, save_data.party),
                boxes = COALESCE($3, save_data.boxes),
                nuzlocke = COALESCE($4, save_data.nuzlocke),
                trainer = COALESCE($5, save_data.trainer),
                nuzlocke_points = $6,
                nuzlocke_points_earned = $7,
                nuzlocke_points_deaths = $8,
                nuzlocke_points_spent = $9,
                updated_at = NOW()`,
            [
                req.userId,
                JSON.stringify(party || []),
                JSON.stringify(boxes || []),
                JSON.stringify(nuzlocke || { deaths: [], enabled: true }),
                JSON.stringify(trainer || {}),
                finalPoints,
                finalEarned,
                finalDeath,
                finalSpent
            ]
        );

        console.log(`🔄 Sync from ${req.username}: ${(party || []).length} party, ${(boxes || []).reduce((s, b) => s + (b.slots || []).filter(Boolean).length, 0)} box Pokémon`);
        res.json({ success: true, message: 'Datos sincronizados' });
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: 'Error al sincronizar' });
    }

});

// ===================== PUBLIC DASHBOARD API =====================
// Anyone can view all trainers and their data

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                u.id,
                u.username,
                u.avatar_url,
                u.created_at,
                sd.party,
                sd.boxes,
                sd.nuzlocke,
                sd.trainer,
                sd.nuzlocke_points,
                sd.nuzlocke_points_earned,
                sd.nuzlocke_points_deaths,
                sd.nuzlocke_points_spent,
                sd.updated_at
            FROM users u
            LEFT JOIN save_data sd ON sd.user_id = u.id
            ORDER BY sd.updated_at DESC NULLS LAST
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                u.id,
                u.username,
                u.avatar_url,
                u.created_at,
                sd.party,
                sd.boxes,
                sd.nuzlocke,
                sd.trainer,
                sd.nuzlocke_points,
                sd.nuzlocke_points_earned,
                sd.nuzlocke_points_deaths,
                sd.nuzlocke_points_spent,
                sd.updated_at
            FROM users u
            LEFT JOIN save_data sd ON sd.user_id = u.id
            WHERE u.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

// ===================== START =====================

async function start() {
    try {
        await initDB();
        app.listen(PORT, () => {
            console.log(`🌐 Pokemon League Web Dashboard running at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
}

start();

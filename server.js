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

// Active SSE clients for stream overlays
const overlayClients = new Map(); // userId -> Array of res objects

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
        console.log(`[DEBUG] Syncing points (raw) -> Challenges: ${nuzlockePointsEarned}, Deaths: ${nuzlockePointsDeath}, Spent: ${nuzlockePointsSpent}, Total: ${nuzlockePoints}`);

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

        // Protección: si el nuzlocke que llega está vacío (sin muertes, sin compras, sin tiradas)
        // pero la BD ya tiene datos, conservar el nuzlocke de la BD (evita que una reinstalación borre las tiradas de gacha)
        let finalNuzlocke = nuzlocke || { deaths: [], enabled: true };
        const incomingDeaths = (finalNuzlocke.deaths || []).length;
        const incomingPurchases = (finalNuzlocke.purchases || []).length;
        const incomingGacha = (finalNuzlocke.gachaPulls || []).length;
        const incomingIsEmpty = incomingDeaths === 0 && incomingPurchases === 0 && incomingGacha === 0;

        if (incomingIsEmpty) {
            const prevNuz = await pool.query(
                'SELECT nuzlocke FROM save_data WHERE user_id = $1',
                [req.userId]
            );
            if (prevNuz.rows.length > 0 && prevNuz.rows[0].nuzlocke) {
                const dbNuz = prevNuz.rows[0].nuzlocke;
                const dbHasData = (dbNuz.deaths || []).length > 0 ||
                                  (dbNuz.purchases || []).length > 0 ||
                                  (dbNuz.gachaPulls || []).length > 0;
                if (dbHasData) {
                    console.log(`[SYNC GUARD] ${req.username}: nuzlocke vacío pero BD tiene datos — conservando nuzlocke de BD`);
                    finalNuzlocke = dbNuz;
                }
            }
        }

        // Preservar la cola de maldiciones (incomingCurses) de la base de datos para evitar que el sync local la borre
        const dbRes = await pool.query('SELECT nuzlocke FROM save_data WHERE user_id = $1', [req.userId]);
        if (dbRes.rows.length > 0 && dbRes.rows[0].nuzlocke) {
            const dbNuz = dbRes.rows[0].nuzlocke;
            if (dbNuz.cards && Array.isArray(dbNuz.cards.incomingCurses)) {
                if (!finalNuzlocke.cards) finalNuzlocke.cards = {};
                finalNuzlocke.cards.incomingCurses = dbNuz.cards.incomingCurses;
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
                JSON.stringify(finalNuzlocke),
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
                u.stream_platform,
                u.stream_channel,
                u.is_live,
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
                u.stream_platform,
                u.stream_channel,
                u.is_live,
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

// ===================== STREAM OVERLAY SSE ENDPOINT =====================

app.get('/api/overlay/events', (req, res) => {
    const userId = parseInt(req.query.userId);
    if (!userId) {
        return res.status(400).send('userId is required');
    }
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.write('\n');
    
    if (!overlayClients.has(userId)) {
        overlayClients.set(userId, []);
    }
    overlayClients.get(userId).push(res);
    
    req.on('close', () => {
        const clients = overlayClients.get(userId) || [];
        const idx = clients.indexOf(res);
        if (idx !== -1) {
            clients.splice(idx, 1);
        }
        if (clients.length === 0) {
            overlayClients.delete(userId);
        }
    });
});

// ===================== CARD CURSES ENDPOINT =====================

app.post('/api/cards/curse/:targetUserId', authMiddleware, async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.targetUserId);
        const { fromUsername, cardId, cardName, cardEmoji, curseType, description, timestamp, selectedPokemon } = req.body;

        if (!targetUserId || !curseType) {
            return res.status(400).json({ error: 'targetUserId y curseType son requeridos' });
        }
        if (targetUserId === req.userId) {
            return res.status(400).json({ error: 'No puedes maldecirte a ti mismo' });
        }

        // Fetch target's current nuzlocke data from DB
        const targetResult = await pool.query(
            'SELECT nuzlocke FROM save_data WHERE user_id = $1',
            [targetUserId]
        );
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ error: 'Jugador objetivo no encontrado' });
        }

        let targetNuzlocke = targetResult.rows[0].nuzlocke || {};
        if (!targetNuzlocke.cards) targetNuzlocke.cards = { pulled: [], pullsByIsland: {}, activeEffects: {}, incomingCurses: [] };
        if (!targetNuzlocke.cards.activeEffects) targetNuzlocke.cards.activeEffects = {};
        if (!targetNuzlocke.cards.incomingCurses) targetNuzlocke.cards.incomingCurses = [];

        const targetAE = targetNuzlocke.cards.activeEffects;

        // Check shield
        if (targetAE.shield) {
            targetAE.shield = false;
            await pool.query('UPDATE save_data SET nuzlocke = $1 WHERE user_id = $2', [JSON.stringify(targetNuzlocke), targetUserId]);
            console.log(`[CARDS] Curse ${curseType} from ${fromUsername} was BLOCKED by ${targetUserId}'s shield`);
            return res.json({ success: true, shieldBlocked: true, message: '¡El escudo del rival bloqueó la maldición!' });
        }

        // Check reflect
        if (targetAE.reflect) {
            targetAE.reflect = false;
            await pool.query('UPDATE save_data SET nuzlocke = $1 WHERE user_id = $2', [JSON.stringify(targetNuzlocke), targetUserId]);
            console.log(`[CARDS] Curse ${curseType} from ${fromUsername} was REFLECTED by ${targetUserId}`);
            return res.json({ success: true, reflected: true, message: '¡La maldición fue rebotada al origen!' });
        }

        let finalDescription = description;
        let stolenCard = null;
        if (curseType === 'steal_card') {
            const pulledList = targetNuzlocke.cards.pulled || [];
            const unusedIndices = [];
            pulledList.forEach((c, idx) => {
                if (!c.usedAt) unusedIndices.push(idx);
            });
            if (unusedIndices.length > 0) {
                const randIdx = unusedIndices[Math.floor(Math.random() * unusedIndices.length)];
                stolenCard = { ...pulledList[randIdx] };
                pulledList[randIdx].usedAt = new Date().toISOString();
                pulledList[randIdx].stolenBy = fromUsername || 'Rival';
                finalDescription = `Te han robado la mano: ${stolenCard.emoji || '🃏'} ${stolenCard.name}. ¡Ha pasado a la mano de ${fromUsername}!`;
            } else {
                return res.json({ success: true, noCardsToSteal: true, message: 'El rival no tiene cartas en su mano' });
            }
        }

        // Deliver curse: add to target's incomingCurses in DB
        const curse = {
            fromUsername: fromUsername || 'Desconocido',
            cardId, cardName, cardEmoji, curseType, description: finalDescription,
            timestamp: timestamp || new Date().toISOString(),
            receivedAt: new Date().toISOString()
        };
        if (selectedPokemon) {
            curse.selectedPokemon = selectedPokemon;
        }
        targetNuzlocke.cards.incomingCurses.push(curse);

        await pool.query('UPDATE save_data SET nuzlocke = $1 WHERE user_id = $2', [JSON.stringify(targetNuzlocke), targetUserId]);
        console.log(`[CARDS] Curse ${curseType} delivered from ${fromUsername} to user ${targetUserId}`);

        // Broadcast the curse to any active OBS stream overlay clients
        const clients = overlayClients.get(targetUserId) || [];
        console.log(`[OVERLAY] Broadcasting curse to ${clients.length} OBS client(s) for user ${targetUserId}`);
        clients.forEach(client => {
            client.write(`data: ${JSON.stringify({ type: 'incoming-curse', curse })}\n\n`);
        });

        res.json({ success: true, message: 'Maldición entregada al objetivo', stolenCard });
    } catch (err) {
        console.error('Card curse error:', err);
        res.status(500).json({ error: 'Error al enviar maldición' });
    }
});

// GET pending curses from DB for the authenticated user (polled by local app)
app.get('/api/cards/pending-curses', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT nuzlocke FROM save_data WHERE user_id = $1', [req.userId]);
        if (result.rows.length === 0) return res.json([]);
        const nuzlocke = result.rows[0].nuzlocke || {};
        const curses = (nuzlocke.cards && nuzlocke.cards.incomingCurses) || [];
        res.json(curses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE pending curses from DB (called after local app has processed them)
app.post('/api/cards/clear-pending-curses', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT nuzlocke FROM save_data WHERE user_id = $1', [req.userId]);
        if (result.rows.length === 0) return res.json({ success: true });
        let nuzlocke = result.rows[0].nuzlocke || {};
        if (nuzlocke.cards) nuzlocke.cards.incomingCurses = [];
        await pool.query('UPDATE save_data SET nuzlocke = $1 WHERE user_id = $2', [JSON.stringify(nuzlocke), req.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const https = require('https');

function fetchUrlText(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => { resolve(data); });
        }).on('error', (err) => {
            resolve('');
        });
    });
}

async function checkLiveStatus(platform, channel) {
    return true; // Temporarily disabled live requirement for local testing
    /*
    if (!platform || !channel) return false;
    const plat = platform.toLowerCase().trim();
    const chan = channel.toLowerCase().trim();

    if (chan === 'test') return true;

    try {
        if (plat === 'twitch') {
            const url = `https://twitch.tv/${chan}`;
            const html = await fetchUrlText(url);
            return html.includes('"isLiveBroadcast":true') || html.includes('"isLive":true');
        } else if (plat === 'youtube') {
            const url = `https://youtube.com/@${chan}/live`;
            const html = await fetchUrlText(url);
            return html.includes('"isLive":true') || (html.includes('liveStreamability') && !html.includes('yt-playability-error-supported-renderers'));
        } else if (plat === 'kick') {
            const url = `https://kick.com/${chan}`;
            const html = await fetchUrlText(url);
            return html.includes('"livestream":{') && !html.includes('"livestream":null');
        }
    } catch (err) {
        console.error(`[STREAM CHECK] Error checking ${platform} channel ${channel}:`, err.message);
    }
    return false;
    */
}

async function updateAllLiveStatuses() {
    try {
        console.log('[STREAM MONITOR] Updating live statuses...');
        const result = await pool.query('SELECT id, stream_platform, stream_channel FROM users WHERE stream_platform IS NOT NULL AND stream_channel IS NOT NULL');
        for (const user of result.rows) {
            const isLive = await checkLiveStatus(user.stream_platform, user.stream_channel);
            await pool.query('UPDATE users SET is_live = $1 WHERE id = $2', [isLive, user.id]);
        }
        console.log('[STREAM MONITOR] Live statuses updated.');
    } catch (err) {
        console.error('[STREAM MONITOR] Error updating live statuses:', err);
    }
}

// ===================== START =====================

async function start() {
    try {
        await initDB();
        app.listen(PORT, () => {
            console.log(`🌐 Pokemon League Web Dashboard running at http://localhost:${PORT}`);
        });
        
        // Start background stream monitor
        setInterval(updateAllLiveStatuses, 3 * 60 * 1000);
        setTimeout(updateAllLiveStatuses, 5000);
    } catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
}

start();

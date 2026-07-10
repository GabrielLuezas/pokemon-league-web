const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const ADMIN_USER = 'GabrielLucifer22';
const MAX_LOSSES = 3;

// ===================== HELPERS =====================

async function getTournamentState() {
    const result = await pool.query('SELECT state FROM tournament LIMIT 1');
    return result.rows.length > 0 ? (result.rows[0].state || {}) : {};
}

async function saveTournamentState(state) {
    await pool.query('UPDATE tournament SET state = $1, updated_at = NOW()', [JSON.stringify(state)]);
}

async function getPlayerBattleTeam(userId) {
    const res = await pool.query('SELECT party, boxes, nuzlocke FROM save_data WHERE user_id = $1', [userId]);
    if (res.rows.length === 0) return [];
    
    const { party, boxes, nuzlocke } = res.rows[0];
    const allAlive = [];
    if (party) {
        party.forEach(p => { if (p && !p.isDead) allAlive.push(p); });
    }
    if (boxes) {
        boxes.forEach(box => {
            if (box && box.slots) {
                box.slots.forEach(p => { if (p && !p.isDead) allAlive.push(p); });
            }
        });
    }
    
    const battleTeamECs = nuzlocke && Array.isArray(nuzlocke.battleTeam) ? nuzlocke.battleTeam : [];
    return battleTeamECs.map(ec => allAlive.find(p => p.ec === ec)).filter(Boolean);
}

function getLockedBansForGame(match, playerId, gameNumber) {
    if (gameNumber <= 1) return [];
    
    const prevGameNumber = gameNumber - 1;
    const prevGame = (match.games || []).find(g => g.gameNumber === prevGameNumber);
    if (!prevGame || prevGame.status !== 'completed' || !prevGame.winnerId) return [];
    
    if (prevGame.winnerId !== playerId) return [];
    
    if (playerId === match.player1.id) {
        return prevGame.p1BannedEC ? [prevGame.p1BannedEC] : [];
    } else {
        return prevGame.p2BannedEC ? [prevGame.p2BannedEC] : [];
    }
}

async function enrichMatch(match) {
    if (!match || match.isBye) return match;
    
    const p1Team = await getPlayerBattleTeam(match.player1.id);
    const p2Team = await getPlayerBattleTeam(match.player2.id);
    
    match.player1.battleTeam = p1Team;
    match.player2.battleTeam = p2Team;
    
    const games = match.games || [];
    let activeGame = games.find(g => g.status !== 'completed' && g.status !== 'conflict');
    if (!activeGame && games.length > 0) {
        activeGame = games[games.length - 1];
    }
    
    const activeGameNumber = activeGame ? activeGame.gameNumber : 1;
    
    match.p1LockedBans = getLockedBansForGame(match, match.player1.id, activeGameNumber);
    match.p2LockedBans = getLockedBansForGame(match, match.player2.id, activeGameNumber);
    
    return match;
}

/**
 * Swiss pairing algorithm:
 * 1. Group active players by record (wins-losses key, e.g. "2-1")
 * 2. Sort groups from best record to worst
 * 3. Within each group, shuffle and pair
 * 4. If odd in a group, carry the leftover down to next group
 * 5. Avoid rematches when possible
 * 6. If total active players is odd, give BYE to worst-ranked player without prior BYE
 */
function generateSwissPairings(state) {
    const activePlayers = state.players.filter(p => !p.eliminated);

    if (activePlayers.length < 2) return { matches: [], bye: null };

    // Build set of past matchups for rematch avoidance
    const pastMatchups = new Set();
    for (const round of state.rounds) {
        for (const m of round.matches) {
            if (!m.isBye && m.player1 && m.player2) {
                const key1 = `${m.player1.id}-${m.player2.id}`;
                const key2 = `${m.player2.id}-${m.player1.id}`;
                pastMatchups.add(key1);
                pastMatchups.add(key2);
            }
        }
    }

    // Determine BYE player if odd number of active players
    let byePlayer = null;
    let playersToMatch = [...activePlayers];

    if (playersToMatch.length % 2 !== 0) {
        // Give BYE to worst-ranked player who hasn't had one
        // Sort by record (worst first), then by fewest wins
        const byeCandidates = playersToMatch
            .filter(p => !p.byeReceived)
            .sort((a, b) => {
                const diffA = a.wins - a.losses;
                const diffB = b.wins - b.losses;
                if (diffA !== diffB) return diffA - diffB; // worst record first
                return a.wins - b.wins; // fewer wins first
            });

        // If everyone already had a BYE, allow repeat for worst player
        if (byeCandidates.length > 0) {
            byePlayer = byeCandidates[0];
        } else {
            const sorted = [...playersToMatch].sort((a, b) => {
                const diffA = a.wins - a.losses;
                const diffB = b.wins - b.losses;
                if (diffA !== diffB) return diffA - diffB;
                return a.wins - b.wins;
            });
            byePlayer = sorted[0];
        }
        playersToMatch = playersToMatch.filter(p => p.id !== byePlayer.id);
    }

    // Group players by record
    const groups = {};
    for (const p of playersToMatch) {
        const key = `${p.wins}-${p.losses}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    }

    // Sort group keys: best record first (most wins, fewest losses)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        const [aW, aL] = a.split('-').map(Number);
        const [bW, bL] = b.split('-').map(Number);
        const diffA = aW - aL, diffB = bW - bL;
        if (diffA !== diffB) return diffB - diffA; // better record first
        return bW - aW; // more wins first
    });

    const matches = [];
    let carryOver = null;
    const roundNum = state.currentRound;

    for (let gi = 0; gi < sortedKeys.length; gi++) {
        let group = [...groups[sortedKeys[gi]]];

        // Add carry-over from previous group
        if (carryOver) {
            group.push(carryOver);
            carryOver = null;
        }

        // Shuffle the group
        for (let i = group.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [group[i], group[j]] = [group[j], group[i]];
        }

        // Try to pair avoiding rematches
        const paired = new Set();
        const groupMatches = [];

        for (let i = 0; i < group.length; i++) {
            if (paired.has(group[i].id)) continue;

            let bestPartner = null;
            let bestPartnerIdx = -1;
            let foundNonRematch = false;

            for (let j = i + 1; j < group.length; j++) {
                if (paired.has(group[j].id)) continue;

                const matchKey = `${group[i].id}-${group[j].id}`;
                const isRematch = pastMatchups.has(matchKey);

                if (!isRematch) {
                    bestPartner = group[j];
                    bestPartnerIdx = j;
                    foundNonRematch = true;
                    break;
                } else if (!bestPartner) {
                    bestPartner = group[j];
                    bestPartnerIdx = j;
                }
            }

            if (bestPartner) {
                paired.add(group[i].id);
                paired.add(bestPartner.id);
                const matchNum = matches.length + groupMatches.length + 1;
                groupMatches.push({
                    id: `r${roundNum}_m${matchNum}`,
                    player1: { id: group[i].id, username: group[i].username, avatar_url: group[i].avatar_url },
                    player2: { id: bestPartner.id, username: bestPartner.username, avatar_url: bestPartner.avatar_url },
                    status: 'pending',
                    p1Ready: false,
                    p2Ready: false,
                    games: [
                        {
                            gameNumber: 1,
                            status: 'banning',
                            p1BannedEC: null,
                            p2BannedEC: null,
                            p1Report: null,
                            p2Report: null,
                            winnerId: null,
                            loserId: null
                        }
                    ],
                    score: { p1: 0, p2: 0 },
                    winnerId: null,
                    loserId: null,
                    reports: {},
                    isBye: false
                });
            }
        }

        matches.push(...groupMatches);

        // Check for unpaired player in this group
        for (const p of group) {
            if (!paired.has(p.id)) {
                carryOver = p;
                break;
            }
        }
    }

    // If there's still a carry-over (shouldn't happen if BYE was correct, but safety)
    if (carryOver && !byePlayer) {
        byePlayer = carryOver;
    }

    // Fix match IDs to be sequential
    matches.forEach((m, i) => {
        m.id = `r${roundNum}_m${i + 1}`;
    });

    return { matches, bye: byePlayer };
}

// ===================== ROUTES =====================

// GET / — Full tournament state
router.get('/', async (req, res) => {
    try { res.json(await getTournamentState()); }
    catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// GET /players — List all registered users for admin selection
router.get('/players', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        const result = await pool.query('SELECT id, username, avatar_url FROM users ORDER BY username ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching players:', err);
        res.status(500).json({ error: 'Error obteniendo jugadores' });
    }
});

// GET /my-matches — Current and past matches for the logged-in user
router.get('/my-matches', authMiddleware, async (req, res) => {
    try {
        const state = await getTournamentState();
        const userId = req.userId;
        if (!state || !state.status) return res.json({ current: null, past: [] });

        let current = null;
        const past = [];

        for (const round of (state.rounds || [])) {
            for (const match of round.matches) {
                const isP = (match.player1 && match.player1.id === userId) ||
                            (match.player2 && match.player2.id === userId);
                if (!isP) continue;
                const entry = { ...match, roundNumber: round.roundNumber };
                if (match.status === 'completed') past.push(entry);
                else current = entry;
            }
        }

        if (current) {
            current = await enrichMatch(current);
        }

        res.json({ current, past });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// POST /generate — Create tournament with Round 1 (Swiss format)
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        let users;
        const { playerIds } = req.body || {};

        if (playerIds && Array.isArray(playerIds) && playerIds.length >= 2) {
            const placeholders = playerIds.map((_, i) => `$${i + 1}`).join(',');
            const usersResult = await pool.query(
                `SELECT id, username, avatar_url FROM users WHERE id IN (${placeholders})`,
                playerIds
            );
            const userMap = {};
            usersResult.rows.forEach(u => { userMap[u.id] = u; });
            users = playerIds.map(id => userMap[id]).filter(Boolean);
        } else {
            const usersResult = await pool.query('SELECT id, username, avatar_url FROM users');
            users = usersResult.rows;
        }

        if (users.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 jugadores' });

        // Shuffle for Round 1
        for (let i = users.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [users[i], users[j]] = [users[j], users[i]];
        }

        const state = {
            status: 'active',
            format: 'swiss',
            generatedAt: new Date().toISOString(),
            players: users.map(u => ({
                id: u.id,
                username: u.username,
                avatar_url: u.avatar_url,
                wins: 0,
                losses: 0,
                eliminated: false,
                byeReceived: false
            })),
            rounds: [],
            currentRound: 1,
            champion: null
        };

        // Generate Round 1 pairings (random since all are 0-0)
        const { matches, bye } = generateSwissPairings(state);

        const round = {
            roundNumber: 1,
            status: 'active',
            matches,
            bye: bye ? { id: bye.id, username: bye.username, avatar_url: bye.avatar_url } : null
        };

        // Apply BYE win
        if (bye) {
            const p = state.players.find(pl => pl.id === bye.id);
            if (p) {
                p.wins += 1;
                p.byeReceived = true;
            }
        }

        state.rounds.push(round);

        await saveTournamentState(state);
        res.json({ success: true, message: `Torneo suizo generado con ${users.length} jugadores`, state });
    } catch (err) {
        console.error('Generate tournament error:', err);
        res.status(500).json({ error: 'Error generando torneo' });
    }
});

// POST /report — Player reports match result
router.post('/report', authMiddleware, async (req, res) => {
    try {
        const { matchId, myScore, enemyScore } = req.body;
        const userId = req.userId;

        if (![0, 1, 2].includes(myScore) || ![0, 1, 2].includes(enemyScore))
            return res.status(400).json({ error: 'Scores inválidos' });
        if (myScore !== 2 && enemyScore !== 2)
            return res.status(400).json({ error: 'En un Bo3, alguien debe tener 2 victorias' });
        if (myScore === 2 && enemyScore === 2)
            return res.status(400).json({ error: 'Ambos no pueden tener 2 victorias' });

        let state = await getTournamentState();
        if (!state || state.status !== 'active')
            return res.status(400).json({ error: 'No hay torneo activo' });

        // Find match in rounds
        let match = null;
        for (const round of state.rounds) {
            const m = round.matches.find(x => x.id === matchId);
            if (m) { match = m; break; }
        }
        if (!match) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });
        if (match.status === 'completed')
            return res.status(400).json({ error: 'Enfrentamiento ya completado' });

        const isP1 = match.player1 && match.player1.id === userId;
        const isP2 = match.player2 && match.player2.id === userId;
        if (!isP1 && !isP2)
            return res.status(403).json({ error: 'No eres parte de este enfrentamiento' });

        match.reports = match.reports || {};
        match.reports[userId] = {
            p1: isP1 ? myScore : enemyScore,
            p2: isP2 ? myScore : enemyScore
        };

        const p1Id = match.player1.id, p2Id = match.player2.id;
        const rep1 = match.reports[p1Id], rep2 = match.reports[p2Id];

        if (rep1 && rep2) {
            if (rep1.p1 === rep2.p1 && rep1.p2 === rep2.p2) {
                match.status = 'completed';
                match.score = { p1: rep1.p1, p2: rep1.p2 };
                match.winnerId = rep1.p1 > rep1.p2 ? p1Id : p2Id;
                match.loserId = rep1.p1 > rep1.p2 ? p2Id : p1Id;

                // Update player records
                const winner = state.players.find(p => p.id === match.winnerId);
                const loser = state.players.find(p => p.id === match.loserId);
                if (winner) winner.wins += 1;
                if (loser) {
                    loser.losses += 1;
                    if (loser.losses >= MAX_LOSSES) loser.eliminated = true;
                }
            } else {
                match.status = 'conflict';
            }
        } else {
            match.status = 'waiting_opponent';
        }

        await saveTournamentState(state);
        res.json({ success: true, match });
    } catch (err) {
        console.error('Report error:', err);
        res.status(500).json({ error: 'Error reportando partido' });
    }
});

// POST /admin/override — Admin forces match result
router.post('/admin/override', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        const { matchId, p1Wins, p2Wins } = req.body;
        if (![0, 1, 2].includes(p1Wins) || ![0, 1, 2].includes(p2Wins))
            return res.status(400).json({ error: 'Scores inválidos' });

        let state = await getTournamentState();

        let match = null;
        for (const round of state.rounds) {
            const m = round.matches.find(x => x.id === matchId);
            if (m) { match = m; break; }
        }
        if (!match) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });

        if (!match.player1 || !match.player2)
            return res.status(400).json({ error: 'El enfrentamiento no tiene ambos jugadores' });

        // If match was already completed, undo previous result first
        if (match.status === 'completed' && match.winnerId && match.loserId) {
            const prevWinner = state.players.find(p => p.id === match.winnerId);
            const prevLoser = state.players.find(p => p.id === match.loserId);
            if (prevWinner) prevWinner.wins -= 1;
            if (prevLoser) {
                prevLoser.losses -= 1;
                prevLoser.eliminated = prevLoser.losses >= MAX_LOSSES;
            }
        }

        match.status = 'completed';
        match.score = { p1: p1Wins, p2: p2Wins };
        match.winnerId = p1Wins > p2Wins ? match.player1.id : match.player2.id;
        match.loserId = p1Wins > p2Wins ? match.player2.id : match.player1.id;
        match.adminOverride = true;

        if (match.games) {
            match.games.forEach(g => {
                g.status = 'completed';
            });
        }

        // Update player records
        const winner = state.players.find(p => p.id === match.winnerId);
        const loser = state.players.find(p => p.id === match.loserId);
        if (winner) winner.wins += 1;
        if (loser) {
            loser.losses += 1;
            if (loser.losses >= MAX_LOSSES) loser.eliminated = true;
        }

        await saveTournamentState(state);
        res.json({ success: true, match });
    } catch (err) {
        console.error('Override error:', err);
        res.status(500).json({ error: 'Error forzando partido' });
    }
});

// POST /advance-round — Admin advances to next round
router.post('/advance-round', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        let state = await getTournamentState();
        if (!state || state.status !== 'active')
            return res.status(400).json({ error: 'No hay torneo activo' });

        // Check all matches in current round are completed
        const currentRound = state.rounds.find(r => r.roundNumber === state.currentRound);
        if (!currentRound)
            return res.status(400).json({ error: 'No se encontró la ronda actual' });

        const pendingMatches = currentRound.matches.filter(m => m.status !== 'completed');
        if (pendingMatches.length > 0)
            return res.status(400).json({
                error: `Hay ${pendingMatches.length} partido(s) sin completar en la Ronda ${state.currentRound}`
            });

        // Mark current round as completed
        currentRound.status = 'completed';

        // Check for champion
        const activePlayers = state.players.filter(p => !p.eliminated);
        if (activePlayers.length <= 1) {
            state.status = 'finished';
            state.champion = activePlayers.length === 1 ? {
                id: activePlayers[0].id,
                username: activePlayers[0].username,
                avatar_url: activePlayers[0].avatar_url
            } : null;
            await saveTournamentState(state);
            return res.json({
                success: true,
                message: state.champion
                    ? `🏆 ¡${state.champion.username} es el campeón!`
                    : 'Torneo finalizado sin campeón',
                state
            });
        }

        // Generate next round
        state.currentRound += 1;
        const { matches, bye } = generateSwissPairings(state);

        if (matches.length === 0 && !bye) {
            return res.status(400).json({ error: 'No se pueden generar emparejamientos' });
        }

        const newRound = {
            roundNumber: state.currentRound,
            status: 'active',
            matches,
            bye: bye ? { id: bye.id, username: bye.username, avatar_url: bye.avatar_url } : null
        };

        // Apply BYE win
        if (bye) {
            const p = state.players.find(pl => pl.id === bye.id);
            if (p) {
                p.wins += 1;
                p.byeReceived = true;
            }
        }

        state.rounds.push(newRound);

        await saveTournamentState(state);
        res.json({
            success: true,
            message: `Ronda ${state.currentRound} generada con ${matches.length} partidos`,
            state
        });
    } catch (err) {
        console.error('Advance round error:', err);
        res.status(500).json({ error: 'Error avanzando ronda' });
    }
});

// POST /reset — Reset tournament
router.post('/reset', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });
        await saveTournamentState({});
        res.json({ success: true, message: 'Torneo reseteado' });
    } catch (err) {
        console.error('Reset error:', err);
        res.status(500).json({ error: 'Error reseteando torneo' });
    }
});


// POST /ready — Player marks themselves ready
router.post('/ready', authMiddleware, async (req, res) => {
    try {
        const { matchId } = req.body;
        const userId = req.userId;

        let state = await getTournamentState();
        if (!state || state.status !== 'active')
            return res.status(400).json({ error: 'No hay torneo activo' });

        let match = null;
        for (const round of state.rounds) {
            const m = round.matches.find(x => x.id === matchId);
            if (m) { match = m; break; }
        }
        if (!match) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });
        if (match.status === 'completed')
            return res.status(400).json({ error: 'El enfrentamiento ya terminó' });

        const isP1 = match.player1 && match.player1.id === userId;
        const isP2 = match.player2 && match.player2.id === userId;
        if (!isP1 && !isP2)
            return res.status(403).json({ error: 'No eres parte de este enfrentamiento' });

        if (isP1) match.p1Ready = true;
        if (isP2) match.p2Ready = true;

        if (match.p1Ready && match.p2Ready) {
            match.status = 'ready';
        }

        await saveTournamentState(state);
        res.json({ success: true, match: await enrichMatch(match) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al marcar listo' });
    }
});

// POST /ban — Player selects a Pokémon to ban from the opponent's team
router.post('/ban', authMiddleware, async (req, res) => {
    try {
        const { matchId, bannedEC } = req.body;
        const userId = req.userId;

        let state = await getTournamentState();
        if (!state || state.status !== 'active')
            return res.status(400).json({ error: 'No hay torneo activo' });

        let match = null;
        for (const round of state.rounds) {
            const m = round.matches.find(x => x.id === matchId);
            if (m) { match = m; break; }
        }
        if (!match) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });
        if (!match.p1Ready || !match.p2Ready)
            return res.status(400).json({ error: 'Ambos jugadores deben estar listos' });

        const isP1 = match.player1 && match.player1.id === userId;
        const isP2 = match.player2 && match.player2.id === userId;
        if (!isP1 && !isP2)
            return res.status(403).json({ error: 'No eres parte de este enfrentamiento' });

        if (!match.games) match.games = [];
        let activeGame = match.games.find(g => g.status !== 'completed' && g.status !== 'conflict');
        if (!activeGame) {
            activeGame = {
                gameNumber: match.games.length + 1,
                status: 'banning',
                p1BannedEC: null,
                p2BannedEC: null,
                p1Report: null,
                p2Report: null,
                winnerId: null,
                loserId: null
            };
            match.games.push(activeGame);
        }

        if (activeGame.status !== 'banning')
            return res.status(400).json({ error: 'No estás en fase de baneo' });

        const opponentId = isP1 ? match.player2.id : match.player1.id;
        const opponentTeam = await getPlayerBattleTeam(opponentId);
        const exists = opponentTeam.some(p => p.ec === bannedEC);
        if (!exists) return res.status(400).json({ error: 'El Pokémon no está en el equipo del rival' });

        const myLockedBans = getLockedBansForGame(match, userId, activeGame.gameNumber);
        if (myLockedBans.includes(bannedEC)) {
            return res.status(400).json({ error: 'No puedes volver a banear el mismo Pokémon si ganaste la ronda anterior' });
        }

        if (isP1) {
            activeGame.p1BannedEC = bannedEC;
        } else {
            activeGame.p2BannedEC = bannedEC;
        }

        if (activeGame.p1BannedEC && activeGame.p2BannedEC) {
            activeGame.status = 'playing';
            match.status = 'playing';
        }

        await saveTournamentState(state);
        res.json({ success: true, match: await enrichMatch(match) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al banear' });
    }
});

// POST /report-game — Player reports win or loss for the current game
router.post('/report-game', authMiddleware, async (req, res) => {
    try {
        const { matchId, result } = req.body;
        const userId = req.userId;

        if (result !== 'win' && result !== 'loss')
            return res.status(400).json({ error: 'Resultado inválido (debe ser win o loss)' });

        let state = await getTournamentState();
        if (!state || state.status !== 'active')
            return res.status(400).json({ error: 'No hay torneo activo' });

        let match = null;
        for (const round of state.rounds) {
            const m = round.matches.find(x => x.id === matchId);
            if (m) { match = m; break; }
        }
        if (!match) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });

        const isP1 = match.player1 && match.player1.id === userId;
        const isP2 = match.player2 && match.player2.id === userId;
        if (!isP1 && !isP2)
            return res.status(403).json({ error: 'No eres parte de este enfrentamiento' });

        if (!match.games) return res.status(400).json({ error: 'No hay partidas iniciadas' });
        let activeGame = match.games.find(g => g.status !== 'completed' && g.status !== 'conflict');
        if (!activeGame) return res.status(400).json({ error: 'No hay partida activa para reportar' });

        if (activeGame.status !== 'playing')
            return res.status(400).json({ error: 'La partida no está en fase de juego' });

        if (isP1) {
            activeGame.p1Report = result;
        } else {
            activeGame.p2Report = result;
        }

        if (activeGame.p1Report && activeGame.p2Report) {
            const p1Won = activeGame.p1Report === 'win';
            const p2Won = activeGame.p2Report === 'win';

            if (p1Won !== p2Won) {
                activeGame.status = 'completed';
                const gameWinnerId = p1Won ? match.player1.id : match.player2.id;
                const gameLoserId = p1Won ? match.player2.id : match.player1.id;
                activeGame.winnerId = gameWinnerId;
                activeGame.loserId = gameLoserId;

                match.score = match.score || { p1: 0, p2: 0 };
                if (p1Won) match.score.p1 += 1;
                else match.score.p2 += 1;

                if (match.score.p1 === 2 || match.score.p2 === 2) {
                    match.status = 'completed';
                    match.winnerId = match.score.p1 === 2 ? match.player1.id : match.player2.id;
                    match.loserId = match.score.p1 === 2 ? match.player2.id : match.player1.id;

                    const winner = state.players.find(p => p.id === match.winnerId);
                    const loser = state.players.find(p => p.id === match.loserId);
                    if (winner) winner.wins += 1;
                    if (loser) {
                        loser.losses += 1;
                        if (loser.losses >= MAX_LOSSES) loser.eliminated = true;
                    }
                } else {
                    match.status = 'ready';
                    match.games.push({
                        gameNumber: activeGame.gameNumber + 1,
                        status: 'banning',
                        p1BannedEC: null,
                        p2BannedEC: null,
                        p1Report: null,
                        p2Report: null,
                        winnerId: null,
                        loserId: null
                    });
                }
            } else {
                activeGame.status = 'conflict';
                match.status = 'conflict';
            }
        } else {
            match.status = 'waiting_opponent';
        }

        await saveTournamentState(state);
        res.json({ success: true, match: await enrichMatch(match) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al reportar juego' });
    }
});

module.exports = router;

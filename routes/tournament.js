const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const ADMIN_USER = 'GabrielLucifer22';

// ===================== HELPERS =====================

async function getTournamentState() {
    const result = await pool.query('SELECT state FROM tournament LIMIT 1');
    return result.rows.length > 0 ? (result.rows[0].state || {}) : {};
}

async function saveTournamentState(state) {
    await pool.query('UPDATE tournament SET state = $1, updated_at = NOW()', [JSON.stringify(state)]);
}

function findMatchById(state, matchId) {
    if (state.semifinals && state.semifinals.id === matchId)
        return { match: state.semifinals, bracket: 'semifinals', roundIndex: 0 };
    if (state.grandFinal && state.grandFinal.id === matchId)
        return { match: state.grandFinal, bracket: 'grandFinal', roundIndex: 0 };
    for (const bk of ['upper', 'middle', 'lower']) {
        if (!state[bk] || !state[bk].rounds) continue;
        for (let r = 0; r < state[bk].rounds.length; r++) {
            const m = state[bk].rounds[r].find(x => x.id === matchId);
            if (m) return { match: m, bracket: bk, roundIndex: r };
        }
    }
    return null;
}

function countFeedMatches(state, targetMatchId) {
    let count = 0;
    for (const bk of ['upper', 'middle', 'lower']) {
        if (!state[bk] || !state[bk].rounds) continue;
        for (const round of state[bk].rounds) {
            for (const m of round) {
                if (m.nextMatchId === targetMatchId ||
                    (m.loserDest && m.loserDest.matchId === targetMatchId)) {
                    if (m.status !== 'completed') count++;
                }
            }
        }
    }
    // Also check semifinals/grandFinal
    if (state.semifinals && state.semifinals.nextMatchId === targetMatchId && state.semifinals.status !== 'completed') count++;
    return count;
}

function placeInMatch(state, matchId, player) {
    const found = findMatchById(state, matchId);
    if (!found) return;
    const m = found.match;
    if (!m.player1) m.player1 = player;
    else if (!m.player2) m.player2 = player;
    checkAutoWin(state, m);
}

function checkAutoWin(state, match) {
    if (match.player1 && !match.player2 && match.status === 'pending') {
        const feedCount = countFeedMatches(state, match.id);
        if (feedCount > 0) return;
        match.status = 'completed';
        match.winnerId = match.player1.id;
        match.score = { p1: 2, p2: 0 };
        advanceWinner(state, match);
    }
}

function advanceWinner(state, match) {
    if (!match.winnerId) return;
    const winner = match.winnerId === match.player1.id ? match.player1 : match.player2;
    const loser = match.player2
        ? (match.loserId === match.player1.id ? match.player1 : match.player2)
        : null;
    if (match.nextMatchId) placeInMatch(state, match.nextMatchId, winner);
    if (loser && match.loserDest) placeInMatch(state, match.loserDest.matchId, loser);
}

function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function makeMatch(id, nextMatchId, loserDest) {
    return {
        id, nextMatchId, loserDest,
        player1: null, player2: null,
        status: 'pending', score: { p1: 0, p2: 0 },
        winnerId: null, loserId: null, reports: {}
    };
}

// ===================== ROUTES =====================

router.get('/', async (req, res) => {
    try { res.json(await getTournamentState()); }
    catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// GET /api/tournament/players — List all registered users for admin selection
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

router.get('/my-matches', authMiddleware, async (req, res) => {
    try {
        const state = await getTournamentState();
        const userId = req.userId;
        if (!state || !state.status) return res.json({ current: null, past: [] });

        let current = null;
        const past = [];

        for (const bk of ['upper', 'middle', 'lower']) {
            if (!state[bk] || !state[bk].rounds) continue;
            for (const round of state[bk].rounds) {
                for (const match of round) {
                    const isP = (match.player1 && match.player1.id === userId) ||
                                (match.player2 && match.player2.id === userId);
                    if (!isP) continue;
                    const entry = { ...match, bracket: bk };
                    if (match.status === 'completed') past.push(entry); else current = entry;
                }
            }
        }

        for (const key of ['semifinals', 'grandFinal']) {
            const m = state[key];
            if (!m) continue;
            const isP = (m.player1 && m.player1.id === userId) || (m.player2 && m.player2.id === userId);
            if (isP) {
                const entry = { ...m, bracket: key };
                if (m.status === 'completed') past.push(entry); else current = entry;
            }
        }

        res.json({ current, past });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// POST /api/tournament/generate
// Accepts optional { playerIds: [id1, id2, ...] } to use specific players in order.
// If playerIds is not provided, falls back to all registered users (shuffled).
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        let users;
        const { playerIds } = req.body || {};

        if (playerIds && Array.isArray(playerIds) && playerIds.length >= 2) {
            // Admin selected specific players in specific order
            const placeholders = playerIds.map((_, i) => `$${i + 1}`).join(',');
            const usersResult = await pool.query(
                `SELECT id, username, avatar_url FROM users WHERE id IN (${placeholders})`,
                playerIds
            );
            // Preserve admin-specified order
            const userMap = {};
            usersResult.rows.forEach(u => { userMap[u.id] = u; });
            users = playerIds.map(id => userMap[id]).filter(Boolean);
        } else {
            // Fallback: all registered users, shuffled
            const usersResult = await pool.query('SELECT id, username, avatar_url FROM users');
            users = usersResult.rows;
            // Shuffle
            for (let i = users.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [users[i], users[j]] = [users[j], users[i]];
            }
        }

        if (users.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 jugadores' });

        const n = users.length;
        const numUBRounds = Math.ceil(Math.log2(n));
        const ubSlots = Math.pow(2, numUBRounds);

        const state = {
            status: 'active',
            generatedAt: new Date().toISOString(),
            upper: { rounds: [] },
            middle: { rounds: [] },
            lower: { rounds: [] },
            semifinals: null,
            grandFinal: null
        };

        // ========== UPPER BRACKET ==========
        const upperR0 = [];
        for (let i = 0; i < ubSlots; i += 2) {
            const mNum = (i / 2) + 1;
            const p1 = i < n ? users[i] : null;
            const p2 = (i + 1) < n ? users[i + 1] : null;
            const matchId = `u0_m${mNum}`;
            const nextMatchId = numUBRounds > 1 ? `u1_m${Math.ceil(mNum / 2)}` : 'gf_final';
            const isBye = !p1 || !p2;
            const loserDest = isBye ? null : { matchId: `m0_m${Math.ceil(mNum / 2)}` };

            upperR0.push({
                id: matchId, nextMatchId, loserDest,
                player1: p1, player2: p2,
                status: isBye ? 'completed' : 'pending',
                score: isBye ? { p1: p1 ? 2 : 0, p2: p2 ? 2 : 0 } : { p1: 0, p2: 0 },
                winnerId: isBye ? (p1 ? p1.id : (p2 ? p2.id : null)) : null,
                loserId: null, reports: {}
            });
        }
        state.upper.rounds.push(upperR0);

        let prevCount = upperR0.length;
        for (let r = 1; prevCount > 1; r++) {
            const numM = Math.ceil(prevCount / 2);
            const round = [];
            for (let m = 1; m <= numM; m++) {
                const mId = `u${r}_m${m}`;
                const isUBFinal = numM === 1;
                const nextMId = isUBFinal ? 'gf_final' : `u${r + 1}_m${Math.ceil(m / 2)}`;
                const midRound = 2 * r - 1;
                round.push(makeMatch(mId, nextMId, { matchId: `m${midRound}_m${m}` }));
            }
            state.upper.rounds.push(round);
            prevCount = numM;
        }

        // ========== MIDDLE BRACKET ==========
        // Losers from Upper fall here. Losers from Middle fall to Lower.
        const numMidRounds = numUBRounds >= 2 ? 2 * (numUBRounds - 1) : 0;
        const allMiddleMatches = [];

        for (let mr = 0; mr < numMidRounds; mr++) {
            const isMinor = mr % 2 === 0;
            let numM;

            if (mr === 0) {
                numM = Math.ceil(upperR0.length / 2);
            } else if (isMinor) {
                numM = Math.ceil(state.middle.rounds[mr - 1].length / 2);
            } else {
                numM = state.middle.rounds[mr - 1].length;
            }

            const round = [];
            for (let m = 1; m <= numM; m++) {
                const mId = `m${mr}_m${m}`;
                const isMidFinal = mr === numMidRounds - 1;
                let nextMId;
                if (isMidFinal) nextMId = 'gf_semi';
                else if (isMinor) nextMId = `m${mr + 1}_m${m}`;
                else nextMId = `m${mr + 1}_m${Math.ceil(m / 2)}`;

                const match = makeMatch(mId, nextMId, null); // loserDest set below
                round.push(match);
                allMiddleMatches.push(match);
            }
            state.middle.rounds.push(round);
        }

        // ========== LOWER BRACKET ==========
        // Losers from Middle fall here. Losers from Lower are ELIMINATED (2nd loss).
        const totalMidMatches = allMiddleMatches.length;

        if (totalMidMatches >= 2) {
            const lowerSlots = nextPow2(totalMidMatches);
            const numLBRounds = Math.round(Math.log2(lowerSlots));

            let lbPrevCount = lowerSlots / 2;
            for (let lr = 0; lr < numLBRounds; lr++) {
                const numM = lr === 0 ? lowerSlots / 2 : Math.ceil(lbPrevCount / 2);
                const round = [];
                for (let m = 1; m <= numM; m++) {
                    const mId = `l${lr}_m${m}`;
                    const isLBFinal = lr === numLBRounds - 1 && numM === 1;
                    const nextMId = isLBFinal ? 'gf_semi' : `l${lr + 1}_m${Math.ceil(m / 2)}`;
                    // Losers from Lower are eliminated (no loserDest = null)
                    round.push(makeMatch(mId, nextMId, null));
                }
                state.lower.rounds.push(round);
                lbPrevCount = numM;
            }

            // Assign Middle match loserDests → Lower R0 slots
            for (let i = 0; i < allMiddleMatches.length; i++) {
                const lowerR0Match = Math.floor(i / 2) + 1;
                if (state.lower.rounds.length > 0 && lowerR0Match <= state.lower.rounds[0].length) {
                    allMiddleMatches[i].loserDest = { matchId: `l0_m${lowerR0Match}` };
                }
                // else: loser eliminated (null loserDest stays)
            }
        } else if (totalMidMatches === 1) {
            // Only 1 middle match: loser is eliminated (2nd loss) — no Lower bracket needed.
            // The single Middle match loser has already lost once (from Upper) and now loses
            // again in Middle = 2 losses = eliminated. This is correct.
            allMiddleMatches[0].loserDest = null;
        }

        // ========== FINALS ==========
        // Semifinals: Middle champion vs Lower champion (if Lower exists).
        // Grand Final: Upper champion vs Semifinals winner.
        state.semifinals = makeMatch('gf_semi', 'gf_final', null);
        state.grandFinal = makeMatch('gf_final', null, null);

        // ========== ADVANCE BYES ==========
        for (const match of upperR0) {
            if (match.status === 'completed' && match.winnerId) {
                advanceWinner(state, match);
            }
        }

        await saveTournamentState(state);
        res.json({ success: true, message: 'Torneo generado exitosamente', state });
    } catch (err) {
        console.error('Generate tournament error:', err);
        res.status(500).json({ error: 'Error generando torneo' });
    }
});

// POST /api/tournament/report
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

        const found = findMatchById(state, matchId);
        if (!found) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });
        const { match } = found;

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
                advanceWinner(state, match);
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

// POST /api/tournament/admin/override
router.post('/admin/override', authMiddleware, async (req, res) => {
    try {
        if (req.username.toLowerCase() !== ADMIN_USER.toLowerCase())
            return res.status(403).json({ error: 'No autorizado' });

        const { matchId, p1Wins, p2Wins } = req.body;
        if (![0, 1, 2].includes(p1Wins) || ![0, 1, 2].includes(p2Wins))
            return res.status(400).json({ error: 'Scores inválidos' });

        let state = await getTournamentState();
        const found = findMatchById(state, matchId);
        if (!found) return res.status(404).json({ error: 'Enfrentamiento no encontrado' });
        const { match } = found;

        if (!match.player1 || !match.player2)
            return res.status(400).json({ error: 'El enfrentamiento no tiene ambos jugadores' });

        match.status = 'completed';
        match.score = { p1: p1Wins, p2: p2Wins };
        match.winnerId = p1Wins > p2Wins ? match.player1.id : match.player2.id;
        match.loserId = p1Wins > p2Wins ? match.player2.id : match.player1.id;
        match.adminOverride = true;
        advanceWinner(state, match);

        await saveTournamentState(state);
        res.json({ success: true, match });
    } catch (err) {
        console.error('Override error:', err);
        res.status(500).json({ error: 'Error forzando partido' });
    }
});

// POST /api/tournament/reset
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

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

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
            resolve(''); // return empty string on error to prevent crashing
        });
    });
}

async function checkLiveStatus(platform, channel) {
    return true; // Temporarily disabled live requirement for local testing
    /*
    if (!platform || !channel) return false;
    const plat = platform.toLowerCase().trim();
    const chan = channel.toLowerCase().trim();

    if (chan === 'test') return true; // dev bypass

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

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, password, stream_platform, stream_channel } = req.body;

        if (!username || !password || !stream_platform || !stream_channel) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }
        if (username.length < 3 || username.length > 50) {
            return res.status(400).json({ error: 'Username debe tener entre 3 y 50 caracteres' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: 'Password debe tener al menos 4 caracteres' });
        }

        // Check if user exists
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
        }

        // Hash password and create user
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password, stream_platform, stream_channel) VALUES ($1, $2, $3, $4) RETURNING id, username, avatar_url, stream_platform, stream_channel, created_at',
            [username, hashedPassword, stream_platform, stream_channel]
        );

        const user = result.rows[0];

        // Create empty save_data entry
        await pool.query(
            'INSERT INTO save_data (user_id) VALUES ($1)',
            [user.id]
        );

        // Generate token
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            token,
            user: { id: user.id, username: user.username, avatar_url: user.avatar_url, stream_platform: user.stream_platform, stream_channel: user.stream_channel }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username y password son obligatorios' });
        }

        const result = await pool.query('SELECT id, username, password, avatar_url, stream_platform, stream_channel FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Check if stream is live
        const isLive = await checkLiveStatus(user.stream_platform, user.stream_channel);
        if (!isLive) {
            return res.status(403).json({ error: `Debe estar en directo en tu canal de ${user.stream_platform} (${user.stream_channel}) para poder iniciar sesión y jugar.` });
        }

        // Update is_live status in DB
        await pool.query('UPDATE users SET is_live = true WHERE id = $1', [user.id]);

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, avatar_url: user.avatar_url, stream_platform: user.stream_platform, stream_channel: user.stream_channel }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, avatar_url, created_at FROM users WHERE id = $1', [req.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
});

// PUT /api/auth/avatar
router.put('/avatar', authMiddleware, async (req, res) => {
    try {
        const { avatarUrl } = req.body;
        if (avatarUrl && avatarUrl.length > 500000) {
            return res.status(400).json({ error: 'Imagen demasiado grande (máx 500KB)' });
        }
        await pool.query(
            'UPDATE users SET avatar_url = $1 WHERE id = $2',
            [avatarUrl || null, req.userId]
        );
        res.json({ success: true, avatar_url: avatarUrl || null });
    } catch (err) {
        console.error('Avatar update error:', err);
        res.status(500).json({ error: 'Error al actualizar avatar' });
    }
});

// PUT /api/auth/username
router.put('/username', authMiddleware, async (req, res) => {
    try {
        const { newUsername, password } = req.body;
        if (!newUsername || !password) {
            return res.status(400).json({ error: 'Nuevo nombre y contraseña son obligatorios' });
        }
        if (newUsername.length < 3 || newUsername.length > 50) {
            return res.status(400).json({ error: 'El nombre debe tener entre 3 y 50 caracteres' });
        }

        // Verify current password
        const userResult = await pool.query('SELECT id, password FROM users WHERE id = $1', [req.userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const valid = await bcrypt.compare(password, userResult.rows[0].password);
        if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

        // Check uniqueness
        const existing = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [newUsername, req.userId]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Ese nombre ya está en uso' });

        await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, req.userId]);

        // Issue new token with updated username
        const token = jwt.sign(
            { userId: req.userId, username: newUsername },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ success: true, username: newUsername, token });
    } catch (err) {
        console.error('Username update error:', err);
        res.status(500).json({ error: 'Error al cambiar nombre' });
    }
});

// PUT /api/auth/password
router.put('/password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Ambas contraseñas son obligatorias' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
        }

        // Verify current password
        const userResult = await pool.query('SELECT id, password FROM users WHERE id = $1', [req.userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const valid = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.userId]);

        res.json({ success: true, message: 'Contraseña actualizada' });
    } catch (err) {
        console.error('Password update error:', err);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

// GET /api/auth/check-live — checks current live status and updates DB
router.get('/check-live', authMiddleware, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT stream_platform, stream_channel FROM users WHERE id = $1', [req.userId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const { stream_platform, stream_channel } = userRes.rows[0];
        const isLive = await checkLiveStatus(stream_platform, stream_channel);

        // Update is_live in DB
        await pool.query('UPDATE users SET is_live = $1 WHERE id = $2', [isLive, req.userId]);

        res.json({
            isLive,
            platform: stream_platform,
            channel: stream_channel
        });
    } catch (err) {
        console.error('Check live error:', err);
        res.status(500).json({ error: 'Error al verificar directo' });
    }
});

// PUT /api/auth/stream — updates user stream info
router.put('/stream', authMiddleware, async (req, res) => {
    try {
        const { platform, channel } = req.body;
        if (!platform || !channel) {
            return res.status(400).json({ error: 'Plataforma y canal son obligatorios' });
        }
        await pool.query(
            'UPDATE users SET stream_platform = $1, stream_channel = $2 WHERE id = $3',
            [platform, channel, req.userId]
        );
        res.json({ success: true, platform, channel });
    } catch (err) {
        console.error('Update stream info error:', err);
        res.status(500).json({ error: 'Error al actualizar información de directo' });
    }
});

// GET /api/auth/nuzlocke — devuelve el nuzlocke almacenado en BD para el usuario autenticado
// Usado por la app de escritorio al arrancar para restaurar nuzlocke.json si se ha perdido
router.get('/nuzlocke', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT nuzlocke FROM save_data WHERE user_id = $1',
            [req.userId]
        );
        if (result.rows.length === 0 || !result.rows[0].nuzlocke) {
            return res.json(null);
        }
        res.json(result.rows[0].nuzlocke);
    } catch (err) {
        console.error('Error fetching nuzlocke:', err);
        res.status(500).json({ error: 'Error al obtener nuzlocke' });
    }
});

module.exports = router;


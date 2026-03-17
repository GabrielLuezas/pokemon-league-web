const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username y password son obligatorios' });
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
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, avatar_url, created_at',
            [username, hashedPassword]
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
            user: { id: user.id, username: user.username, avatar_url: user.avatar_url }
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

        const result = await pool.query('SELECT id, username, password, avatar_url FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, avatar_url: user.avatar_url }
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


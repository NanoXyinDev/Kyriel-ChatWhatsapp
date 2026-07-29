const express = require('express');
const githubDB = require('../utils/github-db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

router.get('/profile', authenticate, async (req, res) => {
  try {
    const users = await githubDB.getUsers();
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ROLE_LIMITS = require('./auth').ROLE_LIMITS;
    res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar, activeSessions: user.activeSessions || 0, whatsappSessions: user.whatsappSessions || [], limits: ROLE_LIMITS[user.role], createdAt: user.createdAt, lastLogin: user.lastLogin } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

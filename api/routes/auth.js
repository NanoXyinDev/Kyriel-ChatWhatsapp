const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const githubDB = require('../utils/github-db');
const { JWT_SECRET } = require('../middleware/auth');

const ROLE_LIMITS = {
  'OWNER': { sessions: Infinity, canViewOnce: true, canBroadcast: true, canExport: true },
  'BUILDER': { sessions: 10, canViewOnce: true, canBroadcast: true, canExport: true },
  'PRO MAX': { sessions: 5, canViewOnce: true, canBroadcast: true, canExport: false },
  'PRO': { sessions: 3, canViewOnce: true, canBroadcast: false, canExport: false },
  'FREE': { sessions: 1, canViewOnce: false, canBroadcast: false, canExport: false }
};

async function getUsers() {
  try { return await githubDB.getUsers(); }
  catch(e) { console.error('getUsers error:', e.message); return []; }
}

async function saveUsers(users) {
  try { await githubDB.saveUsers(users); }
  catch(e) { console.error('saveUsers error:', e.message); }
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const users = await getUsers();
    if (users.find(u => u.username === username || u.email === email)) return res.status(400).json({ error: 'User already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(), username, email, password: hashedPassword,
      role: 'FREE', avatar: null, createdAt: new Date().toISOString(),
      lastLogin: null, activeSessions: 0, whatsappSessions: []
    };
    users.push(newUser);
    await saveUsers(users);
    await githubDB.addLog(username, 'REGISTER', { email });
    res.json({ success: true, message: 'Registered' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const users = await getUsers();
    const user = users.find(u => u.username === username || u.email === username);
    if (!user) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });
    user.lastLogin = new Date().toISOString();
    await saveUsers(users);
    await githubDB.addLog(user.username, 'LOGIN', { ip: req.ip });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true, token,
      user: {
        id: user.id, username: user.username, email: user.email,
        role: user.role, avatar: user.avatar,
        limits: ROLE_LIMITS[user.role]
      }
    });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = await getUsers();
    const user = users.find(u => u.id === decoded.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id, username: user.username, email: user.email,
        role: user.role, avatar: user.avatar,
        activeSessions: user.activeSessions || 0,
        limits: ROLE_LIMITS[user.role]
      }
    });
  } catch(err) { res.status(401).json({ error: 'Invalid token' }); }
});

router.post('/update-role', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = await getUsers();
    const admin = users.find(u => u.id === decoded.id);
    if (admin.role !== 'OWNER') return res.status(403).json({ error: 'OWNER only' });
    const { username, newRole } = req.body;
    if (!ROLE_LIMITS[newRole]) return res.status(400).json({ error: 'Invalid role' });
    const target = users.find(u => u.username === username);
    if (!target) return res.status(404).json({ error: 'User not found' });
    target.role = newRole;
    await saveUsers(users);
    await githubDB.addLog(admin.username, 'UPDATE_ROLE', { target: username, newRole });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/all', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = await getUsers();
    const requester = users.find(u => u.id === decoded.id);
    if (!['OWNER','BUILDER'].includes(requester?.role)) return res.status(403).json({ error: 'Access denied' });
    res.json({ users: users.map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role, activeSessions: u.activeSessions, lastLogin: u.lastLogin, createdAt: u.createdAt })) });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
module.exports.ROLE_LIMITS = ROLE_LIMITS;

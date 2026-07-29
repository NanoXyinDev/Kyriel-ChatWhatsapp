const express = require('express');
const { v4: uuidv4 } = require('uuid');
const githubDB = require('../utils/github-db');
const { authenticate } = require('../middleware/auth');

const globalMessages = [];

module.exports = (io) => {
  const router = express.Router();

  router.get('/global', authenticate, async (req, res) => {
    res.json({ messages: globalMessages.slice(-100) });
  });

  router.post('/global', authenticate, async (req, res) => {
    try {
      const { message } = req.body;
      const msg = { id: uuidv4(), username: req.user.username, message, timestamp: new Date().toISOString(), avatar: null };
      globalMessages.push(msg);
      if (globalMessages.length > 500) globalMessages.shift();
      io.to('global-chat').emit('new-global-message', msg);
      await githubDB.addLog(req.user.username, 'GLOBAL_CHAT', { message: message.substring(0,100) });
      res.json({ success: true, message: msg });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/my-logs', authenticate, async (req, res) => {
    try { const logs = await githubDB.getUserLogs(req.user.username); res.json({ logs }); }
    catch(err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

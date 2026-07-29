const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const githubDB = require('../utils/github-db');
const { authenticate } = require('../middleware/auth');
const NodeCache = require('node-cache');

const msgRetryCounterCache = new NodeCache();

module.exports = (io, sessions, liveLogs) => {
  const router = express.Router();
  const activeConnections = new Map();

  const emitLog = (userId, type, message, data = {}) => {
    const log = { id: Date.now().toString(), type, message, data, timestamp: new Date().toISOString() };
    if (!liveLogs.has(userId)) liveLogs.set(userId, []);
    liveLogs.get(userId).push(log);
    if (liveLogs.get(userId).length > 200) liveLogs.get(userId).shift();
    io.to(userId).emit('live-log', log);
  };

  const getSessionPath = (userId, sessionId) => path.join('/tmp', `sessions/${userId}/${sessionId}`);

  const createConnection = async (userId, sessionId, method, phoneNumber = null) => {
    const sessionPath = getSessionPath(userId, sessionId);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state, printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('KyrielWhatsApp'),
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      msgRetryCounterCache, syncFullHistory: false
    });

    activeConnections.set(`${userId}_${sessionId}`, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        const qrDataUrl = await qrcode.toDataURL(qr);
        io.to(userId).emit('wa-qr', { sessionId, qr: qrDataUrl, method });
        emitLog(userId, 'info', `QR generated for ${sessionId}`);
      }
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut : true;
        emitLog(userId, 'warning', `Session ${sessionId} disconnected`);
        io.to(userId).emit('wa-disconnected', { sessionId, shouldReconnect });
        if (shouldReconnect) {
          setTimeout(() => createConnection(userId, sessionId, method, phoneNumber), 3000);
        } else activeConnections.delete(`${userId}_${sessionId}`);
      } else if (connection === 'open') {
        emitLog(userId, 'success', `Session ${sessionId} connected!`);
        io.to(userId).emit('wa-connected', { sessionId, user: sock.user });
        const users = await githubDB.getUsers();
        const user = users.find(u => u.id === userId);
        if (user) {
          user.activeSessions = (user.activeSessions || 0) + 1;
          if (!user.whatsappSessions) user.whatsappSessions = [];
          if (!user.whatsappSessions.includes(sessionId)) user.whatsappSessions.push(sessionId);
          await githubDB.saveUsers(users);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const md = { id: msg.key.id, from: msg.key.remoteJid, pushName: msg.pushName || 'Unknown', timestamp: msg.messageTimestamp, type: 'unknown' };
        if (msg.message?.conversation) { md.type = 'text'; md.text = msg.message.conversation; }
        else if (msg.message?.extendedTextMessage?.text) { md.type = 'text'; md.text = msg.message.extendedTextMessage.text; }
        else if (msg.message?.imageMessage) { md.type = 'image'; md.caption = msg.message.imageMessage.caption || ''; md.viewOnce = msg.message.imageMessage.viewOnce || false; }
        else if (msg.message?.videoMessage) { md.type = 'video'; md.caption = msg.message.videoMessage.caption || ''; md.viewOnce = msg.message.videoMessage.viewOnce || false; }
        else if (msg.message?.audioMessage) { md.type = 'audio'; }
        else if (msg.message?.documentMessage) { md.type = 'document'; md.fileName = msg.message.documentMessage.fileName; }
        io.to(userId).emit('wa-message', { sessionId, message: md });
        emitLog(userId, 'message', `New ${md.type} from ${md.pushName}`);
      }
    });

    if (method === 'pairing' && phoneNumber && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        io.to(userId).emit('wa-pairing-code', { sessionId, code });
        emitLog(userId, 'info', `Pairing code: ${code}`);
      } catch (err) { emitLog(userId, 'error', `Pairing failed: ${err.message}`); }
    }

    return sock;
  };

  router.post('/connect', authenticate, async (req, res) => {
    try {
      const { method, phoneNumber } = req.body;
      const userId = req.user.id;
      const sessionId = `session_${Date.now()}`;
      const users = await githubDB.getUsers();
      const user = users.find(u => u.id === userId);
      const ROLE_LIMITS = require('./auth').ROLE_LIMITS;
      const limits = ROLE_LIMITS[user.role];
      if (user.whatsappSessions && user.whatsappSessions.length >= limits.sessions) {
        return res.status(403).json({ error: `Max ${limits.sessions} sessions for ${user.role}` });
      }
      emitLog(userId, 'info', `Starting ${method} connection...`);
      await createConnection(userId, sessionId, method, phoneNumber);
      await githubDB.addLog(user.username, 'WA_CONNECT', { method, sessionId });
      res.json({ success: true, sessionId });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/disconnect', authenticate, async (req, res) => {
    try {
      const { sessionId } = req.body;
      const userId = req.user.id;
      const key = `${userId}_${sessionId}`;
      const sock = activeConnections.get(key);
      if (sock) { await sock.logout(); activeConnections.delete(key); }
      const sp = getSessionPath(userId, sessionId);
      if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true });
      const users = await githubDB.getUsers();
      const user = users.find(u => u.id === userId);
      if (user) {
        user.activeSessions = Math.max(0, (user.activeSessions || 0) - 1);
        user.whatsappSessions = (user.whatsappSessions || []).filter(s => s !== sessionId);
        await githubDB.saveUsers(users);
      }
      emitLog(userId, 'info', `Session ${sessionId} disconnected`);
      await githubDB.addLog(req.user.username, 'WA_DISCONNECT', { sessionId });
      res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/sessions', authenticate, async (req, res) => {
    try {
      const userId = req.user.id;
      const userSessions = [];
      for (const [key, sock] of activeConnections) {
        if (key.startsWith(`${userId}_`)) {
          const sessionId = key.replace(`${userId}_`, '');
          userSessions.push({ sessionId, connected: !!sock.user, user: sock.user || null });
        }
      }
      res.json({ sessions: userSessions });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/send', authenticate, async (req, res) => {
    try {
      const { sessionId, to, message, type = 'text' } = req.body;
      const userId = req.user.id;
      const key = `${userId}_${sessionId}`;
      const sock = activeConnections.get(key);
      if (!sock) return res.status(404).json({ error: 'Session not found' });
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      let result;
      if (type === 'text') result = await sock.sendMessage(jid, { text: message });
      else if (type === 'image') { const buf = Buffer.from(message.base64, 'base64'); result = await sock.sendMessage(jid, { image: buf, caption: message.caption || '' }); }
      else if (type === 'video') { const buf = Buffer.from(message.base64, 'base64'); result = await sock.sendMessage(jid, { video: buf, caption: message.caption || '' }); }
      emitLog(userId, 'success', `Message sent to ${to}`);
      await githubDB.addLog(req.user.username, 'WA_SEND', { to, type, sessionId });
      res.json({ success: true, messageId: result?.key?.id });
    } catch(err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/logs', authenticate, (req, res) => {
    const userId = req.user.id;
    const logs = liveLogs.get(userId) || [];
    res.json({ logs });
  });

  return router;
};

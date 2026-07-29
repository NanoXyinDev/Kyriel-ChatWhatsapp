require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

app.use('/api/auth', require('./api/routes/auth'));
app.use('/api/users', require('./api/routes/users'));
app.use('/api/chat', require('./api/routes/chat')(io));

const sessions = new Map();
const liveLogs = new Map();
const whatsappRouter = require('./api/routes/whatsapp')(io, sessions, liveLogs);
app.use('/api/whatsapp', whatsappRouter);

io.on('connection', (socket) => {
  socket.on('join-room', (uid) => socket.join(uid));
  socket.on('join-global', () => socket.join('global-chat'));
  socket.on('send-global', (data) => {
    io.to('global-chat').emit('new-global-message', {
      id: Date.now().toString(), username: data.username,
      message: data.message, timestamp: new Date().toISOString()
    });
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('KYRIEL on port', PORT));

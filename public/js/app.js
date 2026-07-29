const API_URL = (typeof CONFIG !== 'undefined' && CONFIG.API_URL) ? CONFIG.API_URL : '/api';
const SOCKET_URL = (typeof CONFIG !== 'undefined' && CONFIG.SOCKET_URL) ? CONFIG.SOCKET_URL : window.location.origin;

let socket = null;
let currentUser = null;
let currentSession = null;
let activeSessions = [];
let currentChat = null;
let messages = {};
let globalMessages = [];
let logs = [];
let selectedMethod = 'qr';

document.addEventListener('DOMContentLoaded', () => {
  initAuthTabs();
  checkAuth();
});

/* ===== AUTH ===== */
function initAuthTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
      const form = document.getElementById(btn.dataset.tab + '-form');
      if (form) form.classList.remove('hidden');
    });
  });
}

async function handleLogin() {
  const username = document.getElementById('login-username')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  if (!username || !password) return showToast('Isi semua field', 'error');
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success && data.user) {
      localStorage.setItem('kyriel_token', data.token);
      localStorage.setItem('kyriel_user', JSON.stringify(data.user));
      showToast('Login sukses', 'success');
      initApp(data.user);
    } else {
      showToast(data.error || 'Login gagal', 'error');
    }
  } catch (err) { showToast('Server error', 'error'); console.error(err); }
}

async function handleRegister() {
  const username = document.getElementById('reg-username')?.value?.trim();
  const email = document.getElementById('reg-email')?.value?.trim();
  const password = document.getElementById('reg-password')?.value;
  if (!username || !email || !password) return showToast('Isi semua field', 'error');
  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Register sukses! Silakan login.', 'success');
      document.querySelector('.tab-btn[data-tab="login"]')?.click();
    } else {
      showToast(data.error || 'Register gagal', 'error');
    }
  } catch (err) { showToast('Server error', 'error'); }
}

function checkAuth() {
  const token = localStorage.getItem('kyriel_token');
  const userStr = localStorage.getItem('kyriel_user');
  if (token && userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user && user.id) initApp(user);
    } catch(e) { localStorage.clear(); }
  }
}

function logout() {
  localStorage.removeItem('kyriel_token');
  localStorage.removeItem('kyriel_user');
  if (socket) { socket.disconnect(); socket = null; }
  location.reload();
}

/* ===== APP ===== */
function initApp(user) {
  if (!user || !user.id) { showToast('User data invalid', 'error'); return; }
  currentUser = user;
  document.getElementById('auth-screen')?.classList.remove('active');
  document.getElementById('app-screen')?.classList.add('active');

  const usernameEl = document.getElementById('sidebar-username');
  if (usernameEl) usernameEl.textContent = user.username || 'User';

  const roleEl = document.getElementById('user-role');
  if (roleEl) {
    roleEl.textContent = user.role || 'FREE';
    roleEl.setAttribute('data-role', user.role || 'FREE');
  }

  updatePlanCard(user);
  initSocket();
  loadSessions();
  loadGlobalMessages();
}

function updatePlanCard(user) {
  const limits = user?.limits || { sessions: 1, canViewOnce: false, canBroadcast: false, canExport: false };
  const max = limits.sessions === Infinity ? '∞' : (limits.sessions || 1);
  const card = document.getElementById('plan-card');
  if (!card) return;
  card.innerHTML = `
    <div class="plan-name">${user?.role || 'FREE'}</div>
    <div class="plan-limits">
      <div class="plan-limit ${max > 0 ? '' : 'off'}"><i class="fas fa-mobile-alt"></i><span>${max} Session${max !== 1 ? 's' : ''}</span></div>
      <div class="plan-limit ${limits.canViewOnce ? '' : 'off'}"><i class="fas fa-eye-slash"></i><span>View Once</span></div>
      <div class="plan-limit ${limits.canBroadcast ? '' : 'off'}"><i class="fas fa-broadcast-tower"></i><span>Broadcast</span></div>
      <div class="plan-limit ${limits.canExport ? '' : 'off'}"><i class="fas fa-file-export"></i><span>Export</span></div>
    </div>
  `;
}

/* ===== SOCKET ===== */
function initSocket() {
  try {
    socket = io(SOCKET_URL, { path: '/socket.io/', transports: ['websocket','polling'] });
    socket.on('connect', () => {
      if (currentUser?.id) {
        socket.emit('join-room', currentUser.id);
        socket.emit('join-global');
      }
      addLog('Connected', 'success');
    });
    socket.on('connect_error', (err) => { console.log('Socket error:', err.message); });
    socket.on('wa-qr', (data) => {
      if (data.method === 'qr') {
        const el = document.getElementById('qr-display');
        if (el) el.innerHTML = `<img src="${data.qr}" alt="QR">`;
      }
      addLog('QR received', 'info');
    });
    socket.on('wa-pairing-code', (data) => {
      const el = document.getElementById('pairing-code-display');
      if (el) el.innerHTML = data.code;
      addLog(`Pairing: ${data.code}`, 'info');
    });
    socket.on('wa-connected', (data) => {
      hideLoading(); closeConnectModal();
      showToast('WhatsApp connected!', 'success');
      addLog('Connected', 'success');
      loadSessions();
    });
    socket.on('wa-disconnected', () => { addLog('Disconnected', 'warning'); loadSessions(); });
    socket.on('wa-message', (data) => {
      const msg = data?.message;
      if (!msg) return;
      if (!messages[msg.from]) messages[msg.from] = [];
      messages[msg.from].push(msg);
      addLog(`New msg from ${msg.pushName || 'Unknown'}`, 'message');
      if (currentChat === msg.from) renderMessages(msg.from);
    });
    socket.on('live-log', (log) => { if (log?.message) addLog(log.message, log.type || 'info'); });
    socket.on('global-messages', (msgs) => { if (Array.isArray(msgs)) { globalMessages = msgs; renderGlobalMessages(); } });
    socket.on('new-global-message', (msg) => {
      if (!msg) return;
      globalMessages.push(msg);
      if (globalMessages.length > 500) globalMessages.shift();
      renderGlobalMessages();
    });
  } catch(err) { console.error('Socket init error:', err); }
}

/* ===== SESSIONS ===== */
async function loadSessions() {
  try {
    const token = localStorage.getItem('kyriel_token');
    const res = await fetch(`${API_URL}/whatsapp/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    activeSessions = data?.sessions || [];
    renderSessions();
  } catch(err) { console.error('loadSessions error:', err); }
}

function renderSessions() {
  const container = document.getElementById('sessions-list');
  if (!container) return;
  const limits = currentUser?.limits || { sessions: 1 };
  const max = limits.sessions === Infinity ? '∞' : (limits.sessions || 1);
  const countEl = document.getElementById('session-count');
  if (countEl) countEl.textContent = `${activeSessions.length}/${max}`;

  if (activeSessions.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-mobile-alt"></i><p>Belum ada session</p><button class="btn-ghost" onclick="openConnectModal()">+ Tambah Session</button></div>`;
    return;
  }

  container.innerHTML = activeSessions.map(s => `
    <div class="session-item ${currentSession === s.sessionId ? 'active' : ''}" onclick="selectSession('${s.sessionId}')">
      <div class="session-icon ${s.connected ? '' : 'offline'}"><i class="fab fa-whatsapp"></i></div>
      <div class="session-details">
        <div class="session-name">${s.user?.name || s.sessionId}</div>
        <div class="session-status ${s.connected ? 'online' : ''}">${s.connected ? 'online' : 'offline'}</div>
      </div>
      <div class="session-delete" onclick="event.stopPropagation(); disconnectSession('${s.sessionId}')"><i class="fas fa-trash"></i></div>
    </div>
  `).join('');
}

function selectSession(sessionId) {
  currentSession = sessionId;
  renderSessions();
  if (window.innerWidth <= 768) toggleSidebar();
}

async function disconnectSession(sessionId) {
  try {
    const token = localStorage.getItem('kyriel_token');
    await fetch(`${API_URL}/whatsapp/disconnect`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    showToast('Session disconnected', 'success');
    loadSessions();
  } catch(err) { showToast('Failed', 'error'); }
}

/* ===== SIDEBAR ===== */
function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('show');
}

/* ===== CONNECT ===== */
function openConnectModal() {
  const modal = document.getElementById('connect-modal');
  if (modal) modal.classList.remove('hidden');
  const qr = document.getElementById('qr-display');
  if (qr) qr.innerHTML = `<i class="fas fa-qrcode"></i><p>QR akan muncul</p>`;
  const pair = document.getElementById('pairing-code-display');
  if (pair) pair.innerHTML = '<span class="placeholder">Kode akan muncul</span>';
}

function closeConnectModal() {
  document.getElementById('connect-modal')?.classList.add('hidden');
}

function selectMethod(method) {
  selectedMethod = method;
  document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.method-btn[data-method="${method}"]`)?.classList.add('active');
  const qrSec = document.getElementById('qr-section');
  const pairSec = document.getElementById('pairing-section');
  if (method === 'qr') { qrSec?.classList.remove('hidden'); pairSec?.classList.add('hidden'); }
  else { qrSec?.classList.add('hidden'); pairSec?.classList.remove('hidden'); }
}

async function startConnection() {
  const token = localStorage.getItem('kyriel_token');
  const phone = document.getElementById('phone-number')?.value?.trim();
  if (selectedMethod === 'pairing' && !phone) return showToast('Masukin nomor HP', 'error');
  showLoading('Menghubungkan...');
  try {
    const res = await fetch(`${API_URL}/whatsapp/connect`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: selectedMethod, phoneNumber: phone })
    });
    const data = await res.json();
    if (data?.success) addLog('Connection started', 'info');
    else { hideLoading(); showToast(data?.error || 'Failed', 'error'); }
  } catch(err) { hideLoading(); showToast('Server error', 'error'); }
}

/* ===== CHAT ===== */
function openChat(jid, name) {
  currentChat = jid;
  document.getElementById('welcome-state')?.classList.add('hidden');
  document.getElementById('chat-area')?.classList.remove('hidden');
  const cn = document.getElementById('chat-contact-name');
  if (cn) cn.textContent = name || jid;
  renderMessages(jid);
}

function closeChat() {
  currentChat = null;
  document.getElementById('chat-area')?.classList.add('hidden');
  document.getElementById('welcome-state')?.classList.remove('hidden');
}

function renderMessages(jid) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const msgs = messages[jid] || [];
  container.innerHTML = msgs.map(m => {
    const isSent = m.fromMe;
    const time = m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '--:--';
    let content = '';
    if (m.type === 'text') content = `<div>${escapeHtml(m.text || '')}</div>`;
    else if (m.type === 'image') content = `<img src="${m.url || ''}" class="message-media" alt=""><div>${escapeHtml(m.caption || '')}</div>`;
    else content = `<div>[${m.type || 'unknown'}]</div>`;
    return `<div class="message ${isSent ? 'sent' : 'received'}">${content}<div class="message-time">${time}</div></div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input?.value?.trim();
  if (!text || !currentSession || !currentChat) return;
  try {
    const token = localStorage.getItem('kyriel_token');
    await fetch(`${API_URL}/whatsapp/send`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSession, to: currentChat, message: text, type: 'text' })
    });
    input.value = '';
    if (!messages[currentChat]) messages[currentChat] = [];
    messages[currentChat].push({ fromMe: true, text, timestamp: Math.floor(Date.now()/1000), type: 'text' });
    renderMessages(currentChat);
  } catch(err) { showToast('Gagal kirim', 'error'); }
}

function handleFileSelect(e) {
  const file = e.target?.files?.[0];
  if (file) showToast(`File: ${file.name}`, 'info');
}

/* ===== GLOBAL CHAT ===== */
function toggleGlobalChat() {
  const modal = document.getElementById('global-chat-modal');
  if (!modal) return;
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) { renderGlobalMessages(); loadGlobalMessages(); }
}

async function loadGlobalMessages() {
  try {
    const token = localStorage.getItem('kyriel_token');
    const res = await fetch(`${API_URL}/chat/global`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data?.messages) { globalMessages = data.messages; renderGlobalMessages(); }
  } catch(err) { console.error('loadGlobal error:', err); }
}

function renderGlobalMessages() {
  const container = document.getElementById('global-messages');
  if (!container) return;
  container.innerHTML = globalMessages.map(m => `
    <div class="global-msg">
      <div class="g-avatar">${(m.username || '?').charAt(0).toUpperCase()}</div>
      <div class="g-content">
        <div class="g-user">${escapeHtml(m.username || 'Unknown')}</div>
        <div class="g-text">${escapeHtml(m.message || '')}</div>
        <div class="g-time">${m.timestamp ? new Date(m.timestamp).toLocaleTimeString('id-ID') : '--:--'}</div>
      </div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendGlobalMessage() {
  const input = document.getElementById('global-message-input');
  const text = input?.value?.trim();
  if (!text) return;
  if (socket && socket.connected) {
    socket.emit('send-global', { username: currentUser?.username || 'User', message: text });
    input.value = '';
  } else {
    try {
      const token = localStorage.getItem('kyriel_token');
      const res = await fetch(`${API_URL}/chat/global`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      if (data?.success) { globalMessages.push(data.message); renderGlobalMessages(); input.value = ''; }
    } catch(err) { showToast('Gagal kirim', 'error'); }
  }
}

/* ===== LOGS ===== */
function toggleLogs() {
  document.getElementById('logs-modal')?.classList.toggle('hidden');
}

function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  logs.push({ time, type, message });
  if (logs.length > 200) logs.shift();
  const container = document.getElementById('logs-container');
  if (container) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-tag">[${type.toUpperCase()}]</span><span class="log-text">${escapeHtml(message)}</span>`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }
  const loadingLogs = document.getElementById('loading-logs');
  if (loadingLogs && document.getElementById('loading-overlay') && !document.getElementById('loading-overlay').classList.contains('hidden')) {
    const el = document.createElement('div');
    const colors = { error:'#ef4444', success:'#22c55e', warning:'#f59e0b', info:'#3b82f6', message:'#25d366' };
    el.style.cssText = `color:${colors[type] || '#3b82f6'};margin-bottom:2px;`;
    el.textContent = `[${time}] ${message}`;
    loadingLogs.appendChild(el);
    loadingLogs.scrollTop = loadingLogs.scrollHeight;
  }
}

/* ===== SPOTIFY ===== */
function toggleSpotify() {
  document.getElementById('spotify-modal')?.classList.toggle('hidden');
}

/* ===== VIEW ONCE ===== */
function openViewOnceModal() {
  if (!currentUser?.limits?.canViewOnce) return showToast('Butuh PRO+', 'error');
  document.getElementById('viewonce-modal')?.classList.remove('hidden');
}

function closeViewOnceModal() {
  document.getElementById('viewonce-modal')?.classList.add('hidden');
}

function previewViewOnce(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  const preview = document.getElementById('viewonce-preview');
  if (!preview) return;
  const url = URL.createObjectURL(file);
  if (file.type?.startsWith('image/')) preview.innerHTML = `<img src="${url}" alt="">`;
  else if (file.type?.startsWith('video/')) preview.innerHTML = `<video src="${url}" controls></video>`;
}

function sendViewOnce() {
  showToast('View once sent!', 'success');
  closeViewOnceModal();
}

/* ===== POPUP ===== */
function togglePopup() {
  if (window.opener || window.name === 'kyriel-popup') { window.close(); return; }
  const popup = window.open(window.location.href, 'kyriel-popup', 'width=420,height=650,resizable=yes,scrollbars=yes');
  if (popup) showToast('Popup mode', 'success');
  else showToast('Allow popups', 'warning');
}

if (window.opener || window.name === 'kyriel-popup') document.body?.classList.add('popup-mode');

/* ===== LOADING ===== */
function showLoading(text) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text || 'Loading...';
  document.getElementById('loading-overlay')?.classList.remove('hidden');
  const logs = document.getElementById('loading-logs');
  if (logs) logs.innerHTML = '';
}

function hideLoading() {
  document.getElementById('loading-overlay')?.classList.add('hidden');
}

/* ===== TOAST ===== */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success:'fa-check-circle', error:'fa-times-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' };
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(20px)'; setTimeout(() => toast.remove(), 300); }, 4000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
});

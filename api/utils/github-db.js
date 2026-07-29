require('dotenv').config();
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'NanoXyinDev';
const REPO_NAME = 'Kyriel-ChatWhatsapp';
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

class GitHubDB {
  constructor() {
    this.headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  async getFile(path) {
    try {
      const res = await axios.get(`${API_BASE}/${path}`, { headers: this.headers, timeout: 15000 });
      return { data: JSON.parse(Buffer.from(res.data.content, 'base64').toString()), sha: res.data.sha };
    } catch (err) {
      if (err.response?.status === 404) return { data: null, sha: null };
      throw err;
    }
  }

  async putFile(path, content, msg, sha) {
    const payload = { message: msg, content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64') };
    if (sha) payload.sha = sha;
    const res = await axios.put(`${API_BASE}/${path}`, payload, { headers: this.headers, timeout: 15000 });
    return res.data;
  }

  async getUsers() {
    const { data } = await this.getFile('users.json');
    return data || [];
  }

  async saveUsers(users) {
    const { sha } = await this.getFile('users.json');
    return await this.putFile('users.json', users, 'Update users', sha);
  }

  async getLogs() {
    const { data } = await this.getFile('logs.json');
    return data || [];
  }

  async saveLogs(logs) {
    const { sha } = await this.getFile('logs.json');
    return await this.putFile('logs.json', logs, 'Update logs', sha);
  }

  async getUserLogs(username) {
    const { data } = await this.getFile(`LOGSSYSTEM/${username}/logs.json`);
    return data || [];
  }

  async saveUserLogs(username, logs) {
    let sha = null;
    try { const e = await this.getFile(`LOGSSYSTEM/${username}/logs.json`); sha = e.sha; } catch(e){}
    return await this.putFile(`LOGSSYSTEM/${username}/logs.json`, logs, `Update logs for ${username}`, sha);
  }

  async addLog(username, action, details = {}) {
    const entry = { id: Date.now().toString(), username, action, details, timestamp: new Date().toISOString(), ip: details.ip || null };
    try {
      const gl = await this.getLogs(); gl.push(entry); if (gl.length > 1000) gl.shift(); await this.saveLogs(gl);
      const ul = await this.getUserLogs(username); ul.push(entry); if (ul.length > 500) ul.shift(); await this.saveUserLogs(username, ul);
    } catch(e) { console.error('addLog error:', e.message); }
    return entry;
  }
}

module.exports = new GitHubDB();

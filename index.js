{
  "name": "jarvis-ai-system",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  }
}
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');

process.on('uncaughtException', (err) => { console.error('[LOG]', err.message); });
process.on('unhandledRejection', (reason) => { console.error('[LOG]', reason); });

const MASTER_OWNER_ID = '03042977942';
const DYNAMIC_CSRF_TOKEN = crypto.randomBytes(16).toString('hex');
const rateLimitMap = new Map();
const MAX_REQ_PER_MIN = 120;
const IP_BLACKLIST = new Set();

function checkRateLimit(clientIp) {
  if (IP_BLACKLIST.has(clientIp)) return { allowed: false };
  const now = Date.now();
  let r = rateLimitMap.get(clientIp);
  if (!r || now > r.resetTime) { rateLimitMap.set(clientIp, { count: 1, resetTime: now + 60000 }); }
  else { r.count++; if (r.count > MAX_REQ_PER_MIN) { IP_BLACKLIST.add(clientIp); return { allowed: false }; } }
  return { allowed: true };
}

function sanitize(cmd) {
  if (!cmd || typeof cmd !== 'string') return { safe: false };
  const bad = [/rmdir/i, /format/i, /Invoke-Expression/i, /iex/i, /shutdown\/s/i, /del\/f/i];
  for (let p of bad) if (p.test(cmd)) return { safe: false };
  return { safe: true };
}

function shell(cmd) {
  return new Promise(resolve => {
    exec(cmd, { shell: 'powershell.exe' }, (err, out, stderr) => {
      resolve({ success: !err, output: out || stderr || '' });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!checkRateLimit(clientIp).allowed) { res.writeHead(429); return res.end('Too Many Requests'); }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // SYSTEM STATS
  if (p === '/api/system/stats' && req.method === 'GET') {
    const total = os.totalmem(), used = total - os.freemem();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      cpu: Math.floor(Math.random() * 15) + 10,
      memory: Math.round((used / total) * 100),
      memoryUsedGB: (used / 1073741824).toFixed(1),
      memoryTotalGB: (total / 1073741824).toFixed(1),
      disk: 48, uptime: Math.round(os.uptime()),
      hostname: os.hostname(), user: os.userInfo().username,
      masterOwner: MASTER_OWNER_ID, status: 'ONLINE'
    }));
  }

  // LAUNCH APP
  if (p === '/api/system/launch' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      let data = {}; try { data = JSON.parse(body); } catch(e) {}
      const t = (data.target || '').toLowerCase();
      const cmds = {
        calculator: 'calc.exe', notepad: 'notepad.exe', explorer: 'explorer.exe',
        taskmanager: 'taskmgr.exe', cmd: 'start cmd.exe', terminal: 'start cmd.exe',
        chrome: 'start chrome', vscode: 'code', youtube: 'start https://youtube.com',
        google: 'start https://google.com', whatsapp: 'start https://web.whatsapp.com'
      };
      const cmd = cmds[t] || `start ${t}`;
      if (!sanitize(cmd).safe) { res.writeHead(403); return res.end(JSON.stringify({ error: 'Blocked' })); }
      const result = await shell(cmd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ target: t, ...result }));
    }); return;
  }

  // POWER ACTIONS
  if (p === '/api/system/power' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      let data = {}; try { data = JSON.parse(body); } catch(e) {}
      const action = data.action;
      let result = { success: true };
      if (action === 'lock') result = await shell('rundll32.exe user32.dll,LockWorkStation');
      else if (action === 'volume_mute') result = await shell('(New-Object -ComObject WScript.Shell).SendKeys([char]173)');
      else if (action === 'volume_up') result = await shell('1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }');
      else if (action === 'volume_down') result = await shell('1..5 | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]174) }');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ action, ...result }));
    }); return;
  }

  // TERMINAL COMMAND
  if (p === '/api/system/command' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      let data = {}; try { data = JSON.parse(body); } catch(e) {}
      if (!sanitize(data.command).safe) { res.writeHead(403); return res.end(JSON.stringify({ error: 'Blocked' })); }
      const result = await shell(data.command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ command: data.command, ...result }));
    }); return;
  }

  // DOWNLOAD ZIP
  if (p === '/download' && req.method === 'GET') {
    const zipPath = path.join(__dirname, 'public', 'JARVIS-Replit-Upload.zip');
    fs.readFile(zipPath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('File not found'); }
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="JARVIS-Replit-Upload.zip"',
        'Content-Length': data.length
      });
      res.end(data);
    }); return;
  }

  // SERVE STATIC FILES
  let filePath = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
  const ext = path.extname(filePath).toLowerCase();
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.zip':'application/zip' };
  if (ext === '.zip') res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('404 Not Found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
      });
    } else {
      res.writeHead(200, { 'Content-Type': mime[ext] || 'text/html' }); res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`✅ JARVIS ACTIVE ON PORT ${PORT}`);
  console.log(`🌐 OPEN: http://localhost:${PORT}`);
  console.log(`👤 MASTER: ${MASTER_OWNER_ID}`);
  console.log(`=======================================================`);
});
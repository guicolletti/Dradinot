#!/usr/bin/env node
// ============================================================
//  Servidor online do Couraçado — sem dependências.
//  Serve os arquivos do jogo por HTTP e roda a simulação,
//  falando com os navegadores por WebSocket (/ws).
//
//  Uso:  node server/server.js
//  Variáveis: PORT (padrão 8080), CHEATS=1 libera /cheats,
//             DATA_FILE (padrão server/data/ships.json)
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'ships.json');

// ---------- carrega a simulação compartilhada (mesmos arquivos do navegador) ----------
const SHARED = ['util', 'data', 'ship', 'player', 'ai', 'world', 'actions', 'universe'];
for (const f of SHARED) {
  const file = path.join(ROOT, 'js', f + '.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

// ---------- persistência em arquivo ----------
let saveTimer = null;
const storage = {
  load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return {}; }
  },
  save(records) {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(records));
        fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
      } catch (e) { console.error('Erro ao salvar:', e.message); }
    }, 1500);
  },
};

// eslint-disable-next-line no-undef
const uni = new Universe({ storage, offline: false, cheats: process.env.CHEATS === '1' });

// ---------- HTTP (arquivos estáticos) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, players: uni.sessions.size, ships: uni.active.size }));
    return;
  }
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT) || file.includes(path.join(ROOT, 'server'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSocket mínimo (RFC 6455) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsSend(sock, str) {
  if (sock.destroyed) return;
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  sock.write(Buffer.concat([header, payload]));
}

function wsControl(sock, opcode, data = Buffer.alloc(0)) {
  if (sock.destroyed) return;
  sock.write(Buffer.concat([Buffer.from([0x80 | opcode, data.length]), data]));
}

server.on('upgrade', (req, sock) => {
  if ((req.url || '').split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);

  const sess = uni.connect((msg) => wsSend(sock, JSON.stringify(msg)));
  let buf = Buffer.alloc(0);
  let frag = [];
  let alive = true;
  let msgCount = 0, msgWindow = Date.now();

  const close = () => {
    if (!alive) return;
    alive = false;
    uni.disconnect(sess);
    sock.destroy();
  };

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 2 * 1024 * 1024) { close(); return; }
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1024 * 1024) { close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        data = Buffer.from(data);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      }
      buf = buf.subarray(need);
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { wsControl(sock, 0xA, data); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        frag.push(data);
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8');
        frag = [];
        // limite simples contra spam
        const now = Date.now();
        if (now - msgWindow > 1000) { msgWindow = now; msgCount = 0; }
        if (++msgCount > 200) continue;
        let m;
        try { m = JSON.parse(text); } catch (e) { continue; }
        try { uni.receive(sess, m); } catch (e) { console.error('Erro ao processar mensagem:', e); }
      }
    }
  });
  sock.on('close', close);
  sock.on('error', close);
  sock.on('end', close);
});

// ---------- laço da simulação ----------
const STEP = 1 / 60;
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  if (acc > 0.25) acc = 0.25;
  while (acc >= STEP) {
    try { uni.tick(STEP); } catch (e) { console.error('Erro na simulação:', e); }
    acc -= STEP;
  }
}, 1000 / 60);

const shutdown = () => {
  console.log('\nSalvando naves...');
  uni.saveAll();
  if (saveTimer) clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(uni.records));
  } catch (e) { console.error(e.message); }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Couraçado online rodando em http://localhost:${PORT}`);
  console.log(`Amigos na mesma rede: http://SEU-IP:${PORT}`);
});

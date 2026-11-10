// ============================================================
//  Rede do cliente: transporte local (offline, o universo roda
//  dentro do navegador) e WebSocket (online).
// ============================================================
'use strict';

function getToken() {
  try {
    let t = localStorage.getItem('couracado_token');
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('couracado_token', t); }
    return t;
  } catch (e) { return 'tok' + Math.random().toString(36).slice(2); }
}

// Armazenamento offline (localStorage), com migração do save antigo
const LocalStore = {
  KEY: 'couracado_mp_v2',
  timer: null,
  load() {
    let recs = {};
    try { recs = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { recs = {}; }
    try {
      const old = localStorage.getItem('couracado_save_v1');
      if (old) {
        const d = JSON.parse(old);
        const key = 'SALVO1';
        if (!recs[key] && d && d.ship) {
          const tok = getToken();
          recs[key] = { owner: tok, name: d.ship.name || 'Minha Nave', public: false, data: d.ship, members: {}, created: Date.now() };
          recs[key].members[tok] = { name: d.player.name, inv: d.player.inv, equip: d.player.equip };
        }
        localStorage.removeItem('couracado_save_v1');
        localStorage.setItem(this.KEY, JSON.stringify(recs));
      }
    } catch (e) { /* ignore */ }
    return recs;
  },
  save(recs) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { localStorage.setItem(this.KEY, JSON.stringify(recs)); } catch (e) { console.warn('Falha ao salvar', e); }
    }, 800);
  },
};

class LocalTransport {
  constructor(onMsg) {
    this.onMsg = onMsg;
    this.inbox = [];
    this.uni = new Universe({ storage: LocalStore, offline: true, cheats: true });
    this.sess = this.uni.connect((m) => this.inbox.push(JSON.stringify(m)));
    this.acc = 0;
    this.kind = 'offline';
    setTimeout(() => this.onOpen && this.onOpen(), 0);
  }
  send(m) { this.uni.receive(this.sess, JSON.parse(JSON.stringify(m))); }
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= 1 / 60 && n < 6) { this.uni.tick(1 / 60); this.acc -= 1 / 60; n++; }
    const box = this.inbox; this.inbox = [];
    for (const s of box) this.onMsg(JSON.parse(s));
  }
  close() {
    try { this.uni.saveAll(); } catch (e) { /* ignore */ }
    this.uni.disconnect(this.sess);
  }
}

function wsURL(addr) {
  addr = (addr || '').trim();
  if (!addr) return null;
  if (/^wss?:\/\//.test(addr)) return addr.replace(/\/+$/, '') + (addr.endsWith('/ws') ? '' : '/ws');
  let secure = location.protocol === 'https:';
  if (/^https:\/\//.test(addr)) secure = true;
  if (/^http:\/\//.test(addr)) secure = false;
  addr = addr.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (/^(localhost|127\.|192\.168\.|10\.|172\.)/.test(addr)) secure = false;
  return (secure ? 'wss://' : 'ws://') + addr + '/ws';
}

class WSTransport {
  constructor(url, onMsg) {
    this.onMsg = onMsg;
    this.kind = 'online';
    this.queue = [];
    this.open = false;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.open = true;
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
      if (this.onOpen) this.onOpen();
    };
    this.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } this.onMsg(m); };
    this.ws.onclose = () => { this.open = false; if (this.onClose) this.onClose(); };
    this.ws.onerror = () => { if (this.onError) this.onError(); };
  }
  send(m) {
    const s = JSON.stringify(m);
    if (this.open) this.ws.send(s); else this.queue.push(s);
  }
  update() {}
  close() { this.onClose = null; try { this.ws.close(); } catch (e) { /* ignore */ } }
}

// ============================================================
//  Universo: todas as zonas, naves, tripulações e conexões.
//  Roda no servidor Node (online) ou dentro do navegador
//  (offline). Fala com os clientes só por mensagens.
// ============================================================
'use strict';

const SNAP_EVERY = 3;   // 60 Hz / 3 = 20 snapshots por segundo
const r1 = (v) => Math.round(v * 10) / 10;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

class Universe {
  // storage: { load() -> registros, save(registros) }
  constructor(opts = {}) {
    this.storage = opts.storage || { load: () => ({}), save: () => {} };
    this.offline = !!opts.offline;
    this.cheats = !!opts.cheats;
    this.worlds = {};
    this.sessions = new Map();
    this.records = this.storage.load() || {};
    this.active = new Map();      // key -> Ship
    this.tickN = 0;
    this.saveT = 10;
    this.nextSid = 1;
    this.dirty = false;
  }

  world(zoneId) {
    if (!this.worlds[zoneId]) this.worlds[zoneId] = new World(zoneId, this, { headless: true });
    return this.worlds[zoneId];
  }

  // ---------- conexões ----------
  connect(send) {
    const s = new Session(this, send, this.nextSid++);
    this.sessions.set(s.id, s);
    return s;
  }

  disconnect(sess) {
    if (sess.ship) this.leaveShip(sess);
    this.sessions.delete(sess.id);
  }

  receive(sess, m) {
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello':
        sess.name = String(m.name || 'Tripulante').slice(0, 16) || 'Tripulante';
        sess.token = String(m.token || '').slice(0, 40) || ('anon' + sess.id);
        this.sendMenu(sess);
        return;
      case 'menu': this.sendMenu(sess); return;
      case 'create': if (!sess.ship) this.createShip(sess); return;
      case 'join': if (!sess.ship) this.joinByKey(sess, String(m.key || '').toUpperCase().trim()); return;
      case 'leave': if (sess.ship) { this.leaveShip(sess); this.sendMenu(sess); } return;
      case 'ping': sess.send({ t: 'pong', id: m.id }); return;
    }
    sess.handle(m);
  }

  sendMenu(sess) {
    const list = [];
    for (const [key, r] of Object.entries(this.records)) {
      const mine = r.owner === sess.token;
      const ship = this.active.get(key);
      if (!mine && !(r.public && ship)) continue;
      if (r.banned && r.banned.includes(sess.token)) continue;
      list.push({
        key, name: ship ? ship.name : r.name, mine, public: !!r.public,
        zone: ship && ship.world ? ship.world.zone.name : 'Guardada no Porto Livre',
        crew: ship ? ship.crew.length : 0, size: r.data ? `${r.data.w}×${r.data.h}` : '',
      });
    }
    list.sort((a, b) => (b.mine - a.mine) || (b.crew - a.crew));
    sess.send({ t: 'menu', ships: list, online: this.sessions.size, offline: this.offline });
  }

  // ---------- naves ----------
  createShip(sess) {
    let key = makeCode();
    while (this.records[key]) key = makeCode();
    const ship = USE_TEST_SHIP ? buildTestShip() : buildStarterShip();
    ship.key = key;
    ship.name = `Nave de ${sess.name}`;
    this.records[key] = { owner: sess.token, ownerName: sess.name, name: ship.name, public: false, data: null, members: {}, created: Date.now() };
    this.records[key].members[sess.token] = {
      name: sess.name, equip: { feet: null, back: null },
      inv: (() => { const inv = new Array(10).fill(null); invAdd(inv, 'wrench', 1); invAdd(inv, 'ammo_standard', 8); invAdd(inv, 'block', 16); invAdd(inv, 'walkway', 8); invAdd(inv, 'booster', 2); return inv; })(),
    };
    this.spawnShip(ship, 'freeport');
    this.saveShip(ship);
    this.joinShip(sess, ship);
    sess.notify(`Nave criada! Código de convite: ${key} (use /convite para ver de novo, /publica para listar).`, '#ffd84a');
  }

  joinByKey(sess, key) {
    const rec = this.records[key];
    if (!rec) { sess.send({ t: 'err', m: 'Nave não encontrada. Confira o código.' }); return; }
    if (rec.banned && rec.banned.includes(sess.token)) { sess.send({ t: 'err', m: 'Você foi expulso dessa nave.' }); return; }
    let ship = this.active.get(key);
    if (!ship) {
      if (!rec.data) { sess.send({ t: 'err', m: 'Essa nave não tem dados salvos.' }); return; }
      ship = Ship.deserialize(rec.data);
      ship.key = key;
      this.spawnShip(ship, 'freeport');
    }
    if (ship.crew.length >= 12) { sess.send({ t: 'err', m: 'A nave está lotada.' }); return; }
    this.joinShip(sess, ship);
  }

  spawnShip(ship, zoneId) {
    ship.team = 'player';
    const w = this.world(zoneId);
    w.placeShipAtOpenSpot(ship);
    this.active.set(ship.key, ship);
    ship.derelictT = null;
  }

  joinShip(sess, ship) {
    const rec = this.records[ship.key];
    const p = new Player(ship);
    p.name = sess.name;
    const mem = rec.members[sess.token];
    if (mem) {
      p.inv = (mem.inv || []).slice(0, 10).concat(new Array(10).fill(null)).slice(0, 10);
      p.equip = mem.equip || { feet: null, back: null };
    }
    sess.player = p; sess.ship = ship;
    sess.sent.clear(); sess.zoneSent = null; sess.ui = null; sess.wrench = null;
    sess.lastInv = ''; sess.lastEq = '';
    ship.crew.push(sess);
    ship.derelictT = null;
    const captain = rec.owner === sess.token;
    sess.send({ t: 'joined', pid: p.id, sid: ship.id, key: ship.key, captain, name: ship.name });
    this.shipMsg(ship, `${sess.name} entrou na nave.`, '#9fe0ff', sess);
    if (!captain && ship.crew.length === 1) sess.notify(`Você entrou em "${ship.name}".`, '#9fe0ff');
  }

  leaveShip(sess, silent = false) {
    const ship = sess.ship;
    if (!ship) return;
    sess.exitControl();
    const rec = this.records[ship.key];
    if (rec && sess.player) {
      rec.members[sess.token] = { name: sess.name, inv: sess.player.inv, equip: sess.player.equip };
      this.dirty = true;
    }
    ship.crew = ship.crew.filter((c) => c !== sess);
    if (!silent) this.shipMsg(ship, `${sess.name} saiu da nave.`, '#9fb0c2');
    sess.ship = null; sess.player = null; sess.ui = null;
    if (!ship.crew.length && !ship.dead) {
      // nave abandonada: some depois de um tempo (é salva ao sumir)
      ship.derelictT = this.offline ? 0.1 : (ship.world && ship.world.zone.safe ? 30 : 300);
      ship.thrust.x = 0; ship.thrust.y = 0;
    }
  }

  despawnShip(ship) {
    this.saveShip(ship, true);
    if (ship.world) ship.world.removeShip(ship);
    this.active.delete(ship.key);
  }

  // salva o estado atual da nave e dos tripulantes
  saveShip(ship) {
    const rec = this.records[ship.key];
    if (!rec || ship.dead) return;
    rec.data = ship.serialize();
    rec.name = ship.name;
    for (const c of ship.crew) if (c.player) rec.members[c.token] = { name: c.name, inv: c.player.inv, equip: c.player.equip };
    rec.saved = Date.now();
    this.persist();
  }

  persist() { this.dirty = true; }

  moveShip(ship, zoneId) {
    const old = ship.world;
    if (old) old.removeShip(ship);
    const w = this.world(zoneId);
    w.placeShipAtOpenSpot(ship);
    for (const c of ship.crew) { c.sent.clear(); c.zoneSent = null; c.sfxMe('portal'); }
    const z = w.zone;
    this.shipMsg(ship, `Entrando em ${z.name}. ${z.desc}`, z.safe ? '#9fe0ff' : z.pvp ? '#ff9a7a' : '#d0ffa0');
    if (z.safe) this.saveShip(ship);
  }

  // ---------- ganchos chamados pelo World ----------
  shipMsg(ship, m, c = '#fff', except = null) { for (const s of ship.crew) if (s !== except) s.notify(m, c); }
  zoneMsg(world, m, c = '#fff') { for (const s of this.sessions.values()) if (s.world === world) s.notify(m, c); }
  onObjectDestroyed(ship, o) { for (const s of ship.crew) if (s.player && s.player.ctrl === o) s.exitControl(); }
  onShipDestroyed(ship) {
    const stats = { bots: ship.stats.bots, ships: ship.stats.ships, name: ship.name };
    for (const s of ship.crew.slice()) {
      s.send({ t: 'dead', stats });
      s.ship = null; s.player = null; s.ui = null;
    }
    ship.crew = [];
    this.active.delete(ship.key);
    delete this.records[ship.key];
    this.persist();
  }

  // ---------- laço ----------
  tick(dt) {
    this.tickN++;
    for (const [id, w] of Object.entries(this.worlds)) {
      const hasPlayers = w.ships.some((s) => s.team === 'player');
      if (!hasPlayers) {
        w.idleT = (w.idleT || 0) + dt;
        if (w.idleT > 120 && id !== 'freeport') { delete this.worlds[id]; continue; }
        if (w.idleT > 3) continue; // zona vazia fica congelada
      } else w.idleT = 0;
      w.update(dt);
    }
    for (const s of this.sessions.values()) s.tick(dt);
    for (const ship of [...this.active.values()]) {
      if (ship.derelictT !== null && ship.derelictT !== undefined && !ship.crew.length) {
        ship.derelictT -= dt;
        if (ship.derelictT <= 0) this.despawnShip(ship);
      }
    }
    // salvamento periódico das naves no Porto Livre
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 10;
      for (const ship of this.active.values()) if (ship.world && ship.world.zone.safe && ship.crew.length) this.saveShip(ship);
    }
    if (this.dirty) { this.dirty = false; this.storage.save(this.records); }
    if (this.tickN % SNAP_EVERY === 0) this.broadcast();
  }

  saveAll() {
    for (const ship of this.active.values()) if (ship.world && ship.world.zone.safe) this.saveShip(ship);
    for (const sess of this.sessions.values()) if (sess.ship && sess.player) {
      const rec = this.records[sess.ship.key];
      if (rec) rec.members[sess.token] = { name: sess.name, inv: sess.player.inv, equip: sess.player.equip };
    }
    this.storage.save(this.records);
  }

  // ---------- snapshots ----------
  broadcast() {
    const byWorld = new Map();
    for (const s of this.sessions.values()) {
      const w = s.world;
      if (!w) continue;
      if (!byWorld.has(w)) byWorld.set(w, []);
      byWorld.get(w).push(s);
    }
    for (const w of Object.values(this.worlds)) {
      const list = byWorld.get(w);
      if (!list) { w.fx.length = 0; w.dirtyTiles.clear(); continue; }
      const base = this.worldSnap(w);
      for (const s of list) this.sendSnap(s, w, base);
      w.fx.length = 0; w.dirtyTiles.clear();
    }
  }

  worldSnap(w) {
    const ships = w.ships.map((s) => this.shipDyn(s));
    const objs = new Map();
    for (const s of w.ships) if (s.team === 'player') objs.set(s.id, JSON.stringify(s.objects.map((o) => this.objNet(o))));
    const tc = [];
    for (const i of w.dirtyTiles) tc.push([i, w.terrain[i], Math.round(w.thp[i])]);
    return {
      ships, objs, tc,
      bo: w.bots.map((b) => [b.id, b.type, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), r1(b.angle), Math.round(b.hp), b.maxHp, r1(b.flash), r1(b.rot)]),
      bu: w.bullets.map((b) => [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.ammo, b.r]),
      cr: w.crates.map((c) => [c.id, r1(c.x), r1(c.y), r1(c.vx), r1(c.vy), r1(c.rot), c.items[0][0], c.items.some(([i]) => RARE_ITEMS.has(i)) ? 1 : 0]),
      fx: w.fx.slice(),
    };
  }

  objNet(o) {
    const c = {};
    for (const k in o) if (k !== 'cool' && k !== 'lt' && k !== 'cart') c[k] = o[k];   // cronômetros e carrinho não vão aqui
    return c;
  }

  shipDyn(s) {
    const dyn = [s.id, r1(s.x), r1(s.y), r1(s.vx), r1(s.vy), Math.round(s.shield), Math.round(s.integrity), s.maxShield, s.maxIntegrity,
      r1(s.hitFlash), r1(s.thrust.x), s.turrets.map((t) => [r1(t.angle), t.ammo, t.ammoType || '', r1(t.recoil || 0)]), s.rev];
    if (s.team === 'player') {
      dyn.push(s.items.map((it) => [it.id, it.item, it.n, r1(it.x), r1(it.y), r1(it.rot)]));
      dyn.push(s.crew.filter((c) => c.player).map((c) => {
        const p = c.player;
        return [p.id, c.name, r1(p.x), r1(p.y), p.facing, p.onGround ? 1 : 0, r1(p.walkAnim || 0), p.mode, p.held ? p.held.item : '', p.equip.feet || '', p.equip.back || '', p.jetting ? 1 : 0, r1(c.aim || 0)];
      }));
      dyn.push(s.cargoQueue.reduce((a, [, n]) => a + n, 0));
      dyn.push(s.key);
      // carrinhos de munição: [caixa, x, y, item, quantidade, sentido]
      dyn.push(s.objects.filter((o) => o.cart).map((o) => [o.id, r1(o.cart.px), r1(o.cart.py), o.cart.item, o.cart.n, o.cart.dir || 1]));
    }
    return dyn;
  }

  sendSnap(sess, w, base) {
    if (sess.zoneSent !== w) {
      sess.send({ t: 'zone', ...w.netTerrain() });
      sess.zoneSent = w;
      sess.sent.clear();
    }
    const st = [], ob = [];
    for (const s of w.ships) {
      let k = sess.sent.get(s.id);
      if (!k) { k = { rev: -1, objs: '' }; sess.sent.set(s.id, k); }
      if (k.rev !== s.rev) { st.push(s.netStruct()); k.rev = s.rev; }
      const oj = base.objs.get(s.id);
      if (oj !== undefined && oj !== k.objs) { ob.push([s.id, JSON.parse(oj)]); k.objs = oj; }
    }
    // remove naves que sumiram
    for (const id of sess.sent.keys()) if (!w.ships.some((s) => s.id === id)) sess.sent.delete(id);
    const p = sess.player;
    const me = {
      mode: p.mode, tp: p.tp, x: r1(p.x), y: r1(p.y), sel: p.sel, rax: sess.resizeAxis,
      ctrl: p.ctrl ? (p.mode === 'turret' ? { k: 't', i: sess.ship.turrets.indexOf(p.ctrl) } : { k: 'o', id: p.ctrl.id }) : null,
      wr: sess.wrench && sess.wrench.t > 0 ? [r1(sess.wrench.lx), r1(sess.wrench.ly), r1(sess.wrench.t), sess.wrench.need] : null,
      cap: this.records[sess.ship.key] ? this.records[sess.ship.key].owner === sess.token : false,
      pub: this.records[sess.ship.key] ? !!this.records[sess.ship.key].public : false,
    };
    const inv = JSON.stringify(p.inv);
    if (inv !== sess.lastInv) { me.inv = p.inv; sess.lastInv = inv; }
    const eq = JSON.stringify(p.equip);
    if (eq !== sess.lastEq) { me.eq = p.equip; sess.lastEq = eq; }
    sess.send({
      t: 's', tm: r1(w.time), sh: base.ships, st, ob, bo: base.bo, bu: base.bu, cr: base.cr, fx: base.fx, tc: base.tc, me,
    });
  }
}

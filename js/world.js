// ============================================================
//  Mundo (zona): terreno destrutível, portais, naves, bots,
//  projéteis, caixas de saque e efeitos.
//
//  O mesmo código roda no servidor (headless: efeitos viram
//  eventos enviados aos clientes) e no cliente (espelho: só
//  desenha e toca os efeitos recebidos).
//
//  "host" é quem controla o mundo (Universe). Métodos usados:
//   host.shipMsg(ship, texto, cor)   mensagem para a tripulação
//   host.zoneMsg(world, texto, cor)  mensagem para a zona
//   host.onShipDestroyed(ship)
//   host.onObjectDestroyed(ship, obj)
//   host.sfx(nome, x, y) / host.shake(a, x, y)  (cliente)
// ============================================================
'use strict';

const W = { EMPTY: 0, ROCK: 1, FLUX: 2, DIAMOND: 3, WALL: 4 };
const W_HP = { 1: 60, 2: 90, 3: 160, 4: Infinity };

class World {
  constructor(zoneId, host, opts = {}) {
    this.host = host;
    this.zoneId = zoneId;
    this.zone = ZONES[zoneId];
    this.headless = !!opts.headless;
    this.mirror = !!opts.mirror;
    this.ships = [];
    this.bots = [];
    this.bullets = [];
    this.crates = [];
    this.particles = [];
    this.portals = [];
    this.fx = [];               // eventos de efeito (servidor -> clientes)
    this.dirtyTiles = new Set(); // tiles de terreno alterados (servidor -> clientes)
    this.time = 0;
    this.botTimer = 0;
    this.shipTimer = 10;
    if (opts.mirror) this.loadMirror(opts.mirror);
    else {
      this.n = this.zone.size;
      this.size = this.n * WTS;
      this.generate();
    }
  }

  // ---------- terreno ----------
  generate() {
    const n = this.n, z = this.zone;
    this.terrain = new Uint8Array(n * n);
    this.thp = new Float32Array(n * n);
    const seed = (Math.random() * 1e9) | 0;
    const noise = makeNoise(seed);
    const noise2 = makeNoise(seed + 77);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let t = W.EMPTY;
        if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) t = W.WALL;
        else if (z.density > 0) {
          const v = noise(x * 0.11, y * 0.11, 4);
          const thr = 0.62 - z.density * 0.28;
          if (v > thr + 0.08) t = W.ROCK;
          else if (v > thr && noise2(x * 0.3, y * 0.3, 2) > 0.45) t = W.ROCK;
          if (t === W.ROCK) {
            const r = Math.random();
            if (r < z.diamond) t = W.DIAMOND;
            else if (r < z.diamond + z.flux) t = W.FLUX;
          }
        }
        this.setW(x, y, t);
      }
    if (this.zoneId === 'freeport') this.buildFreeport();
    for (const target of z.portals) {
      const p = this.findOpenSpot(260, 260, 400);
      this.clearArea(p.x - 160, p.y - 160, 320, 320);
      this.portals.push({ x: p.x + 130, y: p.y + 130, r: 90, target, phase: Math.random() * 6 });
    }
    this.dirtyTiles.clear();
  }

  // dados para o cliente montar o espelho
  netTerrain() {
    let ter = '';
    for (let i = 0; i < this.terrain.length; i++) ter += this.terrain[i];
    const hp = [];
    for (let i = 0; i < this.terrain.length; i++) {
      const t = this.terrain[i];
      if (t && t !== W.WALL && this.thp[i] < W_HP[t]) hp.push([i, Math.round(this.thp[i])]);
    }
    return { id: this.zoneId, n: this.n, ter, hp, portals: this.portals.map((p) => ({ x: p.x, y: p.y, r: p.r, target: p.target })) };
  }

  loadMirror(d) {
    this.n = d.n; this.size = d.n * WTS;
    this.terrain = new Uint8Array(d.n * d.n);
    this.thp = new Float32Array(d.n * d.n);
    for (let i = 0; i < d.ter.length; i++) { const t = d.ter.charCodeAt(i) - 48; this.terrain[i] = t; this.thp[i] = W_HP[t] || 0; }
    for (const [i, hp] of d.hp) this.thp[i] = hp;
    this.portals = d.portals.map((p) => Object.assign({ phase: Math.random() * 6 }, p));
  }

  applyTileChanges(list) {
    for (const [i, t, hp] of list) {
      const was = this.terrain[i];
      this.terrain[i] = t; this.thp[i] = t ? hp : 0;
      if (was && !t && this.host && this.host.onTerrainBreak) this.host.onTerrainBreak(i, was);
    }
  }

  buildFreeport() {
    const c = Math.floor(this.n / 2);
    for (let x = c - 6; x <= c + 6; x++) { this.setW(x, c + 4, W.WALL); this.setW(x, c - 4, W.WALL); }
    for (let y = c - 4; y <= c + 4; y++) { if (Math.abs(y - c) > 1) { this.setW(c - 6, y, W.WALL); this.setW(c + 6, y, W.WALL); } }
    for (let i = 0; i < 10; i++) {
      const x = randInt(5, this.n - 8), y = randInt(5, this.n - 8);
      if (Math.abs(x - c) < 9 && Math.abs(y - c) < 7) continue;
      const len = randInt(2, 5);
      for (let k = 0; k < len; k++) this.setW(x + k, y, W.WALL);
    }
  }

  setW(x, y, t) { const i = y * this.n + x; this.terrain[i] = t; this.thp[i] = W_HP[t] || 0; this.dirtyTiles.add(i); }
  getW(x, y) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return W.WALL;
    return this.terrain[y * this.n + x];
  }
  solidW(px, py) { return this.getW(Math.floor(px / WTS), Math.floor(py / WTS)) !== W.EMPTY; }

  rectHitsTerrain(x, y, w, h) {
    const x0 = Math.floor(x / WTS), x1 = Math.floor((x + w) / WTS);
    const y0 = Math.floor(y / WTS), y1 = Math.floor((y + h) / WTS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.getW(tx, ty) !== W.EMPTY) return true;
    return false;
  }

  clearArea(x, y, w, h) {
    const x0 = Math.floor(x / WTS), x1 = Math.floor((x + w) / WTS);
    const y0 = Math.floor(y / WTS), y1 = Math.floor((y + h) / WTS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
      if (tx >= 2 && ty >= 2 && tx < this.n - 2 && ty < this.n - 2 && this.getW(tx, ty) !== W.EMPTY) this.setW(tx, ty, W.EMPTY);
  }

  playerShips() { return this.ships.filter((s) => s.team === 'player' && !s.dead); }
  avoidPlayers(r) { return this.playerShips().map((s) => ({ x: s.cx, y: s.cy, r })); }

  // avoid: lista de {x,y,r}
  findOpenSpot(w, h, margin = 100, avoid = null) {
    const list = avoid ? (Array.isArray(avoid) ? avoid : [avoid]) : [];
    for (let tries = 0; tries < 400; tries++) {
      const x = rand(WTS * 3, this.size - WTS * 3 - w);
      const y = rand(WTS * 3, this.size - WTS * 3 - h);
      if (this.rectHitsTerrain(x - margin, y - margin, w + margin * 2, h + margin * 2)) continue;
      if (list.some((a) => dist(x + w / 2, y + h / 2, a.x, a.y) < a.r)) continue;
      let hitShip = false;
      for (const s of this.ships) if (aabbOverlap(x - 40, y - 40, w + 80, h + 80, s.x, s.y, s.pw, s.ph)) { hitShip = true; break; }
      if (hitShip) continue;
      return { x, y };
    }
    const x = this.size / 2 - w / 2 + rand(-300, 300), y = this.size / 2 - h / 2 + rand(-300, 300);
    this.clearArea(x - margin, y - margin, w + margin * 2, h + margin * 2);
    return { x, y };
  }

  damageTerrain(tx, ty, dmg, bx, by) {
    const t = this.getW(tx, ty);
    if (t === W.EMPTY || t === W.WALL) return false;
    const i = ty * this.n + tx;
    this.thp[i] -= dmg;
    this.dirtyTiles.add(i);
    this.spark(bx, by, this.zone.rockEdge, 3);
    if (this.thp[i] <= 0) {
      this.setW(tx, ty, W.EMPTY);
      const cx = (tx + 0.5) * WTS, cy = (ty + 0.5) * WTS;
      this.breakFx(cx, cy, t);
      let loot = null;
      if (t === W.ROCK && Math.random() < 0.25) loot = [['metal', randInt(6, 16)]];
      if (t === W.FLUX) loot = [['flux', randInt(2, 5)], ['metal', randInt(2, 6)]];
      if (t === W.DIAMOND) loot = LOOT_TABLES.diamond();
      if (loot) this.spawnCrate(cx, cy, loot);
    }
    return true;
  }

  // ---------- efeitos (eventos no servidor, partículas no cliente) ----------
  spark(x, y, color, n = 6, spd = 160) {
    if (this.headless) { this.fx.push(['sp', Math.round(x), Math.round(y), color, n, spd]); return; }
    for (let k = 0; k < n; k++) this.particles.push({
      x, y, vx: rand(-spd, spd), vy: rand(-spd, spd), life: rand(0.15, 0.45), max: 0.45, color, size: rand(1.5, 3.5),
    });
  }

  breakFx(cx, cy, t) {
    if (this.headless) { this.fx.push(['tb', Math.round(cx), Math.round(cy), t]); return; }
    for (let k = 0; k < 18; k++) this.particles.push({
      x: cx + rand(-50, 50), y: cy + rand(-50, 50), vx: rand(-120, 120), vy: rand(-120, 120),
      life: rand(0.5, 1.2), max: 1.2, color: t === W.FLUX ? '#b45cff' : t === W.DIAMOND ? '#ffffff' : this.zone.rock, size: rand(4, 10),
    });
  }

  explosion(x, y, scale = 1) {
    if (this.headless) { this.fx.push(['ex', Math.round(x), Math.round(y), Math.round(scale * 100) / 100]); return; }
    for (let k = 0; k < 40 * scale; k++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 340) * Math.sqrt(scale);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 1.3), max: 1.3,
        color: choice(['#ffd84a', '#ff9a3c', '#ff5d3b', '#ffffff', '#777']), size: rand(2, 7) * Math.sqrt(scale),
      });
    }
    this.shake(Math.min(14, 5 * scale), x, y);
    this.sound('boom', x, y);
  }

  sound(name, x, y) {
    if (this.headless) { this.fx.push(['so', name, Math.round(x), Math.round(y)]); return; }
    if (this.host && this.host.sfx) this.host.sfx(name, x, y);
  }
  shake(a, x, y) {
    if (this.headless) { this.fx.push(['sh', a, Math.round(x), Math.round(y)]); return; }
    if (this.host && this.host.shake) this.host.shake(a, x, y);
  }

  // aplica eventos recebidos do servidor (cliente)
  playFx(list) {
    for (const e of list) {
      switch (e[0]) {
        case 'sp': this.spark(e[1], e[2], e[3], e[4], e[5]); break;
        case 'tb': this.breakFx(e[1], e[2], e[3]); break;
        case 'ex': this.explosion(e[1], e[2], e[3]); break;
        case 'so': this.sound(e[1], e[2], e[3]); break;
        case 'sh': this.shake(e[1], e[2], e[3]); break;
      }
    }
  }

  // ---------- entidades ----------
  addShip(ship, x, y) {
    ship.x = x; ship.y = y; ship.vx = 0; ship.vy = 0;
    ship.world = this;
    this.ships.push(ship);
  }
  removeShip(ship) {
    this.ships = this.ships.filter((s) => s !== ship);
    if (ship.world === this) ship.world = null;
  }
  shipById(id) { return this.ships.find((s) => s.id === id) || null; }

  spawnCrate(x, y, items, vx = rand(-40, 40), vy = rand(-40, 40)) {
    items = items.filter(([, n]) => n > 0);
    if (!items.length) return;
    this.crates.push({ id: uid(), x, y, vx, vy, items, r: 11, age: 0, spin: rand(-2, 2), rot: rand(0, 6) });
  }

  // ---------- disparos ----------
  fireBullet(x, y, angle, ammoKey, team, ownerId, dmgMul = 1) {
    const a = AMMO[ammoKey];
    const pellets = a.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const ang = angle + (pellets > 1 ? rand(-a.spread, a.spread) : rand(-0.015, 0.015));
      const spd = a.speed * (pellets > 1 ? rand(0.85, 1.1) : 1);
      this.bullets.push({
        id: uid(), x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: a.life * (pellets > 1 ? rand(0.8, 1.1) : 1), ammo: ammoKey, dmg: a.dmg * dmgMul,
        team, ownerId, r: a.r, bounces: a.bounce || 0, pierce: a.pierce || 0, age: 0, bounced: false,
      });
    }
  }

  // dispara uma torreta (jogador ou IA). Retorna true se disparou.
  fireTurret(ship, t, infiniteAmmo = false, onEmpty = null) {
    const d = TURRETS[t.type];
    if (t.cool > 0) return false;
    if (!infiniteAmmo && (t.ammo <= 0 || !t.ammoType)) {
      if (!t.emptyClick) { if (onEmpty) onEmpty(); t.emptyClick = 0.4; }
      return false;
    }
    const ammoKey = t.ammoType || 'standard';
    const a = AMMO[ammoKey];
    t.cool = d.rof * (a.rof || 1);
    t.burstLeft = d.burst - 1;
    t.burstT = d.burstGap || 0;
    this._shoot(ship, t, ammoKey, infiniteAmmo);
    return true;
  }

  _shoot(ship, t, ammoKey, infiniteAmmo) {
    const d = TURRETS[t.type];
    if (!infiniteAmmo) {
      if (t.ammo <= 0) return;
      t.ammo--;
      if (t.ammo <= 0) { t.ammo = 0; t.ammoType = null; }
    }
    const p = ship.turretWorld(t);
    const bx = p.x + Math.cos(t.angle) * 16, by = p.y + Math.sin(t.angle) * 16;
    const jit = ship.team === 'pirate' ? rand(-0.05, 0.05) : 0;
    this.fireBullet(bx, by, t.angle + jit, ammoKey, ship.team, ship.id, (d.dmgMul || 1) * (ship.dmgMul || 1));
    t.recoil = 1;
    this.spark(bx, by, AMMO[ammoKey].color, 3, 60);
    this.sound('shoot', bx, by);
    t._lastAmmo = ammoKey;
  }

  // ---------- atualização (só no servidor) ----------
  populate() {
    this.populated = true;
    const avoid = this.avoidPlayers(1100);
    const z = this.zone;
    for (let i = 0; i < Math.round(z.botCount * 0.75); i++) {
      const spot = this.findOpenSpot(60, 60, 40, avoid);
      this.bots.push(makeBot(weighted(z.bots), spot.x + 30, spot.y + 30));
    }
    for (let i = 0; i < Math.ceil(z.ships / 2); i++) {
      const ship = buildPirateShip(choice(['small', 'medium', 'medium', 'large']));
      const spot = this.findOpenSpot(ship.pw, ship.ph, 120, this.avoidPlayers(1800));
      this.addShip(ship, spot.x, spot.y);
    }
    this.shipTimer = 30;
  }

  update(dt) {
    if (!this.populated) this.populate();
    this.time += dt;
    for (const s of this.ships.slice()) this.updateShip(s, dt);
    this.shipCollisions();
    this.updateBullets(dt);
    for (const b of this.bots) updateBot(this, b, dt);
    this.bots = this.bots.filter((b) => !b.dead);
    this.updateCrates(dt);
    this.updateParticles(dt);
    this.spawner(dt);
  }

  updateParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
    for (const p of this.portals) p.phase += dt;
  }

  spawner(dt) {
    const z = this.zone;
    this.botTimer -= dt;
    if (this.botTimer <= 0 && this.bots.length < z.botCount) {
      this.botTimer = 2.5;
      const spot = this.findOpenSpot(60, 60, 40, this.avoidPlayers(900));
      this.bots.push(makeBot(weighted(z.bots), spot.x + 30, spot.y + 30));
    }
    const pirates = this.ships.filter((s) => s.team === 'pirate').length;
    this.shipTimer -= dt;
    if (this.shipTimer <= 0 && pirates < z.ships) {
      this.shipTimer = 45;
      const boss = z.boss && !this.bossSpawned;
      const ship = buildPirateShip(boss ? 'boss' : choice(['small', 'small', 'medium', 'medium', 'large']));
      if (boss) this.bossSpawned = true;
      const spot = this.findOpenSpot(ship.pw, ship.ph, 120, this.avoidPlayers(1400));
      this.addShip(ship, spot.x, spot.y);
    }
  }

  updateShip(s, dt) {
    if (s.dead) return;
    s.hitFlash = Math.max(0, s.hitFlash - dt * 3);
    if (s.team === 'pirate') updatePirate(this, s, dt);

    // propulsão
    const tx = s.thrust.x, ty = s.thrust.y;
    s.vx += tx * s.accel * dt;
    s.vy += ty * s.accel * dt;
    const damp = Math.pow(tx || ty ? 0.6 : 0.35, dt);
    s.vx *= damp; s.vy *= damp;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > s.maxSpeed) { s.vx *= s.maxSpeed / sp; s.vy *= s.maxSpeed / sp; }

    // movimento com colisão contra o terreno
    s.x += s.vx * dt;
    if (this.rectHitsTerrain(s.x, s.y, s.pw, s.ph)) {
      s.x -= s.vx * dt;
      if (Math.abs(s.vx) > 180) this.collideDamage(s, Math.abs(s.vx));
      s.vx = -s.vx * 0.25;
    }
    s.y += s.vy * dt;
    if (this.rectHitsTerrain(s.x, s.y, s.pw, s.ph)) {
      s.y -= s.vy * dt;
      if (Math.abs(s.vy) > 180) this.collideDamage(s, Math.abs(s.vy));
      s.vy = -s.vy * 0.25;
    }
    if (this.rectHitsTerrain(s.x, s.y, s.pw, s.ph)) {
      const a = Math.atan2(this.size / 2 - s.cy, this.size / 2 - s.cx);
      s.x += Math.cos(a) * 60 * dt; s.y += Math.sin(a) * 60 * dt;
    }

    // torretas
    for (const t of s.turrets) {
      t.cool = Math.max(0, t.cool - dt);
      if (t.emptyClick) t.emptyClick = Math.max(0, t.emptyClick - dt);
      t.recoil = Math.max(0, (t.recoil || 0) - dt * 6);
      if (t.burstLeft > 0) {
        t.burstT -= dt;
        if (t.burstT <= 0) {
          t.burstLeft--; t.burstT = TURRETS[t.type].burstGap;
          this._shoot(s, t, t._lastAmmo || t.ammoType || 'standard', s.team === 'pirate');
        }
      }
    }

    // geradores de escudo
    for (const o of s.objects) {
      if (o.type === 'shield_gen' && o.fuel > 0 && s.shield < s.maxShield) {
        const amt = Math.min(25 * dt, o.fuel, s.maxShield - s.shield);
        s.shield += amt; o.fuel -= amt;
      }
    }
    if (s.team === 'pirate') {
      s.lastHit = (s.lastHit || 0) + dt;
      if (s.lastHit > 5) s.shield = Math.min(s.maxShield, s.shield + 10 * dt);
    }
    if (s.team === 'player') this.updateShipInterior(s, dt);
  }

  collideDamage(s, speed) {
    if (this.zone.safe) return;
    const dmg = (speed - 180) * 0.08;
    if (s.shield > 0) s.shield = Math.max(0, s.shield - dmg);
    else s.integrity -= dmg * 0.5;
    this.shake(4, s.cx, s.cy);
    this.sound('thud', s.cx, s.cy);
    if (s.integrity <= 0) this.destroyShip(s);
  }

  updateShipInterior(s, dt) {
    for (const it of s.items) {
      it.age += dt;
      it.vy += GRAVITY * dt;
      const fr = it.onGround ? Math.pow(0.002, dt) : Math.pow(0.7, dt);
      it.vx *= fr;
      const ball = ITEMS[it.item].kind === 'ball';
      const pvx = it.vx, pvy = it.vy;
      const r = collideMove(it, s, dt, true, false);
      if (ball) {
        const b = ITEMS[it.item].bounce;
        if (r.hitX) it.vx = -pvx * b;
        if (r.hitY && Math.abs(pvy) > 60) { it.vy = -pvy * b; it.onGround = false; }
        it.rot += it.vx * dt * 0.1;
      }
      it.x = clamp(it.x, TS, s.pw - TS - it.w);
      it.y = clamp(it.y, TS, s.ph - TS - it.h);
    }
    this.separateItems(s);
    for (const o of s.objects) {
      const od = OBJECTS[o.type];
      if (od.fab) this.updateFab(s, o, dt);
      if (o.type === 'hatch') {
        o.cool -= dt;
        if (o.cool <= 0 && s.cargoQueue.length && o.mode !== 'none' && !this.hatchBlocked(s, o)) {
          const [item, n] = s.cargoQueue[0];
          const k = Math.min(n, ITEMS[item].stack);
          s.spawnItem(item, k, (o.x + 1) * TS + rand(-6, 6), (o.y + 0.6) * TS, rand(-60, 60), -rand(120, 220));
          if (n - k > 0) s.cargoQueue[0] = [item, n - k]; else s.cargoQueue.shift();
          o.cool = 0.3;
          this.sound('pop', s.cx, s.cy);
        }
      }
    }
  }

  // colisão entre itens soltos: eles se empilham em vez de se sobrepor
  separateItems(s) {
    const L = s.items;
    if (L.length < 2) return;
    // grade espacial simples por célula da nave
    const grid = new Map();
    for (let i = 0; i < L.length; i++) {
      const k = Math.floor((L[i].x + 5) / TS) + Math.floor((L[i].y + 5) / TS) * 1000;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const free = (it, x, y) => {
      const x0 = Math.floor(x / TS), x1 = Math.floor((x + it.w - 0.01) / TS);
      const y0 = Math.floor(y / TS), y1 = Math.floor((y + it.h - 0.01) / TS);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (s.solidForItem(cx, cy)) return false;
      return true;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        const gx = Math.floor((a.x + 5) / TS), gy = Math.floor((a.y + 5) / TS);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const cell = grid.get(gx + dx + (gy + dy) * 1000);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = L[j];
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ox <= 0.01 || oy <= 0.01) continue;
            if (oy < ox) {
              // empilha: o de cima fica apoiado no de baixo
              const top = a.y < b.y ? a : b, bot = top === a ? b : a;
              const ny = bot.y - top.h;
              if (free(top, top.x, ny)) { top.y = ny; if (top.vy > 0) top.vy = 0; top.onGround = true; top.vx *= 0.9; }
              else if (free(bot, bot.x, top.y + top.h)) bot.y = top.y + top.h;
            } else {
              const left = a.x < b.x ? a : b, right = left === a ? b : a;
              const half = ox / 2;
              if (free(left, left.x - half, left.y)) left.x -= half; else if (free(right, right.x + half, right.y)) right.x += half;
              if (free(right, right.x + half, right.y)) right.x += half; else if (free(left, left.x - half, left.y)) left.x -= half;
              const v = (left.vx + right.vx) / 2;
              left.vx = Math.min(left.vx, v); right.vx = Math.max(right.vx, v);
            }
          }
        }
      }
    }
  }

  hatchBlocked(s, o) {
    if (o.mode === 'none') return true;
    let c = 0;
    const x0 = o.x * TS, y0 = o.y * TS;
    for (const it of s.items) if (aabbOverlap(it.x, it.y, it.w, it.h, x0, y0, 2 * TS, 2 * TS)) c++;
    return c >= 6;
  }

  updateFab(s, o, dt) {
    const list = RECIPES[OBJECTS[o.type].fab];
    if (!o.queue.length) { o.progress = 0; o.started = false; return; }
    const q = o.queue[0];
    const r = list[q.r];
    if (!o.started) {
      for (const m in r.cost) if ((o.mats[m] || 0) < r.cost[m]) { o.stalled = true; return; }
      for (const m in r.cost) o.mats[m] -= r.cost[m];
      o.started = true; o.stalled = false; o.progress = 0;
    }
    o.progress += dt;
    if (o.progress >= r.t) {
      for (let i = 0; i < r.n; i++) {
        s.spawnItem(r.out, 1, (o.x + 1) * TS + rand(-4, 4), (o.y + 0.5) * TS, rand(-50, 50), -rand(80, 160));
      }
      this.mergeItemsNear(s, (o.x + 1) * TS, (o.y + 1) * TS);
      o.started = false; o.progress = 0;
      if (q.left !== Infinity && q.left !== null) q.left--;
      if (q.left !== Infinity && q.left !== null && q.left <= 0) o.queue.shift();
      this.sound('ding', s.cx, s.cy);
    }
  }

  mergeItemsNear(s, x, y) {
    const near = s.items.filter((it) => dist(it.x, it.y, x, y) < TS * 3 && it.age < 0.1);
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      if (a.n <= 0) continue;
      for (let j = i + 1; j < near.length; j++) {
        const b = near[j];
        if (b.n > 0 && b.item === a.item && a.n < ITEMS[a.item].stack) {
          const k = Math.min(ITEMS[a.item].stack - a.n, b.n);
          a.n += k; b.n -= k;
        }
      }
    }
    s.items = s.items.filter((it) => it.n > 0);
  }

  shipCollisions() {
    const L = this.ships;
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        if (!aabbOverlap(a.x, a.y, a.pw, a.ph, b.x, b.y, b.pw, b.ph)) continue;
        const ox = Math.min(a.x + a.pw, b.x + b.pw) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.ph, b.y + b.ph) - Math.max(a.y, b.y);
        const ta = b.mass / (a.mass + b.mass), tb = 1 - ta;
        if (ox < oy) {
          const d = a.cx < b.cx ? -1 : 1;
          a.x += d * ox * ta; b.x -= d * ox * tb;
          const v = (a.vx * a.mass + b.vx * b.mass) / (a.mass + b.mass);
          a.vx = v + d * 30; b.vx = v - d * 30;
        } else {
          const d = a.cy < b.cy ? -1 : 1;
          a.y += d * oy * ta; b.y -= d * oy * tb;
          const v = (a.vy * a.mass + b.vy * b.mass) / (a.mass + b.mass);
          a.vy = v + d * 30; b.vy = v - d * 30;
        }
      }
  }

  // projétil pode acertar esta nave?
  canHitShip(b, sh) {
    if (sh.dead) return false;
    if (sh.id === b.ownerId) return b.bounced;
    if (sh.team !== b.team) return true;
    // naves de jogadores diferentes só se atingem em zonas JxJ
    return sh.team === 'player' && this.zone.pvp;
  }

  updateBullets(dt) {
    const out = [];
    for (const b of this.bullets) {
      let alive = true;
      const a = AMMO[b.ammo];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 14));
      const sdt = dt / steps;
      for (let s = 0; s < steps && alive; s++) {
        const px = b.x, py = b.y;
        b.x += b.vx * sdt; b.y += b.vy * sdt;
        const tx = Math.floor(b.x / WTS), ty = Math.floor(b.y / WTS);
        const tt = this.getW(tx, ty);
        if (tt !== W.EMPTY) {
          if (!this.zone.safe) this.damageTerrain(tx, ty, b.dmg, b.x, b.y);
          if (b.bounces > 0) {
            b.bounces--; b.bounced = true;
            const ptx = Math.floor(px / WTS), pty = Math.floor(py / WTS);
            if (ptx !== tx) b.vx = -b.vx;
            if (pty !== ty) b.vy = -b.vy;
            if (ptx === tx && pty === ty) { b.vx = -b.vx; b.vy = -b.vy; }
            b.x = px; b.y = py;
          } else if (b.pierce > 0 && tt !== W.WALL) {
            b.pierce--;
            b.vx *= 0.85; b.vy *= 0.85;
          } else { alive = false; this.spark(b.x, b.y, a.color, 5); }
          if (!alive) break;
          continue;
        }
        for (const sh of this.ships) {
          if (!this.canHitShip(b, sh)) continue;
          if (b.x < sh.x || b.y < sh.y || b.x > sh.x + sh.pw || b.y > sh.y + sh.ph) continue;
          this.hitShip(sh, b, px, py);
          alive = false; break;
        }
        if (!alive) break;
        if (b.team !== 'bot') {
          for (const bot of this.bots) {
            if (bot.dead) continue;
            if (dist(b.x, b.y, bot.x, bot.y) < bot.r + b.r) {
              hitBot(this, bot, b);
              alive = false; break;
            }
          }
        }
      }
      b.age += dt;
      b.life -= dt;
      if (a.decay) b.dmg = Math.max(0.5, a.dmg * (1 - b.age / a.life));
      if (alive && b.life <= 0) {
        alive = false;
        if (a.flak) {
          for (let k = 0; k < a.flak; k++) {
            const ang = (k / a.flak) * Math.PI * 2 + rand(-0.2, 0.2);
            this.bullets.push({
              id: uid(), x: b.x, y: b.y, vx: Math.cos(ang) * 520, vy: Math.sin(ang) * 520, life: 0.35, ammo: 'scatter',
              dmg: a.dmg, team: b.team, ownerId: b.ownerId, r: 2, bounces: 0, pierce: 0, age: 0, bounced: false,
            });
          }
          this.spark(b.x, b.y, '#ffb05d', 14, 220);
          this.sound('pop', b.x, b.y);
        }
      }
      if (alive) out.push(b);
    }
    this.bullets = out;
  }

  hitShip(sh, b, px, py) {
    const a = AMMO[b.ammo];
    sh.hitFlash = 1;
    sh.lastHit = 0;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const dx = b.vx / sp, dy = b.vy / sp;
    if (a.knock) {
      const k = a.knock / Math.sqrt(sh.mass) * 6;
      sh.vx += dx * k; sh.vy += dy * k;
    }
    if (this.zone.safe) { this.spark(b.x, b.y, '#9fd8ff', 4); return; }
    sh.lastAttacker = b.ownerId;
    if (sh.shield > 0) {
      sh.shield = Math.max(0, sh.shield - b.dmg);
      this.spark(b.x, b.y, '#7fd0ff', 6);
      this.sound('shield', b.x, b.y);
    } else {
      const lx = clamp(px - sh.x, 1, sh.pw - 1), ly = clamp(py - sh.y, 1, sh.ph - 1);
      const r = sh.damageInterior(lx, ly, dx, dy, b.dmg);
      this.spark(b.x, b.y, '#ffb05d', 10, 220);
      this.sound('hullhit', b.x, b.y);
      if (r.destroyedObject) {
        const o = r.destroyedObject;
        if (this.host && this.host.onObjectDestroyed) this.host.onObjectDestroyed(sh, o);
        sh.removeObject(o);
        const od = OBJECTS[o.type];
        this.explosion(sh.x + (o.x + od.w / 2) * TS, sh.y + (o.y + od.h / 2) * TS, 0.6);
        if (sh.team === 'player' && this.host) this.host.shipMsg(sh, `${od.name} foi destruído!`, '#ff7070');
      }
      if (sh.integrity <= 0) this.destroyShip(sh);
    }
  }

  destroyShip(sh) {
    if (sh.dead) return;
    sh.dead = true;
    this.explosion(sh.cx, sh.cy, 2 + sh.pw / 300);
    for (let i = 0; i < 6; i++) this.explosion(sh.x + rand(0, sh.pw), sh.y + rand(0, sh.ph), 1);
    const scale = sh.boss ? 4 : Math.max(1, Math.round(sh.w * sh.h / 300));
    const loot = sh.team === 'pirate' ? LOOT_TABLES.ship(scale) : [];
    if (sh.team === 'player') {
      for (const it of sh.items) loot.push([it.item, it.n]);
      for (const o of sh.objects) if (Math.random() < 0.5) loot.push([o.type, 1]);
      for (const o of sh.objects) if (o.mats) for (const m of FAB_MATS) if (o.mats[m] > 0) loot.push([m, Math.floor(o.mats[m] / 2)]);
    }
    for (let i = 0; i < loot.length; i += 2) {
      this.spawnCrate(sh.cx + rand(-sh.pw / 3, sh.pw / 3), sh.cy + rand(-sh.ph / 3, sh.ph / 3), loot.slice(i, i + 2), rand(-120, 120), rand(-120, 120));
    }
    this.ships = this.ships.filter((s) => s !== sh);
    // crédito para quem destruiu
    const killer = this.shipById(sh.lastAttacker);
    if (killer && killer.team === 'player') {
      killer.stats.ships++;
      if (this.host) this.host.shipMsg(killer, sh.boss ? 'A nave chefe foi destruída! Saque épico!' : `Nave "${sh.name}" destruída!`, '#ffd84a');
    }
    if (sh.team === 'player' && this.host) {
      if (killer && killer.team === 'player') this.host.zoneMsg(this, `"${sh.name}" foi destruída por "${killer.name}"!`, '#ff9a7a');
      this.host.onShipDestroyed(sh);
    }
  }

  updateCrates(dt) {
    for (const c of this.crates) {
      c.age += dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vx *= Math.pow(0.5, dt); c.vy *= Math.pow(0.5, dt);
      c.rot += c.spin * dt;
      if (this.solidW(c.x, c.y)) { c.x -= c.vx * dt * 2; c.y -= c.vy * dt * 2; c.vx = -c.vx; c.vy = -c.vy; }
      for (const s of this.ships) {
        if (s.team !== 'player') continue;
        if (c.x > s.x - 6 && c.y > s.y - 6 && c.x < s.x + s.pw + 6 && c.y < s.y + s.ph + 6) {
          if (c.age < 0.6 && c.fromId === s.id) continue;
          const hatches = s.objectsOf('hatch');
          if (!hatches.length) {
            if (!s._warnHatch && this.host) { this.host.shipMsg(s, 'Sem Escotilha de Carga: não é possível coletar saque!', '#ffb070'); s._warnHatch = true; }
            continue;
          }
          if (hatches.every((h) => this.hatchBlocked(s, h)) || s.cargoQueue.length > 30) continue;
          for (const it of c.items) s.cargoQueue.push(it.slice());
          c.dead = true;
          this.sound('collect', c.x, c.y);
          break;
        }
      }
    }
    this.crates = this.crates.filter((c) => !c.dead && c.age < 300);
  }

  ejectFromShip(s, o, item, n) {
    const od = OBJECTS[o.type];
    const lx = (o.x + od.w / 2) * TS, ly = (o.y + od.h / 2) * TS;
    const dl = lx, dr = s.pw - lx, dtp = ly, db = s.ph - ly;
    const m = Math.min(dl, dr, dtp, db);
    let x = s.x + lx, y = s.y + ly, vx = 0, vy = 0;
    if (m === dl) { x = s.x - 20; vx = -220; }
    else if (m === dr) { x = s.x + s.pw + 20; vx = 220; }
    else if (m === dtp) { y = s.y - 20; vy = -220; }
    else { y = s.y + s.ph + 20; vy = 220; }
    this.crates.push({ id: uid(), x, y, vx: vx + s.vx, vy: vy + s.vy, items: [[item, n]], r: 11, age: 0, spin: rand(-2, 2), rot: 0, fromId: s.id });
  }

  // muda o terreno sob uma nave recém-chegada
  placeShipAtOpenSpot(ship) {
    const spot = this.findOpenSpot(ship.pw, ship.ph, 200);
    this.addShip(ship, spot.x, spot.y);
  }
}

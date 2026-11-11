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
  // personagens que estão fisicamente dentro da nave s (tripulantes de qualquer nave; só no servidor)
  occupants(s) {
    const out = [];
    const add = (c) => { if (c.player && c.player.ship === s && !out.includes(c.player)) out.push(c.player); };
    for (const c of s.crew || []) add(c);
    for (const sh of this.ships || []) if (sh !== s && sh.team === 'player') for (const c of sh.crew || []) add(c);
    return out;
  }
  // tripulantes soltos no espaço: [{ sess, p }]
  spacewalkers() {
    const out = [];
    for (const sh of this.ships || []) if (sh.team === 'player') for (const c of sh.crew || []) if (c.player && !c.player.ship) out.push({ sess: c, p: c.player });
    return out;
  }
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

  // raio da pistola laser dentro das naves (só efeito visual)
  laserFx(x1, y1, x2, y2) {
    if (this.headless) { this.fx.push(['lz', Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]); return; }
    this.beams = this.beams || [];
    this.beams.push({ x1, y1, x2, y2, life: 0.09 });
    this.spark(x2, y2, AMMO.laser.color, 3, 60);
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
        case 'lz': this.laserFx(e[1], e[2], e[3], e[4]); break;
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
  fireBullet(x, y, angle, ammoKey, team, ownerId, dmgMul = 1, knockMul = 1) {
    const a = AMMO[ammoKey];
    const pellets = a.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const ang = angle + (pellets > 1 ? rand(-a.spread, a.spread) : rand(-0.015, 0.015));
      const spd = a.speed * (pellets > 1 ? rand(0.85, 1.1) : 1);
      this.bullets.push({
        id: uid(), x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: a.life * (pellets > 1 ? rand(0.8, 1.1) : 1), ammo: ammoKey, dmg: a.dmg * dmgMul, dmg0: a.dmg * dmgMul, knockMul,
        team, ownerId, r: a.r, bounces: a.bounce || 0, pierce: a.pierce || 0, age: 0, bounced: false,
      });
    }
  }

  // dispara uma torreta (jogador ou IA). Retorna true se disparou.
  fireTurret(ship, t, infiniteAmmo = false, onEmpty = null) {
    const d = TURRETS[t.type];
    if (t.cool > 0) return false;
    if (!d.mining && !infiniteAmmo && (t.ammo <= 0 || !t.ammoType)) {
      if (!t.emptyClick) { if (onEmpty) onEmpty(); t.emptyClick = 0.4; }
      return false;
    }
    if (d.mining) {
      // mineradora: munição infinita, cadência própria (fora do ritmo das armas)
      t.cool = d.rof; t.burstLeft = 0;
      const p = ship.turretWorld(t);
      this.fireBullet(p.x + Math.cos(t.angle) * 16, p.y + Math.sin(t.angle) * 16, t.angle, 'mining', ship.team, ship.id);
      t.recoil = 0.5;
      this.sound('shoot', p.x, p.y);
      return true;
    }
    const ammoKey = t.ammoType || 'standard';
    const a = AMMO[ammoKey];
    t.cool = d.rof * (a.rof || 1) * TURRET_PACE;
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
    this.fireBullet(bx, by, t.angle + jit, ammoKey, ship.team, ship.id, (d.dmgMul || 1) * (ship.dmgMul || 1) * TURRET_PACE, TURRET_PACE);
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
    for (let i = 0; i < (z.derelicts || 0); i++) this.spawnDerelict(900);
    this.shipTimer = 30;
    this.derelictTimer = 90;
  }

  update(dt) {
    if (!this.populated) this.populate();
    this.time += dt;
    this.eva = this.spacewalkers();
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
    if (this.beams) { for (const b of this.beams) b.life -= dt; this.beams = this.beams.filter((b) => b.life > 0); }
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
    for (const p of this.portals) p.phase += dt;
  }

  spawnDerelict(avoidR = 1400) {
    const ship = buildDerelict();
    const spot = this.findOpenSpot(ship.pw, ship.ph, 140, this.avoidPlayers(avoidR));
    this.addShip(ship, spot.x, spot.y);
    return ship;
  }

  // naves abandonadas: quando saqueadas (e sem ninguém dentro) somem; outras aparecem com o tempo
  derelictUpkeep(dt) {
    for (const s of this.ships) {
      if (s.team !== 'derelict') continue;
      const empty = !s.items.length && !s.objects.some((o) => o.store && o.store.n > 0);
      if (!empty) { s.goneT = null; continue; }
      if (this.occupants(s).length) continue;
      s.goneT = (s.goneT ?? 40) - dt;
      if (s.goneT <= 0) { s.dead = true; this.spark(s.cx, s.cy, '#9aa', 20, 200); }
    }
    this.ships = this.ships.filter((s) => !(s.team === 'derelict' && s.dead));
    const z = this.zone, n = this.ships.filter((s) => s.team === 'derelict').length;
    this.derelictTimer = (this.derelictTimer ?? 90) - dt;
    if (n < (z.derelicts || 0) && this.derelictTimer <= 0) { this.derelictTimer = 90; this.spawnDerelict(); }
  }

  spawner(dt) {
    const z = this.zone;
    this.derelictUpkeep(dt);
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
    if (s.team === 'derelict') { this.updateShipInterior(s, dt); this.updateDrones(s, dt); }
  }

  // ---------- drones de vigia (naves abandonadas) ----------
  updateDrones(s, dt) {
    if (!s.drones || !s.drones.length) return;
    const people = this.occupants(s);
    for (const d of s.drones) {
      d.flash = Math.max(0, d.flash - dt * 4);
      d.cool = Math.max(0, d.cool - dt);
      const cx = d.x + 5, cy = d.y + 5;
      let tgt = null, bd = DRONE.sight;
      for (const p of people) { const dd = dist(cx, cy, p.cxL, p.cyL); if (dd < bd) { bd = dd; tgt = p; } }
      let ax = 0, ay = 0, max = DRONE.speed;
      if (tgt) { const a = Math.atan2(tgt.cyL - cy, tgt.cxL - cx); ax = Math.cos(a); ay = Math.sin(a); }
      else { d.wander += dt * 0.7; ax = Math.cos(d.wander) * 0.4; ay = Math.sin(d.wander * 1.3) * 0.4; max = 30; }
      d.vx += ax * DRONE.accel * dt; d.vy += ay * DRONE.accel * dt;
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > max) { d.vx *= max / sp; d.vy *= max / sp; }
      d.x += d.vx * dt;
      if (s.boxHits(d.x, d.y, 10, 10, true)) { d.x -= d.vx * dt; d.vx *= -0.5; }
      d.y += d.vy * dt;
      if (s.boxHits(d.x, d.y, 10, 10, true)) { d.y -= d.vy * dt; d.vy *= -0.5; }
      // encostou no personagem: choque
      if (tgt && d.cool <= 0 && aabbOverlap(d.x - 1, d.y - 1, 12, 12, tgt.x, tgt.y, tgt.w, tgt.h)) {
        d.cool = DRONE.hitCool;
        tgt.hp -= DRONE.dmg;
        d.vx = -d.vx * 0.8 - Math.sign(tgt.cxL - cx) * 60; d.vy = -d.vy * 0.8 - 30;
        this.spark(s.x + cx, s.y + cy, '#ff6060', 8, 140);
        this.sound('hullhit', s.x + cx, s.y + cy);
      }
    }
  }

  hitDrone(s, d, dmg) {
    d.hp -= dmg; d.flash = 1;
    this.spark(s.x + d.x + 5, s.y + d.y + 5, '#ffd27a', 4, 120);
    this.sound('bothit', s.x + d.x + 5, s.y + d.y + 5);
    if (d.hp <= 0) {
      s.drones.splice(s.drones.indexOf(d), 1);
      this.explosion(s.x + d.x + 5, s.y + d.y + 5, 0.3);
      s.spawnItem('metal', randInt(3, 8), d.x + 5, d.y + 5, rand(-40, 40), -80);
      if (Math.random() < 0.35) s.spawnItem('explosives', randInt(2, 5), d.x + 5, d.y + 5, rand(-40, 40), -80);
    }
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
      // em rampa o atrito é menor e a gravidade puxa o item morro abaixo
      const fr = it.onGround ? Math.pow(it.slope ? 0.25 : 0.002, dt) : Math.pow(0.7, dt);
      it.vx *= fr;
      if (it.onGround && it.slope) it.vx += GRAVITY * it.slope / (1 + it.slope * it.slope) * dt;
      const ball = ITEMS[it.item].kind === 'ball';
      const pvx = it.vx, pvy = it.vy;
      it._py = it.y;
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
    this.pushItemsByCrew(s);
    this.separateItems(s);
    for (const o of s.objects) {
      const od = OBJECTS[o.type];
      if (od.fab) this.updateFab(s, o, dt);
      if (o.type === 'loader') this.updateLoader(s, o, dt);
      if (o.type === 'ammo_crate') this.updateCrate(s, o, dt);
      if (o.type === 'hatch') {
        o.cool -= dt;
        // cada escotilha solta o primeiro item da fila que o filtro dela deixa passar
        const qi = o.cool <= 0 && !this.hatchBlocked(s, o) ? s.cargoQueue.findIndex(([item]) => this.hatchAccepts(o, item)) : -1;
        if (qi >= 0) {
          const [item, n] = s.cargoQueue[qi];
          const k = Math.min(n, ITEMS[item].stack);
          const hd = OBJECTS.hatch;
          s.spawnItem(item, k, (o.x + hd.w / 2) * TS + rand(-3, 3), (o.y + hd.h * 0.4) * TS, rand(-60, 60), -rand(80, 160));
          if (n - k > 0) s.cargoQueue[qi] = [item, n - k]; else s.cargoQueue.splice(qi, 1);
          o.cool = 0.3;
          this.sound('pop', s.cx, s.cy);
        }
      }
    }
  }

  // colisão entre tripulantes e itens soltos (lado do servidor).
  // O personagem é sólido para os itens: item que cai em cima dele fica apoiado
  // e anda junto; andando contra um item, o personagem o empurra.
  // (O navegador faz o outro lado: o personagem fica em pé sobre os itens.)
  pushItemsByCrew(s) {
    if (!s.items.length) return;
    const people = this.occupants(s);
    if (!people.length) return;
    const fits = (it, x) => {
      return !s.boxHits(x, it.y, it.w, it.h, true);
    };
    for (const p of people) {
      if (p.mode !== 'walk') continue;
      for (const it of s.items) {
        const ox = Math.min(p.x + p.w, it.x + it.w) - Math.max(p.x, it.x); // > 0: sobreposição horizontal
        const oy = Math.min(p.y + p.h, it.y + it.h) - Math.max(p.y, it.y); // > 0: sobreposição vertical
        if (ox < -2 || oy < -2) continue; // longe
        const itBottom = it.y + it.h;
        // 1) item caindo/apoiado na cabeça do personagem
        if (ox > 1 && it.vy >= 0 && itBottom >= p.y - 1 && itBottom <= p.y + 8) {
          it.y = p.y - it.h; it.vy = 0; it.onGround = true;
          it.vx = p.vx;
          continue;
        }
        // 2) item embaixo dos pés: o personagem está em pé nele (tratado no navegador)
        if (it.y >= p.y + p.h - 4) continue;
        // 3) contato lateral
        if (oy <= 1) continue;
        const dir = it.x + it.w / 2 < p.x + p.w / 2 ? -1 : 1;
        if (ox > 0.5) {
          // sobrepostos (atraso de rede, item caiu de lado): tira o item de dentro
          const nx = dir < 0 ? p.x - it.w : p.x + p.w;
          if (fits(it, nx)) it.x = nx;
        }
        // andando contra o item: empurra (um pouco mais rápido que o personagem,
        // para ele não ficar "travado" esperando a posição nova chegar pela rede)
        if (dir * p.vx > 1) {
          const sp = Math.abs(p.vx) + 20;
          if (dir * it.vx < sp) it.vx = dir * sp;
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
    const free = (it, x, y) => !s.boxHits(x, y, it.w, it.h, true);
    for (const it of L) it._touch = false;
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
            if (a.n <= 0 || b.n <= 0) continue;
            // itens iguais se juntam na mesma pilha
            if (a.item === b.item) {
              const max = ITEMS[a.item].stack;
              if (a.n < max) {
                const k = Math.min(max - a.n, b.n);
                a.n += k; b.n -= k;
                if (b.n <= 0) continue;
              }
              if (b.n < max) {
                const k = Math.min(max - b.n, a.n);
                b.n += k; a.n -= k;
                if (a.n <= 0) continue;
              }
            }
            // item com outro apoiado em cima dele (é uma pilha, não um item solto)
            const hasRider = (it) => {
              const gx = Math.floor((it.x + 5) / TS), gy = Math.floor((it.y + 5) / TS);
              for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const cell = grid.get(gx + dx + (gy + dy) * 1000);
                if (cell) for (const k of cell) {
                  const o = L[k];
                  if (o !== it && o !== a && o !== b && o.n > 0 && Math.abs(o.y + o.h - it.y) < 2 && Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) > 1) return o;
                }
              }
              return null;
            };
            // move o item para o lado levando junto o que está empilhado em cima dele
            const shiftX = (it, d, depth = 0) => {
              const r = depth < 6 ? hasRider(it) : null;
              it.x += d;
              if (r && free(r, r.x + d, r.y)) shiftX(r, d, depth + 1);
            };
            const stack = () => {
              // empilha: o de cima fica apoiado no de baixo
              const top = a.y < b.y || (a.y === b.y && a.id > b.id) ? a : b, bot = top === a ? b : a;
              const ny = bot.y - top.h;
              if (free(top, top.x, ny)) { top.y = ny; if (top.vy > 0) top.vy = 0; top.onGround = true; top.vx *= 0.9; return true; }
              if (free(bot, bot.x, top.y + top.h)) { bot.y = top.y + top.h; return true; }
              return false;
            };
            const side = () => {
              const left = a.x < b.x || (a.x === b.x && a.id < b.id) ? a : b, right = left === a ? b : a;
              const half = ox / 2;
              let moved = 0;
              if (free(left, left.x - half, left.y)) { shiftX(left, -half); moved += half; }
              if (free(right, right.x + (ox - moved), right.y)) { shiftX(right, ox - moved); moved = ox; }
              else if (moved < ox && free(left, left.x - (ox - moved), left.y)) { shiftX(left, -(ox - moved)); moved = ox; }
              if (moved > 0) {
                const v = (left.vx + right.vx) / 2; left.vx = Math.min(left.vx, v); right.vx = Math.max(right.vx, v);
                // o que está empilhado em cima acompanha a velocidade de quem está embaixo
                for (const base of [left, right]) {
                  let cur = base, r, guard = 0;
                  while ((r = hasRider(cur)) && guard++ < 6) { r.vx = cur.vx; cur = r; }
                }
              }
              return moved >= ox - 0.01;
            };
            a._touch = b._touch = true;
            // se ficaram espremidos lado a lado por muito tempo, empilham
            const top0 = a.y < b.y || (a.y === b.y && a.id > b.id) ? a : b;
            let solved = true;
            // Item caindo em cima de outro (sobreposição rasa na vertical) sempre empilha.
            // Espremidos lado a lado (ex.: empurrados), um só sobe no outro se os dois
            // forem itens soltos: contra uma pilha, ela é empurrada inteira em vez de ser escalada.
            const canClimb = !hasRider(a) && !hasRider(b);
            if (oy < ox) { if (!stack() && !side()) solved = false; }
            else if ((a.ov > 20 || b.ov > 20) && canClimb) { if (!stack() && !side()) solved = false; }
            else if (!side() && !(canClimb && stack())) solved = false;
            if (!solved && top0._py !== undefined && top0._py < top0.y) { top0.y = top0._py; top0.vy = 0; top0.onGround = true; }
          }
        }
      }
    }
    for (const it of L) it.ov = it._touch ? (it.ov || 0) + 1 : 0;
    if (L.some((it) => it.n <= 0)) s.items = L.filter((it) => it.n > 0);
  }

  // procura um lugar livre para o item produzido dentro da área do fabricador.
  // Retorna null se a área estiver totalmente ocupada por outros itens.
  fabOutputSpot(s, o, outItem, n) {
    const od = OBJECTS[o.type];
    const x0 = o.x * TS, y0 = o.y * TS, w = od.w * TS, h = od.h * TS;
    const near = s.items.filter((it) => aabbOverlap(it.x, it.y, it.w, it.h, x0 - 2, y0 - 2, w + 4, h + 4));
    // pilha do mesmo item com espaço aceita a produção
    for (const it of near) if (it.item === outItem && it.n + n <= ITEMS[outItem].stack) return { x: it.x, y: it.y, it };
    for (let y = y0 + h - 10; y >= y0; y -= 2) {
      for (let k = 0; k <= w - 10; k += 2) {
        // começa pelo centro e vai para as bordas
        const off = (k / 2) % 2 ? -Math.ceil(k / 4) * 2 : Math.ceil(k / 4) * 2;
        const x = clamp(x0 + w / 2 - 5 + off, x0, x0 + w - 10);
        let ok = !s.boxHits(x, y, 10, 10, true);
        if (!ok) continue;
        for (const it of near) if (aabbOverlap(it.x, it.y, it.w, it.h, x, y, 10, 10)) { ok = false; break; }
        if (ok) return { x, y };
      }
    }
    return null;
  }

  // a escotilha deixa esse item passar? (fechada não deixa nada)
  hatchAccepts(o, item) {
    if (!o.open) return false;
    const inList = o.filter.includes(item);
    return o.fmode === 'allow' ? inList : !inList;
  }
  hatchBlocked(s, o) {
    if (!o.open) return true;
    let c = 0;
    const od = OBJECTS[o.type];
    const x0 = o.x * TS, y0 = o.y * TS;
    for (const it of s.items) if (aabbOverlap(it.x, it.y, it.w, it.h, x0, y0, od.w * TS, od.h * TS)) c++;
    return c >= 3 * od.w * od.h;
  }

  // retângulo (coordenadas do mundo) livre de blocos do mapa?
  rectFree(x, y, w, h) {
    for (let ty = Math.floor(y / WTS); ty <= Math.floor((y + h - 0.01) / WTS); ty++)
      for (let tx = Math.floor(x / WTS); tx <= Math.floor((x + w - 0.01) / WTS); tx++)
        if (this.getW(tx, ty) !== W.EMPTY) return false;
    return true;
  }

  // ---------- Carregador ----------
  // A cada movimento (LOADER_TIME s) leva a pilha máxima do item da casa de entrada para a de saída.
  // Entrada: caixa expando (retira) ou itens soltos naquela casa (inclui produtos de fabricador).
  // Saída: fabricador, expando, gerador de escudo, reciclador, ejetor, outro Carregador, torreta
  // (munição) ou o chão — este último só se "só em máquinas" estiver desligado.
  loaderAllows(o, item) { return !o.filter || !o.filter.length || o.filter.includes(item); }

  // tudo o que dá para pegar na casa de entrada (respeitando o filtro)
  loaderSources(s, o, cx, cy) {
    const out = [];
    if (!s.isInterior(cx, cy)) return out;
    const obj = s.objectAt(cx, cy);
    if (obj && obj !== o && (obj.type === 'expando' || obj.type === 'ammo_crate')) {
      const st = obj.store;
      if (st && st.item && st.n > 0 && this.loaderAllows(o, st.item))
        out.push({ item: st.item, n: st.n, take: (k) => { st.n -= k; if (st.n <= 0) { st.item = null; st.n = 0; } } });
      return out;
    }
    if (obj && obj.type === 'loader') return out;
    const x0 = cx * TS, y0 = cy * TS;
    for (const it of s.items) {
      if (it.n <= 0 || !this.loaderAllows(o, it.item)) continue;
      const mx = it.x + it.w / 2, my = it.y + it.h / 2;
      if (mx < x0 || mx >= x0 + TS || my < y0 || my >= y0 + TS) continue;
      out.push({ item: it.item, n: it.n, take: (k) => { it.n -= k; if (it.n <= 0) s.items.splice(s.items.indexOf(it), 1); } });
    }
    return out;
  }

  // quanto cabe na casa de saída e como entregar; null = não dá para entregar ali
  loaderDest(s, o, cx, cy, item) {
    const d = ITEMS[item];
    const t = s.turretAtHull(cx, cy);
    if (t) {
      if (d.kind !== 'ammo') return null;
      const a = AMMO[d.ammo], cap = TURRETS[t.type].cap;
      if (t.ammo > 0 && t.ammoType && t.ammoType !== d.ammo) return null;
      return { room: Math.floor((cap - t.ammo) / a.shots), put: (k) => { t.ammo += a.shots * k; t.ammoType = d.ammo; } };
    }
    if (!s.isInterior(cx, cy)) return null;
    const obj = s.objectAt(cx, cy);
    if (obj && obj !== o) {
      const od = OBJECTS[obj.type];
      if (od.fab) {
        if (!FAB_MATS.includes(item)) return null;
        return { room: FAB_CAP - (obj.mats[item] || 0), put: (k) => { obj.mats[item] = (obj.mats[item] || 0) + k; } };
      }
      switch (obj.type) {
        case 'ammo_crate':
        case 'expando': {
          if (obj.type === 'ammo_crate' && d.kind !== 'ammo') return null;
          const st = obj.store || (obj.store = { item: null, n: 0 });
          if (st.item && st.item !== item) return null;
          return { room: expandoCap(item) - st.n, put: (k) => { st.item = item; st.n += k; } };
        }
        case 'shield_gen':
          if (item !== 'booster' && item !== 'flux') return null;
          return { room: d.stack, put: (k) => { obj.fuel = (obj.fuel || 0) + k * (item === 'booster' ? 60 : 300); } };
        case 'recycler': {
          const v = recycleValue(item);
          if (!Object.keys(v).length) return null;
          return { room: d.stack, put: (k) => { for (const m in v) if (v[m] * k > 0) s.spawnItem(m, v[m] * k, (obj.x + 1) * TS, obj.y * TS, rand(-40, 40), -150); this.sound('break', s.cx, s.cy); } };
        }
        case 'ejector':
          return { room: d.stack, put: (k) => this.ejectFromShip(s, obj, item, k) };
        case 'loader':
          // passa para outro Carregador (corrente de Carregadores)
          if (obj.carry || !this.loaderAllows(obj, item)) return null;
          return { room: d.stack, put: (k) => { obj.carry = { item, n: k }; obj.lt = 0; obj.seq = (obj.seq || 0) + 1; obj.wait = false; } };
      }
    }
    if (s.solidAt(cx, cy)) return null;
    // chão: só se o filtro "só em máquinas" estiver desligado, e um item por vez naquela casa
    if (o.only) return null;
    const x0 = cx * TS, y0 = cy * TS;
    if (s.items.some((it) => it.x + it.w > x0 && it.x < x0 + TS && it.y + it.h > y0 && it.y < y0 + TS)) return null;
    return { room: d.stack, put: (k) => s.spawnItem(item, k, x0 + TS / 2, y0 + TS / 2, 0, 0) };
  }

  updateLoader(s, o, dt) {
    const [ix, iy] = LOADER_DIRS[o.din], [ox, oy] = LOADER_DIRS[o.dout];
    if (o.carry) {
      o.lt = (o.lt || 0) + dt;
      if (o.lt < LOADER_TIME) return;
      const d = this.loaderDest(s, o, o.x + ox, o.y + oy, o.carry.item);
      if (d && d.room > 0) {
        const k = Math.min(d.room, o.carry.n);
        d.put(k);
        o.carry.n -= k;
        if (o.carry.n <= 0) { o.carry = null; o.lt = 0; }
        else o.carry = { item: o.carry.item, n: o.carry.n };   // novo objeto: o cliente vê a mudança
      }
      o.wait = !!o.carry;   // segurando, esperando espaço na saída
      return;
    }
    o.cool = (o.cool || 0) - dt;
    if (o.cool > 0) return;
    o.cool = 0.2;
    // pega o primeiro item da entrada que a saída aceita
    let src = null;
    for (const c of this.loaderSources(s, o, o.x + ix, o.y + iy)) {
      const d = this.loaderDest(s, o, o.x + ox, o.y + oy, c.item);
      if (d && d.room > 0) { src = c; break; }
    }
    if (!src) return;
    const k = Math.min(src.n, ITEMS[src.item].stack);
    src.take(k);
    o.carry = { item: src.item, n: k }; o.lt = 0; o.wait = false; o.seq = (o.seq || 0) + 1;
  }

  // ---------- Caixa de Munição + Trilho + carrinho ----------
  // Primeira casa de trilho encostada na caixa (lados, sem diagonais).
  railStart(s, o) {
    const d = OBJECTS[o.type], cand = [];
    for (let x = o.x; x < o.x + d.w; x++) cand.push([x, o.y - 1], [x, o.y + d.h]);
    for (let y = o.y; y < o.y + d.h; y++) cand.push([o.x - 1, y], [o.x + d.w, y]);
    return cand.find(([x, y]) => s.get(x, y) === T.RAIL) || null;
  }
  // "Tour" completo do trilho a partir de start: entra em cada ramo até a ponta e volta,
  // terminando no começo. Trilhos se ligam pelos 4 lados.
  railRoute(s, start) {
    const key = (x, y) => y * 1000 + x;
    const seen = new Set([key(...start)]), route = [start];
    const stack = [[start[0], start[1], 0]];
    const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[2] >= 4) {
        stack.pop();
        if (stack.length) { const p = stack[stack.length - 1]; route.push([p[0], p[1]]); }   // volta para o pai
        continue;
      }
      const [dx, dy] = D4[top[2]++];
      const nx = top[0] + dx, ny = top[1] + dy;
      if (s.get(nx, ny) !== T.RAIL || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      route.push([nx, ny]);
      stack.push([nx, ny, 0]);
    }
    return route;
  }
  // devolve a munição de um carrinho para a caixa (ou solta no chão se a caixa mudou de tipo)
  cartReturn(s, o) {
    const c = o.cart; o.cart = null;
    if (!c || c.n <= 0) return;
    const st = o.store;
    if (!st.item || st.item === c.item) { st.item = c.item; st.n += c.n; }
    else s.spawnItem(c.item, c.n, c.px || (o.x + 1) * TS, c.py || o.y * TS, 0, -60);
  }
  // reabastece as torretas do casco ao lado da casa (cx, cy); devolve quantas munições entregou
  cartRefill(s, cart, cx, cy) {
    let used = 0;
    const done = new Set();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const t = s.turretAtHull(cx + dx, cy + dy);
      if (!t || done.has(t)) continue;
      done.add(t);
      const ammo = ITEMS[cart.item].ammo, a = AMMO[ammo], cap = TURRETS[t.type].cap;
      if (t.ammo > 0 && t.ammoType && t.ammoType !== ammo) continue;   // outro tipo: só se estiver vazia
      while (cart.n > 0 && t.ammo + a.shots <= cap) { t.ammo += a.shots; t.ammoType = ammo; cart.n--; used++; }
    }
    return used;
  }
  updateCrate(s, o, dt) {
    const st = o.store;
    let c = o.cart;
    if (!c) {
      o.cool = (o.cool || 0) - dt;
      if (o.cool > 0 || !st.item || st.n <= 0) return;
      const start = this.railStart(s, o);
      if (!start) { o.cool = 0.5; return; }
      const k = Math.min(CART_CAP, st.n);
      st.n -= k; const item = st.item; if (st.n <= 0) { st.item = null; st.n = 0; }
      c = o.cart = { item, n: k, route: this.railRoute(s, start), seg: 0, f: 0, pause: 0.4, gave: 0 };
      c.px = (start[0] + 0.5) * TS; c.py = (start[1] + 0.5) * TS;
      c.gave += this.cartRefill(s, c, start[0], start[1]);   // a casa de saída também conta
      if (c.n <= 0) { o.cart = null; o.cool = 0.6; }
      return;
    }
    if (c.pause > 0) { c.pause -= dt; return; }
    const R = c.route;
    if (c.seg >= R.length - 1) {
      // terminou a volta: recalcula o trilho (pode ter mudado) e sai de novo
      const start = this.railStart(s, o);
      if (!start) { this.cartReturn(s, o); return; }
      // de volta na caixa: completa a carga com a munição dela (se for do mesmo tipo)
      if (st.item === c.item && st.n > 0 && c.n < CART_CAP) {
        const k = Math.min(CART_CAP - c.n, st.n);
        c.n += k; st.n -= k;
        if (st.n <= 0) { st.item = null; st.n = 0; }
        c.gave = c.gave || 1;   // recarregou: não precisa esperar a pausa longa
      }
      c.route = this.railRoute(s, start); c.seg = 0; c.f = 0;
      c.pause = c.gave ? 0.6 : 2.5;   // volta sem entregar nada: espera mais antes da próxima
      c.gave = 0;
      return;
    }
    c.f += dt * CART_SPEED / TS;
    while (c.f >= 1 && c.seg < R.length - 1) {
      c.f -= 1; c.seg++;
      const [x, y] = R[c.seg];
      if (s.get(x, y) !== T.RAIL) { this.cartReturn(s, o); o.cool = 0.5; return; }   // trilho removido no caminho
      const used = this.cartRefill(s, c, x, y);
      if (used) { c.gave += used; c.pause = 0.35; c.f = 0; this.sound('load', s.cx, s.cy); }
      if (c.n <= 0) { o.cart = null; o.cool = 0.6; return; }   // acabou: some, e a caixa solta outro
      if (c.pause > 0) break;
    }
    // posição (px) para desenhar: entre a casa atual e a próxima
    const a = R[c.seg], b = R[Math.min(c.seg + 1, R.length - 1)], f = Math.min(1, c.f);
    c.px = (a[0] + 0.5 + (b[0] - a[0]) * f) * TS; c.py = (a[1] + 0.5 + (b[1] - a[1]) * f) * TS;
    c.dir = b[0] !== a[0] ? Math.sign(b[0] - a[0]) : (c.dir || 1);
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
    o.progress = Math.min(r.t, o.progress + dt);
    if (o.progress >= r.t) {
      const spot = this.fabOutputSpot(s, o, r.out, r.n);
      if (!spot) { o.blocked = true; return; }   // sem espaço: espera liberar
      o.blocked = false;
      if (spot.it) spot.it.n += r.n;
      else {
        const it = s.spawnItem(r.out, r.n, spot.x + 5, spot.y + 5, 0, 0);
        it.x = spot.x; it.y = spot.y;
      }
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
          if (!this.zone.safe && !a.noTerrain) this.damageTerrain(tx, ty, b.dmg, b.x, b.y);
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
        if (a.mining) continue;   // feixe de mineração atravessa naves e bots sem causar dano
        for (const sh of this.ships) {
          if (!this.canHitShip(b, sh)) continue;
          if (b.x < sh.x || b.y < sh.y || b.x > sh.x + sh.pw || b.y > sh.y + sh.ph) continue;
          this.hitShip(sh, b, px, py);
          alive = false; break;
        }
        if (!alive) break;
        for (const { p } of this.eva || []) {
          if (this.zone.safe || (b.team === 'player' && !this.zone.pvp)) continue;
          if (b.x < p.x - 2 || b.y < p.y - 2 || b.x > p.x + p.w + 2 || b.y > p.y + p.h + 2) continue;
          if (b.ownerId && p.ship === null && this.shipById(b.ownerId) && this.shipById(b.ownerId).crew && this.shipById(b.ownerId).crew.some((c) => c.player === p)) continue;   // nave dele
          p.hp -= b.dmg * 0.5;
          this.spark(b.x, b.y, '#ff7070', 8, 160);
          this.sound('hullhit', b.x, b.y);
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
      if (a.decay) b.dmg = Math.max(0.5, (b.dmg0 ?? a.dmg) * (1 - b.age / a.life));
      if (alive && b.life <= 0) {
        alive = false;
        if (a.flak) {
          for (let k = 0; k < a.flak; k++) {
            const ang = (k / a.flak) * Math.PI * 2 + rand(-0.2, 0.2);
            this.bullets.push({
              id: uid(), x: b.x, y: b.y, vx: Math.cos(ang) * 520, vy: Math.sin(ang) * 520, life: 0.35, ammo: 'scatter',
              dmg: b.dmg0 ?? a.dmg, dmg0: b.dmg0 ?? a.dmg, team: b.team, ownerId: b.ownerId, r: 2, bounces: 0, pierce: 0, age: 0, bounced: false,
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
      const k = a.knock * (b.knockMul || 1) / Math.sqrt(sh.mass) * 6;
      sh.vx += dx * k; sh.vy += dy * k;
    }
    if (this.zone.safe || sh.team === 'derelict') { this.spark(b.x, b.y, '#9fd8ff', 4); return; }   // abandonadas não quebram
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
          // só entra o que alguma escotilha aberta aceita; o resto fica na caixa, no espaço
          const open = hatches.filter((h) => !this.hatchBlocked(s, h));
          const take = c.items.filter(([item]) => open.some((h) => this.hatchAccepts(h, item)));
          if (!take.length) continue;
          for (const it of take) s.cargoQueue.push(it.slice());
          c.items = c.items.filter((it) => !take.includes(it));
          if (!c.items.length) c.dead = true;
          else {
            // sobra: fica flutuando e é empurrada para longe da nave (não é recoletada na hora)
            c.fromId = s.id; c.age = 0;
            const dx = c.x - s.cx, dy = c.y - s.cy, d = Math.hypot(dx, dy) || 1;
            c.vx += (dx / d) * 90; c.vy += (dy / d) * 90;
          }
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

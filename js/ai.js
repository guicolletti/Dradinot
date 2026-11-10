// ============================================================
//  IA: bots circulares e naves piratas
// ============================================================
'use strict';

function makeBot(type, x, y) {
  const d = BOTS[type];
  return {
    id: uid(), type, x, y, vx: 0, vy: 0, r: d.r, hp: d.hp, maxHp: d.hp,
    cool: rand(0.5, 2), burstLeft: 0, burstT: 0, angle: rand(0, 6.28), wander: rand(0, 6.28),
    orbit: Math.random() < 0.5 ? 1 : -1, flash: 0, dead: false, spin: rand(-2, 2), rot: 0,
  };
}

function lineOfSight(world, x1, y1, x2, y2) {
  const d = dist(x1, y1, x2, y2);
  const steps = Math.ceil(d / (WTS / 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (world.solidW(lerp(x1, x2, t), lerp(y1, y2, t))) return false;
  }
  return true;
}

function leadAim(sx, sy, tx, ty, tvx, tvy, speed) {
  const d = dist(sx, sy, tx, ty);
  const t = d / speed;
  return Math.atan2(ty + tvy * t - sy, tx + tvx * t - sx);
}

function updateBot(world, b, dt) {
  const d = BOTS[b.type];
  b.flash = Math.max(0, b.flash - dt * 4);
  b.rot += b.spin * dt;
  let target = null, td = Infinity;
  if (!world.zone.safe) {
    for (const s of world.ships) {
      if (s.team !== 'player') continue;
      const dd = dist(b.x, b.y, s.cx, s.cy);
      if (dd < d.range * 1.4 && dd < td) { td = dd; target = s; }
    }
  }
  let dvx = 0, dvy = 0;
  if (target) {
    const a = Math.atan2(target.cy - b.y, target.cx - b.x);
    const want = (b.type === 'green' ? 280 : 400) + Math.max(target.pw, target.ph) * 0.4;
    const radial = td > want + 60 ? 1 : td < want - 60 ? -1 : 0;
    dvx = Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * b.orbit * 0.7;
    dvy = Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * b.orbit * 0.7;
    if (Math.random() < dt * 0.15) b.orbit *= -1;
    // disparo
    b.cool -= dt;
    const am = AMMO[d.ammo];
    b.angle = leadAim(b.x, b.y, target.cx, target.cy, target.vx, target.vy, am.speed);
    if (b.burstLeft > 0) {
      b.burstT -= dt;
      if (b.burstT <= 0) { b.burstLeft--; b.burstT = 0.12; world.fireBullet(b.x + Math.cos(b.angle) * b.r, b.y + Math.sin(b.angle) * b.r, b.angle, d.ammo, 'bot', b.id); }
    } else if (b.cool <= 0 && td < d.range && lineOfSight(world, b.x, b.y, target.cx, target.cy)) {
      b.cool = d.rof * rand(0.9, 1.4) + (d.burst ? 1.4 : 0);
      world.fireBullet(b.x + Math.cos(b.angle) * b.r, b.y + Math.sin(b.angle) * b.r, b.angle, d.ammo, 'bot', b.id);
      if (d.burst) { b.burstLeft = d.burst - 1; b.burstT = 0.12; }
      world.game.sfx('botshoot', b.x, b.y);
    }
  } else {
    b.wander += rand(-1, 1) * dt;
    dvx = Math.cos(b.wander) * 0.35; dvy = Math.sin(b.wander) * 0.35;
  }
  // desvia do terreno
  const ax = b.x + b.vx * 0.5, ay = b.y + b.vy * 0.5;
  if (world.solidW(ax, ay)) { dvx = -b.vx; dvy = -b.vy; b.wander += Math.PI; }
  const l = Math.hypot(dvx, dvy) || 1;
  const sp = d.speed * Math.min(1, l);
  const tvx = (dvx / l) * sp, tvy = (dvy / l) * sp;
  b.vx += (tvx - b.vx) * Math.min(1, dt * 2);
  b.vy += (tvy - b.vy) * Math.min(1, dt * 2);
  b.x += b.vx * dt; b.y += b.vy * dt;
  // empurra para fora do terreno
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const px = b.x + Math.cos(a) * b.r, py = b.y + Math.sin(a) * b.r;
    if (world.solidW(px, py)) { b.x -= Math.cos(a) * 2; b.y -= Math.sin(a) * 2; }
  }
  // colisão com naves
  for (const s of world.ships) {
    const nx = clamp(b.x, s.x, s.x + s.pw), ny = clamp(b.y, s.y, s.y + s.ph);
    const dd = dist(b.x, b.y, nx, ny);
    if (dd < b.r) {
      const a = dd > 0.01 ? Math.atan2(b.y - ny, b.x - nx) : Math.atan2(b.y - s.cy, b.x - s.cx);
      b.x = nx + Math.cos(a) * b.r; b.y = ny + Math.sin(a) * b.r;
      b.vx = Math.cos(a) * 150; b.vy = Math.sin(a) * 150;
    }
  }
}

function hitBot(world, bot, b) {
  const a = AMMO[b.ammo];
  bot.hp -= b.dmg;
  bot.flash = 1;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  if (a.knock) { bot.vx += (b.vx / sp) * a.knock * 1.5; bot.vy += (b.vy / sp) * a.knock * 1.5; }
  else { bot.vx += (b.vx / sp) * 40; bot.vy += (b.vy / sp) * 40; }
  world.spark(b.x, b.y, BOTS[bot.type].color, 6);
  world.game.sfx('bothit', b.x, b.y);
  if (bot.hp <= 0 && !bot.dead) {
    bot.dead = true;
    world.explosion(bot.x, bot.y, bot.r / 24);
    world.spawnCrate(bot.x, bot.y, LOOT_TABLES[BOTS[bot.type].drops]());
    world.game.stats.bots++;
  }
}

// ---------- naves piratas ----------
const PIRATE_NAMES = ['Corsário Rubro', 'Ferro Velho', 'Viúva Negra', 'Maré Sombria', 'Gancho Torto', 'Caveira de Aço',
  'Tubarão Cinza', 'Fúria Estelar', 'Lâmina Fria', 'Saqueador', 'Ossada', 'Cometa Sujo', 'Brasa', 'Pólvora'];

function buildPirateShip(size) {
  const dims = { small: [18, 10], medium: [26, 14], large: [34, 18], boss: [46, 24] }[size];
  const [w, h] = dims;
  const s = new Ship(w, h, { name: size === 'boss' ? 'Couraçado Pirata' : choice(PIRATE_NAMES), team: 'pirate', color: size === 'boss' ? '#6a2f3a' : '#6a4040' });
  s.boss = size === 'boss';
  // conveses
  for (let y = h - 7; y > 2; y -= 6) {
    for (let x = 1; x < w - 1; x++) s.set(x, y, T.WALKWAY);
    const lx = randInt(3, w - 4);
    for (let yy = y; yy < Math.min(h - 1, y + 6); yy++) s.set(lx, yy, T.LADDER);
  }
  // blocos de reforço
  for (let i = 0; i < w * h * 0.04; i++) {
    const x = randInt(1, w - 2), y = randInt(1, h - 2);
    if (s.get(x, y) === T.EMPTY) s.set(x, y, T.BLOCK);
  }
  s.placeObject('helm', 2, h - 3);
  if (s.canPlaceObject('fab_munitions', 6, h - 3)) s.placeObject('fab_munitions', 6, h - 3);
  if (s.canPlaceObject('hatch', 10, h - 3)) s.placeObject('hatch', 10, h - 3);
  // torretas
  const types = size === 'small' ? ['turret', 'turret'] : ['turret', 'turret_auto', 'turret_burst', 'turret_rc'];
  const ammos = ['standard', 'standard', 'standard', 'scatter', 'flak', 'sniper'];
  const gap = size === 'boss' ? 6 : size === 'large' ? 10 : 8;
  for (const side of ['top', 'bottom']) {
    for (let p = 3; p <= w - 4; p += gap) if (s.canPlaceTurret(side, p)) s.placeTurret(choice(types), side, p, { ammoType: choice(ammos), ammo: 999 });
  }
  for (const side of ['left', 'right']) {
    for (let p = 3; p <= h - 4; p += gap) if (s.canPlaceTurret(side, p)) s.placeTurret(choice(types), side, p, { ammoType: choice(ammos), ammo: 999 });
  }
  s.recalc();
  if (size === 'boss') { s.maxShield *= 2.5; s.maxIntegrity *= 2; }
  s.shield = s.maxShield;
  s.integrity = s.maxIntegrity;
  s.dmgMul = size === 'boss' ? 0.8 : 0.55;
  s.ai = { strafe: 1, strafeT: rand(2, 5), wp: null, aggro: 0 };
  return s;
}

function updatePirate(world, s, dt) {
  const ai = s.ai;
  const ps = world.game.ship;
  let target = null;
  if (ps && !ps.dead && !world.zone.safe) {
    const d = dist(s.cx, s.cy, ps.cx, ps.cy);
    if (d < 2000 || ai.aggro > 0) target = ps;
  }
  ai.aggro = Math.max(0, ai.aggro - dt);
  if (s.lastHit !== undefined && s.lastHit < 0.1) ai.aggro = 15;
  let tx = 0, ty = 0;
  if (target) {
    const d = dist(s.cx, s.cy, target.cx, target.cy);
    const want = 520 + Math.max(s.pw, s.ph) * 0.6;
    const a = Math.atan2(target.cy - s.cy, target.cx - s.cx);
    const radial = d > want + 80 ? 1 : d < want - 80 ? -0.8 : 0;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe *= -1; ai.strafeT = rand(2, 6); }
    tx = Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * ai.strafe * 0.6;
    ty = Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * ai.strafe * 0.6;
  } else {
    if (!ai.wp || dist(s.cx, s.cy, ai.wp.x, ai.wp.y) < 200) ai.wp = { x: rand(WTS * 4, world.size - WTS * 4), y: rand(WTS * 4, world.size - WTS * 4) };
    const a = Math.atan2(ai.wp.y - s.cy, ai.wp.x - s.cx);
    tx = Math.cos(a) * 0.5; ty = Math.sin(a) * 0.5;
  }
  // evita terreno à frente
  const look = 0.9;
  if (world.rectHitsTerrain(s.x + s.vx * look, s.y + s.vy * look, s.pw, s.ph)) {
    tx = -sign(s.vx) || rand(-1, 1); ty = -sign(s.vy) || rand(-1, 1);
    ai.wp = null; ai.strafe *= -1;
  }
  const l = Math.hypot(tx, ty);
  if (l > 1) { tx /= l; ty /= l; }
  s.thrust.x = tx * 0.75; s.thrust.y = ty * 0.75;

  // torretas
  for (const t of s.turrets) {
    let aim = SIDE_ANGLE[t.side];
    let canFire = false;
    if (target) {
      const p = s.turretWorld(t);
      const am = AMMO[t.ammoType || 'standard'];
      const raw = leadAim(p.x, p.y, target.cx, target.cy, target.vx - s.vx, target.vy - s.vy, am.speed);
      aim = s.clampTurretAngle(t, raw);
      const dd = dist(p.x, p.y, target.cx, target.cy);
      canFire = Math.abs(angDiff(aim, raw)) < 0.05 && dd < am.speed * am.life * 0.95 && dd < 1300;
      if (canFire && Math.random() < 0.15) canFire = lineOfSight(world, p.x, p.y, target.cx, target.cy);
      else if (canFire) canFire = t._los !== false;
      t._los = canFire;
    }
    t.angle += clamp(angDiff(t.angle, aim), -3 * dt, 3 * dt);
    if (canFire && t.cool <= 0 && Math.abs(angDiff(t.angle, aim)) < 0.12) {
      if (world.fireTurret(s, t, true)) t.cool *= s.boss ? 1.8 : 2.6;
    }
  }
}

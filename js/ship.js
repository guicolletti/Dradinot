// ============================================================
//  Nave: grade de tiles, objetos, torretas, itens internos,
//  escudo/integridade, redimensionamento e serialização.
// ============================================================
'use strict';

const SIDES = ['top', 'right', 'bottom', 'left'];
const SIDE_ANGLE = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI };

class Ship {
  constructor(w, h, opts = {}) {
    this.id = uid();
    this.name = opts.name || 'Nave';
    this.team = opts.team || 'player';
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.tileHp = new Float32Array(w * h);
    this.objMap = new Int32Array(w * h).fill(-1);
    this.objects = [];
    this.turrets = [];
    this.items = [];        // itens soltos dentro da nave
    this.cargoQueue = [];   // itens aguardando sair pelas escotilhas
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.thrust = { x: 0, y: 0 };
    this.pilot = null;
    this.dead = false;
    this.hitFlash = 0;
    this.color = opts.color || '#56637a';
    this.key = opts.key || null;
    this.rev = 0;
    this.stats = { bots: 0, ships: 0 };
    this.crew = [];
    this.buildHull();
    this.recalc();
    this.shield = this.maxShield;
    this.integrity = this.maxIntegrity;
  }

  // ---------- grade ----------
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isHull(x, y) { return x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1; }
  isInterior(x, y) { return x > 0 && y > 0 && x < this.w - 1 && y < this.h - 1; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.HULL; }
  set(x, y, t) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.tiles[i] = t;
    this.tileHp[i] = TILE_INFO[t].hp || 0;
    this.rev++;
  }

  buildHull() {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        this.set(x, y, this.isHull(x, y) ? T.HULL : T.EMPTY);
  }

  rebuildObjMap() {
    this.objMap.fill(-1);
    this.objects.forEach((o, i) => {
      const d = OBJECTS[o.type];
      for (let yy = 0; yy < d.h; yy++)
        for (let xx = 0; xx < d.w; xx++)
          if (this.inBounds(o.x + xx, o.y + yy)) this.objMap[this.idx(o.x + xx, o.y + yy)] = i;
    });
  }

  objectAt(cx, cy) {
    if (!this.inBounds(cx, cy)) return null;
    const i = this.objMap[this.idx(cx, cy)];
    return i >= 0 ? this.objects[i] : null;
  }

  // sólido para jogadores
  solidAt(cx, cy) {
    const t = this.get(cx, cy);
    if (t === T.HULL || t === T.BLOCK) return true;
    const o = this.objectAt(cx, cy);
    if (o && o.type === 'door' && !o.open) return true;
    return false;
  }
  // sólido para itens (redes também bloqueiam itens)
  solidForItem(cx, cy) {
    return this.solidAt(cx, cy) || this.get(cx, cy) === T.NET;
  }
  platformAt(cx, cy) {
    const t = this.get(cx, cy);
    return t === T.WALKWAY || (t === T.LADDER && this.get(cx, cy - 1) !== T.LADDER);
  }
  ladderAt(cx, cy) { return this.get(cx, cy) === T.LADDER; }
  supportAt(cx, cy) {
    const t = this.get(cx, cy);
    return t === T.HULL || t === T.BLOCK || t === T.WALKWAY;
  }

  // ---------- estatísticas ----------
  recalc() {
    const area = (this.w - 2) * (this.h - 2);
    this.maxShield = Math.round(200 + area * 1.1);
    this.maxIntegrity = Math.round(120 + area * 0.5);
    let blocks = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] !== T.EMPTY) blocks++;
    this.mass = 40 + blocks * 0.25 + this.objects.length * 2 + this.turrets.length * 3;
    this.accel = clamp(36000 / this.mass, 140, 900);
    this.maxSpeed = clamp(520 - this.mass * 0.6, 240, 520);
    if (this.shield > this.maxShield) this.shield = this.maxShield;
    if (this.integrity > this.maxIntegrity) this.integrity = this.maxIntegrity;
  }

  get pw() { return this.w * TS; }
  get ph() { return this.h * TS; }
  get cx() { return this.x + this.pw / 2; }
  get cy() { return this.y + this.ph / 2; }

  // ---------- objetos ----------
  canPlaceObject(type, cx, cy) {
    const d = OBJECTS[type];
    for (let yy = 0; yy < d.h; yy++)
      for (let xx = 0; xx < d.w; xx++) {
        const x = cx + xx, y = cy + yy;
        if (!this.isInterior(x, y)) return false;
        if (this.get(x, y) !== T.EMPTY) return false;
        if (this.objectAt(x, y)) return false;
      }
    if (d.floor) {
      for (let xx = 0; xx < d.w; xx++) if (!this.supportAt(cx + xx, cy + d.h)) return false;
    }
    return true;
  }

  placeObject(type, cx, cy, extra = {}) {
    const o = Object.assign({ id: uid(), type, x: cx, y: cy, hp: OBJECTS[type].hp }, extra);
    if (OBJECTS[type].fab) {
      o.mats = o.mats || { metal: 0, explosives: 0, flux: 0 };
      o.queue = o.queue || [];
      o.progress = o.progress || 0;
    }
    if (type === 'expando') o.inv = o.inv || new Array(24).fill(null);
    if (type === 'door') o.open = !!o.open;
    if (type === 'shield_gen') o.fuel = o.fuel || 0;
    if (type === 'hatch') o.mode = o.mode || 'all';
    if (type === 'hatch' || type === 'ejector') o.cool = 0;
    this.objects.push(o);
    this.rev++;
    this.rebuildObjMap();
    this.recalc();
    return o;
  }

  removeObject(o) {
    const i = this.objects.indexOf(o);
    if (i >= 0) this.objects.splice(i, 1);
    this.rev++;
    this.rebuildObjMap();
    this.recalc();
  }

  objectsOf(type) { return this.objects.filter((o) => o.type === type); }

  // ---------- torretas ----------
  sideLen(side) { return side === 'top' || side === 'bottom' ? this.w : this.h; }

  // converte célula do casco em (lado, posição)
  hullCellToSide(cx, cy) {
    if (!this.isHull(cx, cy)) return null;
    const corner = (cx === 0 || cx === this.w - 1) && (cy === 0 || cy === this.h - 1);
    if (corner) return null;
    if (cy === 0) return { side: 'top', pos: cx };
    if (cy === this.h - 1) return { side: 'bottom', pos: cx };
    if (cx === 0) return { side: 'left', pos: cy };
    return { side: 'right', pos: cy };
  }

  canPlaceTurret(side, pos) {
    const len = this.sideLen(side);
    if (pos - 1 < 1 || pos + 1 > len - 2) return false;
    for (const t of this.turrets) if (t.side === side && Math.abs(t.pos - pos) < 3) return false;
    return true;
  }

  placeTurret(type, side, pos, extra = {}) {
    const t = Object.assign({
      id: uid(), type, side, pos,
      ammoType: null, ammo: 0,
      angle: SIDE_ANGLE[side], cool: 0, burstLeft: 0, burstT: 0, hp: 60,
    }, extra);
    this.turrets.push(t);
    this.rev++;
    this.recalc();
    return t;
  }

  removeTurret(t) {
    const i = this.turrets.indexOf(t);
    if (i >= 0) this.turrets.splice(i, 1);
    this.rev++;
    this.recalc();
  }

  turretAtHull(cx, cy) {
    const s = this.hullCellToSide(cx, cy);
    if (!s) return null;
    return this.turrets.find((t) => t.side === s.side && Math.abs(t.pos - s.pos) <= 1) || null;
  }

  // posição local (px) do centro da torreta
  turretLocal(t) {
    const o = 3;
    switch (t.side) {
      case 'top': return { x: (t.pos + 0.5) * TS, y: -o };
      case 'bottom': return { x: (t.pos + 0.5) * TS, y: this.ph + o };
      case 'left': return { x: -o, y: (t.pos + 0.5) * TS };
      default: return { x: this.pw + o, y: (t.pos + 0.5) * TS };
    }
  }
  turretWorld(t) {
    const l = this.turretLocal(t);
    return { x: this.x + l.x, y: this.y + l.y };
  }
  // limita a mira ao semiplano externo do lado
  clampTurretAngle(t, a) {
    const base = SIDE_ANGLE[t.side];
    const d = clamp(angDiff(base, a), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    return base + d;
  }

  // ---------- itens internos ----------
  spawnItem(item, n, lx, ly, vx = 0, vy = 0) {
    if (n <= 0) return null;
    const it = { id: uid(), item, n, x: lx - 5, y: ly - 5, w: 10, h: 10, vx, vy, age: 0, rot: 0 };
    this.items.push(it);
    if (this.items.length > 220) this.items.shift();
    return it;
  }

  // ---------- redimensionamento ----------
  // axis: 'x' ou 'y'; dir: +1 cresce, -1 encolhe.
  // Cresce para a direita (x) ou para cima (y).
  resize(axis, dir) {
    const nw = this.w + (axis === 'x' ? dir : 0);
    const nh = this.h + (axis === 'y' ? dir : 0);
    if (nw < 6 || nh < 6) return 'A nave não pode ficar menor.';
    if (nw > MAX_SHIP_TILES || nh > MAX_SHIP_TILES) return 'Tamanho máximo atingido (80x80).';
    const oy = axis === 'y' ? dir : 0;  // deslocamento vertical do conteúdo

    if (dir < 0) {
      // verifica se a coluna/linha a ser removida está vazia
      if (axis === 'x') {
        const cx = this.w - 2;
        for (let y = 1; y < this.h - 1; y++)
          if (this.get(cx, y) !== T.EMPTY || this.objectAt(cx, y)) return 'Esvazie a coluna da direita antes de encolher.';
        for (const t of this.turrets)
          if ((t.side === 'top' || t.side === 'bottom') && t.pos + 1 > nw - 2) return 'Remova as torretas na borda direita primeiro.';
      } else {
        const cy = 1;
        for (let x = 1; x < this.w - 1; x++)
          if (this.get(x, cy) !== T.EMPTY || this.objectAt(x, cy)) return 'Esvazie a linha de cima antes de encolher.';
        for (const t of this.turrets)
          if ((t.side === 'left' || t.side === 'right') && t.pos - 1 + oy < 1) return 'Remova as torretas na borda de cima primeiro.';
      }
    }

    const old = { w: this.w, h: this.h, tiles: this.tiles, hp: this.tileHp };
    this.w = nw; this.h = nh;
    this.tiles = new Uint8Array(nw * nh);
    this.tileHp = new Float32Array(nw * nh);
    this.objMap = new Int32Array(nw * nh).fill(-1);
    this.buildHull();
    for (let y = 1; y < old.h - 1; y++)
      for (let x = 1; x < old.w - 1; x++) {
        const nx = x, ny = y + oy;
        if (this.isInterior(nx, ny)) {
          const t = old.tiles[y * old.w + x];
          this.tiles[this.idx(nx, ny)] = t;
          this.tileHp[this.idx(nx, ny)] = old.hp[y * old.w + x];
        }
      }
    for (const o of this.objects) o.y += oy;
    for (const t of this.turrets) {
      if (t.side === 'left' || t.side === 'right') t.pos += oy;
    }
    for (const it of this.items) { it.y += oy * TS; }
    this.y -= oy * TS;
    this.rebuildObjMap();
    this.recalc();
    return null;
  }

  // ---------- dano ----------
  // dano interno quando o escudo está zerado; lx,ly locais (px)
  damageInterior(lx, ly, dirx, diry, dmg) {
    this.integrity -= dmg;
    // procura o primeiro conteúdo na direção da bala
    let x = lx, y = ly;
    for (let s = 0; s < 6; s++) {
      const cx = Math.floor(x / TS), cy = Math.floor(y / TS);
      if (this.isInterior(cx, cy)) {
        const o = this.objectAt(cx, cy);
        if (o) {
          o.hp -= dmg;
          if (o.hp <= 0) return { destroyedObject: o };
          return {};
        }
        const t = this.get(cx, cy);
        if (t !== T.EMPTY) {
          const i = this.idx(cx, cy);
          this.tileHp[i] -= dmg;
          if (this.tileHp[i] <= 0) { this.set(cx, cy, T.EMPTY); this.recalc(); }
          else this.rev++;
          return {};
        }
      }
      x += dirx * TS; y += diry * TS;
    }
    return {};
  }

  // ---------- serialização ----------
  serialize() {
    return {
      name: this.name, w: this.w, h: this.h,
      tiles: Array.from(this.tiles),
      objects: this.objects.map((o) => JSON.parse(JSON.stringify(o))),
      turrets: this.turrets.map((t) => ({ type: t.type, side: t.side, pos: t.pos, ammoType: t.ammoType, ammo: t.ammo })),
      items: this.items.map((i) => ({ item: i.item, n: i.n, x: i.x, y: i.y })),
      cargoQueue: this.cargoQueue.slice(),
      shield: this.shield, integrity: this.integrity,
      stats: this.stats, color: this.color,
    };
  }

  // ---------- rede ----------
  // estrutura (enviada só quando rev muda)
  netStruct() {
    let tiles = '';
    for (let i = 0; i < this.tiles.length; i++) tiles += this.tiles[i];
    const thp = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t && t !== T.HULL && this.tileHp[i] < TILE_INFO[t].hp) thp.push([i, Math.round(this.tileHp[i])]);
    }
    return {
      id: this.id, name: this.name, team: this.team, color: this.color, boss: !!this.boss,
      w: this.w, h: this.h, tiles, thp, tu: this.turrets.map((t) => [t.type, t.side, t.pos]), rev: this.rev,
    };
  }

  static fromStruct(d) {
    const s = new Ship(d.w, d.h, { name: d.name, team: d.team, color: d.color });
    s.id = d.id;
    s.applyStruct(d);
    return s;
  }

  applyStruct(d) {
    this.name = d.name; this.team = d.team; this.color = d.color; this.boss = d.boss;
    if (d.w !== this.w || d.h !== this.h) {
      this.w = d.w; this.h = d.h;
      this.tiles = new Uint8Array(d.w * d.h);
      this.tileHp = new Float32Array(d.w * d.h);
      this.objMap = new Int32Array(d.w * d.h).fill(-1);
    }
    for (let i = 0; i < d.tiles.length; i++) { const t = d.tiles.charCodeAt(i) - 48; this.tiles[i] = t; this.tileHp[i] = TILE_INFO[t].hp || 0; }
    for (const [i, hp] of d.thp) this.tileHp[i] = hp;
    const old = this.turrets;
    this.turrets = d.tu.map(([type, side, pos], k) => {
      const prev = old[k] && old[k].side === side && old[k].pos === pos ? old[k] : null;
      return prev ? Object.assign(prev, { type }) : { id: uid(), type, side, pos, ammoType: null, ammo: 0, angle: SIDE_ANGLE[side], cool: 0, recoil: 0 };
    });
    this.rebuildObjMap();
    this.recalc();
    this.rev = d.rev;
  }

  static deserialize(d) {
    const s = new Ship(d.w, d.h, { name: d.name });
    s.tiles = Uint8Array.from(d.tiles);
    for (let i = 0; i < s.tiles.length; i++) s.tileHp[i] = TILE_INFO[s.tiles[i]].hp || 0;
    for (const o of d.objects) {
      const copy = Object.assign({}, o);
      delete copy.id;
      s.placeObject(o.type, o.x, o.y, copy);
    }
    for (const t of d.turrets) s.placeTurret(t.type, t.side, t.pos, { ammoType: t.ammoType, ammo: t.ammo });
    for (const i of d.items) s.items.push({ id: uid(), item: i.item, n: i.n, x: i.x, y: i.y, w: 10, h: 10, vx: 0, vy: 0, age: 0, rot: 0 });
    s.cargoQueue = d.cargoQueue || [];
    if (d.stats) s.stats = d.stats;
    if (d.color) s.color = d.color;
    s.recalc();
    s.shield = Math.min(d.shield, s.maxShield);
    s.integrity = Math.min(d.integrity, s.maxIntegrity);
    return s;
  }
}

// ---------- nave inicial ----------
function buildStarterShip() {
  const s = new Ship(11, 8, { name: 'Minha Nave' });

  // convés do meio (passarela) com abertura para escada
  for (let x = 1; x <= 3; x++) s.set(x, 4, T.WALKWAY);
  for (let x = 5; x <= 9; x++) s.set(x, 3, T.BLOCK);
  for (let y = 3; y <= 6; y++) s.set(4, y, T.LADDER);

  for (let y = 5; y <= 6; y++) s.set(3, y, T.NET);

  s.placeObject('helm', 6, 5);

  s.placeObject('expando', 8, 1);

  const fab = s.placeObject('fab_starter', 2, 2);
  fab.mats = { metal: 40, explosives: 20, flux: 0 };

  s.placeObject('hatch', 1, 1);
  s.placeObject('ejector', 5, 4);

  s.placeObject('spawn', 8, 5);
  s.placeTurret('turret_rc', 'right', 4, { ammoType: 'standard', ammo: 15 });
  s.placeTurret('turret_rc', 'left', 4, { ammoType: 'standard', ammo: 15 });
  s.recalc();
  s.shield = s.maxShield;
  s.integrity = s.maxIntegrity;
  return s;
}

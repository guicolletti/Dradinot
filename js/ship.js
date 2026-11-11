// ============================================================
//  Nave: grade de tiles, objetos, torretas, itens internos,
//  escudo/integridade, redimensionamento e serialização.
// ============================================================
'use strict';

const SIDES = ['top', 'right', 'bottom', 'left'];

// Altura do topo / da base de uma parte sólida (trapézio) dentro do trecho [o0, o1].
// mode 'center': no ponto mais próximo de cx (personagens pisam na rampa pelo centro dos pés);
// mode 'max': o ponto mais saliente do trecho (itens apoiam no ponto mais alto da rampa).
function pieceTop(p, cx, o0, o1, mode) {
  const f = (x) => p.T0 + (p.T1 - p.T0) * (x - p.X0) / (p.X1 - p.X0);
  return mode === 'center' ? f(clamp(cx, o0, o1)) : Math.min(f(o0), f(o1));
}
function pieceBot(p, cx, o0, o1, mode) {
  const f = (x) => p.B0 + (p.B1 - p.B0) * (x - p.X0) / (p.X1 - p.X0);
  return mode === 'center' ? f(clamp(cx, o0, o1)) : Math.max(f(o0), f(o1));
}
const SIDE_ANGLE = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI };

class Ship {
  constructor(w, h, opts = {}) {
    this.id = uid();
    this.name = opts.name || 'Nave';
    this.team = opts.team || 'player';
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.shapes = new Uint8Array(w * h);   // formato de cada bloco (índice em SHAPES; 0 = inteiro)
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
  set(x, y, t, shape = 0) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.tiles[i] = t;
    this.shapes[i] = SHAPED_TILES.has(t) && shape > 0 && shape < SHAPES.length ? shape : 0;
    this.tileHp[i] = TILE_INFO[t].hp || 0;
    this.rev++;
  }
  shapeAt(x, y) { return this.inBounds(x, y) ? this.shapes[this.idx(x, y)] : 0; }

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
    if (o && ((o.type === 'door' && !o.open) || OBJECTS[o.type].solid)) return true;
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
    // objetos precisam de piso inteiro (bloco com formato não serve de apoio)
    return t === T.HULL || (t === T.BLOCK && this.shapeAt(cx, cy) === 0) || t === T.WALKWAY;
  }

  // ---------- colisão com formatos ----------
  // Partes sólidas (trapézios em pixels) das células que tocam o retângulo dado.
  // forItem: redes também contam. Casco e portas fechadas são inteiros.
  solidPieces(x0, y0, x1, y1, forItem, out = []) {
    const cx0 = Math.floor(x0 / TS), cx1 = Math.floor((x1 - 0.001) / TS);
    const cy0 = Math.floor(y0 / TS), cy1 = Math.floor((y1 - 0.001) / TS);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const t = this.get(cx, cy);
        let shape = -1;
        if (t === T.HULL) shape = 0;
        else if (t === T.BLOCK || (forItem && t === T.NET)) shape = this.shapeAt(cx, cy);
        else { const o = this.objectAt(cx, cy); if (o && ((o.type === 'door' && !o.open) || OBJECTS[o.type].solid)) shape = 0; }
        if (shape < 0) continue;
        const [a0, a1, t0, t1, b0, b1] = SHAPES[shape].p, px = cx * TS, py = cy * TS;
        out.push({ X0: px + a0 * TS, X1: px + a1 * TS, T0: py + t0 * TS, T1: py + t1 * TS, B0: py + b0 * TS, B1: py + b1 * TS });
      }
    return out;
  }
  // O retângulo encosta em algo sólido? Rampas são testadas no ponto de apoio
  // (centro do retângulo para personagens, ponto mais alto para itens), igual à física.
  boxHits(x, y, w, h, forItem, mode = forItem ? 'max' : 'center') {
    for (const p of this.solidPieces(x, y, x + w, y + h, forItem)) {
      const o0 = Math.max(x, p.X0), o1 = Math.min(x + w, p.X1);
      if (o1 - o0 <= 0.01) continue;
      const top = pieceTop(p, x + w / 2, o0, o1, mode), bot = pieceBot(p, x + w / 2, o0, o1, mode);
      if (bot - top < 0.01) continue;
      if (y < bot - 0.01 && y + h > top + 0.01) return true;
    }
    return false;
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
    if (type === 'loader') {
      o.din = clamp((o.din ?? 6) | 0, 0, 7); o.dout = clamp((o.dout ?? 2) | 0, 0, 7);
      o.filter = Array.isArray(o.filter) ? o.filter.filter((k) => ITEMS[k]) : [];
      o.only = !!o.only; o.carry = o.carry && ITEMS[o.carry.item] ? o.carry : null; o.seq = o.seq || 0;
    }
    if (type === 'gunnery') o.side = GUN_SIDES.includes(o.side) ? o.side : 'right';
    if (type === 'ammo_crate') {
      o.store = o.store || { item: null, n: 0 };
      if (o.store.item && ITEMS[o.store.item].kind !== 'ammo') o.store = { item: null, n: 0 };
      if (o.cart) {
        // carrinho que estava na rua quando a nave foi salva: a munição volta para a caixa
        if (!o.store.item || o.store.item === o.cart.item) { o.store.item = o.cart.item; o.store.n += o.cart.n; }
        o.cart = null;
      }
    }
    if (type === 'expando') {
      o.store = o.store || { item: null, n: 0 };
      if (o.inv) {
        // save antigo: fica com o tipo de item mais numeroso; o resto cai no chão ao lado da caixa
        const tot = {};
        for (const st of o.inv) if (st) tot[st.item] = (tot[st.item] || 0) + st.n;
        const keep = Object.keys(tot).sort((a, b) => tot[b] - tot[a])[0];
        if (keep) {
          const n = Math.min(tot[keep], expandoCap(keep));
          o.store = { item: keep, n };
          tot[keep] -= n;
        }
        const ex = (cx + 1) * TS, ey = (cy + 1) * TS;
        for (const it in tot) {
          let left = tot[it];
          while (left > 0) { const k = Math.min(left, ITEMS[it].stack); this.spawnItem(it, k, ex, ey, rand(-40, 40), -60); left -= k; }
        }
        delete o.inv;
      }
    }
    if (type === 'door') o.open = !!o.open;
    if (type === 'shield_gen') o.fuel = o.fuel || 0;
    if (type === 'hatch') {
      // aberta/fechada + filtro: fmode 'allow' (só estes itens) ou 'block' (todos menos estes)
      if (o.open === undefined) o.open = o.mode !== 'none';
      o.fmode = o.fmode === 'allow' ? 'allow' : 'block';
      o.filter = Array.isArray(o.filter) ? o.filter.filter((k) => ITEMS[k]) : [];
      delete o.mode;
    }
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
  // o ângulo está dentro do alcance de mira da torreta?
  turretCanAim(t, a) {
    return Math.abs(angDiff(SIDE_ANGLE[t.side], a)) <= Math.PI / 2 - 0.05;
  }
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
  // ---------- redimensionar em qualquer coluna/linha ----------
  // Ampliador: insere uma coluna/linha vazia na divisa `at` (o conteúdo de `at` em diante
  // anda uma casa). Encolhedor: remove a coluna/linha `at`, que precisa estar vazia.
  // people: tripulantes ({x,y,w,h}) que também contam como "algo no caminho".
  shrinkBlocker(axis, at, people = []) {
    const nw = this.w - (axis === 'x' ? 1 : 0), nh = this.h - (axis === 'y' ? 1 : 0);
    if (nw < 6 || nh < 6) return 'A nave não pode ficar menor.';
    const line = axis === 'x' ? 'coluna' : 'linha';
    const len = axis === 'x' ? this.h : this.w;
    if (at < 1 || at > (axis === 'x' ? this.w : this.h) - 2) return `Escolha uma ${line} dentro da nave.`;
    for (let k = 1; k < len - 1; k++) {
      const x = axis === 'x' ? at : k, y = axis === 'x' ? k : at;
      if (this.get(x, y) !== T.EMPTY) return `Tem blocos nessa ${line}.`;
      if (this.objectAt(x, y)) return `Tem uma construção nessa ${line}.`;
    }
    const a0 = at * TS, a1 = (at + 1) * TS;
    const crosses = (o) => (axis === 'x' ? o.x < a1 && o.x + o.w > a0 : o.y < a1 && o.y + o.h > a0);
    if (this.items.some(crosses)) return `Tem itens soltos nessa ${line}.`;
    if (people.some(crosses)) return `Tem alguém nessa ${line}.`;
    const sides = axis === 'x' ? ['top', 'bottom'] : ['left', 'right'];
    if (this.turrets.some((t) => sides.includes(t.side) && t.pos - 1 <= at && at <= t.pos + 1)) return `Tem uma torreta no casco dessa ${line}.`;
    return null;
  }

  resizeAt(axis, dir, at, people = []) {
    const nw = this.w + (axis === 'x' ? dir : 0);
    const nh = this.h + (axis === 'y' ? dir : 0);
    if (dir > 0 && (nw > MAX_SHIP_TILES || nh > MAX_SHIP_TILES)) return 'Tamanho máximo atingido (80x80).';
    if (dir > 0) at = clamp(at, 1, axis === 'x' ? this.w - 1 : this.h - 1);
    else { const err = this.shrinkBlocker(axis, at, people); if (err) return err; }

    // nova posição de uma coluna/linha antiga (null = removida)
    const map = (v) => (dir > 0 ? (v >= at ? v + 1 : v) : v === at ? null : v > at ? v - 1 : v);
    const mapX = axis === 'x' ? map : (v) => v, mapY = axis === 'y' ? map : (v) => v;

    const old = { w: this.w, h: this.h, tiles: this.tiles, hp: this.tileHp, shapes: this.shapes };
    this.w = nw; this.h = nh;
    this.tiles = new Uint8Array(nw * nh);
    this.shapes = new Uint8Array(nw * nh);
    this.tileHp = new Float32Array(nw * nh);
    this.objMap = new Int32Array(nw * nh).fill(-1);
    this.buildHull();
    for (let y = 1; y < old.h - 1; y++)
      for (let x = 1; x < old.w - 1; x++) {
        const nx = mapX(x), ny = mapY(y);
        if (nx === null || ny === null || !this.isInterior(nx, ny)) continue;
        const i = this.idx(nx, ny), j = y * old.w + x;
        this.tiles[i] = old.tiles[j]; this.shapes[i] = old.shapes[j]; this.tileHp[i] = old.hp[j];
      }
    // em pixels: tudo que está depois da divisa anda uma casa
    const shiftPx = (v) => (dir > 0 ? (v >= at * TS ? TS : 0) : v >= (at + 1) * TS ? -TS : 0);
    for (const o of this.objects) {
      const d = OBJECTS[o.type];
      // colunas: o objeto acompanha seu lado esquerdo; linhas: acompanha o piso (lado de baixo)
      if (axis === 'x') o.x += shiftPx(o.x * TS) / TS;
      else o.y += shiftPx((o.y + d.h - 1) * TS) / TS;
    }
    const sides = axis === 'x' ? ['top', 'bottom'] : ['left', 'right'];
    for (const t of this.turrets) if (sides.includes(t.side)) t.pos += shiftPx(t.pos * TS) / TS;
    for (const it of this.items) {
      if (axis === 'x') it.x += shiftPx(it.x + it.w / 2); else it.y += shiftPx(it.y + it.h / 2);
    }
    for (const pp of people) {
      if (axis === 'x') pp.x += shiftPx(pp.x + pp.w / 2); else pp.y += shiftPx(pp.y + pp.h - 1);
    }
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
      shapes: this.shapes.some((v) => v) ? Array.from(this.shapes) : undefined,
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
    let tiles = '', sh = '';
    for (let i = 0; i < this.tiles.length; i++) tiles += this.tiles[i];
    if (this.shapes.some((v) => v)) for (let i = 0; i < this.shapes.length; i++) sh += String.fromCharCode(48 + this.shapes[i]);
    const thp = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t && t !== T.HULL && this.tileHp[i] < TILE_INFO[t].hp) thp.push([i, Math.round(this.tileHp[i])]);
    }
    return {
      id: this.id, name: this.name, team: this.team, color: this.color, boss: !!this.boss,
      w: this.w, h: this.h, tiles, sh, thp, tu: this.turrets.map((t) => [t.type, t.side, t.pos]), rev: this.rev,
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
    if (this.shapes.length !== d.w * d.h) this.shapes = new Uint8Array(d.w * d.h);
    for (let i = 0; i < d.tiles.length; i++) { const t = d.tiles.charCodeAt(i) - 48; this.tiles[i] = t; this.tileHp[i] = TILE_INFO[t].hp || 0; }
    for (let i = 0; i < this.shapes.length; i++) this.shapes[i] = d.sh ? d.sh.charCodeAt(i) - 48 : 0;
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
    if (d.shapes && d.shapes.length === s.tiles.length) s.shapes = Uint8Array.from(d.shapes);
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

// Coluna/linha alvo do Ampliador (divisa mais próxima do mouse) ou do Encolhedor (célula sob o mouse)
function resizeTarget(s, axis, dir, lx, ly) {
  const v = axis === 'x' ? lx : ly, n = axis === 'x' ? s.w : s.h;
  return dir > 0 ? clamp(Math.round(v / TS), 1, n - 1) : Math.floor(v / TS);
}

// ---------- nave inicial ----------
// ---------- Nave de testes (TEMPORÁRIO) ----------
// Com true, toda nave nova é criada com a nave de testes abaixo, que tem um pouco de tudo.
// Para voltar à nave padrão, troque para false.
const USE_TEST_SHIP = false;

function buildTestShip() {
  const s = new Ship(26, 12, { name: 'Nave de Testes' });
  const put = (type, x, y, extra) => {
    if (!s.canPlaceObject(type, x, y)) throw new Error(`nave de testes: ${type} não cabe em ${x},${y}`);
    return s.placeObject(type, x, y, extra);
  };

  // ===== estrutura =====
  // piso do andar de cima (linha 6): blocos, um trecho de passarela (itens atravessam) e a escada
  for (let x = 1; x <= 24; x++) s.set(x, 6, x >= 11 && x <= 13 ? T.WALKWAY : T.BLOCK);
  for (let y = 2; y <= 10; y++) s.set(14, y, T.LADDER);
  // rede no andar de cima: pessoas passam, itens não
  for (let y = 1; y <= 5; y++) s.set(17, y, T.NET);
  // degraus de bloco no canto do andar de baixo
  s.set(24, 10, T.BLOCK); s.set(24, 9, T.BLOCK); s.set(23, 10, T.BLOCK);

  // ===== andar de baixo (linhas 7–10) =====
  const mats = () => ({ metal: 99, explosives: 99, flux: 40 });
  put('fab_starter', 1, 9, { mats: mats() });
  put('fab_munitions', 3, 9, { mats: mats() });
  put('fab_engineering', 5, 9, { mats: mats() });
  put('fab_machine', 7, 9, { mats: mats() });
  put('fab_equipment', 9, 9, { mats: mats() });
  put('door', 11, 9, { open: true });
  put('helm', 12, 9);
  put('recycler', 15, 9);

  // ===== andar de cima (linhas 1–5) =====
  put('expando', 1, 4, { store: { item: 'metal', n: 160 } });
  put('expando', 3, 4);
  put('shield_gen', 5, 4, { fuel: 300 });
  put('spawn', 7, 4);
  // Caixa de Munição com trilho: sobe da caixa, corre pelo teto e desce pela parede esquerda
  put('ammo_crate', 8, 4, { store: { item: 'ammo_standard', n: 48 } });
  for (let y = 1; y <= 3; y++) s.set(8, y, T.RAIL);
  for (let x = 1; x <= 16; x++) s.set(x, 1, T.RAIL);
  for (let y = 2; y <= 3; y++) s.set(1, y, T.RAIL);
  put('ejector', 16, 5);
  put('gunnery', 12, 4, { side: 'top' });   // Posto de Artilharia: torretas de cima
  put('hatch', 24, 5);
  // Carregador de exemplo: pega o que chega pela escotilha (diagonal) e solta à esquerda
  put('loader', 23, 4, { din: 3, dout: 6 });

  // ===== torretas: os 4 tipos, as 8 munições, quantidades variadas (uma vazia) =====
  const tur = (type, side, pos, ammoType, ammo) => {
    if (!s.canPlaceTurret(side, pos)) throw new Error(`nave de testes: torreta não cabe em ${side} ${pos}`);
    s.placeTurret(type, side, pos, { ammoType: ammo > 0 ? ammoType : null, ammo });
  };
  tur('turret', 'top', 3, 'standard', 6);
  tur('turret_auto', 'top', 8, 'scatter', 20);
  tur('turret_burst', 'top', 13, 'flak', 13);
  tur('turret_rc', 'top', 18, 'sniper', 6);
  tur('turret', 'top', 22, 'slug', 0);
  tur('turret_auto', 'bottom', 4, 'punch', 30);
  tur('turret_burst', 'bottom', 10, 'yank', 15);
  tur('turret_rc', 'bottom', 16, 'trash', 24);
  tur('turret', 'bottom', 21, 'slug', 10);
  tur('turret_rc', 'left', 3, 'standard', 10);
  tur('turret', 'left', 8, 'sniper', 12);
  tur('turret_rc', 'right', 3, 'standard', 24);
  tur('turret_burst', 'right', 8, 'flak', 30);

  // ===== itens soltos =====
  const drop = (item, n, cx, cy) => s.spawnItem(item, n, (cx + 0.5) * TS, (cy + 0.5) * TS, 0, 0);
  // atrás da rede (andar de cima): uma unidade de cada ferramenta e equipamento
  [['wrench', 1], ['shredder', 1], ['booster', 16], ['repair', 8], ['embiggener', 4], ['shrinker', 4], ['boots', 1], ['speed', 1], ['jetpack', 1]]
    .forEach(([it, n], i) => drop(it, n, 18 + (i % 5), i < 5 ? 5 : 4));
  // bolas, no andar de cima
  drop('loader', 8, 23, 2);   // Carregadores para testar (caem em cima do Carregador de exemplo)
  drop('ball_beach', 1, 10, 3); drop('ball_soccer', 1, 11, 2); drop('ball_volley', 1, 12, 2);
  drop('rail', 32, 20, 3);   // trilhos para testar
  // andar de baixo: recursos, munição, uma pilha de 2 itens e um item solto para testar empurrões
  drop('metal', 16, 18, 10); drop('explosives', 16, 19, 10); drop('flux', 16, 20, 10);
  drop('ammo_standard', 16, 21, 8); drop('ammo_flak', 16, 22, 8);
  const p1 = drop('block', 16, 17, 10), p2 = drop('walkway', 16, 17, 10);
  p1.y = 10 * TS + TS - p1.h; p2.y = p1.y - p2.h;

  s.recalc();
  s.shield = s.maxShield;
  s.integrity = s.maxIntegrity;
  return s;
}

function buildStarterShip() {
  const s = new Ship(11, 8, { name: 'Minha Nave' });

  // convés do meio (passarela) com abertura para escada
  for (let x = 1; x <= 3; x++) s.set(x, 4, T.WALKWAY);
  for (let x = 5; x <= 9; x++) s.set(x, 3, T.BLOCK);
  for (let y = 3; y <= 6; y++) s.set(4, y, T.LADDER);

  for (let y = 5; y <= 6; y++) s.set(3, y, T.NET);

  s.placeObject('helm', 6, 5);

  s.placeObject('expando', 8, 1, { store: { item: 'ammo_standard', n: 48 } });

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

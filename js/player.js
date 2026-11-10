// ============================================================
//  Jogador (tripulante): física de plataforma dentro da nave,
//  escadas, passarelas, inventário e equipamentos.
// ============================================================
'use strict';

const GRAVITY = 1500;
const REACH = TS * 7;

// Movimento com colisão contra a grade da nave (usado por jogador e itens)
function collideMove(e, ship, dt, forItem, dropping) {
  const solid = forItem ? (x, y) => ship.solidForItem(x, y) : (x, y) => ship.solidAt(x, y);
  const maxV = TS * 0.9 / dt;
  e.vx = clamp(e.vx, -maxV, maxV);
  e.vy = clamp(e.vy, -maxV, maxV);
  let hitX = false, hitY = false;
  // eixo X
  e.x += e.vx * dt;
  let y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - 0.01) / TS);
  if (e.vx > 0) {
    const cx = Math.floor((e.x + e.w - 0.01) / TS);
    for (let cy = y0; cy <= y1; cy++) if (solid(cx, cy)) { e.x = cx * TS - e.w; hitX = true; break; }
  } else if (e.vx < 0) {
    const cx = Math.floor(e.x / TS);
    for (let cy = y0; cy <= y1; cy++) if (solid(cx, cy)) { e.x = (cx + 1) * TS; hitX = true; break; }
  }
  // eixo Y
  const prevBottom = e.y + e.h;
  e.y += e.vy * dt;
  e.onGround = false;
  const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 0.01) / TS);
  if (e.vy >= 0) {
    const cy = Math.floor((e.y + e.h - 0.01) / TS);
    for (let cx = x0; cx <= x1; cx++) {
      const plat = !dropping && ship.platformAt(cx, cy) && prevBottom <= cy * TS + 0.5;
      if (solid(cx, cy) || plat) { e.y = cy * TS - e.h; hitY = true; e.onGround = true; break; }
    }
  } else {
    const cy = Math.floor(e.y / TS);
    for (let cx = x0; cx <= x1; cx++) if (solid(cx, cy)) { e.y = (cy + 1) * TS; hitY = true; break; }
  }
  return { hitX, hitY };
}

// ---------- inventário ----------
function invAdd(inv, item, n) {
  const max = ITEMS[item].stack;
  for (let i = 0; i < inv.length && n > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && s.n < max) {
      const k = Math.min(max - s.n, n);
      s.n += k; n -= k;
    }
  }
  for (let i = 0; i < inv.length && n > 0; i++) {
    if (!inv[i]) {
      const k = Math.min(max, n);
      inv[i] = { item, n: k }; n -= k;
    }
  }
  return n; // sobra
}
function invCount(inv, item) {
  let c = 0;
  for (const s of inv) if (s && s.item === item) c += s.n;
  return c;
}

class Player {
  constructor(ship) {
    this.ship = ship;
    this.w = 10; this.h = 22;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.onLadder = false;
    this.jumpT = 0;
    this.dropT = 0;
    this.facing = 1;
    this.inv = new Array(10).fill(null);
    this.sel = 0;
    this.equip = { feet: null, back: null };
    this.mode = 'walk';       // walk | helm | turret
    this.ctrl = null;         // objeto/torreta controlado
    this.jetFuel = 1;
    this.walkAnim = 0;
    this.name = 'Você';
    this.color = '#f0c27a';
    this.respawn();
  }

  respawn() {
    const sp = this.ship.objectsOf('spawn')[0];
    if (sp) {
      this.x = sp.x * TS + 3; this.y = (sp.y + 2) * TS - this.h - 0.1;
    } else {
      // procura um lugar livre no chão
      this.x = TS * 2; this.y = (this.ship.h - 1) * TS - this.h - 0.1;
      for (let cy = this.ship.h - 2; cy > 0; cy--) {
        for (let cx = 1; cx < this.ship.w - 1; cx++) {
          if (!this.ship.solidAt(cx, cy) && !this.ship.solidAt(cx, cy - 1) && this.ship.supportAt(cx, cy + 1)) {
            this.x = cx * TS + 3; this.y = (cy + 1) * TS - this.h - 0.1; return;
          }
        }
      }
    }
  }

  get held() { return this.inv[this.sel]; }
  get cxL() { return this.x + this.w / 2; }
  get cyL() { return this.y + this.h / 2; }

  update(dt, input) {
    const s = this.ship;
    if (this.mode !== 'walk') { this.vx = 0; this.vy = 0; return; }
    const speedMul = this.equip.feet === 'speed' ? 1.5 : 1;
    const jumpMul = this.equip.feet === 'boots' ? 1.35 : 1;
    const run = 150 * speedMul;

    // escadas
    const cx = Math.floor(this.cxL / TS);
    const touching = s.ladderAt(cx, Math.floor((this.y + this.h - 1) / TS)) || s.ladderAt(cx, Math.floor(this.cyL / TS));
    const ladderBelow = s.ladderAt(cx, Math.floor((this.y + this.h + 1) / TS));
    if (!touching && !(this.onLadder && ladderBelow && input.down)) this.onLadder = false;
    if (!this.onLadder && ((input.up && touching) || (input.down && (touching || ladderBelow)))) {
      this.onLadder = true;
      this.x = clamp(cx * TS + (TS - this.w) / 2, this.x - 4, this.x + 4);
    }

    if (this.onLadder) {
      const climb = 120 * speedMul;
      this.vx = (input.right - input.left) * run * 0.7;
      this.vy = (input.down - input.up) * climb;
      if (input.jumpPressed) { this.onLadder = false; this.vy = -220 * jumpMul; this.jumpT = 0.1; }
      collideMove(this, s, dt, false, true);
    } else {
      const target = (input.right - input.left) * run;
      const acc = this.onGround ? 1800 : 900;
      if (Math.abs(target - this.vx) < acc * dt) this.vx = target;
      else this.vx += sign(target - this.vx) * acc * dt;

      if (input.jumpPressed && this.onGround) {
        this.vy = -300 * jumpMul;
        this.jumpT = 0.22;
      }
      let g = GRAVITY;
      if (input.jump && this.jumpT > 0 && this.vy < 0) { g *= 0.35; }
      this.jumpT -= dt;
      // mochila-foguete
      if (this.equip.back === 'jetpack' && input.jump && !this.onGround && this.jumpT <= 0 && this.jetFuel > 0) {
        this.vy -= 2600 * dt;
        this.vy = Math.max(this.vy, -260);
        this.jetFuel -= dt * 0.6;
        this.jetting = true;
      } else this.jetting = false;
      if (this.onGround) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.8);
      this.vy += g * dt;
      if (input.downPressed && this.onGround) this.dropT = 0.2;
      this.dropT -= dt;
      collideMove(this, s, dt, false, this.dropT > 0 || (input.down && !this.onGround));
    }
    if (this.vx !== 0) this.facing = sign(this.vx);
    this.walkAnim += Math.abs(this.vx) * dt * 0.08;

    // mantém dentro da nave (segurança)
    this.x = clamp(this.x, TS, s.pw - TS - this.w);
    this.y = clamp(this.y, TS, s.ph - TS - this.h);
  }
}

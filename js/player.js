// ============================================================
//  Jogador (tripulante): física de plataforma dentro da nave,
//  escadas, passarelas, inventário e equipamentos.
// ============================================================
'use strict';

const GRAVITY = 700;
const REACH = TS * 7;

// Movimento com colisão contra a grade da nave (usado por jogador e itens).
// Os blocos podem ter formatos (meio bloco, 1/4, rampas): cada célula sólida vira um
// trapézio. Personagens sobem e descem rampas andando (apoiados pelo centro dos pés);
// itens apoiam no ponto mais alto e escorregam (ver e.slope, inclinação do apoio).
// boxes (opcional): caixas sólidas extras {x,y,w,h}, ex.: itens soltos para o jogador.
function collideMove(e, ship, dt, forItem, dropping, boxes) {
  const mode = forItem ? 'max' : 'center';
  const maxV = TS * 0.9 / dt;
  e.vx = clamp(e.vx, -maxV, maxV);
  e.vy = clamp(e.vy, -maxV, maxV);
  const wasGround = e.onGround;
  let hitX = false, hitY = false;
  const slopeOf = (p) => (p.T1 - p.T0) / (p.X1 - p.X0);

  // ---------- eixo X ----------
  const prevX = e.x, prevLeft = e.x, prevRight = e.x + e.w;
  const dx = e.vx * dt;
  e.x += dx;
  if (dx !== 0) {
    let lift = 0, blocked = false;
    const reach = Math.abs(dx) + 2;
    for (const p of ship.solidPieces(e.x, e.y - reach, e.x + e.w, e.y + e.h, forItem)) {
      const o0 = Math.max(e.x, p.X0), o1 = Math.min(e.x + e.w, p.X1);
      if (o1 - o0 <= 0.01) continue;
      const top = pieceTop(p, e.x + e.w / 2, o0, o1, mode), bot = pieceBot(p, e.x + e.w / 2, o0, o1, mode);
      if (bot - top < 0.01 || e.y >= bot - 0.01 || e.y + e.h <= top + 0.01) continue;
      // rampa: em vez de bater, sobe por ela (no máximo o que a inclinação permite neste passo)
      const pen = e.y + e.h - top;
      if (p.T0 !== p.T1 && pen <= Math.abs(dx) * Math.abs(slopeOf(p)) + 1.2) { lift = Math.max(lift, pen); continue; }
      // personagem no chão sobe sozinho desníveis de até meia largura (fim de rampa encontrando
      // o platô); degraus de verdade (meio bloco = 8px) continuam precisando de pulo
      if (!forItem && wasGround && pen <= e.w / 2 + 0.6) { lift = Math.max(lift, pen); continue; }
      blocked = true;
      if (dx > 0) e.x = Math.max(prevX, Math.min(e.x, p.X0 - e.w));
      else e.x = Math.min(prevX, Math.max(e.x, p.X1));
    }
    if (lift > 0) {
      if (!ship.boxHits(e.x, e.y - lift, e.w, e.h, forItem, mode)) { e.y -= lift; e.onGround = true; }
      else { e.x = prevX; blocked = true; }
    }
    if (blocked) hitX = true;
  }
  if (boxes && e.vx !== 0) {
    for (const b of boxes) {
      if (e.y + e.h <= b.y + 0.01 || e.y >= b.y + b.h - 0.01) continue; // sem sobreposição vertical
      // só bloqueia se antes estava do lado de fora (evita "teleportes" quando já sobreposto)
      if (e.vx > 0 && prevRight <= b.x + 0.5 && e.x + e.w > b.x) { e.x = b.x - e.w; hitX = true; }
      else if (e.vx < 0 && prevLeft >= b.x + b.w - 0.5 && e.x < b.x + b.w) { e.x = b.x + b.w; hitX = true; }
    }
  }

  // ---------- eixo Y ----------
  const prevBottom = e.y + e.h, prevTop = e.y;
  e.y += e.vy * dt;
  e.onGround = false;
  e.slope = 0;
  const cxm = e.x + e.w / 2;
  if (e.vy >= 0) {
    // quem estava no chão "gruda" no piso ao descer rampas (sem ficar pulando degraus)
    const snap = !wasGround ? 0 : forItem ? Math.abs(dx) * 1.1 + 1 : Math.max(Math.abs(dx) * 1.1 + 1, e.w / 2 + 1);
    let best = Infinity, bestSlope = 0;
    for (const p of ship.solidPieces(e.x, prevBottom - 1, e.x + e.w, e.y + e.h + snap + 0.01, forItem)) {
      const o0 = Math.max(e.x, p.X0), o1 = Math.min(e.x + e.w, p.X1);
      if (o1 - o0 <= 0.01) continue;
      const top = pieceTop(p, cxm, o0, o1, mode), bot = pieceBot(p, cxm, o0, o1, mode);
      if (bot - top < 0.01) continue;
      if (top >= prevBottom - 0.75 && top <= e.y + e.h + snap && top < best) { best = top; bestSlope = slopeOf(p); }
    }
    // passarelas e topo de escada (só personagens; itens atravessam)
    if (!forItem && !dropping) {
      const cx0 = Math.floor(e.x / TS), cx1 = Math.floor((e.x + e.w - 0.01) / TS);
      for (let cy = Math.floor(prevBottom / TS); cy <= Math.floor((e.y + e.h + snap) / TS); cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const top = cy * TS;
          if (ship.platformAt(cx, cy) && prevBottom <= top + 0.5 && top <= e.y + e.h + snap && top < best) { best = top; bestSlope = 0; }
        }
    }
    if (best < Infinity) { e.y = best - e.h; e.vy = 0; hitY = true; e.onGround = true; e.slope = bestSlope; }
  } else {
    let best = -Infinity;
    for (const p of ship.solidPieces(e.x, e.y - 0.01, e.x + e.w, prevTop + 1, forItem)) {
      const o0 = Math.max(e.x, p.X0), o1 = Math.min(e.x + e.w, p.X1);
      if (o1 - o0 <= 0.01) continue;
      const top = pieceTop(p, cxm, o0, o1, mode), bot = pieceBot(p, cxm, o0, o1, mode);
      if (bot - top < 0.01) continue;
      if (bot <= prevTop + 0.75 && bot > e.y && bot > best) best = bot;
    }
    if (best > -Infinity) { e.y = best; e.vy = 0; hitY = true; }
  }
  if (boxes) {
    for (const b of boxes) {
      if (e.x + e.w <= b.x + 0.01 || e.x >= b.x + b.w - 0.01) continue; // sem sobreposição horizontal
      if (e.vy >= 0 && prevBottom <= b.y + 0.5 && e.y + e.h > b.y) {
        e.y = b.y - e.h; e.vy = 0; hitY = true; e.onGround = true; e.slope = 0; // em pé sobre o item
      } else if (e.vy < 0 && prevTop >= b.y + b.h - 0.5 && e.y < b.y + b.h) {
        e.y = b.y + b.h; e.vy = 0; hitY = true; // bateu a cabeça no item
      }
    }
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
    this.id = uid();
    this.tp = 0;              // contador de teletransporte (cliente re-sincroniza)
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
    this.tp++;
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
    const run = 120 * speedMul;

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
      const climb = 90 * speedMul;
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
        this.vy = -200 * jumpMul;
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
      const goingUp = this.vy < 0;
      // itens soltos são sólidos para o personagem; no navegador usa a posição
      // oficial do servidor (tx/ty) em vez da posição suavizada do desenho
      const boxes = s.items.map((it) => ({ x: it.tx ?? it.x, y: it.ty ?? it.y, w: it.w, h: it.h }));
      const hit = collideMove(this, s, dt, false, this.dropT > 0 || (input.down && !this.onGround), boxes);
      if (hit.hitY && goingUp) this.jumpT = 0; // bateu no teto: encerra o pulo
    }
    if (this.vx !== 0) this.facing = sign(this.vx);
    this.walkAnim += Math.abs(this.vx) * dt * 0.08;

    // mantém dentro da nave (segurança)
    this.x = clamp(this.x, TS, s.pw - TS - this.w);
    this.y = clamp(this.y, TS, s.ph - TS - this.h);
  }
}

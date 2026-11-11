// ============================================================
//  Renderização (canvas 2D)
// ============================================================
'use strict';

// Roda de formatos: anel interno com inteiro, meios e quartos; anel externo com as rampas.
const SHAPE_WHEEL = { inner: 74, outer: 138, split: 9 };
function shapeWheelSlot(i, cx, cy) {
  const inner = i < SHAPE_WHEEL.split;
  const n = inner ? SHAPE_WHEEL.split : SHAPES.length - SHAPE_WHEEL.split, k = inner ? i : i - SHAPE_WHEEL.split;
  const a = -Math.PI / 2 + (k / n) * Math.PI * 2, R = inner ? SHAPE_WHEEL.inner : SHAPE_WHEEL.outer;
  return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: inner ? 23 : 22 };
}
// formato sob o mouse (ou null perto do centro = manter o atual)
function shapeWheelPick(mx, my, cx, cy) {
  const d = Math.hypot(mx - cx, my - cy);
  if (d < 32) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < SHAPES.length; i++) {
    const s = shapeWheelSlot(i, cx, cy);
    const dd = Math.hypot(mx - s.x, my - s.y);
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

// Roda de direções do Carregador: anel interno = de onde pega (0–7), externo = onde coloca (8–15)
const DIR_WHEEL = { inner: 58, outer: 112 };
function dirWheelSlot(i, cx, cy) {
  const k = i % 8, R = i < 8 ? DIR_WHEEL.inner : DIR_WHEEL.outer;
  const [dx, dy] = LOADER_DIRS[k], a = Math.atan2(dy, dx);
  return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: i < 8 ? 19 : 21 };
}
function dirWheelPick(mx, my, cx, cy) {
  if (Math.hypot(mx - cx, my - cy) < 30) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < 16; i++) { const s = dirWheelSlot(i, cx, cy), d = Math.hypot(mx - s.x, my - s.y); if (d < bd) { bd = d; best = i; } }
  return best;
}

// para quais lados um trilho em (x, y) se liga: outros trilhos e Caixas de Munição
function railMask(s, x, y) {
  const link = (cx, cy) => s.get(cx, cy) === T.RAIL || (s.objectAt(cx, cy) || {}).type === 'ammo_crate';
  return (link(x, y - 1) ? 1 : 0) | (link(x + 1, y) ? 2 : 0) | (link(x, y + 1) ? 4 : 0) | (link(x - 1, y) ? 8 : 0);
}

// carrinho de munição (coordenadas da nave; x, y = centro da casa do trilho)
function drawCart(ctx, c) {
  const w = 14, h = 9, col = ITEMS[c.item] ? ITEMS[c.item].color : '#ccc';
  ctx.save(); ctx.translate(c.x, c.y + 1);
  // rodas
  ctx.fillStyle = '#1b1d22';
  for (const wx of [-w * 0.3, w * 0.3]) { ctx.beginPath(); ctx.arc(wx, h / 2 - 1, 2.1, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#8b939c';
  for (const wx of [-w * 0.3, w * 0.3]) { ctx.beginPath(); ctx.arc(wx, h / 2 - 1, 0.8, 0, Math.PI * 2); ctx.fill(); }
  // caçamba (vagão de mina vermelho, com contorno escuro)
  const body = () => { ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 - 2, h / 2 - 2); ctx.lineTo(-w / 2 + 2, h / 2 - 2); ctx.closePath(); };
  ctx.fillStyle = '#b8483a'; body(); ctx.fill();
  ctx.strokeStyle = '#4a1a14'; ctx.lineWidth = 0.9; body(); ctx.stroke();
  ctx.fillStyle = '#d9694f'; ctx.fillRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, 1.3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-0.5, -h / 2 + 1.5, 1, h - 3.5);
  // munição saindo por cima (cor do tipo)
  ctx.fillStyle = col; ctx.fillRect(-w / 2 + 1.5, -h / 2 - 2.2, w - 3, 2.6);
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-w / 2 + 1.5, -h / 2 - 2.2, w - 3, 0.8);
  // quantidade
  ctx.font = 'bold 5.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillText(c.n, 0.4, h / 2 - 2.6);
  ctx.fillStyle = '#fff'; ctx.fillText(c.n, 0, h / 2 - 3);
  ctx.restore();
}

// Roda de lado do Posto de Artilharia (4 setas)
const SIDE_WHEEL_R = 74;
function sideWheelSlot(i, cx, cy) { const a = -Math.PI / 2 + i * Math.PI / 2; return { x: cx + Math.cos(a) * SIDE_WHEEL_R, y: cy + Math.sin(a) * SIDE_WHEEL_R, r: 26 }; }
function sideWheelPick(mx, my, cx, cy) {
  if (Math.hypot(mx - cx, my - cy) < 28) return null;
  const a = Math.atan2(my - cy, mx - cx);
  return ((Math.round((a + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
}

class Renderer {
  constructor(game, canvas) {
    this.game = game;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    for (let i = 0; i < 340; i++) {
      const layer = i < 200 ? 0 : i < 300 ? 1 : 2;
      this.stars.push({ x: Math.random(), y: Math.random(), z: [0.04, 0.1, 0.2][layer], s: [1, 1.6, 2.4][layer], a: rand(0.35, 1), tw: rand(0, 6.28), big: layer === 2, c: choice(['#ffffff', '#cfe0ff', '#ffe9c8']) });
    }
    this.nebula = [];
    for (let i = 0; i < 6; i++) this.nebula.push({ x: Math.random(), y: Math.random(), r: rand(0.35, 0.7), k: i % 2 });
    this.tiles = {};
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini.getContext('2d');
    this.terrainImg = null;
    this.terrainDirty = true;
    this.miniT = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cv.width = Math.floor(innerWidth * dpr);
    this.cv.height = Math.floor(innerHeight * dpr);
    this.cv.style.width = innerWidth + 'px';
    this.cv.style.height = innerHeight + 'px';
  }

  // tela -> mundo
  toWorld(sx, sy) {
    const c = this.game.cam;
    return { x: (sx - innerWidth / 2) / c.zoom + c.x, y: (sy - innerHeight / 2) / c.zoom + c.y };
  }

  draw(dt) {
    const g = this.game, ctx = this.ctx, w = g.world, cam = g.cam;
    const W_ = innerWidth, H_ = innerHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx, w, cam, W_, H_);

    const sh = g.shakeAmt;
    const ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
    ctx.setTransform(this.dpr * cam.zoom, 0, 0, this.dpr * cam.zoom,
      this.dpr * (W_ / 2 - cam.x * cam.zoom + ox), this.dpr * (H_ / 2 - cam.y * cam.zoom + oy));
    const view = { x0: cam.x - W_ / 2 / cam.zoom, y0: cam.y - H_ / 2 / cam.zoom, x1: cam.x + W_ / 2 / cam.zoom, y1: cam.y + H_ / 2 / cam.zoom };
    this.view = view;

    this.drawPortals(ctx, w);
    this.drawTerrain(ctx, w, view);
    for (const c of w.crates) this.drawCrate(ctx, c);
    for (const s of w.ships) if (this.inView(s.x, s.y, s.pw, s.ph, 60)) this.drawShip(ctx, s);
    for (const b of w.bots) if (this.inView(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, 30)) this.drawBot(ctx, b);
    this.drawBullets(ctx, w);
    this.drawParticles(ctx, w);
    this.drawCursorPreview(ctx);
    for (const s of w.ships) if (this.inView(s.x, s.y, s.pw, s.ph, 80)) this.drawShipBars(ctx, s);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // vinheta
    const vg = ctx.createRadialGradient(W_ / 2, H_ / 2, Math.min(W_, H_) * 0.45, W_ / 2, H_ / 2, Math.max(W_, H_) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W_, H_);
    this.drawOffscreenIndicators(ctx);
    if (g.shapeWheel) this.drawShapeWheel(ctx);
    this.miniT -= dt;
    if (this.miniT <= 0) { this.drawMinimap(); this.miniT = 0.12; }
  }

  inView(x, y, w, h, m = 0) {
    const v = this.view;
    return x + w + m > v.x0 && x - m < v.x1 && y + h + m > v.y0 && y - m < v.y1;
  }

  // ---------- fundo: gradiente, nebulosas e estrelas em camadas ----------
  drawBackground(ctx, w, cam, W_, H_) {
    const z = w.zone, t = this.game.time;
    const grd = ctx.createLinearGradient(0, 0, 0, H_);
    grd.addColorStop(0, z.bg[0]); grd.addColorStop(1, z.bg[1]);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W_, H_);
    ctx.globalCompositeOperation = 'lighter';
    const span = Math.max(W_, H_) * 1.8;
    for (const nb of this.nebula) {
      const px = ((nb.x * span * 2 - cam.x * 0.03) % span + span) % span - span * 0.2;
      const py = ((nb.y * span * 2 - cam.y * 0.03) % span + span) % span - span * 0.2;
      const R = nb.r * Math.max(W_, H_) * 0.6;
      const ng = ctx.createRadialGradient(px, py, 0, px, py, R);
      ng.addColorStop(0, hexA(nb.k ? z.rockEdge : z.rock, 0.2)); ng.addColorStop(1, hexA(z.rock, 0));
      ctx.fillStyle = ng; ctx.fillRect(px - R, py - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of this.stars) {
      const x = ((s.x * W_ * 2 - cam.x * s.z) % W_ + W_) % W_;
      const y = ((s.y * H_ * 2 - cam.y * s.z) % H_ + H_) % H_;
      const a = s.a * (0.65 + 0.35 * Math.sin(t * 1.7 + s.tw));
      ctx.fillStyle = s.c;
      if (s.big) {
        ctx.globalAlpha = a * 0.22; ctx.fillRect(x - 3, y - 0.5, 8.4, 1.4); ctx.fillRect(x + 0.5, y - 4, 1.4, 8.4);
      }
      ctx.globalAlpha = a; ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- terreno ----------
  // sprite pré-renderizado de um bloco do mundo (por zona, tipo e variação)
  tileSprite(w, t, v) {
    const key = w.zoneId + ':' + t + ':' + v;
    if (this.tiles[key]) return this.tiles[key];
    const c = document.createElement('canvas');
    c.width = c.height = WTS;
    const x = c.getContext('2d');
    const rng = mulberry32(t * 977 + v * 131 + w.zoneId.length * 7919 + 5);
    const rr2 = (a, b) => a + rng() * (b - a);
    const z = w.zone;
    if (t === W.WALL) {
      x.fillStyle = '#171c23'; x.fillRect(0, 0, WTS, WTS);
      const pg = x.createLinearGradient(0, 0, 0, WTS);
      pg.addColorStop(0, '#39434f'); pg.addColorStop(1, '#232a33');
      x.fillStyle = pg; rrect(x, 4, 4, WTS - 8, WTS - 8, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3; x.strokeRect(18, 18, WTS - 36, WTS - 36);
      x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(20, 21); x.lineTo(WTS - 20, 21); x.moveTo(20, 21); x.lineTo(20, WTS - 20); x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(26, WTS - 26); x.lineTo(WTS - 26, 26); x.stroke();
      x.fillStyle = '#5b6775';
      for (const [rx, ry] of [[11, 11], [WTS - 11, 11], [11, WTS - 11], [WTS - 11, WTS - 11]]) { x.beginPath(); x.arc(rx, ry, 3.2, 0, 6.3); x.fill(); }
    } else {
      x.fillStyle = z.rock; x.fillRect(0, 0, WTS, WTS);
      for (let k = 0; k < 16; k++) {
        x.fillStyle = shade(z.rock, rr2(-0.2, 0.14)); x.globalAlpha = 0.6;
        x.beginPath(); x.ellipse(rr2(0, WTS), rr2(0, WTS), rr2(10, 34), rr2(8, 24), rr2(0, 3), 0, 6.3); x.fill();
      }
      x.globalAlpha = 1;
      for (let k = 0; k < 46; k++) {
        x.fillStyle = shade(z.rock, rng() < 0.5 ? -0.3 : 0.22); x.globalAlpha = 0.5;
        const s = rr2(2, 5); x.fillRect(rr2(0, WTS), rr2(0, WTS), s, s);
      }
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        let px = rr2(10, WTS - 10), py = rr2(10, WTS - 10);
        x.beginPath(); x.moveTo(px, py);
        for (let i = 0; i < 3; i++) { px += rr2(-22, 22); py += rr2(-22, 22); x.lineTo(px, py); }
        x.stroke();
      }
      const bg = x.createLinearGradient(0, 0, WTS, WTS);
      bg.addColorStop(0, 'rgba(255,255,255,0.10)'); bg.addColorStop(1, 'rgba(0,0,0,0.22)');
      x.fillStyle = bg; x.fillRect(0, 0, WTS, WTS);
      if (t === W.FLUX) {
        for (let k = 0; k < 5; k++) {
          const cx = rr2(24, WTS - 24), cy = rr2(28, WTS - 28), hgt = rr2(14, 24), wd = hgt * 0.45;
          const gl = x.createRadialGradient(cx, cy, 0, cx, cy, hgt * 1.6);
          gl.addColorStop(0, 'rgba(190,110,255,0.45)'); gl.addColorStop(1, 'rgba(190,110,255,0)');
          x.fillStyle = gl; x.fillRect(cx - 40, cy - 40, 80, 80);
          const cg = x.createLinearGradient(cx - wd, cy, cx + wd, cy);
          cg.addColorStop(0, '#e9c8ff'); cg.addColorStop(0.5, '#b45cff'); cg.addColorStop(1, '#6a22b8');
          x.fillStyle = cg;
          x.beginPath(); x.moveTo(cx, cy - hgt); x.lineTo(cx + wd, cy - 2); x.lineTo(cx, cy + hgt * 0.8); x.lineTo(cx - wd, cy - 2); x.closePath(); x.fill();
          x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 1.2;
          x.beginPath(); x.moveTo(cx, cy - hgt); x.lineTo(cx, cy + hgt * 0.8); x.stroke();
        }
      } else if (t === W.DIAMOND) {
        const cx = WTS / 2, cy = WTS / 2;
        const gl = x.createRadialGradient(cx, cy, 0, cx, cy, 58);
        gl.addColorStop(0, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gl; x.fillRect(0, 0, WTS, WTS);
        x.fillStyle = '#ffffff';
        x.beginPath(); x.moveTo(cx, cy - 32); x.lineTo(cx + 24, cy); x.lineTo(cx, cy + 32); x.lineTo(cx - 24, cy); x.closePath(); x.fill();
        x.fillStyle = '#bfe0ff';
        x.beginPath(); x.moveTo(cx, cy - 32); x.lineTo(cx + 24, cy); x.lineTo(cx, cy); x.closePath(); x.fill();
        x.fillStyle = '#8fc4f2';
        x.beginPath(); x.moveTo(cx, cy + 32); x.lineTo(cx - 24, cy); x.lineTo(cx, cy); x.closePath(); x.fill();
        x.strokeStyle = '#e8f4ff'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(cx - 24, cy); x.lineTo(cx + 24, cy); x.stroke();
      }
    }
    this.tiles[key] = c;
    return c;
  }

  drawTerrain(ctx, w, v) {
    const x0 = Math.max(0, Math.floor(v.x0 / WTS)), x1 = Math.min(w.n - 1, Math.floor(v.x1 / WTS));
    const y0 = Math.max(0, Math.floor(v.y0 / WTS)), y1 = Math.min(w.n - 1, Math.floor(v.y1 / WTS));
    const z = w.zone;
    const light = shade(z.rockEdge, 0.2), lightW = '#566270';
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const t = w.terrain[ty * w.n + tx];
        if (!t) continue;
        const x = tx * WTS, y = ty * WTS;
        const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        ctx.drawImage(this.tileSprite(w, t, h & 3), x, y, WTS + 0.6, WTS + 0.6);
        // bordas expostas: luz em cima/esquerda, sombra embaixo/direita
        const up = !w.getW(tx, ty - 1), lf = !w.getW(tx - 1, ty), dn = !w.getW(tx, ty + 1), rt = !w.getW(tx + 1, ty);
        ctx.fillStyle = t === W.WALL ? lightW : light;
        if (up) ctx.fillRect(x, y, WTS, 6);
        if (lf) ctx.fillRect(x, y, 6, WTS);
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        if (dn) ctx.fillRect(x, y + WTS - 8, WTS, 8);
        if (rt) ctx.fillRect(x + WTS - 6, y, 6, WTS);
        const hp = w.thp[ty * w.n + tx], max = W_HP[t];
        if (hp < max) {
          const f = 1 - hp / max;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
          ctx.beginPath();
          const n = Math.ceil(f * 5);
          for (let k = 0; k < n; k++) {
            const sx = x + 20 + ((h >> k) & 80), sy = y + 20 + ((h >> (k + 3)) & 80);
            ctx.moveTo(sx, sy); ctx.lineTo(sx + 20 - ((h >> k) & 40), sy + 24); ctx.lineTo(sx + 6, sy + 44);
          }
          ctx.stroke();
        }
      }
  }

  drawPortals(ctx, w) {
    for (const p of w.portals) {
      if (!this.inView(p.x - 160, p.y - 160, 320, 320)) continue;
      const tz = ZONES[p.target];
      const col = shade(tz.rockEdge, 0.35);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.5);
      gl.addColorStop(0, hexA(col, 0.55)); gl.addColorStop(0.6, hexA(tz.rockEdge, 0.2)); gl.addColorStop(1, hexA(tz.rockEdge, 0));
      ctx.fillStyle = gl; ctx.fillRect(p.x - p.r * 1.5, p.y - p.r * 1.5, p.r * 3, p.r * 3);
      ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const r = p.r * (0.3 + k * 0.17) + Math.sin(p.phase * 2 + k) * 3;
        const a0 = p.phase * (k % 2 ? -0.9 : 1.2) + k * 1.3;
        ctx.strokeStyle = hexA(col, 0.35 + k * 0.1); ctx.lineWidth = 5 - k * 0.5;
        for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(p.x, p.y, r, a0 + j * 2.1, a0 + j * 2.1 + 1.3); ctx.stroke(); }
      }
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(tz.name, p.x, p.y - p.r - 16);
      ctx.font = '13px sans-serif'; ctx.fillStyle = '#ddd';
      ctx.fillText(tz.safe ? 'zona segura' : tz.pvp ? 'zona de combate' : 'zona PvE', p.x, p.y - p.r + 2);
    }
  }

  drawCrate(ctx, c) {
    if (!this.inView(c.x - 30, c.y - 30, 60, 60)) return;
    const rare = c.rare !== undefined ? c.rare : c.items.some(([i]) => RARE_ITEMS.has(i));
    if (rare) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 30);
      gl.addColorStop(0, 'rgba(110,255,140,0.4)'); gl.addColorStop(1, 'rgba(110,255,140,0)');
      ctx.fillStyle = gl; ctx.fillRect(c.x - 30, c.y - 30, 60, 60); ctx.restore();
    }
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    ctx.fillStyle = rare ? '#2a6a3a' : '#5a3d1c'; rrect(ctx, -12, -12, 24, 24, 3); ctx.fill();
    const cg = ctx.createLinearGradient(-10, -10, 10, 10);
    cg.addColorStop(0, rare ? '#6fe080' : '#b98d52'); cg.addColorStop(1, rare ? '#3a9a4c' : '#8a6234');
    ctx.fillStyle = cg; ctx.fillRect(-9.5, -9.5, 19, 19);
    ctx.strokeStyle = rare ? '#2a6a3a' : '#5a3a18'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-9.5, -9.5, 19, 2);
    ctx.restore();
    drawItemIcon(ctx, c.items[0][0], c.x, c.y - 24, 14);
  }

  // ---------- naves ----------
  drawThrust(ctx, s, pw, ph) {
    if (Math.hypot(s.vx, s.vy) < 20) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const tri = (ax, ay, bx, by, cx, cy) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.fill(); };
    const jet = (x, y, dx, dy, len) => {
      const nx = -dy, ny = dx;
      ctx.fillStyle = 'rgba(255,130,40,0.5)'; tri(x + nx * 5, y + ny * 5, x - nx * 5, y - ny * 5, x + dx * len, y + dy * len);
      ctx.fillStyle = 'rgba(255,235,170,0.8)'; tri(x + nx * 2.5, y + ny * 2.5, x - nx * 2.5, y - ny * 2.5, x + dx * len * 0.55, y + dy * len * 0.55);
    };
    if (Math.abs(s.vx) > 20) {
      const x = s.vx > 0 ? 0 : pw, dx = s.vx > 0 ? -1 : 1;
      for (let y = TS * 2; y < ph - TS; y += TS * 3) jet(x, y, dx, 0, Math.min(34, Math.abs(s.vx) * 0.09) * rand(0.7, 1.1));
    }
    if (Math.abs(s.vy) > 20) {
      const y = s.vy > 0 ? 0 : ph, dy = s.vy > 0 ? -1 : 1;
      for (let x = TS * 2; x < pw - TS; x += TS * 3) jet(x, y, 0, dy, Math.min(34, Math.abs(s.vy) * 0.09) * rand(0.7, 1.1));
    }
    ctx.restore();
  }

  drawShip(ctx, s) {
    const g = this.game;
    ctx.save();
    ctx.translate(s.x, s.y);
    const pw = s.pw, ph = s.ph, col = s.color;
    this.drawThrust(ctx, s, pw, ph);
    // escudo (bolha brilhante)
    if (s.shield > 0) {
      const f = s.shield / s.maxShield;
      ctx.save();
      ctx.shadowColor = 'rgba(110,200,255,0.9)'; ctx.shadowBlur = 12 + s.hitFlash * 14;
      ctx.strokeStyle = `rgba(140,215,255,${0.22 + f * 0.33 + s.hitFlash * 0.4})`;
      ctx.lineWidth = 2.2;
      rrect(ctx, -8, -8, pw + 16, ph + 16, 11); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(110,200,255,${0.03 + s.hitFlash * 0.07})`;
      rrect(ctx, -8, -8, pw + 16, ph + 16, 11); ctx.fill();
    }
    // casco metálico
    const hg = ctx.createLinearGradient(0, 0, 0, ph);
    hg.addColorStop(0, shade(col, 0.24)); hg.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = hg; rrect(ctx, 0, 0, pw, ph, 5); ctx.fill();
    ctx.strokeStyle = shade(col, -0.62); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = 1; x < s.w; x++) { ctx.moveTo(x * TS, 1); ctx.lineTo(x * TS, TS); ctx.moveTo(x * TS, ph - TS); ctx.lineTo(x * TS, ph - 1); }
    for (let y = 1; y < s.h; y++) { ctx.moveTo(1, y * TS); ctx.lineTo(TS, y * TS); ctx.moveTo(pw - TS, y * TS); ctx.lineTo(pw - 1, y * TS); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(5, 1.4, pw - 10, 1.2);
    ctx.fillStyle = shade(col, 0.4);
    for (let x = 0; x < s.w; x++) { ctx.fillRect(x * TS + 7, 4, 2, 2); ctx.fillRect(x * TS + 7, ph - 6, 2, 2); }
    for (let y = 1; y < s.h - 1; y++) { ctx.fillRect(4, y * TS + 7, 2, 2); ctx.fillRect(pw - 6, y * TS + 7, 2, 2); }
    // interior
    const ix = TS, iy = TS, iw = pw - TS * 2, ih = ph - TS * 2;
    ctx.fillStyle = s.team === 'player' ? '#151a22' : '#1d1518';
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (let x = 1; x < s.w - 1; x += 2) ctx.fillRect(x * TS, iy, TS, ih);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 4; y < s.h - 1; y += 4) ctx.fillRect(ix, y * TS - 0.75, iw, 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 2; x < s.w - 1; x++) { ctx.moveTo(x * TS, iy); ctx.lineTo(x * TS, iy + ih); }
    for (let y = 2; y < s.h - 1; y++) { ctx.moveTo(ix, y * TS); ctx.lineTo(ix + iw, y * TS); }
    ctx.stroke();
    // sombra interna
    let sg = ctx.createLinearGradient(0, iy, 0, iy + 8);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fillRect(ix, iy, iw, 8);
    sg = ctx.createLinearGradient(ix, 0, ix + 7, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fillRect(ix, iy, 7, ih);
    sg = ctx.createLinearGradient(ix + iw, 0, ix + iw - 7, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fillRect(ix + iw - 7, iy, 7, ih);
    ctx.strokeStyle = shade(col, -0.6); ctx.lineWidth = 1; ctx.strokeRect(ix, iy, iw, ih);

    // objetos
    for (const o of s.objects) {
      const d = OBJECTS[o.type];
      ctx.save(); ctx.translate(o.x * TS, o.y * TS);
      if (o.type === 'helm') { s._helmSpin = (s._helmSpin || 0) + (s.thrustX || 0) * 0.05; o.spin = s._helmSpin; }
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(1, d.h * TS - 1.5, d.w * TS - 2, 2.5);
      drawObjectShape(ctx, o, d.w * TS, d.h * TS);
      if (o.type === 'loader') this.drawLoaderArmAnim(ctx, o);
      if ((o.type === 'expando' || o.type === 'ammo_crate') && o.store && o.store.item) {
        // mostra o item guardado e a quantidade na frente da caixa
        const bw = d.w * TS, bh = d.h * TS;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bw / 2 - 7, bh / 2 - 8, 14, 13);
        drawItemIcon(ctx, o.store.item, bw / 2, bh / 2 - 1.5, 11, 0);
        ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillText(o.store.n, bw / 2 + 0.5, bh - 2.5);
        ctx.fillStyle = '#fff'; ctx.fillText(o.store.n, bw / 2, bh - 3);
      }
      if (o.hp < d.hp) {
        ctx.fillStyle = '#300'; ctx.fillRect(0, -4, d.w * TS, 2.5);
        ctx.fillStyle = '#f55'; ctx.fillRect(0, -4, d.w * TS * (o.hp / d.hp), 2.5);
      }
      ctx.restore();
    }
    // tiles
    for (let y = 1; y < s.h - 1; y++)
      for (let x = 1; x < s.w - 1; x++) {
        const t = s.tiles[y * s.w + x];
        if (t) {
          const shp = t === T.RAIL ? railMask(s, x, y) : s.shapes[y * s.w + x];
          drawTileShape(ctx, t, x * TS, y * TS, TS, shp);
          const hp = s.tileHp[y * s.w + x], max = TILE_INFO[t].hp;
          if (hp < max) {
            ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - hp / max)})`;
            if (shp) { const q = shapePoly(shp, x * TS, y * TS, TS); ctx.beginPath(); q.forEach(([a, b], k) => (k ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.fill(); }
            else ctx.fillRect(x * TS, y * TS, TS, TS);
          }
        }
      }
    // carrinhos de munição (passam por cima dos trilhos, atrás dos itens)
    for (const c of s.carts || []) drawCart(ctx, c);
    // itens soltos
    for (const it of s.items) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(it.x + it.w / 2, it.y + it.h, 4.5, 1.1, 0, 0, 6.3); ctx.fill();
      drawItemIcon(ctx, it.item, it.x + it.w / 2, it.y + it.h / 2, 12, it.rot);
      if (it.n > 1) {
        ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(it.n, it.x + it.w + 2.5, it.y + it.h + 1.5);
        ctx.fillStyle = '#fff'; ctx.fillText(it.n, it.x + it.w + 2, it.y + it.h + 1);
      }
    }
    // torretas
    // a munição aparece aos poucos conforme o zoom chega perto (1.8 → 2.4)
    const ammoAlpha = s === g.ship ? clamp((g.cam.zoom - 1.8) / 0.6, 0, 1) : 0;
    for (const t of s.turrets) {
      const p = s.turretLocal(t);
      const d = TURRETS[t.type];
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.save(); ctx.rotate(SIDE_ANGLE[t.side]);
      ctx.fillStyle = shade(d.color, -0.4); rrect(ctx, -6, -TS * 1.5, 7, TS * 3, 2); ctx.fill();
      ctx.fillStyle = shade(d.color, -0.15); ctx.fillRect(-5, -TS * 1.5 + 2, 2, TS * 3 - 4);
      ctx.restore();
      ctx.save(); ctx.rotate(t.angle);
      const rec = (t.recoil || 0) * 3;
      ctx.fillStyle = shade(d.color, -0.5); rrect(ctx, 4 - rec, -3.2, 19, 6.4, 1.5); ctx.fill();
      ctx.fillStyle = shade(d.color, -0.2); ctx.fillRect(5 - rec, -2.4, 16, 1.6);
      if (t.type === 'turret_burst') { ctx.fillStyle = shade(d.color, -0.5); ctx.fillRect(4 - rec, -6.4, 15, 2); ctx.fillRect(4 - rec, 4.4, 15, 2); }
      ctx.fillStyle = t.ammoType ? AMMO[t.ammoType].color : '#3a3a3a';
      ctx.fillRect(19 - rec, -3.2, 4, 6.4);
      ctx.restore();
      const dg = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10.5);
      dg.addColorStop(0, shade(d.color, 0.45)); dg.addColorStop(1, shade(d.color, -0.25));
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(d.color, -0.6); ctx.lineWidth = 1; ctx.stroke();
      if (g.player && (g.player.ctrl === t || (g.player.mode === 'gunner' && g.player.ctrl && g.player.ctrl.side === t.side && !d.rc))) { ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke(); }
      // munição (só na própria nave e com o zoom perto): "13/24", no estilo da quantidade dos itens
      if (ammoAlpha > 0) {
        const txt = `${t.ammo}/${d.cap}`;
        ctx.globalAlpha = ammoAlpha;
        ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(txt, 0.5, 16.5);
        ctx.fillStyle = t.ammo > 0 ? '#fff' : '#ff7a6a'; ctx.fillText(txt, 0, 16);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    // tripulação
    for (const c of s.crewNet || []) {
      if (s === g.ship && c.id === g.pid) continue;
      this.drawPlayer(ctx, c);
    }
    if (s === g.ship && g.player) this.drawPlayer(ctx, g.player);
    if (s.team === 'pirate') this.drawPirateCrew(ctx, s);
    if (s.hitFlash > 0 && s.shield <= 0) {
      ctx.fillStyle = `rgba(255,80,40,${s.hitFlash * 0.25})`;
      rrect(ctx, 0, 0, pw, ph, 5); ctx.fill();
    }
    ctx.restore();
  }

  drawPirateCrew(ctx, s) {
    const n = Math.min(4, s.turrets.length);
    for (let i = 0; i < n; i++) {
      const x = (2 + ((i * 7) % (s.w - 4))) * TS, y = (s.h - 1) * TS - 22;
      const sw = Math.sin(this.game.time * 0.7 + i * 2);
      this.drawPerson(ctx, x + sw * 8, y, '#b64848', sw > 0 ? 1 : -1, this.game.time * 5 + i, '#2a1414');
    }
  }

  drawPerson(ctx, x, y, color, facing, walk, hair = '#4a3020', boots = '#15181f') {
    // x,y = canto superior esquerdo de uma caixa 10x22
    const sw = Math.sin(walk) * 2.6;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(x + 5, y + 22, 5.2, 1.3, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#262b3a';
    rrect(ctx, x + 1.6 + sw * 0.5, y + 14.5, 3, 7.3, 1); ctx.fill();
    rrect(ctx, x + 5.4 - sw * 0.5, y + 14.5, 3, 7.3, 1); ctx.fill();
    ctx.fillStyle = boots;
    ctx.fillRect(x + 1.3 + sw * 0.5 + (facing > 0 ? 0 : -0.6), y + 20.3, 3.9, 1.7);
    ctx.fillRect(x + 5.1 - sw * 0.5 + (facing > 0 ? 0 : -0.6), y + 20.3, 3.9, 1.7);
    ctx.fillStyle = color; rrect(ctx, x + 0.8, y + 7, 8.4, 8.6, 2.2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x + 1.8, y + 7.7, 6.4, 1.3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 0.8, y + 13.4, 8.4, 1.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + 5 - facing * 0.5, y + 9.3); ctx.lineTo(x + 5 + facing * 1.2 - sw * 0.9, y + 13.6); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#f2d0a8';
    ctx.beginPath(); ctx.arc(x + 5, y + 3.9, 3.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(x + 5, y + 3.5, 4.1, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.fillRect(x + 5 - facing * 4.1 - (facing > 0 ? 0 : 1.2), y + 2.6, 1.2, 2.6);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x + 5 + facing * 1.7 - 0.6, y + 3.7, 1.2, 1.4);
  }

  drawPlayer(ctx, p) {
    // degraus pequenos (fim de rampa encontrando o platô) são suavizados só no desenho
    const off = p === this.game.player ? p.visOff || 0 : 0;
    if (!off) return this.drawPlayerRaw(ctx, p);
    ctx.save(); ctx.translate(0, off); this.drawPlayerRaw(ctx, p); ctx.restore();
  }

  drawPlayerRaw(ctx, p) {
    const me = p === this.game.player;
    if (p.jetting) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = choice(['rgba(255,216,74,0.8)', 'rgba(255,154,60,0.7)', 'rgba(255,93,59,0.6)']);
        ctx.fillRect(p.x + (p.facing > 0 ? -2 : 9) + rand(-0.5, 0.8), p.y + 16 + rand(0, 8), 2.6, 4);
      }
      ctx.restore();
    }
    if (p.equip.back === 'jetpack') {
      ctx.fillStyle = '#6d7480'; rrect(ctx, p.x + (p.facing > 0 ? -2.2 : 9), p.y + 6.5, 3.2, 9.5, 1); ctx.fill();
      ctx.fillStyle = '#d07070'; ctx.fillRect(p.x + (p.facing > 0 ? -2.2 : 9), p.y + 8, 3.2, 1.4);
    }
    let color = '#e08a3a';
    if (!me) { let h = 0; for (const ch of String(p.name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; color = `hsl(${(h + (p.id || 0) * 47) % 360},55%,55%)`; }
    const walking = p.mode === 'walk' || p.mode === undefined;
    this.drawPerson(ctx, p.x, p.y, color, p.facing, walking ? (p.onGround ? p.walkAnim : 0.7) : 0, '#4a3020', p.equip.feet ? ITEMS[p.equip.feet].color : '#15181f');
    const h = p.held;
    if (h && walking) {
      const ang = me ? (this.game.aimAngle || 0) : (p.aim || 0);
      drawItemIcon(ctx, h.item, p.cxL + Math.cos(ang) * 9, p.cyL + 1 + Math.sin(ang) * 6, 9);
    }
    ctx.font = 'bold 4.6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(p.name, p.cxL + 0.3, p.y - 2.2);
    ctx.fillStyle = me ? '#ffffff' : '#bfe8ff'; ctx.fillText(p.name, p.cxL, p.y - 2.5);
  }

  drawShipBars(ctx, s) {
    const zoom = this.game.cam.zoom, k = 1 / zoom;
    const w = clamp(s.pw * zoom * 0.55, 90, 210);
    ctx.save(); ctx.translate(s.cx, s.y - 14 * k - 9); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rrect(ctx, -w / 2 - 2, -14, w + 4, 15, 4); ctx.fill();
    ctx.fillStyle = '#16304a'; ctx.fillRect(-w / 2, -12, w, 6);
    ctx.fillStyle = '#58bcff'; ctx.fillRect(-w / 2, -12, w * clamp(s.shield / s.maxShield, 0, 1), 6);
    ctx.fillStyle = '#1c3a1c'; ctx.fillRect(-w / 2, -5, w, 4);
    ctx.fillStyle = s.integrity / s.maxIntegrity > 0.35 ? '#7fe07f' : '#ff6a4a';
    ctx.fillRect(-w / 2, -5, w * clamp(s.integrity / s.maxIntegrity, 0, 1), 4);
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(s.name, 0, -19);
    ctx.fillStyle = s === this.game.ship ? '#ffffff' : s.team === 'player' ? '#9fe8ff' : '#ff9a9a';
    ctx.fillText(s.name, 0, -19);
    ctx.restore();
  }

  drawBot(ctx, b) {
    const d = BOTS[b.type];
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(0, 0, b.r * 0.6, 0, 0, b.r * 2);
    gl.addColorStop(0, hexA(d.color, 0.35)); gl.addColorStop(1, hexA(d.color, 0));
    ctx.fillStyle = gl; ctx.fillRect(-b.r * 2, -b.r * 2, b.r * 4, b.r * 4);
    ctx.restore();
    ctx.fillStyle = b.flash > 0 ? '#fff' : shade(d.color, -0.45);
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
    const bg = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.35, b.r * 0.1, 0, 0, b.r * 0.85);
    bg.addColorStop(0, shade(d.color, 0.35)); bg.addColorStop(1, shade(d.color, -0.2));
    ctx.fillStyle = b.flash > 0.5 ? '#fff' : bg;
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.84, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.rotate(b.rot);
    ctx.strokeStyle = shade(d.color, -0.55); ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * b.r * 0.52, Math.sin(a) * b.r * 0.52); ctx.lineTo(Math.cos(a) * b.r * 0.82, Math.sin(a) * b.r * 0.82); ctx.stroke();
    }
    ctx.restore();
    const ex = Math.cos(b.angle) * b.r * 0.3, ey = Math.sin(b.angle) * b.r * 0.3;
    ctx.fillStyle = d.core;
    ctx.beginPath(); ctx.arc(ex, ey, b.r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(ex * 1.4, ey * 1.4, b.r * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(ex - b.r * 0.1, ey - b.r * 0.12, b.r * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (b.hp < b.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(b.x - b.r - 1, b.y - b.r - 10, b.r * 2 + 2, 5);
      ctx.fillStyle = '#f55'; ctx.fillRect(b.x - b.r, b.y - b.r - 9, b.r * 2 * (b.hp / b.maxHp), 3);
    }
  }

  drawBullets(ctx, w) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of w.bullets) {
      const a = AMMO[b.ammo];
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const tl = Math.min(26, sp * 0.02);
      ctx.strokeStyle = a.color; ctx.lineWidth = b.r * 1.3;
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.moveTo(b.x - b.vx / sp * tl, b.y - b.vy / sp * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 0.22; ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx, w) {
    const rock = w.zone.rock;
    // detritos opacos
    for (const p of w.particles) {
      if (p.color !== rock && p.color !== '#777') continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    // faíscas e fogo com brilho
    ctx.globalCompositeOperation = 'lighter';
    for (const p of w.particles) {
      if (p.color === rock || p.color === '#777') continue;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a * 0.25;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.6, 0, 6.3); ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---------- pré-visualização de construção ----------
  drawCursorPreview(ctx) {
    const g = this.game, p = g.player, s = g.ship;
    if (!p || !s || p.mode !== 'walk' || g.ui.blocking()) return;
    const m = g.mouseWorld;
    const lx = m.x - s.x, ly = m.y - s.y;
    const cx = Math.floor(lx / TS), cy = Math.floor(ly / TS);
    const h = p.held;
    const inReach = dist(p.cxL, p.cyL, lx, ly) <= REACH;
    ctx.save(); ctx.translate(s.x, s.y);
    if (h) {
      const d = ITEMS[h.item];
      if (d.kind === 'tile') {
        const ok = inReach && g.canPlaceTile(cx, cy);
        const shp = d.tile === T.RAIL ? railMask(s, cx, cy) : g.shapeFor(h.item);
        ctx.globalAlpha = 0.55; drawTileShape(ctx, d.tile, cx * TS, cy * TS, TS, shp); ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? '#6eff6e' : '#ff5050'; ctx.lineWidth = 1; ctx.strokeRect(cx * TS + 0.5, cy * TS + 0.5, TS - 1, TS - 1);
        if (SHAPED_TILES.has(d.tile) && !g.shapeWheel) {
          // lembrete de que dá para trocar o formato
          ctx.font = 'bold 4px sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('R: formato', cx * TS + TS / 2 + 0.3, cy * TS + TS + 5.3);
          ctx.fillStyle = 'rgba(200,255,200,0.85)'; ctx.fillText('R: formato', cx * TS + TS / 2, cy * TS + TS + 5);
        }
      } else if (d.kind === 'object') {
        const od = OBJECTS[d.obj];
        const ox = cx - Math.floor((od.w - 1) / 2), oy = cy - (od.h - 1);
        const ok = inReach && s.canPlaceObject(d.obj, ox, oy);
        ctx.globalAlpha = 0.5; ctx.save(); ctx.translate(ox * TS, oy * TS);
        const ld = g.loaderDirs;
        drawObjectShape(ctx, { type: d.obj, queue: [], mats: {}, fuel: 0, din: ld.din, dout: ld.dout, side: GUN_SIDES[g.gunSide] }, od.w * TS, od.h * TS, d.obj === 'loader'); ctx.restore(); ctx.globalAlpha = 1;
        if (d.obj === 'gunnery' && !g.shapeWheel) {
          ctx.font = 'bold 4px sans-serif'; ctx.textAlign = 'center';
          const lbl = `R: lado (${GUN_SIDE_NAMES[GUN_SIDES[g.gunSide]]})`, ly2 = (oy + od.h) * TS + 5;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(lbl, (ox + od.w / 2) * TS + 0.3, ly2 + 0.3);
          ctx.fillStyle = 'rgba(200,255,200,0.85)'; ctx.fillText(lbl, (ox + od.w / 2) * TS, ly2);
        }
        if (d.obj === 'loader' && !g.shapeWheel) {
          ctx.font = 'bold 4px sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('R: direções', cx * TS + TS / 2 + 0.3, cy * TS + TS + 5.3);
          ctx.fillStyle = 'rgba(200,255,200,0.85)'; ctx.fillText('R: direções', cx * TS + TS / 2, cy * TS + TS + 5);
        }
        ctx.strokeStyle = ok ? '#6eff6e' : '#ff5050'; ctx.lineWidth = 1; ctx.strokeRect(ox * TS + 0.5, oy * TS + 0.5, od.w * TS - 1, od.h * TS - 1);
        if (od.floor) { ctx.fillStyle = ok ? 'rgba(110,255,110,0.3)' : 'rgba(255,80,80,0.3)'; ctx.fillRect(ox * TS, (oy + od.h) * TS, od.w * TS, 3); }
      } else if (d.kind === 'turret') {
        const hs = s.hullCellToSide(cx, cy);
        if (hs) {
          const ok = inReach && s.canPlaceTurret(hs.side, hs.pos);
          ctx.strokeStyle = ok ? '#6eff6e' : '#ff5050'; ctx.lineWidth = 2;
          if (hs.side === 'top' || hs.side === 'bottom') ctx.strokeRect((hs.pos - 1) * TS, cy * TS, TS * 3, TS);
          else ctx.strokeRect(cx * TS, (hs.pos - 1) * TS, TS, TS * 3);
        }
      } else if (d.tool === 'wrench' || d.tool === 'shredder') {
        ctx.strokeStyle = inReach ? 'rgba(255,220,80,0.8)' : 'rgba(255,80,80,0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(cx * TS + 0.5, cy * TS + 0.5, TS - 1, TS - 1);
      } else if (d.tool === 'embiggener' || d.tool === 'shrinker') {
        this.drawResizePreview(ctx, s, d.tool === 'embiggener' ? 1 : -1, lx, ly, inReach);
      }
    }
    // dica do que está sob o mouse (itens, torretas, construções); com Ampliador/Encolhedor
    // o clique redimensiona a nave, então a dica da construção não se aplica
    const resizing = h && (ITEMS[h.item].tool === 'embiggener' || ITEMS[h.item].tool === 'shrinker');
    if (!resizing) this.drawHover(ctx, lx, ly, cx, cy, h, inReach);
    // progresso da chave inglesa
    if (g.wrench && g.wrench.t > 0) {
      ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(lx, ly, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (g.wrench.t / g.wrench.need)); ctx.stroke();
    }
    // alcance
    if (!inReach && h) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.cxL, p.cyL, REACH, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- dica ao passar o mouse ----------
  // Mesma prioridade do clique: item solto > torreta > construção.
  // Blocos (escada, passarela etc.) não têm dica: só o que tem função.
  hoverInfo(lx, ly, cx, cy, h) {
    const s = this.game.ship;
    const hd = h ? ITEMS[h.item] : null;
    const wrench = hd && hd.tool === 'wrench';
    const L = [];                       // linhas: { t, c }
    const hint = (t) => L.push({ t: t[0].toUpperCase() + t.slice(1), c: '#9fe0ff' });
    const info = (t, c = '#d8d8d8') => L.push({ t, c });
    const hpLine = (hp, max) => { if (hp < max) info(`Integridade ${Math.ceil(hp)}/${max}`, hp / max < 0.35 ? '#ff8a7a' : '#ffd890'); };

    // item solto
    let it = null, bd = 12;
    for (const x of s.items) { const d = dist(lx, ly, x.x + x.w / 2, x.y + x.h / 2); if (d < bd) { bd = d; it = x; } }
    if (it) {
      const d = ITEMS[it.item];
      if (hd && hd.tool === 'shredder') hint('destruir');
      return { rect: { x: it.x - 1, y: it.y - 1, w: it.w + 2, h: it.h + 2 }, title: d.name + (it.n > 1 ? ` ×${it.n}` : ''), rare: RARE_ITEMS.has(it.item), lines: L };
    }

    // torreta
    let t = s.turretAtHull(cx, cy);
    if (!t) for (const x of s.turrets) { const q = s.turretLocal(x); if (dist(lx, ly, q.x, q.y) < 14) { t = x; break; } }
    if (t) {
      const td = TURRETS[t.type], q = s.turretLocal(t);
      info(t.ammo > 0 ? `Munição ${t.ammo}/${td.cap}${t.ammoType ? ' • ' + AMMO[t.ammoType].name : ''}` : 'Sem munição', t.ammo > 0 ? '#d8d8d8' : '#ff8a7a');
      if (t.hp !== undefined) hpLine(t.hp, 60);
      if (wrench) hint('Segure para desmontar');
      else if (hd && hd.kind === 'ammo') hint('Carregar (Shift: pilha toda)');
      else if (td.rc) hint('Controlada pelo leme');
      else hint('controlar');
      return { rect: { x: q.x - 9, y: q.y - 9, w: 18, h: 18 }, title: td.name, rare: RARE_ITEMS.has(t.type), lines: L };
    }

    // construção
    const o = s.objectAt(cx, cy);
    if (o) {
      const od = OBJECTS[o.type];
      const rect = { x: o.x * TS, y: o.y * TS, w: od.w * TS, h: od.h * TS };
      let zones = null;
      if (od.fab) {
        const r = o.queue && o.queue[0] && RECIPES[od.fab][o.queue[0].r];
        if (r) {
          if (o.stalled && !o.started) info(`${ITEMS[r.out].name}: falta material`, '#ffb070');
          else info(`${ITEMS[r.out].name} ${Math.floor(100 * (o.progress || 0) / r.t)}%`);
        }
        if (!wrench) hint(h && FAB_MATS.includes(h.item) ? `Carregar ${hd.name}` : 'Abrir');
      } else switch (o.type) {
        case 'helm': if (!wrench) hint('pilotar'); break;
        case 'gunnery': {
          const n = gunneryTurrets(s, o).length;
          info(`Controla: torretas da ${GUN_SIDE_NAMES[o.side]} (${n})`, n ? '#d8d8d8' : '#ffb070');
          const user = (s.crewNet || []).find((c) => c.mode === 'gunner' && c.id !== g.pid && Math.abs(c.x + 6 - (o.x + 1) * TS) < 10 && Math.abs(c.y + 22 - (o.y + 2) * TS) < 4);
          if (user) info(`Em uso por ${user.name}`, '#ffb070');
          if (!wrench) hint('usar');
          break;
        }
        case 'door': info(o.open ? 'Aberta' : 'Fechada'); if (!wrench) hint(o.open ? 'fechar' : 'abrir'); break;
        case 'hatch': {
          info(o.open ? 'Aberta' : 'Fechada', o.open ? '#8aff8a' : '#ff8a7a');
          const f = o.filter || [], names = f.length > 2 ? `${f.length} itens` : f.map((k) => ITEMS[k].name).join(', ');
          if (o.fmode === 'allow') info(f.length ? `Só deixa passar: ${names}` : 'Só deixa passar: (nada marcado)', f.length ? '#d8d8d8' : '#ffb070');
          else if (f.length) info(`Não deixa passar: ${names}`);
          if (!wrench) hint('configurar');
          break;
        }
        case 'shield_gen':
          info(`Carga ${Math.round(o.fuel || 0)}`);
          if (!wrench) hint(h && (h.item === 'booster' || h.item === 'flux') ? `abastecer com ${hd.name}` : 'Abasteça com Reforço ou Fluxo');
          break;
        case 'recycler': if (!wrench) hint(h ? `reciclar ${hd.name}` : 'Segure um item para reciclar'); break;
        case 'loader': {
          info(`Pega ${LOADER_ARROWS[o.din]} ${LOADER_DIR_NAMES[o.din]} • coloca ${LOADER_ARROWS[o.dout]} ${LOADER_DIR_NAMES[o.dout]}`);
          if (o.filter && o.filter.length) info(`Filtro: ${o.filter.length > 2 ? o.filter.length + ' itens' : o.filter.map((k) => ITEMS[k].name).join(', ')}`, '#bcbcbc');
          if (o.only) info('Só em máquinas', '#bcbcbc');
          if (o.carry) info(`${ITEMS[o.carry.item].name} ×${o.carry.n}${o.wait ? ' — esperando espaço' : ''}`, o.wait ? '#ffb070' : '#d8d8d8');
          if (!wrench) hint('configurar');
          break;
        }
        case 'ejector': if (!wrench) hint(h ? `lançar ${hd.name} ao espaço` : 'Segure um item para lançar'); break;
        case 'ammo_crate':
        case 'expando': {
          const st = o.store || { item: null, n: 0 };
          info(st.item ? `${ITEMS[st.item].name} ${st.n}/${expandoCap(st.item)}` : 'Vazia', st.item ? '#d8d8d8' : '#bcbcbc');
          if (o.type === 'ammo_crate') {
            const d = OBJECTS.ammo_crate;
            let linked = false;
            for (let k = 0; k < d.w && !linked; k++) linked = s.get(o.x + k, o.y - 1) === T.RAIL || s.get(o.x + k, o.y + d.h) === T.RAIL;
            for (let k = 0; k < d.h && !linked; k++) linked = s.get(o.x - 1, o.y + k) === T.RAIL || s.get(o.x + d.w, o.y + k) === T.RAIL;
            const cart = (s.carts || []).find((c) => c.id === o.id);
            if (!linked) info('Sem trilho: encoste um Trilho na caixa', '#ffb070');
            else if (cart) info(`Carrinho na rota: ${ITEMS[cart.item].name} ×${cart.n}`);
            else if (st.item) info('Carrinho saindo…', '#bcbcbc');
          }
          if (wrench) break;
          const half = rect.h / 2, top = ly < rect.y + half;
          let upTxt, upOk, dnTxt, dnOk;
          if (!h) { upTxt = o.type === 'ammo_crate' ? 'Segure uma munição para guardar' : 'Segure um item para guardar'; upOk = false; }
          else if (o.type === 'ammo_crate' && hd.kind !== 'ammo') { upTxt = 'Só guarda munição'; upOk = false; }
          else if (st.item && st.item !== h.item) { upTxt = `Só guarda ${ITEMS[st.item].name}`; upOk = false; }
          else if (st.n >= expandoCap(h.item)) { upTxt = 'Caixa cheia'; upOk = false; }
          else { upTxt = `Guardar ${hd.name}`; upOk = true; }
          if (!st.item) { dnTxt = 'Nada para retirar'; dnOk = false; }
          else { dnTxt = `Retirar ${ITEMS[st.item].name}`; dnOk = true; }
          L.push({ t: top ? upTxt : dnTxt, c: (top ? upOk : dnOk) ? '#9fe0ff' : '#ff8a7a' });
          zones = { half, top, upOk, dnOk };
          break;
        }
      }
      hpLine(o.hp, od.hp);
      if (wrench) hint('Segure para desmontar');
      return { rect, title: od.name, lines: L, zones };
    }

    return null;
  }

  // desenha só os quatro cantos de um retângulo
  drawCorners(ctx, x, y, w, h, len) {
    const l = Math.min(len, w / 2.5, h / 2.5);
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
  }

  drawHover(ctx, lx, ly, cx, cy, h, inReach) {
    const H = this.hoverInfo(lx, ly, cx, cy, h);
    if (!H) return;
    const r = H.rect;
    // destaque do alvo
    if (H.zones) {
      const z = H.zones, okC = inReach ? '110,255,110' : '255,255,255', badC = '255,90,90';
      const zone = (zy, ok, active) => {
        const c = ok ? okC : badC;
        ctx.fillStyle = `rgba(${c},${active ? 0.25 : 0.07})`; ctx.fillRect(r.x, zy, r.w, z.half);
        if (active) { ctx.strokeStyle = `rgba(${c},0.9)`; ctx.lineWidth = 0.8; this.drawCorners(ctx, r.x + 0.5, zy + 0.5, r.w - 1, z.half - 1, 4); }
      };
      zone(r.y, z.upOk, z.top); zone(r.y + z.half, z.dnOk, !z.top);
      const arrow = (ax, ay, dir, active) => {
        ctx.fillStyle = active ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.moveTo(ax - 2.5, ay - 1.2 * dir); ctx.lineTo(ax + 2.5, ay - 1.2 * dir); ctx.lineTo(ax, ay + 1.7 * dir); ctx.fill();
      };
      arrow(r.x + 4, r.y + z.half / 2, 1, z.top); arrow(r.x + 4, r.y + z.half * 1.5, -1, !z.top);
    } else {
      ctx.strokeStyle = 'rgba(83, 255, 91, 0.85)'; ctx.lineWidth = 0.8;
      this.drawCorners(ctx, r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1, 4);
    }
    // caixa de texto acima do alvo
    const TF = 'bold 4.5px sans-serif', BF = '3.8px sans-serif', LH = 4.8, MAXW = 90;
    const GREEN = '#53ff5b', GREEN_DIM = '#a6ffab';
    const rows = [{ t: H.title, c: GREEN, f: TF }];
    ctx.font = BF;
    for (const l of H.lines) {
      // quebra linhas longas (descrições)
      let cur = '';
      for (const w of l.t.split(' ')) {
        const test = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(test).width > MAXW) { rows.push({ t: cur, c: l.c, f: BF }); cur = w; } else cur = test;
      }
      if (cur) rows.push({ t: cur, c: l.c, f: BF });
    }
    if (!inReach && H.lines.length) rows.push({ t: 'muito longe', c: '#ff8a7a', f: BF });
    let tw = 0;
    for (const row of rows) { ctx.font = row.f; tw = Math.max(tw, ctx.measureText(row.t).width); }
    const pad = 2, bw = tw + pad * 2, bh = rows.length * LH + pad * 1.5;
    const by = r.y - bh - 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // sem caixa de fundo: texto verde com uma sombra escura leve para ler sobre qualquer fundo
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 1.5;
    rows.forEach((row, i) => {
      ctx.font = row.f;
      // vermelho/laranja continuam para avisos (caixa cheia, sem munição, muito longe...)
      const warn = row.c === '#ff8a7a' || row.c === '#ffb070';
      ctx.fillStyle = warn ? row.c : i === 0 ? GREEN : (!inReach ? '#8a8a8a' : GREEN_DIM);
      ctx.fillText(row.t, r.x + r.w / 2, by + pad + (i + 1) * LH - 1.2);
    });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  // Braço do Carregador: parado aponta para a entrada; carregando, gira da entrada até a saída
  // em LOADER_TIME s (o cronômetro é local: o servidor só avisa quando um movimento começa).
  drawLoaderArmAnim(ctx, o) {
    const A = this.loaderAnim || (this.loaderAnim = new Map());
    const key = o.carry ? o.seq + ':' + o.carry.item : null;
    let st = A.get(o.id);
    if (!st || st.key !== key) { st = { key, t0: performance.now() }; A.set(o.id, st); }
    const ain = Math.atan2(LOADER_DIRS[o.din][1], LOADER_DIRS[o.din][0]), aout = Math.atan2(LOADER_DIRS[o.dout][1], LOADER_DIRS[o.dout][0]);
    let a = ain, item = null, len = 0.42;
    if (o.carry) {
      const k = o.wait ? 1 : Math.min(1, (performance.now() - st.t0) / 1000 / LOADER_TIME);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // suaviza início e fim
      a = ain + angDiff(ain, aout) * e;
      item = o.carry.item;
      len = 0.42 + Math.sin(k * Math.PI) * -0.12;   // recolhe um pouco no meio do caminho
    }
    drawLoaderArm(ctx, TS, TS, [Math.cos(a), Math.sin(a)], len, item);
    if (o.carry && o.carry.n > 1) {
      ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillText(o.carry.n, TS + 0.5, TS + 0.5);
      ctx.fillStyle = '#fff'; ctx.fillText(o.carry.n, TS, TS);
    }
  }

  // prévia do Ampliador (onde entra a coluna/linha nova) e do Encolhedor (o que sai, ou por que não)
  drawResizePreview(ctx, s, dir, lx, ly, inReach) {
    const g = this.game, ax = g.resizeAxis, X = ax === 'x';
    const at = resizeTarget(s, ax, dir, lx, ly);
    let ok = inReach, label;
    const GREEN = '83,255,91', RED = '255,90,90';
    if (dir > 0) {
      const v = at * TS;
      ctx.strokeStyle = `rgba(${GREEN},0.95)`; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.beginPath();
      if (X) { ctx.moveTo(v, -6); ctx.lineTo(v, s.ph + 6); } else { ctx.moveTo(-6, v); ctx.lineTo(s.pw + 6, v); }
      ctx.stroke(); ctx.setLineDash([]);
      // setas mostrando para onde o conteúdo anda
      ctx.fillStyle = `rgba(${GREEN},0.9)`;
      const arrow = (x, y) => { ctx.beginPath(); if (X) { ctx.moveTo(x + 1, y - 3); ctx.lineTo(x + 6, y); ctx.lineTo(x + 1, y + 3); } else { ctx.moveTo(x - 3, y + 1); ctx.lineTo(x, y + 6); ctx.lineTo(x + 3, y + 1); } ctx.fill(); };
      if (X) { arrow(v, -3); arrow(v, s.ph + 3); } else { arrow(-3, v); arrow(s.pw + 3, v); }
      label = s.w + (X ? 1 : 0) > MAX_SHIP_TILES || s.h + (X ? 0 : 1) > MAX_SHIP_TILES ? 'Tamanho máximo atingido' : `Inserir ${X ? 'coluna' : 'linha'} aqui`;
      if (label !== `Inserir ${X ? 'coluna' : 'linha'} aqui`) ok = false;
    } else {
      const people = [g.player, ...(s.crewNet || [])].filter((p) => p && p.x !== undefined && (p.mode === 'walk' || p.mode === undefined))
        .map((p) => ({ x: p.x, y: p.y, w: p.w || 12, h: p.h || 22 }));
      const err = s.shrinkBlocker(ax, at, people);
      if (err) ok = false;
      label = err || `Remover esta ${X ? 'coluna' : 'linha'}`;
      const c = ok ? GREEN : RED;
      const rx = X ? at * TS : 0, ry = X ? 0 : at * TS, rw = X ? TS : s.pw, rh = X ? s.ph : TS;
      ctx.fillStyle = `rgba(${c},0.18)`; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = `rgba(${c},0.9)`; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1); ctx.setLineDash([]);
    }
    if (!inReach) label = 'Muito longe';
    // legenda junto do mouse, no mesmo estilo das outras dicas
    ctx.font = 'bold 4.5px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 1.5;
    ctx.fillStyle = ok ? '#53ff5b' : '#ff8a7a';
    ctx.fillText(label, lx, ly - 8);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  // ---------- roda de formatos (segurar R com Bloco ou Rede) ----------
  drawDirWheel(ctx) {
    const g = this.game, wh = g.shapeWheel, ld = g.loaderDirs;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.86)';
    ctx.beginPath(); ctx.arc(wh.cx, wh.cy, DIR_WHEEL.outer + 32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(83,255,91,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineWidth = 1;
    for (const [r, c] of [[DIR_WHEEL.inner, 'rgba(90,180,255,0.25)'], [DIR_WHEEL.outer, 'rgba(255,160,64,0.25)']]) { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(wh.cx, wh.cy, r, 0, Math.PI * 2); ctx.stroke(); }
    // Carregador no centro, já com as direções escolhidas
    ctx.save(); ctx.translate(wh.cx - 22, wh.cy - 22);
    drawObjectShape(ctx, { type: 'loader', din: ld.din, dout: ld.dout }, 44, 44, true);
    ctx.restore();
    for (let i = 0; i < 16; i++) {
      const { x, y, r } = dirWheelSlot(i, wh.cx, wh.cy);
      const isIn = i < 8, k = i % 8, sel = isIn ? ld.din === k : ld.dout === k, hov = wh.hover === i;
      const col = isIn ? '90,180,255' : '255,160,64';
      ctx.fillStyle = hov ? `rgba(${col},0.35)` : sel ? `rgba(${col},0.22)` : 'rgba(20,30,46,0.92)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = hov || sel ? 2 : 1.2;
      ctx.strokeStyle = hov ? '#53ff5b' : sel ? `rgb(${col})` : 'rgba(255,255,255,0.18)'; ctx.stroke();
      // seta: entrada aponta para o centro (o item vem de lá), saída aponta para fora
      const [dx, dy] = LOADER_DIRS[k], a = Math.atan2(dy, dx) + (isIn ? Math.PI : 0), s2 = r * 0.55;
      ctx.fillStyle = sel || hov ? '#fff' : `rgba(${col},0.9)`;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * s2, y + Math.sin(a) * s2);
      ctx.lineTo(x + Math.cos(a + 2.4) * s2, y + Math.sin(a + 2.4) * s2);
      ctx.lineTo(x + Math.cos(a - 2.4) * s2, y + Math.sin(a - 2.4) * s2);
      ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
    const hv = wh.hover;
    ctx.font = 'bold 12px sans-serif';
    if (hv !== null) {
      ctx.fillStyle = hv < 8 ? '#7cc4ff' : '#ffb366';
      ctx.fillText(`${hv < 8 ? 'Pegar de' : 'Colocar em'}: ${LOADER_DIR_NAMES[hv % 8]}`, wh.cx, wh.cy - DIR_WHEEL.outer - 22);
    } else {
      ctx.fillStyle = '#c8f5ca';
      ctx.fillText(`Pega: ${LOADER_DIR_NAMES[ld.din]} • Coloca: ${LOADER_DIR_NAMES[ld.dout]}`, wh.cx, wh.cy - DIR_WHEEL.outer - 22);
    }
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('anel azul: pegar de • anel laranja: colocar em • clique escolhe, solte o R para fechar', wh.cx, wh.cy + DIR_WHEEL.outer + 22);
    ctx.restore();
  }

  drawSideWheel(ctx) {
    const g = this.game, wh = g.shapeWheel;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.86)';
    ctx.beginPath(); ctx.arc(wh.cx, wh.cy, SIDE_WHEEL_R + 40, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(83,255,91,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.translate(wh.cx - 24, wh.cy - 24);
    drawObjectShape(ctx, { type: 'gunnery', side: GUN_SIDES[g.gunSide] }, 48, 48, true);
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      const { x, y, r } = sideWheelSlot(i, wh.cx, wh.cy), hov = wh.hover === i, sel = g.gunSide === i;
      ctx.fillStyle = hov ? 'rgba(83,255,91,0.3)' : sel ? 'rgba(240,194,122,0.22)' : 'rgba(20,30,46,0.92)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = hov || sel ? 2 : 1.2; ctx.strokeStyle = hov ? '#53ff5b' : sel ? '#f0c27a' : 'rgba(255,255,255,0.18)'; ctx.stroke();
      const a = -Math.PI / 2 + i * Math.PI / 2, s2 = r * 0.55;
      ctx.fillStyle = hov || sel ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * s2, y + Math.sin(a) * s2); ctx.lineTo(x + Math.cos(a + 2.4) * s2, y + Math.sin(a + 2.4) * s2); ctx.lineTo(x + Math.cos(a - 2.4) * s2, y + Math.sin(a - 2.4) * s2); ctx.fill();
    }
    const show = wh.hover ?? g.gunSide, side = GUN_SIDES[show];
    const n = gunneryTurrets(g.ship, { side }).length;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#53ff5b';
    ctx.fillText(`Torretas da ${GUN_SIDE_NAMES[side] === 'cima' || GUN_SIDE_NAMES[side] === 'baixo' ? 'parte de ' : ''}${GUN_SIDE_NAMES[side]} (${n})`, wh.cx, wh.cy - SIDE_WHEEL_R - 52);
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('solte o R sobre o lado • Esc cancela', wh.cx, wh.cy + SIDE_WHEEL_R + 52);
    ctx.restore();
  }

  drawShapeWheel(ctx) {
    const g = this.game, wh = g.shapeWheel;
    if (wh.kind === 'dir') return this.drawDirWheel(ctx);
    if (wh.kind === 'side') return this.drawSideWheel(ctx);
    const tile = ITEMS[wh.item].tile;
    const cur = g.shapeFor(wh.item);
    ctx.save();
    // fundo
    ctx.fillStyle = 'rgba(8,12,20,0.86)';
    ctx.beginPath(); ctx.arc(wh.cx, wh.cy, SHAPE_WHEEL.outer + 32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(83,255,91,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    // miolo escuro para o nome ficar legível
    ctx.fillStyle = 'rgba(4,8,14,0.95)';
    ctx.beginPath(); ctx.arc(wh.cx, wh.cy, SHAPE_WHEEL.inner - 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (const r of [SHAPE_WHEEL.inner, SHAPE_WHEEL.outer]) { ctx.beginPath(); ctx.arc(wh.cx, wh.cy, r, 0, Math.PI * 2); ctx.stroke(); }
    for (let i = 0; i < SHAPES.length; i++) {
      const { x, y, r } = shapeWheelSlot(i, wh.cx, wh.cy);
      const hov = wh.hover === i, sel = cur === i;
      ctx.fillStyle = hov ? 'rgba(83,255,91,0.22)' : 'rgba(20,30,46,0.92)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = hov ? 2 : 1.2;
      ctx.strokeStyle = hov ? '#53ff5b' : sel ? '#f0c27a' : 'rgba(255,255,255,0.18)';
      ctx.stroke();
      const sz = r * 1.25;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      drawTileShape(ctx, tile, x - sz / 2, y - sz / 2, sz, i);
    }
    // centro: nome do formato sob o mouse (ou o atual)
    const show = wh.hover ?? cur;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
    const S = SHAPES[show], sub = S.name.startsWith(S.g) ? S.name.slice(S.g.length).trim() : S.name;
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#53ff5b';
    ctx.fillText(S.g, wh.cx, wh.cy - (sub ? 8 : 0));
    if (sub) {
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#c8f5ca';
      // quebra em duas linhas se não couber no miolo
      const words = sub.split(' '), maxW = (SHAPE_WHEEL.inner - 34) * 2;
      let l1 = sub, l2 = '';
      if (ctx.measureText(sub).width > maxW) { const k = Math.ceil(words.length / 2); l1 = words.slice(0, k).join(' '); l2 = words.slice(k).join(' '); }
      ctx.fillText(l1, wh.cx, wh.cy + 7); if (l2) ctx.fillText(l2, wh.cx, wh.cy + 19);
    }
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('solte o R para escolher • Esc cancela', wh.cx, wh.cy + SHAPE_WHEEL.outer + 20);
    ctx.restore();
  }

  drawOffscreenIndicators(ctx) {
    const g = this.game, w = g.world, s = g.ship;
    if (!s) return;
    const W_ = innerWidth, H_ = innerHeight;
    const mark = (wx, wy, color, label) => {
      const sx = (wx - g.cam.x) * g.cam.zoom + W_ / 2, sy = (wy - g.cam.y) * g.cam.zoom + H_ / 2;
      if (sx > 0 && sy > 0 && sx < W_ && sy < H_) return;
      const a = Math.atan2(sy - H_ / 2, sx - W_ / 2);
      const r = Math.min(W_, H_) / 2 - 40;
      const x = W_ / 2 + Math.cos(a) * r * (W_ / Math.min(W_, H_)) * 0.92, y = H_ / 2 + Math.sin(a) * r;
      const px = clamp(x, 30, W_ - 30), py = clamp(y, 30, H_ - 30);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.fill();
      ctx.restore();
      if (label) { ctx.fillStyle = color; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, px, py - 14); }
    };
    for (const sh of w.ships) {
      if (sh === s || dist(sh.cx, sh.cy, s.cx, s.cy) > 2600) continue;
      mark(sh.cx, sh.cy, sh.team === 'pirate' ? '#ff6a6a' : w.zone.pvp ? '#ffb05a' : '#7fe0ff', sh.name);
    }
    if (g.player && g.player.mode !== 'helm') { /* nada */ }
  }

  drawMinimap() {
    const g = this.game, w = g.world, m = this.mctx;
    const S = this.mini.width;
    if (this.terrainDirty || !this.terrainImg || this.terrainImg._n !== w.n || this.terrainImg._world !== w) {
      const c = document.createElement('canvas'); c.width = c.height = w.n;
      const x = c.getContext('2d');
      const img = x.createImageData(w.n, w.n);
      for (let i = 0; i < w.n * w.n; i++) {
        const t = w.terrain[i];
        const col = t === W.EMPTY ? [0, 0, 0, 0] : t === W.WALL ? [70, 80, 95, 255] : t === W.FLUX ? [180, 92, 255, 255] : t === W.DIAMOND ? [255, 255, 255, 255] : [120, 130, 140, 200];
        img.data.set(col, i * 4);
      }
      x.putImageData(img, 0, 0);
      c._n = w.n; c._world = w;
      this.terrainImg = c; this.terrainDirty = false;
    }
    m.clearRect(0, 0, S, S);
    m.fillStyle = 'rgba(5,10,20,0.75)'; m.fillRect(0, 0, S, S);
    m.imageSmoothingEnabled = false;
    m.drawImage(this.terrainImg, 0, 0, S, S);
    const k = S / w.size;
    for (const p of w.portals) {
      m.fillStyle = shade(ZONES[p.target].rockEdge, 0.3);
      m.beginPath(); m.arc(p.x * k, p.y * k, 5, 0, Math.PI * 2); m.fill();
    }
    for (const b of w.bots) { m.fillStyle = BOTS[b.type].color; m.fillRect(b.x * k - 1, b.y * k - 1, 2, 2); }
    for (const c of w.crates) { m.fillStyle = '#d0a060'; m.fillRect(c.x * k - 1, c.y * k - 1, 2, 2); }
    for (const s of w.ships) {
      m.fillStyle = s === g.ship ? '#ffffff' : s.team === 'player' ? '#5fd8ff' : '#ff5050';
      m.fillRect(s.x * k - 1, s.y * k - 1, Math.max(3, s.pw * k), Math.max(3, s.ph * k));
    }
    // vista da câmera
    const v = this.view;
    if (v) { m.strokeStyle = 'rgba(255,255,255,0.35)'; m.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k); }
  }
}

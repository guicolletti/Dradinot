// ============================================================
//  Renderização (canvas 2D)
// ============================================================
'use strict';

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
          drawTileShape(ctx, t, x * TS, y * TS, TS);
          const hp = s.tileHp[y * s.w + x], max = TILE_INFO[t].hp;
          if (hp < max) { ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - hp / max)})`; ctx.fillRect(x * TS, y * TS, TS, TS); }
        }
      }
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
      if (g.player && g.player.ctrl === t) { ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke(); }
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
        ctx.globalAlpha = 0.55; drawTileShape(ctx, d.tile, cx * TS, cy * TS, TS); ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? '#6eff6e' : '#ff5050'; ctx.lineWidth = 1; ctx.strokeRect(cx * TS + 0.5, cy * TS + 0.5, TS - 1, TS - 1);
      } else if (d.kind === 'object') {
        const od = OBJECTS[d.obj];
        const ox = cx - Math.floor((od.w - 1) / 2), oy = cy - (od.h - 1);
        const ok = inReach && s.canPlaceObject(d.obj, ox, oy);
        ctx.globalAlpha = 0.5; ctx.save(); ctx.translate(ox * TS, oy * TS);
        drawObjectShape(ctx, { type: d.obj, queue: [], mats: {}, fuel: 0 }, od.w * TS, od.h * TS); ctx.restore(); ctx.globalAlpha = 1;
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
        ctx.strokeStyle = d.color; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
        if (g.resizeAxis === 'x') { ctx.beginPath(); ctx.moveTo(s.pw + 4, 0); ctx.lineTo(s.pw + 4, s.ph); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(s.pw, -4); ctx.stroke(); }
        ctx.setLineDash([]);
      }
    }
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

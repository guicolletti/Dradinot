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
    for (let i = 0; i < 260; i++) this.stars.push({ x: Math.random(), y: Math.random(), z: rand(0.05, 0.35), s: rand(0.5, 2), a: rand(0.3, 1) });
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
    // fundo
    const grd = ctx.createLinearGradient(0, 0, 0, H_);
    grd.addColorStop(0, w.zone.bg[0]); grd.addColorStop(1, w.zone.bg[1]);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W_, H_);
    for (const s of this.stars) {
      const x = ((s.x * W_ * 3 - cam.x * s.z) % W_ + W_) % W_;
      const y = ((s.y * H_ * 3 - cam.y * s.z) % H_ + H_) % H_;
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(g.time * 2 + s.x * 50));
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // mundo
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
    for (const b of w.bots) if (this.inView(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, 20)) this.drawBot(ctx, b);
    this.drawBullets(ctx, w);
    for (const p of w.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.drawCursorPreview(ctx);

    // nomes/barras acima das naves
    for (const s of w.ships) if (this.inView(s.x, s.y, s.pw, s.ph, 80)) this.drawShipBars(ctx, s);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenIndicators(ctx);
    this.miniT -= dt;
    if (this.miniT <= 0) { this.drawMinimap(); this.miniT = 0.12; }
  }

  inView(x, y, w, h, m = 0) {
    const v = this.view;
    return x + w + m > v.x0 && x - m < v.x1 && y + h + m > v.y0 && y - m < v.y1;
  }

  // ---------- terreno ----------
  drawTerrain(ctx, w, v) {
    const x0 = Math.max(0, Math.floor(v.x0 / WTS)), x1 = Math.min(w.n - 1, Math.floor(v.x1 / WTS));
    const y0 = Math.max(0, Math.floor(v.y0 / WTS)), y1 = Math.min(w.n - 1, Math.floor(v.y1 / WTS));
    const z = w.zone;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const t = w.terrain[ty * w.n + tx];
        if (!t) continue;
        const x = tx * WTS, y = ty * WTS;
        const h = (tx * 73856093) ^ (ty * 19349663);
        if (t === W.WALL) {
          ctx.fillStyle = '#20262e'; ctx.fillRect(x, y, WTS, WTS);
          ctx.fillStyle = '#2c343e'; ctx.fillRect(x + 6, y + 6, WTS - 12, WTS - 12);
          ctx.fillStyle = '#3a4450';
          for (let k = 0; k < 4; k++) ctx.fillRect(x + 6, y + 18 + k * 28, WTS - 12, 4);
          continue;
        }
        ctx.fillStyle = z.rockEdge; ctx.fillRect(x, y, WTS, WTS);
        ctx.fillStyle = z.rock; ctx.fillRect(x + 5, y + 5, WTS - 10, WTS - 10);
        ctx.fillStyle = shade(z.rock, -0.15);
        ctx.fillRect(x + 20 + (h & 31), y + 24 + ((h >> 5) & 31), 26, 18);
        ctx.fillRect(x + 54 + ((h >> 10) & 15), y + 70 + ((h >> 14) & 15), 34, 14);
        // vizinhos vazios: borda clara
        ctx.fillStyle = shade(z.rockEdge, 0.25);
        if (!w.getW(tx, ty - 1)) ctx.fillRect(x, y, WTS, 5);
        if (!w.getW(tx - 1, ty)) ctx.fillRect(x, y, 5, WTS);
        if (t === W.FLUX) {
          for (let k = 0; k < 4; k++) {
            const cx = x + 26 + ((h >> (k * 3)) & 63), cy = y + 30 + ((h >> (k * 4 + 2)) & 63);
            ctx.fillStyle = '#b45cff';
            ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 14); ctx.lineTo(cx - 8, cy); ctx.fill();
            ctx.fillStyle = '#e2b8ff'; ctx.fillRect(cx - 2, cy - 8, 3, 10);
          }
        } else if (t === W.DIAMOND) {
          const cx = x + WTS / 2, cy = y + WTS / 2;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx + 22, cy); ctx.lineTo(cx, cy + 30); ctx.lineTo(cx - 22, cy); ctx.fill();
          ctx.fillStyle = '#cfe8ff';
          ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx + 22, cy); ctx.lineTo(cx, cy); ctx.fill();
        }
        // rachaduras de dano
        const hp = w.thp[ty * w.n + tx], max = W_HP[t];
        if (hp < max) {
          const f = 1 - hp / max;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
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
      if (!this.inView(p.x - 150, p.y - 150, 300, 300)) continue;
      const tz = ZONES[p.target];
      for (let k = 4; k >= 0; k--) {
        ctx.globalAlpha = 0.18 + k * 0.05;
        ctx.fillStyle = k % 2 ? tz.bg[1] : shade(tz.rockEdge, 0.2);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.17) + Math.sin(p.phase * 2 + k) * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = shade(tz.rockEdge, 0.4); ctx.lineWidth = 4;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, p.phase + k * 2.1, p.phase + k * 2.1 + 1.2); ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(tz.name, p.x, p.y - p.r - 14);
      ctx.font = '13px sans-serif'; ctx.fillStyle = '#ddd';
      ctx.fillText(tz.safe ? 'zona segura' : tz.pvp ? 'zona de combate' : 'zona PvE', p.x, p.y - p.r + 4);
    }
  }

  drawCrate(ctx, c) {
    if (!this.inView(c.x - 20, c.y - 20, 40, 40)) return;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    const rare = c.items.some(([i]) => RARE_ITEMS.has(i));
    ctx.fillStyle = rare ? '#3a8a4a' : '#7a5a30'; ctx.fillRect(-11, -11, 22, 22);
    ctx.fillStyle = rare ? '#5aca6a' : '#a07a48'; ctx.fillRect(-9, -9, 18, 18);
    ctx.strokeStyle = rare ? '#2a6a3a' : '#5a3a18'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.stroke();
    ctx.restore();
    drawItemIcon(ctx, c.items[0][0], c.x, c.y - 22, 14);
  }

  // ---------- naves ----------
  drawShip(ctx, s) {
    const g = this.game;
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    const pw = s.pw, ph = s.ph;
    // escudo (bolha)
    if (s.shield > 0) {
      const f = s.shield / s.maxShield;
      ctx.strokeStyle = `rgba(120,200,255,${0.15 + f * 0.25 + s.hitFlash * 0.4})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(-7, -7, pw + 14, ph + 14);
    }
    // casco
    ctx.fillStyle = shade(s.color, -0.4); ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = s.color; ctx.fillRect(2, 2, pw - 4, ph - 4);
    // interior
    ctx.fillStyle = s.team === 'player' ? '#1b2129' : '#211a1c';
    ctx.fillRect(TS, TS, pw - TS * 2, ph - TS * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < s.w - 1; x++) { ctx.moveTo(x * TS, TS); ctx.lineTo(x * TS, ph - TS); }
    for (let y = 1; y < s.h - 1; y++) { ctx.moveTo(TS, y * TS); ctx.lineTo(pw - TS, y * TS); }
    ctx.stroke();
    // rebites do casco
    ctx.fillStyle = shade(s.color, 0.25);
    for (let x = 0; x < s.w; x += 2) { ctx.fillRect(x * TS + 7, 6, 2, 2); ctx.fillRect(x * TS + 7, ph - 8, 2, 2); }
    for (let y = 0; y < s.h; y += 2) { ctx.fillRect(6, y * TS + 7, 2, 2); ctx.fillRect(pw - 8, y * TS + 7, 2, 2); }

    // objetos (fundo)
    for (const o of s.objects) {
      const d = OBJECTS[o.type];
      ctx.save(); ctx.translate(o.x * TS, o.y * TS);
      if (o.type === 'helm' && s.pilot) o.spin = (o.spin || 0) + (s.thrust.x * 0.05);
      drawObjectShape(ctx, o, d.w * TS, d.h * TS);
      if (o.hp < d.hp) {
        ctx.fillStyle = '#300'; ctx.fillRect(0, -4, d.w * TS, 3);
        ctx.fillStyle = '#f55'; ctx.fillRect(0, -4, d.w * TS * (o.hp / d.hp), 3);
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
      drawItemIcon(ctx, it.item, it.x + it.w / 2, it.y + it.h / 2, 12, it.rot);
      if (it.n > 1) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(it.n, it.x + it.w + 2, it.y + it.h + 1);
      }
    }
    // torretas
    for (const t of s.turrets) {
      const p = s.turretLocal(t);
      const d = TURRETS[t.type];
      const base = SIDE_ANGLE[t.side];
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.save(); ctx.rotate(base);
      ctx.fillStyle = shade(d.color, -0.35); ctx.fillRect(-6, -TS * 1.5, 7, TS * 3);
      ctx.restore();
      ctx.save(); ctx.rotate(t.angle);
      const rec = (t.recoil || 0) * 3;
      ctx.fillStyle = shade(d.color, -0.45);
      ctx.fillRect(4 - rec, -3, 18, 6);
      if (t.type === 'turret_burst') { ctx.fillRect(4 - rec, -6, 15, 2); ctx.fillRect(4 - rec, 4, 15, 2); }
      ctx.fillStyle = t.ammoType ? AMMO[t.ammoType].color : '#444';
      ctx.fillRect(18 - rec, -3, 4, 6);
      ctx.restore();
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(d.color, 0.3);
      ctx.beginPath(); ctx.arc(-2, -2, 4, 0, Math.PI * 2); ctx.fill();
      if (g.player && g.player.ctrl === t) { ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    // tripulação
    if (s === g.ship && g.player) this.drawPlayer(ctx, g.player);
    if (s.team === 'pirate') this.drawPirateCrew(ctx, s);
    // flash de dano
    if (s.hitFlash > 0 && s.shield <= 0) {
      ctx.fillStyle = `rgba(255,80,40,${s.hitFlash * 0.25})`;
      ctx.fillRect(0, 0, pw, ph);
    }
    ctx.restore();
  }

  drawPirateCrew(ctx, s) {
    const n = Math.min(4, s.turrets.length);
    for (let i = 0; i < n; i++) {
      const x = (2 + ((i * 7) % (s.w - 4))) * TS, y = (s.h - 1) * TS - 22;
      this.drawPerson(ctx, x + Math.sin(this.game.time + i) * 8, y, '#c05050', 1, Math.sin(this.game.time * 4 + i));
    }
  }

  drawPerson(ctx, x, y, color, facing, walk) {
    // x,y = canto superior esquerdo de uma caixa 10x22
    const lw = Math.sin(walk) * 3;
    ctx.fillStyle = '#2a2a3a';
    ctx.fillRect(x + 2 + lw * 0.5, y + 15, 3, 7);
    ctx.fillRect(x + 6 - lw * 0.5, y + 15, 3, 7);
    ctx.fillStyle = color; ctx.fillRect(x + 1, y + 7, 9, 9);
    ctx.fillStyle = '#f2d0a8';
    ctx.beginPath(); ctx.arc(x + 5.5, y + 4, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(x + 5.5 + facing * 1.5, y + 3, 1.5, 1.5);
  }

  drawPlayer(ctx, p) {
    if (p.mode === 'helm' || p.mode === 'turret') {
      // fica parado junto do objeto
    }
    if (p.jetting) {
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = choice(['#ffd84a', '#ff9a3c', '#ff5d3b']);
        ctx.fillRect(p.x + 1 + rand(-1, 1) + (p.facing > 0 ? 0 : 6), p.y + 16 + rand(0, 8), 3, 4);
      }
    }
    if (p.equip.back === 'jetpack') { ctx.fillStyle = '#777'; ctx.fillRect(p.x + (p.facing > 0 ? -2 : 9), p.y + 7, 3, 9); }
    this.drawPerson(ctx, p.x, p.y, p.equip.feet ? '#5a9ad0' : '#d07a3a', p.facing, p.onGround ? p.walkAnim : 0.6);
    if (p.equip.feet) { ctx.fillStyle = ITEMS[p.equip.feet].color; ctx.fillRect(p.x + 1, p.y + 20, 9, 2); }
    // item na mão
    const h = p.held;
    if (h && p.mode === 'walk') {
      const ang = this.game.aimAngle || 0;
      drawItemIcon(ctx, h.item, p.cxL + Math.cos(ang) * 9, p.cyL + 1 + Math.sin(ang) * 6, 9);
    }
    // nome
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p.name, p.cxL, p.y - 3);
  }

  drawShipBars(ctx, s) {
    const w = Math.min(160, s.pw);
    const x = s.cx - w / 2, y = s.y - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 1, y - 1, w + 2, 12);
    ctx.fillStyle = '#4fb4ff'; ctx.fillRect(x, y, w * (s.shield / s.maxShield), 5);
    ctx.fillStyle = s.integrity / s.maxIntegrity > 0.35 ? '#7fe07f' : '#ff6a4a';
    ctx.fillRect(x, y + 6, w * clamp(s.integrity / s.maxIntegrity, 0, 1), 4);
    ctx.fillStyle = s.team === 'player' ? '#ffffff' : '#ff9a9a';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(s.name, s.cx, y - 5);
  }

  drawBot(ctx, b) {
    const d = BOTS[b.type];
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.fillStyle = b.flash > 0 ? '#fff' : shade(d.color, -0.35);
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.82, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.rotate(b.rot);
    ctx.strokeStyle = shade(d.color, -0.5); ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * b.r * 0.5, Math.sin(a) * b.r * 0.5); ctx.lineTo(Math.cos(a) * b.r * 0.8, Math.sin(a) * b.r * 0.8); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = d.core;
    ctx.beginPath(); ctx.arc(Math.cos(b.angle) * b.r * 0.3, Math.sin(b.angle) * b.r * 0.3, b.r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(Math.cos(b.angle) * b.r * 0.42, Math.sin(b.angle) * b.r * 0.42, b.r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (b.hp < b.maxHp) {
      ctx.fillStyle = '#300'; ctx.fillRect(b.x - b.r, b.y - b.r - 9, b.r * 2, 4);
      ctx.fillStyle = '#f55'; ctx.fillRect(b.x - b.r, b.y - b.r - 9, b.r * 2 * (b.hp / b.maxHp), 4);
    }
  }

  drawBullets(ctx, w) {
    for (const b of w.bullets) {
      const a = AMMO[b.ammo];
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const tl = Math.min(18, sp * 0.012);
      ctx.strokeStyle = a.color; ctx.lineWidth = b.r * 1.4;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(b.x - b.vx / sp * tl, b.y - b.vy / sp * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
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
    for (const sh of w.ships) if (sh.team === 'pirate' && dist(sh.cx, sh.cy, s.cx, s.cy) < 2600) mark(sh.cx, sh.cy, '#ff6a6a', sh.name);
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
      m.fillStyle = s === g.ship ? '#ffffff' : '#ff5050';
      m.fillRect(s.x * k - 1, s.y * k - 1, Math.max(3, s.pw * k), Math.max(3, s.ph * k));
    }
    // vista da câmera
    const v = this.view;
    if (v) { m.strokeStyle = 'rgba(255,255,255,0.35)'; m.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k); }
  }
}

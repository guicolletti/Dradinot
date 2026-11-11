// ============================================================
//  Ícones de itens desenhados proceduralmente (canvas)
// ============================================================
'use strict';

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// desenha o ícone centrado em (x,y) com tamanho s
function drawItemIcon(ctx, id, x, y, s, rot = 0) {
  const d = ITEMS[id];
  if (!d) return;
  const c = d.color;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  const h = s / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (d.kind) {
    case 'resource':
      if (id === 'metal') {
        ctx.fillStyle = shade(c, -0.25);
        ctx.beginPath(); ctx.moveTo(-h * 0.9, h * 0.45); ctx.lineTo(-h * 0.55, -h * 0.35); ctx.lineTo(h * 0.55, -h * 0.35); ctx.lineTo(h * 0.9, h * 0.45); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(c, 0.25);
        ctx.fillRect(-h * 0.5, -h * 0.35, h, h * 0.18);
      } else if (id === 'explosives') {
        ctx.fillStyle = c;
        ctx.fillRect(-h * 0.6, -h * 0.5, h * 0.5, h * 1.1);
        ctx.fillRect(h * 0.1, -h * 0.5, h * 0.5, h * 1.1);
        ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-h * 0.7, -h * 0.05, h * 1.4, h * 0.2);
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = s * 0.06;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.5); ctx.quadraticCurveTo(h * 0.2, -h * 0.9, h * 0.5, -h * 0.85); ctx.stroke();
      } else {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.9); ctx.lineTo(h * 0.5, -h * 0.1); ctx.lineTo(0, h * 0.85); ctx.lineTo(-h * 0.5, -h * 0.1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(c, 0.5);
        ctx.beginPath(); ctx.moveTo(0, -h * 0.9); ctx.lineTo(h * 0.15, -h * 0.1); ctx.lineTo(0, h * 0.85); ctx.lineTo(-h * 0.2, -h * 0.1); ctx.closePath(); ctx.fill();
      }
      break;
    case 'tile':
      drawTileShape(ctx, d.tile, -h * 0.8, -h * 0.8, s * 0.8);
      break;
    case 'object': {
      const od = OBJECTS[d.obj];
      const ww = od.w >= od.h ? s * 0.8 : s * 0.45, hh = od.h >= od.w ? s * 0.8 : s * 0.45;
      ctx.translate(-ww / 2, -hh / 2);
      drawObjectShape(ctx, { type: d.obj, open: false, mats: { metal: 0, explosives: 0, flux: 0 }, queue: [], fuel: 0 }, ww, hh, true);
      break;
    }
    case 'turret':
      ctx.fillStyle = shade(c, -0.3);
      ctx.fillRect(-h * 0.8, h * 0.35, h * 1.6, h * 0.35);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, h * 0.35, h * 0.55, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = s * 0.16;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(h * 0.55, -h * 0.65); ctx.stroke();
      if (d.turret === 'turret_burst') { ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(-h * 0.2, 0); ctx.lineTo(h * 0.3, -h * 0.75); ctx.stroke(); }
      if (d.turret === 'turret_auto') { ctx.fillStyle = '#ffd84a'; ctx.fillRect(-h * 0.15, h * 0.05, h * 0.3, h * 0.2); }
      break;
    case 'ammo':
      ctx.fillStyle = '#5a5040';
      ctx.fillRect(-h * 0.75, -h * 0.55, h * 1.5, h * 1.15);
      ctx.fillStyle = c;
      ctx.fillRect(-h * 0.75, -h * 0.2, h * 1.5, h * 0.4);
      ctx.fillStyle = '#2a251c';
      ctx.fillRect(-h * 0.75, -h * 0.62, h * 1.5, h * 0.15);
      break;
    case 'tool':
      if (d.tool === 'wrench') {
        ctx.strokeStyle = c; ctx.lineWidth = s * 0.16;
        ctx.beginPath(); ctx.moveTo(-h * 0.55, h * 0.55); ctx.lineTo(h * 0.3, -h * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.arc(h * 0.42, -h * 0.42, h * 0.32, 0.9, 5.4); ctx.stroke();
      } else if (d.tool === 'shredder') {
        ctx.fillStyle = c; ctx.fillRect(-h * 0.7, -h * 0.4, h * 1.4, h * 0.8);
        ctx.fillStyle = '#ddd';
        for (let i = 0; i < 4; i++) ctx.fillRect(-h * 0.6 + i * h * 0.35, h * 0.4, h * 0.15, h * 0.4);
      } else if (d.tool === 'booster') {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.85); ctx.lineTo(h * 0.7, -h * 0.45); ctx.lineTo(h * 0.5, h * 0.4); ctx.lineTo(0, h * 0.85); ctx.lineTo(-h * 0.5, h * 0.4); ctx.lineTo(-h * 0.7, -h * 0.45); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8f6ff'; ctx.fillRect(-h * 0.1, -h * 0.4, h * 0.2, h * 0.8); ctx.fillRect(-h * 0.4, -h * 0.1, h * 0.8, h * 0.2);
      } else if (d.tool === 'laser') {
        // pistola: corpo, cabo e ponta brilhante
        ctx.fillStyle = '#3a3f4a'; rrect(ctx, -h * 0.55, -h * 0.05, h * 0.38, h * 0.75, h * 0.1); ctx.fill();
        ctx.fillStyle = '#d8dde6'; rrect(ctx, -h * 0.75, -h * 0.45, h * 1.35, h * 0.5, h * 0.15); ctx.fill();
        ctx.fillStyle = c; ctx.fillRect(-h * 0.6, -h * 0.3, h * 0.95, h * 0.16);
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(h * 0.68, -h * 0.2, h * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexA(c, 0.5); ctx.beginPath(); ctx.arc(h * 0.68, -h * 0.2, h * 0.28, 0, Math.PI * 2); ctx.fill();
      } else if (d.tool === 'drill') {
        // broca: cabo, corpo e ponta em espiral
        ctx.fillStyle = '#4a4f58'; rrect(ctx, -h * 0.85, -h * 0.05, h * 0.5, h * 0.75, h * 0.1); ctx.fill();
        ctx.fillStyle = c; rrect(ctx, -h * 0.75, -h * 0.4, h * 0.85, h * 0.6, h * 0.12); ctx.fill();
        ctx.fillStyle = shade(c, 0.35); ctx.fillRect(-h * 0.65, -h * 0.34, h * 0.65, h * 0.1);
        ctx.fillStyle = '#c8ced6';
        ctx.beginPath(); ctx.moveTo(h * 0.1, -h * 0.32); ctx.lineTo(h * 0.95, -h * 0.1); ctx.lineTo(h * 0.1, h * 0.12); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#7d848e'; ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.moveTo(h * 0.3, -h * 0.28); ctx.lineTo(h * 0.38, h * 0.06); ctx.moveTo(h * 0.55, -h * 0.2); ctx.lineTo(h * 0.6, 0); ctx.stroke();
      } else if (d.tool === 'repair') {
        ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-h * 0.75, -h * 0.55, h * 1.5, h * 1.1);
        ctx.fillStyle = '#e04040'; ctx.fillRect(-h * 0.12, -h * 0.4, h * 0.24, h * 0.8); ctx.fillRect(-h * 0.4, -h * 0.12, h * 0.8, h * 0.24);
      } else {
        const out = d.tool === 'embiggener';
        ctx.strokeStyle = c; ctx.lineWidth = s * 0.12;
        ctx.strokeRect(-h * 0.35, -h * 0.35, h * 0.7, h * 0.7);
        for (let k = 0; k < 4; k++) {
          ctx.save(); ctx.rotate(k * Math.PI / 2 + Math.PI / 4);
          ctx.beginPath();
          const a = out ? h * 0.55 : h * 0.95, b = out ? h * 0.95 : h * 0.6;
          ctx.moveTo(a, 0); ctx.lineTo(b, 0);
          ctx.moveTo(b, 0); ctx.lineTo(b - (out ? 1 : -1) * h * 0.2, -h * 0.15);
          ctx.moveTo(b, 0); ctx.lineTo(b - (out ? 1 : -1) * h * 0.2, h * 0.15);
          ctx.stroke(); ctx.restore();
        }
      }
      break;
    case 'equip':
      if (d.slot === 'feet') {
        ctx.fillStyle = c;
        ctx.fillRect(-h * 0.7, -h * 0.5, h * 0.55, h * 1.0);
        ctx.fillRect(-h * 0.7, h * 0.2, h * 1.4, h * 0.4);
        ctx.fillStyle = shade(c, -0.4); ctx.fillRect(-h * 0.75, h * 0.55, h * 1.5, h * 0.18);
      } else {
        ctx.fillStyle = '#777'; ctx.fillRect(-h * 0.6, -h * 0.7, h * 0.5, h * 1.1); ctx.fillRect(h * 0.1, -h * 0.7, h * 0.5, h * 1.1);
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-h * 0.5, h * 0.45); ctx.lineTo(-h * 0.35, h * 0.95); ctx.lineTo(-h * 0.2, h * 0.45); ctx.fill();
        ctx.beginPath(); ctx.moveTo(h * 0.2, h * 0.45); ctx.lineTo(h * 0.35, h * 0.95); ctx.lineTo(h * 0.5, h * 0.45); ctx.fill();
      }
      break;
    case 'ball':
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, 0, h * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = id === 'ball_soccer' ? '#222' : id === 'ball_beach' ? '#5ab0ff' : '#4a7aff';
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      if (id === 'ball_soccer') { ctx.arc(0, 0, h * 0.3, 0, Math.PI * 2); }
      else { ctx.moveTo(-h * 0.8, 0); ctx.quadraticCurveTo(0, -h * 0.6, h * 0.8, 0); ctx.moveTo(0, -h * 0.8); ctx.quadraticCurveTo(h * 0.5, 0, 0, h * 0.8); }
      ctx.stroke();
      break;
  }
  ctx.restore();
}

// tiles da nave (canto superior esquerdo x,y, tamanho s)
// Trilho: mask diz para quais lados ele se liga (1 cima, 2 direita, 4 baixo, 8 esquerda)
function drawRail(ctx, x, y, s, mask) {
  if (!mask) mask = 2 | 8;
  const cx = x + s / 2, cy = y + s / 2, g = s * 0.17;
  const seg = (dx, dy) => {
    // dormentes de madeira
    ctx.fillStyle = '#6b4f2e';
    for (const k of [0.18, 0.42]) {
      const px = cx + dx * s * k, py = cy + dy * s * k;
      if (dx) ctx.fillRect(px - s * 0.05, cy - s * 0.3, s * 0.1, s * 0.6); else ctx.fillRect(cx - s * 0.3, py - s * 0.05, s * 0.6, s * 0.1);
    }
    // dois trilhos de aço
    ctx.strokeStyle = '#aab3bd'; ctx.lineWidth = Math.max(0.8, s * 0.07);
    ctx.beginPath();
    if (dx) { ctx.moveTo(cx, cy - g); ctx.lineTo(cx + dx * s / 2, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx + dx * s / 2, cy + g); }
    else { ctx.moveTo(cx - g, cy); ctx.lineTo(cx - g, cy + dy * s / 2); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g, cy + dy * s / 2); }
    ctx.stroke();
  };
  if (mask & 1) seg(0, -1);
  if (mask & 2) seg(1, 0);
  if (mask & 4) seg(0, 1);
  if (mask & 8) seg(-1, 0);
  ctx.fillStyle = '#7d868f'; ctx.fillRect(cx - g * 1.25, cy - g * 1.25, g * 2.5, g * 2.5);   // junção
}

// Desenha um bloco; com formato (shape > 0), recorta a textura no contorno do formato.
function drawTileShape(ctx, t, x, y, s, shape = 0) {
  if (t === T.RAIL) return drawRail(ctx, x, y, s, shape);   // no trilho, "shape" é a máscara de ligações
  if (shape && SHAPED_TILES.has(t)) {
    const poly = shapePoly(shape, x, y, s);
    const path = () => { ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(poly[k][0], poly[k][1]); ctx.closePath(); };
    ctx.save(); path(); ctx.clip();
    drawTileShapeFull(ctx, t, x, y, s);
    ctx.restore();
    // borda: clara no topo (inclinado ou não), escura no resto
    ctx.lineWidth = Math.max(0.6, s * 0.06);
    ctx.strokeStyle = t === T.NET ? 'rgba(111,176,176,0.95)' : 'rgba(0,0,0,0.45)';
    path(); ctx.stroke();
    if (t === T.BLOCK) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); ctx.lineTo(poly[1][0], poly[1][1]); ctx.stroke();
    }
    return;
  }
  drawTileShapeFull(ctx, t, x, y, s);
}
function drawTileShapeFull(ctx, t, x, y, s) {
  switch (t) {
    case T.BLOCK: {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, '#8f9aa8'); g.addColorStop(1, '#56606b');
      ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, s, s * 0.1); ctx.fillRect(x, y, s * 0.1, s);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + s * 0.9, s, s * 0.1); ctx.fillRect(x + s * 0.9, y, s * 0.1, s);
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const [rx, ry] of [[0.18, 0.18], [0.76, 0.18], [0.18, 0.76], [0.76, 0.76]]) ctx.fillRect(x + s * rx, y + s * ry, s * 0.07, s * 0.07);
      break;
    }
    case T.WALKWAY: {
      const g = ctx.createLinearGradient(x, y, x, y + s * 0.3);
      g.addColorStop(0, '#c2925a'); g.addColorStop(1, '#7d5830');
      ctx.fillStyle = g; ctx.fillRect(x, y, s, s * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x, y, s, s * 0.06);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + s * 0.48, y + s * 0.06, s * 0.04, s * 0.24);
      ctx.fillStyle = 'rgba(70,45,22,0.75)';
      ctx.fillRect(x + s * 0.1, y + s * 0.3, s * 0.1, s * 0.24); ctx.fillRect(x + s * 0.8, y + s * 0.3, s * 0.1, s * 0.24);
      break;
    }
    case T.LADDER:
      ctx.fillStyle = '#9a7442';
      ctx.fillRect(x + s * 0.15, y, s * 0.12, s); ctx.fillRect(x + s * 0.73, y, s * 0.12, s);
      ctx.fillStyle = '#c09a60';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + s * 0.15, y + s * (0.12 + k * 0.33), s * 0.7, s * 0.1);
      break;
    case T.NET:
      ctx.strokeStyle = 'rgba(111,176,176,0.85)'; ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        ctx.moveTo(x + (k / 4) * s, y); ctx.lineTo(x + (k / 4) * s, y + s);
        ctx.moveTo(x, y + (k / 4) * s); ctx.lineTo(x + s, y + (k / 4) * s);
      }
      ctx.stroke();
      break;
  }
}

// objetos (canto superior esquerdo 0,0 já transladado; largura w, altura h em px)
// braço do Carregador: sai do centro na direção (dx,dy); len = fração do tamanho; leva um item na ponta
function drawLoaderArm(ctx, w, h, [dx, dy], len, item) {
  const a = Math.atan2(dy, dx), L = w * len * (dx && dy ? 1.25 : 1);
  const cx = w / 2, cy = h / 2, tx = cx + Math.cos(a) * L, ty = cy + Math.sin(a) * L;
  ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = w * 0.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = w * 0.11;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#e0a83a'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7d828a'; ctx.beginPath(); ctx.arc(tx, ty, w * 0.1, 0, Math.PI * 2); ctx.fill();
  if (item) drawItemIcon(ctx, item, tx, ty, w * 0.62, 0);
}

function drawObjectShape(ctx, o, w, h, icon = false) {
  const d = OBJECTS[o.type];
  const c = d.color;
  const lw = Math.max(1, w * 0.04);
  const box = (col) => {
    ctx.fillStyle = shade(col, -0.35); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = col; ctx.fillRect(lw, lw, w - lw * 2, h - lw * 2);
    ctx.fillStyle = shade(col, 0.2); ctx.fillRect(lw, lw, w - lw * 2, h * 0.1);
  };
  switch (o.type) {
    case 'helm': {
      ctx.fillStyle = '#4a3a28'; ctx.fillRect(w * 0.42, h * 0.45, w * 0.16, h * 0.55);
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(w * 0.25, h * 0.88, w * 0.5, h * 0.12);
      ctx.strokeStyle = '#a07a48'; ctx.lineWidth = w * 0.08;
      const r = w * 0.32, cx = w / 2, cy = h * 0.42;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = w * 0.05;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + (o.spin || 0);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3); ctx.stroke();
      }
      ctx.fillStyle = '#d0a060'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'fab_starter': case 'fab_munitions': case 'fab_engineering': case 'fab_machine': case 'fab_equipment': {
      box(c);
      ctx.fillStyle = '#1a2028'; ctx.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.36);
      ctx.fillStyle = o.queue && o.queue.length ? (o.stalled ? '#ff6060' : o.blocked ? '#ffb040' : '#6effa0') : '#3a5a6a';
      ctx.fillRect(w * 0.2, h * 0.24, w * 0.6 * (o.started ? Math.min(1, (o.progress || 0) / RECIPES[d.fab][o.queue[0].r].t) : 0.15), h * 0.08);
      // ícone do tipo
      ctx.fillStyle = shade(c, 0.5);
      const sym = { fab_starter: 'F', fab_munitions: 'M', fab_engineering: 'E', fab_machine: 'Q', fab_equipment: 'Q' }[o.type];
      ctx.font = `bold ${Math.round(h * 0.3)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (o.type === 'fab_equipment') ctx.fillText('EQ', w / 2, h * 0.73);
      else ctx.fillText(sym, w / 2, h * 0.73);
      ctx.fillStyle = shade(c, -0.5); ctx.fillRect(w * 0.08, h * 0.88, w * 0.84, h * 0.08);
      break;
    }
    case 'recycler':
      box(c);
      ctx.strokeStyle = '#b0ffd0'; ctx.lineWidth = w * 0.07;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.24, 0.3, 2.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.24, 3.4, 5.8); ctx.stroke();
      break;
    case 'gunnery': {
      // console de artilharia: mesa, tela com a nave e seta para o lado controlado
      ctx.fillStyle = shade(c, -0.45); ctx.fillRect(w * 0.12, h * 0.62, w * 0.76, h * 0.38);
      ctx.fillStyle = c; ctx.fillRect(w * 0.08, h * 0.55, w * 0.84, h * 0.12);
      ctx.fillStyle = '#2a2633'; ctx.fillRect(w * 0.2, h * 0.08, w * 0.6, h * 0.44);
      ctx.fillStyle = '#0d1a14'; ctx.fillRect(w * 0.24, h * 0.12, w * 0.52, h * 0.36);
      ctx.strokeStyle = '#4cff7a'; ctx.lineWidth = Math.max(0.6, w * 0.03);
      ctx.strokeRect(w * 0.4, h * 0.22, w * 0.2, h * 0.16);   // nave na tela
      const sides = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }, [dx, dy] = sides[o.side || 'right'];
      const ax = w * 0.5 + dx * w * 0.18, ay = h * 0.3 + dy * h * 0.13, a = Math.atan2(dy, dx), s2 = w * 0.07;
      ctx.fillStyle = '#ffd84a'; ctx.beginPath();
      ctx.moveTo(ax + Math.cos(a) * s2, ay + Math.sin(a) * s2); ctx.lineTo(ax + Math.cos(a + 2.4) * s2, ay + Math.sin(a + 2.4) * s2); ctx.lineTo(ax + Math.cos(a - 2.4) * s2, ay + Math.sin(a - 2.4) * s2); ctx.fill();
      ctx.fillStyle = '#ff5050'; ctx.fillRect(w * 0.22, h * 0.58, w * 0.08, h * 0.05);
      ctx.fillStyle = '#ffd84a'; ctx.fillRect(w * 0.7, h * 0.58, w * 0.08, h * 0.05);
      break;
    }
    case 'ammo_crate': {
      // caixote militar: tampa, cintas e três projéteis na frente
      box(c);
      ctx.fillStyle = shade(c, -0.3); ctx.fillRect(w * 0.06, h * 0.1, w * 0.88, h * 0.16);
      ctx.fillStyle = shade(c, -0.45); ctx.fillRect(w * 0.18, h * 0.1, w * 0.07, h * 0.82); ctx.fillRect(w * 0.75, h * 0.1, w * 0.07, h * 0.82);
      for (let k = 0; k < 3; k++) {
        const bx = w * (0.34 + k * 0.12), by = h * 0.38;
        ctx.fillStyle = '#d9b23e'; ctx.fillRect(bx, by + h * 0.12, w * 0.08, h * 0.32);
        ctx.fillStyle = '#c7cdd4'; ctx.beginPath(); ctx.moveTo(bx, by + h * 0.12); ctx.lineTo(bx + w * 0.04, by); ctx.lineTo(bx + w * 0.08, by + h * 0.12); ctx.fill();
      }
      break;
    }
    case 'expando':
      box(c);
      ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = w * 0.05;
      ctx.strokeRect(w * 0.12, h * 0.15, w * 0.76, h * 0.72);
      ctx.beginPath(); ctx.moveTo(w * 0.12, h * 0.15); ctx.lineTo(w * 0.88, h * 0.87); ctx.moveTo(w * 0.88, h * 0.15); ctx.lineTo(w * 0.12, h * 0.87); ctx.stroke();
      break;
    case 'hatch': {
      box(c);
      // verde: aberta sem filtro • laranja: só alguns itens • amarelo: todos menos alguns • vermelho: fechada
      const col = o.open === false ? '#ff5050' : o.fmode === 'allow' ? '#ffa03c' : (o.filter && o.filter.length) ? '#ffe36b' : '#6eff6e';
      ctx.fillStyle = '#20301a'; ctx.fillRect(w * 0.15, h * 0.12, w * 0.7, h * 0.3);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.5); ctx.lineTo(w * 0.7, h * 0.5); ctx.lineTo(w * 0.5, h * 0.85); ctx.fill();
      break;
    }
    case 'loader': {
      // bloco metálico com moldura de alerta, setas de entrada (azul) e saída (laranja)
      ctx.fillStyle = '#3a3f48'; ctx.fillRect(0, 0, w, h);
      const fw = w * 0.14;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(fw, fw, w - fw * 2, h - fw * 2); ctx.clip('evenodd');
      for (let k = -4; k < 8; k++) { ctx.fillStyle = k % 2 ? '#1c1c1c' : '#e0a83a'; ctx.beginPath(); ctx.moveTo(k * w * 0.2, 0); ctx.lineTo(k * w * 0.2 + w * 0.1, 0); ctx.lineTo(k * w * 0.2 + w * 0.1 + h, h); ctx.lineTo(k * w * 0.2 + h, h); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = '#4c535e'; ctx.fillRect(fw, fw, w - fw * 2, h - fw * 2);
      const mark = (dir, col, inward) => {
        const [dx, dy] = LOADER_DIRS[dir], a = Math.atan2(dy, dx);
        const r = w * 0.36, px = w / 2 + Math.cos(a) * r, py = h / 2 + Math.sin(a) * r, s2 = w * 0.13;
        const b = inward ? a + Math.PI : a;
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(px + Math.cos(b) * s2, py + Math.sin(b) * s2);
        ctx.lineTo(px + Math.cos(b + 2.3) * s2, py + Math.sin(b + 2.3) * s2);
        ctx.lineTo(px + Math.cos(b - 2.3) * s2, py + Math.sin(b - 2.3) * s2);
        ctx.fill();
      };
      mark(o.din ?? 6, '#5ab4ff', true);
      mark(o.dout ?? 2, '#ffa040', false);
      if (icon) drawLoaderArm(ctx, w, h, LOADER_DIRS[o.dout ?? 2], 0.42, null);
      break;
    }
    case 'ejector':
      box(c);
      ctx.fillStyle = '#ffd0d0';
      ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.8); ctx.lineTo(w * 0.7, h * 0.8); ctx.lineTo(w * 0.5, h * 0.25); ctx.fill();
      break;
    case 'shield_gen': {
      box(c);
      const f = clamp((o.fuel || 0) / 600, 0, 1);
      ctx.fillStyle = '#0a1a2a'; ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
      ctx.fillStyle = '#7fd0ff'; ctx.fillRect(w * 0.2, h * 0.2 + h * 0.6 * (1 - f), w * 0.6, h * 0.6 * f);
      ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = w * 0.04; ctx.strokeRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
      break;
    }
    case 'spawn':
      ctx.fillStyle = '#1f4a4a'; ctx.fillRect(0, h * 0.85, w, h * 0.15);
      ctx.fillStyle = 'rgba(80,220,220,0.35)'; ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.75);
      ctx.strokeStyle = '#7ff0f0'; ctx.lineWidth = w * 0.08;
      ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.85); ctx.lineTo(w * 0.1, h * 0.1); ctx.moveTo(w * 0.9, h * 0.85); ctx.lineTo(w * 0.9, h * 0.1); ctx.stroke();
      break;
    case 'airlock': {
      // moldura grossa, janela redonda e faixas de alerta
      box(shade(c, -0.15));
      ctx.fillStyle = shade(c, 0.12); ctx.fillRect(w * 0.15, h * 0.08, w * 0.7, h * 0.84);
      ctx.fillStyle = '#ffd84a';
      for (let k = 0; k < 3; k++) ctx.fillRect(w * 0.15, h * (0.62 + k * 0.1), w * 0.7, h * 0.04);
      ctx.fillStyle = '#0d1a24'; ctx.beginPath(); ctx.arc(w / 2, h * 0.3, w * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,220,255,0.55)'; ctx.beginPath(); ctx.arc(w / 2 - w * 0.06, h * 0.28, w * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(c, -0.5); ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(w / 2, h * 0.3, w * 0.24, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9fe0ff'; ctx.fillRect(w * 0.72, h * 0.46, w * 0.1, h * 0.06);
      break;
    }
    case 'door':
      if (o.open) {
        ctx.fillStyle = 'rgba(106,111,120,0.5)'; ctx.fillRect(0, 0, w * 0.2, h); ctx.fillRect(w * 0.8, 0, w * 0.2, h);
      } else {
        box(c);
        ctx.fillStyle = '#ffd84a'; ctx.fillRect(w * 0.65, h * 0.45, w * 0.15, h * 0.1);
      }
      break;
  }
  void icon;
}

// cache de ícones para a interface (dataURL)
const ICON_CACHE = {};
function iconURL(id) {
  if (ICON_CACHE[id]) return ICON_CACHE[id];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  drawItemIcon(x, id, 32, 32, 52);
  ICON_CACHE[id] = c.toDataURL();
  return ICON_CACHE[id];
}

// ---------- auxiliares de desenho ----------
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

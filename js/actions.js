// ============================================================
//  Sessão de um tripulante no servidor: recebe a entrada do
//  cliente e executa todas as ações (construir, desmontar,
//  pilotar, torretas, fabricadores, inventário, comandos).
// ============================================================
'use strict';

const KEYBIT = { left: 1, right: 2, up: 4, down: 8, jump: 16, shift: 32 };

class Session {
  constructor(uni, send, id) {
    this.uni = uni;
    this._send = send;
    this.id = id;
    this.name = 'Tripulante';
    this.token = '';
    this.player = null;
    this.ship = null;
    this.keys = 0;
    this.mouse = { x: 0, y: 0, lx: 0, ly: 0, left: false };
    this.wrench = null;
    this.resizeAxis = 'x';
    this.cheats = false;
    this.ui = null;          // { type: 'fab'|'store', oid }
    this.sent = new Map();   // shipId -> { rev, objs }
    this.zoneSent = null;
    this.lastInv = ''; this.lastEq = '';
    this.chatT = 0;
  }

  send(m) { try { this._send(m); } catch (e) { /* conexão caiu */ } }
  get world() { return this.ship ? this.ship.world : null; }
  notify(m, c = '#fff') { this.send({ t: 'msg', m, c }); }
  sfxMe(n) { this.send({ t: 'sfx', n }); }
  sfx(n) { const p = this.player, s = this.ship; if (s && s.world && p) s.world.sound(n, s.x + p.cxL, s.y + p.cyL); }
  isCaptain() { const r = this.ship && this.uni.records[this.ship.key]; return !!r && r.owner === this.token; }
  key(k) { return (this.keys & KEYBIT[k]) !== 0; }

  // ---------- entrada ----------
  onInput(m) {
    const p = this.player, s = this.ship;
    if (!p || !s) return;
    this.keys = m.k | 0;
    this.mouse.x = +m.mx || 0; this.mouse.y = +m.my || 0;
    this.mouse.lx = +m.lx || 0; this.mouse.ly = +m.ly || 0;
    this.mouse.left = !!m.ml;
    this.aim = +m.a || 0;
    if (m.sel >= 0 && m.sel < 10 && m.sel !== p.sel) { p.sel = m.sel | 0; this.wrench = null; }
    if (p.mode === 'walk' && m.tp === p.tp) {
      // posição vem do cliente (validada contra a grade da nave)
      const x = clamp(+m.x || 0, TS, s.pw - TS - p.w), y = clamp(+m.y || 0, TS, s.ph - TS - p.h);
      if (!this.overlapsSolid(x, y)) { p.x = x; p.y = y; }
      p.vx = +m.vx || 0; p.vy = +m.vy || 0;
      p.facing = m.f < 0 ? -1 : 1; p.onGround = !!m.og; p.onLadder = !!m.ol;
      p.walkAnim = +m.wa || 0; p.jetting = !!m.jet;
    }
  }

  overlapsSolid(x, y) {
    const s = this.ship, p = this.player;
    const x0 = Math.floor((x + 1) / TS), x1 = Math.floor((x + p.w - 1) / TS);
    const y0 = Math.floor((y + 1) / TS), y1 = Math.floor((y + p.h - 1) / TS);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (s.solidAt(cx, cy)) return true;
    return false;
  }

  handle(m) {
    if (!this.player || !this.ship) return;
    switch (m.t) {
      case 'in': this.onInput(m); break;
      case 'click': if (this.player.mode === 'walk') this.primaryClick(+m.lx, +m.ly, !!m.sh); break;
      case 'key': this.onKey(m.c, !!m.sh); break;
      case 'inv': this.invMove(m); break;
      case 'throw': this.throwFrom(m); break;
      case 'equip': this.equipFromSlot(m.i | 0); break;
      case 'unequip': this.unequip(m.s); break;
      case 'fab': this.fabOp(m); break;
      case 'closeui': this.ui = null; break;
      case 'chat': this.chat(String(m.text || '').slice(0, 140)); break;
    }
  }

  onKey(c, shift) {
    const p = this.player;
    if (c === 'Escape' || (c === 'Space' && p.mode !== 'walk')) {
      if (p.mode !== 'walk') this.exitControl();
      this.wrench = null;
      return;
    }
    if (p.mode === 'helm') { if (c === 'KeyQ') this.tryPortal(); return; }
    if (p.mode === 'turret') { if (c === 'KeyQ') this.unloadTurret(p.ctrl); return; }
    if (c === 'KeyQ') this.dropHeld(shift);
    if (c === 'KeyR') {
      const h = p.held;
      if (h && (h.item === 'embiggener' || h.item === 'shrinker')) {
        this.resizeAxis = this.resizeAxis === 'x' ? 'y' : 'x';
        this.notify(`Eixo de redimensionamento: ${this.resizeAxis === 'x' ? 'horizontal (direita)' : 'vertical (cima)'}`, '#cfe');
      }
    }
  }

  // ---------- por quadro ----------
  tick(dt) {
    const p = this.player, s = this.ship, w = this.world;
    if (!p || !s || !w) return;
    if (p.mode === 'walk') {
      const w = this.wrench;
      if (w) {
        w.age += dt;
        if (this.mouse.left || w.age < 0.06) this.updateWrench(dt, this.mouse.lx, this.mouse.ly);
        else {
          const pend = w.pend;
          this.wrench = null;
          if (pend && w.age < 0.35) {
            if (s.turrets.includes(pend)) this.controlTurret(pend);
            else if (s.objects.includes(pend)) this.interact(pend);
          }
        }
      }
    } else if (p.mode === 'helm') {
      if (s.pilot !== this || !s.objects.includes(p.ctrl)) { this.exitControl(); return; }
      let tx = (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0);
      let ty = (this.key('down') ? 1 : 0) - (this.key('up') ? 1 : 0);
      const l = Math.hypot(tx, ty);
      if (l > 1) { tx /= l; ty /= l; }
      s.thrust.x = tx; s.thrust.y = ty;
      for (const t of s.turrets) {
        if (!TURRETS[t.type].rc) continue;
        const tw = s.turretWorld(t);
        const raw = Math.atan2(this.mouse.y - tw.y, this.mouse.x - tw.x);
        const a = s.clampTurretAngle(t, raw);
        t.angle += clamp(angDiff(t.angle, a), -8 * dt, 8 * dt);
        // só dispara se o mouse estiver no lado da torreta (dentro do alcance de mira)
        if (this.mouse.left && s.turretCanAim(t, raw)) w.fireTurret(s, t, false, () => this.sfxMe('click'));
      }
    } else if (p.mode === 'turret') {
      const t = p.ctrl;
      if (!s.turrets.includes(t) || t.user !== this) { this.exitControl(); return; }
      const tw = s.turretWorld(t);
      const raw = Math.atan2(this.mouse.y - tw.y, this.mouse.x - tw.x);
      const a = s.clampTurretAngle(t, raw);
      t.angle += clamp(angDiff(t.angle, a), -10 * dt, 10 * dt);
      if (this.mouse.left && s.turretCanAim(t, raw)) w.fireTurret(s, t, false, () => this.sfxMe('click'));
    }
    // fecha painéis distantes
    if (this.ui) {
      const o = s.objects.find((x) => x.id === this.ui.oid);
      const far = !o || dist(p.cxL, p.cyL, (o.x + OBJECTS[o.type].w / 2) * TS, (o.y + OBJECTS[o.type].h / 2) * TS) > REACH + TS * 2;
      if (far) { this.ui = null; this.send({ t: 'ui', op: 'close' }); }
    }
  }

  exitControl() {
    const p = this.player, s = this.ship;
    if (!p) return;
    if (p.mode === 'helm' && s && s.pilot === this) { s.pilot = null; s.thrust.x = 0; s.thrust.y = 0; }
    if (p.mode === 'turret' && p.ctrl && p.ctrl.user === this) p.ctrl.user = null;
    p.mode = 'walk'; p.ctrl = null;
  }

  // ---------- auxiliares ----------
  inReach(lx, ly) { const p = this.player; return dist(p.cxL, p.cyL, lx, ly) <= REACH + 4; }

  canPlaceTile(cx, cy, tile) {
    const s = this.ship;
    if (!s.isInterior(cx, cy)) return false;
    if (s.get(cx, cy) !== T.EMPTY || s.objectAt(cx, cy)) return false;
    if (tile === T.BLOCK) {
      for (const c of s.crew) {
        const p = c.player;
        if (p && aabbOverlap(p.x, p.y, p.w, p.h, cx * TS, cy * TS, TS, TS)) return false;
      }
    }
    return true;
  }

  consumeHeld(n = 1) {
    const p = this.player, h = p.held;
    if (!h) return;
    h.n -= n;
    if (h.n <= 0) { p.inv[p.sel] = null; this.refillSlot(p.sel, h.item); }
  }

  // slot esvaziou: traz outra pilha do mesmo item para ele
  refillSlot(i, item) {
    const inv = this.player.inv;
    if (inv[i]) return;
    for (let j = 0; j < inv.length; j++) {
      if (j !== i && inv[j] && inv[j].item === item) { inv[i] = inv[j]; inv[j] = null; return; }
    }
  }

  giveItem(item, n, lx, ly) {
    const p = this.player;
    const rest = invAdd(p.inv, item, n);
    if (rest > 0) this.ship.spawnItem(item, rest, lx ?? p.cxL, ly ?? p.cyL, 0, -60);
  }

  itemUnder(lx, ly) {
    let best = null, bd = 12;
    for (const it of this.ship.items) {
      const d = dist(lx, ly, it.x + it.w / 2, it.y + it.h / 2);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  turretNear(lx, ly) {
    const s = this.ship;
    for (const t of s.turrets) {
      const p = s.turretLocal(t);
      if (dist(lx, ly, p.x, p.y) < 14) return t;
    }
    return null;
  }

  // ---------- clique principal ----------
  primaryClick(lx, ly, shift) {
    const p = this.player, s = this.ship;
    this.mouse.lx = lx; this.mouse.ly = ly;
    const cx = Math.floor(lx / TS), cy = Math.floor(ly / TS);
    const reach = this.inReach(lx, ly);
    const h = p.held;
    const d = h ? ITEMS[h.item] : null;
    const turret = s.turretAtHull(cx, cy) || this.turretNear(lx, ly);
    const obj = s.objectAt(cx, cy);
    const item = this.itemUnder(lx, ly);

    if (!reach) {
      if (h || obj || turret || item) { this.notify('Muito longe.', '#aaa'); this.sfxMe('error'); }
      return;
    }
    if (d && d.tool === 'shredder') {
      if (item) {
        s.items.splice(s.items.indexOf(item), 1);
        s.world.spark(s.x + lx, s.y + ly, '#ff7070', 8);
        this.sfx('break');
      }
      return;
    }
    if (item) {
      const rest = invAdd(p.inv, item.item, item.n);
      if (rest === item.n) { this.notify('Inventário cheio.', '#ffb070'); this.sfxMe('error'); return; }
      if (rest > 0) item.n = rest; else s.items.splice(s.items.indexOf(item), 1);
      this.sfxMe('collect');
      return;
    }
    // chave inglesa: segurar desmonta; um clique rápido num objeto ainda interage
    if (d && d.tool === 'wrench') { this.wrench = { t: 0, need: 0, key: null, age: 0, pend: turret || obj || null }; return; }

    if (d && turret && d.kind === 'ammo') { this.loadTurret(turret, h, shift); return; }
    if (d && obj) {
      const od = OBJECTS[obj.type];
      if (od.fab && FAB_MATS.includes(h.item)) { this.loadFab(obj, h); return; }
      if (obj.type === 'shield_gen' && (h.item === 'booster' || h.item === 'flux')) {
        obj.fuel = (obj.fuel || 0) + (h.item === 'booster' ? 60 : 300);
        this.consumeHeld(1);
        this.sfx('load');
        this.notify(`Gerador de escudo: ${Math.round(obj.fuel)} de carga.`, '#9fe0ff');
        return;
      }
      if (obj.type === 'recycler') { this.recycle(obj, h); return; }
      if (obj.type === 'ejector') { this.eject(obj, h); return; }
      if (obj.type === 'expando') { this.openUI('store', obj); return; }
    }
    if (turret) { this.controlTurret(turret); return; }
    if (obj) { this.interact(obj); return; }
    if (d) this.useHeld(lx, ly, cx, cy);
  }

  openUI(type, o) {
    this.ui = { type, oid: o.id };
    this.send({ t: 'ui', op: type, oid: o.id });
  }

  useHeld(lx, ly, cx, cy) {
    const p = this.player, s = this.ship, h = p.held, d = ITEMS[h.item];
    if (d.kind === 'tile') {
      if (this.canPlaceTile(cx, cy, d.tile)) {
        s.set(cx, cy, d.tile); s.recalc();
        this.consumeHeld(1); this.sfx('place');
      } else this.sfxMe('error');
    } else if (d.kind === 'object') {
      const od = OBJECTS[d.obj];
      const ox = cx - Math.floor((od.w - 1) / 2), oy = cy - (od.h - 1);
      if (s.canPlaceObject(d.obj, ox, oy)) {
        s.placeObject(d.obj, ox, oy);
        this.consumeHeld(1); this.sfx('place');
        this.notify(`${od.name} construído.`, '#cfe');
      } else { this.notify(od.floor ? 'Espaço inválido (precisa de piso embaixo e área livre).' : 'Espaço inválido.', '#ffb070'); this.sfxMe('error'); }
    } else if (d.kind === 'turret') {
      const hs = s.hullCellToSide(cx, cy);
      if (hs && s.canPlaceTurret(hs.side, hs.pos)) {
        s.placeTurret(d.turret, hs.side, hs.pos);
        this.consumeHeld(1); this.sfx('place');
        this.notify(`${d.name} instalada. Carregue com munição.`, '#cfe');
      } else { this.notify('Torretas vão no casco externo e precisam de 3 blocos de espaço.', '#ffb070'); this.sfxMe('error'); }
    } else if (d.tool === 'booster') {
      if (s.shield >= s.maxShield) { this.notify('Escudo já está cheio.', '#aaa'); return; }
      s.shield = Math.min(s.maxShield, s.shield + 80);
      this.consumeHeld(1); this.sfx('shield');
      s.world.spark(s.x + lx, s.y + ly, '#7fd0ff', 12);
    } else if (d.tool === 'repair') {
      if (s.integrity >= s.maxIntegrity) { this.notify('O casco está intacto.', '#aaa'); return; }
      s.integrity = Math.min(s.maxIntegrity, s.integrity + 60);
      this.consumeHeld(1); this.sfx('place');
    } else if (d.tool === 'embiggener' || d.tool === 'shrinker') {
      const dir = d.tool === 'embiggener' ? 1 : -1;
      const err = s.resize(this.resizeAxis, dir);
      if (err) { this.notify(err, '#ffb070'); this.sfxMe('error'); return; }
      if (this.resizeAxis === 'y') for (const c of s.crew) if (c.player) { c.player.y += dir * TS; c.player.tp++; }
      this.consumeHeld(1); this.sfx('place');
      this.uni.shipMsg(s, `Nave agora tem ${s.w}x${s.h}.`, '#cfe');
    } else if (d.kind === 'equip') {
      this.equipFromSlot(p.sel);
    }
  }

  equipFromSlot(i) {
    const p = this.player, st = p.inv[i];
    if (!st || ITEMS[st.item].kind !== 'equip') return;
    const slot = ITEMS[st.item].slot;
    const old = p.equip[slot];
    p.equip[slot] = st.item;
    p.inv[i] = old ? { item: old, n: 1 } : null;
    this.notify(`Equipado: ${ITEMS[st.item].name}`, '#cfe');
  }

  unequip(slot) {
    const p = this.player;
    if (!p.equip[slot]) return;
    const rest = invAdd(p.inv, p.equip[slot], 1);
    if (rest) { this.notify('Inventário cheio.', '#ffb070'); return; }
    p.equip[slot] = null;
  }

  interact(o) {
    const p = this.player, s = this.ship;
    const od = OBJECTS[o.type];
    switch (o.type) {
      case 'helm': {
        if (s.pilot && s.pilot !== this) { this.notify(`${s.pilot.name} já está pilotando.`, '#ffb070'); return; }
        p.mode = 'helm'; p.ctrl = o; s.pilot = this;
        p.x = (o.x + 1) * TS - p.w / 2; p.y = (o.y + 2) * TS - p.h - 0.1; p.vx = 0; p.vy = 0; p.tp++;
        this.wrench = null;
        this.notify('Pilotando: WASD move, clique dispara torretas RC, Q usa portal, Espaço sai.', '#cfe');
        break;
      }
      case 'door': o.open = !o.open; this.sfx('click'); break;
      case 'hatch':
        o.mode = o.mode === 'none' ? 'all' : 'none';
        this.notify(`Escotilha: ${o.mode === 'all' ? 'liberada (verde)' : 'bloqueada (vermelha)'}`, '#cfe');
        this.sfx('click');
        break;
      case 'expando': this.openUI('store', o); break;
      case 'shield_gen': this.notify(`Gerador de escudo: ${Math.round(o.fuel || 0)} de carga. Use Reforços ou Fluxo nele.`, '#9fe0ff'); break;
      case 'recycler': this.notify('Clique no reciclador segurando um item para reciclá-lo.', '#cfe'); break;
      case 'ejector': this.notify('Clique no ejetor segurando um item para lançá-lo ao espaço.', '#cfe'); break;
      case 'spawn': this.notify('Ponto de renascimento.', '#cfe'); break;
      default: if (od.fab) this.openUI('fab', o);
    }
  }

  controlTurret(t) {
    const p = this.player;
    if (TURRETS[t.type].rc) { this.notify('Torretas RC são disparadas pelo leme.', '#ffb070'); return; }
    if (t.user && t.user !== this) { this.notify(`${t.user.name} já está nessa torreta.`, '#ffb070'); return; }
    p.mode = 'turret'; p.ctrl = t; t.user = this; this.wrench = null;
    this.notify(`${TURRETS[t.type].name}: clique para atirar, Q descarrega, Espaço sai. Munição: ${t.ammo}`, '#cfe');
  }

  loadTurret(t, h, shift) {
    const ammoKey = ITEMS[h.item].ammo;
    const cap = TURRETS[t.type].cap;
    if (t.ammoType && t.ammoType !== ammoKey && t.ammo > 0) this.unloadTurret(t);
    if (t.ammo + AMMO[ammoKey].shots > cap) { this.notify('Torreta cheia.', '#aaa'); return; }
    let used = 0;
    const max = shift ? h.n : 1;
    while (used < max && t.ammo + AMMO[ammoKey].shots <= cap) { t.ammo += AMMO[ammoKey].shots; used++; }
    t.ammoType = ammoKey;
    this.consumeHeld(used);
    this.sfx('load');
    this.notify(`Torreta carregada: ${t.ammo}/${cap} (${AMMO[ammoKey].name})`, '#cfe');
  }

  unloadTurret(t) {
    if (!t || !t.ammoType || t.ammo <= 0) { this.notify('Torreta vazia.', '#aaa'); return; }
    const per = AMMO[t.ammoType].shots;
    const boxes = Math.floor(t.ammo / per);
    if (boxes > 0) this.giveItem('ammo_' + t.ammoType, boxes);
    t.ammo = 0; t.ammoType = null;
    this.sfx('load');
  }

  loadFab(o, h) {
    const room = FAB_CAP - (o.mats[h.item] || 0);
    if (room <= 0) { this.notify('Fabricador cheio desse material.', '#aaa'); return; }
    const k = Math.min(room, h.n);
    o.mats[h.item] = (o.mats[h.item] || 0) + k;
    this.consumeHeld(k);
    this.sfx('load');
  }

  recycle(o, h) {
    const v = recycleValue(h.item);
    const keys = Object.keys(v);
    if (!keys.length) { this.notify('Esse item não pode ser reciclado.', '#ffb070'); this.sfxMe('error'); return; }
    const n = h.n;
    const lx = (o.x + 1) * TS, ly = o.y * TS;
    for (const m of keys) {
      const total = v[m] * n;
      if (total > 0) this.ship.spawnItem(m, total, lx, ly, rand(-40, 40), -150);
    }
    this.consumeHeld(n);
    this.sfx('break');
  }

  eject(o, h) {
    this.world.ejectFromShip(this.ship, o, h.item, h.n);
    this.consumeHeld(h.n);
    this.sfx('pop');
  }

  dropHeld(one) {
    const p = this.player, h = p.held;
    if (!h) return;
    const n = one ? 1 : h.n;
    const a = this.aim || 0;
    this.ship.spawnItem(h.item, n, p.cxL + Math.cos(a) * 6, p.cyL - 2, Math.cos(a) * 320 + p.vx, Math.sin(a) * 320 - 60);
    this.consumeHeld(n);
  }

  updateWrench(dt, lx, ly) {
    const s = this.ship, w = this.wrench;
    const cx = Math.floor(lx / TS), cy = Math.floor(ly / TS);
    if (!this.inReach(lx, ly)) { this.wrench = null; return; }
    const turret = s.turretAtHull(cx, cy) || this.turretNear(lx, ly);
    const obj = s.objectAt(cx, cy);
    let key = null, need = 0;
    if (turret) { key = 't' + turret.id; need = 1.2; }
    else if (obj) { key = 'o' + obj.id; need = 1.0; }
    else if (s.isInterior(cx, cy) && s.get(cx, cy) !== T.EMPTY) { key = `c${cx},${cy}`; need = 0.25; }
    w.lx = lx; w.ly = ly;
    if (!key) { w.t = 0; return; }
    if (w.key !== key) { w.key = key; w.t = 0; w.need = need; }
    w.t += dt;
    if (w.t < w.need) return;
    if (turret) {
      if (turret.ammoType && turret.ammo > 0) this.unloadTurret(turret);
      if (turret.user) turret.user.exitControl();
      s.removeTurret(turret);
      this.giveItem(turret.type, 1, lx, ly);
    } else if (obj) {
      for (const c of s.crew) if (c.player && c.player.ctrl === obj) c.exitControl();
      if (obj.mats) for (const m of FAB_MATS) if (obj.mats[m] > 0) s.spawnItem(m, obj.mats[m], lx, ly, rand(-40, 40), -100);
      if (obj.inv) for (const st of obj.inv) if (st) s.spawnItem(st.item, st.n, lx, ly, rand(-60, 60), -120);
      s.removeObject(obj);
      this.giveItem(obj.type, 1, lx, ly);
    } else {
      const t = s.get(cx, cy);
      s.set(cx, cy, T.EMPTY); s.recalc();
      this.giveItem(TILE_INFO[t].item, 1, lx, ly);
    }
    this.sfx('break');
    s.world.spark(s.x + lx, s.y + ly, '#ffd84a', 6);
    w.key = null; w.t = 0;
  }

  tryPortal() {
    const s = this.ship, w = this.world;
    for (const p of w.portals) {
      const nx = clamp(p.x, s.x, s.x + s.pw), ny = clamp(p.y, s.y, s.y + s.ph);
      if (dist(nx, ny, p.x, p.y) < p.r) { this.uni.moveShip(s, p.target); return; }
    }
    this.notify('Voe sobre um portal e aperte Q para atravessar.', '#aaa');
  }

  // ---------- inventário / caixa ----------
  getCont(c) {
    if (c === 'inv') return this.player.inv;
    if (c === 'store' && this.ui && this.ui.type === 'store') {
      const o = this.ship.objects.find((x) => x.id === this.ui.oid);
      return o ? o.inv : null;
    }
    return null;
  }

  invMove(m) {
    const src = this.getCont(m.fc), dst = this.getCont(m.tc);
    const i = m.fi | 0, j = m.ti | 0;
    if (!src || !dst || !src[i] || j < 0 || j >= dst.length) return;
    if (dst === src && i === j) return;
    const s = src[i], t = dst[j];
    const n = clamp(m.n | 0, 1, s.n);
    if (!t) {
      dst[j] = { item: s.item, n };
      s.n -= n; if (s.n <= 0) src[i] = null;
    } else if (t.item === s.item) {
      const k = Math.min(ITEMS[t.item].stack - t.n, n);
      t.n += k; s.n -= k; if (s.n <= 0) src[i] = null;
    } else if (n === s.n) {
      dst[j] = s; src[i] = t;
    }
  }

  throwFrom(m) {
    const src = this.getCont(m.c);
    const i = m.i | 0;
    if (!src || !src[i]) return;
    const s = src[i], p = this.player;
    const n = clamp(m.n | 0, 1, s.n);
    const a = +m.a || 0;
    this.ship.spawnItem(s.item, n, p.cxL, p.cyL - 2, Math.cos(a) * 300, Math.sin(a) * 300 - 60);
    s.n -= n;
    if (s.n <= 0) { src[i] = null; if (m.c === 'inv') this.refillSlot(i, s.item); }
  }

  // ---------- fabricadores ----------
  fabOp(m) {
    if (!this.ui || this.ui.type !== 'fab') return;
    const o = this.ship.objects.find((x) => x.id === this.ui.oid);
    if (!o || !o.queue) return;
    const list = RECIPES[OBJECTS[o.type].fab];
    const refundFirst = () => {
      if (o.started && o.queue.length) {
        const r = list[o.queue[0].r];
        for (const k in r.cost) o.mats[k] = Math.min(FAB_CAP, (o.mats[k] || 0) + r.cost[k]);
      }
      o.started = false; o.progress = 0;
    };
    if (m.op === 'queue') {
      const r = m.r | 0;
      if (r < 0 || r >= list.length) return;
      const loop = m.n === -1;
      const last = o.queue[o.queue.length - 1];
      if (loop) o.queue.push({ r, left: null });
      else if (last && last.r === r && last.left !== null) last.left += clamp(m.n | 0, 1, 5);
      else o.queue.push({ r, left: clamp(m.n | 0, 1, 5) });
      if (o.queue.length > 8) o.queue.pop();
    } else if (m.op === 'clear') {
      refundFirst(); o.queue = [];
    } else if (m.op === 'rm') {
      const k = m.k | 0;
      if (k === 0) refundFirst();
      o.queue.splice(k, 1);
    } else if (m.op === 'eject') {
      for (const mat of FAB_MATS) if (o.mats[mat] > 0) { this.ship.spawnItem(mat, o.mats[mat], (o.x + 1) * TS, o.y * TS, rand(-40, 40), -120); o.mats[mat] = 0; }
    }
  }

  // ---------- chat e comandos ----------
  chat(text) {
    text = text.trim();
    if (!text) return;
    if (text.startsWith('/')) { this.command(text); return; }
    this.chatT = 0;
    const w = this.world;
    for (const c of this.uni.sessions.values()) {
      if (c.world === w) c.send({ t: 'chat', n: this.name, s: this.ship.name, m: text, mine: c.ship === this.ship });
    }
  }

  command(text) {
    const [cmd, ...args] = text.trim().split(/\s+/);
    const s = this.ship, rec = this.uni.records[s.key];
    switch (cmd.toLowerCase()) {
      case '/help': case '/ajuda':
        this.notify('Comandos: /convite, /publica, /expulsar NOME, /navenome NOME, /tripulacao, /save, /zonas, /nome NOME, /stats' + (this.uni.cheats ? ', /cheats' : ''), '#cfe'); break;
      case '/convite': case '/invite':
        this.notify(`Código de convite da nave: ${s.key} (outros jogadores entram com esse código)`, '#ffd84a'); break;
      case '/publica': case '/public':
        if (!this.isCaptain()) { this.notify('Só o capitão pode fazer isso.', '#ffb070'); break; }
        rec.public = !rec.public;
        this.uni.shipMsg(s, rec.public ? 'A nave agora é PÚBLICA (aparece na lista de naves).' : 'A nave agora é PRIVADA (só entra com código).', '#ffd84a');
        this.uni.persist();
        break;
      case '/expulsar': case '/kick': {
        if (!this.isCaptain()) { this.notify('Só o capitão pode fazer isso.', '#ffb070'); break; }
        const name = args.join(' ').toLowerCase();
        const c = s.crew.find((x) => x !== this && x.name.toLowerCase() === name);
        if (!c) { this.notify('Tripulante não encontrado.', '#ffb070'); break; }
        rec.banned = rec.banned || [];
        rec.banned.push(c.token);
        this.uni.leaveShip(c, true);
        c.notify('Você foi expulso da nave.', '#ff7070');
        this.uni.shipMsg(s, `${c.name} foi expulso.`, '#ffb070');
        break;
      }
      case '/navenome':
        if (!this.isCaptain()) { this.notify('Só o capitão pode fazer isso.', '#ffb070'); break; }
        if (args.length) { s.name = args.join(' ').slice(0, 24); rec.name = s.name; s.rev++; this.uni.persist(); }
        break;
      case '/tripulacao': case '/crew':
        this.notify('Tripulação: ' + s.crew.map((c) => c.name + (this.uni.records[s.key].owner === c.token ? ' (capitão)' : '')).join(', '), '#cfe'); break;
      case '/save': case '/salvar':
        if (!s.world.zone.safe) { this.notify('Só é possível salvar no Porto Livre (zona segura).', '#ffb070'); break; }
        this.uni.saveShip(s); this.notify('Nave salva!', '#9fe0ff'); break;
      case '/zonas': this.notify('Zonas: ' + Object.entries(ZONES).map(([k, z]) => `${z.name} (${k})`).join(', '), '#cfe'); break;
      case '/nome': if (args.length) { this.name = args.join(' ').slice(0, 16); this.player.name = this.name; this.notify('Nome alterado.', '#cfe'); } break;
      case '/stats': this.notify(`Nave "${s.name}" — bots destruídos: ${s.stats.bots} | naves destruídas: ${s.stats.ships}`, '#cfe'); break;
      case '/cheats':
        if (!this.uni.cheats) { this.notify('Trapaças desativadas neste servidor.', '#ffb070'); break; }
        this.cheats = !this.cheats; this.notify(`Trapaças ${this.cheats ? 'ativadas' : 'desativadas'}.`, '#ffd84a'); break;
      case '/goto':
        if (!this.cheats) { this.notify('Ative /cheats primeiro.', '#ffb070'); break; }
        if (ZONES[args[0]]) this.uni.moveShip(s, args[0]); else this.notify('Zona desconhecida. Veja /zonas', '#ffb070');
        break;
      case '/perto': {
        if (!this.cheats) { this.notify('Ative /cheats primeiro.', '#ffb070'); break; }
        const o = s.world.ships.filter((x) => x !== s && x.team === 'player').sort((a, b2) => dist(a.cx, a.cy, s.cx, s.cy) - dist(b2.cx, b2.cy, s.cx, s.cy))[0];
        if (!o) { this.notify('Nenhuma outra nave de jogador aqui.', '#ffb070'); break; }
        s.world.clearArea(o.x + o.pw, o.y - 200, s.pw + 500, Math.max(s.ph, o.ph) + 400);
        s.x = o.x + o.pw + 350; s.y = o.y; s.vx = s.vy = 0;
        break;
      }
      case '/give':
        if (!this.cheats) { this.notify('Ative /cheats primeiro.', '#ffb070'); break; }
        if (ITEMS[args[0]]) this.giveItem(args[0], clamp(parseInt(args[1] || '1', 10) || 1, 1, 999));
        else this.notify('Item desconhecido. Itens: ' + Object.keys(ITEMS).join(', '), '#ffb070');
        break;
      default: this.notify('Comando desconhecido. Digite /help', '#ffb070');
    }
  }
}

// ============================================================
//  Jogo: laço principal, entrada, ações do jogador, câmera,
//  viagens entre zonas, salvamento.
// ============================================================
'use strict';

const SAVE_KEY = 'couracado_save_v1';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this, this.canvas);
    this.ui = new UI(this);
    this.cam = { x: 0, y: 0, zoom: 1.4, targetZoom: 1.4 };
    this.keys = {};
    this.pressed = {};
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, left: false, right: false, leftPressed: false };
    this.mouseWorld = { x: 0, y: 0 };
    this.time = 0;
    this.shakeAmt = 0;
    this.resizeAxis = 'x';
    this.wrench = null;
    this.stats = { bots: 0, ships: 0, time: 0, zones: new Set() };
    this.cheats = false;
    this.running = false;
    this.saveTimer = 0;
    this.bindInput();
    addEventListener('resize', () => this.renderer.resize());
    this.renderer.resize();
    // mundo de fundo para a tela de título
    this.world = new World('hummingbird', this);
    this.cam.x = this.world.size / 2; this.cam.y = this.world.size / 2; this.cam.zoom = 0.5;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- início / salvamento ----------
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

  start(fromSave, name) {
    SFX.init();
    let data = null;
    if (fromSave) { try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; } }
    this.world = new World('freeport', this);
    if (data) {
      this.ship = Ship.deserialize(data.ship);
      this.player = new Player(this.ship);
      this.player.inv = data.player.inv;
      this.player.equip = data.player.equip || { feet: null, back: null };
      this.player.sel = data.player.sel || 0;
      this.player.name = data.player.name || name || 'Você';
      if (data.stats) { this.stats.bots = data.stats.bots || 0; this.stats.ships = data.stats.ships || 0; this.stats.time = data.stats.time || 0; }
      this.notify('Jogo carregado. Bem-vindo de volta ao Porto Livre!', '#9fe0ff');
    } else {
      this.ship = buildStarterShip();
      this.player = new Player(this.ship);
      this.player.name = name || 'Você';
      invAdd(this.player.inv, 'wrench', 1);
      invAdd(this.player.inv, 'ammo_standard', 8);
      invAdd(this.player.inv, 'block', 16);
      invAdd(this.player.inv, 'walkway', 8);
      invAdd(this.player.inv, 'booster', 2);
      this.stats = { bots: 0, ships: 0, time: 0, zones: new Set() };
      this.notify('Nova nave criada! Aperte H para ver os controles.', '#9fe0ff');
    }
    this.ship.name = data ? this.ship.name : `Nave de ${this.player.name}`;
    const spot = this.world.findOpenSpot(this.ship.pw, this.ship.ph, 150);
    this.world.addShip(this.ship, spot.x, spot.y);
    this.cam.x = this.ship.cx; this.cam.y = this.ship.cy; this.cam.zoom = 1.4; this.cam.targetZoom = 1.4;
    this.stats.zones.add('freeport');
    this.running = true;
    this.ui.onStart();
    this.save();
  }

  save(manual = false) {
    if (!this.running || !this.ship || this.ship.dead) return;
    if (!this.world.zone.safe) { if (manual) this.notify('Só é possível salvar no Porto Livre (zona segura).', '#ffb070'); return; }
    const p = this.player;
    const data = {
      v: 1,
      ship: this.ship.serialize(),
      player: { inv: p.inv, equip: p.equip, sel: p.sel, name: p.name },
      stats: { bots: this.stats.bots, ships: this.stats.ships, time: this.stats.time },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); if (manual) this.notify('Nave salva!', '#9fe0ff'); }
    catch (e) { if (manual) this.notify('Falha ao salvar: ' + e.message, '#ff7070'); }
  }

  onPlayerShipDestroyed() {
    this.exitControl();
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    this.ui.showDeath();
    this.player = null;
    this.running = false;
  }

  // ---------- viagem entre zonas ----------
  travel(zoneId) {
    const old = this.world;
    old.ships = old.ships.filter((s) => s !== this.ship);
    this.world = new World(zoneId, this);
    this.renderer.terrainDirty = true;
    const spot = this.world.findOpenSpot(this.ship.pw, this.ship.ph, 200);
    this.world.addShip(this.ship, spot.x, spot.y);
    this.cam.x = this.ship.cx; this.cam.y = this.ship.cy;
    this.stats.zones.add(zoneId);
    const z = this.world.zone;
    this.ui.zoneBanner(z);
    this.notify(`Entrando em ${z.name}. ${z.desc}`, z.safe ? '#9fe0ff' : z.pvp ? '#ff9a7a' : '#d0ffa0');
    SFX.play('portal', 1);
    if (z.safe) this.save();
  }

  // ---------- utilidades ----------
  notify(msg, color = '#fff') { this.ui.chatLine(msg, color); }
  shake(a, x, y) {
    const d = x !== undefined ? dist(x, y, this.cam.x, this.cam.y) : 0;
    const f = clamp(1 - d / 1600, 0, 1);
    this.shakeAmt = Math.max(this.shakeAmt, a * f);
  }
  sfx(name, x, y) {
    const d = x !== undefined ? dist(x, y, this.cam.x, this.cam.y) : 0;
    SFX.play(name, clamp(1 - d / 1500, 0, 1));
  }

  // ---------- entrada ----------
  bindInput() {
    addEventListener('keydown', (e) => {
      if (this.ui.chatOpen) {
        if (e.code === 'Enter') { this.ui.submitChat(); e.preventDefault(); }
        else if (e.code === 'Escape') this.ui.closeChat();
        return;
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.running) this.onKey(e);
      else if (e.code === 'Enter' && this.ui.titleOpen) this.ui.clickPlay();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mouse.left = false; this.mouse.right = false; });
    const cv = this.canvas;
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    cv.addEventListener('mousedown', (e) => {
      SFX.init();
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.onRightClick(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.targetZoom = clamp(this.cam.targetZoom * (e.deltaY > 0 ? 0.88 : 1.13), 0.3, 3);
    }, { passive: false });
  }

  onKey(e) {
    const p = this.player;
    if (!p) return;
    const c = e.code;
    if (c === 'Enter') { this.ui.openChat(); e.preventDefault(); return; }
    if (c === 'Slash') { this.ui.openChat('/'); e.preventDefault(); return; }
    if (c === 'KeyH' || c === 'F1') { this.ui.toggleHelp(); e.preventDefault(); return; }
    if (c === 'Escape') {
      if (this.ui.closeAll()) return;
      if (p.mode !== 'walk') this.exitControl();
      return;
    }
    if (c.startsWith('Digit')) {
      const n = c === 'Digit0' ? 9 : parseInt(c.slice(5), 10) - 1;
      if (n >= 0 && n < 10) { p.sel = n; this.wrench = null; this.ui.renderInv(); }
      return;
    }
    if (c === 'KeyI') { this.ui.toggleEquip(); return; }
    if (c === 'KeyM') { this.ui.toggleBigMap(); return; }
    if (p.mode === 'helm') {
      if (c === 'Space') this.exitControl();
      if (c === 'KeyQ') this.tryPortal();
      return;
    }
    if (p.mode === 'turret') {
      if (c === 'Space') this.exitControl();
      if (c === 'KeyQ') this.unloadTurret(p.ctrl);
      return;
    }
    if (c === 'KeyQ') this.dropHeld(e.shiftKey);
    if (c === 'KeyR') {
      const h = p.held;
      if (h && (h.item === 'embiggener' || h.item === 'shrinker')) {
        this.resizeAxis = this.resizeAxis === 'x' ? 'y' : 'x';
        this.notify(`Eixo de redimensionamento: ${this.resizeAxis === 'x' ? 'horizontal (direita)' : 'vertical (cima)'}`, '#cfe');
      }
    }
  }

  onRightClick() {
    this.wrench = null;
    this.ui.closeAll();
  }

  exitControl() {
    const p = this.player;
    if (!p) return;
    if (p.mode === 'helm' && this.ship) { this.ship.pilot = null; this.ship.thrust.x = 0; this.ship.thrust.y = 0; }
    p.mode = 'walk'; p.ctrl = null;
  }

  // ---------- laço ----------
  frame(t) {
    let dt = (t - this.last) / 1000;
    this.last = t;
    dt = Math.min(dt, 0.05);
    this.acc = (this.acc || 0) + dt;
    const step = 1 / 60;
    let n = 0;
    while (this.acc >= step && n < 4) { this.update(step); this.acc -= step; n++; }
    if (n >= 4) this.acc = 0;
    this.renderer.draw(dt);
    this.ui.update(dt);
    requestAnimationFrame((tt) => this.frame(tt));
  }

  update(dt) {
    this.time += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
    this.mouseWorld = this.renderer.toWorld(this.mouse.x, this.mouse.y);
    const p = this.player, s = this.ship;
    if (this.running && p && s && !s.dead) {
      this.stats.time += dt;
      const uiBlock = this.ui.blocking();
      const input = {
        left: !!(this.keys.KeyA || this.keys.ArrowLeft), right: !!(this.keys.KeyD || this.keys.ArrowRight),
        up: !!(this.keys.KeyW || this.keys.ArrowUp), down: !!(this.keys.KeyS || this.keys.ArrowDown),
        jump: !!this.keys.Space, jumpPressed: !!this.pressed.Space,
        downPressed: !!(this.pressed.KeyS || this.pressed.ArrowDown),
      };
      if (uiBlock && this.ui.typing()) { for (const k in input) input[k] = false; }
      const lx = this.mouseWorld.x - s.x, ly = this.mouseWorld.y - s.y;
      this.aimAngle = Math.atan2(ly - p.cyL, lx - p.cxL);

      if (p.mode === 'walk') {
        p.update(dt, input);
        if (input.jumpPressed && p.onGround === false && p.vy < -200) this.sfx('jump');
        if (this.mouse.leftPressed && !this.ui.mouseOverUI) this.primaryClick(lx, ly);
        if (this.mouse.left && this.wrench) this.updateWrench(dt, lx, ly);
        else this.wrench = null;
      } else if (p.mode === 'helm') {
        s.thrust.x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        s.thrust.y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const l = Math.hypot(s.thrust.x, s.thrust.y);
        if (l > 1) { s.thrust.x /= l; s.thrust.y /= l; }
        for (const t of s.turrets) {
          if (!TURRETS[t.type].rc) continue;
          const tw = s.turretWorld(t);
          const a = s.clampTurretAngle(t, Math.atan2(this.mouseWorld.y - tw.y, this.mouseWorld.x - tw.x));
          t.angle += clamp(angDiff(t.angle, a), -8 * dt, 8 * dt);
          if (this.mouse.left && !this.ui.mouseOverUI) this.world.fireTurret(s, t);
        }
        if (!s.objects.includes(p.ctrl)) this.exitControl();
      } else if (p.mode === 'turret') {
        const t = p.ctrl;
        if (!s.turrets.includes(t)) this.exitControl();
        else {
          const tw = s.turretWorld(t);
          const a = s.clampTurretAngle(t, Math.atan2(this.mouseWorld.y - tw.y, this.mouseWorld.x - tw.x));
          t.angle += clamp(angDiff(t.angle, a), -10 * dt, 10 * dt);
          const d = TURRETS[t.type];
          if (this.mouse.left && !this.ui.mouseOverUI && (d.auto || this.mouse.leftPressed || t.cool <= 0)) this.world.fireTurret(s, t);
        }
      }
      // autosave no porto
      if (this.world.zone.safe) {
        this.saveTimer -= dt;
        if (this.saveTimer <= 0) { this.save(); this.saveTimer = 8; }
      }
    }
    this.world.update(dt);
    this.updateCamera(dt);
    this.mouse.leftPressed = false;
    this.pressed = {};
  }

  updateCamera(dt) {
    const p = this.player, s = this.ship, c = this.cam;
    let tx = c.x, ty = c.y;
    if (this.running && s && p) {
      if (p.mode === 'walk') { tx = s.x + p.cxL; ty = s.y + p.cyL; }
      else {
        const mx = this.mouseWorld.x - s.cx, my = this.mouseWorld.y - s.cy;
        tx = s.cx + clamp(mx, -600, 600) * 0.25; ty = s.cy + clamp(my, -400, 400) * 0.25;
        if (p.mode === 'turret') { tx = (tx + s.x + p.cxL) / 2; ty = (ty + s.y + p.cyL) / 2; }
      }
    } else {
      tx = this.world.size / 2 + Math.cos(this.time * 0.05) * 800;
      ty = this.world.size / 2 + Math.sin(this.time * 0.04) * 600;
    }
    const k = Math.min(1, dt * 8);
    c.x += (tx - c.x) * k + (s && this.running ? s.vx * dt * (1 - k) : 0);
    c.y += (ty - c.y) * k + (s && this.running ? s.vy * dt * (1 - k) : 0);
    c.zoom += (c.targetZoom - c.zoom) * Math.min(1, dt * 10);
  }

  // ---------- ações do jogador ----------
  inReach(lx, ly) { const p = this.player; return dist(p.cxL, p.cyL, lx, ly) <= REACH; }

  canPlaceTile(cx, cy) {
    const s = this.ship, p = this.player;
    if (!s.isInterior(cx, cy)) return false;
    if (s.get(cx, cy) !== T.EMPTY || s.objectAt(cx, cy)) return false;
    const h = p.held;
    if (h && ITEMS[h.item].tile === T.BLOCK) {
      if (aabbOverlap(p.x, p.y, p.w, p.h, cx * TS, cy * TS, TS, TS)) return false;
    }
    return true;
  }

  consumeHeld(n = 1) {
    const p = this.player, h = p.held;
    if (!h) return;
    h.n -= n;
    if (h.n <= 0) p.inv[p.sel] = null;
    this.ui.renderInv();
  }

  giveItem(item, n, lx, ly) {
    const p = this.player;
    const rest = invAdd(p.inv, item, n);
    if (rest > 0) this.ship.spawnItem(item, rest, lx ?? p.cxL, ly ?? p.cyL, 0, -60);
    this.ui.renderInv();
  }

  itemUnder(lx, ly) {
    const s = this.ship;
    let best = null, bd = 12;
    for (const it of s.items) {
      const d = dist(lx, ly, it.x + it.w / 2, it.y + it.h / 2);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  primaryClick(lx, ly) {
    const p = this.player, s = this.ship;
    const cx = Math.floor(lx / TS), cy = Math.floor(ly / TS);
    const reach = this.inReach(lx, ly);
    const h = p.held;
    const d = h ? ITEMS[h.item] : null;
    const turret = s.turretAtHull(cx, cy) || this.turretNear(lx, ly);
    const obj = s.objectAt(cx, cy);
    const item = this.itemUnder(lx, ly);

    if (!reach) {
      if (h || obj || turret || item) { this.notify('Muito longe.', '#aaa'); this.sfx('error'); }
      return;
    }

    // triturador destrói itens soltos
    if (d && d.tool === 'shredder') {
      if (item) {
        s.items.splice(s.items.indexOf(item), 1);
        this.world.spark(s.x + lx, s.y + ly, '#ff7070', 8);
        this.sfx('break');
      }
      return;
    }

    // pegar item solto
    if (item) {
      const rest = invAdd(p.inv, item.item, item.n);
      if (rest === item.n) { this.notify('Inventário cheio.', '#ffb070'); this.sfx('error'); return; }
      if (rest > 0) item.n = rest; else s.items.splice(s.items.indexOf(item), 1);
      this.sfx('collect');
      this.ui.renderInv();
      return;
    }

    // chave inglesa: segurar para desmontar
    if (d && d.tool === 'wrench') {
      this.wrench = { cx, cy, t: 0, need: 0, key: null };
      return;
    }

    // usos específicos do item em alvos
    if (d && turret && d.kind === 'ammo') { this.loadTurret(turret, h); return; }
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
      if (obj.type === 'expando') { this.ui.openStorage(obj); return; }
    }

    // interagir
    if (turret) { this.controlTurret(turret); return; }
    if (obj) { this.interact(obj); return; }

    // colocação / uso geral
    if (d) this.useHeld(lx, ly, cx, cy);
  }

  turretNear(lx, ly) {
    const s = this.ship;
    for (const t of s.turrets) {
      const p = s.turretLocal(t);
      if (dist(lx, ly, p.x, p.y) < 14) return t;
    }
    return null;
  }

  useHeld(lx, ly, cx, cy) {
    const p = this.player, s = this.ship, h = p.held, d = ITEMS[h.item];
    if (d.kind === 'tile') {
      if (this.canPlaceTile(cx, cy)) {
        s.set(cx, cy, d.tile); s.recalc();
        this.consumeHeld(1); this.sfx('place');
      } else this.sfx('error');
    } else if (d.kind === 'object') {
      const od = OBJECTS[d.obj];
      const ox = cx - Math.floor((od.w - 1) / 2), oy = cy - (od.h - 1);
      if (s.canPlaceObject(d.obj, ox, oy)) {
        s.placeObject(d.obj, ox, oy);
        this.consumeHeld(1); this.sfx('place');
        this.notify(`${od.name} construído.`, '#cfe');
      } else { this.notify(od.floor ? 'Espaço inválido (precisa de piso embaixo e área livre).' : 'Espaço inválido.', '#ffb070'); this.sfx('error'); }
    } else if (d.kind === 'turret') {
      const hs = s.hullCellToSide(cx, cy);
      if (hs && s.canPlaceTurret(hs.side, hs.pos)) {
        s.placeTurret(d.turret, hs.side, hs.pos);
        this.consumeHeld(1); this.sfx('place');
        this.notify(`${d.name} instalada. Carregue com munição.`, '#cfe');
      } else { this.notify('Torretas vão no casco externo e precisam de 3 blocos de espaço.', '#ffb070'); this.sfx('error'); }
    } else if (d.tool === 'booster') {
      if (s.shield >= s.maxShield) { this.notify('Escudo já está cheio.', '#aaa'); return; }
      s.shield = Math.min(s.maxShield, s.shield + 80);
      this.consumeHeld(1); this.sfx('shield');
      this.world.spark(s.x + lx, s.y + ly, '#7fd0ff', 12);
    } else if (d.tool === 'repair') {
      if (s.integrity >= s.maxIntegrity) { this.notify('O casco está intacto.', '#aaa'); return; }
      s.integrity = Math.min(s.maxIntegrity, s.integrity + 60);
      this.consumeHeld(1); this.sfx('place');
    } else if (d.tool === 'embiggener' || d.tool === 'shrinker') {
      const dir = d.tool === 'embiggener' ? 1 : -1;
      const err = s.resize(this.resizeAxis, dir);
      if (err) { this.notify(err, '#ffb070'); this.sfx('error'); return; }
      if (this.resizeAxis === 'y') p.y += dir * TS;
      this.consumeHeld(1); this.sfx('place');
      this.notify(`Nave agora tem ${s.w}x${s.h}.`, '#cfe');
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
    this.ui.renderInv(); this.ui.renderEquip();
  }

  unequip(slot) {
    const p = this.player;
    if (!p.equip[slot]) return;
    const rest = invAdd(p.inv, p.equip[slot], 1);
    if (rest) { this.notify('Inventário cheio.', '#ffb070'); return; }
    p.equip[slot] = null;
    this.ui.renderInv(); this.ui.renderEquip();
  }

  interact(o) {
    const p = this.player, s = this.ship;
    const od = OBJECTS[o.type];
    switch (o.type) {
      case 'helm':
        if (s.pilot && s.pilot !== p) return;
        p.mode = 'helm'; p.ctrl = o; s.pilot = p;
        p.x = (o.x + 1) * TS - p.w / 2; p.y = (o.y + 2) * TS - p.h - 0.1; p.vx = 0; p.vy = 0;
        this.wrench = null;
        this.notify('Pilotando: WASD move, clique dispara torretas RC, Q usa portal, Espaço sai.', '#cfe');
        break;
      case 'door': o.open = !o.open; this.sfx('click'); break;
      case 'hatch': {
        const modes = ['all', 'none'];
        o.mode = modes[(modes.indexOf(o.mode) + 1) % modes.length];
        this.notify(`Escotilha: ${o.mode === 'all' ? 'liberada (verde)' : 'bloqueada (vermelha)'}`, '#cfe');
        this.sfx('click');
        break;
      }
      case 'expando': this.ui.openStorage(o); break;
      case 'shield_gen': this.notify(`Gerador de escudo: ${Math.round(o.fuel || 0)} de carga. Use Reforços ou Fluxo nele.`, '#9fe0ff'); break;
      case 'recycler': this.notify('Clique no reciclador segurando um item para reciclá-lo.', '#cfe'); break;
      case 'ejector': this.notify('Clique no ejetor segurando um item para lançá-lo ao espaço.', '#cfe'); break;
      case 'spawn': this.notify('Ponto de renascimento.', '#cfe'); break;
      default:
        if (od.fab) this.ui.openFab(o);
    }
  }

  controlTurret(t) {
    const p = this.player;
    if (TURRETS[t.type].rc) { this.notify('Torretas RC são disparadas pelo leme.', '#ffb070'); return; }
    p.mode = 'turret'; p.ctrl = t; this.wrench = null;
    this.notify(`${TURRETS[t.type].name}: clique para atirar, Q descarrega, Espaço sai. Munição: ${t.ammo}`, '#cfe');
  }

  loadTurret(t, h) {
    const p = this.player;
    const ammoKey = ITEMS[h.item].ammo;
    const cap = TURRETS[t.type].cap;
    if (t.ammoType && t.ammoType !== ammoKey && t.ammo > 0) this.unloadTurret(t);
    if (t.ammo + AMMO[ammoKey].shots > cap) { this.notify('Torreta cheia.', '#aaa'); return; }
    let used = 0;
    const max = this.keys.ShiftLeft || this.keys.ShiftRight ? h.n : 1;
    while (used < max && t.ammo + AMMO[ammoKey].shots <= cap) { t.ammo += AMMO[ammoKey].shots; used++; }
    t.ammoType = ammoKey;
    this.consumeHeld(used);
    this.sfx('load');
    this.notify(`Torreta carregada: ${t.ammo}/${cap} (${AMMO[ammoKey].name})`, '#cfe');
    void p;
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
    this.ui.refreshFab();
  }

  recycle(o, h) {
    const v = recycleValue(h.item);
    const keys = Object.keys(v);
    if (!keys.length) { this.notify('Esse item não pode ser reciclado.', '#ffb070'); this.sfx('error'); return; }
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
    const a = this.aimAngle || 0;
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
    if (!key) { w.t = 0; return; }
    if (w.key !== key) { w.key = key; w.t = 0; w.need = need; }
    w.t += dt;
    if (w.t < w.need) return;
    // desmonta
    if (turret) {
      if (turret.ammoType && turret.ammo > 0) this.unloadTurret(turret);
      s.turrets.splice(s.turrets.indexOf(turret), 1); s.recalc();
      this.giveItem(turret.type, 1, lx, ly);
    } else if (obj) {
      if (obj === this.player.ctrl) this.exitControl();
      if (obj.mats) for (const m of FAB_MATS) if (obj.mats[m] > 0) s.spawnItem(m, obj.mats[m], lx, ly, rand(-40, 40), -100);
      if (obj.inv) for (const st of obj.inv) if (st) s.spawnItem(st.item, st.n, lx, ly, rand(-60, 60), -120);
      if (this.ui.storageObj === obj || this.ui.fabObj === obj) this.ui.closeAll();
      s.removeObject(obj);
      this.giveItem(obj.type, 1, lx, ly);
    } else {
      const t = s.get(cx, cy);
      s.set(cx, cy, T.EMPTY); s.recalc();
      this.giveItem(TILE_INFO[t].item, 1, lx, ly);
    }
    this.sfx('break');
    this.world.spark(s.x + lx, s.y + ly, '#ffd84a', 6);
    w.key = null; w.t = 0;
  }

  tryPortal() {
    const s = this.ship;
    for (const p of this.world.portals) {
      const nx = clamp(p.x, s.x, s.x + s.pw), ny = clamp(p.y, s.y, s.y + s.ph);
      if (dist(nx, ny, p.x, p.y) < p.r) {
        const z = ZONES[p.target];
        if (z.mission && !this.world.zone.safe && this.world.zone.pvp === false) { /* livre */ }
        this.travel(p.target);
        return;
      }
    }
    this.notify('Voe sobre um portal e aperte Q para atravessar.', '#aaa');
  }

  // ---------- chat / comandos ----------
  command(text) {
    const [cmd, ...args] = text.trim().split(/\s+/);
    switch (cmd.toLowerCase()) {
      case '/help': case '/ajuda':
        this.notify('Comandos: /save, /zonas, /nome NOME, /stats, /cheats (ativa /goto ZONA e /give ITEM N)', '#cfe'); break;
      case '/save': case '/salvar': this.save(true); break;
      case '/zonas': this.notify('Zonas: ' + Object.entries(ZONES).map(([k, z]) => `${z.name} (${k})`).join(', '), '#cfe'); break;
      case '/nome': if (args.length) { this.player.name = args.join(' ').slice(0, 16); this.ship.name = `Nave de ${this.player.name}`; this.notify('Nome alterado.', '#cfe'); } break;
      case '/stats': this.notify(`Bots destruídos: ${this.stats.bots} | Naves destruídas: ${this.stats.ships} | Tempo: ${Math.floor(this.stats.time / 60)} min`, '#cfe'); break;
      case '/cheats': this.cheats = !this.cheats; this.notify(`Trapaças ${this.cheats ? 'ativadas' : 'desativadas'}.`, '#ffd84a'); break;
      case '/goto':
        if (!this.cheats) { this.notify('Ative /cheats primeiro.', '#ffb070'); break; }
        if (ZONES[args[0]]) this.travel(args[0]); else this.notify('Zona desconhecida. Veja /zonas', '#ffb070');
        break;
      case '/give':
        if (!this.cheats) { this.notify('Ative /cheats primeiro.', '#ffb070'); break; }
        if (ITEMS[args[0]]) { this.giveItem(args[0], parseInt(args[1] || '1', 10) || 1); }
        else this.notify('Item desconhecido. Ex.: /give metal 16. Itens: ' + Object.keys(ITEMS).join(', '), '#ffb070');
        break;
      default: this.notify('Comando desconhecido. Digite /help', '#ffb070');
    }
  }
}

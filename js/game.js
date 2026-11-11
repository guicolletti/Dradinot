// ============================================================
//  Cliente do jogo: conexão, espelho do estado recebido,
//  predição do movimento do tripulante, entrada, câmera.
//  A simulação de verdade roda no Universe (servidor ou local).
// ============================================================
'use strict';

const INPUT_RATE = 1 / 30;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this, this.canvas);
    this.ui = new UI(this);
    this.cam = { x: 0, y: 0, zoom: 1.4, targetZoom: 1.4 };
    this.zoomWalk = 3;       // zoom a pé (dentro da nave)
    this.zoomFly = 1.5;      // zoom pilotando ou na torreta
    this.keys = {};
    this.pressed = {};
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, left: false, right: false, leftPressed: false };
    this.mouseWorld = { x: 0, y: 0 };
    this.time = 0;
    this.shakeAmt = 0;
    this.resizeAxis = 'x';
    this.wrench = null;
    this.shapeSel = {};        // formato escolhido para cada item de construção (Bloco, Rede)
    this.shapeWheel = null;    // roda de formatos aberta (segurando R)
    this.loaderDirs = { din: 6, dout: 2 };
    this.gunSide = 1;          // lado do próximo Posto de Artilharia (índice em GUN_SIDES; 1 = direita)   // direções do próximo Carregador (pega da esquerda, coloca à direita)
    this.state = 'title';      // title | menu | play | dead
    this.transport = null;
    this.ships = new Map();
    this.ship = null;
    this.player = null;
    this.pid = null; this.sid = null; this.key = null;
    this.captain = false;
    this.inputT = 0;
    this.token = getToken();
    this.bindInput();
    addEventListener('resize', () => this.renderer.resize());
    addEventListener('beforeunload', () => { if (this.transport) this.transport.close(); });
    this.renderer.resize();
    // mundo decorativo para a tela de título
    this.world = new World('hummingbird', this);
    this.cam.x = this.world.size / 2; this.cam.y = this.world.size / 2; this.cam.zoom = this.cam.targetZoom = 0.5;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get running() { return this.state === 'play' && !!this.ship && !!this.player; }

  // ---------- conexão ----------
  connect(kind, addr) {
    SFX.init();
    if (this.transport) this.transport.close();
    const onMsg = (m) => this.onMessage(m);
    if (kind === 'offline') this.transport = new LocalTransport(onMsg);
    else {
      const url = wsURL(addr);
      if (!url) { this.ui.titleError('Digite o endereço do servidor.'); return; }
      try { this.transport = new WSTransport(url, onMsg); } catch (e) { this.ui.titleError('Endereço inválido.'); return; }
      this.transport.onError = () => this.ui.titleError('Não foi possível conectar ao servidor.');
      this.transport.onClose = () => this.onDisconnect();
    }
    this.ui.titleStatus(kind === 'offline' ? 'Iniciando...' : 'Conectando...');
    this.transport.onOpen = () => this.send({ t: 'hello', name: this.ui.playerName(), token: this.token });
  }

  disconnect() {
    if (this.transport) { const t = this.transport; this.transport = null; t.close(); }
    this.clearPlay();
    this.state = 'title';
    this.ui.showTitle();
  }

  onDisconnect() {
    this.transport = null;
    this.clearPlay();
    this.state = 'title';
    this.ui.showTitle();
    this.ui.titleError('Conexão com o servidor perdida.');
  }

  send(m) { if (this.transport) this.transport.send(m); }

  clearPlay() {
    this.ship = null; this.player = null; this.ships = new Map();
    this.pid = this.sid = this.key = null;
    this.ui.closeAll(true);
  }

  onMessage(m) {
    switch (m.t) {
      case 'menu':
        this.clearPlay();
        this.state = 'menu';
        this.ui.showMenu(m, this.transport && this.transport.kind);
        break;
      case 'joined':
        this.pid = m.pid; this.sid = m.sid; this.key = m.key; this.captain = m.captain;
        this.state = 'play';
        this.ui.onStart();
        break;
      case 'zone':
        this.world = new World(m.id, this, { mirror: m });
        this.ships = new Map();
        this.ship = null;
        this.renderer.terrainDirty = true;
        this.ui.zoneBanner(this.world.zone);
        break;
      case 's': if (this.state === 'play') this.applySnapshot(m); break;
      case 'msg': this.ui.chatLine(m.m, m.c); break;
      case 'chat': this.ui.chatLine(`<b style="color:${m.mine ? '#9fe0ff' : '#ffd0a0'}">${this.ui.esc(m.n)}</b> <small>[${this.ui.esc(m.s)}]</small>: ${this.ui.esc(m.m)}`, '#fff', true); break;
      case 'sfx': SFX.play(m.n, 1); break;
      case 'ui':
        if (m.op === 'fab') this.ui.openFab(m.oid);
        else if (m.op === 'loader') this.ui.openLoader(m.oid);
        else if (m.op === 'hatch') this.ui.openHatch(m.oid);
        else if (m.op === 'store') this.ui.openStorage(m.oid);
        else this.ui.closeAll(true);
        break;
      case 'dead':
        this.state = 'dead';
        this.ship = null; this.player = null;
        this.ui.showDeath(m.stats);
        break;
      case 'err': this.ui.menuError(m.m); break;
    }
  }

  // ---------- espelho do estado ----------
  applySnapshot(m) {
    const now = this.time;
    const w = this.world;
    for (const st of m.st) {
      const s = this.ships.get(st.id);
      if (s) s.applyStruct(st);
      else { const ns = Ship.fromStruct(st); ns.crewNet = []; ns.fresh = true; this.ships.set(st.id, ns); }
    }
    for (const [id, objs] of m.ob) {
      const s = this.ships.get(id);
      if (!s) continue;
      s.objects = objs;
      for (const o of objs) if (o.queue) for (const q of o.queue) if (q.left === null) q.left = Infinity;
      s.rebuildObjMap();
    }
    const list = [];
    for (const d of m.sh) {
      const s = this.ships.get(d[0]);
      if (!s) continue;
      list.push(s);
      if (s.fresh) { s.x = d[1]; s.y = d[2]; s.fresh = false; }
      s.sx = d[1]; s.sy = d[2]; s.vx = d[3]; s.vy = d[4]; s.rt = now;
      s.shield = d[5]; s.integrity = d[6]; s.maxShield = d[7]; s.maxIntegrity = d[8];
      s.hitFlash = d[9]; s.thrustX = d[10];
      d[11].forEach((td, i) => {
        const t = s.turrets[i];
        if (!t) return;
        t.netAngle = td[0]; t.ammo = td[1]; t.ammoType = td[2] || null; t.recoil = td[3];
        if (t.angle === undefined || !t.predicted) t.angle = td[0];
      });
      if (d.length > 13) {
        const prev = new Map(s.items.map((it) => [it.id, it]));
        s.items = d[13].map(([id, item, n, x, y, rot]) => {
          const p = prev.get(id);
          return { id, item, n, tx: x, ty: y, x: p ? p.x : x, y: p ? p.y : y, rot, w: 10, h: 10 };
        });
        const pc = new Map((s.crewNet || []).map((c) => [c.id, c]));
        s.crewNet = d[14].map(([id, name, x, y, f, og, wa, mode, held, feet, back, jet, aim]) => {
          const p = pc.get(id);
          return {
            id, name, tx: x, ty: y, x: p ? p.x : x, y: p ? p.y : y, w: 10, h: 22, facing: f, onGround: !!og, walkAnim: wa, mode,
            held: held ? { item: held, n: 1 } : null, equip: { feet: feet || null, back: back || null }, jetting: !!jet, aim,
            get cxL() { return this.x + 5; }, get cyL() { return this.y + 11; },
          };
        });
        s.cargoN = d[15]; s.key = d[16];
        const pcart = new Map((s.carts || []).map((c) => [c.id, c]));
        s.carts = (d[17] || []).map(([id, x, y, item, n, dir]) => {
          const p = pcart.get(id);
          // carrinho novo (ou que pulou para longe) aparece direto no lugar; senão desliza até a posição
          const near = p && Math.abs(p.x - x) + Math.abs(p.y - y) < TS * 3;
          return { id, item, n, dir, tx: x, ty: y, x: near ? p.x : x, y: near ? p.y : y };
        });
      }
    }
    for (const s of this.ships.values()) if (!list.includes(s)) this.ships.delete(s.id);
    w.ships = list;

    // bots e caixas com suavização
    const pb = new Map(w.bots.map((b) => [b.id, b]));
    w.bots = m.bo.map(([id, type, x, y, vx, vy, angle, hp, maxHp, flash, rot]) => {
      const p = pb.get(id);
      return { id, type, sx: x, sy: y, x: p ? p.x : x, y: p ? p.y : y, vx, vy, rt: now, angle, hp, maxHp, flash, rot, r: BOTS[type].r };
    });
    const pcr = new Map(w.crates.map((c) => [c.id, c]));
    w.crates = m.cr.map(([id, x, y, vx, vy, rot, item, rare]) => {
      const p = pcr.get(id);
      return { id, sx: x, sy: y, x: p ? p.x : x, y: p ? p.y : y, vx, vy, rt: now, rot, items: [[item, 1]], rare: !!rare };
    });
    w.bullets = m.bu.map(([x, y, vx, vy, ammo, r]) => ({ x, y, vx, vy, ammo, r }));
    if (m.tc.length) { w.applyTileChanges(m.tc); this.renderer.terrainDirty = true; }
    w.playFx(m.fx);

    // eu
    this.ship = this.ships.get(this.sid) || null;
    if (!this.ship) return;
    const me = m.me;
    if (!this.player) {
      this.player = new Player(this.ship);
      this.player.name = this.ui.playerName();
      this.player.tp = -1;
    }
    const p = this.player;
    p.ship = this.ship;
    if (me.inv) { p.inv = me.inv; this.ui.renderInv(); }
    if (me.eq) { p.equip = me.eq; this.ui.renderEquip(); }
    const modeChanged = p.mode !== me.mode;
    p.mode = me.mode;
    if (me.tp !== p.tp || me.mode !== 'walk') {
      p.x = me.x; p.y = me.y;
      if (me.tp !== p.tp) { p.vx = 0; p.vy = 0; }
      p.tp = me.tp;
    }
    p.ctrl = !me.ctrl ? null : me.ctrl.k === 't' ? this.ship.turrets[me.ctrl.i] || null : this.ship.objects.find((o) => o.id === me.ctrl.id) || null;
    this.resizeAxis = me.rax;
    this.wrench = me.wr ? { lx: me.wr[0], ly: me.wr[1], t: me.wr[2], need: me.wr[3] } : null;
    this.captain = me.cap; this.isPublic = me.pub;
    if (modeChanged) this.ui.renderInv();
  }

  // suaviza uma entidade em direção à posição do servidor
  smooth(e, dt, k = 12) {
    if (e.sx === undefined) return;
    const age = Math.min(0.25, this.time - e.rt);
    const tx = e.sx + e.vx * age, ty = e.sy + e.vy * age;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (Math.abs(tx - e.x) > 300 || Math.abs(ty - e.y) > 300) { e.x = tx; e.y = ty; return; }
    const f = Math.min(1, dt * k);
    e.x += (tx - e.x) * f; e.y += (ty - e.y) * f;
  }

  // ---------- utilidades usadas pelo mundo-espelho ----------
  shake(a, x, y) {
    const d = x !== undefined ? dist(x, y, this.cam.x, this.cam.y) : 0;
    this.shakeAmt = Math.max(this.shakeAmt, a * clamp(1 - d / 1600, 0, 1));
  }
  sfx(name, x, y) {
    const d = x !== undefined ? dist(x, y, this.cam.x, this.cam.y) : 0;
    SFX.play(name, clamp(1 - d / 1500, 0, 1));
  }
  notify(msg, color) { this.ui.chatLine(msg, color); }

  // ---------- entrada ----------
  bindInput() {
    addEventListener('keydown', (e) => {
      if (this.ui.chatOpen) {
        if (e.code === 'Enter') { this.ui.submitChat(); e.preventDefault(); }
        else if (e.code === 'Escape') this.ui.closeChat();
        return;
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        if (e.code === 'Enter' && this.state === 'title') this.ui.clickOffline();
        return;
      }
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.running) this.onKey(e);
    });
    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'KeyR' && this.shapeWheel) this.closeShapeWheel(true);
    });
    addEventListener('blur', () => { this.keys = {}; this.mouse.left = false; this.mouse.right = false; });
    const cv = this.canvas;
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    cv.addEventListener('mousedown', (e) => {
      SFX.init();
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.wrench = null; this.ui.closeAll(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 0.88 : 1.13;
      if (this.running && this.player.mode === 'walk') this.zoomWalk = clamp(this.zoomWalk * f, 0.6, 6);
      else if (this.running) this.zoomFly = clamp(this.zoomFly * f, 0.3, 4);
    }, { passive: false });
  }

  onKey(e) {
    const p = this.player;
    const c = e.code;
    if (c === 'Enter') { this.ui.openChat(); e.preventDefault(); return; }
    if (c === 'Slash') { this.ui.openChat('/'); e.preventDefault(); return; }
    if (c === 'KeyH' || c === 'F1') { this.ui.toggleHelp(); e.preventDefault(); return; }
    if (c === 'Escape') {
      if (this.shapeWheel) { this.closeShapeWheel(false); return; }
      if (this.ui.closeAll()) return;
      this.send({ t: 'key', c });
      return;
    }
    if (c === 'KeyR' && p.mode === 'walk') {
      if (e.repeat || this.shapeWheel) return;
      if (this.openShapeWheel()) return;   // Bloco/Rede na mão: roda de formatos
    }
    if (c.startsWith('Digit')) {
      this.closeShapeWheel(false);
      const n = c === 'Digit0' ? 9 : parseInt(c.slice(5), 10) - 1;
      if (n >= 0 && n < 10) { p.sel = n; this.ui.renderInv(); }
      return;
    }
    if (c === 'KeyI') { this.ui.toggleEquip(); return; }
    if (c === 'KeyM') { this.ui.toggleBigMap(); return; }
    if (c === 'KeyQ' || c === 'KeyR' || (c === 'Space' && p.mode !== 'walk')) this.send({ t: 'key', c, sh: e.shiftKey });
  }

  // ---------- laço ----------
  frame(t) {
    let dt = (t - this.last) / 1000;
    this.last = t;
    dt = Math.min(dt, 0.05);
    if (this.transport) this.transport.update(dt);
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
    const w = this.world;
    if (this.shapeWheel) {
      const wh = this.shapeWheel, h = this.player && this.player.held;
      if (!h || h.item !== wh.item || this.player.mode !== 'walk') this.closeShapeWheel(false);
      else {
        wh.hover = wh.kind === 'dir' ? dirWheelPick(this.mouse.x, this.mouse.y, wh.cx, wh.cy) : wh.kind === 'side' ? sideWheelPick(this.mouse.x, this.mouse.y, wh.cx, wh.cy) : shapeWheelPick(this.mouse.x, this.mouse.y, wh.cx, wh.cy);
        if (this.mouse.leftPressed) {
          // roda de direções: o clique escolhe e mantém aberta (dá para acertar entrada e saída); formatos: escolhe e fecha
          if (wh.kind === 'dir') this.applyWheel(wh); else this.closeShapeWheel(true);
          this.mouse.leftPressed = false; this.mouse.left = false;
        }
      }
    }
    // suavização das entidades
    for (const s of w.ships) {
      this.smooth(s, dt);
      for (const c of s.carts || []) { c.x += (c.tx - c.x) * Math.min(1, dt * 15); c.y += (c.ty - c.y) * Math.min(1, dt * 15); }
      for (const it of s.items) if (it.tx !== undefined) { it.x += (it.tx - it.x) * Math.min(1, dt * 15); it.y += (it.ty - it.y) * Math.min(1, dt * 15); }
      for (const c of s.crewNet || []) { c.x += (c.tx - c.x) * Math.min(1, dt * 15); c.y += (c.ty - c.y) * Math.min(1, dt * 15); }
      for (const t of s.turrets) if (t.netAngle !== undefined && !t.predicted) t.angle += angDiff(t.angle, t.netAngle) * Math.min(1, dt * 15);
    }
    for (const b of w.bots) this.smooth(b, dt);
    for (const c of w.crates) { this.smooth(c, dt, 6); }
    for (const b of w.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    w.updateParticles(dt);

    const p = this.player, s = this.ship;
    if (this.running) {
      const typing = this.ui.typing();
      const input = {
        left: !typing && !!(this.keys.KeyA || this.keys.ArrowLeft), right: !typing && !!(this.keys.KeyD || this.keys.ArrowRight),
        up: !typing && !!(this.keys.KeyW || this.keys.ArrowUp), down: !typing && !!(this.keys.KeyS || this.keys.ArrowDown),
        jump: !typing && !!this.keys.Space, jumpPressed: !typing && !!this.pressed.Space,
        downPressed: !typing && !!(this.pressed.KeyS || this.pressed.ArrowDown),
      };
      const lx = this.mouseWorld.x - s.x, ly = this.mouseWorld.y - s.y;
      this.aimAngle = Math.atan2(ly - p.cyL, lx - p.cxL);
      if (p.mode === 'walk') {
        const wasGround = p.onGround, py0 = p.y, px0 = p.x;
        p.update(dt, input);
        // degrau pequeno de fim de rampa: o desenho acompanha suavemente
        const dyStep = p.y - py0;
        if (wasGround && p.onGround && Math.abs(dyStep) > Math.abs(p.x - px0) + 0.5 && Math.abs(dyStep) < TS * 0.5) p.visOff = (p.visOff || 0) - dyStep;
        p.visOff = (p.visOff || 0) * Math.exp(-dt * 18);
        if (Math.abs(p.visOff) < 0.05) p.visOff = 0;
        if (input.jumpPressed && wasGround) this.sfx('jump');
        if (this.mouse.leftPressed && !this.ui.mouseOverUI && !this.shapeWheel) {
          const h = p.held;
          this.send({ t: 'click', lx: r1(lx), ly: r1(ly), sh: !!(this.keys.ShiftLeft || this.keys.ShiftRight), shp: h ? this.shapeFor(h.item) : 0 });
        }
      }
      // predição visual da mira das torretas
      for (const t of s.turrets) t.predicted = false;
      const aimT = (t) => {
        const tw = s.turretWorld(t);
        t.angle = s.clampTurretAngle(t, Math.atan2(this.mouseWorld.y - tw.y, this.mouseWorld.x - tw.x));
        t.predicted = true;
      };
      if (p.mode === 'helm') for (const t of s.turrets) { if (TURRETS[t.type].rc) aimT(t); }
      if (p.mode === 'turret' && p.ctrl) aimT(p.ctrl);
      if (p.mode === 'gunner' && p.ctrl) for (const t of gunneryTurrets(s, p.ctrl)) aimT(t);
      // envia entrada
      this.inputT -= dt;
      if (this.inputT <= 0) {
        this.inputT = INPUT_RATE;
        const k = (input.left ? 1 : 0) | (input.right ? 2 : 0) | (input.up ? 4 : 0) | (input.down ? 8 : 0) | (input.jump ? 16 : 0);
        this.send({
          t: 'in', tp: p.tp, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), f: p.facing, og: p.onGround ? 1 : 0, ol: p.onLadder ? 1 : 0,
          wa: r1(p.walkAnim), jet: p.jetting ? 1 : 0, k, mx: r1(this.mouseWorld.x), my: r1(this.mouseWorld.y), lx: r1(lx), ly: r1(ly),
          ml: this.mouse.left && !this.ui.mouseOverUI && !this.shapeWheel ? 1 : 0, sel: p.sel, a: r1(this.aimAngle),
        });
      }
    }
    this.updateCamera(dt);
    this.mouse.leftPressed = false;
    this.pressed = {};
  }

  updateCamera(dt) {
    const p = this.player, s = this.ship, c = this.cam;
    let tx, ty;
    if (this.running) {
      c.targetZoom = p.mode === 'walk' ? this.zoomWalk : this.zoomFly;
      if (p.mode === 'walk') { tx = s.x + p.cxL; ty = s.y + p.cyL; }
      else {
        const mx = this.mouseWorld.x - s.cx, my = this.mouseWorld.y - s.cy;
        tx = s.cx + clamp(mx, -600, 600) * 0.25; ty = s.cy + clamp(my, -400, 400) * 0.25;
        if (p.mode === 'turret') { tx = (tx + s.x + p.cxL) / 2; ty = (ty + s.y + p.cyL) / 2; }
      }
      // segue a nave sem atraso; suaviza só o deslocamento interno
      const k = Math.min(1, dt * 10);
      c.ox = (c.ox === undefined ? tx - s.x : c.ox) + ((tx - s.x) - (c.ox === undefined ? tx - s.x : c.ox)) * k;
      c.oy = (c.oy === undefined ? ty - s.y : c.oy) + ((ty - s.y) - (c.oy === undefined ? ty - s.y : c.oy)) * k;
      c.x = s.x + c.ox; c.y = s.y + c.oy;
    } else {
      c.ox = undefined; c.oy = undefined;
      c.targetZoom = 0.5;
      tx = this.world.size / 2 + Math.cos(this.time * 0.05) * 800;
      ty = this.world.size / 2 + Math.sin(this.time * 0.04) * 600;
      const k = Math.min(1, dt * 2);
      c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    }
    c.zoom += (c.targetZoom - c.zoom) * Math.min(1, dt * 6);
  }

  // ---------- auxiliares só de leitura (dicas e pré-visualização) ----------
  inReach(lx, ly) { const p = this.player; return dist(p.cxL, p.cyL, lx, ly) <= REACH; }
  // ---------- formatos de bloco ----------
  shapeFor(item) {
    if (item === 'loader') return this.loaderDirs.din * 8 + this.loaderDirs.dout;   // vai no clique de construir
    if (item === 'gunnery') return this.gunSide;
    const d = ITEMS[item];
    return d && d.kind === 'tile' && SHAPED_TILES.has(d.tile) ? this.shapeSel[item] || 0 : 0;
  }
  openShapeWheel() {
    const h = this.player && this.player.held;
    if (h && h.item === 'loader') { this.shapeWheel = { kind: 'dir', item: h.item, cx: this.mouse.x, cy: this.mouse.y, hover: null }; return true; }
    if (h && h.item === 'gunnery') { this.shapeWheel = { kind: 'side', item: h.item, cx: this.mouse.x, cy: this.mouse.y, hover: null }; return true; }
    if (!h || ITEMS[h.item].kind !== 'tile' || !SHAPED_TILES.has(ITEMS[h.item].tile)) return false;
    this.shapeWheel = { item: h.item, cx: this.mouse.x, cy: this.mouse.y, hover: null };
    return true;
  }
  closeShapeWheel(apply) {
    const wh = this.shapeWheel;
    if (!wh) return;
    if (apply) this.applyWheel(wh);
    this.shapeWheel = null;
  }
  applyWheel(wh) {
    if (wh.hover === null) return;
    if (wh.kind === 'dir') { if (wh.hover < 8) this.loaderDirs.din = wh.hover; else this.loaderDirs.dout = wh.hover - 8; }
    else if (wh.kind === 'side') this.gunSide = wh.hover;
    else this.shapeSel[wh.item] = wh.hover;
  }

  canPlaceTile(cx, cy) {
    const s = this.ship, p = this.player;
    if (!s.isInterior(cx, cy)) return false;
    if (s.get(cx, cy) !== T.EMPTY || s.objectAt(cx, cy)) return false;
    const h = p.held;
    if (h && ITEMS[h.item].tile === T.BLOCK) {
      const [a0, a1, t0, t1, b0, b1] = SHAPES[this.shapeFor(h.item)].p;
      if (aabbOverlap(p.x, p.y, p.w, p.h, cx * TS + a0 * TS, cy * TS + Math.min(t0, t1) * TS, (a1 - a0) * TS, (Math.max(b0, b1) - Math.min(t0, t1)) * TS)) return false;
    }
    return true;
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
    for (const t of s.turrets) { const p = s.turretLocal(t); if (dist(lx, ly, p.x, p.y) < 14) return t; }
    return null;
  }
}


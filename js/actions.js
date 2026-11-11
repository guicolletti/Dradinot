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
    this.tetherPref = true;  // sair pela escotilha já com a corda presa
    this.drillT = 0;         // acumula o tempo de broca (aplica em pulsos)
  }

  send(m) { try { this._send(m); } catch (e) { /* conexão caiu */ } }
  get world() { return this.ship ? this.ship.world : null; }
  notify(m, c = '#fff') { this.send({ t: 'msg', m, c }); }
  sfxMe(n) { this.send({ t: 'sfx', n }); }
  sfx(n) { const p = this.player, w = this.world; if (w && p) w.sound(n, p.wx + p.w / 2, p.wy + p.h / 2); }
  // nave onde o personagem está agora (a própria, uma abandonada) ou null no espaço
  get here() { return this.player ? this.player.ship : null; }
  // roda fn como se a nave atual fosse s (usado dentro de naves abandonadas)
  withShip(s, fn) {
    const home = this.ship;
    if (s === home) return fn();
    this.ship = s;
    try { return fn(); } finally { this.ship = home; }
  }
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
      if (!p.ship) {
        // no espaço: coordenadas do mundo; não entra na rocha nem passa do comprimento da corda
        const w = this.world, x = +m.x || 0, y = +m.y || 0;
        const a = this.tetherAnchor();
        const okRope = !a || dist(x + p.w / 2, y + p.h / 2, a.x, a.y) <= EVA.tether + 40;
        if (w && !w.rectHitsTerrain(x, y, p.w, p.h) && okRope) { p.x = x; p.y = y; }
      } else {
        // posição vem do cliente (validada contra a grade da nave em que ele está)
        const h = p.ship;
        const x = clamp(+m.x || 0, TS, h.pw - TS - p.w), y = clamp(+m.y || 0, TS, h.ph - TS - p.h);
        if (!this.overlapsSolid(x, y)) { p.x = x; p.y = y; }
      }
      p.vx = +m.vx || 0; p.vy = +m.vy || 0;
      p.facing = m.f < 0 ? -1 : 1; p.onGround = !!m.og; p.onLadder = !!m.ol;
      p.walkAnim = +m.wa || 0; p.jetting = !!m.jet;
    }
  }

  overlapsSolid(x, y) {
    // mesma regra da física do personagem (rampas pelo centro dos pés), com 1px de folga
    const p = this.player;
    return (p.ship || this.ship).boxHits(x + 1, y + 1, p.w - 2, p.h - 2, false, 'center');
  }

  handle(m) {
    if (!this.player || !this.ship) return;
    switch (m.t) {
      case 'in': this.onInput(m); break;
      case 'click':
        if (this.player.mode !== 'walk') break;
        this.placeCode = clamp(m.shp | 0, 0, 63); this.placeShape = Math.min(this.placeCode, SHAPES.length - 1);
        if (!this.here) this.spaceClick(+m.wx || 0, +m.wy || 0);
        else this.withShip(this.here, () => this.primaryClick(+m.lx, +m.ly, !!m.sh));
        break;
      case 'key': this.onKey(m.c, !!m.sh); break;
      case 'inv': this.invMove(m); break;
      case 'throw': this.throwFrom(m); break;
      case 'equip': this.equipFromSlot(m.i | 0); break;
      case 'unequip': this.unequip(m.s); break;
      case 'fab': this.fabOp(m); break;
      case 'loader': this.loaderOp(m); break;
      case 'hatch': this.hatchOp(m); break;
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
    if (p.mode === 'gunner') {
      if (c === 'KeyR' && p.ctrl) {
        const o = p.ctrl;
        o.side = GUN_SIDES[(GUN_SIDES.indexOf(o.side) + (shift ? 3 : 1)) % 4];
        const n = gunneryTurrets(this.ship, o).length;
        this.notify(`Artilharia: lado ${GUN_SIDE_NAMES[o.side]} (${n} torreta${n === 1 ? '' : 's'})`, '#cfe');
        this.sfx('click');
      }
      return;
    }
    if (c === 'KeyT') { this.toggleTether(); return; }
    if (c === 'KeyQ') this.dropHeld(shift);
    if (c === 'KeyR') {
      const h = p.held;
      if (h && (h.item === 'embiggener' || h.item === 'shrinker')) {
        this.resizeAxis = this.resizeAxis === 'x' ? 'y' : 'x';
        this.notify(`Eixo: ${this.resizeAxis === 'x' ? 'colunas (aumenta/diminui na horizontal)' : 'linhas (aumenta/diminui na vertical)'}`, '#cfe');
      }
    }
  }

  // ---------- por quadro ----------
  tick(dt) {
    const p = this.player, s = this.ship, w = this.world;
    if (!p || !s || !w) return;
    this.evaTick(dt);
    if (!this.player || this.player !== p) return;   // morreu e renasceu neste quadro
    if (p.ship !== s) {
      // fora da própria nave (espaço ou nave abandonada): só a chave inglesa funciona aqui
      if (this.ui) { this.ui = null; this.send({ t: 'ui', op: 'close' }); }
      if (!p.ship) { this.wrench = null; return; }
      const wr = this.wrench;
      if (wr) {
        wr.age += dt;
        if (this.mouse.left || wr.age < 0.06) this.withShip(p.ship, () => this.updateWrench(dt, this.mouse.lx, this.mouse.ly));
        else {
          const pend = wr.pend;
          this.wrench = null;
          if (pend && wr.age < 0.35 && p.ship.objects.includes(pend)) this.withShip(p.ship, () => this.interact(pend));
        }
      }
      return;
    }
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
    } else if (p.mode === 'gunner') {
      if (!s.objects.includes(p.ctrl)) { this.exitControl(); return; }
      // todas as torretas comuns do lado escolhido miram no mouse e atiram juntas
      // (uma torreta que alguém está usando sozinho fica com essa pessoa)
      for (const t of gunneryTurrets(s, p.ctrl)) {
        if (t.user && t.user !== this) continue;
        const tw = s.turretWorld(t);
        const raw = Math.atan2(this.mouse.y - tw.y, this.mouse.x - tw.x);
        t.angle += clamp(angDiff(t.angle, s.clampTurretAngle(t, raw)), -10 * dt, 10 * dt);
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

  // ---------- fora da nave (EVA) ----------
  // ponto onde a corda está presa (porta de uma escotilha da própria nave), ou null
  tetherAnchor() {
    const p = this.player;
    if (!p || !p.tether || !this.ship) return null;
    const o = this.ship.objects.find((x) => x.id === p.tether.oid && x.type === 'airlock');
    return o ? this.ship.airlockDoor(o) : null;
  }

  // oxigênio, combustível, vida, corda, coleta de caixas e broca
  evaTick(dt) {
    const p = this.player, home = this.ship, w = this.world;
    // pistola laser: esfria sempre; superaquecida só volta quando esfriar tudo
    p.heat = p.heat || 0; p.laserT = Math.max(0, (p.laserT || 0) - dt);
    if (p.overheat) { p.heat = Math.max(0, p.heat - LASER.overCool * dt); if (p.heat <= 0) p.overheat = false; }
    const lh = p.held;
    if (p.mode === 'walk' && lh && lh.item === 'laser_gun' && this.mouse.left && p.ship !== home) {
      if (!p.overheat && p.laserT <= 0) {
        p.laserT = LASER.rof;
        this.fireLaser();
        p.heat = Math.min(1, p.heat + LASER.heat);
        if (p.heat >= 1) { p.overheat = true; this.sfxMe('error'); }
      }
    } else if (!p.overheat) p.heat = Math.max(0, p.heat - LASER.cool * dt);
    if (p.ship === home) {
      // em casa: recupera tudo e recolhe a corda
      p.o2 = Math.min(1, p.o2 + dt * 0.6); p.fuel = Math.min(1, p.fuel + dt * 0.4); p.hp = Math.min(EVA.hp, p.hp + dt * 6);
      p.tether = null; this.lowO2 = false;
      return;
    }
    let anchor = this.tetherAnchor();
    if (p.tether && !anchor) {
      // a escotilha da corda sumiu
      p.tether = null;
      this.notify('A escotilha onde a corda estava presa sumiu: a corda se soltou!', '#ffb070');
    } else if (anchor && dist(p.wx + p.w / 2, p.wy + p.h / 2, anchor.x, anchor.y) > EVA.tether * 1.6) {
      p.tether = null; anchor = null;
      this.notify('A corda arrebentou: a nave ficou longe demais!', '#ff8a6a');
      this.sfxMe('error');
    }
    if (anchor) {
      // preso à nave: ar e combustível vêm pela corda
      p.o2 = Math.min(1, p.o2 + dt * 0.6); p.fuel = Math.min(1, p.fuel + dt * 0.6);
    } else {
      p.o2 = Math.max(0, p.o2 - dt / EVA.o2);
      // o cliente prevê o gasto do jato; aqui conta só o que foi pedido
      if (!p.ship && (this.keys & 15) && p.mode === 'walk') p.fuel = Math.max(0, p.fuel - dt / EVA.fuel);
    }
    if (p.o2 < 0.25 && !this.lowO2) { this.lowO2 = true; this.notify('Oxigênio acabando! Volte para a nave.', '#ff8a6a'); this.sfxMe('error'); }
    if (p.o2 > 0.3) this.lowO2 = false;
    if (p.o2 <= 0) p.hp -= EVA.suffocate * dt;
    if (!p.ship) {
      // pega caixas de saque encostando nelas
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      for (const c of w.crates) {
        if (c.dead || dist(cx, cy, c.x, c.y) > c.r + 12) continue;
        let got = false;
        c.items = c.items.filter(([item, n], k) => {
          const rest = invAdd(p.inv, item, n);
          if (rest < n) got = true;
          if (rest > 0) { c.items[k][1] = rest; return true; }
          return false;
        });
        if (!c.items.length) c.dead = true;
        if (got) this.sfxMe('collect');
        else if (!this.fullT || w.time - this.fullT > 3) { this.fullT = w.time; this.notify('Inventário cheio.', '#ffb070'); }
      }
    }
    if (w.crates.some((c) => c.dead)) w.crates = w.crates.filter((c) => !c.dead);   // caixa esvaziada sai na hora
    // broca: segurando o clique (aplica em pulsos para não encher a rede de faíscas)
    const h = p.held;
    if (p.mode === 'walk' && h && h.item === 'drill' && this.mouse.left) {
      this.drillT += dt;
      if (this.drillT >= 0.15) { this.useDrill(this.drillT); this.drillT = 0; }
    } else this.drillT = 0;
    if (p.hp <= 0) this.dieOutside();
  }

  useDrill(t) {
    const p = this.player, w = this.world;
    if (!p.ship) {
      const mx = this.mouse.x, my = this.mouse.y;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const tx = Math.floor(mx / WTS), ty = Math.floor(my / WTS);
      const tt = w.getW(tx, ty);
      if (tt === W.EMPTY) return;
      // distância do personagem até a borda do bloco
      const nx = clamp(cx, tx * WTS, (tx + 1) * WTS), ny = clamp(cy, ty * WTS, (ty + 1) * WTS);
      if (dist(cx, cy, nx, ny) > EVA.drillRange) { if (!this.farT || w.time - this.farT > 2) { this.farT = w.time; this.notify('Chegue mais perto da rocha para minerar.', '#aaa'); } return; }
      if (tt === W.WALL) { w.spark(nx, ny, '#888', 2); return; }
      w.damageTerrain(tx, ty, EVA.drill * t, nx + (cx - nx) * 0.1, ny + (cy - ny) * 0.1);
      w.sound('drill', nx, ny);
    }
  }

  // pistola laser: no espaço dispara um projétil (não quebra o mapa);
  // dentro de uma nave abandonada é um raio curto que acerta os drones
  fireLaser() {
    const p = this.player, w = this.world, home = this.ship;
    if (!p.ship) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const a = Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
      w.fireBullet(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, a, 'laser', 'player', home.id);
      w.sound('laser', cx, cy);
      return;
    }
    const s = p.ship, cx = p.cxL, cy = p.cyL;
    const a = Math.atan2(this.mouse.ly - cy, this.mouse.lx - cx);
    const dx = Math.cos(a), dy = Math.sin(a);
    let ex = cx, ey = cy, hit = null;
    for (let d = 6; d <= LASER.range; d += 2) {
      const x = cx + dx * d, y = cy + dy * d;
      ex = x; ey = y;
      hit = (s.drones || []).find((q) => Math.abs(x - (q.x + 5)) < 6 && Math.abs(y - (q.y + 5)) < 6);
      if (hit || s.solidForItem(Math.floor(x / TS), Math.floor(y / TS))) break;
    }
    w.laserFx(s.x + cx + dx * 6, s.y + cy + dy * 6, s.x + ex, s.y + ey);
    w.sound('laser', s.x + cx, s.y + cy);
    if (hit) w.hitDrone(s, hit, AMMO.laser.dmg);
  }

  // morreu fora da nave: os itens ficam numa caixa no lugar e ele renasce em casa
  dieOutside() {
    const p = this.player, w = this.world, home = this.ship;
    const items = p.inv.filter(Boolean).map((st) => [st.item, st.n]);
    if (items.length) w.crates.push({ id: uid(), x: p.wx + p.w / 2, y: p.wy + p.h / 2, vx: 0, vy: 0, items, r: 11, age: 0, spin: 0.5, rot: 0 });
    p.inv = new Array(10).fill(null);
    p.ship = home; p.tether = null;
    p.hp = EVA.hp; p.o2 = 1; p.fuel = 1; p.vx = 0; p.vy = 0;
    p.respawn();
    this.wrench = null; this.lowO2 = false;
    this.notify(items.length ? 'Você morreu fora da nave. Seus itens ficaram numa caixa no lugar onde você caiu.' : 'Você morreu fora da nave.', '#ff7070');
    this.uni.shipMsg(home, `${this.name} morreu fora da nave.`, '#ff9a7a', this);
    this.sfxMe('error');
  }

  // sair pela escotilha de tripulação (da própria nave ou de uma abandonada)
  exitAirlock(o) {
    const p = this.player, s = this.ship, w = this.world;
    const door = s.airlockDoor(o);
    const x = door.side < 0 ? door.x - p.w - 2 : door.x + 2, y = door.y - p.h / 2;
    if (w.rectHitsTerrain(x, y, p.w, p.h)) { this.notify('Tem rocha encostada do lado de fora da escotilha.', '#ffb070'); this.sfxMe('error'); return; }
    p.ship = null;
    p.x = x; p.y = y; p.vx = door.side * 50 + s.vx; p.vy = s.vy; p.tp++;
    p.onGround = false; p.onLadder = false;
    this.wrench = null;
    if (s.team === 'player') {   // saindo da própria nave (de uma abandonada, a corda continua como estava)
      p.tether = this.tetherPref ? { sid: s.id, oid: o.id } : null;
      if (!this.evaHelp) {
        this.evaHelp = true;
        this.notify('No espaço: WASD usa o jato • T prende/solta a corda • clique numa escotilha para entrar • Broca de Mão minera rochas • Pistola Laser atira.', '#9fe0ff');
      }
      this.notify(p.tether ? 'Saiu com a corda presa (ar e jato à vontade).' : 'Saiu SEM corda: oxigênio e combustível acabam!', p.tether ? '#9fe0ff' : '#ffb070');
    }
    w.sound('door', door.x, door.y);
  }

  // entrar por uma escotilha vista de fora
  enterAirlock(s, o) {
    const p = this.player, home = this.ship;
    p.ship = s;
    p.x = o.x * TS + (TS - p.w) / 2; p.y = (o.y + 2) * TS - p.h - 0.1;
    p.vx = 0; p.vy = 0; p.tp++;
    if (s === home) p.tether = null;
    else if (!s.visited) {
      s.visited = true;
      this.notify(`Você entrou em "${s.name}". Sem ar aqui dentro${p.tether ? ' (a corda te mantém)' : ''}. Cuidado com os drones (a Pistola Laser resolve)!`, '#d0ffa0');
    }
    this.world.sound('door', s.x + p.cxL, s.y + p.cyL);
  }

  spaceClick(wx, wy) {
    const p = this.player, w = this.world;
    this.mouse.x = wx; this.mouse.y = wy;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // escotilha de tripulação (porta do lado de fora)
    for (const s of w.ships) {
      if (s.team !== 'player' && s.team !== 'derelict') continue;
      for (const o of s.objects) {
        if (o.type !== 'airlock') continue;
        const d = s.airlockDoor(o);
        if (Math.abs(wx - (d.x + d.side * 6)) > 14 || Math.abs(wy - d.y) > 20) continue;
        if (s.team === 'player' && s !== this.ship) { this.notify('Só dá para entrar na sua nave ou em naves abandonadas.', '#ffb070'); this.sfxMe('error'); return; }
        if (dist(cx, cy, d.x, d.y) > 46) { this.notify('Chegue mais perto da escotilha.', '#aaa'); return; }
        this.enterAirlock(s, o);
        return;
      }
    }
  }

  toggleTether() {
    const p = this.player;
    if (p.ship === this.ship) {
      this.tetherPref = !this.tetherPref;
      this.notify(this.tetherPref ? 'Corda: LIGADA ao sair (ar e jato sem limite, alcance limitado).' : 'Corda: DESLIGADA ao sair (vai longe, mas oxigênio e combustível acabam).', '#cfe');
      this.sfx('click');
      return;
    }
    if (p.tether) { p.tether = null; this.notify('Corda solta. Fique de olho no oxigênio!', '#ffb070'); this.sfx('click'); return; }
    // prende de novo na escotilha mais perto, se alcançar
    let best = null, bd = EVA.tether;
    for (const o of this.ship.objectsOf('airlock')) {
      const d = this.ship.airlockDoor(o), dd = dist(p.wx + p.w / 2, p.wy + p.h / 2, d.x, d.y);
      if (dd < bd) { bd = dd; best = o; }
    }
    if (!best) { this.notify('Longe demais da sua nave para prender a corda.', '#ffb070'); this.sfxMe('error'); return; }
    p.tether = { sid: this.ship.id, oid: best.id };
    this.notify('Corda presa.', '#9fe0ff'); this.sfx('click');
  }

  // solta um item: no espaço vira uma caixa flutuando
  spawnDrop(item, n, a, speed, vx0 = 0) {
    const p = this.player, w = this.world;
    if (!p.ship) {
      w.crates.push({ id: uid(), x: p.x + p.w / 2 + Math.cos(a) * 26, y: p.y + p.h / 2 + Math.sin(a) * 26, vx: Math.cos(a) * speed * 0.5 + p.vx, vy: Math.sin(a) * speed * 0.5 + p.vy, items: [[item, n]], r: 11, age: 0, spin: rand(-2, 2), rot: 0 });
      return;
    }
    p.ship.spawnItem(item, n, p.cxL + Math.cos(a) * 6, p.cyL - 2, Math.cos(a) * speed + vx0, Math.sin(a) * speed - 60);
  }

  // ---------- auxiliares ----------
  inReach(lx, ly) { const p = this.player; return dist(p.cxL, p.cyL, lx, ly) <= REACH + 4; }

  canPlaceTile(cx, cy, tile, shape = 0) {
    const s = this.ship;
    if (!s.isInterior(cx, cy)) return false;
    if (s.get(cx, cy) !== T.EMPTY || s.objectAt(cx, cy)) return false;
    if (tile === T.BLOCK) {
      // não deixa construir em cima de alguém (só a parte que o formato ocupa)
      const [a0, a1, t0, t1, b0, b1] = SHAPES[shape].p;
      const bx = cx * TS + a0 * TS, bw = (a1 - a0) * TS, by = cy * TS + Math.min(t0, t1) * TS, bh = (Math.max(b0, b1) - Math.min(t0, t1)) * TS;
      for (const p of s.world.occupants(s)) {
        if (aabbOverlap(p.x, p.y, p.w, p.h, bx, by, bw, bh)) return false;
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
    if (s.team === 'derelict') {
      // nave abandonada: dá para pegar itens, abrir caixas, desmontar (sucata) e sair; não dá para construir nem pilotar
      const useful = obj && (obj.type === 'expando' || obj.type === 'airlock' || obj.type === 'door');
      if (item && !(d && d.tool === 'shredder')) { /* pega abaixo */ }
      else if (d && (d.tool === 'wrench' || d.tool === 'shredder')) { /* desmonta / tritura abaixo */ }
      else if (useful) {
        if (obj.type === 'expando') { this.expandoClick(obj, ly, shift, !!h && !(d && d.tool === 'drill')); return; }
        this.interact(obj); return;
      } else if (turret || obj) { this.notify('Isso não funciona numa nave abandonada.', '#aaa'); return; }
      else if (d && (d.tool === 'drill' || d.tool === 'laser')) return;   // segurar o clique
      else if (d && (d.kind === 'tile' || d.kind === 'object' || d.kind === 'turret' || d.tool)) { this.notify('Não dá para construir ou usar isso numa nave abandonada.', '#aaa'); return; }
    }
    if (d && d.tool === 'laser' && !item && !obj && !turret) {
      if (s.team !== 'derelict') this.notify('A Pistola Laser só funciona fora da nave (espaço e naves abandonadas).', '#aaa');
      return;
    }
    if (d && d.tool === 'drill' && !item) {
      if (!obj && !turret) this.notify('A Broca de Mão funciona fora da nave, nas rochas do mapa.', '#aaa');
      if (!obj && !turret) return;
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
    // ampliador/encolhedor: agem na coluna/linha clicada, mesmo em cima de construções
    if (d && (d.tool === 'embiggener' || d.tool === 'shrinker')) { this.resizeShip(d.tool === 'embiggener' ? 1 : -1, lx, ly); return; }

    if (d && turret && d.kind === 'ammo') {
      if (TURRETS[turret.type].mining) { this.notify('A Torreta Mineradora não usa munição.', '#aaa'); return; }
      this.loadTurret(turret, h, shift); return;
    }
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
      if (obj.type === 'expando' || obj.type === 'ammo_crate') { this.expandoClick(obj, ly, shift, true); return; }
    }
    if (turret) { this.controlTurret(turret); return; }
    if (obj) { this.interact(obj); return; }
    if (d) this.useHeld(lx, ly, cx, cy);
  }

  // caixa expansível: metade de cima guarda o item da mão, metade de baixo retira.
  // Guarda um único tipo de item; Shift move só 1 unidade.
  expandoClick(o, ly, shift, canDeposit) {
    const p = this.player, h = p.held;
    const st = o.store || (o.store = { item: null, n: 0 });
    const top = ly < (o.y + OBJECTS[o.type].h / 2) * TS;
    if (top) {
      if (!h || !canDeposit) { this.notify('Segure um item para guardar na caixa.', '#aaa'); return; }
      if (o.type === 'ammo_crate' && ITEMS[h.item].kind !== 'ammo') { this.notify('A Caixa de Munição só guarda munição.', '#ffb070'); this.sfxMe('error'); return; }
      if (st.item && st.item !== h.item) {
        this.notify(`Esta caixa só guarda ${ITEMS[st.item].name}.`, '#ffb070'); this.sfxMe('error'); return;
      }
      const space = expandoCap(h.item) - st.n;
      if (space <= 0) { this.notify('A caixa está cheia.', '#ffb070'); this.sfxMe('error'); return; }
      const k = Math.min(shift ? 1 : h.n, space);
      st.item = h.item; st.n += k;
      this.consumeHeld(k);
      this.sfx('place');
    } else {
      if (!st.item || st.n <= 0) { this.notify('A caixa está vazia.', '#aaa'); return; }
      const want = Math.min(shift ? 1 : ITEMS[st.item].stack, st.n);
      const rest = invAdd(p.inv, st.item, want);
      const got = want - rest;
      if (got <= 0) { this.notify('Inventário cheio.', '#ffb070'); this.sfxMe('error'); return; }
      st.n -= got;
      if (st.n <= 0) { st.item = null; st.n = 0; }
      this.sfxMe('collect');
    }
  }

  openUI(type, o) {
    this.ui = { type, oid: o.id };
    this.send({ t: 'ui', op: type, oid: o.id });
  }

  useHeld(lx, ly, cx, cy) {
    const p = this.player, s = this.ship, h = p.held, d = ITEMS[h.item];
    if (d.kind === 'tile') {
      if (this.canPlaceTile(cx, cy, d.tile, this.placeShape || 0)) {
        s.set(cx, cy, d.tile, SHAPED_TILES.has(d.tile) ? this.placeShape || 0 : 0); s.recalc();
        this.consumeHeld(1); this.sfx('place');
      } else this.sfxMe('error');
    } else if (d.kind === 'object') {
      const od = OBJECTS[d.obj];
      const ox = cx - Math.floor((od.w - 1) / 2), oy = cy - (od.h - 1);
      // objetos sólidos (Carregador) não podem nascer em cima de alguém ou de itens
      const blocked = od.solid && (s.world.occupants(s).some((q) => aabbOverlap(q.x, q.y, q.w, q.h, ox * TS, oy * TS, od.w * TS, od.h * TS))
        || s.items.some((it) => aabbOverlap(it.x, it.y, it.w, it.h, ox * TS, oy * TS, od.w * TS, od.h * TS)));
      if (blocked) { this.notify('Tem algo no caminho.', '#ffb070'); this.sfxMe('error'); return; }
      if (s.canPlaceObject(d.obj, ox, oy)) {
        s.placeObject(d.obj, ox, oy, d.obj === 'loader' ? { din: (this.placeCode >> 3) & 7, dout: this.placeCode & 7 } : d.obj === 'gunnery' ? { side: GUN_SIDES[this.placeCode & 3] } : {});
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
      this.resizeShip(d.tool === 'embiggener' ? 1 : -1, lx, ly);
    } else if (d.kind === 'equip') {
      this.equipFromSlot(p.sel);
    }
  }

  // insere (dir = 1) ou remove (dir = -1) a coluna/linha sob o mouse, no eixo escolhido com R
  resizeShip(dir, lx, ly) {
    const s = this.ship, axis = this.resizeAxis;
    if (dir > 0) {
      // aumentar só no Porto Livre, e só se a nave tiver espaço para crescer (senão ela entra nas pedras)
      if (s.world.zoneId !== 'freeport') { this.notify('O Ampliador só funciona no Porto Livre.', '#ffb070'); this.sfxMe('error'); return; }
      if (!s.world.rectFree(s.x, s.y, s.pw + (axis === 'x' ? TS : 0), s.ph + (axis === 'y' ? TS : 0))) {
        this.notify('Sem espaço para a nave crescer aqui: afaste-se das paredes.', '#ffb070'); this.sfxMe('error'); return;
      }
    }
    const at = resizeTarget(s, axis, dir, lx, ly);
    const people = s.world.occupants(s).filter((p) => p.mode === 'walk');
    const err = s.resizeAt(axis, dir, at, people);
    if (err) { this.notify(err, '#ffb070'); this.sfxMe('error'); return; }
    for (const p of people) p.tp++;   // reposiciona os tripulantes no cliente
    this.consumeHeld(1); this.sfx('place');
    this.uni.shipMsg(s, `Nave agora tem ${s.w}x${s.h}.`, '#cfe');
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
      case 'gunnery': {
        const busy = s.crew.find((c) => c !== this && c.player && c.player.mode === 'gunner' && c.player.ctrl === o);
        if (busy) { this.notify(`${busy.name} já está nesse posto.`, '#ffb070'); return; }
        p.mode = 'gunner'; p.ctrl = o;
        p.x = (o.x + 1) * TS - p.w / 2; p.y = (o.y + 2) * TS - p.h - 0.1; p.vx = 0; p.vy = 0; p.tp++;
        this.wrench = null;
        const n = gunneryTurrets(s, o).length;
        this.notify(`Artilharia (${GUN_SIDE_NAMES[o.side]}): ${n} torreta${n === 1 ? '' : 's'}. Mouse mira, clique atira, R troca de lado, Espaço sai.`, '#cfe');
        break;
      }
      case 'door': o.open = !o.open; this.sfx('click'); break;
      case 'airlock': this.exitAirlock(o); break;
      case 'hatch': this.openUI('hatch', o); break;
      case 'ammo_crate':
      case 'expando': this.expandoClick(o, this.mouse.ly, false, false); break;
      case 'loader': this.openUI('loader', o); break;
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
    this.spawnDrop(h.item, n, a, 320, p.vx);
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
    else if (obj && !(obj.type === 'airlock' && s.team === 'derelict')) { key = 'o' + obj.id; need = 1.0; }
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
      if (obj.carry) s.spawnItem(obj.carry.item, obj.carry.n, lx, ly, rand(-40, 40), -100);
      if (obj.cart && obj.cart.n > 0) s.spawnItem(obj.cart.item, obj.cart.n, lx, ly, rand(-40, 40), -100);
      if (obj.store && obj.store.item) {
        // caixa desmontada: devolve o conteúdo em pilhas
        let left = obj.store.n;
        while (left > 0) { const k = Math.min(left, ITEMS[obj.store.item].stack); s.spawnItem(obj.store.item, k, lx, ly, rand(-60, 60), -120); left -= k; }
      }
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
    this.spawnDrop(s.item, n, a, 300);
    s.n -= n;
    if (s.n <= 0) { src[i] = null; if (m.c === 'inv') this.refillSlot(i, s.item); }
  }

  // ---------- fabricadores ----------
  // painel do Carregador: direções, filtro de itens e "só em máquinas"
  loaderOp(m) {
    if (!this.ui || this.ui.type !== 'loader') return;
    const o = this.ship.objects.find((x) => x.id === this.ui.oid);
    if (!o || o.type !== 'loader') return;
    if (m.op === 'dir') {
      const v = clamp(m.d | 0, 0, 7);
      if (m.which === 'in') o.din = v; else o.dout = v;
    } else if (m.op === 'only') o.only = !!m.v;
    else if (m.op === 'filter' && ITEMS[m.item]) {
      const f = new Set(o.filter);
      if (m.on) f.add(m.item); else f.delete(m.item);
      o.filter = [...f];
    } else if (m.op === 'clearf') o.filter = [];
  }

  // painel da escotilha: aberta/fechada, modo e lista do filtro
  hatchOp(m) {
    if (!this.ui || this.ui.type !== 'hatch') return;
    const o = this.ship.objects.find((x) => x.id === this.ui.oid);
    if (!o || o.type !== 'hatch') return;
    if (m.op === 'open') { o.open = !!m.v; this.sfx('click'); }
    else if (m.op === 'fmode') o.fmode = m.v === 'allow' ? 'allow' : 'block';
    else if (m.op === 'filter' && ITEMS[m.item]) {
      const f = new Set(o.filter);
      if (m.on) f.add(m.item); else f.delete(m.item);
      o.filter = [...f];
    } else if (m.op === 'clearf') o.filter = [];
  }

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

// ============================================================
//  Interface (DOM): HUD, inventário com arrastar/soltar,
//  fabricadores, caixa expansível, equipamento, chat, ajuda.
// ============================================================
'use strict';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

class UI {
  constructor(game) {
    this.g = game;
    this.chatOpen = false;
    this.titleOpen = true;
    this.fabObj = null;
    this.storageObj = null;
    this.drag = null;
    this.mouseOverUI = false;
    this.lines = [];
    this.buildHotbar();
    this.buildTitle();
    this.bindDrag();
    $('#chat-input').addEventListener('blur', () => { if (this.chatOpen) this.closeChat(); });
    $('#help-close').onclick = () => this.toggleHelp(false);
    $('#death-btn').onclick = () => { $('#death').classList.add('hidden'); this.g.start(false, this.g.lastName); };
    $('#btn-help').onclick = () => this.toggleHelp();
    $('#btn-equip').onclick = () => this.toggleEquip();
    $('#btn-sound').onclick = () => { SFX.enabled = !SFX.enabled; $('#btn-sound').textContent = SFX.enabled ? '🔊' : '🔇'; };
    document.querySelectorAll('.panel .close').forEach((b) => { b.onclick = () => this.closeAll(); });
    $('#minimap').addEventListener('click', () => this.toggleBigMap());
  }

  // ---------- título ----------
  buildTitle() {
    const name = (() => { try { return localStorage.getItem('couracado_name') || ''; } catch (e) { return ''; } })();
    $('#name-input').value = name;
    $('#btn-play').onclick = () => this.clickPlay();
    const cont = $('#btn-continue');
    if (this.g.hasSave()) { cont.classList.remove('hidden'); cont.onclick = () => this.clickPlay(true); }
  }
  clickPlay(fromSave = false) {
    const name = ($('#name-input').value || '').trim().slice(0, 16) || 'Tripulante';
    try { localStorage.setItem('couracado_name', name); } catch (e) { /* ignore */ }
    this.g.lastName = name;
    if (!fromSave && this.g.hasSave() && !confirm('Começar uma nova nave apaga o jogo salvo. Continuar?')) return;
    this.g.start(fromSave, name);
  }
  onStart() {
    this.titleOpen = false;
    $('#title').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    this.renderInv(); this.renderEquip();
    this.zoneBanner(this.g.world.zone);
  }

  // ---------- inventário ----------
  buildHotbar() {
    const hb = $('#hotbar');
    hb.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'slot');
      s.dataset.cont = 'inv'; s.dataset.idx = i;
      s.appendChild(el('span', 'key', String((i + 1) % 10)));
      s.addEventListener('click', () => { if (this.g.player) { this.g.player.sel = i; this.g.wrench = null; this.renderInv(); } });
      s.addEventListener('dblclick', () => { if (this.g.player) this.g.equipFromSlot(i); });
      hb.appendChild(s);
    }
    const st = $('#storage-grid');
    st.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const s = el('div', 'slot');
      s.dataset.cont = 'store'; s.dataset.idx = i;
      st.appendChild(s);
    }
    document.querySelectorAll('#equip-slots .slot').forEach((s) => {
      s.addEventListener('click', () => { if (this.g.player) this.g.unequip(s.dataset.idx); });
    });
  }

  fillSlot(div, st) {
    let img = div.querySelector('img'), cnt = div.querySelector('.cnt');
    if (!st) { if (img) img.remove(); if (cnt) cnt.remove(); div.dataset.item = ''; return; }
    if (!img) { img = el('img'); img.draggable = false; div.appendChild(img); }
    if (div.dataset.item !== st.item) { img.src = iconURL(st.item); div.dataset.item = st.item; }
    if (st.n > 1) { if (!cnt) { cnt = el('span', 'cnt'); div.appendChild(cnt); } cnt.textContent = st.n; }
    else if (cnt) cnt.remove();
  }

  renderInv() {
    const p = this.g.player;
    if (!p) return;
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((s, i) => { this.fillSlot(s, p.inv[i]); s.classList.toggle('sel', i === p.sel); });
    const h = p.held;
    $('#held-name').textContent = h ? ITEMS[h.item].name + (h.n > 1 ? ` ×${h.n}` : '') : '';
    $('#held-name').style.color = h && RARE_ITEMS.has(h.item) ? '#7dff9a' : '#fff';
    if (this.storageObj) this.renderStorage();
  }

  renderEquip() {
    const p = this.g.player;
    if (!p) return;
    document.querySelectorAll('#equip-slots .slot').forEach((s) => {
      const id = p.equip[s.dataset.idx];
      this.fillSlot(s, id ? { item: id, n: 1 } : null);
    });
  }

  // container helpers para arrastar/soltar
  getCont(cont) {
    const p = this.g.player;
    if (cont === 'inv') return p.inv;
    if (cont === 'store') return this.storageObj ? this.storageObj.inv : null;
    return null;
  }

  bindDrag() {
    addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const slot = e.target.closest && e.target.closest('.slot[data-cont]');
      if (!slot || !this.g.player) return;
      const arr = this.getCont(slot.dataset.cont);
      if (!arr) return;
      const i = +slot.dataset.idx;
      const st = arr[i];
      if (!st) return;
      let n = st.n;
      if (e.shiftKey && st.n > 1) n = Math.ceil(st.n / 2);
      this.drag = { cont: slot.dataset.cont, idx: i, item: st.item, n, x0: e.clientX, y0: e.clientY, moved: false };
      const gh = $('#drag-ghost');
      gh.innerHTML = `<img src="${iconURL(st.item)}">${n > 1 ? `<span class="cnt">${n}</span>` : ''}`;
      e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) > 4) {
        this.drag.moved = true; $('#drag-ghost').classList.remove('hidden');
      }
      const gh = $('#drag-ghost');
      gh.style.left = e.clientX - 22 + 'px'; gh.style.top = e.clientY - 22 + 'px';
    });
    addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      $('#drag-ghost').classList.add('hidden');
      if (!d.moved) return;
      const src = this.getCont(d.cont);
      if (!src || !src[d.idx]) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const slot = target && target.closest && target.closest('.slot[data-cont]');
      const eqSlot = target && target.closest && target.closest('#equip-slots .slot');
      if (eqSlot) {
        // arrastar para equipamento
        if (d.cont === 'inv' && ITEMS[d.item].kind === 'equip' && ITEMS[d.item].slot === eqSlot.dataset.idx) this.g.equipFromSlot(d.idx);
        return;
      }
      if (slot) {
        const dst = this.getCont(slot.dataset.cont);
        const j = +slot.dataset.idx;
        if (!dst || (dst === src && j === d.idx)) return;
        const s = src[d.idx], t = dst[j];
        if (!t) {
          dst[j] = { item: s.item, n: d.n };
          s.n -= d.n; if (s.n <= 0) src[d.idx] = null;
        } else if (t.item === s.item) {
          const k = Math.min(ITEMS[t.item].stack - t.n, d.n);
          t.n += k; s.n -= k; if (s.n <= 0) src[d.idx] = null;
        } else if (d.n === s.n) {
          dst[j] = s; src[d.idx] = t;
        }
        this.renderInv();
        return;
      }
      // soltou sobre o jogo: arremessa o item
      if (target === this.g.canvas && this.g.ship && this.g.player) {
        const s = src[d.idx];
        const p = this.g.player, a = this.g.aimAngle || 0;
        this.g.ship.spawnItem(s.item, d.n, p.cxL, p.cyL - 2, Math.cos(a) * 300, Math.sin(a) * 300 - 60);
        s.n -= d.n; if (s.n <= 0) src[d.idx] = null;
        this.renderInv();
      }
    });
    // dicas
    addEventListener('mouseover', (e) => {
      const slot = e.target.closest && e.target.closest('.slot');
      const tip = $('#tooltip');
      if (!slot || !this.g.player) { tip.classList.add('hidden'); return; }
      let st = null;
      if (slot.dataset.cont) { const arr = this.getCont(slot.dataset.cont); st = arr && arr[+slot.dataset.idx]; }
      else if (slot.closest('#equip-slots')) { const id = this.g.player.equip[slot.dataset.idx]; st = id ? { item: id, n: 1 } : null; }
      if (!st) { tip.classList.add('hidden'); return; }
      const d = ITEMS[st.item];
      tip.innerHTML = `<b style="color:${RARE_ITEMS.has(st.item) ? '#7dff9a' : '#fff'}">${d.name}</b>${st.n > 1 ? ` ×${st.n}` : ''}<br><small>${d.desc || ''}</small>`;
      const r = slot.getBoundingClientRect();
      tip.style.left = r.left + 'px'; tip.style.top = r.top - 8 + 'px';
      tip.classList.remove('hidden');
    });
  }

  // ---------- painéis ----------
  blocking() { return this.chatOpen; }
  typing() { return this.chatOpen; }

  closeAll() {
    let any = false;
    for (const id of ['#panel-fab', '#panel-storage', '#panel-equip', '#help']) {
      const e = $(id);
      if (!e.classList.contains('hidden')) { e.classList.add('hidden'); any = true; }
    }
    $('#minimap').classList.remove('big');
    this.fabObj = null; this.storageObj = null;
    return any;
  }

  toggleHelp(force) {
    const h = $('#help');
    const show = force !== undefined ? force : h.classList.contains('hidden');
    h.classList.toggle('hidden', !show);
  }
  toggleEquip() { $('#panel-equip').classList.toggle('hidden'); this.renderEquip(); }
  toggleBigMap() { $('#minimap').classList.toggle('big'); }

  openFab(o) {
    this.closeAll();
    this.fabObj = o;
    const od = OBJECTS[o.type];
    $('#fab-title').textContent = od.name;
    const list = $('#fab-recipes');
    list.innerHTML = '';
    RECIPES[od.fab].forEach((r, i) => {
      const b = el('div', 'recipe');
      const cost = Object.entries(r.cost).map(([m, n]) => `<span class="cost"><img src="${iconURL(m)}">${n}</span>`).join('') || '<span class="cost">grátis</span>';
      b.innerHTML = `<img class="ri" src="${iconURL(r.out)}"><div class="rn">${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''}<div class="rc">${cost}<span class="rt">${r.t}s</span></div></div>`;
      b.title = 'Clique: +1  |  Shift: +5  |  Ctrl ou botão direito: repetir';
      b.onclick = (e) => this.queueRecipe(i, e.ctrlKey ? Infinity : e.shiftKey ? 5 : 1);
      b.oncontextmenu = (e) => { e.preventDefault(); this.queueRecipe(i, Infinity); };
      list.appendChild(b);
    });
    $('#fab-eject').onclick = () => {
      const s = this.g.ship;
      for (const m of FAB_MATS) if (o.mats[m] > 0) { s.spawnItem(m, o.mats[m], (o.x + 1) * TS, o.y * TS, rand(-40, 40), -120); o.mats[m] = 0; }
      this.refreshFab();
    };
    $('#fab-clear').onclick = () => { this.clearQueue(o); this.refreshFab(); };
    $('#panel-fab').classList.remove('hidden');
    this.refreshFab();
  }

  queueRecipe(i, n) {
    const o = this.fabObj;
    if (!o) return;
    const last = o.queue[o.queue.length - 1];
    if (n === Infinity) { o.queue.push({ r: i, left: Infinity }); }
    else if (last && last.r === i && last.left !== Infinity) last.left += n;
    else o.queue.push({ r: i, left: n });
    if (o.queue.length > 8) o.queue.pop();
    SFX.play('click', 1);
    this.refreshFab();
  }

  clearQueue(o) {
    if (o.started && o.queue.length) {
      const r = RECIPES[OBJECTS[o.type].fab][o.queue[0].r];
      for (const m in r.cost) o.mats[m] = Math.min(FAB_CAP, o.mats[m] + r.cost[m]);
    }
    o.queue = []; o.started = false; o.progress = 0;
  }

  refreshFab() {
    const o = this.fabObj;
    if (!o) return;
    const mats = $('#fab-mats');
    mats.innerHTML = FAB_MATS.map((m) => `<div class="mat"><img src="${iconURL(m)}"><div class="bar"><i style="width:${(o.mats[m] / FAB_CAP) * 100}%;background:${ITEMS[m].color}"></i></div><span>${o.mats[m]}/${FAB_CAP}</span></div>`).join('');
    const list = RECIPES[OBJECTS[o.type].fab];
    const q = $('#fab-queue');
    q.innerHTML = o.queue.length ? '' : '<small>Fila vazia. Clique numa receita. Carregue materiais clicando no fabricador com eles na mão.</small>';
    o.queue.forEach((e, k) => {
      const r = list[e.r];
      const d = el('div', 'qitem');
      const prog = k === 0 && o.started ? (o.progress / r.t) * 100 : 0;
      d.innerHTML = `<img src="${iconURL(r.out)}"><span>${e.left === Infinity ? '∞' : '×' + e.left}</span><div class="bar"><i style="width:${prog}%"></i></div>`;
      if (k === 0 && o.stalled) d.classList.add('stalled');
      d.title = 'Clique para remover';
      d.onclick = () => {
        if (k === 0 && o.started) {
          const rr = list[o.queue[0].r];
          for (const m in rr.cost) o.mats[m] = Math.min(FAB_CAP, o.mats[m] + rr.cost[m]);
          o.started = false; o.progress = 0;
        }
        o.queue.splice(k, 1); this.refreshFab();
      };
      q.appendChild(d);
    });
    // disponibilidade
    document.querySelectorAll('#fab-recipes .recipe').forEach((b, i) => {
      const r = list[i];
      const ok = Object.entries(r.cost).every(([m, n]) => o.mats[m] >= n);
      b.classList.toggle('lack', !ok);
    });
  }

  openStorage(o) {
    this.closeAll();
    this.storageObj = o;
    $('#panel-storage').classList.remove('hidden');
    this.renderStorage();
  }
  renderStorage() {
    const o = this.storageObj;
    if (!o) return;
    document.querySelectorAll('#storage-grid .slot').forEach((s, i) => this.fillSlot(s, o.inv[i]));
  }

  // ---------- chat ----------
  openChat(prefix = '') {
    this.chatOpen = true;
    const i = $('#chat-input');
    i.classList.remove('hidden'); i.value = prefix; i.focus();
    $('#chat').classList.add('open');
  }
  closeChat() {
    this.chatOpen = false;
    const i = $('#chat-input');
    i.classList.add('hidden'); i.blur();
    $('#chat').classList.remove('open');
  }
  submitChat() {
    const v = $('#chat-input').value.trim();
    this.closeChat();
    if (!v) return;
    if (v.startsWith('/')) this.g.command(v);
    else this.chatLine(`<b>${this.esc(this.g.player ? this.g.player.name : 'Você')}:</b> ${this.esc(v)}`, '#fff', true);
  }
  esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  chatLine(msg, color = '#fff', html = false) {
    const log = $('#chat-log');
    const d = el('div', 'line');
    if (html) d.innerHTML = msg; else d.textContent = msg;
    d.style.color = color;
    d._t = performance.now();
    log.appendChild(d);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  zoneBanner(z) {
    const b = $('#zone-banner');
    b.innerHTML = `<div class="zn">${z.name}</div><div class="zd">${z.desc}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  showDeath() {
    const s = this.g.stats;
    $('#death-stats').innerHTML = `Bots destruídos: <b>${s.bots}</b><br>Naves piratas destruídas: <b>${s.ships}</b><br>Zonas visitadas: <b>${s.zones.size}</b><br>Tempo de jogo: <b>${Math.floor(s.time / 60)} min</b>`;
    $('#death').classList.remove('hidden');
    this.closeAll();
  }

  // ---------- atualização por quadro ----------
  update() {
    const g = this.g;
    const under = document.elementFromPoint(g.mouse.x, g.mouse.y);
    this.mouseOverUI = !!under && under !== g.canvas;
    // linhas do chat somem
    const now = performance.now();
    for (const d of $('#chat-log').children) d.classList.toggle('faded', !this.chatOpen && now - d._t > 12000);
    if (!g.running || !g.player || !g.ship) return;
    const s = g.ship, p = g.player, w = g.world;
    // HUD
    $('#hud-zone').innerHTML = `<b>${w.zone.name}</b> <small>${w.zone.safe ? '• zona segura' : w.zone.pvp ? '• combate JxJ' : '• PvE'}</small>`;
    $('#bar-shield').style.width = (s.shield / s.maxShield) * 100 + '%';
    $('#bar-hull').style.width = clamp(s.integrity / s.maxIntegrity, 0, 1) * 100 + '%';
    $('#txt-shield').textContent = `Escudo ${Math.ceil(s.shield)}/${s.maxShield}`;
    $('#txt-hull').textContent = `Casco ${Math.max(0, Math.ceil(s.integrity))}/${s.maxIntegrity}`;
    const cq = s.cargoQueue.reduce((a, [, n]) => a + n, 0);
    $('#hud-info').innerHTML = `${s.w}×${s.h} tiles • ${Math.round(Math.hypot(s.vx, s.vy))} u/s${cq ? ` • carga na fila: ${cq}` : ''}`;
    // dica de contexto
    $('#hint').innerHTML = this.contextHint();
    // fecha painéis distantes
    const far = (o) => { const od = OBJECTS[o.type]; return dist(p.cxL, p.cyL, (o.x + od.w / 2) * TS, (o.y + od.h / 2) * TS) > REACH + TS * 2; };
    if (this.fabObj) { if (far(this.fabObj) || !s.objects.includes(this.fabObj)) this.closeAll(); else if (Math.floor(g.time * 10) % 3 === 0) this.refreshFab(); }
    if (this.storageObj && (far(this.storageObj) || !s.objects.includes(this.storageObj))) this.closeAll();
  }

  contextHint() {
    const g = this.g, p = g.player, s = g.ship;
    if (p.mode === 'helm') {
      const rc = s.turrets.filter((t) => TURRETS[t.type].rc);
      const ammo = rc.map((t) => t.ammo).join(' / ');
      let txt = `<b>Pilotando</b> — WASD: mover • Clique: torretas RC${rc.length ? ` (munição ${ammo})` : ' (nenhuma)'} • Espaço/Esc: sair`;
      for (const pt of g.world.portals) {
        const nx = clamp(pt.x, s.x, s.x + s.pw), ny = clamp(pt.y, s.y, s.y + s.ph);
        if (dist(nx, ny, pt.x, pt.y) < pt.r) txt = `<span class="hl">Aperte Q para ir para ${ZONES[pt.target].name}</span> • ` + txt;
      }
      return txt;
    }
    if (p.mode === 'turret') {
      const t = p.ctrl;
      return `<b>${TURRETS[t.type].name}</b> — munição ${t.ammo}/${TURRETS[t.type].cap}${t.ammoType ? ' (' + AMMO[t.ammoType].name + ')' : ''} • Clique: atirar • Q: descarregar • Espaço/Esc: sair`;
    }
    const lx = g.mouseWorld.x - s.x, ly = g.mouseWorld.y - s.y;
    const cx = Math.floor(lx / TS), cy = Math.floor(ly / TS);
    const t = s.turretAtHull(cx, cy) || g.turretNear(lx, ly);
    const o = s.objectAt(cx, cy);
    const it = g.itemUnder(lx, ly);
    const h = p.held;
    const hd = h ? ITEMS[h.item] : null;
    if (it) return `${ITEMS[it.item].name}${it.n > 1 ? ' ×' + it.n : ''} — clique para pegar`;
    if (t) return `${TURRETS[t.type].name} (${t.ammo}/${TURRETS[t.type].cap}${t.ammoType ? ' ' + AMMO[t.ammoType].name : ''}) — ${hd && hd.kind === 'ammo' ? 'clique para carregar (Shift: tudo)' : TURRETS[t.type].rc ? 'disparada pelo leme' : 'clique para controlar'}`;
    if (o) {
      const od = OBJECTS[o.type];
      let a = 'clique para usar';
      if (o.type === 'helm') a = 'clique para pilotar';
      else if (od.fab) a = hd && FAB_MATS.includes(h.item) ? 'clique para carregar material' : 'clique para abrir';
      else if (o.type === 'recycler') a = h ? 'clique para reciclar o item na mão' : 'segure um item e clique';
      else if (o.type === 'ejector') a = h ? 'clique para ejetar o item na mão' : 'segure um item e clique';
      else if (o.type === 'door') a = o.open ? 'clique para fechar' : 'clique para abrir';
      else if (o.type === 'hatch') a = `modo: ${o.mode === 'all' ? 'liberada' : 'bloqueada'} — clique para alternar`;
      else if (o.type === 'shield_gen') a = `carga ${Math.round(o.fuel || 0)} — use Reforço/Fluxo`;
      if (hd && hd.tool === 'wrench') a = 'segure para desmontar';
      return `${od.name} — ${a}`;
    }
    if (hd) {
      if (hd.kind === 'tile' || hd.kind === 'object') return `${hd.name} — clique para construir • Q: soltar`;
      if (hd.kind === 'turret') return `${hd.name} — clique no casco externo para instalar`;
      if (hd.tool === 'wrench') return 'Chave inglesa — segure o clique sobre blocos/objetos para desmontar';
      if (hd.tool === 'booster') return 'Reforço de Escudo — clique para recarregar +80 de escudo';
      if (hd.tool === 'repair') return 'Kit de Reparo — clique para restaurar +60 do casco';
      if (hd.tool === 'embiggener' || hd.tool === 'shrinker') return `${hd.name} — clique para ${hd.tool === 'embiggener' ? 'aumentar' : 'diminuir'} (${g.resizeAxis === 'x' ? 'horizontal' : 'vertical'}) • R: trocar eixo`;
      if (hd.kind === 'equip') return `${hd.name} — clique (ou duplo clique no slot) para equipar`;
      if (hd.kind === 'ammo') return `${hd.name} — clique numa torreta para carregar`;
      if (hd.kind === 'resource') return `${hd.name} — clique num fabricador para carregar`;
    }
    return '';
  }
}

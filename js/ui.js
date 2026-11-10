// ============================================================
//  Interface (DOM): título, menu de naves, HUD, inventário com
//  arrastar/soltar, fabricadores, caixa, equipamento, chat.
//  Toda alteração de estado é enviada ao servidor.
// ============================================================
'use strict';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const lsGet = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

class UI {
  constructor(game) {
    this.g = game;
    this.chatOpen = false;
    this.fabOid = null;
    this.storeOid = null;
    this.drag = null;
    this.mouseOverUI = false;
    this.buildHotbar();
    this.buildTitle();
    this.bindDrag();
    $('#chat-input').addEventListener('blur', () => { if (this.chatOpen) this.closeChat(); });
    $('#help-close').onclick = () => this.toggleHelp(false);
    $('#death-btn').onclick = () => { $('#death').classList.add('hidden'); this.g.send({ t: 'menu' }); };
    $('#btn-help').onclick = () => this.toggleHelp();
    $('#btn-copy').onclick = () => this.copyCode();
    $('#btn-equip').onclick = () => this.toggleEquip();
    $('#btn-leave').onclick = () => { if (confirm('Sair da nave e voltar ao menu de naves?')) this.g.send({ t: 'leave' }); };
    $('#btn-sound').onclick = () => { SFX.enabled = !SFX.enabled; $('#btn-sound').textContent = SFX.enabled ? '🔊' : '🔇'; };
    document.querySelectorAll('.panel .close').forEach((b) => { b.onclick = () => this.closeAll(); });
    $('#minimap').addEventListener('click', () => this.toggleBigMap());
  }

  copyCode() {
    const code = this.g.key, b = $('#btn-copy');
    if (!code) return;
    b.blur();
    const done = () => {
      this.chatLine(`Código ${code} copiado! Envie para quem vai entrar na nave.`, '#ffd84a');
      b.textContent = '✔ Copiado!';
      setTimeout(() => { b.textContent = '📋 Copiar código'; }, 1600);
    };
    const fallback = () => {
      const ta = el('textarea'); ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else this.chatLine(`Não deu para copiar automaticamente. Código: ${code}`, '#ffb070');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(done, fallback);
    else fallback();
  }

  // ---------- título ----------
  buildTitle() {
    $('#name-input').value = lsGet('couracado_name');
    let addr = lsGet('couracado_server');
    if (!addr && /^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) addr = location.host;
    $('#server-input').value = addr;
    $('#btn-offline').onclick = () => this.clickOffline();
    $('#btn-online').onclick = () => this.clickOnline();
    $('#menu-create').onclick = () => this.g.send({ t: 'create' });
    $('#menu-join').onclick = () => { const k = $('#code-input').value.trim(); if (k) this.g.send({ t: 'join', key: k }); };
    $('#menu-back').onclick = () => this.g.disconnect();
    $('#menu-refresh').onclick = () => this.g.send({ t: 'menu' });
  }
  playerName() { return ($('#name-input').value || '').trim().slice(0, 16) || 'Tripulante'; }
  saveName() { lsSet('couracado_name', this.playerName()); }
  clickOffline() { this.saveName(); this.g.connect('offline'); }
  clickOnline() {
    this.saveName();
    const a = $('#server-input').value.trim();
    lsSet('couracado_server', a);
    this.g.connect('online', a);
  }
  titleStatus(m) { const e = $('#title-msg'); e.textContent = m; e.style.color = '#9fb0c2'; }
  titleError(m) { const e = $('#title-msg'); e.textContent = m; e.style.color = '#ff8a7a'; }
  menuError(m) { const e = $('#menu-msg'); e.textContent = m; e.style.color = '#ff8a7a'; if (this.g.state === 'play') this.chatLine(m, '#ff8a7a'); }

  showTitle() {
    $('#title').classList.remove('hidden');
    $('#shipmenu').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#death').classList.add('hidden');
    this.titleStatus('');
  }

  showMenu(m, kind) {
    $('#title').classList.add('hidden');
    $('#hud').classList.add('hidden');
    $('#death').classList.add('hidden');
    $('#shipmenu').classList.remove('hidden');
    $('#menu-msg').textContent = '';
    $('#menu-mode').innerHTML = kind === 'offline'
      ? 'Modo <b>offline</b> (só você)'
      : `Conectado ao servidor • <b>${m.online}</b> jogador(es) online`;
    const list = $('#menu-list');
    list.innerHTML = '';
    if (!m.ships.length) list.innerHTML = '<div class="muted empty">Nenhuma nave ainda. Crie a sua!</div>';
    for (const s of m.ships) {
      const row = el('div', 'shiprow');
      row.innerHTML = `<div><b>${this.esc(s.name)}</b> ${s.mine ? '<span class="tag cap">sua</span>' : ''}${s.public ? '<span class="tag pub">pública</span>' : ''}
        <div class="muted">${this.esc(s.zone)} • ${s.crew} tripulante(s)${s.size ? ' • ' + s.size : ''} • código ${s.key}</div></div>`;
      const b = el('button', '', 'Entrar');
      b.onclick = () => this.g.send({ t: 'join', key: s.key });
      row.appendChild(b);
      list.appendChild(row);
    }
  }

  onStart() {
    $('#title').classList.add('hidden');
    $('#shipmenu').classList.add('hidden');
    $('#death').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#chat-log').innerHTML = '';
    this.renderInv(); this.renderEquip();
  }

  // ---------- inventário ----------
  buildHotbar() {
    const hb = $('#hotbar');
    hb.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'slot');
      s.dataset.cont = 'inv'; s.dataset.idx = i;
      s.appendChild(el('span', 'key', String((i + 1) % 10)));
      s.addEventListener('click', () => { if (this.g.player) { this.g.player.sel = i; this.renderInv(); } });
      s.addEventListener('dblclick', () => { if (this.g.player) this.g.send({ t: 'equip', i }); });
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
      s.addEventListener('click', () => { if (this.g.player) this.g.send({ t: 'unequip', s: s.dataset.idx }); });
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
    document.querySelectorAll('#hotbar .slot').forEach((s, i) => { this.fillSlot(s, p.inv[i]); s.classList.toggle('sel', i === p.sel); });
    const h = p.held;
    $('#held-name').textContent = h ? ITEMS[h.item].name + (h.n > 1 ? ` ×${h.n}` : '') : '';
    $('#held-name').style.color = h && RARE_ITEMS.has(h.item) ? '#7dff9a' : '#fff';
    if (this.storeOid) this.renderStorage();
  }

  renderEquip() {
    const p = this.g.player;
    if (!p) return;
    document.querySelectorAll('#equip-slots .slot').forEach((s) => {
      const id = p.equip[s.dataset.idx];
      this.fillSlot(s, id ? { item: id, n: 1 } : null);
    });
  }

  objById(oid) { const s = this.g.ship; return s ? s.objects.find((o) => o.id === oid) || null : null; }

  getCont(cont) {
    const p = this.g.player;
    if (!p) return null;
    if (cont === 'inv') return p.inv;
    if (cont === 'store') { const o = this.objById(this.storeOid); return o ? o.inv : null; }
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
      $('#drag-ghost').innerHTML = `<img src="${iconURL(st.item)}">${n > 1 ? `<span class="cnt">${n}</span>` : ''}`;
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
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const slot = target && target.closest && target.closest('.slot[data-cont]');
      const eqSlot = target && target.closest && target.closest('#equip-slots .slot');
      if (eqSlot) {
        if (d.cont === 'inv' && ITEMS[d.item].kind === 'equip' && ITEMS[d.item].slot === eqSlot.dataset.idx) this.g.send({ t: 'equip', i: d.idx });
        return;
      }
      if (slot) {
        const j = +slot.dataset.idx;
        if (slot.dataset.cont === d.cont && j === d.idx) return;
        this.g.send({ t: 'inv', fc: d.cont, fi: d.idx, tc: slot.dataset.cont, ti: j, n: d.n });
        return;
      }
      if (target === this.g.canvas && this.g.running) {
        this.g.send({ t: 'throw', c: d.cont, i: d.idx, n: d.n, a: r1(this.g.aimAngle || 0) });
      }
    });
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

  closeAll(silent = false) {
    let any = false;
    for (const id of ['#panel-fab', '#panel-storage', '#panel-equip', '#help']) {
      const e = $(id);
      if (!e.classList.contains('hidden')) { e.classList.add('hidden'); any = true; }
    }
    $('#minimap').classList.remove('big');
    if ((this.fabOid || this.storeOid) && !silent) this.g.send({ t: 'closeui' });
    this.fabOid = null; this.storeOid = null;
    return any;
  }

  toggleHelp(force) {
    const h = $('#help');
    const show = force !== undefined ? force : h.classList.contains('hidden');
    h.classList.toggle('hidden', !show);
  }
  toggleEquip() { $('#panel-equip').classList.toggle('hidden'); this.renderEquip(); }
  toggleBigMap() { $('#minimap').classList.toggle('big'); }

  openFab(oid) {
    const o = this.objById(oid);
    if (!o) return;
    this.closeAll(true);
    this.fabOid = oid;
    const od = OBJECTS[o.type];
    $('#fab-title').textContent = od.name;
    const list = $('#fab-recipes');
    list.innerHTML = '';
    RECIPES[od.fab].forEach((r, i) => {
      const b = el('div', 'recipe');
      const cost = Object.entries(r.cost).map(([m, n]) => `<span class="cost"><img src="${iconURL(m)}">${n}</span>`).join('') || '<span class="cost">grátis</span>';
      b.innerHTML = `<img class="ri" src="${iconURL(r.out)}"><div class="rn">${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''}<div class="rc">${cost}<span class="rt">${r.t}s</span></div></div>`;
      b.title = 'Clique: +1  |  Shift: +5  |  Ctrl ou botão direito: repetir';
      b.onclick = (e) => this.g.send({ t: 'fab', op: 'queue', r: i, n: e.ctrlKey ? -1 : e.shiftKey ? 5 : 1 });
      b.oncontextmenu = (e) => { e.preventDefault(); this.g.send({ t: 'fab', op: 'queue', r: i, n: -1 }); };
      list.appendChild(b);
    });
    $('#fab-eject').onclick = () => this.g.send({ t: 'fab', op: 'eject' });
    $('#fab-clear').onclick = () => this.g.send({ t: 'fab', op: 'clear' });
    $('#panel-fab').classList.remove('hidden');
    this.refreshFab();
  }

  refreshFab() {
    const o = this.objById(this.fabOid);
    if (!o) return;
    const key = JSON.stringify([o.mats, o.queue, o.started, o.stalled, o.blocked, Math.round((o.progress || 0) * 10)]);
    if (key === this._fabKey) return;
    this._fabKey = key;
    $('#fab-mats').innerHTML = FAB_MATS.map((m) => `<div class="mat"><img src="${iconURL(m)}"><div class="bar"><i style="width:${(o.mats[m] / FAB_CAP) * 100}%;background:${ITEMS[m].color}"></i></div><span>${o.mats[m]}/${FAB_CAP}</span></div>`).join('');
    const list = RECIPES[OBJECTS[o.type].fab];
    const q = $('#fab-queue');
    q.innerHTML = o.queue.length ? '' : '<small>Fila vazia. Clique numa receita. Carregue materiais clicando no fabricador com eles na mão.</small>';
    o.queue.forEach((e, k) => {
      const r = list[e.r];
      const d = el('div', 'qitem');
      const prog = k === 0 && o.started ? (o.progress / r.t) * 100 : 0;
      const inf = e.left === Infinity || e.left === null;
      d.innerHTML = `<img src="${iconURL(r.out)}"><span>${inf ? '∞' : '×' + e.left}</span><div class="bar"><i style="width:${prog}%"></i></div>`;
      if (k === 0 && o.stalled) d.classList.add('stalled');
      if (k === 0 && o.blocked) d.classList.add('blocked');
      d.title = 'Clique para remover';
      d.onclick = () => this.g.send({ t: 'fab', op: 'rm', k });
      q.appendChild(d);
    });
    document.querySelectorAll('#fab-recipes .recipe').forEach((b, i) => {
      const r = list[i];
      b.classList.toggle('lack', !Object.entries(r.cost).every(([m, n]) => o.mats[m] >= n));
    });
  }

  openStorage(oid) {
    if (!this.objById(oid)) return;
    this.closeAll(true);
    this.storeOid = oid;
    $('#panel-storage').classList.remove('hidden');
    this.renderStorage();
  }
  renderStorage() {
    const o = this.objById(this.storeOid);
    if (!o || !o.inv) return;
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
    if (v) this.g.send({ t: 'chat', text: v });
  }
  esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
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

  showDeath(st) {
    $('#death-stats').innerHTML = `A nave <b>${this.esc(st.name)}</b> foi destruída.<br>Bots destruídos: <b>${st.bots}</b><br>Naves destruídas: <b>${st.ships}</b>`;
    $('#death').classList.remove('hidden');
    $('#hud').classList.add('hidden');
    this.closeAll(true);
  }

  // ---------- atualização por quadro ----------
  update() {
    const g = this.g;
    const under = document.elementFromPoint(g.mouse.x, g.mouse.y);
    this.mouseOverUI = !!under && under !== g.canvas;
    const now = performance.now();
    for (const d of $('#chat-log').children) d.classList.toggle('faded', !this.chatOpen && now - d._t > 12000);
    if (!g.running) return;
    const s = g.ship, w = g.world;
    $('#hud-zone').innerHTML = `<b>${w.zone.name}</b> <small>${w.zone.safe ? '• zona segura' : w.zone.pvp ? '• combate JxJ' : '• PvE'}</small>`;
    $('#bar-shield').style.width = (s.shield / s.maxShield) * 100 + '%';
    $('#bar-hull').style.width = clamp(s.integrity / s.maxIntegrity, 0, 1) * 100 + '%';
    $('#txt-shield').textContent = `Escudo ${Math.ceil(s.shield)}/${s.maxShield}`;
    $('#txt-hull').textContent = `Casco ${Math.max(0, Math.ceil(s.integrity))}/${s.maxIntegrity}`;
    const cq = s.cargoN || 0;
    $('#hud-info').innerHTML = `${s.w}×${s.h} • ${Math.round(Math.hypot(s.vx, s.vy))} u/s • tripulação ${s.crewNet ? s.crewNet.length : 1}${cq ? ` • carga na fila: ${cq}` : ''}<br>Código <b>${g.key}</b>${g.captain ? ' • você é o capitão' : ''}${g.isPublic ? ' • pública' : ''}`;
    $('#hint').innerHTML = this.contextHint();
    if (this.fabOid) { if (!this.objById(this.fabOid)) this.closeAll(true); else this.refreshFab(); }
    if (this.storeOid) { if (!this.objById(this.storeOid)) this.closeAll(true); else this.renderStorage(); }
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
    if (p.mode === 'turret' && p.ctrl) {
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
      else if (o.type === 'hatch') a = `modo: ${o.mode === 'none' ? 'bloqueada' : 'liberada'} — clique para alternar`;
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

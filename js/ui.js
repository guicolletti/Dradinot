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
    for (const id of ['#panel-fab', '#panel-loader', '#panel-hatch', '#panel-storage', '#panel-equip', '#help']) {
      const e = $(id);
      if (!e.classList.contains('hidden')) { e.classList.add('hidden'); any = true; }
    }
    $('#minimap').classList.remove('big');
    if ((this.fabOid || this.storeOid || this.loaderOid || this.hatchOid) && !silent) this.g.send({ t: 'closeui' });
    this.fabOid = null; this.storeOid = null; this.loaderOid = null; this.hatchOid = null;
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
    $('#fab-icon').src = iconURL(o.type);
    $('#fab-sub').textContent = `${RECIPES[od.fab].length} receitas`;
    const list = $('#fab-recipes');
    list.innerHTML = '';
    RECIPES[od.fab].forEach((r, i) => {
      const b = el('div', 'recipe');
      const cost = Object.entries(r.cost).map(([m, n]) => `<span class="cost" data-m="${m}" data-n="${n}" title="${ITEMS[m].name}"><img src="${iconURL(m)}">${n}</span>`).join('') || '<span class="cost">grátis</span>';
      b.innerHTML = `<div class="ri-wrap"><img class="ri" src="${iconURL(r.out)}">${r.n > 1 ? `<span class="rn-n">×${r.n}</span>` : ''}</div>`
        + `<div class="rn">${ITEMS[r.out].name}<div class="rc">${cost}<span class="rt">⏱ ${r.t}s</span></div></div><span class="inq hidden"></span>`;
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
    $('#fab-mats').innerHTML = FAB_MATS.map((m) => `<div class="mat"><img src="${iconURL(m)}"><span class="mn">${ITEMS[m].name}</span><span>${o.mats[m]}/${FAB_CAP}</span><div class="bar"><i style="width:${(o.mats[m] / FAB_CAP) * 100}%;background:${ITEMS[m].color}"></i></div></div>`).join('');
    const list = RECIPES[OBJECTS[o.type].fab];
    const isInf = (e) => e.left === Infinity || e.left === null;
    // produção atual
    const cur = $('#fab-current');
    const first = o.queue[0];
    if (!first) cur.innerHTML = '<div class="empty">Parado. Clique numa receita para produzir.</div>';
    else {
      const r = list[first.r];
      const pct = o.started ? Math.min(100, (o.progress / r.t) * 100) : 0;
      const st = o.stalled ? ['stalled', 'Sem material'] : o.blocked ? ['blocked', 'Sem espaço para soltar o item'] : o.started ? ['', `Produzindo • ${Math.max(0, r.t - o.progress).toFixed(1)}s`] : ['idle', 'Aguardando'];
      cur.innerHTML = `<div class="fc ${st[0]}"><img src="${iconURL(r.out)}"><div class="fc-t"><span>${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''}</span><span class="muted">${isInf(first) ? '∞' : first.left + ' restante' + (first.left > 1 ? 's' : '')}</span></div>`
        + `<div><div class="bar"><i style="width:${pct}%"></i></div><div class="fc-s">${st[1]}</div></div></div>`;
    }
    // fila (ícones compactos; clique remove)
    const q = $('#fab-queue');
    q.innerHTML = o.queue.length ? '' : '<div class="empty">Vazia. Carregue materiais clicando no fabricador com eles na mão.</div>';
    o.queue.forEach((e, k) => {
      const r = list[e.r];
      const d = el('div', 'qitem');
      d.innerHTML = `<img src="${iconURL(r.out)}"><b>${isInf(e) ? '∞' : '×' + e.left}</b>`;
      d.title = `${ITEMS[r.out].name} — clique para remover`;
      d.onclick = () => this.g.send({ t: 'fab', op: 'rm', k });
      q.appendChild(d);
    });
    // receitas: custo que falta em vermelho e quanto já está na fila
    document.querySelectorAll('#fab-recipes .recipe').forEach((b, i) => {
      const r = list[i];
      b.classList.toggle('lack', !Object.entries(r.cost).every(([m, n]) => o.mats[m] >= n));
      b.querySelectorAll('.cost[data-m]').forEach((c) => c.classList.toggle('miss', (o.mats[c.dataset.m] || 0) < +c.dataset.n));
      const qs = o.queue.filter((e) => e.r === i);
      const tag = b.querySelector('.inq');
      tag.classList.toggle('hidden', !qs.length);
      if (qs.length) tag.textContent = qs.some(isInf) ? '∞' : qs.reduce((a, e) => a + e.left, 0);
    });
  }

  // ---------- painel do Carregador ----------
  openLoader(oid) {
    const o = this.objById(oid);
    if (!o) return;
    this.closeAll(true);
    this.loaderOid = oid;
    this._ldKey = null;
    $('#ld-icon').src = iconURL('loader');
    // grades 3×3 de direção (a casa do meio é o próprio Carregador)
    const order = [7, 0, 1, 6, -1, 2, 5, 4, 3];
    for (const which of ['in', 'out']) {
      const grid = $('#ld-' + which);
      grid.innerHTML = '';
      for (const d of order) {
        if (d < 0) { grid.appendChild(el('div', 'mid', `<img src="${iconURL('loader')}">`)); continue; }
        const b = el('button', '', LOADER_ARROWS[d]);
        b.dataset.d = d;
        b.title = (which === 'in' ? 'Pegar de: ' : 'Colocar em: ') + LOADER_DIR_NAMES[d];
        b.onclick = () => this.g.send({ t: 'loader', op: 'dir', which, d });
        grid.appendChild(b);
      }
    }
    $('#ld-only').onchange = (e) => this.g.send({ t: 'loader', op: 'only', v: e.target.checked });
    // filtro: todos os itens do jogo
    const f = $('#ld-filter');
    f.innerHTML = '';
    for (const k of Object.keys(ITEMS)) {
      const b = el('div', 'fi', `<img src="${iconURL(k)}">`);
      b.dataset.item = k;
      b.title = ITEMS[k].name;
      b.onclick = () => this.g.send({ t: 'loader', op: 'filter', item: k, on: !b.classList.contains('on') });
      f.appendChild(b);
    }
    $('#ld-clearf').onclick = () => this.g.send({ t: 'loader', op: 'clearf' });
    $('#panel-loader').classList.remove('hidden');
    this.refreshLoader();
  }

  refreshLoader() {
    const o = this.objById(this.loaderOid);
    if (!o) return;
    const key = JSON.stringify([o.din, o.dout, o.only, o.filter, o.carry, o.wait]);
    if (key === this._ldKey) return;
    this._ldKey = key;
    $('#ld-sub').textContent = `Pega de ${LOADER_DIR_NAMES[o.din]} ${LOADER_ARROWS[o.din]} • coloca em ${LOADER_DIR_NAMES[o.dout]} ${LOADER_ARROWS[o.dout]}`;
    document.querySelectorAll('#ld-in button').forEach((b) => b.classList.toggle('on', +b.dataset.d === o.din));
    document.querySelectorAll('#ld-out button').forEach((b) => b.classList.toggle('on', +b.dataset.d === o.dout));
    $('#ld-only').checked = !!o.only;
    const f = new Set(o.filter || []);
    $('#ld-filter').classList.toggle('all', !f.size);
    document.querySelectorAll('#ld-filter .fi').forEach((b) => b.classList.toggle('on', f.has(b.dataset.item)));
    $('#ld-fsum').textContent = f.size ? `${f.size} ${f.size > 1 ? 'itens marcados' : 'item marcado'}` : 'nenhum marcado = aceita todos';
    $('#ld-carry').innerHTML = o.carry
      ? `<img src="${iconURL(o.carry.item)}"><span>${ITEMS[o.carry.item].name} ×${o.carry.n}${o.wait ? ' <span style="color:#ffb070">— esperando espaço na saída</span>' : ''}</span>`
      : '<span class="muted">Nada no momento.</span>';
  }

  // ---------- painel da escotilha de carga ----------
  openHatch(oid) {
    const o = this.objById(oid);
    if (!o) return;
    this.closeAll(true);
    this.hatchOid = oid;
    this._htKey = null;
    $('#ht-icon').src = iconURL('hatch');
    $('#ht-open').onchange = (e) => this.g.send({ t: 'hatch', op: 'open', v: e.target.checked });
    document.querySelectorAll('#ht-mode button').forEach((b) => { b.onclick = () => this.g.send({ t: 'hatch', op: 'fmode', v: b.dataset.v }); });
    const f = $('#ht-filter');
    f.innerHTML = '';
    for (const k of Object.keys(ITEMS)) {
      const b = el('div', 'fi', `<img src="${iconURL(k)}">`);
      b.dataset.item = k;
      b.title = ITEMS[k].name;
      b.onclick = () => this.g.send({ t: 'hatch', op: 'filter', item: k, on: !b.classList.contains('on') });
      f.appendChild(b);
    }
    $('#ht-clearf').onclick = () => this.g.send({ t: 'hatch', op: 'clearf' });
    $('#panel-hatch').classList.remove('hidden');
    this.refreshHatch();
  }

  refreshHatch() {
    const o = this.objById(this.hatchOid), s = this.g.ship;
    if (!o) return;
    const key = JSON.stringify([o.open, o.fmode, o.filter, s.cargoN]);
    if (key === this._htKey) return;
    this._htKey = key;
    const f = new Set(o.filter || []), allow = o.fmode === 'allow';
    $('#ht-open').checked = !!o.open;
    document.querySelectorAll('#ht-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === o.fmode));
    $('#ht-filter').classList.toggle('allow', allow);
    $('#ht-filter').classList.toggle('all', !allow && !f.size);
    document.querySelectorAll('#ht-filter .fi').forEach((b) => b.classList.toggle('on', f.has(b.dataset.item)));
    $('#ht-explain').textContent = !o.open ? 'Fechada: nenhum item sai por ela.'
      : allow ? (f.size ? `Só os ${f.size} ${f.size > 1 ? 'itens marcados passam' : 'item marcado passa'}. O resto fica na caixa de saque, no espaço.` : 'Nenhum item marcado: nada passa. Marque os itens que podem entrar.')
      : (f.size ? `Todos passam, menos ${f.size > 1 ? `os ${f.size} itens marcados` : 'o item marcado'}, que ficam na caixa de saque, no espaço.` : 'Todos os itens passam. Marque os que você quer barrar.');
    $('#ht-explain').style.color = o.open && !(allow && !f.size) ? '#9fb0c2' : '#ffb070';
    $('#ht-fsum').textContent = f.size ? `${f.size} ${f.size > 1 ? 'marcados' : 'marcado'}` : '';
    $('#ht-sub').textContent = `${o.open ? 'Aberta' : 'Fechada'} • ${allow ? 'só estes itens' : 'todos menos estes'}`;
    $('#ht-queue').textContent = s.cargoN ? `${s.cargoN} itens na fila de carga da nave` : 'Fila de carga vazia';
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
    if (this.loaderOid) { if (!this.objById(this.loaderOid)) this.closeAll(true); else this.refreshLoader(); }
    if (this.hatchOid) { if (!this.objById(this.hatchOid)) this.closeAll(true); else this.refreshHatch(); }
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
    if (p.mode === 'gunner' && p.ctrl) {
      const ts = gunneryTurrets(s, p.ctrl);
      const ammo = ts.map((t) => `${t.ammo}/${TURRETS[t.type].cap}`).join(' • ');
      return `<b>Artilharia — ${GUN_SIDE_NAMES[p.ctrl.side]}</b> — ${ts.length ? `${ts.length} torreta${ts.length > 1 ? 's' : ''} (${ammo})` : 'nenhuma torreta comum nesse lado'} • Clique: atirar • R: trocar lado • Espaço/Esc: sair`;
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
    const resizing = hd && (hd.tool === 'embiggener' || hd.tool === 'shrinker');   // o clique redimensiona, não usa o alvo
    if (t && !resizing) return `${TURRETS[t.type].name} (${t.ammo}/${TURRETS[t.type].cap}${t.ammoType ? ' ' + AMMO[t.ammoType].name : ''}) — ${hd && hd.kind === 'ammo' ? 'clique para carregar (Shift: tudo)' : TURRETS[t.type].rc ? 'disparada pelo leme' : 'clique para controlar'}`;
    if (o && !resizing) {
      const od = OBJECTS[o.type];
      let a = 'clique para usar';
      if (o.type === 'helm') a = 'clique para pilotar';
      else if (o.type === 'gunnery') a = `clique para controlar as torretas da ${GUN_SIDE_NAMES[o.side]}`;
      else if (od.fab) a = hd && FAB_MATS.includes(h.item) ? 'clique para carregar material' : 'clique para abrir';
      else if (o.type === 'recycler') a = h ? 'clique para reciclar o item na mão' : 'segure um item e clique';
      else if (o.type === 'ejector') a = h ? 'clique para ejetar o item na mão' : 'segure um item e clique';
      else if (o.type === 'door') a = o.open ? 'clique para fechar' : 'clique para abrir';
      else if (o.type === 'ammo_crate') a = 'metade de cima guarda munição, de baixo retira';
      else if (o.type === 'loader') a = `pega ${LOADER_ARROWS[o.din]} coloca ${LOADER_ARROWS[o.dout]} — clique para configurar`;
      else if (o.type === 'hatch') a = `${o.open ? 'aberta' : 'fechada'}${o.filter && o.filter.length ? (o.fmode === 'allow' ? ' • só itens do filtro' : ' • com itens barrados') : o.fmode === 'allow' ? ' • nada marcado no filtro' : ''} — clique para configurar`;
      else if (o.type === 'shield_gen') a = `carga ${Math.round(o.fuel || 0)} — use Reforço/Fluxo`;
      if (hd && hd.tool === 'wrench') a = 'segure para desmontar';
      return `${od.name} — ${a}`;
    }
    if (hd) {
      if (h.item === 'gunnery') return `Posto de Artilharia — clique para construir • lado: ${GUN_SIDE_NAMES[GUN_SIDES[g.gunSide]]} • R: escolher lado`;
      if (h.item === 'loader') return `Carregador — clique para construir • pega ${LOADER_ARROWS[g.loaderDirs.din]} coloca ${LOADER_ARROWS[g.loaderDirs.dout]} • R: direções`;
      if (hd.kind === 'tile' || hd.kind === 'object') return `${hd.name} — clique para construir • Q: soltar`;
      if (hd.kind === 'turret') return `${hd.name} — clique no casco externo para instalar`;
      if (hd.tool === 'wrench') return 'Chave inglesa — segure o clique sobre blocos/objetos para desmontar';
      if (hd.tool === 'booster') return 'Reforço de Escudo — clique para recarregar +80 de escudo';
      if (hd.tool === 'repair') return 'Kit de Reparo — clique para restaurar +60 do casco';
      if (hd.tool === 'embiggener' || hd.tool === 'shrinker') {
        const what = g.resizeAxis === 'x' ? 'coluna' : 'linha';
        return `${hd.name} — clique para ${hd.tool === 'embiggener' ? `inserir uma ${what}` : `remover a ${what} (precisa estar vazia)`} • R: ${g.resizeAxis === 'x' ? 'usar linhas' : 'usar colunas'}`;
      }
      if (hd.kind === 'equip') return `${hd.name} — clique (ou duplo clique no slot) para equipar`;
      if (hd.kind === 'ammo') return `${hd.name} — clique numa torreta para carregar`;
      if (hd.kind === 'resource') return `${hd.name} — clique num fabricador para carregar`;
    }
    return '';
  }
}

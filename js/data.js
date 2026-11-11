// ============================================================
//  Dados do jogo: tiles, itens, objetos, torretas, munições,
//  receitas dos fabricadores e zonas.
// ============================================================
'use strict';

// ---------- Tiles da nave ----------
const T = { EMPTY: 0, HULL: 1, BLOCK: 2, WALKWAY: 3, LADDER: 4, NET: 5, RAIL: 6 };
const TILE_INFO = {
  [T.EMPTY]:   { name: 'Vazio', solid: false },
  [T.HULL]:    { name: 'Casco', solid: true, hp: Infinity },
  [T.BLOCK]:   { name: 'Bloco', solid: true, hp: 50, item: 'block' },
  [T.WALKWAY]: { name: 'Passarela', solid: false, platform: true, hp: 20, item: 'walkway' },
  [T.LADDER]:  { name: 'Escada', solid: false, ladder: true, hp: 20, item: 'ladder' },
  [T.NET]:     { name: 'Rede de Itens', solid: false, net: true, hp: 15, item: 'net' },
  [T.RAIL]:    { name: 'Trilho', solid: false, rail: true, hp: 20, item: 'rail' },
};

// ---------- Formatos de bloco ----------
// Cada formato é um trapézio vertical dentro da célula (coordenadas 0–1, y para baixo):
// [x0, x1, topo em x0, topo em x1, base em x0, base em x1]. Rampas = topo ou base inclinados.
// Só o Bloco e a Rede têm formatos (segure R com eles na mão).
const SHAPES = [
  { name: 'Bloco inteiro',                 g: 'Inteiro',     p: [0, 1, 0, 0, 1, 1] },
  { name: 'Meio bloco (baixo)',            g: 'Meio bloco',  p: [0, 1, 0.5, 0.5, 1, 1] },
  { name: 'Meio bloco (cima)',             g: 'Meio bloco',  p: [0, 1, 0, 0, 0.5, 0.5] },
  { name: 'Meio bloco (esquerda)',         g: 'Meio bloco',  p: [0, 0.5, 0, 0, 1, 1] },
  { name: 'Meio bloco (direita)',          g: 'Meio bloco',  p: [0.5, 1, 0, 0, 1, 1] },
  { name: '1/4 de bloco (baixo esq.)',     g: '1/4 de bloco', p: [0, 0.5, 0.5, 0.5, 1, 1] },
  { name: '1/4 de bloco (baixo dir.)',     g: '1/4 de bloco', p: [0.5, 1, 0.5, 0.5, 1, 1] },
  { name: '1/4 de bloco (cima esq.)',      g: '1/4 de bloco', p: [0, 0.5, 0, 0, 0.5, 0.5] },
  { name: '1/4 de bloco (cima dir.)',      g: '1/4 de bloco', p: [0.5, 1, 0, 0, 0.5, 0.5] },
  { name: 'Rampa 45° (sobe à direita)',    g: 'Rampa 45°',   p: [0, 1, 1, 0, 1, 1] },
  { name: 'Rampa 45° (sobe à esquerda)',   g: 'Rampa 45°',   p: [0, 1, 0, 1, 1, 1] },
  { name: 'Rampa 45° de teto (direita)',   g: 'Rampa 45°',   p: [0, 1, 0, 0, 0, 1] },
  { name: 'Rampa 45° de teto (esquerda)',  g: 'Rampa 45°',   p: [0, 1, 0, 0, 1, 0] },
  { name: 'Rampa suave baixa (sobe à dir.)', g: 'Rampa suave', p: [0, 1, 1, 0.5, 1, 1] },
  { name: 'Rampa suave alta (sobe à dir.)',  g: 'Rampa suave', p: [0, 1, 0.5, 0, 1, 1] },
  { name: 'Rampa suave baixa (sobe à esq.)', g: 'Rampa suave', p: [0, 1, 0.5, 1, 1, 1] },
  { name: 'Rampa suave alta (sobe à esq.)',  g: 'Rampa suave', p: [0, 1, 0, 0.5, 1, 1] },
  { name: 'Rampa suave de teto baixa (dir.)', g: 'Rampa suave', p: [0, 1, 0, 0, 0, 0.5] },
  { name: 'Rampa suave de teto alta (dir.)',  g: 'Rampa suave', p: [0, 1, 0, 0, 0.5, 1] },
  { name: 'Rampa suave de teto baixa (esq.)', g: 'Rampa suave', p: [0, 1, 0, 0, 0.5, 0] },
  { name: 'Rampa suave de teto alta (esq.)',  g: 'Rampa suave', p: [0, 1, 0, 0, 1, 0.5] },
];
const SHAPED_TILES = new Set([T.BLOCK, T.NET]);
// contorno do formato (para desenhar), em pixels a partir do canto da célula
function shapePoly(shape, x, y, s) {
  const [x0, x1, t0, t1, b0, b1] = SHAPES[shape].p;
  return [[x + x0 * s, y + t0 * s], [x + x1 * s, y + t1 * s], [x + x1 * s, y + b1 * s], [x + x0 * s, y + b0 * s]];
}

// ---------- Carregador ----------
// 8 direções (vizinhos da célula), no sentido horário a partir de cima
const LOADER_DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const LOADER_DIR_NAMES = ['cima', 'cima-direita', 'direita', 'baixo-direita', 'baixo', 'baixo-esquerda', 'esquerda', 'cima-esquerda'];
const LOADER_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const LOADER_TIME = 1.5;   // segundos por movimento (leva a pilha máxima do item de uma vez)

// ---------- Posto de Artilharia ----------
const GUN_SIDES = ['top', 'right', 'bottom', 'left'];
const GUN_SIDE_NAMES = { top: 'cima', right: 'direita', bottom: 'baixo', left: 'esquerda' };
// torretas que um posto controla: as comuns (não RC) do lado escolhido
function gunneryTurrets(s, o) { return s.turrets.filter((t) => t.side === o.side && !TURRETS[t.type].rc); }

// ---------- Caixa de Munição + Trilho ----------
const CART_CAP = 16;      // munições por carrinho (1 pilha)
const CART_SPEED = 120;   // px/s, ritmo de caminhada

// ---------- Munições ----------
// shots = disparos por caixa carregada; dmg = dano por projétil
const AMMO = {
  standard: { name: 'Padrão', color: '#ffd84a', shots: 3, dmg: 10, speed: 950, life: 1.3, rof: 0.8, r: 3 },
  scatter:  { name: 'Dispersão', color: '#ff9a3c', shots: 3, dmg: 4, speed: 800, life: 0.7, pellets: 6, spread: 0.32, r: 2 },
  flak:     { name: 'Flak', color: '#ff5d5d', shots: 3, dmg: 4, speed: 700, life: 0.42, flak: 10, r: 4 },
  sniper:   { name: 'Atirador', color: '#7df9ff', shots: 3, dmg: 18, speed: 1800, life: 1.6, bounce: 3, rof: 1.5, r: 2 },
  punch:    { name: 'Soco', color: '#9dff7a', shots: 3, dmg: 6, speed: 800, life: 1.1, knock: 260, r: 4 },
  yank:     { name: 'Puxão', color: '#d68cff', shots: 3, dmg: 5, speed: 800, life: 1.1, knock: -260, r: 4 },
  slug:     { name: 'Perfurante', color: '#c8c8c8', shots: 1, dmg: 40, speed: 420, life: 2.6, pierce: 4, rof: 1.8, r: 5 },
  trash:    { name: 'Lixo', color: '#8a7a5a', shots: 4, dmg: 3, speed: 650, life: 0.8, decay: true, r: 3 },
  // munições de bots (não fabricáveis)
  bot_red:   { name: 'Bala de Bot', color: '#ff3b3b', dmg: 6, speed: 520, life: 2.2, r: 4 },
  bot_blue:  { name: 'Bala Azul', color: '#4fa3ff', dmg: 9, speed: 650, life: 2.0, r: 4 },
  bot_green: { name: 'Soco Disperso', color: '#5dff8a', dmg: 3, speed: 560, life: 1.2, pellets: 5, spread: 0.4, knock: 120, r: 3 },
};

// ---------- Torretas (montadas no casco, ocupam 3 tiles) ----------
// Ritmo das torretas: cada tiro demora TURRET_PACE vezes mais e causa TURRET_PACE vezes mais
// dano (e empurrão). O dano por segundo fica igual e cada carga de munição dura TURRET_PACE vezes mais.
const TURRET_PACE = 2.5;

const TURRETS = {
  turret:       { name: 'Torreta', color: '#8d97a6', rof: 0.38, burst: 1, auto: false, cap: 24, rc: false },
  turret_auto:  { name: 'Torreta Automática', color: '#9aa7b8', rof: 0.14, burst: 1, auto: true, cap: 36, rc: false, dmgMul: 0.75 },
  turret_burst: { name: 'Torreta de Rajada', color: '#a69a8d', rof: 0.95, burst: 3, burstGap: 0.07, auto: false, cap: 30, rc: false },
  turret_rc:    { name: 'Torreta RC', color: '#e8853a', rof: 0.42, burst: 1, auto: true, cap: 24, rc: true },
};

// ---------- Objetos (construíveis dentro da nave) ----------
const OBJECTS = {
  helm:          { name: 'Leme', w: 2, h: 2, floor: true, hp: 60, color: '#6c4f2e' },
  fab_starter:   { name: 'Fabricador Inicial', w: 2, h: 2, floor: true, hp: 80, color: '#5a6b7a', fab: 'starter' },
  fab_munitions: { name: 'Fabricador de Munição', w: 2, h: 2, floor: true, hp: 80, color: '#7a4a4a', fab: 'munitions' },
  fab_engineering:{ name: 'Fabricador de Engenharia', w: 2, h: 2, floor: true, hp: 80, color: '#3f7a4f', fab: 'engineering' },
  fab_machine:   { name: 'Fabricador de Máquinas', w: 2, h: 2, floor: true, hp: 80, color: '#4a5a8a', fab: 'machine' },
  fab_equipment: { name: 'Fabricador de Equipamento', w: 2, h: 2, floor: true, hp: 80, color: '#7a5a8a', fab: 'equipment' },
  recycler:      { name: 'Reciclador', w: 2, h: 2, floor: true, hp: 60, color: '#4d6b5d' },
  expando:       { name: 'Caixa Expansível', w: 2, h: 2, floor: true, hp: 60, color: '#8a6a3a' },
  hatch:         { name: 'Escotilha de Carga', w: 1, h: 1, floor: false, hp: 50, color: '#5b7f2f' },
  ejector:       { name: 'Ejetor de Carga', w: 1, h: 1, floor: false, hp: 50, color: '#8a3f3f' },
  shield_gen:    { name: 'Gerador de Escudo', w: 2, h: 2, floor: true, hp: 70, color: '#2f6f9a' },
  spawn:         { name: 'Ponto de Renascimento', w: 1, h: 2, floor: true, hp: 30, color: '#3fa0a0' },
  door:          { name: 'Porta', w: 1, h: 2, floor: false, hp: 50, color: '#6a6f78', solidWhenClosed: true },
  gunnery:       { name: 'Posto de Artilharia', w: 2, h: 2, floor: true, hp: 60, color: '#4e4466' },
  ammo_crate:    { name: 'Caixa de Munição', w: 2, h: 2, floor: true, hp: 70, color: '#5b6b3a' },
  loader:        { name: 'Carregador', w: 1, h: 1, floor: false, hp: 60, color: '#b8862e', solid: true },
};

// ---------- Itens ----------
// kind: resource | tile | object | turret | ammo | tool | equip | ball
const ITEMS = {
  metal:      { name: 'Metal', kind: 'resource', stack: 16, color: '#b8c0c8', desc: 'Material principal. Carregue em fabricadores.' },
  explosives: { name: 'Explosivos', kind: 'resource', stack: 16, color: '#e2553b', desc: 'Usado para fabricar munição.' },
  flux:       { name: 'Cristal de Fluxo', kind: 'resource', stack: 16, color: '#b45cff', desc: 'Material raro. Usado em itens avançados.' },

  block:   { name: 'Bloco', kind: 'tile', tile: T.BLOCK, stack: 16, color: '#7d8794', desc: 'Bloco sólido de construção. Segure R para escolher o formato (meio bloco, 1/4, rampas).' },
  walkway: { name: 'Passarela', kind: 'tile', tile: T.WALKWAY, stack: 16, color: '#a07a4a', desc: 'Plataforma: pule por baixo, aperte S para descer.' },
  ladder:  { name: 'Escada', kind: 'tile', tile: T.LADDER, stack: 16, color: '#b08a50', desc: 'Suba e desça com W/S.' },
  rail:    { name: 'Trilho', kind: 'tile', tile: T.RAIL, stack: 32, color: '#9a8a6a', desc: 'Liga uma Caixa de Munição às torretas: o carrinho percorre o trilho e reabastece as armas do casco ao lado. Fica no fundo (não tem colisão).' },
  net:     { name: 'Rede de Itens', kind: 'tile', tile: T.NET, stack: 16, color: '#6fb0b0', desc: 'Jogadores passam, itens não. Segure R para escolher o formato.' },

  helm:            { name: 'Leme', kind: 'object', obj: 'helm', stack: 1, color: '#8a6a3e', desc: 'Pilote a nave com WASD.' },
  fab_starter:     { name: 'Fabricador Inicial', kind: 'object', obj: 'fab_starter', stack: 1, color: '#6b7d8f' },
  fab_munitions:   { name: 'Fabricador de Munição', kind: 'object', obj: 'fab_munitions', stack: 1, color: '#9a5a5a' },
  fab_engineering: { name: 'Fabricador de Engenharia', kind: 'object', obj: 'fab_engineering', stack: 1, color: '#4f9a62' },
  fab_machine:     { name: 'Fabricador de Máquinas', kind: 'object', obj: 'fab_machine', stack: 1, color: '#5a6fae' },
  fab_equipment:   { name: 'Fabricador de Equipamento', kind: 'object', obj: 'fab_equipment', stack: 1, color: '#9a6fae' },
  recycler:        { name: 'Reciclador', kind: 'object', obj: 'recycler', stack: 1, color: '#5d8a72', desc: 'Converte itens de volta em materiais (com perda).' },
  expando:         { name: 'Caixa Expansível', kind: 'object', obj: 'expando', stack: 1, color: '#aa8448', desc: 'Guarda muitas unidades de um único tipo de item. Clique na metade de cima para guardar e na de baixo para retirar (Shift: 1 unidade).' },
  hatch:           { name: 'Escotilha de Carga', kind: 'object', obj: 'hatch', stack: 1, color: '#74a23a', desc: 'Recebe itens das caixas de saque coletadas.' },
  ejector:         { name: 'Ejetor de Carga', kind: 'object', obj: 'ejector', stack: 1, color: '#aa4f4f', desc: 'Ejeta itens para o espaço.' },
  shield_gen:      { name: 'Gerador de Escudo', kind: 'object', obj: 'shield_gen', stack: 1, color: '#3a8ac0', desc: 'Carregue com reforços ou fluxo para regenerar o escudo.' },
  spawn:           { name: 'Ponto de Renascimento', kind: 'object', obj: 'spawn', stack: 1, color: '#4fc0c0', desc: 'Você renasce aqui.' },
  door:            { name: 'Porta', kind: 'object', obj: 'door', stack: 1, color: '#7f8590', desc: 'Clique para abrir/fechar.' },
  gunnery:         { name: 'Posto de Artilharia', kind: 'object', obj: 'gunnery', stack: 1, color: '#7a6aa0', desc: 'Sente nele para mirar e atirar com todas as torretas comuns (não RC) de um lado da nave ao mesmo tempo. Segure R para escolher o lado; sentado, R troca de lado.' },
  ammo_crate:      { name: 'Caixa de Munição', kind: 'object', obj: 'ammo_crate', stack: 1, color: '#6f8248', desc: 'Guarda um tipo de munição. Com um Trilho encostado nela, solta um carrinho que leva até 16 munições e reabastece as torretas pelo caminho.' },
  loader:          { name: 'Carregador', kind: 'object', obj: 'loader', stack: 8, color: '#d09a3a', desc: 'Bloco com braço: pega itens de um lado e coloca do outro (chão, máquinas, torretas ou outro Carregador). Segure R para escolher as direções; clique nele construído para filtros.' },

  turret:       { name: 'Torreta', kind: 'turret', turret: 'turret', stack: 1, color: '#8d97a6', desc: 'Torreta manual. Instale no casco externo.' },
  turret_auto:  { name: 'Torreta Automática', kind: 'turret', turret: 'turret_auto', stack: 1, color: '#9aa7b8', desc: 'Dispara enquanto o botão estiver pressionado.' },
  turret_burst: { name: 'Torreta de Rajada', kind: 'turret', turret: 'turret_burst', stack: 1, color: '#a69a8d', desc: 'Dispara rajadas de 3.' },
  turret_rc:    { name: 'Torreta RC', kind: 'turret', turret: 'turret_rc', stack: 1, color: '#e8853a', desc: 'Controlada pelo leme (clique esquerdo ao pilotar).' },

  ammo_standard: { name: 'Munição Padrão', kind: 'ammo', ammo: 'standard', stack: 16, color: AMMO.standard.color },
  ammo_scatter:  { name: 'Munição de Dispersão', kind: 'ammo', ammo: 'scatter', stack: 16, color: AMMO.scatter.color },
  ammo_flak:     { name: 'Munição Flak', kind: 'ammo', ammo: 'flak', stack: 16, color: AMMO.flak.color },
  ammo_sniper:   { name: 'Munição de Atirador', kind: 'ammo', ammo: 'sniper', stack: 16, color: AMMO.sniper.color },
  ammo_punch:    { name: 'Munição de Soco', kind: 'ammo', ammo: 'punch', stack: 16, color: AMMO.punch.color },
  ammo_yank:     { name: 'Munição de Puxão', kind: 'ammo', ammo: 'yank', stack: 16, color: AMMO.yank.color },
  ammo_slug:     { name: 'Munição Perfurante', kind: 'ammo', ammo: 'slug', stack: 16, color: AMMO.slug.color },
  ammo_trash:    { name: 'Munição de Lixo', kind: 'ammo', ammo: 'trash', stack: 16, color: AMMO.trash.color },

  wrench:     { name: 'Chave Inglesa', kind: 'tool', tool: 'wrench', stack: 1, color: '#c0c6cc', desc: 'Segure o clique para desmontar blocos e objetos.' },
  shredder:   { name: 'Triturador de Itens', kind: 'tool', tool: 'shredder', stack: 1, color: '#c05050', desc: 'Clique em itens soltos para destruí-los.' },
  booster:    { name: 'Reforço de Escudo', kind: 'tool', tool: 'booster', stack: 16, color: '#58b8ff', desc: 'Use para recarregar o escudo da nave.' },
  embiggener: { name: 'Ampliador de Nave', kind: 'tool', tool: 'embiggener', stack: 16, color: '#5ad18a', desc: 'Aumenta a nave. R muda o eixo.' },
  shrinker:   { name: 'Encolhedor de Nave', kind: 'tool', tool: 'shrinker', stack: 16, color: '#d1a05a', desc: 'Diminui a nave. R muda o eixo.' },
  repair:     { name: 'Kit de Reparo', kind: 'tool', tool: 'repair', stack: 16, color: '#ffd0a0', desc: 'Restaura a integridade do casco.' },

  boots:   { name: 'Botas Saltadoras', kind: 'equip', slot: 'feet', stack: 1, color: '#d0d070', desc: 'Pulos mais altos.' },
  speed:   { name: 'Botas de Velocidade', kind: 'equip', slot: 'feet', stack: 1, color: '#70d0d0', desc: 'Corre mais rápido.' },
  jetpack: { name: 'Mochila-Foguete', kind: 'equip', slot: 'back', stack: 1, color: '#d07070', desc: 'Segure espaço no ar para voar.' },

  ball_beach:  { name: 'Bola de Praia', kind: 'ball', stack: 1, color: '#ff6b9a', bounce: 0.8 },
  ball_soccer: { name: 'Bola de Futebol', kind: 'ball', stack: 1, color: '#f4f4f4', bounce: 0.65 },
  ball_volley: { name: 'Bola de Vôlei', kind: 'ball', stack: 1, color: '#ffe36b', bounce: 0.75 },
};
for (const k in ITEMS) ITEMS[k].id = k;

// Raridade (cor do nome)
const RARE_ITEMS = new Set(['flux', 'turret_auto', 'turret_burst', 'turret_rc', 'jetpack', 'fab_equipment', 'ball_beach', 'ball_soccer', 'ball_volley']);

// ---------- Receitas ----------
// cost: { metal, explosives, flux }, n = quantidade produzida, t = segundos
const R = (out, n, t, cost) => ({ out, n, t, cost });
const RECIPES = {
  starter: [
    R('block', 4, 1, { metal: 2 }),
    R('walkway', 4, 1, { metal: 2 }),
    R('ladder', 4, 1, { metal: 2 }),
    R('net', 4, 1, { metal: 2 }),
    R('ammo_standard', 4, 2, { metal: 1, explosives: 1 }),
    R('booster', 1, 3, { metal: 2 }),
    R('wrench', 1, 10, { metal: 4 }),
    R('helm', 1, 10, { metal: 8 }),
    R('hatch', 1, 10, { metal: 8 }),
    R('fab_munitions', 1, 20, { metal: 16 }),
    R('fab_engineering', 1, 20, { metal: 16 }),
    R('fab_machine', 1, 20, { metal: 16 }),
  ],
  munitions: [
    R('ammo_standard', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_scatter', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_flak', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_sniper', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_punch', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_yank', 4, 2, { metal: 1, explosives: 1 }),
    R('ammo_slug', 4, 3, { metal: 1, explosives: 1 }),
    R('ammo_trash', 4, 2, {}),
    R('booster', 1, 3, { metal: 2 }),
  ],
  engineering: [
    R('rail', 4, 1, { metal: 1 }),
    R('wrench', 1, 10, { metal: 4 }),
    R('shredder', 1, 10, { metal: 4 }),
    R('booster', 1, 3, { metal: 2 }),
    R('repair', 1, 4, { metal: 3 }),
    R('embiggener', 1, 3, { metal: 2 }),
    R('shrinker', 1, 3, { metal: 2 }),
    R('block', 4, 1, { metal: 2 }),
    R('walkway', 4, 1, { metal: 2 }),
    R('ladder', 4, 1, { metal: 2 }),
    R('net', 4, 1, { metal: 2 }),
  ],
  machine: [
    R('helm', 1, 10, { metal: 8 }),
    R('fab_munitions', 1, 20, { metal: 16 }),
    R('fab_engineering', 1, 20, { metal: 16 }),
    R('fab_machine', 1, 20, { metal: 16 }),
    R('fab_equipment', 1, 20, { metal: 16, flux: 2 }),
    R('recycler', 1, 20, { metal: 16 }),
    R('expando', 1, 10, { metal: 8 }),
    R('hatch', 1, 10, { metal: 8 }),
    R('ejector', 1, 10, { metal: 8 }),
    R('shield_gen', 1, 15, { metal: 12, flux: 1 }),
    R('spawn', 1, 10, { metal: 8 }),
    R('door', 1, 10, { metal: 8 }),
    R('loader', 1, 8, { metal: 8 }),
    R('ammo_crate', 1, 12, { metal: 12 }),
    R('gunnery', 1, 15, { metal: 12 }),
    R('turret', 1, 20, { metal: 12, flux: 2 }),
  ],
  equipment: [
    R('boots', 1, 15, { metal: 8, flux: 2 }),
    R('speed', 1, 15, { metal: 8, flux: 2 }),
    R('jetpack', 1, 25, { metal: 12, flux: 6 }),
  ],
};

// Materiais aceitos por fabricadores
const FAB_MATS = ['metal', 'explosives', 'flux'];
const FAB_CAP = 64;

// Valor de reciclagem (o que volta)
function recycleValue(itemId) {
  for (const list of Object.values(RECIPES)) {
    for (const r of list) {
      if (r.out === itemId) {
        const out = {};
        for (const m in r.cost) {
          const v = Math.floor((r.cost[m] / r.n) * 0.75);
          if (v > 0) out[m] = v;
        }
        return out;
      }
    }
  }
  if (ITEMS[itemId] && ITEMS[itemId].kind === 'turret') return { metal: 8, flux: 1 };
  return {};
}

// ---------- Zonas ----------
const ZONES = {
  freeport: {
    name: 'Porto Livre', safe: true, pvp: false, size: 44,
    bg: ['#0d1a2b', '#132840'], rock: '#3a4a5e', rockEdge: '#56708c',
    density: 0.0, bots: [], botCount: 0, ships: 0, diamond: 0, flux: 0,
    portals: ['hummingbird', 'finch'], desc: 'Zona segura. O jogo é salvo aqui.',
  },
  hummingbird: {
    name: 'Beija-flor', safe: false, pvp: false, size: 60,
    bg: ['#10202a', '#1b3a3a'], rock: '#4a5a4a', rockEdge: '#6f8a6a',
    density: 0.36, bots: [['red', 10], ['blue', 1]], botCount: 18, ships: 0, diamond: 0.01, flux: 0.01,
    portals: ['freeport', 'finch'], desc: 'Zona inicial. Bots vermelhos.',
  },
  finch: {
    name: 'Tentilhão', safe: false, pvp: false, size: 66,
    bg: ['#1c1830', '#2b2346'], rock: '#5a4a6a', rockEdge: '#82709a',
    density: 0.4, bots: [['red', 7], ['blue', 3], ['green', 1]], botCount: 24, ships: 1, diamond: 0.02, flux: 0.025,
    portals: ['freeport', 'hummingbird', 'sparrow'], desc: 'Bots vermelhos e azuis. Algumas naves piratas.',
  },
  sparrow: {
    name: 'Pardal', safe: false, pvp: true, size: 74,
    bg: ['#2a1414', '#3e1d1d'], rock: '#6a4a3e', rockEdge: '#9a6a52',
    density: 0.42, bots: [['red', 5], ['blue', 4], ['green', 2]], botCount: 26, ships: 3, diamond: 0.05, flux: 0.04,
    portals: ['finch', 'pits', 'canary', 'vulture', 'falcon'], desc: 'Zona de combate (JxJ). Naves piratas!',
  },
  falcon: {
    name: 'Falcão', safe: false, pvp: true, size: 80,
    bg: ['#140e05', '#2a1d08'], rock: '#6a5a2e', rockEdge: '#a08a4a',
    density: 0.38, bots: [['red', 3], ['blue', 5], ['green', 2]], botCount: 28, ships: 5, diamond: 0.06, flux: 0.06,
    portals: ['sparrow', 'freeport'], desc: 'Zona perigosa. Muitas naves e saque raro.',
  },
  pits: {
    name: 'Os Fossos', safe: false, pvp: true, size: 56, mission: true,
    bg: ['#0a0a0a', '#1d1d1d'], rock: '#4e4e4e', rockEdge: '#7a7a7a',
    density: 0.58, bots: [['red', 6], ['blue', 6]], botCount: 36, ships: 1, diamond: 0.16, flux: 0.03,
    portals: ['sparrow', 'freeport'], desc: 'Missão: terreno denso cheio de diamantes.',
  },
  canary: {
    name: 'Canário', safe: false, pvp: true, size: 56, mission: true,
    bg: ['#2a2a08', '#3d3a10'], rock: '#7a7030', rockEdge: '#b0a050',
    density: 0.4, bots: [['green', 8], ['red', 2]], botCount: 30, ships: 1, diamond: 0.05, flux: 0.12,
    portals: ['sparrow', 'freeport'], desc: 'Missão: bots verdes e muito fluxo.',
  },
  vulture: {
    name: 'Abutre', safe: false, pvp: true, size: 64, mission: true,
    bg: ['#1a0820', '#2e0e38'], rock: '#5a2e6a', rockEdge: '#8a52a0',
    density: 0.3, bots: [['blue', 5], ['red', 3]], botCount: 18, ships: 6, boss: true, diamond: 0.06, flux: 0.05,
    portals: ['sparrow', 'freeport'], desc: 'Missão: frota pirata e uma nave chefe.',
  },
};

// ---------- Bots ----------
const BOTS = {
  red:   { name: 'Bot Vermelho', r: 60, hp: 40, speed: 120, color: '#e04040', core: '#ff9a9a', ammo: 'bot_red', rof: 1.1, range: 900, drops: 'red' },
  blue:  { name: 'Bot Azul', r: 85, hp: 110, speed: 95, color: '#3f7fe0', core: '#a0c8ff', ammo: 'bot_blue', rof: 0.6, burst: 3, range: 1000, drops: 'blue' },
  green: { name: 'Bot Verde', r: 35, hp: 70, speed: 150, color: '#3fc060', core: '#b0ffc0', ammo: 'bot_green', rof: 1.2, range: 650, drops: 'green' },
};

const LOOT_TABLES = {
  red: () => {
    const out = [['metal', randInt(2, 8)]];
    if (Math.random() < 0.7) out.push(['explosives', randInt(1, 5)]);
    return out;
  },
  blue: () => {
    const out = [['metal', randInt(3, 10)], ['explosives', randInt(2, 6)]];
    if (Math.random() < 0.35) out.push([weighted([['turret', 4], ['turret_auto', 2], ['turret_burst', 2], ['turret_rc', 2]]), 1]);
    if (Math.random() < 0.3) out.push(['flux', randInt(1, 2)]);
    return out;
  },
  green: () => {
    const out = [['metal', randInt(2, 6)]];
    if (Math.random() < 0.4) out.push([choice(['ball_beach', 'ball_soccer', 'ball_volley']), 1]);
    if (Math.random() < 0.3) out.push(['ammo_punch', randInt(2, 6)]);
    return out;
  },
  diamond: () => {
    const rare = weighted([
      ['turret', 3], ['turret_auto', 3], ['turret_burst', 3], ['turret_rc', 3],
      ['flux', 4], ['fab_equipment', 1], ['jetpack', 1], ['boots', 1], ['speed', 1],
      ['ammo_sniper', 2], ['ammo_slug', 2], ['ammo_flak', 2],
    ]);
    const n = ITEMS[rare].stack > 1 ? randInt(3, 10) : 1;
    return [[rare, n], ['metal', randInt(4, 12)]];
  },
  ship: (scale) => {
    const out = [['metal', randInt(10, 24) * scale], ['explosives', randInt(5, 14) * scale]];
    if (Math.random() < 0.8) out.push(['flux', randInt(1, 4) * scale]);
    if (Math.random() < 0.6) out.push([choice(['turret', 'turret_auto', 'turret_burst', 'turret_rc']), 1]);
    if (Math.random() < 0.5) out.push([choice(['ammo_flak', 'ammo_sniper', 'ammo_scatter', 'ammo_slug']), randInt(4, 12)]);
    if (Math.random() < 0.25) out.push([choice(['jetpack', 'boots', 'speed', 'fab_equipment']), 1]);
    return out;
  },
};

// Caixa expansível: guarda um único tipo de item, até o equivalente a 24 pilhas dele
const EXPANDO_STACKS = 24;
function expandoCap(item) { return item ? ITEMS[item].stack * EXPANDO_STACKS : 0; }

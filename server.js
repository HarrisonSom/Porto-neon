/* Porto Neon 0.3.0 — arquivo único gerado por build.js. Não edite à mão. */

'use strict';
/* =========================================================================
   PORTO NEON 0.3.0 — "O Véu Noturno"
   Arquivo único de publicação: servidor + imagens (SVG/procedurais) + interface.
   Protótipo. Inteligência local, ações pré-programadas. Sem IA externa.
   ========================================================================= */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const VERSION = '0.3.0';
const BUILD = 'ALPHA 0.3';
const PORT = process.env.PORT || 3000;

/* Segredo de liderança: SEMPRE via variável de ambiente em produção.
   Sem LEADER_CODE definido o servidor cria um código efêmero e o imprime
   somente no console local (nunca é exposto por HTTP nem por socket).      */
let LEADER_CODE = String(process.env.LEADER_CODE || '').trim();
const LEADER_CODE_FROM_ENV = LEADER_CODE.length >= 8;
if (!LEADER_CODE_FROM_ENV) {
  LEADER_CODE = crypto.randomBytes(9).toString('base64url');
}

/* ------------------------------ utilidades ------------------------------ */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const now = () => Date.now();
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function esc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
function sanitizeName(s) {
  s = String(s || '').replace(/[^\p{L}\p{N} .'_-]/gu, '').trim().slice(0, 18);
  return s || 'Visitante';
}

/* ------------------------------- o mundo -------------------------------- */
const TS = 48;            // tamanho do tile em unidades do mundo
const N = 45;             // tiles por lado
const WORLD = N * TS;
const grid = new Uint8Array(N * N);       // 1 = parede
const tileTag = new Int16Array(N * N).fill(-1); // índice do prédio

const BLOCKS = [];        // prédios
const PLAZA = { x0: 16, y0: 16, x1: 27, y1: 27 };
const CIRCLE = { x: (PLAZA.x0 + PLAZA.x1 + 1) / 2 * TS, y: (PLAZA.y0 + PLAZA.y1 + 1) / 2 * TS, r: 176 };

const NAMED = {
  '0,0': ['Clínica Aurora', 'clinica', '#39d3ff'],
  '1,0': ['Mercado Maré', 'mercado', '#ffb03a'],
  '2,0': ['Escola Farol', 'escola', '#7dff9b'],
  '3,0': ['Biblioteca Salgada', 'biblioteca', '#b98cff'],
  '4,0': ['Rádio Vento Norte', 'radio', '#ff5f9e'],
  '5,0': ['Torre Kestrel', 'torre', '#5ad1ff'],
  '0,1': ['Oficina Kaiser', 'oficina', '#ff8a3a'],
  '1,1': ['Padaria Brasa', 'padaria', '#ffd166'],
  '2,1': ['Bar Neon', 'bar', '#ff3ea5'],
  '3,1': ['Estúdio Agulha', 'estudio', '#9d7bff'],
  '4,1': ['Academia Píer', 'academia', '#4ad9c0'],
  '5,1': ['Fórum Velho', 'forum', '#c9d1ff'],
  '0,2': ['Cadeia Municipal', 'cadeia', '#8892b0'],
  '1,2': ['Restaurante Maré Alta', 'restaurante', '#ffa552'],
  '4,2': ['Ateliê da Agulha', 'atelie', '#ff7bd5'],
  '5,2': ['Garagem Sodré', 'garagem', '#7f8ca8'],
  '0,3': ['Delegacia do Porto', 'delegacia', '#6ad6ff'],
  '1,3': ['Doca Sul', 'doca', '#4fa8ff'],
  '4,3': ['Templo do Véu', 'templo', '#c06bff'],
  '5,3': ['Torre do Relógio', 'relogio', '#ffd166']
};

function tileIdx(tx, ty) { return ty * N + tx; }
function isWallTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return true;
  return grid[tileIdx(tx, ty)] === 1;
}
function isWall(x, y) { return isWallTile(Math.floor(x / TS), Math.floor(y / TS)); }

function buildWorld() {
  // tudo parede, depois abrimos ruas
  grid.fill(1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const rua = (x % 7 === 0 || x % 7 === 1 || y % 7 === 0 || y % 7 === 1);
      if (rua) grid[tileIdx(x, y)] = 0;
    }
  }
  // praça central aberta
  for (let y = PLAZA.y0; y <= PLAZA.y1; y++) for (let x = PLAZA.x0; x <= PLAZA.x1; x++) grid[tileIdx(x, y)] = 0;
  // muralha externa
  for (let i = 0; i < N; i++) {
    grid[tileIdx(i, 0)] = 1; grid[tileIdx(i, N - 1)] = 1;
    grid[tileIdx(0, i)] = 1; grid[tileIdx(N - 1, i)] = 1;
  }
  // prédios
  let residencial = 0;
  const letras = 'ABCDEFGHIJKL';
  for (let by = 0; by < 6; by++) {
    for (let bx = 0; bx < 6; bx++) {
      const x0 = bx * 7 + 2, y0 = by * 7 + 2, x1 = x0 + 4, y1 = y0 + 4;
      if (x0 >= PLAZA.x0 && x1 <= PLAZA.x1 && y0 >= PLAZA.y0 && y1 <= PLAZA.y1) continue; // praça
      const key = bx + ',' + by;
      const nm = NAMED[key] || ['Residencial ' + letras[residencial++ % 12], 'casa', '#6f7dbe'];
      const id = BLOCKS.length;
      const rng = mulberry32(hashStr(nm[0]));
      const b = {
        id, nome: nm[0], tipo: nm[1], cor: nm[2], bx, by, x0, y0, x1, y1,
        cx: (x0 + x1 + 1) / 2 * TS, cy: (y0 + y1 + 1) / 2 * TS,
        altura: 0.7 + rng() * 1.1,
        porta: { x: (x0 + 2 + 0.5) * TS, y: (y0 - 0.5) * TS }
      };
      BLOCKS.push(b);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { grid[tileIdx(x, y)] = 1; tileTag[tileIdx(x, y)] = id; }
    }
  }
  // a praça precisa de acesso: garantido pelas ruas ao redor
}
buildWorld();

const byTipo = t => BLOCKS.find(b => b.tipo === t);
const CLINICA = byTipo('clinica');
const CADEIA = byTipo('cadeia');
const CRUZ = { x: CIRCLE.x, y: CIRCLE.y - CIRCLE.r - 56 };
const CADEIA_CELA = { x: CADEIA.porta.x, y: CADEIA.porta.y - 26 };

/* ---------------------- colisão, visada e caminho ----------------------- */
const RAIO = 13;
function livre(x, y, r) {
  r = r || RAIO;
  if (x < r || y < r || x > WORLD - r || y > WORLD - r) return false;
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
    if (isWall(x + ox, y + oy)) return false;
  }
  return true;
}
function mover(ent, dx, dy) {
  if (livre(ent.x + dx, ent.y)) ent.x += dx; 
  if (livre(ent.x, ent.y + dy)) ent.y += dy;
  ent.x = clamp(ent.x, RAIO, WORLD - RAIO); ent.y = clamp(ent.y, RAIO, WORLD - RAIO);
}
function temVisada(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const passos = Math.max(2, Math.ceil(d / (TS * 0.4)));
  for (let i = 1; i < passos; i++) {
    const t = i / passos;
    if (isWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}
function tileLivreProx(tx, ty) {
  if (!isWallTile(tx, ty)) return [tx, ty];
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      if (!isWallTile(tx + dx, ty + dy)) return [tx + dx, ty + dy];
    }
  }
  return [22, 22];
}
/* A* em grade (mundo pequeno: 45x45) */
function rota(sx, sy, gx, gy) {
  let [a, b] = tileLivreProx(Math.floor(sx / TS), Math.floor(sy / TS));
  let [c, d] = tileLivreProx(Math.floor(gx / TS), Math.floor(gy / TS));
  const start = tileIdx(a, b), goal = tileIdx(c, d);
  if (start === goal) return [{ x: gx, y: gy }];
  const open = [start];
  const came = new Map(); const gsc = new Map([[start, 0]]);
  const h = i => Math.abs((i % N) - c) + Math.abs(Math.floor(i / N) - d);
  const f = new Map([[start, h(start)]]);
  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if ((f.get(open[i]) || 1e9) < (f.get(open[bi]) || 1e9)) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) {
      const path = []; let k = cur;
      while (k !== start) { path.push({ x: ((k % N) + 0.5) * TS, y: (Math.floor(k / N) + 0.5) * TS }); k = came.get(k); }
      path.reverse(); path.push({ x: gx, y: gy });
      return path;
    }
    const cx = cur % N, cy = Math.floor(cur / N);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (isWallTile(nx, ny)) continue;
      const ni = tileIdx(nx, ny); const tg = (gsc.get(cur) || 0) + 1;
      if (tg < (gsc.get(ni) ?? 1e9)) {
        came.set(ni, cur); gsc.set(ni, tg); f.set(ni, tg + h(ni));
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return [{ x: gx, y: gy }];
}


/* ======================== MORADORES (36 perfis) ========================= */

const NOMES = [
  ['Ana Vilar', 'F'], ['Bruno Sodré', 'M'], ['Carla Menezes', 'F'], ['Davi Antunes', 'M'],
  ['Elisa Kaiser', 'F'], ['Fábio Nunes', 'M'], ['Gilda Prado', 'F'], ['Heitor Salles', 'M'],
  ['Íris Camargo', 'F'], ['João Bastos', 'M'], ['Kátia Moreno', 'F'], ['Lucas Ferrão', 'M'],
  ['Marta Quiroga', 'F'], ['Nélson Braga', 'M'], ['Olívia Tanaka', 'F'], ['Pedro Vasques', 'M'],
  ['Quésia Lima', 'F'], ['Rafael Doria', 'M'], ['Sara Belmonte', 'F'], ['Tiago Werner', 'M'],
  ['Úrsula Paiva', 'F'], ['Victor Aragão', 'M'], ['Wanda Ferraz', 'F'], ['Xavier Rolim', 'M'],
  ['Yara Cordeiro', 'F'], ['Zeca Monteiro', 'M'], ['Alice Rebouças', 'F'], ['Bento Faria', 'M'],
  ['Clara Duarte', 'F'], ['Dante Ribas', 'M'], ['Eva Nogueira', 'F'], ['Fausto Lins', 'M'],
  ['Gabriela Orsi', 'F'], ['Hugo Serrano', 'M'], ['Inês Valadão', 'F'], ['Ivo Brandão', 'M']
];

const PROFISSOES = [
  ['enfermeira', 'clinica'], ['mecânico', 'oficina'], ['professora', 'escola'], ['estivador', 'doca'],
  ['bibliotecária', 'biblioteca'], ['padeiro', 'padaria'], ['radialista', 'radio'], ['guarda', 'delegacia'],
  ['costureira', 'atelie'], ['cozinheiro', 'restaurante'], ['médica', 'clinica'], ['barman', 'bar'],
  ['zeladora', 'forum'], ['eletricista', 'garagem'], ['tatuadora', 'estudio'], ['pescador', 'doca'],
  ['vendedora', 'mercado'], ['segurança', 'delegacia'], ['música', 'bar'], ['carteiro', 'forum'],
  ['arquivista', 'biblioteca'], ['personal', 'academia'], ['farmacêutica', 'clinica'], ['soldador', 'oficina'],
  ['jornalista', 'radio'], ['motorista', 'garagem'], ['florista', 'mercado'], ['relojoeiro', 'relogio'],
  ['psicóloga', 'clinica'], ['vigia', 'templo'], ['fotógrafa', 'estudio'], ['carpinteiro', 'oficina'],
  ['confeiteira', 'padaria'], ['porteiro', 'torre'], ['professora de coro', 'templo'], ['sapateiro', 'mercado']
];

const TRACOS = ['calmo', 'ansioso', 'teimoso', 'curioso', 'gentil', 'irônico', 'reservado', 'falante', 'metódico', 'sonhador', 'desconfiado', 'leal'];
const GOSTOS = ['café forte', 'chuva à noite', 'rádio antigo', 'peixe frito', 'cartas de baralho', 'vinil riscado', 'pão quente', 'maresia', 'gatos de rua', 'domingos vazios', 'neon refletido', 'violão desafinado'];
const MEDOS = ['altura', 'multidão', 'escuro', 'mar aberto', 'agulhas', 'silêncio', 'sirenes', 'apagões', 'espelhos', 'trovão'];
const SEGREDOS = [
  'guarda uma carta que nunca enviou', 'deve dinheiro ao Bar Neon', 'já viu o círculo aceso antes',
  'esconde um caderno de sonhos', 'trocou de nome ao chegar no porto', 'tem medo de perder o emprego',
  'foi membro antigo da Ordem', 'esconde uma faca sob o colchão', 'nunca aprendeu a nadar',
  'escreve boatos anônimos no mural', 'ama alguém que não sabe', 'sabe quem apagou a torre em 0.1'
];

const PELE = ['#f1cfae', '#e6b58c', '#d19a6e', '#b5794f', '#8d5a36', '#6b4227', '#4e3020', '#f7ded0'];
const CABELO = ['#1b1712', '#2e2018', '#4b2f1c', '#7a4a22', '#b07a33', '#d8c08a', '#8d8d99', '#e2e2e8', '#5a2c52', '#243a6b'];
const ROUPA = ['#2f6df0', '#e0424f', '#2fae7a', '#e8a13a', '#8b4fd6', '#d94f9c', '#3fb6c9', '#c9552b', '#4b5573', '#1f8f5f', '#a13a6c', '#2b4c8c'];
const DETALHE = ['#ffd166', '#39d3ff', '#ff5f9e', '#7dff9b', '#ffffff', '#111318', '#b98cff', '#ff8a3a'];
const CORTE = ['curto', 'raspado', 'ondulado', 'coque', 'trança', 'longo', 'moicano', 'careca'];
const ACESSORIO = ['nenhum', 'óculos', 'boné', 'lenço', 'brinco', 'cachecol', 'fone', 'chapéu'];

const ARMAS = {
  soco: { nome: 'Soco', dano: 3, cd: 650, alcance: 34, saque: false },
  faca: { nome: 'Faca', dano: 11, cd: 800, alcance: 40, saque: true },
  taco: { nome: 'Taco de baseball', dano: 16, cd: 1100, alcance: 48, saque: true },
  espada: { nome: 'Espada', dano: 23, cd: 1050, alcance: 52, saque: true },
  espada_fogo: { nome: 'Espada de fogo', dano: 90, cd: 600, alcance: 62, saque: false }
};

function aparencia(rng) {
  return {
    pele: pick(rng, PELE), cabelo: pick(rng, CABELO), roupa: pick(rng, ROUPA),
    detalhe: pick(rng, DETALHE), corte: pick(rng, CORTE), acess: pick(rng, ACESSORIO),
    altura: 0.92 + rng() * 0.2, largura: 0.9 + rng() * 0.25, barba: rng() < 0.3
  };
}

const NPCS = [];
function criarNPCs() {
  for (let i = 0; i < NOMES.length; i++) {
    const [nome, g] = NOMES[i];
    const rng = mulberry32(hashStr(nome + '|porto-neon|0.3'));
    const [prof, local] = PROFISSOES[i % PROFISSOES.length];
    const trab = byTipo(local) || BLOCKS[i % BLOCKS.length];
    const casa = BLOCKS.filter(b => b.tipo === 'casa')[i % Math.max(1, BLOCKS.filter(b => b.tipo === 'casa').length)] || BLOCKS[0];
    const hpMax = 145 + Math.floor(rng() * 76); // 145–220
    const armaBase = rng() < 0.25 ? 'faca' : rng() < 0.45 ? 'taco' : rng() < 0.58 ? 'espada' : 'soco';
    const n = {
      id: 'npc' + i, tipo: 'npc', nome, genero: g, idade: 19 + Math.floor(rng() * 44),
      profissao: prof, trabalhoId: trab.id, casaId: casa.id,
      apar: aparencia(rng),
      traco: pick(rng, TRACOS), traco2: pick(rng, TRACOS),
      gosto: pick(rng, GOSTOS), medo: pick(rng, MEDOS), segredo: pick(rng, SEGREDOS),
      x: casa.porta.x + (rng() - 0.5) * 40, y: casa.porta.y + 18 + rng() * 20,
      ang: rng() * Math.PI * 2, vel: 44 + rng() * 22,
      hp: hpMax, hpMax, arma: armaBase, armaVisivel: false, ultimoAtaque: 0,
      necessidades: { fome: rng() * 30, sono: rng() * 30, social: rng() * 30, higiene: rng() * 30, diversao: rng() * 30 },
      humor: 55 + rng() * 25, xp: Math.floor(rng() * 40), nivel: 1,
      estado: 'rotina', pose: 'idle', acao: 'acordando', alvo: null, caminho: [], destino: null,
      mem: [], boatos: [], relacoes: {}, tarefa: null,
      ordem: null, ordemAte: 0, sabeOrdem: false, preso: false, presoAte: 0, cruz: false,
      morto: false, voltaEm: 0, guardaDe: null, falaAte: 0, fala: '',
      spawn: { x: casa.porta.x, y: casa.porta.y + 20 }
    };
    n.bio = gerarBio(n, rng);
    NPCS.push(n);
  }
  // relações iniciais
  for (const a of NPCS) {
    const rng = mulberry32(hashStr(a.nome + 'rel'));
    for (let k = 0; k < 5; k++) {
      const b = NPCS[Math.floor(rng() * NPCS.length)];
      if (b.id === a.id) continue;
      a.relacoes[b.id] = Math.floor(rng() * 60) + 10;
    }
  }
}

function gerarBio(n, rng) {
  const trab = BLOCKS[n.trabalhoId], casa = BLOCKS[n.casaId];
  const origens = ['nasceu no porto', 'chegou de barco aos 12 anos', 'veio do interior', 'cresceu na Doca Sul', 'foi criada na Escola Farol', 'morou anos fora e voltou'];
  const o = pick(rng, origens);
  return `${n.nome}, ${n.idade} anos, ${n.profissao} na ${trab.nome}. ${o.charAt(0).toUpperCase() + o.slice(1)}. ` +
    `Temperamento ${n.traco} e ${n.traco2}. Gosta de ${n.gosto}; tem medo de ${n.medo}. ` +
    `Mora na ${casa.nome}. Dizem que ${n.segredo}.`;
}
criarNPCs();
const npcById = id => NPCS.find(n => n.id === id);

/* ---------------------------- rotina e vida ----------------------------- */
/* Relógio do jogo: 1 minuto real ≈ 24 minutos de jogo (1 dia ≈ 60 min reais) */
const GAME_START = now();
const DIA_MS = 60 * 60 * 1000;
function horaJogo(t) {
  const ms = ((t || now()) - GAME_START) % DIA_MS;
  const total = (ms / DIA_MS) * 1440;
  return { h: Math.floor(total / 60), m: Math.floor(total % 60), minutos: total };
}
function hhmm(t) { const g = horaJogo(t); return String(g.h).padStart(2, '0') + ':' + String(g.m).padStart(2, '0'); }

function destinoRotina(n) {
  const g = horaJogo();
  const h = g.h;
  const casa = BLOCKS[n.casaId], trab = BLOCKS[n.trabalhoId];
  if (n.necessidades.fome > 78) { const m = byTipo('restaurante'); return { b: m, acao: 'comendo' }; }
  if (n.necessidades.sono > 82) return { b: casa, acao: 'dormindo' };
  if (n.necessidades.higiene > 85) return { b: casa, acao: 'higiene' };
  if (h >= 0 && h < 6) return { b: casa, acao: 'dormindo' };
  if (h >= 6 && h < 8) return { b: byTipo('padaria'), acao: 'café da manhã' };
  if (h >= 8 && h < 12) return { b: trab, acao: 'trabalhando' };
  if (h >= 12 && h < 13) return { b: byTipo('restaurante'), acao: 'almoçando' };
  if (h >= 13 && h < 17) return { b: trab, acao: 'trabalhando' };
  if (h >= 17 && h < 19) return { b: byTipo('mercado'), acao: 'compras' };
  if (h >= 19 && h < 22) return { b: n.necessidades.social > 50 ? byTipo('bar') : byTipo('academia'), acao: n.necessidades.social > 50 ? 'socializando' : 'exercício' };
  return { b: casa, acao: 'voltando pra casa' };
}

function memoria(n, texto) {
  n.mem.unshift({ t: hhmm(), texto });
  if (n.mem.length > 12) n.mem.pop();
}
function boato(n, texto) {
  if (n.boatos.some(b => b.texto === texto)) return;
  n.boatos.unshift({ t: hhmm(), texto });
  if (n.boatos.length > 8) n.boatos.pop();
}
function falar(n, texto, ms) {
  n.fala = texto; n.falaAte = now() + (ms || 3500);
}
function ganharXP(n, q) {
  n.xp += q;
  const prox = n.nivel * 100;
  if (n.xp >= prox) { n.xp -= prox; n.nivel++; memoria(n, `Subiu para o nível ${n.nivel} como ${n.profissao}.`); }
}


/* ===================== A ORDEM DE DANTALION ============================= */

const COMANDOS = {
  reunir:     { nome: 'Reunir no círculo', pose: 'reunir', dur: 60000 },
  dancar:     { nome: 'Dançar', pose: 'dancar', dur: 60000 },
  deitar:     { nome: 'Deitar', pose: 'deitar', dur: 60000 },
  cerimonia:  { nome: 'Cerimônia musical', pose: 'cantar', dur: 60000 },
  oferenda:   { nome: 'Oferenda', pose: 'oferenda', dur: 60000 },
  sacrificio: { nome: 'Sacrifício fictício', pose: 'sacrificio', dur: 30000 },
  duelo:      { nome: 'Duelo', pose: 'duelo', dur: 60000 },
  patrulhar:  { nome: 'Patrulhar', pose: 'patrulha', dur: 60000 },
  trabalhar:  { nome: 'Trabalhar', pose: 'trabalho', dur: 60000 },
  prender:    { nome: 'Prender', pose: 'prender', dur: 45000 },
  crucificar: { nome: 'Crucificação simbólica', pose: 'cruz', dur: 45000 },
  libertar:   { nome: 'Libertar', pose: 'idle', dur: 1000 }
};

const estado = {
  lider: null,                 // { socketId, nome, sessao }
  ordens: [],                  // ordens agendadas/ativas
  pendentes: [],               // pedidos de visitantes aguardando aprovação
  saques: [],                  // armas no chão
  eventos: [],                 // log público
  convergencia: true
};

function logEvento(texto, tipo) {
  estado.eventos.unshift({ t: hhmm(), texto, tipo: tipo || 'info' });
  if (estado.eventos.length > 40) estado.eventos.pop();
}

/* -------- interpretação de linguagem: padrões pré-programados ----------- */
const PALAVRAS = [
  [/dan[çc]/i, 'dancar'], [/re[úu]n|reunir|convoc|todos no c[íi]rculo|no c[íi]rculo/i, 'reunir'],
  [/deit|dormir no ch[ãa]o|prostr/i, 'deitar'], [/cerim[ôo]ni|cant|m[úu]sica ritual|coro/i, 'cerimonia'],
  [/oferend|oferta|tributo/i, 'oferenda'], [/sacrif/i, 'sacrificio'], [/duel|desafi/i, 'duelo'],
  [/patrulh|vigi(?!a do templo)/i, 'patrulhar'], [/trabalh|volt(ar|em) ao trabalho/i, 'trabalhar'],
  [/prend|cadei|pris[ãa]o|encarcer/i, 'prender'], [/crucific|cruz/i, 'crucificar'],
  [/libert|solt|liber/i, 'libertar']
];

function interpretar(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const limpo = t.replace(/^ordem\s*:\s*/i, '');
  let cmd = null;
  for (const [re, c] of PALAVRAS) if (re.test(limpo)) { cmd = c; break; }
  if (!cmd) return null;

  // horário
  let quando = 'agora', hora = null;
  const mh = limpo.match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  if (mh) { hora = clamp(+mh[1], 0, 23) * 60 + clamp(+mh[2], 0, 59); quando = 'hora'; }
  else if (/meia[- ]noite/i.test(limpo)) { hora = 0; quando = 'hora'; }
  else if (/meio[- ]dia/i.test(limpo)) { hora = 720; quando = 'hora'; }

  // destinatário
  let alvo = 'todos', alvoId = null;
  for (const n of NPCS) {
    const primeiro = n.nome.split(' ')[0];
    if (new RegExp('\\b' + primeiro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(limpo)) {
      alvo = 'um'; alvoId = n.id; break;
    }
  }
  if (/\btodos\b|\btodo mundo\b|\bmoradores\b/i.test(limpo)) { alvo = 'todos'; alvoId = null; }
  return { cmd, quando, hora, alvo, alvoId, texto: t };
}

/* ------------------------- agendar / executar --------------------------- */
function minutosParaMs(minAlvo) {
  const g = horaJogo();
  let delta = minAlvo - g.minutos;
  if (delta < 0) delta += 1440;             // já passou: vale para o próximo dia
  return (delta / 1440) * DIA_MS;
}

function criarOrdem(spec, autor, aprovadaPor) {
  const c = COMANDOS[spec.cmd];
  if (!c) return null;
  const inicioEm = spec.quando === 'hora' ? now() + minutosParaMs(spec.hora) : now() + 800;
  const o = {
    id: 'o' + Math.random().toString(36).slice(2, 9),
    cmd: spec.cmd, nome: c.nome, pose: c.pose,
    alvo: spec.alvo, alvoId: spec.alvoId, adversarioId: spec.adversarioId || null,
    autor, aprovadaPor: aprovadaPor || autor,
    criadaEm: now(), inicioEm, fimEm: inicioEm + c.dur,
    iniciada: false, encerrada: false, horaTexto: spec.quando === 'hora' ? fmtMin(spec.hora) : 'agora',
    convergencia: estado.convergencia, mensageiros: 0
  };
  estado.ordens.push(o);
  // mensageiros: a notícia se espalha a partir do círculo
  semearMensageiros(o);
  logEvento(`Ordem registrada por ${autor}: ${c.nome} (${o.horaTexto}) — ${o.alvo === 'todos' ? 'todos os moradores' : (npcById(o.alvoId) || {}).nome || '—'}`, 'ordem');
  return o;
}
function fmtMin(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

function destinatarios(o) {
  if (o.alvo === 'todos') return NPCS.filter(n => !n.morto);
  const a = npcById(o.alvoId); const lista = a && !a.morto ? [a] : [];
  if (o.cmd === 'duelo' && o.adversarioId) { const b = npcById(o.adversarioId); if (b && !b.morto) lista.push(b); }
  return lista;
}

function semearMensageiros(o) {
  for (const n of NPCS) n._sabe = n._sabe || {};
  const alvos = destinatarios(o);
  // posições fixas no círculo, para que quem chegar depois ocupe seu lugar
  o.slots = {}; alvos.forEach((n, i) => { o.slots[n.id] = i; });
  o.total = alvos.length;
  // mensageiros iniciais: os mais próximos do círculo ouvem a proclamação
  const ord = alvos.slice().sort((a, b) => dist2(a.x, a.y, CIRCLE.x, CIRCLE.y) - dist2(b.x, b.y, CIRCLE.x, CIRCLE.y));
  for (let i = 0; i < Math.min(4, ord.length); i++) { ord[i]._sabe[o.id] = true; o.mensageiros++; boato(ord[i], `Ouviu a ordem: ${o.nome} às ${o.horaTexto}.`); }
}

function propagarMensageiros(dt) {
  for (const o of estado.ordens) {
    if (o.encerrada) continue;
    const alvos = destinatarios(o);
    for (const a of alvos) {
      if (!a._sabe || !a._sabe[o.id] || a.morto) continue;
      for (const b of alvos) {
        if (b === a || b.morto || (b._sabe && b._sabe[o.id])) continue;
        if (dist2(a.x, a.y, b.x, b.y) < 110 * 110 && temVisada(a.x, a.y, b.x, b.y) && Math.random() < 0.06) {
          b._sabe = b._sabe || {}; b._sabe[o.id] = true; o.mensageiros++;
          boato(b, `${a.nome} avisou: ${o.nome} ${o.horaTexto === 'agora' ? 'agora' : 'às ' + o.horaTexto}.`);
          falar(a, o.horaTexto === 'agora' ? `${o.nome}, agora!` : `${o.nome} às ${o.horaTexto}!`, 2500);
          // se a ordem já começou, o retardatário parte agora (pode chegar atrasado)
          if (o.iniciada && !o.encerrada) aplicarOrdemA(b, o);
        }
      }
    }
  }
}

function posicaoNoCirculo(i, total, raio) {
  const ang = (i / Math.max(1, total)) * Math.PI * 2;
  return { x: CIRCLE.x + Math.cos(ang) * raio, y: CIRCLE.y + Math.sin(ang) * raio };
}

function iniciarOrdem(o) {
  o.iniciada = true;
  const alvos = destinatarios(o);
  logEvento(`${o.nome} começou (${alvos.length} destinatário(s)).`, 'ordem');

  if (o.cmd === 'libertar') {
    for (const n of NPCS) if (n.preso) { soltar(n); }
    for (const p of Object.values(jogadores)) if (p.preso) soltarJogador(p);
    o.encerrada = true; return;
  }

  alvos.forEach((n, i) => {
    // Com convergência mística, o chamado alcança todos de uma vez.
    // Sem ela, só age quem já soube; os demais entram quando o mensageiro chegar.
    if (!o.convergencia && !(n._sabe && n._sabe[o.id])) return;
    aplicarOrdemA(n, o);
  });

  if (o.cmd === 'sacrificio') {
    const vivos = alvos.filter(n => n.ordem === o.id);
    const vitima = o.alvo === 'todos' ? vivos[Math.floor(Math.random() * vivos.length)] : alvos[0];
    if (vitima) setTimeout(() => { if (!vitima.morto) derrotar(vitima, 'o ritual', true); }, 6000);
  }
  if (o.cmd === 'duelo' && alvos.length >= 2) {
    alvos[0].alvo = alvos[1].id; alvos[1].alvo = alvos[0].id;
    alvos[0].estado = 'duelo'; alvos[1].estado = 'duelo';
  }
}

/* Coloca um morador específico sob uma ordem já em andamento. */
function aplicarOrdemA(n, o) {
  if (n.morto || n.ordem === o.id) return;
  const i = (o.slots && o.slots[n.id] !== undefined) ? o.slots[n.id] : 0;
  const total = o.total || 36;
  {
    n.ordem = o.id; n.ordemAte = o.fimEm; n.pose = o.pose; n.estado = 'ordem';
    n.armaVisivel = (o.cmd === 'duelo' || o.cmd === 'patrulhar' || o.cmd === 'prender');

    if (['reunir', 'dancar', 'deitar', 'cerimonia', 'oferenda', 'sacrificio'].includes(o.cmd)) {
      const alvoPos = posicaoNoCirculo(i, total, CIRCLE.r * (o.cmd === 'reunir' ? 0.72 : 0.85));
      if (o.convergencia) { if (livre(alvoPos.x, alvoPos.y)) { n.x = alvoPos.x; n.y = alvoPos.y; } n.caminho = []; }
      else { n.caminho = rota(n.x, n.y, alvoPos.x, alvoPos.y); }
      n.destino = alvoPos;
      n.ang = Math.atan2(CIRCLE.y - n.y, CIRCLE.x - n.x);
      n.acao = o.nome.toLowerCase();
    } else if (o.cmd === 'patrulhar') {
      n.destino = null; n.caminho = rota(n.x, n.y, CIRCLE.x + (Math.random() - .5) * 600, CIRCLE.y + (Math.random() - .5) * 600);
      n.acao = 'patrulhando';
    } else if (o.cmd === 'trabalhar') {
      const b = BLOCKS[n.trabalhoId]; n.caminho = rota(n.x, n.y, b.porta.x, b.porta.y); n.acao = 'trabalhando'; ganharXP(n, 8);
    } else if (o.cmd === 'prender') {
      n.preso = true; n.presoAte = o.fimEm; n.cruz = false;
      n.x = CADEIA_CELA.x + (Math.random() - .5) * 26; n.y = CADEIA_CELA.y + (Math.random() - .5) * 20;
      n.caminho = []; n.acao = 'preso'; designarGuardas(n);
    } else if (o.cmd === 'crucificar') {
      n.preso = true; n.cruz = true; n.presoAte = o.fimEm;
      n.x = CRUZ.x + (i - total / 2) * 34; n.y = CRUZ.y; n.caminho = []; n.acao = 'na cruz'; designarGuardas(n);
    } else if (o.cmd === 'duelo') {
      n.acao = 'em duelo'; n.armaVisivel = true;
    }
    memoria(n, `Cumpriu a ordem: ${o.nome}.`);
    if (o.cmd !== 'prender' && o.cmd !== 'crucificar') ganharXP(n, 3);
  }
}

function encerrarOrdem(o) {
  o.encerrada = true;
  for (const n of NPCS) {
    if (n.ordem === o.id) {
      n.ordem = null; n.pose = 'idle'; n.armaVisivel = false;
      if (n.preso && now() >= n.presoAte) soltar(n);
      if (!n.preso) { n.estado = 'rotina'; n.acao = 'retomando a rotina'; n.alvo = null; }
    }
  }
  logEvento(`${o.nome} terminou. Os moradores voltam às rotinas.`, 'info');
}

function designarGuardas(n) {
  const guardas = NPCS.filter(g => !g.morto && !g.preso && g.id !== n.id)
    .sort((a, b) => dist2(a.x, a.y, n.x, n.y) - dist2(b.x, b.y, n.x, n.y)).slice(0, 2);
  for (const g of guardas) { g.guardaDe = n.id; g.estado = 'guarda'; g.armaVisivel = true; g.acao = 'vigiando'; }
}
function soltar(n) {
  n.preso = false; n.cruz = false; n.presoAte = 0; n.estado = 'rotina'; n.acao = 'liberado';
  memoria(n, 'Foi liberado.'); 
  for (const g of NPCS) if (g.guardaDe === n.id) { g.guardaDe = null; g.estado = 'rotina'; g.armaVisivel = false; }
}

/* ---------------------------- combate ----------------------------------- */
function derrotar(ent, porQuem, ritual) {
  if (ent.tipo === 'npc') {
    ent.morto = true; ent.hp = 0; ent.voltaEm = now() + 75000; ent.preso = false; ent.cruz = false;
    ent.pose = 'idle'; ent.estado = 'morto';
    for (const g of NPCS) if (g.guardaDe === ent.id) { g.guardaDe = null; g.estado = 'rotina'; }
    if (!ritual && ARMAS[ent.arma] && ARMAS[ent.arma].saque) {
      estado.saques.push({ id: 's' + Math.random().toString(36).slice(2, 8), arma: ent.arma, x: ent.x, y: ent.y, ate: now() + 120000, coletado: false });
    }
    logEvento(ritual ? `${ent.nome} foi oferecido no ritual (simbólico) e desaparece.` : `${ent.nome} foi derrotado por ${porQuem}.`, 'combate');
    for (const o of NPCS) if (!o.morto && dist2(o.x, o.y, ent.x, ent.y) < 260 * 260) boato(o, `${ent.nome} caiu perto d${ritual ? 'o círculo' : 'aqui'}.`);
  }
}

function atacar(atacante, alvoId) {
  const t = now();
  const arma = ARMAS[atacante.arma] || ARMAS.soco;
  if (t - (atacante.ultimoAtaque || 0) < arma.cd) return { ok: false, motivo: 'intervalo' };
  let alvo = npcById(alvoId) || jogadores[alvoId];
  if (!alvo || alvo.morto) return { ok: false, motivo: 'alvo' };
  if (atacante.arma === 'espada_fogo' && !(atacante.lider)) return { ok: false, motivo: 'sem-permissao' };
  const d = dist(atacante.x, atacante.y, alvo.x, alvo.y);
  if (d > arma.alcance + 18) return { ok: false, motivo: 'distancia' };
  if (!temVisada(atacante.x, atacante.y, alvo.x, alvo.y)) return { ok: false, motivo: 'parede' };
  if (alvo.invulneravel || (alvo.protegidoAte && alvo.protegidoAte > t)) return { ok: false, motivo: 'protegido' };

  atacante.ultimoAtaque = t;
  atacante.armaVisivel = true; atacante.swingAte = t + 220;
  alvo.hp -= arma.dano; alvo.ultimoDano = t;
  if (alvo.tipo === 'npc') {
    alvo.armaVisivel = true;
    if (alvo.estado !== 'ordem' && !alvo.preso) { alvo.estado = 'combate'; alvo.alvo = atacante.id; }
    memoria(alvo, `Foi atingido por ${atacante.nome}.`);
  }
  if (alvo.hp <= 0) {
    if (alvo.tipo === 'npc') { derrotar(alvo, atacante.nome, false); if (atacante.tipo === 'npc') ganharXP(atacante, 20); }
    else derrotarJogador(alvo, atacante.nome);
  }
  return { ok: true, dano: arma.dano, alvo: alvo.id, hp: Math.max(0, alvo.hp) };
}


/* ========================= JOGADORES / VISITANTES ======================= */
const jogadores = {};   // socket.id -> player

function criarJogador(socketId, nome) {
  const rng = mulberry32(hashStr(nome + socketId));
  const p = {
    id: socketId, tipo: 'player', nome, lider: false,
    x: CIRCLE.x + (rng() - .5) * 120, y: CIRCLE.y + CIRCLE.r + 70,
    ang: -Math.PI / 2, hp: 160, hpMax: 160, arma: 'soco', inventario: ['soco'],
    ultimoAtaque: 0, morto: false, invulneravel: false, protegidoAte: 0,
    dinheiro: 500, preso: false, presoAte: 0, cruz: false, primeira: false,
    apar: aparencia(rng), entrou: now()
  };
  if (!livre(p.x, p.y)) { p.x = CIRCLE.x; p.y = CIRCLE.y + 40; }
  jogadores[socketId] = p;
  return p;
}
function derrotarJogador(p, porQuem) {
  const perda = Math.min(100, p.dinheiro, 40 + Math.floor(Math.random() * 61));
  p.dinheiro -= perda;
  p.hp = p.hpMax; p.x = CLINICA.porta.x; p.y = CLINICA.porta.y + 28;
  p.protegidoAte = now() + 8000; p.preso = false; p.cruz = false;
  logEvento(`${p.nome} foi derrotado por ${porQuem} e acordou na Clínica Aurora (−R$ ${perda}).`, 'combate');
  io.to(p.id).emit('aviso', { tipo: 'derrota', texto: `Você foi derrotado. Reapareceu na Clínica Aurora. Penalidade: R$ ${perda}. Proteção temporária ativa.` });
}
function soltarJogador(p) {
  p.preso = false; p.cruz = false; p.presoAte = 0;
  for (const g of NPCS) if (g.guardaDe === p.id) { g.guardaDe = null; g.estado = 'rotina'; g.armaVisivel = false; }
  io.to(p.id).emit('aviso', { tipo: 'livre', texto: 'Você foi libertado.' });
}
function prenderJogador(p, cruz) {
  p.preso = true; p.cruz = !!cruz; p.presoAte = now() + 45000;
  if (cruz) { p.x = CRUZ.x; p.y = CRUZ.y; } else { p.x = CADEIA_CELA.x; p.y = CADEIA_CELA.y; }
  designarGuardas(p);
  logEvento(`${p.nome} foi ${cruz ? 'levado à cruz simbólica' : 'detido na Cadeia Municipal'} por ordem da liderança.`, 'ordem');
  io.to(p.id).emit('aviso', { tipo: 'preso', texto: cruz ? 'Você está na cruz simbólica (imobilização, sem ferimentos). Até 45 segundos.' : 'Você está detido na Cadeia Municipal. Até 45 segundos.' });
}
function atacarJogadorComGuardas(p) {
  const trio = NPCS.filter(n => !n.morto && !n.preso).sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y)).slice(0, 3);
  for (const g of trio) { g.estado = 'caca'; g.alvo = p.id; g.cacaAte = now() + 60000; g.armaVisivel = true; g.acao = 'perseguindo'; }
  logEvento(`Três moradores foram mobilizados contra ${p.nome}.`, 'combate');
  io.to(p.id).emit('aviso', { tipo: 'ataque', texto: 'A liderança autorizou um ataque contra você. Corra ou lute.' });
}

/* =============================== SIMULAÇÃO ============================== */
let ultimo = now();
function tick() {
  const t = now();
  const dt = Math.min(0.25, (t - ultimo) / 1000); ultimo = t;

  // ordens
  for (const o of estado.ordens) {
    if (!o.iniciada && t >= o.inicioEm) iniciarOrdem(o);
    if (o.iniciada && !o.encerrada && t >= o.fimEm) encerrarOrdem(o);
  }
  estado.ordens = estado.ordens.filter(o => !o.encerrada || t - o.fimEm < 20000);
  propagarMensageiros(dt);

  // saques expiram
  estado.saques = estado.saques.filter(s => !s.coletado && t < s.ate);

  // pedidos pendentes expiram
  for (const p of estado.pendentes) if (t > p.expiraEm && !p.resolvido) { p.resolvido = true; p.resultado = 'expirou'; }
  estado.pendentes = estado.pendentes.filter(p => !p.resolvido || t - p.expiraEm < 15000);

  // jogadores presos
  for (const p of Object.values(jogadores)) {
    if (p.preso && t >= p.presoAte) soltarJogador(p);
  }

  for (const n of NPCS) {
    if (n.morto) {
      if (t >= n.voltaEm) {
        n.morto = false; n.hp = n.hpMax; n.estado = 'rotina'; n.acao = 'voltou';
        n.x = n.spawn.x; n.y = n.spawn.y; n.caminho = []; memoria(n, 'Voltou a circular pela cidade.');
      }
      continue;
    }
    // necessidades
    const k = dt * 0.55;
    n.necessidades.fome = clamp(n.necessidades.fome + k * 1.1, 0, 100);
    n.necessidades.sono = clamp(n.necessidades.sono + k * 0.8, 0, 100);
    n.necessidades.social = clamp(n.necessidades.social + k * 0.7, 0, 100);
    n.necessidades.higiene = clamp(n.necessidades.higiene + k * 0.6, 0, 100);
    n.necessidades.diversao = clamp(n.necessidades.diversao + k * 0.65, 0, 100);
    const med = (n.necessidades.fome + n.necessidades.sono + n.necessidades.social + n.necessidades.higiene + n.necessidades.diversao) / 5;
    n.humor = clamp(100 - med * 0.8 + (n.nivel * 2), 5, 100);
    if (n.hp < n.hpMax && t - (n.ultimoDano || 0) > 6000) n.hp = Math.min(n.hpMax, n.hp + 10 * dt);

    if (n.preso) { if (t >= n.presoAte) soltar(n); else { n.pose = n.cruz ? 'cruz' : 'preso'; continue; } }

    switch (n.estado) {
      case 'ordem': comportamentoOrdem(n, dt, t); break;
      case 'duelo': comportamentoDuelo(n, dt, t); break;
      case 'combate': case 'caca': comportamentoCombate(n, dt, t); break;
      case 'guarda': comportamentoGuarda(n, dt, t); break;
      default: comportamentoRotina(n, dt, t);
    }
  }
}

function andarCaminho(n, dt, vel) {
  if (!n.caminho || !n.caminho.length) return true;
  const alvo = n.caminho[0];
  const d = dist(n.x, n.y, alvo.x, alvo.y);
  if (d < 10) { n.caminho.shift(); return n.caminho.length === 0; }
  const v = (vel || n.vel) * dt;
  const ang = Math.atan2(alvo.y - n.y, alvo.x - n.x);
  n.ang = ang;
  mover(n, Math.cos(ang) * v, Math.sin(ang) * v);
  return false;
}

function comportamentoRotina(n, dt, t) {
  if (!n._proxDecisao || t > n._proxDecisao) {
    n._proxDecisao = t + 6000 + Math.random() * 8000;
    const d = destinoRotina(n);
    n.acao = d.acao; n.tarefa = d.acao;
    const dest = { x: d.b.porta.x + (Math.random() - .5) * 50, y: d.b.porta.y + 22 + Math.random() * 18 };
    n.caminho = rota(n.x, n.y, dest.x, dest.y);
    n.destino = dest;
    if (Math.random() < 0.25) falar(n, frasePorAcao(n), 3000);
  }
  const chegou = andarCaminho(n, dt, n.vel);
  n.pose = chegou ? (n.acao === 'dormindo' ? 'deitar' : 'idle') : 'andar';
  if (chegou) {
    if (n.acao === 'comendo' || n.acao === 'almoçando' || n.acao === 'café da manhã') n.necessidades.fome = Math.max(0, n.necessidades.fome - 40 * dt);
    if (n.acao === 'dormindo') n.necessidades.sono = Math.max(0, n.necessidades.sono - 30 * dt);
    if (n.acao === 'socializando') n.necessidades.social = Math.max(0, n.necessidades.social - 30 * dt);
    if (n.acao === 'higiene') n.necessidades.higiene = Math.max(0, n.necessidades.higiene - 40 * dt);
    if (n.acao === 'exercício') n.necessidades.diversao = Math.max(0, n.necessidades.diversao - 25 * dt);
    if (n.acao === 'trabalhando' && Math.random() < dt * 0.4) ganharXP(n, 1);
  }
  // contato social
  if (Math.random() < dt * 0.25) {
    const outro = NPCS.find(o => o !== n && !o.morto && dist2(o.x, o.y, n.x, n.y) < 70 * 70 && temVisada(n.x, n.y, o.x, o.y));
    if (outro) {
      n.necessidades.social = Math.max(0, n.necessidades.social - 6);
      n.relacoes[outro.id] = clamp((n.relacoes[outro.id] || 20) + 2, 0, 100);
      if (Math.random() < 0.35 && n.boatos.length) boato(outro, n.boatos[0].texto);
      if (Math.random() < 0.2) falar(n, pick(Math.random, ['Tudo certo por aí?', 'Viu o círculo hoje?', 'Dizem coisas na praça...', 'Trabalho puxado.']), 2500);
    }
  }
}

function frasePorAcao(n) {
  const f = {
    'trabalhando': ['Turno cheio hoje.', 'Mais uma hora e eu saio.'],
    'dormindo': ['Preciso dormir.', 'Que noite longa...'],
    'compras': ['Faltou pão em casa.', 'O mercado tá caro.'],
    'socializando': ['Me paga uma?', 'A rádio tocou aquela música.'],
    'almoçando': ['Comida quente, enfim.'], 'café da manhã': ['Café forte, por favor.']
  };
  const l = f[n.acao] || ['Hm.', 'Porto Neon nunca dorme.', 'O véu está baixo hoje.'];
  return l[Math.floor(Math.random() * l.length)];
}

function comportamentoOrdem(n, dt, t) {
  const o = estado.ordens.find(x => x.id === n.ordem);
  if (!o || o.encerrada) { n.estado = 'rotina'; n.pose = 'idle'; return; }
  if (o.cmd === 'patrulhar') {
    const fim = andarCaminho(n, dt, n.vel * 1.1);
    n.pose = fim ? 'patrulha' : 'andar';
    if (fim) n.caminho = rota(n.x, n.y, 200 + Math.random() * (WORLD - 400), 200 + Math.random() * (WORLD - 400));
    return;
  }
  if (o.cmd === 'trabalhar') { const fim = andarCaminho(n, dt, n.vel); n.pose = fim ? 'trabalho' : 'andar'; return; }
  if (n.caminho && n.caminho.length) { andarCaminho(n, dt, n.vel * 1.15); n.pose = 'andar'; return; }
  n.pose = o.pose;
  if (n.destino) n.ang = Math.atan2(CIRCLE.y - n.y, CIRCLE.x - n.x);
  if (Math.random() < dt * 0.05) {
    const falas = { dancar: ['Dantalion vê!', 'A dança não para!'], cerimonia: ['Lá-lá-á... o véu desce.'], oferenda: ['Aceite nossa oferta.'], reunir: ['Estamos todos aqui.'], deitar: ['O chão é frio.'], sacrificio: ['Que seja simbólico...'] };
    const l = falas[o.cmd]; if (l) falar(n, l[Math.floor(Math.random() * l.length)], 2600);
  }
}

function comportamentoDuelo(n, dt, t) {
  const alvo = npcById(n.alvo);
  if (!alvo || alvo.morto) { n.estado = 'rotina'; n.alvo = null; n.pose = 'idle'; return; }
  const d = dist(n.x, n.y, alvo.x, alvo.y);
  n.pose = 'duelo'; n.armaVisivel = true;
  if (d > (ARMAS[n.arma] || ARMAS.soco).alcance) { n.caminho = rota(n.x, n.y, alvo.x, alvo.y).slice(0, 2); andarCaminho(n, dt, n.vel * 1.2); }
  else { n.ang = Math.atan2(alvo.y - n.y, alvo.x - n.x); atacar(n, alvo.id); }
}

function comportamentoCombate(n, dt, t) {
  const alvo = npcById(n.alvo) || jogadores[n.alvo];
  if (!alvo || alvo.morto || (n.cacaAte && t > n.cacaAte)) { n.estado = 'rotina'; n.alvo = null; n.armaVisivel = false; n.cacaAte = 0; return; }
  const d = dist(n.x, n.y, alvo.x, alvo.y);
  n.armaVisivel = true;
  if (d > (ARMAS[n.arma] || ARMAS.soco).alcance) {
    if (!n._recalc || t > n._recalc) { n.caminho = rota(n.x, n.y, alvo.x, alvo.y); n._recalc = t + 900; }
    andarCaminho(n, dt, n.vel * 1.25); n.pose = 'andar';
  } else { n.ang = Math.atan2(alvo.y - n.y, alvo.x - n.x); n.pose = 'duelo'; atacar(n, alvo.id); }
}

function comportamentoGuarda(n, dt, t) {
  const preso = npcById(n.guardaDe) || jogadores[n.guardaDe];
  if (!preso || (preso.preso === false)) { n.guardaDe = null; n.estado = 'rotina'; n.armaVisivel = false; return; }
  const d = dist(n.x, n.y, preso.x, preso.y);
  if (d > 70) { if (!n._recalc || t > n._recalc) { n.caminho = rota(n.x, n.y, preso.x, preso.y); n._recalc = t + 1200; } andarCaminho(n, dt, n.vel); n.pose = 'andar'; }
  else { n.pose = 'patrulha'; n.ang = Math.atan2(preso.y - n.y, preso.x - n.x); n.caminho = []; }
}


/* ===================== IMAGENS GERADAS NO SERVIDOR ====================== */
/* Retratos vetoriais determinísticos (fictícios). Sem arquivos externos.   */
function retratoSVG(n) {
  const a = n.apar;
  const rng = mulberry32(hashStr(n.nome + 'retrato'));
  const fundo = ['#12203a', '#1b1430', '#0f2a2a', '#2a1420', '#15182e'][Math.floor(rng() * 5)];
  const sombra = '#00000055';
  const olhos = ['#3a2a1a', '#2b4a6b', '#3f6b3a', '#5a3a2a'][Math.floor(rng() * 4)];
  const larg = 200, alt = 240;
  const cabelos = {
    curto: `<path d="M56 96 q44 -58 88 0 q6 -46 -44 -50 q-50 4 -44 50z" fill="${a.cabelo}"/>`,
    raspado: `<path d="M58 94 q42 -46 84 0 q2 -34 -42 -36 q-44 2 -42 36z" fill="${a.cabelo}" opacity=".85"/>`,
    ondulado: `<path d="M52 100 q10 -66 48 -62 q42 -4 48 62 q-14 -26 -30 -18 q-18 -14 -36 0 q-18 -6 -30 18z" fill="${a.cabelo}"/>`,
    coque: `<circle cx="100" cy="36" r="17" fill="${a.cabelo}"/><path d="M56 96 q44 -56 88 0 q4 -44 -44 -48 q-48 4 -44 48z" fill="${a.cabelo}"/>`,
    tranca: `<path d="M56 96 q44 -56 88 0 q4 -44 -44 -48 q-48 4 -44 48z" fill="${a.cabelo}"/><path d="M58 104 q-12 56 2 88" stroke="${a.cabelo}" stroke-width="13" fill="none" stroke-linecap="round"/>`,
    longo: `<path d="M52 98 q48 -60 96 0 q4 -50 -48 -54 q-52 4 -48 54z" fill="${a.cabelo}"/>`,
    moicano: `<path d="M92 34 q8 -22 16 0 l4 62 h-24z" fill="${a.cabelo}"/><path d="M58 98 q12 -30 34 -34 l0 36z M142 98 q-12 -30 -34 -34 l0 36z" fill="${a.cabelo}" opacity=".5"/>`,
    careca: ''
  };
  const acess = {
    nenhum: '',
    'óculos': `<g fill="none" stroke="#1a1a22" stroke-width="4"><circle cx="82" cy="120" r="17"/><circle cx="118" cy="120" r="17"/><path d="M99 120h2M65 116l-9-4M135 116l9-4"/></g><circle cx="82" cy="120" r="15" fill="#bfe9ff" opacity=".18"/><circle cx="118" cy="120" r="15" fill="#bfe9ff" opacity=".18"/>`,
    'boné': `<path d="M52 92 q48 -50 96 0 z" fill="${a.detalhe}"/><path d="M52 92 h96 q8 10 -10 12 h-78 q-14 -2 -8 -12z" fill="${a.detalhe}" opacity=".8"/><path d="M148 92 q22 2 26 14 l-28 0z" fill="${a.detalhe}"/>`,
    'lenço': `<path d="M62 190 q38 22 76 0 l6 16 q-44 24 -88 0z" fill="${a.detalhe}"/>`,
    brinco: `<circle cx="55" cy="140" r="5" fill="${a.detalhe}"/><circle cx="145" cy="140" r="5" fill="${a.detalhe}"/>`,
    cachecol: `<path d="M56 192 q44 26 88 0 l4 22 q-46 26 -96 0z" fill="${a.detalhe}"/>`,
    fone: `<path d="M52 118 v-8 a48 44 0 0 1 96 0 v8" stroke="${a.detalhe}" stroke-width="7" fill="none"/><rect x="42" y="112" width="18" height="30" rx="8" fill="${a.detalhe}"/><rect x="140" y="112" width="18" height="30" rx="8" fill="${a.detalhe}"/>`,
    'chapéu': `<ellipse cx="100" cy="88" rx="66" ry="12" fill="${a.detalhe}"/><path d="M68 88 q4 -44 32 -44 q28 0 32 44z" fill="${a.detalhe}"/>`
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fundo}"/><stop offset="1" stop-color="#05070d"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff22"/><stop offset="1" stop-color="#00000000"/></radialGradient></defs>
<rect width="${larg}" height="${alt}" fill="url(#bg)"/><rect width="${larg}" height="${alt}" fill="url(#glow)"/>
<path d="M40 240 q0 -52 60 -62 q60 10 60 62z" fill="${a.roupa}"/>
<path d="M78 178 h44 v26 q-22 14 -44 0z" fill="${a.pele}"/>
<ellipse cx="100" cy="132" rx="46" ry="54" fill="${sombra}" opacity=".18"/>
${a.corte === 'longo' || a.corte === 'trança' ? `<path d="M50 120 q50 -46 100 0 l6 84 q-28 12 -36 -8 l-6 -58 h-32 l-6 58 q-8 20 -36 8z" fill="${a.cabelo}" opacity=".95"/>` : ''}
<ellipse cx="100" cy="128" rx="45" ry="53" fill="${a.pele}"/>
<ellipse cx="55" cy="134" rx="7" ry="10" fill="${a.pele}"/><ellipse cx="145" cy="134" rx="7" ry="10" fill="${a.pele}"/>
${a.barba && n.genero === 'M' ? `<path d="M60 134 q6 48 40 52 q34 -4 40 -52 q-12 32 -40 28 q-28 4 -40 -28z" fill="${a.cabelo}" opacity=".85"/>` : ''}
${cabelos[a.corte] || ''}
<path d="M70 107 q12 -8 24 -2M130 107 q-12 -8 -24 -2" stroke="${a.cabelo}" stroke-width="4.5" fill="none" stroke-linecap="round" opacity=".92"/>
<ellipse cx="82" cy="124" rx="9" ry="7" fill="#fdfdfd"/><ellipse cx="118" cy="124" rx="9" ry="7" fill="#fdfdfd"/>
<circle cx="83" cy="125" r="4.4" fill="${olhos}"/><circle cx="119" cy="125" r="4.4" fill="${olhos}"/>
<circle cx="84.6" cy="123.4" r="1.5" fill="#fff"/><circle cx="120.6" cy="123.4" r="1.5" fill="#fff"/>
<path d="M100 132 q-4 10 -6 14 q3 3 8 2.5" stroke="${sombra}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>
<path d="M88 164 q12 8 24 0" stroke="#8d4444" stroke-width="4" fill="none" stroke-linecap="round"/>
${acess[a.acess] || ''}
<rect x="0" y="212" width="${larg}" height="28" fill="#00000066"/>
<text x="100" y="231" font-family="ui-monospace,monospace" font-size="13" fill="#cfe6ff" text-anchor="middle">${esc(n.nome)}</text>
</svg>`;
}

/* Mapa grande com o sigilo estilizado */
function mapaSVG() {
  let ruas = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!isWallTile(x, y)) ruas += `<rect x="${x * 8}" y="${y * 8}" width="8" height="8" fill="#16203a"/>`;
  let preds = BLOCKS.map(b => `<rect x="${b.x0 * 8}" y="${b.y0 * 8}" width="${(b.x1 - b.x0 + 1) * 8}" height="${(b.y1 - b.y0 + 1) * 8}" fill="${b.cor}22" stroke="${b.cor}" stroke-width="1.2"/>`).join('');
  const cx = CIRCLE.x / TS * 8, cy = CIRCLE.y / TS * 8, r = CIRCLE.r / TS * 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${N * 8}" height="${N * 8}" viewBox="0 0 ${N * 8} ${N * 8}">
  <rect width="100%" height="100%" fill="#080b14"/>${ruas}${preds}
  ${sigiloSVG(cx, cy, r, '#c06bff', 1)}
  <text x="${cx}" y="${cy + r + 22}" fill="#c9a6ff" font-size="11" font-family="ui-monospace,monospace" text-anchor="middle">CÍRCULO DA PRAÇA</text></svg>`;
}

/* Inscrição geométrica estilizada, inspirada em sigilos ocultistas.
   Desenho original: círculos, pentáculo invertido estilizado, hastes e runas. */
function sigiloSVG(cx, cy, r, cor, op) {
  let p = '';
  p += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cor}" stroke-width="2" opacity="${op}"/>`;
  p += `<circle cx="${cx}" cy="${cy}" r="${r * .82}" fill="none" stroke="${cor}" stroke-width="1" opacity="${op * .8}"/>`;
  p += `<circle cx="${cx}" cy="${cy}" r="${r * .3}" fill="none" stroke="${cor}" stroke-width="1.5" opacity="${op}"/>`;
  // estrela de 5 pontas invertida
  let pts = [];
  for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i * 2 * Math.PI * 2) / 5; pts.push([cx + Math.cos(a) * r * .8, cy + Math.sin(a) * r * .8]); }
  p += `<polygon points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="${cor}" stroke-width="1.6" opacity="${op}"/>`;
  // hastes e cruzetas
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r * .3, y1 = cy + Math.sin(a) * r * .3;
    const x2 = cx + Math.cos(a) * r * .82, y2 = cy + Math.sin(a) * r * .82;
    p += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${cor}" stroke-width="1" opacity="${op * .7}"/>`;
    p += `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="${r * .045}" fill="${cor}" opacity="${op * .9}"/>`;
  }
  // haste central com travessões (motivo de sigilo)
  p += `<path d="M${cx} ${cy - r * .62} V${cy + r * .55} M${cx - r * .16} ${cy - r * .34} H${cx + r * .16} M${cx - r * .1} ${cy + r * .2} H${cx + r * .1}" stroke="${cor}" stroke-width="1.8" fill="none" opacity="${op}"/>`;
  p += `<path d="M${cx - r * .22} ${cy + r * .55} q${r * .22} ${r * .2} ${r * .44} 0" stroke="${cor}" stroke-width="1.6" fill="none" opacity="${op}"/>`;
  return p;
}

const PAGINA = "<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover\">\n<title>Porto Neon — ALPHA 0.3</title>\n<style>\n  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\n  html,body{margin:0;height:100%;background:#05070d;color:#dfe9ff;font-family:ui-sans-serif,system-ui,\"Segoe UI\",Roboto,sans-serif;overflow:hidden;overscroll-behavior:none}\n  canvas{display:block;width:100%;height:100%;touch-action:none}\n  #app{position:fixed;inset:0}\n  .hud{position:absolute;pointer-events:none;z-index:5}\n  .card{background:rgba(9,13,24,.92);border:1px solid #23304f;border-radius:12px;box-shadow:0 8px 30px #0009}\n  button{font:inherit;color:#dfe9ff;background:#16203a;border:1px solid #2b3a5e;border-radius:9px;padding:8px 11px;cursor:pointer}\n  button:hover{background:#1e2b4a}button:active{transform:translateY(1px)}\n  button.p{background:linear-gradient(180deg,#7a3ce0,#5722a8);border-color:#9a6bff}\n  button.d{background:linear-gradient(180deg,#c0392b,#8e2419);border-color:#ff7a68}\n  button.g{background:linear-gradient(180deg,#1f8f5f,#136b45);border-color:#49d59b}\n  select,input{font:inherit;color:#dfe9ff;background:#0d1426;border:1px solid #2b3a5e;border-radius:9px;padding:8px}\n  /* ---------- topo ---------- */\n  #top{top:8px;left:8px;right:8px;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}\n  #top>*{pointer-events:auto}\n  .chip{padding:7px 11px;font-size:13px;display:flex;gap:8px;align-items:center;white-space:nowrap}\n  .dot{width:8px;height:8px;border-radius:50%;background:#49d59b;box-shadow:0 0 8px #49d59b}\n  .bar{width:92px;height:8px;border-radius:5px;background:#1b2440;overflow:hidden}\n  .bar>i{display:block;height:100%;background:linear-gradient(90deg,#49d59b,#9ef5c8)}\n  /* ---------- painéis ---------- */\n  #painel{position:absolute;top:56px;right:8px;width:330px;max-height:calc(100% - 140px);overflow:auto;padding:12px;z-index:6;display:none}\n  #painel.on{display:block}\n  #painel h3{margin:0 0 8px;font-size:14px;letter-spacing:.06em;color:#c9a6ff;text-transform:uppercase}\n  .row{display:flex;gap:6px;margin-bottom:7px;align-items:center;flex-wrap:wrap}\n  .row>*{flex:1 1 auto}\n  .lab{font-size:11px;color:#8fa3c8;flex:0 0 100%;margin-bottom:-2px}\n  .evt{font-size:12px;color:#a9bde0;border-left:2px solid #2b3a5e;padding:3px 0 3px 7px;margin:3px 0}\n  .evt.ordem{border-color:#9a6bff;color:#d8c4ff}.evt.combate{border-color:#ff7a68;color:#ffc7bf}.evt.aviso{border-color:#ffd166;color:#ffe9b0}\n  #ficha{position:absolute;left:8px;bottom:104px;width:300px;padding:12px;z-index:12;display:none;max-height:56%;overflow:auto}\n  @media(max-width:899px){\n    #ficha{left:8px;right:8px;width:auto;bottom:112px;max-height:52%}\n    #painel{top:52px;left:8px;right:8px;width:auto;max-height:calc(100% - 230px)}\n    #pedidos{left:8px;right:8px;width:auto;bottom:112px}\n    #top{gap:6px}.chip{padding:6px 9px;font-size:12px}\n  }\n  #ficha.on{display:block}\n  #ficha img{width:76px;height:92px;border-radius:9px;border:1px solid #2b3a5e;object-fit:cover;background:#0d1426}\n  .need{display:flex;align-items:center;gap:6px;font-size:11px;margin:2px 0}\n  .need .bar{flex:1;height:6px}.need .bar>i{background:linear-gradient(90deg,#ffb03a,#ff5f5f)}\n  #toast{position:absolute;left:50%;transform:translateX(-50%);top:64px;z-index:20;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}\n  .t{padding:9px 14px;font-size:13px;animation:fade .3s}\n  @keyframes fade{from{opacity:0;transform:translateY(-8px)}}\n  /* ---------- caixa privada do líder ---------- */\n  #pedidos{position:absolute;right:8px;bottom:96px;width:300px;z-index:9;display:none;padding:12px;border-color:#9a6bff}\n  #pedidos.on{display:block}\n  #pedidos .pd{border-top:1px solid #2b3a5e;padding-top:8px;margin-top:8px;font-size:13px}\n  /* ---------- controles ---------- */\n  #ctrl{position:absolute;inset:auto 0 0 0;height:92px;z-index:8;pointer-events:none}\n  #stick{position:absolute;left:14px;bottom:14px;width:118px;height:118px;border-radius:50%;background:rgba(13,20,38,.6);border:1px solid #2b3a5e;pointer-events:auto;touch-action:none}\n  #stick i{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px;border-radius:50%;background:#2b3a5e;border:1px solid #4a5f92}\n  #btns{position:absolute;right:10px;bottom:12px;display:grid;grid-template-columns:repeat(3,58px);gap:7px;pointer-events:auto}\n  #btns button{height:50px;padding:0;font-size:12px}\n  .kbd{display:none}\n  @media(min-width:900px){#stick,#btns{display:none}.kbd{display:block}}\n  /* ---------- login ---------- */\n  #login{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,#1a1030,#05070d 70%)}\n  #login .box{width:min(430px,92vw);padding:26px;text-align:center}\n  #login h1{margin:0 0 4px;font-size:30px;letter-spacing:.14em;background:linear-gradient(90deg,#ff5f9e,#9a6bff,#39d3ff);-webkit-background-clip:text;background-clip:text;color:transparent}\n  #login p{color:#8fa3c8;font-size:13px;margin:6px 0 16px;line-height:1.5}\n  #login input{width:100%;text-align:center;margin-bottom:10px;padding:11px}\n  #login button{width:100%;padding:12px}\n  .small{font-size:11px;color:#7386ab;line-height:1.5}\n  #mapa{position:fixed;inset:0;z-index:30;background:rgba(3,5,10,.94);display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px}\n  #mapa.on{display:flex}\n  #mapa img{max-width:min(92vw,720px);max-height:74vh;border:1px solid #2b3a5e;border-radius:12px;background:#080b14}\n  ::-webkit-scrollbar{width:8px}::-webkit-scrollbar-thumb{background:#2b3a5e;border-radius:6px}\n</style>\n</head>\n<body>\n<div id=\"app\"><canvas id=\"cv\"></canvas></div>\n\n<div class=\"hud\" id=\"top\">\n  <div class=\"card chip\"><span class=\"dot\"></span><b id=\"cNome\">—</b><span id=\"cLider\" style=\"color:#c9a6ff\"></span></div>\n  <div class=\"card chip\">HORA <b id=\"cHora\">00:00</b></div>\n  <div class=\"card chip\">VIDA <span class=\"bar\"><i id=\"cHp\" style=\"width:100%\"></i></span><span id=\"cHpT\">160</span></div>\n  <div class=\"card chip\">ARMA <b id=\"cArma\">Soco</b></div>\n  <div class=\"card chip\">R$ <b id=\"cDin\">500</b></div>\n  <div class=\"card chip\" id=\"cVisao\">Visão normal</div>\n  <button class=\"card chip\" onclick=\"togglePainel()\">A Ordem</button>\n  <button class=\"card chip\" onclick=\"abrirMapa()\">Mapa</button>\n</div>\n\n<div class=\"card\" id=\"painel\">\n  <h3>A Ordem de Dantalion</h3>\n  <div id=\"boxLider\"></div>\n  <div class=\"row\"><div class=\"lab\">Comando</div><select id=\"fCmd\"></select></div>\n  <div class=\"row\"><div class=\"lab\">Destinatário</div><select id=\"fAlvo\"><option value=\"todos\">Todos os moradores</option></select></div>\n  <div class=\"row\" id=\"rowAdv\" style=\"display:none\"><div class=\"lab\">Adversário (duelo)</div><select id=\"fAdv\"></select></div>\n  <div class=\"row\"><div class=\"lab\">Horário (relógio do jogo)</div>\n    <select id=\"fQuando\" style=\"flex:0 0 96px\"><option value=\"agora\">Agora</option><option value=\"hora\">Às…</option></select>\n    <input id=\"fHora\" value=\"00:00\" placeholder=\"HH:MM\" style=\"flex:0 0 84px\">\n  </div>\n  <div class=\"row\"><button class=\"p\" onclick=\"enviarComando()\">Emitir ordem</button></div>\n  <div class=\"row\"><div class=\"lab\">Ou escreva: “À meia-noite, todos no círculo da praça”</div>\n    <input id=\"fTexto\" placeholder=\"Ordem: Dancem às 00:00\"><button onclick=\"enviarTexto()\">Enviar</button></div>\n  <div class=\"row\"><label class=\"small\" style=\"display:flex;gap:7px;align-items:center\"><input type=\"checkbox\" id=\"fConv\" checked style=\"flex:0 0 auto;width:16px;height:16px\"> Convergência mística (posiciona no círculo)</label></div>\n  <div class=\"row\"><button onclick=\"toggleMusica()\" id=\"btMus\">Ouvir música ritual</button></div>\n  <h3 style=\"margin-top:14px\">Ordens ativas</h3><div id=\"listaOrdens\" class=\"small\">Nenhuma.</div>\n  <h3 style=\"margin-top:14px\">Acontecimentos</h3><div id=\"eventos\"></div>\n  <h3 style=\"margin-top:14px\">Controles</h3>\n  <div class=\"small\">Computador: <b>WASD</b> andar · <b>setas</b> olhar · arrastar o cenário · <b>V</b> visão · <b>B</b> arsenal · <b>Espaço</b> atacar · <b>G</b> recolher · <b>E</b> interagir.<br>Celular: analógico, arrastar para olhar e os botões abaixo.</div>\n  <h3 style=\"margin-top:14px\">Arsenal</h3><div id=\"arsenal\" class=\"row\"></div>\n</div>\n\n<div class=\"card\" id=\"ficha\"></div>\n<div class=\"card\" id=\"pedidos\"></div>\n<div id=\"toast\"></div>\n\n<div id=\"ctrl\">\n  <div id=\"stick\"><i></i></div>\n  <div id=\"btns\">\n    <button onclick=\"acao('atacar')\">Atacar</button>\n    <button onclick=\"acao('interagir')\">Falar</button>\n    <button onclick=\"acao('recolher')\">Pegar</button>\n    <button onclick=\"acao('visao')\">Visão</button>\n    <button onclick=\"acao('arsenal')\">Arsenal</button>\n    <button onclick=\"togglePainel()\">Ordem</button>\n  </div>\n</div>\n\n<div id=\"mapa\" onclick=\"fecharMapa()\"><img id=\"mapaImg\" alt=\"Mapa de Porto Neon\"><div class=\"small\">Toque para fechar</div></div>\n\n<div id=\"login\"><div class=\"box card\">\n  <h1>PORTO NEON</h1>\n  <div style=\"color:#c9a6ff;letter-spacing:.3em;font-size:12px;margin-bottom:10px\">ALPHA 0.3 — O VÉU NOTURNO</div>\n  <p>36 moradores com rotinas, necessidades e memórias. Exploração em primeira pessoa, a Ordem de Dantalion e o círculo da praça.</p>\n  <input id=\"inNome\" maxlength=\"18\" placeholder=\"Seu nome\" autocomplete=\"off\">\n  <button class=\"p\" onclick=\"entrar()\">Entrar em Porto Neon</button>\n  <p class=\"small\" style=\"margin-top:14px\">Protótipo com inteligência local e ações pré-programadas. Não compreende ordens livres. Violência simbólica, sem gore.</p>\n</div></div>\n\n<script src=\"/socket.io/socket.io.js\"></script>\n<script>\n/* ===================== ESTADO DO CLIENTE ===================== */\nvar socket=null, EU=null, MUNDO=null, GRID=null, BLOCOS=[], NPCLIST=[], ARMAS={}, COMANDOS=[];\nvar S={npcs:[],players:[],saques:[],ordens:[],eventos:[],hora:'00:00',lider:null,ritual:false};\nvar prim=false, souLider=false, dinheiro=500, fichaAberta=null;\nvar cam={x:0,y:0,ang:-Math.PI/2};\nvar teclas={}, joy={x:0,y:0,ativo:false};\nvar cv=document.getElementById('cv'), ctx=cv.getContext('2d',{alpha:false});\nvar W=1,H=1,DPR=1;\nvar spriteCache={};\n\nfunction redim(){DPR=Math.min(2,window.devicePixelRatio||1);W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.floor(W*DPR);cv.height=Math.floor(H*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);ctx.imageSmoothingEnabled=false;}\nwindow.addEventListener('resize',redim);\n\nfunction toast(txt,tipo){var d=document.createElement('div');d.className='card t';if(tipo==='erro')d.style.borderColor='#ff7a68';if(tipo==='ok')d.style.borderColor='#49d59b';d.textContent=txt;document.getElementById('toast').appendChild(d);setTimeout(function(){d.remove();},4200);}\n\n/* ===================== ENTRAR ===================== */\nfunction entrar(){\n  var nome=(document.getElementById('inNome').value||'').trim()||'Visitante';\n  socket=io();\n  socket.on('connect',function(){socket.emit('entrar',nome);});\n  socket.on('bemvindo',function(d){\n    EU=d.voce;MUNDO=d.mundo;BLOCOS=d.blocos;NPCLIST=d.npcs;ARMAS=d.armas;COMANDOS=d.comandos;\n    GRID=Uint8Array.from(atob(d.grid),function(c){return c.charCodeAt(0);});\n    cam.x=EU.x;cam.y=EU.y;cam.ang=EU.ang;\n    document.getElementById('login').style.display='none';\n    document.getElementById('cNome').textContent=EU.nome;\n    montarFormulario();redim();requestAnimationFrame(loop);\n  });\n  socket.on('estado',function(st){\n    S=st;document.getElementById('cHora').textContent=st.hora;\n    var me=st.players.find(function(p){return p.id===(EU&&EU.id);});\n    if(me){var vivo=EU;EU=Object.assign(vivo||{},me);\n      document.getElementById('cHp').style.width=Math.max(0,me.hp/me.hpMax*100)+'%';\n      document.getElementById('cHpT').textContent=Math.round(me.hp);\n      document.getElementById('cArma').textContent=(ARMAS[me.arma]||{}).nome||'Soco';\n      souLider=me.lider;document.getElementById('cLider').textContent=me.lider?'· LÍDER':'';\n      if(!arrastando&&(me.preso)){cam.x=me.x;cam.y=me.y;}\n    }\n    document.getElementById('cDin').textContent=dinheiro;\n    renderPainel();\n  });\n  socket.on('aviso',function(a){toast(a.texto,a.tipo==='erro'?'erro':a.tipo==='ok'?'ok':'');});\n  socket.on('lideranca',function(){toast('Liderança autenticada. Espada de fogo e invulnerabilidade ativas.','ok');});\n  socket.on('novaOrdem',function(o){toast('Nova ordem: '+o.nome+' ('+o.hora+') — '+o.autor);});\n  socket.on('ficha',function(f){mostrarFicha(f);});\n  socket.on('pedido',function(p){addPedido(p);});\n  socket.on('combate',function(r){if(!r.ok&&r.motivo==='distancia')toast('Muito longe.','erro');if(!r.ok&&r.motivo==='parede')toast('Há uma parede no caminho.','erro');if(!r.ok&&r.motivo==='protegido')toast('O alvo está protegido.','erro');});\n  socket.on('golpe',function(g){flashes.push({para:g.para,t:performance.now()});});\n}\ndocument.getElementById('inNome').addEventListener('keydown',function(e){if(e.key==='Enter')entrar();});\nvar flashes=[];\n\n/* ===================== FORMULÁRIO DA ORDEM ===================== */\nfunction montarFormulario(){\n  var c=document.getElementById('fCmd');c.innerHTML='';\n  COMANDOS.forEach(function(k){var o=document.createElement('option');o.value=k.k;o.textContent=k.nome;c.appendChild(o);});\n  c.onchange=function(){document.getElementById('rowAdv').style.display=(c.value==='duelo')?'flex':'none';};\n  var a=document.getElementById('fAlvo'),b=document.getElementById('fAdv');\n  NPCLIST.forEach(function(n){\n    var o=document.createElement('option');o.value=n.id;o.textContent=n.nome+' — '+n.profissao;a.appendChild(o);\n    var o2=o.cloneNode(true);b.appendChild(o2);\n  });\n  document.getElementById('fConv').onchange=function(){if(socket)socket.emit('convergencia',this.checked);};\n  renderArsenal();\n}\nfunction renderArsenal(){\n  var el=document.getElementById('arsenal');el.innerHTML='';\n  var inv=(EU&&EU.inventario)||['soco'];\n  ['soco','faca','taco','espada','espada_fogo'].forEach(function(k){\n    if(k==='espada_fogo'&&!souLider)return;\n    var b=document.createElement('button');\n    var tem=inv.indexOf(k)>=0;\n    b.textContent=(ARMAS[k]||{}).nome||k;b.style.opacity=tem?1:.45;\n    if(k==='espada_fogo')b.className='d';\n    b.onclick=function(){socket.emit('equipar',k);};\n    el.appendChild(b);\n  });\n}\nfunction enviarComando(){\n  var spec={cmd:document.getElementById('fCmd').value};\n  var alvo=document.getElementById('fAlvo').value;\n  if(alvo!=='todos'){spec.alvo='um';spec.alvoId=alvo;}\n  if(spec.cmd==='duelo')spec.adversarioId=document.getElementById('fAdv').value;\n  if(document.getElementById('fQuando').value==='hora')spec.hora=document.getElementById('fHora').value;\n  socket.emit('comando',spec);\n}\nfunction enviarTexto(){\n  var i=document.getElementById('fTexto');if(!i.value.trim())return;\n  socket.emit('comando',{texto:i.value});i.value='';\n}\nfunction togglePainel(){\n  var p=document.getElementById('painel');p.classList.toggle('on');\n  if(p.classList.contains('on')&&window.innerWidth<900)document.getElementById('ficha').classList.remove('on');\n}\nfunction abrirMapa(){document.getElementById('mapaImg').src='/mapa.svg?'+Date.now();document.getElementById('mapa').classList.add('on');}\nfunction fecharMapa(){document.getElementById('mapa').classList.remove('on');}\n\nfunction renderPainel(){\n  var lo=document.getElementById('listaOrdens');\n  lo.innerHTML=S.ordens.length?S.ordens.map(function(o){\n    return '<div class=\"evt ordem\">'+o.nome+' · '+o.hora+' · '+(o.iniciada?('ativa '+o.resta+'s'):'agendada')+' · '+(o.alvo||'todos')+' · mensageiros: '+o.mensageiros+'</div>';\n  }).join(''):'<div class=\"small\">Nenhuma.</div>';\n  document.getElementById('eventos').innerHTML=S.eventos.map(function(e){return '<div class=\"evt '+e.tipo+'\">['+e.t+'] '+e.texto+'</div>';}).join('');\n  var bl=document.getElementById('boxLider');\n  if(souLider){bl.innerHTML='<div class=\"evt ordem\">Você lidera a Ordem. Espada de fogo e invulnerabilidade ativas.</div>';}\n  else{bl.innerHTML='<div class=\"row\"><button class=\"p\" onclick=\"assumir()\">Assumir liderança</button></div><div class=\"small\" style=\"margin-bottom:8px\">Pedidos de visitante aguardam aprovação do líder'+(S.lider?' ('+S.lider+')':'')+'.</div>';}\n}\nfunction assumir(){\n  var c=prompt('Código de liderança (definido por você em LEADER_CODE):');\n  if(c)socket.emit('assumirLideranca',c);\n}\nfunction addPedido(p){\n  var box=document.getElementById('pedidos');box.classList.add('on');\n  var d=document.createElement('div');d.className='pd';\n  d.innerHTML='<b>'+p.autor+'</b> pede: '+p.nome+' ('+p.hora+') — '+p.alvo+\n    '<div class=\"row\" style=\"margin-top:6px\">'+\n    '<button class=\"g\" data-a=\"aprovar\">Obedecer</button><button data-a=\"cadeia\">Cadeia</button>'+\n    '<button data-a=\"crucificar\">Crucificar</button><button class=\"d\" data-a=\"atacar\">Atacar</button>'+\n    '<button data-a=\"ignorar\">Ignorar</button></div>';\n  d.querySelectorAll('button').forEach(function(b){b.onclick=function(){socket.emit('decidirPedido',{id:p.id,decisao:b.dataset.a});d.remove();if(!box.querySelector('.pd'))box.classList.remove('on');};});\n  if(!box.querySelector('h3'))box.innerHTML='<h3>Caixa privada da liderança</h3>';\n  box.appendChild(d);\n}\nfunction mostrarFicha(f){\n  fichaAberta=f.id;\n  if(window.innerWidth<900)document.getElementById('painel').classList.remove('on');\n  var el=document.getElementById('ficha');el.classList.add('on');\n  var needs=Object.keys(f.necessidades).map(function(k){\n    return '<div class=\"need\"><span style=\"width:56px\">'+k+'</span><span class=\"bar\"><i style=\"width:'+f.necessidades[k]+'%\"></i></span></div>';}).join('');\n  el.innerHTML='<div style=\"display:flex;gap:10px\"><img src=\"'+f.retrato+'\" alt=\"\">'+\n    '<div style=\"flex:1\"><b>'+f.nome+'</b><div class=\"small\">'+f.profissao+' · '+f.idade+' anos · nível '+f.nivel+'</div>'+\n    '<div class=\"small\">Agora: '+f.acao+' · humor '+f.humor+'</div>'+\n    '<div class=\"small\">Relação com você: '+f.relacao+'</div></div></div>'+\n    '<div class=\"small\" style=\"margin:8px 0\">'+f.bio+'</div>'+needs+\n    (f.segredo?'<div class=\"evt ordem\" style=\"margin-top:6px\">Confidência: '+f.segredo+'</div>':'<div class=\"small\" style=\"margin-top:6px\">Ainda não confia o bastante para contar segredos.</div>')+\n    '<div class=\"small\" style=\"margin-top:8px\"><b>Memórias</b></div>'+f.mem.map(function(m){return '<div class=\"evt\">['+m.t+'] '+m.texto+'</div>';}).join('')+\n    (f.boatos.length?'<div class=\"small\" style=\"margin-top:6px\"><b>Boatos</b></div>'+f.boatos.map(function(m){return '<div class=\"evt aviso\">'+m.texto+'</div>';}).join(''):'')+\n    '<div class=\"row\" style=\"margin-top:8px\"><button class=\"g\" id=\"btElogio\">Elogiar</button><button id=\"btFechaFicha\">Fechar</button></div>';\n  el.querySelector('#btElogio').onclick=function(){socket.emit('elogiar',f.id);};\n  el.querySelector('#btFechaFicha').onclick=function(){el.classList.remove('on');fichaAberta=null;};\n}\n\n/* ===================== CONTROLES ===================== */\nwindow.addEventListener('keydown',function(e){\n  if(e.target.tagName==='INPUT')return;\n  teclas[e.key.toLowerCase()]=true;\n  var k=e.key.toLowerCase();\n  if(k==='v'){prim=!prim;document.getElementById('cVisao').textContent=prim?'Primeira pessoa':'Visão normal';}\n  if(k==='b')togglePainel();\n  if(k===' '){e.preventDefault();acao('atacar');}\n  if(k==='g')acao('recolher');\n  if(k==='e')acao('interagir');\n});\nwindow.addEventListener('keyup',function(e){teclas[e.key.toLowerCase()]=false;});\n\nvar arrastando=false,lastX=0;\ncv.addEventListener('pointerdown',function(e){arrastando=true;lastX=e.clientX;cv.setPointerCapture(e.pointerId);});\ncv.addEventListener('pointermove',function(e){if(!arrastando)return;var dx=e.clientX-lastX;lastX=e.clientX;cam.ang+=dx*0.005;});\ncv.addEventListener('pointerup',function(e){arrastando=false;});\ncv.addEventListener('pointercancel',function(){arrastando=false;});\n\nvar st=document.getElementById('stick'),knob=st.querySelector('i');\nst.addEventListener('pointerdown',function(e){joy.ativo=true;st.setPointerCapture(e.pointerId);moverStick(e);});\nst.addEventListener('pointermove',function(e){if(joy.ativo)moverStick(e);});\nst.addEventListener('pointerup',function(){joy.ativo=false;joy.x=joy.y=0;knob.style.transform='';});\nfunction moverStick(e){\n  var r=st.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;\n  var dx=(e.clientX-cx)/(r.width/2),dy=(e.clientY-cy)/(r.height/2);\n  var m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}\n  joy.x=dx;joy.y=dy;knob.style.transform='translate('+dx*34+'px,'+dy*34+'px)';\n}\nfunction acao(a){\n  if(!socket)return;\n  if(a==='atacar')socket.emit('atacar',null);\n  else if(a==='recolher')socket.emit('recolher');\n  else if(a==='interagir'){var n=npcProximo();if(n)socket.emit('interagir',n.id);else toast('Ninguém por perto.','erro');}\n  else if(a==='visao'){prim=!prim;document.getElementById('cVisao').textContent=prim?'Primeira pessoa':'Visão normal';}\n  else if(a==='arsenal'){togglePainel();renderArsenal();}\n}\nfunction npcProximo(){\n  if(!EU)return null;var melhor=null,md=1e9;\n  S.npcs.forEach(function(n){if(n.morto)return;var d=Math.hypot(n.x-EU.x,n.y-EU.y);if(d<110&&d<md){md=d;melhor=n;}});\n  return melhor;\n}\n\n/* ===================== MÚSICA RITUAL (sintetizada) ===================== */\nvar AC=null,musOn=false,musTimer=null;\nfunction toggleMusica(){\n  if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();\n  if(AC.state==='suspended')AC.resume();\n  musOn=!musOn;document.getElementById('btMus').textContent=musOn?'Parar música ritual':'Ouvir música ritual';\n  if(musOn)tocar();else if(musTimer){clearInterval(musTimer);musTimer=null;}\n}\nfunction tocar(){\n  var escala=[0,3,5,7,10,12,15],base=110,passo=0;\n  var pad=AC.createOscillator(),pg=AC.createGain(),f=AC.createBiquadFilter();\n  pad.type='sawtooth';pad.frequency.value=55;f.type='lowpass';f.frequency.value=420;pg.gain.value=0.05;\n  pad.connect(f);f.connect(pg);pg.connect(AC.destination);pad.start();\n  musTimer=setInterval(function(){\n    if(!musOn){pad.stop();return;}\n    var t=AC.currentTime;\n    var n=escala[(passo*3)%escala.length];\n    var o=AC.createOscillator(),g=AC.createGain();\n    o.type=passo%4===0?'triangle':'sine';\n    o.frequency.value=base*Math.pow(2,n/12)*(passo%8<4?1:1.5);\n    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.14,t+0.03);\n    g.gain.exponentialRampToValueAtTime(0.001,t+0.65);\n    o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+0.7);\n    if(passo%8===0){ // tambor\n      var b=AC.createOscillator(),bg=AC.createGain();b.type='sine';b.frequency.setValueAtTime(120,t);\n      b.frequency.exponentialRampToValueAtTime(40,t+0.25);bg.gain.setValueAtTime(0.5,t);\n      bg.gain.exponentialRampToValueAtTime(0.001,t+0.4);b.connect(bg);bg.connect(AC.destination);b.start(t);b.stop(t+0.45);\n    }\n    passo++;\n  },340);\n}\n\n/* ===================== SPRITES DE AVATAR ===================== */\nfunction spriteAvatar(ap,pose,arma,lider){\n  var key=[ap.pele,ap.cabelo,ap.roupa,ap.detalhe,ap.corte,ap.acess,ap.barba?1:0,pose,arma||'',lider?1:0].join('|');\n  if(spriteCache[key])return spriteCache[key];\n  var w=64,h=96,c=document.createElement('canvas');c.width=w;c.height=h;var g=c.getContext('2d');\n  var cx=32;\n  function perna(x,dy){g.fillStyle='#22283a';g.fillRect(x,66+dy,9,26);}\n  function braco(x,y,ang,len){g.save();g.translate(x,y);g.rotate(ang);g.fillStyle=ap.pele;g.fillRect(-4,0,8,len);g.restore();}\n  var lean=0;\n  if(pose==='deitar'||pose==='cruz'){/* tratado na projeção */}\n  // pernas\n  if(pose==='andar'){perna(22,0);perna(33,-3);}else if(pose==='dancar'){perna(20,-4);perna(35,2);}else{perna(22,0);perna(33,0);}\n  // corpo\n  g.fillStyle=ap.roupa;g.beginPath();g.moveTo(18,34);g.lineTo(46,34);g.lineTo(48,70);g.lineTo(16,70);g.closePath();g.fill();\n  g.fillStyle=ap.detalhe;g.fillRect(30,34,4,36);\n  // braços conforme pose\n  if(pose==='dancar'){braco(20,36,0.9,26);braco(44,36,-0.9,26);}\n  else if(pose==='cruz'||pose==='oferenda'){braco(20,38,1.55,26);braco(44,38,-1.55,26);}\n  else if(pose==='cantar'){braco(20,36,0.5,24);braco(44,36,-0.5,24);}\n  else if(pose==='duelo'||pose==='patrulha'){braco(20,38,0.25,24);braco(44,38,-1.1,26);}\n  else{braco(20,38,0.15,26);braco(44,38,-0.15,26);}\n  // cabeça\n  g.fillStyle=ap.pele;g.beginPath();g.arc(cx,24,13,0,7);g.fill();\n  if(ap.barba){g.fillStyle=ap.cabelo;g.beginPath();g.arc(cx,29,11,0,Math.PI);g.fill();}\n  // cabelo\n  g.fillStyle=ap.cabelo;\n  if(ap.corte!=='careca'){\n    g.beginPath();g.arc(cx,22,13,Math.PI,0);g.fill();\n    if(ap.corte==='longo'||ap.corte==='trança'){g.fillRect(19,22,26,18);}\n    if(ap.corte==='coque'){g.beginPath();g.arc(cx,8,6,0,7);g.fill();}\n    if(ap.corte==='moicano'){g.fillRect(cx-3,4,6,16);}\n  }\n  // olhos\n  g.fillStyle='#10131c';g.fillRect(27,22,3,3);g.fillRect(35,22,3,3);\n  // acessório\n  if(ap.acess==='óculos'){g.strokeStyle='#10131c';g.lineWidth=2;g.strokeRect(25,20,7,6);g.strokeRect(34,20,7,6);g.beginPath();g.moveTo(32,23);g.lineTo(34,23);g.stroke();}\n  if(ap.acess==='boné'){g.fillStyle=ap.detalhe;g.fillRect(19,12,26,6);g.fillRect(19,18,32,3);}\n  if(ap.acess==='chapéu'){g.fillStyle=ap.detalhe;g.fillRect(14,16,36,3);g.fillRect(24,6,16,10);}\n  if(ap.acess==='fone'){g.fillStyle=ap.detalhe;g.fillRect(16,20,5,10);g.fillRect(43,20,5,10);g.fillRect(16,12,32,3);}\n  if(ap.acess==='cachecol'||ap.acess==='lenço'){g.fillStyle=ap.detalhe;g.fillRect(19,33,26,6);}\n  if(ap.acess==='brinco'){g.fillStyle=ap.detalhe;g.fillRect(18,26,3,3);g.fillRect(44,26,3,3);}\n  // arma visível\n  if(arma&&arma!=='soco'){\n    if(arma==='espada_fogo'){\n      var grd=g.createLinearGradient(50,10,58,50);grd.addColorStop(0,'#fff2a0');grd.addColorStop(.5,'#ff8a3a');grd.addColorStop(1,'#ff2f2f');\n      g.fillStyle=grd;g.fillRect(50,12,6,42);g.fillStyle='#3a2a1a';g.fillRect(48,54,10,4);\n      g.globalAlpha=.4;g.fillStyle='#ff8a3a';g.fillRect(46,8,14,50);g.globalAlpha=1;\n    } else if(arma==='espada'){g.fillStyle='#cfd8ea';g.fillRect(50,18,5,34);g.fillStyle='#6b4a2a';g.fillRect(48,52,9,4);}\n    else if(arma==='faca'){g.fillStyle='#cfd8ea';g.fillRect(50,34,4,16);g.fillStyle='#3a2a1a';g.fillRect(49,50,6,4);}\n    else if(arma==='taco'){g.fillStyle='#b98a4a';g.fillRect(50,20,6,34);}\n  }\n  if(lider){g.fillStyle='#ffd166';g.beginPath();g.moveTo(24,8);g.lineTo(28,2);g.lineTo(32,8);g.lineTo(36,2);g.lineTo(40,8);g.closePath();g.fill();}\n  spriteCache[key]=c;return c;\n}\n\n/* ===================== MOVIMENTO LOCAL ===================== */\nvar tPrev=performance.now();\nfunction entrada(dt){\n  if(!EU)return;\n  var fx=0,fy=0;\n  if(teclas['w'])fy-=1;if(teclas['s'])fy+=1;if(teclas['a'])fx-=1;if(teclas['d'])fx+=1;\n  if(teclas['arrowleft'])cam.ang-=1.9*dt;if(teclas['arrowright'])cam.ang+=1.9*dt;\n  fx+=joy.x;fy+=joy.y;\n  var vx=0,vy=0;\n  if(fx||fy){\n    if(prim){ // relativo à câmera\n      var f=-fy,s=fx;\n      vx=Math.cos(cam.ang)*f-Math.sin(cam.ang)*s;\n      vy=Math.sin(cam.ang)*f+Math.cos(cam.ang)*s;\n    } else {vx=fx;vy=fy;}\n    var m=Math.hypot(vx,vy)||1;vx/=m;vy/=m;\n    if(prim)cam.ang=cam.ang; // mantém direção do olhar\n  }\n  socket.emit('mover',{vx:vx,vy:vy,dt:dt,ang:cam.ang});\n  // câmera segue\n  cam.x+=(EU.x-cam.x)*Math.min(1,dt*10);cam.y+=(EU.y-cam.y)*Math.min(1,dt*10);\n}\n\n/* ===================== RENDER ===================== */\nfunction loop(t){\n  var dt=Math.min(.05,(t-tPrev)/1000);tPrev=t;\n  entrada(dt);\n  if(prim)renderPrimeira();else renderTopo();\n  requestAnimationFrame(loop);\n}\nfunction ehParede(tx,ty){\n  if(tx<0||ty<0||tx>=MUNDO.N||ty>=MUNDO.N)return 1;\n  return GRID[ty*MUNDO.N+tx];\n}\nfunction corParede(tx,ty){\n  for(var i=0;i<BLOCOS.length;i++){var b=BLOCOS[i];if(tx>=b.x0&&tx<=b.x1&&ty>=b.y0&&ty<=b.y1)return b.cor;}\n  return '#3a4668';\n}\nvar corCache={};\nfunction corParedeC(tx,ty){var k=tx+','+ty;if(corCache[k])return corCache[k];var c=corParede(tx,ty);if(c.indexOf('#')!==0||c.length>7)c='#3a4668';corCache[k]=c;return c;}\nfunction sombrear(hex,f){\n  var r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16);\n  return 'rgb('+Math.round(r*f)+','+Math.round(g*f)+','+Math.round(b*f)+')';\n}\n\n/* --------- PRIMEIRA PESSOA (raycaster retrô 2,5D) --------- */\nvar zbuf=[];\nfunction renderPrimeira(){\n  var TS=MUNDO.TS;\n  var px=EU.x/TS,py=EU.y/TS,ang=cam.ang;\n  var fov=Math.PI/2.6, proj=(W/2)/Math.tan(fov/2), horizonte=H*0.5;\n  // céu e chão\n  var g1=ctx.createLinearGradient(0,0,0,horizonte);\n  g1.addColorStop(0,'#0a0a18');g1.addColorStop(1,S.ritual?'#3a1250':'#141d38');\n  ctx.fillStyle=g1;ctx.fillRect(0,0,W,horizonte);\n  var g2=ctx.createLinearGradient(0,horizonte,0,H);\n  g2.addColorStop(0,'#141a28');g2.addColorStop(1,'#0a0d16');\n  ctx.fillStyle=g2;ctx.fillRect(0,horizonte,W,H-horizonte);\n\n  var passo=Math.max(1,Math.floor(W/420));\n  zbuf=new Array(Math.ceil(W/passo));\n  for(var i=0,col=0;i<W;i+=passo,col++){\n    var camX=2*(i+passo/2)/W-1;\n    var ra=ang+Math.atan(camX*Math.tan(fov/2));\n    var dx=Math.cos(ra),dy=Math.sin(ra);\n    var mx=Math.floor(px),my=Math.floor(py);\n    var ddx=Math.abs(1/(dx||1e-6)),ddy=Math.abs(1/(dy||1e-6));\n    var sx,sy,sdx,sdy;\n    if(dx<0){sx=-1;sdx=(px-mx)*ddx;}else{sx=1;sdx=(mx+1-px)*ddx;}\n    if(dy<0){sy=-1;sdy=(py-my)*ddy;}else{sy=1;sdy=(my+1-py)*ddy;}\n    var lado=0,hit=0,guard=0;\n    while(!hit&&guard++<120){\n      if(sdx<sdy){sdx+=ddx;mx+=sx;lado=0;}else{sdy+=ddy;my+=sy;lado=1;}\n      if(ehParede(mx,my))hit=1;\n    }\n    var pd=lado===0?(sdx-ddx):(sdy-ddy);\n    if(pd<0.05)pd=0.05;\n    zbuf[col]=pd;\n    var alturaP=1.35;\n    var h=proj*alturaP/pd;\n    var topo=horizonte-h*0.72, base=horizonte+h*0.28;\n    var cor=corParedeC(mx,my);\n    var f=Math.max(.18,Math.min(1,1.35/(1+pd*0.28)))*(lado?0.72:1);\n    ctx.fillStyle=sombrear(cor,f*0.55);\n    ctx.fillRect(i,topo,passo,base-topo);\n    // janelas neon\n    var jy=topo+(base-topo)*0.25;\n    if(((mx*7+my*3)%3===0)&&pd<9){\n      ctx.fillStyle='rgba(255,220,140,'+Math.max(0,0.5-pd*0.045)+')';\n      ctx.fillRect(i,jy,passo,Math.max(1,(base-topo)*0.09));\n      ctx.fillStyle='rgba(120,220,255,'+Math.max(0,0.35-pd*0.035)+')';\n      ctx.fillRect(i,jy+(base-topo)*0.26,passo,Math.max(1,(base-topo)*0.07));\n    }\n    // topo do prédio\n    ctx.fillStyle=sombrear(cor,Math.min(1,f*0.9));\n    ctx.fillRect(i,topo-2,passo,2);\n  }\n  desenharSigiloChao(px,py,ang,proj,horizonte);\n  desenharSprites(px,py,ang,proj,horizonte,passo);\n  desenharMira();\n  minimapa();\n}\nfunction projPonto(wx,wy,px,py,ang,proj,horizonte,alturaOlho){\n  var dx=wx-px,dy=wy-py;\n  var depth=dx*Math.cos(ang)+dy*Math.sin(ang);\n  var side=-dx*Math.sin(ang)+dy*Math.cos(ang);\n  if(depth<=0.08)return null;\n  return {x:W/2+(side/depth)*proj,y:horizonte+(alturaOlho/depth)*proj,d:depth};\n}\nfunction desenharSigiloChao(px,py,ang,proj,horizonte){\n  var TS=MUNDO.TS,C=MUNDO.circulo,R=C.r/TS,cx=C.x/TS,cy=C.y/TS;\n  var pulso=S.ritual?0.55+0.45*Math.sin(performance.now()/380):0.32;\n  ctx.lineWidth=2;\n  [1,.82,.3].forEach(function(k){\n    ctx.strokeStyle='rgba(192,107,255,'+pulso*(k===1?.9:.5)+')';\n    ctx.beginPath();var start=true;\n    for(var a=0;a<=Math.PI*2+0.1;a+=0.12){\n      var p=projPonto(cx+Math.cos(a)*R*k,cy+Math.sin(a)*R*k,px,py,ang,proj,horizonte,0.5);\n      if(!p){start=true;continue;}\n      if(start){ctx.moveTo(p.x,p.y);start=false;}else ctx.lineTo(p.x,p.y);\n    }\n    ctx.stroke();\n  });\n  // estrela\n  ctx.strokeStyle='rgba(255,120,220,'+pulso*.8+')';ctx.beginPath();\n  var pts=[],ok=true;\n  for(var i=0;i<6;i++){var a=Math.PI/2+(i*2*Math.PI*2)/5;var p=projPonto(cx+Math.cos(a)*R*.8,cy+Math.sin(a)*R*.8,px,py,ang,proj,horizonte,0.5);if(!p){ok=false;break;}pts.push(p);}\n  if(ok){ctx.moveTo(pts[0].x,pts[0].y);for(var j=1;j<pts.length;j++)ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();}\n  // velas\n  for(var v=0;v<12;v++){\n    var a2=(v/12)*Math.PI*2;\n    var p2=projPonto(cx+Math.cos(a2)*R*1.02,cy+Math.sin(a2)*R*1.02,px,py,ang,proj,horizonte,0.5);\n    if(!p2)continue;\n    var s=Math.max(1.5,proj*0.06/p2.d);\n    var fl=0.7+0.3*Math.sin(performance.now()/120+v);\n    ctx.fillStyle='rgba(255,190,90,'+fl+')';\n    ctx.fillRect(p2.x-s/2,p2.y-s*2.2,s,s*2.2);\n    ctx.fillStyle='rgba(255,240,180,'+fl+')';\n    ctx.beginPath();ctx.arc(p2.x,p2.y-s*2.6,s*0.7,0,7);ctx.fill();\n  }\n}\nfunction entidades(){\n  var arr=[];\n  S.npcs.forEach(function(n){if(!n.morto)arr.push(n);});\n  S.players.forEach(function(p){if(!EU||p.id!==EU.id)arr.push(p);});\n  S.saques.forEach(function(s){arr.push({saque:true,x:s.x,y:s.y,arma:s.arma,id:s.id,resta:s.resta});});\n  return arr;\n}\nfunction desenharSprites(px,py,ang,proj,horizonte,passo){\n  var TS=MUNDO.TS;\n  var lista=entidades().map(function(e){\n    var p=projPonto(e.x/TS,e.y/TS,px,py,ang,proj,horizonte,0.5);\n    return p?{e:e,p:p}:null;\n  }).filter(Boolean).sort(function(a,b){return b.p.d-a.p.d;});\n  lista.forEach(function(it){\n    var e=it.e,p=it.p;\n    if(p.d>26)return;\n    var altura=(e.saque?0.35:(e.apar?e.apar.altura:1)*0.92);\n    var hpx=(altura/p.d)*proj, wpx=hpx*0.66;\n    var x0=p.x-wpx/2,y0=p.y-hpx;\n    // z-test pelo centro\n    var col=Math.floor(p.x/passo);\n    if(zbuf[col]!==undefined&&p.d>zbuf[col]+0.25)return;\n    if(e.saque){\n      ctx.fillStyle='rgba(255,209,102,.9)';\n      ctx.fillRect(p.x-wpx*0.18,p.y-hpx,wpx*0.36,hpx);\n      ctx.fillStyle='rgba(255,209,102,.25)';ctx.beginPath();ctx.ellipse(p.x,p.y,wpx*0.5,wpx*0.2,0,0,7);ctx.fill();\n      if(p.d<6){ctx.fillStyle='#ffd166';ctx.font='11px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText((ARMAS[e.arma]||{}).nome+' ('+e.resta+'s)',p.x,y0-6);}\n      return;\n    }\n    var pose=e.pose||'idle';\n    var sp=spriteAvatar(e.apar,pose,e.arma||(e.tipo==='player'?e.arma:null),e.lider);\n    ctx.save();\n    // sombra\n    ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(p.x,p.y,wpx*0.42,wpx*0.15,0,0,7);ctx.fill();\n    if(pose==='deitar'){\n      ctx.translate(p.x,p.y-hpx*0.18);ctx.rotate(Math.PI/2);\n      ctx.drawImage(sp,-hpx*0.5,-wpx*0.5,hpx,wpx);\n    } else {\n      ctx.drawImage(sp,x0,y0,wpx,hpx);\n    }\n    ctx.restore();\n    if(pose==='cruz'){ctx.strokeStyle='#8d6a3a';ctx.lineWidth=Math.max(2,wpx*0.12);ctx.beginPath();ctx.moveTo(p.x,y0-hpx*0.15);ctx.lineTo(p.x,p.y);ctx.moveTo(p.x-wpx*0.55,y0+hpx*0.2);ctx.lineTo(p.x+wpx*0.55,y0+hpx*0.2);ctx.stroke();}\n    if(p.d<14){\n      ctx.textAlign='center';ctx.font='12px ui-sans-serif,system-ui';\n      ctx.fillStyle=e.lider?'#ffd166':'#cfe6ff';ctx.fillText(e.nome,p.x,y0-16);\n      if(e.hp<e.hpMax){ctx.fillStyle='#331a1a';ctx.fillRect(p.x-20,y0-12,40,4);ctx.fillStyle='#49d59b';ctx.fillRect(p.x-20,y0-12,40*(e.hp/e.hpMax),4);}\n      if(e.fala&&p.d<7){\n        ctx.font='12px ui-sans-serif,system-ui';var tw=ctx.measureText(e.fala).width+12;\n        ctx.fillStyle='rgba(9,13,24,.9)';ctx.fillRect(p.x-tw/2,y0-44,tw,20);\n        ctx.strokeStyle='#2b3a5e';ctx.strokeRect(p.x-tw/2,y0-44,tw,20);\n        ctx.fillStyle='#dfe9ff';ctx.fillText(e.fala,p.x,y0-30);\n      }\n    }\n    flashes.forEach(function(f){\n      if(f.para===e.id&&performance.now()-f.t<220){ctx.fillStyle='rgba(255,90,90,.35)';ctx.fillRect(x0,y0,wpx,hpx);}\n    });\n  });\n  flashes=flashes.filter(function(f){return performance.now()-f.t<300;});\n}\nfunction desenharMira(){\n  ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1.5;\n  ctx.beginPath();ctx.moveTo(W/2-9,H/2);ctx.lineTo(W/2-3,H/2);ctx.moveTo(W/2+3,H/2);ctx.lineTo(W/2+9,H/2);\n  ctx.moveTo(W/2,H/2-9);ctx.lineTo(W/2,H/2-3);ctx.moveTo(W/2,H/2+3);ctx.lineTo(W/2,H/2+9);ctx.stroke();\n}\n\n/* --------- VISÃO NORMAL (topo 2,5D) --------- */\nfunction renderTopo(){\n  var TS=MUNDO.TS,esc=Math.max(0.55,Math.min(1.25,Math.min(W,H)/760));\n  ctx.fillStyle='#070a12';ctx.fillRect(0,0,W,H);\n  ctx.save();ctx.translate(W/2,H/2);ctx.scale(esc,esc);ctx.translate(-cam.x,-cam.y);\n  var vx0=cam.x-W/2/esc-TS,vy0=cam.y-H/2/esc-TS,vx1=cam.x+W/2/esc+TS,vy1=cam.y+H/2/esc+TS;\n  // piso\n  ctx.fillStyle='#10182c';ctx.fillRect(vx0,vy0,vx1-vx0,vy1-vy0);\n  var t0=Math.max(0,Math.floor(vx0/TS)),t1=Math.min(MUNDO.N-1,Math.ceil(vx1/TS));\n  var s0=Math.max(0,Math.floor(vy0/TS)),s1=Math.min(MUNDO.N-1,Math.ceil(vy1/TS));\n  for(var y=s0;y<=s1;y++)for(var x=t0;x<=t1;x++){\n    if(!ehParede(x,y)){\n      ctx.fillStyle=((x+y)%2)?'#16203a':'#141d34';\n      ctx.fillRect(x*TS,y*TS,TS,TS);\n      ctx.fillStyle='rgba(90,140,220,.05)';ctx.fillRect(x*TS+2,y*TS+2,TS-4,TS-4);\n    }\n  }\n  // círculo ritual\n  desenharCirculoTopo();\n  // prédios com extrusão\n  BLOCOS.forEach(function(b){\n    var X=b.x0*TS,Y=b.y0*TS,Wd=(b.x1-b.x0+1)*TS,Hd=(b.y1-b.y0+1)*TS;\n    if(X>vx1||Y>vy1||X+Wd<vx0||Y+Hd<vy0)return;\n    var off=10*b.altura;\n    ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(X+off,Y+off,Wd,Hd);\n    ctx.fillStyle=sombrear(b.cor,.22);ctx.fillRect(X,Y,Wd,Hd);\n    ctx.strokeStyle=b.cor;ctx.lineWidth=1.5;ctx.strokeRect(X,Y,Wd,Hd);\n    ctx.fillStyle=b.cor+'18';ctx.fillRect(X+4,Y+4,Wd-8,Hd-8);\n    for(var jy=Y+10;jy<Y+Hd-10;jy+=18)for(var jx=X+10;jx<X+Wd-10;jx+=20){\n      ctx.fillStyle=((jx+jy)%3===0)?'rgba(255,214,140,.5)':'rgba(120,200,255,.18)';ctx.fillRect(jx,jy,7,5);\n    }\n    ctx.fillStyle='#cfe6ff';ctx.font='11px ui-monospace,monospace';ctx.textAlign='center';\n    ctx.fillText(b.nome,X+Wd/2,Y+Hd/2+3);\n  });\n  // saques\n  S.saques.forEach(function(s){\n    ctx.fillStyle='#ffd166';ctx.fillRect(s.x-4,s.y-10,8,20);\n    ctx.fillStyle='rgba(255,209,102,.2)';ctx.beginPath();ctx.arc(s.x,s.y,16,0,7);ctx.fill();\n  });\n  // entidades\n  var ents=entidades().filter(function(e){return !e.saque;});\n  if(EU)ents.push(EU);\n  ents.sort(function(a,b){return a.y-b.y;}).forEach(function(e){\n    if(e.x<vx0||e.x>vx1||e.y<vy0||e.y>vy1)return;\n    var sp=spriteAvatar(e.apar,e.pose||'idle',e.arma,e.lider);\n    var h=40*((e.apar&&e.apar.altura)||1),w=h*0.66;\n    ctx.fillStyle='rgba(0,0,0,.4)';ctx.beginPath();ctx.ellipse(e.x,e.y,w*0.4,w*0.16,0,0,7);ctx.fill();\n    if((e.pose||'')==='deitar'){ctx.save();ctx.translate(e.x,e.y);ctx.rotate(Math.PI/2);ctx.drawImage(sp,-h/2,-w/2,h,w);ctx.restore();}\n    else ctx.drawImage(sp,e.x-w/2,e.y-h,w,h);\n    if(e.pose==='cruz'){ctx.strokeStyle='#8d6a3a';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(e.x,e.y-h*1.1);ctx.lineTo(e.x,e.y);ctx.moveTo(e.x-14,e.y-h*0.78);ctx.lineTo(e.x+14,e.y-h*0.78);ctx.stroke();}\n    ctx.textAlign='center';ctx.font='11px ui-sans-serif,system-ui';\n    ctx.fillStyle=(EU&&e.id===EU.id)?'#9ef5c8':(e.lider?'#ffd166':'#b9cdf0');\n    ctx.fillText(e.nome,e.x,e.y-h-6);\n    if(e.hp!==undefined&&e.hp<e.hpMax){ctx.fillStyle='#331a1a';ctx.fillRect(e.x-16,e.y-h-3,32,3);ctx.fillStyle='#49d59b';ctx.fillRect(e.x-16,e.y-h-3,32*(e.hp/e.hpMax),3);}\n    if(e.fala&&balaoOk(e)){var tw=ctx.measureText(e.fala).width+10;ctx.fillStyle='rgba(9,13,24,.9)';ctx.fillRect(e.x-tw/2,e.y-h-26,tw,16);ctx.fillStyle='#dfe9ff';ctx.fillText(e.fala,e.x,e.y-h-14);}\n    flashes.forEach(function(f){if(f.para===e.id&&performance.now()-f.t<220){ctx.fillStyle='rgba(255,90,90,.4)';ctx.beginPath();ctx.arc(e.x,e.y-h/2,w*0.6,0,7);ctx.fill();}});\n  });\n  // cone de visão do jogador\n  if(EU){\n    ctx.fillStyle='rgba(120,200,255,.07)';ctx.beginPath();ctx.moveTo(EU.x,EU.y);\n    ctx.arc(EU.x,EU.y,120,cam.ang-0.5,cam.ang+0.5);ctx.closePath();ctx.fill();\n  }\n  ctx.restore();\n  minimapa();\n}\nvar _balaoSet=null,_balaoT=0;\nfunction balaoOk(e){\n  var t=performance.now();\n  if(!_balaoSet||t-_balaoT>250){\n    _balaoT=t;\n    var falantes=entidades().filter(function(o){return o.fala&&!o.saque;});\n    if(EU)falantes.sort(function(a,b){return Math.hypot(a.x-EU.x,a.y-EU.y)-Math.hypot(b.x-EU.x,b.y-EU.y);});\n    _balaoSet={};falantes.slice(0,4).forEach(function(o){_balaoSet[o.id]=1;});\n  }\n  return !!_balaoSet[e.id];\n}\nfunction desenharCirculoTopo(){\n  var C=MUNDO.circulo,pulso=S.ritual?0.6+0.4*Math.sin(performance.now()/380):0.35;\n  ctx.save();ctx.translate(C.x,C.y);\n  ctx.strokeStyle='rgba(192,107,255,'+pulso+')';ctx.lineWidth=3;\n  ctx.beginPath();ctx.arc(0,0,C.r,0,7);ctx.stroke();\n  ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,C.r*.82,0,7);ctx.stroke();\n  ctx.beginPath();ctx.arc(0,0,C.r*.3,0,7);ctx.stroke();\n  ctx.strokeStyle='rgba(255,120,220,'+pulso*.85+')';ctx.lineWidth=2;ctx.beginPath();\n  for(var i=0;i<6;i++){var a=Math.PI/2+(i*2*Math.PI*2)/5;var X=Math.cos(a)*C.r*.8,Y=Math.sin(a)*C.r*.8;if(i===0)ctx.moveTo(X,Y);else ctx.lineTo(X,Y);}\n  ctx.stroke();\n  ctx.strokeStyle='rgba(192,107,255,'+pulso*.6+')';ctx.lineWidth=1;\n  for(var k=0;k<8;k++){var a2=(k/8)*Math.PI*2;ctx.beginPath();ctx.moveTo(Math.cos(a2)*C.r*.3,Math.sin(a2)*C.r*.3);ctx.lineTo(Math.cos(a2)*C.r*.82,Math.sin(a2)*C.r*.82);ctx.stroke();}\n  ctx.lineWidth=2.5;ctx.strokeStyle='rgba(216,196,255,'+pulso+')';\n  ctx.beginPath();ctx.moveTo(0,-C.r*.62);ctx.lineTo(0,C.r*.55);\n  ctx.moveTo(-C.r*.16,-C.r*.34);ctx.lineTo(C.r*.16,-C.r*.34);\n  ctx.moveTo(-C.r*.1,C.r*.2);ctx.lineTo(C.r*.1,C.r*.2);ctx.stroke();\n  ctx.beginPath();ctx.moveTo(-C.r*.22,C.r*.55);ctx.quadraticCurveTo(0,C.r*.75,C.r*.22,C.r*.55);ctx.stroke();\n  for(var v=0;v<12;v++){\n    var av=(v/12)*Math.PI*2,vx=Math.cos(av)*C.r*1.02,vy=Math.sin(av)*C.r*1.02;\n    var fl=0.7+0.3*Math.sin(performance.now()/120+v);\n    ctx.fillStyle='rgba(255,190,90,'+fl+')';ctx.fillRect(vx-2,vy-10,4,12);\n    ctx.fillStyle='rgba(255,240,180,'+fl+')';ctx.beginPath();ctx.arc(vx,vy-13,3,0,7);ctx.fill();\n  }\n  ctx.restore();\n}\nfunction minimapa(){\n  if(!MUNDO)return;\n  var s=Math.min(120,W*0.22),k=s/(MUNDO.N*MUNDO.TS);\n  var painelAberto=document.getElementById('painel').classList.contains('on')&&W>=900;\n  var X=W-s-10-(painelAberto?346:0),Y=H-s-10;\n  ctx.fillStyle='rgba(5,8,16,.8)';ctx.fillRect(X,Y,s,s);\n  ctx.strokeStyle='#2b3a5e';ctx.strokeRect(X,Y,s,s);\n  BLOCOS.forEach(function(b){ctx.fillStyle=b.cor+'55';ctx.fillRect(X+b.x0*MUNDO.TS*k,Y+b.y0*MUNDO.TS*k,(b.x1-b.x0+1)*MUNDO.TS*k,(b.y1-b.y0+1)*MUNDO.TS*k);});\n  ctx.strokeStyle='#c06bff';ctx.beginPath();ctx.arc(X+MUNDO.circulo.x*k,Y+MUNDO.circulo.y*k,MUNDO.circulo.r*k,0,7);ctx.stroke();\n  S.npcs.forEach(function(n){if(n.morto)return;ctx.fillStyle=n.preso?'#ff7a68':'#8fa3c8';ctx.fillRect(X+n.x*k-1,Y+n.y*k-1,2,2);});\n  if(EU){ctx.fillStyle='#9ef5c8';ctx.fillRect(X+EU.x*k-2,Y+EU.y*k-2,4,4);}\n}\n</script>\n</body>\n</html>\n";

/* ============================== SERVIDOR ================================ */
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 20000, pingTimeout: 25000 });

app.disable('x-powered-by');
app.get('/health', (req, res) => {
  res.json({
    ok: true, version: VERSION, build: BUILD, npcs: NPCS.length,
    jogadores: Object.keys(jogadores).length,
    lider: estado.lider ? estado.lider.nome : null,
    leaderCodeFromEnv: LEADER_CODE_FROM_ENV,
    hora: hhmm(), uptime: Math.floor(process.uptime())
  });
});
app.get('/', (req, res) => { res.type('html').send(PAGINA); });
app.get('/retrato/:id.svg', (req, res) => {
  const n = npcById(String(req.params.id));
  if (!n) return res.status(404).end();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(retratoSVG(n));
});
app.get('/mapa.svg', (req, res) => { res.type('image/svg+xml').send(mapaSVG()); });

/* ----------------------- estado enviado ao cliente ---------------------- */
function snapshotNPC(n) {
  return {
    id: n.id, nome: n.nome, x: Math.round(n.x), y: Math.round(n.y), ang: +n.ang.toFixed(2),
    pose: n.pose, acao: n.acao, hp: Math.round(n.hp), hpMax: n.hpMax, morto: n.morto,
    arma: n.armaVisivel ? n.arma : null, apar: n.apar, preso: n.preso, cruz: n.cruz,
    fala: n.falaAte > now() ? n.fala : '', nivel: n.nivel, swing: n.swingAte > now()
  };
}
function snapshotPlayer(p) {
  return {
    id: p.id, nome: p.nome, x: Math.round(p.x), y: Math.round(p.y), ang: +p.ang.toFixed(2),
    hp: Math.round(p.hp), hpMax: p.hpMax, arma: p.arma, apar: p.apar, lider: p.lider,
    preso: p.preso, cruz: p.cruz, invul: !!p.invulneravel, tipo: 'player',
    protegido: p.protegidoAte > now(), swing: p.swingAte > now()
  };
}
function estadoPublico() {
  const ativas = estado.ordens.filter(o => !o.encerrada);
  return {
    hora: hhmm(), npcs: NPCS.map(snapshotNPC), players: Object.values(jogadores).map(snapshotPlayer),
    saques: estado.saques.map(s => ({ id: s.id, arma: s.arma, x: Math.round(s.x), y: Math.round(s.y), resta: Math.max(0, Math.round((s.ate - now()) / 1000)) })),
    ordens: ativas.map(o => ({ id: o.id, nome: o.nome, hora: o.horaTexto, iniciada: o.iniciada, resta: Math.max(0, Math.round((o.fimEm - now()) / 1000)), mensageiros: o.mensageiros, alvo: o.alvo === 'todos' ? 'todos' : (npcById(o.alvoId) || {}).nome })),
    lider: estado.lider ? estado.lider.nome : null,
    eventos: estado.eventos.slice(0, 12), convergencia: estado.convergencia,
    ritual: ativas.some(o => o.iniciada && ['reunir', 'dancar', 'cerimonia', 'oferenda', 'sacrificio', 'deitar'].includes(o.cmd))
  };
}

/* ------------------------------ sockets --------------------------------- */
const rate = new Map();
function limitar(id, chave, ms) {
  const k = id + ':' + chave, t = now();
  if ((rate.get(k) || 0) > t) return false;
  rate.set(k, t + ms); return true;
}

io.on('connection', socket => {
  let p = null;

  socket.on('entrar', nome => {
    if (p) return;
    p = criarJogador(socket.id, sanitizeName(nome));
    socket.emit('bemvindo', {
      id: p.id, versao: VERSION, build: BUILD,
      mundo: { TS, N, WORLD, circulo: CIRCLE, cruz: CRUZ },
      grid: Buffer.from(grid).toString('base64'),
      blocos: BLOCKS.map(b => ({ id: b.id, nome: b.nome, tipo: b.tipo, cor: b.cor, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, altura: b.altura })),
      npcs: NPCS.map(n => ({ id: n.id, nome: n.nome, profissao: n.profissao, bio: n.bio })),
      voce: snapshotPlayer(p), comandos: Object.entries(COMANDOS).map(([k, v]) => ({ k, nome: v.nome })),
      armas: ARMAS
    });
    logEvento(`${p.nome} chegou em Porto Neon.`, 'info');
  });

  socket.on('mover', d => {
    if (!p || p.preso || p.morto) return;
    const vx = clamp(+d.vx || 0, -1, 1), vy = clamp(+d.vy || 0, -1, 1);
    const vel = 132 * clamp(+d.dt || 0.033, 0, 0.12);
    const m = Math.hypot(vx, vy) || 1;
    mover(p, (vx / m) * vel * Math.min(1, Math.hypot(vx, vy) * 1.4), (vy / m) * vel * Math.min(1, Math.hypot(vx, vy) * 1.4));
    if (typeof d.ang === 'number' && isFinite(d.ang)) p.ang = d.ang;
  });

  socket.on('atacar', alvoId => {
    if (!p || p.preso || p.morto) return;
    if (!limitar(socket.id, 'atk', 120)) return;
    let id = alvoId;
    if (!id) { // alvo mais próximo no cone de visão
      const cands = [...NPCS.filter(n => !n.morto), ...Object.values(jogadores).filter(o => o.id !== p.id)];
      let melhor = null, md = 1e9;
      for (const c of cands) {
        const d = dist(p.x, p.y, c.x, c.y);
        const a = Math.atan2(c.y - p.y, c.x - p.x);
        let diff = Math.abs(((a - p.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < 70 && diff < 1.1 && d < md) { md = d; melhor = c; }
      }
      id = melhor && melhor.id;
    }
    if (!id) return socket.emit('combate', { ok: false, motivo: 'alvo' });
    const r = atacar(p, id);
    socket.emit('combate', r);
    if (r.ok) io.emit('golpe', { de: p.id, para: id, dano: r.dano });
  });

  socket.on('recolher', () => {
    if (!p || p.preso || p.morto) return;
    const s = estado.saques.find(s => !s.coletado && dist2(s.x, s.y, p.x, p.y) < 52 * 52);
    if (!s) return socket.emit('aviso', { tipo: 'info', texto: 'Nada para recolher por perto.' });
    s.coletado = true;
    if (!p.inventario.includes(s.arma)) p.inventario.push(s.arma);
    p.arma = s.arma;
    socket.emit('aviso', { tipo: 'saque', texto: `Você recolheu: ${ARMAS[s.arma].nome}.` });
    logEvento(`${p.nome} recolheu ${ARMAS[s.arma].nome}.`, 'info');
  });

  socket.on('equipar', arma => {
    if (!p) return;
    if (arma === 'espada_fogo' && !p.lider) return socket.emit('aviso', { tipo: 'erro', texto: 'A espada de fogo pertence apenas à liderança autenticada.' });
    if (!p.inventario.includes(arma)) return socket.emit('aviso', { tipo: 'erro', texto: 'Você não possui essa arma.' });
    p.arma = arma; socket.emit('aviso', { tipo: 'info', texto: `Equipado: ${ARMAS[arma].nome}.` });
  });

  socket.on('interagir', npcId => {
    if (!p) return;
    const n = npcById(npcId);
    if (!n || n.morto) return;
    if (dist2(p.x, p.y, n.x, n.y) > 110 * 110) return socket.emit('aviso', { tipo: 'erro', texto: 'Chegue mais perto para conversar.' });
    n.necessidades.social = Math.max(0, n.necessidades.social - 10);
    n.relacoes[p.id] = clamp((n.relacoes[p.id] || 10) + 4, 0, 100);
    memoria(n, `Conversou com ${p.nome}.`);
    const priv = n.relacoes[p.id] > 55;
    falar(n, priv ? 'Posso te contar uma coisa...' : 'Olá. Dia estranho, não?', 3000);
    socket.emit('ficha', {
      id: n.id, nome: n.nome, bio: n.bio, profissao: n.profissao, idade: n.idade, nivel: n.nivel, xp: n.xp,
      humor: Math.round(n.humor), acao: n.acao, hp: Math.round(n.hp), hpMax: n.hpMax,
      necessidades: Object.fromEntries(Object.entries(n.necessidades).map(([k, v]) => [k, Math.round(v)])),
      mem: n.mem.slice(0, 6), boatos: n.boatos.slice(0, 5),
      segredo: priv ? n.segredo : null, relacao: Math.round(n.relacoes[p.id] || 0),
      retrato: '/retrato/' + n.id + '.svg'
    });
  });

  socket.on('elogiar', npcId => {
    if (!p || !limitar(socket.id, 'elogio', 1500)) return;
    const n = npcById(npcId); if (!n) return;
    n.relacoes[p.id] = clamp((n.relacoes[p.id] || 10) + 9, 0, 100);
    n.humor = clamp(n.humor + 6, 0, 100);
    falar(n, 'Obrigado, viu? Precisava ouvir isso.', 3000);
    memoria(n, `${p.nome} foi gentil.`);
    socket.emit('aviso', { tipo: 'info', texto: `${n.nome} gostou do elogio.` });
  });

  /* ---------------------------- liderança ------------------------------- */
  socket.on('assumirLideranca', codigo => {
    if (!p) return;
    if (!limitar(socket.id, 'auth', 2500)) return socket.emit('aviso', { tipo: 'erro', texto: 'Aguarde antes de tentar novamente.' });
    if (!safeEqual(String(codigo || ''), LEADER_CODE)) {
      logEvento(`Tentativa de liderança recusada (${p.nome}).`, 'aviso');
      return socket.emit('aviso', { tipo: 'erro', texto: 'Código incorreto.' });
    }
    // uma sessão de líder por vez
    if (estado.lider && estado.lider.socketId !== socket.id) {
      const antigo = jogadores[estado.lider.socketId];
      if (antigo) { antigo.lider = false; antigo.invulneravel = false; antigo.arma = 'soco'; antigo.inventario = antigo.inventario.filter(a => a !== 'espada_fogo'); io.to(antigo.id).emit('aviso', { tipo: 'erro', texto: 'A liderança foi transferida para outra sessão.' }); }
    }
    estado.lider = { socketId: socket.id, nome: p.nome, sessao: crypto.randomUUID() };
    p.lider = true; p.invulneravel = true;
    if (!p.inventario.includes('espada_fogo')) p.inventario.push('espada_fogo');
    p.arma = 'espada_fogo'; p.hp = p.hpMax;
    socket.emit('lideranca', { ok: true, nome: p.nome });
    logEvento(`${p.nome} assumiu a liderança da Ordem de Dantalion.`, 'ordem');
  });

  socket.on('convergencia', v => {
    if (!p || !p.lider) return;
    estado.convergencia = !!v;
    logEvento(`Convergência mística ${estado.convergencia ? 'ativada' : 'desativada'}.`, 'info');
  });

  socket.on('comando', spec => {
    if (!p) return;
    if (!limitar(socket.id, 'cmd', 900)) return;
    let s = null;
    if (spec && spec.texto && !spec.cmd) s = interpretar(spec.texto);
    else if (spec && COMANDOS[spec.cmd]) {
      s = { cmd: spec.cmd, quando: spec.hora ? 'hora' : 'agora', hora: null, alvo: spec.alvo === 'um' ? 'um' : 'todos', alvoId: spec.alvoId || null, adversarioId: spec.adversarioId || null, texto: '' };
      if (spec.hora) { const m = String(spec.hora).match(/^(\d{1,2}):(\d{2})$/); if (m) s.hora = clamp(+m[1], 0, 23) * 60 + clamp(+m[2], 0, 59); else s.quando = 'agora'; }
    }
    if (!s) return socket.emit('aviso', { tipo: 'erro', texto: 'Não reconheci a ordem. Este protótipo entende apenas comandos pré-programados (ex.: "À meia-noite, todos no círculo da praça").' });

    if (p.lider) {
      const o = criarOrdem(s, p.nome, p.nome);
      socket.emit('aviso', { tipo: 'ok', texto: `Ordem emitida: ${o.nome} (${o.horaTexto}).` });
      io.emit('novaOrdem', { nome: o.nome, hora: o.horaTexto, autor: p.nome });
    } else {
      if (!estado.lider) { // sem líder: pedido fica registrado e o mundo ignora
        return socket.emit('aviso', { tipo: 'erro', texto: 'Não há liderança autenticada no momento. Pedidos de visitante precisam de aprovação.' });
      }
      const ped = { id: 'p' + Math.random().toString(36).slice(2, 8), autor: p.nome, autorId: p.id, spec: s, nome: COMANDOS[s.cmd].nome, hora: s.quando === 'hora' ? fmtMin(s.hora) : 'agora', criadoEm: now(), expiraEm: now() + 60000, resolvido: false };
      estado.pendentes.push(ped);
      socket.emit('aviso', { tipo: 'info', texto: 'Seu pedido foi enviado à liderança e aguarda aprovação.' });
      io.to(estado.lider.socketId).emit('pedido', { id: ped.id, autor: ped.autor, nome: ped.nome, hora: ped.hora, alvo: s.alvo === 'todos' ? 'todos' : (npcById(s.alvoId) || {}).nome || '—', texto: s.texto });
      logEvento(`${p.nome} pediu: ${ped.nome} (${ped.hora}) — aguardando liderança.`, 'aviso');
    }
  });

  socket.on('decidirPedido', ({ id, decisao }) => {
    if (!p || !p.lider) return;
    const ped = estado.pendentes.find(x => x.id === id && !x.resolvido);
    if (!ped) return;
    ped.resolvido = true; ped.resultado = decisao;
    const autor = jogadores[ped.autorId];
    if (decisao === 'aprovar') {
      const o = criarOrdem(ped.spec, ped.autor, p.nome);
      io.emit('novaOrdem', { nome: o.nome, hora: o.horaTexto, autor: ped.autor + ' (aprovado)' });
      if (autor) io.to(autor.id).emit('aviso', { tipo: 'ok', texto: 'A liderança aprovou seu pedido.' });
    } else if (decisao === 'cadeia' || decisao === 'crucificar') {
      if (autor) prenderJogador(autor, decisao === 'crucificar');
    } else if (decisao === 'atacar') {
      if (autor) atacarJogadorComGuardas(autor);
    } else {
      if (autor) io.to(autor.id).emit('aviso', { tipo: 'erro', texto: 'A liderança ignorou seu pedido.' });
      logEvento(`Pedido de ${ped.autor} foi ignorado.`, 'info');
    }
  });

  socket.on('liberarVisitante', alvoId => {
    if (!p || !p.lider) return;
    const alvo = jogadores[alvoId];
    if (alvo && alvo.preso) soltarJogador(alvo);
    for (const n of NPCS) if (n.preso) soltar(n);
  });

  socket.on('disconnect', () => {
    if (!p) return;
    if (estado.lider && estado.lider.socketId === socket.id) {
      estado.lider = null;
      logEvento(`${p.nome} deixou a liderança (desconexão). É preciso entrar novamente com o código.`, 'aviso');
    }
    for (const n of NPCS) { if (n.guardaDe === p.id) { n.guardaDe = null; n.estado = 'rotina'; } if (n.alvo === p.id) { n.alvo = null; n.estado = 'rotina'; } }
    logEvento(`${p.nome} saiu.`, 'info');
    delete jogadores[socket.id];
  });
});

const _tTick = setInterval(tick, 50);
const _tNet = setInterval(() => { io.emit('estado', estadoPublico()); }, 100);

/* Exportações para os testes automatizados (não afetam a execução normal). */
module.exports = {
  VERSION, BUILD, app, server, io, NPCS, BLOCKS, CIRCLE, CRUZ, CADEIA_CELA, grid, N, TS, WORLD,
  ARMAS, COMANDOS, estado, jogadores, LEADER_CODE,
  mulberry32, hashStr, aparencia, memoria, boato, ganharXP, hhmm, horaJogo, destinoRotina,
  isWallTile, livre, temVisada, rota, dist, npcById, interpretar, criarOrdem, iniciarOrdem,
  encerrarOrdem, destinatarios, propagarMensageiros, atacar, derrotar, soltar, designarGuardas,
  criarJogador, prenderJogador, soltarJogador, atacarJogadorComGuardas, derrotarJogador,
  tick, comportamentoRotina, comportamentoCombate, comportamentoGuarda, estadoPublico,
  retratoSVG, mapaSVG, fmtMin, minutosParaMs, sanitizeName, safeEqual,
  fechar() { clearInterval(_tTick); clearInterval(_tNet); try { io.close(); } catch (e) {} try { server.close(); } catch (e) {} }
};

server.listen(PORT, () => {
  console.log(`\n  Porto Neon ${BUILD} (${VERSION}) — http://localhost:${PORT}`);
  console.log(`  Moradores: ${NPCS.length} | health: /health`);
  if (!LEADER_CODE_FROM_ENV) {
    console.log('\n  [AVISO] LEADER_CODE não definido no ambiente.');
    console.log('  Código de liderança temporário desta execução: ' + LEADER_CODE);
    console.log('  Em produção, defina LEADER_CODE no Render (mínimo 12 caracteres).\n');
  } else {
    console.log('  LEADER_CODE carregado do ambiente.\n');
  }
});


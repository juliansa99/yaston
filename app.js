(() => {
'use strict';
const cfg = window.YASTON_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const PTS = { W: 3, D: 1, L: 0 };
const MAX_TRIES = 3;
// Tabla final del Apertura 2026 (primera mitad del año): se jugaba con otro puntaje, así que queda fija.
const APERTURA_2026 = [
  ['Chiqui Masla', 38, 12], ['Tomer', 34, 14], ['Tarlo', 30, 15], ['Webo', 28, 14], ['Guido', 27, 10], ['Peto', 27, 12],
  ['Gure', 22, 10], ['Fito', 21, 8], ['Ivancito', 18, 8], ['Dbor', 17, 9], ['Langer', 15, 8], ['Fefe', 15, 7],
  ['Lucho', 12.5, 8], ['Gueler', 11, 6], ['Ruso', 10, 3], ['Tau', 8.5, 6], ['Bono', 8, 4], ['Brian', 7, 4],
  ['Yanu', 6, 3], ['Niesa', 2, 3], ['Gorbi', 1.5, 3], ['Primo', 0.5, 1],
].map(([n, pts, asist]) => ({ n, pts, asist, prom: pts / asist }));
// Nombre en la planilla -> nombre en el Plantel (solo cuando es el mismo jugador con otro nombre)
const ALIAS = {
  'chiqui masla': 'masla', 'tomer': 'tota', 'langer': 'longa', 'gueler': 'marto',
  'brian': 'braiton', 'yanu': 'yannu', 'niesa': 'zalito',
};
const TORNEOS = [
  { id: 'clausura-2026', name: 'Clausura 2026', full: 'Yaston League Clausura', from: '2026-06-16', to: '2026-12-31', kind: 'vivo', rules: { W: 3, D: 1, L: 0 } },
  { id: 'apertura-2026', name: 'Apertura 2026', full: 'Yaston League Apertura', from: '2026-01-01', to: '2026-06-15', kind: 'fija', rules: { W: 4, D: 2, L: 1 }, partidos: 16 },
  { id: 'anual-2025', name: 'Anual 2025', full: 'Yaston League Anual', from: '2025-01-01', to: '2025-12-31', kind: 'sin-datos', champion: 'Masla' },
];
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const torneoActual = () => TORNEOS.find(t => t.from <= todayISO() && todayISO() <= t.to) || TORNEOS[0];
const num = (n, d = 2) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: d });
const fmtShort = d => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
// Un juego por semana. Cada entrada rige desde el lunes indicado; si no hay uno nuevo, sigue el último.
const WEEKLY_GAMES = [
  { id: 'penales', from: '2026-10-19', title: 'Pateale Penales a Gure', blurb: 'Tanda de 5 penales. Tocá el arco y fijate si Gure la ataja.' },
  { id: 'adivina', from: '2026-10-26', title: '¿Quién ganó ese partido?', blurb: 'Te muestro los equipos de un partido viejo sin el resultado. Adiviná cómo terminó. 5 partidos al azar.' },
];
const gameForWeek = wk => [...WEEKLY_GAMES].reverse().find(g => g.from <= wk) || null;

if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  app.innerHTML = `<div class="center-screen"><div class="card setup">
    <h2>⚙️ Falta configurar</h2>
    <p class="muted">Abrí <code>config.js</code> y pegá la <b>URL</b> y la <b>anon key</b> de tu proyecto de Supabase. Los pasos están en el README.</p></div></div>`;
  return;
}
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const S = {
  user: null, isAdmin: false, meId: null, tab: 'tabla', game: null, torneo: null, sort: 'pts',
  sims: {}, prev: null, perfilId: null, prevTab: null, raceSel: null, raceMode: 'pts', week: null, board: [], plays: [], playId: null,
  players: [], emails: {}, matches: [], mp: [], mvp: [], totals: {}, myVotes: {}, unclaimed: [],
};

/* ---------------- utilidades ---------------- */
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 2600);
}
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const player = id => S.players.find(p => p.id === id);
function av(p, cls = '') {
  if (!p) return `<span class="av ${cls}">?</span>`;
  return p.photo_url
    ? `<img class="av ${cls}" src="${esc(p.photo_url)}" alt="${esc(p.name)}" loading="lazy">`
    : `<span class="av ${cls}">${esc(initials(p.name))}</span>`;
}
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function lastThursday() {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/* ---------------- datos ---------------- */
async function loadAll() {
  const jobs = [
    must(db.from('players').select('*').order('name')),
    must(db.from('matches').select('*').order('played_on', { ascending: false })),
    must(db.from('match_players').select('*')),
    must(db.rpc('mvp_counts')),
    must(db.rpc('vote_totals')),
    S.user ? must(db.from('votes').select('match_id,voted_for')) : [],
    S.user ? must(db.rpc('my_player_id')) : null,
  ];
  if (S.isAdmin) jobs.push(must(db.from('player_emails').select('*')));
  const [players, matches, mp, mvp, totals, votes, meId, emails] = await Promise.all(jobs);
  S.players = players; S.matches = matches; S.mp = mp; S.mvp = mvp; S.meId = meId;
  if (S.isAdmin) { // invitados que quedaron sin ningún partido: se limpian solos
    const orphans = players.filter(p => p.guest && !mp.some(x => x.player_id === p.id));
    if (orphans.length) {
      db.from('players').delete().in('id', orphans.map(p => p.id)).then(() => {});
      S.players = players.filter(p => !orphans.includes(p));
    }
  }
  S.totals = Object.fromEntries(totals.map(t => [t.match_id, t.total]));
  S.myVotes = Object.fromEntries(votes.map(v => [v.match_id, v.voted_for]));
  S.emails = emails ? Object.fromEntries(emails.map(e => [e.player_id, e.email])) : {};
  S.unclaimed = S.user && !meId ? await must(db.rpc('unclaimed_players')) : [];
  await loadGameData();
}

function maybeClaim() {
  let skipped = false;
  try { skipped = sessionStorage.getItem('yaston-skip-claim') === '1'; } catch { /* sin storage */ }
  if (S.user && !S.meId && S.unclaimed.length && !skipped && !$('#modal-root .overlay')) claimModal();
}

function currentGame() { return gameForWeek(S.week || '0000') || WEEKLY_GAMES[WEEKLY_GAMES.length - 1]; }
async function loadGameData() {
  S.week = await must(db.rpc('current_week'));
  const id = currentGame().id;
  const [board, plays] = await Promise.all([
    must(db.rpc('game_board', { p_game: id })),
    S.user ? must(db.from('game_plays').select('id,goals').eq('game', id).eq('week', S.week)) : [],
  ]);
  S.board = board; S.plays = plays;
  // resultado de la semana pasada (para anunciar al ganador)
  const prevWeek = addDays(S.week, -7), pg = gameForWeek(prevWeek);
  S.prev = null;
  if (pg) {
    try { S.prev = { game: pg, week: prevWeek, rows: await must(db.rpc('game_board_week', { p_game: pg.id, p_week: prevWeek })) }; } catch { S.prev = null; }
  }
}
function prevResult() {
  if (!S.prev || !S.prev.rows.length) return null;
  const rows = S.prev.rows.map(r => ({ ...r, p: player(r.player_id) })).filter(r => r.p)
    .sort((a, b) => b.best - a.best || b.total - a.total || a.tries - b.tries || a.p.name.localeCompare(b.p.name));
  if (!rows.length) return null;
  const f = rows[0], winners = rows.filter(r => r.best === f.best && r.total === f.total && r.tries === f.tries);
  return { game: S.prev.game, week: S.prev.week, rows, winners };
}
const weekLabel = wk => {
  const d = new Date(wk + 'T12:00:00'), e = new Date(d); e.setDate(d.getDate() + 6);
  const m = x => x.toLocaleDateString('es-AR', { month: 'long' });
  return d.getMonth() === e.getMonth() ? `${d.getDate()} al ${e.getDate()} de ${m(e)}` : `${d.getDate()} de ${m(d)} al ${e.getDate()} de ${m(e)}`;
};

async function refresh() {
  try { await loadAll(); render(); maybeClaim(); } catch (e) { toast(e.message || 'Error al cargar', true); }
}

/* ---------------- cálculo de la tabla ---------------- */
function mvpWinners(matchId) {
  const rows = S.mvp.filter(r => r.match_id === matchId).sort((a, b) => b.votes - a.votes);
  if (!rows.length) return { winners: [], rows };
  return { winners: rows.filter(r => r.votes === rows[0].votes), rows };
}
function standings(t) { // t = torneo (rango de fechas y puntaje); null = todos los partidos cargados
  const rows = new Map(S.players.map(p => [p.id, { p, pj: 0, g: 0, e: 0, pe: 0, pts: 0, mvp: 0 }]));
  const inT = m => !t || (m.played_on >= t.from && m.played_on <= t.to);
  const rules = t?.rules || PTS;
  for (const m of S.matches) {
    if (!m.result || !inT(m)) continue;
    for (const x of S.mp.filter(x => x.match_id === m.id)) {
      const r = rows.get(x.player_id); if (!r) continue;
      r.pj++;
      if (m.result === 'D') { r.e++; r.pts += rules.D; }
      else if (m.result === x.team) { r.g++; r.pts += rules.W; }
      else { r.pe++; r.pts += rules.L; }
    }
    if (!m.voting_open) for (const w of mvpWinners(m.id).winners) { const r = rows.get(w.player_id); if (r) r.mvp++; }
  }
  const H = history();
  const all = [...rows.values()];
  for (const r of all) r.st = streaks(H.get(r.p.id) || []);
  for (const r of all) r.pct = r.pj ? r.g / r.pj : null;
  const byPts = (a, b) => b.pts - a.pts || b.g - a.g || b.mvp - a.mvp || a.pe - b.pe || a.p.name.localeCompare(b.p.name);
  let played = all.filter(r => r.pj > 0).sort(byPts);
  if (S.sort === 'avg') { // por promedio de victorias: primero los que jugaron al menos MIN partidos
    const enough = played.filter(r => r.pj >= MIN).sort((a, b) => b.pct - a.pct || b.pj - a.pj || byPts(a, b));
    played = [...enough, ...played.filter(r => r.pj < MIN)];
  }
  const never = all.filter(r => r.pj === 0 && !r.p.guest).sort((a, b) => a.p.name.localeCompare(b.p.name));
  return { played, never };
}


/* ---------------- historial, rachas y premios ---------------- */
function history() { // jugador -> partidos con resultado, en orden cronológico
  const byM = new Map(S.matches.filter(m => m.result).map(m => [m.id, m]));
  const h = new Map(S.players.map(p => [p.id, []]));
  for (const x of S.mp) {
    const m = byM.get(x.match_id); if (!m || !h.has(x.player_id)) continue;
    h.get(x.player_id).push({ m, team: x.team, out: m.result === 'D' ? 'D' : m.result === x.team ? 'W' : 'L' });
  }
  for (const l of h.values()) l.sort((a, b) => a.m.played_on.localeCompare(b.m.played_on));
  return h;
}
function streaks(list) {
  let bw = 0, bl = 0, w = 0, l = 0;
  for (const { out } of list) { w = out === 'W' ? w + 1 : 0; l = out === 'L' ? l + 1 : 0; bw = Math.max(bw, w); bl = Math.max(bl, l); }
  return { bw, bl, cw: w, cl: l };
}
function teamsByMatch() {
  const t = new Map();
  for (const x of S.mp) { if (!t.has(x.match_id)) t.set(x.match_id, {}); t.get(x.match_id)[x.player_id] = x.team; }
  return t;
}
function versus(a, b) { // a y b: juntos (mismo equipo) y enfrentados
  const T = teamsByMatch(), o = { wj: 0, dj: 0, lj: 0, aw: 0, bw: 0, d: 0 };
  for (const m of S.matches) {
    if (!m.result) continue;
    const t = T.get(m.id); if (!t || !t[a] || !t[b]) continue;
    if (t[a] === t[b]) { if (m.result === 'D') o.dj++; else if (m.result === t[a]) o.wj++; else o.lj++; }
    else if (m.result === 'D') o.d++; else if (m.result === t[a]) o.aw++; else o.bw++;
  }
  return o;
}
function pairStats() {
  const T = teamsByMatch(), P = new Map();
  for (const m of S.matches) {
    if (!m.result) continue;
    const t = T.get(m.id); if (!t) continue;
    const ids = Object.keys(t);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (t[ids[i]] !== t[ids[j]]) continue;
      const k = [ids[i], ids[j]].sort().join('|');
      const o = P.get(k) || { ids: [ids[i], ids[j]], n: 0, w: 0 };
      o.n++; if (m.result === t[ids[i]]) o.w++;
      P.set(k, o);
    }
  }
  return [...P.values()];
}
function mvpEvents() { // una entrada por jugador del partido en cada votación cerrada
  const ev = [];
  for (const m of S.matches) if (!m.voting_open) for (const w of mvpWinners(m.id).winners) ev.push({ pid: w.player_id, date: m.played_on });
  return ev;
}
const top = (arr, val) => {
  const c = arr.map(x => [x, val(x)]).filter(([, v]) => v != null && !Number.isNaN(v));
  if (!c.length) return [];
  const m = Math.max(...c.map(([, v]) => v));
  return c.filter(([, v]) => v === m).map(([x]) => x);
};
const pct = (n, d) => d ? Math.round(n * 100 / d) + '%' : '–';
const MIN = 3; // partidos mínimos para que cuente el promedio

function award(icon, title, sub, items) {
  return `<div class="award"><div class="at">${icon} ${title}</div><div class="asub">${sub}</div>
    ${items.length ? items.map(i => `<div class="aw"><span class="avs">${i.ps.map(p => av(p)).join('')}</span><div><b>${esc(i.ps.map(p => p.name).join(' y '))}</b><div class="muted small">${i.text}</div></div></div>`).join('')
      : '<div class="muted small">Todavía nadie.</div>'}</div>`;
}

function viewPremios() {
  const H = history(), ev = mvpEvents();
  const rows = S.players.map(p => {
    const l = H.get(p.id);
    const g = l.filter(x => x.out === 'W').length, pe = l.filter(x => x.out === 'L').length;
    return { p, pj: l.length, g, e: l.length - g - pe, pe, st: streaks(l), mvp: ev.filter(x => x.pid === p.id).length };
  });
  const one = (r, text) => ({ ps: [r.p], text });
  const victorioso = top(rows, r => r.g || null).map(r => one(r, `${r.g} partidos ganados`));
  const promedio = top(rows, r => r.pj >= MIN ? r.g / r.pj + r.pj / 1e6 : null).map(r => one(r, `${pct(r.g, r.pj)} de victorias en ${r.pj} partidos`));
  const derrotado = top(rows, r => r.pj >= MIN && r.pe ? r.pe / r.pj + r.pj / 1e6 : null).map(r => one(r, `${pct(r.pe, r.pj)} de derrotas en ${r.pj} partidos`));
  const fantasmas = rows.filter(r => r.pj === 0 && !r.p.guest).map(r => one(r, 'Todavía no jugó ningún partido'));
  // jugador del mes: el que más veces ganó la estrella (mes actual, o el último con estrellas)
  const months = [...new Set(ev.map(x => x.date.slice(0, 7)))].sort();
  const nowKey = new Date().toISOString().slice(0, 7);
  const mk = months.includes(nowKey) ? nowKey : months[months.length - 1];
  const mLabel = mk ? new Date(mk + '-15T12:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : '';
  const inMonth = ev.filter(x => x.date.startsWith(mk || '~'));
  const delMes = top(rows, r => inMonth.filter(x => x.pid === r.p.id).length || null).map(r => one(r, `${inMonth.filter(x => x.pid === r.p.id).length} ⭐ en ${mLabel}`));
  const bestW = top(rows, r => r.st.bw || null).map(r => one(r, `${r.st.bw} victorias seguidas`));
  const worstL = top(rows, r => r.st.bl || null).map(r => one(r, `${r.st.bl} derrotas seguidas`));
  const pairs = pairStats().filter(x => x.n >= MIN);
  const pairItem = x => ({ ps: x.ids.map(player).filter(Boolean), text: `ganaron ${x.w} de ${x.n} juntos (${pct(x.w, x.n)})` });
  const letal = top(pairs, x => x.w / x.n + x.n / 1e6).map(pairItem);
  const maldita = top(pairs, x => -(x.w / x.n) + x.n / 1e6).map(pairItem);
  const stars = rows.filter(r => r.mvp).sort((a, b) => b.mvp - a.mvp || a.p.name.localeCompare(b.p.name));
  return `<div class="section-title"><h2>Premios</h2></div>
    <div class="awards">
      ${award('🏆', 'Más victorioso', 'El que más partidos ganó', victorioso)}
      ${award('📈', 'Mejor promedio', `Más % de victorias (mínimo ${MIN} partidos)`, promedio)}
      ${award('🤕', 'Derrotado', `Más % de derrotas (mínimo ${MIN} partidos)`, derrotado)}
      ${award('👻', 'Fantasma', 'El que no viene nunca', fantasmas)}
      ${award('⭐', 'Jugador del mes', mk ? mLabel : 'El que más veces ganó la estrella', delMes)}
      ${award('🔥', 'Mejor racha', 'Más victorias seguidas de la historia', bestW)}
      ${award('🥶', 'Peor racha', 'Más derrotas seguidas de la historia', worstL)}
      ${award('🤝', 'Dupla letal', `Mejor % de victorias juntos (mínimo ${MIN} partidos)`, letal)}
      ${award('💀', 'Dupla maldita', `Peor % de victorias juntos (mínimo ${MIN} partidos)`, maldita)}
    </div>
    <div class="section-title"><h2>Ranking de estrellas ⭐</h2></div>
    ${stars.length ? `<div class="table-wrap"><table class="tbl stars"><tbody>${stars.map((r, i) => `<tr class="${i === 0 ? 'top1' : ''}"><td class="pos">${i + 1}</td>
      <td class="l"><div class="pl">${av(r.p)}<span class="n">${esc(r.p.name)}</span></div></td><td class="pts">⭐ ${r.mvp}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Todavía no se cerró ninguna votación.</div>'}`;
}

function duoNemesis(id) {
  let dupla = null, bestia = null;
  for (const q of S.players.filter(q => q.id !== id && !q.guest)) {
    const v = versus(id, q.id), together = v.wj + v.dj + v.lj, against = v.aw + v.bw + v.d;
    if (together >= MIN) { const r = v.wj / together + together / 1e6; if (!dupla || r > dupla.r) dupla = { q, r, w: v.wj, n: together }; }
    if (against >= MIN) { const r = v.bw / against + against / 1e6; if (v.bw && (!bestia || r > bestia.r)) bestia = { q, r, w: v.bw, n: against }; }
  }
  return { dupla, bestia };
}

function viewPerfil() {
  const id = S.perfilId || S.meId, p = player(id);
  const back = `<div class="section-title"><button class="btn sm ghost" data-act="tab" data-tab="${S.prevTab || 'tabla'}">← Volver</button></div>`;
  if (!p) return back + '<div class="empty">No encontré a ese jugador.</div>';
  const H = history(), l = H.get(id) || [];
  const g = l.filter(x => x.out === 'W').length, pe = l.filter(x => x.out === 'L').length, e = l.length - g - pe;
  const st = streaks(l), stars = mvpEvents().filter(x => x.pid === id).length;
  const { dupla, bestia } = duoNemesis(id);
  const curr = st.cw >= 1 ? `🔥 ${st.cw} ganado${st.cw > 1 ? 's' : ''} seguido${st.cw > 1 ? 's' : ''}` : st.cl >= 1 ? `🥶 ${st.cl} perdido${st.cl > 1 ? 's' : ''} seguido${st.cl > 1 ? 's' : ''}` : '–';
  const tv = TORNEOS.find(x => x.kind === 'vivo'), sv = standings(tv);
  const posV = sv.played.findIndex(r => r.p.id === id), rowV = sv.played[posV];
  const ap = APERTURA_2026.map((r, i) => ({ ...r, pos: i + 1 })).find(r => playerByName(r.n)?.id === id);
  const mine = S.board.find(b => b.player_id === id);
  const boardRank = mine ? [...S.board].sort((a, b) => b.best - a.best || b.total - a.total).findIndex(b => b.player_id === id) + 1 : 0;
  const others = S.players.filter(q => q.id !== id && !q.guest);
  const chip = { W: ['G', 'w'], D: ['E', 'd'], L: ['P', 'l'] };
  const line = [...l].reverse().slice(0, 20).map(x => {
    const star = !x.m.voting_open && mvpWinners(x.m.id).winners.some(w => w.player_id === id);
    return `<div class="tl"><span class="tl-date">${new Date(x.m.played_on + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
      <span class="tl-chip ${chip[x.out][1]}">${chip[x.out][0]}</span><span class="tl-txt">Equipo ${x.team}${star ? ' · ⭐ jugador del partido' : ''}</span></div>`;
  }).join('');
  return back + `
    <div class="card perfil-head">${av(p, 'xl')}
      <div><h2>${esc(p.name)}</h2><div class="muted small">${p.id === S.meId ? 'Este sos vos' : p.guest ? 'Invitado' : 'Jugador del plantel'}</div>
        <div class="small" style="margin-top:6px">Racha actual: <b>${curr}</b></div></div></div>
    <div class="statrow">
      <div><b>${l.length}</b><span>jugados</span></div><div><b>${g}</b><span>ganados</span></div>
      <div><b>${e}</b><span>empates</span></div><div><b>${pe}</b><span>perdidos</span></div>
      <div><b>${pct(g, l.length)}</b><span>victorias</span></div><div><b>${stars}</b><span>⭐</span></div></div>
    <div class="card">
      <div class="kv"><span>🏆 ${esc(tv.name)}</span><b>${rowV ? `${posV + 1}º · ${rowV.pts} pts (${rowV.pj} PJ)` : 'todavía no jugó'}</b></div>
      <div class="kv"><span>🏆 Apertura 2026</span><b>${ap ? `${ap.pos}º · ${num(ap.pts)} pts (${ap.asist} asist.)` : 'sin datos'}</b></div>
      <div class="kv"><span>🎮 Juego de la semana</span><b>${mine ? `${boardRank}º · mejor ${mine.best}/5 (${mine.tries}/${MAX_TRIES} intentos)` : 'todavía no jugó'}</b></div>
      <div class="kv"><span>Mejor racha</span><b>${st.bw} victoria${st.bw === 1 ? '' : 's'}</b></div>
      <div class="kv"><span>Peor racha</span><b>${st.bl} derrota${st.bl === 1 ? '' : 's'}</b></div>
      <div class="kv"><span>🤝 Mejor dupla</span><b>${dupla ? `${esc(dupla.q.name)} (${dupla.w}/${dupla.n})` : `todavía sin datos (mín. ${MIN})`}</b></div>
      <div class="kv"><span>😈 Bestia negra</span><b>${bestia ? `${esc(bestia.q.name)} (le ganó ${bestia.w}/${bestia.n})` : `todavía sin datos (mín. ${MIN})`}</b></div>
    </div>
    <button class="btn primary wide" data-act="wrapped" data-id="${id}">🎁 Ver el resumen de ${nowAR().iso.slice(0, 4)}</button>
    <div class="section-title"><h2>Último${l.length === 1 ? '' : 's'} partido${l.length === 1 ? '' : 's'}</h2></div>
    ${line ? `<div class="card timeline">${line}</div>` : '<div class="empty">Todavía no jugó ningún partido.</div>'}
    <div class="section-title"><h2>Comparar con otro</h2></div>
    <div class="card"><div class="field" style="margin:0"><label for="vs">Ver el historial con otro jugador</label>
      <select class="sel" id="vs" style="width:100%"><option value="">Elegí un jugador…</option>
        ${others.map(q => `<option value="${q.id}">${esc(q.name)}</option>`).join('')}</select></div>
      <div id="vsres"></div></div>`;
}
function bindPerfil() {
  const sel = $('#vs'); if (!sel) return;
  const id = S.perfilId || S.meId, p = player(id);
  sel.onchange = e => {
    const q = player(e.target.value); if (!q) return $('#vsres').innerHTML = '';
    const v = versus(id, q.id), tj = v.wj + v.dj + v.lj, ta = v.aw + v.bw + v.d;
    $('#vsres').innerHTML = (tj + ta === 0) ? `<div class="empty">${esc(p.name)} y ${esc(q.name)} nunca coincidieron en un partido.</div>` : `
      <div class="vsbox"><h4>🤝 Del mismo equipo · ${tj} partido${tj === 1 ? '' : 's'}</h4>
        ${tj ? `<div class="vsnums"><div><b>${v.wj}</b><span>ganaron</span></div><div><b>${v.dj}</b><span>empataron</span></div><div><b>${v.lj}</b><span>perdieron</span></div><div><b>${pct(v.wj, tj)}</b><span>victorias</span></div></div>` : '<div class="muted small">Nunca jugaron juntos.</div>'}</div>
      <div class="vsbox"><h4>⚔️ Enfrentados · ${ta} ${ta === 1 ? 'vez' : 'veces'}</h4>
        ${ta ? `<div class="vsnums"><div><b>${v.aw}</b><span>ganó ${esc(p.name.split(' ')[0])}</span></div><div><b>${v.d}</b><span>empates</span></div><div><b>${v.bw}</b><span>ganó ${esc(q.name.split(' ')[0])}</span></div></div>` : '<div class="muted small">Nunca se enfrentaron.</div>'}</div>`;
  };
}

/* ---------------- render ---------------- */
function render() {
  const me = player(S.meId);
  const name = S.user ? (me?.name || S.user.user_metadata?.full_name || S.user.email) : '';
  const avatar = me ? av(me, 'sm') : `<span class="av sm">${esc(initials(name || '?'))}</span>`;
  app.innerHTML = `
    <header class="top">
      <div class="logo">⚽ YASTON<small>Los jueves, fútbol 5</small></div>
      ${S.user ? `<div class="me" data-act="${S.meId ? 'perfil' : 'claim'}" data-id="${S.meId || ''}" title="${S.meId ? 'Mi perfil' : 'Elegir quién sos'}">${avatar}<span>${esc(name.split(' ')[0])}</span><button data-act="logout">Salir</button></div>`
        : '<button class="btn sm primary" data-act="login">Entrar con Google</button>'}
    </header>
    <main class="wrap">${S.tab === 'tabla' ? lastMatchCard() + gameNews() : ''}${S.tab === 'tabla' || S.tab === 'partidos' ? gameBanner() : ''}${S.tab === 'perfil' ? viewPerfil() : S.tab === 'tabla' ? viewTabla() : S.tab === 'premios' ? viewPremios() : S.tab === 'juegos' ? viewJuegos() : S.tab === 'partidos' ? viewPartidos() : viewPlantel()}</main>
    <nav class="tabs"><div class="in">
      ${[['tabla', '🏆', 'Tabla'], ['premios', '🏅', 'Premios'], ['partidos', '📅', 'Partidos'], ['plantel', '👥', 'Plantel'], ['juegos', '🎮', 'Juegos']]
        .map(([k, i, l]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><b>${i}</b>${l}</button>`).join('')}
    </div></nav>`;
  mountGame();
  bindPerfil();
}

function prevWeekCard() {
  const r = prevResult(); if (!r) return '';
  const w = r.winners, rest = r.rows.filter(x => !w.includes(x)).slice(0, 2);
  return `<div class="card prevweek"><div class="eyebrow">🏆 Ganador de la semana pasada · ${weekLabel(r.week)}</div>
    <div class="weekly-main"><span class="avs">${w.map(x => av(x.p, 'lg')).join('')}</span>
      <div class="gc-txt"><b>${esc(w.map(x => x.p.name).join(' y '))}</b>
        <span class="muted small">${w.length > 1 ? 'Empataron' : 'Ganó'} ${esc(r.game.title)} con ${w[0].best} de 5 (${w[0].tries} intento${w[0].tries === 1 ? '' : 's'}).</span></div></div>
    ${rest.length ? `<div class="small muted" style="margin-top:8px">${rest.map((x, i) => `${w.length + i + 1}º ${esc(x.p.name)} (${x.best}/5)`).join(' · ')}</div>` : ''}</div>`;
}
function gameNews() { // aviso arriba de la Tabla: quién ganó el juego de la semana pasada y cuál es el de esta
  const r = prevResult(), g = currentGame(); if (!r) return '';
  const w = r.winners.map(x => esc(x.p.name)).join(' y ');
  return `<div class="gamenews"><div class="small">🏆 ${r.winners.length > 1 ? 'Empataron' : 'Ganó'} el juego de la semana pasada (${esc(r.game.title)}): <b>${w}</b> con ${r.winners[0].best} de 5.
    Esta semana: <b>${esc(g.title)}</b>.</div><button class="btn sm" data-act="tab" data-tab="juegos">Jugar</button></div>`;
}
function viewJuegos() {
  const g = currentGame();
  if (S.game === g.id && S.playId) {
    return `<div class="section-title"><button class="btn sm ghost" data-act="game" data-g="">← Juegos</button></div><div id="game-root"></div>`;
  }
  const used = S.plays.length, left = Math.max(0, MAX_TRIES - used);
  const best = S.plays.reduce((m, x) => Math.max(m, x.goals ?? 0), 0);
  const gure = S.players.find(p => !p.guest && p.name.trim().toLowerCase() === 'gure');
  let cta;
  if (!S.user) cta = '<button class="btn google sm" data-act="login">Entrar con Google para jugar</button>';
  else if (!S.meId) cta = '<button class="btn primary" data-act="claim">Elegí quién sos para jugar</button>';
  else if (!left) cta = '<span class="muted small">Ya usaste tus 3 intentos. Se renuevan el lunes.</span>';
  else cta = `<button class="btn primary" data-act="play">${used ? 'Jugar otra vez' : 'Jugar'}</button>`;
  const dots = S.user && S.meId ? `<div class="tries">${Array.from({ length: MAX_TRIES }, (_, k) => `<i class="${k < used ? 'used' : ''}"></i>`).join('')}
      <span class="muted small">${left ? `Te quedan ${left} de ${MAX_TRIES} intentos` : 'Sin intentos'}${used ? ` · tu mejor: ${best} de 5` : ''}</span></div>` : '';
  const rows = S.board.map(b => ({ ...b, p: player(b.player_id) })).filter(r => r.p)
    .sort((a, b) => b.best - a.best || b.total - a.total || a.tries - b.tries || a.p.name.localeCompare(b.p.name));
  return `<div class="section-title"><h2>Juegos</h2></div>
    ${!S.user ? `<div class="card notice"><b>🔒 Hay que entrar con Google</b>
      <div class="muted small" style="margin:4px 0 10px">Para jugar y para votar al jugador del partido tenés que entrar con tu Gmail. Para ver la tabla no hace falta.</div>
      <button class="btn google sm" data-act="login">Entrar con Google</button></div>` : ''}
    <div class="card weekly">
      <div class="eyebrow">Juego de la semana · ${weekLabel(S.week)}</div>
      <div class="weekly-main">
        ${g.id === 'penales' ? `<span class="gc-art">${gure ? av(gure, 'lg') : '<span class="av lg">G</span>'}<span class="gc-ball">⚽</span></span>` : '<span class="gc-art"><span class="av lg qmark">🏟️</span></span>'}
        <div class="gc-txt"><b>${esc(g.title)}</b><span class="muted small">${esc(g.blurb)}</span></div>
      </div>
      ${dots}
      <div class="weekly-cta">${cta}</div>
      <p class="legend" style="margin:10px 0 0">Hay un juego nuevo por semana. Cada cuenta de Google juega hasta ${MAX_TRIES} veces y en la tabla cuenta el mejor intento.</p>
    </div>
    ${prevWeekCard()}
    <div class="section-title"><h2>Tabla de la semana</h2></div>
    ${rows.length ? `<div class="table-wrap"><table class="tbl board"><thead><tr><th>#</th><th class="l">Jugador</th><th>Mejor</th><th>Total</th><th>Int.</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i === 0 ? 'top1' : ''} ${r.p.id === S.meId ? 'mine' : ''}"><td class="pos">${i + 1}</td>
        <td class="l"><div class="pl">${av(r.p)}<span class="who"><span class="n">${esc(r.p.name)}</span></span></div></td>
        <td class="pts">${r.best}<small>/5</small></td><td>${r.total}</td><td>${r.tries}/${MAX_TRIES}</td></tr>`).join('')}</tbody></table></div>
      <p class="legend">Mejor: goles del mejor intento (de 5 penales). Total: goles sumando todos tus intentos. Int.: intentos usados.</p>`
      : '<div class="empty">Todavía nadie jugó esta semana. ¡Sé el primero!</div>'}`;
}

function mountGame() {
  const g = currentGame();
  if (S.tab !== 'juegos' || S.game !== g.id || !S.playId || !$('#game-root')) return;
  const mods = { penales: window.YastonPenales, adivina: window.YastonAdivina }, mod = mods[g.id];
  if (!mod) return;
  const gure = S.players.find(p => !p.guest && p.name.trim().toLowerCase() === 'gure');
  const left = () => Math.max(0, MAX_TRIES - S.plays.length);
  mod.mount($('#game-root'), {
    name: gure?.name || 'Gure', photo: gure?.photo_url || null,
    matches: S.matches.filter(m => m.result && ['A', 'B'].every(t => S.mp.some(x => x.match_id === m.id && x.team === t))),
    pitch: (m, o) => pitchHtml(m, o), label: m => fmtDate(m.played_on),
    figure: m => { if (m.voting_open) return ''; const w = mvpWinners(m.id).winners; return w.length ? w.map(x => player(x.player_id)?.name || '?').join(' y ') : ''; },
    tryLabel: () => `Intento ${S.plays.length} de ${MAX_TRIES}`,
    attemptsLeft: left,
    best: () => S.plays.reduce((m, x) => Math.max(m, x.goals ?? 0), 0),
    onFinish: async goals => { const id = S.playId; S.playId = null; await must(db.rpc('finish_play', { p_play: id, p_goals: goals })); await loadGameData(); },
    onAgain: async () => {
      try { S.playId = await must(db.rpc('start_play', { p_game: g.id })); await loadGameData(); return true; }
      catch (e) { toast(e.message, true); return false; }
    },
    onExit: () => { S.game = null; S.playId = null; render(); scrollTo(0, 0); },
  });
}

function playerByName(n) {
  const k = n.trim().toLowerCase();
  const target = ALIAS[k] || k;
  return S.players.find(p => !p.guest && p.name.trim().toLowerCase() === target) || null;
}
function champion(t) {
  if (t.champion) return t.champion;
  if (t.kind === 'fija') { const top = APERTURA_2026[0]; return playerByName(top.n)?.name || top.n; }
  return null;
}
function avName(n) { // avatar de un nombre de la planilla (con foto si es un jugador del plantel)
  const p = playerByName(n);
  return p ? av(p) : `<span class="av">${esc(initials(n))}</span>`;
}

function viewTabla() {
  const t = TORNEOS.find(x => x.id === S.torneo) || torneoActual();
  const finished = t.to < todayISO();
  const champ = champion(t);
  const rango = `${finished ? 'Finalizó el' : 'Termina el'} ${fmtShort(t.to)}`;
  const head = `
    <div class="section-title"><h2>Tabla de posiciones</h2>
      <div class="filters"><select class="sel" data-act="torneo">
        ${TORNEOS.map(x => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${x.name}</option>`).join('')}
      </select></div></div>
    <div class="torneo-card">
      <div><b>${esc(t.full)} ${t.name.split(' ').pop()}</b><div class="muted small">${rango}</div></div>
      <span class="badge ${finished ? '' : 'hot'}">${finished ? 'Finalizado' : 'En juego'}</span>
    </div>`;
  let body;
  if (t.kind === 'sin-datos') {
    body = `<div class="card champ-card">${avName(champ).replace('class="av', 'class="av xl')}
      <div><div class="eyebrow">Campeón</div><div class="champ-name">🏆 ${esc(champ)}</div>
      <div class="muted small" style="margin-top:6px">De este torneo no hay tabla ni partidos cargados.</div></div></div>`;
  } else if (t.kind === 'fija') {
    const rows = APERTURA_2026.map((r, i) => ({ ...r, pos: i + 1 }));
    const list = S.sort === 'avg'
      ? [...rows.filter(r => r.asist >= MIN).sort((a, b) => b.prom - a.prom || b.asist - a.asist || b.pts - a.pts), ...rows.filter(r => r.asist < MIN)]
      : rows;
    body = `<div class="table-wrap"><table class="tbl apertura">
      <thead><tr><th>#</th><th class="l">Jugador</th>
        <th class="sortable ${S.sort === 'pts' ? 'on' : ''}" data-act="sort" data-s="pts">Pts${S.sort === 'pts' ? '▾' : ''}</th>
        <th>Asist.</th>
        <th class="sortable ${S.sort === 'avg' ? 'on' : ''}" data-act="sort" data-s="avg">Prom.${S.sort === 'avg' ? '▾' : ''}</th></tr></thead>
      <tbody>${list.map((r, i) => `<tr class="${i === 0 ? 'top1' : ''} ${S.sort === 'avg' && r.asist < MIN ? 'few' : ''}"><td class="pos">${i + 1}</td>
        <td class="l"><div class="pl">${avName(r.n)}<span class="who"><span class="n">${esc(playerByName(r.n)?.name || r.n)}</span></span></div></td>
        <td class="pts">${num(r.pts)}</td><td>${r.asist}</td><td class="avg">${num(r.prom)}${r.asist < MIN ? '*' : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="rules">
      <span class="rule w">Equipo ganador: <b>${t.rules.W} puntos</b></span>
      <span class="rule d">Empate: <b>${t.rules.D} puntos</b></span>
      <span class="rule l">Equipo perdedor: <b>${t.rules.L} punto</b></span>
    </div>
    <p class="legend">Partidos: ${t.partidos}. Asist.: partidos jugados. Prom.: puntos ÷ asistencia. Tocá <b>Pts</b> o <b>Prom.</b> para ordenar. Al ordenar por promedio solo entran los que jugaron al menos ${MIN} partidos; los demás van al final, con *.
    Esta tabla es la final del torneo y no se modifica.</p>`;
  } else {
    const { played, never } = standings(t);
    const few = r => S.sort === 'avg' && r.pj > 0 && r.pj < MIN;
    const row = (r, i, dim) => `<tr class="${i === 0 && !dim ? 'top1' : ''} ${dim ? 'dim' : ''} ${few(r) ? 'few' : ''}">
      <td class="pos">${dim ? '–' : i + 1}</td>
      <td class="l"><div class="pl">${av(r.p)}<span class="who"><span class="n">${esc(r.p.name)}</span><span class="tags">${r.p.guest ? '<span class="badge">invitado</span>' : ''}${r.st.cw >= 3 ? `<span class="badge hot" title="Racha de victorias">🔥${r.st.cw}</span>` : r.st.cl >= 3 ? `<span class="badge cold" title="Racha de derrotas">🥶${r.st.cl}</span>` : ''}</span></span></div></td>
      <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.pe}</td><td>${r.mvp ? '⭐' + r.mvp : '–'}</td><td class="avg">${r.pj ? Math.round(r.pct * 100) + '%' + (r.pj < MIN ? '*' : '') : '–'}</td><td class="pts">${r.pts}</td></tr>`;
    const played_n = S.matches.filter(m => m.result && m.played_on >= t.from && m.played_on <= t.to).length;
    body = !S.players.length ? '<div class="empty">Todavía no hay jugadores cargados.</div>' : `
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>#</th><th class="l">Jugador</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>MVP</th>
        <th class="sortable ${S.sort === 'avg' ? 'on' : ''}" data-act="sort" data-s="avg" title="Ordenar por promedio de victorias">%${S.sort === 'avg' ? '▾' : ''}</th>
        <th class="sortable ${S.sort === 'pts' ? 'on' : ''}" data-act="sort" data-s="pts" title="Ordenar por puntos">Pts${S.sort === 'pts' ? '▾' : ''}</th></tr></thead>
      <tbody>${played.map((r, i) => row(r, i)).join('')}${never.map(r => row(r, 0, true)).join('')}</tbody>
    </table></div>
    <div class="rules">
      <span class="rule w">Ganado: <b>${t.rules.W} pts</b></span><span class="rule d">Empate: <b>${t.rules.D} pt</b></span><span class="rule l">Perdido: <b>${t.rules.L} pts</b></span>
    </div>
    <p class="legend">PJ: jugados · G/E/P: ganados/empatados/perdidos · ⭐ veces elegido jugador del partido · %: promedio de victorias (ganados ÷ jugados). Tocá <b>%</b> o <b>Pts</b> arriba para ordenar la tabla por promedio o por puntos. Al ordenar por promedio solo entran los que jugaron al menos ${MIN} partidos; los demás van al final, con * en el %.
    ${played_n} partido${played_n === 1 ? '' : 's'} jugado${played_n === 1 ? '' : 's'}.
    🔥 3 o más victorias seguidas · 🥶 3 o más derrotas seguidas. Los de abajo (en gris) son parte del grupo pero todavía no jugaron.</p>
    <div class="section-title"><h2>La carrera por el título</h2></div>${raceHtml(t)}
    <div class="section-title"><h2>Chances de campeón</h2></div>${oddsHtml(t)}`;
  }
  const palmares = [...TORNEOS].sort((a, b) => a.from.localeCompare(b.from)).map(x => {
    const c = champion(x), fin = x.to < todayISO();
    return `<tr><td>${x.to.slice(0, 4)}</td><td class="l">${esc(x.full)}</td><td>${fin && c ? '🏆 ' + esc(c) : '<span class="muted">En juego</span>'}</td><td>${fmtShort(x.to)}</td></tr>`;
  }).join('');
  const navidad = S.meId && nowAR().iso.slice(5, 7) === '12'
    ? `<div class="card notice"><b>🎁 ¡Ya está tu resumen del año!</b><div class="muted small" style="margin:4px 0 10px">Tus partidos, tu racha, tu dupla y tu apodo de ${nowAR().iso.slice(0, 4)}.</div><button class="btn primary sm" data-act="wrapped" data-id="${S.meId}">Verlo</button></div>` : '';
  return navidad + head + body + `
    <div class="section-title"><h2>Títulos</h2></div>
    <div class="table-wrap"><table class="tbl titles"><thead><tr><th>Año</th><th class="l">Torneo</th><th>Campeón</th><th>Finaliza</th></tr></thead><tbody>${palmares}</tbody></table></div>`;
}

const FORMATIONS = { 1: [1], 2: [1, 1], 3: [1, 2], 4: [1, 1, 2], 5: [1, 2, 2], 6: [1, 2, 3], 7: [2, 2, 3] };
function pitchHtml(m, o = {}) {
  const { hide = false, swap = false, stat = false } = o; // hide: sin resultado ni estrellas; swap: equipos al revés; stat: fichas sin tocar
  const flip = t => swap ? (t === 'A' ? 'B' : 'A') : t;
  const mvpIds = !hide && !m.voting_open ? mvpWinners(m.id).winners.map(w => w.player_id) : [];
  const toks = ['A', 'B'].map(t => {
    const ps = S.mp.filter(x => x.match_id === m.id && x.team === flip(t)).map(x => player(x.player_id)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const rows = FORMATIONS[Math.min(ps.length, 7)] || [3, 3, 3];
    const out = []; let k = 0;
    rows.forEach((cnt, r) => {
      const y = 8 + r * 15;
      for (let c = 0; c < cnt && k < ps.length; c++, k++) {
        const p = ps[k], x = (c + 1) / (cnt + 1) * 100;
        const inner = `<span class="p-av">${av(p)}${mvpIds.includes(p.id) ? '<span class="p-star">⭐</span>' : ''}</span><span class="p-name">${esc(p.name)}</span>`;
        out.push(stat
          ? `<span class="p-tok ${t}" style="left:${x.toFixed(1)}%;top:${t === 'A' ? y : 100 - y}%">${inner}</span>`
          : `<button class="p-tok ${t}" style="left:${x.toFixed(1)}%;top:${t === 'A' ? y : 100 - y}%" data-act="perfil" data-id="${p.id}" title="${esc(p.name)}">${inner}</button>`);
      }
    });
    return out.join('');
  }).join('');
  return `<div class="pitch" role="group" aria-label="Equipos en la cancha">
    <i class="p-line"></i><i class="p-circle"></i><i class="p-box top"></i><i class="p-box bot"></i><i class="p-goal top"></i><i class="p-goal bot"></i>
    <span class="p-tag a">EQUIPO A${!hide && m.result === flip('A') ? ' 🏆' : ''}</span><span class="p-tag b">EQUIPO B${!hide && m.result === flip('B') ? ' 🏆' : ''}</span>
    ${toks}</div>`;
}

function mvpBox(m) {
  const { winners, rows } = mvpWinners(m.id);
  if (!winners.length) return `<div class="mvpbox"><h4>⭐ Jugador del partido</h4><span class="muted small">Votación cerrada sin votos.</span></div>`;
  const rank = rows.map(r => `${esc(player(r.player_id)?.name || '?')} (${r.votes})`).join(' · ');
  return `<div class="mvpbox"><h4>⭐ Jugador del partido</h4>
    ${winners.map(w => `<div class="mvpwin">${av(player(w.player_id), 'lg')}<div>${esc(player(w.player_id)?.name || '?')}<div class="muted small">${w.votes} voto${w.votes === 1 ? '' : 's'}</div></div></div>`).join('')}
    <div class="mvprank">${rank}</div></div>`;
}

function voteBox(m) {
  const parts = S.mp.filter(x => x.match_id === m.id);
  const total = S.totals[m.id] || 0;
  const info = `<div class="muted small">${total}/${parts.length} ya votaron</div>`;
  const mine = parts.find(x => x.player_id === S.meId);
  if (!S.user) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Para votar al jugador del partido tenés que entrar con Google.</div><div style="margin:10px 0"><button class="btn sm primary" data-act="login">Entrar con Google</button></div>${info}</div>`;
  if (!S.meId) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Todavía no elegiste quién sos.</div><div style="margin:10px 0"><button class="btn sm primary" data-act="claim">Elegir quién soy</button></div>${info}</div>`;
  if (!mine) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Solo votan los que jugaron este partido.</div>${info}</div>`;
  const myVote = S.myVotes[m.id];
  const opts = parts.filter(x => x.player_id !== S.meId).map(x => player(x.player_id)).filter(Boolean);
  return `<div class="votebox"><h4>🗳️ ¿Quién fue el mejor del partido?</h4>
    <div class="muted small">${myVote ? 'Ya votaste. Podés cambiar tu voto hasta que cierre la votación.' : 'Tocá a un jugador para votar. Tu voto es secreto.'}</div>
    <div class="vgrid">${opts.map(p => `<button class="vopt ${myVote === p.id ? 'sel' : ''}" data-act="vote" data-m="${m.id}" data-p="${p.id}">${av(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <div style="margin-top:8px">${info}</div></div>`;
}


/* ---------------- simulador de partido ---------------- */
const SIM_RUNS = 10000;
function rngFrom(str) { // número aleatorio con semilla: el mismo partido da siempre la misma simulación
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function simulate(m) {
  const H = history(), ev = mvpEvents(), pairs = pairStats();
  const ids = { A: [], B: [] };
  for (const x of S.mp.filter(x => x.match_id === m.id)) ids[x.team].push(x.player_id);
  if (!ids.A.length || !ids.B.length) return null;
  const K = 4; // "partidos de prueba": a quien jugó poco se lo acerca a 50% en vez de creerle un 100% de un solo partido
  const info = id => {
    const l = H.get(id) || [], g = l.filter(x => x.out === 'W').length, e = l.filter(x => x.out === 'D').length;
    const st = streaks(l), stars = ev.filter(x => x.pid === id).length;
    let s = (g + 0.5 * e + K * 0.5) / (l.length + K);
    s += Math.min(0.06, (l.length ? stars / l.length : 0) * 0.1);
    if (st.cw >= 3) s += 0.02;
    if (st.cl >= 3) s -= 0.02;
    return { id, p: player(id), pj: l.length, g, s, st, stars, pct: l.length ? g / l.length : null };
  };
  const build = key => {
    const ps = ids[key].map(info), set = new Set(ids[key]);
    const base = ps.reduce((a, x) => a + x.s, 0) / ps.length;
    const duos = pairs.filter(x => x.n >= MIN && set.has(x.ids[0]) && set.has(x.ids[1]));
    const chem = duos.length ? duos.reduce((a, x) => a + (x.w / x.n - 0.5), 0) / duos.length * 0.15 : 0;
    const falta = Math.max(0, 5 - ps.length) * 0.05; // jugar con menos gente pesa
    return { key, ps, duos, strength: base + chem - falta, base };
  };
  const A = build('A'), B = build('B');
  const rand = rngFrom(m.id + '|' + SIM_RUNS);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  let wa = 0, wb = 0, d = 0;
  for (let i = 0; i < SIM_RUNS; i++) {
    const diff = (A.strength + 0.2 * normal()) - (B.strength + 0.2 * normal()); // el fútbol 5 tiene mucho de azar
    if (Math.abs(diff) < 0.02) d++; else if (diff > 0) wa++; else wb++;
  }
  return { A, B, pA: wa / SIM_RUNS, pD: d / SIM_RUNS, pB: wb / SIM_RUNS };
}
function simFacts(r) {
  const out = [], nm = x => esc(x.p?.name || '?');
  const pct1 = x => x.pct == null ? 'debuta' : `${Math.round(x.pct * 100)}% de victorias`;
  for (const T of [r.A, r.B]) {
    const played = T.ps.filter(x => x.pj > 0).sort((a, b) => b.s - a.s);
    if (played[0]) out.push(`⭐ La figura del Equipo ${T.key}: <b>${nm(played[0])}</b> (${pct1(played[0])}).`);
    const duo = [...T.duos].sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n)[0];
    if (duo) out.push(`🤝 En el Equipo ${T.key}, <b>${esc(duo.ids.map(i => player(i)?.name || '?').join(' y '))}</b> ganaron ${duo.w} de ${duo.n} juntos.`);
    for (const x of T.ps) {
      if (x.st.cw >= 3) out.push(`🔥 <b>${nm(x)}</b> (Equipo ${T.key}) llega con ${x.st.cw} victorias seguidas.`);
      else if (x.st.cl >= 3) out.push(`🥶 <b>${nm(x)}</b> (Equipo ${T.key}) viene con ${x.st.cl} derrotas seguidas.`);
    }
  }
  const deb = [...r.A.ps, ...r.B.ps].filter(x => x.pj === 0);
  if (deb.length) out.push(`🆕 ${deb.length === 1 ? 'Debuta' : 'Debutan'}: <b>${deb.map(nm).join(', ')}</b>. Sin historial, se los toma como una incógnita.`);
  return out;
}
function simHeadline(r) {
  const gap = Math.abs(r.pA - r.pB), fav = r.pA >= r.pB ? 'A' : 'B', fp = Math.round(Math.max(r.pA, r.pB) * 100);
  if (gap < 0.06) return `Partidazo parejo: los números no se animan a elegir. Se define por detalles.`;
  if (gap < 0.2) return `El Equipo ${fav} llega apenas favorito (${fp}% de ganar), pero es un partido para cualquiera.`;
  if (gap < 0.4) return `El Equipo ${fav} es favorito (${fp}% de ganar). Al otro le toca sacar un batacazo.`;
  return `Paliza anunciada: el Equipo ${fav} tiene ${fp}% de ganar. El otro equipo necesita un milagro.`;
}
function simBox(m) {
  const st = S.sims[m.id];
  if (!st) return `<div class="simbox"><button class="btn sm" data-act="simulate" data-id="${m.id}">🔮 Simular cómo va a salir</button></div>`;
  if (st === 'run') return `<div class="simbox"><h4>🔮 Simulador del partido</h4><div class="simrun">Simulando ${SIM_RUNS.toLocaleString('es-AR')} partidos…<div class="simprog"><i></i></div></div></div>`;
  const r = simulate(m);
  if (!r) return '';
  const pa = Math.round(r.pA * 100), pd = Math.round(r.pD * 100), pb = Math.max(0, 100 - pa - pd);
  return `<div class="simbox"><h4>🔮 Simulador del partido</h4>
    <div class="simbar"><span class="a" style="flex:${Math.max(pa, 4)}">A ${pa}%</span><span class="d" style="flex:${Math.max(pd, 4)}">E ${pd}%</span><span class="b" style="flex:${Math.max(pb, 4)}">B ${pb}%</span></div>
    <p class="sim-head">${simHeadline(r)}</p>
    <ul class="sim-facts">${simFacts(r).map(x => `<li>${x}</li>`).join('')}</ul>
    <small class="muted">Se simularon ${SIM_RUNS.toLocaleString('es-AR')} partidos con las victorias, estrellas, rachas y duplas de cada uno. Es solo un juego, no es oficial.</small></div>`;
}

/* ---------------- hora de Argentina y próximo partido (jueves de 19 a 20) ---------------- */
const AR_TZ = 'America/Argentina/Buenos_Aires';
function nowAR() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { iso: `${g('year')}-${g('month')}-${g('day')}`, h: Number(g('hour')), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function nextThursday() { // hoy si es jueves y todavía no son las 20; si no, el que viene
  const n = nowAR();
  if (n.dow === 4 && n.h < 20) return n.iso;
  return addDays(n.iso, ((4 - n.dow + 7) % 7) || 7);
}
const cdText = ms => {
  const min = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `faltan ${d} día${d > 1 ? 's' : ''} y ${h} h` : h ? `faltan ${h} h ${m} min` : `faltan ${m} min`;
};
function gameBanner() {
  const nxt = nextThursday(), start = new Date(`${nxt}T19:00:00-03:00`), end = new Date(`${nxt}T20:00:00-03:00`), now = new Date();
  const m = S.matches.find(x => x.played_on === nxt), playing = now >= start && now < end;
  const n = m ? S.mp.filter(x => x.match_id === m.id).length : 0;
  const title = playing ? '🔴 Se está jugando ahora' : nxt === nowAR().iso ? '⚽ Hoy se juega' : '📅 Próximo partido';
  return `<div class="gamebanner ${playing ? 'live' : ''}">
    <div><b>${title}</b>
      <div class="muted small">${fmtDate(nxt)} · de 19 a 20 hs${playing ? '' : ` · <span id="cd" data-t="${start.getTime()}">${cdText(start - now)}</span>`}</div>
      <div class="small" style="margin-top:4px">${m ? `✅ Ya están los equipos (${n} jugadores)` : 'Todavía no están armados los equipos'}</div></div>
    ${m && S.tab !== 'partidos' ? '<button class="btn sm" data-act="tab" data-tab="partidos">Ver equipos</button>' : ''}
  </div>`;
}
setInterval(() => {
  const el = $('#cd'); if (!el) return;
  const ms = Number(el.dataset.t) - Date.now();
  if (ms <= 0) render(); else el.textContent = cdText(ms);
}, 30000);

/* ---------------- crónica automática ---------------- */
function chronicle(m) {
  const done = S.matches.filter(x => x.result).sort((a, b) => a.played_on.localeCompare(b.played_on) || a.id.localeCompare(b.id));
  const idx = done.findIndex(x => x.id === m.id); if (idx < 0) return null;
  const TM = teamsByMatch(), T = TM.get(m.id) || {}, ids = Object.keys(T), prev = done.slice(0, idx);
  const rnd = rngFrom(m.id + '|cronica'), pickT = arr => arr[Math.floor(rnd() * arr.length)];
  const nm = id => `<b>${esc(player(id)?.name || '?')}</b>`;
  const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];
  const before = id => prev.filter(x => TM.get(x.id)?.[id]).map(x => ({ out: x.result === 'D' ? 'D' : x.result === TM.get(x.id)[id] ? 'W' : 'L' }));
  let head = m.result === 'D'
    ? pickT(['Se repartieron los puntos: empate entre los dos equipos.', 'Terminó parejo: empate.', 'Nadie pudo sacar ventaja y el partido terminó empatado.'])
    : pickT([`Se quedó con el partido el Equipo ${m.result}.`, `Ganó el Equipo ${m.result}.`, `Fue para el Equipo ${m.result}.`]);
  if (!m.voting_open) {
    const w = mvpWinners(m.id).winners;
    if (w.length) head += w.length === 1 ? ` La figura fue ${nm(w[0].player_id)}.` : ` Las figuras fueron ${list(w.map(x => nm(x.player_id)))}.`;
  } else head += ' La votación a la figura sigue abierta.';
  const facts = [];
  for (const id of ids) {
    const out = m.result === 'D' ? 'D' : m.result === T[id] ? 'W' : 'L', b = before(id), sB = streaks(b), sA = streaks([...b, { out }]);
    if (out === 'W' && sA.cw >= 3) facts.push([1, `${nm(id)} llegó a ${sA.cw} victorias seguidas 🔥`]);
    else if (out === 'W' && sB.cl >= 3) facts.push([2, `${nm(id)} cortó una racha de ${sB.cl} derrotas seguidas`]);
    else if (out === 'L' && sB.cw >= 3) facts.push([2, `${nm(id)} perdió después de ${sB.cw} victorias seguidas`]);
    else if (out === 'L' && sA.cl >= 3) facts.push([3, `${nm(id)} acumula ${sA.cl} derrotas seguidas 🥶`]);
  }
  const lines = facts.sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]);
  const debut = ids.filter(id => !player(id)?.guest && before(id).length === 0);
  if (debut.length) lines.push(`${debut.length === 1 ? 'Debutó' : 'Debutaron'} ${list(debut.map(nm))} 🆕`);
  const guests = ids.filter(id => player(id)?.guest);
  if (guests.length) lines.push(`Jugó${guests.length > 1 ? 'ron' : ''} de invitado${guests.length > 1 ? 's' : ''}: ${list(guests.map(nm))}`);
  // ¿cambió el líder del torneo vivo?
  const tv = TORNEOS.find(x => x.kind === 'vivo');
  if (m.played_on >= tv.from && m.played_on <= tv.to) {
    const lead = k => {
      const pts = new Map(), gg = new Map();
      for (const x of done.slice(0, k).filter(x => x.played_on >= tv.from && x.played_on <= tv.to)) {
        for (const [pid, team] of Object.entries(TM.get(x.id) || {})) {
          const w = x.result === 'D' ? tv.rules.D : x.result === team ? tv.rules.W : tv.rules.L;
          pts.set(pid, (pts.get(pid) || 0) + w); if (x.result === team) gg.set(pid, (gg.get(pid) || 0) + 1);
        }
      }
      return [...pts.keys()].sort((a, b) => pts.get(b) - pts.get(a) || (gg.get(b) || 0) - (gg.get(a) || 0) || (player(a)?.name || '').localeCompare(player(b)?.name || ''))[0] || null;
    };
    const b = lead(idx), a = lead(idx + 1);
    if (b && a && a !== b) lines.push(`👑 ${nm(a)} pasó a liderar el ${tv.name}`);
  }
  return { head, lines };
}
function chronicleBox(m) {
  const c = m.result ? chronicle(m) : null; if (!c) return '';
  return `<div class="chron"><h4>📰 Crónica</h4><p>${c.head}</p>${c.lines.length ? `<ul class="sim-facts">${c.lines.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`;
}

/* ---------------- la carrera por el título y chances de campeón ---------------- */
const RACE_COLORS = ['#ffd23f', '#4aa3ff', '#ff7a59', '#3ddc84', '#c792ea', '#ff6b9a', '#2ee6d6', '#f1f7f4'];
function torneoMatches(t) { return S.matches.filter(m => m.result && m.played_on >= t.from && m.played_on <= t.to).sort((a, b) => a.played_on.localeCompare(b.played_on) || a.id.localeCompare(b.id)); }
function raceFrames(t) {
  const TM = teamsByMatch(), pts = new Map(), gg = new Map(), pj = new Map(), frames = [];
  for (const m of torneoMatches(t)) {
    for (const [pid, team] of Object.entries(TM.get(m.id) || {})) {
      pj.set(pid, (pj.get(pid) || 0) + 1);
      const w = m.result === 'D' ? t.rules.D : m.result === team ? t.rules.W : t.rules.L;
      pts.set(pid, (pts.get(pid) || 0) + w); if (m.result === team) gg.set(pid, (gg.get(pid) || 0) + 1);
    }
    const order = [...pj.keys()].sort((a, b) => pts.get(b) - pts.get(a) || (gg.get(b) || 0) - (gg.get(a) || 0) || (player(a)?.name || '').localeCompare(player(b)?.name || ''));
    frames.push({ date: m.played_on, pts: new Map(pts), rank: new Map(order.map((pid, i) => [pid, i + 1])), n: order.length });
  }
  return frames;
}
function raceHtml(t) {
  const frames = raceFrames(t);
  if (frames.length < 2) return '<div class="empty">La carrera aparece cuando haya al menos 2 partidos jugados.</div>';
  const last = frames[frames.length - 1];
  const ranked = [...last.pts.keys()].sort((a, b) => last.pts.get(b) - last.pts.get(a) || last.rank.get(a) - last.rank.get(b));
  if (!S.raceSel) S.raceSel = new Set([...ranked.slice(0, 5), ...(S.meId && last.pts.has(S.meId) ? [S.meId] : [])]);
  const sel = ranked.filter(id => S.raceSel.has(id));
  const color = id => RACE_COLORS[sel.indexOf(id) % RACE_COLORS.length];
  const W = 360, Hh = 240, L = 30, R = 66, Tp = 14, B = 28, pw = W - L - R, ph = Hh - Tp - B, n = frames.length;
  const posMode = S.raceMode === 'pos';
  const maxPts = Math.max(8, Math.ceil(Math.max(...last.pts.values()) / 4) * 4), N = Math.max(2, last.n);
  const x = i => L + pw * (i / n);
  const y = v => posMode ? Tp + ph * ((v - 1) / (N - 1)) : Tp + ph * (1 - v / maxPts);
  const grid = posMode
    ? [1, Math.round(N / 3), Math.round(2 * N / 3), N].map(v => [v, y(v)])
    : [0, 1, 2, 3, 4].map(k => [Math.round(maxPts * k / 4), y(maxPts * k / 4)]);
  const lines = sel.map(id => {
    const pts = [];
    if (!posMode) pts.push([x(0), y(0)]);
    frames.forEach((f, i) => { const v = posMode ? f.rank.get(id) : (f.pts.get(id) ?? 0); if (v !== undefined) pts.push([x(i + 1), y(v)]); });
    return { id, pts };
  });
  // etiquetas al final de cada línea, separadas para que no se pisen
  const labels = lines.filter(l => l.pts.length).map(l => ({ id: l.id, y: l.pts[l.pts.length - 1][1] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;
  const short = id => { const nme = player(id)?.name || '?'; return nme.length > 8 ? nme.slice(0, 7) + '…' : nme; };
  const svg = `<svg class="race-svg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Carrera por el título">
    ${grid.map(([v, yy]) => `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="rgrid"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end" class="rtxt">${v}</text>`).join('')}
    ${frames.map((_, i) => (n <= 10 || i % 2 === 1 || i === n - 1) ? `<text x="${x(i + 1)}" y="${Hh - 10}" text-anchor="middle" class="rtxt">${i + 1}</text>` : '').join('')}
    ${lines.map(l => l.pts.length ? `<polyline fill="none" stroke="${color(l.id)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${l.pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>
      <circle cx="${l.pts[l.pts.length - 1][0].toFixed(1)}" cy="${l.pts[l.pts.length - 1][1].toFixed(1)}" r="3.6" fill="${color(l.id)}"/>` : '').join('')}
    ${labels.map(l => `<text x="${W - R + 8}" y="${(l.y + 3.5).toFixed(1)}" class="rlabel" fill="${color(l.id)}">${esc(short(l.id))}</text>`).join('')}
  </svg>`;
  return `<div class="card race">
    <div class="race-top"><div class="seg2"><button class="${posMode ? '' : 'on'}" data-act="race-mode" data-m="pts">Puntos</button><button class="${posMode ? 'on' : ''}" data-act="race-mode" data-m="pos">Posición</button></div>
      <span class="muted small">Fecha n° del ${esc(t.name)}</span></div>
    ${svg}
    <div class="chips">${ranked.map(id => `<button class="chip ${S.raceSel.has(id) ? 'on' : ''}" data-act="race-toggle" data-id="${id}" ${S.raceSel.has(id) ? `style="--c:${color(id)}"` : ''}>${esc(player(id)?.name || '?')}</button>`).join('')}</div>
    <p class="legend" style="margin:8px 0 0">Tocá un nombre para sumarlo o sacarlo del gráfico. ${posMode ? 'En "Posición", arriba es el primer puesto.' : 'Cada línea muestra cuántos puntos va sumando.'}</p></div>`;
}

function remainingThursdays(t) {
  const out = []; let d = nextThursday();
  const played = new Set(torneoMatches(t).map(m => m.played_on));
  while (d <= t.to) { if (!played.has(d)) out.push(d); d = addDays(d, 7); }
  return out;
}
function championOdds(t) {
  const done = torneoMatches(t), rem = remainingThursdays(t), H = history();
  const { played } = standings(t);
  const elig = played.filter(r => !r.p.guest && r.pj > 0).map(r => {
    const l = H.get(r.p.id) || [], g = l.filter(x => x.out === 'W').length, e = l.filter(x => x.out === 'D').length;
    return { id: r.p.id, rate: r.pj / Math.max(1, done.length), s: (g + 0.5 * e + 2) / (l.length + 4), pts: r.pts, g: r.g };
  });
  const lider = played[0] || null;
  if (!rem.length || elig.length < 2) return { rem: rem.length, lider, rows: [] };
  const RUNS = 3000, rand = rngFrom(`${t.id}|${done.length}|${rem.length}`), champs = new Map();
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const take = Math.min(10, elig.length);
  for (let r = 0; r < RUNS; r++) {
    const pts = new Map(elig.map(e => [e.id, e.pts])), gg = new Map(elig.map(e => [e.id, e.g]));
    for (let w = 0; w < rem.length; w++) {
      const crowd = elig.map(e => [e, Math.pow(rand(), 1 / Math.max(0.05, e.rate))]).sort((a, b) => b[1] - a[1]).slice(0, take).map(x => x[0]);
      for (let k = crowd.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [crowd[k], crowd[j]] = [crowd[j], crowd[k]]; }
      const half = Math.ceil(crowd.length / 2), A = crowd.slice(0, half), Bt = crowd.slice(half);
      if (!Bt.length) continue;
      const mean = tm => tm.reduce((a, e) => a + e.s, 0) / tm.length;
      const diff = (mean(A) + 0.2 * normal()) - (mean(Bt) + 0.2 * normal());
      const res = Math.abs(diff) < 0.02 ? 'D' : diff > 0 ? 'A' : 'B';
      for (const [tm, side] of [[A, 'A'], [Bt, 'B']]) for (const e of tm) {
        const w2 = res === 'D' ? t.rules.D : res === side ? t.rules.W : t.rules.L;
        pts.set(e.id, pts.get(e.id) + w2); if (res === side) gg.set(e.id, gg.get(e.id) + 1);
      }
    }
    const best = [...pts.keys()].sort((a, b) => pts.get(b) - pts.get(a) || gg.get(b) - gg.get(a) || (rand() - 0.5))[0];
    champs.set(best, (champs.get(best) || 0) + 1);
  }
  const rows = [...champs.entries()].map(([id, c]) => ({ id, p: c / RUNS })).sort((a, b) => b.p - a.p);
  return { rem: rem.length, lider, rows, RUNS };
}
function oddsHtml(t) {
  const o = championOdds(t);
  if (!o.rem) return '<div class="empty">No quedan jueves en este torneo.</div>';
  const shown = o.rows.filter(r => r.p >= 0.01).slice(0, 8);
  return `<div class="card odds">
    <p class="small" style="margin:0 0 10px">Quedan <b>${o.rem} jueves</b> hasta el ${fmtShort(t.to)}, a razón de un partido por semana (jueves de 19 a 20 hs).${o.lider ? ` Hoy lidera <b>${esc(o.lider.p.name)}</b> con ${o.lider.pts} pts.` : ''}</p>
    ${shown.length ? shown.map(r => `<div class="odd"><span class="pl">${av(player(r.id), 'sm')}<span class="n">${esc(player(r.id)?.name || '?')}</span></span>
      <span class="odd-bar"><i style="width:${Math.max(3, Math.round(r.p * 100))}%"></i></span><b>${r.p < 0.01 ? '<1' : Math.round(r.p * 100)}%</b></div>`).join('') : '<div class="muted small">Todavía no hay datos suficientes.</div>'}
    <p class="legend" style="margin:10px 0 0">Se simularon ${o.RUNS?.toLocaleString('es-AR') || ''} finales de torneo: cada semana juegan 10 con la frecuencia con la que viene cada uno, los equipos se arman al azar y gana el más fuerte según las estadísticas, con un poco de suerte. Es una estimación para divertirse, no un resultado seguro. Solo se muestran los que tienen al menos 1%.</p></div>`;
}

/* ---------------- resumen del año ---------------- */
function wrappedData(id) {
  const year = nowAR().iso.slice(0, 4), p = player(id);
  const H = history(), l = (H.get(id) || []).filter(x => x.m.played_on.startsWith(year));
  const g = l.filter(x => x.out === 'W').length, pe = l.filter(x => x.out === 'L').length, e = l.length - g - pe;
  const loaded = S.matches.filter(m => m.result && m.played_on.startsWith(year)).length;
  const ap = year === '2026' ? APERTURA_2026.map((r, i) => ({ ...r, pos: i + 1 })).find(r => playerByName(r.n)?.id === id) : null;
  const apTotal = year === '2026' ? 16 : 0;
  const played = l.length + (ap?.asist || 0), total = loaded + apTotal;
  // mejor racha de victorias (con fechas) y peor de derrotas
  let best = { n: 0 }, cur = null, worst = 0, run = 0;
  for (const x of l) {
    if (x.out === 'W') { cur = cur ? { ...cur, n: cur.n + 1, to: x.m.played_on } : { n: 1, from: x.m.played_on, to: x.m.played_on }; if (cur.n > best.n) best = cur; } else cur = null;
    run = x.out === 'L' ? run + 1 : 0; worst = Math.max(worst, run);
  }
  const byMonth = {};
  for (const x of l) { const k = x.m.played_on.slice(5, 7); byMonth[k] = (byMonth[k] || 0) + 1; }
  const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  const monthName = k => new Date(`${year}-${k}-15T12:00:00`).toLocaleDateString('es-AR', { month: 'long' });
  const stars = mvpEvents().filter(x => x.pid === id && x.date.startsWith(year)).length;
  const { dupla, bestia } = duoNemesis(id);
  const tv = TORNEOS.find(x => x.kind === 'vivo'), sv = standings(tv);
  const posV = sv.played.findIndex(r => r.p.id === id), rowV = sv.played[posV];
  const att = total ? played / total : 0, pw = l.length ? g / l.length : 0;
  let nick, why;
  if (stars >= 3) { nick = 'La Figura'; why = `fuiste el mejor del partido ${stars} veces`; }
  else if (l.length >= 4 && pw >= 0.65) { nick = 'El Ganador'; why = `ganaste ${Math.round(pw * 100)}% de tus partidos`; }
  else if (best.n >= 4) { nick = 'El Imparable'; why = `una racha de ${best.n} victorias seguidas`; }
  else if (att >= 0.8) { nick = 'El Infaltable'; why = `jugaste ${Math.round(att * 100)}% de los jueves`; }
  else if (l.length >= 4 && pw <= 0.25) { nick = 'El Valiente'; why = 'perdiste mucho y seguiste viniendo'; }
  else if (att > 0 && att <= 0.3) { nick = 'El Misterioso'; why = 'apareciste solo de vez en cuando'; }
  else { nick = 'El Regular'; why = 'sumaste partido tras partido'; }
  return { year, p, l, g, e, pe, played, total, att, pw, best, worst, topMonth: topMonth && { name: monthName(topMonth[0]), n: topMonth[1] }, stars, dupla, bestia, ap, rowV, posV, tv, nick, why };
}
function wrappedSlides(d) {
  const n = esc(d.p.name), dt = x => new Date(x + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  const S2 = [];
  S2.push({ bg: 'a', big: av(d.p, 'xl'), title: `Tu ${d.year} en Yaston`, text: `${n}, repasemos cómo te fue este año.` });
  S2.push({ bg: 'b', big: `${d.played}`, title: d.played === 1 ? 'partido jugado' : 'partidos jugados', text: d.total ? `Fuiste a ${Math.round(d.att * 100)}% de los jueves del año (${d.played} de ${d.total}).${d.topMonth ? ` Tu mes con más partidos cargados: ${d.topMonth.name} (${d.topMonth.n}).` : ''}` : 'Todavía no hay partidos este año.' });
  if (d.l.length) S2.push({ bg: 'c', big: `${Math.round(d.pw * 100)}%`, title: 'de victorias', text: `En los partidos cargados en la página: ${d.g} ganado${d.g === 1 ? '' : 's'}, ${d.e} empate${d.e === 1 ? '' : 's'} y ${d.pe} perdido${d.pe === 1 ? '' : 's'}.` });
  if (d.best.n) S2.push({ bg: 'd', big: `${d.best.n} 🔥`, title: d.best.n === 1 ? 'victoria seguida' : 'victorias seguidas', text: `Tu mejor racha${d.best.from ? ` (del ${dt(d.best.from)} al ${dt(d.best.to)})` : ''}.${d.worst >= 2 ? ` Tu peor: ${d.worst} derrotas seguidas 🥶.` : ''}` });
  S2.push({ bg: 'e', big: '🤝', title: 'Tu dupla y tu bestia negra', text: `${d.dupla ? `Con ${esc(d.dupla.q.name)} ganaron ${d.dupla.w} de ${d.dupla.n} juntos. ` : 'Todavía no tenés una dupla con 3 partidos juntos. '}${d.bestia ? `Y ${esc(d.bestia.q.name)} te ganó ${d.bestia.w} de ${d.bestia.n} enfrentamientos.` : ''}` });
  S2.push({ bg: 'f', big: `${d.stars} ⭐`, title: d.stars === 1 ? 'vez jugador del partido' : 'veces jugador del partido', text: d.stars ? 'Te eligieron como el mejor de la cancha.' : 'Todavía no fuiste la figura. Todavía.' });
  if (d.ap || d.rowV) S2.push({ bg: 'g', big: '🏆', title: 'Tus torneos', text: `${d.ap ? `Apertura 2026: ${d.ap.pos}º con ${num(d.ap.pts)} pts (asististe a ${d.ap.asist} partidos). ` : ''}${d.rowV ? `${d.tv.name}: vas ${d.posV + 1}º con ${d.rowV.pts} pts.` : ''}` });
  S2.push({ bg: 'h', big: `«${esc(d.nick)}»`, title: 'Tu apodo del año', text: `Porque ${esc(d.why)}.` });
  S2.push({ bg: 'a', big: '👏', title: 'Gracias por jugar', text: `Nos vemos el jueves, ${n}.`, last: true });
  return S2;
}
function wrappedText(d) {
  return [`🎁 Mi ${d.year} en Yaston`, `⚽ ${d.played} partidos${d.total ? ` (${Math.round(d.att * 100)}% de los jueves)` : ''}`,
    d.l.length ? `📈 ${Math.round(d.pw * 100)}% de victorias (${d.g}G ${d.e}E ${d.pe}P)` : '', d.best.n ? `🔥 Mejor racha: ${d.best.n} victorias seguidas` : '',
    `⭐ ${d.stars} veces jugador del partido`, `🏷️ Mi apodo: ${d.nick}`].filter(Boolean).join('\n');
}
function wrappedStory(id) {
  const d = wrappedData(id); if (!d.p) return;
  const slides = wrappedSlides(d); let i = 0;
  const root = $('#modal-root');
  const draw = () => {
    const sl = slides[i];
    root.innerHTML = `<div class="story bg-${sl.bg}" id="story">
      <div class="story-bars">${slides.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')}</div>
      <button class="story-x" id="story-x" aria-label="Cerrar">✕</button>
      <div class="story-body"><div class="story-big">${sl.big}</div><h2>${sl.title}</h2><p>${sl.text}</p>
        ${sl.last ? '<div class="story-actions"><button class="btn primary" id="story-copy">Copiar mi resumen</button><button class="btn ghost" id="story-close">Cerrar</button></div>' : ''}</div>
      <button class="story-nav prev" id="story-prev" aria-label="Anterior"></button><button class="story-nav next" id="story-next" aria-label="Siguiente"></button></div>`;
    $('#story-x').onclick = () => { root.innerHTML = ''; document.onkeydown = null; };
    $('#story-prev').onclick = () => { if (i > 0) { i--; draw(); } };
    $('#story-next').onclick = () => { if (i < slides.length - 1) { i++; draw(); } };
    if (sl.last) {
      $('#story-close').onclick = $('#story-x').onclick;
      $('#story-copy').onclick = async () => { try { await navigator.clipboard.writeText(wrappedText(d)); toast('Resumen copiado 📋'); } catch { toast('No pude copiar. Sacale una captura 📸', true); } };
    }
  };
  document.onkeydown = e => { if (e.key === 'ArrowRight') $('#story-next')?.click(); else if (e.key === 'ArrowLeft') $('#story-prev')?.click(); else if (e.key === 'Escape') $('#story-x')?.click(); };
  draw();
}

/* ---------------- último partido: votar a la figura, bien a la vista ---------------- */
function lastMatchCard() {
  const done = S.matches.filter(m => m.result)
    .sort((a, b) => b.played_on.localeCompare(a.played_on) || (b.created_at || '').localeCompare(a.created_at || ''));
  const m = done[0]; if (!m) return '';
  const parts = S.mp.filter(x => x.match_id === m.id); if (!parts.length) return '';
  const days = (new Date(nowAR().iso + 'T12:00:00Z') - new Date(m.played_on + 'T12:00:00Z')) / 864e5;
  if (!m.voting_open && days > 7) return ''; // la figura ya elegida se muestra una semana
  const when = new Date(m.played_on + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const pending = m.voting_open && parts.some(x => x.player_id === S.meId) && !S.myVotes[m.id];
  return `<div class="lastmatch ${pending ? 'pending' : ''}">
    <div class="eyebrow lm-when">Último partido · ${when}</div>
    <h3>${m.result === 'D' ? 'El último partido terminó empatado' : `El último partido lo ganó el Equipo ${m.result} 🏆`}</h3>
    ${m.voting_open ? `<p class="lm-cta">${pending ? '<b>¡Te falta votar!</b> ' : ''}Elegí quién fue la figura del partido.</p>${voteBox(m)}` : mvpBox(m)}
    <div class="lm-foot">
      <button class="link" data-act="tab" data-tab="partidos">Ver el partido completo ›</button>
      ${S.isAdmin && m.voting_open ? `<button class="btn sm ghost" data-act="toggle-voting" data-id="${m.id}">🔒 Cerrar votación</button>` : ''}
    </div></div>`;
}

function matchCard(m) {
  const res = m.result === 'A' ? 'Ganó el Equipo A' : m.result === 'B' ? 'Ganó el Equipo B' : m.result === 'D' ? 'Empate' : 'Sin resultado';
  const hasParts = S.mp.some(x => x.match_id === m.id);
  return `<div class="card match">
    <div class="head"><div class="date">${fmtDate(m.played_on)}</div><span class="res ${m.result || ''}">${res}</span></div>
    ${pitchHtml(m)}
    ${hasParts && !m.result ? simBox(m) : ''}
    ${hasParts && m.result ? chronicleBox(m) : ''}
    ${hasParts ? (m.voting_open ? voteBox(m) : mvpBox(m)) : ''}
    ${S.isAdmin ? `<div class="admin-row">
      <button class="btn sm" data-act="edit-match" data-id="${m.id}">✏️ Editar</button>
      ${hasParts ? `<button class="btn sm ghost" data-act="toggle-voting" data-id="${m.id}">${m.voting_open ? '🔒 Cerrar votación' : '🔓 Reabrir votación'}</button>` : ''}
      <button class="btn sm danger" data-act="del-match" data-id="${m.id}">Borrar</button></div>` : ''}
  </div>`;
}

function viewPartidos() {
  return `<div class="section-title"><h2>Partidos</h2>
      ${S.isAdmin ? '<button class="btn primary sm" data-act="new-match">+ Nuevo partido</button>' : ''}</div>
    ${!S.user ? `<div class="card notice"><b>🔒 Para votar hay que entrar con Google</b>
      <div class="muted small" style="margin:4px 0 10px">Para votar al jugador del partido tenés que entrar con tu Gmail. Mirar los partidos no hace falta.</div>
      <button class="btn google sm" data-act="login">Entrar con Google</button></div>` : ''}
    ${S.matches.length ? S.matches.map(matchCard).join('') : `<div class="empty">Todavía no se cargó ningún partido.${S.isAdmin ? '<br>Tocá "+ Nuevo partido" para armar los equipos A y B.' : ''}</div>`}`;
}

function viewPlantel() {
  const roster = S.players.filter(p => !p.guest);
  const all = standings(null), st = Object.fromEntries([...all.played, ...all.never].map(r => [r.p.id, r]));
  return `<div class="section-title"><h2>Plantel · ${roster.length}</h2>
      ${S.isAdmin ? '<button class="btn primary sm" data-act="new-player">+ Jugador</button>' : ''}</div>
    ${S.user && !S.meId ? '<div class="card"><b>¿Quién sos?</b><div class="muted small" style="margin:4px 0 10px">Elegí tu nombre para poder votar.</div><button class="btn sm primary" data-act="claim">Elegir quién soy</button></div>' : ''}
    ${roster.length ? `<div class="pgrid">${roster.map(p => {
      const r = st[p.id];
      return `<div class="pcard ${p.id === S.meId ? 'me-card' : ''}">${av(p, 'xl')}
        <div class="nm">${esc(p.name)}</div>
        <div class="st">${r.pj} PJ · ${r.g} G · ${r.mvp ? '⭐' + r.mvp : '0 ⭐'}</div>
        <div class="pbtns"><button class="btn sm" data-act="player-history" data-id="${p.id}">Historial</button>
        ${S.isAdmin ? `<button class="btn sm ghost" data-act="edit-player" data-id="${p.id}">Editar</button>` : ''}</div>
        ${S.isAdmin ? `<div class="mail">${esc(S.emails[p.id] || 'sin mail')}</div>` : ''}</div>`;
    }).join('')}</div>` : '<div class="empty">Todavía no hay jugadores.</div>'}`;
}

/* ---------------- modales ---------------- */
function openModal(html) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  $('#modal-root .overlay').addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) closeModal(); });
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };

async function resizeImage(file) {
  const bmp = await createImageBitmap(file);
  const size = 400, c = document.createElement('canvas'); c.width = c.height = size;
  const s = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}

function claimModal() {
  const opts = S.unclaimed.map(player).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  let pick = null;
  openModal(`<h3>¿Quién sos?</h3>
    <p class="muted small">Elegí tu nombre de la lista. Queda vinculado a <b>${esc(S.user.email)}</b> y con eso podés votar. Si te equivocás, avisale al admin.</p>
    ${opts.length ? `<div class="vgrid">${opts.map(p => `<button type="button" class="vopt" data-pick="${p.id}">${av(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>`
      : '<div class="empty">Todos los jugadores de la lista ya fueron elegidos. Si no estás, avisale al admin.</div>'}
    <div class="err" id="cerr"></div>
    <div class="actions"><button type="button" class="btn ghost" id="cskip">Ahora no</button>
      <button type="button" class="btn primary" id="cok" disabled>Elegí tu nombre</button></div>`);
  $('#cskip').onclick = () => { try { sessionStorage.setItem('yaston-skip-claim', '1'); } catch { /* sin storage */ } closeModal(); };
  $('#modal-root').onclick = e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    pick = player(b.dataset.pick);
    document.querySelectorAll('#modal-root .vopt').forEach(x => x.classList.toggle('sel', x === b));
    $('#cok').disabled = false; $('#cok').textContent = `Soy ${pick.name}`;
  };
  $('#cok').onclick = async () => {
    if (!pick) return;
    $('#cok').disabled = true; $('#cerr').textContent = '';
    try { await must(db.rpc('claim_player', { p_player: pick.id })); closeModal(); toast(`Listo, sos ${pick.name} ✅`); refresh(); }
    catch (e) { $('#cerr').textContent = e.message; $('#cok').disabled = false; refresh(); }
  };
}

function playerModal(id) {
  const p = id ? player(id) : null;
  openModal(`<h3>${p ? 'Editar jugador' : 'Nuevo jugador'}</h3>
    <form id="pf">
      <div class="field photo-pick"><div id="prev">${p ? av(p, 'xl') : '<span class="av xl">📷</span>'}</div>
        <div><input type="file" id="pfile" accept="image/*"><div class="hint">Foto cuadrada o de cara, se recorta sola.</div></div></div>
      <div class="field"><label>Nombre</label><input type="text" id="pname" required maxlength="40" value="${esc(p?.name || '')}"></div>
      <div class="field"><label>Mail de Gmail (para que pueda entrar y votar)</label>
        <input type="email" id="pmail" placeholder="opcional" value="${esc(S.emails[id] || '')}">
        <div class="hint">Tiene que ser el mismo mail con el que va a entrar con Google.</div></div>
      <div class="err" id="perr"></div>
      <div class="actions">
        ${p ? '<button type="button" class="btn danger" id="pdel" style="margin-right:auto">Borrar</button>' : ''}
        <button type="button" class="btn ghost" id="pcancel">Cancelar</button>
        <button class="btn primary" id="psave">Guardar</button></div>
    </form>`);
  let blob = null;
  let pid = p?.id; // si algo falla a mitad, al reintentar se actualiza el mismo jugador (no se duplica)
  $('#pfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { blob = await resizeImage(f); $('#prev').innerHTML = `<img class="av xl" src="${URL.createObjectURL(blob)}">`; }
    catch { $('#perr').textContent = 'No pude leer esa imagen.'; }
  };
  $('#pcancel').onclick = closeModal;
  if (p) $('#pdel').onclick = async () => {
    if (!confirm(`¿Borrar a ${p.name}? Se borra también de todos los partidos.`)) return;
    try { await must(db.from('players').delete().eq('id', p.id)); closeModal(); toast('Jugador borrado'); refresh(); }
    catch (e) { $('#perr').textContent = e.message; }
  };
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#psave'); btn.disabled = true; $('#perr').textContent = '';
    try {
      const row = { name: $('#pname').value.trim() };
      if (pid) await must(db.from('players').update(row).eq('id', pid));
      else pid = (await must(db.from('players').insert(row).select().single())).id;
      if (blob) {
        const path = `${pid}-${Date.now()}.jpg`;
        await must(db.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg' }));
        const url = db.storage.from('fotos').getPublicUrl(path).data.publicUrl;
        await must(db.from('players').update({ photo_url: url }).eq('id', pid));
      }
      const mail = $('#pmail').value.trim().toLowerCase();
      if (mail) await must(db.from('player_emails').upsert({ player_id: pid, email: mail }));
      else await must(db.from('player_emails').delete().eq('player_id', pid));
      closeModal(); toast('Guardado ✅'); refresh();
    } catch (err) {
      btn.disabled = false;
      $('#perr').textContent = /duplicate|unique/i.test(err.message) ? 'Ese mail ya está asignado a otro jugador.' : err.message;
    }
  };
}

function matchModal(id) {
  const m = id ? S.matches.find(x => x.id === id) : null;
  const teamOf = pid => S.mp.find(x => x.match_id === id && x.player_id === pid)?.team || '';
  // candidatos: jugadores del plantel + invitados que ya estaban en este partido + invitados nuevos (tid)
  const cand = [
    ...S.players.filter(p => !p.guest).map(p => ({ key: p.id, p })),
    ...S.players.filter(p => p.guest && teamOf(p.id)).map(p => ({ key: p.id, p })),
  ];
  const pickRow = (c, team) => {
    const p = c.p || { name: c.name, guest: true };
    return `<div class="pick" data-key="${c.key}">${av(c.p || { name: c.name }, 'sm')}<span class="nm">${esc(p.name)}${p.guest ? ' <span class="badge">invitado</span>' : ''}</span>
      <div class="seg">
        <label data-t="A"><input type="radio" name="t-${c.key}" value="A" ${team === 'A' ? 'checked' : ''}><span>A</span></label>
        <label data-t="-"><input type="radio" name="t-${c.key}" value="" ${!team ? 'checked' : ''}><span>–</span></label>
        <label data-t="B"><input type="radio" name="t-${c.key}" value="B" ${team === 'B' ? 'checked' : ''}><span>B</span></label>
      </div></div>`;
  };
  openModal(`<h3>${m ? 'Editar partido' : 'Nuevo partido'}</h3>
    <form id="mf">
      <div class="field"><label>Fecha</label><input type="date" id="mdate" required value="${m?.played_on || lastThursday()}"></div>
      <div class="field"><label>Armá los equipos (máx. 5 por equipo)</label>
        <div class="counts" id="mcounts"></div>
        <div id="plist">${cand.map(c => pickRow(c, teamOf(c.key))).join('')}</div>
        <div id="pempty" class="muted ${cand.length ? 'hidden' : ''}">Todavía no hay jugadores. Cargalos en Plantel o sumá un invitado acá abajo.</div>
        <div class="guest-add">
          <label for="gname">➕ Sumar un invitado solo para este partido</label>
          <div class="guest-row"><input type="text" id="gname" maxlength="40" placeholder="Nombre del invitado">
            <button type="button" class="btn sm" id="gadd">Agregar</button></div>
          <div class="hint">Aparece en la tabla solo con el nombre, sin foto, y no figura en el Plantel. Si ya vino de invitado antes con el mismo nombre, se cuenta como el mismo jugador.</div>
        </div>
      </div>
      <div class="field"><label>¿Quién ganó?</label><div class="seg">
        ${[['', 'Todavía no'], ['A', 'Equipo A'], ['B', 'Equipo B'], ['D', 'Empate']].map(([v, l]) =>
          `<label><input type="radio" name="res" value="${v}" ${(m?.result || '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div></div>
      <div class="err" id="merr"></div>
      <div class="actions"><button type="button" class="btn ghost" id="mcancel">Cancelar</button>
        <button class="btn primary" id="msave">Guardar</button></div>
    </form>`);
  const team = key => $(`input[name="t-${key}"]:checked`)?.value || '';
  const count = () => {
    const a = cand.filter(c => team(c.key) === 'A').length, b = cand.filter(c => team(c.key) === 'B').length;
    $('#mcounts').innerHTML = `<span class="${a > 5 ? 'bad' : a === 5 ? 'ok' : ''}">Equipo A: ${a}</span><span class="${b > 5 ? 'bad' : b === 5 ? 'ok' : ''}">Equipo B: ${b}</span>`;
    return [a, b];
  };
  count();
  $('#mf').addEventListener('change', count);
  $('#mcancel').onclick = closeModal;
  let n = 0;
  const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const addGuest = () => {
    const input = $('#gname'), name = input.value.trim(), err = $('#merr');
    err.textContent = '';
    if (!name) return input.focus();
    const same = norm(name);
    const reg = S.players.find(p => !p.guest && norm(p.name) === same);
    if (reg) return err.textContent = `${reg.name} ya está en el plantel: buscalo en la lista de arriba.`;
    if (cand.some(c => norm(c.p?.name || c.name) === same)) return err.textContent = `${name} ya está en la lista del partido.`;
    // si ya vino de invitado antes, se usa el mismo jugador (así suma sus partidos en la tabla)
    const games = p => S.mp.filter(x => x.player_id === p.id).length;
    const before = S.players.filter(p => p.guest && norm(p.name) === same).sort((x, y) => games(y) - games(x))[0];
    const c = before ? { key: before.id, p: before } : { key: 'new' + (++n), name, temp: true };
    cand.push(c);
    $('#plist').insertAdjacentHTML('beforeend', pickRow(c, ''));
    $('#pempty').classList.add('hidden');
    if (before) toast(`${before.name} ya había venido de invitado: se cuenta como el mismo jugador`);
    input.value = '';
    count();
  };
  $('#gadd').onclick = addGuest;
  $('#gname').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } };
  let mid = id;
  const made = new Map(); // invitados nuevos ya creados (por si hay que reintentar)
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const [a, b] = count(); const err = $('#merr'); err.textContent = '';
    if (a > 5 || b > 5) return err.textContent = 'Cada equipo puede tener hasta 5 jugadores.';
    if (a + b === 0) return err.textContent = 'Elegí al menos un jugador.';
    const btn = $('#msave'); btn.disabled = true;
    try {
      const row = { played_on: $('#mdate').value, result: $('input[name=res]:checked').value || null };
      if (mid) await must(db.from('matches').update(row).eq('id', mid));
      else mid = (await must(db.from('matches').insert(row).select().single())).id;
      // crear los invitados nuevos que quedaron en algún equipo
      const fresh = cand.filter(c => c.temp && team(c.key) && !made.has(c.key));
      if (fresh.length) {
        const rows = await must(db.from('players').insert(fresh.map(c => ({ name: c.name, guest: true }))).select());
        fresh.forEach((c, i) => made.set(c.key, rows[i].id));
      }
      const pid = c => c.temp ? made.get(c.key) : c.key;
      const want = cand.filter(c => team(c.key)).map(c => ({ match_id: mid, player_id: pid(c), team: team(c.key) }));
      const have = S.mp.filter(x => x.match_id === mid);
      const removed = have.filter(h => !want.some(w => w.player_id === h.player_id));
      const changed = have.filter(h => want.some(w => w.player_id === h.player_id && w.team !== h.team));
      for (const r of [...removed, ...changed]) await must(db.from('match_players').delete().match({ match_id: mid, player_id: r.player_id }));
      const toAdd = want.filter(w => { const h = have.find(x => x.player_id === w.player_id); return !h || h.team !== w.team; });
      if (toAdd.length) await must(db.from('match_players').insert(toAdd));
      // un invitado que sacaste del partido no vuelve a hacer falta
      for (const r of removed) {
        const otherMatches = S.mp.some(x => x.player_id === r.player_id && x.match_id !== mid);
        if (player(r.player_id)?.guest && !otherMatches) await must(db.from('players').delete().eq('id', r.player_id));
      }
      closeModal(); toast('Partido guardado ✅'); refresh();
    } catch (er) { btn.disabled = false; err.textContent = er.message; }
  };
}

/* ---------------- acciones ---------------- */
const actions = {
  login: () => db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }),
  logout: async () => { await db.auth.signOut(); S.user = null; S.isAdmin = false; S.meId = null; S.myVotes = {}; S.emails = {}; render(); },
  simulate: el => { const id = el.dataset.id; S.sims[id] = 'run'; render(); setTimeout(() => { S.sims[id] = 'done'; render(); }, 1700); },
  sort: el => { S.sort = el.dataset.s; render(); },
  game: () => { S.game = null; S.playId = null; render(); scrollTo(0, 0); },
  play: async () => {
    try { S.playId = await must(db.rpc('start_play', { p_game: currentGame().id })); S.game = currentGame().id; await loadGameData(); render(); scrollTo(0, 0); }
    catch (e) { S.playId = null; toast(e.message, true); refresh(); }
  },
  tab: el => { S.tab = el.dataset.tab; S.game = null; S.playId = null; render(); scrollTo(0, 0); },
  torneo: el => { S.torneo = el.value; render(); },
  vote: async el => {
    try { await must(db.rpc('cast_vote', { p_match: el.dataset.m, p_for: el.dataset.p })); toast('Voto registrado 🗳️'); refresh(); }
    catch (e) { toast(e.message, true); }
  },
  claim: () => { try { sessionStorage.removeItem('yaston-skip-claim'); } catch { /* sin storage */ } claimModal(); },
  'player-history': el => actions.perfil(el),
  perfil: el => { if (S.tab !== 'perfil') S.prevTab = S.tab; S.tab = 'perfil'; S.perfilId = el.dataset.id || S.meId; S.game = null; S.playId = null; render(); scrollTo(0, 0); },
  wrapped: el => wrappedStory(el.dataset.id || S.meId),
  'race-mode': el => { S.raceMode = el.dataset.m; render(); },
  'race-toggle': el => { const id = el.dataset.id; if (!S.raceSel) return; if (S.raceSel.has(id)) S.raceSel.delete(id); else S.raceSel.add(id); render(); },
  'new-player': () => playerModal(),
  'edit-player': el => playerModal(el.dataset.id),
  'new-match': () => matchModal(),
  'edit-match': el => matchModal(el.dataset.id),
  'toggle-voting': async el => {
    const m = S.matches.find(x => x.id === el.dataset.id);
    try { await must(db.from('matches').update({ voting_open: !m.voting_open }).eq('id', m.id)); toast(m.voting_open ? 'Votación cerrada' : 'Votación reabierta'); refresh(); }
    catch (e) { toast(e.message, true); }
  },
  'del-match': async el => {
    if (!confirm('¿Borrar este partido? Se pierden también sus votos.')) return;
    try { await must(db.from('matches').delete().eq('id', el.dataset.id)); toast('Partido borrado'); refresh(); }
    catch (e) { toast(e.message, true); }
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && el.tagName !== 'SELECT') actions[el.dataset.act]?.(el);
});
document.addEventListener('change', e => { if (e.target.dataset?.act === 'torneo') actions.torneo(e.target); });

/* ---------------- inicio ---------------- */
async function start() {
  const { data: { session } } = await db.auth.getSession();
  S.user = session?.user || null;
  try {
    S.isAdmin = S.user ? !!(await must(db.rpc('is_admin'))) : false;
    await loadAll();
    render();
    maybeClaim();
  } catch (e) {
    app.innerHTML = `<div class="center-screen"><div class="card setup"><h2>Ups</h2>
      <p class="muted">${esc(e.message)}</p><p class="small muted">¿Corriste el <code>schema.sql</code> en Supabase?</p>
      <button class="btn" data-act="logout">Salir</button></div></div>`;
  }
}
start();
})();

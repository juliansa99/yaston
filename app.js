(() => {
'use strict';
const cfg = window.YASTON_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const PTS = { W: 3, D: 1, L: 0 };

if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  app.innerHTML = `<div class="center-screen"><div class="card setup">
    <h2>⚙️ Falta configurar</h2>
    <p class="muted">Abrí <code>config.js</code> y pegá la <b>URL</b> y la <b>anon key</b> de tu proyecto de Supabase. Los pasos están en el README.</p></div></div>`;
  return;
}
const db = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const S = {
  user: null, isAdmin: false, meId: null, tab: 'tabla', year: 'all',
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
  S.totals = Object.fromEntries(totals.map(t => [t.match_id, t.total]));
  S.myVotes = Object.fromEntries(votes.map(v => [v.match_id, v.voted_for]));
  S.emails = emails ? Object.fromEntries(emails.map(e => [e.player_id, e.email])) : {};
  S.unclaimed = S.user && !meId ? await must(db.rpc('unclaimed_players')) : [];
}

function maybeClaim() {
  let skipped = false;
  try { skipped = sessionStorage.getItem('yaston-skip-claim') === '1'; } catch { /* sin storage */ }
  if (S.user && !S.meId && S.unclaimed.length && !skipped && !$('#modal-root .overlay')) claimModal();
}

async function refresh() {
  try { await loadAll(); render(); maybeClaim(); } catch (e) { toast(e.message || 'Error al cargar', true); }
}

/* ---------------- cálculo de la tabla ---------------- */
function mvpWinners(matchId) {
  const rows = S.mvp.filter(r => r.match_id === matchId).sort((a, b) => b.votes - a.votes);
  if (!rows.length) return { winners: [], rows };
  return { winners: rows.filter(r => r.votes === rows[0].votes), rows };
}
function standings() {
  const rows = new Map(S.players.map(p => [p.id, { p, pj: 0, g: 0, e: 0, pe: 0, pts: 0, mvp: 0 }]));
  const inYear = m => S.year === 'all' || m.played_on.startsWith(S.year);
  for (const m of S.matches) {
    if (!m.result || !inYear(m)) continue;
    for (const x of S.mp.filter(x => x.match_id === m.id)) {
      const r = rows.get(x.player_id); if (!r) continue;
      r.pj++;
      if (m.result === 'D') { r.e++; r.pts += PTS.D; }
      else if (m.result === x.team) { r.g++; r.pts += PTS.W; }
      else { r.pe++; r.pts += PTS.L; }
    }
    if (!m.voting_open) for (const w of mvpWinners(m.id).winners) { const r = rows.get(w.player_id); if (r) r.mvp++; }
  }
  const H = history();
  const all = [...rows.values()];
  for (const r of all) r.st = streaks(H.get(r.p.id) || []);
  const played = all.filter(r => r.pj > 0).sort((a, b) =>
    b.pts - a.pts || b.g - a.g || b.mvp - a.mvp || a.pe - b.pe || a.p.name.localeCompare(b.p.name));
  const never = all.filter(r => r.pj === 0).sort((a, b) => a.p.name.localeCompare(b.p.name));
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
    ${stars.length ? `<div class="table-wrap"><table class="tbl"><tbody>${stars.map((r, i) => `<tr class="${i === 0 ? 'top1' : ''}"><td class="pos">${i + 1}</td>
      <td class="l"><div class="pl">${av(r.p)}<span class="n">${esc(r.p.name)}</span></div></td><td class="pts">⭐ ${r.mvp}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Todavía no se cerró ninguna votación.</div>'}`;
}

function historyModal(id) {
  const p = player(id), H = history(), l = H.get(id) || [];
  const g = l.filter(x => x.out === 'W').length, pe = l.filter(x => x.out === 'L').length, e = l.length - g - pe;
  const st = streaks(l), stars = mvpEvents().filter(x => x.pid === id).length;
  const others = S.players.filter(q => q.id !== id && !q.guest);
  let dupla = null, bestia = null;
  for (const q of others) {
    const v = versus(id, q.id), together = v.wj + v.dj + v.lj, against = v.aw + v.bw + v.d;
    if (together >= MIN) { const r = v.wj / together + together / 1e6; if (!dupla || r > dupla.r) dupla = { q, r, w: v.wj, n: together }; }
    if (against >= MIN) { const r = v.bw / against + against / 1e6; if (v.bw && (!bestia || r > bestia.r)) bestia = { q, r, w: v.bw, n: against }; }
  }
  const curr = st.cw >= 1 ? `🔥 ${st.cw} ganado${st.cw > 1 ? 's' : ''} seguido${st.cw > 1 ? 's' : ''}` : st.cl >= 1 ? `🥶 ${st.cl} perdido${st.cl > 1 ? 's' : ''} seguido${st.cl > 1 ? 's' : ''}` : '–';
  openModal(`<h3 class="pl" style="gap:12px">${av(p, 'lg')}<span>${esc(p.name)}</span></h3>
    <div class="statrow">
      <div><b>${l.length}</b><span>jugados</span></div><div><b>${g}</b><span>ganados</span></div>
      <div><b>${e}</b><span>empates</span></div><div><b>${pe}</b><span>perdidos</span></div>
      <div><b>${pct(g, l.length)}</b><span>victorias</span></div><div><b>${stars}</b><span>⭐</span></div></div>
    <div class="kv"><span>Racha actual</span><b>${curr}</b></div>
    <div class="kv"><span>Mejor racha</span><b>${st.bw} victoria${st.bw === 1 ? '' : 's'}</b></div>
    <div class="kv"><span>Peor racha</span><b>${st.bl} derrota${st.bl === 1 ? '' : 's'}</b></div>
    <div class="kv"><span>🤝 Mejor dupla</span><b>${dupla ? `${esc(dupla.q.name)} (${dupla.w}/${dupla.n})` : `todavía sin datos (mín. ${MIN})`}</b></div>
    <div class="kv"><span>😈 Bestia negra</span><b>${bestia ? `${esc(bestia.q.name)} (te ganó ${bestia.w}/${bestia.n})` : `todavía sin datos (mín. ${MIN})`}</b></div>
    <div class="field" style="margin-top:16px"><label for="vs">Ver historial con otro jugador</label>
      <select class="sel" id="vs" style="width:100%"><option value="">Elegí un jugador…</option>
        ${others.map(q => `<option value="${q.id}">${esc(q.name)}</option>`).join('')}</select></div>
    <div id="vsres"></div>
    <div class="actions"><button class="btn" id="hclose">Cerrar</button></div>`);
  $('#hclose').onclick = closeModal;
  $('#vs').onchange = e => {
    const q = player(e.target.value); if (!q) return $('#vsres').innerHTML = '';
    const v = versus(id, q.id), tj = v.wj + v.dj + v.lj, ta = v.aw + v.bw + v.d;
    $('#vsres').innerHTML = (tj + ta === 0) ? `<div class="empty">${esc(p.name)} y ${esc(q.name)} nunca coincidieron en un partido.</div>` : `
      <div class="vsbox"><h4>🤝 Del mismo equipo · ${tj} partido${tj === 1 ? '' : 's'}</h4>
        ${tj ? `<div class="vsnums"><div><b>${v.wj}</b><span>ganaron</span></div><div><b>${v.dj}</b><span>empataron</span></div><div><b>${v.lj}</b><span>perdieron</span></div><div><b>${pct(v.wj, tj)}</b><span>victorias</span></div></div>` : '<div class="muted small">Nunca jugaron juntos.</div>'}</div>
      <div class="vsbox"><h4>⚔️ Enfrentados · ${ta} vez${ta === 1 ? '' : 'es'}</h4>
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
      ${S.user ? `<div class="me">${avatar}<span>${esc(name.split(' ')[0])}</span><button data-act="logout">Salir</button></div>`
        : '<button class="btn sm primary" data-act="login">Entrar con Google</button>'}
    </header>
    <main class="wrap">${S.tab === 'tabla' ? viewTabla() : S.tab === 'premios' ? viewPremios() : S.tab === 'partidos' ? viewPartidos() : viewPlantel()}</main>
    <nav class="tabs"><div class="in">
      ${[['tabla', '🏆', 'Tabla'], ['premios', '🏅', 'Premios'], ['partidos', '📅', 'Partidos'], ['plantel', '👥', 'Plantel']]
        .map(([k, i, l]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><b>${i}</b>${l}</button>`).join('')}
    </div></nav>`;
}

function viewTabla() {
  const years = [...new Set(S.matches.map(m => m.played_on.slice(0, 4)))].sort().reverse();
  const { played, never } = standings();
  const row = (r, i, dim) => `<tr class="${i === 0 && !dim ? 'top1' : ''} ${dim ? 'dim' : ''}">
      <td class="pos">${dim ? '–' : i + 1}</td>
      <td class="l"><div class="pl">${av(r.p)}<span class="n">${esc(r.p.name)}</span>${r.p.guest ? '<span class="badge">invitado</span>' : ''}${r.st.cw >= 3 ? `<span class="badge hot" title="Racha de victorias">🔥${r.st.cw}</span>` : r.st.cl >= 3 ? `<span class="badge cold" title="Racha de derrotas">🥶${r.st.cl}</span>` : ''}</div></td>
      <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.pe}</td><td>${r.mvp ? '⭐' + r.mvp : '–'}</td><td class="pts">${r.pts}</td></tr>`;
  const played_n = S.matches.filter(m => m.result && (S.year === 'all' || m.played_on.startsWith(S.year))).length;
  return `
    <div class="section-title"><h2>Tabla de posiciones</h2>
      <div class="filters"><select class="sel" data-act="year">
        <option value="all">Histórica</option>${years.map(y => `<option ${S.year === y ? 'selected' : ''}>${y}</option>`).join('')}
      </select></div></div>
    ${!S.players.length ? '<div class="empty">Todavía no hay jugadores cargados.</div>' : `
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>#</th><th class="l">Jugador</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>MVP</th><th>Pts</th></tr></thead>
      <tbody>${played.map((r, i) => row(r, i)).join('')}${never.map(r => row(r, 0, true)).join('')}</tbody>
    </table></div>
    <p class="legend">Ganado 3 pts · Empate 1 · Perdido 0. PJ: jugados · G/E/P: ganados/empatados/perdidos · ⭐ veces elegido jugador del partido. ${played_n} partido${played_n === 1 ? '' : 's'} jugado${played_n === 1 ? '' : 's'}.
    🔥 3 o más victorias seguidas · 🥶 3 o más derrotas seguidas. Los de abajo (en gris) son parte del grupo pero todavía no jugaron.</p>`}`;
}

function teamHtml(m, t) {
  const members = S.mp.filter(x => x.match_id === m.id && x.team === t).map(x => player(x.player_id)).filter(Boolean);
  const won = m.result === t;
  return `<div class="team ${t} ${won ? 'won' : ''}">
    <h4><span>Equipo ${t} ${won ? '🏆' : ''}</span></h4>
    ${members.map(p => `<div class="row">${av(p, 'sm')}<span>${esc(p.name)}</span></div>`).join('') || '<span class="muted small">Sin jugadores</span>'}
  </div>`;
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
  if (!S.user) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Para votar tenés que entrar con tu Gmail.</div><div style="margin:10px 0"><button class="btn sm primary" data-act="login">Entrar con Google</button></div>${info}</div>`;
  if (!S.meId) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Todavía no elegiste quién sos.</div><div style="margin:10px 0"><button class="btn sm primary" data-act="claim">Elegir quién soy</button></div>${info}</div>`;
  if (!mine) return `<div class="votebox"><h4>🗳️ Votación abierta</h4><div class="muted small">Solo votan los que jugaron este partido.</div>${info}</div>`;
  const myVote = S.myVotes[m.id];
  const opts = parts.filter(x => x.player_id !== S.meId).map(x => player(x.player_id)).filter(Boolean);
  return `<div class="votebox"><h4>🗳️ ¿Quién fue el mejor del partido?</h4>
    <div class="muted small">${myVote ? 'Ya votaste. Podés cambiar tu voto hasta que cierre la votación.' : 'Tocá a un jugador para votar. Tu voto es secreto.'}</div>
    <div class="vgrid">${opts.map(p => `<button class="vopt ${myVote === p.id ? 'sel' : ''}" data-act="vote" data-m="${m.id}" data-p="${p.id}">${av(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <div style="margin-top:8px">${info}</div></div>`;
}

function matchCard(m) {
  const res = m.result === 'A' ? 'Ganó el Equipo A' : m.result === 'B' ? 'Ganó el Equipo B' : m.result === 'D' ? 'Empate' : 'Sin resultado';
  const hasParts = S.mp.some(x => x.match_id === m.id);
  return `<div class="card match">
    <div class="head"><div class="date">${fmtDate(m.played_on)}</div><span class="res ${m.result || ''}">${res}</span></div>
    <div class="teams">${teamHtml(m, 'A')}${teamHtml(m, 'B')}</div>
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
    ${S.matches.length ? S.matches.map(matchCard).join('') : `<div class="empty">Todavía no se cargó ningún partido.${S.isAdmin ? '<br>Tocá "+ Nuevo partido" para armar los equipos A y B.' : ''}</div>`}`;
}

function viewPlantel() {
  const roster = S.players.filter(p => !p.guest);
  const st = Object.fromEntries([...standings().played, ...standings().never].map(r => [r.p.id, r]));
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
          <div class="hint">Aparece en la tabla solo con el nombre, sin foto, y no figura en el Plantel.</div>
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
  const addGuest = () => {
    const input = $('#gname'), name = input.value.trim();
    if (!name) return input.focus();
    const c = { key: 'new' + (++n), name, temp: true };
    cand.push(c);
    $('#plist').insertAdjacentHTML('beforeend', pickRow(c, ''));
    $('#pempty').classList.add('hidden');
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
      for (const r of removed) if (player(r.player_id)?.guest) await must(db.from('players').delete().eq('id', r.player_id));
      closeModal(); toast('Partido guardado ✅'); refresh();
    } catch (er) { btn.disabled = false; err.textContent = er.message; }
  };
}

/* ---------------- acciones ---------------- */
const actions = {
  login: () => db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }),
  logout: async () => { await db.auth.signOut(); S.user = null; S.isAdmin = false; S.meId = null; S.myVotes = {}; S.emails = {}; render(); },
  tab: el => { S.tab = el.dataset.tab; render(); scrollTo(0, 0); },
  year: el => { S.year = el.value; render(); },
  vote: async el => {
    try { await must(db.rpc('cast_vote', { p_match: el.dataset.m, p_for: el.dataset.p })); toast('Voto registrado 🗳️'); refresh(); }
    catch (e) { toast(e.message, true); }
  },
  claim: () => { try { sessionStorage.removeItem('yaston-skip-claim'); } catch { /* sin storage */ } claimModal(); },
  'player-history': el => historyModal(el.dataset.id),
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
document.addEventListener('change', e => { if (e.target.dataset?.act === 'year') actions.year(e.target); });

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

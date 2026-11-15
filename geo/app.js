(() => {
  'use strict';
  const TZ = 'America/Argentina/Buenos_Aires';
  const LAUNCH = '2026-11-15';
  const WEIGHTS = [1, 1, 2, 2, 4]; // 5 rondas de 0-100, máximo 1000
  const EARTH_KM = 6371;
  const $ = id => document.getElementById(id);

  // ---------- Día y lugares ----------
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const dayNum = Math.round((Date.parse(day) - Date.parse(LAUNCH)) / 864e5) + 1;

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(a) {
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyPlaces() {
    const r = rng(hash('yagui-geo:' + day));
    const pick = (arr, n) => {
      const a = arr.slice(), out = [];
      for (let i = 0; i < n; i++) out.push(a.splice(Math.floor(r() * a.length), 1)[0]);
      return out;
    };
    return [...pick(PLACES.easy, 2), ...pick(PLACES.mid, 2), ...pick(PLACES.hard, 1)]
      .map(([name, country, lat, lon]) => ({ name, country, lat, lon }));
  }
  const places = dailyPlaces();

  // ---------- Estado ----------
  const KEY = 'yagui-geo:' + day;
  let state = { results: [] }; // results[i] = {lat, lon, km, pts}
  try { state = JSON.parse(localStorage.getItem(KEY)) || state; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  const isDone = () => state.results.length >= places.length;
  const total = () => state.results.reduce((s, r, i) => s + r.pts * WEIGHTS[i], 0);

  let phase = 'guess'; // guess | reveal | done
  let guess = null;    // [lon, lat]

  function scoreFor(km) {
    if (km <= 20) return 100;
    return Math.round(100 * Math.exp(-(km - 20) / 1500));
  }
  const fmtKm = km => Math.round(km).toLocaleString('es-AR');

  // ---------- Globo ----------
  const cv = $('globe');
  const ctx = cv.getContext('2d');
  const proj = d3.geoOrthographic().clipAngle(90).precision(0.3);
  const path = d3.geoPath(proj, ctx);
  const grat = d3.geoGraticule10();
  let geo = { lo: null, hi: null };
  let W = 0, H = 0, base = 100;
  let rot = [58, 20]; // centra en [-rot0, -rot1]
  let zoom = 1;
  let moving = false;
  let queued = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    base = Math.min(W, H * 0.8) / 2 * 0.92;
    draw();
  }
  function draw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  }
  const center = () => [-rot[0], -rot[1]];
  const visible = p => d3.geoDistance(p, center()) < Math.PI / 2 - 0.02;

  function dot(p, color, r) {
    if (!visible(p)) return;
    const [x, y] = proj(p);
    ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = color; ctx.fill();
  }
  function arc(a, b) {
    ctx.beginPath(); path({ type: 'LineString', coordinates: [a, b] });
    ctx.setLineDash([6, 5]); ctx.strokeStyle = '#1b2433'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    proj.translate([W / 2, H / 2]).scale(base * zoom).rotate([rot[0], rot[1]]);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = '#1d4466'; ctx.fill();
    ctx.beginPath(); path(grat); ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 0.6; ctx.stroke();
    const g = (moving && zoom < 4) || !geo.hi ? geo.lo : geo.hi;
    if (g) {
      ctx.beginPath(); path(g.land); ctx.fillStyle = '#eadfc6'; ctx.fill();
      ctx.beginPath(); path(g.borders); ctx.strokeStyle = '#b3a17c'; ctx.lineWidth = 0.7; ctx.stroke();
    }
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = '#7fb4e055'; ctx.lineWidth = 1.5; ctx.stroke();

    const show = i => {
      const r = state.results[i], p = places[i];
      const target = [p.lon, p.lat];
      if (r && r.lon != null) { arc([r.lon, r.lat], target); dot([r.lon, r.lat], '#ff6b4a', 5); }
      dot(target, '#2fbf71', 6);
    };
    if (phase === 'done') places.forEach((_, i) => show(i));
    else if (phase === 'reveal') show(state.results.length - 1);
    else if (guess) dot(guess, '#ff6b4a', 6);
  }

  let anim = 0;
  function flyTo(c, z, ms = 750) {
    const id = ++anim;
    const from = center(), z0 = zoom;
    const ip = d3.geoInterpolate(from, c);
    const t0 = performance.now();
    moving = true;
    const step = now => {
      if (id !== anim) return;
      const t = Math.min(1, (now - t0) / ms), e = d3.easeCubicInOut(t);
      const p = ip(e);
      rot = [-p[0], -p[1]];
      zoom = z0 + (z - z0) * e;
      if (t < 1) { render(); requestAnimationFrame(step); }
      else { moving = false; render(); }
    };
    requestAnimationFrame(step);
  }

  // Gestos: arrastrar gira, rueda/pellizco hace zoom, toque sin arrastrar marca.
  const ptrs = new Map();
  let travel = 0, pinch = 0, multi = false;
  const clampZoom = z => Math.max(0.8, Math.min(40, z));
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { travel = 0; multi = false; anim++; }
    else { multi = true; pinch = 0; }
    cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = [e.clientX, e.clientY];
    ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) {
      const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
      travel += Math.abs(dx) + Math.abs(dy);
      if (travel < 6) return;
      const k = (180 / Math.PI) / (base * zoom);
      rot[0] += dx * k;
      rot[1] = Math.max(-90, Math.min(90, rot[1] - dy * k));
      moving = true; draw();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { zoom = clampZoom(zoom * d / pinch); moving = true; draw(); }
      pinch = d;
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    pinch = 0;
    if (ptrs.size === 0) {
      cv.classList.remove('dragging');
      const tap = !multi && travel < 6 && e.type === 'pointerup';
      moving = false;
      if (tap && phase === 'guess') {
        const rect = cv.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (Math.hypot(x - W / 2, y - H / 2) <= base * zoom) {
          const ll = proj.invert([x, y]);
          if (ll && isFinite(ll[0]) && isFinite(ll[1])) { guess = ll; updateUI(); }
        }
      }
      draw();
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  let wheelTimer = 0;
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = clampZoom(zoom * Math.exp(-e.deltaY * 0.0015));
    moving = true; draw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { moving = false; draw(); }, 150);
  }, { passive: false });
  window.addEventListener('resize', resize);

  // ---------- Interfaz ----------
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function updateUI() {
    $('dayLabel').textContent = '#' + dayNum;
    const n = state.results.length;
    const btn = $('btnMain'), fb = $('feedback');
    $('bar').hidden = false;
    if (phase === 'done') {
      $('prompt').hidden = true; fb.hidden = true;
      btn.disabled = false; btn.textContent = 'Ver resultado';
    } else {
      const i = phase === 'reveal' ? n - 1 : n;
      const p = places[i];
      $('prompt').hidden = false;
      $('roundLabel').textContent = `Ronda ${i + 1}/${places.length} · ×${WEIGHTS[i]}`;
      $('scoreLabel').textContent = `${total()} pts`;
      $('placeName').textContent = p.name;
      $('placeCountry').textContent = p.country;
      if (phase === 'reveal') {
        const r = state.results[i];
        fb.hidden = false;
        fb.innerHTML = `A <b>${fmtKm(r.km)} km</b> · ${r.pts}/100` +
          (WEIGHTS[i] > 1 ? ` ×${WEIGHTS[i]} = <b>+${r.pts * WEIGHTS[i]}</b>` : '');
        btn.disabled = false;
        btn.textContent = isDone() ? 'Ver resultado' : 'Siguiente';
      } else {
        fb.hidden = true;
        btn.disabled = !guess;
        btn.textContent = guess ? 'Confirmar' : 'Tocá el mapa';
      }
    }
    draw();
  }

  $('btnMain').addEventListener('click', () => {
    if (phase === 'guess') {
      if (!guess) return;
      const p = places[state.results.length];
      const target = [p.lon, p.lat];
      const ang = d3.geoDistance(guess, target);
      const km = ang * EARTH_KM;
      state.results.push({ lon: +guess[0].toFixed(3), lat: +guess[1].toFixed(3), km: Math.round(km), pts: scoreFor(km) });
      save();
      const g = guess;
      guess = null; phase = 'reveal';
      updateUI();
      flyTo(d3.geoInterpolate(g, target)(0.5), Math.max(1, Math.min(10, 1.3 / Math.max(ang, 0.01))));
    } else if (phase === 'reveal') {
      if (isDone()) finish();
      else { phase = 'guess'; updateUI(); flyTo(center(), 1, 500); }
    } else {
      showEnd();
    }
  });

  function finish() {
    phase = 'done';
    updateUI();
    flyTo(center(), 1, 500);
    showEnd();
    syncPlay();
  }

  function showEnd() {
    $('endTotal').innerHTML = `${total()} <small>/ 1000</small>`;
    const ol = $('endRounds');
    ol.textContent = '';
    places.forEach((p, i) => {
      const r = state.results[i];
      const li = document.createElement('li');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = `${p.name}, ${p.country}`;
      b.innerHTML = `${fmtKm(r.km)} km · <b>${r.pts * WEIGHTS[i]}</b>`;
      li.append(a, b); ol.append(li);
    });
    $('endNote').textContent = !sb ? 'Volvé mañana por cinco lugares nuevos.'
      : user ? 'Puntaje guardado en la tabla. Volvé mañana por cinco lugares nuevos.'
      : 'Entrá con Google para guardar tu puntaje en la tabla.';
    if (!$('endDlg').open) $('endDlg').showModal();
  }
  const mark = pts => pts >= 90 ? '🟢' : pts >= 60 ? '🟡' : pts >= 30 ? '🟠' : '🔴';
  $('btnShare').addEventListener('click', async () => {
    const text = `Yagui Geo #${dayNum}\n` +
      state.results.map(r => mark(r.pts) + r.pts).join(' ') +
      `\nTotal: ${total()}/1000\n${location.origin + location.pathname}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Resultado copiado'); }
    } catch (e) { /* cancelado */ }
  });
  $('btnEndClose').addEventListener('click', () => $('endDlg').close());
  $('btnEndBoard').addEventListener('click', () => { $('endDlg').close(); showBoard(); });
  $('btnBoard').addEventListener('click', showBoard);
  $('btnBoardClose').addEventListener('click', () => $('boardDlg').close());

  // ---------- Supabase: login con Google y tabla ----------
  const cfg = window.YAGUI_CONFIG || {};
  const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  let user = null;

  function updateAuthUI() {
    const b = $('btnAuth');
    if (!sb) { b.hidden = true; return; }
    const m = user && user.user_metadata || {};
    b.textContent = user ? `Salir (${(m.full_name || m.name || user.email || '').split(' ')[0]})` : 'Entrar con Google';
  }
  $('btnAuth').addEventListener('click', async () => {
    if (!sb) return;
    if (user) { await sb.auth.signOut(); return; }
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) toast('No se pudo iniciar sesión');
  });

  async function syncPlay() {
    if (!sb || !user) return;
    const m = user.user_metadata || {};
    const name = m.full_name || m.name || (user.email || 'Jugador').split('@')[0];
    await sb.from('geo_profiles').upsert({ id: user.id, name, avatar_url: m.avatar_url || m.picture || null });
    const { data: row, error } = await sb.from('geo_plays').select('rounds,total')
      .eq('user_id', user.id).eq('day', day).maybeSingle();
    if (error) { toast('No se pudo leer tu partida'); return; }
    if (row) {
      // Ya jugó hoy con esta cuenta (quizá en otro dispositivo): vale lo guardado.
      state = { results: row.rounds }; save();
      guess = null; phase = 'done'; updateUI();
      if (!$('endDlg').open && !$('boardDlg').open) showEnd();
    } else if (isDone()) {
      const { error: e2 } = await sb.from('geo_plays').insert({ user_id: user.id, day, rounds: state.results, total: total() });
      toast(e2 ? 'No se pudo guardar el puntaje' : 'Puntaje guardado');
      if ($('endDlg').open) showEnd();
    }
  }

  let sortKey = 'total';
  let boardRows = [];
  const COLS = [['total', 'Total'], ['days', 'Días'], ['average', 'Prom.'], ['best', 'Mejor'], ['today', 'Hoy']];
  function renderBoard() {
    const body = $('boardBody');
    body.textContent = '';
    if (!boardRows.length) { body.textContent = 'Todavía no jugó nadie. ¡Sé el primero!'; return; }
    const rows = boardRows.slice().sort((a, b) => (b[sortKey] ?? -1) - (a[sortKey] ?? -1) || b.total - a.total);
    const table = document.createElement('table');
    const hr = table.createTHead().insertRow();
    ['#', 'Jugador'].forEach(t => { const th = document.createElement('th'); th.textContent = t; hr.append(th); });
    COLS.forEach(([k, label]) => {
      const th = document.createElement('th');
      th.textContent = label + (k === sortKey ? ' ▾' : '');
      if (k === sortKey) th.className = 'sorted';
      th.addEventListener('click', () => { sortKey = k; renderBoard(); });
      hr.append(th);
    });
    const tb = table.createTBody();
    rows.forEach((r, i) => {
      const tr = tb.insertRow();
      if (user && r.id === user.id) tr.className = 'me';
      tr.insertCell().textContent = i + 1;
      const pc = tr.insertCell(); pc.className = 'player';
      if (r.avatar_url) {
        const img = new Image(); img.src = r.avatar_url; img.alt = ''; img.referrerPolicy = 'no-referrer';
        pc.append(img);
      }
      pc.append(r.name);
      COLS.forEach(([k]) => {
        const v = r[k];
        tr.insertCell().textContent = v == null ? '–' : k === 'average' ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 1 }) : v;
      });
    });
    body.append(table);
  }
  async function showBoard() {
    const body = $('boardBody');
    if (!$('boardDlg').open) $('boardDlg').showModal();
    if (!sb) { body.textContent = 'La tabla todavía no está conectada (falta configurar Supabase en config.js).'; return; }
    body.textContent = 'Cargando…';
    const { data, error } = await sb.from('geo_leaderboard').select('*');
    if (error) { body.textContent = 'No se pudo cargar la tabla.'; return; }
    boardRows = data || [];
    renderBoard();
  }

  // ---------- Arranque ----------
  if (isDone()) phase = 'done';
  resize();
  updateUI();
  updateAuthUI();
  if (phase === 'done') showEnd();

  const load = (file, key) => d3.json(file).then(t => {
    geo[key] = {
      land: topojson.feature(t, t.objects.land),
      borders: topojson.mesh(t, t.objects.countries, (a, b) => a !== b)
    };
    draw();
  });
  load('vendor/countries-110m.json', 'lo').then(() => load('vendor/countries-50m.json', 'hi'));

  if (sb) {
    sb.auth.onAuthStateChange((_event, session) => {
      const next = session ? session.user : null;
      const changed = (next && next.id) !== (user && user.id);
      user = next;
      updateAuthUI();
      if (changed && user) setTimeout(syncPlay, 0); // fuera del callback para no bloquear el cliente
    });
  }
})();

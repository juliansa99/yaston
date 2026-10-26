// Juego "¿Quién es?": una foto muy ampliada y borrosa que se va aclarando; hay que elegir el nombre entre 4.
(() => {
'use strict';
const ROUNDS = 5;
const REVEAL_MS = 11000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const rand = (a, b) => a + Math.random() * (b - a);
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function loadImg(url) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
}

function mount(root, opts) {
  const all = (opts.players || []).filter(p => p.name);
  const withPhoto = all.filter(p => p.photo_url);
  // si hay fotos de sobra, no te toca tu propia cara
  const pool = withPhoto.filter(p => p.id !== opts.excludeId).length >= ROUNDS ? withPhoto.filter(p => p.id !== opts.excludeId) : withPhoto;
  if (all.length < 4 || pool.length < 1) {
    root.innerHTML = '<div class="empty">Para jugar hacen falta al menos 4 jugadores y alguna foto cargada en el Plantel.</div>';
    return;
  }
  const rounds = Math.min(ROUNDS, pool.length);
  root.innerHTML = `<div class="pen qe">
    <div class="pen-head">
      <div><b>¿Quién es?</b><div class="muted small">La foto se va aclarando. Elegí el nombre entre 4 opciones: 1 punto por acierto.</div><div class="small pen-try" id="qe-try"></div></div>
      <div class="pen-score"><b id="qe-score">0</b><span>aciertos</span></div>
    </div>
    <div class="qe-frame" id="qe-frame"><img id="qe-img" alt="¿Quién es?" draggable="false"><span class="qe-round" id="qe-round"></span></div>
    <div class="qe-time"><i id="qe-bar"></i></div>
    <div class="qe-opts" id="qe-opts"></div>
    <div class="pen-dots" id="qe-dots">${Array.from({ length: rounds }, () => '<i></i>').join('')}</div>
    <div class="pen-end hidden" id="qe-end"></div>
  </div>`;
  const $ = id => root.querySelector('#' + id);
  const img = $('qe-img'), bar = $('qe-bar'), optsEl = $('qe-opts');
  const tryLabel = () => { $('qe-try').textContent = opts.tryLabel?.() || ''; };
  let order = [], round = 0, score = 0, locked = true, timer = null, token = 0;

  function newGame() {
    order = shuffle(pool); round = 0; score = 0; locked = true;
    $('qe-score').textContent = '0';
    root.querySelectorAll('#qe-dots i').forEach(i => { i.className = ''; });
    $('qe-end').classList.add('hidden'); $('qe-end').innerHTML = '';
    tryLabel(); next();
  }

  async function next() {
    if (round >= rounds) return end();
    const my = ++token;
    const target = order[round];
    $('qe-round').textContent = `Ronda ${round + 1} de ${rounds}`;
    optsEl.innerHTML = ''; locked = true;
    // se carga la foto antes de empezar a aclarar, para que el tiempo corra con la foto a la vista
    img.className = 'start'; bar.style.transition = 'none'; bar.style.width = '0';
    if (!(await loadImg(target.photo_url))) { if (my !== token) return; order.splice(round, 1); if (round >= Math.min(rounds, order.length)) return end(); return next(); }
    if (my !== token || !root.isConnected) return;
    const others = shuffle(all.filter(p => p.id !== target.id && norm(p.name) !== norm(target.name)));
    const names = shuffle([target.name, ...[...new Map(others.map(p => [norm(p.name), p.name])).values()].slice(0, 3)]);
    optsEl.innerHTML = names.map(n => `<button class="qe-opt" data-n="${esc(n)}">${esc(n)}</button>`).join('');
    img.src = target.photo_url;
    img.style.setProperty('--ox', rand(25, 75).toFixed(0) + '%'); img.style.setProperty('--oy', rand(25, 75).toFixed(0) + '%');
    void img.offsetWidth;
    img.className = 'go'; bar.style.transition = `width ${REVEAL_MS}ms linear`; bar.style.width = '100%';
    locked = false;
    optsEl.onclick = e => {
      const b = e.target.closest('.qe-opt'); if (!b || locked) return;
      locked = true;
      const ok = norm(b.dataset.n) === norm(target.name);
      if (ok) score++;
      img.className = 'done'; bar.style.transition = 'none';
      optsEl.querySelectorAll('.qe-opt').forEach(x => { x.disabled = true; if (norm(x.dataset.n) === norm(target.name)) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      try { if (!ok) navigator.vibrate?.(60); } catch { /* sin vibración */ }
      $('qe-score').textContent = score;
      root.querySelectorAll('#qe-dots i')[round].className = ok ? 'g' : 'w';
      round++;
      clearTimeout(timer);
      timer = setTimeout(() => { if (root.isConnected) next(); }, 1500);
    };
  }

  async function end() {
    let saveErr = '';
    try { await opts.onFinish?.(score); } catch (e) { saveErr = e.message || 'No se pudo guardar tu resultado'; }
    if (!root.isConnected) return;
    const left = opts.attemptsLeft?.() ?? 0, best = Math.max(score, opts.best?.() ?? 0);
    const text = ['Ni a tu mamá la reconociste.', 'Más ojo, che.', 'Algunos se te escaparon.', 'Bastante bien, conocés a la banda.', 'Casi perfecto: tenés ojo de lince.', '¡Pleno! Los conocés hasta por una oreja. 👂'][Math.min(score, 5)];
    const box = $('qe-end'); box.classList.remove('hidden');
    box.innerHTML = `<div class="pen-final"><b>${score} de ${rounds}</b><span>${esc(text)}</span>
      ${saveErr ? `<small class="pen-err">${esc(saveErr)}</small>` : `<small>Tu mejor de la semana: ${best} de ${ROUNDS}</small>`}
      ${left > 0 ? `<button class="btn primary" id="qe-again">Jugar de nuevo (te quedan ${left})</button>` : '<small>Ya usaste tus 3 intentos de esta semana.</small>'}
      <button class="btn ghost" id="qe-exit">Ver la tabla</button></div>`;
    $('qe-exit').onclick = () => opts.onExit?.();
    if (left > 0) $('qe-again').onclick = async () => {
      $('qe-again').disabled = true;
      if (!(await opts.onAgain?.())) { $('qe-again').disabled = false; return; }
      newGame();
    };
  }
  newGame();
}

window.YastonQuienEs = { mount };
})();

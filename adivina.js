// Juego "¿Quién ganó ese partido?": se ve la cancha de un partido viejo sin el resultado y hay que adivinar.
(() => {
'use strict';
const ROUNDS = 5;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

function mount(root, opts) {
  const pool = opts.matches || [];
  if (pool.length < 1) { root.innerHTML = '<div class="empty">Todavía no hay partidos con resultado para jugar.</div>'; return; }
  const rounds = Math.min(ROUNDS, pool.length);
  root.innerHTML = `<div class="pen aq">
    <div class="pen-head">
      <div><b>¿Quién ganó ese partido?</b><div class="muted small">Mirá los equipos y adiviná cómo terminó. 1 punto por acierto.</div><div class="small pen-try" id="aq-try"></div></div>
      <div class="pen-score"><b id="aq-score">0</b><span>aciertos</span></div>
    </div>
    <div class="aq-when" id="aq-when"></div>
    <div class="aq-opts" id="aq-opts">
      <button class="aq-opt a" data-r="A">Ganó el A</button><button class="aq-opt d" data-r="D">Empate</button><button class="aq-opt b" data-r="B">Ganó el B</button>
    </div>
    <div class="aq-reveal" id="aq-reveal"></div>
    <div id="aq-pitch"></div>
    <div class="pen-dots" id="aq-dots">${Array.from({ length: rounds }, () => '<i></i>').join('')}</div>
    <div class="pen-end hidden" id="aq-end"></div>
  </div>`;
  const $ = id => root.querySelector('#' + id);
  const optBtns = () => root.querySelectorAll('.aq-opt');
  let order = [], round = 0, score = 0, locked = true, timer = null, cur = null;

  const tryLabel = () => { $('aq-try').textContent = opts.tryLabel?.() || ''; };

  function newGame() {
    order = shuffle(pool).slice(0, rounds); round = 0; score = 0;
    $('aq-score').textContent = '0';
    root.querySelectorAll('#aq-dots i').forEach(i => { i.className = ''; });
    $('aq-end').classList.add('hidden'); $('aq-end').innerHTML = '';
    tryLabel(); next();
  }

  function next() {
    if (round >= rounds) { end(); return; }
    const m = order[round], swap = Math.random() < 0.5; // a veces se muestran los equipos al revés, para que no sirva "siempre el A"
    cur = { m, swap };
    $('aq-when').textContent = `Partido ${round + 1} de ${rounds}`;
    $('aq-pitch').innerHTML = opts.pitch(m, { hide: true, swap, stat: true });
    $('aq-reveal').innerHTML = '';
    optBtns().forEach(b => { b.disabled = false; b.className = 'aq-opt ' + b.dataset.r.toLowerCase(); });
    locked = false;
  }

  root.querySelector('#aq-opts').onclick = e => {
    const b = e.target.closest('.aq-opt'); if (!b || locked) return;
    locked = true;
    const { m, swap } = cur, real = m.result === 'D' ? 'D' : (swap ? (m.result === 'A' ? 'B' : 'A') : m.result); // resultado visto desde lo que se muestra
    const ok = b.dataset.r === real;
    if (ok) score++;
    optBtns().forEach(x => { x.disabled = true; if (x.dataset.r === real) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    try { if (!ok) navigator.vibrate?.(60); } catch { /* sin vibración */ }
    $('aq-score').textContent = score;
    root.querySelectorAll('#aq-dots i')[round].className = ok ? 'g' : 'w';
    $('aq-pitch').innerHTML = opts.pitch(m, { hide: false, swap, stat: true });
    const fig = opts.figure?.(m);
    $('aq-reveal').innerHTML = `<b>${ok ? '¡Acertaste!' : 'Era otro resultado.'}</b> ${real === 'D' ? 'Empataron.' : `Ganó el Equipo ${real}.`}${fig ? ` La figura fue ${esc(fig)}.` : ''}`;
    round++;
    clearTimeout(timer);
    timer = setTimeout(() => { if (root.isConnected) next(); }, 2400);
  };

  async function end() {
    let saveErr = '';
    try { await opts.onFinish?.(score); } catch (e) { saveErr = e.message || 'No se pudo guardar tu resultado'; }
    if (!root.isConnected) return;
    const left = opts.attemptsLeft?.() ?? 0, best = Math.max(score, opts.best?.() ?? 0);
    const text = ['Ni una. Te perdiste todos los jueves.', 'Uno solo. ¿Dónde estabas?', 'Dos. Te acordás a medias.', 'Tres. Buena memoria.', 'Cuatro. Casi sos el historiador del grupo.', '¡Pleno! Sos la memoria de los jueves. 🧠'][Math.min(score, 5)];
    const box = $('aq-end'); box.classList.remove('hidden');
    box.innerHTML = `<div class="pen-final"><b>${score} de ${rounds}</b><span>${esc(text)}</span>
      ${saveErr ? `<small class="pen-err">${esc(saveErr)}</small>` : `<small>${(opts.maxTries ?? 3) === 1 ? 'Tu resultado de la semana' : 'Tu mejor de la semana'}: ${best} de ${ROUNDS}</small>`}
      ${left > 0 ? `<button class="btn primary" id="aq-again">Jugar de nuevo (te quedan ${left})</button>` : `<small>${(opts.maxTries ?? 3) === 1 ? 'Este era tu único intento de esta semana.' : `Ya usaste tus ${opts.maxTries ?? 3} intentos de esta semana.`}</small>`}
      <button class="btn ghost" id="aq-exit">Ver la tabla</button></div>`;
    $('aq-exit').onclick = () => opts.onExit?.();
    if (left > 0) $('aq-again').onclick = async () => {
      $('aq-again').disabled = true;
      if (!(await opts.onAgain?.())) { $('aq-again').disabled = false; return; }
      newGame();
    };
  }
  newGame();
}

window.YastonAdivina = { mount };
})();

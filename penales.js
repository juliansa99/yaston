// Juego "Pateale Penales a Gure": tanda de 5 penales, el arquero es la foto del jugador.
(() => {
'use strict';
const KEY = 'yaston-penales-record';
const SHOTS = 5;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = list => list[Math.floor(Math.random() * list.length)];
const GOAL = { x1: 9, x2: 91, y1: 7, y2: 39 };   // el arco, en % de la cancha
const REST = { x: 50, y: 24 };                    // dónde espera el arquero
const BALL = { x: 50, y: 84 };                    // el punto del penal

function readRecord() { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } }
function saveRecord(n) { try { localStorage.setItem(KEY, String(n)); } catch { /* sin storage */ } }

function mount(root, opts) {
  const name = opts.name || 'Gure';
  const face = opts.photo
    ? `<img class="pen-face" src="${esc(opts.photo)}" alt="${esc(name)}" draggable="false">`
    : `<span class="pen-face pen-initial">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  root.innerHTML = `<div class="pen">
    <div class="pen-head">
      <div><b>Pateale Penales a ${esc(name)}</b><div class="muted small">Tocá el arco para patear. Son ${SHOTS} penales.</div></div>
      <div class="pen-score"><b id="pen-goals">0</b><span>goles</span></div>
    </div>
    <div class="pen-stage" id="pen-stage">
      <div class="pen-goal"><div class="pen-net"></div></div>
      <div class="pen-spot"></div>
      <div class="pen-keeper" id="pen-keeper"><span class="pen-body"></span>${face}<span class="pen-glove l">🧤</span><span class="pen-glove r">🧤</span><span class="pen-react" id="pen-react"></span></div>
      <div class="pen-ball" id="pen-ball">⚽</div>
      <div class="pen-msg" id="pen-msg"></div>
    </div>
    <div class="pen-dots" id="pen-dots">${Array.from({ length: SHOTS }, () => '<i></i>').join('')}</div>
    <div class="pen-end hidden" id="pen-end"></div>
  </div>`;
  const $ = id => root.querySelector('#' + id);
  const stage = $('pen-stage'), keeper = $('pen-keeper'), ball = $('pen-ball'), msg = $('pen-msg'), react = $('pen-react');
  let shots = 0, goals = 0, busy = false;

  const place = (el, x, y, extra = '') => { el.style.left = x + '%'; el.style.top = y + '%'; el.style.transform = `translate(-50%, -50%) ${extra}`; };
  const reset = () => {
    for (const el of [ball, keeper]) el.style.transition = 'none';
    place(ball, BALL.x, BALL.y);
    place(keeper, REST.x, REST.y);
    react.textContent = ''; msg.className = 'pen-msg'; msg.textContent = '';
    void stage.offsetWidth; // aplicar sin animar
    ball.style.transition = ''; keeper.style.transition = '';
  };
  reset();

  function end() {
    const record = Math.max(readRecord(), goals);
    const newRecord = goals > readRecord();
    saveRecord(record);
    const text = [
      `${name} te dejó en cero. Mejor volvé al truco.`,
      `${name} todavía manda.`, `${name} todavía manda.`,
      `Ganaste, pero ${name} no se olvida.`,
      `Casi perfecto. ${name} llora en el vestuario.`,
      `¡Pleno! Humillaste a ${name}. 🔥`,
    ][goals];
    const box = $('pen-end');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="pen-final"><b>${goals} de ${SHOTS}</b><span>${esc(text)}</span>
      <small>${newRecord ? '🏆 ¡Nuevo récord!' : `Tu récord: ${record} de ${SHOTS}`}</small>
      <button class="btn primary" id="pen-again">Jugar de nuevo</button></div>`;
    $('pen-again').onclick = () => {
      shots = 0; goals = 0; busy = false;
      $('pen-goals').textContent = '0';
      root.querySelectorAll('#pen-dots i').forEach(i => { i.className = ''; });
      box.classList.add('hidden'); box.innerHTML = '';
      reset();
    };
  }

  function shoot(tx, ty) {
    busy = true;
    const inGoal = tx > GOAL.x1 && tx < GOAL.x2 && ty > GOAL.y1 && ty < GOAL.y2;
    // el arquero a veces se la huele y se tira cerca de donde pateaste
    let kx, ky;
    if (Math.random() < 0.35) { kx = tx + rand(-9, 9); ky = ty + rand(-6, 6); }
    else { kx = rand(16, 84); ky = rand(16, 36); }
    kx = clamp(kx, 15, 85); ky = clamp(ky, 15, 37);
    const S = stage.clientWidth;
    const dist = Math.hypot((tx - kx) / 100 * S, (ty - ky) / 100 * S);
    const saved = inGoal && dist < 0.13 * S;
    const bx = clamp(tx, 2, 98), by = clamp(ty, 2, 60);

    ball.style.transition = 'left .45s cubic-bezier(.2,.7,.3,1), top .45s cubic-bezier(.2,.7,.3,1), transform .45s linear';
    place(ball, bx, by, 'scale(.55) rotate(540deg)');
    setTimeout(() => {
      keeper.style.transition = 'left .32s ease-out, top .32s ease-out, transform .32s ease-out';
      place(keeper, kx, ky, `rotate(${clamp((kx - 50) * 0.9, -40, 40)}deg)`);
    }, 70);

    setTimeout(() => {
      if (!root.isConnected) return;
      let kind, text, emoji;
      if (!inGoal) { kind = 'w'; text = pick(['¡Afuera!', '¡A la tribuna!', '¡Se la dio a un nene!']); emoji = '😂'; }
      else if (saved) { kind = 's'; text = pick([`¡ATAJÓ ${name.toUpperCase()}!`, `¡${name} la sacó!`, '¡Muro!']); emoji = '😎'; }
      else { kind = 'g'; text = pick(['¡GOOOL!', '¡Qué golazo!', '¡Lo clavó en el ángulo!']); emoji = '😭'; goals++; }
      if (kind !== 'g') try { navigator.vibrate?.(60); } catch { /* sin vibración */ }
      react.textContent = emoji;
      msg.textContent = text; msg.className = 'pen-msg show ' + kind;
      $('pen-goals').textContent = goals;
      root.querySelectorAll('#pen-dots i')[shots].className = kind;
      shots++;
      setTimeout(() => {
        if (!root.isConnected) return;
        if (shots >= SHOTS) return end();
        reset(); busy = false;
      }, 1300);
    }, 560);
  }

  stage.addEventListener('pointerdown', e => {
    if (busy || shots >= SHOTS) return;
    const r = stage.getBoundingClientRect();
    const tx = (e.clientX - r.left) / r.width * 100, ty = (e.clientY - r.top) / r.height * 100;
    if (ty > 58) return; // tocar abajo (cerca de la pelota) no cuenta como tiro
    shoot(tx, ty);
  });
}

window.YastonPenales = { mount };
})();

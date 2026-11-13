// Juego de preguntas: "¿Cuánto conocés a X?". Las respuestas correctas viven en la base, no en esta página.
(() => {
'use strict';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mount(root, opts) {
  root.innerHTML = '<div class="empty">Cargando las preguntas…</div>';
  let qs = [], answers = [], i = 0, locked = false;

  const head = (n, total) => `<div class="pen-head">
      <div><b>${esc(opts.title)}</b><div class="muted small">${opts.practice ? 'Modo práctica: podés responder, pero no suma puntos ni aparece en la tabla.' : 'Una pregunta por vez. Elegí una opción.'}</div></div>
      <div class="pen-score"><b>${n}/${total}</b><span>pregunta</span></div></div>`;

  function question() {
    const q = qs[i];
    root.innerHTML = `<div class="fq">${head(i + 1, qs.length)}
      <div class="fq-bar"><i style="width:${(i / qs.length) * 100}%"></i></div>
      <div class="fq-card"><div class="fq-num">Pregunta ${i + 1}</div><h3>${esc(q.question)}</h3>
        <div class="fq-opts">${q.options.map((o, k) => `<button class="fq-opt" data-k="${k}"><span class="fq-l">${LETTERS[k]}</span><span>${esc(o)}</span></button>`).join('')}</div></div></div>`;
    locked = false;
    root.querySelector('.fq-opts').onclick = e => {
      const b = e.target.closest('.fq-opt'); if (!b || locked) return;
      locked = true; b.classList.add('sel');
      answers[i] = Number(b.dataset.k);
      setTimeout(() => { if (!root.isConnected) return; i++; if (i < qs.length) question(); else finish(); }, 380);
    };
  }

  async function finish() {
    root.innerHTML = `<div class="fq">${head(qs.length, qs.length)}<div class="fq-bar"><i style="width:100%"></i></div><div class="empty">Corrigiendo tus respuestas…</div></div>`;
    let res = null, err = '';
    try { res = await opts.submit(answers); } catch (e) { err = e.message || 'No se pudo guardar tu resultado'; }
    if (!root.isConnected) return;
    const max = qs.length, sc = res?.score ?? 0;
    const text = sc <= 2 ? 'Para Fito sos casi un desconocido.' : sc <= 4 ? 'Lo conocés poco.' : sc <= 6 ? 'Amigo de la casa.' : sc <= 8 ? 'Casi hermano.' : sc < max ? 'Casi perfecto.' : '¡Pleno! Lo conocés mejor que nadie. 🏆';
    if (opts.practice) {
      const corr = res?.correct || [];
      root.innerHTML = `<div class="fq"><div class="fq-final"><b>Modo práctica</b><span>Esto no suma puntos ni aparece en la tabla.</span></div>
        <div class="fq-review">${qs.map((q, k) => {
          const ok = answers[k] === corr[k];
          return `<div class="fq-rev ${ok ? 'ok' : 'bad'}"><div class="fq-rq">${k + 1}. ${esc(q.question)}</div>
            <div class="small">${ok ? '✅' : '❌'} Elegiste <b>${LETTERS[answers[k]]}) ${esc(q.options[answers[k]] ?? '–')}</b>${ok ? '' : ` · Correcta: <b>${LETTERS[corr[k]]}) ${esc(q.options[corr[k]] ?? '?')}</b>`}</div></div>`;
        }).join('')}</div>
        <div class="fq-actions"><button class="btn primary" id="fq-again">Probar de nuevo</button><button class="btn ghost" id="fq-exit">Salir</button></div></div>`;
      root.querySelector('#fq-again').onclick = () => { answers = []; i = 0; question(); };
      root.querySelector('#fq-exit').onclick = () => opts.onExit?.();
      return;
    }
    root.innerHTML = `<div class="fq"><div class="fq-final"><b>${err ? '¡Listo!' : `${sc} de ${max}`}</b><span>${err ? 'Respondiste todas las preguntas.' : esc(text)}</span>
      ${err ? `<small class="pen-err">${esc(err)}</small>` : '<small>Tu resultado ya quedó en la tabla de la semana.</small>'}
      <small>Este era tu único intento de esta semana.</small>
      <button class="btn primary" id="fq-exit">Ver la tabla</button></div></div>`;
    root.querySelector('#fq-exit').onclick = () => opts.onExit?.();
  }

  (async () => {
    try { qs = await opts.loadQuestions(); } catch (e) { root.innerHTML = `<div class="empty">No pude cargar las preguntas.<br><small>${esc(e.message || '')}</small></div>`; return; }
    if (!qs?.length) { root.innerHTML = '<div class="empty">Este juego todavía no tiene preguntas cargadas.</div>'; return; }
    qs = [...qs].sort((a, b) => a.n - b.n);
    question();
  })();
}

window.YastonQuiz = { mount };
})();

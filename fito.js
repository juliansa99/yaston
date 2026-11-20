// Juego de preguntas: "¿Cuánto conocés a X?". Las respuestas correctas viven en la base, no en esta página:
// cada pregunta se responde una sola vez y recién ahí la base dice cuál era la correcta.
(() => {
'use strict';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mount(root, opts) {
  root.innerHTML = '<div class="empty">Cargando las preguntas…</div>';
  let qs = [], res = [], i = 0, busy = false, resumed = false;
  const tally = () => ({ ok: res.filter(r => r?.ok).length, bad: res.filter(r => r && !r.ok).length });

  const head = (n, total) => `<div class="pen-head">
      <div><b>${esc(opts.title)}</b><div class="muted small">${opts.practice ? 'Modo práctica: no suma puntos ni aparece en la tabla.' : resumed ? 'Seguís donde habías quedado. Tus respuestas anteriores están guardadas.' : 'Una pregunta por vez. Tenés un solo intento.'}</div></div>
      <div class="pen-score"><b>${n}/${total}</b><span>pregunta</span></div></div>`;
  const tallyHtml = () => { const t = tally(); return `<div class="fq-tally"><span class="ok">✅ ${t.ok} bien</span><span class="bad">❌ ${t.bad} mal</span></div>`; };

  function question() {
    const q = qs[i], last = i === qs.length - 1;
    root.innerHTML = `<div class="fq">${head(i + 1, qs.length)}
      <div class="fq-bar"><i style="width:${(i / qs.length) * 100}%"></i></div>
      ${tallyHtml()}
      <div class="fq-card"><div class="fq-num">Pregunta ${i + 1}</div><h3>${esc(q.question)}</h3>
        <div class="fq-opts">${q.options.map((o, k) => `<button class="fq-opt" data-k="${k}"><span class="fq-l">${LETTERS[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div class="fq-fb" id="fq-fb"></div>
        <div class="fq-next hidden" id="fq-next"><button class="btn primary" id="fq-go">${last ? 'Ver el resultado' : 'Siguiente →'}</button></div>
      </div></div>`;
    busy = false;
    const opts_ = [...root.querySelectorAll('.fq-opt')];
    root.querySelector('.fq-opts').onclick = async e => {
      const b = e.target.closest('.fq-opt'); if (!b || busy) return;
      busy = true; b.classList.add('sel');
      const choice = Number(b.dataset.k);
      let r;
      try { r = await opts.answer(q.n, choice); }
      catch (err) { busy = false; b.classList.remove('sel'); const fb = root.querySelector('#fq-fb'); if (fb) fb.innerHTML = `<span class="bad">${esc(err.message || 'No se pudo guardar tu respuesta. Probá de nuevo.')}</span>`; return; }
      if (!root.isConnected) return;
      const ok = !!(r.is_correct ?? r.ok), correct = r.correct_idx;
      res[i] = { choice, correct, ok };
      opts_.forEach(x => { x.disabled = true; x.classList.remove('sel'); });
      opts_[correct]?.classList.add('right');
      if (!ok) b.classList.add('wrong');
      try { if (!ok) navigator.vibrate?.(60); } catch { /* sin vibración */ }
      root.querySelector('#fq-fb').innerHTML = ok ? '<span class="ok">✅ ¡Correcta!</span>' : `<span class="bad">❌ Era la ${LETTERS[correct]}) ${esc(q.options[correct] ?? '?')}</span>`;
      root.querySelector('.fq-tally').outerHTML = tallyHtml();
      root.querySelector('#fq-next').classList.remove('hidden');
      root.querySelector('#fq-go').onclick = () => { i++; if (i < qs.length) question(); else finish(); };
      root.querySelector('#fq-go').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
  }

  const review = () => `<div class="fq-review">${qs.map((q, k) => {
    const r = res[k] || { choice: -1, correct: -1, ok: false };
    return `<div class="fq-rev ${r.ok ? 'ok' : 'bad'}"><div class="fq-rq">${k + 1}. ${esc(q.question)}</div>
      <div class="small">${r.ok ? '✅' : '❌'} Elegiste <b>${LETTERS[r.choice] ?? '–'}) ${esc(q.options[r.choice] ?? '–')}</b>${r.ok ? '' : ` · Correcta: <b>${LETTERS[r.correct] ?? '?'}) ${esc(q.options[r.correct] ?? '?')}</b>`}</div></div>`;
  }).join('')}</div>`;

  async function finish() {
    root.innerHTML = `<div class="fq">${head(qs.length, qs.length)}<div class="fq-bar"><i style="width:100%"></i></div><div class="empty">Guardando tu resultado…</div></div>`;
    let err = '';
    try { await opts.finish(); } catch (e) { err = e.message || 'No se pudo guardar tu resultado'; }
    if (!root.isConnected) return;
    const t = tally(), max = qs.length;
    const V = opts.verdicts || ['Para Fito sos casi un desconocido.', 'Lo conocés poco.', 'Amigo de la casa.', 'Casi hermano.', 'Casi perfecto.', '¡Pleno! Lo conocés mejor que nadie. 🏆'];
    const text = t.ok <= 2 ? V[0] : t.ok <= 4 ? V[1] : t.ok <= 6 ? V[2] : t.ok <= 8 ? V[3] : t.ok < max ? V[4] : V[5];
    if (opts.practice) {
      root.innerHTML = `<div class="fq"><div class="fq-final"><b>Modo práctica</b><span>${t.ok} bien · ${t.bad} mal. No suma puntos ni aparece en la tabla.</span></div>${review()}
        <div class="fq-actions"><button class="btn primary" id="fq-again">Probar de nuevo</button><button class="btn ghost" id="fq-exit">Salir</button></div></div>`;
      root.querySelector('#fq-again').onclick = () => { res = []; i = 0; question(); };
      root.querySelector('#fq-exit').onclick = () => opts.onExit?.();
      return;
    }
    root.innerHTML = `<div class="fq"><div class="fq-final"><b>${t.ok} de ${max}</b><span>${esc(text)}</span>
      ${err ? `<small class="pen-err">${esc(err)}</small>` : '<small>Tu resultado ya quedó en la tabla de la semana.</small>'}
      <small>Este era tu único intento de esta semana.</small></div>${review()}
      <div class="fq-actions"><button class="btn primary" id="fq-exit">Ver la tabla</button></div></div>`;
    root.querySelector('#fq-exit').onclick = () => opts.onExit?.();
  }

  (async () => {
    try { qs = await opts.loadQuestions(); } catch (e) { root.innerHTML = `<div class="empty">No pude cargar las preguntas.<br><small>${esc(e.message || '')}</small></div>`; return; }
    if (!qs?.length) { root.innerHTML = '<div class="empty">Este juego todavía no tiene preguntas cargadas.</div>'; return; }
    qs = [...qs].sort((a, b) => a.n - b.n);
    // si ya habías respondido algunas, se retoma desde la primera que falta
    let prog = [];
    if (opts.progress) { try { prog = (await opts.progress()) || []; } catch { prog = []; } }
    prog.forEach(p => { const k = qs.findIndex(q => q.n === p.n); if (k >= 0) res[k] = { choice: p.choice, correct: p.correct_idx, ok: p.is_correct }; });
    const next = qs.findIndex((q, k) => !res[k]);
    resumed = prog.length > 0;
    if (next === -1) { i = qs.length; finish(); return; }
    i = next;
    question();
  })();
}

window.YastonQuiz = { mount };
})();

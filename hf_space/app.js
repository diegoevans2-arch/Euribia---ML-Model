/* ═══════════════════════════════════════════════════════════════════════════
   Proyección de demanda de asignaturas · app
   Sin dependencias, sin build. Los datos llegan precomputados desde data/.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ------------------------------------------------------------------ estado */
let LANG = (localStorage.getItem('lang')
            || ((navigator.language || 'es').startsWith('en') ? 'en' : 'es'));
if (!I18N[LANG]) LANG = 'es';

let D = null;            // dashboard.json  · agregados de todos los módulos
let SERIE = null;        // serie.json      · secciones por período (carga diferida)
let CELDAS = null;       // celdas.json     · 1,7 MB, solo si se abre el explorador
let TAB = 'resumen';

/* Filtros del gráfico de secciones y del explorador. Se guardan por VALOR y no por
   índice: los catálogos pueden cambiar entre corridas y un índice no sobrevive. */
const FS = { campus: new Set(), comp: new Set(), esc: new Set(), reg: 'regular',
             escala: 'lineal' };
const FX = { q: '', periodo: '', campus: '', comp: '', pag: 0 };
const PAGE = 60;

/* ---------------------------------------------------------------- formato  */
const LOC = () => LANG === 'en' ? 'en-US' : 'es-CL';
const F = {
  n:   (v, d = 0) => v == null || isNaN(v) ? '—'
        : v.toLocaleString(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (v, d = 1) => v == null || isNaN(v) ? '—'
        : (v * 100).toLocaleString(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %',
  sig: (v, d = 1) => v == null || isNaN(v) ? '—'
        : (v > 0 ? '+' : '') + (v * 100).toLocaleString(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %',
  d:   (v, d = 3) => v == null || isNaN(v) ? '—'
        : v.toLocaleString(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }),
  compact: v => v == null || isNaN(v) ? '—'
        : v >= 1000 ? (v / 1000).toLocaleString(LOC(), { maximumFractionDigits: v >= 10000 ? 0 : 1 }) + 'k'
                    : v.toLocaleString(LOC(), { maximumFractionDigits: 0 }),
};
const t = (k, v = {}) => {
  let s = (I18N[LANG] && I18N[LANG][k]) ?? (I18N.es[k] ?? k);
  for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(b);
  return s;
};
const tv = s => (LANG === 'en' && VAL.en[s]) ? VAL.en[s] : s;
const cls = v => v == null ? '' : (v >= 0 ? 'pos' : 'neg');
const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------- helpers de render */
const kpi = (lbl, val, sub, kls = '') =>
  `<div class="kpi"><div class="lbl">${lbl}</div>
   <div class="val ${kls}">${val}</div>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`;

/* `opts.cols` reparte el ancho con <colgroup>. Sin él, una tabla de frases se
   estira hasta el doble del contenedor y la última columna queda fuera de vista. */
const tabla = (cols, filas, opts = {}) =>
  `<div class="tw"><table${opts.cl ? ` class="${opts.cl}"` : ''}>${
    opts.cols ? `<colgroup>${cols.map((_, i) => `<col class="c${i + 1}">`).join('')}</colgroup>` : ''
  }<thead><tr>${
    cols.map((c, i) => `<th${i ? ' class="r"' : ''}>${c}</th>`).join('')
  }</tr></thead><tbody>${
    filas.map(f => `<tr${f.cl ? ` class="${f.cl}"` : ''}>${
      f.c.map((v, i) => `<td${i ? ' class="r"' : ''}>${v}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;

const callout = (tipo, titulo, cuerpo) =>
  `<div class="cal ${tipo}">${titulo ? `<b>${titulo}</b>` : ''}<div>${cuerpo}</div></div>`;

/* ═══════════════════════════════════════════ MÓDULO 1 · RESUMEN EJECUTIVO */
function vResumen() {
  const r = D.resumen;
  const filas = r.niveles.map(n => ({
    c: [tv(n.nivel), '~' + F.n(n.n_tipico), '<b>' + F.pct(n.err, 0) + '</b>']
  }));
  return `
  <h2>${t('r_titulo')}</h2>
  <p class="note">${t('r_nota')}</p>

  <div class="grid">
    ${kpi(t('r_total'), F.n(r.total), t('r_total_sub', { n: r.periodos }))}
    ${kpi(t('r_ventaja'), F.pct(r.ventaja, 0), t('r_ventaja_sub'), 'pos')}
    ${kpi(t('r_prelim'), F.pct(r.pct_prelim, 0), t('r_prelim_sub', { p: r.per_prelim.join(' · ') }))}
  </div>

  <h3>${t('r_sirve')}</h3>
  <p>${t('r_sirve_txt', { v: F.pct(r.ventaja, 0) })}</p>

  <h3>${t('r_confiar')}</h3>
  <p class="note">${t('r_confiar_txt')}</p>
  ${tabla([t('r_col_nivel'), t('r_col_tam'), t('r_col_err')], filas)}
  <p class="note">${t('r_confiar_pie')}</p>

  <h3>${t('r_saber')}</h3>
  ${callout('info', '1 · ' + t('r_a1_t', { n: r.periodos }),
      t('r_a1', { p: r.per_prelim.join(' ' + (LANG === 'en' ? 'and' : 'y') + ' '),
                  v: F.pct(r.pct_prelim, 0) }))}
  ${callout('info', '2 · ' + t('r_a2_t'), t('r_a2', { v: F.pct(r.exceso_p50, 0) }))}
  ${callout('warn', '3 · ' + t('r_a3_t', { v: F.pct(Math.abs(r.sesgo_sec), 0) }), t('r_a3'))}`;
}

/* ═══════════════════════════════════════════════ MÓDULO 2 · MÉTRICAS */
function vModelo() {
  const m = D.modelo;
  const met = [
    ['MAE', F.n(m.mae, 2), LANG === 'en' ? 'enrolments of error per combination' : 'inscritos de error por combinación'],
    ['RMSE', F.n(m.rmse, 2), LANG === 'en' ? 'penalises large errors' : 'penaliza los errores grandes'],
    ['WAPE', F.d(m.wape), LANG === 'en' ? 'Σ|error| / Σ actual — weighted by size, robust with zeros' : 'Σ|error| / Σ real — ponderado por tamaño, robusto con ceros'],
    ['sMAPE', F.d(m.smape), LANG === 'en' ? 'symmetric; unstable near zero' : 'simétrico; inestable cerca de cero'],
    ['MASE', F.d(m.mase), (m.mase < 1 ? '✅ ' : '⚠️ ') + (LANG === 'en'
        ? (m.mase < 1 ? '< 1: beats the naive' : '> 1: does NOT beat the naive')
        : (m.mase < 1 ? '< 1: le gana al naive' : '> 1: NO le gana al naive'))],
    [LANG === 'en' ? 'Bias' : 'Sesgo', F.sig(m.sesgo),
      (m.sesgo > 0 ? (LANG === 'en' ? 'over-forecasts' : 'sobre-proyecta')
                   : (LANG === 'en' ? 'under-forecasts' : 'sub-proyecta'))],
  ].map(x => ({ c: [`<b>${x[0]}</b>`, x[1], `<span class="mut">${x[2]}</span>`] }));

  const cob = [['P10', m.cob_p10, .10], ['P50', m.cob_p50, .50],
               ['P90', m.cob_p90, .90],
               [LANG === 'en' ? 'interval' : 'intervalo', m.cob_int, .80]]
    .map(x => ({ c: [x[0], F.pct(x[1]), F.pct(x[2], 0),
      `<span class="${Math.abs(x[1] - x[2]) <= .05 ? 'pos' : 'neg'}">${F.sig(x[1] - x[2])}</span>`] }));

  const tr = m.tramos.map(x => ({ c: [x.tramo, F.n(x.filas), F.pct(x.pct_vol),
    F.d(x.wape), `<span class="${cls(x.sesgo)}">${F.sig(x.sesgo)}</span>`, F.pct(x.en_banda)] }));

  const reglas = [
    [1, LANG === 'en' ? 'Beats the seasonal naive with margin' : 'Le gana al seasonal naive con holgura',
        true, `skill ${F.sig(m.ventaja)}`],
    [2, LANG === 'en' ? 'Temporal validation, never shuffle' : 'Validación temporal, jamás barajar',
        true, LANG === 'en' ? 'walk-forward, 7 origins' : 'walk-forward, 7 orígenes'],
    [3, LANG === 'en' ? 'Features known BEFORE the forecast' : 'Features conocidas ANTES del pronóstico',
        true, LANG === 'en' ? 'the notebook aborts if a banned one enters' : 'el notebook aborta si entra una prohibida'],
    [4, LANG === 'en' ? 'Forecast the interval, not just the point' : 'Se pronostica el intervalo, no solo el punto',
        true, `P10/P50/P90 + CQR · ${F.pct(m.cob_int)}`],
    [5, LANG === 'en' ? 'Validated at the real decision horizon' : 'Validado al horizonte REAL de la decisión',
        true, 'h1 · h2'],
    [6, LANG === 'en' ? 'Same protocol + degradation by horizon' : 'Mismo protocolo + degradación por horizonte',
        false, LANG === 'en' ? 'measured, but the h2 band stays under-widened'
                             : 'medida, pero la banda del h2 queda sub-ensanchada'],
  ].map(x => ({ c: [`${x[2] ? '✅' : '⚠️'} <b>${x[0]}</b>`, x[1],
    `<span class="mut">${x[3]}</span>`] }));

  return `
  <h2>${t('m_titulo')}</h2>
  <p class="note">${t('m_nota', { n: m.periodos })}</p>

  <h3>${t('m_vara')}</h3>
  <p class="note">${t('m_vara_nota')}</p>
  <div class="grid">
    ${kpi('WAPE ' + (LANG === 'en' ? 'naive' : 'del naive'), F.d(m.wape_naive),
          LANG === 'en' ? 'the bar to beat' : 'la vara a batir')}
    ${kpi('WAPE ' + (LANG === 'en' ? 'model' : 'del modelo'), F.d(m.wape),
          'skill ' + F.sig(m.ventaja), 'pos')}
    ${kpi(LANG === 'en' ? 'Naive coverage' : 'Cobertura del naive', F.pct(m.cob_naive),
          F.n(m.filas) + (LANG === 'en' ? ' rows' : ' filas'))}
  </div>

  <h3>${t('m_punt')}</h3>
  ${tabla([t('m_metrica'), t('m_valor'), t('m_lect')], met)}

  <h3>${t('m_banda')}</h3>
  <p class="note">${t('m_banda_nota')}</p>
  ${tabla([t('m_cuantil'), t('m_real'), t('m_teor'), t('m_desv')], cob)}

  <h3>${t('m_donde')}</h3>
  <p class="note">${t('m_donde_nota')}</p>
  ${tabla([t('m_tramo'), t('m_filas'), t('m_vol'), 'WAPE', t('m_sesgo'), t('m_enbanda')], tr)}

  <h3>${t('m_reglas')}</h3>
  <p class="note">${t('m_reglas_nota')}</p>
  ${tabla(['#', LANG === 'en' ? 'Rule' : 'Regla', LANG === 'en' ? 'Evidence' : 'Evidencia'], reglas, { cl: 'lft' })}

  ${callout('exec', null, t('m_lectura', { w: F.pct(m.wape, 0), s: F.pct(Math.abs(m.sesgo), 0) }))}`;
}

/* ═══════════════════════════════════════════════ MÓDULO 4 · CASCADA */
function vCascada() {
  const filas = D.cascada.map(c => ({
    c: ['&nbsp;'.repeat(c.prof * 3) + (c.prof ? '└ ' : '') + tv(c.nivel),
        F.n(c.celdas), F.n(c.n_tipico), F.d(c.wape),
        `<span class="${cls(c.skill)}">${F.sig(c.skill)}</span>`,
        F.pct(c.err_p50), F.pct(c.err_p90),
        `<span class="mut">${F.sig(c.lo, 0)} … ${F.sig(c.hi, 0)}</span>`] }));
  return `
  <h2>${t('c_titulo')}</h2>
  <p class="note">${t('c_nota')}</p>
  ${tabla([t('c_col_nivel'), t('c_col_celdas'), t('c_col_n'), 'WAPE',
           t('c_col_skill'), t('c_col_err'), t('c_col_err90'), t('c_col_rango')],
          filas, { cl: 'lft' })}
  ${callout('info', null, t('c_leer'))}
  ${callout('info', null, t('c_hermanas'))}
  ${callout('warn', null, t('c_arranca'))}`;
}

/* ═══════════════════════════════════════════════ MÓDULO 5 · SECCIONES */
function vSecciones() {
  const s = D.secciones, v = s.vara;
  const crit = s.criterios.map(c => ({
    c: [tv(c.criterio), F.n(c.suma), `<span class="${cls(c.sesgo)}">${F.sig(c.sesgo)}</span>`,
        F.d(c.wape), `<span class="${cls(c.skill)}">${F.sig(c.skill)}</span>`,
        F.pct(c.exacta), F.pct(c.mas_menos_1)] }));

  const cn = s.criterios.map(c => c.criterio);
  const mcols = [t('c_col_nivel'), ...s.matriz.map(m => tv(m.nivel))];
  const mfilas = cn.map(c => ({
    c: [tv(c), ...s.matriz.map(m => {
      const x = m.crit[c];
      return `<span class="${cls(x.skill)}">${F.sig(x.skill, 0)}</span>`;
    })] }));

  const tr = s.tramos.map(x => ({
    c: [x.tramo, F.n(x.filas), F.pct(x.pct_sec), F.d(x.wape),
        `<span class="${cls(x.sesgo)}">${F.sig(x.sesgo)}</span>`,
        `<span class="${cls(x.sesgo_vara)}">${F.sig(x.sesgo_vara)}</span>`,
        F.pct(x.exacta)] }));

  // reparto del error: la diferencia entre el operativo y la vara es lo que aporta el modelo
  const op = s.criterios[0];
  const rep = (op.wape - v.wape) / op.wape;

  return `
  <h2>${t('s_titulo')}</h2>
  <p class="note">${t('s_nota')}</p>
  ${callout('info', null, t('s_cadena'))}

  <h3>${t('s_vara')}</h3>
  <p class="note">${t('s_vara_nota')}</p>
  <div class="grid">
    ${kpi(LANG === 'en' ? 'Actual sections' : 'Secciones reales', F.n(s.reales), '')}
    ${kpi(LANG === 'en' ? 'Norm with real enrolments' : 'Norma con inscritos reales',
          F.n(v.suma), F.sig(v.sesgo), 'neg')}
    ${kpi(LANG === 'en' ? 'Exact hit' : 'Acierta exacto', F.pct(v.exacta), '')}
  </div>
  ${callout('danger', null, t('s_techo', { v: F.sig(v.sesgo) }))}

  <h3>${t('s_crit')}</h3>
  ${tabla([t('s_col_crit'), t('s_col_suma'), t('s_col_vs'), 'WAPE',
           t('c_col_skill'), t('s_col_exacta'), t('s_col_pm1')], crit, { cl: 'lft' })}

  <h3>${t('s_matriz')}</h3>
  <p class="note">${t('s_matriz_nota')}</p>
  ${tabla(mcols, mfilas, { cl: 'lft' })}

  <h3>${t('s_tramos')}</h3>
  <p class="note">${t('s_tramos_nota')}</p>
  ${tabla([t('s_col_sec'), t('m_filas'), t('m_vol'), 'WAPE', t('m_sesgo'),
           t('s_col_svara'), t('s_col_exacta')], tr)}

  ${callout('exec', null, t('s_reparto', { m: F.pct(rep, 0), e: F.pct(1 - rep, 0) }))}`;
}

/* ═══════════════════════════════════════════════ MÓDULO 6 · ESTÁNDARES */
function vEstandares() {
  const e = D.estandares;
  const donde = c => {
    if (c.norma == null) return '—';
    if (c.norma > c.p90) return `<span class="neg">⚠️ ${t('e_sobre')}</span>`;
    if (c.norma < c.p25) return `<span class="neg">⚠️ ${t('e_bajo')}</span>`;
    return `<span class="pos">${t('e_entre')}</span>`;
  };
  const filas = e.componentes.map(c => ({
    c: [`<b>${c.comp}</b>`, F.n(c.secciones), F.n(c.norma),
        F.n(c.p25), F.n(c.p50), F.n(c.p75), F.n(c.p90),
        F.n(c.ocup, 1), F.d(c.abanico, 1) + '×', donde(c)] }));
  const barras = e.componentes.map(c => ({
    k: c.comp, v: c.abanico,
    color: c.norma > c.p90 ? 'var(--bad)' : 'var(--pred)' }));
  return `
  <h2>${t('e_titulo')}</h2>
  <p class="note">${t('e_nota')} · ${e.ventana[0]}–${e.ventana[1]}</p>
  ${tabla([t('e_col_comp'), t('s_col_sec'), t('e_col_norma'), 'p25', 'p50', 'p75', 'p90',
           t('e_col_ocup'), t('e_col_ab'), t('e_col_donde')], filas, { cl: 'lft' })}
  ${callout('info', null, t('e_leer'))}
  <h3>${t('e_col_ab')}</h3>
  <p class="note">${t('e_abanico')}</p>
  ${hBars(barras, { fv: v => F.d(v, 1) + '×', l: 70 })}
  ${callout('exec', null, t('e_hallazgo'))}`;
}

/* ═══════════════════════════════════════════════ MÓDULO 7 · EXPLORADOR */
async function vExplorador() {
  if (!CELDAS) {
    document.getElementById('app').innerHTML =
      `<div class="loading">${t('g_cargando')}</div>`;
    CELDAS = await (await fetch('data/celdas.json')).json();
  }
  return renderExplorador();
}

function filasExplorador() {
  const C = CELDAS, n = C.PERIODO.length, out = [];
  const q = FX.q.trim().toLowerCase();
  for (let i = 0; i < n; i++) {
    if (FX.periodo && String(C.PERIODO[i]) !== FX.periodo) continue;
    if (FX.campus && C.CAMPUS[i] !== FX.campus) continue;
    if (FX.comp && C.COMPONENTE[i] !== FX.comp) continue;
    if (q && !(String(C.CODIGO_PROGRAMABLE[i]).toLowerCase().includes(q) ||
               String(C.ASIGNATURA_REGLA[i]).toLowerCase().includes(q))) continue;
    out.push(i);
  }
  return out;
}

function renderExplorador() {
  const C = CELDAS;
  const idx = filasExplorador();
  const tot = C.PERIODO.length;
  const pag = Math.min(FX.pag, Math.max(0, Math.ceil(idx.length / PAGE) - 1));
  FX.pag = pag;
  const vis = idx.slice(pag * PAGE, pag * PAGE + PAGE);

  const uniq = k => [...new Set(C[k])].sort();
  const sel = (id, val, opts, lbl) =>
    `<label class="fl">${lbl}<select id="${id}">
      <option value="">${t('x_todos')}</option>
      ${opts.map(o => `<option value="${esc(o)}"${String(o) === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}
     </select></label>`;

  const filas = vis.map(i => ({
    cl: C.horizonte[i] === 2 ? 'fut' : '',
    c: [`<b>${esc(C.CODIGO_PROGRAMABLE[i])}</b>`,
        `<span class="mut">${esc(C.ASIGNATURA_REGLA[i])}</span>`,
        C.PERIODO[i], esc(C.COMPONENTE[i]), esc(C.CAMPUS[i]),
        `<span class="mut">${F.n(C.P10[i])} – ${F.n(C.P90[i])}</span>`,
        `<b>${F.n(C.P50[i])}</b>`, F.n(C.P50_ESPERADO[i]),
        F.pct(C.PROB_SE_DICTA[i], 0),
        F.n(C.N_SECCIONES_TEORICAS_PROYECTADAS[i]),
        `<span class="mut">${t('g_' + (C.confiabilidad[i] || 'media'))}</span>`] }));

  const nav = idx.length > PAGE
    ? `<div class="pag">
        <button id="pv"${pag === 0 ? ' disabled' : ''}>←</button>
        <span>${pag + 1} / ${Math.ceil(idx.length / PAGE)}</span>
        <button id="nx"${(pag + 1) * PAGE >= idx.length ? ' disabled' : ''}>→</button>
       </div>` : '';

  return `
  <h2>${t('x_titulo', { n: F.n(tot) })}</h2>
  <p class="note">${t('x_nota')}</p>
  ${callout('info', null, t('x_p50_nota'))}
  <div class="filtros">
    <label class="fl">${t('x_buscar')}
      <input id="q" type="search" value="${esc(FX.q)}" placeholder="${t('x_buscar')}"></label>
    ${sel('fp', FX.periodo, uniq('PERIODO'), t('x_periodo'))}
    ${sel('fc', FX.campus, uniq('CAMPUS'), t('x_campus'))}
    ${sel('fk', FX.comp, uniq('COMPONENTE'), t('x_comp'))}
  </div>
  <p class="note">${t('x_mostrando', { n: F.n(idx.length), t: F.n(tot) })}</p>
  ${idx.length ? tabla([t('x_col_cod'), t('x_col_asig'), t('x_periodo'), t('x_comp'),
      t('x_campus'), t('x_col_banda'), t('x_col_p50'), t('x_col_esp'), t('x_col_prob'),
      t('x_col_sec'), t('x_col_conf')], filas, { cl: 'lft' })
    : `<p class="note">${t('x_nada')}</p>`}
  ${nav}`;
}

function bindExplorador() {
  const on = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
  const re = () => { document.getElementById('app').innerHTML = renderExplorador(); bindExplorador(); };
  let tmr;
  on('q', 'input', e => { clearTimeout(tmr); const v = e.target.value;
    tmr = setTimeout(() => { FX.q = v; FX.pag = 0; re();
      const q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(v.length, v.length); } }, 220); });
  on('fp', 'change', e => { FX.periodo = e.target.value; FX.pag = 0; re(); });
  on('fc', 'change', e => { FX.campus = e.target.value; FX.pag = 0; re(); });
  on('fk', 'change', e => { FX.comp = e.target.value; FX.pag = 0; re(); });
  on('pv', 'click', () => { FX.pag--; re(); window.scrollTo(0, 0); });
  on('nx', 'click', () => { FX.pag++; re(); window.scrollTo(0, 0); });
}

/* ═══════════════════════════════════ MÓDULO 7b · ESCENARIOS (gráfico + tabla)
   Es la celda «SECCIONES POR PERÍODO» del notebook, con sus filtros dinámicos, y
   debajo la misma cifra en tabla — la celda «EL MISMO GRÁFICO, EN TABLA».

   Las dos vistas comparten `agregaSerie()`, así que no pueden discrepar: si el
   gráfico y la tabla mostraran números distintos sería un bug, no una opción. */

const SERIES_BASE = [
  { k: 'reales',               lbl: 'Reales',      color: 'var(--real)',  w: 2.4 },
  { k: 'teoricas',             lbl: 'Norma·real',  color: 'var(--naive)', w: 1.8, dash: '4 3' },
  { k: 'teoricas_proyectadas', lbl: '⭐ Norma·P50', color: 'var(--pred)',  w: 2.4 },
];
/* ⚠️ Paleta CATEGÓRICA (--k*), no la rampa secuencial (--l*). p25/p50/p75/p90 son
   series distintas que se leen a la vez, así que necesitan separación por TONO. Con
   la rampa —pensada para niveles ordenados— salían cuatro verdes-amarillos casi
   indistinguibles en la leyenda. */
const ESCEN = [
  { k: 'promedio', lbl: 'Ocupación', color: 'var(--k6)' },   // teal
  { k: 'p25', lbl: 'p25', color: 'var(--k4)' },              // púrpura
  { k: 'p50', lbl: 'p50', color: 'var(--k3)' },              // verde
  { k: 'p75', lbl: 'p75', color: 'var(--k1)' },              // azul
  { k: 'p90', lbl: 'p90', color: 'var(--k7)' },              // magenta
];

/** Suma la serie por período aplicando los filtros activos.
 *  Un Set vacío significa «todos»: es más cómodo que marcar los 8 campus. */
/* Regímenes de período. Sin este filtro el gráfico es ilegible: los semestres
   (TT 10/20) mueven ~14.000 secciones y los trimestres (05/15/25) ~2.000, así que
   la línea zigzaguea entre dos órdenes de magnitud y no se ve ninguna tendencia.
   Son dos calendarios distintos, y se miran por separado. */
const REGIMEN = {
  todos:   { lbl: 'Todos',       tt: null },
  regular: { lbl: 'TT 10/20',    tt: [10, 20] },
  advance: { lbl: 'TT 05/15/25', tt: [5, 15, 25] },
};

function agregaSerie() {
  const S = SERIE, n = S.periodo.length;
  const claves = SERIES_BASE.map(s => s.k).concat(ESCEN.map(e => e.k));
  const tt = REGIMEN[FS.reg || 'todos'].tt;
  const acc = new Map();
  let filas = 0;
  for (let i = 0; i < n; i++) {
    if (tt && !tt.includes(S.periodo[i] % 100)) continue;
    if (FS.campus.size && !FS.campus.has(S.campus[i])) continue;
    if (FS.comp.size && !FS.comp.has(S.comp[i])) continue;
    filas++;
    const p = S.periodo[i];
    if (!acc.has(p)) acc.set(p, Object.fromEntries(claves.map(k => [k, null])));
    const o = acc.get(p);
    for (const k of claves) {
      const v = S[k][i];
      if (v != null) o[k] = (o[k] || 0) + v;
    }
  }
  return { per: [...acc.keys()].sort((a, b) => a - b), acc, filas };
}

async function vEscenarios() {
  if (!SERIE) {
    document.getElementById('app').innerHTML = `<div class="loading">${t('g_cargando')}</div>`;
    SERIE = await (await fetch('data/serie.json')).json();
  }
  return renderEscenarios();
}

function renderEscenarios() {
  const { per, acc, filas } = agregaSerie();
  const act = [...SERIES_BASE, ...ESCEN.filter(e => FS.esc.has(e.k))];

  /* ⚠️ EJE CATEGÓRICO. El período es un CÓDIGO (202210, 202220, 202310…), no una
     magnitud: entre 202220 y 202310 hay 90 unidades y entre 202210 y 202220 sólo
     10, así que usarlo como coordenada deforma el eje y amontona las etiquetas.
     Se grafica contra el ÍNDICE y `fx` recupera la etiqueta — que es lo que hace
     plotly en el notebook. */
  const ix = new Map(per.map((p, i) => [p, i]));
  const series = act.map(s => ({
    color: s.color, w: s.w || 1.6, dash: s.dash || '', name: tv(s.lbl),
    pts: per.filter(p => acc.get(p)[s.k] != null).map(p => [ix.get(p), acc.get(p)[s.k]]),
  })).filter(s => s.pts.length);

  const chips = (arr, set, campo) => arr.map(v =>
    `<button class="chip sel" data-f="${campo}" data-v="${esc(v)}"
      aria-pressed="${set.has(v)}">${esc(v)}</button>`).join('');

  // % contra las reales: es la lectura que el notebook pone bajo cada cifra
  const vs = (v, r) => (v == null || r == null || !r) ? ''
    : `<div class="vs ${Math.abs(v / r - 1) > .25 ? 'neg' : (Math.abs(v / r - 1) > .1 ? 'amb' : 'pos')}">${F.sig(v / r - 1, 1)}</div>`;

  const cols = [t('x_periodo'), ...act.map(s => tv(s.lbl))];
  const tfilas = per.map(p => {
    const o = acc.get(p), r = o.reales;
    return {
      cl: p > SERIE.ultimo_real ? 'fut' : '',
      c: [`<b>${p}</b>${p > SERIE.ultimo_real ? ' <span class="mut">·proy</span>' : ''}`,
          ...act.map(s => o[s.k] == null ? '—'
            : F.n(o[s.k]) + (s.k === 'reales' ? '' : vs(o[s.k], r)))],
    };
  });

  return `
  <h2>${t('n_titulo')}</h2>
  <p class="note">${t('n_nota')}</p>

  <div class="filtros">
    <div class="fgrp"><span class="flbl">${t('n_regimen')}</span>
      <div class="chips">${Object.entries(REGIMEN).map(([k, r]) =>
        `<button class="chip reg" data-r="${k}"
          aria-pressed="${(FS.reg || 'todos') === k}">${r.lbl}</button>`).join('')}</div></div>
    <div class="fgrp"><span class="flbl">${t('x_campus')}</span>
      <div class="chips">${chips(D.meta.campus, FS.campus, 'campus')}</div></div>
    <div class="fgrp"><span class="flbl">${t('x_comp')}</span>
      <div class="chips">${chips(D.meta.componentes, FS.comp, 'comp')}</div></div>
    <div class="fgrp"><span class="flbl">${t('n_escenarios')}</span>
      <div class="chips">${ESCEN.map(e =>
        `<button class="chip sel" data-f="esc" data-v="${e.k}"
          aria-pressed="${FS.esc.has(e.k)}">${e.lbl}</button>`).join('')}</div></div>
    <button id="fclr" class="chip">${t('n_limpiar')}</button>
  </div>
  <p class="note">${t('n_filas', { n: F.n(filas), p: per.length })}</p>

  ${legend(act.map(s => ({ name: tv(s.lbl), color: s.color })))}
  <div class="controls">
    <span class="flbl">${t('n_escala')}</span>
    <div class="seg" id="esc-escala">
      <button data-e="lineal" aria-pressed="${FS.escala !== 'log'}">${t('n_lineal')}</button>
      <button data-e="log"    aria-pressed="${FS.escala === 'log'}">${t('n_log')}</button>
    </div>
  </div>
  ${series.length ? lineChart(series, { w: 900, h: 330, y0: 0, anchoEtq: 52,
      log: FS.escala === 'log', hover: true,
      fy: v => F.compact(v), fx: i => per[i] ?? '' })
                  : `<p class="note">${t('x_nada')}</p>`}
  ${callout('info', null, t('n_leer'))}

  <h3>${t('n_tabla')}</h3>
  <p class="note">${t('n_tabla_nota')}</p>
  ${tfilas.length ? tabla(cols, tfilas) : ''}`;
}

function bindEscenarios() {
  const rehacer = () => {
    document.getElementById('app').innerHTML = renderEscenarios();
    bindEscenarios();
  };

  // toggle de escala
  document.querySelectorAll('#esc-escala button').forEach(b =>
    b.addEventListener('click', () => { FS.escala = b.dataset.e; rehacer(); }));

  /* HOVER UNIFICADO. Las bandas las dibuja lineChart; aquí se les cuelga el
     comportamiento, porque el tooltip necesita los datos y las etiquetas, que
     charts.js no conoce. Se recalcula la agregación una vez y se cierra sobre
     ella: recalcular en cada mousemove sería recorrer 956 filas por píxel. */
  const svg = document.querySelector('#app svg');
  if (svg) {
    const { per, acc } = agregaSerie();
    const act = [...SERIES_BASE, ...ESCEN.filter(e => FS.esc.has(e.k))];
    const regla = svg.querySelector('.hrule');
    svg.querySelectorAll('.hb').forEach(b => {
      const i = +b.dataset.x, p = per[i];
      const mostrar = ev => {
        const o = acc.get(p) || {};
        const filas = act.filter(s => o[s.k] != null).map(s =>
          `<div class="tr"><i style="background:${s.color}"></i>${esc(tv(s.lbl))}
           <b>${F.n(o[s.k])}</b></div>`).join('');
        tipShow(`<div class="tt"><div class="th">${p}</div>${filas ||
          `<div class="tr">${t('x_nada')}</div>`}</div>`, ev.clientX, ev.clientY);
        if (regla) {                       // la guía vertical, como en el notebook
          const x = +b.getAttribute('x') + (+b.getAttribute('width')) / 2;
          regla.setAttribute('x1', x); regla.setAttribute('x2', x);
          regla.setAttribute('opacity', '.55');
        }
      };
      b.addEventListener('mouseenter', mostrar);
      b.addEventListener('mousemove', mostrar);
      b.addEventListener('mouseleave', () => {
        tipHide(); if (regla) regla.setAttribute('opacity', '0');
      });
    });
  }

  document.querySelectorAll('#app .chip.sel').forEach(b =>
    b.addEventListener('click', () => {
      const set = FS[b.dataset.f];
      const v = b.dataset.v;
      set.has(v) ? set.delete(v) : set.add(v);
      document.getElementById('app').innerHTML = renderEscenarios();
      bindEscenarios();
    }));
  document.querySelectorAll('#app .chip.reg').forEach(b =>
    b.addEventListener('click', () => {
      FS.reg = b.dataset.r;
      document.getElementById('app').innerHTML = renderEscenarios();
      bindEscenarios();
    }));
  const c = document.getElementById('fclr');
  if (c) c.addEventListener('click', () => {
    FS.campus.clear(); FS.comp.clear(); FS.esc.clear(); FS.reg = 'regular';
    FS.escala = 'lineal';
    document.getElementById('app').innerHTML = renderEscenarios();
    bindEscenarios();
  });
}

/* ═══════════════════════════════════════════════ MÓDULO 8 · DESCARGAS
   El CSV se arma en el navegador desde los datos ya cargados: no hay endpoint que
   llamar ni archivo que mantener sincronizado. Respeta los filtros activos del
   explorador, así que lo que se baja es exactamente lo que se está viendo. */

/* ⚠️ Excel abre el CSV con la convención regional del SISTEMA, no con la del que
   lo generó. En es-CL el separador de listas es ';' y el decimal ',': con ',' de
   separador, Excel mete toda la fila en una celda. Por eso ';' y coma decimal. */
function aCSV(cols, filas) {
  const cel = v => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(';'), ...filas.map(f => f.map(cel).join(';'))].join('\r\n');
}

function bajar(nombre, texto, mime = 'text/csv;charset=utf-8') {
  // BOM: sin él Excel lee los acentos como mojibake (Proyección -> ProyecciÃ³n)
  const blob = new Blob(['﻿' + texto], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function vDescargas() {
  if (!CELDAS) {
    document.getElementById('app').innerHTML = `<div class="loading">${t('g_cargando')}</div>`;
    CELDAS = await (await fetch('data/celdas.json')).json();
  }
  const n = CELDAS.PERIODO.length;
  const filtradas = filasExplorador().length;
  const hayFiltro = filtradas !== n;
  return `
  <h2>${t('dl_titulo')}</h2>
  <p class="note">${t('dl_nota')}</p>

  <div class="grid">
    <div class="kpi"><div class="lbl">${t('dl_celdas')}</div>
      <div class="val">${F.n(n)}</div>
      <div class="sub2">${t('dl_celdas_sub', { n: F.n(n) })}</div>
      <button class="dlb" id="dl-todo">${t('dl_bajar')} CSV</button></div>

    <div class="kpi"><div class="lbl">${t('dl_filtrado')}</div>
      <div class="val ${hayFiltro ? 'pos' : ''}">${F.n(filtradas)}</div>
      <div class="sub2">${hayFiltro ? t('dl_filtrado_si') : t('dl_filtrado_no')}</div>
      <button class="dlb" id="dl-filtro"${hayFiltro ? '' : ' disabled'}>${t('dl_bajar')} CSV</button></div>

    <div class="kpi"><div class="lbl">${t('dl_metricas')}</div>
      <div class="val">JSON</div>
      <div class="sub2">${t('dl_metricas_sub')}</div>
      <button class="dlb" id="dl-json">${t('dl_bajar')} JSON</button></div>
  </div>

  ${callout('info', null, t('dl_excel'))}
  ${callout('warn', t('dl_uso_t'), t('dl_uso'))}`;
}

function bindDescargas() {
  const cols = Object.keys(CELDAS);
  const armar = idx => idx.map(i => cols.map(c => CELDAS[c][i]));
  const hoy = (D.meta.generado || '').slice(0, 10).replace(/-/g, '');
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };

  on('dl-todo', () => bajar(`proyeccion_asignaturas_${hoy}.csv`,
    aCSV(cols, armar([...CELDAS.PERIODO.keys()]))));
  on('dl-filtro', () => bajar(`proyeccion_asignaturas_filtrado_${hoy}.csv`,
    aCSV(cols, armar(filasExplorador()))));
  on('dl-json', () => bajar(`metricas_proyeccion_${hoy}.json`,
    JSON.stringify(D, null, 2), 'application/json;charset=utf-8'));
}

/* ═══════════════════════════════════════════════ MÓDULO 9 · METODOLOGÍA */
function vMetodo() {
  const li = k => `<li>${t(k)}</li>`;
  const m = D.modelo, c = D.cascada;
  const niv = k => c.find(x => x.nivel === k) || {};
  const per = niv('Período'), cam = niv('… × Campus');
  const cmp = niv('… × Componente'), gr = c[c.length - 1];

  /* Cada métrica con la PREGUNTA que responde, no solo su definición. Sin esto la
     tabla es un glosario; con esto, alguien que no sabe qué es un WAPE puede
     decidir. El valor de hoy va al lado para no tener que buscarlo en otra pestaña. */
  const met = [
    ['WAPE', 'q_wape', 'l_wape',
      `${F.pct(gr.wape, 1)} ${LANG === 'en' ? 'at the model grain' : 'al grano del modelo'} · ${F.pct(per.wape, 1)} ${LANG === 'en' ? 'per term' : 'por período'}`],
    ['Skill', 'q_skill', 'l_skill',
      `<b class="pos">${F.sig(m.ventaja)}</b>`],
    [LANG === 'en' ? 'Bias' : 'Sesgo', 'q_sesgo', 'l_sesgo', F.sig(m.sesgo)],
    ['MASE', 'q_mase', 'l_mase',
      `${F.d(m.mase)} ${m.mase < 1 ? '✅' : '⚠️'}`],
    [LANG === 'en' ? 'P10–P90 band' : 'Banda P10–P90', 'q_banda', 'l_banda',
      `${F.pct(m.cob_int)} ${LANG === 'en' ? 'vs 80 % nominal' : 'contra el 80 % nominal'}`],
    ['R²', 'q_r2', 'l_r2',
      `${F.d(m.r2, 3)} ${LANG === 'en' ? 'vs' : 'contra'} ${F.d(m.r2_naive, 3)} ${LANG === 'en' ? 'of the naive' : 'del naive'} — ${LANG === 'en' ? 'it only adds' : 'sólo añade'} ${F.d(m.r2 - m.r2_naive, 3)}`],
    // 'cómo se lee' NO va atenuado: es la instrucción de uso, no una nota al pie
  ].map(x => ({ c: [x[0], t(x[1]), t(x[2]), x[3]] }));

  return `
  <h2>${t('d_leer')}</h2>
  <p class="note">${t('d_leer_nota')}</p>
  ${tabla([t('m_metrica'), t('d_col_preg'), t('m_lect'), t('d_col_hoy')], met,
          { cl: 'txt', cols: true })}
  ${callout('warn', t('d_regla_t'), t('d_regla'))}

  <h3>${t('d_decidir')}</h3>
  <ul>
    <li>${t('d_dec1', { v: F.pct(per.err_p50, 0) })}</li>
    <li>${t('d_dec2', { v: F.pct(cam.err_p50, 0) })}</li>
    <li>${t('d_dec3', { v: F.pct(cmp.err_p50, 0) })}</li>
    <li>${t('d_dec4', { v: F.pct(gr.err_p50, 0) })}</li>
  </ul>

  <h2>${t('d_titulo')}</h2>

  <h3>${t('d_pipeline')}</h3>
  <p>${t('d_pipeline_txt')}</p>
  <pre class="ascii">${esc(t('d_ascii_pipe'))}</pre>

  <h3>${t('d_modelo')}</h3>
  <p>${t('d_modelo_txt')}</p>
  ${callout('info', t('d_familia_t'), t('d_familia'))}
  <pre class="ascii">${esc(t('d_ascii_ml'))}</pre>
  <p class="note">${t('d_capas_nota')}</p>
  <div class="capas">
    ${[1,2,3,4,5].map(i =>
      `<div class="capa"><span class="cn">${i}</span>
        <div><b>${t('d_capa'+i+'_t')}</b><div class="mut">${t('d_capa'+i)}</div></div></div>`).join('')}
  </div>
  ${callout('warn', t('d_porque_t'), t('d_porque'))}

  <h3>${t('d_limites')}</h3>
  <ul>${li('d_lim1')}${li('d_lim2')}${li('d_lim3')}${li('d_lim4')}</ul>
  ${callout('danger', t('d_nototal_t'), t('d_nototal'))}

  <h3>${t('d_fuente')}</h3>
  <p class="note">${t('d_fuente_txt')}</p>
  <ul>${['f1', 'f2', 'f3', 'f4', 'f5'].map(k => li('d_' + k)).join('')}</ul>
  <p class="note">${t('d_docs')}</p>
  <ul>${['g1', 'g2', 'g3', 'g4', 'g5'].map(k => li('d_' + k)).join('')}</ul>`;
}

/* ═══════════════════════════════════════════════════════════════ router  */
const TABS = [
  ['resumen', vResumen], ['modelo', vModelo],
  ['cascada', vCascada], ['secciones', vSecciones], ['escenarios', vEscenarios],
  ['estandares', vEstandares], ['explorador', vExplorador],
  ['descargas', vDescargas], ['metodo', vMetodo],
];

async function render() {
  const app = document.getElementById('app');
  const f = (TABS.find(x => x[0] === TAB) || TABS[0])[1];
  const html = await f();
  app.innerHTML = html;
  if (TAB === 'explorador') bindExplorador();
  if (TAB === 'escenarios') bindEscenarios();
  if (TAB === 'descargas') bindDescargas();
}

function pintarTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(([k]) =>
    `<button data-t="${k}" aria-selected="${k === TAB}">${t('tab_' + k)}</button>`).join('');
  document.querySelectorAll('#tabs button').forEach(b =>
    b.addEventListener('click', () => {
      TAB = b.dataset.t;
      location.hash = TAB;
      pintarTabs(); render();
    }));
}

function marcarTema() {
  const tm = document.documentElement.dataset.tema || 'claro';
  document.querySelectorAll('#tema button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.tm === tm)));
}

function pintarCabecera() {
  document.getElementById('h1').innerHTML =
    `<span class="nom">${esc(t('h1'))}</span>`
    + `<span class="lema">${esc(t('h1_lema'))}</span>`;
  document.getElementById('intro').textContent = t('intro');
  document.title = `${t('h1')} · ${t('h1_lema')}`;
  document.documentElement.lang = LANG;
  const m = D.meta;
  // el ámbito sale del <h1> al pasar a llamarse Euribia: va aquí para no perderlo
  document.getElementById('meta').innerHTML = [
    t('h1sub'),
    t('chip_filas', { n: F.n(m.filas_proy) }),
    t('chip_periodos', { n: m.periodos_proy.length }),
    t('chip_hist', { n: m.periodos_hist.length }),
  ].map(s => `<span class="chip">${s}</span>`).join('');
  document.getElementById('foot1').textContent = t('foot1');
  document.getElementById('foot2').textContent =
    t('foot2', { filas: F.n(m.filas_proy), fecha: m.generado });
  document.querySelectorAll('.lang button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.l === LANG)));
}

async function init() {
  try {
    D = await (await fetch('data/dashboard.json')).json();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="loading">${t('g_error')}</div>`;
    return;
  }
  const h = location.hash.replace('#', '');
  if (TABS.some(x => x[0] === h)) TAB = h;
  document.querySelectorAll('.lang button').forEach(b =>
    b.addEventListener('click', () => {
      LANG = b.dataset.l; localStorage.setItem('lang', LANG);
      pintarCabecera(); pintarTabs(); render();
    }));
  /* El tema sólo toca el atributo del <html>: el CSS hace el resto. Se guarda para
     que la elección sobreviva a la recarga, y el script del <head> la relee antes
     de pintar. Si localStorage está bloqueado, el toggle sigue funcionando en la
     sesión — sólo no se recuerda. */
  document.querySelectorAll('#tema button').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.tm === document.documentElement.dataset.tema) return;
      document.documentElement.dataset.tema = b.dataset.tm;
      try { localStorage.setItem('tema', b.dataset.tm); } catch (e) {}
      marcarTema();
      render();          // los SVG leen los tokens al construirse, hay que rehacerlos
    }));
  marcarTema();
  pintarCabecera(); pintarTabs(); render();
}

init();

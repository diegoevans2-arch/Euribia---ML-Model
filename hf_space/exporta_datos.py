# -*- coding: utf-8 -*-
"""
Genera los JSON que consume el Space estático, con las MISMAS fórmulas que las
celdas de `Análisis_despliegue_modelo.ipynb`.

    python exporta_datos.py

Salidas en data/:
    dashboard.json   agregados de todos los módulos          (~60 KB)
    celdas.json      las 22.142 filas del entregable, en columnas
    serie.json       la serie por período para los gráficos

⚠️ FORMATO COLUMNAR, no una lista de objetos. `[{a:1,b:2},{a:3,b:4}]` repite el
   nombre de cada campo en cada fila: con 22 mil filas eso son megas de nombres.
   `{a:[1,3], b:[2,4]}` los escribe una vez. Reduce ~4x, y el navegador lo
   reconstruye en un bucle trivial.
"""
import io
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

AQUI = Path(__file__).resolve().parent
DATA = AQUI / 'data'
CARPETA = 'data/raw'
LEER = dict(sep=';', decimal=',', encoding='utf-8-sig', low_memory=False)
DIMS = ['PERIODO', 'MATERIA', 'CURSO', 'COMPONENTE', 'CAMPUS']

# ── Constantes que vienen del notebook de ML (no se recalculan aquí) ────────
BT_H2 = {'wape_h1': 0.414, 'wape_h2': 0.482, 'degradacion': 0.165,
         'sesgo_h1': -0.076, 'sesgo_h2': -0.155, 'factor': 1.165,
         'pares': [('202320→202420', 2955, .428, .480),
                   ('202420→202520', 2612, .406, .476),
                   ('202310→202410', 3123, .421, .474),
                   ('202410→202510', 2700, .401, .497)]}


def wape(y, f):
    y, f = np.asarray(y, float), np.asarray(f, float)
    s = np.abs(y).sum()
    return float(np.abs(f - y).sum() / s) if s else None


def _r2(y, f):
    """1 − SS_res/SS_tot. Puede salir negativo: eso significa que el modelo es peor
    que predecir siempre la media, no que la métrica esté mal calculada."""
    y, f = np.asarray(y, float), np.asarray(f, float)
    sst = ((y - y.mean()) ** 2).sum()
    return float(1 - ((y - f) ** 2).sum() / sst) if sst else None


def n(x):
    """float JSON-safe: NaN/inf -> None, y redondeo para no inflar el archivo."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(x) else round(x, 6)


print('Cargando entregables…')
proy = pd.read_csv(f'{CARPETA}/PROYECCION_INSCRITOS_2026_2027.csv', **LEER)
serie = pd.read_csv(f'{CARPETA}/SERIE_COMPLETA_REAL_VS_PROYECTADO.csv', **LEER)
hist = serie[serie['TIPO'] == 'REAL'].copy()
lag = pd.read_parquet(f'{CARPETA}/DEMANDA_PROCESADA.parquet',
                      columns=DIMS + ['ins_lag_1y'])
print(f'  proy {len(proy):,} × {proy.shape[1]}   serie {len(serie):,} × {serie.shape[1]}')

D = {'meta': {
    'generado': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M'),
    'filas_proy': int(len(proy)), 'filas_serie': int(len(serie)),
    'periodos_proy': sorted(int(p) for p in proy['PERIODO'].unique()),
    'periodos_hist': sorted(int(p) for p in hist['PERIODO'].unique()),
    'campus': sorted(proy['CAMPUS'].dropna().unique().tolist()),
    'componentes': sorted(proy['COMPONENTE'].dropna().unique().tolist()),
}}

# ══ MÓDULO 1 · RESUMEN EJECUTIVO ═══════════════════════════════════════════
print('· resumen ejecutivo')
_rb = hist[hist['INSCRITOS_REAL'].notna() & hist['PROY_ESTANDAR'].notna()].copy()
_rb = _rb.merge(lag, on=DIMS, how='left')
_rb = _rb[_rb['ins_lag_1y'].notna()]

_NIV_RES = [('un período completo', ['PERIODO']),
            ('una sede en ese período', ['PERIODO', 'CAMPUS']),
            ('un componente de esa sede', ['PERIODO', 'CAMPUS', 'COMPONENTE']),
            ('una asignatura concreta', DIMS)]
_niveles = []
for _nom, _by in _NIV_RES:
    g = _rb.groupby(_by, observed=True)[['INSCRITOS_REAL', 'PROY_ESTANDAR']].sum()
    g = g[g['INSCRITOS_REAL'] > 0]
    e = (g['PROY_ESTANDAR'] / g['INSCRITOS_REAL'] - 1).abs()
    _niveles.append({'nivel': _nom, 'n_tipico': n(g['INSCRITOS_REAL'].median()),
                     'err': n(e.median())})

_gh = proy.groupby('horizonte')['P50_ESPERADO'].sum()
_hs = hist[hist['N_SECCIONES_REALES'] > 0]
D['resumen'] = {
    'total': n(proy['P50_ESPERADO'].sum()),
    'periodos': int(proy['PERIODO'].nunique()),
    'ventaja': n(1 - wape(_rb['INSCRITOS_REAL'], _rb['PROY_ESTANDAR']) /
                 wape(_rb['INSCRITOS_REAL'], _rb['ins_lag_1y'])),
    'niveles': _niveles,
    'pct_prelim': n(_gh.get(2, 0) / _gh.sum()),
    'per_prelim': sorted(int(p) for p in
                         proy.loc[proy['horizonte'] == 2, 'PERIODO'].unique()),
    'exceso_p50': n(proy['P50'].sum() / proy['P50_ESPERADO'].sum() - 1),
    'sesgo_sec': n(_hs['N_SECCIONES_TEORICAS'].sum() /
                   _hs['N_SECCIONES_REALES'].sum() - 1),
}

# ══ MÓDULO 2 · MÉTRICAS DEL MODELO ═════════════════════════════════════════
print('· métricas del modelo')
_m = hist[hist['INSCRITOS_REAL'].notna() & hist['PROY_ESTANDAR'].notna()].merge(
    lag, on=DIMS, how='left')
_y, _f = _m['INSCRITOS_REAL'].values, _m['PROY_ESTANDAR'].values
_e = _f - _y
_cn = _m['ins_lag_1y'].notna()
_mae_naive = float(np.abs(_m.loc[_cn, 'ins_lag_1y'] - _m.loc[_cn, 'INSCRITOS_REAL']).mean())
_wape_naive = wape(_m.loc[_cn, 'INSCRITOS_REAL'], _m.loc[_cn, 'ins_lag_1y'])
_w = wape(_y, _f)


def pinball(y, q, a):
    d = np.asarray(y, float) - np.asarray(q, float)
    return float(np.maximum(a * d, (a - 1) * d).mean())


D['modelo'] = {
    'filas': int(len(_m)), 'periodos': int(_m['PERIODO'].nunique()),
    'inscritos': n(_y.sum()),
    'mae': n(np.abs(_e).mean()), 'rmse': n(np.sqrt((_e ** 2).mean())),
    'wape': n(_w), 'smape': n((2 * np.abs(_e) / (np.abs(_y) + np.abs(_f))).mean()),
    'mase': n(np.abs(_m.loc[_cn, 'PROY_ESTANDAR'] -
                     _m.loc[_cn, 'INSCRITOS_REAL']).mean() / _mae_naive),
    'sesgo': n(_e.sum() / _y.sum()),
    'wape_naive': n(_wape_naive), 'mae_naive': n(_mae_naive),
    'cob_naive': n(_cn.mean()),
    'ventaja': n(1 - _w / _wape_naive),
    # R² del modelo y el del naive, sobre la MISMA base comparable. Suelto engaña:
    # la inercia de la serie explica casi toda la varianza antes de que el modelo
    # haga nada, así que sólo significa algo puesto al lado del de su baseline.
    'r2': n(_r2(_m.loc[_cn, 'INSCRITOS_REAL'], _m.loc[_cn, 'PROY_ESTANDAR'])),
    'r2_naive': n(_r2(_m.loc[_cn, 'INSCRITOS_REAL'], _m.loc[_cn, 'ins_lag_1y'])),
    'cob_p10': n((_m['INSCRITOS_REAL'] <= _m['PROY_BAJO']).mean()),
    'cob_p50': n((_m['INSCRITOS_REAL'] <= _m['PROY_ESTANDAR']).mean()),
    'cob_p90': n((_m['INSCRITOS_REAL'] <= _m['PROY_ALTO']).mean()),
    'cob_int': n(_m['DENTRO_BANDA'].mean()),
    'pinball': n(np.mean([pinball(_m['INSCRITOS_REAL'], _m[c], a) for c, a in
                          [('PROY_BAJO', .10), ('PROY_ESTANDAR', .50),
                           ('PROY_ALTO', .90)]])),
    'ancho': n((_m['PROY_ALTO'] - _m['PROY_BAJO']).mean()),
}
# dónde se concentra el error, por tamaño de serie
_m['_tr'] = pd.cut(_m['INSCRITOS_REAL'], [0, 10, 30, 100, np.inf],
                   labels=['1-10', '11-30', '31-100', '>100'])
D['modelo']['tramos'] = []
for k, x in _m.groupby('_tr', observed=True):
    D['modelo']['tramos'].append({
        'tramo': str(k), 'filas': int(len(x)),
        'pct_vol': n(x['INSCRITOS_REAL'].sum() / _y.sum()),
        'wape': n(wape(x['INSCRITOS_REAL'], x['PROY_ESTANDAR'])),
        'sesgo': n((x['PROY_ESTANDAR'].sum() - x['INSCRITOS_REAL'].sum()) /
                   x['INSCRITOS_REAL'].sum()),
        'en_banda': n(x['DENTRO_BANDA'].mean())})

# ══ MÓDULO 3 · HORIZONTE ═══════════════════════════════════════════════════
print('· horizonte')
_g = proy.groupby('horizonte').agg(
    filas=('P50', 'size'), periodos=('PERIODO', 'nunique'),
    p50=('P50', 'sum'), esperado=('P50_ESPERADO', 'sum'),
    secciones=('N_SECCIONES_TEORICAS_PROYECTADAS', 'sum'))
_g['pct'] = _g['esperado'] / _g['esperado'].sum()
D['horizonte'] = {
    'backtest': BT_H2,
    'peso': [{'h': int(h), **{k: n(v) for k, v in r.items()}}
             for h, r in _g.iterrows()],
    'por_periodo': [{'periodo': int(p), 'h': int(x['horizonte'].iloc[0]),
                     'esperado': n(x['P50_ESPERADO'].sum())}
                    for p, x in proy.groupby('PERIODO')],
}
# guard del ensanchamiento de banda, pareado por serie y TT
_K4 = ['MATERIA', 'CURSO', 'COMPONENTE', 'CAMPUS']
_pr = proy.assign(_anc=proy['P90'] - proy['P10'])
_ens = []
for _tt, _a, _b in [(20, 202620, 202720), (25, 202625, 202725)]:
    A = _pr[_pr['PERIODO'] == _a].set_index(_K4)[['_anc', 'P50']]
    B = _pr[_pr['PERIODO'] == _b].set_index(_K4)[['_anc', 'P50']]
    j = A.join(B, how='inner', lsuffix='_1', rsuffix='_2').dropna()
    if len(j) and j['_anc_1'].sum() > 0 and j['P50_1'].sum() > 0:
        ra = j['_anc_2'].sum() / j['_anc_1'].sum()
        rp = j['P50_2'].sum() / j['P50_1'].sum()
        _ens.append({'tt': _tt, 'series': int(len(j)), 'ratio_ancho': n(ra),
                     'ratio_p50': n(rp), 'ensanche': n(ra / rp)})
D['horizonte']['guard'] = {
    'detalle': _ens,
    'efectivo': n(np.mean([e['ensanche'] for e in _ens])) if _ens else None,
    'declarado': BT_H2['factor'],
}

# ══ MÓDULO 4 · CASCADA POR NIVELES ═════════════════════════════════════════
print('· cascada por niveles')
_PC = ['PERIODO', 'CAMPUS']
_NIV = [('Período', ['PERIODO'], 0), ('… × Campus', _PC, 1),
        ('… × Componente', _PC + ['COMPONENTE'], 2),
        ('… × Materia × Curso', _PC + ['MATERIA', 'CURSO'], 2),
        ('… × Materia×Curso × Comp.', _PC + ['MATERIA', 'CURSO', 'COMPONENTE'], 3)]
D['cascada'] = []
for _nom, _by, _prof in _NIV:
    g = _rb.groupby(_by, observed=True)[['INSCRITOS_REAL', 'PROY_ESTANDAR',
                                         'ins_lag_1y']].sum()
    wm, wn = wape(g['INSCRITOS_REAL'], g['PROY_ESTANDAR']), \
             wape(g['INSCRITOS_REAL'], g['ins_lag_1y'])
    gp = g[g['INSCRITOS_REAL'] > 0]
    err = gp['PROY_ESTANDAR'] / gp['INSCRITOS_REAL'] - 1
    D['cascada'].append({
        'nivel': _nom, 'prof': _prof, 'celdas': int(len(g)),
        'n_tipico': n(gp['INSCRITOS_REAL'].median()),
        'wape': n(wm), 'wape_naive': n(wn),
        'skill': n(1 - wm / wn) if wn else None,
        'err_p50': n(err.abs().median()), 'err_p90': n(err.abs().quantile(.90)),
        'lo': n(err.quantile(.05)), 'hi': n(err.quantile(.95))})

# ══ MÓDULO 5 · SECCIONES: criterios × niveles ══════════════════════════════
print('· secciones')
SEC_REAL, VARA = 'N_SECCIONES_REALES', 'N_SECCIONES_TEORICAS'
CRIT = [('N_SECCIONES_TEORICAS_PROYECTADAS', 'Norma·P50'),
        ('N_SECCIONES_PROMEDIO', 'Ocupación observada'),
        ('N_SECCIONES_P25', 'p25'), ('N_SECCIONES_P50', 'p50'),
        ('N_SECCIONES_P75', 'p75'), ('N_SECCIONES_P90', 'p90')]
_sb = hist[hist[SEC_REAL] > 0].copy()
_tot = _sb[SEC_REAL].sum()
_dv = _sb[VARA] - _sb[SEC_REAL]
D['secciones'] = {
    'filas': int(len(_sb)), 'reales': n(_tot),
    'vara': {'etiqueta': 'Norma·real (norma + inscritos REALES)',
             'suma': n(_sb[VARA].sum()), 'sesgo': n(_sb[VARA].sum() / _tot - 1),
             'wape': n(wape(_sb[SEC_REAL], _sb[VARA])),
             'exacta': n((_dv == 0).mean())},
    'criterios': [], 'matriz': [], 'tramos': [],
}
for c, e in CRIT:
    d = _sb[c] - _sb[SEC_REAL]
    w = wape(_sb[SEC_REAL], _sb[c])
    D['secciones']['criterios'].append({
        'criterio': e, 'suma': n(_sb[c].sum()),
        'sesgo': n(_sb[c].sum() / _tot - 1), 'wape': n(w),
        'skill': n(1 - w / D['secciones']['vara']['wape']),
        'exacta': n((d == 0).mean()), 'mas_menos_1': n((d.abs() <= 1).mean()),
        'err_p90': n(d.abs().quantile(.90))})
# matriz criterio × nivel
NIV_S = [('Período', ['PERIODO']), ('+Campus', _PC),
         ('+Compon.', _PC + ['COMPONENTE']),
         ('+Mat×Curso', _PC + ['MATERIA', 'CURSO']),
         ('grano', _PC + ['MATERIA', 'CURSO', 'COMPONENTE'])]
for _nom, _by in NIV_S:
    g = _sb.groupby(_by, observed=True)[[SEC_REAL, VARA] +
                                        [c for c, _ in CRIT]].sum()
    g = g[g[SEC_REAL] > 0]
    wv = wape(g[SEC_REAL], g[VARA])
    dv = g[VARA] - g[SEC_REAL]
    fila = {'nivel': _nom, 'celdas': int(len(g)),
            'n_tipico': n(g[SEC_REAL].median()), 'wape_vara': n(wv),
            'exacta_vara': n((dv == 0).mean()), 'crit': {}}
    for c, e in CRIT:
        d = g[c] - g[SEC_REAL]
        w = wape(g[SEC_REAL], g[c])
        fila['crit'][e] = {'skill': n(1 - w / wv) if wv else None,
                           'err_p50': n((d / g[SEC_REAL]).abs().median()),
                           'exacta': n((d == 0).mean())}
    D['secciones']['matriz'].append(fila)
# sesgo por tamaño de asignatura
_sb['_tr'] = pd.cut(_sb[SEC_REAL], [0, 1, 3, 10, np.inf],
                    labels=['1', '2-3', '4-10', '>10'])
for k, x in _sb.groupby('_tr', observed=True):
    d = x['N_SECCIONES_TEORICAS_PROYECTADAS'] - x[SEC_REAL]
    dv2 = x[VARA] - x[SEC_REAL]
    D['secciones']['tramos'].append({
        'tramo': str(k), 'filas': int(len(x)),
        'pct_sec': n(x[SEC_REAL].sum() / _tot),
        'wape': n(wape(x[SEC_REAL], x['N_SECCIONES_TEORICAS_PROYECTADAS'])),
        'sesgo': n(d.sum() / x[SEC_REAL].sum()),
        'sesgo_vara': n(dv2.sum() / x[SEC_REAL].sum()),
        'exacta': n((d == 0).mean()), 'mas_menos_1': n((d.abs() <= 1).mean())})

# ══ MÓDULO 6 · ESTÁNDARES: tamaño observado vs norma ═══════════════════════
print('· estándares')
PCOLS = [f'estandar_p{p}' for p in (25, 50, 75, 90)]
sp = pd.read_parquet(f'{CARPETA}/DEMANDA_PROCESADA.parquet',
                     columns=['PERIODO', 'COMPONENTE', 'CAMPUS', 'INSCRITOS',
                              'n_secciones'] + PCOLS)
A_MAX = sp['PERIODO'].max() // 100
sp = sp[(sp['PERIODO'] % 100).isin([5, 10, 15, 20, 25]) &
        (sp['PERIODO'] // 100 >= A_MAX - 2)]
et = proy.groupby('COMPONENTE', observed=True)['ESTANDAR_TEORICO'].median()
g = (sp.groupby('COMPONENTE', observed=True)
       .agg(secciones=('n_secciones', 'sum'), inscritos=('INSCRITOS', 'sum'),
            **{f'p{p}': (f'estandar_p{p}', 'median') for p in (25, 50, 75, 90)},
            p50_min=('estandar_p50', 'min'), p50_max=('estandar_p50', 'max'))
       .join(et.rename('norma')))
g['ocup'] = g['inscritos'] / g['secciones']
g = g[g['secciones'] > 500].sort_values('secciones', ascending=False)
D['estandares'] = {
    'ventana': [int(sp['PERIODO'].min()), int(sp['PERIODO'].max())],
    'componentes': [{'comp': c, **{k: n(v) for k, v in r.items()},
                     'abanico': n(r['p90'] / max(r['p25'], 1))}
                    for c, r in g.iterrows()]}

# ══ SERIE POR PERÍODO (para los gráficos de secciones) ═════════════════════
print('· serie por período')
SEC_COLS = ['N_SECCIONES_REALES', 'N_SECCIONES_TEORICAS',
            'N_SECCIONES_TEORICAS_PROYECTADAS', 'N_SECCIONES_PROMEDIO',
            'N_SECCIONES_P25', 'N_SECCIONES_P50', 'N_SECCIONES_P75',
            'N_SECCIONES_P90']
sg = (serie.groupby(['PERIODO', 'CAMPUS', 'COMPONENTE'], observed=True)[SEC_COLS]
      .sum(min_count=1).reset_index())
S = {'periodo': sg['PERIODO'].astype(int).tolist(),
     'campus': sg['CAMPUS'].tolist(), 'comp': sg['COMPONENTE'].tolist()}
for c in SEC_COLS:
    S[c.replace('N_SECCIONES_', '').lower()] = [n(v) for v in sg[c]]
S['ultimo_real'] = int(hist['PERIODO'].max())

# ══ CELDAS DEL ENTREGABLE (formato columnar) ═══════════════════════════════
print('· celdas del entregable')
COLS_CELDA = ['PERIODO', 'CODIGO_PROGRAMABLE', 'ASIGNATURA_REGLA', 'COMPONENTE',
              'CAMPUS', 'P10', 'P50', 'P90', 'P50_ESPERADO', 'PROB_SE_DICTA',
              'horizonte', 'confiabilidad', 'ESTANDAR_TEORICO',
              'N_SECCIONES_TEORICAS_PROYECTADAS']
C = {}
for c in COLS_CELDA:
    if c not in proy.columns:
        print(f'    ⚠️ falta la columna {c}')
        continue
    s = proy[c]
    C[c] = (s.astype(int).tolist() if s.dtype.kind in 'i'
            else [n(v) for v in s] if s.dtype.kind == 'f'
            else s.fillna('').astype(str).tolist())

# ── Escritura ──────────────────────────────────────────────────────────────
DATA.mkdir(exist_ok=True)
for nombre, obj in [('dashboard.json', D), ('serie.json', S), ('celdas.json', C)]:
    p = DATA / nombre
    with io.open(p, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'  {nombre:<18} {p.stat().st_size / 1024:>8,.0f} KB')

print('\n✔ listo')

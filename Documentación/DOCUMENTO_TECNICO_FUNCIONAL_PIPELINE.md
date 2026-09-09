# Documento técnico-funcional · PIPELINE de Proyección de Demanda de Asignaturas

> [!info] 📌 Ficha
> **Artefacto**: `PIPELINE_PROYECCION_ASIGNATURAS.ipynb` (35 celdas)
> **Versión**: 2026-09-01 · corrida de referencia `exec 1–35`, sin errores
> **Función**: transformar seis fuentes crudas de Banner 9 en **una sábana modelable**
> **Salida**: `DEMANDA_PROCESADA.parquet` — 163.954 filas × 61 columnas · 28.996 series · 131 períodos (201510–202627) · 5,1 MB
> **Consumidor**: `MODELO_ML_PROYECCION_ASIGNATURAS.ipynb` (Fases 2–7)
> **Tiempo de corrida**: ~8 min (dominado por la lectura del detalle de inscripción, 385 MB)

**Cómo leer este documento.** Usa un sistema de audiencias: 🔧 detalle técnico · 🧭 puente entre negocio y técnica · 👔 lectura ejecutiva. Las secciones §1–§3 son 👔🧭; §4–§11 son 🔧🧭; §12–§15 son transversales.

---

## 1 · Qué resuelve este pipeline 👔

La pregunta de negocio es **cuántos estudiantes se inscribirán en cada asignatura el próximo período**, para programar secciones, salas y carga docente. Antes de poder responderla hay un problema anterior que consume la mayor parte de este pipeline:

> **Los códigos de asignatura cambian con el tiempo.** La misma asignatura se dicta durante años bajo códigos distintos, porque cada versión de malla curricular la renombra. Si no se unifican, el histórico queda partido en fragmentos cortos y no hay serie temporal que modelar.

El pipeline hace cuatro cosas, en este orden:

| # | Etapa | Qué produce | Métrica de cierre |
|---|---|---|---|
| 1 | **Unificar códigos** | cada asignatura histórica apuntando a su código vigente | 2.499.295 inscripciones reubicadas (33,7%) |
| 2 | **Construir el objetivo** | inscritos por asignatura-componente-sede-período | 164.276 combinaciones · 7.413.130 inscripciones |
| 3 | **Enriquecer** | nivel, reprobación, atributos de malla, estándares | 90–100% de cobertura según familia |
| 4 | **Derivar features temporales** | 10 variables de historia, todas mirando al pasado | 17,7%–59,2% de nulos, **estructurales** |

> [!abstract] 👔 En una frase
> Este pipeline no proyecta nada. Construye la **materia prima** de la proyección: una tabla donde cada fila es una asignatura-componente-sede en un período, con su historia limpia al lado. El 60% de su código existe para resolver que Banner renombra asignaturas.

---

## 2 · Arquitectura de datos

```
┌─ FUENTES (6) ────────────────────────────────────────────────────────┐
│  df   REPORTE_INSCRIPCIÓ_FULL_2015_2026    7.413.130 × 7   [385 MB]  │
│  df2  MAESTRO_MALLAS_CATALOGO_APERTURADO     214.490 × 38            │
│  df3  PROYECCION_MATRICULA                     9.513 × 9   ⛔ D-06   │
│  df4  INDICE_REPROBACION                     131.108 × 10            │
│  df5  SCRLEVL  (nivel académico)              19.229                 │
│  df6  STVLEVL  (descriptor de nivel)               —                 │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ BLOQUE A · NORMALIZACIÓN DE CÓDIGOS  (celdas 2 · 2b · 7b) ──────────┐
│  tabla de reglas con ranking  →  cascada de homologación             │
│  9.406 asignaturas históricas  →  7.748 códigos unificados           │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ BLOQUE B · VARIABLE OBJETIVO  (celda 8) ────────────────────────────┐
│  grano:  PERIODO × MATERIA × CURSO × COMPONENTE × CAMPUS             │
│  INSCRITOS = count(RUT)   ·   n_secciones = nunique(NRC)             │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ BLOQUE C · ENRIQUECIMIENTO  (celdas 9–13 · 18–20) ──────────────────┐
│  nivel académico · reprobación · atributos de malla (espiral) ·      │
│  imputación por asignatura                                           │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ BLOQUE D · FEATURES TEMPORALES  (celda 15) ─────────────────────────┐
│  10 lags: estacionales (mismo TT, k años) · rolling 3y · cronológico │
│  ⚠️ el corazón del anti-leakage                                      │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ BLOQUE E · CONVERSIÓN A OFERTA  (celdas 22 · 24c) ──────────────────┐
│  estándar de programación (con lag)  ·  percentiles p25/50/75/90     │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ENTREGA  (celdas 24b · 25 · 26 · 27) ───────────────────────────────┐
│  DEMANDA_PROCESADA.parquet  163.954 × 61  +  4 CSV de trazabilidad   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 · Los seis insumos 🔧

| Var | Archivo | Filas | Rol | Nota crítica |
|---|---|---:|---|---|
| `df` | `REPORTE_INSCRIPCIÓ_FULL_2015_2026_22072026.csv` | 7.413.130 | **Fuente del objetivo**. 1 fila = 1 inscripción | Solo 7 columnas: no expone `ESTADO_NRC`, de ahí la ambigüedad RE/RW aún abierta |
| `df2` | `MAESTRO_MALLAS_CATALOGO_APERTURADO.csv` | 214.490 | Mallas + catálogo. Fuente de reglas y atributos | Grano programa × área × regla × asignatura × componente → **nunca se mergea directo** |
| `df3` | `PROYECCION_MATRICULA_2026_2031.CSV` | 9.513 | ⛔ **Descartado (D-06)** | Grano año × condición × carrera × sede × nivel: no baja a asignatura ni a semestre curricular |
| `df4` | `INDICE_REPROBACION_ASIGNATURA_SEDE_PERIODO.csv` | 131.108 | Reprobación por asignatura-sede-período | Se produce aparte en `TASA_REPROBACIÓNxNRC.ipynb` |
| `df5` | `SCRLEVL.csv` | 19.229 | Nivel académico por asignatura, versionado | `dtype=str` obligatorio: `'0068'` pierde ceros si pandas infiere entero |
| `df6` | `STVLEVL.csv` | — | Descriptor del nivel | UG · AV · MG · DP · PE · PH |

> [!warning] ⚠️ La trampa de tipos
> `SCRLEVL` se lee con `dtype=str` en `subj_code`/`crse_numb`. Sin eso, `'0068'` se convierte en `68` y el cruce con la regla falla silenciosamente — no da error, simplemente no matchea.

---

## 3 · La regla maestra: qué es una asignatura 🧭

> [!danger] 🚨 Convención que atraviesa todo el proyecto
> **Una asignatura es `cod_materia || n_curso`, concatenados SIN separador.**
> `FORI` + `0001` → `FORI0001`. El código de `regla` en Banner **es** esa concatenación.

De aquí salen dos decisiones no obvias que están medidas:

**① No se aplica `zfill(4)` a `n_curso`.** Parece que debería —los códigos "se ven" sin ceros en Excel— pero es Excel recortándolos al mostrar, no el dato. Aplicarlo **rompe 2.395 matches** y no rescata ninguno:

```
'CEP' + '100'  = 'CEP100'   == regla CEP100   ✓
'CEP' + '0100' = 'CEP0100'  != regla CEP100   ✗
```

El problema son las materias de 3 caracteres (5.027 filas): `CEP`, `CFG`, `REM`.

**② No se parte el código por posición.** Por la misma razón, `regla[:4]` no da la materia. Cuando hace falta separar materia y curso de una regla, se leen de **su propia fila** en el catálogo (`_PARES` en la celda 7b), no por corte de string.

**Distribución real del largo de `regla`** (214.490 filas):

| Largo | Filas | % |
|---:|---:|---:|
| 4 | 20 | 0,0% |
| 6 | 2.341 | 1,1% |
| 7 | 17.202 | 8,0% |
| **8** | **127.356** | **59,4%** |
| 9 | 58.766 | 27,4% |
| 10 | 8.805 | 4,1% |

Solo el 59,4% mide los 8 caracteres canónicos. El resto son reglas legítimas de otro largo, así que **se marca (`regla_cumple_8`) en vez de rellenar**.

---

## 4 · Bloque A · Normalización de códigos 🔧

Es el bloque más complejo del pipeline y el que más valor aporta. Consta de dos celdas.

### 4.1 · Tabla de reglas con ranking (celda 2b)

Construye, desde `df2`, el mapa asignatura → regla con un **ranking de versiones**:

```python
ranking = rank DENSO y DESCENDENTE de `periodo_reglas` DENTRO de cada `regla`
#          ranking 1 = la versión más reciente
```

> [!danger] 🚨 Por qué NO se filtra por `vigente`
> `vigente` es una marca **por programa-carrera** (la última versión de la malla de *ese* programa), no por asignatura. **4.051 de 16.466 asignaturas (24,6%) solo existen en mallas no vigentes** y quedaban invisibles. En el período 202610 eso dejaba fuera al **23% de los inscritos**.

**Métricas de salida:**

| Métrica | Valor |
|---|---:|
| filas | 86.586 |
| asignaturas distintas | 16.450 |
| reglas distintas | 15.501 |
| ranking máximo | 28 |
| períodos de regla | 95 (199010–202612) |
| **alcance vs `vigente == True`** | **16.450 vs 12.407 → +4.043 (24,6%)** |

Distribución por nivel: ranking 1 = 37,1% · 2 = 16,3% · 3 = 9,5% · 4 = 5,4% · 5 = 4,5% · 6 = 3,4% · 7+ = 23,9%.

**No se colapsa a una fila por asignatura**: una asignatura aparece en todos los períodos en que colgó de la regla, así que la misma puede estar en el nivel 1, 2 y 3. Eso es exactamente lo que habilita la cascada.

### 4.2 · Homologación por cascada (celda 7b)

Recorre las versiones de malla de la más reciente a la más antigua. En cada nivel, y bajando **solo lo que no resuelve**:

| Situación | Decisión |
|---|---|
| 1 sola regla candidata | **se toma** |
| varias, **con** auto-referencia | gana la regla igual al propio código (lo conserva) |
| varias, **sin** auto-referencia | ⏭️ **no resuelve — baja de nivel** |

> [!tip] 💡 La auto-referencia es la regla auxiliar del negocio
> Si el código existe como regla, se programa con ese código. Por eso `ODON1004` baja hasta el nivel 3 —donde aparece su propia regla— en vez de repartirse entre las cuatro candidatas del nivel 1. **El diferimiento es la clave del diseño**: no forzar una decisión con información insuficiente.

**Traza de la cascada (9.406 asignaturas del histórico):**

| Nivel | Resuelve | Por auto-ref | Difiere | Pendientes |
|---:|---:|---:|---:|---:|
| 1 | 6.762 | 4.876 | 809 | 2.644 |
| 2 | 1.159 | 710 | 409 | 1.485 |
| 3 | 365 | 238 | 290 | 1.120 |
| 4 | 240 | 165 | 256 | 880 |
| 5 | 78 | 67 | 227 | 802 |
| 6 | 22 | 13 | 214 | 780 |
| 7 | 44 | 35 | 196 | 736 |
| 8 | 15 | 13 | 194 | 721 |
| … | *hasta el nivel 21* | | | |

**Resultado:**

| Métrica | Valor |
|---|---:|
| resueltas | 8.710 |
| sin cruce (ninguna malla las reconoce) | 696 |
| por auto-referencia | 6.131 (70,4% de las resueltas) |
| **cambian de código** | **2.237** |
| **inscripciones reubicadas** | **2.499.295 de 7.413.130 (33,7%)** |
| asignaturas distintas | 9.406 → **7.748** |
| `df4` tras re-agregar | 131.108 → 123.653 filas |

**Punto fijo y detección de ciclos** 🔧 — el mapa se itera hasta converger (máx. 20 pasadas) para resolver cadenas `A→B→C`, y aborta si detecta un ciclo `A→B→A`:

```python
for _i in range(20):
    _nv = {a: MAPA_HOMOLOGACION.get(b, b) for a, b in MAPA_HOMOLOGACION.items()}
    if _nv == MAPA_HOMOLOGACION: break
    MAPA_HOMOLOGACION = _nv
else:
    raise RuntimeError("La homologación no converge: hay un ciclo A→B→A.")
```

**Re-agregación obligatoria de `df4`** ⚠️ — cuando dos códigos colapsan en uno, la llave de reprobación queda duplicada y el merge posterior multiplicaría filas de la sábana. Por eso se re-agrega, y **los ratios se recalculan** (`n_reprobados / n_aprobados`) en vez de promediarse: promediar promedios sería incorrecto.

**Guards de la celda** — cuatro invariantes que abortan la corrida:

1. `len(df)` no cambia
2. el nº de inscripciones no cambia (invariante de suma)
3. `n_registros` de `df4` no cambia
4. `df4` no queda con llave duplicada

---

## 5 · Bloque B · La variable objetivo (celda 8) 🔧

```python
dims = ['PERIODO', 'MATERIA', 'CURSO', 'COMPONENTE', 'CAMPUS']
demanda = df.groupby(dims).agg(INSCRITOS=('RUT', 'count'),
                               n_secciones=('NRC', 'nunique')).reset_index()
```

> [!warning] ⚠️ R-01 · El NRC queda FUERA del grano
> El NRC identifica una **sección**, que es más fino que la unidad de decisión. Se suman todas las secciones de una misma combinación. `n_secciones` se guarda aparte porque es la **verdad de terreno** de la conversión demanda → oferta.

| Métrica | Valor |
|---|---:|
| inscripciones | 7.413.130 (0 con RUT nulo, 0 con dimensión nula) |
| **combinaciones (grano objetivo)** | **164.276** |
| secciones (NRC) totales | 452.695 |
| ocupación media por sección | 16,4 inscritos |

La cuadratura es exacta: `Σ INSCRITOS == 7.413.130`.

---

## 6 · Bloque C · Enriquecimiento

### 6.1 · Nivel académico (celda 9) 🔧

Asigna a cada asignatura su nivel desde `SCRLEVL`, tomando el registro del **máximo `eff_term`** — la misma lógica de vigencia que en mallas.

**Desambiguación** cuando una asignatura tiene varios niveles vigentes (137 casos): manda el tipo de período donde tiene inscripción **real**.

| TT | Grupo |
|---|---|
| 10 / 20 / 30 (semestres y verano) | **UG** — Pregrado |
| 05 / 15 / 25 (trimestres) | **AV** — Trimestral Pregrado |
| otro | orden alfabético |

De los 137 ambiguos: **34 resueltos por tipo de período**, 103 por alfabético.

| Nivel | Filas | Inscritos |
|---|---:|---:|
| PREGRADO | 93.343 | 5.601.686 |
| TRIMESTRAL PREGRADO | 52.887 | 1.341.507 |
| DESARROLLO PROFESIONAL | 5.786 | 235.723 |
| MAGISTER | 8.703 | 208.406 |
| POSTÍTULO DE ESPECIALIZACIÓN | 2.358 | 21.365 |
| DOCTORADO | 1.170 | 3.987 |
| *(sin nivel)* | 29 | 456 |

Cobertura: **100,0%** de las filas y de las inscripciones.

> [!tip] 💡 Para qué sirve — base de R-09
> Los períodos que "tributan" a un nivel dependen de él. La tasa de crecimiento de una asignatura debe calcularse sobre **todos los períodos de SU nivel**, no solo contra el mismo TT del año anterior.

### 6.2 · Vigencia y versión de malla (celdas 10 · 11 · 12c) 🔧

| Celda | Produce | Métrica |
|---|---|---|
| 10 | `cod_programa_carrera`, `vigente` | 899 llaves · 37.795 filas vigentes (17,6%) |
| 11 | `version_malla` (1 = más antigua), `n_versiones_malla` | 1–22 · mediana 1, media 1,67 · consistencia con `vigente` **100,00%** |
| 12c | `ranking_malla` | `= n_versiones_malla − version_malla + 1` |

**`ranking_malla == 1` ≡ `vigente == True`**, verificado sobre las 214.490 filas sin excepciones (hay un `raise` que lo comprueba).

**Cobertura acumulada bajando de nivel** — la justificación cuantitativa de la cascada:

| Hasta nivel | Asignaturas alcanzables | % | Nuevas |
|---:|---:|---:|---:|
| 1 | 12.407 | 75,4% | +12.407 |
| 2 | 13.832 | 84,1% | +1.425 |
| 3 | 14.682 | 89,3% | +850 |
| 4 | 15.091 | 91,7% | +409 |
| 5 | 15.301 | 93,0% | +210 |
| 6 | 15.448 | 93,9% | +147 |

### 6.3 · Merge de reprobación (celda 13) 🔧

Llave: `PERIODO × MATERIA × CURSO × CAMPUS`. **No incluye `COMPONENTE`** — el índice vive al grano asignatura-sede-período y se replica en todos los componentes.

| Métrica | Valor |
|---|---:|
| filas | 164.276 → 164.276 (sin multiplicación) |
| con índice de reprobación | 156.332 (95,2%) |
| sin match | 7.944 |
| inscripciones cubiertas | 6.908.929 (93,2%) |

El sin-match se concentra en asignaturas **sin historial de notas**: `EEDD`, `IAGE`, `CBB2` — formación general sin nota tradicional.

> [!danger] 🚨 Estas columnas son del período ACTUAL
> `indice_reprobacion`, `n_reprobados` y compañía están **prohibidas como feature** (§10 anti-leakage). Solo entran sus versiones con lag, construidas en la celda 15.

### 6.4 · Atributos de malla con espiral temporal (celda 19) 🔧

> [!warning] ⚠️ Por qué hay que pivotar antes
> `df2` está al grano programa × área × regla × asignatura × componente. Un merge directo **multiplicaría** las filas de la sábana. La celda 18 lo colapsa primero a asignatura-componente-período: `pivot_df2_1` (33.272 combinaciones) y `pivot_df2_2` (19.810).

La espiral busca el atributo en este orden: **exacto → adelante → atrás**, implementada con `merge_asof`:

```python
ade = pd.merge_asof(d, p, left_on='PERIODO', right_on='periodo_scacrse',
                    by=LLAVE_ASIG, direction='forward')    # exacto + adelante
atr = pd.merge_asof(d, p, ..., direction='backward')       # fallback
```

`direction='forward'` con `allow_exact_matches=True` ya devuelve el match exacto cuando existe, así que dos pasadas bastan.

> [!danger] 🚨 El placeholder 999996
> `periodo_scacrse = 999996` es un valor centinela. Si se deja, **absorbe todos los matches hacia adelante** y contamina los atributos de toda la sábana. Se excluye explícitamente.

**Distribución del tipo de match:**

| Tipo | Filas |
|---|---:|
| atrás | 83.674 |
| adelante | 53.963 |
| sin match | 15.793 |
| exacto | 10.846 |

Cobertura: 148.320 filas (90,3%) · 6.352.235 inscripciones (85,7%).

`periodo_atrib` y `tipo_match` son columnas de **auditoría, no features**.

### 6.5 · Imputación por asignatura (celda 20) 🔧

Para lo que quedó nulo: se quita `COMPONENTE` de la llave y se imputa con el valor representativo de la asignatura.

| Tipo | Agregación | Por qué |
|---|---|---|
| numéricos | **MEDIANA** | las distribuciones están muy sesgadas; en `carga_semanal` acierta 67,5% vs 49,9% de la media |
| categóricos | **MODA** | — |

| Campo | Nulos antes | Después | Imputados |
|---|---:|---:|---:|
| `carga_semanal` | 15.956 | 1.457 | 14.499 |
| `hr_teo` | 37.938 | 28.775 | 9.163 |
| `hr_lab` | 47.012 | 34.873 | 12.139 |
| `hr_otro` | 157.593 | 155.000 | 2.593 |
| `cod_modo_programacion` | 15.793 | 1.432 | 14.361 |
| `departamento/form_general` | 20.723 | 8.491 | 12.232 |

**Calidad medida contra el valor real** (en filas que sí tenían dato): `hr_teo` **97,3%** exacto · `hr_lab` **98,9%** · `hr_otro` **98,9%** · `carga_semanal` **67,5%**.

`carga_semanal` es el más débil porque la carga es intrínsecamente **por componente** (TEO 4h vs LAB 2h). Aun así la asignatura es el mejor proxy disponible: **MAE 1,74 vs 7,70** si se imputara por componente.

Filas con algún atributo imputado: 18.424 (11,2%). Remanente sin imputar: 1.457 filas (0,89%), correspondientes a **337 asignaturas que no existen en `df2`** (4,82% de las inscripciones).

---

## 7 · Bloque D · Features temporales — el corazón del anti-leakage (celda 15) 🔧

> [!danger] 🚨 §10 · Regla anti-leakage
> **Todo mira solo al pasado.** Ninguna variable del período que se pronostica entra como feature. El notebook de ML aborta si detecta una prohibida.

Hay **dos nociones de "anterior"**, y aportan señal distinta:

| Noción | Definición | Qué capta |
|---|---|---|
| **ESTACIONAL** | mismo TT, *k* años atrás (self-merge sobre `ANIO + k`) | compara 1er semestre con 1er semestre |
| **CRONOLÓGICO** | período inmediatamente anterior de la serie (`shift(1)`) | el flujo real de repitentes semestre a semestre |

> [!tip] 💡 Medido, no supuesto
> El seasonal naive gana con el estacional: **WAPE 0,398 vs 0,548** del cronológico. Por eso el estacional es la vara oficial del proyecto — pero ambos entran como feature, porque capturan fenómenos distintos.

```python
SERIE = ['MATERIA', 'CURSO', 'COMPONENTE', 'CAMPUS']

def add_seasonal_lag(dem, col, k, newname):
    """Valor de `col` de k años atrás, mismo TT y misma serie (self-merge)."""
    prev = dem[SERIE + ['ANIO', 'TT', col]].copy()
    prev['ANIO'] = prev['ANIO'] + k          # se ofrece al año siguiente
    return dem.merge(prev.rename(columns={col: newname}),
                     on=SERIE + ['ANIO', 'TT'], how='left')
```

**Los 10 features y su cobertura:**

| Feature | Tipo | Cobertura |
|---|---|---:|
| `ins_lag_1y` | estacional | 69,4% |
| `ins_lag_2y` | estacional | 53,5% |
| `ins_lag_3y` | estacional | 40,7% |
| `ins_roll_mean_3y` | rolling | 72,9% |
| `ins_roll_std_3y` | rolling | 53,6% |
| `ins_lag_prev` | cronológico | **82,3%** |
| `reprob_idx_lag_1y` | estacional | 67,9% |
| `reprob_n_lag_1y` | estacional | 68,1% |
| `reprob_n_prev` | cronológico | 80,4% |
| `reprob_idx_prev` | cronológico | 80,0% |

> [!warning] ⚠️ Los nulos de los lags son ESTRUCTURALES
> No son datos perdidos: la serie **no tiene historia previa**. Se dejan como `NaN` a propósito —CatBoost los maneja nativamente— y los indicadores de madurez (`es_serie_nueva`, `sin_historia_estacional`, `n_periodos_historia`, `antiguedad_serie`) hacen explícito su significado. Imputarlos con cero sería afirmar que hubo cero inscritos, que es falso.

---

## 8 · Bloque E · Conversión a oferta

### 8.1 · Estándar de programación (celda 22) 🔧

Dos columnas que se confunden con facilidad y **no son intercambiables**:

| Columna | Definición | Uso |
|---|---|---|
| `estandar_observado` | `INSCRITOS / n_secciones`, **por fila** | diagnóstico — lo que pasó |
| `estandar_programacion` | promedio del grupo `PERIODO × CAMPUS × COMPONENTE`, **del período homólogo anterior** | el que se usa para dimensionar |

> [!danger] 🚨 Por qué el lag es obligatorio
> `estandar_observado` se construye dividiendo por `INSCRITOS`, que es justo la variable que el modelo predice. Tomar el promedio del **mismo** período significa que el estándar ya "sabe" el resultado → **circularidad**, y §10 lo prohíbe. Con el lag, además, el estándar existe para períodos que aún no ocurren.

**Cascada de búsqueda:**

1. `grupo_lag_1y` — mismo TT del año anterior (202410 → 202510)
2. `grupo_espiral_atras` — grupo más reciente **antes** del período (`merge_asof` backward con `allow_exact_matches=False`)
3. `promedio_global` — último recurso

> [!tip] 💡 `allow_exact_matches=False` no es un detalle
> Es lo que **garantiza** que nunca se use el período actual. Sin ese parámetro, la circularidad volvería por la puerta de atrás.

**Tratamiento asimétrico de actividades masivas** (`TOPE_SECCION = 300`):

| Caso | Decisión | Por qué |
|---|---|---|
| **Presencial > tope** | ⛔ **se excluye la asignatura completa** (R-12) | son actividades institucionales tipo encuesta (`EEDD`, `IAGE`, `CIVU`), no clases → no son demanda de asignatura. 16 asignaturas |
| **ONL > tope** | ⚠️ se **marca** pero no se elimina | son electivos virtuales masivos reales (`CRE2`, `CBB2`, `CVRA`). Solo quedan fuera del cálculo del promedio, para no contaminar el estándar del resto |

Se excluye la **asignatura completa**, no solo la fila que superó el tope: si una asignatura es una encuesta institucional, lo es en todos sus períodos.

> [!info] 📌 `TOPE_SECCION_ONL = 300`
> El p99 real de ONL es **145,3**. Una nota antigua decía 348 y estaba desactualizada.

### 8.2 · Percentiles de ocupación por sección (celda 24c) 🔧

> [!tip] 💡 Por qué vive en el pipeline y no en el ML
> Los percentiles necesitan los inscritos **por NRC**, y el NRC solo existe en el detalle de inscripción (385 MB). La sábana ya viene agregada y lo perdió. Calcularlos aquí cuesta ~6 s; hacerlo en el ML obligaría a releer el CSV grande en cada corrida.

```python
# ⚠️ PERIODO entra en la llave: el NRC se REUTILIZA entre períodos (77% reaparece).
#    Sin él se colapsarían secciones distintas.
_sec = (df[df['RUT'].notna()]
        .groupby(['PERIODO', 'NRC'] + dims[1:], observed=True)['RUT']
        .count().rename('_ins').reset_index())
_gb = _sec.groupby(['PERIODO', 'COMPONENTE', 'CAMPUS'], observed=True)['_ins']
_pc = pd.DataFrame({f'estandar_p{p}': _gb.quantile(p / 100) for p in [25, 50, 75, 90]})
```

| Métrica | Valor |
|---|---:|
| secciones individuales (NRC × período) | 452.695 |
| ocupación por sección | p25 **2** · p50 **9** · p75 **24** · p90 **40** |
| grupos `PERIODO × COMPONENTE × CAMPUS` | 2.439 |
| con <10 secciones (percentil poco fiable) | 724 (29,7%) |
| cobertura · monotonía p25≤p50≤p75≤p90 | 100,0% · verificada |

> [!warning] ⚠️ El grano es COMPONENTE × CAMPUS, no la combinación de la fila
> Medido: al grano fino el **79% de las combinaciones tiene ≤2 secciones**, así que los cuatro percentiles colapsan al mismo número y el abanico p90/p25 queda en 1,2×. A nivel de componente el abanico es real.

**Abanico de tamaño de sección por componente** (últimos 3 años):

| Comp | p25 | p50 | p75 | p90 | Abanico |
|---|---:|---:|---:|---:|---:|
| TEO | 11 | 25 | 48 | 65 | 5,9× |
| LAB | 7 | 15 | 25 | 30 | 4,3× |
| **ELG** | 6 | 12 | 22 | 42 | **7,7×** |
| OCS | 1 | 1 | 3 | 4 | 4,0× |
| TAL | 24 | 32 | 38 | 42 | 1,8× |
| SSA | 9 | 11 | 12 | 12 | 1,3× |
| GRU | 2 | 3 | 5 | 6 | 3,0× |
| **SIM** | 10 | 12 | 12 | 12 | **1,1×** |

> [!abstract] 👔 El hallazgo
> Los componentes con abanico **estrecho** son justo aquellos cuyo estándar teórico **se cumple** (SIM 12, SSA 12, TAL 40): secciones homogéneas porque hay un tope efectivo. Donde el estándar no describe la práctica (TEO, ELG), las secciones se dispersan y el abanico se abre. **El abanico mide qué tan real es la norma.**

> [!warning] ⚠️ Dos p90 distintos para TEO — no es una discrepancia
> Esta tabla da **p90 = 65** para TEO; la celda «Tamaño de sección observado vs estándar normativo» del notebook de despliegue da **71**. Son ventanas distintas y ambas correctas:
> · **aquí**: últimos 3 años, **todos** los TT
> · **allá**: últimos 3 años, **solo TT regulares** (05/10/15/20/25)
> Los TT irregulares (verano, intensivos) tienen secciones más chicas y bajan el percentil. Al citar el dato hay que decir cuál de las dos ventanas se está usando — la conclusión no cambia: la norma (80) está por encima de las dos.

> [!danger] 🚨 Los percentiles NO son features del modelo
> Dependen de los inscritos del propio período (§10). Son insumo de la **conversión a secciones**, que ocurre *después* de proyectar la demanda.

---

## 9 · Trazabilidad y entrega

### 9.1 · Regla y códigos de origen (celda 24b) 🔧

`MATERIA`/`CURSO` en la sábana **ya son el código homologado**. `CODIGOS_ORIGEN` es lo único que permite volver atrás, porque la agregación de la celda 8 funde varios orígenes en una fila y `MATERIA_ORIGEN` no sobrevive a ese `groupby`.

| Métrica | Valor |
|---|---:|
| filas de la sábana | 163.954 |
| asignaturas distintas | 7.732 |
| con `REGLA` asignada | 160.354 (97,8%) · 6.885.684 inscritos |
| sin regla (ninguna malla las reconoce) | 3.600 filas · 196.504 inscritos |
| asignaturas que fusionan varios códigos | 1.181 |
| **máximo de códigos fusionados** | **13** (`DSPU0011`) |

El caso extremo: `DSPU0011` agrupa `FONA0031 | KINE0039 | KINEG006 | NYGAG002 | QYFA1035 | TEOCH006 | TMED0080 | TMED0083 | TMED0086 | TMEDJ003 | TMEDJ007 | TMEDJ010 | TMEDJ013`.

### 9.2 · Export final (celda 25) 🔧

| Formato | Tamaño | Consumidor |
|---|---:|---|
| `DEMANDA_PROCESADA.parquet` | 5,1 MB | **`MODELO_ML_PROYECCION_ASIGNATURAS.ipynb`** |
| `DEMANDA_PROCESADA.csv` | 62,6 MB | revisión en Excel (`sep=';'`, `decimal=','`, `utf-8-sig`) |

> [!warning] ⚠️ El parquet es el que importa
> Preserva dtypes (booleanos, enteros con nulos) que el CSV pierde. El CSV es para revisión humana, no para alimentar el modelo.

> [!info] 📌 `decimal=','` en el CSV
> Excel en configuración es-CL espera **coma** decimal. Sin ese parámetro lee el punto como separador de miles y `22.333333333333332` se muestra como `22.333.333.333.333.332`. Afecta a las 10 columnas con decimales.

**Perfil de nulos de la entrega, por familia:**

| Familia | Rango de nulos | Interpretación |
|---|---|---|
| LLAVE / OBJETIVO | **0,0%** | íntegra por construcción |
| REPROBACIÓN (período) | 4,1% – 4,7% | asignaturas sin historial de notas |
| **LAGS INSCRITOS** | **17,7% – 59,2%** | **estructurales** — la serie no tiene historia |
| LAGS REPROBACIÓN | 19,5% – 32,0% | ídem |
| ATRIBUTOS DE MALLA | 0,8% – 94,3% | `hr_otro` 94,3% es normal: pocas asignaturas tienen "otras horas" |
| MADUREZ DE LA SERIE | 0,0% | calculada, siempre presente |
| AUDITORÍA DEL MATCH | 9,6% – 24,1% | no son features |

### 9.3 · Exports auxiliares

| Celda | Archivo | Para qué |
|---|---|---|
| 2b | `TABLA_REGLAS_RANKING.csv` | validar el ranking de reglas |
| 12c | `MALLA_CON_RANKING_VERSION.csv` | 214.490 × 21 — validar que nivel 1 ≡ vigente |
| 17 | `MAESTRO_MALLAS_ENRIQUECIDO.csv` | 214.490 × 47 · 89,4 MB — revisión en Excel |
| 26 | índice asignatura × componente × período → código de regla | trazabilidad de la homologación |
| 27 | asignaturas únicas por período | validar el cruce |

---

## 10 · Reglas duras que el pipeline implementa 🧭

| Regla | Enunciado | Dónde vive |
|---|---|---|
| **Regla maestra** | asignatura = `materia \|\| curso`, sin separador | transversal |
| **R-01** | el NRC queda fuera del grano objetivo | celda 8 |
| **R-02** | malla vigente = máximo `periodo_reglas` por `cod_programa & codcarrera` | celda 10 |
| **R-09** | la tasa de crecimiento se calcula sobre los períodos del **nivel** | celda 9 |
| **R-12** | las actividades masivas presenciales se excluyen del dataset | celda 22 |
| **§10** | anti-leakage: ninguna variable del período pronosticado entra como feature | celdas 15 · 22 · 24c |
| **D-06** | `PROYECCION_MATRICULA` descartada como driver | celda 5 |
| **Variante D** | homologación en cascada con **diferimiento** | celda 7b |

---

## 11 · Guards — dónde aborta el pipeline 🔧

El pipeline falla ruidosamente, nunca en silencio. Los `raise` activos:

| Celda | Qué verifica |
|---|---|
| 2b | ranking denso aplicado por regla · sin nulos en llaves · sin duplicados en `(regla, periodo, asignatura)` |
| 7b | filas de `df` invariantes · inscripciones invariantes · `n_registros` de `df4` invariante · sin llave duplicada en `df4` · sin ciclos `A→B→A` |
| 12c | `ranking_malla == 1` ≡ `vigente` · ranking parte en 1 · ranking máximo == nº de versiones |
| 24b | ninguna fila sin `ASIGNATURA` |
| 24c | el merge no duplicó filas · cobertura ≥ 99% · monotonía p25≤p50≤p75≤p90 |

**Idempotencia** — casi todas las celdas pueden re-ejecutarse sin corromper el estado: la 7b restaura `df` a los códigos originales antes de rehomologar; las demás hacen `drop(columns=..., errors='ignore')` antes de recrear.

---

## 12 · Métricas salientes — tablero completo 📊

### 12.1 · Volumen

| Etapa | Filas | Δ |
|---|---:|---|
| detalle de inscripción | 7.413.130 | — |
| combinaciones tras agregar (celda 8) | 164.276 | grano objetivo |
| tras excluir masivas presenciales (R-12) | 163.954 | −322 |
| **sábana final exportada** | **163.954 × 61** | 28.996 series |

### 12.2 · Cobertura por familia

| Dato | Cobertura filas | Cobertura inscripciones |
|---|---:|---:|
| nivel académico | 100,0% | 100,0% |
| índice de reprobación | 95,2% | 93,2% |
| atributos de malla (pre-imputación) | 90,3% | 85,7% |
| atributos de malla (post-imputación) | 99,1% | 95,2% |
| percentiles de sección | 100,0% | 100,0% |
| `REGLA` asignada | 97,8% | 97,2% |

### 12.3 · Homologación

| Métrica | Valor |
|---|---:|
| asignaturas históricas | 9.406 |
| resueltas por la cascada | 8.710 (92,6%) |
| **sin cruce** | **696 (7,4%)** |
| cambian de código | 2.237 |
| inscripciones reubicadas | 2.499.295 (33,7%) |
| reducción de códigos | 9.406 → 7.748 (−17,6%) |
| asignaturas alcanzables vs `vigente` | +4.043 (+24,6%) |

### 12.4 · Downstream — qué logra el modelo con esta sábana

Medido en `Análisis_despliegue_modelo.ipynb` sobre 23 períodos cerrados:

| Nivel | N típico | WAPE | Skill vs naive | Error típico |
|---|---:|---:|---:|---:|
| Período | 44.250 | 0,063 | **+17,7%** | 6,2% |
| └ × Campus | 9.888 | 0,086 | +5,4% | 8,0% |
| ⠀⠀├ × Componente | 1.420 | 0,100 | +2,4% | 11,8% |
| ⠀⠀├ × Materia × Curso | 40 | 0,354 | +10,8% | 30,2% |
| ⠀⠀└ **× Componente ⭐ grano** | 23 | 0,356 | **+10,6%** | 29,0% |

> [!abstract] 👔 Lectura
> Al nivel al que se decide, el modelo reduce el error del "igual que el año pasado" en un **11%**. El 4,2% de WAPE institucional no es una medida de calidad: es compensación de errores al sumar.

**Conversión a secciones** (vara: la norma aplicada a inscritos reales):

| Métrica | Valor |
|---|---:|
| desvío del estándar con demanda perfecta | **−27,0%** |
| desvío del criterio operativo (norma sobre P50) | −24,7% |
| **reparto del error** | **88% estándar · 12% modelo** |
| celdas con número exacto de secciones | 66,5% |
| a ±1 sección | 84,3% |

> [!danger] 🚨 El sesgo escala con el tamaño
> En asignaturas de más de 10 secciones (40% del volumen) la norma abre **−46,9% de las secciones reales — con los inscritos verdaderos**. Ningún cambio en el pipeline ni en el modelo toca ese número: sale de que las secciones reales no se abren al tamaño que fija la norma.

---

## 13 · Riesgos y deuda conocida ⚠️

| # | Riesgo | Impacto | Estado |
|---|---|---|---|
| 1 | **696 asignaturas sin cruce** (7,4%) | ninguna malla las reconoce; quedan con `REGLA = NaN` | documentado, no resuelto |
| 2 | **`ESTADO_NRC` no expuesto** en el reporte de inscripción | ambigüedad RE/RW: no se distingue retiro de reprobación | abierto — requiere ampliar la extracción |
| 3 | **337 asignaturas sin ficha** en el catálogo de mallas | 4,82% de las inscripciones sin atributos imputables | documentado (`EEDD`, `IAGE`, `CBB2`) |
| 4 | **103 de 137 niveles ambiguos** resueltos por orden alfabético | asignación de nivel arbitraria en esos casos | bajo impacto (volumen marginal) |
| 5 | **724 grupos con <10 secciones** (29,7%) en los percentiles | el percentil es ruido en esos grupos | marcados, no eliminados |
| 6 | **El estándar teórico excede el p90 observado** en TEO (80 vs 65) y ELG (60 vs 42) | la conversión abre de menos sistemáticamente | ⭐ **conversación pendiente con la Dirección** |

| 7 | `carga_semanal` imputada acierta solo el 67,5% | es intrínsecamente por componente, no por asignatura | mejor proxy disponible (MAE 1,74 vs 7,70) |

---

## 14 · Cómo re-ejecutar 🔧

1. **Intérprete**: Anaconda — `<tu-entorno>\python.exe`. El Python del `PATH` no tiene las dependencias.
2. **Carpeta de datos**: `CARPETA` en la celda 1 — es a la vez origen de los insumos y destino de los exports.
3. **Orden**: secuencial de la celda 0 a la 34. No hay celdas opcionales; las de `INSPECCIÓN` y `DIAGNÓSTICO` no alteran el estado pero documentan la corrida.
4. **`N_SERIES`** (celda 25): `None` = sábana completa. Un entero exporta una muestra de N series completas, útil para pruebas rápidas del notebook de ML.
5. **Después**: correr `MODELO_ML_PROYECCION_ASIGNATURAS.ipynb`, que consume el parquet.

> [!tip] 💡 Re-ejecución parcial
> Las celdas son idempotentes, pero el **orden importa**: la 7b modifica `df` y `df4` in-place. Si se re-ejecuta a mitad de camino, hacerlo desde la 7b (que se auto-restaura) y no desde una celda posterior.

---

## 15 · Documentos relacionados

| Documento | Qué aporta |
|---|---|
| `CONTEXTO_REGLAS_DURAS.md` | las reglas de negocio numeradas (R-xx) y el §10 anti-leakage |
| `PLAN_PROYECCION_DEMANDA_ASIGNATURAS.md` | decisiones de diseño (D-xx) con su justificación |
| `BITACORA_EXPERIMENTOS.md` | experimentos con resultado, incluidos los negativos |
| `DICCIONARIO_ENTREGABLES_PROYECCION.md` | campo por campo de los dos CSV de salida del modelo |
| `CASO_USO_HOMOLOGACION_REGLAS_RANKING.md` | las cuatro variantes de homologación evaluadas |
| `HANDOFF_MODELO_PROYECCION.md` | traspaso operativo |
| `nota-tecnica_2026-07-27_pipeline-*.md` | versión anterior de esta nota (histórica) |

---

*Documento generado el 2026-09-01 sobre la corrida `exec 1–35` del pipeline. Todas las cifras salen de los outputs de esa corrida, no de estimaciones.*

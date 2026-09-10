---
title: "Documento técnico-funcional · MODELO ML de Proyección de Demanda de Asignaturas"
tags:
  - nota-tecnica
  - machine-learning
  - forecasting
  - catboost
  - cuantiles
  - supervivencia
  - proyeccion-demanda
  - asignaturas
  - banner9
audiencias: [tecnico, puente, ejecutivo]
status: activo
type: documento-tecnico-funcional
project: PROYECCION_DEMANDA_ASIGNATURAS
notebook: MODELO_ML_PROYECCION_ASIGNATURAS.ipynb
version: "1.0"
fecha_creacion: 2026-09-01
ultima_actualizacion: 2026-09-01
owner: Diego Evans Pérez
author: Diego Evans Pérez Paz
---

# Documento técnico-funcional · MODELO ML de Proyección de Demanda de Asignaturas

> [!info] 📌 Ficha
> **Artefacto**: `MODELO_ML_PROYECCION_ASIGNATURAS.ipynb` (27 celdas)
> **Versión**: 2026-09-01 · modelo vigente **v5 — CatBoost** (D-29, D-31)
> **Función**: proyectar **inscritos** por `PERIODO × MATERIA × CURSO × COMPONENTE × CAMPUS`, con salida puntual (P50) y probabilística (P10/P90), supervivencia y conversión a secciones
> **Insumo**: `DEMANDA_PROCESADA.parquet` — 163.954 × 61 (producido por el pipeline)
> **Salida**: `PROYECCION_INSCRITOS_2026_2027.csv` (22.142 × 36) · `SERIE_COMPLETA_REAL_VS_PROYECTADO.csv` (78.125 × 35)
> **Tiempo de corrida**: ~50 min completo · ~20 min saltando las 3 celdas diagnósticas

**Cómo leer este documento.** Usa un sistema de audiencias: 🔧 detalle técnico · 🧭 puente entre negocio y técnica · 👔 lectura ejecutiva. Las secciones §1–§3 son 👔🧭; §4–§11 son 🔧🧭; §12–§15 son transversales.

---

## 1 · Qué resuelve este modelo 👔

La pregunta de negocio es **cuántos estudiantes se inscribirán en cada asignatura el próximo período**, para dimensionar secciones, cupos, salas y dotación docente.

El modelo responde con **tres cifras y una probabilidad**:

| Salida | Pregunta que responde | Ejemplo |
|---|---|---|
| **P50** | ¿cuántos alumnos si la asignatura se dicta? | 53 |
| **P10 / P90** | ¿cuál es el piso y techo razonable? | 38 – 71 |
| **PROB_SE_DICTA** | ¿va a abrirse? | 0,94 |
| **P50_ESPERADO** | ¿cuánto sumo al total institucional? | 50 |

> [!abstract] 👔 En una frase
> El modelo no predice un número: entrega un **parte meteorológico** — máxima, mínima, lo más probable, y la probabilidad de que el evento ocurra. Planificar salas con la máxima es prudente; presupuestar con la máxima es caro. Y si la probabilidad de que se abra es 22%, lo primero es decidir si se abre.

> [!danger] 🚨 La regla que no se puede violar
> **`P50_ESPERADO` para SUMAR · `P50` para DIMENSIONAR.**
> Sumar `P50` infla el total en **99.745 inscritos (8,9%)** — demanda asignada a asignaturas que no se abrirán. Dimensionar con `P50_ESPERADO` aplica el descuento dos veces. Detalle completo en [`DICCIONARIO_ENTREGABLES_PROYECCION.md`](DICCIONARIO_ENTREGABLES_PROYECCION.md) §2.

---

## 2 · Arquitectura del modelo — las cinco capas

```
┌─ CAPA 1 · BASE ──────────────────────────────────────────────────────┐
│  ins_lag_1y (seasonal naive)                                         │
│  aporta el NIVEL — la extrapolación que los árboles no pueden dar    │
└──────────────────────────────────────────────────────────────────┬────┘
                                                                   │
┌─ CAPA 2 · CATBOOST ─────────────────────────────────────────────┤────┐
│  target = log1p(y) − log1p(naive)                                │    │
│  aprende la CORRECCIÓN relativa al naive, centrada en 0          │    │
│  47 features · walk-forward · 7 orígenes                         │    │
└──────────────────────────────────────────────────────────────────┤────┘
                                                                  │
┌─ CAPA 3 · BLEND ────────────────────────────────────────────────┤────┐
│  p = w · p_catboost + (1−w) · naive                              │    │
│  w calibrado en fold de validación (último período del train)    │    │
│  solo controla la DISTRIBUCIÓN, no el nivel                      │    │
└──────────────────────────────────────────────────────────────────┤────┘
                                                                  │
┌─ CAPA 4 · RECONCILIACIÓN ───────────────────────────────────────┤────┐
│  escala ∀ filas para que Σ = Σ(naive) × fac                      │    │
│  fac = 0,9878 (mediana histórica de la tasa persistente)         │    │
│  fija el NIVEL — lo que el modelo no puede extrapolar            │    │
└──────────────────────────────────────────────────────────────────┤────┘
                                                                  │
┌─ CAPA 5 · SUPERVIVENCIA ────────────────────────────────────────┤────┐
│  P50_ESPERADO = P50 × P(se dicte)                                │    │
│  descuenta las series que morirán                                │    │
│  AUC 0,826 · tasa 81,8%                                         │    │
└──────────────────────────────────────────────────────────────────┴────┘
```

> [!tip] 💡 Por qué no predecir inscritos directo
> *"Un árbol nunca predice fuera del rango visto en train."* Con la matrícula creciendo +18%/+25% anual, el modelo v0 (nivel directo) se aplanaba en el techo histórico y **perdía contra el seasonal naive por 21%** (WAPE 0,466 vs 0,385). Sesgo degradándose de −0,16 (2023) a −0,39 (2026). La reformulación como corrección resolvió el problema de raíz: el naive aporta el nivel, el modelo solo aprende cuánto corregirlo.

---

## 3 · Métricas vigentes — el scorecard 🧭

> [!important] 📏 Dos bases de medición, y no son intercambiables
> Este documento reporta cifras de **dos poblaciones distintas**. Confundirlas es la
> causa más común de discrepancias entre este documento, el panel y los notebooks.
>
> | Base | Qué es | Volumen |
> |---|---|---|
> | **Auditoría de despliegue** | El entregable final contra lo realmente ocurrido, sobre `SERIE_COMPLETA` | 55.983 celdas · 23 períodos (202205–202615) |
> | **Validación de modelado** | El walk-forward durante el desarrollo, sobre el dataset filtrado por `TT_MODELO` | 144.662 filas · 21.456 series · 55 períodos |
>
> **§3 reporta la auditoría de despliegue** — es la que manda, la que alimenta el
> panel y la única que mide lo que se entregó. Las §6 y §7 conservan las cifras de
> validación porque documentan el proceso de decisión, no el resultado final.

### 3.1 Modelo puntual · auditoría de despliegue

Sobre 55.983 celdas y 2.612.770 inscritos. Cada cifra con su vara al lado:

| Métrica | Naive estacional | **Modelo** | Referencia |
|---|---:|---:|---|
| **WAPE** | 0,398 | **0,356** | **+10,6 % de skill** |
| **MAE** | 18,6 | **16,6** | inscritos por combinación |
| **MASE** | 1,000 | **0,894** | escala = MAE del naive out-of-sample |
| **R²** | 0,653 | **0,670** | el modelo aporta 0,017 |
| RMSE | — | 42,7 | expone la cola de error |
| sMAPE | — | 0,415 | |
| **Sesgo** | — | **+4,2 %** | sobreproyecta en el agregado |

> [!warning] ⚠️ Hay dos MASE en este proyecto y ambos son correctos
> El **0,894** de arriba usa como escala el **MAE del naive estacional
> out-of-sample**, sobre la misma base comparable. La escala canónica de Hyndman
> —**MAE in-sample del naive de un paso, solo con train**— da en cambio **1,489**,
> contra un baseline de **1,630**.
>
> No se contradicen — normalizan contra tareas distintas. El naive de un paso
> in-sample es mucho más fácil de batir que el estacional out-of-sample, y por eso
> ambos valores quedan sobre 1 en esa convención. **En las dos, el modelo queda por
> debajo de su baseline**, que es lo que la métrica debe responder. Al citarlo fuera
> de contexto, decir siempre qué escala se usó.

> [!important] 🎯 Criterio de éxito
> *"Si no le ganas al seasonal naive con holgura, no tienes modelo — tienes decoración."*
> El skill de **+10,6 %** es la respuesta. Lo que lo refuerza es el comportamiento del
> sesgo: para dimensionar cupos, un error simétrico vale más que uno menor pero
> sistemáticamente corrido hacia un lado.

### 3.2 Cuantiles (CatBoost + CQR) · auditoría de despliegue

| Criterio | Nominal | Real | |
|---|---:|---:|---|
| Cobertura P10 | 10 % | 20,1 % | |
| Cobertura P50 | 50 % | **63,0 %** | ⚠️ descentrado |
| Cobertura P90 | 90 % | **93,3 %** | ✅ |
| **Intervalo P10–P90** | **80 %** | **75,2 %** | ⚠️ apretado |
| Ancho medio | — | 47,3 | |
| Pinball loss | — | 5,59 | |

> [!warning] ⚠️ El intervalo cubre menos de lo que promete
> 75,2 % contra un nominal de 80 %. En validación (§7.2) daba 79,1 %: la brecha
> aparece al llevarlo al entregable completo, donde entra el horizonte 2 con su banda
> sin recalibrar. Está medido y declarado — una banda mal calibrada que se conoce es
> utilizable; una que no se midió, no.

### 3.3 Supervivencia

| Métrica | Valor |
|---|---|
| AUC | 0,826 |
| Tasa de supervivencia | 81,8% |
| Ajuste sobre el entregable | −8,9% (P50 1.126.278 → P50_ESPERADO 1.026.533) |

### 3.4 Horizonte 2

| Métrica | Valor |
|---|---|
| `FACTOR_H2` | 1,165 (degradación +16,5%) |
| Bandas calibradas | ❌ No — `banda_calibrada = False` en h2 |

### 3.5 Conversión a secciones

| Métrica | Valor |
|---|---|
| Exactitud (P50 = real) | 53,8% |
| Techo (demanda real → secciones reales) | 65,8% |
| **Reparto del error** | **88% estándar · 12% modelo** |

---

## 4 · Mapa del notebook (27 celdas) 🔧

```
[0] SETUP ──► [1-4] EDA + CLUSTERING ──► [5] BASELINE WALK-FORWARD
                                                      │
     [11] v3 blend ◄── [10] v2 tendencia ◄── [6-9] v0→v1 MODELOS
       │
       └──► [12] F4g · v5 CatBoost ──► [13] F4g-bis · ranking 🆕
                                    │          (diagnóstica)
                                    ├──► [14] F4g-ter · pruebas 🆕
                                    │          (diagnóstica)
                                    ├──► [15] F4h · error por segmento
                                    │
                                    ├──► [16] F4i · ponderación
                                    │
                                    ├──► [17] F4j · SUPERVIVENCIA
                                    │
                                    ├──► [18-19] F5/F5b · CUANTILES + CQR
                                    │
                                    ├──► [20] F5c · ¿CatBoost cuantil? 🆕
                                    │          (diagnóstica)
                                    ├──► [21] F6 · demanda → secciones
                                    │
                                    ├──► [22] F7a · BACKTESTING h2
                                    │
                                    ├──► [23] F7b · PROYECCIÓN → CSV 1
                                    │
                                    ├──► [24] F7c · SERIE COMPLETA → CSV 2
                                    │
                                    ├──► [25] F7d · CÓDIGO PROGRAMABLE 🆕
                                    │
                                    └──► [26] F7e · SECCIONES 🆕
```

| # | Fase | Qué hace | Tiempo |
|---|---|---|---|
| 0 | Setup | Carga el parquet, aplica filtro `TT_MODELO` | 5 s |
| 1–4 | **F2** · EDA + clustering | Estacionalidad, correlación, K-Means/HDBSCAN | 2 min |
| 5 | **F3** · Baseline | Seasonal naive + walk-forward (7 orígenes) | 3 min |
| 6–11 | **F4** · v0→v3 | Nivel → corrección → tendencia → blend | 8 min |
| **12** | **F4g** · v5 | CatBoost sin `REGLA` · define `_cat_str`, `_CatWrap`, `_fit_corr_v4` | 6 min |
| 13 | F4g-bis | Ranking de algoritmos + ensemble + importancia | ⏭️ 14 min |
| 14 | F4g-ter | Pruebas: ¿REGLA? ¿CatBoost? ¿qué sobra? | ⏭️ 14 min |
| 15 | **F4h** | Error por segmento · define `WAPE_SERIE` | 1 min |
| 16 | F4i | Experimento ponderación por volumen | 1 min |
| **17** | **F4j** | Modelo de supervivencia | 2 min |
| 18–19 | **F5 · F5b** | Cuantiles P10/P50/P90 + CQR | 14 min |
| 20 | F5c | ¿CatBoost en cuantiles? (diagnóstica, ya decidió D-31) | ⏭️ 14 min |
| 21 | **F6** | Demanda → secciones | 30 s |
| **22** | **F7a** | Backtesting de horizonte 2 · define `FACTOR_H2` | 1 min |
| **23** | **F7b** | Proyección multi-período → CSV 1 | 30 s |
| **24** | **F7c** | Serie completa → CSV 2 | 1 min |
| **25** | **F7d** | `CODIGO_PROGRAMABLE` en ambos CSV | 20 s |
| **26** | **F7e** | Secciones — estándar + 4 escenarios percentil | 10 s |

**⏭️** = celda diagnóstica, saltable. No alimenta celdas posteriores.

**Orden obligatorio:** `F4g → F4h → F4j → F5 → F5b → F7a → F7b → F7c → F7d → F7e`. La F7b consume `WAPE_SERIE` (15), `MODELO_SV` (17), `_Q` (19) y `FACTOR_H2` (22).

> ⚠️ `_fit_cuantil` (celda 18) usa `_cat_str` y `_CatWrap`, definidas en la celda **12**. Si se reordenan, rompe.

---

## 5 · La validación — walk-forward (Tashman, 2000) 🔧

Única validación honesta en forecasting. Para cada origen `t`: entrenar con **todo lo anterior** a `t`, predecir `t`. Nunca K-Fold aleatorio — barajar el tiempo es entrenar con el diario de mañana.

```
 fold 1: [████ train ████][t]
 fold 2: [██████ train ██████][t]
 fold 3: [████████ train ████████][t]
 ...
 fold 7: [██████████████████████████████ train █████████████████████][t]
```

**Orígenes:** `202310, 202320, 202410, 202420, 202510, 202520, 202610` (7 períodos cerrados).

**Métricas (Hyndman y Koehler, 2006):**

| Métrica | Uso |
|---|---|
| **WAPE** | `Σ|y−ŷ| / Σy` — **ponderado por tamaño**: cada celda pesa por sus alumnos. Robusto con ceros y agrega bien |
| **MASE** | Referencia comparable entre series; escala = MAE in-sample del naive, **solo con train** |
| **Sesgo** | `Σ(ŷ−y)/Σy` — ¿sobre o sub-proyecta? |
| MAE / RMSE | Interpretable en inscritos; RMSE expone la cola |
| Pinball + **cobertura** | Cuantiles (Romano et al., 2019) |

---

## 6 · El modelo puntual — de v0 a v5 🔧

### 6.1 El fracaso que definió la arquitectura

| v0 · nivel directo | WAPE | Sesgo |
|---|---|---|
| LightGBM | 0,466 | −0,267 |
| XGBoost | 0,475 | −0,263 |
| CatBoost | 0,475 | −0,283 |

**Los tres perdieron contra el baseline por ~21%.** Causa: los árboles no extrapolan tendencia. `CURSO` y `MATERIA` fueron las features #1 y #2 — el modelo memorizaba identidad en vez de aprender dinámica.

### 6.2 La reformulación como corrección

```python
target      = log1p(INSCRITOS) − log1p(ins_lag_1y)     # centrada en 0
predicción  = expm1( log1p(ins_lag_1y) + corrección )
```

### 6.3 Evolución medida

> [!note] 📏 Base de validación, no de despliegue
> Las cifras de esta tabla salen del **walk-forward de modelado** (144.662 filas ·
> 21.456 series), que es la base sobre la que se tomaron las decisiones. Por eso el
> ganador marca 0,344 y no el **0,356** de la auditoría de despliegue (§3.1): son
> poblaciones distintas. Lo comparable entre versiones es el orden, no el nivel
> absoluto.

| Versión | Qué agrega | WAPE | vs baseline | Sesgo |
|---|---|---|---|---|
| v0 · nivel | — | 0,466 | ❌ −21,1% | −0,267 |
| v1 · híbrido | target = corrección | 0,373 | ✅ +3,0% | −0,134 |
| v2 · + tendencia | `crec_inst/sede/mat` | 0,361 | ✅ +6,2% | −0,115 |
| v3 · blend | mezcla con baseline | 0,356 | ✅ +7,4% | −0,104 |
| v3 · + calib | factor por sede | 0,358 | ✅ +6,8% | −0,048 |
| **v5 · CatBoost sin REGLA** ⭐ | D-28, D-29 | **0,344** | ✅ **+9,1%** | **+0,004** |
| *baseline* | — | *0,379* | — | *+0,029* |

### 6.4 Por qué se eliminó `REGLA` (Exp. 9)

`REGLA` era la feature #1 en importancia (17,19%) pero con 3.516 niveles para ~100K filas (~29 filas/categoría), **memorizaba en vez de generalizar**:

| Configuración | WAPE | Ventaja vs baseline |
|---|---|---|
| LightGBM **con** REGLA | 0,3707 | +2,21% |
| LightGBM **sin** REGLA | 0,3565 | +5,97% |
| CatBoost **con** REGLA | 0,3461 | +8,69% |
| **CatBoost sin REGLA** ⭐ | **0,3450** | **+8,99%** |

> [!important] 📌 Importancia alta ≠ aporte
> La importancia de una feature no dice si ayuda a generalizar. Solo el error out-of-sample lo dice.

### 6.5 El blend y la reconciliación

**Blend:** `w × modelo + (1−w) × baseline`, con `w` aprendido en fold de calibración (último período del train), nunca mirando el test. En `202610` bajó a `w = 0,60` por sí solo.

**Reconciliación:** el blend no controla el nivel del total. La capa 4 escala todas las filas para que `Σ = Σ(naive) × fac`, donde `fac = 0,9878` es la mediana histórica de la tasa persistente.

> [!warning] ⚠️ El `fac` es una constante sobre una serie muy volátil
> σ = **5,2 pp** · rango 0,886–1,058 · salto máximo año-a-año 12,7 pp. El modelo se desvía **+11 a +13%** en los años donde la tasa cae (2022, 2024). **Ningún estimador constante lo arregla** — media y mediana fallan en los mismos años. (Exp. 12)
>
> **El TT10 ya cerrado tiene correlación +0,912 con la tasa del año** y MAE 1,91 pp. El ancla histórica tiene correlación **−0,380** — se mueve en dirección contraria. El dato existe y no se usa. (Decisión de cerrar el ciclo el 2026-08-28)

---

## 7 · Los cuantiles — P10 / P50 / P90 (Romano et al., 2019) 🔧

### 7.1 Arquitectura

Tres modelos CatBoost independientes, cada uno con una pérdida pinball distinta:

```
_fit_cuantil(τ=0.10)  → P10  (escenario bajo)
_fit_cuantil(τ=0.50)  → P50  (estándar)
_fit_cuantil(τ=0.90)  → P90  (escenario alto)
```

El target es `log1p(INSCRITOS)` directo (no la corrección) — porque el cuantil busca la **distribución condicional completa**, no solo el centro.

### 7.2 Calibración conformal (CQR)

Los cuantiles crudos no tienen cobertura garantizada. La CQR (Conformal Quantile Regression) los ensancha lo justo:

```python
Q_conformal = quantile(|y − P50_crudo|, 1 − α, sobre el último fold)
P10_calibrado = P10_crudo − Q
P90_calibrado = P90_crudo + Q
```

**Resultado:**

| | Crudo | Tras CQR |
|---|---|---|
| Cobertura P90 | 84,5% | **89,7%** |
| Intervalo 80% | 67,9% | **79,1%** |
| Ancho medio | 53,0 | 64,9 |

### 7.3 Por qué se midió antes de migrar a CatBoost (Exp. 10)

Dos precedentes de que lo que funciona en el puntual no se traslada al cuantil:
- D-17: `sample_weight` descentra el P50
- D-18: el P50 puntual estima la media geométrica y sub-proyecta 16,3%

El veto era que el **centrado del P50** cayera fuera de [48%, 52%]. CatBoost pasó con 50,5%.

> [!caution] ⚠️ Cuantiles cruzados en TT chicos
> En `202725` (TT chico + horizonte 2), los cuantiles cruzados pasan de 0,05% a **2,67%**. Las tres funciones de loss se entrenan independientes y donde hay pocos datos, CatBoost sobreajusta la distribución condicional. El reordenamiento por fila (`np.sort`) los absorbe, pero **enmascara el problema sin resolverlo**. Si el % sube mucho más, revisar. (D-32)

---

## 8 · El modelo de supervivencia 🔧

### 8.1 Qué predice

Probabilidad de que una serie `MATERIA × CURSO × COMPONENTE × CAMPUS` que existió en el período fuente **siga existiendo** en el período destino: `P(se dicte)`.

### 8.2 Diseño

Clasificador binario (LightGBM) sobre la transición período-a-período:

```
y = 1  si la serie aparece en el período siguiente (del mismo TT)
y = 0  si desaparece
```

Features: lags de inscritos, antigüedad, tendencia, nivel, campus, componente. **No usa features del período futuro** (§10 anti-leakage).

### 8.3 Métricas

| Métrica | Valor |
|---|---|
| AUC | 0,826 |
| Tasa de supervivencia global | 81,8% |
| Umbral | 0,5 |
| Ajuste neto sobre el entregable | −8,9% |

### 8.4 Guards 🔧

Tres guards que abortan si los datos están contaminados:

| Guard | Condición | Por qué existe |
|---|---|---|
| Tasa global | fuera de [55%, 95%] | Un período parcial contamina catastróficamente (Exp. 2: P = 0,025 vs ~0,77) |
| Tasa por período | algún período < 30% | Aísla la contaminación a un período específico |
| Mínimo de filas | < 100 en train | Evita entrenar sobre ruido |

> [!danger] 🚨 Un período presente pero incompleto es peor que uno ausente
> El Exp. 2 documentó que el notebook solo "funcionaba" al reejecutarlo sin reiniciar el kernel, heredando `PERIODOS_PARCIALES` de la corrida anterior. Ahora se calculan in situ. Lección transferible: cualquier cálculo por período debe preguntarse si ese período está cerrado.

---

## 9 · El horizonte 2 — proyección encadenada 🔧

Para proyectar más allá del período inmediato, el modelo se alimenta de su propia salida:

```
h1: ins_lag_1y = dato REAL del año anterior     → 5 períodos (202620–202715)
h2: ins_lag_1y = PROYECCIÓN del h1              → 2 períodos (202720, 202725)
```

**Backtesting (F7a):** se mide la degradación reentrenando con 2 años de desventaja y comparando:

| Métrica | h1 | h2 | Degradación |
|---|---|---|---|
| WAPE | **0,414** | **0,482** | **+16,5 %** |
| Sesgo | −0,076 | −0,155 | se duplica |
| `FACTOR_H2` | 1,000 | **1,165** | se aplica al ancho de banda |

Medido sobre 4 pares de orígenes encadenados (202320→202420, 202420→202520,
202310→202410, 202410→202510), entre 2.612 y 3.123 celdas cada uno.

> [!warning] ⚠️ La banda del h2 NO está calibrada por CQR
> `banda_calibrada = False` en todas las filas de h2. El `FACTOR_H2` ensancha el intervalo proporcionalmente, pero no es una calibración conformal. Usar con más cautela.

---

## 10 · Regla anti-leakage (Tashman, 2000) 🔧

> [!danger] 🚨 Todo mira solo al pasado
> **Ninguna variable del período que se pronostica entra como feature.** El notebook aborta si detecta una prohibida.

**Columnas prohibidas como features** (están en la sábana para diagnóstico, no para modelar):

```
indice_reprobacion · n_reprobados · n_aprobados · n_registros · n_evaluados
tasa_reprobacion · INSCRITOS · n_secciones · estandar_observado
```

**Columnas permitidas** — solo sus versiones con lag:

```
ins_lag_1y · ins_lag_2y · ins_lag_3y · ins_roll_mean_3y · ins_roll_std_3y
ins_lag_prev · reprob_idx_lag_1y · reprob_n_lag_1y
reprob_n_prev · reprob_idx_prev
```

---

## 11 · La conversión a secciones (F6 · F7e) 🔧🧭

### 11.1 La fórmula

```python
N_SECCIONES_TEORICAS_PROYECTADAS = ceil(P50 / estandar_teorico × 1,10)
```

El `× 1,10` es un colchón explícito — regla dura del negocio.

### 11.2 Los cuatro escenarios (F7e)

| Escenario | Denominador | Lectura |
|---|---|---|
| `N_SECCIONES_TEORICAS_PROYECTADAS` | Estándar teórico (norma) | Mínimo normativo — el piso |
| `N_SECCIONES_PROMEDIO` | Promedio observado (2 años) | Lo que realmente se hace |
| `N_SECCIONES_P75` | p75 observado | Secciones "llenas" |
| `N_SECCIONES_P50` | p50 observado (mediana) | Secciones "típicas" |

### 11.3 El hallazgo: 88% estándar · 12% modelo (Exp. 15)

| Eslabón | WAPE | Exacta | Sesgo |
|---|---|---|---|
| Solo el ESTÁNDAR (inscritos reales) | 0,360 | 71,9% | −27,0% |
| ESTÁNDAR + MODELO (con P50) | 0,417 | 66,5% | −24,7% |
| **Diferencia = costo del modelo** | **+0,057** | −5,4% | +2,3% |

> [!abstract] 👔 La palanca está en revisar el estándar, no en afinar la proyección
> En asignaturas de más de 10 secciones (40% del volumen) la norma abre **−46,9% de las secciones reales — con los inscritos verdaderos**. Mejorar el modelo de demanda solo puede atacar el 12% del error de conversión. El 88% restante lo resuelve calibrar cuántos alumnos caben realmente por sección.

---

## 12 · A qué grano el modelo aporta (Exp. 14) 📊

| Nivel | N típico | WAPE | Skill vs naive | Error típ. |
|---|---|---|---|---|
| Período | 44.250 | 0,063 | **+17,7%** | 6,2% |
| └ × Campus | 9.888 | 0,086 | +5,4% | 8,0% |
|   ├ × Componente | 1.420 | 0,100 | +2,4% | 11,8% |
|   ├ × Materia × Curso | 40 | 0,354 | +10,8% | 30,2% |
|   └ **× Componente ⭐ grano** | 23 | 0,356 | **+10,6%** | 29,0% |

> [!warning] ⚠️ El WAPE baja al agregar y eso NO es mérito del modelo
> Es compensación de errores de signo opuesto al sumar. Un WAPE institucional de 0,04 no significa "4% de error" en nada que se decida. El skill score es lo único comparable entre niveles.

**`N típico` es la columna de entrada:** se busca la fila cuyo N se parezca al volumen a proyectar y se lee el error a la derecha.

---

## 13 · Lo que NO cubre ⛔

| Límite | Magnitud | ¿Mejorable? |
|---|---|---|
| **Postgrado** | `TT 00`: ~436.000 inscritos fuera | Sí — reincorporar |
| **Asignaturas nuevas** | 19–29% de las series del destino | Requiere otro modelo |
| **Error por fila** | 57,8% de las combinaciones se desvía >20% | ❌ Piso a este grano |
| **Horizonte 2** | +16,5% de degradación | ❌ Inherente a encadenar |
| **El crecimiento institucional** | tasa 0,974 (existentes) vs 1,080 (total) | La diferencia viene de asignaturas **nuevas** |

> [!warning] ⚠️ El total NO es una proyección de matrícula institucional
> El modelo proyecta lo que harán las series **que ya existen**. Comparar contra una meta de matrícula lleva a concluir erróneamente que sub-proyecta.

---

## 14 · Guards — dónde aborta el notebook 🔧

| Guard | Celda | Condición |
|---|---|---|
| Features del v4 ausentes | F4g | `ValueError` si falta alguna en `_d2` |
| Tasa de supervivencia global | F4j | fuera de [55%, 95%] |
| Supervivencia por período | F4j | algún período < 30% |
| WAPE absurdo | F4j | transición con WAPE > 3 |
| P(se dicte) media | F7b | < 0,45 ponderado por volumen |
| Período fuente parcial | F7b | aborta si la fuente no cerró |
| Integridad de la grilla | F7b | si un merge altera el nº de filas |
| Cuantiles cruzados | F5b | log si el % supera un umbral |

---

## 15 · Riesgos y deuda conocida ⚠️

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | `fac = 0,9878` estático — σ = 5,2 pp, correlación −0,380 con lo que predice | 🔴 Alta | Mitigable con ancla TT10 (r = +0,912), no implementado |
| 2 | Asignaturas nuevas (19–29% del destino) | 🟠 Alta | Sin modelo — requiere predecir aperturas |
| 3 | CatBoost menos estable en TT chicos — cuantiles cruzados 2,67% | 🟡 Media | Tapado por reordenamiento, vigilar % |
| 4 | Top 10% del error concentra 54% del error absoluto | 🟠 Alta | Solo atacable con overrides manuales — sin implementar |
| 5 | Sin scheduler ni monitoreo de drift | 🟠 Alta | El modelo no se actualiza solo |
| 6 | Supervivencia nunca tuneada | 🟡 Media | AUC 0,826 con defaults |

---

## 16 · Cómo re-ejecutar 🔧

1. **Intérprete**: Anaconda — `<tu-entorno>\python.exe`. El `py` del sistema NO tiene `lightgbm`.
2. **Insumo**: `DEMANDA_PROCESADA.parquet` — producido por `PIPELINE_PROYECCION_ASIGNATURAS.ipynb`.
3. **Orden**: secuencial de la celda 0 a la 26. Las celdas 13, 14 y 20 son diagnósticas y pueden saltarse (~30 min de ahorro).
4. **`TT_MODELO = [5, 10, 15, 20, 25]`** en la celda 0. Modificarlo cambia el universo completo.
5. **Recargar desde disco** antes de ejecutar, después de cualquier parche externo. Pasó tres veces que el editor sobrescribió los cambios.
6. **Cerrar los CSV en Excel** antes de exportar — `PermissionError`.

> [!tip] 💡 Re-ejecución parcial
> Las celdas F7d y F7e son idempotentes y reejecutables solas (~20 s). Si solo cambia el criterio de código programable o de secciones, basta con correr esas celdas al final.

---

## 17 · Documentos relacionados

| Documento | Qué aporta |
|---|---|
| [`RESUMEN_EJECUTIVO.md`](RESUMEN_EJECUTIVO.md) | El proyecto completo en diez minutos |
| [`DOCUMENTO_TECNICO_FUNCIONAL_PIPELINE.md`](DOCUMENTO_TECNICO_FUNCIONAL_PIPELINE.md) | La sábana de datos que alimenta este modelo |
| [`DICCIONARIO_ENTREGABLES_PROYECCION.md`](DICCIONARIO_ENTREGABLES_PROYECCION.md) | Los dos CSV campo por campo, con recetas SQL |
| [`Análisis_deploy_modelo.ipynb`](../Notebooks/Análisis_deploy_modelo.ipynb) | Auditoría post-producción (17 celdas) |

---

---

## 18 · Volumetría y performance 🔧🧭

### 18.1 Insumo

| Objeto | Filas | Columnas | Peso | Formato |
|---|---|---|---|---|
| `DEMANDA_PROCESADA.parquet` (total) | 163.954 | 61 | 5,1 MB | Parquet (Snappy) |
| Dataset tras filtro `TT_MODELO` | **144.662** | 61 | ~4,5 MB | en memoria |
| Series únicas en el modelo | **21.456** | — | — | — |
| Períodos | 55 | — | — | 201510–202620 |
| Inscripciones representadas | **6.608.810** | — | — | 93,3% del total |

### 18.2 Salidas exportadas

| Archivo | Filas | Columnas | Peso | Períodos | Separador | Decimal |
|---|---|---|---|---|---|---|
| `PROYECCION_INSCRITOS_2026_2027.csv` | **22.142** | 36 | ~5,0 MB | 7 futuros (5 h1 + 2 h2) | `;` | `,` |
| `SERIE_COMPLETA_REAL_VS_PROYECTADO.csv` | **78.125** | 35 | ~14,6 MB | 30 (2022–2027) | `;` | `,` |
| **Total exportado** | **100.267** | — | **~19,6 MB** | — | — | — |

> [!info] 📌 Formato de los CSV
> Ambos con separador `;` y decimal `,` — abren directo en Excel sin importador. Codificación UTF-8 con BOM.

### 18.3 Volúmenes intermedios en memoria

| Variable | Filas | Descripción |
|---|---|---|
| Folds walk-forward (7 orígenes) | 7 × ~120K train + ~20K test | El fold más grande tiene ~140K filas |
| Modelos entrenados por corrida | **7** (uno por origen) × **4** (puntual + 3 cuantiles) = **28 modelos** | + 7 de supervivencia = **35 total** |
| Predicciones acumuladas | ~144K filas × 7 columnas de salida | P10, P50, P90, corrección, blend, supervivencia, secciones |
| Grilla de proyección (F7b) | **22.142** filas × 7 períodos | Generada expandiendo la grilla del período fuente |
| Serie completa (F7c) | **78.125** filas | Reentrenando año por año con solo el pasado |

### 18.4 Tiempo de corrida

**Máquina de referencia:** laptop con CPU Intel Core i7, 16 GB RAM, SSD NVMe. Sin GPU — CatBoost corre en CPU.

| Bloque | Celdas | Tiempo | Saltable |
|---|---|---|---|
| Setup + carga | 0 | ~5 s | No |
| EDA + clustering | 1–4 | ~2 min | No |
| Baseline walk-forward | 5 | ~3 min | No |
| Modelos v0→v3 (históricos) | 6–11 | ~8 min | No |
| **F4g · v5 CatBoost** | **12** | **~6 min** | No |
| F4g-bis · ranking + ensemble | 13 | ~14 min | ⏭️ **Sí** |
| F4g-ter · pruebas configuración | 14 | ~14 min | ⏭️ **Sí** |
| F4h · error por segmento | 15 | ~1 min | No |
| F4i · ponderación | 16 | ~1 min | No |
| **F4j · supervivencia** | **17** | **~2 min** | No |
| **F5/F5b · cuantiles + CQR** | **18–19** | **~14 min** | No |
| F5c · ¿CatBoost cuantil? | 20 | ~14 min | ⏭️ **Sí** |
| F6 · secciones | 21 | ~30 s | No |
| **F7a · backtesting h2** | **22** | **~1 min** | No |
| **F7b · proyección → CSV 1** | **23** | **~30 s** | No |
| **F7c · serie completa → CSV 2** | **24** | **~1 min** | No |
| **F7d · código programable** | **25** | **~20 s** | No |
| **F7e · secciones entregables** | **26** | **~10 s** | No |
| | | | |
| **TOTAL completo** | 0–26 | **~50 min** | — |
| **TOTAL sin diagnósticas** | saltando 13, 14, 20 | **~20 min** | — |
| **Solo re-exportar** (F7d + F7e) | 25–26 | **~30 s** | — |

> [!tip] 💡 El cuello de botella es el entrenamiento de cuantiles
> Las celdas F5/F5b consumen ~14 min (28% del total) porque entrenan 21 modelos CatBoost (3 cuantiles × 7 orígenes). El modelo puntual (F4g) toma ~6 min (7 modelos). Las fases de exportación (F7b–F7e) son triviales (~2 min combinadas).

### 18.5 Pico de memoria

| Momento | RAM estimada |
|---|---|
| Carga del parquet | ~200 MB |
| Pico durante walk-forward (7 modelos CatBoost en memoria) | ~1,2 GB |
| Exportación final | ~400 MB |
| **Mínimo recomendado** | **4 GB libres** |

> [!warning] ⚠️ Los 35 modelos se entrenan en CPU
> CatBoost no usa GPU en esta configuración. El tiempo de corrida escala linealmente con el número de cores disponibles para threading. En una máquina con 4 cores, esperar ~50 min; con 8 cores, ~35 min.

---

*Documento generado el 2026-09-01 sobre la corrida vigente del notebook ML (27 celdas, modelo v5 CatBoost). Todas las cifras provienen de los outputs de esa corrida y de la bitácora de experimentos, no de estimaciones.*

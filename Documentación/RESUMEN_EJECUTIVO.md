---
date: 2026-09-09
type: resumen-ejecutivo
project: EURIBIA_PROYECCION_DEMANDA_ASIGNATURAS
version: "3.0"
status: vigente
author: Diego Evans Pérez Paz
tags:
  - resumen-ejecutivo
  - proyeccion-demanda
  - asignaturas
  - banner9
  - machine-learning
  - forecasting
---

# Euribia — Resumen Ejecutivo

> **Estado vigente.** Todas las cifras salen de la auditoría del 2026-09-01: se
> recalcularon desde los CSV de salida y se contrastaron contra `dashboard.json`.
> Cuando una cifra aquí y una del panel difieran, manda el panel.

---

## 1 · Qué es

Un modelo de **forecasting de demanda de asignaturas** para instituciones de educación
superior que operan sobre **ERP Banner**. Proyecta cuántos estudiantes se inscribirán
en cada combinación de:

```
PERÍODO × MATERIA × CURSO × COMPONENTE × SEDE
```

y convierte esa demanda en **cuántas secciones abrir**, con su banda de incertidumbre.

El problema que resuelve es una decisión que hoy se toma con criterio experto y
planillas: una sección de más es presupuesto comprometido; una de menos son
estudiantes sin cupo y un problema de gestión académica en pleno período.

> [!note] 📐 Por qué es portable
> La nomenclatura de períodos (`YYYYTT`), los códigos de componente (`TEO`, `LAB`,
> `AYU`, `TAL`…) y la estructura `materia + curso` son **estándar de Banner**, no de
> una institución concreta. El pipeline consume seis extracciones que cualquier
> instalación de Banner ya tiene: inscripción por NRC, catálogo, mallas curriculares
> e índices de reprobación.

---

## 2 · El resultado en una línea

El modelo proyecta **1.026.533 inscritos** para siete períodos y se equivoca un
**10,6 % menos** que suponer que se repite el año anterior. A nivel de período completo
el desvío típico es del **6,2 %**; a nivel de una asignatura concreta, del **29,0 %**.

**El número agregado se presupuesta; el fino se revisa con la sede.**

---

## 3 · Métricas del modelo

Medidas sobre **55.983 celdas** de 23 períodos cerrados (202205–202615), que
representan **2.612.770 inscritos**. Ninguna cifra va sin su vara al lado: un
porcentaje de error, solo, no significa nada.

| Métrica | Naive estacional | **Euribia** | Lectura |
|---|---:|---:|---|
| **WAPE** | 0,398 | **0,356** | De cada 100 inscritos, cuántos quedan mal asignados |
| **MAE** | 18,6 | **16,6** | Inscritos de error por celda |
| **MASE** | 1,000 | **0,894** | Bajo 1 le gana al baseline |
| **Skill** | — | **+10,6 %** | `1 − WAPE_modelo / WAPE_vara` |
| **R²** | 0,653 | **0,670** | El modelo aporta 0,017 sobre el naive |
| RMSE | — | 42,7 | Penaliza la cola de error |
| sMAPE | — | 0,415 | |
| **Sesgo** | — | **+4,2 %** | Sobreproyecta en el agregado; medido y descontable |

**Bandas de incertidumbre** (cuantiles con *conformal quantile regression*):

| | Objetivo | Real |
|---|---:|---:|
| Cobertura P10 | 10 % | 20,1 % |
| Cobertura P50 | 50 % | 63,0 % |
| Cobertura P90 | 90 % | 93,3 % |
| **Intervalo P10–P90** | **80 %** | **75,2 %** |

El intervalo queda ligeramente **apretado**: cubre menos de lo que promete. Está
medido y declarado, que es la diferencia entre una banda útil y una decorativa.

**Clasificador de supervivencia:** AUC **0,826**. Estima la probabilidad de que la
asignatura llegue a dictarse, y de ahí sale `P50_ESPERADO = P50 × P(se dicte)`.

---

## 4 · Arquitectura — cinco capas

Nunca predice inscritos directamente: los árboles no extrapolan tendencia, y con la
matrícula creciendo la primera versión se aplanaba en el techo histórico y **perdía
contra el naive por un 21 %**. Reformularlo como corrección resolvió el problema de
raíz.

| Capa | Qué hace | Qué aporta |
|---|---|---|
| **1 · Base** | `ins_lag_1y` — seasonal naive | El **nivel**, y con él la extrapolación |
| **2 · CatBoost** | Aprende `log1p(y) − log1p(naive)` · 47 variables | El **ajuste relativo** |
| **3 · Blend** | `p = w·p_cb + (1−w)·naive`, con `w` calibrado | Controla la **distribución** |
| **4 · Reconciliación** | Escala para que `Σ = Σ(naive) × 0,9878` | Cuadra el **total** |
| **5 · Supervivencia** | Clasificador de que la serie siga viva | Descuenta lo que **morirá** |

### La elección de familia se midió, no se supuso

| Modelo | WAPE |
|---|---:|
| **CatBoost** 🏆 | **0,346** |
| LightGBM | 0,371 |
| XGBoost | 0,391 |

El **ensemble no mejoró al ganador**: promediar con modelos peores arrastra al bueno.

### Validación

**Walk-forward con 7 orígenes**, nunca validación cruzada aleatoria — en series
temporales el corte cronológico es lo único que evita *leakage*.

---

## 5 · Cuánto confiar, según el nivel de agregación

El mismo pronóstico, mirado con distinto zoom. Es una encuesta nacional: acierta el
país con ±3 puntos y se equivoca feo por comuna, porque ahí preguntó a 20 personas.

| Nivel | Celdas | Tamaño típico | Error | Skill |
|---|---:|---:|---:|---:|
| Período | 23 | ~44.250 | **6,2 %** | +17,7 % |
| … × Sede | 132 | ~9.888 | 8,0 % | +5,4 % |
| … × Componente | 659 | ~1.420 | 11,8 % | +2,4 % |
| … × Materia × Curso | 31.840 | ~40 | 29,0 % | +10,8 % |
| … × Materia×Curso × Comp. | 55.983 | ~23 | 35,6 % | +10,6 % |

---

## 6 · De inscritos a secciones

La conversión aplica una norma de ocupación por componente. El hallazgo importante es
**dónde vive el error**:

| | Secciones | vs. real |
|---|---:|---:|
| Secciones **reales** abiertas | 168.974 | — |
| La norma con los **inscritos reales ya sabidos** | 123.335 | **−27,0 %** |

La segunda fila no usa el modelo: aplica la norma a la demanda **verdadera**. Y aun así
abre un 27 % menos secciones de las que se abrieron. **La mayor parte del error de
conversión no viene del pronóstico, viene del estándar de programación.**

Acierta la sección exacta en el **71,9 %** de los casos.

---

## 7 · Límites conocidos

| Límite | Detalle |
|---|---|
| **Asignaturas nuevas** | Entre el **19 % y el 29 %** de las series de cada período no existían antes. Sin historia no hay lag del cual partir |
| **No es proyección de matrícula** | Proyecta lo que harán las asignaturas **que ya existen**. Compararlo contra una meta institucional lleva a concluir, erróneamente, que sub-proyecta |
| **Postgrado fuera de alcance** | Se modelan los tipos de período regulares; postgrado y verano corren en calendarios propios |
| **Las secciones no cuadran al agregar** | Sumar las columnas de secciones da la suma de dimensionamientos individuales, cada uno calculado como si su asignatura se dictara |
| **`P50` y `P50_ESPERADO` no son intercambiables** | El primero dimensiona, el segundo suma. Confundirlos cuesta un **9,7 %** en el agregado |
| **Horizonte 2** | Al encadenar una predicción sobre otra, el WAPE se degrada de 0,414 a 0,482 (**+16,5 %**). El **28 %** del volumen proyectado está en ese régimen |
| **Concentración del error** | El **10 % peor de las celdas concentra el 54 %** del error absoluto. Es una lista corta, atacable con revisión manual |
| **Sin monitoreo de drift** | El modelo no avisa si el comportamiento cambia bajo sus pies |

---

## 8 · Insumos y volumetría

| Objeto | Volumen |
|---|---|
| Inscripciones de origen | **7.413.130** (2015–2026, 131 períodos) |
| Homologación de códigos | **2.499.295** inscripciones reubicadas (33,7 %) · 9.406 → **7.748** códigos |
| Sábana analítica | **163.954** filas × 61 columnas · **28.996** series |
| Celdas medidas en backtest | 55.983 · 23 períodos |
| Entregable de proyección | **22.142** filas · 7 períodos (202620–202725) |
| Serie real vs. proyectado | 78.125 filas |
| Cobertura | 8 sedes · 9 componentes |

> [!tip] 💡 Por qué la homologación es el 60 % del trabajo
> Banner renombra la asignatura con cada versión de malla. Sin unificar los códigos,
> la serie de una misma asignatura queda partida en fragmentos de dos o tres períodos
> y no hay historia que modelar. La cascada de homologación es lo que hace posible
> todo lo demás.

---

## 9 · Entregables

| Pieza | Qué es |
|---|---|
| `PROYECCION_INSCRITOS_*.csv` | 22.142 combinaciones con P10 · P50 · P90, probabilidad de dictarse y secciones sugeridas |
| `SERIE_COMPLETA_REAL_VS_PROYECTADO.csv` | 78.125 filas de real contra proyectado — la evidencia que permite auditar el modelo en vez de creerle |
| **Panel Euribia** | Dashboard estático bilingüe (ES/EN) de 9 módulos |

---

## 10 · Estructura del repositorio

```
Euribia - Proyección de Demanda Asignaturas/
├── Documentación/
│   ├── RESUMEN_EJECUTIVO_27-08-2026.md          ← este documento
│   ├── DOCUMENTO_TECNICO_FUNCIONAL_PIPELINE.md  ← la sábana de datos, celda por celda
│   ├── DOCUMENTO_TECNICO_FUNCIONAL_MODELO_ML.md ← el modelo, métricas y decisiones
│   └── DICCIONARIO_ENTREGABLES_PROYECCION.md    ← los CSV campo por campo
├── Notebooks/
│   ├── PIPELINE_PROYECCION_ASIGNATURAS.ipynb    ← 6 fuentes → sábana modelable
│   ├── MODELO_ML_PROYECCION_ASIGNATURAS.ipynb   ← el modelo de cinco capas
│   └── Análisis_deploy_modelo.ipynb             ← auditoría post-producción
├── Imagenes/
└── hf_space/                                     ← el panel: HTML/CSS/JS sin dependencias
```

---

## 11 · Siguientes pasos

1. **Revisar el estándar de programación** — ahí vive la mayor parte del error de conversión
2. Corregir el ensanchamiento de la banda del horizonte 2 (requiere reentrenar)
3. Modelo de *cold start* para asignaturas sin historia
4. Monitoreo de drift sobre el factor de reconciliación
5. Re-proyectar los períodos lejanos al cerrar el año en curso

---

**Diego Evans Pérez Paz** · Ingeniería de Datos y Machine Learning

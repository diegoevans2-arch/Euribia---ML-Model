---
title: Euribia · Proyección de demanda de asignaturas
emoji: 📚
colorFrom: indigo
colorTo: gray
sdk: static
app_file: index.html
pinned: false
license: other
short_description: Course demand forecast with uncertainty bands · Banner ERP
tags:
  - education
  - forecasting
  - capacity-planning
  - catboost
  - time-series
---

# Euribia · Proyección de demanda de asignaturas
### Course demand forecast · Banner ERP · 2026–2027

Dashboard estático **bilingüe (ES/EN)** con la proyección de inscritos por
`asignatura × componente × sede × período`, su banda de incertidumbre y su
conversión a número de secciones a abrir.

*Static bilingual dashboard with the enrolment forecast per course, component, campus
and term, its uncertainty band and its conversion into section counts.*

## El problema

Cada período académico hay que decidir **cuántas secciones abrir** para decenas de
miles de combinaciones de asignatura, componente y sede. En la mayoría de las
instituciones esa decisión se toma con criterio experto y planillas.

Una sección de más es presupuesto comprometido. Una de menos son estudiantes sin cupo
y un problema de gestión académica en pleno período.

Este proyecto construye el pronóstico sobre los datos que **cualquier institución con
ERP Banner** ya tiene: inscripción histórica por NRC, catálogo de asignaturas, mallas
curriculares e índices de reprobación. La nomenclatura de períodos (`YYYYTT`), los
códigos de componente (`TEO`, `LAB`, `AYU`, `TAL`…) y la estructura
`materia + curso` son estándar de Banner, no de una institución concreta.

## El resultado en una línea

El modelo proyecta **1.026.533 inscritos** para siete períodos y se equivoca un **11 %
menos** que suponer que se repite el año anterior. A nivel de período completo el
desvío típico es del **6 %**; a nivel de una asignatura concreta, del **29 %** — el
número agregado se presupuesta, el fino se revisa con la sede.

## Qué contiene

| Pestaña | Contenido |
|---|---|
| **Resumen** | Las tres preguntas ejecutivas: ¿sirve el modelo?, ¿cuánto confiar según el tamaño de lo que se mire?, y las tres advertencias de uso |
| **Modelo** | La vara primero (seasonal naive), luego MAE/RMSE/WAPE/sMAPE/MASE/sesgo, la cobertura real de la banda P10–P90 y el checklist de las **seis** reglas de oro del forecasting |
| **Cascada** | De macro a micro: el error y la ventaja sobre el naive en cinco niveles de agregación, con el margen de error de cada uno |
| **Secciones** | La conversión de inscritos a secciones, sus seis criterios, la matriz criterio × nivel y el reparto del error entre modelo y estándar |
| **Escenarios** | El gráfico de secciones por período con filtros de régimen, sede, componente y escenario de percentil, y debajo las mismas cifras en tabla con su desvío contra lo real |
| **Estándares** | Tamaño de sección observado (percentiles reales) contra la norma, por componente |
| **Explorador** | Las 22.142 combinaciones proyectadas, buscables y filtrables, con banda y probabilidad de dictarse |
| **Descargas** | CSV de todas las combinaciones o solo las filtradas, y el JSON de métricas agregadas. Se generan en el navegador, con `;` y coma decimal para Excel en es-CL |
| **Metodología** | **Cómo leer las cifras**: qué pregunta responde cada métrica, hacia dónde se lee y cuánto vale hoy, siempre con su baseline al lado. Más los **diagramas ASCII** de la arquitectura de datos y de las cinco capas del modelo, qué familia de modelo es y por qué se eligió, y los límites conocidos |

## La arquitectura del modelo

Cinco capas, y cada una resuelve algo que la anterior no puede:

| Capa | Qué hace |
|---|---|
| **1 · Base** | Los inscritos del mismo período del año anterior. Aporta el *nivel*: la extrapolación que los árboles no saben hacer |
| **2 · CatBoost** | No predice inscritos, sino **cuánto corregir esa base**. 47 variables, validación walk-forward con 7 orígenes |
| **3 · Blend** | Mezcla la predicción con la base en una proporción calibrada |
| **4 · Reconciliación** | Escala el conjunto para que el total cuadre con la tasa de crecimiento histórica |
| **5 · Supervivencia** | Un clasificador estima la probabilidad de que la asignatura llegue a dictarse (AUC 0,826) |

La elección de familia se midió, no se supuso: **CatBoost 0,346 · LightGBM 0,371 ·
XGBoost 0,391** de WAPE, y el ensemble no mejoró al ganador. Las bandas P10–P90 se
calibran con *conformal quantile regression*; la validación es siempre walk-forward,
nunca validación cruzada aleatoria.

## Cómo está hecho

Sin dependencias externas: HTML, CSS y JavaScript plano. No hay CDN, no hay build
step, no hay servidor — por eso carga al instante y nunca se duerme.

```
index.html         esqueleto + script anti-destello del tema
styles.css         tokens de color; la paleta cuelga de `data-tema`, con toggle ☀/☾
i18n.js            diccionario ES/EN
charts.js          lineChart, hBars, dotPlot (SVG) y scatterCanvas (canvas)
app.js             router, los 9 módulos, filtros y generación de CSV
exporta_datos.py   genera data/ desde los entregables del modelo
data/              dashboard.json (9 KB) · serie.json (59 KB) · celdas.json (1,7 MB)
```

Los datos van en **formato columnar**, no como lista de objetos: `{a:[1,3],b:[2,4]}`
en vez de `[{a:1,b:2},{a:3,b:4}]`. Con 22 mil filas eso ahorra megas de nombres de
campo repetidos. `celdas.json` se carga sólo al abrir el Explorador.

## Advertencias que el dashboard hace explícitas

- **El 28 % del volumen es preliminar.** Los dos períodos más lejanos se apoyan en una
  proyección previa, no en datos reales. Deben re-proyectarse al cerrar el año en curso.
- **`P50` y `P50_ESPERADO` no son intercambiables.** El primero dimensiona, el segundo
  suma. Confundirlos cuesta un 10 % en el total o secciones de menos en el detalle.
- **Las secciones salen 27 % por debajo de lo real, y eso no es del modelo.** Aplicando
  la norma a los inscritos verdaderos ocurre lo mismo: el estándar de 80 alumnos por
  sección de teoría está por encima del p90 observado. La mayor parte del error de
  conversión viene del **estándar de programación**, no del pronóstico.
- **No cubre asignaturas nuevas sin historia.** Entre el 19 % y el 29 % de las
  asignaturas de cada período no existían el año anterior. No es una proyección de
  matrícula institucional: proyecta lo que harán las asignaturas **que ya existen**.

---

**Diego Evans Pérez** · Ingeniería de Datos y Machine Learning

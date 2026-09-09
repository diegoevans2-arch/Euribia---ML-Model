---
title: "Diccionario de Entregables — Proyección de Demanda de Asignaturas"
tags: [diccionario-datos, proyeccion-demanda, asignaturas, forecasting, banner9, entregable]
audiencias: [tecnico, puente, ejecutivo]
status: activo
type: diccionario-datos
project: PROYECCION_DEMANDA_ASIGNATURAS
version: "1.4"
fecha_creacion: 2026-08-27
ultima_actualizacion: 2026-08-28
owner: Diego Evans Pérez
author: Diego Evans Pérez Paz
---

# 📊 Diccionario de Entregables — Proyección de Demanda de Asignaturas

**Navegación:** [`HANDOFF_MODELO_PROYECCION.md`](HANDOFF_MODELO_PROYECCION.md) · [`CONTEXTO_REGLAS_DURAS.md`](CONTEXTO_REGLAS_DURAS.md) · [`PLAN_PROYECCION_DEMANDA_ASIGNATURAS.md`](PLAN_PROYECCION_DEMANDA_ASIGNATURAS.md) · [`BITACORA_EXPERIMENTOS.md`](BITACORA_EXPERIMENTOS.md)

Audiencia: 🔧 🧭 👔

---

> [!info] 📌 ¿Por qué importa este documento?
> El modelo produce **dos CSV**, y ninguno se explica solo. Uno tiene 36 columnas y el otro 35; entre ellas hay tres cifras de inscritos, dos formas distintas de sumar el total —que difieren en 100.000 inscritos—, **dos códigos de asignatura que no son intercambiables**, **cuatro maneras de contar secciones**, y siete columnas que solo existen para decirte **cuánto confiar en la fila que estás mirando**. Este documento traduce cada campo desde su forma física hasta la decisión que habilita, para que nadie tenga que abrir el notebook para saber qué significa una columna.

> [!abstract] 👔 Impacto ejecutivo
> La proyección alimenta la decisión de **cuántas secciones abrir y con qué dotación**, con un año de anticipación.
>
> - **Decisiones que habilita:** dimensionamiento de la oferta académica por sede, presupuesto de dotación docente, detección temprana de asignaturas en riesgo de no abrirse, negociación de salas y laboratorios.
> - **Costo de leerlo mal:** sumar la columna equivocada infla la demanda institucional en **~100.000 inscritos (8,9%)**, que se traduce en secciones presupuestadas para asignaturas que no van a dictarse.
> - **Pregunta ejecutiva que responde:** *¿cuánta demanda espero por asignatura y sede el próximo año, con qué margen de error, y qué tan seguro estoy de que esa asignatura llegue a abrirse?*

> [!tip] 💡 Analogía general: el parte meteorológico
> El entregable no dice "van a inscribirse 24 alumnos". Dice lo mismo que un parte del tiempo: **"máxima 35, mínima 16, lo más probable 24, y un 94% de probabilidad de que el evento ocurra"**. Las tres cifras no compiten entre sí — cada una responde una pregunta distinta. Planificar salas con la máxima es prudente; presupuestar con la máxima es caro. Y si la probabilidad de que llueva es 22%, no importa cuánta lluvia se proyecte: lo primero es decidir si sales.

---

## 1. Los dos archivos y para qué sirve cada uno

Audiencia: 🔧 🧭 👔

**Ruta común:**

```
data\raw\
```

| | **El entregable** | **La evidencia** |
|---|---|---|
| Archivo | `PROYECCION_INSCRITOS_2026_2027.csv` | `SERIE_COMPLETA_REAL_VS_PROYECTADO.csv` |
| Filas × columnas | **22.142 × 36** | **78.125 × 35** |
| Peso | 5,0 MB | 14,6 MB |
| Cobertura | 7 períodos futuros | 30 períodos (2022–2027) |
| Grano | `PERIODO × MATERIA × CURSO × COMPONENTE × CAMPUS` | idéntico |
| **Pregunta que responde** | *¿cuánta demanda espero?* | *¿le creo a este modelo?* |
| Fase que lo genera | `FASE 7b` | `FASE 7c` |
| Fase que agrega el código programable | `FASE 7d` | `FASE 7d` |
| Fase que agrega las secciones | `FASE 7e` | `FASE 7e` |

**🔧 Formato:** ambos con separador `;` y decimal `,` (abren directo en Excel, sin importador). Codificación UTF-8 con BOM.

**🧭 Cuál abrir según lo que necesitas:**

| Necesito… | Archivo | Cómo |
|---|---|---|
| **Programar la asignatura en Banner** | Entregable | **`CODIGO_PROGRAMABLE`** — nunca `MATERIA`+`CURSO` (§3.5) |
| **Decidir cuántas secciones abrir** | Entregable | `N_SECCIONES_TEORICAS_PROYECTADAS` (piso) y `N_SECCIONES_PROMEDIO` (techo) — §3.6 |
| Dimensionar cupos de una asignatura | Entregable | `P50` + su `PROB_SE_DICTA` al lado |
| Un total institucional o por sede | Entregable | Sumar **`P50_ESPERADO`**, nunca `P50` |
| Priorizar qué revisar a mano | Entregable | Filtrar `confiabilidad = baja` o `RIESGO_BAJA = alto` |
| Justificar el modelo ante un comité | Evidencia | `TIPO = REAL` y comparar real vs proyectado |
| Graficar una asignatura 2022→2027 | Evidencia | Serie continua, sin corte entre pasado y futuro |
| Detectar sesgo en un campus | Evidencia | Agrupar y promediar `ERROR_PCT` sobre `TIPO = REAL` |
| **Auditar la conversión a secciones** | Evidencia | Comparar `N_SECCIONES_*` contra las reales sobre `TIPO = REAL` — §4.3 |

**👔 En una frase para el negocio:** el primer archivo es **el pronóstico**; el segundo es **el historial de aciertos del pronosticador**. Antes de usar el primero para decidir presupuesto, el segundo es lo que responde si el modelo se ha ganado esa confianza.

---

## 2. ⚠️ La regla que no se puede violar

Audiencia: 🔧 🧭 👔

> [!danger] 🚨 Error costoso: **sumar** `P50` para obtener un total
> `P50` supone que **todas** las asignaturas se dictan. Sumarla da **1.126.278** inscritos.
> Para un total, la cifra correcta es la suma de `P50_ESPERADO`: **1.026.533**.
>
> **La diferencia son 99.745 inscritos (8,9%)** de demanda asignada a series que probablemente no se abran. Presupuestar ese total inflado significa financiar oferta que nunca se dictará.
>
> ⚠️ **El error es SUMARLA, no usarla.** `P50` es la cifra correcta para dimensionar
> **una** asignatura — y por eso las columnas de secciones (§3.6) se calculan sobre
> `P50` y **no** sobre `P50_ESPERADO`. Eso no contradice esta regla: la contradice
> quien sume las secciones esperando un total institucional.

**🔧 Por qué existe la diferencia:** un clasificador de supervivencia independiente (AUC 0,826) estima `PROB_SE_DICTA` para cada fila, y `P50_ESPERADO = round(P50 × PROB_SE_DICTA)`. El modelo de demanda proyecta *cuántos se inscribirían si la asignatura se dicta*; el de supervivencia estima *si llega a dictarse*. Son dos preguntas y el entregable las separa a propósito.

**🧭 Cuándo usar cada una:**

| Uso | Columna | Por qué |
|---|---|---|
| **Totales** — institucional, por sede, por carrera | `P50_ESPERADO` | La probabilidad se promedia bien sobre muchas filas |
| **Una asignatura concreta** | `P50` **+** `PROB_SE_DICTA` | Un valor esperado de 12 en una asignatura con 22% de probabilidad no significa "abre con 12 alumnos": significa "probablemente no abre, y si abre son ~53" |
| **Dimensionar secciones** | `P50` | Se dimensiona el caso **si se dicta**. Usar el esperado aplicaría el descuento dos veces |

> [!important] 🎯 La regla en una línea
> **`P50_ESPERADO` para SUMAR. `P50` para DIMENSIONAR.** Todo lo demás se deduce de
> ahí. La versión completa, con la tabla de decisión y los dos errores simétricos,
> está en [`CONTEXTO_REGLAS_DURAS.md`](CONTEXTO_REGLAS_DURAS.md) §8.3.

> [!warning] ⚠️ El valor esperado no es un pronóstico de cupos
> `P50_ESPERADO` es una cifra **agregable**, no una cifra **operativa**. Nunca dimensiones una sala con ella.

**👔 En una frase para el negocio:** hay dos totales legítimos y uno solo sirve para presupuestar — el que ya descontó las asignaturas que no van a abrirse.

---

## 3. Entregable · `PROYECCION_INSCRITOS_2026_2027.csv`

Audiencia: 🔧 🧭

**Ficha:** 22.142 filas × 36 columnas · 7 períodos · Σ`P50_ESPERADO` = 1.026.533

**Períodos que cubre:**

| Horizonte | Períodos | Fuente |
|---|---|---|
| **h1** — desde período real | `202620` `202625` `202705` `202710` `202715` | Inscripción observada |
| **h2** — encadenado | `202720` `202725` | Un período ya proyectado |

### 3.1 Identificación — la llave de la fila

Las cinco columnas juntas son la llave primaria: no hay duplicados.

| Campo | Tipo | Únicos | 🔧 Definición | 🧭 Lectura de negocio |
|---|---|---|---|---|
| `PERIODO` | int | 7 | Período académico proyectado, `AAAATT` | El semestre/trimestre que se está planificando |
| `periodo_fuente` | int | 7 | Homólogo del año anterior del que salen la grilla y el lag | Contra qué período se compara el crecimiento |
| `MATERIA` | str | 141 | Código de materia Banner | Área/disciplina |
| `CURSO` | str | 645 | Número de curso Banner | Nivel dentro de la materia |
| `COMPONENTE` | str | 9 | `TEO` `LAB` `TAL` `ELG` … | Cada componente se programa por separado |
| `CAMPUS` | str | 8 | `TPC` `LPS` `PAP` `BES` `CVA` `ONL` `CES` `TP2` | Sede donde se dicta |

> [!warning] ⚠️ Convención Banner: la asignatura es `MATERIA` + `CURSO` **concatenados sin separador**
> `DBIO` + `1069` = `DBIO1069`. No lleva guion, espacio ni ceros de relleno adicionales. Un `CONCAT` con separador rompe el cruce contra cualquier otra fuente Banner.

**🧭 Por qué el grano llega hasta componente y campus:** una misma asignatura puede tener teoría en una sede y laboratorio en otra, con demandas distintas. Agregarlas antes de tiempo esconde justamente la información que sirve para programar.

### 3.2 Proyección — las cifras

| Campo | Tipo | Rango | Mediana | 🔧 Definición |
|---|---|---|---|---|
| `ins_lag_1y` | float | 0 – 9.532 | 24 | Inscritos **reales** del `periodo_fuente`. Es el punto de partida (*seasonal naive*) |
| `P10` | int | 0 – 6.717 | 16 | Percentil 10 — escenario **bajo** |
| `P50` | int | 0 – 7.736 | 24 | Percentil 50 — **la cifra de referencia** |
| `P90` | int | 1 – 10.656 | 35 | Percentil 90 — escenario **alto** |
| `PROB_SE_DICTA` | float | 0,01 – 1,00 | 0,94 | Probabilidad de que la asignatura llegue a abrirse |
| `P50_ESPERADO` | float | 0 – 7.572 | 21 | `P50 × PROB_SE_DICTA`, redondeado |

**🔧 Cómo se construye la cifra.** El modelo **no predice inscritos directamente**. Predice una *corrección* sobre el naive, en espacio logarítmico:

```
corrección = log1p(INSCRITOS) − log1p(ins_lag_1y)      ← lo que aprende CatBoost
proyección = expm1( log1p(ins_lag_1y) + corrección )   ← lo que se entrega
```

El nivel agregado lo fija después una reconciliación contra la tasa histórica de crecimiento; el modelo aporta la **discriminación entre series**, no el nivel.

**🧭 Por qué tres cifras y no una.** El error medio de la proyección puntual es **34%**. Un solo número esconde esa incertidumbre y se lee con más confianza de la que merece. El intervalo `P10`–`P90` contiene al valor real el **79%** de las veces.

| Decisión | Cifra a usar | Por qué |
|---|---|---|
| Presupuesto base | `P50` | Es la mediana: tan probable quedar arriba como abajo |
| Reserva de salas y laboratorios | `P90` | El costo de quedarse corto (alumno sin cupo) supera al de sobrar |
| Escenario de contracción | `P10` | Para planes de contingencia, no para presupuestar |

> [!tip] 💡 Analogía
> `P50` es la hora a la que **calculas** llegar; `P90` es la hora a la que **dices** que llegarás. La diferencia entre ambas no es pesimismo: es el margen que te permite cumplir.

### 3.3 Calidad — cuánto confiar en cada fila

Estas cuatro columnas existen para que **no todas las filas se lean igual**.

| Campo | Tipo | Valores | 🔧 Definición |
|---|---|---|---|
| `confiabilidad` | str | `alta` · `media` · `baja` | Corte de `wape_ref`: alta < 0,25 · media 0,25–0,50 · baja > 0,50 |
| `wape_ref` | float | 0,02 – 2,33 | Error esperado de esa fila, en proporción. Mediana 0,35 = **±35% típico** |
| `wape_fuente` | str | `serie` · `campus_componente` · `global` | De qué histórico se tomó ese error |
| `RIESGO_BAJA` | str | `alto` · `medio` · `bajo` | Corte de `PROB_SE_DICTA`: alto ≤ 0,50 · medio 0,50–0,75 · bajo > 0,75 |

**🔧 Cascada de `wape_fuente`.** El error de referencia se busca en tres niveles de granularidad, del más específico al más general:

```
histórico de la PROPIA serie  →  de su CAMPUS × COMPONENTE  →  global
```

Las filas de horizonte 2 llevan además el `FACTOR_H2 = 1,165` aplicado, que es la degradación medida al encadenar.

**🧭 Distribución actual del volumen proyectado:**

| Confiabilidad | Filas | Volumen `P50` | % del total | WAPE |
|---|---|---|---|---|
| **alta** | 2.511 | 201.985 | 17,9% | 0,177 |
| **media** | 17.938 | 860.644 | 76,4% | 0,365 |
| **baja** | 1.693 | 63.649 | **5,7%** | 0,696 |

**👔 Lectura ejecutiva:** el 94,3% del volumen proyectado está en confiabilidad alta o media. Las filas malas existen, pero pesan poco — y están **etiquetadas**, que es la diferencia entre un error conocido y una sorpresa.

**🧭 Riesgo de baja — el mismo patrón:**

| Riesgo | Series | `P50` | `P50_ESPERADO` | Prob. media | % del `P50` |
|---|---|---|---|---|---|
| **alto** | 3.831 | 49.056 | 12.396 | 0,227 | 4,4% |
| **medio** | 2.376 | 56.828 | 36.460 | 0,635 | 5,0% |
| **bajo** | 15.935 | 1.020.394 | 977.677 | 0,945 | 90,6% |

> [!info] 📌 Muchas asignaturas, poca demanda
> Las 3.831 series de riesgo alto son el **17% de las filas** pero solo el **4,4% del volumen**. Son asignaturas pequeñas y marginales, no carreras completas en riesgo.

### 3.4 Trazabilidad — cómo se produjo la fila

| Campo | Tipo | Valores | 🔧 Definición |
|---|---|---|---|
| `horizonte` | int | `1` · `2` | `1` = proyectado desde período real · `2` = desde otro proyectado |
| `metodo` | str | 2 valores | `híbrido (naive × corrección) + calib v4` (21.798 filas) · `cold start` (344) |
| `banda_calibrada` | bool | `true` · `false` | Si el intervalo pasó por calibración conformal (CQR) |

**🔧 Qué significa cada uno:**

- **`horizonte = 2`** — `202720` y `202725` se proyectan desde períodos que a su vez son proyección. El error se acumula, y por eso su `wape_ref` ya viene multiplicado por 1,165.
- **`metodo = cold start`** — 344 filas de series **sin historia**: no hay `ins_lag_1y` que corregir, así que se estiman desde asignaturas comparables. Son las de mayor incertidumbre estructural.
- **`banda_calibrada = false`** — las 6.723 filas de horizonte 2. Su intervalo no pasó por CQR; se ensanchó a mano ×1,165. Es una banda **más burda, no inválida**.

**🧭 Cuándo importa:** si vas a auditar la proyección o explicar una cifra rara, estas tres columnas dicen por qué esa fila salió como salió.

---

### 3.5 ⭐ Código de agrupación vs código programable

Audiencia: 🔧 🧭 👔

> [!danger] 🚨 `MATERIA` + `CURSO` **no es el código que se abre en Banner**
> Es la **regla de malla**: el código de familia con el que la homologación (D-24) unió las
> series fragmentadas. **450 de 2.717 códigos (16,6%) nunca se dictaron bajo ese nombre** y
> arrastran el 17,3% del volumen esperado. Quien busque `PSICEA03` en Banner no lo encuentra.
>
> Para programar hay que usar **`CODIGO_PROGRAMABLE`**, que sí existe en el 100% de las filas.

**🔧 Por qué hay dos códigos.** El histórico de Banner fragmenta una misma asignatura en
varios códigos a lo largo de los años (renombres, migraciones de malla). La homologación los
colapsa a la regla de malla vigente, y eso es lo correcto **para modelar**: sube la cobertura
de `ins_lag_1y` de 68,0% a 73,1% y la historia media por serie de 5,8 a 6,74 períodos. Pero
la regla es una etiqueta de catálogo, no necesariamente un código que alguien haya usado
para inscribir. Los dos códigos sirven a dos usuarios distintos y por eso conviven.

| Columna | Tipo | 🔧 Definición | 🧭 Para qué se usa |
|---|---|---|---|
| `MATERIA` + `CURSO` | str | La **regla de malla** — coincide con `REGLA` en el 97,8% de las filas | **Agrupar**: es la llave del modelo y la que une el histórico |
| `ASIGNATURA_REGLA` | str | Esa misma familia, ya concatenada | Comodidad — evita el `CONCAT` a mano |
| **`CODIGO_PROGRAMABLE`** | str | El código **vivo** de la familia | ⭐ **Programar**: es lo que se abre en Banner |
| `REGLA_SE_DICTA` | bool | Si la regla misma llegó a dictarse alguna vez | `False` (17,7% de las filas) = el programable es indispensable |
| `CODIGOS_ORIGEN` | str | Todos los códigos fundidos en la familia, separados por `\|` | Auditar de dónde salió la serie |
| `N_CODIGOS_ORIGEN` | int | Cuántos son. Máximo 13 (`DSPU0011`) | Un valor alto avisa de una familia heterogénea |
| `ULTIMO_PERIODO_DICTADO` | float | Último período en que se vio el `CODIGO_PROGRAMABLE` | Detectar códigos que llevan tiempo sin usarse |

**🔧 Cómo se elige el programable.** De todos los códigos de la familia —incluida la propia
regla, que compite como una más— gana el del **último año dictado**; dentro de ese año, el
de **mayor volumen**.

> [!info] 📌 Por qué el criterio es por año y no por período
> Dos códigos que se dictan el mismo año en TT distintos están **ambos vivos**. Desempatar por
> período elegiría el trimestre más tardío, que suele ser el minoritario. Al medirlo, el
> criterio por período elegía mal en **43 casos**; el criterio por año los corrige.

**🧭 Cómo se ve en la práctica:**

| `ASIGNATURA_REGLA` | `CODIGO_PROGRAMABLE` | `N` | `CODIGOS_ORIGEN` |
|---|---|---|---|
| `PSICEA03` | `PSICD001` | 3 | `PSIC0060｜PSIC1221｜PSICD001` |
| `ODONFA04` | `ODONF005` | 2 | `ODONF004｜ODONF005` |
| `PDIAFA02` | `PDIAF004` | 1 | `PDIAF004` |

El último caso es el más incómodo: `N = 1` significa que la homologación **no unió ninguna
serie** — solo renombró al código de malla vigente, que nunca se usó para inscribir. Son 264
códigos así, el 8,5% del volumen: costo sin beneficio.

**Efecto medido de la `FASE 7d`:**

| | Antes | Después |
|---|---|---|
| Códigos que existen en Banner | 82,3% | **100%** |
| Códigos que cambian | — | 505 de 2.717 (18,6%) |
| Volumen esperado rescatado | — | **194.744 (19,0%)** |
| Colisiones (2 familias → 1 código) | — | **0** |
| Duplicados en `PERIODO×CÓDIGO×COMPONENTE×CAMPUS` | — | **0** |

> [!warning] ⚠️ No son intercambiables
> Si agrupas por `CODIGO_PROGRAMABLE` obtienes la vista operativa; si agrupas por
> `ASIGNATURA_REGLA` obtienes la vista del modelo. **Las dos suman igual** —la `FASE 7d` no
> movió ninguna cifra— pero reparten distinto. Para cruzar contra el histórico del modelo,
> usa la regla; contra Banner, el programable.

**👔 En una frase para el negocio:** el modelo necesita agrupar los códigos que fueron la
misma asignatura a lo largo del tiempo; quien programa necesita el código que existe hoy.
El entregable trae los dos, y confundirlos significa buscar en Banner un código que no está.

---

### 3.6 ⭐ Secciones — cuántas abrir, por tres criterios

Audiencia: 🔧 🧭 👔

El entregable proyecta **inscritos**, pero quien programa decide **secciones**. La
conversión no es única, y por eso van varias columnas en vez de una.

| Campo | Tipo | 🔧 Definición | 🧭 Lectura de negocio |
|---|---|---|---|
| `ESTANDAR_TEORICO` | float | Capacidad normativa por componente (dato duro de la Dirección) | **Lo que debería caber** en una sección |
| `ESTANDAR_PROMEDIO` | float | Σ inscritos / Σ secciones de los **2 años anteriores a ese período**, por asignatura×componente×sede | **Lo que de hecho cabe** — el dato de terreno |
| `ESTANDAR_PROM_FUENTE` | str | Nivel al que se pudo calcular: `serie` · `campus_componente` · `componente` · `global` | Hoy es **`serie` en el 100%** de las filas |
| **`N_SECCIONES_TEORICAS_PROYECTADAS`** ⭐ | int | `ceil(P50 / [ESTANDAR_TEORICO × 1,10])`, mín. 1 | **La que se programa.** Única que existe en el 100% de las filas |
| `N_SECCIONES_TEORICAS` | float | `ceil(INSCRITOS_REAL / [ESTANDAR_TEORICO × 1,10])` | La misma norma con la demanda **real**. ⚠️ Vacía en el entregable |
| `N_SECCIONES_PROMEDIO` | float | `round(P50 / [ESTANDAR_PROMEDIO × 1,10])` | Denominador de **esta fila**. ⚠️ Vacía en el entregable |
| **`N_SECCIONES_P25`** | int | `round(P50 / [estandar_p25 × 1,10])` | Escenario **secciones vacías** → el máximo |
| **`N_SECCIONES_P50`** | int | `round(P50 / [estandar_p50 × 1,10])` | Escenario mediana |
| **`N_SECCIONES_P75`** | int | `round(P50 / [estandar_p75 × 1,10])` | Escenario **secciones llenas** |
| **`N_SECCIONES_P90`** | int | `round(P50 / [estandar_p90 × 1,10])` | Escenario **muy llenas** → el mínimo |

> [!important] ⭐ Las cuatro `N_SECCIONES_P*` son ESCENARIOS, no criterios rivales
> Comparten numerador y sólo cambian el denominador: el **tamaño típico de sección**
> de ese `PERIODO × COMPONENTE × CAMPUS` según el cuartil. Se leen como una banda —
> *"¿cuántas secciones si las lleno como el 25% menos ocupado, o como el 90% más
> lleno?"* — y **existen también a futuro**, porque el denominador no depende de los
> inscritos del período que se proyecta.
>
> Medido contra lo real: `p25` **+144%** · `p50` +25% · `p75` **−21%** · `p90` −35%.
> **Lo real cae entre `p50` y `p75`**, así que la banda contiene la respuesta mientras
> la norma sola se queda 17% corta.
>
> ⚠️ El grano es el **componente**, no la fila: al grano fino el 79% de las
> combinaciones tiene ≤2 secciones y los cuatro percentiles colapsan al mismo valor.
> Los calcula el **pipeline (celda 24c)** y viajan en el parquet como `estandar_p*`.
| `N_SECCIONES_REALES` | float | Las que se abrieron: **del propio período** si ya ocurrió, del homólogo del año anterior si aún no | La referencia histórica |

**🔧 El estándar teórico por componente:**

| Comp | Est. | | Comp | Est. |
|---|---|---|---|---|
| **TEO** · UG (TT 10, 20) | **80** | | ELG · AYU | 60 |
| **TEO** · AV (TT 05, 15, 25) | **60** | | TAL | 40 |
| LAB | 30 | | SIM · SSA | 12 |
| GRU | 6 | | OCS | 3 |

> [!info] 📌 Por qué la ventana del estándar observado es MÓVIL
> Para cada período se usan los **2 años anteriores a él**, no una ventana fija sobre
> el final del panel. Sin esto, reconstruir las secciones de `202210` con datos de 2025
> sería mirar el futuro, y la auditoría de la §4.3 no valdría nada.
>
> Cuesta ~1 punto de exactitud en el entregable (51,3% → 50,3%) y no mueve las
> teóricas en absoluto. Se paga por poder auditar 55.983 filas históricas honestamente.

> [!warning] ⚠️ REGLA DURA: el `× 1,10`
> Una sección admite **hasta un 10% sobre su estándar** antes de exigir otra. Va en el
> **denominador**, así que **reduce** el número de secciones: con estándar 80, una
> sección cubre hasta **88** alumnos.
>
> ⭐ **Aplica a TODOS los estándares** — teórico, observado y percentiles (decisión
> de la Dirección, 2026-08-30). La flexibilidad es una propiedad de la **sección**,
> no del método con que se calcule su tamaño.
>
> ⚠️ Costo medido: con el ×1,10 `N_SECCIONES_PROMEDIO` deja de reproducir las
> secciones reales aunque la demanda sea perfecta (100% → **89,7%**). Parte de su
> desvío pasa a ser la flexibilidad y no error del modelo.

> [!danger] 🚨 Las tres se calculan sobre `P50`, NO sobre `P50_ESPERADO`
> `P50_ESPERADO` ya viene multiplicado por `PROB_SE_DICTA`; usarlo aquí aplicaría el
> descuento **dos veces**. Una asignatura con `P50 = 50` y probabilidad 0,3 daría
> **1 sección** cuando, si se dicta, necesita **2**.
>
> **Consecuencia deliberada:** estas columnas **no cuadran** con `P50_ESPERADO` a nivel
> agregado. Dimensionan el caso, no el total institucional. Para saber si la asignatura
> se dicta está `PROB_SE_DICTA` al lado.

**🧭 Qué tan bien acierta cada criterio.** Medido sobre las 15.500 filas con homólogo
real (los h2 se excluyen: no tienen contra qué compararse):

| Criterio | Σ secciones | vs real | Exacta | ±1 |
|---|---|---|---|---|
| *REAL* | *47.920* | | | |
| **Teóricas** | 36.777 | **−23,3%** | **73,8%** | 87,8% |
| **Promedio** | 55.292 | **+15,4%** | 51,3% | **93,8%** |

> [!info] 📌 Cada criterio falla en una dirección distinta — por eso van los dos
> El normativo **abre de menos** (supone salas más llenas de lo que se llenan) y el
> observado **abre de más**. El real queda en medio. La ocupación efectiva ronda la
> mitad del estándar: GRU 6→3,7 · LAB 30→16,1 · TEO 80→43,3.
>
> **`ELG` es la excepción** (60 → 107,6 reales): los electivos se abren con secciones
> grandes, y ahí la columna teórica sobre-estima en vez de sub-estimar.

> [!warning] ⚠️ Dos avisos al usar estas columnas
> **`N_SECCIONES_REALES` viene vacía en `202720` y `202725`** (30% de las filas): su
> `periodo_fuente` también es proyectado, así que no hay secciones reales que traer.
>
> **124 filas (0,56%) tienen estándar observado >3× el normativo** — hasta 4.285
> alumnos/sección, en secciones masivas. No se capean porque es una modalidad real,
> pero ahí `N_SECCIONES_PROMEDIO` no es comparable con el resto: `CBB20002` en ONL da
> **9 secciones** contra 118 teóricas.

---

## 4. Evidencia · `SERIE_COMPLETA_REAL_VS_PROYECTADO.csv`

Audiencia: 🔧 🧭 👔

**Ficha:** 78.125 filas × 35 columnas · 30 períodos (2022–2027) · cobertura de banda 75,2%

**🔧 Qué contiene que el otro no.** Para cada período **ya cerrado**, el modelo se reentrenó usando solo años anteriores y volvió a predecirlo. El archivo pone el real y el proyectado uno al lado del otro:

| `TIPO` | Filas | Períodos | `INSCRITOS_REAL` |
|---|---|---|---|
| `REAL` | 55.983 | 23 (2022–2026) | presente |
| `PROYECTADO` | 22.142 | 7 (los del entregable) | **vacío** |

**🧭 Por qué existe este archivo.** Un pronóstico sin historial de aciertos es una opinión. Este archivo permite responder *"¿cuánto se ha equivocado antes este modelo, y en qué?"* antes de comprometer presupuesto — y permite graficar una asignatura desde 2022 hasta 2027 sin corte visual entre lo observado y lo proyectado.

### 4.1 Campos que cambian respecto del entregable

| Campo | Tipo | 🔧 Definición | Equivalente en el entregable |
|---|---|---|---|
| `TIPO` | str | `REAL` · `PROYECTADO` | — (nuevo) |
| `INSCRITOS_REAL` | float | Valor observado. **Nulo en las 22.142 filas `PROYECTADO`** | — (nuevo) |
| `PROY_BAJO` | float | Escenario bajo | `P10` |
| `PROY_ESTANDAR` | float | **La cifra de referencia** | `P50` |
| `PROY_ALTO` | float | Escenario alto | `P90` |
| `horizonte` | int | Aquí aparece el **`0`**: período histórico reconstruido | `1` · `2` |
| `ANIO` | int | 2022–2027, para agrupar | — (nuevo) |

Las columnas de identificación (`PERIODO`, `MATERIA`, `CURSO`, `COMPONENTE`, `CAMPUS`) y de calidad (`wape_ref`, `wape_fuente`, `confiabilidad`) son las mismas que en la sección 3, con una diferencia: **las de calidad están vacías en las 55.983 filas `REAL`**, porque ahí no hay que estimar el error — se mide.

> [!warning] ⚠️ Este archivo NO trae `PROB_SE_DICTA` ni `P50_ESPERADO`
> Son propias del entregable. Si necesitas el valor esperado sobre este archivo, hay que cruzarlo por la llave de cinco campos.

> [!warning] ⚠️ `MATERIA` y `CURSO` tienen más valores únicos aquí
> 162 materias y 720 cursos, contra 141 y 645 del entregable. No es inconsistencia: el histórico incluye asignaturas que **ya dejaron de dictarse** y por eso no aparecen en la grilla futura.

### 4.2 Medición del error — solo donde hay real

| Campo | Tipo | Rango | 🔧 Fórmula |
|---|---|---|---|
| `ERROR_ABS` | float | 0 – 1.565 | `\|PROY_ESTANDAR − INSCRITOS_REAL\|`, en inscritos. Mediana 6,6 |
| `ERROR_PCT` | float | −1,00 – 160 | `PROY_ESTANDAR / INSCRITOS_REAL − 1`. **Positivo = proyectó de más** |
| `DENTRO_BANDA` | float | `0` · `1` | Si el real cayó entre `PROY_BAJO` y `PROY_ALTO`. Promedia **0,752** |

> [!danger] 🚨 Las tres columnas están vacías en las 22.142 filas `PROYECTADO`
> Filtra por `TIPO = REAL` **antes** de promediar cualquiera de ellas. Sin el filtro, los nulos sesgan el resultado silenciosamente.

> [!warning] ⚠️ No promedies `ERROR_PCT` para medir sesgo agregado
> Su máximo es **160** — no es un error de cálculo: son series con 1 o 2 inscritos reales, donde el denominador hace explotar el porcentaje. Para sesgo agregado usa `Σ ERROR_ABS / Σ INSCRITOS_REAL`, que es como se calcula el WAPE oficial.

**🧭 Desempeño histórico del modelo, año a año:**

| Año | WAPE | Lectura |
|---|---|---|
| 2022 | 0,342 | |
| 2023 | 0,338 | |
| 2024 | 0,407 | El peor — año con reestructuración de mallas |
| 2025 | 0,358 | |
| 2026 | 0,324 | El mejor |
| **Media** | **0,356** | Cobertura de banda 75,2% |

**👔 En una frase para el negocio:** el modelo se equivoca en torno a un tercio por asignatura individual, y acierta el rango 3 de cada 4 veces. Ese error es alto por fila y **bajo en el agregado** — que es donde vive la decisión de presupuesto.

---

### 4.3 ⭐ Auditoría de la conversión a secciones

Audiencia: 🔧 🧭 👔

Las seis columnas de secciones (§3.6) también están aquí, dimensionadas sobre
`PROY_ESTANDAR`. Y este archivo permite algo que el entregable no puede: **medir cuánto
acierta cada criterio**, porque para el mismo período tiene la proyección Y las
secciones que de verdad se abrieron.

Sobre **55.983 filas** de períodos cerrados (2022–2026):

| Criterio | Demanda que usa | Σ secciones | vs real | Exacta | ±1 |
|---|---|---|---|---|---|
| *REAL — lo que se abrió* | — | *168.974* | | | |
| **`N_SECCIONES_TEORICAS`** | inscritos **reales** | 123.334 | **−27,0%** | **71,9%** | **87,2%** |
| **`N_SECCIONES_TEORICAS_PROYECTADAS`** | `P50` del modelo | 127.154 | −24,7% | 66,5% | 84,3% |
| **`N_SECCIONES_PROMEDIO`** | `P50` del modelo | 204.448 | +21,0% | 38,4% | 83,2% |

**🧭 Estable año a año**, lo que dice que la brecha es estructural y no el artefacto
de un período raro:

| Año | Teór·**real** | Teór·**proy** | Brecha | Promedio | Σ real |
|---|---|---|---|---|---|
| 2022 | 64,5% | 61,3% | 3,2 pp | 34,5% | 36.215 |
| 2023 | 71,8% | 67,6% | 4,2 pp | 40,1% | 38.154 |
| 2024 | 73,7% | 68,4% | 5,3 pp | 37,0% | 36.839 |
| 2025 | **76,0%** | 68,4% | **7,6 pp** | 40,3% | 36.924 |
| 2026 | 74,0% | 66,2% | 7,8 pp | 40,9% | 20.842 |

> [!important] ⭐ Las dos primeras columnas separan DOS errores que antes se confundían
> `N_SECCIONES_TEORICAS` aplica la misma fórmula normativa pero sobre los inscritos
> **reales**. Compararlas responde dos preguntas distintas:
>
> | Comparación | Qué mide |
> |---|---|
> | `TEORICAS` vs `REALES` | el error de la **CONVERSIÓN** — cuánto falla el estándar |
> | `TEORICAS` vs `TEORICAS_PROYECTADAS` | el error del **MODELO** de demanda |
>
> **La brecha entre ambas es de 5,4 puntos** (71,9% vs 66,5%; entre 3 y 8 según el año)
> — ese es el costo del modelo de demanda. El resto, el **28% que falta para 100%**,
> es error del estándar, y **ningún modelo de demanda lo arregla**: aun acertando la
> demanda perfectamente, la conversión falla en más de una de cada cuatro asignaturas.
>
> ⚠️ Curiosidad que confirma el diagnóstico: con la demanda real el total se aleja
> (−27,0% vs −24,7%) aunque la exactitud por fila mejora. El modelo sobre-proyecta un
> poco y eso **compensa por casualidad** el sesgo a la baja del estándar. Dos errores
> en direcciones opuestas que se cancelan en el agregado — no es precisión, es suerte.
>
> 📌 Es el diagnóstico que dice **dónde invertir**: mejorar el modelo rinde pocos
> puntos; revisar el estándar rinde el cuarto que falta.

**👔 Lectura ejecutiva:** programar solo con el estándar normativo abriría **una de
cada cuatro secciones de menos**. Programar solo con el observado, una de cada cinco de
más. El número correcto está en medio, y por eso el entregable trae el rango en vez de
un valor único con falsa precisión.

> [!warning] ⚠️ `N_SECCIONES_REALES` cambia de significado según la fila — a propósito
> Si el período **ya ocurrió** (`TIPO = REAL`), trae **sus propias** secciones observadas.
> Si **aún no** (`TIPO = PROYECTADO`), las del homólogo del año anterior. Así la columna
> significa siempre *"las que se abrieron"*, y en el histórico es directamente comparable
> con las dos estimaciones. Vacía en el 8,5% de las filas: los períodos h2, cuyo
> homólogo tampoco existe.

---

## 5. Recetas de consulta

Audiencia: 🔧

**Total institucional correcto:**

```sql
SELECT SUM(P50_ESPERADO) FROM proyeccion;          -- 1.026.533  ✅
-- NO: SELECT SUM(P50)                             -- 1.126.278  ❌ (+8,9%)
```

**Vista para programación — con el código que existe en Banner:**

```sql
SELECT PERIODO, CODIGO_PROGRAMABLE, COMPONENTE, CAMPUS,
       P50, P90, PROB_SE_DICTA, confiabilidad,
       ASIGNATURA_REGLA          -- la familia, por trazabilidad
FROM proyeccion
ORDER BY CAMPUS, CODIGO_PROGRAMABLE, PERIODO;
-- la llave (PERIODO, CODIGO_PROGRAMABLE, COMPONENTE, CAMPUS) es única: 0 duplicados
```

**Las que cambiaron de código (para avisar a quien programa):**

```sql
SELECT DISTINCT ASIGNATURA_REGLA, CODIGO_PROGRAMABLE, N_CODIGOS_ORIGEN, CODIGOS_ORIGEN
FROM proyeccion
WHERE CODIGO_PROGRAMABLE <> ASIGNATURA_REGLA;   -- 505 códigos, 19% del volumen
```

**Plan de secciones — el rango a programar:**

```sql
SELECT PERIODO, CODIGO_PROGRAMABLE, COMPONENTE, CAMPUS,
       P50, PROB_SE_DICTA, confiabilidad,
       N_SECCIONES_TEORICAS_PROYECTADAS AS piso,   -- la norma
       N_SECCIONES_PROMEDIO             AS techo,  -- la práctica
       N_SECCIONES_REALES               AS ano_pasado
FROM proyeccion
WHERE PROB_SE_DICTA >= 0.5                 -- descarta las que probablemente no abren
ORDER BY CAMPUS, CODIGO_PROGRAMABLE, PERIODO;
```

**Dónde las dos estimaciones más discrepan (revisar a mano):**

```sql
SELECT CODIGO_PROGRAMABLE, COMPONENTE, CAMPUS, P50,
       ESTANDAR_TEORICO, ESTANDAR_PROMEDIO,
       N_SECCIONES_TEORICAS_PROYECTADAS, N_SECCIONES_PROMEDIO
FROM proyeccion
WHERE ABS(N_SECCIONES_PROMEDIO - N_SECCIONES_TEORICAS_PROYECTADAS) > 3
ORDER BY ABS(N_SECCIONES_PROMEDIO - N_SECCIONES_TEORICAS_PROYECTADAS) DESC;
```

**Asignaturas que exigen revisión manual:**

```sql
SELECT * FROM proyeccion
WHERE confiabilidad = 'baja' OR RIESGO_BAJA = 'alto'
ORDER BY P50 DESC;
```

**Demanda por sede, solo lo confiable:**

```sql
SELECT CAMPUS, SUM(P50_ESPERADO) AS demanda
FROM proyeccion
WHERE confiabilidad IN ('alta','media')
GROUP BY CAMPUS ORDER BY demanda DESC;
```

**Sesgo real del modelo por campus (WAPE, no promedio de porcentajes):**

```sql
SELECT CAMPUS,
       SUM(ERROR_ABS) / SUM(INSCRITOS_REAL) AS wape
FROM serie_completa
WHERE TIPO = 'REAL'
GROUP BY CAMPUS ORDER BY wape DESC;
```

**Serie continua de una asignatura, 2022→2027:**

```sql
SELECT PERIODO, TIPO, INSCRITOS_REAL, PROY_BAJO, PROY_ESTANDAR, PROY_ALTO
FROM serie_completa
WHERE MATERIA = 'DBIO' AND CURSO = '1069' AND COMPONENTE = 'TEO'
ORDER BY PERIODO;
```

---

## 6. Limitaciones declaradas

Audiencia: 🧭 👔

> [!warning] ⚠️ Lo que este entregable **no** hace
> | Limitación | Implicancia práctica |
> |---|---|
> | **No inventa asignaturas nuevas** | La grilla es la del `periodo_fuente`. Una asignatura que se crea en 2027 no aparece |
> | **No proyecta postgrado** | Solo `TT ∈ (05, 10, 15, 20, 25)` — pregrado y advance |
> | **No proyecta secciones (NRC): las deriva** | Por aritmética, `ceil(P50 / estándar)`. La `FASE 7e` entrega **dos estimaciones** (§3.6) porque ninguna acierta sola: la normativa abre 23,3% de menos, la observada 15,4% de más |
> | **El horizonte 2 es estructuralmente peor** | +16,5% de error, y su banda no está calibrada |
> | ~~Códigos destino que nunca se dictaron~~ ✅ **RESUELTO** | La `FASE 7d` agrega `CODIGO_PROGRAMABLE`: el 100% de las filas trae ahora un código que sí existe en Banner. Ver §3.5 |

**👔 En una frase para el negocio:** el modelo proyecta **la evolución de lo que ya existe**, no la creación de oferta nueva. El crecimiento por apertura de carreras o sedes es una decisión institucional que hay que sumar aparte.

---

## 7. Procedencia

Audiencia: 🔧

| | |
|---|---|
| **Notebook** | `MODELO_ML_PROYECCION_ASIGNATURAS.ipynb` — `FASE 7b` (entregable), `FASE 7c` (evidencia), `FASE 7d` (código programable), `FASE 7e` (secciones) |
| **Insumo** | `DEMANDA_PROCESADA.parquet` (163.954 × 57), producido por `PIPELINE_PROYECCION_ASIGNATURAS.ipynb` |
| **Dataset de entrenamiento** | 144.662 filas · 21.456 series · 55 períodos |
| **Algoritmo** | CatBoost sobre la corrección logarítmica, puntual y cuantiles |
| **Validación** | Walk-forward, 7 orígenes. **Nunca K-Fold** — ver Tomo 17 §10 |
| **Métricas vigentes** | WAPE 0,344 vs baseline 0,379 (**+9,1%**) · MASE 1,489 · sesgo +0,004 |
| **Generado** | 2026-08-27 · `FASE 7d` añadida el 2026-08-28 |

---

> **Diego Evans Pérez** · Ingeniería de Datos y Machine Learning
> Diccionario de entregables · `v1.4` · 2026-08-28
> Formato según [`Guía Maestra de Data Science`](../../../Data%20Science%20-%20Master%20Data/Guia-Maestra-DS/00-MOC-Guia-Maestra.md) — sistema de audiencias 🔧 🧭 👔

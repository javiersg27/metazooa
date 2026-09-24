# METAZOOA

METAZOOA es una aplicación web local-first para adivinar un animal diario por proximidad taxonómica. Esta primera versión no usa backend ni APIs externas para jugar: el objetivo del día se calcula localmente a partir de `fecha + seed`, y el progreso se conserva en `localStorage` cuando el navegador lo permite.

## Estructura

```text
/metazooa/
├── index.html
├── style.css
├── script.js
├── animals.js
├── manifest.json
├── service-worker.js
├── icon.svg
├── icon-192.png
├── icon-512.png
└── README.md
```

`icon.svg`, `icon-192.png` e `icon-512.png` son recursos adicionales para favicon/instalación PWA. El motor funciona también sin imágenes de animales: cada ficha utiliza un icono visual de respaldo incluido en los datos.

## Cómo empezar inmediatamente

Puedes abrir `index.html` directamente en un navegador de escritorio para probar la aplicación. La parte de juego funciona sin servidor siempre que el navegador permita persistencia local para ese origen.

Para desarrollo local completo, incluida PWA/offline, sirve la carpeta por `localhost`:

```bash
cd metazooa
python3 -m http.server 8080
```

Después abre:

```text
http://localhost:8080/
```

Para una instalación PWA publicada, utiliza HTTPS. Los service workers solo están disponibles en contextos seguros; `localhost` se trata como contexto seguro para desarrollo. `file://` no es una base fiable para service workers y el comportamiento de `localStorage` sobre `file:` no está definido entre navegadores. Ver referencias al final. 

## 1. Algoritmo de proximidad

La aplicación compara dos fichas taxonómicas mediante una jerarquía ordenada de rangos:

```text
Reino → Filo → [Subfilo] → Clase → [Subclase] → Orden → [Suborden]
      → Familia → [Subfamilia] → [Subgénero] → Género → Especie
```

Primero se comprueba el último rango compartido cuyo valor es idéntico. Ese rango es el ancestro taxonómico común más profundo disponible en las fichas comparadas.

Después se calcula una medida interna de distancia utilizando pesos de rango. Los rangos opcionales tienen un peso menor y sirven para refinar la comparación cuando están disponibles. El usuario no ve la puntuación numérica: la salida se convierte en cinco categorías:

- `MUY CERCA`
- `CERCA`
- `RELACIONADO`
- `LEJANO`
- `MUY LEJANO`

Una coincidencia exacta de especie termina la partida.

La interfaz también muestra qué rama comparten. Por ejemplo, dos especies del mismo género aparecen como “mismo género, especies distintas”; dos especies de la misma familia pero de géneros distintos convergen en la familia y después se separan.

## 2. Ancestro común / LCA

`findLCA()` recorre los rangos taxonómicos desde Reino hasta Especie y conserva la última coincidencia. Por ejemplo:

```text
Panthera tigris + Panthera leo → Panthera en Género
Panthera tigris + Canis lupus  → Carnivora en Orden
Panthera tigris + Aquila chrysaetos → Chordata en Filo
```

El resultado se utiliza tanto en el cálculo de cercanía como en el mensaje de dirección taxonómica.

## 3. Animal del día

El objetivo se selecciona con:

```text
seed fijo + versión del dataset + fecha local + índice determinista
```

No se usa `Math.random()` para el animal diario.

El día de la semana controla la dificultad mediante `CONFIG.DIFFICULTY_BY_WEEKDAY`. La primera configuración es:

```text
Domingo  FÁCIL
Lunes    FÁCIL
Martes   MEDIO
Miércoles DIFÍCIL
Jueves   MEDIO
Viernes  DIFÍCIL
Sábado   EXPERTO
```

El selector evita, dentro de lo posible, repetir un objetivo durante los 14 días anteriores. Si la versión del dataset cambia, el historial determinista también puede cambiar para fechas futuras; por eso la selección incorpora `DATASET_VERSION`.

Los parámetros configurables están al principio de `script.js`:

```js
MIN_DIFFICULTY
MAX_DIFFICULTY
ALLOW_EXTINCT
ALLOW_SUBSPECIES
```

## 4. Búsqueda

`SearchIndex` construye índices `Map` para:

- nombre exacto normalizado,
- prefijos de tres caracteres,
- bigramas de dos caracteres.

La consulta se normaliza eliminando diacríticos, diferencia de mayúsculas/minúsculas y algunos signos. La búsqueda fuzzy utiliza distancia de Levenshtein acotada y solo amplía el conjunto de candidatos cuando es necesario.

La misma especie se identifica siempre por `id`, por lo que escribir su alias, nombre común o nombre científico no permite registrarla dos veces en la partida.

## 5. Pokédex

Cada intento válido hace dos cosas:

1. Añade el animal al historial de la partida.
2. Desbloquea el registro del animal en la Pokédex y actualiza su contador de uso.

La Pokédex conserva:

```text
unlocked
usageCount
dailyTimesUsed
firstDiscovered
lastUsed
```

Los animales no descubiertos se muestran como tarjetas bloqueadas. El motor puede recibir `image`, `thumbnail` o `silhouette` en `animals.js`; si no hay imagen se utiliza el icono visual de respaldo del registro.

## 6. localStorage

Toda la persistencia pasa por `StorageManager`. La clave actual es:

```text
metazooa.state.v1
```

La estructura está versionada:

```js
{
  version: 1,
  settings: {},
  game: {},
  dailyHistory: {},
  stats: {},
  pokedex: {}
}
```

Así se puede añadir una migración futura sin acoplar la UI al almacenamiento.

Si `localStorage` no está disponible, la aplicación sigue funcionando durante la sesión, pero mostrará que el almacenamiento es temporal.

## 7. Exportar / importar

La exportación genera un JSON que contiene:

```text
app
version
exportedAt
datasetVersion
state
```

La importación comprueba el identificador de la aplicación, versión, estructura básica, fechas y que los IDs de animales existan en la edición cargada. Los registros desconocidos se descartan.

## 8. Ampliar la base de animales

`animals.js` contiene exclusivamente datos. No hay lógica de juego dentro de ese archivo.

Cada registro debe mantener como mínimo:

```js
{
  id,
  commonName,
  scientificName,
  aliases,
  kingdom,
  phylum,
  class,
  order,
  family,
  genus,
  species,
  taxonomy,
  habitat,
  rarity,
  difficulty,
  image,
  thumbnail,
  silhouette,
  icon
}
```

Para ampliar a cientos o miles de animales:

1. Añade registros con `id` únicos.
2. Mantén nombres científicos aceptados y taxonomía verificable.
3. Evita nombres comunes ambiguos como único identificador.
4. Mantén `scientificName` y `species` coherentes.
5. Conserva `taxonomy` y los campos planos sincronizados.
6. Incrementa `DATASET_VERSION` si el cambio altera la selección diaria que ya hayas publicado.

El motor no necesita modificarse para pasar de 201 animales a varios miles; los índices de búsqueda y el filtrado están separados del renderizado.

## 9. PWA

La aplicación incluye:

- `manifest.json`
- `service-worker.js`
- iconos 192/512
- caché del app shell
- estrategia cache-first con actualización en segundo plano para recursos de la misma aplicación

El service worker precarga HTML, CSS, JavaScript, datos e iconos. Por tanto, una vez visitada la aplicación y completado el registro del worker, la interfaz principal puede seguir funcionando sin red.

Para instalarla como PWA en producción, sirve el proyecto por HTTPS. Para desarrollo, `http://localhost` es válido para probar service workers.

## 10. Instalar en iPhone

En Safari, abre la URL HTTPS de la aplicación y utiliza **Compartir → Añadir a pantalla de inicio**. La interfaz está preparada para `viewport-fit=cover`, `100dvh` indirectamente mediante layouts flexibles y `safe-area-inset-bottom` en la navegación móvil.

La función de compartir utiliza `navigator.share()` cuando está disponible y, en caso contrario, intenta usar el portapapeles.

## 11. Ejecutar en Windows

Con Python:

```bash
cd metazooa
python -m http.server 8080
```

Abre `http://localhost:8080` en Chrome o Edge.

También puedes usar cualquier servidor estático equivalente (por ejemplo, un servidor local de Node).

## 12. Backend futuro

La separación actual es:

```text
animals.js      → DATA
script.js       → GAME LOGIC + STORAGE + UI ORCHESTRATION
style.css       → PRESENTATION
service-worker  → OFFLINE DELIVERY
```

En una segunda etapa, `StorageManager` puede sustituirse por una capa API sin cambiar el motor de proximidad. El backend podría almacenar perfiles, estadísticas globales, objetivos diarios firmados, imágenes, versiones de dataset y descubrimientos por usuario.

Para un backend real, la selección diaria ya no debería considerarse secreta en el cliente. El servidor puede entregar solo los datos necesarios para validar el intento y ocultar el objetivo.

## 13. Limitaciones deliberadas de la versión frontend

Un juego 100% frontend **no puede ocultar completamente el animal diario** frente a un usuario que inspeccione el JavaScript o los datos descargados. Tampoco puede impedir de forma fiable que alguien manipule la fecha del dispositivo.

Esta versión solo realiza detecciones básicas de retroceso de fecha mediante una marca local y documenta la limitación. No se presenta como un sistema antifraude.

La seguridad real del objetivo requiere que el secreto y la validación crítica vivan en un backend.

## 14. Taxonomía y fuentes de referencia

La base inicial es una colección manual de especies animales conocidas, con una clasificación diseñada para el juego y alineada con rangos zoológicos ampliamente utilizados. La taxonomía puede cambiar según la fuente o revisión científica; por eso la aplicación mantiene la jerarquía como datos y no como reglas codificadas.

Como referencias para futuras ampliaciones y verificaciones:

- Catalogue of Life: versión actual 2026-08-26 XR y documentación de clasificación/nombres aceptados.
- GBIF Backbone Taxonomy y Species API/documentación de matching.
- WoRMS para taxones marinos cuando corresponda.

No se debe interpretar esta base de 201 especies como una copia completa de ningún catálogo global. Para una base de miles o decenas de miles conviene generar/verificar los registros desde fuentes taxonómicas mantenidas y guardar la versión exacta utilizada.

## 15. QA de esta entrega

La versión se ha revisado con comprobaciones automáticas y manuales sobre:

- sintaxis JavaScript,
- IDs únicos de animales,
- campos obligatorios de los registros,
- búsqueda normalizada y fuzzy,
- protección contra duplicados en la partida,
- selección determinista diaria,
- rollover de fecha y cuenta atrás local,
- persistencia y recuperación,
- exportación/importación,
- reset con doble confirmación,
- rutas de service worker y app shell,
- responsive CSS para móvil/tablet/escritorio,
- soporte táctil sin depender de `hover`,
- `prefers-reduced-motion`,
- `navigator.share` con fallback de portapapeles.

La comprobación real en Safari/iPhone físico requiere un dispositivo Apple; el código evita APIs obligatorias que solo existan en Safari y usa feature detection para las funciones opcionales.

## Fuentes técnicas

Catalogue of Life: https://www.catalogueoflife.org/
GBIF Species API / taxonomic processing: https://techdocs.gbif.org/
MDN Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
MDN Making PWAs installable: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
MDN Web Share API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API
MDN `localStorage`: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

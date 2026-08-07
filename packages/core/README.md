# @nanoplayer/core

Núcleo del reproductor: manifiesto, ciclo de vida, motores, sincronización y
registro de plugins. Sin interfaz — los controles van en `@nanoplayer/ui`.

Sin dependencias en tiempo de ejecución. **7,5 KB gzip** en el bundle IIFE.

---

## El manifiesto

Describe **qué** hay que reproducir, nunca **cómo**. No menciona motores,
elementos `<video>` ni layouts: si algún día hace falta cambiar de motor, el
manifiesto no se entera.

Es **JSON**, sin formato propio. Se puede pasar de dos formas:

```js
// Objeto, si la página ya tiene los datos
createPlayer({ container, manifest: { id: 'x', streams: [...] } });

// URL, que se pide y se parsea como JSON
createPlayer({ container, manifest: '/api/video/123' });
```

JSON porque lo emite cualquier backend sin esfuerzo. Un formato propio
obligaría a escribir y mantener un parser que nadie ha pedido. Si tu API
devuelve otra cosa, `manifestResolver` puede traducirla: el reproductor solo
mira la forma final.

### Mono-stream, el caso mínimo

```json
{
  "id": "clase-1",
  "title": "Introducción a la termodinámica",
  "poster": "https://ejemplo/miniatura.jpg",
  "duration": 3600,
  "streams": [
    {
      "id": "camara",
      "role": "presenter",
      "audio": true,
      "sources": [
        { "src": "https://ejemplo/video.mp4", "type": "video/mp4" }
      ]
    }
  ]
}
```

### Dual-stream

```json
{
  "id": "clase-1",
  "duration": 3600,
  "streams": [
    {
      "id": "camara", "role": "presenter", "label": "Ponente",
      "audio": true,
      "sources": [{ "src": "camara.mp4", "type": "video/mp4" }]
    },
    {
      "id": "diapositivas", "role": "presentation", "label": "Diapositivas",
      "audio": false,
      "sources": [{ "src": "diapositivas.mp4", "type": "video/mp4" }]
    }
  ]
}
```

> **Exactamente un stream puede llevar `audio: true`.** No es una convención
> estética: ese stream es el maestro del reloj de sincronización y los demás lo
> persiguen. El spike S1 midió que alterar la velocidad del stream con audio se
> oye, así que la corrección recae en los mudos; y S2 midió que **iOS no
> reproduce dos pistas de audio a la vez**. Un manifiesto con dos se rechaza al
> validar, en lugar de producir un reproductor que falla solo en iPhone.

### HLS

Idéntico, cambiando el tipo MIME de las fuentes:

```json
{
  "streams": [
    {
      "id": "camara", "role": "presenter", "audio": true,
      "sources": [
        { "src": "camara.m3u8", "type": "application/vnd.apple.mpegurl" }
      ]
    }
  ]
}
```

Con `@nanoplayer/engine-hls` registrado, ese tipo hace que gane hls.js donde hay
MediaSource y el motor nativo donde no. **No cambia nada más del manifiesto.**

### Varias calidades

```json
"sources": [
  { "src": "video-1080.mp4", "type": "video/mp4", "height": 1080, "label": "1080p" },
  { "src": "video-720.mp4",  "type": "video/mp4", "height": 720 },
  { "src": "video-360.mp4",  "type": "video/mp4", "height": 360 }
]
```

El motor elige. Con HLS la selección adaptativa la hace hls.js y basta una
fuente.

### Subtítulos

```json
"textTracks": [
  { "src": "es.vtt", "lang": "es", "label": "Español", "kind": "subtitles", "default": true },
  { "src": "en.vtt", "lang": "en", "label": "English", "kind": "subtitles" }
]
```

Con `@nanoplayer/plugin-captions` cargado, esto **activa los subtítulos sin
configurar nada**: el plugin declara que le corresponde actuar cuando el
manifiesto trae pistas.

### Solo audio

No hace falta declarar nada: el tipo MIME basta.

```json
{
  "id": "podcast-1",
  "poster": "https://ejemplo/caratula.jpg",
  "streams": [
    {
      "id": "locucion", "role": "presenter", "audio": true,
      "sources": [{ "src": "audio.m4a", "type": "audio/mp4" }]
    }
  ]
}
```

La carátula **se queda puesta durante la reproducción** en lugar de dejar un
rectángulo negro. Sin `poster`, el reproductor se reduce a la barra de
controles: reservar un hueco de vídeo vacío no aporta nada.

Cuando el MIME no basta —HLS con solo audio, donde el tipo es el mismo que para
vídeo— se declara explícitamente:

```json
{ "id": "x", "role": "presenter", "audio": true, "kind": "audio",
  "sources": [{ "src": "audio.m3u8", "type": "application/vnd.apple.mpegurl" }] }
```

### Audio con diapositivas

Una clase sin cámara pero con la presentación. El modelo maestro/esclavo no
cambia: **el audio es el maestro** y el vídeo mudo lo persigue.

```json
"streams": [
  { "id": "locucion", "role": "presenter", "audio": true,
    "sources": [{ "src": "audio.m4a", "type": "audio/mp4" }] },
  { "id": "slides", "role": "presentation", "audio": false,
    "sources": [{ "src": "slides.mp4", "type": "video/mp4" }] }
]
```

### Anotaciones

Datos anclados al timeline. Unifica lo que parecen features sueltas: recorte,
capítulos y contenido interactivo son consumidores del mismo mecanismo, y añadir
uno nuevo no toca el núcleo.

```json
"annotations": [
  { "kind": "trim", "start": 12, "end": 3500 },
  { "kind": "chapter", "start": 60, "end": 900, "title": "Primer principio" },
  { "kind": "h5p", "start": 300, "data": { "library": "H5P.Blanks 1.14" } }
]
```

Un `kind` desconocido **pasa la validación**: lo resolverá su plugin, no el
núcleo.

### Directo

```json
{
  "id": "clausura",
  "live": true,
  "liveWaitingImage": "https://ejemplo/empieza-a-las-10.jpg",
  "streams": [
    { "id": "camara", "role": "presenter", "audio": true,
      "sources": [{ "src": "camara.m3u8", "type": "application/vnd.apple.mpegurl" }] },
    { "id": "slides", "role": "presentation", "audio": false,
      "sources": [{ "src": "slides.m3u8", "type": "application/vnd.apple.mpegurl" }] }
  ]
}
```

`liveWaitingImage` es aparte de `poster` a propósito: el póster es lo que se ve
**antes** de pulsar play; esto es lo que se ve **después**, esperando. Suelen
querer decir cosas distintas. Si falta, se usa el póster.

**Un flujo que no emite no impide reproducir el resto.** El aviso aparece en el
hueco del que falta, y se reintenta con espera creciente hasta que empieza. El
estado se consulta con `player.liveStatus` y `player.liveStatusOf(id)`, y llega
por el evento `live:status`.

Se distingue **"aún no ha empezado"** de **"se ha interrumpido"**: decirle lo
primero a quien llevaba veinte minutos viendo el evento sería desconcertante.

> **Requisito para dual-stream en vivo:** ambas listas deben traer
> `EXT-X-PROGRAM-DATE-TIME`. Sin esa etiqueta el reproductor **no puede medir**
> si los flujos están sincronizados —`currentTime` en directo tiene su origen en
> el momento en que cada uno empezó a cargar— y por eso no corrige, en lugar de
> fingir. En Wowza es la propiedad `cupertinoEnableProgramDateTime`, desactivada
> por defecto.

Un recorte sobre un directo se rechaza: no tiene sentido.

---

## Referencia

### Manifest

| Campo | Tipo | |
|---|---|---|
| `id` | `string` | **Requerido** |
| `streams` | `Stream[]` | **Requerido**, al menos uno |
| `title` | `string` | |
| `poster` | `string` | También se puede pasar en `createPlayer` para tenerlo sin resolver |
| `duration` | `number` | Segundos |
| `annotations` | `Annotation[]` | |
| `textTracks` | `TextTrackDef[]` | |
| `live` | `boolean` | |

### Stream

| Campo | Tipo | |
|---|---|---|
| `id` | `string` | **Requerido**, único |
| `role` | `string` | **Requerido**. `presenter`, `presentation` u otro |
| `audio` | `boolean` | **Requerido**. Exactamente uno a `true` |
| `sources` | `Source[]` | **Requerido**, al menos una |
| `kind` | `'video' \| 'audio'` | Se deduce del MIME; solo hace falta si es ambiguo |
| `label` | `string` | |
| `poster` | `string` | |

### Source

| Campo | Tipo | |
|---|---|---|
| `src` | `string` | **Requerido** |
| `type` | `string` | **Requerido**. El MIME decide el motor |
| `height` | `number` | |
| `label` | `string` | |

---

## Validar antes de reproducir

```ts
import { validateManifest } from '@nanoplayer/core';

const r = validateManifest(datos);
if (!r.ok) {
  for (const e of r.errors) console.error(`${e.path}: ${e.message}`);
}
```

Los errores se **acumulan**, no se para en el primero: corregir un manifiesto de
error en error es exasperante. Y cada mensaje dice el porqué, no solo el qué.

# @nanoplayer/bundle

El reproductor entero en un fichero, con la interfaz y los subtítulos ya
puestos. **69 KB, 22 KB gzip.**

Es el paquete del objetivo O5: instalar con una etiqueta `<script>` y tres
líneas, sin build, sin herramientas y sin npm.

```html
<div id="player"></div>
<script src="nanoplayer.min.js"></script>
<script>
  NanoPlayer.create('#player', { manifest: '/api/video/123' });
</script>
```

Eso da un reproductor **con controles**: barra accesible, menú de ajustes,
disposiciones y subtítulos si el manifiesto trae pistas.

---

## En qué se diferencia del núcleo

`@nanoplayer/core` es *headless* a propósito — hay quien quiere su propia
interfaz — así que su `create()` no monta ningún control. Aquí sí:

```js
create('#player', { manifest });                    // con barra
create('#player', { manifest, controls: false });   // sin ella
create('#player', { manifest, controls: { lang: 'en' } });
```

Todo lo demás es igual, incluido **el ciclo perezoso**: montar la interfaz no
descarga nada. Con el póster a la vista no hay ningún `<video>` en el DOM ni un
byte de vídeo pedido, y eso se comprueba en CI cargando este fichero en un
navegador de verdad.

## Una cosa o la otra, no las dos

Este bundle **lleva el núcleo dentro**. Si en la misma página se carga además
`@nanoplayer/core` por su cuenta, habrá dos registros de plugins y dos
políticas de reproducción exclusiva, y ninguno verá al otro. Los plugins no se
activarían y dos reproductores podrían sonar a la vez.

Con un build propio, usar los paquetes sueltos:

```js
import { create } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
```

## Qué NO lleva

**El motor de HLS.** `@nanoplayer/engine-hls` carga hls.js con un `import()`
dinámico, y en una etiqueta `<script>` clásica no hay quien resuelva ese
especificador.

En la práctica eso significa:

| | HLS |
|---|---|
| Safari y iOS | **Sí**, por el motor nativo |
| Chrome, Firefox, Edge | No |
| MP4 en todas partes | Sí |

Quien necesite HLS en escritorio tiene que ir por npm y registrar el motor.
Está anotado como pendiente: la salida razonable es que el bundle busque un
`window.Hls` ya cargado, para que baste con añadir hls.js desde un CDN en otra
etiqueta.

## Idiomas

Español e inglés de serie, y el resto es configuración:

```js
NanoPlayer.create('#player', { manifest, lang: 'eu', strings: {
  eu: { 'ui.play': 'Erreproduzitu' },
} });
```

Ver [`@nanoplayer/ui`](../ui/README.md#idiomas).

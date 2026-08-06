# @nanoplayer/ui

Interfaz por defecto de NanoPlayer: barra de controles accesible.

Paquete aparte a propósito. El núcleo se queda *headless* —hay quien querrá su
propia interfaz— y el bundle "con pilas incluidas" lleva ambos, así que el caso
`<script>` sigue siendo una etiqueta.

```ts
import { createPlayer } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';

const player = createPlayer({ container, manifest: '/api/video/123' });
await player.attach();
attachControls(player, { lang: 'es' });
```

## Accesibilidad

No es una intención: se comprueba en CI y **bloquea el merge**.

| Decisión | Por qué |
|---|---|
| Botones `<button>` nativos | Traen rol, activación por teclado y foco. Un `<div role="button">` obliga a reimplementarlo todo |
| `<input type="range">` para progreso y volumen | Traen teclado, gestos táctiles y anuncio de valores |
| `aria-valuetext` con tiempo hablado | Un lector diría "735"; con esto dice "12 minutos y 15 segundos" |
| La barra no se oculta con el foco dentro | Quien navega con teclado perdería de vista el control en uso |
| Región `role="status"` | Para lo que solo se percibe mirando: buffering, errores |
| Sin Shadow DOM | Las relaciones ARIA no cruzan bien esa frontera, y obligaría a exponer un `::part` por elemento para poder darle estilo |

**Lo que la comprobación automática NO cubre:** axe-core detecta alrededor de un
tercio de los problemas reales. Que pase en verde evita regresiones, pero no
sustituye una revisión con lector de pantalla.

## Teclado

| Tecla | Acción |
|---|---|
| `Espacio` / `K` | Reproducir o pausar |
| `←` / `→` | ∓5 s |
| `J` / `L` | ∓10 s |
| `↑` / `↓` | Volumen |
| `M` | Silenciar |
| `F` | Pantalla completa |
| `0`–`9` | Saltar a ese porcentaje |
| `Inicio` / `Fin` | Principio o final |

Los atajos ceden las teclas que el control enfocado ya usa: las flechas sobre un
deslizador son suyas, y el espacio sobre un botón lo activa.

## Subtítulos

Se pintan en una capa del ancho del reproductor, no dentro de un `<video>`. El
navegador los dibujaría dentro del elemento, y en un layout lado a lado eso los
encajona en la mitad del ancho.

El `<track>` sigue ahí en modo `hidden`: el navegador parsea el WebVTT y
gestiona los tiempos —que es lo difícil— y solo se toma el control de dónde se
pintan. **Lo que se pierde son las preferencias de subtítulos del sistema
operativo**, así que se exponen como variables:

```css
.np {
  --np-cue-color: #fff;
  --np-cue-bg: rgba(0, 0, 0, .78);
}
.np .np__cue { --np-cue-size: 1.4rem; }   /* por defecto escala con el ancho */
```

## Dentro de un iframe

Funciona sin más, pero **la pantalla completa necesita permiso explícito**:

```html
<iframe src="…" allow="fullscreen; autoplay; picture-in-picture"></iframe>
```

Sin ese atributo la llamada se rechaza con *Disallowed by permissions policy*, y
el botón **se oculta solo** en lugar de quedarse sin hacer nada.

Ojo con una consecuencia menos obvia: el `PlayerRegistry` no cruza iframes, así
que varios reproductores en varios iframes dejan de coordinarse entre sí.

## Theming

Todo lo personalizable son variables CSS. Se puede rediseñar el reproductor
entero sin forkear:

```css
.np {
  --np-color-accent: #c8102e;
  --np-control-size: 3rem;
  --np-bar-height: 6px;
  --np-radius: 0;
}
```

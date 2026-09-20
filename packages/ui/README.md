# @nanoplayer/ui

Interfaz por defecto de NanoPlayer: barra de controles accesible.

Paquete aparte a propósito. El núcleo se queda *headless* —hay quien querrá su
propia interfaz— y el bundle "con pilas incluidas" lleva ambos, así que el caso
`<script>` sigue siendo una etiqueta.

```ts
import { createPlayer } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';

const player = createPlayer({ container, manifest: '/api/video/123', lang: 'es' });
await player.attach();
attachControls(player);
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

## Idiomas

Español e inglés de serie. **Añadir otro es configuración, no un fork:**

```ts
create('#player', {
  manifest,
  lang: 'eu',
  strings: {
    eu: {
      'ui.play': 'Erreproduzitu',
      'ui.pause': 'Pausatu',
      'ui.mute': 'Mututu',
    },
  },
});
```

Lo que el idioma nuevo no cubra cae al catálogo base, así que una traducción a
medias deja el reproductor usable en vez de con botones en blanco. Una clave que
no existe en ninguna parte **se enseña tal cual** —`ui.play`— porque un hueco
vacío no dice dónde mirar.

Sirve igual para cambiar una sola palabra, que es el caso más frecuente y el que
peor se lleva con un PR al proyecto:

```ts
create('#player', { manifest, strings: {
  es: { 'ui.layout.presentation': 'Pizarra' },
} });
```

El idioma se dice **una vez**, en `create()`, y lo heredan la barra, el póster y
todos los plugins. `attachControls(player, { lang })` existe solo para el caso
raro de que la barra deba hablar en otro distinto.

Sin decir nada se usa el del documento que contiene al reproductor
(`<html lang>`), y `es` si tampoco lo declara. Un `es-MX` sirve el catálogo `es`.

### Las claves

| Prefijo | Qué cubre |
|---|---|
| `ui.*` | Botones y deslizadores de la barra |
| `ui.status.*` | Región viva: reproduciendo, en pausa, cargando |
| `ui.live.*` | Directo: distintivo, espera, ir al borde |
| `ui.poster.*` | El póster antes de reproducir |
| `ui.settings.*` | Menú de ajustes |
| `ui.layout.*` | Nombres de las disposiciones |
| `captions.*` | Plugin de subtítulos |

Las que llevan variable la escriben entre llaves —`'Retrasado: {tiempo}'`—
para que cada idioma ponga las palabras en su orden.

### Lo que no hace falta traducir

Los tiempos y los porcentajes los formatea `Intl`, no este catálogo. `12
minutos y 15 segundos` para `aria-valuetext`, `35 %` para el volumen, y ambos
salen bien en cualquier idioma sin que nadie escriba una cadena: en euskera el
signo va delante —`% 35`— y en inglés va pegado.

### Añadir un idioma al proyecto

Un objeto más en `packages/ui/src/strings.ts`, con las mismas claves que el
español. No hay que tocar nada más.

**CI comprueba que la traducción está completa**, y lo hace contra el idioma
base, así que un idioma nuevo queda cubierto sin tocar el test. Falla si:

- falta alguna clave del base — y dice cuáles, por nombre;
- sobra alguna que el base no tenga, que casi siempre es una errata;
- alguna cadena está vacía;
- **se pierde una variable.** Si `ui.live.behindBy` es `'Retrasado: {tiempo}'`
  y la traducción pone solo `'Behind live'`, no falta la clave ni está vacía:
  simplemente el tiempo deja de aparecer. Es el fallo que no se ve leyendo el
  diff.

### Desde un plugin

`ctx.t` llega en el contexto, así que un plugin **no deduce el idioma ni trae su
propia tabla**:

```ts
plugins.register({ id: 'mio', load: () => ({
  activate(ctx) {
    ctx.whenUi((ui) => ui.addBarControl({
      id: 'mio', icon: ICONO, label: () => ctx.t('mio.label'), onActivate,
    }));
  },
}) });

// Al cargarse, el plugin aporta sus cadenas al catálogo compartido:
strings.register('es', { 'mio.label': 'Lo mío' });
```

Quien integre puede sobrescribirlas con `strings` sin tocar el plugin.

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

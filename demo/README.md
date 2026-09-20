# Demo

Dos páginas con propósitos distintos, servidas por el mismo Vite:

| | |
|---|---|
| [`index.html`](index.html) | **El reproductor**, tal cual lo vería quien lo integre. Sin instrumentación |
| [`banco.html`](banco.html) | **El banco de pruebas del núcleo**, con el ciclo de vida en crudo |

```bash
./gen-media.sh     # requiere ffmpeg; genera los vídeos con timecode incrustado
pnpm install
pnpm --filter @nanoplayer/demo dev    # http://localhost:5180
```

La demo apunta al **código fuente** de los paquetes, no a su build: los cambios
se ven al instante mientras se desarrolla.

---

## El reproductor

Dual-stream sincronizado, subtítulos en dos idiomas, menú de ajustes y barra de
controles. Son literalmente las tres líneas que promete el objetivo O5:

```ts
import '@nanoplayer/plugin-captions';   // se auto-registra

const player = create('#player', { manifest: MANIFIESTO });
attachControls(player, { lang: 'es' });
```

El panel de la derecha no forma parte de lo que necesitaría un integrador: está
para poder ver el estado, el número de elementos `<video>` y el bus de eventos
sin abrir las herramientas de desarrollo.

Lo que conviene mirar:

- **Mientras se ve el póster no hay ningún `<video>` en el DOM** ni se ha
  descargado un byte de vídeo. El contador lo enseña.
- **Los subtítulos se activan solos** porque el manifiesto trae `textTracks`. No
  hay una línea de configuración que los encienda.
- **Se navega entero con el teclado.** Dentro del menú de ajustes recorren las
  flechas, no Tab, y `Esc` retrocede un panel antes de cerrar.
- **Los layouts están en el menú de ajustes**, bajo *Disposición*: lado a lado,
  imagen en imagen, solo ponente y solo presentación. Aparecen solos porque el
  manifiesto trae dos streams.

## El banco de pruebas del núcleo

Usa la API pública tal cual la usaría un integrador — si algo aquí necesitase
saltársela, sería señal de que la API está mal. Lo que cambia es que los pasos
del ciclo de vida son botones, porque eso es justamente lo interesante de
enseñar.

**Seis escenarios**, elegibles en el desplegable: mono-stream, dual-stream, los
mismos dos por HLS, solo audio, audio con diapositivas, y un manifiesto inválido
con dos pistas de audio.

### Qué demuestra

**El ciclo de vida perezoso, con los números a la vista.** El contador de
peticiones de red y el de elementos `<video>` cambian al avanzar de estado:

| Estado | Peticiones | Elementos `<video>` |
|---|---|---|
| `idle` | 0 | 0 |
| `resolved` | 1 | 0 |
| `attached` | 1 | 2 |

**Que el sincronizador corrige de verdad.** *Desincronizar 400 ms* mete el
desfase a propósito; la deriva y la acción del lazo se ven en vivo, y el valor
vuelve por debajo de los 33 ms de un frame. El spike S1 midió una mediana de
9,8 ms.

**Que soltar el motor conserva la posición.** Pulsa *Soltar motor* a mitad de
reproducción: los elementos `<video>` desaparecen del DOM, se liberan los
decodificadores y la posición queda guardada. Al volver a enganchar, continúa
donde estaba. Es lo que hace viable una página con muchos reproductores — S2
midió el techo del navegador en 17 elementos (WebKit) y 18 (Blink).

**Que el motor se elige por capacidad, no por condicionales.** En el escenario
HLS gana hls.js donde hay MediaSource y el nativo donde no, sin que cambie nada
más del manifiesto. El evento `engine:attach:ok` dice cuál ha ganado.

**Que el bus lo cuenta todo.** El registro de eventos es literalmente lo que ve
`bus.onAny()`, que es por donde se conectará la analítica sin tocar el núcleo.

**Que la validación no es decorativa.** El manifiesto con dos pistas de audio
falla con el motivo: *"playing two tracks at once does not work on iOS"*.
Los mensajes de validación van en inglés a propósito: los lee quien
integra, por consola, y son lo que se acaba pegando en un buscador.

---

## Lo que todavía no se ve aquí

Funciona en el núcleo, pero no tiene escenario en la demo: el **directo**
—ventana DVR, salto al borde, espera por flujo— que validó el spike
[S5](../spikes/s5-live-dual/), y el caso **multi-instancia** de muchos
reproductores coordinándose en una misma página.

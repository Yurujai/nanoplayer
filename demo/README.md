# Demo

La web pública del proyecto. Cuatro páginas servidas por el mismo Vite, **todas
en inglés**, que se publican en la raíz de GitHub Pages:

| | |
|---|---|
| [`index.html`](index.html) | **Portada.** Qué es el reproductor, por qué existe y qué casos resuelve. Solo texto y tres botones |
| [`video/`](video/index.html) | **Demo de vídeo.** El reproductor completo con MP4, mono o dual, con o sin cabecera y cola |
| [`live/`](live/index.html) | **Demo de directo.** Dual en directo sobre un canal público de pruebas |
| [`bench/`](bench/index.html) | **Banco de pruebas** del núcleo, con el ciclo de vida en crudo |

```bash
./gen-media.sh     # requiere ffmpeg; genera los vídeos con timecode incrustado
pnpm install
pnpm --filter @nanoplayer/demo dev    # http://localhost:5180
```

La web apunta al **código fuente** de los paquetes, no a su build: los cambios
se ven al instante mientras se desarrolla. Los estilos comunes están en
[`src/site.css`](src/site.css).

Las direcciones antiguas (`/demo/` y `/demo/banco.html`) las redirige el
workflow de Pages, para no romper los enlaces ya compartidos.

---

## Demo de vídeo (`video/`)

Es literalmente lo que haría un integrador: `create()` y `attachControls()`.
Lo único propio de la demo es cambiar de manifiesto sin recargar, y se hace
igual que lo haría cualquiera: destruir el reproductor y crear otro,
conservando la posición. Activar la cabecera a mitad de clase **no la
repite**: sigue por donde iba.

- **Mientras se ve el póster no hay ningún `<video>` en el DOM** ni se ha
  descargado un byte de vídeo.
- **Los subtítulos se activan solos** porque el manifiesto trae `textTracks`.
- **Los layouts están en el menú de ajustes**, bajo *Layout*, y solo aparecen
  en dual.
- **Cabecera y cola**, desactivadas por defecto para que quien entra por
  primera vez no vea antes que nada una cabecera.

Es la página que auditan en CI `e2e/a11y.mjs` y `e2e/teclado.mjs`.

## Demo de directo (`live/`)

GitHub Pages solo sirve ficheros estáticos, así que el directo es de fuera: el
**canal público de pruebas de [ireplay.tv](https://ireplay.tv/)**, que emite
24/7 con unos 25 minutos de ventana DVR, CORS abierto y
`EXT-X-PROGRAM-DATE-TIME`, el requisito para sincronizar dos directos (spike
[S5](../spikes/s5-live-dual/)). Sus condiciones piden enlazarlo donde se use, y
la página lo hace.

- **Los dos flujos son el mismo canal:** la lista principal, con audio, hace de
  cámara, y una variante de solo vídeo, de diapositivas. Por eso la
  sincronización se ve a simple vista: las dos mitades enseñan el mismo
  fotograma.
- **Se abre en directo.** El canal declara `EXT-X-START:TIME-OFFSET=36`, que
  pide empezar casi 25 minutos por detrás. El reproductor lo respeta porque es
  el estándar; la demo salta al borde una vez, en cuanto se sabe dónde está.
- **Si el canal cae, la demo también.** Es una dependencia de terceros, y la
  página lo avisa. Para usar otro basta con cambiar `FUENTES` en
  [`src/live.ts`](src/live.ts).

## Banco de pruebas (`bench/`)

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

**Que el sincronizador corrige de verdad.** *Desync by 400 ms* mete el
desfase a propósito; la deriva y la acción del lazo se ven en vivo, y el valor
vuelve por debajo de los 33 ms de un frame. El spike S1 midió una mediana de
9,8 ms.

**Que soltar el motor conserva la posición.** Pulsa *Detach engine* a mitad de
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


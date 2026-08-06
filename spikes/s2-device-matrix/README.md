# Spike S2 — Matriz de dispositivos

**Preguntas que responde**, y que no se pueden contestar desde un solo equipo:

1. ¿Cuántos vídeos simultáneos aguanta el dispositivo? → fija el presupuesto del
   `PlayerRegistry` (también resuelve **S4**)
2. ¿`requestFullscreen` sobre el contenedor funciona, o el sistema secuestra la
   pantalla y mata el segundo stream? → **la pregunta decisiva para iPhone**
3. ¿Hay `MediaSource` / `ManagedMediaSource`? → sin alguna, hls.js no funciona
4. ¿Se sostiene la sincronización de S1 fuera de Chrome sobre escritorio?
5. ¿Deja sonar dos vídeos a la vez? ¿Cuál es su política de autoplay?

**Estado:** ✅ **completo.** Medido en Blink (Ubuntu, Mac M2 Pro), Safari de
escritorio y dos iPhone (Safari 26 y Chrome iOS).

---

## Cómo se usa

```bash
./gen-media.sh      # requiere ffmpeg
pnpm install
node build.mjs      # -> dist/nanoplayer-probe.html  (autocontenido, ~558 KB)
node verify.mjs     # comprueba la sonda contra Chrome local antes de repartirla
```

`dist/nanoplayer-probe.html` es **un único fichero sin recursos externos**. Se
cuelga en cualquier hosting estático, o se abre en local. Los vídeos van
incrustados en base64 y se convierten a `blob:` en tiempo de ejecución, porque
Safari en iOS maneja mal las URIs `data:` en elementos multimedia.

### Qué se pide a quien prueba

1. Abrir el enlace en el dispositivo.
2. Pulsar **Iniciar pruebas** y esperar (menos de un minuto).
3. Pulsar **Probar pantalla completa**. Es la más importante: mirar si se ven
   **los dos** vídeos o solo uno.
4. Pulsar **Copiar informe** y devolverlo.

Todo son datos técnicos del navegador. No recoge nada personal ni sale de la
página: no hay ninguna petición de red.

---

## Resultados

| | Chrome · Ubuntu | Chrome · Mac M2 Pro | Safari 16.4 · Mac | **iPhone** (Safari 26 y Chrome iOS) |
|---|---|---|---|---|
| Motor | Blink | Blink | WebKit | WebKit |
| Vídeos simultáneos | 18 | 18 | 17 | **17** |
| Fullscreen del contenedor | sí | sí | sí | **NO** |
| Dos audios a la vez | sí | sí | sí | **no** |
| Deriva mediana / p95 / máx | 7.8 / 15.1 / 39 ms | 8.3 / 19.6 / 41 ms | 30.6 / 53.9 / 118 ms | **28.1 / 209 / 405 ms** |
| Saltos duros | 0 | 0 | 0 | **1** |
| `audioTracks` | **no** | **no** | sí | sí |
| MediaSource | sí | sí | sí | no |
| ManagedMediaSource | no | no | no (Safari 16) | **sí** |
| AV1 | probably | probably | no | no |

### Los cuatro hallazgos que cambian el diseño

**1. En iPhone no existe el fullscreen del contenedor.** `requestFullscreen`
sobre un `<div>` no está implementado: solo queda `webkitEnterFullscreen()`
sobre el vídeo suelto, que entrega la pantalla al reproductor del sistema y
hace desaparecer el segundo stream. **El dual-stream a pantalla completa es
imposible en iPhone.**

En Safari de escritorio sí funciona. **La limitación es de iOS, no de WebKit** —
justo lo que el Mac estaba en la matriz para distinguir.

**2. El límite de vídeos simultáneos es del motor, no del hardware.** 18 en
Blink, 17 en WebKit — y un iPhone de 4 núcleos da los mismos 17 que un Mac.

> **Corrección.** Una versión anterior de este documento afirmaba que el iPhone
> aguantaba solo 2. Era un defecto de la sonda: las pruebas previas no liberaban
> los decodificadores y la rampa arrancaba sin recursos. Corregido con
> `release()`, y confirmado con dos navegadores del mismo iPhone. Sirva de aviso:
> **un número sorprendente es más probable que sea un fallo del instrumento que
> un hallazgo.**

Matiz: la métrica es "cuántos elementos siguen avanzando su `currentTime`". No
prueba que se rendericen con fluidez, y los vídeos de prueba son de 320x180. El
presupuesto del `PlayerRegistry` debe seguir midiéndose en ejecución, pero
partiendo de que el orden de magnitud es holgado y no de 2.

**3. El ajuste de S1 es de Chrome, no universal** — y falla de forma distinta
en cada sitio.

En Safari de escritorio la degradación es uniforme: 30.6 ms de mediana frente a
7.8. Eso es calibración.

En iPhone la firma es otra y más interesante: **mediana de 28.1 ms (buena, por
debajo del frame) con un p95 de 209 ms y un máximo de 405**. No es un desajuste
de ganancia — si las constantes estuvieran mal, la mediana también lo estaría.
Son **excursiones puntuales severas** sobre un comportamiento base correcto.

Dos causas plausibles, sin distinguir todavía:
- Buffering momentáneo por contención de decodificación en el dispositivo.
- WebKit en móvil no aplica los cambios de `playbackRate` con la finura que el
  controlador da por supuesta.

Consecuencia para la Fase 3: el arreglo **no es subir la ganancia** sino bajar
el umbral de salto duro en el perfil de WebKit, para que una excursión de 200 ms
se corrija en vez de quedarse. Distinguir entre ambas causas requiere
instrumentar los eventos de stall durante la reproducción, y se hace mejor con
el reproductor real que con la sonda.

**4. `audioTracks` está invertido respecto a lo esperado:** existe en WebKit y
no en Blink. El `AudioTrackProvider` necesita las dos vías desde el principio
—nativa en Safari, hls.js en Chrome—, y es la excepción legítima a la regla de
"una sola implementación hasta que haya consumidor real": aquí ya hay dos.

Y una buena noticia: iOS 26.5 trae `ManagedMediaSource`, así que hls.js es
viable en iPhone pese a no haber `MediaSource` clásico.

### Lo que queda fuera del alcance de este spike

- **Distinguir la causa de las excursiones en iPhone** (stalls vs. `playbackRate`
  no honrado). Necesita instrumentar eventos de stall durante la reproducción;
  se hace mejor con el reproductor real en la Fase 3.
- **HLS.** La sonda usa MP4 progresivo para mantenerse autocontenida. Con MSE y
  hls.js el buffering es otro mundo y hay que repetir la medición.
- **Red real.** Todo son blobs en memoria: sin latencia ni ancho de banda
  limitado.
- **Consumo de batería y CPU** sostenido.

---

## Cómo se leerán los resultados

| Hallazgo | Consecuencia para el producto |
|---|---|
| `maxConcurrentVideos` < 4 | Sospechar primero de la sonda: medido 17-18 en todos los motores. Si se confirma, el degradado es obligatorio |
| `containerFullscreen: false` | En ese dispositivo no hay dual-stream a pantalla completa. Hay que decidir: conmutar a un stream, o desactivar el botón |
| `mediaSource` y `managedMediaSource` ambos `false` | hls.js no funciona: solo HLS nativo, sin control de calidad propio |
| `hlsMime` es `"maybe"` | **No es prueba de nada.** Chrome lo devuelve sin soportar HLS nativo. Solo `"probably"` junto a la ausencia de MSE indica HLS nativo real |
| `audioTracks: false` | El multi-audio no puede ir por la API nativa en ese navegador |
| `coldAutoplay.muted: false` | Ni siquiera silenciado se puede autoarrancar: el póster y el botón de play son obligatorios, no una optimización |
| `dualAudio: false` | Confirma que el audio debe venir de un solo stream, como ya asume el diseño maestro/esclavo |
| `driftP95Ms` > 33 | La sincronización de S1 no se sostiene ahí; hay que revisar umbrales por plataforma |
| `loopFps` muy bajo | El lazo de control está limitado por CPU; hay que espaciarlo |

---

## Dispositivos que interesan

Prioridad por lo que más puede cambiar el diseño:

1. **iPhone reciente** — la pregunta del fullscreen del contenedor
2. **iPhone o iPad antiguo** — el suelo de decodificación simultánea
3. **iPad** — se espera que sí soporte fullscreen del contenedor; hay que
   confirmar que iPad y iPhone divergen
4. **Safari en Mac** — separa "es Safari" de "es iOS"
5. **Android de gama baja** — el otro suelo de decodificación

Un iPad mini antiguo **no es un mal dispositivo de prueba, es uno de los
buenos**: los límites de hardware solo aparecen en equipos modestos. Lo que hay
que decidir es si queda por debajo del suelo de soporte declarado — pero eso se
decide *con* el dato, no antes de tenerlo.

---

## Limitaciones de la sonda

- **No prueba HLS.** Necesitaría un stream externo, lo que rompería la
  autocontención. La sincronización sobre HLS/MSE hay que medirla aparte, con
  hosting propio.
- **No prueba red real.** Todo es local; no hay latencia ni ancho de banda
  limitado.
- El tope de la prueba de decodificación son 24 vídeos. Si un dispositivo llega
  ahí, el informe lo marca con `decodeCappedAtLimit`, y el número real es mayor.
- El consumo de batería y CPU sostenido no se mide.

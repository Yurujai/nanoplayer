# Spike S2 — Matriz de dispositivos

**Preguntas que responde**, y que no se pueden contestar desde un solo equipo:

1. ¿Cuántos vídeos simultáneos aguanta el dispositivo? → fija el presupuesto del
   `PlayerRegistry` (también resuelve **S4**)
2. ¿`requestFullscreen` sobre el contenedor funciona, o el sistema secuestra la
   pantalla y mata el segundo stream? → **la pregunta decisiva para iPhone**
3. ¿Hay `MediaSource` / `ManagedMediaSource`? → sin alguna, hls.js no funciona
4. ¿Se sostiene la sincronización de S1 fuera de Chrome sobre escritorio?
5. ¿Deja sonar dos vídeos a la vez? ¿Cuál es su política de autoplay?

**Estado:** sonda construida y verificada. **Faltan los datos de dispositivos.**

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

## Referencia: escritorio

Para poder interpretar los resultados de los móviles hace falta un techo
conocido.

Todo lo medido hasta ahora es **motor Blink**. Sigue faltando WebKit.

| | Chrome headless (CI) | Chrome 150 · Ubuntu, 16 núcleos | Chrome 150 · Mac M2 Pro, 10 núcleos |
|---|---|---|---|
| Vídeos simultáneos | **18** | **18** | **18** |
| Dos audios a la vez | sí | sí | sí |
| Deriva mediana / p95 | 7.8 / 14.6 ms | 7.8 / 15.1 ms | 8.3 / 19.6 ms |
| Saltos duros | 0 | 0 | 0 |
| FPS del lazo de control | 26 | 27 | 24 |
| Fullscreen del contenedor | sí, ambos vídeos vivos | sí | sí |
| MediaSource | sí | sí | sí |

Tres entornos dando lo mismo, y coincidiendo con lo medido en S1 con vídeos
grandes y servidor propio. La sonda mide de forma consistente.

### Hipótesis: los 18 vídeos son un tope de Chrome, no del hardware

Tres máquinas muy distintas —16 núcleos x86, 10 núcleos Apple Silicon y un
runner de CI— se paran **exactamente en 18**. Si fuera un límite de
decodificación por hardware, cabría esperar dispersión.

Si se confirma, es buena noticia para el `PlayerRegistry`: el presupuesto sería
una constante por navegador y no algo que haya que descubrir en cada
dispositivo. **Queda por comprobar en WebKit y en Gecko**, donde es muy probable
que el número sea distinto — y en móvil, donde sí debería mandar el hardware.

### Hallazgo: `audioTracks` no existe en Chrome

Chrome no implementa `HTMLMediaElement.audioTracks`. **Esto invalida la
implementación de multi-audio que se daba por supuesta** — delegar las pistas
embebidas en el navegador — para todo Chrome, que es la mayor parte del parque.

Consecuencia para el diseño: el `AudioTrackProvider` de pistas embebidas tiene
que apoyarse en la API de hls.js, no en la nativa. Y como hls.js exige MSE, en
Safari/iOS sin `ManagedMediaSource` habrá que comprobar si queda alguna vía.

---

## Cómo se leerán los resultados

| Hallazgo | Consecuencia para el producto |
|---|---|
| `maxConcurrentVideos` < 4 | El degradado móvil (S3) es obligatorio, no opcional |
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

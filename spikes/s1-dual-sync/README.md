# Spike S1 — Sincronización dual-stream

**Pregunta:** ¿se pueden mantener dos flujos de vídeo sincronizados dentro de un
frame usando solo `<video>` nativo, sin biblioteca externa?

**Respuesta: sí.** Deriva mediana de ~10 ms y p95 de ~14 ms en régimen estable
(un frame a 30 fps son 33 ms), con recuperación en todos los escenarios probados.

> Código desechable. Lo que se lleva a producción son las conclusiones de §4, no
> estos ficheros.

---

## 1. Cómo ejecutarlo

```bash
./gen-media.sh          # genera los vídeos de prueba (requiere ffmpeg)
pnpm install
node serve.mjs 8099     # servidor estático CON soporte de Range
```

- **Manual:** abrir `http://127.0.0.1:8099/` — gráfico de deriva en vivo y
  botones para provocar cada perturbación.
- **Automático:** `node measure.mjs` (o `HEADED=1 node measure.mjs`).

Barrido de parámetros sin tocar código:

```bash
URL="http://127.0.0.1:8099/index.html?gain=1.2&maxRateDelta=0.25" node measure.mjs
```

### Medios de prueba

Dos vídeos de 90 s con **timecode incrustado**, para que la deriva sea visible a
simple vista además de medible. Framerates **distintos a propósito** (30 y
25 fps): en dual-stream real las fuentes rara vez coinciden. GOP de 2 s, que es
lo realista en producción y limita la precisión del seek.

---

## 2. Resultados

Chrome 1xx, headless, Linux. `requestVideoFrameCallback` disponible.

| Escenario | Deriva mediana | p95 | Recuperación | Saltos duros |
|---|---|---|---|---|
| Estable 1× (25 s) | 9.8 ms | 14.3 ms | — | 0 |
| Estable 2× (15 s) | 12.9 ms | 22.4 ms | — | 0 |
| Desvío +250 ms | — | pico 260 ms | 1905 ms | 0 |
| Desvío +2 s | — | pico 2003 ms | 67 ms | 1 |
| Seek del maestro | — | pico 81 ms | 900 ms | 0 |
| Stall del esclavo 1.5 s | — | pico 7 ms | 3 ms | 0 |

Todo por debajo de un frame en régimen estable, incluso a 2×.

---

## 3. Diseño que funcionó

**Maestro/esclavo.** El maestro es el stream con audio y **no se le toca nunca
el `playbackRate`**: alterar la velocidad del audio se oye. Toda la corrección
recae en el esclavo, que es mudo.

**Dos regímenes:**
- Deriva pequeña → control proporcional sobre el `playbackRate` del esclavo.
  Invisible para el usuario.
- Deriva > 500 ms → salto duro (asignar `currentTime`). Se nota, pero recupera
  en ~67 ms.

**Histéresis obligatoria.** Engancha a 33 ms, suelta a 8 ms.

**Política ante stall:** pausar ambos. Si el esclavo se queda sin buffer y se
deja correr al maestro, la deriva crece por encima del umbral de salto duro y el
usuario ve un salto en lugar de una pausa breve. Pausando ambos, el pico de
deriva medido fue de 7 ms.

---

## 4. Conclusiones para la implementación real

1. **Es viable con `<video>` nativo.** No hace falta biblioteca de sincronización.

2. **La histéresis no es opcional.** Sin ella, el controlador tiene error de
   estado estacionario: se para al entrar en la zona muerta y deja un offset
   permanente. Medido en la primera pasada: **28.8 ms fijos de mediana**. Con
   histéresis (engancha 33 ms / suelta 8 ms): **9.8 ms**.

3. **La ganancia gobierna la recuperación, no el techo de velocidad.** Subir
   `maxRateDelta` de 0.12 a 0.25 no cambió nada (3.4 s → 3.7 s, ruido). Subir la
   ganancia de 0.6 a 1.2 la redujo a la mitad (**1.7 s**) a cambio de 3 ms más de
   deriva estable. El techo puede ser generoso: el esclavo no lleva audio, que es
   el único motivo real para limitarlo.

4. **Valores de partida:** `deadZone 33 ms`, `releaseZone 8 ms`, `gain 1.2`,
   `maxRateDelta 0.25`, `hardSeek 500 ms`.

5. **Usar `requestVideoFrameCallback`** para el lazo de control cuando exista: se
   dispara con la presentación real del frame, no con el repintado. Con fallback
   a `requestAnimationFrame`.

6. **Pausar ambos ante stall de cualquiera de los dos.** Coherencia visual por
   encima de continuidad de audio.

---

## 5. Trampa encontrada en el banco de pruebas

`python -m http.server` **ignora la cabecera Range**. Cada seek obliga al
navegador a redescargar el vídeo entero desde el principio. Con eso, la primera
medición dio 300+ saltos duros y derivas de 36 segundos — todo artefacto del
servidor, cero relación con el algoritmo.

Por eso este spike incluye `serve.mjs`, con Range real.

**Lección que trasciende el spike:** cualquier medida de sincronización es
inseparable de las condiciones de red. Antes de culpar al algoritmo, verificar
que el transporte responde `206 Partial Content`. Lo mismo aplicará al depurar
en producción.

---

## 6. Lo que este spike NO responde

- **Safari / iOS.** Es el objeto del spike **S2**. Lo medido aquí es Chrome sobre
  Linux; nada garantiza el mismo comportamiento donde `requestVideoFrameCallback`
  puede no existir y el fullscreen funciona distinto.
- **HLS.** Aquí son MP4 progresivos. Con MSE y hls.js, el buffering es otro
  mundo: hay que repetir la medición.
- **Red real.** Todo en localhost. Falta medir con latencia y ancho de banda
  limitados.
- **Consumo de CPU/batería** del lazo de control en dispositivos modestos.

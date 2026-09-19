# Spike S6 — Encadenado de cabecera y cola

**Pregunta:** ¿se puede pasar de la cabecera al contenido —y de éste a la
cola— sin que se vea el salto, y sobrevive el segundo `play()` a la política de
autoplay?

**Respuesta: sí, pero solo con anticipación.** Arrancar la pieza siguiente al
terminar la anterior deja un hueco de **340–445 ms** — diez fotogramas, se ve
perfectamente. Arrancarla unos cientos de milisegundos antes lo deja en **0 ms**
en los dos motores de escritorio.

**Falta la mitad que decide:** en escritorio la política de autoplay no llega a
estorbar, porque Chromium y WebKit conceden la activación **por página**. En
iOS es **por elemento**, y esa medición hay que hacerla a mano en un iPhone.
Hasta entonces, la variante B no está descartada ni confirmada.

> Código desechable. Lo que sobrevive son las conclusiones de §5.

---

## 1. Por qué hay que medirlo antes de escribir el reproductor

Son dos preguntas, y la respuesta a una estorba a la otra:

**Para que no se vea el salto** hace falta que la pieza siguiente ya esté
decodificando cuando la actual termina. Eso obliga a tener **dos elementos
`<video>` distintos**: uno visible y otro esperando detrás.

**Pero un elemento `<video>` que nunca ha reproducido está bloqueado.** Cuando
la cabecera acabe y haya que llamar a `play()` sobre el segundo, esa llamada no
viene de un gesto del usuario: viene de un `ended`. En iOS el permiso de
reproducción es **de cada elemento**, no de la página, así que ese segundo
elemento puede rechazar el `play()` con `NotAllowedError` y dejar la cabecera
terminada y el contenido parado.

La salida conocida es **desbloquear el segundo elemento dentro del mismo gesto
que arrancó la cabecera**: un `play()` seguido de `pause()` inmediato, en el
propio manejador del clic. Funciona en la teoría y es lo que hacen los
reproductores con publicidad. Este spike existe para comprobar si funciona de
verdad, y a qué precio.

La alternativa —**un solo elemento al que se le cambia el `src`**— no tiene
problema de permisos, porque el elemento quedó desbloqueado por el gesto
inicial. A cambio obliga a `load()` y a rellenar búfer, y eso se ve. Cuánto se
ve es precisamente lo que hay que cuantificar antes de descartarla.

---

## 2. Las tres variantes

| | Elementos | Desbloqueo en el gesto | Anticipación |
|---|---|---|---|
| **A** | Uno por pieza | Sí | Configurable |
| **B** | Uno por pieza | **No** | Configurable |
| **C** | Uno solo, cambiando `src` | No hace falta | **Imposible** |

**A es la propuesta.** B es su control: la misma mecánica sin el desbloqueo,
para poder decir si el desbloqueo aporta algo o es superstición. C es la
alternativa simple, para saber qué se pierde eligiéndola.

Que C no admita anticipación no es una limitación del banco: **no se puede
cargar la pieza siguiente sin destruir la que está sonando**, porque solo hay
un elemento. Esa imposibilidad ya es un resultado.

### La anticipación

Arrancar la pieza entrante unos milisegundos **antes** de que termine la
saliente, para que tenga fotograma listo en el instante del cambio. Durante ese
solape la entrante va **silenciada** —si no, se oirían las dos— y se le quita
el silencio al descubrirla.

Eso introduce una tercera pregunta que el banco también mide: quitarle el
silencio a un vídeo en marcha es otra operación sin gesto detrás, y algunos
navegadores responden **pausándolo**. La columna `pausada` del informe es eso.

---

## 3. Cómo se ejecuta

```bash
./gen-media.sh                 # requiere ffmpeg
pnpm install
node serve.mjs 8180            # imprime también la IP de la red local
```

> **ffmpeg sin `drawtext`.** El de Homebrew en macOS se compila sin libfreetype
> y no trae ese filtro. El script lo detecta y genera los vídeos **sin texto**,
> avisando: el instrumento de verdad es el color plano, y el cuadro blanco que
> cruza la pantalla basta para ver si el vídeo avanza o está congelado. Para
> tener el texto hay que instalar `homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype`.

Banco manual en `http://127.0.0.1:8180/`, y desde el móvil en la dirección LAN
que imprime el servidor.

```bash
node measure.mjs               # Chrome del sistema, o el Chromium de Playwright
ENGINE=webkit node measure.mjs # el motor de Safari
HEADED=1 node measure.mjs      # con ventana
DUR_MAIN=12 ./gen-media.sh     # principal corto, para no esperar en cada pasada
```

El arnés prefiere Google Chrome si está instalado y si no cae al Chromium de
Playwright. S1 y S5 exigen el del sistema porque el empaquetado no traía
códecs H.264; **eso ya no es cierto** en las versiones actuales, y se comprueba
antes de medir: si el navegador no decodifica las piezas, aborta en vez de
devolver ceros que parecerían un resultado.

### Qué se le pide a quien prueba en el móvil

1. Abrirlo **en Safari** si es un iPhone. Chrome y Firefox en iOS son WebKit por
   dentro, pero su capa cambia el comportamiento de autoplay.
2. Desactivar el **modo de bajo consumo**: altera la reproducción y contamina la
   medida.
3. Probar las tres variantes, dejando terminar las dos costuras en cada una.
4. Probar también el botón de **saltar cabecera**.
5. Pulsar **Copiar informe** y devolverlo.

Mirar la pantalla importa tanto como el número: **si entre dos piezas aparece
negro, hubo hueco**. Las tres piezas son de color plano y saturado, y el fondo
del escenario es lo único negro de la página.

---

## 4. Qué se mide

**El hueco**, en milisegundos, entre el último fotograma **presentado** de la
pieza saliente y el primero de la entrante. La fuente es
`requestVideoFrameCallback`, que es la única API que dice cuándo un fotograma
llegó a la pantalla: con `timeupdate`, que llega a unos 4 Hz, un hueco de 200 ms
es indistinguible de uno de 20.

Donde no existe esa API se estima con `requestAnimationFrame` y **el informe lo
advierte**. Esos números no son comparables con los de un navegador que sí la
tiene.

Además, por cada costura:

| Campo | |
|---|---|
| `bloqueado` | El `play()` fue rechazado con `NotAllowedError` |
| `conSonido` | Si la petición iba con sonido. **Si es `false`, esa fila no prueba nada sobre la política**: un `play()` silenciado se concede siempre |
| `pausadaTrasSonido` | Al quitarle el silencio, el navegador la pausó |
| `readyStateEntrante` | Cuánto tenía cargado la entrante al pedirle el play. Menos de 2 significa que el hueco es de búfer, no de política |

Ese `conSonido` está publicado a propósito: la trampa más fácil al montar esto
es silenciar la pieza entrante para que arranque siempre, y acabar concluyendo
que no hay problema de autoplay cuando lo que pasa es que no se ha probado.

**Nada se descarga hasta que se pulsa reproducir.** Los elementos se crean
dentro del propio manejador del clic, que es lo que obliga el principio 2 del
reproductor y además es la parte difícil: hay que desbloquear un elemento que en
ese instante todavía no tiene un byte.

### Al leer la salida de `measure.mjs`

**Chrome de escritorio concede la activación por página, no por elemento.** Un
clic en cualquier sitio desbloquea todos los `<video>` de la página, así que es
de esperar que la variante B pase. **Eso no dice nada sobre iOS**, donde el
permiso es de cada elemento. El arnés no pasa
`--autoplay-policy=no-user-gesture-required` —al contrario que los de S1 y S5—
precisamente para no falsear esto más de lo que ya lo hace la plataforma.

---

## 5. Resultados

Medido el 2026-09-19, macOS arm64, Chromium 141 y WebKit 26.5 de Playwright,
piezas de 8 / 12 / 6 s servidas desde localhost. Huecos en milisegundos.

### Sin anticipación, el hueco es visible siempre

| Variante | Motor | intro→main | main→outro |
|---|---|---:|---:|
| A (dos elementos, desbloqueados) | Chromium | 340 | 91 |
| A | WebKit | 444 | 444 |
| B (sin desbloquear) | Chromium | 375 | 90 |
| B | WebKit | 445 | 445 |
| C (un elemento, cambiando `src`) | Chromium | 187 | 180 |
| C | WebKit | 236 | 235 |

Un fotograma a 30 fps son 33 ms. Todo eso se ve.

Y hay una sorpresa: **C sale mejor que A**. Recargar el elemento entero es más
rápido que despertar a uno que llevaba ocho segundos pausado con `opacity: 0`.
La causa está en la columna de latencia: el `play()` de un elemento parado tarda
unos **250 ms en Chromium y 375–430 ms en WebKit** en dar el primer fotograma,
mientras que el `load()` + `play()` de C tarda 65–180 ms. Tener el elemento
listo no significa que arranque instantáneamente.

### Con anticipación, el hueco desaparece

| Anticipación | Motor | intro→main | main→outro |
|---|---|---:|---:|
| 300 ms | Chromium | 21 | 0 |
| 300 ms | WebKit | **0** | **0** |
| 600 ms | Chromium | **0** | **0** |
| 600 ms | WebKit | **0** | **0** |

**La anticipación tiene que superar la latencia del `play()`**, y esa latencia
depende del motor. Con 300 ms Chromium todavía deja 21 ms porque su `play()`
tarda ~250 y el lazo de vigilancia muestrea cada 50. Con 600 ms va sobrado en
los dos.

### El salto es gratis

Saltar la cabecera a mitad da **0–28 ms**, y por una razón que conviene
entender: al saltar, la pieza saliente **sigue reproduciéndose** hasta que la
entrante tiene fotograma. No hay hueco porque no se deja de enseñar nada. Es el
mismo mecanismo que la anticipación, disparado a mano.

### Lo que NO se ha podido medir

`bloq` salió **no** en todas las filas, incluida la variante B. **Eso no
significa que el desbloqueo sobre.** En escritorio, tanto Chromium como WebKit
conceden la activación por página: el clic en «Reproducir» desbloquea todos los
`<video>` del documento, así que B no llega a ponerse a prueba. En iOS el
permiso es de cada elemento y es donde B debería fallar.

`pausadaTrasSonido` salió **no** en todas: quitarle el silencio a la pieza
entrante a mitad de reproducción no la pausó en ninguno de los dos motores.
Buena señal para la anticipación, pendiente de confirmar en iOS.

---

## 6. Conclusiones para la implementación

1. **La anticipación no es una optimización, es el mecanismo.** Sin ella no hay
   forma de encadenar sin hueco visible, en ningún motor y con ninguna de las
   tres variantes. El reproductor tiene que arrancar la pieza siguiente antes
   de que termine la actual.

2. **Margen de 600 ms, y medido, no supuesto.** Tiene que superar la latencia
   del `play()`, que va de 250 ms (Chromium) a 430 ms (WebKit) para un elemento
   parado. 300 ms es suficiente en WebKit y se queda corto en Chromium.

3. **Durante el solape, la entrante va silenciada y se le quita el silencio al
   descubrirla.** Ninguno de los dos motores la pausó al hacerlo.

4. **Tener el elemento enganchado no basta.** `readyState` 4 y un `play()` que
   tarda un cuarto de segundo conviven sin problema. Cualquier diseño que
   asuma que «ya está cargado, luego arranca ya» está mal.

5. **El botón de saltar sale gratis** y reutiliza exactamente el mismo camino:
   arrancar la entrante, esperar su primer fotograma, conmutar. No hace falta
   nada aparte.

6. **Pendiente de iOS:** si el desbloqueo en el gesto es necesario (variante A)
   o si basta sin él (variante B). El coste de A es bajo y el riesgo de
   equivocarse es alto, así que mientras no haya dato, **implementar A**.

## 7. Lo que este spike NO responde

- **HLS.** Todo es MP4 progresivo. Con HLS el arranque pasa por parsear la
  lista y traer el primer segmento, así que los huecos serán otros — y el motor
  de hls.js tiene su propio ciclo de enganche.
- **Dual-stream.** La cabecera es mono-stream, que es lo realista, pero el
  contenido principal puede ser dual, y ahí el cambio tiene que coordinarse con
  el sincronizador.
- **Directo.** Una cabecera delante de un directo cambia el problema: mientras
  la cabecera suena, el borde de la emisión se aleja.
- **Pantalla completa.** No se ha probado el encadenado con el reproductor en
  pantalla completa, donde el cambio de elemento visible podría comportarse
  distinto. En iPhone además no existe el fullscreen de contenedor (S2).
- **Android.** Ni Chrome ni Samsung Internet. La política de autoplay de
  Android tiene sus propias reglas.

# NanoPlayer

Reproductor web multi-stream, accesible y extensible.

> **Estado: en desarrollo.** El reproductor ya funciona —mono-stream,
> dual-stream sincronizado, HLS, directo, subtítulos y barra de controles
> accesible— pero **no hay nada publicado**: ni en npm, ni en un CDN, ni una
> versión etiquetada. Hoy la única forma de usarlo es clonar el repositorio y
> compilarlo. La API puede cambiar sin aviso.

---

## Por qué

Cuatro requisitos, sacados de operar vídeo docente en producción, que
condicionan toda la arquitectura:

**Accesibilidad verificable.** WCAG 2.1 AA y EN 301 549 como requisito de
arquitectura, comprobados automáticamente en CI. La accesibilidad añadida al
final siempre sale cara y siempre sale peor.

**Cero red hasta que el usuario lo pide.** Una página puede contener decenas de
reproductores — el caso real que motivó esto tenía 32. Instanciar uno no
descarga nada: ni metadatos, ni manifiesto, ni un byte de vídeo. Y una política
de reproducción exclusiva evita que compitan entre ellos.

**Configuración, no forks.** Activar o desactivar cualquier plugin es
configuración en tiempo de ejecución. Nunca hace falta montar un build propio
para cambiar qué features están encendidas.

**Theming sin forks.** Variables CSS documentadas como API estable, para
rediseñar el aspecto sin tocar el código del reproductor.

La tesis, en una frase: **un reproductor que no te obliga a forkearlo.**

---

## Qué funciona ya

| | |
|---|---|
| **Reproducción** | Mono-stream, dual-stream sincronizado, solo audio con carátula, y audio con diapositivas |
| **Formatos** | MP4 por el motor nativo; HLS con [hls.js](packages/engine-hls/) en carga diferida, que solo se descarga si hace falta |
| **Directo** | Ventana DVR, salto al borde, espera por flujo con reintentos, y distinción entre «aún no ha empezado» y «se ha interrumpido» |
| **Sincronización** | Control proporcional con histéresis y perfiles por motor. En directo mide por hora absoluta (`EXT-X-PROGRAM-DATE-TIME`), no por `currentTime` |
| **Interfaz** | Barra de controles accesible, navegable entera con teclado, y menú de ajustes por paneles apilados con la ergonomía del de YouTube |
| **Layouts** | Lado a lado, imagen en imagen, solo ponente y solo presentación |
| **Multi-instancia** | Registro compartido con reproducción exclusiva y resolución de manifiestos en lote — 32 reproductores, una petición |
| **Plugins** | Registro con orden topológico y anclajes de interfaz. Los plugins declaran su condición y se activan solos según el manifiesto |
| **Theming** | Variables CSS documentadas, sin Shadow DOM |

El núcleo **no tiene dependencias en tiempo de ejecución**, y hls.js solo se
descarga la primera vez que hay que reproducir HLS: quien reproduzca MP4 no lo
paga.

### Paquetes

| Paquete | |
|---|---|
| [`@nanoplayer/core`](packages/core/) | Manifiesto, ciclo de vida, motores, sincronización y plugins. Sin interfaz |
| [`@nanoplayer/ui`](packages/ui/) | Barra de controles accesible, menú de ajustes y layouts |
| [`@nanoplayer/engine-hls`](packages/engine-hls/) | Motor HLS sobre hls.js |
| [`@nanoplayer/plugin-captions`](packages/plugin-captions/) | Subtítulos |

## Qué falta

Por orden de lo que bloquea a más gente:

- **Publicación.** Nada está en npm y no hay workflow de release. Los cuatro
  paquetes siguen en `0.0.0`.
- **El bundle de una etiqueta.** El núcleo ya construye un IIFE con la global
  `NanoPlayer`, pero `@nanoplayer/ui` solo construye ESM: falta el paquete que
  los junte para que una etiqueta `<script>` dé un reproductor **con
  controles**.
- **Recorte (`trim`).** El manifiesto lo valida y lo expone, pero todavía nada
  lo aplica durante la reproducción.
- **Plugins previstos:** multi-audio, Chromecast, listas de reproducción y H5P.
  Las anotaciones del manifiesto ya son el mecanismo por el que entrarán.
- **Demo.** El directo y el caso multi-instancia funcionan pero no tienen
  escenario donde verlos, y el spike S5 no se publica en Pages.

El alcance detallado y el calendario se publicarán cuando el MVP esté más
avanzado.

---

## Spikes

Antes de escribir arquitectura, validar lo que puede hundir el proyecto. Código
desechable: lo que sobrevive son las conclusiones.

### [S1 · Sincronización dual-stream](spikes/s1-dual-sync/) ✅

**¿Se pueden mantener dos vídeos sincronizados con solo `<video>` nativo?** Sí.
Deriva mediana de 9,8 ms y p95 de 14,3 ms en Chrome — un frame a 30 fps son
33 ms — con recuperación en todos los escenarios probados.

Hallazgo principal: la **histéresis es obligatoria**. Sin separar el umbral de
enganche del de suelta, el controlador deja un offset permanente de 28,8 ms.

### [S2 · Matriz de dispositivos](spikes/s2-device-matrix/) ✅

**¿Qué aguanta cada dispositivo?** Medido en Blink, Safari de escritorio y dos
iPhone. Un único fichero HTML autocontenido que cualquiera abre en su móvil y
devuelve un informe.

| Motor | Vídeos a la vez | Deriva p95 | Fullscreen del contenedor |
|---|---|---|---|
| Blink (Chrome) | 18 | 15 ms | sí |
| WebKit (Safari, Mac) | 17 | 54 ms | sí |
| WebKit (iPhone) | 17 | 209 ms | **no** |

La respuesta a la pregunta decisiva fue que no: **en iPhone no existe el
fullscreen de contenedor**, así que el dual-stream a pantalla completa es
imposible, y es limitación de iOS y no de WebKit. De ahí que el botón se oculte
donde la política lo prohíbe en lugar de quedarse sin hacer nada.

### [S5 · Directo dual-stream](spikes/s5-live-dual/) ✅

**¿Se pueden sincronizar dos directos HLS independientes?** Sí, **pero solo con
`EXT-X-PROGRAM-DATE-TIME`** en ambas listas. Sin esa etiqueta no es que la
corrección salga peor: es que **no hay forma de medir** si están sincronizados,
porque en directo `currentTime` tiene su origen en el momento en que cada flujo
empezó a cargar.

Por eso el sincronizador tiene un modo directo que compara por hora absoluta, y
por eso sin la etiqueta el reproductor **no corrige**, en lugar de fingir. En
Wowza la propiedad es `cupertinoEnableProgramDateTime`, desactivada por defecto.

---

## Desarrollo

Requisitos: Node 20+, pnpm, ffmpeg.

```bash
pnpm install
pnpm test          # 241 tests unitarios
pnpm typecheck
```

La auditoría de accesibilidad se pasa sobre el build de la demo, no sobre el
servidor de desarrollo — es más fiel auditar lo que realmente se despliega:

```bash
pnpm --filter @nanoplayer/demo build
cd e2e && node a11y.mjs --serve ../demo/dist
```

### La demo

```bash
cd demo
./gen-media.sh     # genera los vídeos de prueba con ffmpeg
pnpm --filter @nanoplayer/demo dev      # http://localhost:5180
```

Dos páginas: el **reproductor** tal cual lo vería quien lo integre, y el
**banco de pruebas** del núcleo, con el ciclo de vida en crudo. Ver
[`demo/README.md`](demo/README.md).

### Los spikes

```bash
# S1 — banco de sincronización
cd spikes/s1-dual-sync
./gen-media.sh && pnpm install
node serve.mjs 8099     # http://127.0.0.1:8099 para verlo
node measure.mjs        # medición automática

# S2 — sonda de dispositivos
cd spikes/s2-device-matrix
./gen-media.sh && pnpm install
node build.mjs          # -> dist/nanoplayer-probe.html
node verify.mjs         # comprobar la sonda antes de repartirla

# S5 — directo dual-stream
cd spikes/s5-live-dual
./stream.sh             # dos emisiones en vivo arrancadas a la vez
node serve.mjs 8170     # sirve las listas SIN caché: imprescindible en directo
node measure.mjs 30
```

Los medios de prueba no se versionan: se regeneran con `gen-media.sh`.

### Publicación

Cada push a `main` publica en GitHub Pages el índice, la demo y los bancos de
S1 y S2. CI ejecuta tests, typecheck y la auditoría de accesibilidad, que
**bloquea el merge**: la accesibilidad que no se comprueba automáticamente se
pierde sin que nadie se entere, que es exactamente lo que este proyecto existe
para evitar.

---

## Licencia

[Apache-2.0](LICENSE). Permisiva y con concesión de patentes.

Es una elección deliberada: cualquiera puede usar NanoPlayer, modificarlo,
integrarlo en productos propietarios y comercializarlo, sin pedir permiso. En un
reproductor web la adopción es el valor, y la fricción legal es lo primero que
descarta una opción cuando alguien evalúa qué integrar.

Las contribuciones entran bajo la misma licencia por defecto, según la sección 5
de la propia Apache-2.0. No hace falta firmar ningún CLA.

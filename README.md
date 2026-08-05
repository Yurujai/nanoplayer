# NanoPlayer

Reproductor web multi-stream, accesible y extensible.

> **Estado: diseño y validación técnica.** Todavía no hay reproductor. Lo que
> hay son los spikes que responden a las preguntas capaces de hundir el
> proyecto antes de escribir una línea de arquitectura.

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

## Qué hará

- Mono-stream, dual-stream (dos flujos sincronizados) y directo por HLS
- Múltiples layouts para multi-stream
- Sistema de ajustes extensible, con la ergonomía del reproductor de YouTube
- Plugins: subtítulos, multi-audio, trimming, Chromecast, listas de
  reproducción, H5P
- Instalación con una etiqueta `<script>` y tres líneas, o por npm

El alcance detallado y el calendario se publicarán cuando el MVP esté más
avanzado.

---

## Spikes

Antes de escribir arquitectura, validar lo que puede hundir el proyecto.

### [S1 · Sincronización dual-stream](spikes/s1-dual-sync/) ✅

**¿Se pueden mantener dos vídeos sincronizados con solo `<video>` nativo?** Sí.
Deriva mediana de 9.8 ms y p95 de 14.3 ms en Chrome — un frame a 30 fps son
33 ms — con recuperación en todos los escenarios probados.

Hallazgo principal: la **histéresis es obligatoria**. Sin separar el umbral de
enganche del de suelta, el controlador deja un offset permanente de 28.8 ms.

### [S2 · Matriz de dispositivos](spikes/s2-device-matrix/) 🔧

**¿Qué aguanta cada dispositivo?** Sonda construida y verificada; faltan los
datos de hardware real. Es un único fichero HTML autocontenido que cualquiera
abre en su móvil y devuelve un informe.

La pregunta decisiva: en iPhone, ¿`requestFullscreen` sobre el contenedor
funciona, o el sistema secuestra la pantalla y mata el segundo stream?

---

## Desarrollo

Requisitos: Node 20+, pnpm, ffmpeg.

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
```

Los medios de prueba no se versionan: se regeneran con `gen-media.sh`.

---

## Licencia

[Apache-2.0](LICENSE). Permisiva y con concesión de patentes.

Es una elección deliberada: cualquiera puede usar NanoPlayer, modificarlo,
integrarlo en productos propietarios y comercializarlo, sin pedir permiso. En un
reproductor web la adopción es el valor, y la fricción legal es lo primero que
descarta una opción cuando alguien evalúa qué integrar.

Las contribuciones entran bajo la misma licencia por defecto, según la sección 5
de la propia Apache-2.0. No hace falta firmar ningún CLA.

# Demo — banco de pruebas del núcleo

Cablea a mano las piezas que ya existen para poder verlas en un navegador real
y no solo en tests unitarios.

**No es el reproductor.** No hay barra de controles ni layouts (Fase 2) ni
sincronizador (Fase 3).

```bash
./gen-media.sh     # requiere ffmpeg; genera los vídeos con timecode incrustado
pnpm install
pnpm --filter @nanoplayer/demo dev    # http://localhost:5180
```

## Qué demuestra

**El ciclo de vida perezoso, con los números a la vista.** El contador de
peticiones de red y el de elementos `<video>` cambian al avanzar de estado:

| Estado | Peticiones | Elementos `<video>` |
|---|---|---|
| `idle` | 0 | 0 |
| `resolved` | 1 | 0 |
| `attached` | 1 | 2 |

**Que soltar el motor conserva la posición.** Pulsa *Soltar motor* a mitad de
reproducción: los elementos `<video>` desaparecen del DOM, se liberan los
decodificadores y la posición queda guardada. Al volver a enganchar, continúa
donde estaba. Es lo que hace viable una página con muchos reproductores — S2
midió el techo del navegador en 17 elementos (WebKit) y 18 (Blink).

**Que el bus lo cuenta todo.** El registro de eventos es literalmente lo que ve
`bus.onAny()`, que es por donde se conectará la analítica sin tocar el núcleo.

**Que la validación no es decorativa.** El manifiesto con dos pistas de audio
falla con el motivo: *"reproducir dos pistas a la vez no funciona en iOS"*.

## El desfase entre streams

Con dos streams aparece un desfase de unos 70 ms, porque los motores se
enganchan y arrancan en secuencia. Con ficheros locales se queda quieto —no
crece— pero **nada lo corrige**, y un stall o un salto lo empeorarían de forma
permanente.

Eso es lo que resuelve el sincronizador de la Fase 3. El spike S1 midió que con
corrección la mediana queda en 9,8 ms.

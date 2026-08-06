# Spike S5 — Directo dual-stream

**Pregunta:** ¿puede el reproductor mantener sincronizados dos directos HLS
independientes?

**Respuesta: sí, pero solo con `EXT-X-PROGRAM-DATE-TIME`.** Sin esa etiqueta no
es que la corrección sea peor: es que **no hay forma de medir** si están
sincronizados, y actuar sobre la medida equivocada empeora las cosas.

> Código desechable. Lo que sobrevive son las conclusiones de §4.

---

## 1. Cómo se ejecuta

```bash
./stream.sh                 # dos emisiones en vivo, arrancadas a la vez
./stream-desfasado.sh       # el segundo flujo arranca 8 s más tarde
PDT=0 ./stream.sh           # sin la etiqueta de hora, para comparar
node serve.mjs 8170         # sirve las listas SIN caché (imprescindible en directo)
node measure.mjs 30         # medición automática
```

Banco manual en `http://127.0.0.1:8170/`.

Las dos emisiones salen del mismo proceso y llevan **el reloj de pared
incrustado**: dos fotogramas con la misma hora son el mismo instante, así que la
deriva se comprueba a ojo además de medirse. Framerates distintos (30 y 25) a
propósito, como en S1.

**El montaje alinea las fuentes por construcción.** Es deliberado: la pregunta
no es si el servidor de emisión alinea bien —eso es su trabajo— sino si el
navegador es capaz de no separarlas.

---

## 2. Resultados

### Régimen estable

| | Con PDT |
|---|---|
| Deriva real (mediana) | **20–31 ms** |
| Retraso sobre el directo | 6,1–6,7 s |
| Estabilidad en 30 s | sin variación apreciable |

Con fuentes alineadas, dos instancias de hls.js se mantienen dentro de un frame.

### Tras un corte de 3 s en un flujo

```
+ 1 s tras el corte   deriva real = -2 982 ms
+ 5 s                 deriva real = -2 981 ms
+12 s                 deriva real = -2 981 ms
```

**No recupera nunca.** El flujo cortado se queda tres segundos por detrás de
forma permanente.

### La medida sin PDT es inservible

Cargando los dos flujos **con 20 s de diferencia** —lo que ocurre cuando el
presupuesto de recursos desaloja uno y lo vuelve a enganchar:

```
deriva REAL        =     -28 ms     ← están sincronizados
por currentTime    = -20 053 ms     ← dice que van 20 s separados
```

---

## 3. Por qué `currentTime` no sirve

`currentTime` en un directo es la posición dentro de la ventana de la lista, y
su origen lo fija **el momento en que ese reproductor empezó a cargar**. Dos
instancias que arrancan juntas tienen orígenes parecidos y la medida parece
funcionar; en cuanto una carga más tarde, la medida miente por la diferencia
entera.

Y no es un caso rebuscado: pasa cada vez que un flujo se desaloja y se vuelve a
enganchar, que es justo lo que hace el presupuesto de recursos del
`PlayerRegistry`.

Un sincronizador que se fiara de esa medida daría un salto duro para "corregir"
20 segundos que no existen, **destrozando una reproducción correcta**.

---

## 4. Conclusiones para la implementación

1. **`EXT-X-PROGRAM-DATE-TIME` es requisito, no mejora.** Para dual-stream en
   vivo hay que exigirla en ambas listas. En Wowza es la propiedad
   `cupertinoEnableProgramDateTime`, que **viene desactivada por defecto**.

2. **El sincronizador necesita un modo directo** que compare `playingDate` en
   lugar de `currentTime`. El resto del modelo —maestro/esclavo, histéresis,
   control proporcional— sirve igual; lo que cambia es de dónde sale la medida.

3. **Sin la etiqueta, el único comportamiento honesto es no corregir.** Poner
   ambos en el borde del directo y avisar de que pueden separarse. Fingir una
   sincronización que no se puede medir es peor que no ofrecerla.

4. **Hay que corregir tras cada corte.** hls.js no recupera solo, y el desfase
   que deja un stall de 3 segundos es de 3 segundos, permanente. Aquí conviene
   un salto duro por hora absoluta en lugar de corrección suave: absorber 3
   segundos al 25 % de velocidad extra tardaría doce.

5. **Detectar si un flujo ha empezado** es aparte y más sencillo: la lista
   devuelve 404, o existe sin segmentos. Hay que distinguir "aún no ha
   empezado" de "se ha cortado", porque quien lleva veinte minutos viendo algo
   no debería leer que aún no ha empezado.

---

## 5. Lo que este spike NO responde

- **Wowza de verdad.** Aquí las fuentes salen del mismo proceso con el mismo
  reloj. Con dos codificadores reales, la marca de hora refleja *cuándo llegó*
  el flujo al empaquetador, no cuándo se capturó: latencias de subida distintas
  desplazan las marcas. Hay que medirlo con emisiones reales.
- **Safari y iOS.** Todo medido en Chrome. S2 ya demostró que la calibración de
  sincronización no es portable entre motores.
- **Red inestable.** Todo en localhost, sin pérdida de paquetes ni ancho de
  banda variable, que es donde los stalls se vuelven frecuentes.
- **Latencia baja.** No se ha probado LL-HLS, donde las ventanas y los tiempos
  de segmento cambian bastante.

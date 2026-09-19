/**
 * Formato de tiempos y cantidades.
 *
 * Dos formas para dos públicos: la compacta para la pantalla, y una hablada
 * para los lectores de pantalla. `12:05` se lee "doce, dos puntos, cero cinco",
 * que no significa nada. Es un detalle pequeño y de los que más se notan.
 *
 * **Toda la gramática la pone `Intl`.** La versión anterior la escribía a mano
 * y eso la dejaba en dos idiomas: era un `lang.startsWith('es')` con los
 * plurales puestos uno a uno, así que un usuario con `lang="fr"` recibía
 * `aria-valuetext` en inglés. Con `Intl` salen todos, y salen bien: en euskera
 * el porcentaje va delante —`% 35`— y ningún `${n} %` escrito a mano acierta
 * eso jamás.
 */

/** `1:05:03` o `4:07`. La hora solo aparece si hace falta. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dosDigitos = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dosDigitos(m)}:${dosDigitos(s)}` : `${m}:${dosDigitos(s)}`;
}

/**
 * `1 hora, 5 minutos y 3 segundos`, para `aria-valuetext`.
 *
 * `Intl.NumberFormat` con `style: 'unit'` pone la unidad y el plural, y
 * `Intl.ListFormat` la conjunción. En español la salida es idéntica a la que
 * daba el código escrito a mano; la diferencia es que ahora también hay
 * catalán, gallego, euskera y lo que haga falta.
 */
export function spokenTime(seconds: number, lang = 'es'): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const unidad = (valor: number, unit: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' })
      .format(valor);

  const partes: string[] = [];
  if (h > 0) partes.push(unidad(h, 'hour'));
  if (m > 0) partes.push(unidad(m, 'minute'));
  // Los segundos se dicen siempre si no hay nada más, para no leer "" en el 0.
  if (s > 0 || partes.length === 0) partes.push(unidad(s, 'second'));

  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' })
    .format(partes);
}

/**
 * `35 %`, para el volumen.
 *
 * El espacio antes del signo lo decide el idioma, no nosotros: en español y en
 * francés va, en inglés no, y en euskera el signo va delante del número.
 */
export function formatPercent(value: number, lang = 'es'): string {
  const acotado = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return new Intl.NumberFormat(lang, { style: 'percent' }).format(acotado);
}

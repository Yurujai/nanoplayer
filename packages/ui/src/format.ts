/**
 * Formato de tiempos.
 *
 * Dos formas para dos públicos: la compacta para la pantalla, y una hablada
 * para los lectores de pantalla. `12:05` se lee "doce, dos puntos, cero cinco",
 * que no significa nada. Es un detalle pequeño y de los que más se notan.
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

/** `1 hora, 5 minutos y 3 segundos`, para `aria-valuetext`. */
export function spokenTime(seconds: number, lang = 'es'): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const es = lang.startsWith('es');
  const unidad = (n: number, sing: string, plur: string) =>
    `${n} ${n === 1 ? sing : plur}`;

  const partes: string[] = [];
  if (h > 0) partes.push(es ? unidad(h, 'hora', 'horas') : unidad(h, 'hour', 'hours'));
  if (m > 0) partes.push(es ? unidad(m, 'minuto', 'minutos') : unidad(m, 'minute', 'minutes'));
  // Los segundos se dicen siempre si no hay nada más, para no leer "" en el 0.
  if (s > 0 || partes.length === 0) {
    partes.push(es ? unidad(s, 'segundo', 'segundos') : unidad(s, 'second', 'seconds'));
  }

  if (partes.length === 1) return partes[0]!;
  const y = es ? ' y ' : ' and ';
  return partes.slice(0, -1).join(', ') + y + partes[partes.length - 1];
}

/** `35 %`, para el volumen. */
export function formatPercent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)} %`;
}

/**
 * Estados del ciclo de vida perezoso y las transiciones permitidas.
 *
 * El principio 2 dice que instanciar un reproductor no descarga nada. Estos
 * estados son la forma de hacerlo cumplir: cada uno declara explícitamente qué
 * cuesta, y no se avanza al siguiente hasta que hace falta de verdad.
 *
 * La transición que da sentido a todo es **`attached` → `resolved`**: soltar el
 * motor y sus elementos `<video>` conservando la posición. Sin ella, una página
 * con muchos reproductores agota los decodificadores del navegador — S2 midió
 * el techo en 17 (WebKit) y 18 (Blink), y ese límite es del motor, no del
 * hardware, así que también aplica en escritorio.
 *
 * Las transiciones viven en una tabla y no repartidas en condicionales: así se
 * pueden leer de un vistazo y probar exhaustivamente.
 */

export type PlayerState =
  /** Solo el póster. **Coste de red: ninguno.** */
  | 'idle'
  /** Pidiendo el manifiesto. Transitorio; existe para impedir peticiones dobles. */
  | 'resolving'
  /** Manifiesto en memoria. Coste: una petición de metadatos. */
  | 'resolved'
  /** Creando motor y elementos multimedia. Transitorio. */
  | 'attaching'
  /** Motor vivo y con buffer. Coste: descarga de vídeo. */
  | 'attached'
  /** Reproduciendo. */
  | 'active'
  /** Terminal. No se sale de aquí. */
  | 'destroyed';

/**
 * Qué se puede alcanzar desde cada estado.
 *
 * Nótese que `active` **no** puede ir directo a `resolved`: para soltar el motor
 * hay que pausar antes. Es deliberado — obliga a que quien desaloja un
 * reproductor (el registro, por presupuesto de recursos) lo haga en dos pasos
 * explícitos en vez de arrancar el motor de debajo de una reproducción en curso.
 */
export const TRANSITIONS = {
  idle: ['resolving', 'destroyed'],
  // Volver a `idle` es el camino del fallo: el manifiesto no se pudo obtener.
  resolving: ['resolved', 'idle', 'destroyed'],
  // Volver a `idle` es un reinicio completo, que descarta el manifiesto.
  resolved: ['attaching', 'idle', 'destroyed'],
  // Volver a `resolved` es el camino del fallo al crear el motor.
  attaching: ['attached', 'resolved', 'destroyed'],
  // Volver a `resolved` es el desalojo: suelta el motor, conserva la posición.
  attached: ['active', 'resolved', 'destroyed'],
  active: ['attached', 'destroyed'],
  destroyed: [],
} as const satisfies Record<PlayerState, readonly PlayerState[]>;

/** Estados en los que hay un manifiesto cargado. */
export const WITH_MANIFEST: readonly PlayerState[] = [
  'resolved', 'attaching', 'attached', 'active',
];

/** Estados en los que existe un motor consumiendo recursos del navegador. */
export const WITH_ENGINE: readonly PlayerState[] = ['attached', 'active'];

export function canTransition(from: PlayerState, to: PlayerState): boolean {
  return (TRANSITIONS[from] as readonly PlayerState[]).includes(to);
}

/**
 * Falla ruidosamente ante una transición inválida.
 *
 * Un cambio de estado imposible es siempre un fallo de programación, y
 * tolerarlo en silencio deja al reproductor en un estado incoherente que se
 * manifiesta mucho después y lejos de la causa.
 */
export function assertTransition(from: PlayerState, to: PlayerState): void {
  if (!canTransition(from, to)) {
    const permitidas = TRANSITIONS[from];
    const detalle = permitidas.length ? permitidas.join(', ') : '(ninguna: estado terminal)';
    throw new Error(
      `Transición inválida: "${from}" → "${to}". Desde "${from}" solo se permite: ${detalle}`,
    );
  }
}

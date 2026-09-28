/** Small DOM helpers shared by the control bar components. */

export function createButton(doc: Document, label: string, icon: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'np__btn';
  b.setAttribute('aria-label', label);
  b.innerHTML = icon;
  return b;
}

export function createRange(
  doc: Document, label: string, min: number, max: number, step: number,
): HTMLInputElement {
  const r = doc.createElement('input');
  r.type = 'range';
  r.className = 'np__range';
  r.min = String(min);
  r.max = String(max);
  r.step = String(step);
  r.value = '0';
  r.setAttribute('aria-label', label);
  return r;
}

/** Event listeners and subscriptions to undo together when a component goes. */
export class Listeners {
  #undo: Array<() => void> = [];

  on(target: EventTarget, type: string, fn: (ev: never) => void): void {
    target.addEventListener(type, fn as EventListener);
    this.#undo.push(() => target.removeEventListener(type, fn as EventListener));
  }

  add(undo: () => void): void {
    this.#undo.push(undo);
  }

  removeAll(): void {
    for (const undo of this.#undo) undo();
    this.#undo = [];
  }
}

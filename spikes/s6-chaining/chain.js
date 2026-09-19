'use strict';
/*
 * Encadenado de piezas: las tres variantes que este spike compara.
 *
 * La pregunta es si se puede pasar de la cabecera al contenido sin que se vea
 * el salto, y si el segundo `play()` sobrevive a la política de autoplay. Son
 * dos preguntas y se estorban entre sí:
 *
 *   - Dos elementos `<video>` distintos permiten tener el segundo ya
 *     decodificando cuando el primero termina, que es la única forma de que no
 *     haya hueco. Pero un elemento que nunca ha reproducido está bloqueado.
 *   - Un solo elemento al que se le cambia el `src` no tiene ese problema
 *     —quedó desbloqueado por el gesto inicial— pero obliga a `load()` y a
 *     rellenar búfer, y eso se ve.
 *
 * De ahí las tres variantes. La A es la que se propone para el reproductor;
 * las otras dos existen para poder decir en qué se nota la diferencia.
 *
 * NADA se descarga hasta que el usuario pulsa reproducir: los elementos se
 * crean dentro del propio gestor del clic. No es celo estético, es lo que
 * obliga el principio 2 del reproductor, y además es la parte difícil —hay que
 * desbloquear un elemento que en ese instante todavía no tiene un byte.
 */

const HAY_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
const ahora = () => performance.now();

/** Las piezas de la cadena. La cola entra por el mismo mecanismo que la cabecera. */
const PIEZAS = [
  { id: 'intro', src: 'media/intro.mp4', etiqueta: 'CABECERA', saltable: true },
  { id: 'main', src: 'media/main.mp4', etiqueta: 'PRINCIPAL' },
  { id: 'outro', src: 'media/outro.mp4', etiqueta: 'COLA' },
];

const VARIANTES = {
  A: {
    id: 'A',
    label: 'A · dos elementos, desbloqueados en el gesto',
    unElemento: false,
    desbloquear: true,
  },
  B: {
    id: 'B',
    label: 'B · dos elementos, sin desbloquear',
    unElemento: false,
    desbloquear: false,
  },
  C: {
    id: 'C',
    label: 'C · un elemento, cambiando src',
    unElemento: true,
    desbloquear: false,
  },
};

/**
 * Encadena las piezas y mide cada costura.
 *
 * Una costura se mide con tres instantes, no con uno: cuándo se pidió el play
 * de la entrante, cuándo presentó su primer fotograma, y cuándo presentó el
 * suyo último la saliente. El hueco visible es la distancia entre los dos
 * últimos; lo demás es diagnóstico para saber *por qué* salió ese número.
 */
class Cadena {
  constructor(escenario, opciones) {
    this.escenario = escenario;
    this.variante = VARIANTES[opciones.variante] ?? VARIANTES.A;
    // La variante C no admite anticipación: no se puede cargar la pieza
    // siguiente sin destruir la que está sonando. Esa imposibilidad es en sí
    // misma un resultado del spike, así que se fuerza aquí y se deja escrito.
    this.leadMs = this.variante.unElemento ? 0 : (opciones.leadMs ?? 0);
    this.onCambio = opciones.onCambio ?? (() => {});

    this.indice = 0;
    this.elementos = [];
    this.marcas = new Map();
    this.costuras = [];
    this.desbloqueos = [];
    this.arranque = null;
    this.preparacion = null;
    this.transitando = false;
    this.terminada = false;
    this.temporizador = null;
  }

  get piezaActual() { return PIEZAS[this.indice]; }
  get elementoActual() {
    return this.variante.unElemento ? this.elementos[0] : this.elementos[this.indice];
  }
  get haySiguiente() { return this.indice < PIEZAS.length - 1; }
  get saltable() {
    return !!this.piezaActual && !!this.piezaActual.saltable && this.haySiguiente
      && !this.terminada;
  }

  /* ------------------------------------------------------------- arranque -- */

  /**
   * Arranca la cadena. **Tiene que llamarse desde el gestor del clic**, y todo
   * lo que hay hasta el primer `await` corre dentro del gesto del usuario.
   *
   * Ese detalle es el spike entero: la activación por gesto solo vale mientras
   * la pila de llamadas viene del evento. Un `await` antes de desbloquear y el
   * permiso ya se perdió.
   */
  arrancar() {
    if (this.elementos.length) return;

    if (this.variante.unElemento) {
      this.elementos.push(this.#crearElemento(PIEZAS[0], 0));
    } else {
      PIEZAS.forEach((pieza, i) => this.elementos.push(this.#crearElemento(pieza, i)));
    }

    // Desbloquear TODO lo que no sea la primera pieza, todavía dentro del
    // gesto. Se hace antes de arrancar la cabecera a propósito: si se hiciera
    // después, un `play()` pendiente podría colarse entre medias.
    if (this.variante.desbloquear) {
      for (let i = 1; i < this.elementos.length; i++) {
        this.#desbloquear(this.elementos[i], PIEZAS[i].id);
      }
    }

    for (const el of this.elementos) this.#instrumentar(el);

    const primero = this.elementos[0];
    this.arranque = { id: PIEZAS[0].id, t: ahora(), bloqueado: false, error: null };
    this.#pedirPlay(primero, this.arranque);
    this.#activar(0);
    this.#vigilar();
    this.onCambio();
  }

  #crearElemento(pieza, indice) {
    const el = document.createElement('video');
    el.src = pieza.src;
    el.preload = 'auto';
    el.playsInline = true;
    // Safari antiguo solo mira el atributo, no la propiedad. Mismo motivo que
    // en el motor nativo del reproductor.
    el.setAttribute('playsinline', '');
    el.dataset.pieza = pieza.id;
    el.className = 'pieza';
    // Todas apiladas en el mismo hueco. Se oculta con opacidad y no con
    // `display:none` ni `visibility:hidden`: hace falta que el navegador siga
    // componiendo el elemento para que tenga un fotograma listo que enseñar en
    // el instante del cambio. Ocultarlo del todo invita a que lo descarte, que
    // es justo el hueco negro que se intenta evitar.
    el.style.opacity = indice === 0 ? '1' : '0';
    el.style.zIndex = indice === 0 ? '2' : '1';
    this.escenario.appendChild(el);
    return el;
  }

  /**
   * Desbloquea un elemento para poder reproducirlo después sin gesto.
   *
   * Dos decisiones que parecen detalles y no lo son:
   *
   * **Volumen a cero, y NO `muted`.** Con `muted = true` el navegador concede
   * el play por la política de autoplay silencioso, y entonces esto no
   * probaría nada: el permiso que interesa es el de reproducir con sonido.
   *
   * **`pause()` inmediato, sin esperar a la promesa.** Si se espera, el vídeo
   * llega a sonar. Interrumpirlo así hace que la promesa de `play()` se
   * rechace con `AbortError`, y ese rechazo es **el camino bueno**: significa
   * que el play llegó a concederse. El que delata un bloqueo es
   * `NotAllowedError`.
   */
  #desbloquear(el, id) {
    const registro = { id, ok: false, error: null };
    this.desbloqueos.push(registro);

    const volumenPrevio = el.volume;
    el.volume = 0;

    let promesa;
    try {
      promesa = el.play();
    } catch (error) {
      registro.error = String((error && error.name) || error);
      el.volume = volumenPrevio;
      return;
    }

    el.pause();

    Promise.resolve(promesa)
      .then(() => { registro.ok = true; })
      .catch((error) => {
        const nombre = (error && error.name) || String(error);
        registro.ok = nombre === 'AbortError';
        if (!registro.ok) registro.error = nombre;
      })
      .finally(() => {
        el.volume = volumenPrevio;
        try { el.currentTime = 0; } catch { /* aún sin metadatos: da igual */ }
        this.onCambio();
      });
  }

  /** Pide reproducción y anota si la política la rechazó. */
  #pedirPlay(el, registro) {
    let promesa;
    try {
      promesa = el.play();
    } catch (error) {
      registro.bloqueado = true;
      registro.error = String((error && error.name) || error);
      return Promise.resolve();
    }
    return Promise.resolve(promesa).catch((error) => {
      const nombre = (error && error.name) || String(error);
      // Un AbortError aquí es una carrera con nuestro propio pause, no un veto.
      if (nombre === 'NotAllowedError') registro.bloqueado = true;
      registro.error = nombre;
      this.onCambio();
    });
  }

  /* -------------------------------------------------------- instrumentación */

  /**
   * Anota cuándo se presentó cada fotograma.
   *
   * `requestVideoFrameCallback` es la única fuente que dice cuándo un fotograma
   * llegó **a la pantalla**. `timeupdate` llega a unos 4 Hz y mide otra cosa, y
   * con él un hueco de 200 ms es indistinguible de uno de 20. Donde no existe
   * la API se degrada a `requestAnimationFrame` y el informe lo advierte: los
   * números salen más gruesos y no se pueden comparar con los de un navegador
   * que sí la tiene.
   */
  #instrumentar(el) {
    const marca = { ultimo: 0, ultimoMedia: 0, frames: 0, primeroTras: null, desde: 0 };
    this.marcas.set(el, marca);

    if (HAY_RVFC) {
      const paso = (tiempo, meta) => {
        marca.ultimo = tiempo;
        marca.ultimoMedia = meta ? meta.mediaTime : el.currentTime;
        marca.frames++;
        if (marca.desde && marca.primeroTras === null && tiempo >= marca.desde) {
          marca.primeroTras = tiempo;
        }
        marca.handle = el.requestVideoFrameCallback(paso);
      };
      marca.handle = el.requestVideoFrameCallback(paso);
    } else {
      const paso = () => {
        const t = ahora();
        // Sin rVFC solo se sabe que el elemento avanza, no cuándo pintó. Se
        // exige que `currentTime` haya cambiado para no contar fotogramas
        // que no existen mientras está parado.
        if (el.currentTime !== marca.ultimoMedia) {
          marca.ultimo = t;
          marca.ultimoMedia = el.currentTime;
          marca.frames++;
          if (marca.desde && marca.primeroTras === null && t >= marca.desde) {
            marca.primeroTras = t;
          }
        }
        marca.raf = requestAnimationFrame(paso);
      };
      marca.raf = requestAnimationFrame(paso);
    }
  }

  /* ------------------------------------------------------------- transición */

  /** Vigila el final de la pieza en curso para empezar la siguiente a tiempo. */
  #vigilar() {
    clearInterval(this.temporizador);
    this.temporizador = setInterval(() => {
      const el = this.elementoActual;
      if (!el || this.transitando || this.terminada) return;

      if (!this.haySiguiente) {
        if (el.ended) { this.terminada = true; clearInterval(this.temporizador); this.onCambio(); }
        return;
      }

      /*
       * Anticipar: arrancar la entrante `leadMs` antes del final, para que
       * tenga fotograma listo cuando haya que enseñarla.
       *
       * Se exige duración conocida. Mientras `readyState` es 0 la duración es
       * NaN, y dando por buena esa lectura el restante salía 0 y la
       * anticipación se disparaba en el primer fotograma: la pieza siguiente
       * arrancaba a la vez que la cabecera y no se medía nada.
       */
      const duracion = el.duration;
      if (this.leadMs > 0 && Number.isFinite(duracion) && duracion > 0) {
        const restante = duracion - el.currentTime;
        if (restante * 1000 <= this.leadMs) void this.#preparar(true);
      }
      if (el.ended) void this.#transitar('fin');
    }, 50);
  }

  /**
   * Arranca la pieza siguiente sin enseñarla todavía.
   *
   * Es la mitad del truco: cuando llegue el momento de cambiar, la entrante ya
   * está decodificando y el cambio es solo un `opacity`. La otra mitad es no
   * hacer el cambio hasta que haya presentado un fotograma de verdad.
   */
  #preparar(anticipada = false) {
    if (this.preparacion) return this.preparacion;
    if (this.variante.unElemento || !this.haySiguiente) return Promise.resolve(null);

    const entrante = this.elementos[this.indice + 1];
    const marca = this.marcas.get(entrante);

    /*
     * Silenciada **solo** cuando se arranca por anticipación, que es cuando la
     * saliente todavía suena: durante unos cientos de milisegundos coexisten,
     * y dos audios a la vez se oyen.
     *
     * En el camino normal —y en el salto, que viene de un botón— arranca con
     * sonido. El salto además ocurre dentro del gesto del usuario, así que
     * silenciarlo ahí sería regalar la única prueba que da gratis.
     *
     * Fuera de ese caso arranca CON sonido, y eso no es un detalle: un
     * `play()` silenciado lo concede siempre la política de autoplay, así que
     * si la entrante arrancara siempre muda la variante B pasaría sin probar
     * nada. El informe publica `conSonido` para que se pueda comprobar que la
     * medición era válida en vez de tener que fiarse.
     */
    entrante.muted = anticipada;

    const registro = {
      tPeticion: ahora(),
      readyState: entrante.readyState,
      buffered: entrante.buffered.length ? entrante.buffered.end(0) : 0,
      anticipada,
      conSonido: !anticipada,
      bloqueado: false,
      error: null,
    };
    marca.desde = registro.tPeticion;
    marca.primeroTras = null;

    this.preparacion = this.#pedirPlay(entrante, registro).then(() => registro);
    return this.preparacion;
  }

  /** Salta la pieza actual. Mismo camino que el final natural. */
  saltar() {
    if (!this.saltable) return;
    void this.#transitar('salto');
  }

  async #transitar(motivo) {
    if (this.transitando || this.terminada || !this.haySiguiente) return;
    this.transitando = true;

    const saliente = this.elementoActual;
    const piezaSaliente = this.piezaActual;
    const piezaEntrante = PIEZAS[this.indice + 1];

    const costura = {
      de: piezaSaliente.id,
      a: piezaEntrante.id,
      motivo,
      lead: this.leadMs,
      anticipada: this.preparacion !== null,
      bloqueado: false,
      error: null,
      conSonido: null,
      pausadaTrasSonido: false,
      readyStateEntrante: null,
      hueco: null,
      tPeticion: null,
      tPrimerFrameEntrante: null,
      tUltimoFrameSaliente: null,
    };

    if (this.variante.unElemento) {
      await this.#transitarMismoElemento(saliente, piezaEntrante, costura);
    } else {
      await this.#transitarDosElementos(saliente, piezaEntrante, costura);
    }

    this.costuras.push(costura);
    this.indice++;
    this.preparacion = null;
    this.transitando = false;
    this.#activar(this.indice);
    this.onCambio();
  }

  /** Variante A/B: la entrante ya existe; solo hay que arrancarla y descubrirla. */
  async #transitarDosElementos(saliente, piezaEntrante, costura) {
    const entrante = this.elementos[this.indice + 1];
    const marcaEntrante = this.marcas.get(entrante);
    const marcaSaliente = this.marcas.get(saliente);

    // Sin anticipación: aquí se conmuta ya, así que la entrante arranca con
    // sonido y la medida de política vale.
    const preparacion = this.#preparar(false);
    const registro = await preparacion;
    if (registro) {
      costura.tPeticion = registro.tPeticion;
      costura.readyStateEntrante = registro.readyState;
      costura.bloqueado = registro.bloqueado;
      costura.error = registro.error;
      costura.anticipada = registro.anticipada;
      costura.conSonido = registro.conSonido;
    }

    // Esperar al primer fotograma **presentado** de la entrante antes de
    // descubrirla. Cambiar la opacidad antes de eso es exactamente lo que
    // produce el destello negro: el elemento está visible y todavía no tiene
    // nada que enseñar.
    if (!costura.bloqueado) {
      costura.tPrimerFrameEntrante = await this.#esperarPrimerFrame(marcaEntrante, 3000);
    }

    // La saliente sigue presentando fotogramas hasta este instante, así que su
    // último frame se lee **aquí**, no cuando se pidió el play.
    costura.tUltimoFrameSaliente = marcaSaliente.ultimo;

    saliente.muted = true;
    entrante.muted = false;
    saliente.style.opacity = '0';
    saliente.style.zIndex = '1';
    entrante.style.opacity = '1';
    entrante.style.zIndex = '2';
    saliente.pause();

    costura.hueco = this.#hueco(costura);

    /*
     * Si arrancó muda por la anticipación, quitarle el silencio es otra
     * operación sin gesto detrás, y algunos navegadores responden pausando el
     * elemento en vez de rechazar nada. Se comprueba un instante después en
     * lugar de darlo por bueno: un fallo así es invisible salvo que se mire.
     */
    if (costura.anticipada && !costura.bloqueado) {
      await new Promise((r) => setTimeout(r, 250));
      if (entrante.paused) {
        costura.pausadaTrasSonido = true;
        this.#pedirPlay(entrante, costura);
      }
    }
  }

  /** Variante C: un elemento al que se le cambia la fuente. */
  async #transitarMismoElemento(el, piezaEntrante, costura) {
    const marca = this.marcas.get(el);
    costura.tUltimoFrameSaliente = marca.ultimo;
    costura.readyStateEntrante = 0;

    el.src = piezaEntrante.src;
    el.load();

    const registro = { bloqueado: false, error: null };
    // El elemento es el que ya estaba sonando, así que la petición va con
    // sonido y la prueba de política es válida sin hacer nada más.
    costura.conSonido = true;
    costura.tPeticion = ahora();
    marca.desde = costura.tPeticion;
    marca.primeroTras = null;

    await this.#pedirPlay(el, registro);
    costura.bloqueado = registro.bloqueado;
    costura.error = registro.error;

    if (!costura.bloqueado) {
      costura.tPrimerFrameEntrante = await this.#esperarPrimerFrame(marca, 5000);
    }
    costura.hueco = this.#hueco(costura);
  }

  #esperarPrimerFrame(marca, limiteMs) {
    const t0 = ahora();
    return new Promise((resolve) => {
      const mirar = () => {
        if (marca.primeroTras !== null) return resolve(marca.primeroTras);
        if (ahora() - t0 > limiteMs) return resolve(null);
        requestAnimationFrame(mirar);
      };
      mirar();
    });
  }

  /**
   * El hueco visible.
   *
   * Se acota por abajo en cero a propósito: con anticipación la entrante
   * presenta fotogramas **antes** de que la saliente termine, y la resta sale
   * negativa. Eso no es un hueco de -200 ms, es que no hubo hueco.
   */
  #hueco(costura) {
    if (costura.bloqueado) return null;
    if (costura.tPrimerFrameEntrante === null || !costura.tUltimoFrameSaliente) return null;
    return Math.max(0, costura.tPrimerFrameEntrante - costura.tUltimoFrameSaliente);
  }

  #activar(indice) {
    if (this.variante.unElemento) return;
    this.elementos.forEach((el, i) => {
      el.style.opacity = i === indice ? '1' : '0';
      el.style.zIndex = i === indice ? '2' : '1';
      el.muted = i !== indice;
    });
  }

  /* ----------------------------------------------------------------- estado */

  pausar() { this.elementoActual?.pause(); this.onCambio(); }
  reanudar() {
    const el = this.elementoActual;
    if (el) this.#pedirPlay(el, { bloqueado: false, error: null });
    this.onCambio();
  }

  destruir() {
    clearInterval(this.temporizador);
    for (const el of this.elementos) {
      const marca = this.marcas.get(el);
      if (marca && marca.raf) cancelAnimationFrame(marca.raf);
      if (marca && marca.handle && el.cancelVideoFrameCallback) {
        el.cancelVideoFrameCallback(marca.handle);
      }
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    }
    this.elementos = [];
    this.marcas.clear();
  }

  get informe() {
    return {
      variante: this.variante.id,
      etiqueta: this.variante.label,
      leadMs: this.leadMs,
      rvfc: HAY_RVFC,
      arranque: this.arranque,
      desbloqueos: this.desbloqueos.slice(),
      costuras: this.costuras.slice(),
      terminada: this.terminada,
    };
  }
}

window.Cadena = Cadena;
window.PIEZAS = PIEZAS;
window.VARIANTES = VARIANTES;
window.HAY_RVFC = HAY_RVFC;

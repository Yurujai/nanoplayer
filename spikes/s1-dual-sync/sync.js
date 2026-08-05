/*
 * Spike S1 — sincronización dual-stream.
 *
 * Código desechable: sirve para responder preguntas, no para reutilizarse.
 * Lo que sobrevive de aquí son las conclusiones, no las líneas.
 *
 * Modelo maestro/esclavo:
 *
 *   - El maestro es el stream que lleva el audio. Nunca se le toca el
 *     playbackRate: alterar la velocidad del audio se oye, y un reproductor que
 *     hace "wow" en la voz del ponente es inaceptable.
 *   - El esclavo persigue al maestro. Toda la corrección se aplica sobre él.
 *
 * Dos regímenes de corrección:
 *
 *   - Deriva pequeña  -> control proporcional sobre playbackRate. Invisible.
 *   - Deriva grande   -> salto duro (asignar currentTime). Se ve, pero recupera.
 *
 * La franja entre ambos umbrales es la decisión de diseño importante: demasiado
 * estrecha y el esclavo salta constantemente; demasiado ancha y los dos vídeos
 * se ven desincronizados sin que el sistema reaccione.
 */

const CFG = {
  // Umbral de ENGANCHE: por debajo de esto no se empieza a corregir. Un frame a
  // 30fps son 33ms; perseguir menos que un frame visible es perseguir ruido.
  deadZone: 0.033,
  // Umbral de SUELTA. Una vez enganchado, se corrige hasta bajar de aquí, no
  // hasta rozar el umbral de enganche.
  //
  // Sin esta histéresis el controlador tiene error de estado estacionario: se
  // para justo al entrar en la zona muerta y deja un offset permanente de casi
  // un frame. Medido en la primera pasada del spike: 28.8 ms de mediana, fijos.
  releaseZone: 0.008,
  // Por encima de esto, salto duro: el control proporcional tardaría demasiado.
  hardSeek: 0.5,
  // Ganancia del control proporcional. Medido en el barrido de parámetros: es
  // ESTA la que gobierna el tiempo de recuperación, no el techo de abajo.
  // Subirla de 0.6 a 1.2 pasó la recuperación de 3.4 s a 1.7 s, a cambio de
  // 3 ms más de deriva en régimen estable. Buen cambio.
  gain: 1.2,
  // Techo de desviación de velocidad del esclavo. Puede ser generoso porque el
  // esclavo NO lleva audio: el motivo habitual para limitarlo no aplica aquí.
  maxRateDelta: 0.25,
  // Qué hacer cuando el esclavo se queda sin buffer.
  //   'pauseBoth'  -> congela los dos. Coherente visualmente, corta el audio.
  //   'letMasterRun' -> el maestro sigue, el esclavo recupera después.
  stallPolicy: 'pauseBoth',
};

// Sobrescribible por query string para barrer parámetros sin editar el fichero:
//   index.html?maxRateDelta=0.25&gain=0.9
for (const [k, v] of new URLSearchParams(location.search)) {
  if (!(k in CFG)) continue;
  CFG[k] = typeof CFG[k] === 'number' ? parseFloat(v) : v;
}

class DualSync {
  constructor(master, slave) {
    this.master = master;
    this.slave = slave;
    this.running = false;
    this.samples = [];
    this.maxDrift = 0;
    this.hardSeeks = 0;
    this.stalls = 0;
    this._stalledByUs = false;
    this._correcting = false;
    this._listeners = [];
    this._wire();
  }

  on(el, ev, fn) {
    el.addEventListener(ev, fn);
    this._listeners.push([el, ev, fn]);
  }

  _wire() {
    const { master, slave } = this;

    // --- Propagación de estado -------------------------------------------
    this.on(master, 'play', () => {
      if (!this._stalledByUs) slave.play().catch(() => {});
    });
    this.on(master, 'pause', () => slave.pause());
    this.on(master, 'ratechange', () => this._applyRate(0));

    // Seek: el esclavo va directo al mismo punto. Con GOP de 2s el navegador
    // decodifica desde el keyframe previo, así que esto tarda pero es exacto.
    this.on(master, 'seeking', () => {
      slave.currentTime = this._clampToSlave(master.currentTime);
    });

    // --- Buffering --------------------------------------------------------
    // El maestro se queda sin buffer: el esclavo debe esperarlo siempre, o
    // seguiría avanzando y acumularía deriva imposible de recuperar en suave.
    this.on(master, 'waiting', () => {
      this.stalls++;
      slave.pause();
    });
    this.on(master, 'playing', () => {
      if (!master.paused && !this._stalledByUs) slave.play().catch(() => {});
    });

    // El esclavo se queda sin buffer: aquí sí hay decisión de diseño.
    this.on(slave, 'waiting', () => {
      this.stalls++;
      if (CFG.stallPolicy === 'pauseBoth' && !master.paused) {
        this._stalledByUs = true;
        master.pause();
      }
    });
    this.on(slave, 'canplay', () => {
      if (this._stalledByUs) {
        this._stalledByUs = false;
        master.play().catch(() => {});
      }
    });
  }

  _clampToSlave(t) {
    const d = this.slave.duration;
    return Number.isFinite(d) ? Math.min(t, Math.max(0, d - 0.05)) : t;
  }

  /** Deriva instantánea. Negativa = el esclavo va por detrás del maestro. */
  drift() {
    return this.slave.currentTime - this.master.currentTime;
  }

  _applyRate(drift) {
    const base = this.master.playbackRate;
    const a = Math.abs(drift);

    // Histéresis: engancha en deadZone, suelta en releaseZone.
    if (!this._correcting && a > CFG.deadZone) this._correcting = true;
    else if (this._correcting && a < CFG.releaseZone) this._correcting = false;

    if (!this._correcting) {
      this.slave.playbackRate = base;
      return base;
    }
    // Control proporcional: si el esclavo va por detrás (drift < 0), acelera.
    const delta = Math.max(
      -CFG.maxRateDelta,
      Math.min(CFG.maxRateDelta, -CFG.gain * drift)
    );
    const rate = base + delta;
    this.slave.playbackRate = rate;
    return rate;
  }

  /** Un paso del lazo de control. Devuelve el estado para la UI. */
  tick() {
    const drift = this.drift();
    const adrift = Math.abs(drift);
    let action = 'ok';
    let rate = this.slave.playbackRate;

    if (this.master.seeking || this.slave.seeking) {
      action = 'seeking';
    } else if (adrift > CFG.hardSeek) {
      this.slave.currentTime = this._clampToSlave(this.master.currentTime);
      this.slave.playbackRate = this.master.playbackRate;
      this._correcting = false;
      this.hardSeeks++;
      action = 'hard-seek';
    } else {
      rate = this._applyRate(drift);
      action = this._correcting ? 'correcting' : 'ok';
    }

    // El maxDrift solo cuenta en reproducción estable: durante un seek la
    // medida no significa nada.
    if (action !== 'seeking' && !this.master.paused) {
      this.maxDrift = Math.max(this.maxDrift, adrift);
      this.samples.push(drift);
      if (this.samples.length > 600) this.samples.shift();
    }

    return { drift, action, rate };
  }

  reset() {
    this.samples = [];
    this.maxDrift = 0;
    this.hardSeeks = 0;
    this.stalls = 0;
  }

  destroy() {
    this.running = false;
    for (const [el, ev, fn] of this._listeners) el.removeEventListener(ev, fn);
    this._listeners = [];
  }
}

/* ------------------------------------------------------------------ UI --- */

const master = document.getElementById('master');
const slave = document.getElementById('slave');
const sync = new DualSync(master, slave);

// Expuesto para el arnés de medición automática (measure.mjs).
window.__sync = sync;
window.__CFG = CFG;

const el = (id) => document.getElementById(id);
const canvas = el('chart');
const ctx = canvas.getContext('2d');

function fmt(n, d = 3) {
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

function drawChart() {
  const w = canvas.width, h = canvas.height;
  const mid = h / 2;
  // Escala: la zona visible llega hasta el umbral de salto duro.
  const scale = mid / CFG.hardSeek;

  ctx.clearRect(0, 0, w, h);

  // Bandas de referencia.
  ctx.fillStyle = 'rgba(136,255,0,0.10)';
  ctx.fillRect(0, mid - CFG.deadZone * scale, w, CFG.deadZone * scale * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(0, mid); ctx.lineTo(w, mid);
  ctx.stroke();

  const s = sync.samples;
  if (s.length < 2) return;
  ctx.strokeStyle = '#88ff00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  s.forEach((v, i) => {
    const x = (i / (s.length - 1)) * w;
    const y = Math.max(2, Math.min(h - 2, mid - v * scale));
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function render(state) {
  el('drift').textContent = fmt(state.drift * 1000, 1) + ' ms';
  el('drift').className = 'val ' + (Math.abs(state.drift) > CFG.deadZone ? 'warn' : 'good');
  el('maxdrift').textContent = (sync.maxDrift * 1000).toFixed(1) + ' ms';
  el('rate').textContent = state.rate.toFixed(4) + '×';
  el('action').textContent = state.action;
  el('action').className = 'val ' + (state.action === 'ok' ? 'good' : 'warn');
  el('hardseeks').textContent = sync.hardSeeks;
  el('stalls').textContent = sync.stalls;
  el('mt').textContent = master.currentTime.toFixed(3);
  el('st').textContent = slave.currentTime.toFixed(3);
  drawChart();
}

// requestVideoFrameCallback se dispara con la presentación real del frame, que
// es más fiel que rAF para medir. Si no existe, rAF sirve.
function loop() {
  render(sync.tick());
  if (master.requestVideoFrameCallback) {
    master.requestVideoFrameCallback(loop);
  } else {
    requestAnimationFrame(loop);
  }
}
loop();

/* --------------------------------------------------- Escenarios de prueba - */

el('btn-play').onclick = () => (master.paused ? master.play() : master.pause());
el('btn-seek').onclick = () => {
  master.currentTime = Math.random() * (master.duration - 5);
};
el('btn-reset').onclick = () => { sync.reset(); };

// Simula que el esclavo se queda sin buffer, que es el caso que no se puede
// provocar a voluntad con la red.
el('btn-stall').onclick = () => {
  const was = slave.playbackRate;
  slave.pause();
  el('btn-stall').disabled = true;
  setTimeout(() => {
    slave.playbackRate = was;
    if (!master.paused) slave.play().catch(() => {});
    el('btn-stall').disabled = false;
  }, 1500);
};

// Desincroniza a lo bruto para ver cuánto tarda en recuperar y por qué vía.
el('btn-nudge').onclick = () => { slave.currentTime += 0.25; };
el('btn-shove').onclick = () => { slave.currentTime += 2.0; };

el('rate-sel').onchange = (e) => { master.playbackRate = parseFloat(e.target.value); };

el('stall-sel').onchange = (e) => { CFG.stallPolicy = e.target.value; };

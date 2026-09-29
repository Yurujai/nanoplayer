/*
 * Spike S1 — dual-stream synchronisation.
 *
 * Throwaway code: it answers questions, it is not meant for reuse. What
 * survives are the conclusions, not the lines.
 *
 * Master/slave model:
 *
 *   - The master is the stream carrying the audio. Its playbackRate is never
 *     touched: changing the speed of audio is audible, and a player that
 *     "wows" the speaker's voice is unacceptable.
 *   - The slave chases the master. All correction is applied to it.
 *
 * Two correction regimes:
 *
 *   - Small drift -> proportional control over playbackRate. Invisible.
 *   - Large drift -> hard seek (assign currentTime). Visible, but it recovers.
 *
 * The band between both thresholds is the important design decision: too
 * narrow and the slave keeps jumping; too wide and the two videos look out of
 * sync without the system reacting.
 */

const CFG = {
  // ENGAGE threshold: below this no correction starts. One frame at 30 fps is
  // 33 ms; chasing less than a visible frame is chasing noise.
  deadZone: 0.033,
  // RELEASE threshold. Once engaged, correction continues until drift drops
  // below this, not until it just touches the engage threshold.
  //
  // Without this hysteresis the controller has steady-state error: it stops
  // right on entering the dead zone and leaves a permanent offset of almost a
  // frame. Measured on the spike's first pass: a fixed 28.8 ms median.
  releaseZone: 0.008,
  // Above this, hard seek: proportional control would take too long.
  hardSeek: 0.5,
  // Proportional gain. Measured in the parameter sweep: THIS governs recovery
  // time, not the ceiling below. Raising it from 0.6 to 1.2 took recovery from
  // 3.4 s to 1.7 s, at the cost of 3 ms more steady-state drift. A good trade.
  gain: 1.2,
  // Ceiling on the slave's speed deviation. It can be generous because the
  // slave carries NO audio: the usual reason to limit it does not apply.
  maxRateDelta: 0.25,
  // What to do when the slave runs out of buffer.
  //   'pauseBoth'    -> freezes both. Visually coherent, cuts the audio.
  //   'letMasterRun' -> the master keeps going, the slave catches up later.
  stallPolicy: 'pauseBoth',
};

// Overridable from the query string, to sweep parameters without editing:
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

    // --- State propagation ----------------------------------------------
    this.on(master, 'play', () => {
      if (!this._stalledByUs) slave.play().catch(() => {});
    });
    this.on(master, 'pause', () => slave.pause());
    this.on(master, 'ratechange', () => this._applyRate(0));

    // Seek: the slave goes straight to the same point. With a 2 s GOP the
    // browser decodes from the previous keyframe, so it is slow but exact.
    this.on(master, 'seeking', () => {
      slave.currentTime = this._clampToSlave(master.currentTime);
    });

    // --- Buffering --------------------------------------------------------
    // The master runs out of buffer: the slave must always wait for it, or it
    // would keep going and build up drift too large to recover smoothly.
    this.on(master, 'waiting', () => {
      this.stalls++;
      slave.pause();
    });
    this.on(master, 'playing', () => {
      if (!master.paused && !this._stalledByUs) slave.play().catch(() => {});
    });

    // The slave runs out of buffer: this is where a design decision is needed.
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

  /** Instant drift. Negative = the slave is behind the master. */
  drift() {
    return this.slave.currentTime - this.master.currentTime;
  }

  _applyRate(drift) {
    const base = this.master.playbackRate;
    const a = Math.abs(drift);

    // Hysteresis: engage at deadZone, release at releaseZone.
    if (!this._correcting && a > CFG.deadZone) this._correcting = true;
    else if (this._correcting && a < CFG.releaseZone) this._correcting = false;

    if (!this._correcting) {
      this.slave.playbackRate = base;
      return base;
    }
    // Proportional control: if the slave is behind (drift < 0), speed it up.
    const delta = Math.max(
      -CFG.maxRateDelta,
      Math.min(CFG.maxRateDelta, -CFG.gain * drift)
    );
    const rate = base + delta;
    this.slave.playbackRate = rate;
    return rate;
  }

  /** One step of the control loop. Returns the state for the UI. */
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

    // maxDrift only counts during steady playback: during a seek the reading
    // means nothing.
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

// Exposed for the automatic measurement harness (measure.mjs).
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
  // Scale: the visible area reaches the hard-seek threshold.
  const scale = mid / CFG.hardSeek;

  ctx.clearRect(0, 0, w, h);

  // Reference bands.
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

// requestVideoFrameCallback fires on the actual presentation of the frame,
// which measures more faithfully than rAF. Where it does not exist, rAF will do.
function loop() {
  render(sync.tick());
  if (master.requestVideoFrameCallback) {
    master.requestVideoFrameCallback(loop);
  } else {
    requestAnimationFrame(loop);
  }
}
loop();

/* ------------------------------------------------------- Test scenarios -- */

el('btn-play').onclick = () => (master.paused ? master.play() : master.pause());
el('btn-seek').onclick = () => {
  master.currentTime = Math.random() * (master.duration - 5);
};
el('btn-reset').onclick = () => { sync.reset(); };

// Simulates the slave running out of buffer, which the network cannot be made
// to do on demand.
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

// Knocks it out of sync on purpose, to see how long recovery takes and by which path.
el('btn-nudge').onclick = () => { slave.currentTime += 0.25; };
el('btn-shove').onclick = () => { slave.currentTime += 2.0; };

el('rate-sel').onchange = (e) => { master.playbackRate = parseFloat(e.target.value); };

el('stall-sel').onchange = (e) => { CFG.stallPolicy = e.target.value; };

'use strict';
/*
 * Chaining pieces: the three variants this spike compares.
 *
 * The question is whether the intro can hand over to the content without the
 * cut being visible, and whether the second `play()` survives the autoplay
 * policy. They are two questions and they get in each other's way:
 *
 *   - Two distinct `<video>` elements let the second one already be decoding
 *     when the first ends, which is the only way to have no gap. But an
 *     element that has never played is locked.
 *   - A single element whose `src` is swapped does not have that problem
 *     —it was unlocked by the initial gesture— but it forces a `load()` and a
 *     buffer refill, and that shows.
 *
 * Hence the three variants. A is the one proposed for the player; the other
 * two exist to be able to say where the difference shows.
 *
 * NOTHING is downloaded until the user presses play: the elements are created
 * inside the click handler itself. It is not aesthetic zeal, it is what the
 * player's principle 2 demands, and it is also the hard part —an element must
 * be unlocked while it does not yet have a single byte.
 */

const HAS_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
const now = () => performance.now();

/** The pieces of the chain. The outro goes in through the same mechanism as the intro. */
const PIECES = [
  { id: 'intro', src: 'media/intro.mp4', label: 'INTRO', skippable: true },
  { id: 'main', src: 'media/main.mp4', label: 'MAIN' },
  { id: 'outro', src: 'media/outro.mp4', label: 'OUTRO' },
];

const VARIANTS = {
  A: {
    id: 'A',
    label: 'A · two elements, unlocked in the gesture',
    singleElement: false,
    unlock: true,
  },
  B: {
    id: 'B',
    label: 'B · two elements, not unlocked',
    singleElement: false,
    unlock: false,
  },
  C: {
    id: 'C',
    label: 'C · one element, swapping src',
    singleElement: true,
    unlock: false,
  },
};

/**
 * Chains the pieces and measures each seam.
 *
 * A seam is measured with three instants, not one: when the incoming piece's
 * play was requested, when it presented its first frame, and when the
 * outgoing one presented its last. The visible gap is the distance between
 * the last two; the rest is diagnostics, to know *why* that number came out.
 */
class Chain {
  constructor(stage, options) {
    this.stage = stage;
    this.variant = VARIANTS[options.variant] ?? VARIANTS.A;
    // Variant C cannot anticipate: the next piece cannot be loaded without
    // destroying the one playing. That impossibility is itself a result of
    // the spike, so it is forced here and written down.
    this.leadMs = this.variant.singleElement ? 0 : (options.leadMs ?? 0);
    this.onChange = options.onChange ?? (() => {});

    this.index = 0;
    this.elements = [];
    this.marks = new Map();
    this.seams = [];
    this.unlocks = [];
    this.start = null;
    this.preparation = null;
    this.transitioning = false;
    this.finished = false;
    this.timer = null;
  }

  get currentPiece() { return PIECES[this.index]; }
  get currentElement() {
    return this.variant.singleElement ? this.elements[0] : this.elements[this.index];
  }
  get hasNext() { return this.index < PIECES.length - 1; }
  get skippable() {
    return !!this.currentPiece && !!this.currentPiece.skippable && this.hasNext
      && !this.finished;
  }

  /* ---------------------------------------------------------------- start -- */

  /**
   * Starts the chain. **It must be called from the click handler**, and
   * everything up to the first `await` runs inside the user gesture.
   *
   * That detail is the whole spike: gesture activation is only valid while the
   * call stack comes from the event. One `await` before unlocking and the
   * permission is gone.
   */
  begin() {
    if (this.elements.length) return;

    if (this.variant.singleElement) {
      this.elements.push(this.#createElement(PIECES[0], 0));
    } else {
      PIECES.forEach((piece, i) => this.elements.push(this.#createElement(piece, i)));
    }

    // Unlock EVERYTHING except the first piece, still inside the gesture. It
    // is done before starting the intro on purpose: done afterwards, a pending
    // `play()` could slip in between.
    if (this.variant.unlock) {
      for (let i = 1; i < this.elements.length; i++) {
        this.#unlock(this.elements[i], PIECES[i].id);
      }
    }

    for (const el of this.elements) this.#instrument(el);

    const first = this.elements[0];
    this.start = { id: PIECES[0].id, t: now(), blocked: false, error: null };
    this.#requestPlay(first, this.start);
    this.#activate(0);
    this.#watch();
    this.onChange();
  }

  #createElement(piece, index) {
    const el = document.createElement('video');
    el.src = piece.src;
    el.preload = 'auto';
    el.playsInline = true;
    // Old Safari only looks at the attribute, not the property. Same reason
    // as in the player's native engine.
    el.setAttribute('playsinline', '');
    el.dataset.piece = piece.id;
    el.className = 'piece';
    // All stacked in the same slot. Hidden with opacity and not with
    // `display:none` or `visibility:hidden`: the browser must keep compositing
    // the element so it has a frame ready to show at the moment of the switch.
    // Hiding it completely invites the browser to discard it, which is exactly
    // the black gap being avoided.
    el.style.opacity = index === 0 ? '1' : '0';
    el.style.zIndex = index === 0 ? '2' : '1';
    this.stage.appendChild(el);
    return el;
  }

  /**
   * Unlocks an element so it can be played later without a gesture.
   *
   * Two decisions that look like details and are not:
   *
   * **Volume to zero, and NOT `muted`.** With `muted = true` the browser grants
   * the play under the muted-autoplay policy, and then this would prove
   * nothing: the permission that matters is playing with sound.
   *
   * **Immediate `pause()`, without waiting for the promise.** If it waits, the
   * video gets to be heard. Interrupting it like this makes the `play()`
   * promise reject with `AbortError`, and that rejection is **the good path**:
   * it means the play was granted. The one that betrays a block is
   * `NotAllowedError`.
   */
  #unlock(el, id) {
    const record = { id, ok: false, error: null };
    this.unlocks.push(record);

    const previousVolume = el.volume;
    el.volume = 0;

    let promise;
    try {
      promise = el.play();
    } catch (error) {
      record.error = String((error && error.name) || error);
      el.volume = previousVolume;
      return;
    }

    el.pause();

    Promise.resolve(promise)
      .then(() => { record.ok = true; })
      .catch((error) => {
        const name = (error && error.name) || String(error);
        record.ok = name === 'AbortError';
        if (!record.ok) record.error = name;
      })
      .finally(() => {
        el.volume = previousVolume;
        try { el.currentTime = 0; } catch { /* no metadata yet: does not matter */ }
        this.onChange();
      });
  }

  /** Requests playback and records whether the policy rejected it. */
  #requestPlay(el, record) {
    let promise;
    try {
      promise = el.play();
    } catch (error) {
      record.blocked = true;
      record.error = String((error && error.name) || error);
      return Promise.resolve();
    }
    return Promise.resolve(promise).catch((error) => {
      const name = (error && error.name) || String(error);
      // An AbortError here is a race with our own pause, not a veto.
      if (name === 'NotAllowedError') record.blocked = true;
      record.error = name;
      this.onChange();
    });
  }

  /* ------------------------------------------------------ instrumentation -- */

  /**
   * Records when each frame was presented.
   *
   * `requestVideoFrameCallback` is the only source that says when a frame
   * reached **the screen**. `timeupdate` arrives at about 4 Hz and measures
   * something else, and with it a 200 ms gap is indistinguishable from a 20 ms
   * one. Where the API does not exist it degrades to `requestAnimationFrame`
   * and the report warns about it: the numbers come out coarser and cannot be
   * compared with those of a browser that has it.
   */
  #instrument(el) {
    const mark = { last: 0, lastMedia: 0, frames: 0, firstAfter: null, since: 0 };
    this.marks.set(el, mark);

    if (HAS_RVFC) {
      const step = (time, meta) => {
        mark.last = time;
        mark.lastMedia = meta ? meta.mediaTime : el.currentTime;
        mark.frames++;
        if (mark.since && mark.firstAfter === null && time >= mark.since) {
          mark.firstAfter = time;
        }
        mark.handle = el.requestVideoFrameCallback(step);
      };
      mark.handle = el.requestVideoFrameCallback(step);
    } else {
      const step = () => {
        const t = now();
        // Without rVFC all that is known is that the element advances, not
        // when it painted. `currentTime` is required to have changed so as not
        // to count frames that do not exist while it is stopped.
        if (el.currentTime !== mark.lastMedia) {
          mark.last = t;
          mark.lastMedia = el.currentTime;
          mark.frames++;
          if (mark.since && mark.firstAfter === null && t >= mark.since) {
            mark.firstAfter = t;
          }
        }
        mark.raf = requestAnimationFrame(step);
      };
      mark.raf = requestAnimationFrame(step);
    }
  }

  /* ----------------------------------------------------------- transition -- */

  /** Watches for the end of the current piece to start the next one in time. */
  #watch() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const el = this.currentElement;
      if (!el || this.transitioning || this.finished) return;

      if (!this.hasNext) {
        if (el.ended) { this.finished = true; clearInterval(this.timer); this.onChange(); }
        return;
      }

      /*
       * Anticipate: start the incoming piece `leadMs` before the end, so it
       * has a frame ready when it has to be shown.
       *
       * A known duration is required. While `readyState` is 0 the duration is
       * NaN, and taking that reading at face value made the remaining time
       * come out as 0 and fired the anticipation on the first frame: the next
       * piece started together with the intro and nothing was measured.
       */
      const duration = el.duration;
      if (this.leadMs > 0 && Number.isFinite(duration) && duration > 0) {
        const remaining = duration - el.currentTime;
        if (remaining * 1000 <= this.leadMs) void this.#prepare(true);
      }
      if (el.ended) void this.#transition('end');
    }, 50);
  }

  /**
   * Starts the next piece without showing it yet.
   *
   * It is half of the trick: when the time comes to switch, the incoming one
   * is already decoding and the switch is just an `opacity`. The other half is
   * not switching until it has presented a real frame.
   */
  #prepare(anticipated = false, muted = anticipated) {
    if (this.preparation) return this.preparation;
    if (this.variant.singleElement || !this.hasNext) return Promise.resolve(null);

    const incoming = this.elements[this.index + 1];
    const mark = this.marks.get(incoming);

    /*
     * Muted while the outgoing one is still playing: in the anticipation and
     * in the skip. For a few hundred milliseconds they coexist, and two audio
     * tracks at once are heard.
     *
     * The skip used to start with sound, and on iPhone that **stops the
     * outgoing one** as soon as the `play()` is requested: a 321 ms gap
     * (README §5), because iOS does not play two audio tracks at once. Now it
     * starts muted, as the player does, to measure what will really be used.
     *
     * On the normal path without anticipation it starts WITH sound, and that
     * is not a detail: a muted `play()` is always granted by the autoplay
     * policy, so if the incoming one always started muted variant B would
     * pass without proving anything. The report publishes `withSound` so it
     * can be checked that the measurement was valid instead of having to
     * trust it.
     */
    incoming.muted = muted;

    const record = {
      tRequest: now(),
      readyState: incoming.readyState,
      buffered: incoming.buffered.length ? incoming.buffered.end(0) : 0,
      anticipated,
      withSound: !muted,
      blocked: false,
      error: null,
    };
    mark.since = record.tRequest;
    mark.firstAfter = null;

    this.preparation = this.#requestPlay(incoming, record).then(() => record);
    return this.preparation;
  }

  /** Skips the current piece. Same path as the natural end. */
  skip() {
    if (!this.skippable) return;
    void this.#transition('skip');
  }

  async #transition(reason) {
    if (this.transitioning || this.finished || !this.hasNext) return;
    this.transitioning = true;

    const outgoing = this.currentElement;
    const outgoingPiece = this.currentPiece;
    const incomingPiece = PIECES[this.index + 1];

    const seam = {
      from: outgoingPiece.id,
      to: incomingPiece.id,
      reason,
      lead: this.leadMs,
      anticipated: this.preparation !== null,
      blocked: false,
      error: null,
      withSound: null,
      pausedAfterUnmute: false,
      incomingReadyState: null,
      gap: null,
      tRequest: null,
      tIncomingFirstFrame: null,
      tOutgoingLastFrame: null,
    };

    if (this.variant.singleElement) {
      await this.#transitionSameElement(outgoing, incomingPiece, seam);
    } else {
      await this.#transitionTwoElements(outgoing, incomingPiece, seam);
    }

    this.seams.push(seam);
    this.index++;
    this.preparation = null;
    this.transitioning = false;
    this.#activate(this.index);
    this.onChange();
  }

  /** Variant A/B: the incoming element already exists; it only has to be started and revealed. */
  async #transitionTwoElements(outgoing, incomingPiece, seam) {
    const incoming = this.elements[this.index + 1];
    const incomingMark = this.marks.get(incoming);
    const outgoingMark = this.marks.get(outgoing);

    // Without anticipation the switch happens now: at the natural end the
    // incoming one starts with sound and the policy measurement is valid; on a
    // skip it starts muted, because the outgoing one keeps playing until the
    // incoming one has a picture.
    const preparation = this.#prepare(false, seam.reason === 'skip');
    const record = await preparation;
    if (record) {
      seam.tRequest = record.tRequest;
      seam.incomingReadyState = record.readyState;
      seam.blocked = record.blocked;
      seam.error = record.error;
      seam.anticipated = record.anticipated;
      seam.withSound = record.withSound;
    }

    // Wait for the incoming one's first **presented** frame before revealing
    // it. Changing the opacity before that is exactly what produces the black
    // flash: the element is visible and has nothing to show yet.
    if (!seam.blocked) {
      seam.tIncomingFirstFrame = await this.#waitFirstFrame(incomingMark, 3000);
    }

    // The outgoing one keeps presenting frames until this instant, so its last
    // frame is read **here**, not when the play was requested.
    seam.tOutgoingLastFrame = outgoingMark.last;

    outgoing.muted = true;
    incoming.muted = false;
    outgoing.style.opacity = '0';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';
    incoming.style.zIndex = '2';
    outgoing.pause();

    seam.gap = this.#gap(seam);

    /*
     * If it started muted —through anticipation or a skip—, unmuting it is
     * another operation with no gesture behind it, and some browsers respond
     * by pausing the element instead of rejecting anything. It is checked a
     * moment later rather than taken for granted: a failure like that is
     * invisible unless someone looks.
     */
    if (seam.withSound === false && !seam.blocked) {
      await new Promise((r) => setTimeout(r, 250));
      if (incoming.paused) {
        seam.pausedAfterUnmute = true;
        this.#requestPlay(incoming, seam);
      }
    }
  }

  /** Variant C: one element whose source is swapped. */
  async #transitionSameElement(el, incomingPiece, seam) {
    const mark = this.marks.get(el);
    seam.tOutgoingLastFrame = mark.last;
    seam.incomingReadyState = 0;

    el.src = incomingPiece.src;
    el.load();

    const record = { blocked: false, error: null };
    // The element is the one that was already playing, so the request goes
    // with sound and the policy test is valid without doing anything else.
    seam.withSound = true;
    seam.tRequest = now();
    mark.since = seam.tRequest;
    mark.firstAfter = null;

    await this.#requestPlay(el, record);
    seam.blocked = record.blocked;
    seam.error = record.error;

    if (!seam.blocked) {
      seam.tIncomingFirstFrame = await this.#waitFirstFrame(mark, 5000);
    }
    seam.gap = this.#gap(seam);
  }

  #waitFirstFrame(mark, limitMs) {
    const t0 = now();
    return new Promise((resolve) => {
      const check = () => {
        if (mark.firstAfter !== null) return resolve(mark.firstAfter);
        if (now() - t0 > limitMs) return resolve(null);
        requestAnimationFrame(check);
      };
      check();
    });
  }

  /**
   * The visible gap.
   *
   * Clamped at zero on purpose: with anticipation the incoming one presents
   * frames **before** the outgoing one ends, and the subtraction comes out
   * negative. That is not a -200 ms gap, it means there was no gap.
   */
  #gap(seam) {
    if (seam.blocked) return null;
    if (seam.tIncomingFirstFrame === null || !seam.tOutgoingLastFrame) return null;
    return Math.max(0, seam.tIncomingFirstFrame - seam.tOutgoingLastFrame);
  }

  #activate(index) {
    if (this.variant.singleElement) return;
    this.elements.forEach((el, i) => {
      el.style.opacity = i === index ? '1' : '0';
      el.style.zIndex = i === index ? '2' : '1';
      el.muted = i !== index;
    });
  }

  /* ---------------------------------------------------------------- state -- */

  pause() { this.currentElement?.pause(); this.onChange(); }
  resume() {
    const el = this.currentElement;
    if (el) this.#requestPlay(el, { blocked: false, error: null });
    this.onChange();
  }

  destroy() {
    clearInterval(this.timer);
    for (const el of this.elements) {
      const mark = this.marks.get(el);
      if (mark && mark.raf) cancelAnimationFrame(mark.raf);
      if (mark && mark.handle && el.cancelVideoFrameCallback) {
        el.cancelVideoFrameCallback(mark.handle);
      }
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    }
    this.elements = [];
    this.marks.clear();
  }

  get report() {
    return {
      variant: this.variant.id,
      label: this.variant.label,
      leadMs: this.leadMs,
      rvfc: HAS_RVFC,
      start: this.start,
      unlocks: this.unlocks.slice(),
      seams: this.seams.slice(),
      finished: this.finished,
    };
  }
}

window.Chain = Chain;
window.PIECES = PIECES;
window.VARIANTS = VARIANTS;
window.HAS_RVFC = HAS_RVFC;

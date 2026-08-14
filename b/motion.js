/* ============================================================
   motion.js — Apple-style spring + gesture core
   ------------------------------------------------------------
   No dependency, no build step, no CDN. The page is served as
   flat files and must stay that way, so the spring model from
   Apple's "Designing Fluid Interfaces" is implemented here
   directly rather than pulling in Motion/Framer.

   The four things that make motion feel fluid, and where each
   one lives in this file:

     1. Springs, not durations          → class Spring
     2. Re-target from the PRESENTATION  → Spring#to()
        value, carrying velocity through
     3. Release velocity handed to the   → drag() → onEnd(v)
        animation with no seam
     4. Momentum projected forward       → project()

   Exposed as window.AM.
   ============================================================ */
(() => {
'use strict';

const TAU = Math.PI * 2;
const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* Live, not latched — the user can flip the OS setting mid-session. */
const AM = { get reduced() { return mqMotion.matches; } };

/* ============================================================
   1 · TICKER
   One rAF loop for every running spring. rAF does not run in a
   hidden document, so springs are evaluated from elapsed wall
   time rather than integrated per-frame: coming back from a
   background tab lands them on target instead of replaying the
   whole curve in one giant step.
   ============================================================ */
const running = new Set();
let rafId = 0;

function frame(now) {
  running.forEach(s => s._step(now));
  rafId = running.size ? requestAnimationFrame(frame) : 0;
}
function wake() { if (!rafId) rafId = requestAnimationFrame(frame); }

/* ============================================================
   2 · SPRING
   Apple's two designer-facing parameters, not the physics triplet:

     damping  — damping ratio. 1.0 = critically damped, no
                overshoot. Below 1 overshoots; lower is bouncier.
     response — how fast it reaches the target, in seconds.
                NOT a duration: a spring has no fixed duration,
                its settle time emerges from the parameters.

   Solved analytically rather than integrated, so the result is
   identical at 30fps and 120fps and a dropped frame cannot
   accumulate error.
   ============================================================ */
class Spring {
  constructor(opts = {}) {
    this.damping  = opts.damping  ?? 1;
    this.response = opts.response ?? 0.4;
    this.value    = opts.value    ?? 0;
    this.velocity = opts.velocity ?? 0;
    /* Rest threshold is unit-dependent: a 0–1 progress spring needs a far
       finer epsilon than one animating pixels. Callers set it. */
    this.epsilon  = opts.epsilon  ?? 0.01;
    this.onUpdate = opts.onUpdate || null;
    this.onRest   = opts.onRest   || null;
    this.target   = this.value;
    this._x0 = 0; this._v0 = 0; this._t0 = 0;
  }

  /* Re-target.

     This is the single most important method in the file. It always
     starts from `this.value` — the live, on-screen presentation value —
     and always carries `this.velocity` forward. That is what makes an
     interrupt invisible: grab a moving element and reverse it and the
     motion is continuous, because the new curve begins exactly where
     the old one was and moving exactly as fast.

     Re-targeting from the LOGICAL value instead would jump, and
     hard-cutting velocity to 0 on a reversal is the "brick wall". */
  to(target, opts = {}) {
    if (opts.damping  != null) this.damping  = opts.damping;
    if (opts.response != null) this.response = opts.response;
    if (opts.velocity != null) this.velocity = opts.velocity;

    this.target = target;
    this._x0 = this.value - target;
    this._v0 = this.velocity;
    this._t0 = performance.now();

    /* Reduced motion: no vestibular travel. Land it, still fire onUpdate
       so dependent state (aria, layout, callbacks) stays correct. */
    if (AM.reduced) return this.settle();

    if (Math.abs(this._x0) < this.epsilon && Math.abs(this._v0) < this.epsilon * 10) {
      return this.settle();
    }
    running.add(this); wake();
    return this;
  }

  /* Hard set — used while a finger is down, where the value IS the
     pointer and there is nothing to animate. Keeps velocity so the
     spring can pick it up at release. */
  set(value, velocity = 0) {
    running.delete(this);
    this.value = value;
    this.velocity = velocity;
    this.onUpdate && this.onUpdate(this.value, this);
    return this;
  }

  settle() {
    running.delete(this);
    this.value = this.target;
    this.velocity = 0;
    this.onUpdate && this.onUpdate(this.value, this);
    this.onRest && this.onRest(this.value, this);
    return this;
  }

  stop() { running.delete(this); return this; }
  get isAnimating() { return running.has(this); }

  _step(now) {
    const t = (now - this._t0) / 1000;
    const z = this.damping, wn = TAU / this.response;
    const x0 = this._x0, v0 = this._v0;
    let x, v;

    if (z < 1) {
      /* under-damped — overshoots and rings down */
      const wd  = wn * Math.sqrt(1 - z * z);
      const e   = Math.exp(-z * wn * t);
      const c1  = x0;
      const c2  = (v0 + z * wn * x0) / wd;
      const cos = Math.cos(wd * t), sin = Math.sin(wd * t);
      x = e * (c1 * cos + c2 * sin);
      v = e * (wd * (c2 * cos - c1 * sin) - z * wn * (c1 * cos + c2 * sin));
    } else {
      /* critically damped — the default; graceful, never distracting */
      const e  = Math.exp(-wn * t);
      const c1 = x0;
      const c2 = v0 + wn * x0;
      x = e * (c1 + c2 * t);
      v = e * (c2 - wn * (c1 + c2 * t));
    }

    this.value = this.target + x;
    this.velocity = v;

    if (Math.abs(x) < this.epsilon && Math.abs(v) < this.epsilon * 10) return this.settle();
    this.onUpdate && this.onUpdate(this.value, this);
  }
}

/* Apple's shipping values, named. Bounce is reserved for motion that a
   real gesture already put momentum into — overshoot on something that
   merely faded in reads as wrong. */
const SPRING = {
  ui:      { damping: 1.0, response: 0.35 },  /* default: no overshoot        */
  move:    { damping: 1.0, response: 0.40 },  /* reposition                   */
  flick:   { damping: 0.8, response: 0.40 },  /* released with momentum       */
  sheet:   { damping: 0.8, response: 0.30 },  /* drawer / sheet               */
  snap:    { damping: 0.86, response: 0.42 }, /* carousel landing             */
};

/* ============================================================
   3 · MOMENTUM PROJECTION
   Where a flick is *going*, not where the finger left off. This is
   the exponential-decay form from Apple's sample code — not the
   physics-textbook v²/2a, which decelerates differently and reads
   wrong next to native scrolling.
   ============================================================ */
function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/* ============================================================
   4 · RUBBER-BANDING
   Past a boundary, resist progressively. A hard stop reads as
   "frozen"; increasing resistance reads as "responsive, but
   there is nothing more here".
   ============================================================ */
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ============================================================
   5 · DRAG
   Pointer Events with capture, so tracking survives the pointer
   leaving the element. Reports continuously — never only at the
   end — and hands the release velocity to the caller.
   ============================================================ */
function drag(el, o = {}) {
  const axis      = o.axis || 'x';
  const threshold = o.threshold ?? 10;   /* hysteresis before committing */
  const samples   = [];                  /* short history → release velocity */
  let id = null, started = false, decided = false, sx = 0, sy = 0;

  const sample = (e) => {
    const t = e.timeStamp || performance.now();
    samples.push({ t, x: e.clientX, y: e.clientY });
    while (samples.length > 2 && t - samples[0].t > 100) samples.shift();
  };

  /* Velocity over the last ~100ms, not the last frame: a single frame
     delta is noisy enough to make an intentional flick land short. */
  const velocity = () => {
    if (samples.length < 2) return 0;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    return axis === 'x' ? (b.x - a.x) / dt : (b.y - a.y) / dt;
  };

  function down(e) {
    if (id !== null || e.button > 0) return;
    id = e.pointerId;
    sx = e.clientX; sy = e.clientY;
    started = false; decided = false;
    samples.length = 0; sample(e);
    /* Deliberately NOT capturing yet — capture here and the page can no
       longer scroll vertically through a horizontal rail. Capture is
       taken at the moment the gesture is decided to be ours. */
    o.onDown && o.onDown(e);
  }

  function move(e) {
    if (e.pointerId !== id) return;
    sample(e);
    const dx = e.clientX - sx, dy = e.clientY - sy;

    /* Both plausible gestures are watched from the first move; the loser
       is cancelled once intent is clear, rather than paying a timer. */
    if (!decided) {
      const primary = axis === 'x' ? dx : dy;
      const cross   = axis === 'x' ? dy : dx;
      if (Math.abs(primary) < threshold && Math.abs(cross) < threshold) return;
      decided = true;
      if (Math.abs(cross) > Math.abs(primary)) { id = null; return; }  /* it was a scroll */
      started = true;
      el.setPointerCapture(e.pointerId);
      o.onStart && o.onStart(e);
    }
    if (!started) return;
    e.preventDefault();
    /* Subtract the threshold so motion begins from zero rather than
       jumping the hysteresis distance the moment it commits. */
    const primary = axis === 'x' ? dx : dy;
    const sign = Math.sign(primary);
    o.onMove && o.onMove((Math.abs(primary) - threshold) * sign, e);
  }

  function up(e) {
    if (e.pointerId !== id) return;
    const was = started;
    id = null; started = false; decided = false;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (was) o.onEnd && o.onEnd(velocity(), e);
    else o.onCancel && o.onCancel(e);
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move, { passive: false });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

/* ============================================================
   6 · SCROLL LINK
   Scroll is a gesture, so anything tied to it gets continuous 1:1
   feedback rather than a fire-once animation. Each registration
   maps scroll position to a 0–1 progress and writes it wherever
   the caller wants (usually a CSS custom property, so the actual
   motion stays in the stylesheet and on the compositor).

   One shared loop, one layout read per frame, rAF-latched.
   ============================================================ */
const links = [];
let scrollTicking = false;

function scrollLink(el, apply, opts = {}) {
  const entry = { el, apply, start: opts.start ?? 'bottom', end: opts.end ?? 'top', last: -1 };
  links.push(entry);
  measure(entry);
  return entry;
}

function measure(entry) {
  const r = entry.el.getBoundingClientRect();
  entry._top = r.top + scrollY;
  entry._h = r.height;
}

function runLinks() {
  const vh = innerHeight;
  for (const L of links) {
    const top = L._top - scrollY;             /* element top, viewport-relative */
    /* enters at the bottom edge, fully resolved once it has travelled
       one viewport-and-a-bit — a range wide enough that the motion is
       legible without the element ever feeling like it is chasing you */
    const span = vh * 0.85 + L._h * 0.25;
    const p = clamp((vh - top) / span, 0, 1);
    if (Math.abs(p - L.last) < 0.001) continue;
    L.last = p;
    L.apply(p, L);
  }
  scrollTicking = false;
}

function onScrollFrame() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(runLinks);
}

addEventListener('scroll', onScrollFrame, { passive: true });
addEventListener('resize', () => { links.forEach(measure); scrollTicking = false; runLinks(); });
/* rAF is dead in a hidden document, which leaves the latch stuck and every
   linked element frozen at a stale progress. Clear it on the way back in. */
addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  scrollTicking = false;
  links.forEach(measure);
  runLinks();
});
addEventListener('load', () => { links.forEach(measure); scrollTicking = false; runLinks(); });

/* ============================================================
   7 · PRESS
   Feedback belongs on pointer-DOWN. Waiting for click feels dead.
   Most controls get this from CSS :active — instant, no JS on the
   input path. This is only for elements that need a class hook
   (a container reacting to a press on a child, say).
   ============================================================ */
function press(el, cls = 'is-pressed') {
  const on  = () => el.classList.add(cls);
  const off = () => el.classList.remove(cls);
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}

Object.assign(AM, {
  Spring, SPRING, project, rubberband, clamp, drag, scrollLink, press,
  relayout: () => { links.forEach(measure); runLinks(); },
});
window.AM = AM;
})();

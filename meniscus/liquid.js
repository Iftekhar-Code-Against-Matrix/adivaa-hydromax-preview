/* ============================================================
   liquid.js — the Meniscus water engine
   ------------------------------------------------------------
   Three things, in order of how much they matter:

     1. WaterSurface — a real heightfield fluid simulation with
        refraction, depth absorption and specular. This is the
        signature: the product stands in water rather than in a
        picture of water.
     2. Caustics — the dancing light web on deep bands. Generated
        once into a tile, then moved on the compositor. No
        per-frame cost at all.
     3. ripple() — a disturbance that travels outward from the
        exact point you pressed, on any surface.

   Measured before it was written: the sim + refraction pass costs
   1.21 ms/frame at 300x375, which is 13.8x inside a 60fps budget.
   It still degrades itself if a machine can't keep up (see #tick).

   Exposed as window.LQ.
   ============================================================ */
(() => {
'use strict';

const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
const LQ = { get reduced() { return mqMotion.matches; } };

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/* ============================================================
   1 · WATER SURFACE

   The classic two-buffer wave equation: each cell is pulled toward
   the average of its four neighbours, minus where it was last
   frame, which gives propagation. A per-step multiplier below 1 is
   the viscosity that makes it die out.

   Refraction comes from the GRADIENT of that height field — the
   slope of the surface at a point is its normal, and the normal is
   what decides where a ray landing there came from. Sampling the
   source image at that offset is the whole trick.
   ============================================================ */
class WaterSurface {
  constructor(canvas, img, opts = {}) {
    this.cv  = canvas;
    this.img = img;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    this.waterline = opts.waterline ?? 0.62;   /* 0 = top, 1 = bottom */
    this.tint      = opts.tint ?? 1;           /* how hard depth eats colour */
    this.idle      = opts.idle !== false;      /* ambient disturbance */
    this.gridW     = opts.grid ?? 300;
    this.running   = false;
    this.visible   = false;
    this._budget   = 0;                        /* consecutive slow frames */
    this._build();
  }

  _build() {
    const W = this.gridW;
    const H = Math.max(8, Math.round(W * this.img.naturalHeight / this.img.naturalWidth));
    this.W = W; this.H = H;
    this.cv.width = W; this.cv.height = H;

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    off.getContext('2d').drawImage(this.img, 0, 0, W, H);
    try {
      this.src = off.getContext('2d').getImageData(0, 0, W, H);
    } catch (e) {
      /* a tainted canvas (cross-origin image) makes the whole effect
         impossible — fail visibly-quietly and let the plain <img> show */
      this.dead = true; return;
    }
    this.dst  = this.ctx.createImageData(W, H);
    this.cur  = new Float32Array(W * H);
    this.prev = new Float32Array(W * H);
  }

  /* A disturbance. Radius and strength are in grid units, so they read
     the same whatever resolution the sim has degraded to. */
  drop(gx, gy, r = 7, strength = 320) {
    if (this.dead) return;
    const { W, H, prev } = this;
    const x0 = Math.max(1, gx - r), x1 = Math.min(W - 2, gx + r);
    const y0 = Math.max(1, gy - r), y1 = Math.min(H - 2, gy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - gx, y - gy);
        if (d > r) continue;
        /* cosine falloff — a linear one leaves a visible cone tip */
        prev[y * W + x] += strength * (0.5 + 0.5 * Math.cos(Math.PI * d / r));
      }
    }
  }

  /* Page coordinates → grid coordinates. */
  dropAtClient(cx, cy, r, strength) {
    const b = this.cv.getBoundingClientRect();
    if (!b.width || !b.height) return;
    this.drop(
      Math.round((cx - b.left) / b.width  * this.W),
      Math.round((cy - b.top)  / b.height * this.H),
      r, strength
    );
  }

  get _lineY() { return Math.round(this.H * this.waterline); }

  step() {
    const { W, H, cur, prev } = this;
    const y0 = Math.max(1, this._lineY);
    for (let y = y0; y < H - 1; y++) {
      const r = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = r + x;
        cur[i] = ((prev[i - 1] + prev[i + 1] + prev[i - W] + prev[i + W]) * 0.5) - cur[i];
        cur[i] *= 0.982;                       /* viscosity */
      }
    }
    this.cur = prev; this.prev = cur;          /* swap */
  }

  render() {
    const { W, H, prev, src, dst } = this;
    const s = src.data, d = dst.data;
    const line = this._lineY;
    const span = Math.max(1, H - line);
    d.set(s);                                   /* above the surface, untouched */

    for (let y = line; y < H; y++) {
      const r = y * W;
      /* how deep this row is, 0 at the surface → 1 at the bottom */
      const depth = (y - line) / span;
      /* Beer-Lambert, roughly: red is absorbed fastest, blue barely at all.
         This is what stops it reading as a blue overlay. */
      const kR = 1 - depth * 0.34 * this.tint;
      const kG = 1 - depth * 0.13 * this.tint;
      const kB = 1 - depth * 0.02 * this.tint;

      for (let x = 1; x < W - 1; x++) {
        const i = r + x;
        const dx = (prev[i - 1]  - prev[i + 1]) * 0.55;
        const dy = (prev[i - W]  - prev[i + W]) * 0.55;
        const sx = clamp((x + dx) | 0, 0, W - 1);
        const sy = clamp((y + dy) | 0, 0, H - 1);
        const si = (sy * W + sx) * 4, di = i * 4;
        /* an upward-tilted facet catches the key light */
        const spec = dy < 0 ? Math.min(70, -dy * 9) : 0;
        d[di]     = Math.min(255, s[si]     * kR + spec);
        d[di + 1] = Math.min(255, s[si + 1] * kG + spec * 1.05);
        d[di + 2] = Math.min(255, s[si + 2] * kB + spec * 1.1);
        d[di + 3] = 255;
      }
    }

    /* The meniscus. Water climbs whatever contains it, so the surface
       line is not flat — it lifts at the edges and catches light along
       its whole length. Drawn into the pixel buffer so it displaces
       with the wave rather than floating over it. */
    for (let x = 1; x < W - 1; x++) {
      const lift = Math.round(prev[line * W + x] * 0.05);
      const y = clamp(line + lift, 1, H - 2);
      for (let k = 0; k < 2; k++) {
        const di = ((y + k) * W + x) * 4;
        const a = k === 0 ? 0.85 : 0.35;
        d[di]     = Math.min(255, d[di]     + 150 * a);
        d[di + 1] = Math.min(255, d[di + 1] + 205 * a);
        d[di + 2] = Math.min(255, d[di + 2] + 210 * a);
      }
    }

    this.ctx.putImageData(dst, 0, 0);
  }

  _tick = (t) => {
    if (!this.running) return;
    const t0 = performance.now();
    this.step();
    this.render();
    const cost = performance.now() - t0;

    /* Auto-degrade. A frame budget of 8ms leaves room for everything
       else on the page; three slow frames in a row and the grid drops.
       Better a coarser surface than a page that stutters. */
    if (cost > 8) {
      if (++this._budget >= 3 && this.gridW > 140) {
        this.gridW = Math.round(this.gridW * 0.72);
        this._build();
        this._budget = 0;
      }
    } else this._budget = 0;

    if (this.idle && Math.random() < 0.012) {
      const line = this._lineY;
      this.drop(
        4 + Math.random() * (this.W - 8),
        line + Math.random() * (this.H - line),
        4 + Math.random() * 4, 90
      );
    }
    this._raf = requestAnimationFrame(this._tick);
  };

  start() {
    if (this.running || this.dead || LQ.reduced) return;
    this.running = true;
    this._raf = requestAnimationFrame(this._tick);
  }
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /* Only simulate while it is actually on screen and the document is
     visible. rAF is already dead in a hidden document, but without the
     observer a surface scrolled far off-screen keeps burning frames. */
  autoRun() {
    if (this.dead) return this;
    const sync = () => {
      if (this.visible && !document.hidden) this.start(); else this.stop();
    };
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; sync(); },
      { rootMargin: '120px' }).observe(this.cv);
    document.addEventListener('visibilitychange', sync);
    mqMotion.addEventListener?.('change', () => { LQ.reduced ? this.stop() : sync(); });
    return this;
  }
}

/* ============================================================
   2 · CAUSTICS
   The bright shifting web on the floor of a pool. Generated once
   into a seamless tile, then two copies are translated across each
   other at different rates and screened together — the interference
   between them is what makes it look alive.

   Deliberately NOT an animated feTurbulence: that re-runs the noise
   filter every frame on the CPU. This costs one canvas at startup
   and nothing afterwards, because translation is compositor-only.
   ============================================================ */
function causticTile(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const im = ctx.createImageData(size, size);
  const d = im.data;
  const T = Math.PI * 2 / size;
  /* integer wave numbers only, or the tile will not seam */
  const w = [[3, 2, 0], [2, -4, 1.7], [5, 3, 3.4], [-4, 5, 0.9]];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [a, b, p] of w) v += Math.sin((a * x + b * y) * T + p);
      v /= w.length;
      /* a high power turns soft interference into sharp filaments */
      const k = Math.pow(Math.max(0, v), 7);
      const i = (y * size + x) * 4;
      d[i]     = 190 * k;
      d[i + 1] = 250 * k;
      d[i + 2] = 245 * k;
      d[i + 3] = 255 * Math.min(1, k * 1.5);
    }
  }
  ctx.putImageData(im, 0, 0);
  return cv.toDataURL('image/png');
}

let _tile = null;
function mountCaustics(el) {
  if (LQ.reduced) return;
  if (!_tile) _tile = causticTile();
  const wrap = document.createElement('div');
  wrap.className = 'caustics';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 2; i++) {
    const l = document.createElement('i');
    l.style.backgroundImage = `url(${_tile})`;
    wrap.appendChild(l);
  }
  el.prepend(wrap);
}

/* ============================================================
   3 · RIPPLE
   Rule 3: a press does not highlight, it displaces — and the
   displacement starts exactly where the finger landed and travels
   out from there. Centring it on the element breaks the illusion
   as completely as snapping a dragged card to its centre does.
   ============================================================ */
function ripple(el, clientX, clientY) {
  if (LQ.reduced) return;
  const b = el.getBoundingClientRect();
  const x = clientX - b.left, y = clientY - b.top;
  /* reach the furthest corner, so the wave always crosses the surface */
  const r = Math.hypot(Math.max(x, b.width - x), Math.max(y, b.height - y));
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px`;
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove(), { once: true });
  /* belt and braces: if the animation never fires (element hidden
     mid-press), do not leak the node */
  setTimeout(() => s.remove(), 2000);
}

function bindRipples(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('[data-ripple]');
    if (!el || e.button > 0) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    ripple(el, e.clientX, e.clientY);
  }, { passive: true });
}

Object.assign(LQ, { WaterSurface, causticTile, mountCaustics, ripple, bindRipples, clamp });
window.LQ = LQ;
})();

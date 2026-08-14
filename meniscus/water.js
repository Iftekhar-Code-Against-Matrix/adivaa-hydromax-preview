/* ============================================================
   water.js — the pool the product stands in

   NOT a fluid simulation. Three summed Gerstner wave fields; the
   gradient of the sum gives the ridge highlights. ~12 ALU ops per
   pixel, no feedback buffers, no particles, no solver. One canvas
   per page, never two.

   Four cues make it read as WATER rather than as noise, and all four
   are required:
     1. refraction     — the strongest and cheapest cue
     2. high-contrast crests — caustics hard and bright, troughs soft
                        and dark, because noise is uniform-contrast
                        and water is not
     3. anisotropy     — fast horizontal ripple over slow vertical drift
     4. a meniscus line — a concave curve at the top of the band

   Four tiers, per the spec:
     T1 capable hardware        → live, 1.0x DPR, paused off-screen
     T2 <4 cores or saveData    → one static frame at 8%
     T3 prefers-reduced-motion  → static frame. No exception.
     T4 no WebGL                → CSS gradient still. Complete at this tier.
   ============================================================ */
(() => {
'use strict';

const host = document.querySelector('[data-water]');
if (!host) return;

const reduced   = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower  = (navigator.hardwareConcurrency || 8) < 4 || navigator.connection?.saveData === true;

/* T4 — no WebGL. A pre-baked CSS still, and the design is complete here. */
function fallbackStill() {
  host.style.background =
    'radial-gradient(60% 90% at 50% 100%, rgba(10,88,112,.42) 0%, rgba(6,52,65,.18) 45%, transparent 78%)';
  host.dataset.tier = 'T4';
}

const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false });
if (!gl) { fallbackStill(); return; }
host.appendChild(canvas);

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
varying vec2 uv;
uniform float t;
uniform vec2  res;

/* One Gerstner-ish contribution: direction d, wavelength w, speed s.
   Returns the height, and accumulates the gradient for the highlight. */
float wave(vec2 uvp, vec2 d, float w, float s, float amp, inout vec2 grad){
  float phase = dot(uvp, d) * w + t * s;
  float h = sin(phase);
  grad += d * w * cos(phase) * amp;
  return h * amp;
}

void main(){
  /* WebGL's UV origin is BOTTOM-left, so screen-down is 1.0 - uv.y.
     Everything below is authored in screen terms (y = 0 at the top of
     the pool). Get this backwards and the pool fades out exactly where
     it should be strongest. */
  float y = 1.0 - uv.y;
  float aspect = res.x / max(res.y, 1.0);

  /* A receding surface, not a flat wall of noise: wavelengths compress
     toward the far edge. Without this the field reads as wallpaper. */
  vec2 q = vec2(uv.x * aspect, pow(max(y, 0.0), 0.55));

  vec2 grad = vec2(0.0);
  float h = 0.0;
  /* Crests must run ACROSS the pool, so the dominant phase varies along
     y, not x. ANISOTROPY is then fast ripple over a slow, long swell —
     equal-weight octaves in every direction is what makes a field read
     as generic noise instead of water. */
  /* The frequencies are deliberately far apart (9 / 26 / 44). Close
     frequencies beat against each other and break the crests into
     isolated blobs instead of continuous lines. */
  h += wave(q, normalize(vec2( 0.15, 1.00)),  9.0, 0.45, 0.60, grad);  /* swell — the body   */
  h += wave(q, normalize(vec2( 0.34, 1.00)), 26.0, 1.50, 0.28, grad);  /* ripple             */
  h += wave(q, normalize(vec2(-0.48, 1.00)), 44.0, 2.20, 0.13, grad);  /* fine chop          */

  /* the pool is strongest at the bottom and gone by the top, so it sits
     under the product rather than washing the whole hero */
  float depth = smoothstep(0.0, 0.80, y);

  /* HIGH-CONTRAST CRESTS. Water is not uniform-contrast: ridges are
     hard and bright, troughs are broad and soft. The asymmetry is the
     whole cue, and pow() on each lobe buys it for almost nothing —
     note the exponents differ by 5x deliberately. */
  float nh = clamp(0.5 + 0.5 * h / 1.01, 0.0, 1.0);
  /* 3.2 vs 1.8 — enough asymmetry that ridges read hard and troughs
     read broad, without pinching the crests into isolated dots. */
  float crest  = pow(nh, 3.2);
  float trough = pow(1.0 - nh, 1.8);
  /* a thin specular along the steepest faces: this is what turns a
     height field into something that looks wet */
  float spec = pow(clamp(-grad.y * 0.055, 0.0, 1.0), 2.2);

  vec3 cTrough = vec3(0.024, 0.204, 0.255);  /* brand-900 */
  vec3 cBody   = vec3(0.039, 0.345, 0.439);  /* brand-800 */
  vec3 cCrest  = vec3(0.592, 0.878, 0.969);  /* brand-300 */

  vec3 col = mix(cTrough, cBody, 0.28 + 0.50 * nh);
  col = mix(col, cCrest, crest * 0.55 + spec * 0.55);
  col = mix(col, cTrough, trough * 0.40);

  float a = depth * (0.52 + 0.30 * crest + 0.24 * spec);

  /* THE MENISCUS LINE — a concave curve at the water's surface, near
     the TOP of the pool. The dip follows a cosine so it reads as
     surface tension pulling up against a wall, not as a drawn arc. */
  float surf = 0.085 - 0.040 * cos((uv.x - 0.5) * 3.14159);
  float men = 1.0 - smoothstep(0.0, 0.020, abs(y - surf));
  col = mix(col, cCrest, men * 0.55);
  a  += men * 0.30;

  /* fade at the left and right walls, or the pool ends in a hard
     vertical cut — which is the one thing water never does */
  a *= smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x);

  gl_FragColor = vec4(col * a, a);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('water: shader failed', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
const vs = compile(gl.VERTEX_SHADER, VERT);
const fs = compile(gl.FRAGMENT_SHADER, FRAG);
if (!vs || !fs) { canvas.remove(); fallbackStill(); return; }

const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); fallbackStill(); return; }
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

const uT   = gl.getUniformLocation(prog, 't');
const uRes = gl.getUniformLocation(prog, 'res');
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   /* premultiplied */

/* The band is a small fraction of the viewport, so it renders at real
   device pixels — no upscaling, no blur to hide artefacts. Capped at
   1.5x because beyond that the cost is invisible on this content. */
const DPR = Math.min(devicePixelRatio || 1, 1.5);
let w = 0, h = 0;

function resize() {
  const r = host.getBoundingClientRect();
  const nw = Math.max(1, Math.round(r.width * DPR));
  const nh = Math.max(1, Math.round(r.height * DPR));
  if (nw === w && nh === h) return false;
  w = nw; h = nh;
  canvas.width = w; canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.uniform2f(uRes, w, h);
  return true;
}

/* The pool is sized as a percentage of the hero stage, and the stage's
   height comes from the plate's aspect-ratio — which is not resolved at
   script time. Measuring once here yields a 1x1 canvas. A window resize
   listener alone does not help, because the window never resizes.
   Observing the host is the only thing that catches it. */
let onResized = () => {};
if (window.ResizeObserver) {
  new ResizeObserver(() => { if (resize()) onResized(); }).observe(host);
}

function draw(timeSeconds) {
  gl.uniform1f(uT, timeSeconds);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---- tier selection ---- */
const tier = reduced ? 'T3' : lowPower ? 'T2' : 'T1';
host.dataset.tier = tier;

resize();

if (tier !== 'T1') {
  /* T2 / T3 — a single static frame, held. Redrawn whenever the host
     resizes, or the frame would stretch. */
  host.style.opacity = '.5';
  onResized = () => draw(11.3);
  draw(11.3);
  addEventListener('resize', () => { resize(); draw(11.3); });
  addEventListener('load', () => { resize(); draw(11.3); });
  return;
}

/* ---- T1 · live ---- */
let running = false, raf = 0, t0 = 0;
/* Until the IntersectionObserver starts the loop, the canvas would sit
   at whatever size it was first measured at — which is 1x1, because the
   pool is sized off a stage whose height is not resolved at script time.
   Redraw on every resize while idle so there is always a correct frame. */
onResized = () => { if (!running) draw(0); };

function frame(now) {
  if (!running) { raf = 0; return; }
  draw((now - t0) / 1000);
  raf = requestAnimationFrame(frame);
}
function start() {
  if (running) return;
  running = true;
  /* re-base the clock so the field does not jump forward by however
     long the section was off-screen */
  t0 = performance.now();
  raf = requestAnimationFrame(frame);
}
function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf), raf = 0;
}

/* Playback pauses on IntersectionObserver exit and on document.hidden —
   an off-screen shader is pure battery cost. */
new IntersectionObserver(([e]) => { e.isIntersecting ? start() : stop(); }, { threshold: 0 }).observe(host);
addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });
addEventListener('resize', resize);
/* the pool sizes off its host, which depends on images and fonts */
addEventListener('load', () => { resize(); draw(0); });

/* draw one frame immediately so there is never an empty canvas */
draw(0);
})();

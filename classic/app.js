/* ============================================================
   HydroMax — CURRENT
   Four motion moves only: Rise, Waterline, Tick, Bubble.
   ============================================================ */
(() => {
'use strict';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = new Intl.NumberFormat('en-IN');

/* ---------- Rise ---------- */
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

/* ---------- Tick ---------- */
function tick(el, target, dur = 1400) {
  if (reduced) { el.textContent = fmt.format(target); return; }
  const from = parseInt(String(el.textContent).replace(/[^\d-]/g, ''), 10) || 0;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt.format(Math.round(from + (target - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const cio = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { tick(e.target, +e.target.dataset.count); cio.unobserve(e.target); } });
}, { threshold: 0.6 });
document.querySelectorAll('[data-count]').forEach(el => cio.observe(el));

/* ---------- meters ---------- */
const mio = new IntersectionObserver((es) => {
  es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.querySelector('i').style.width = e.target.dataset.meter + '%';
    mio.unobserve(e.target);
  });
}, { threshold: 0.4 });
document.querySelectorAll('[data-meter]').forEach(el => mio.observe(el));

/* ---------- Bubble ---------- */
if (reduced) {
  document.querySelectorAll('.bubbles').forEach(b => b.remove());
} else {
  document.querySelectorAll('[data-bubbles]').forEach(box => {
    const n = +box.dataset.bubbles;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i');
      const size = 4 + Math.random() * 16;
      b.style.width = b.style.height = size + 'px';
      b.style.left = (Math.random() * 100) + '%';
      b.style.animationDuration = (12 + Math.random() * 10) + 's';
      b.style.animationDelay = (-Math.random() * 22) + 's';
      b.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
      frag.appendChild(b);
    }
    box.appendChild(frag);
  });
}

/* ---------- marquee: clone the track for a seamless loop ----------
   The logo strip is ~49 KB of inline SVG. Shipping it twice in the HTML to make
   the 50%-translate loop work would double that for no benefit, so the markup
   carries one copy and the duplicate is made here. */
document.querySelectorAll('[data-marquee]').forEach(track => {
  track.insertAdjacentHTML('beforeend', track.innerHTML);
  track.setAttribute('aria-hidden', 'true');
});

/* ---------- buy block: quantity × care plan → live total ---------- */
(() => {
  const UNIT = 15999, MAX_QTY = 9;
  const box    = document.querySelector('[data-qty]');
  const out    = document.querySelector('[data-qty-value]');
  const totals = document.querySelectorAll('[data-total]');
  if (!box || !out || !totals.length) return;

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  let qty = 1;

  function planPrice() {
    const sel = document.querySelector('input[name="careplan"]:checked');
    return sel ? +sel.value : 0;
  }
  function render() {
    out.textContent = qty;
    // the care plan is per bottle, so it multiplies with quantity
    const total = (UNIT + planPrice()) * qty;
    totals.forEach(t => { t.textContent = inr.format(total); });
    box.querySelector('[data-step="-1"]').disabled = qty <= 1;
    box.querySelector('[data-step="1"]').disabled  = qty >= MAX_QTY;
  }
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]'); if (!btn) return;
    qty = Math.min(MAX_QTY, Math.max(1, qty + (+btn.dataset.step)));
    render();
  });
  document.querySelectorAll('input[name="careplan"]').forEach(r => r.addEventListener('change', render));
  render();
})();

/* ---------- PPB comparison bars (session 1) ---------- */
const bio = new IntersectionObserver((es) => {
  es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.style.width = e.target.dataset.bar + '%';
    bio.unobserve(e.target);
  });
}, { threshold: 0.5 });
document.querySelectorAll('[data-bar]').forEach(el => bio.observe(el));

/* ---------- safety net ----------
   IntersectionObserver does not fire while the document is hidden (background
   tab, occluded pane). Without this, such a load leaves the page blank until
   the user scrolls. */
function sweepVisible() {
  const vh = innerHeight;
  document.querySelectorAll('[data-reveal]:not(.in)').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) { el.classList.add('in'); io.unobserve(el); }
  });
  document.querySelectorAll('[data-count]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (el.textContent === '0' && r.top < vh && r.bottom > 0) { tick(el, +el.dataset.count); cio.unobserve(el); }
  });
  document.querySelectorAll('[data-meter]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.querySelector('i').style.width = el.dataset.meter + '%';
  });
  document.querySelectorAll('[data-bar]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) el.style.width = el.dataset.bar + '%';
  });
}
addEventListener('load', () => setTimeout(sweepVisible, 1200));

/* ---------- progress + active nav ---------- */
const bar = document.getElementById('progress');
const links = [...document.querySelectorAll('#navlinks a')];
const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
let ticking = false;
function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  let active = -1;
  targets.forEach((t, i) => { if (t.getBoundingClientRect().top <= 150) active = i; });
  links.forEach((a, i) => a.classList.toggle('is-active', i === active));
  sweepVisible();
  ticking = false;
}
addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
}, { passive: true });
onScroll();

/* requestAnimationFrame does not run in a hidden document, so a scroll that happens
   while the tab is backgrounded leaves `ticking` latched and the progress bar and
   active nav link stale. Clear the latch and recompute on the way back in.
   Registered here, after `ticking` and `onScroll` exist. */
addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  ticking = false;
  sweepVisible();
  onScroll();
});

/* ---------- sticky buy bar ---------- */
const buybar = document.getElementById('buybar');
const hero = document.querySelector('.hero');
if (buybar && hero) {
  new IntersectionObserver(([e]) => buybar.classList.toggle('show', !e.isIntersecting), { threshold: 0 })
    .observe(hero);
}
})();

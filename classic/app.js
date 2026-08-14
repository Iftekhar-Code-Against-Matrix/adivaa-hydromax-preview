/* ============================================================
   HydroMax — CURRENT
   Four motion moves only: Rise, Waterline, Tick, Bubble.
   ============================================================ */
(() => {
'use strict';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Rise ---------- */
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

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

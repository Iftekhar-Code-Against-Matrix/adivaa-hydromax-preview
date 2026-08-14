/* ============================================================
   HydroMax — page behaviour
   Depends on motion.js (window.AM) being loaded first.
   ============================================================ */
(() => {
'use strict';
const AM = window.AM;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Rise ----------
   One-shot on entry. An element arriving is not something anyone can
   grab mid-flight, so there is nothing here for a spring's
   interruptibility to buy — but it still uses --spring-ui in CSS, so
   it shares the curve with everything that IS interactive. */
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

/* ============================================================
   RAIL — grab it, throw it
   1:1 with the finger while it is down, momentum PROJECTED forward
   on release so a flick lands where the gesture was going, rubber-band
   at the ends, and grabbable again at any point mid-flight.
   ============================================================ */
function initRail(rail) {
  const track = rail.querySelector('[data-rail-track]');
  if (!track) return;
  const scope = rail.closest('section') || document;
  const prev  = scope.querySelector('[data-rail-prev]');
  const next  = scope.querySelector('[data-rail-next]');
  const items = [...track.children];
  if (!items.length) return;

  /* Reduced motion gets a native scroll container instead: same content,
     same reach, no engine-driven travel — and it keyboard-scrolls, which
     a transform-based rail does not. */
  if (reduced) {
    rail.classList.add('is-native');
    /* the arrows drove the spring; with a native scroller they have nothing
       to do, and two permanently-disabled buttons read as broken UI */
    const nav = scope.querySelector('.rail__nav');
    if (nav) nav.style.display = 'none';
    return;
  }

  let min = 0, snaps = [0];
  const spring = new AM.Spring({
    value: 0, epsilon: 0.05,
    onUpdate: v => { track.style.transform = `translate3d(${v}px,0,0)`; },
  });

  function measure() {
    const styles = getComputedStyle(rail);
    const inner = rail.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    min = Math.min(0, inner - track.scrollWidth);
    const base = items[0].offsetLeft;
    snaps = [...new Set(items.map(it => AM.clamp(-(it.offsetLeft - base), min, 0)))].sort((a, b) => b - a);
    updateNav();
    if (spring.value < min) spring.to(min, AM.SPRING.ui);
  }
  function nearest(to) {
    return snaps.reduce((best, s) => Math.abs(s - to) < Math.abs(best - to) ? s : best, snaps[0]);
  }
  function updateNav() {
    const atStart = spring.target >= -1, atEnd = spring.target <= min + 1;
    if (prev) prev.disabled = atStart;
    if (next) next.disabled = atEnd || min === 0;
  }
  function go(dir) {
    const v = spring.target;
    const cand = dir > 0 ? snaps.filter(s => s < v - 1) : snaps.filter(s => s > v + 1);
    if (!cand.length) return;
    spring.to(dir > 0 ? cand[0] : cand[cand.length - 1], AM.SPRING.move);
    updateNav();
  }

  let grabbed = 0;
  AM.drag(track, {
    axis: 'x',
    onStart: () => {
      /* start from the PRESENTATION value — if the rail was still gliding,
         the finger picks it up exactly where it is */
      grabbed = spring.value;
      spring.stop();
      track.classList.add('is-dragging');
    },
    onMove: (dx) => {
      let v = grabbed + dx;
      /* past an end, resist progressively instead of stopping dead */
      if (v > 0)        v = AM.rubberband(v, rail.clientWidth);
      else if (v < min) v = min - AM.rubberband(min - v, rail.clientWidth);
      spring.set(v);
    },
    onEnd: (velocity) => {
      track.classList.remove('is-dragging');
      /* land where the flick is GOING, not where the finger stopped … */
      const projected = AM.clamp(spring.value + AM.project(velocity), min, 0);
      /* … then hand the release velocity to the spring so there is no seam
         between dragging and animating */
      spring.to(nearest(projected), { ...AM.SPRING.snap, velocity });
      updateNav();
    },
    onCancel: () => track.classList.remove('is-dragging'),
  });

  prev && prev.addEventListener('click', () => go(-1));
  next && next.addEventListener('click', () => go(1));

  /* Tabbing into an item that is off-screen must bring it into view, or
     keyboard users lose the focus ring behind the overflow clip. */
  track.addEventListener('focusin', (e) => {
    const item = items.find(it => it.contains(e.target));
    if (!item) return;
    const to = AM.clamp(-(item.offsetLeft - items[0].offsetLeft), min, 0);
    if (Math.abs(to - spring.target) > 1) { spring.to(to, AM.SPRING.move); updateNav(); }
  });

  measure();
  /* Item widths come from clamp()/vw, and item HEIGHTS settle only once the
     images and webfonts have laid out — so a single measure at init is wrong
     more often than it is right. A window resize listener alone misses the
     late-layout case entirely; observing the track catches both, and also
     covers a pane or container resizing without the window doing so. */
  if (window.ResizeObserver) {
    let first = true;
    new ResizeObserver(() => { if (first) { first = false; return; } measure(); }).observe(track);
  }
  addEventListener('resize', measure);
  addEventListener('load', measure);
}
document.querySelectorAll('[data-rail]').forEach(initRail);

/* ============================================================
   ACCORDION — spring height, interruptible
   Grab a panel mid-open and it reverses from where it actually is,
   carrying its velocity, instead of finishing and then reversing.

   Critically damped (SPRING.ui), NOT the sheet spring — a click puts no
   momentum into the panel, and overshoot on something that merely
   appeared reads as wrong. Bounce is earned by a gesture, not spent by
   default. If this ever becomes drag-to-open, SPRING.sheet is correct.
   ============================================================ */
document.querySelectorAll('.acc__item').forEach(item => {
  const summary = item.querySelector('summary');
  const panel = item.querySelector('.acc__panel');
  if (!summary || !panel) return;

  const spring = new AM.Spring({
    value: 0, epsilon: 0.5,
    onUpdate: h => { panel.style.height = h + 'px'; },
    onRest: h => {
      if (h <= 0) { item.open = false; panel.style.height = '0px'; }
      /* release to auto once settled so the panel reflows on resize
         and on a font-size change */
      else panel.style.height = 'auto';
    },
  });

  if (item.open) { spring.value = 1; spring.target = 1; panel.style.height = 'auto'; }
  else panel.style.height = '0px';

  function openHeight() {
    const prev = panel.style.height;
    panel.style.height = 'auto';
    const h = panel.scrollHeight;
    panel.style.height = prev;
    return h;
  }

  summary.addEventListener('click', (e) => {
    e.preventDefault();
    const opening = !(item.open && spring.target !== 0);
    if (opening) {
      item.open = true;                 /* must be open for scrollHeight to be real */
      panel.style.height = spring.value + 'px';
      spring.to(openHeight(), AM.SPRING.ui);
    } else {
      /* pin the live height before animating away from 'auto' */
      panel.style.height = (spring.value || openHeight()) + 'px';
      if (!spring.isAnimating) spring.value = openHeight();
      spring.to(0, AM.SPRING.ui);
    }
  });
});

/* ---------- buy block: quantity × care plan → live order summary ---------- */
(() => {
  const UNIT = 15999, MAX_QTY = 9;
  const box    = document.querySelector('[data-qty]');
  const out    = document.querySelector('[data-qty-value]');
  const totals = document.querySelectorAll('[data-total]');
  if (!box || !out || !totals.length) return;

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const sumQty  = document.querySelector('[data-sum-qty]');
  const sumUnit = document.querySelector('[data-sum-unit]');
  const planRow = document.querySelector('[data-sum-plan-row]');
  const planQty = document.querySelector('[data-sum-plan-qty]');
  const planAmt = document.querySelector('[data-sum-plan]');
  let qty = 1;

  function planPrice() {
    const sel = document.querySelector('input[name="careplan"]:checked');
    return sel ? +sel.value : 0;
  }
  function render() {
    out.textContent = qty;
    const plan = planPrice();
    // the care plan is per bottle, so it multiplies with quantity
    const total = (UNIT + plan) * qty;

    if (sumQty)  sumQty.textContent  = qty;
    if (sumUnit) sumUnit.textContent = inr.format(UNIT * qty);
    if (planRow) {
      planRow.hidden = plan === 0;
      if (planQty) planQty.textContent = qty;
      if (planAmt) planAmt.textContent = inr.format(plan * qty);
    }
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

/* ---------- scroll-linked chrome ---------- */
const nav = document.getElementById('nav');
const plate = document.querySelector('[data-hero-plate]');
/* The product lags the page slightly as you scroll past it — continuous and
   1:1 with the scroll gesture, not a canned animation played at you. */
if (plate && !reduced) {
  AM.scrollLink(plate, p => plate.style.setProperty('--hp', p.toFixed(4)));
}

/* ---------- progress + active nav ---------- */
const bar = document.getElementById('progress');
const links = [...document.querySelectorAll('#navlinks a')];
const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
let ticking = false;
function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  /* the nav has nothing to separate from at the top of the page, so its
     material only thickens once content is actually sliding under it */
  if (nav) nav.style.setProperty('--nav-p', Math.min(scrollY / 120, 1).toFixed(3));
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

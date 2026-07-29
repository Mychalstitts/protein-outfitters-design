/* ============================================================
   PO Shell — injects footer + reserve sheet markup
   plus runtime behavior for the 3-step reserve flow.
   The nav stays inline in each page for instant render.
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     CUMULATIVE PRICE MODEL (Trello: customer sees ONE all-in $/lb)
     - Farmer's listing rate ($/lb hanging weight) + processing
       (cut/wrap/vac-pack/kill-fee) + condemnation insurance pool +
       platform fee — all rolled into one number the buyer sees.
     - Processor sets their per-lb processing rate in their profile.
     - We use industry-default fallbacks until a specific processor
       is selected at checkout.
     ============================================================ */
  window.PO_PRICING = {
    // Industry defaults — overridden when a specific processor is chosen
    processingPerLbHW: 1.25,   // cut, wrap, vac-pack (hanging weight)
    killFeeFlat: 100,           // per animal (split across share)
    insurancePerLbHW: 0.05,    // condemnation insurance pool
    platformPerLbHW: 0.25,     // PO platform fee
    cutsYield: 0.72,            // typical hanging-to-cuts yield for beef

    /** Compute cumulative all-in $/lb (hanging weight basis) the buyer sees */
    allInPerLbHW(farmerPerLb, shareKey = 'quarter', hangingWeight = 700, processorPerLb = null) {
      const shareFraction = shareKey === 'whole' ? 1 : shareKey === 'half' ? 0.5 : shareKey === 'quarter' ? 0.25 : 0.125;
      const shareLbsHW = hangingWeight * shareFraction;
      if (shareLbsHW === 0) return 0;
      const proc = (processorPerLb != null ? processorPerLb : this.processingPerLbHW);
      const farmer = (farmerPerLb || 0);
      const killShare = this.killFeeFlat / hangingWeight; // per-lb HW
      return farmer + proc + this.insurancePerLbHW + this.platformPerLbHW + killShare;
    },

    /** Convert hanging-weight $/lb to finished-cuts $/lb for display */
    perLbCuts(perLbHW) { return perLbHW / this.cutsYield; },

    /** Full breakdown for "What's included" tooltip */
    breakdown(farmerPerLb, shareKey = 'quarter', hangingWeight = 700, processorPerLb = null) {
      const shareFraction = shareKey === 'whole' ? 1 : shareKey === 'half' ? 0.5 : shareKey === 'quarter' ? 0.25 : 0.125;
      const lbs = hangingWeight * shareFraction;
      const cutsLbs = lbs * this.cutsYield;
      const proc = (processorPerLb != null ? processorPerLb : this.processingPerLbHW);
      return {
        shareLbsHW: lbs,
        shareLbsCuts: cutsLbs,
        farmer: { perLb: farmerPerLb || 0, total: (farmerPerLb || 0) * lbs },
        processing: { perLb: proc, total: proc * lbs },
        killFee: { flat: this.killFeeFlat, share: this.killFeeFlat * shareFraction },
        insurance: { perLb: this.insurancePerLbHW, total: this.insurancePerLbHW * lbs },
        platform: { perLb: this.platformPerLbHW, total: this.platformPerLbHW * lbs },
        get totalDollars() { return this.farmer.total + this.processing.total + this.killFee.share + this.insurance.total + this.platform.total; },
        get allInPerLbHW() { return this.totalDollars / lbs; },
        get allInPerLbCuts() { return this.totalDollars / cutsLbs; }
      };
    }
  };

  /** Format a $/lb as "$X.XX/lb" */
  window.PO_PRICING.fmtPerLb = (n) => '$' + Number(n || 0).toFixed(2) + '/lb';
  window.PO_PRICING.fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const FOOTER_HTML = `
<footer class="po-foot">
  <div class="po-foot-inner">
    <div>
      <div class="po-foot-mark"><img src="/brand/logo-monogram.svg" alt=""><span>Protein Outfitters</span></div>
      <p class="po-foot-meta">A whole animal, in three taps.<br>By Stittsworth Meats · Bemidji, MN.</p>
    </div>
    <div><h4>Marketplace</h4><ul><li><a href="/discover">Discover</a></li><li><a href="/producers">Producers</a></li><li><a href="/map">Farm map</a></li><li><a href="/hardware">Hardware</a></li></ul></div>
    <div><h4>For partners</h4><ul><li><a href="/farmer">Producer dashboard</a></li><li><a href="/processor">Plant dashboard</a></li><li><a href="/processor-saas">Plant plans</a></li><li><a href="/donation-flow">Donation Depot</a></li></ul></div>
    <div><h4>Help &amp; policy</h4><ul><li><a href="/faq">FAQ</a></li><li><a href="/policies/refunds">Refund policy</a></li><li><a href="mailto:hello@proteinoutfitters.com">hello@proteinoutfitters.com</a></li><li><a href="mailto:depot@proteinoutfitters.com">depot@proteinoutfitters.com</a></li></ul></div>
    <div><h4>Company</h4><ul><li><a href="/account">Account</a></li><li><a href="/brand">Brand</a></li></ul></div>
  </div>
  <div class="po-foot-bottom"><span>© 2026 Protein Outfitters. All rights reserved.</span><span>Built in Bemidji, MN.</span></div>
</footer>`;

  const SHEET_HTML = `
<div class="sheet-backdrop" id="sheetBackdrop"></div>
<aside class="sheet" id="sheet" aria-hidden="true" aria-label="Reserve">
  <div class="sheet-grip" aria-hidden="true"></div>
  <header class="sheet-head">
    <div class="sheet-progress" aria-hidden="true"><span class="dot active" data-dot="1"></span><span class="dot" data-dot="2"></span></div>
    <button class="sheet-close" id="sheetClose" aria-label="Close">✕</button>
  </header>
  <div class="sheet-body">
    <div class="sheet-context"><div class="sheet-context-img" id="sheetContextImg"></div><div class="sheet-context-text"><p class="sheet-context-name" id="sheetContextName">Pick an animal to start</p><p class="sheet-context-sub" id="sheetContextSub">Or browse below.</p></div></div>
    <section class="sheet-step" data-step="1"><h3 class="sheet-q">Pick your share.</h3><div class="options" id="shareOptions"></div></section>
    <section class="sheet-step" data-step="2" hidden><h3 class="sheet-q">Reserve it.</h3>
      <p style="font-size:13px;color:var(--ink-2);margin:0 0 14px;line-height:1.5;">Pay your deposit + fees today. Meat is settled at pickup based on actual hanging weight.</p>
      <div class="summary"><div class="summary-row"><span id="sumShareLabel">Deposit</span><span class="v" id="sumShareVal">$0</span></div><div class="summary-row"><span>Processing fee</span><span class="v">$225.00</span></div><div class="summary-row"><span>Insurance pool</span><span class="v">$18.00</span></div><div class="summary-row total"><span>Reserve today</span><span class="v" id="sumTotalVal">$0</span></div><div class="summary-row" style="opacity:.7;font-size:12px;border-top:1px dashed rgba(6,27,14,.15);padding-top:10px;margin-top:6px;"><span id="sumPickupLabel">Estimated at pickup</span><span class="v" id="sumPickupVal">—</span></div></div>
      <div class="pay-stack"><button class="btn-pay btn-pay--apple" id="payApple"> Pay deposit</button><button class="btn-pay btn-pay--card" id="payCard">Reserve with card →</button></div>
      <p style="font-size:12px;color:var(--ink-3);text-align:center;margin:14px 0 0;line-height:1.5;">Free cancellation up to 21 days before harvest. Next, you'll build your cut sheet.</p>
    </section>
    <section class="sheet-step" data-step="3" hidden><div class="confirm"><div class="confirm-mark">✓</div><h3 id="confirmTitle">Reserved.</h3><p id="confirmBody">We just sent your reservation details and your cut sheet builder.</p></div></section>
  </div>
  <footer class="sheet-foot"><button class="sheet-back" id="sheetBack" disabled>← Back</button><button class="sheet-next" id="sheetNext" disabled>Continue →</button></footer>
</aside>`;

  // ── Referral capture ───────────────────────────────────────────
  // If the URL has ?ref=CODE, stash it in localStorage and call /api/referrals
  // to validate. We attach the code to checkout/signup later — best-effort.
  (function captureReferralCode() {
    try {
      const params = new URLSearchParams(location.search);
      const ref = (params.get('ref') || '').toUpperCase().trim();
      if (!ref || !/^[A-Z2-9]{6}$/.test(ref)) return;
      // Don't overwrite a previously captured one
      if (!localStorage.getItem('po_ref_code')) {
        localStorage.setItem('po_ref_code', ref);
        localStorage.setItem('po_ref_captured_at', String(Date.now()));
        // Validate quietly. If valid, leave the ref in storage; if not, drop it.
        fetch('/api/referrals?code=' + encodeURIComponent(ref))
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data || !data.valid) {
              localStorage.removeItem('po_ref_code');
              localStorage.removeItem('po_ref_captured_at');
            } else {
              localStorage.setItem('po_ref_owner_name', data.owner_name || '');
            }
          })
          .catch(() => { /* ignore */ });
      }
    } catch (e) { /* localStorage may be blocked */ }
  })();

  // ── Global mobile-fit + persistent home anchor ──────────────
  // Two recurring UX problems we patch globally so we don't have to fix
  // them per-page: (1) buttons overflowing the viewport on phones, and
  // (2) pages that don't have a clickable wordmark in the nav, leaving
  // the user stranded. Injects a CSS layer + a fallback floating anchor.
  function injectGlobalShell() {
    if (document.getElementById('po-shell-global')) return;
    const s = document.createElement('style');
    s.id = 'po-shell-global';
    s.textContent = `
      /* Persistent home anchor — fixed top-left pill, always visible */
      .po-home-anchor {
        position: fixed; top: 12px; left: 12px; z-index: 9999;
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px 8px 10px; border-radius: 999px;
        background: rgba(6,27,14,.92); color: #fbf9f5;
        text-decoration: none; font: 800 11.5px/1 'Inter', system-ui, sans-serif;
        letter-spacing: .04em; text-transform: uppercase;
        box-shadow: 0 6px 20px rgba(6,27,14,.25);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        transition: transform .15s, opacity .15s;
        max-width: calc(100vw - 24px);
      }
      .po-home-anchor:hover { transform: translateY(-1px); }
      .po-home-anchor:active { transform: translateY(0); }
      .po-home-anchor .po-ha-arrow { font-size: 14px; line-height: 1; opacity: .8; }
      .po-home-anchor .po-ha-text { white-space: nowrap; }
      @media (max-width: 480px) {
        .po-home-anchor { font-size: 10.5px; padding: 7px 12px 7px 8px; }
      }
      /* Mobile: surgical fixes only.
         The earlier aggressive pass (body * { max-width: 100% }, universal
         button font-clamp, h1/h2/h3 !important overrides) broke more than
         it fixed — it collapsed flex children, fought page-specific brand
         typography, and wrecked layouts that were working. Reverted to the
         minimal, well-understood fixes and nothing else. Anything beyond
         this gets fixed per-page with a real screenshot in hand. */
      @media (max-width: 640px) {
        /* Stop the page from scrolling sideways when an isolated child
           overflows. This is the single most useful global mobile rule
           and doesn't break interior flex/grid math. */
        html, body { overflow-x: hidden; -webkit-text-size-adjust: 100%; }

        /* Existing site-nav fix: hide the 4-link middle tray on phones —
           wordmark + sign-in fit; full nav is reachable via the footer. */
        .po-nav-links { display: none !important; }
        .po-nav { padding: 10px 14px; gap: 8px; }
        .po-mark { font-size: 13px; min-width: 0; }
        .po-mark img { width: 22px; height: 22px; flex-shrink: 0; }
        .po-nav-actions { margin-left: auto; }

        /* iOS Safari auto-zooms inputs <16px on focus, which makes the
           layout jump and feels broken. 16px stops that. */
        input[type="text"], input[type="email"], input[type="tel"],
        input[type="number"], input[type="search"], select, textarea {
          font-size: 16px;
        }

        /* The reserve sheet's pay stack used to clip on phones. */
        .pay-stack { flex-direction: column; align-items: stretch; }
        .pay-stack .btn-pay { width: 100%; }
      }
    `;
    document.head.appendChild(s);

    // Inject the home anchor ONLY when the page has no nav of its own.
    // Reported bug 2026-05-07: on /list-animal (and most other pages) the
    // floating pill stacks on top of the page's own wordmark — duplicate
    // brand mark + intercepted taps in the top-left. Auto-detect any nav
    // element instead of requiring per-page opt-out via data-po-home="off".
    const path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/' || path === '/index' || path === '/index.html') return;
    if (document.body.getAttribute('data-po-home') === 'off') return;
    const hasNav = !!document.querySelector('header, nav, .po-nav, .glass-nav, .topnav, .fm-nav, .ds-nav, .ac-nav');
    if (hasNav) return;
    const a = document.createElement('a');
    a.href = '/';
    a.className = 'po-home-anchor';
    a.setAttribute('aria-label', 'Protein Outfitters — home');
    a.innerHTML = '<span class="po-ha-arrow">←</span><span class="po-ha-text">Protein Outfitters</span>';
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectGlobalShell);
  } else {
    injectGlobalShell();
  }

  // Hide internal prototype chrome (page-tabs, role-bar) unless ?dev=1
  function hidePrototypeChrome() {
    if (new URLSearchParams(location.search).has('dev')) return;
    document.querySelectorAll('.page-tabs, .role-bar').forEach(el => { el.style.display = 'none'; });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hidePrototypeChrome);
  } else {
    hidePrototypeChrome();
  }

  let _reserveWired = false;

  // Inject footer + sheet into body (skip if the page already has its own)
  function inject() {
    const host = document.getElementById('po-shell-host');
    const hasFooter = !!document.querySelector('footer.po-foot');
    const hasSheet = !!document.getElementById('sheet');
    if (host) {
      if (!hasFooter) host.insertAdjacentHTML('beforebegin', FOOTER_HTML);
      if (!hasSheet) host.insertAdjacentHTML('afterend', SHEET_HTML);
    } else {
      const parts = [];
      if (!hasFooter) parts.push(FOOTER_HTML);
      if (!hasSheet) parts.push(SHEET_HTML);
      if (parts.length) document.body.insertAdjacentHTML('beforeend', parts.join(''));
    }
    wire();
  }

  function wire() {
    const sheet = document.getElementById('sheet');
    const backdrop = document.getElementById('sheetBackdrop');
    const closeBtn = document.getElementById('sheetClose');
    const backBtn = document.getElementById('sheetBack');
    const nextBtn = document.getElementById('sheetNext');
    if (!sheet || _reserveWired) return;
    _reserveWired = true;
    const dots = sheet.querySelectorAll('.dot');
    const steps = sheet.querySelectorAll('.sheet-step');
    const ctxImg = document.getElementById('sheetContextImg');
    const ctxName = document.getElementById('sheetContextName');
    const ctxSub = document.getElementById('sheetContextSub');
    const shareWrap = document.getElementById('shareOptions');
    const sumShareLabel = document.getElementById('sumShareLabel');
    const sumShareVal = document.getElementById('sumShareVal');
    const sumTotalVal = document.getElementById('sumTotalVal');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmBody = document.getElementById('confirmBody');

    let state = { step: 1, animal: null, share: null, processor: null };
    function fmt(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    function buildShareOptions(preselectKey) {
      const a = state.animal; if (!a) return;
      const opts = [
        { key: 'q', glyph: '¼', title: 'Quarter share', sub: '~110 lb of cuts · fits a 7 cu ft freezer', price: a.priceQ },
        { key: 'h', glyph: '½', title: 'Half share', sub: '~220 lb of cuts · fits a 14 cu ft freezer', price: a.priceH },
        { key: 'w', glyph: '1', title: 'Whole animal', sub: '~440 lb of cuts · for serious operators', price: a.priceW }
      ].filter(o => o.price > 0);
      // Prices are all-in $/lb hanging weight — label so they never look like a lump total.
      shareWrap.innerHTML = opts.map(o => `<button class="option" data-share="${o.key}" data-price="${o.price}"><span class="option-glyph">${o.glyph}</span><span class="option-text"><span class="option-title">${o.title}</span><span class="option-sub">${o.sub}</span></span><span class="option-price">${fmt(o.price)}<small style="display:block;font-size:10px;font-weight:600;opacity:.65;margin-top:2px">/lb all-in</small></span></button>`).join('');
      shareWrap.querySelectorAll('.option').forEach(btn => btn.addEventListener('click', () => {
        shareWrap.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.share = { key: btn.dataset.share, price: Number(btn.dataset.price) };
        nextBtn.disabled = false;
      }));
      // Preselect share when opening from a listing share card or deep-link return.
      if (preselectKey) {
        const key = preselectKey === 'quarter' ? 'q' : preselectKey === 'half' ? 'h' : preselectKey === 'whole' ? 'w' : preselectKey;
        const match = shareWrap.querySelector(`.option[data-share="${key}"]`);
        if (match) match.click();
      }
    }

    // Step 2 processor list — populated dynamically from /api/processors.
    // Cached in module scope so reopening the sheet doesn't refetch.
    let _processorsCache = null;
    async function loadProcessors() {
      if (_processorsCache) return _processorsCache;
      try {
        const r = await fetch('/api/processors');
        const data = await r.json().catch(() => ({}));
        _processorsCache = Array.isArray(data.processors) ? data.processors
                          : Array.isArray(data) ? data : [];
      } catch { _processorsCache = []; }
      return _processorsCache;
    }
    async function renderProcessorOptions() {
      const wrap = document.getElementById('processorOptions');
      if (!wrap) return;
      const list = await loadProcessors();
      if (!list.length) {
        wrap.innerHTML = '<div style="padding:14px;font:500 13px/1.4 var(--ff-sans);opacity:.7;">No processors available yet. Continue and we\'ll assign one for you.</div>';
        // Allow proceeding without a processor — server treats null as "TBD".
        state.processor = null;
        nextBtn.disabled = false;
        return;
      }
      wrap.innerHTML = list.slice(0, 8).map(p => {
        const loc = [p.city, p.state].filter(Boolean).join(', ');
        const glyph = (p.slug || p.name || '?').toString().slice(0, 2).toUpperCase();
        const title = (p.name || 'Processor').replace(/</g,'&lt;');
        const sub = loc ? `${loc}` : (p.slug || 'Pickup details at scheduling');
        return `<button class="option" data-processor="${p.id}" data-processor-slug="${(p.slug||'').replace(/"/g,'&quot;')}"><span class="option-glyph">${glyph}</span><span class="option-text"><span class="option-title">${title}</span><span class="option-sub">${sub}</span></span><span class="option-price">Free</span></button>`;
      }).join('');
      wrap.querySelectorAll('.option').forEach(btn => btn.addEventListener('click', () => {
        wrap.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // data-processor is now a real UUID, not a demo slug.
        state.processor = btn.dataset.processor;
        nextBtn.disabled = false;
      }));
    }

    function setStep(n) {
      state.step = n;
      steps.forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
      dots.forEach((d, i) => { d.classList.toggle('active', i === n - 1); d.classList.toggle('done', i < n - 1); });
      backBtn.disabled = n === 1 || n === 3;
      if (n === 3) { nextBtn.style.visibility = 'hidden'; backBtn.style.visibility = 'hidden'; }
      else {
        nextBtn.style.visibility = 'visible'; backBtn.style.visibility = 'visible';
        if (n === 1) { nextBtn.disabled = !state.share; nextBtn.textContent = 'Continue →'; }
        if (n === 2) { nextBtn.disabled = false; nextBtn.textContent = 'Reserve →'; }
      }
      if (n === 2 && state.share) {
        // Reservation deposit model: deposit is a flat 10% of estimated meat cost (capped 50–500),
        // plus processing fee + insurance. Meat balance is settled at pickup on actual hanging weight.
        // share.price is all-in $/lb HW; cuts-lb estimate used for take-home framing.
        const lbsBySize = { q: 110, h: 220, w: 440 };
        const lbs = lbsBySize[state.share.key] || 110;
        const meatEstimate = state.share.price * lbs;       // all-in $/lb × estimated cuts lb
        const deposit = Math.min(500, Math.max(50, Math.round(meatEstimate * 0.10)));
        const fees = 225 + 18;
        const reserveToday = deposit + fees;
        const shareLabel = state.share.key === 'q' ? 'Quarter' : state.share.key === 'h' ? 'Half' : 'Whole';
        sumShareLabel.textContent = `Deposit (${shareLabel} · 10% of est. meat)`;
        sumShareVal.textContent = fmt(deposit);
        sumTotalVal.textContent = fmt(reserveToday);
        const pickupEl = document.getElementById('sumPickupVal');
        const pickupLabel = document.getElementById('sumPickupLabel');
        if (pickupEl) pickupEl.textContent = `~${fmt(meatEstimate - deposit)}`;
        if (pickupLabel) pickupLabel.textContent = `Balance at pickup (~${lbs} lb cuts @ ${fmt(state.share.price)}/lb all-in, less deposit)`;
      }
    }

    function animalFromEl(el) {
      if (!el) return null;
      return {
        id: el.dataset.animal,
        name: el.dataset.name,
        producer: el.dataset.producer,
        photo: el.dataset.photo,
        priceQ: Number(el.dataset.priceQ || 0),
        priceH: Number(el.dataset.priceH || 0),
        priceW: Number(el.dataset.priceW || 0),
        share: el.dataset.share || null
      };
    }

    function open(a, opts = {}) {
      if (!a || !a.id) return;
      state.animal = a;
      if (ctxImg) ctxImg.style.backgroundImage = `url('${a.photo}')`;
      if (ctxName) ctxName.textContent = a.name;
      if (ctxSub) ctxSub.textContent = a.producer;
      state.share = null; state.processor = null;
      shareWrap?.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
      const preselect = opts.share || a.share || null;
      buildShareOptions(preselect);
      // Processor is no longer chosen by the buyer — the farmer assigns it once
      // the animal is fully sold. Reservations are created with processor=null.
      setStep(1);
      backdrop?.classList.add('open');
      sheet.classList.add('open');
      sheet.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      backdrop?.classList.remove('open');
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    // Event delegation — homepage listings and other async UI inject
    // [data-open-sheet] controls after po-shell.js runs. Per-element wiring
    // misses those; a single document listener catches every current + future CTA.
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-open-sheet]');
      if (!c || c.disabled) return;
      if (c.dataset.animal) {
        e.preventDefault();
        open(animalFromEl(c), { share: c.dataset.share || null });
        return;
      }
      const f = document.querySelector('[data-animal]');
      if (f) {
        e.preventDefault();
        open(animalFromEl(f), { share: c.dataset.share || f.dataset.share || null });
        return;
      }
      e.preventDefault();
      window.location.href = '/discover';
    });

    window.PO_SHELL = { open, close };

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('open')) close(); });
    backBtn?.addEventListener('click', () => { if (state.step > 1) setStep(state.step - 1); });
    nextBtn.addEventListener('click', async () => {
      if (state.step === 1) { setStep(2); return; }
      if (state.step === 2) {
        // Submit reservation to /api/reservations
        nextBtn.disabled = true;
        const origText = nextBtn.textContent;
        nextBtn.textContent = 'Reserving…';

        const shareKeyMap = { q: 'quarter', h: 'half', w: 'whole' };
        const share_size = shareKeyMap[state.share?.key] || 'half';

        // Get email — from current user or prompt
        let email = null, name = null;
        try {
          if (window.PO_API) {
            const me = await window.PO_API.me();
            if (me.user) { email = me.user.email; name = me.user.name; }
          }
        } catch {}

        if (!email) {
          // Customer-by-default: trigger the proper signin modal with role='buyer'
          // instead of a plain prompt, so the magic-link / Apple-Pay flow runs.
          // Deep-link back into this listing + open the sheet with the chosen share.
          if (window.PO_API && typeof window.PO_API.openAuth === 'function') {
            nextBtn.disabled = false; nextBtn.textContent = origText;
            const listingId = state.animal?.id;
            const shareKey = state.share?.key || '';
            const shareParam = shareKey === 'q' ? 'quarter' : shareKey === 'h' ? 'half' : shareKey === 'w' ? 'whole' : shareKey;
            let returnNext = null;
            if (listingId) {
              returnNext = `/listing?id=${encodeURIComponent(listingId)}&open_sheet=1` +
                (shareParam ? `&share=${encodeURIComponent(shareParam)}` : '');
              try {
                sessionStorage.setItem('po_pending_reserve', JSON.stringify({
                  id: listingId,
                  name: state.animal.name,
                  producer: state.animal.producer,
                  photo: state.animal.photo,
                  priceQ: state.animal.priceQ,
                  priceH: state.animal.priceH,
                  priceW: state.animal.priceW,
                  share: shareParam || shareKey
                }));
              } catch (_) { /* private mode */ }
            }
            window.PO_API.openAuth('Sign in to reserve your share', 'buyer', { next: returnNext });
            return;
          }
          // Fallback only if the API helper isn't loaded.
          email = prompt('Enter your email so we can confirm your reservation:');
          if (!email || !email.includes('@')) {
            nextBtn.disabled = false; nextBtn.textContent = origText;
            return;
          }
        }

        try {
          // Send to /api/checkout — creates pending reservation + Stripe Checkout Session
          const r = await fetch('/api/checkout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listing_id: state.animal.id,
              share_size,
              buyer_email: email,
              buyer_name: name,
              // state.processor is now a real UUID (or null if the producer
              // didn't pick one / no processors are configured yet).
              processor_id: state.processor || null,
              notes: null
            })
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok || !data.url) {
            nextBtn.disabled = false; nextBtn.textContent = origText;
            alert('Could not start checkout: ' + (data.error || ('HTTP ' + r.status)));
            return;
          }
          // Hand off to Stripe-hosted checkout
          window.location.href = data.url;
        } catch (e) {
          nextBtn.disabled = false; nextBtn.textContent = origText;
          alert('Network error: ' + e.message);
        }
      }
    });
    const payApple = document.getElementById('payApple');
    const payCard = document.getElementById('payCard');
    payApple?.addEventListener('click', () => nextBtn?.click());
    payCard?.addEventListener('click', () => nextBtn?.click());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

/* ============================================================
   PO Concierge — AI chat widget, site-wide
   Powered by Gemini via /api/concierge. Falls back to a stub.
   ============================================================ */
(function () {
  'use strict';

  const STORAGE = 'po_concierge_thread';
  const HTML = `
<button class="po-concierge-fab" id="poFab" aria-label="Open concierge chat">
  <svg fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-linejoin="round" stroke-linecap="round"/></svg>
  <span class="po-concierge-fab-label">Ask AI</span>
</button>
<aside class="po-concierge-panel" id="poConciergePanel" aria-hidden="true">
  <header class="poc-head">
    <div class="poc-head-l">
      <div class="poc-avatar">
        <img src="/brand/logo-monogram.svg" alt="" width="36" height="36" style="display:block;border-radius:9px"/>
      </div>
      <div>
        <div class="poc-title">Concierge</div>
        <div class="poc-sub">Ask about cuts, farms, pickup</div>
      </div>
    </div>
    <button class="poc-close" id="poCloseChat" aria-label="Close">✕</button>
  </header>
  <div class="poc-msgs" id="pocMsgs">
    <div class="poc-msg poc-msg-bot">
      <div class="poc-bubble">
        Hey — I'm the Protein Outfitters concierge. Ask me anything about livestock listings, certifications, cut sheets, or pickup logistics. <br><br>
        Some starters: <em>"How much freezer space do I need for a half cow?"</em> · <em>"What's the difference between grass-fed and grass-finished?"</em> · <em>"Find me veteran-owned beef under $8/lb"</em>
      </div>
    </div>
  </div>
  <form class="poc-form" id="pocForm">
    <input id="pocInput" class="poc-input" placeholder="Ask anything…" autocomplete="off"/>
    <button type="submit" class="poc-send" aria-label="Send">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke-linejoin="round" stroke-linecap="round"/></svg>
    </button>
  </form>
</aside>`;

  function injectConcierge() {
    if (document.getElementById('poFab')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    [...wrap.children].forEach(n => document.body.appendChild(n));

    const fab = document.getElementById('poFab');
    const panel = document.getElementById('poConciergePanel');
    const close = document.getElementById('poCloseChat');
    const form = document.getElementById('pocForm');
    const input = document.getElementById('pocInput');
    const msgs = document.getElementById('pocMsgs');

    let history = [];
    try { history = JSON.parse(sessionStorage.getItem(STORAGE) || '[]'); } catch {}
    history.forEach(m => addMsg(m.role, m.content, /*save*/false));

    fab.addEventListener('click', () => panel.classList.toggle('open'));
    close.addEventListener('click', () => panel.classList.remove('open'));

    function addMsg(role, content, save = true) {
      const el = document.createElement('div');
      el.className = 'poc-msg ' + (role === 'user' ? 'poc-msg-user' : 'poc-msg-bot');
      el.innerHTML = '<div class="poc-bubble"></div>';
      el.querySelector('.poc-bubble').textContent = content;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      if (save) {
        history.push({ role, content });
        try { sessionStorage.setItem(STORAGE, JSON.stringify(history)); } catch {}
      }
      return el;
    }

    function addTyping() {
      const el = document.createElement('div');
      el.className = 'poc-msg poc-msg-bot poc-typing';
      el.innerHTML = '<div class="poc-bubble"><span class="poc-dots"><span></span><span></span><span></span></span></div>';
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      return el;
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addMsg('user', text);
      const typing = addTyping();
      try {
        const r = await fetch('/api/concierge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history })
        });
        typing.remove();
        if (r.ok) {
          const data = await r.json();
          addMsg('assistant', data.reply || "Hmm, I'm out of words. Try again?");
        } else {
          addMsg('assistant', "Concierge is offline right now. You can still browse listings on /discover or message a farm directly.");
        }
      } catch {
        typing.remove();
        addMsg('assistant', "Concierge is offline right now (no network). Browse /discover or message a farm directly.");
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectConcierge);
  else injectConcierge();
})();

/* ============================================================
   PO Auth Nav — replace .signin link with user name when authed.
   Runs on every page after DOMContentLoaded.
   ============================================================ */
(function () {
  'use strict';

  async function refreshNav() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      if (!data.user) return; // anonymous — leave "Sign in" as-is
      paintAuthedNav(data.user);
    } catch {}
  }

  function paintAuthedNav(user) {
    if (document.getElementById('poUserChip')) return;
    const display = (user.name || user.email.split('@')[0]).split(' ')[0];
    const initials = (user.name || user.email)
      .split(/[\s.@_-]+/).filter(Boolean).slice(0, 2)
      .map(s => s[0].toUpperCase()).join('');

    // Inject styles once
    if (!document.getElementById('po-user-style')) {
      const s = document.createElement('style');
      s.id = 'po-user-style';
      s.textContent = `
        .po-user-chip{position:relative;display:inline-flex;align-items:center;gap:8px;padding:5px 14px 5px 5px;border-radius:999px;background:rgba(6,27,14,.06);text-decoration:none;color:var(--ink, #061b0e);font:700 13px/1 'Inter',system-ui,sans-serif;cursor:pointer;border:0;transition:all .2s cubic-bezier(.2,.9,.3,1.4)}
        .po-user-chip:hover{background:rgba(6,27,14,.1);transform:translateY(-1px)}
        .po-user-chip-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#7da05d,#b48a5a);color:#fbf9f5;display:grid;place-items:center;font:800 11px/1 'Inter';letter-spacing:.02em}
        .po-user-chip-caret{font-size:9px;opacity:.55;margin-left:2px}
        .po-user-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:200px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(6,27,14,.15);padding:6px;display:none;z-index:200}
        .po-user-menu.open{display:block}
        .po-user-menu .pum-head{padding:10px 12px;border-bottom:1px solid rgba(6,27,14,.06);margin-bottom:4px}
        .po-user-menu .pum-name{font:700 13px/1.2 'Inter';color:var(--ink, #061b0e)}
        .po-user-menu .pum-email{font:500 11.5px/1.3 'Inter';color:rgba(6,27,14,.55);margin-top:3px;word-break:break-all}
        .po-user-menu .pum-role{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:rgba(125,160,93,.18);color:#2d4a18;font:700 9.5px/1 'Inter';letter-spacing:.08em;text-transform:uppercase}
        .po-user-menu a, .po-user-menu button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;background:transparent;border:0;color:var(--ink, #061b0e);text-decoration:none;font:600 12.5px/1.2 'Inter';cursor:pointer}
        .po-user-menu a:hover, .po-user-menu button:hover{background:rgba(6,27,14,.05)}
        .po-user-menu .signout{color:#a13a3a;border-top:1px solid rgba(6,27,14,.06);margin-top:4px;padding-top:10px}

        /* Notifications bell */
        .po-bell{position:relative;width:38px;height:38px;border-radius:999px;background:rgba(6,27,14,.06);border:0;color:var(--ink,#061b0e);display:inline-grid;place-items:center;cursor:pointer;transition:all .2s cubic-bezier(.2,.9,.3,1.4)}
        .po-bell:hover{background:rgba(6,27,14,.1);transform:translateY(-1px)}
        .po-bell svg{width:18px;height:18px}
        .po-bell-badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#a13a3a;color:#fff;font:800 10px/18px 'Inter',system-ui,sans-serif;text-align:center;display:none}
        .po-bell-badge.has{display:block}
        .po-notif-pop{position:absolute;top:calc(100% + 8px);right:0;width:360px;max-height:480px;overflow:hidden;background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(6,27,14,.18);display:none;z-index:200;flex-direction:column}
        .po-notif-pop.open{display:flex}
        .po-notif-head{padding:14px 16px;border-bottom:1px solid rgba(6,27,14,.07);display:flex;align-items:center;justify-content:space-between}
        .po-notif-head h4{margin:0;font:800 14px/1 'Inter';color:var(--ink,#061b0e)}
        .po-notif-head button{background:transparent;border:0;color:#5a6359;font:600 11.5px/1 'Inter';cursor:pointer}
        .po-notif-head button:hover{color:var(--ink,#061b0e);text-decoration:underline}
        .po-notif-list{flex:1;overflow-y:auto;padding:4px}
        .po-notif-item{display:flex;gap:11px;padding:11px 13px;border-radius:10px;text-decoration:none;color:inherit;cursor:pointer;border:0;background:transparent;width:100%;text-align:left}
        .po-notif-item:hover{background:rgba(6,27,14,.04)}
        .po-notif-item.unread{background:rgba(125,160,93,.07)}
        .po-notif-item.unread:hover{background:rgba(125,160,93,.13)}
        .po-notif-icon{flex-shrink:0;width:34px;height:34px;border-radius:999px;background:linear-gradient(135deg,#7da05d,#b48a5a);color:#fbf9f5;display:grid;place-items:center;font:600 16px/1 'Material Symbols Outlined','Material Icons';font-variation-settings:'FILL' 0,'wght' 500,'GRAD' 0,'opsz' 24}
        .po-notif-body{flex:1;min-width:0}
        .po-notif-title{font:700 12.5px/1.35 'Inter';color:var(--ink,#061b0e);margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .po-notif-meta{font:500 10.5px/1.3 'Inter';color:rgba(6,27,14,.55)}
        .po-notif-empty{padding:30px 20px;text-align:center;color:rgba(6,27,14,.55);font:500 12.5px/1.5 'Inter'}
        .po-notif-foot{padding:8px;border-top:1px solid rgba(6,27,14,.07);text-align:center}
        .po-notif-foot a{color:var(--ink,#061b0e);font:700 12px/1 'Inter';text-decoration:none;padding:8px 12px;border-radius:8px;display:inline-block}
        .po-notif-foot a:hover{background:rgba(6,27,14,.05)}
      `;
      document.head.appendChild(s);
    }

    // Find the .signin element on the page (any nav variant)
    const signinEls = document.querySelectorAll('.signin, [data-signin]');
    signinEls.forEach(el => el.remove());
    // Also remove anchors that say exactly "Sign in"
    document.querySelectorAll('.po-nav-actions a, .po-nav-actions button').forEach(el => {
      if ((el.textContent || '').trim() === 'Sign in') el.remove();
    });

    // Find a likely insertion point — first .po-nav-actions
    const slot = document.querySelector('.po-nav-actions') || document.querySelector('nav .po-nav-actions') || document.querySelector('header nav');
    if (!slot) return;

    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.innerHTML = `
      <div style="position:relative;display:inline-flex">
        <button class="po-bell" id="poBell" type="button" aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
          <span class="po-bell-badge" id="poBellBadge">0</span>
        </button>
        <div class="po-notif-pop" id="poNotifPop">
          <div class="po-notif-head">
            <h4>Notifications</h4>
            <button id="poNotifMarkAll" type="button">Mark all read</button>
          </div>
          <div class="po-notif-list" id="poNotifList">
            <div class="po-notif-empty">Loading…</div>
          </div>
          <div class="po-notif-foot"><a href="/notifications">View all →</a></div>
        </div>
      </div>
      <button class="po-user-chip" id="poUserChip" type="button">
        <span class="po-user-chip-avatar">${initials || '?'}</span>
        <span>${escapeHtml(display)}</span>
        <span class="po-user-chip-caret">▼</span>
      </button>
      <div class="po-user-menu" id="poUserMenu">
        <div class="pum-head">
          <div class="pum-name">${escapeHtml(user.name || display)}</div>
          <div class="pum-email">${escapeHtml(user.email)}</div>
          <span class="pum-role">${user.role || 'buyer'}</span>
        </div>
        <a href="/account">My account</a>
        <a href="/notifications">Notifications</a>
        <a href="/finance">Finance</a>
        ${user.role === 'producer' || user.role === 'admin' ? '<a href="/farmer">Producer dashboard</a>' : ''}
        ${user.role === 'processor' || user.role === 'admin' ? '<a href="/processor">Processor portal</a>' : ''}
        ${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
        <button class="signout" id="poSignout">Sign out</button>
      </div>
    `;
    slot.prepend(wrap);

    const chip = document.getElementById('poUserChip');
    const menu = document.getElementById('poUserMenu');
    chip.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', () => menu.classList.remove('open'));
    document.getElementById('poSignout').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
      location.href = '/';
    });

    // ─── Notifications wiring ───────────────────────────────────
    const bell = document.getElementById('poBell');
    const pop = document.getElementById('poNotifPop');
    const list = document.getElementById('poNotifList');
    const badge = document.getElementById('poBellBadge');

    function timeAgo(iso) {
      if (!iso) return '';
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm';
      if (s < 86400) return Math.floor(s / 3600) + 'h';
      if (s < 604800) return Math.floor(s / 86400) + 'd';
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    async function refreshUnread() {
      try {
        const r = await fetch('/api/notifications?count=1', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        const n = data.unread || 0;
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.toggle('has', n > 0);
      } catch {}
    }

    async function loadNotifications() {
      try {
        const r = await fetch('/api/notifications', { credentials: 'include' });
        if (!r.ok) { list.innerHTML = '<div class="po-notif-empty">Couldn\'t load.</div>'; return; }
        const data = await r.json();
        const items = data.notifications || [];
        if (!items.length) {
          list.innerHTML = '<div class="po-notif-empty">No notifications yet.<br>Reservations, payouts, and updates land here.</div>';
          return;
        }
        list.innerHTML = items.map(n => `
          <a class="po-notif-item ${n.read_at ? '' : 'unread'}" href="${escapeHtml(n.link_url || '/account')}" data-id="${escapeHtml(n.id)}">
            <span class="po-notif-icon">${escapeHtml(n.icon || 'notifications')}</span>
            <span class="po-notif-body">
              <span class="po-notif-title">${escapeHtml(n.title || '')}</span>
              <span class="po-notif-meta">${timeAgo(n.created_at)}${n.read_at ? '' : ' · new'}</span>
            </span>
          </a>
        `).join('');
        // mark each one read on click (don't await — let navigation proceed)
        list.querySelectorAll('.po-notif-item').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id');
            fetch('/api/notifications?id=' + encodeURIComponent(id), { method: 'PATCH', credentials: 'include' }).catch(() => {});
          });
        });
      } catch {
        list.innerHTML = '<div class="po-notif-empty">Couldn\'t load.</div>';
      }
    }

    bell.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = pop.classList.toggle('open');
      menu.classList.remove('open');
      if (isOpen) loadNotifications();
    });
    document.addEventListener('click', () => pop.classList.remove('open'));
    document.getElementById('poNotifMarkAll').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await fetch('/api/notifications?all=1', { method: 'PATCH', credentials: 'include' }); } catch {}
      await refreshUnread();
      loadNotifications();
    });

    refreshUnread();
    // Light polling so the badge doesn't go stale on long sessions
    setInterval(refreshUnread, 60000);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshNav);
  else refreshNav();

  // ── Microsoft Clarity ────────────────────────────────────────
  // Real-user session recordings, heatmaps, rage-click + dead-click detection.
  // Auto-loads when /api/public-config returns a clarity_project_id. Skipped on
  // localhost so we don't pollute prod analytics during dev.
  function installClarity(projectId) {
    if (!projectId) return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    if (window.clarity) return;
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, 'clarity', 'script', projectId);
  }
  if (window.PO_CLARITY_ID) {
    installClarity(window.PO_CLARITY_ID);
  } else {
    // Honor server cache-control (60s) instead of force-cache. force-cache
    // would pin a null response forever if the env var was set after first fetch.
    fetch('/api/public-config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.clarity_project_id) installClarity(d.clarity_project_id); })
      .catch(() => {});
  }

  // ── PWA hooks ────────────────────────────────────────────────
  // Inject manifest link (so any page becomes installable) + register the
  // service worker so the site works offline and qualifies as a PWA. Both are
  // prerequisites for App Store / Play Store wrappers.
  function ensureManifestLink() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const l = document.createElement('link');
    l.rel = 'manifest';
    l.href = '/manifest.webmanifest';
    document.head.appendChild(l);
  }
  function ensureThemeColor() {
    if (document.querySelector('meta[name="theme-color"]')) return;
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = '#061b0e';
    document.head.appendChild(m);
  }
  function ensureAppleMeta() {
    // Prefer the non-deprecated standard; keep apple-* for older iOS.
    if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
      const m = document.createElement('meta');
      m.name = 'mobile-web-app-capable';
      m.content = 'yes';
      document.head.appendChild(m);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      const a = document.createElement('meta');
      a.name = 'apple-mobile-web-app-capable';
      a.content = 'yes';
      document.head.appendChild(a);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
      const b = document.createElement('meta');
      b.name = 'apple-mobile-web-app-status-bar-style';
      b.content = 'black-translucent';
      document.head.appendChild(b);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-title"]')) {
      const c = document.createElement('meta');
      c.name = 'apple-mobile-web-app-title';
      c.content = 'Protein Outfitters';
      document.head.appendChild(c);
    }
  }
  ensureManifestLink();
  ensureThemeColor();
  ensureAppleMeta();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Register after load so we don't compete with critical render
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {/* SW registration is best-effort */});
    });
  }

  // Listen for the install prompt; expose a `window.poShowInstallPrompt()` so
  // any page can render an "Install app" button when supported.
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.dispatchEvent(new CustomEvent('po:install-available'));
  });
  window.poShowInstallPrompt = async function () {
    if (!deferredInstallPrompt) return { outcome: 'unavailable' };
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return result;
  };

  // ── Live activity ticker (FOMO) ───────────────────────────────
  // Booking.com made billions on this — "Sarah from Brainerd just reserved a
  // quarter share of #214 from Twin Pines Ranch · 4 minutes ago". Mounts to
  // any element with data-po-activity-ticker. Auto-rotates every 6 seconds.
  // Pages opt in by adding `<div data-po-activity-ticker></div>` anywhere; if
  // none exists on a page that wants it, we mount in the bottom-left corner.
  function installActivityTicker() {
    // Skip on tiny pages where it'd feel intrusive (settings, admin, etc.)
    const skipPaths = ['/settings', '/admin', '/admin-overview', '/admin-health', '/admin-bootstrap', '/admin-email', '/admin-ams-import', '/admin-fsis-import', '/processor-checkin', '/booking-confirmation', '/list-animal', '/cut-sheet', '/policies/privacy', '/policies/terms', '/policies/refunds', '/credentials'];
    if (skipPaths.some(p => location.pathname.startsWith(p))) return;
    if (document.body.getAttribute('data-po-ticker') === 'off') return;

    // Inject the ticker styles once
    if (!document.getElementById('po-ticker-style')) {
      const style = document.createElement('style');
      style.id = 'po-ticker-style';
      style.textContent = `
        .po-ticker {
          position: fixed; bottom: 18px; left: 18px; z-index: 9000;
          max-width: 360px; min-width: 240px;
          background: rgba(6, 27, 14, 0.95); color: #fbf9f5;
          border-radius: 14px; padding: 11px 16px 11px 14px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
          font: 500 12.5px/1.45 'Inter', system-ui, sans-serif;
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          transform: translateY(120%); opacity: 0;
          transition: transform .45s cubic-bezier(.2,.85,.3,1.2), opacity .25s ease;
          cursor: pointer;
        }
        .po-ticker.show { transform: translateY(0); opacity: 1; }
        .po-ticker.hide { transform: translateY(120%); opacity: 0; }
        .po-ticker-row { display: flex; gap: 9px; align-items: flex-start; }
        .po-ticker-emoji { font-size: 18px; line-height: 1.2; flex: 0 0 auto; }
        .po-ticker-body { flex: 1; min-width: 0; }
        .po-ticker-text { color: #fbf9f5; }
        .po-ticker-text strong { color: #cfe9d3; font-weight: 700; }
        .po-ticker-meta { font-size: 10.5px; color: rgba(251,249,245,.55); margin-top: 2px; letter-spacing: .03em; }
        .po-ticker-close { position: absolute; top: 4px; right: 6px; background: transparent; border: 0; color: rgba(251,249,245,.4); font: 700 14px/1 'Inter'; cursor: pointer; padding: 4px 6px; }
        .po-ticker-close:hover { color: #fbf9f5; }
        @media (max-width: 640px) {
          .po-ticker { left: 12px; right: 12px; bottom: 12px; max-width: none; min-width: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .po-ticker { transition: opacity .2s; transform: none; }
          .po-ticker.show { opacity: 1; }
          .po-ticker.hide { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // Build the DOM node (one ticker per page)
    let ticker = document.querySelector('.po-ticker');
    if (!ticker) {
      ticker = document.createElement('div');
      ticker.className = 'po-ticker';
      ticker.setAttribute('role', 'status');
      ticker.setAttribute('aria-live', 'polite');
      ticker.innerHTML = '<button class="po-ticker-close" aria-label="Dismiss">×</button><div class="po-ticker-row"><span class="po-ticker-emoji">🥩</span><div class="po-ticker-body"><div class="po-ticker-text"></div><div class="po-ticker-meta"></div></div></div>';
      document.body.appendChild(ticker);
    }

    const closeBtn = ticker.querySelector('.po-ticker-close');
    const emojiEl = ticker.querySelector('.po-ticker-emoji');
    const textEl = ticker.querySelector('.po-ticker-text');
    const metaEl = ticker.querySelector('.po-ticker-meta');
    let dismissed = false;
    let events = [];
    let cursor = 0;
    let tickerTimer = null;

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ticker.classList.remove('show');
      ticker.classList.add('hide');
      dismissed = true;
      if (tickerTimer) clearInterval(tickerTimer);
      // Don't show again this session
      try { sessionStorage.setItem('po_ticker_dismissed', '1'); } catch {}
    });

    ticker.addEventListener('click', () => {
      const ev = events[(cursor - 1 + events.length) % events.length];
      if (ev && ev.link) location.href = ev.link;
    });

    function showEvent(ev) {
      if (!ev) return;
      emojiEl.textContent = ev.emoji || '🥩';
      textEl.textContent = ev.text;
      metaEl.textContent = ev.time;
      ticker.classList.remove('hide');
      ticker.classList.add('show');
    }

    function rotate() {
      if (dismissed || !events.length) return;
      const ev = events[cursor % events.length];
      cursor++;
      // Briefly hide for transition
      ticker.classList.remove('show');
      ticker.classList.add('hide');
      setTimeout(() => showEvent(ev), 350);
    }

    // Skip if user already dismissed in this session
    try { if (sessionStorage.getItem('po_ticker_dismissed') === '1') return; } catch {}

    // Fetch + start rotating
    fetch('/api/recent-activity', { cache: 'default' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        events = (d && d.events) || [];
        if (!events.length) return;
        // First event after a small delay so it doesn't fight with first-paint
        setTimeout(() => {
          showEvent(events[0]);
          cursor = 1;
          // Rotate every 7 seconds, stop after 5 rotations to not annoy
          let rotations = 0;
          tickerTimer = setInterval(() => {
            if (rotations >= 4) { clearInterval(tickerTimer); return; }
            rotate();
            rotations++;
          }, 7000);
        }, 1800);
      })
      .catch(() => {});
  }
  // Wait until idle to install — never block first-paint
  if ('requestIdleCallback' in window) {
    requestIdleCallback(installActivityTicker, { timeout: 3000 });
  } else {
    setTimeout(installActivityTicker, 1500);
  }

  // ── Global share helper ──────────────────────────────────────
  // Any page calls window.poShare({ title, text, url }) to invoke the native
  // share sheet on iOS/Android, falling back to "copied to clipboard" with a
  // toast confirmation. Tracks the share via Clarity custom event so we can
  // see in the dashboard which pages drive the most viral coefficient.
  window.poShare = async function (opts = {}) {
    const url = opts.url || location.href;
    const title = opts.title || document.title || 'Protein Outfitters';
    const text = opts.text || '';
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        if (window.clarity) try { window.clarity('event', 'share_native_used'); } catch {}
        return { ok: true, method: 'native' };
      }
      await navigator.clipboard.writeText(url);
      if (window.clarity) try { window.clarity('event', 'share_link_copied'); } catch {}
      // Toast
      const t = document.createElement('div');
      t.textContent = '✓ Link copied to clipboard';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#061b0e;color:#fbf9f5;padding:11px 20px;border-radius:999px;font:700 13px/1 \'Inter\',system-ui,sans-serif;z-index:9999;box-shadow:0 8px 22px rgba(0,0,0,.35);';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1800);
      return { ok: true, method: 'clipboard' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  // ── Referral capture + landing banner ─────────────────────────
  // When someone arrives with ?ref=XYZ123 we:
  //   1. Stash the code in localStorage so it survives the magic-link
  //      round-trip (email → /api/auth/verify) without being lost.
  //   2. Surface a subtle "Got $25 off your first share — claim it"
  //      banner so the visitor knows there's value waiting.
  //   3. Patch any /api/auth/request-link form on the page to include
  //      the ref code in the `next` URL so /api/auth/verify can capture
  //      it server-side.
  // The banner is dismissable per session and never shows on /account or
  // admin pages (where it'd be noise to a logged-in user).
  function captureReferral() {
    const params = new URLSearchParams(location.search);
    const incoming = (params.get('ref') || '').toUpperCase().trim();
    let stored = null;
    try { stored = localStorage.getItem('po_ref_code'); } catch {}
    if (incoming && /^[A-Z2-9]{6}$/.test(incoming)) {
      try { localStorage.setItem('po_ref_code', incoming); } catch {}
      stored = incoming;
    }
    if (!stored) return;

    // Skip noisy contexts
    const skip = ['/account', '/admin', '/admin-overview', '/admin-health', '/admin-bootstrap', '/admin-email', '/admin-ams-import', '/admin-fsis-import', '/processor-checkin', '/booking-confirmation', '/policies/'];
    if (skip.some(p => location.pathname.startsWith(p))) return;
    try { if (sessionStorage.getItem('po_ref_banner_dismissed') === '1') return; } catch {}

    if (document.querySelector('.po-ref-banner')) return;

    // Banner sits inline at the top of <body>, NOT position:fixed, so the
    // page's own nav (which is itself often sticky/fixed) doesn't get
    // overlaid. Body content shifts down by exactly the banner height,
    // which is what we want — the nav can either go above or below
    // depending on its own positioning.
    const bar = document.createElement('div');
    bar.className = 'po-ref-banner';
    bar.style.cssText = 'position:relative;z-index:50;background:linear-gradient(135deg,#7da05d 0%,#5a7a44 100%);color:#fbf9f5;padding:10px 18px;display:flex;align-items:center;justify-content:center;gap:14px;font:600 13.5px/1.3 \'Inter\',system-ui,sans-serif;text-align:center;';
    bar.innerHTML = `
      <span style="font-size:16px;">🎁</span>
      <span><strong>$25 off your first share.</strong> Reserve and your friend gets $25 too.</span>
      <button class="po-ref-banner-dismiss" aria-label="Dismiss" style="background:transparent;border:0;color:rgba(251,249,245,.85);font:700 18px/1 'Inter';cursor:pointer;padding:0 4px;margin-left:6px;">×</button>
    `;
    bar.addEventListener('click', (e) => {
      if (e.target.classList.contains('po-ref-banner-dismiss')) {
        bar.remove();
        try { sessionStorage.setItem('po_ref_banner_dismissed', '1'); } catch {}
      }
    });
    const pad = document.createElement('style');
    pad.textContent = '@media (max-width:640px){.po-ref-banner{font-size:12px;padding:9px 12px;gap:8px}.po-ref-banner span:first-of-type{display:none}}';
    document.head.appendChild(pad);
    document.body.insertBefore(bar, document.body.firstChild);

    // Patch any inline auth form on the page so the ref code rides along
    // with `next` to the verify endpoint. We rewrite the value just before
    // submit — both <form action> and any <input name="next"> field.
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = (form.action || '').toString();
      if (!action.includes('/api/auth/request-link')) return;
      const nextField = form.querySelector('input[name="next"]');
      if (nextField) {
        try {
          const u = new URL(nextField.value || '/account', location.origin);
          if (!u.searchParams.has('ref')) {
            u.searchParams.set('ref', stored);
            nextField.value = u.pathname + u.search;
          }
        } catch {}
      }
    }, true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', captureReferral);
  } else {
    captureReferral();
  }
})();


/* PO tile image variety v2 (deploy) - varies farm covers + homepage animal tiles; animal tiles keep their species (inferred from current image); only swaps stock placeholders, never real uploads; repairs premium-deer 404 */
;(function(){
  var SCENIC=['cattle-pasture','ranch','angus','hereford','wagyu','hero-pasture','lamb','hog','poultry','venison'];
  var SPECIES={'cattle-pasture':'cattle','ranch':'cattle','angus':'cattle','hereford':'cattle','wagyu':'cattle','hero-pasture':'cattle','hog':'hog','premium-pig':'hog','lamb':'lamb','premium-sheep':'lamb','poultry':'poultry','venison':'venison','premium-deer':'venison'};
  var POOLS={cattle:['cattle-pasture','angus','hereford','wagyu','ranch','hero-pasture'],hog:['hog','premium-pig'],lamb:['lamb','premium-sheep'],poultry:['poultry'],venison:['venison']};
  function bn(u){u=u||'';var k=u.indexOf('/img/');if(k<0)return null;var rest=u.slice(k+5);var d=rest.indexOf('.');if(d<1)return null;var name=rest.slice(0,d);return /^[a-z0-9-]+$/i.test(name)?name:null;}
  function info(node){var isImg=node.tagName==='IMG';var url=isImg?node.getAttribute('src'):(node.style&&node.style.backgroundImage)||'';return {isImg:isImg,base:bn(url)};}
  function setImg(node,d,name){var u='/img/'+name+'.jpg';if(d.isImg){if(node.getAttribute('src')!==u)node.setAttribute('src',u);}else if(String(node.style.backgroundImage).indexOf(u)<0){node.style.backgroundImage="url('"+u+"')";}}
  function sweep(){
    var nodes=document.querySelectorAll('.farm-cover, .product-photo');
    if(!nodes.length)return;
    var ctr=Object.create(null),last=null;
    for(var n=0;n<nodes.length;n++){
      var node=nodes[n],d=info(node);
      if(d.base===null||!(d.base in SPECIES)){if(d.base)last=d.base;continue;}
      var isFarm=node.classList.contains('farm-cover'),pool,key;
      if(isFarm){pool=SCENIC;key='scenic';}else{key=SPECIES[d.base];pool=POOLS[key]||SCENIC;}
      if(pool.length===1){setImg(node,d,pool[0]);last=pool[0];continue;}
      var i=(ctr[key]=(ctr[key]||0))%pool.length,ch=pool[i];ctr[key]++;
      if(ch===last){ch=pool[(i+1)%pool.length];ctr[key]++;}
      setImg(node,d,ch);last=ch;
    }
  }
  var t=false;function sched(){if(t)return;t=true;setTimeout(function(){t=false;sweep();},60);}
  function boot(){sweep();try{new MutationObserver(function(m){for(var i=0;i<m.length;i++){if(m[i].addedNodes&&m[i].addedNodes.length){sched();break;}}}).observe(document.body,{childList:true,subtree:true});}catch(e){}}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}
})();
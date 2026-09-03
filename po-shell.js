/* ============================================================
   PO Shell — injects footer + reserve sheet markup
   plus runtime behavior for the 3-step reserve flow.
   The nav stays inline in each page for instant render.
   ============================================================ */
(function () {
  'use strict';

  const FOOTER_HTML = `
<footer class="po-foot">
  <div class="po-foot-inner">
    <div>
      <div class="po-foot-mark"><img src="/brand/logo-monogram.svg" alt=""><span>Protein Outfitters</span></div>
      <p class="po-foot-meta">A whole animal, in three taps.<br>By Stittsworth Meats · Bemidji, MN.</p>
    </div>
    <div><h4>Marketplace</h4><ul><li><a href="/discover">Discover</a></li><li><a href="/producers">Producers</a></li><li><a href="/map">Farm map</a></li><li><a href="/hardware">Hardware</a></li></ul></div>
    <div><h4>For partners</h4><ul><li><a href="/farmer">Producer dashboard</a></li><li><a href="/processor">Processor portal</a></li><li><a href="/processor-saas">Processor pricing</a></li><li><a href="/donation-flow">Producer Partnership</a></li></ul></div>
    <div><h4>Company</h4><ul><li><a href="/account">Account</a></li><li><a href="/brand">Brand</a></li><li><a href="mailto:hello@proteinoutfitters.com">hello@proteinoutfitters.com</a></li></ul></div>
  </div>
  <div class="po-foot-bottom"><span>© 2026 Protein Outfitters. All rights reserved.</span><span>Built in Bemidji, MN.</span></div>
</footer>`;

  const SHEET_HTML = `
<div class="sheet-backdrop" id="sheetBackdrop"></div>
<aside class="sheet" id="sheet" aria-hidden="true" aria-label="Reserve">
  <div class="sheet-grip" aria-hidden="true"></div>
  <header class="sheet-head">
    <div class="sheet-progress" aria-hidden="true"><span class="dot active" data-dot="1"></span><span class="dot" data-dot="2"></span><span class="dot" data-dot="3"></span></div>
    <button class="sheet-close" id="sheetClose" aria-label="Close">✕</button>
  </header>
  <div class="sheet-body">
    <div class="sheet-context"><div class="sheet-context-img" id="sheetContextImg"></div><div class="sheet-context-text"><p class="sheet-context-name" id="sheetContextName">Pick an animal to start</p><p class="sheet-context-sub" id="sheetContextSub">Or browse below.</p></div></div>
    <section class="sheet-step" data-step="1"><h3 class="sheet-q">Pick your share.</h3><div class="options" id="shareOptions"></div></section>
    <section class="sheet-step" data-step="2" hidden><h3 class="sheet-q">Where will you pick up?</h3><div class="options">
      <button class="option" data-processor="04"><span class="option-glyph">04</span><span class="option-text"><span class="option-title">Plant 04 · Bemidji, MN</span><span class="option-sub">12 mi · Suggested · Pickup window: 8 AM – 5 PM</span></span><span class="option-price">Free</span></button>
      <button class="option" data-processor="17"><span class="option-glyph">17</span><span class="option-text"><span class="option-title">Plant 17 · Cass Lake, MN</span><span class="option-sub">38 mi · Pickup window: 7 AM – 4 PM</span></span><span class="option-price">Free</span></button>
      <button class="option" data-processor="22"><span class="option-glyph">22</span><span class="option-text"><span class="option-title">Plant 22 · Brainerd, MN</span><span class="option-sub">62 mi · Pickup window: 8 AM – 6 PM</span></span><span class="option-price">Free</span></button>
    </div></section>
    <section class="sheet-step" data-step="3" hidden><h3 class="sheet-q">Reserve it.</h3>
      <div class="summary"><div class="summary-row"><span id="sumShareLabel">Share</span><span class="v" id="sumShareVal">$0</span></div><div class="summary-row"><span>Processing fee</span><span class="v">$225</span></div><div class="summary-row total"><span>Reserve today</span><span class="v" id="sumTotalVal">$0</span></div></div>
      <div class="pay-stack"><button class="btn-pay btn-pay--apple" id="payApple"> Pay</button><button class="btn-pay btn-pay--card" id="payCard">Reserve with card →</button></div>
      <p style="font-size:12px;color:var(--ink-3);text-align:center;margin:14px 0 0;line-height:1.5;">If the animal does not pass inspection, we refund what you paid. We'll email your cut sheet within 24 hours.</p>
    </section>
    <section class="sheet-step" data-step="4" hidden><div class="confirm"><div class="confirm-mark">✓</div><h3 id="confirmTitle">Reserved.</h3><p id="confirmBody">We just sent your reservation details and your cut sheet builder.</p></div></section>
  </div>
  <footer class="sheet-foot"><button class="sheet-back" id="sheetBack" disabled>← Back</button><button class="sheet-next" id="sheetNext" disabled>Continue →</button></footer>
</aside>`;

  // Inject footer + sheet into body
  function inject() {
    const host = document.getElementById('po-shell-host');
    if (host) {
      host.insertAdjacentHTML('beforebegin', FOOTER_HTML);
      host.insertAdjacentHTML('afterend', SHEET_HTML);
    } else {
      document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + SHEET_HTML);
    }
    wire();
  }

  function wire() {
    const sheet = document.getElementById('sheet');
    const backdrop = document.getElementById('sheetBackdrop');
    const closeBtn = document.getElementById('sheetClose');
    const backBtn = document.getElementById('sheetBack');
    const nextBtn = document.getElementById('sheetNext');
    if (!sheet) return;
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
    function fmt(n) { return '$' + Number(n).toLocaleString(); }

    function buildShareOptions() {
      const a = state.animal; if (!a) return;
      const opts = [
        { key: 'q', glyph: '¼', title: 'Quarter share', sub: '~110 lb of cuts · fits a 7 cu ft freezer', price: a.priceQ },
        { key: 'h', glyph: '½', title: 'Half share', sub: '~220 lb of cuts · fits a 14 cu ft freezer', price: a.priceH },
        { key: 'w', glyph: '1', title: 'Whole animal', sub: '~440 lb of cuts · for serious operators', price: a.priceW }
      ].filter(o => o.price > 0);
      shareWrap.innerHTML = opts.map(o => `<button class="option" data-share="${o.key}" data-price="${o.price}"><span class="option-glyph">${o.glyph}</span><span class="option-text"><span class="option-title">${o.title}</span><span class="option-sub">${o.sub}</span></span><span class="option-price">${fmt(o.price)}</span></button>`).join('');
      shareWrap.querySelectorAll('.option').forEach(btn => btn.addEventListener('click', () => {
        shareWrap.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.share = { key: btn.dataset.share, price: Number(btn.dataset.price) };
        nextBtn.disabled = false;
      }));
    }

    sheet.querySelectorAll('.sheet-step[data-step="2"] .option').forEach(btn => btn.addEventListener('click', () => {
      sheet.querySelectorAll('.sheet-step[data-step="2"] .option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.processor = btn.dataset.processor;
      nextBtn.disabled = false;
    }));

    function setStep(n) {
      state.step = n;
      steps.forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
      dots.forEach((d, i) => { d.classList.toggle('active', i === n - 1); d.classList.toggle('done', i < n - 1); });
      backBtn.disabled = n === 1 || n === 4;
      if (n === 4) { nextBtn.style.visibility = 'hidden'; backBtn.style.visibility = 'hidden'; }
      else {
        nextBtn.style.visibility = 'visible'; backBtn.style.visibility = 'visible';
        if (n === 1) nextBtn.disabled = !state.share;
        if (n === 2) nextBtn.disabled = !state.processor;
        if (n === 3) { nextBtn.disabled = false; nextBtn.textContent = 'Reserve →'; }
        else nextBtn.textContent = 'Continue →';
      }
      if (n === 3 && state.share) {
        sumShareLabel.textContent = (state.share.key === 'q' ? 'Quarter' : state.share.key === 'h' ? 'Half' : 'Whole') + ' share';
        sumShareVal.textContent = fmt(state.share.price);
        sumTotalVal.textContent = fmt(state.share.price + 225);
      }
    }

    function open(a) {
      if (!a) return;
      state.animal = a;
      ctxImg.style.backgroundImage = `url('${a.photo}')`;
      ctxName.textContent = a.name;
      ctxSub.textContent = a.producer;
      state.share = null; state.processor = null;
      shareWrap.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
      sheet.querySelectorAll('.sheet-step[data-step="2"] .option').forEach(b => b.classList.remove('selected'));
      buildShareOptions();
      setStep(1);
      backdrop.classList.add('open');
      sheet.classList.add('open');
      sheet.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      backdrop.classList.remove('open');
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    document.querySelectorAll('[data-open-sheet]').forEach(btn => btn.addEventListener('click', e => {
      const c = e.currentTarget;
      if (c.dataset.animal) {
        open({
          id: c.dataset.animal,
          name: c.dataset.name,
          producer: c.dataset.producer,
          photo: c.dataset.photo,
          priceQ: Number(c.dataset.priceQ || 0),
          priceH: Number(c.dataset.priceH || 0),
          priceW: Number(c.dataset.priceW || 0)
        });
      } else {
        const f = document.querySelector('[data-animal]');
        if (f) open({
          id: f.dataset.animal,
          name: f.dataset.name,
          producer: f.dataset.producer,
          photo: f.dataset.photo,
          priceQ: Number(f.dataset.priceQ || 0),
          priceH: Number(f.dataset.priceH || 0),
          priceW: Number(f.dataset.priceW || 0)
        });
        else window.location.href = '/discover';
      }
    }));

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    backBtn.addEventListener('click', () => { if (state.step > 1) setStep(state.step - 1); });
    nextBtn.addEventListener('click', () => {
      if (state.step < 3) setStep(state.step + 1);
      else if (state.step === 3) {
        confirmTitle.textContent = 'Reserved.';
        confirmBody.textContent = `We just held the ${state.share.key === 'q' ? 'quarter' : state.share.key === 'h' ? 'half' : 'whole'} share of ${state.animal.name.replace(/^#?\d+\s·\s/, '')} for you. Cut sheet builder is in your inbox.`;
        setStep(4);
      }
    });
    document.getElementById('payApple').addEventListener('click', () => nextBtn.click());
    document.getElementById('payCard').addEventListener('click', () => nextBtn.click());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

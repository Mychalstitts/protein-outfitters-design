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
    <div><h4>Company</h4><ul><li><a href="/account">Account</a></li><li><a href="/screens">All screens</a></li><li><a href="/brand">Brand</a></li><li><a href="mailto:hello@proteinoutfitters.com">hello@proteinoutfitters.com</a></li></ul></div>
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
      <div class="summary"><div class="summary-row"><span id="sumShareLabel">Share</span><span class="v" id="sumShareVal">$0</span></div><div class="summary-row"><span>Processing fee</span><span class="v">$225</span></div><div class="summary-row"><span>Insurance pool</span><span class="v">$18</span></div><div class="summary-row total"><span>Reserve today</span><span class="v" id="sumTotalVal">$0</span></div></div>
      <div class="pay-stack"><button class="btn-pay btn-pay--apple" id="payApple"> Pay</button><button class="btn-pay btn-pay--card" id="payCard">Reserve with card →</button></div>
      <p style="font-size:12px;color:var(--ink-3);text-align:center;margin:14px 0 0;line-height:1.5;">Free cancellation up to 21 days before harvest. We'll email your cut sheet within 24 hours.</p>
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
        sumTotalVal.textContent = fmt(state.share.price + 225 + 18);
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
    nextBtn.addEventListener('click', async () => {
      if (state.step < 3) { setStep(state.step + 1); return; }
      if (state.step === 3) {
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
          email = prompt('Enter your email so we can confirm your reservation:');
          if (!email || !email.includes('@')) {
            nextBtn.disabled = false; nextBtn.textContent = origText;
            return;
          }
        }

        try {
          const totalEstimate = (state.share?.price || 0) + 225 + 18;
          const payload = {
            listing_id: state.animal.id,
            share_size,
            buyer_email: email,
            buyer_name: name,
            processor_id: null, // processor selection currently uses string label, future: real UUID
            total_estimate: totalEstimate,
            deposit_amount: Math.round(totalEstimate * 0.1 * 100) / 100,
            notes: state.processor ? ('Processor: ' + state.processor) : null
          };
          const r = await fetch('/api/reservations', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            nextBtn.disabled = false; nextBtn.textContent = origText;
            alert('Could not reserve: ' + (data.error || ('HTTP ' + r.status)));
            return;
          }
          confirmTitle.textContent = 'Reserved.';
          const animalLabel = (state.animal.name || '').replace(/^#?\d+\s·\s/, '') || 'this animal';
          confirmBody.textContent = `We held the ${share_size} share of ${animalLabel} for you. Confirmation sent to ${email}. Cut-sheet builder follows.`;
          setStep(4);
        } catch (e) {
          nextBtn.disabled = false; nextBtn.textContent = origText;
          alert('Network error: ' + e.message);
        }
      }
    });
    document.getElementById('payApple').addEventListener('click', () => nextBtn.click());
    document.getElementById('payCard').addEventListener('click', () => nextBtn.click());
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
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L14.09 8.26L20 9.27L16 13.14L17.18 19.02L12 16.27L6.82 19.02L8 13.14L4 9.27L9.91 8.26z" stroke-linejoin="round"/></svg>
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
    wrap.innerHTML = `
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
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshNav);
  else refreshNav();
})();

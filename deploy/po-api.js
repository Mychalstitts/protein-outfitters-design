// PO API client — small wrapper for fetch + auth helpers, attached to window.PO_API.
(function () {
  'use strict';

  async function jsonFetch(path, opts = {}) {
    const r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch { /* may be 302/204 */ }
    if (!r.ok) {
      const e = new Error((data && data.error) || `HTTP ${r.status}`);
      e.status = r.status; e.data = data;
      throw e;
    }
    return data;
  }

  const api = {
    me: () => jsonFetch('/api/auth/me'),
    requestLink: (email, role) => jsonFetch('/api/auth/request-link', { method: 'POST', body: { email, role } }),
    logout: () => jsonFetch('/api/auth/logout', { method: 'POST' }),

    listings: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return jsonFetch('/api/listings' + (q ? '?' + q : ''));
    },
    listing: (id) => jsonFetch('/api/listing?id=' + encodeURIComponent(id)),
    createListing: (data) => jsonFetch('/api/listings', { method: 'POST', body: data }),
    updateListing: (id, data) => jsonFetch('/api/listing?id=' + encodeURIComponent(id), { method: 'PATCH', body: data }),

    farms: () => jsonFetch('/api/farms'),
    myFarms: () => jsonFetch('/api/farms?owner=me'),
    farm: (slug) => jsonFetch('/api/farms?slug=' + encodeURIComponent(slug)),
    createFarm: (data) => jsonFetch('/api/farms', { method: 'POST', body: data }),

    reservations: () => jsonFetch('/api/reservations'),
    reserve: (data) => jsonFetch('/api/reservations', { method: 'POST', body: data }),

    processors: () => jsonFetch('/api/processors'),
    processor: (slug) => jsonFetch('/api/processors?slug=' + encodeURIComponent(slug)),
    createProcessor: (data) => jsonFetch('/api/processors', { method: 'POST', body: data }),
    updateProcessor: (slug, data) => jsonFetch('/api/processors?slug=' + encodeURIComponent(slug), { method: 'PATCH', body: data }),

    reviews: (subject_type, subject_id) =>
      jsonFetch(`/api/reviews?subject_type=${encodeURIComponent(subject_type)}&subject_id=${encodeURIComponent(subject_id)}`),
    submitReview: (data) => jsonFetch('/api/reviews', { method: 'POST', body: data }),

    donate: (data) => jsonFetch('/api/donations', { method: 'POST', body: data }),

    // ─ Notifications (in-app inbox) ─
    notifications: (opts = {}) => {
      const q = new URLSearchParams(opts).toString();
      return jsonFetch('/api/notifications' + (q ? '?' + q : ''));
    },
    notificationsUnreadCount: () => jsonFetch('/api/notifications?count=1'),
    markNotificationRead: (id) => jsonFetch('/api/notifications?id=' + encodeURIComponent(id), { method: 'PATCH' }),
    markAllNotificationsRead: () => jsonFetch('/api/notifications?all=1', { method: 'PATCH' })
  };

  window.PO_API = api;

  // ─── Auth modal (magic link) ─────────────────────────────────
  function injectAuthStyles() {
    if (document.getElementById('po-auth-style')) return;
    const s = document.createElement('style');
    s.id = 'po-auth-style';
    s.textContent = `
      .po-auth-back{position:fixed;inset:0;background:rgba(6,27,14,.4);backdrop-filter:blur(6px);z-index:200;display:none;align-items:center;justify-content:center;padding:20px}
      .po-auth-back.open{display:flex}
      .po-auth-card{background:#fff;border-radius:22px;padding:32px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(6,27,14,.25);font-family:'Inter',system-ui,sans-serif;color:#061b0e}
      .po-auth-card h2{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:0 0 6px}
      .po-auth-card p{font-size:14px;line-height:1.5;opacity:.7;margin:0 0 18px}
      .po-auth-card input{width:100%;border:1px solid rgba(6,27,14,.12);border-radius:12px;padding:12px 14px;font:500 15px/1.4 inherit;color:#061b0e;outline:none;margin-bottom:10px}
      .po-auth-card input:focus{border-color:#061b0e}
      .po-auth-card button.primary{width:100%;background:#061b0e;color:#fbf9f5;border:0;border-radius:12px;padding:13px;font-weight:700;cursor:pointer;font-size:14.5px}
      .po-auth-card button.primary:hover{background:#0a2614}
      .po-auth-card button.primary:disabled{opacity:.5;cursor:not-allowed}
      .po-auth-result{background:rgba(125,160,93,.12);border:1px solid rgba(125,160,93,.3);border-radius:10px;padding:11px 14px;margin-top:14px;font-size:13px;line-height:1.5}
      .po-auth-result a{color:#061b0e;font-weight:700}
      .po-auth-x{position:absolute;top:18px;right:18px;background:rgba(6,27,14,.06);border:0;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px;color:#061b0e}
      .po-auth-card{position:relative}
      .po-auth-role{display:flex;gap:6px;margin-bottom:12px}
      .po-auth-role button{flex:1;background:rgba(6,27,14,.05);border:1px solid transparent;border-radius:999px;padding:7px;font:600 12px/1 inherit;cursor:pointer;color:#061b0e}
      .po-auth-role button.active{background:#061b0e;color:#fbf9f5}
    `;
    document.head.appendChild(s);
  }

  function openAuth(prompt = 'Sign in', defaultRole = 'buyer') {
    injectAuthStyles();
    let back = document.getElementById('po-auth-back');
    if (!back) {
      back = document.createElement('div');
      back.id = 'po-auth-back';
      back.className = 'po-auth-back';
      back.innerHTML = `
        <div class="po-auth-card">
          <button class="po-auth-x">✕</button>
          <h2 id="po-auth-title">Sign in to Protein Outfitters</h2>
          <p>We'll email you a one-tap sign-in link. No passwords.</p>
          <div class="po-auth-role">
            <button data-role="buyer" class="active">I'm a buyer</button>
            <button data-role="producer">I'm a farmer</button>
            <button data-role="processor">I'm a processor</button>
          </div>
          <input id="po-auth-email" type="email" placeholder="you@email.com" autocomplete="email">
          <button class="primary" id="po-auth-go">Email me a sign-in link</button>
          <div id="po-auth-result" style="display:none"></div>
        </div>`;
      document.body.appendChild(back);
      back.addEventListener('click', e => { if (e.target === back) back.classList.remove('open'); });
      back.querySelector('.po-auth-x').addEventListener('click', () => back.classList.remove('open'));
      const roleBtns = back.querySelectorAll('.po-auth-role button');
      let chosenRole = defaultRole;
      roleBtns.forEach(b => b.addEventListener('click', () => {
        roleBtns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        chosenRole = b.dataset.role;
      }));
      back.querySelector('#po-auth-go').addEventListener('click', async () => {
        const input = back.querySelector('#po-auth-email');
        const email = input.value.trim();
        const result = back.querySelector('#po-auth-result');
        const btn = back.querySelector('#po-auth-go');
        if (!email.includes('@')) { input.focus(); return; }
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const r = await api.requestLink(email, chosenRole);
          result.style.display = 'block';
          if (r.emailSent) {
            result.className = 'po-auth-result';
            result.innerHTML = `<strong>✓ Check your inbox.</strong> We sent a sign-in link to <strong>${email}</strong>. The link expires in 30 minutes.`;
          } else if (r.devLink) {
            result.className = 'po-auth-result';
            result.innerHTML = `<strong>Dev mode</strong> — email service not yet configured. <a href="${r.devLink}">Click here to sign in</a> (link expires in 30 min).`;
          } else {
            result.innerHTML = '<strong>✓ Check your inbox.</strong>';
          }
          btn.textContent = 'Send another';
          btn.disabled = false;
        } catch (e) {
          result.style.display = 'block';
          result.innerHTML = `<strong>Error:</strong> ${e.message}`;
          btn.disabled = false; btn.textContent = 'Try again';
        }
      });
    }
    back.querySelector('#po-auth-title').textContent = prompt;
    const defaultBtn = back.querySelector(`[data-role="${defaultRole}"]`);
    if (defaultBtn) {
      back.querySelectorAll('.po-auth-role button').forEach(x => x.classList.remove('active'));
      defaultBtn.classList.add('active');
    }
    back.classList.add('open');
    setTimeout(() => back.querySelector('#po-auth-email').focus(), 100);
  }

  api.openAuth = openAuth;
})();

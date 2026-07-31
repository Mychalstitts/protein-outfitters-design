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
    updateProfile: (patch) => jsonFetch('/api/auth/me', { method: 'PATCH', body: patch }),
    requestLink: (email, role, nextOverride) => jsonFetch('/api/auth/request-link', { method: 'POST', body: {
      email, role,
      // Thread the captured referral code + current path through sign-in so the
      // magic link carries ?ref= and /api/auth/verify can attribute the
      // redemption (otherwise referral rewards never fire on email signup).
      // nextOverride lets reserve-sheet hand back a deep link (listing + open sheet).
      ref: (() => { try { return localStorage.getItem('po_ref_code') || undefined; } catch { return undefined; } })(),
      next: (() => {
        if (nextOverride && typeof nextOverride === 'string' && nextOverride.startsWith('/') && !nextOverride.startsWith('//')) {
          return nextOverride;
        }
        try { const p = location.pathname + location.search; return (p && p !== '/') ? p : undefined; } catch { return undefined; }
      })(),
    } }),
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
    updateFarm: (slug, data) => jsonFetch('/api/farms?slug=' + encodeURIComponent(slug), { method: 'PATCH', body: data }),

    // Social
    socialPosts: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return jsonFetch('/api/social-posts' + (q ? '?' + q : ''));
    },
    createSocialPost: (data) => jsonFetch('/api/social-posts', { method: 'POST', body: data }),
    deleteSocialPost: (id) => jsonFetch('/api/social-posts?id=' + encodeURIComponent(id), { method: 'DELETE' }),
    socialFeed: (mode = 'network', limit = 40) =>
      jsonFetch('/api/social-feed?mode=' + encodeURIComponent(mode) + '&limit=' + limit),
    reactToPost: (post_id, emoji = 'heart') =>
      jsonFetch('/api/social-reactions', { method: 'POST', body: { post_id, emoji } }),
    socialComments: (post_id) =>
      jsonFetch('/api/social-comments?post_id=' + encodeURIComponent(post_id)),
    createSocialComment: (post_id, body) =>
      jsonFetch('/api/social-comments', { method: 'POST', body: { post_id, body } }),
    deleteSocialComment: (id) =>
      jsonFetch('/api/social-comments?id=' + encodeURIComponent(id), { method: 'DELETE' }),

    // Multipart photo/PDF upload → Vercel Blob. Returns { ok, url, content_type, kind }.
    // Does not use jsonFetch (must not force Content-Type: application/json on FormData).
    upload: async (file, opts = {}) => {
      if (!file) throw Object.assign(new Error('No file'), { status: 400 });
      const fd = new FormData();
      fd.append(opts.field || 'file', file);
      const r = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
      let data = null;
      try { data = await r.json(); } catch { /* empty */ }
      if (!r.ok) {
        const e = new Error((data && data.error) || `HTTP ${r.status}`);
        e.status = r.status; e.data = data;
        throw e;
      }
      return data;
    },

    // Farm follows — used by the Follow button on farm-profile.html
    farmFollowState: (farm_id) => jsonFetch('/api/farm-follow?farm_id=' + encodeURIComponent(farm_id)),
    followFarm:     (farm_id) => jsonFetch('/api/farm-follow', { method: 'POST', body: { farm_id } }),
    unfollowFarm:   (farm_id) => jsonFetch('/api/farm-follow?farm_id=' + encodeURIComponent(farm_id), { method: 'DELETE' }),

    reservations: () => jsonFetch('/api/reservations'),
    reserve: (data) => jsonFetch('/api/reservations', { method: 'POST', body: data }),

    // Cut sheets — used by /cut-sheet to file real cut instructions for a reservation
    cutSheet: (reservation_id) => jsonFetch('/api/cut-sheets?reservation_id=' + encodeURIComponent(reservation_id)),
    submitCutSheet: (data) => jsonFetch('/api/cut-sheets', { method: 'POST', body: data }),

    // Payouts — Stripe Connect transfer from producer/processor balance to bank
    payouts: () => jsonFetch('/api/payouts'),
    transferToBank: (role, amount_cents) => jsonFetch('/api/payouts', { method: 'POST', body: amount_cents ? { role, amount_cents } : { role } }),

    processors: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return jsonFetch('/api/processors' + (q ? '?' + q : ''));
    },
    myProcessors: () => jsonFetch('/api/processors?owner=me'),
    processor: (slug) => jsonFetch('/api/processors?slug=' + encodeURIComponent(slug)),
    createProcessor: (data) => jsonFetch('/api/processors', { method: 'POST', body: data }),
    claimProcessor: (claim) => jsonFetch('/api/processors', {
      method: 'POST',
      body: typeof claim === 'string' ? { claim_id: claim } : claim,
    }),
    updateProcessor: (slug, data) => jsonFetch('/api/processors?slug=' + encodeURIComponent(slug), { method: 'PATCH', body: data }),

    // Processor daily ops dashboard
    processorOps: (view = 'today') => jsonFetch('/api/processor-ops?view=' + encodeURIComponent(view)),
    processorOpsStats: () => jsonFetch('/api/processor-ops?view=stats'),

    // Bookings status updates (used by processor-ops action buttons)
    updateBooking: (id, patch) => jsonFetch('/api/bookings?id=' + encodeURIComponent(id), { method: 'PATCH', body: patch }),

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
    markAllNotificationsRead: () => jsonFetch('/api/notifications?all=1', { method: 'PATCH' }),

    // ─ Push notifications ─
    // Idempotent: re-running on an already-subscribed device upserts at the
    // server. Returns { ok, attached_user } on success, or { ok: false, reason }
    // when the browser refused permission or VAPID isn't configured.
    enablePushNotifications: async () => {
      if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        const cfg = await fetch('/api/push-subscribe').then(r => r.json());
        if (!cfg.vapid_public_key) return { ok: false, reason: 'vapid-not-configured' };
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return { ok: false, reason: 'permission-denied' };
        const reg = await navigator.serviceWorker.ready;
        // Existing sub? Reuse so we don't rotate keys on every call.
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          // PushManager wants the public key as a Uint8Array, not base64url.
          const raw = cfg.vapid_public_key.replace(/-/g, '+').replace(/_/g, '/');
          const pad = (4 - (raw.length % 4)) % 4;
          const bin = atob(raw + '='.repeat(pad));
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8 });
        }
        const r = await jsonFetch('/api/push-subscribe', { method: 'POST', body: sub.toJSON() });
        return { ok: true, ...r };
      } catch (e) {
        return { ok: false, reason: e.message || 'subscribe-failed' };
      }
    },
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

  function openAuth(prompt = 'Sign in', defaultRole = 'buyer', opts = {}) {
    injectAuthStyles();
    // opts.next — absolute path for post-magic-link redirect (e.g. resume reserve sheet)
    const nextOverride = (opts && typeof opts.next === 'string' && opts.next.startsWith('/') && !opts.next.startsWith('//'))
      ? opts.next
      : null;
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
      // chosenRole lives on the element so reopen can reset it without rebinding
      back._chosenRole = defaultRole;
      roleBtns.forEach(b => b.addEventListener('click', () => {
        roleBtns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        back._chosenRole = b.dataset.role;
      }));
      back.querySelector('#po-auth-go').addEventListener('click', async () => {
        const input = back.querySelector('#po-auth-email');
        const email = input.value.trim();
        const result = back.querySelector('#po-auth-result');
        const btn = back.querySelector('#po-auth-go');
        if (!email.includes('@')) { input.focus(); return; }
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const r = await api.requestLink(email, back._chosenRole || 'buyer', back._nextOverride || null);
          result.style.display = 'block';
          if (r.emailSent) {
            result.className = 'po-auth-result';
            result.innerHTML = `<strong>✓ Check your inbox.</strong> We sent a sign-in link to <strong>${email}</strong>. The link expires in 30 minutes.` +
              (back._nextOverride ? ` After you sign in you'll return to finish your reservation.` : '');
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
    back._nextOverride = nextOverride;
    back._chosenRole = defaultRole;
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

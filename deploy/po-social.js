/* ============================================================
   PO Social — journey timelines + profile walls + following feed
   ============================================================ */
(function () {
  'use strict';

  const MILESTONE_LABEL = {
    listed: 'Listed',
    first_share_sold: 'First sale',
    fully_sold: 'Fully sold',
    plant_booked: 'Plant booked',
    checked_in: 'At the plant',
    ready: 'Ready',
    picked_up: 'Picked up',
    review_unlocked: 'Reviews',
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 48) return h + 'h';
    const d = Math.floor(h / 24);
    if (d < 14) return d + 'd';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function initial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function renderPost(p, opts = {}) {
    const isMile = p.kind === 'milestone';
    const isThanks = p.kind === 'thanks';
    const isPrivate = p.visibility === 'participants';
    const hearts = (p.reaction_counts && p.reaction_counts.heart) || 0;
    const mine = (p.my_reactions || []).includes('heart');
    const media = (p.media_urls || []).map(u =>
      `<img class="po-soc-media" src="${esc(u)}" alt="" loading="lazy" />`
    ).join('');
    let chip = '';
    if (isMile && p.milestone) {
      chip = `<span class="po-soc-chip">${esc(MILESTONE_LABEL[p.milestone] || p.milestone)}</span>`;
    } else if (isThanks) {
      chip = `<span class="po-soc-chip po-soc-chip--thanks">Thanks</span>`;
    } else if (isPrivate) {
      chip = `<span class="po-soc-chip po-soc-chip--private">Participants only</span>`;
    }
    const subject = opts.showSubject && p.subject_name
      ? `<span class="po-soc-subject"> · ${esc(p.subject_name)}</span>`
      : '';

    return `<article class="po-soc-post${isMile ? ' is-milestone' : ''}${isPrivate ? ' is-private' : ''}${isThanks ? ' is-thanks' : ''}" data-post-id="${esc(p.id)}">
      <div class="po-soc-avatar" aria-hidden="true">${esc(initial(p.author_name))}</div>
      <div class="po-soc-body">
        <div class="po-soc-meta">
          <strong>${esc(p.author_name || 'Member')}</strong>${subject}
          <span class="po-soc-time">${esc(timeAgo(p.created_at))}</span>
          ${chip}
        </div>
        ${p.body ? `<p class="po-soc-text">${esc(p.body)}</p>` : ''}
        ${media ? `<div class="po-soc-media-row">${media}</div>` : ''}
        <div class="po-soc-actions">
          <button type="button" class="po-soc-react${mine ? ' on' : ''}" data-react="${esc(p.id)}" aria-label="Appreciate">
            ♥ <span data-count>${hearts || ''}</span>
          </button>
          <button type="button" class="po-soc-comment-toggle" data-comments="${esc(p.id)}">
            Comment${p.comment_count ? ' · ' + p.comment_count : ''}
          </button>
        </div>
        <div class="po-soc-thread" data-thread="${esc(p.id)}" hidden></div>
      </div>
    </article>`;
  }

  function wirePostActions(root) {
    root.querySelectorAll('[data-react]').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const id = btn.dataset.react;
        try {
          const r = await fetch('/api/social-reactions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: id, emoji: 'heart' }),
          });
          if (r.status === 401) {
            window.PO_API?.openAuth?.('Sign in to appreciate this', 'buyer');
            return;
          }
          const data = await r.json();
          btn.classList.toggle('on', !!data.reacted);
          const c = btn.querySelector('[data-count]');
          if (c) c.textContent = data.count ? String(data.count) : '';
        } catch (_) { /* ignore */ }
      });
    });

    root.querySelectorAll('[data-comments]').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const id = btn.dataset.comments;
        const thread = root.querySelector(`[data-thread="${id}"]`);
        if (!thread) return;
        if (!thread.hidden && thread.dataset.loaded) {
          thread.hidden = true;
          return;
        }
        thread.hidden = false;
        thread.innerHTML = '<p class="po-soc-empty">Loading…</p>';
        try {
          const r = await fetch('/api/social-comments?post_id=' + encodeURIComponent(id), { credentials: 'include' });
          const data = await r.json();
          const comments = data.comments || [];
          thread.dataset.loaded = '1';
          thread.innerHTML = comments.map(c => `
            <div class="po-soc-comment">
              <strong>${esc(c.author_name)}</strong>
              <span class="po-soc-time">${esc(timeAgo(c.created_at))}</span>
              <p>${esc(c.body)}</p>
            </div>`).join('') + `
            <form class="po-soc-comment-form" data-post="${esc(id)}">
              <input name="body" type="text" maxlength="1000" placeholder="Add a kind word…" required />
              <button type="submit">Post</button>
            </form>`;
          thread.querySelector('form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = e.target.body;
            const text = input.value.trim();
            if (!text) return;
            const res = await fetch('/api/social-comments', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ post_id: id, body: text }),
            });
            if (res.status === 401) {
              window.PO_API?.openAuth?.('Sign in to comment', 'buyer');
              return;
            }
            if (!res.ok) return;
            input.value = '';
            delete thread.dataset.loaded;
            btn.click();
            btn.click();
          });
        } catch (_) {
          thread.innerHTML = '<p class="po-soc-empty">Could not load comments.</p>';
        }
      });
    });
  }

  function composerHtml(placeholder, opts = {}) {
    const vis = opts.allowParticipants
      ? `<label class="po-soc-vis">
          <select name="visibility">
            <option value="public">Public on journey</option>
            <option value="participants">Participants only (cooler / floor)</option>
          </select>
        </label>`
      : '';
    return `<form class="po-soc-composer">
      <textarea name="body" rows="3" maxlength="2000" placeholder="${esc(placeholder)}"></textarea>
      <div class="po-soc-composer-foot">
        <label class="po-soc-photo-btn">
          <input type="file" name="photo" accept="image/*" hidden />
          + Photo
        </label>
        <span class="po-soc-photo-name" data-photo-name></span>
        ${vis}
        <button type="submit" class="po-soc-submit">Share →</button>
      </div>
      <p class="po-soc-status" data-status></p>
    </form>`;
  }

  async function uploadPhoto(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data.url || data.href || data.downloadUrl;
  }

  function wireComposer(form, { subjectType, subjectId, listingId, kind, onPosted, defaultVisibility }) {
    let pendingUrl = null;
    const fileInput = form.querySelector('input[type="file"]');
    const nameEl = form.querySelector('[data-photo-name]');
    const status = form.querySelector('[data-status]');
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (nameEl) nameEl.textContent = f ? f.name : '';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = form.body.value.trim();
      const file = fileInput?.files?.[0];
      if (!body && !file) {
        if (status) status.textContent = 'Write something or add a photo.';
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sharing…';
      if (status) status.textContent = '';
      try {
        let media_urls = [];
        if (file) {
          const url = await uploadPhoto(file);
          if (url) media_urls = [url];
        } else if (pendingUrl) media_urls = [pendingUrl];
        const visibility = form.visibility?.value || defaultVisibility || 'public';
        const r = await fetch('/api/social-posts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_type: subjectType,
            subject_id: subjectId,
            listing_id: listingId || undefined,
            body: body || null,
            media_urls,
            kind: kind || (media_urls.length ? 'photo' : 'update'),
            visibility,
            cooler: visibility === 'participants',
          }),
        });
        if (r.status === 401) {
          window.PO_API?.openAuth?.('Sign in to post', 'buyer');
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not post');
        form.body.value = '';
        if (fileInput) fileInput.value = '';
        if (nameEl) nameEl.textContent = '';
        pendingUrl = null;
        if (status) {
          status.textContent = visibility === 'participants'
            ? 'Shared with participants only (buyers, farm, plant).'
            : 'Shared.';
        }
        onPosted?.(data.post);
      } catch (err) {
        if (status) status.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Share →';
      }
    });
  }

  async function mountWall(el, opts = {}) {
    if (!el) return;
    const { subjectType, subjectId, canPost = false, emptyText } = opts;
    el.classList.add('po-soc');
    el.innerHTML = `
      ${canPost ? composerHtml(opts.placeholder || "What's happening on the land today?") : ''}
      <div class="po-soc-list" data-list><p class="po-soc-empty">Loading community…</p></div>`;
    const list = el.querySelector('[data-list]');
    const form = el.querySelector('.po-soc-composer');
    if (form) {
      wireComposer(form, {
        subjectType,
        subjectId,
        onPosted: () => mountWall(el, opts),
      });
    }
    try {
      const r = await fetch(
        `/api/social-posts?subject_type=${encodeURIComponent(subjectType)}&subject_id=${encodeURIComponent(subjectId)}&limit=40`,
        { credentials: 'include' }
      );
      const data = await r.json();
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">${esc(emptyText || 'No posts yet — be the first voice here.')}</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p)).join('');
      wirePostActions(list);
    } catch (_) {
      list.innerHTML = '<p class="po-soc-empty">Community feed unavailable.</p>';
    }
  }

  async function mountJourney(el, opts = {}) {
    if (!el) return;
    const { listingId, canPost = false, canThanks = false } = opts;
    el.classList.add('po-soc', 'po-soc--journey');
    const thanksBtn = canThanks
      ? `<button type="button" class="po-soc-thanks-btn" data-thanks>Say thanks to the ranch →</button>`
      : '';
    el.innerHTML = `
      <div class="po-soc-journey-head">
        <h3>Animal journey</h3>
        <p>From pasture to plant to freezer — the story of this animal.</p>
        ${thanksBtn}
      </div>
      ${canPost ? composerHtml('Share a ranch note, cooler photo, or floor update…', { allowParticipants: true }) : ''}
      <div class="po-soc-list" data-list><p class="po-soc-empty">Loading journey…</p></div>`;
    const list = el.querySelector('[data-list]');
    const form = el.querySelector('.po-soc-composer');
    if (form) {
      wireComposer(form, {
        subjectType: 'listing',
        subjectId: listingId,
        listingId,
        defaultVisibility: 'public',
        onPosted: () => mountJourney(el, opts),
      });
    }
    el.querySelector('[data-thanks]')?.addEventListener('click', async () => {
      const msg = prompt('A short thank-you to the people who raised and cut this animal:', 'Thank you for the care you put into this animal.');
      if (msg == null) return;
      const body = msg.trim();
      if (!body) return;
      try {
        const r = await fetch('/api/social-posts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_type: 'listing',
            subject_id: listingId,
            listing_id: listingId,
            kind: 'thanks',
            body,
            visibility: 'public',
          }),
        });
        if (r.status === 401) {
          window.PO_API?.openAuth?.('Sign in to say thanks', 'buyer');
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not post');
        mountJourney(el, opts);
      } catch (err) {
        alert(err.message);
      }
    });
    try {
      const r = await fetch(
        `/api/social-posts?listing_id=${encodeURIComponent(listingId)}&limit=50`,
        { credentials: 'include' }
      );
      const data = await r.json();
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">When this animal sells and heads to the plant, the journey appears here.</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p)).join('');
      wirePostActions(list);
    } catch (_) {
      list.innerHTML = '<p class="po-soc-empty">Journey unavailable.</p>';
    }
  }

  async function mountFeed(el, opts = {}) {
    if (!el) return;
    const mode = opts.mode || 'network';
    el.classList.add('po-soc');
    el.innerHTML = `<div class="po-soc-list" data-list><p class="po-soc-empty">Loading…</p></div>`;
    const list = el.querySelector('[data-list]');
    try {
      const r = await fetch(`/api/social-feed?mode=${encodeURIComponent(mode)}&limit=40`, { credentials: 'include' });
      if (r.status === 401 && mode === 'following') {
        list.innerHTML = `<p class="po-soc-empty">Sign in to see ranches and plants you follow. <button type="button" class="po-soc-signin">Sign in</button></p>`;
        list.querySelector('.po-soc-signin')?.addEventListener('click', () => {
          window.PO_API?.openAuth?.('Sign in for your community feed', 'buyer', { next: location.pathname });
        });
        return;
      }
      const data = await r.json();
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">${mode === 'following'
          ? 'Follow ranches and plants to fill this feed — or reserve an animal to join its journey.'
          : 'No community posts yet. Farms and plants will share here as animals move.'}</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p, { showSubject: true })).join('');
      wirePostActions(list);
    } catch (_) {
      list.innerHTML = '<p class="po-soc-empty">Feed unavailable.</p>';
    }
  }

  window.PO_SOCIAL = { mountWall, mountJourney, mountFeed, renderPost };
})();

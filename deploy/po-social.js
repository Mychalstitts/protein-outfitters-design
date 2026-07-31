/* ============================================================
   PO Social — real posts, hearts, comments, photo upload
   Walls (farm/plant), journey (listing), community feed
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

  function subjectHref(p) {
    if (p.subject_type === 'farm' && p.subject_slug) return '/farm/' + encodeURIComponent(p.subject_slug);
    if (p.subject_type === 'processor' && p.subject_slug) return '/p/' + encodeURIComponent(p.subject_slug);
    if (p.listing_id || (p.subject_type === 'listing' && p.subject_id)) {
      return '/listing?id=' + encodeURIComponent(p.listing_id || p.subject_id);
    }
    return null;
  }

  function renderPost(p, opts = {}) {
    const isMile = p.kind === 'milestone';
    const isThanks = p.kind === 'thanks';
    const isPrivate = p.visibility === 'participants';
    const hearts = (p.reaction_counts && p.reaction_counts.heart) || 0;
    const mine = (p.my_reactions || []).includes('heart');
    const media = (p.media_urls || []).map(u =>
      `<a class="po-soc-media-link" href="${esc(u)}" target="_blank" rel="noopener">
         <img class="po-soc-media" src="${esc(u)}" alt="" loading="lazy" />
       </a>`
    ).join('');
    let chip = '';
    if (isMile && p.milestone) {
      chip = `<span class="po-soc-chip">${esc(MILESTONE_LABEL[p.milestone] || p.milestone)}</span>`;
    } else if (isThanks) {
      chip = `<span class="po-soc-chip po-soc-chip--thanks">Thanks</span>`;
    } else if (isPrivate) {
      chip = `<span class="po-soc-chip po-soc-chip--private">Participants only</span>`;
    }
    let subject = '';
    if (opts.showSubject && p.subject_name) {
      const href = subjectHref(p);
      subject = href
        ? `<a class="po-soc-subject" href="${esc(href)}"> · ${esc(p.subject_name)}</a>`
        : `<span class="po-soc-subject"> · ${esc(p.subject_name)}</span>`;
    }
    const canDelete = !!p.can_delete;
    const avatarStyle = p.author_avatar
      ? ` style="background-image:url('${esc(p.author_avatar)}');background-size:cover;background-position:center"`
      : '';

    return `<article class="po-soc-post${isMile ? ' is-milestone' : ''}${isPrivate ? ' is-private' : ''}${isThanks ? ' is-thanks' : ''}" data-post-id="${esc(p.id)}">
      <div class="po-soc-avatar"${avatarStyle} aria-hidden="true">${p.author_avatar ? '' : esc(initial(p.author_name))}</div>
      <div class="po-soc-body">
        <div class="po-soc-meta">
          <strong>${esc(p.author_name || 'Member')}</strong>${subject}
          <span class="po-soc-time">${esc(timeAgo(p.created_at))}</span>
          ${chip}
          ${canDelete ? `<button type="button" class="po-soc-delete" data-delete="${esc(p.id)}" aria-label="Delete post">Delete</button>` : ''}
        </div>
        ${p.body ? `<p class="po-soc-text">${esc(p.body)}</p>` : ''}
        ${media ? `<div class="po-soc-media-row">${media}</div>` : ''}
        <div class="po-soc-actions">
          <button type="button" class="po-soc-react${mine ? ' on' : ''}" data-react="${esc(p.id)}" aria-pressed="${mine ? 'true' : 'false'}" aria-label="Like">
            <span class="po-soc-heart" aria-hidden="true">${mine ? '♥' : '♡'}</span>
            <span data-count>${hearts || ''}</span>
          </button>
          <button type="button" class="po-soc-comment-toggle" data-comments="${esc(p.id)}" aria-expanded="false">
            Comment${p.comment_count ? ' · ' + p.comment_count : ''}
          </button>
        </div>
        <div class="po-soc-thread" data-thread="${esc(p.id)}" hidden></div>
      </div>
    </article>`;
  }

  async function apiJson(url, opts = {}) {
    const r = await fetch(url, {
      credentials: 'include',
      headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {}),
      ...opts,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    let data = null;
    try { data = await r.json(); } catch { /* empty */ }
    if (!r.ok) {
      const e = new Error((data && data.error) || ('HTTP ' + r.status));
      e.status = r.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  function wirePostActions(root, { onChanged } = {}) {
    root.querySelectorAll('[data-react]').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const id = btn.dataset.react;
        const wasOn = btn.classList.contains('on');
        const countEl = btn.querySelector('[data-count]');
        const heartEl = btn.querySelector('.po-soc-heart');
        const prev = parseInt(countEl?.textContent || '0', 10) || 0;
        // Optimistic
        btn.classList.toggle('on', !wasOn);
        btn.setAttribute('aria-pressed', wasOn ? 'false' : 'true');
        if (heartEl) heartEl.textContent = wasOn ? '♡' : '♥';
        if (countEl) {
          const n = Math.max(0, prev + (wasOn ? -1 : 1));
          countEl.textContent = n ? String(n) : '';
        }
        try {
          const data = await apiJson('/api/social-reactions', {
            method: 'POST',
            body: { post_id: id, emoji: 'heart' },
          });
          btn.classList.toggle('on', !!data.reacted);
          btn.setAttribute('aria-pressed', data.reacted ? 'true' : 'false');
          if (heartEl) heartEl.textContent = data.reacted ? '♥' : '♡';
          if (countEl) countEl.textContent = data.count ? String(data.count) : '';
        } catch (err) {
          // roll back
          btn.classList.toggle('on', wasOn);
          btn.setAttribute('aria-pressed', wasOn ? 'true' : 'false');
          if (heartEl) heartEl.textContent = wasOn ? '♥' : '♡';
          if (countEl) countEl.textContent = prev ? String(prev) : '';
          if (err.status === 401) {
            window.PO_API?.openAuth?.('Sign in to like this', 'buyer', { next: location.pathname + location.hash });
          }
        }
      });
    });

    root.querySelectorAll('[data-delete]').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        const id = btn.dataset.delete;
        try {
          await apiJson('/api/social-posts?id=' + encodeURIComponent(id), { method: 'DELETE' });
          const article = btn.closest('.po-soc-post');
          article?.remove();
          onChanged?.();
        } catch (err) {
          if (err.status === 401) window.PO_API?.openAuth?.('Sign in to delete', 'buyer');
          else alert(err.message || 'Could not delete');
        }
      });
    });

    root.querySelectorAll('[data-comments]').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        const id = btn.dataset.comments;
        const thread = root.querySelector(`[data-thread="${id}"]`);
        if (!thread) return;

        if (!thread.hidden && thread.dataset.open === '1') {
          thread.hidden = true;
          thread.dataset.open = '0';
          btn.setAttribute('aria-expanded', 'false');
          return;
        }

        thread.hidden = false;
        thread.dataset.open = '1';
        btn.setAttribute('aria-expanded', 'true');
        thread.innerHTML = '<p class="po-soc-empty">Loading comments…</p>';

        try {
          await renderThread(thread, id, btn);
        } catch (_) {
          thread.innerHTML = '<p class="po-soc-empty">Could not load comments.</p>';
        }
      });
    });
  }

  async function renderThread(thread, postId, toggleBtn) {
    const data = await apiJson('/api/social-comments?post_id=' + encodeURIComponent(postId));
    const comments = data.comments || [];
    const me = await window.PO_API?.me?.().catch(() => ({ user: null }));
    const uid = me?.user?.id;

    thread.innerHTML = `
      <div class="po-soc-comment-list">
        ${comments.length
          ? comments.map(c => `
            <div class="po-soc-comment" data-comment-id="${esc(c.id)}">
              <div class="po-soc-comment-head">
                <strong>${esc(c.author_name)}</strong>
                <span class="po-soc-time">${esc(timeAgo(c.created_at))}</span>
                ${uid && c.author_id === uid
                  ? `<button type="button" class="po-soc-comment-del" data-del-comment="${esc(c.id)}">Delete</button>`
                  : ''}
              </div>
              <p>${esc(c.body)}</p>
            </div>`).join('')
          : '<p class="po-soc-thread-empty">No comments yet — be the first.</p>'}
      </div>
      <form class="po-soc-comment-form" data-post="${esc(postId)}">
        <input name="body" type="text" maxlength="1000" placeholder="Add a comment…" autocomplete="off" required />
        <button type="submit">Post</button>
      </form>
      <p class="po-soc-status" data-cstatus></p>`;

    if (toggleBtn) {
      toggleBtn.textContent = 'Comment' + (comments.length ? ' · ' + comments.length : '');
    }

    thread.querySelectorAll('[data-del-comment]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await apiJson('/api/social-comments?id=' + encodeURIComponent(b.dataset.delComment), { method: 'DELETE' });
          await renderThread(thread, postId, toggleBtn);
        } catch (err) {
          alert(err.message || 'Could not delete');
        }
      });
    });

    const form = thread.querySelector('form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.body;
      const text = (input.value || '').trim();
      if (!text) return;
      const status = thread.querySelector('[data-cstatus]');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await apiJson('/api/social-comments', {
          method: 'POST',
          body: { post_id: postId, body: text },
        });
        input.value = '';
        await renderThread(thread, postId, toggleBtn);
      } catch (err) {
        if (err.status === 401) {
          window.PO_API?.openAuth?.('Sign in to comment', 'buyer', { next: location.pathname + location.hash });
        } else if (status) {
          status.textContent = err.message || 'Could not post comment';
        }
      } finally {
        submit.disabled = false;
      }
    });
  }

  function composerHtml(placeholder, opts = {}) {
    const vis = opts.allowParticipants
      ? `<label class="po-soc-vis">
          <select name="visibility">
            <option value="public">Public</option>
            <option value="participants">Participants only</option>
          </select>
        </label>`
      : '';
    return `<form class="po-soc-composer">
      <textarea name="body" rows="3" maxlength="2000" placeholder="${esc(placeholder)}"></textarea>
      <div class="po-soc-composer-foot">
        <label class="po-soc-photo-btn">
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          + Photo
        </label>
        <span class="po-soc-photo-name" data-photo-name></span>
        ${vis}
        <button type="submit" class="po-soc-submit">Share →</button>
      </div>
      <div class="po-soc-photo-preview" data-photo-preview hidden></div>
      <p class="po-soc-status" data-status></p>
    </form>`;
  }

  async function uploadPhoto(file) {
    if (window.PO_API?.upload) {
      const data = await window.PO_API.upload(file);
      return data.url || data.href || data.downloadUrl;
    }
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data.url || data.href || data.downloadUrl;
  }

  function wireComposer(form, { subjectType, subjectId, listingId, kind, onPosted, defaultVisibility }) {
    const fileInput = form.querySelector('input[type="file"]');
    const nameEl = form.querySelector('[data-photo-name]');
    const preview = form.querySelector('[data-photo-preview]');
    const status = form.querySelector('[data-status]');

    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (nameEl) nameEl.textContent = f ? f.name : '';
      if (preview) {
        if (f && f.type.startsWith('image/')) {
          const url = URL.createObjectURL(f);
          preview.hidden = false;
          preview.innerHTML = `<img src="${url}" alt="" />`;
        } else {
          preview.hidden = true;
          preview.innerHTML = '';
        }
      }
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
          if (status) status.textContent = 'Uploading photo…';
          const url = await uploadPhoto(file);
          if (url) media_urls = [url];
        }
        const visibility = form.visibility?.value || defaultVisibility || 'public';
        if (status) status.textContent = 'Posting…';
        const data = await apiJson('/api/social-posts', {
          method: 'POST',
          body: {
            subject_type: subjectType,
            subject_id: subjectId,
            listing_id: listingId || undefined,
            body: body || null,
            media_urls,
            kind: kind || (media_urls.length ? 'photo' : 'update'),
            visibility,
            cooler: visibility === 'participants',
          },
        });
        form.body.value = '';
        if (fileInput) fileInput.value = '';
        if (nameEl) nameEl.textContent = '';
        if (preview) { preview.hidden = true; preview.innerHTML = ''; }
        if (status) status.textContent = 'Shared.';
        onPosted?.(data.post);
      } catch (err) {
        if (err.status === 401) {
          window.PO_API?.openAuth?.('Sign in to post', 'buyer', { next: location.pathname + location.hash });
          if (status) status.textContent = 'Sign in required to post.';
        } else if (status) {
          status.textContent = err.message || 'Could not post';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Share →';
      }
    });
  }

  async function mountWall(el, opts = {}) {
    if (!el) return;
    const { subjectType, subjectId, canPost = false, emptyText, allowVisitorNote = false } = opts;
    el.classList.add('po-soc');

    // Anyone signed in can post a public note on farm/plant walls.
    // Owners get the same composer (canPost flag used for placeholder copy).
    let me = { user: null };
    try { me = await window.PO_API?.me?.() || { user: null }; } catch { me = { user: null }; }
    const signedIn = !!me.user;
    const openWall = (subjectType === 'farm' || subjectType === 'processor');
    const showComposer = canPost || (openWall && signedIn) || allowVisitorNote;

    let note = '';
    if (!signedIn && openWall) {
      note = `<p class="po-soc-hint"><button type="button" class="po-soc-signin-inline" data-signin>Sign in</button> to post, like, and comment on this wall.</p>`;
    } else if (signedIn && openWall && !canPost) {
      note = `<p class="po-soc-hint">Leave a public note — the ranch will see it here.</p>`;
    }

    el.innerHTML = `
      ${note}
      ${showComposer ? composerHtml(opts.placeholder || (canPost ? "What's happening on the land today?" : 'Leave a note for this ranch…')) : ''}
      <div class="po-soc-list" data-list><p class="po-soc-empty">Loading…</p></div>`;

    el.querySelector('[data-signin]')?.addEventListener('click', () => {
      window.PO_API?.openAuth?.('Sign in for community', 'buyer', { next: location.pathname + location.hash });
    });

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
      const data = await apiJson(
        `/api/social-posts?subject_type=${encodeURIComponent(subjectType)}&subject_id=${encodeURIComponent(subjectId)}&limit=40`
      );
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">${esc(emptyText || 'No posts yet — be the first voice here.')}</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p)).join('');
      wirePostActions(list, { onChanged: () => mountWall(el, opts) });
    } catch (err) {
      list.innerHTML = `<p class="po-soc-empty">${esc(err.message || 'Community feed unavailable.')}</p>`;
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
        await apiJson('/api/social-posts', {
          method: 'POST',
          body: {
            subject_type: 'listing',
            subject_id: listingId,
            listing_id: listingId,
            kind: 'thanks',
            body,
            visibility: 'public',
          },
        });
        mountJourney(el, opts);
      } catch (err) {
        if (err.status === 401) window.PO_API?.openAuth?.('Sign in to say thanks', 'buyer');
        else alert(err.message);
      }
    });
    try {
      const data = await apiJson(`/api/social-posts?listing_id=${encodeURIComponent(listingId)}&limit=50`);
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">When this animal sells and heads to the plant, the journey appears here.</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p)).join('');
      wirePostActions(list, { onChanged: () => mountJourney(el, opts) });
    } catch (err) {
      list.innerHTML = `<p class="po-soc-empty">${esc(err.message || 'Journey unavailable.')}</p>`;
    }
  }

  async function mountFeed(el, opts = {}) {
    if (!el) return;
    const mode = opts.mode || 'network';
    el.classList.add('po-soc');

    let me = { user: null };
    try { me = await window.PO_API?.me?.() || { user: null }; } catch { me = { user: null }; }

    const composer = me.user
      ? composerHtml(opts.placeholder || 'Share an update with the Protein Outfitters community…')
      : `<div class="po-soc-signin-card">
           <p>Sign in to post, like, and comment.</p>
           <button type="button" class="po-soc-signin" data-feed-signin>Sign in →</button>
         </div>`;

    el.innerHTML = `
      ${composer}
      <div class="po-soc-list" data-list><p class="po-soc-empty">Loading…</p></div>`;

    el.querySelector('[data-feed-signin]')?.addEventListener('click', () => {
      window.PO_API?.openAuth?.('Sign in for your community feed', 'buyer', { next: '/community' });
    });

    const form = el.querySelector('.po-soc-composer');
    if (form && me.user) {
      wireComposer(form, {
        subjectType: 'user',
        subjectId: me.user.id,
        onPosted: () => mountFeed(el, opts),
      });
    }

    const list = el.querySelector('[data-list]');
    try {
      let data;
      if (mode === 'following') {
        const r = await fetch(`/api/social-feed?mode=following&limit=40`, { credentials: 'include' });
        if (r.status === 401) {
          list.innerHTML = `<p class="po-soc-empty">Sign in to see ranches and plants you follow.
            <button type="button" class="po-soc-signin" data-follow-signin>Sign in</button></p>`;
          list.querySelector('[data-follow-signin]')?.addEventListener('click', () => {
            window.PO_API?.openAuth?.('Sign in for your community feed', 'buyer', { next: '/community' });
          });
          return;
        }
        data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Feed failed');
      } else {
        // Network = all public posts
        data = await apiJson('/api/social-posts?limit=40');
      }
      const posts = data.posts || [];
      if (!posts.length) {
        list.innerHTML = `<p class="po-soc-empty">${mode === 'following'
          ? 'Follow ranches and plants to fill this feed — or open Network to see public posts.'
          : 'No community posts yet. Be the first to share an update above.'}</p>`;
        return;
      }
      list.innerHTML = posts.map(p => renderPost(p, { showSubject: true })).join('');
      wirePostActions(list, { onChanged: () => mountFeed(el, opts) });
    } catch (err) {
      list.innerHTML = `<p class="po-soc-empty">${esc(err.message || 'Feed unavailable.')}</p>`;
    }
  }

  window.PO_SOCIAL = { mountWall, mountJourney, mountFeed, renderPost };
})();

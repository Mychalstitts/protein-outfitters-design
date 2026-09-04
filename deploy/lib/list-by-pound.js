/* List-by-pound builder — mounts on /list-animal?mode=pound */
(function () {
  'use strict';
  const root = document.getElementById('poundRoot');
  if (!root || root.hidden) return;
  const H = window.POStittsworth;
  if (!H) return;

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const params = new URLSearchParams(location.search);
  const state = {
    farmName: '',
    town: 'Blackduck',
    title: 'Finished Angus steer',
    species: 'beef',
    hangingPerLb: H.DEFAULT_HANGING_PER_LB.beef,
    hangingLb: H.DEFAULT_HANGING_LB.beef,
    shares: { whole: true, half: true, quarter: true },
    notes: '',
    number: params.get('number') || '',
    listingId: params.get('id') || '',
    locked: false,
    farmId: null,
    harvestWindowStart: null,
    harvestWindowEnd: null,
  };

  function $(id) { return document.getElementById(id); }

  function currentTown() { return H.resolveTown(state.town); }

  function renderTownSelect() {
    const sel = $('lbTown');
    if (!sel) return;
    sel.innerHTML = H.TOWNS.map((t) => {
      const selected = t.name === state.town ? ' selected' : '';
      return '<option value="' + t.name + '"' + selected + '>' + H.townSelectLabel(t) + '</option>';
    }).join('');
  }

  function applySpeciesDefaults(force) {
    const defs = H.hangingDefaults(state.species, { number: state.number, lockedDraft123: state.locked });
    if (force || !state.locked) {
      if (force || !state.hangingPerLb) state.hangingPerLb = defs.hangingPerLb;
      state.hangingLb = H.DEFAULT_HANGING_LB[H.normalizeSpecies(state.species)] || state.hangingLb;
    }
    if (defs.locked) {
      state.locked = true;
      state.hangingPerLb = H.LOCKED_DRAFT_HANGING_PER_LB;
    }
  }

  function paint() {
    const town = currentTown();
    const due = H.harvestDue(state.species, town, 1);
    const totals = H.shareTotals(state.hangingPerLb, state.hangingLb);
    const fee = H.platformFeeOnGross(totals.whole);
    const keep = H.farmerKeep(totals.whole);
    const wrap = H.cutWrapHint(state.hangingLb);
    const next = H.nextHarvestWindow(town);
    const feePct = Math.round(H.PLATFORM_FEE_RATE * 100);

    const keepEl = $('lbKeep'); if (keepEl) keepEl.textContent = money(0);
    const grossEl = $('lbGross'); if (grossEl) grossEl.textContent = money(0);
    const feeEl = $('lbFee'); if (feeEl) feeEl.textContent = money(0);
    const feeLab = $('lbFeeLab'); if (feeLab) feeLab.textContent = 'Fee ' + feePct + '%';
    const bookEl = $('lbBook'); if (bookEl) bookEl.textContent = '0';

    const compass = $('lbCompass');
    if (compass) compass.textContent = town.quadrant.charAt(0).toUpperCase() + town.quadrant.slice(1);
    const compassSub = $('lbCompassSub');
    if (compassSub) compassSub.textContent = town.name + ' · ' + town.miles + ' mi';

    const nextEl = $('lbNext');
    const nextSub = $('lbNextSub');
    if (next && nextEl) {
      nextEl.textContent = H.formatShort(next.headline);
      if (nextSub) {
        const rest = next.days.slice(1).map((d) => H.formatShort(d.date));
        nextSub.textContent = rest.length ? rest.join(' · ') : 'Trailer week on this town’s compass';
      }
    } else if (nextEl) {
      nextEl.textContent = 'None open';
      if (nextSub) nextSub.textContent = 'No leftover harvest slots in the next 90 days';
    }

    const killEl = $('lbKill'); if (killEl) killEl.textContent = money(due.kill);
    const killSub = $('lbKillSub');
    if (killSub) killSub.textContent = H.normalizeSpecies(state.species).replace(/^./, (c) => c.toUpperCase()) + ' · due before trailer leaves';
    const tripEl = $('lbTrip'); if (tripEl) tripEl.textContent = money(due.trip);
    const tripSub = $('lbTripSub');
    if (tripSub) tripSub.textContent = town.miles + ' mi one-way from Turtle River';

    const perLb = $('lbPerLb');
    if (perLb) {
      perLb.value = String(state.hangingPerLb);
      perLb.readOnly = !!state.locked;
    }
    const hangLb = $('lbHangLb');
    if (hangLb) hangLb.value = String(state.hangingLb);
    const lockHelp = $('lbLockHelp');
    if (lockHelp) {
      lockHelp.hidden = !state.locked;
      lockHelp.textContent = state.locked
        ? 'Draft 123 keeps its locked $4.50/lb hanging. This form will not overwrite that rate or publish the listing.'
        : '';
    }

    const whole = $('lbWhole'); if (whole) whole.textContent = money(totals.whole);
    const wholeSub = $('lbWholeSub');
    if (wholeSub) wholeSub.textContent = 'You keep ' + money(keep) + ' after ' + feePct + '% · processing is extra';
    const side = $('lbSide'); if (side) side.textContent = money(totals.half);
    const qtr = $('lbQuarter'); if (qtr) qtr.textContent = money(totals.quarter);
    const kt = $('lbKillTrip'); if (kt) kt.textContent = money(due.total);
    const wrapEl = $('lbWrapHint');
    if (wrapEl) wrapEl.textContent = 'Cut & wrap is a separate plant charge (~' + money(wrap) + ' at $0.90/hanging lb). Hanging price is the animal only.';

    document.querySelectorAll('[data-species]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-species') === state.species ? 'true' : 'false');
    });
    document.querySelectorAll('[data-share]').forEach((btn) => {
      const key = btn.getAttribute('data-share');
      btn.setAttribute('aria-pressed', state.shares[key] ? 'true' : 'false');
    });

    const title = $('lbTitle');
    if (title && title.value !== state.title) title.value = state.title;
    const farm = $('lbFarm');
    if (farm && farm.value !== state.farmName) farm.value = state.farmName;
    const notes = $('lbNotes');
    if (notes && notes.value !== state.notes) notes.value = state.notes;
  }

  function bind() {
    renderTownSelect();
    $('lbTown')?.addEventListener('change', (e) => { state.town = e.target.value; paint(); });
    $('lbFarm')?.addEventListener('input', (e) => { state.farmName = e.target.value; });
    $('lbTitle')?.addEventListener('input', (e) => { state.title = e.target.value; });
    $('lbNotes')?.addEventListener('input', (e) => { state.notes = e.target.value; });
    $('lbPerLb')?.addEventListener('input', (e) => {
      if (state.locked) { e.target.value = String(H.LOCKED_DRAFT_HANGING_PER_LB); return; }
      state.hangingPerLb = Number(e.target.value) || 0;
      paint();
    });
    $('lbHangLb')?.addEventListener('input', (e) => {
      state.hangingLb = Number(e.target.value) || 0;
      paint();
    });
    document.querySelectorAll('[data-species]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.species = btn.getAttribute('data-species');
        applySpeciesDefaults(true);
        paint();
      });
    });
    document.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-share');
        state.shares[key] = !state.shares[key];
        if (!state.shares.whole && !state.shares.half && !state.shares.quarter) {
          state.shares[key] = true;
        }
        paint();
      });
    });
    $('lbPublish')?.addEventListener('click', publish);
    $('lbBookTrailer')?.addEventListener('click', () => {
      const q = new URLSearchParams();
      q.set('town', state.town);
      q.set('species', state.species);
      if (state.listingId) q.set('listing', state.listingId);
      location.href = '/harvest?' + q.toString();
    });
  }

  async function ensureFarm() {
    if (!window.PO_API) throw Object.assign(new Error('API helper not loaded'), { status: 500 });
    const me = await window.PO_API.me().catch(() => ({ user: null }));
    if (!me.user) {
      const e = new Error('Sign in required'); e.status = 401; throw e;
    }
    const mine = await window.PO_API.myFarms().catch(() => ({ farms: [] }));
    if (mine.farms && mine.farms[0]) {
      state.farmId = mine.farms[0].id;
      if (!state.farmName) state.farmName = mine.farms[0].name || '';
      return mine.farms[0];
    }
    if (!state.farmName.trim()) {
      throw Object.assign(new Error('Add a farm name first'), { status: 400 });
    }
    const created = await window.PO_API.createFarm({
      name: state.farmName.trim(),
      city: currentTown().name,
      state: 'MN',
    });
    state.farmId = created.farm.id;
    return created.farm;
  }

  function listingBody(farmId) {
    const rates = H.shareTotals(state.hangingPerLb, state.hangingLb);
    const inv = H.listingShareInventory(state.shares);
    const shares = {
      whole: { available: inv.whole.available, reserved: 0, price: state.hangingPerLb },
      half: { available: inv.half.available, reserved: 0, price: state.hangingPerLb },
      quarter: { available: inv.quarter.available, reserved: 0, price: state.hangingPerLb },
    };
    const locked = state.locked || H.isLockedDraft123(state.number || state.title);
    const notes = (state.notes || '').trim();
    const processing = 'Processing (cut & wrap) is a separate plant charge at about $0.90/hanging lb. Hanging price is the animal only.';
    return {
      farm_id: farmId,
      number: locked ? '123' : (state.number || state.title || null),
      species: H.speciesToDb(state.species),
      description: [state.title, notes, processing].filter(Boolean).join('\n\n'),
      estimated_hanging_weight: state.hangingLb || null,
      price_per_lb: locked ? H.LOCKED_DRAFT_HANGING_PER_LB : state.hangingPerLb,
      shares: shares,
      harvest_window_start: state.harvestWindowStart || null,
      harvest_window_end: state.harvestWindowEnd || null,
      expected_finish_date: state.harvestWindowStart || null,
      status: locked || !state.harvestWindowStart ? 'draft' : 'active',
    };
  }

  async function publish() {
    const btn = $('lbPublish');
    const status = $('lbPublishStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const farm = await ensureFarm();
      const body = listingBody(farm.id || state.farmId);
      if (body.price_per_lb <= 0) throw new Error('Set a hanging $/lb greater than 0');
      if (!body.estimated_hanging_weight) throw new Error('Set estimated hanging lb');
      let result;
      if (state.listingId) {
        const patch = Object.assign({}, body);
        delete patch.farm_id;
        if (H.isLockedDraft123(body.number)) {
          patch.price_per_lb = H.LOCKED_DRAFT_HANGING_PER_LB;
          patch.status = 'draft';
        }
        result = await window.PO_API.updateListing(state.listingId, patch);
      } else {
        result = await window.PO_API.createListing(body);
        state.listingId = result?.listing?.id || '';
      }
      const listing = result?.listing || result;
      if (status) {
        const harvest = window.harvestLabel ? window.harvestLabel(listing) : 'TBD';
        status.textContent = listing?.status === 'draft'
          ? 'Saved as draft. Harvest window is ' + harvest + ' — finish → 30 months is required before this can go live. Draft 123 stays unpublished.'
          : 'Listing saved. Harvest ' + harvest + '. Book the trailer when you are ready.';
      }
      if (listing?.id) {
        const link = $('lbListingLink');
        if (link) { link.href = '/listing?id=' + encodeURIComponent(listing.id); link.hidden = false; }
      }
    } catch (e) {
      if (e.status === 401) {
        window.PO_API.openAuth('Sign in to list by the pound', 'producer', { next: location.pathname + location.search });
      } else if (status) {
        status.textContent = e.message || 'Could not save listing';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save listing'; }
    }
  }

  async function hydrate() {
    try {
      const meFarms = await window.PO_API?.myFarms?.();
      const farm = meFarms?.farms && meFarms.farms[0];
      if (farm) {
        state.farmName = farm.name || '';
        if (farm.city && H.TOWNS.some((t) => t.name.toLowerCase() === String(farm.city).toLowerCase())) {
          state.town = H.TOWNS.find((t) => t.name.toLowerCase() === String(farm.city).toLowerCase()).name;
        }
      }
    } catch (_) { /* anonymous ok */ }

    if (state.listingId && window.PO_API?.listing) {
      try {
        const data = await window.PO_API.listing(state.listingId);
        const l = data.listing || data;
        if (l) {
          state.number = l.number || state.number;
          state.title = l.number || l.breed || state.title;
          state.species = H.normalizeSpecies(l.species);
          state.hangingLb = Number(l.estimated_hanging_weight) || state.hangingLb;
          state.harvestWindowStart = l.harvest_window_start || l.expected_finish_date || null;
          state.harvestWindowEnd = l.harvest_window_end || null;
          if (H.isLockedDraft123(l.number) || Number(l.price_per_lb) === 4.5) {
            state.locked = true;
            state.hangingPerLb = H.LOCKED_DRAFT_HANGING_PER_LB;
          } else if (l.price_per_lb) {
            state.hangingPerLb = Number(l.price_per_lb);
          }
        }
      } catch (_) { /* keep defaults */ }
    }
    if (H.isLockedDraft123(state.number)) {
      state.locked = true;
      state.hangingPerLb = H.LOCKED_DRAFT_HANGING_PER_LB;
    }
    paint();
  }

  bind();
  applySpeciesDefaults(false);
  hydrate();
  paint();
})();

// Shared Stripe Connect status helpers for /farmer (and tests).
//
// connectPayoutsReady matches deploy/po-api.js: an Express account id is not
// enough — charges + payouts must be enabled (status active / charges_enabled
// / payouts_enabled). restricted and pending stay not-ready.
//
// Banner copy is reused from the existing stripe_connect= return handler.
(function (root) {
  'use strict';

  function connectPayoutsReady(row) {
    const status = String(row?.stripe_connect_status || row?.status || '').toLowerCase();
    return !!(row?.stripe_account_id && (
      status === 'active' || status === 'charges_enabled' || status === 'payouts_enabled'
    ));
  }

  function connectBannerState(row) {
    if (connectPayoutsReady(row)) return null;
    const status = String(row?.stripe_connect_status || row?.status || '').toLowerCase();
    const started = !!row?.stripe_account_id;
    const due = Array.isArray(row?.requirements_due) && row.requirements_due.length > 0;
    if (status === 'restricted' || due) {
      return {
        level: 'warn',
        status: 'restricted',
        message: 'Stripe still needs a few details before payouts can go to your bank.',
        resume: true,
        label: 'Continue Stripe →',
      };
    }
    if (started || status === 'pending') {
      return {
        level: 'warn',
        status: 'pending',
        message: 'Stripe is reviewing your account. Payouts unlock when verification finishes.',
        resume: true,
        label: 'Continue Stripe →',
      };
    }
    return {
      level: 'warn',
      status: 'not-started',
      message: 'Connect Stripe payouts — Get paid directly when buyers reserve',
      resume: true,
      label: 'Connect Stripe →',
    };
  }

  // Always keep the Connect row when it is still missing, then fill the rest
  // of the slot with the highest-weight remaining items. The old
  // sort-by-weight + slice(0, 3) dropped "Connect Stripe payouts" (weight 15)
  // behind list-animal / photo / story.
  function pinConnectMissing(missing, limit) {
    const cap = Number.isFinite(limit) ? limit : 3;
    const list = Array.isArray(missing) ? missing.slice() : [];
    const connect = list.filter((c) => c && c.action === 'connect');
    const others = list
      .filter((c) => !c || c.action !== 'connect')
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return connect.concat(others).slice(0, cap);
  }

  const api = { connectPayoutsReady, connectBannerState, pinConnectMissing };
  root.PO_CONNECT_STATUS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

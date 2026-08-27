// How a paid reservation deposit is split on the platform balance.
//
// Reserve charges the buyer a deposit only. The ranch books the locker later,
// so we do not invent a $225 processing transfer at checkout.
// Farmer share = the deposit. Anything else actually charged stays on platform.

export function depositSplit({ amountTotalCents, depositCents }) {
  const farmerCents = Math.max(0, Math.round(Number(depositCents) || 0));
  const charged = Math.max(0, Math.round(Number(amountTotalCents) || farmerCents));
  return {
    farmerCents,
    processorCents: 0,
    platformRetainCents: Math.max(0, charged - farmerCents),
  };
}

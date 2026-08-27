import { PLATFORM_FEE_RATE, farmerPayoutCents, platformFeeCents } from './fees.js';

// How a paid reservation deposit is split on the platform balance.
//
// Three money streams — do not mix them:
//   1. Marketplace meat: farmer's hanging-weight rate + 10% PO fee on that rate.
//      Farmer keeps 100% of their posted $/lb. PO keeps 10% of the meat line.
//   2. Plant fees: kill / cut / wrap. Farmer books the locker. Not on this charge.
//   3. Processor SaaS: plant pays PO for software. Not on this charge.
//
// Reserve charges the buyer a deposit only (10% of estimated meat, capped $50–$500).
// That 10% *deposit* is a hold, not the platform fee. On that deposit we keep 10%
// on the platform and transfer 90% to the farm. Do not invent a $225 processing
// transfer at checkout.

export function depositSplit({ amountTotalCents, depositCents }) {
  const deposit = Math.max(0, Math.round(Number(depositCents) || 0));
  const charged = Math.max(0, Math.round(Number(amountTotalCents) || deposit));
  const farmerCents = farmerPayoutCents(deposit);
  const extraOnCharge = Math.max(0, charged - deposit);
  return {
    farmerCents,
    processorCents: 0,
    platformRetainCents: platformFeeCents(deposit) + extraOnCharge,
    feeRate: PLATFORM_FEE_RATE,
  };
}

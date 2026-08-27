/**
 * Three money streams — do not mix them.
 *
 * 1. Marketplace meat: buyer pays the farmer's hanging-weight rate plus a
 *    Protein Outfitters fee of 10% of that rate. Farmer keeps 100% of their
 *    posted $/lb. PO keeps 10% of the meat line (deposit now, remainder at
 *    hanging-weight settlement).
 * 2. Plant fees: kill / cut / wrap the processor sets. Farmer books the locker.
 *    Buyer pays the plant at the plant. PO takes no cut.
 * 3. Processor SaaS: plant pays PO for software (see /processor-saas).
 *    That is the only thing the plant pays PO. No booking tax.
 *
 * The 10% *deposit* (capped $50–$500) is a hold on estimated meat. It is not
 * the platform fee. On that deposit charge we keep 10% on the platform and
 * transfer 90% to the farm.
 */
export const PLATFORM_FEE_RATE = 0.1;

export function platformFeeCents(meatCents) {
  const meat = Math.max(0, Math.round(Number(meatCents) || 0));
  return Math.round(meat * PLATFORM_FEE_RATE);
}

export function farmerPayoutCents(meatCents) {
  const meat = Math.max(0, Math.round(Number(meatCents) || 0));
  return meat - platformFeeCents(meat);
}

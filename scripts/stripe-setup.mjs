// One-off: creates 3 monthly HKD products in Stripe test mode and prints their price IDs.
// Run on a machine that can reach api.stripe.com (NOT the sandbox — egress there is policy-blocked):
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.mjs
// Then paste the printed price_… IDs into assets/billing-config.js.
import Stripe from 'stripe'; // npm i stripe  (dev-only; not a site dependency)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PLANS = [
  { key: 'all',       name: 'Kuafuor Pro (All-access)', amount: 7000 }, // HK$70.00
  { key: 'subtitle',  name: 'Subtitle Pro',             amount: 3000 }, // HK$30.00
  { key: 'motionlab', name: 'Motion Lab Pro',           amount: 5000 }, // HK$50.00
];
for (const p of PLANS) {
  const product = await stripe.products.create({ name: p.name, metadata: { product_key: p.key } });
  const price = await stripe.prices.create({
    product: product.id, currency: 'hkd', unit_amount: p.amount,
    recurring: { interval: 'month' }, metadata: { product_key: p.key },
  });
  console.log(`${p.key}: price=${price.id}  product=${product.id}`);
}

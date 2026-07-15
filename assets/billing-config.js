// PUBLIC config only. No secret keys here, ever. (Publishable + price IDs are public by design.)
export const BILLING = {
  SB_URL: 'https://ikzoxrvnpsseyjviawti.supabase.co',
  SB_KEY: 'sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O',
  EDGE_BASE: 'https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1',
  STRIPE_PK: 'pk_test_51TtIDUCC4yRJntm5eKGSpWN6nE7xE8xziAYoqZZ2K3MGdI4eqU6VDQtSIeniyR2uC12xqzdzlCNGRfxPvHRAV1Rr008yL4X4CD',
  // TODO: replace with the price IDs printed by scripts/stripe-setup.mjs (Stripe test mode).
  PRODUCTS: {
    all:       { price: 'price_REPLACE_ALL',       label: 'Kuafuor Pro',   monthly: 70 },
    subtitle:  { price: 'price_REPLACE_SUBTITLE',  label: 'Subtitle Pro',  monthly: 30 },
    motionlab: { price: 'price_REPLACE_MOTIONLAB', label: 'Motion Lab Pro', monthly: 50 },
  },
  SUBTITLE_FREE_PREVIEW_RATIO: 0.1,
};

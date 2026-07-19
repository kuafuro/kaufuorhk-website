// PUBLIC config only. No secret keys here, ever. (Publishable + price IDs are public by design.)
export const BILLING = {
  SB_URL: 'https://ikzoxrvnpsseyjviawti.supabase.co',
  SB_KEY: 'sb_publishable_dqWmcDGqfSq3Q8eU6V5HvA_pb2MUS-O',
  EDGE_BASE: 'https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1',
  STRIPE_PK: 'pk_live_51TtID5FxYGpzZTARORP8jSKuVV0vrzsXfyZcZ7YN8Q7diFZ7k6v5zYUIz8f9VKwllBqtv608CN8EpBZnR9JXKrHc00GncUnWuh',
  // Stripe LIVE price IDs (provisioned by setup-billing 2026-07-18). all:max 價由 Vault PRICE_ALL_MAX 供（server-side）。
  PRODUCTS: {
    all:       { price: 'price_1TuSIgFxYGpzZTARbHaAFzgQ', label: 'Kuafuor Pro',    monthly: 70,
                 maxLabel: 'Kuafuor Max', maxMonthly: 120 },
    subtitle:  { price: 'price_1TuSIhFxYGpzZTARzgYTkLSs', label: 'Subtitle Pro',   monthly: 30 },
    motionlab: { price: 'price_1TuSIiFxYGpzZTARxoiVp7zs', label: 'Motion Lab Pro', monthly: 50 },
  },
  SUBTITLE_FREE_PREVIEW_RATIO: 0.1,
};

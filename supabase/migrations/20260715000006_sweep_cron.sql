-- Hourly retention sweep for cloud-transcription audio (spec §7). Applied to ikzoxrvnpsseyjviawti
-- on 2026-07-15 via MCP. The real x-sweep-secret is NOT committed — it is set as the Supabase
-- Edge secret SWEEP_SECRET and embedded in the live cron job. Replace __SWEEP_SECRET__ below with
-- that same value if re-applying by hand. Until the secret matches, sweep-audio returns 403 (no-op).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sweep-subtitle-audio',
  '0 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://ikzoxrvnpsseyjviawti.supabase.co/functions/v1/sweep-audio',
      headers := '{"Content-Type":"application/json","x-sweep-secret":"__SWEEP_SECRET__"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);

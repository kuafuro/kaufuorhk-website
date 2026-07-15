-- Motion Lab freemium quota, SERVER-enforced (spec §8.2). Free coaches: 1 athlete + 3 sessions.
-- Holders of an active 'motionlab' or 'all' entitlement are unlimited. Enforced in the DB so it
-- can't be bypassed from the client. Existing rows grandfathered (fires on INSERT only). Applied 2026-07-15.
create or replace function public.enforce_motionlab_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if public.has_pro(new.owner, 'motionlab') then
    return new;                                  -- Pro: unlimited
  end if;
  if tg_table_name = 'athletes' then
    select count(*) into cnt from public.athletes where owner = new.owner;
    if cnt >= 1 then
      raise exception 'motionlab_free_quota_athletes' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'training_sessions' then
    select count(*) into cnt from public.training_sessions where owner = new.owner;
    if cnt >= 3 then
      raise exception 'motionlab_free_quota_sessions' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists athletes_quota on public.athletes;
create trigger athletes_quota before insert on public.athletes
  for each row execute function public.enforce_motionlab_quota();

drop trigger if exists sessions_quota on public.training_sessions;
create trigger sessions_quota before insert on public.training_sessions
  for each row execute function public.enforce_motionlab_quota();

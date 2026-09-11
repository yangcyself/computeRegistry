alter table public.sessions
  alter column heartbeat_interval_seconds set default 300,
  alter column heartbeat_timeout_seconds set default 600;

update public.sessions as s
set heartbeat_interval_seconds = 300,
    heartbeat_timeout_seconds = 600,
    updated_at = now()
where s.state in ('reserved'::public.session_state,'claimed'::public.session_state,'active'::public.session_state)
  and s.released_at is null
  and s.revoked_at is null;

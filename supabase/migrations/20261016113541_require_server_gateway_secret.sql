create table if not exists compute_private.gateway_config (
  singleton boolean primary key default true check (singleton),
  secret_hash text not null,
  updated_at timestamptz not null default now()
);

revoke all on table compute_private.gateway_config
  from public, anon, authenticated;

create or replace function compute_private.verify_gateway_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from compute_private.gateway_config as g
    where g.singleton = true
      and g.secret_hash = pg_catalog.encode(
        extensions.digest(coalesce(p_secret, ''), 'sha256'),
        'hex'
      )
  );
$$;

revoke all on function compute_private.verify_gateway_secret(text)
  from public, anon, authenticated;

create or replace function public.gateway_check_compute_public_session(
  p_gateway_secret text,
  p_public_status_id uuid,
  p_resource_version bigint default null,
  p_client_fingerprint text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if not compute_private.verify_gateway_secret(p_gateway_secret) then
    raise exception 'gateway authentication failed' using errcode = '42501';
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:global:' || left(coalesce(p_client_fingerprint, 'unknown'), 256),
    120,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:status:' || p_public_status_id::text || ':' || left(coalesce(p_client_fingerprint, 'unknown'), 256),
    30,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  return public.check_compute_public_session(p_public_status_id, p_resource_version);
end;
$$;

create or replace function public.gateway_report_compute_public_session(
  p_gateway_secret text,
  p_public_status_id uuid,
  p_resource_version bigint default null,
  p_compute_usage text default null,
  p_client_fingerprint text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if not compute_private.verify_gateway_secret(p_gateway_secret) then
    raise exception 'gateway authentication failed' using errcode = '42501';
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:global:' || left(coalesce(p_client_fingerprint, 'unknown'), 256),
    120,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:report:' || p_public_status_id::text || ':' || left(coalesce(p_client_fingerprint, 'unknown'), 256),
    30,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  return public.report_compute_public_session(
    p_public_status_id,
    p_resource_version,
    p_compute_usage
  );
end;
$$;

revoke all on function public.gateway_check_compute_public_session(text,uuid,bigint,text)
  from public, authenticated;
grant execute on function public.gateway_check_compute_public_session(text,uuid,bigint,text)
  to anon;

revoke all on function public.gateway_report_compute_public_session(text,uuid,bigint,text,text)
  from public, authenticated;
grant execute on function public.gateway_report_compute_public_session(text,uuid,bigint,text,text)
  to anon;

revoke execute on function public.check_compute_public_session(uuid,bigint)
  from public, anon, authenticated;
revoke execute on function public.report_compute_public_session(uuid,bigint,text)
  from public, anon, authenticated;

revoke execute on function public.claim_compute_session(text)
  from public, anon, authenticated;
revoke execute on function public.get_compute_session_bootstrap(text)
  from public, anon, authenticated;
revoke execute on function public.get_compute_session_token_status(text)
  from public, anon, authenticated;
revoke execute on function public.heartbeat_compute_session(text,bigint)
  from public, anon, authenticated;
revoke execute on function public.release_compute_session(text)
  from public, anon, authenticated;
revoke execute on function public.submit_compute_contribution(text,bigint,text,text,text)
  from public, anon, authenticated;

-- Configure the live gateway secret separately; never commit its plaintext.
-- Example, after hashing a high-entropy secret with SHA-256:
-- insert into compute_private.gateway_config(singleton, secret_hash)
-- values (true, '<sha256-hex>')
-- on conflict (singleton) do update
-- set secret_hash = excluded.secret_hash, updated_at = now();

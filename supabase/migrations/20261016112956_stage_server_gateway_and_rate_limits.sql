create table if not exists compute_private.public_gateway_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now()
);

revoke all on table compute_private.public_gateway_rate_limits
  from public, anon, authenticated;

create or replace function compute_private.consume_public_gateway_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_allowed boolean;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  v_key := pg_catalog.encode(
    extensions.digest(coalesce(p_bucket, ''), 'sha256'),
    'hex'
  );

  insert into compute_private.public_gateway_rate_limits as r (
    bucket_key, window_started_at, request_count, updated_at
  ) values (
    v_key, now(), 1, now()
  )
  on conflict (bucket_key) do update
  set window_started_at = case
        when r.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then now()
        else r.window_started_at
      end,
      request_count = case
        when r.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then 1
        else r.request_count + 1
      end,
      updated_at = now()
  returning request_count <= p_limit into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function compute_private.consume_public_gateway_rate_limit(text,integer,integer)
  from public, anon, authenticated;

create or replace function public.gateway_check_compute_public_session(
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
  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:global:' || coalesce(p_client_fingerprint, 'unknown'),
    120,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:status:' || p_public_status_id::text || ':' || coalesce(p_client_fingerprint, 'unknown'),
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
  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:global:' || coalesce(p_client_fingerprint, 'unknown'),
    120,
    600
  );

  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  v_allowed := compute_private.consume_public_gateway_rate_limit(
    'public-session:report:' || p_public_status_id::text || ':' || coalesce(p_client_fingerprint, 'unknown'),
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

revoke all on function public.gateway_check_compute_public_session(uuid,bigint,text)
  from public, anon, authenticated;
revoke all on function public.gateway_report_compute_public_session(uuid,bigint,text,text)
  from public, anon, authenticated;

grant execute on function public.gateway_check_compute_public_session(uuid,bigint,text)
  to service_role;
grant execute on function public.gateway_report_compute_public_session(uuid,bigint,text,text)
  to service_role;

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

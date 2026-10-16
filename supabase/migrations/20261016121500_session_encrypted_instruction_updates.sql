create table if not exists compute_private.session_instruction_secrets (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  secret text not null,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table compute_private.session_instruction_secrets enable row level security;
revoke all on table compute_private.session_instruction_secrets
  from public, anon, authenticated;

create or replace function public.get_or_create_session_instruction_secret(
  p_session_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.sessions as s where s.id = p_session_id
  ) then
    raise exception 'session not found';
  end if;

  select sis.secret into v_secret
  from compute_private.session_instruction_secrets as sis
  where sis.session_id = p_session_id;

  if v_secret is not null then
    return v_secret;
  end if;

  v_secret := 'csk_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  insert into compute_private.session_instruction_secrets(
    session_id, secret, secret_hash
  ) values (
    p_session_id,
    v_secret,
    pg_catalog.encode(extensions.digest(v_secret, 'sha256'), 'hex')
  )
  on conflict (session_id) do nothing;

  select sis.secret into v_secret
  from compute_private.session_instruction_secrets as sis
  where sis.session_id = p_session_id;

  return v_secret;
end;
$$;

revoke all on function public.get_or_create_session_instruction_secret(uuid)
  from public, anon;
grant execute on function public.get_or_create_session_instruction_secret(uuid)
  to authenticated;

create or replace function public.gateway_get_session_instruction_bundle(
  p_gateway_secret text,
  p_public_status_id uuid,
  p_session_secret text,
  p_client_fingerprint text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_session public.sessions%rowtype;
  v_resource public.resources%rowtype;
  v_secret_hash text;
  v_presented_hash text;
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
    'public-session:instructions:' || p_public_status_id::text || ':' || left(coalesce(p_client_fingerprint, 'unknown'), 256),
    10,
    600
  );
  if not v_allowed then
    return jsonb_build_object('rate_limited', true, 'retry_after_seconds', 600);
  end if;

  select s.* into v_session
  from public.sessions as s
  where s.public_status_id = p_public_status_id
    and s.public_status_enabled = true
  limit 1;

  if v_session.id is not null then
    select sis.secret_hash into v_secret_hash
    from compute_private.session_instruction_secrets as sis
    where sis.session_id = v_session.id;
  end if;

  v_presented_hash := pg_catalog.encode(
    extensions.digest(coalesce(p_session_secret, ''), 'sha256'),
    'hex'
  );

  if v_session.id is null or v_secret_hash is distinct from v_presented_hash then
    raise exception 'instruction access denied' using errcode = '42501';
  end if;

  if v_session.state in (
      'revoked'::public.session_state,
      'released'::public.session_state,
      'expired'::public.session_state,
      'stale'::public.session_state
    )
  then
    return jsonb_build_object(
      'action', 'stop_using_resource',
      'state', v_session.state
    );
  end if;

  select r.* into v_resource
  from public.resources as r
  where r.id = v_session.resource_id;

  if v_resource.id is null
     or v_resource.archived_at is not null
     or v_resource.status <> 'available'::public.resource_status
  then
    return jsonb_build_object(
      'action', 'stop_using_resource',
      'state', v_session.state
    );
  end if;

  return jsonb_build_object(
    'action', 'continue',
    'issued_at', now(),
    'session', jsonb_build_object(
      'id', v_session.id,
      'label', v_session.label,
      'project', v_session.project,
      'agent_label', v_session.agent_label
    ),
    'resource', jsonb_build_object(
      'id', v_resource.id,
      'name', v_resource.name,
      'slug', v_resource.slug,
      'description', v_resource.description,
      'version', v_resource.version,
      'connection', v_resource.connection_instructions,
      'filesystem', v_resource.filesystem_instructions,
      'environment', v_resource.environment_instructions,
      'usage_rules', v_resource.usage_rules,
      'project_restrictions', v_resource.project_restrictions,
      'tags', v_resource.tags,
      'metadata', v_resource.metadata
    )
  );
end;
$$;

revoke all on function public.gateway_get_session_instruction_bundle(text,uuid,text,text)
  from public, authenticated;
grant execute on function public.gateway_get_session_instruction_bundle(text,uuid,text,text)
  to anon;

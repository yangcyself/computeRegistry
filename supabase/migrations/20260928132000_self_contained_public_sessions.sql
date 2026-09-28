alter table public.sessions
  add column if not exists public_status_id uuid,
  add column if not exists public_status_enabled boolean not null default false;

update public.sessions
set public_status_id = extensions.gen_random_uuid()
where public_status_id is null;

alter table public.sessions
  alter column public_status_id set default extensions.gen_random_uuid(),
  alter column public_status_id set not null;

create unique index if not exists sessions_public_status_id_key
  on public.sessions(public_status_id);

create or replace function public.create_compute_public_session(
  p_resource_id uuid,
  p_label text default '',
  p_project text default '',
  p_agent_label text default ''
)
returns table(session_id uuid, public_status_id uuid, resource_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_public_status_id uuid;
  v_resource_version bigint;
  v_status public.resource_status;
  v_archived timestamptz;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  select r.version, r.status, r.archived_at
    into v_resource_version, v_status, v_archived
  from public.resources as r
  where r.id = p_resource_id
  for update;

  if not found then raise exception 'resource not found'; end if;
  if v_archived is not null or v_status <> 'available'::public.resource_status then
    raise exception 'resource is not available';
  end if;

  update public.sessions as s
  set state = case
        when s.expires_at is not null and s.expires_at <= now() then 'expired'::public.session_state
        else 'stale'::public.session_state
      end,
      updated_at = now()
  where s.resource_id = p_resource_id
    and s.state in ('claimed'::public.session_state, 'active'::public.session_state)
    and (
      (s.expires_at is not null and s.expires_at <= now())
      or coalesce(s.last_heartbeat_at, s.claimed_at, s.created_at)
         + make_interval(secs => s.heartbeat_timeout_seconds) < now()
    );

  update public.session_credentials as c
  set revoked_at = coalesce(c.revoked_at, now())
  where c.session_id in (
    select s.id from public.sessions as s
    where s.resource_id = p_resource_id
      and s.state in ('stale'::public.session_state, 'expired'::public.session_state)
  );

  update public.sessions as s
  set state = 'revoked'::public.session_state,
      revoked_at = now(),
      revocation_reason = coalesce(s.revocation_reason, 'Replaced before claim'),
      updated_at = now()
  where s.resource_id = p_resource_id
    and s.state = 'reserved'::public.session_state;

  update public.session_credentials as c
  set revoked_at = coalesce(c.revoked_at, now())
  where c.session_id in (
    select s.id from public.sessions as s
    where s.resource_id = p_resource_id
      and s.state = 'revoked'::public.session_state
  );

  if exists (
    select 1 from public.sessions as s
    where s.resource_id = p_resource_id
      and s.state in ('claimed'::public.session_state, 'active'::public.session_state)
  ) then
    raise exception 'resource already has a claimed or active session; revoke it before creating another';
  end if;

  insert into public.sessions(
    resource_id, label, project, agent_label,
    allow_contributions, state, resource_version_at_claim,
    claimed_at, activated_at, last_heartbeat_at,
    expires_at, public_status_enabled
  )
  values (
    p_resource_id, coalesce(p_label,''), coalesce(p_project,''), coalesce(p_agent_label,''),
    false, 'active'::public.session_state, v_resource_version,
    now(), now(), now(),
    null, true
  )
  returning public.sessions.id, public.sessions.public_status_id
    into v_session_id, v_public_status_id;

  insert into public.audit_events(actor_kind, actor_id, action, resource_id, session_id, metadata)
  values ('human', auth.uid()::text, 'session.create_public', p_resource_id, v_session_id,
          jsonb_build_object('resource_version', v_resource_version));

  return query select v_session_id, v_public_status_id, v_resource_version;
end;
$$;

revoke all on function public.create_compute_public_session(uuid,text,text,text) from public;
grant execute on function public.create_compute_public_session(uuid,text,text,text) to authenticated;
revoke execute on function public.create_compute_public_session(uuid,text,text,text) from anon;

create or replace function public.check_compute_public_session(
  p_public_status_id uuid,
  p_resource_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_resource public.resources%rowtype;
  v_changed boolean;
begin
  select s.* into v_session
  from public.sessions as s
  where s.public_status_id = p_public_status_id
    and s.public_status_enabled = true
  limit 1;

  if not found then
    return jsonb_build_object('found', false, 'action', 'stop_using_resource');
  end if;

  select r.* into v_resource
  from public.resources as r
  where r.id = v_session.resource_id;

  if v_session.state in ('revoked'::public.session_state,'released'::public.session_state,
                         'expired'::public.session_state,'stale'::public.session_state)
     or v_resource.id is null
     or v_resource.archived_at is not null
     or v_resource.status <> 'available'::public.resource_status
  then
    return jsonb_build_object(
      'found', true,
      'action', 'stop_using_resource',
      'state', v_session.state,
      'resource_version', case when v_resource.id is null then null else v_resource.version end
    );
  end if;

  update public.sessions as s
  set last_heartbeat_at = now(), updated_at = now()
  where s.id = v_session.id;

  v_changed := p_resource_version is null or p_resource_version <> v_resource.version;

  return jsonb_build_object(
    'found', true,
    'action', case when v_changed then 'instructions_changed' else 'continue' end,
    'state', v_session.state,
    'resource_version', v_resource.version,
    'check_interval_seconds', v_session.heartbeat_interval_seconds,
    'timeout_seconds', v_session.heartbeat_timeout_seconds
  );
end;
$$;

revoke all on function public.check_compute_public_session(uuid,bigint) from public;
grant execute on function public.check_compute_public_session(uuid,bigint) to anon, authenticated;

update public.sessions as s
set public_status_enabled = true,
    updated_at = now()
where s.state in ('reserved'::public.session_state,'claimed'::public.session_state,'active'::public.session_state)
  and s.revoked_at is null
  and s.released_at is null;

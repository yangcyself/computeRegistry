create or replace function public.create_compute_session(
  p_resource_id uuid,
  p_label text default '',
  p_project text default '',
  p_agent_label text default '',
  p_allow_contributions boolean default false,
  p_expires_at timestamptz default null
)
returns table(session_id uuid, claim_code text, session_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_claim text;
  v_claim_expires_at timestamptz;
  v_status public.resource_status;
  v_archived timestamptz;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  select r.status, r.archived_at into v_status, v_archived
  from public.resources as r
  where r.id = p_resource_id
  for update;

  if not found then raise exception 'resource not found'; end if;
  if v_archived is not null or v_status <> 'available'::public.resource_status then
    raise exception 'resource is not available';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'session expiry must be in the future';
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
    raise exception 'resource already has a claimed or active session; release or revoke it before creating another';
  end if;

  insert into public.sessions(resource_id,label,project,agent_label,allow_contributions,state,expires_at)
  values (p_resource_id,coalesce(p_label,''),coalesce(p_project,''),coalesce(p_agent_label,''),p_allow_contributions,'reserved',p_expires_at)
  returning public.sessions.id into v_session_id;

  v_claim := 'crc_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_claim_expires_at := now() + interval '15 minutes';
  if p_expires_at is not null then
    v_claim_expires_at := least(v_claim_expires_at, p_expires_at);
  end if;

  insert into public.session_credentials(session_id,token_prefix,token_hash,kind,scopes,expires_at)
  values (v_session_id,left(v_claim,16),compute_private.session_token_hash(v_claim),'claim',array['session:claim'],v_claim_expires_at);

  insert into public.audit_events(actor_kind,actor_id,action,resource_id,session_id)
  values ('human',auth.uid()::text,'session.create',p_resource_id,v_session_id);

  return query select v_session_id, v_claim, p_expires_at;
end;
$$;

create or replace function public.claim_compute_session(p_claim_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.session_credentials%rowtype;
  v_session public.sessions%rowtype;
  v_resource_version bigint;
  v_token text;
  v_token_expiry timestamptz;
begin
  select c.* into v_credential
  from public.session_credentials as c
  where c.kind = 'claim'
    and c.token_hash = compute_private.session_token_hash(p_claim_code)
    and c.consumed_at is null
    and c.revoked_at is null
    and c.expires_at > now()
  for update;

  if not found then raise exception 'invalid or expired claim code' using errcode = '28000'; end if;

  select s.* into v_session from public.sessions as s where s.id = v_credential.session_id for update;
  if v_session.state <> 'reserved'::public.session_state then raise exception 'session cannot be claimed'; end if;
  if v_session.expires_at is not null and v_session.expires_at <= now() then raise exception 'session has expired'; end if;

  select r.version into v_resource_version from public.resources as r where r.id = v_session.resource_id;
  update public.session_credentials as c set consumed_at = now() where c.id = v_credential.id;
  update public.sessions as s set state = 'claimed', claimed_at = now(), resource_version_at_claim = v_resource_version where s.id = v_session.id;

  v_token := 'crs_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_expiry := now() + interval '7 days';
  if v_session.expires_at is not null then
    v_token_expiry := least(v_token_expiry, v_session.expires_at);
  end if;

  insert into public.session_credentials(session_id,token_prefix,token_hash,kind,scopes,expires_at)
  values (v_session.id,left(v_token,16),compute_private.session_token_hash(v_token),'session',
    case when v_session.allow_contributions then array['resource:read','heartbeat:write','session:release','notes:suggest'] else array['resource:read','heartbeat:write','session:release'] end,
    v_token_expiry);

  return jsonb_build_object('session_id',v_session.id,'token',v_token,'expires_at',v_token_expiry);
end;
$$;

create or replace function public.heartbeat_compute_session(p_token text, p_resource_version bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_session public.sessions%rowtype;
  v_current_version bigint;
  v_credential_expiry timestamptz;
begin
  v_session_id := compute_private.resolve_session_id(p_token);
  if v_session_id is null then raise exception 'invalid session token' using errcode = '28000'; end if;

  update public.sessions as s
  set state='active', last_heartbeat_at=now(), activated_at=coalesce(s.activated_at,now())
  where s.id=v_session_id
  returning s.* into v_session;

  v_credential_expiry := now() + interval '7 days';
  if v_session.expires_at is not null then
    v_credential_expiry := least(v_credential_expiry, v_session.expires_at);
  end if;

  update public.session_credentials as c
  set expires_at = greatest(c.expires_at, v_credential_expiry)
  where c.session_id = v_session_id
    and c.kind = 'session'
    and c.token_hash = compute_private.session_token_hash(p_token)
    and c.revoked_at is null;

  select r.version into v_current_version from public.resources as r where r.id=v_session.resource_id;
  return jsonb_build_object(
    'ok',true,
    'state',v_session.state,
    'resource_version',v_current_version,
    'refresh_required',p_resource_version is not null and p_resource_version<>v_current_version,
    'server_time',now(),
    'session_expires_at',v_session.expires_at,
    'token_valid_until',v_credential_expiry
  );
end;
$$;

update public.sessions as s
set expires_at = null,
    updated_at = now()
where s.state in ('reserved'::public.session_state,'claimed'::public.session_state,'active'::public.session_state)
  and s.revoked_at is null
  and s.released_at is null;

update public.session_credentials as c
set expires_at = greatest(c.expires_at, now() + interval '7 days')
where c.kind = 'session'
  and c.revoked_at is null
  and exists (
    select 1 from public.sessions as s
    where s.id = c.session_id
      and s.state in ('claimed'::public.session_state,'active'::public.session_state)
      and s.revoked_at is null
      and s.released_at is null
  );

revoke execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) from public, anon;
grant execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) to authenticated;
revoke all on function public.claim_compute_session(text) from public;
grant execute on function public.claim_compute_session(text) to anon, authenticated;
revoke all on function public.heartbeat_compute_session(text,bigint) from public;
grant execute on function public.heartbeat_compute_session(text,bigint) to anon, authenticated;

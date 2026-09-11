create or replace function compute_private.session_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

create or replace function compute_private.resolve_session_id(p_token text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.session_id
  from public.session_credentials c
  join public.sessions s on s.id = c.session_id
  where c.kind = 'session'
    and c.token_hash = compute_private.session_token_hash(p_token)
    and c.revoked_at is null
    and c.expires_at > now()
    and s.state in ('claimed'::public.session_state, 'active'::public.session_state)
    and (s.expires_at is null or s.expires_at > now())
  limit 1;
$$;

create or replace function public.create_compute_session(
  p_resource_id uuid,
  p_label text default '',
  p_project text default '',
  p_agent_label text default '',
  p_allow_contributions boolean default false,
  p_expires_at timestamptz default (now() + interval '24 hours')
)
returns table(session_id uuid, claim_code text, session_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_claim text;
  v_status public.resource_status;
  v_archived timestamptz;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  update public.sessions
     set state = case
       when expires_at is not null and expires_at <= now() then 'expired'::public.session_state
       else 'stale'::public.session_state
     end
   where resource_id = p_resource_id
     and state in ('reserved'::public.session_state, 'claimed'::public.session_state, 'active'::public.session_state)
     and (
       (expires_at is not null and expires_at <= now())
       or (state = 'reserved'::public.session_state and created_at < now() - interval '15 minutes')
       or (state in ('claimed'::public.session_state, 'active'::public.session_state)
           and coalesce(last_heartbeat_at, claimed_at, created_at)
               + make_interval(secs => heartbeat_timeout_seconds) < now())
     );

  select status, archived_at into v_status, v_archived
  from public.resources
  where id = p_resource_id
  for update;

  if not found then raise exception 'resource not found'; end if;
  if v_archived is not null or v_status <> 'available'::public.resource_status then
    raise exception 'resource is not available';
  end if;
  if p_expires_at <= now() then raise exception 'session expiry must be in the future'; end if;

  insert into public.sessions(resource_id,label,project,agent_label,allow_contributions,state,expires_at)
  values (p_resource_id,coalesce(p_label,''),coalesce(p_project,''),coalesce(p_agent_label,''),p_allow_contributions,'reserved',p_expires_at)
  returning id into v_session_id;

  v_claim := 'crc_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.session_credentials(session_id,token_prefix,token_hash,kind,scopes,expires_at)
  values (v_session_id,left(v_claim,16),compute_private.session_token_hash(v_claim),'claim',array['session:claim'],least(p_expires_at,now()+interval '15 minutes'));

  insert into public.audit_events(actor_kind,actor_id,action,resource_id,session_id)
  values ('human',auth.uid()::text,'session.create',p_resource_id,v_session_id);

  return query select v_session_id, v_claim, p_expires_at;
end;
$$;

revoke all on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) from public;
grant execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) to authenticated;

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
  select * into v_credential
  from public.session_credentials
  where kind = 'claim'
    and token_hash = compute_private.session_token_hash(p_claim_code)
    and consumed_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then raise exception 'invalid or expired claim code' using errcode = '28000'; end if;

  select * into v_session from public.sessions where id = v_credential.session_id for update;
  if v_session.state <> 'reserved'::public.session_state then raise exception 'session cannot be claimed'; end if;

  select version into v_resource_version from public.resources where id = v_session.resource_id;
  update public.session_credentials set consumed_at = now() where id = v_credential.id;
  update public.sessions set state = 'claimed', claimed_at = now(), resource_version_at_claim = v_resource_version where id = v_session.id;

  v_token := 'crs_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_expiry := coalesce(v_session.expires_at, now() + interval '24 hours');

  insert into public.session_credentials(session_id,token_prefix,token_hash,kind,scopes,expires_at)
  values (v_session.id,left(v_token,16),compute_private.session_token_hash(v_token),'session',
    case when v_session.allow_contributions then array['resource:read','heartbeat:write','session:release','notes:suggest'] else array['resource:read','heartbeat:write','session:release'] end,
    v_token_expiry);

  return jsonb_build_object('session_id',v_session.id,'token',v_token,'expires_at',v_token_expiry);
end;
$$;

revoke all on function public.claim_compute_session(text) from public;
grant execute on function public.claim_compute_session(text) to anon, authenticated;

create or replace function public.get_compute_session_bootstrap(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_session public.sessions%rowtype;
  v_resource public.resources%rowtype;
begin
  v_session_id := compute_private.resolve_session_id(p_token);
  if v_session_id is null then raise exception 'invalid session token' using errcode = '28000'; end if;
  select * into v_session from public.sessions where id = v_session_id;
  select * into v_resource from public.resources where id = v_session.resource_id;

  return jsonb_build_object(
    'session',jsonb_build_object('id',v_session.id,'label',v_session.label,'project',v_session.project,'agent_label',v_session.agent_label,'state',v_session.state,'allow_contributions',v_session.allow_contributions,'expires_at',v_session.expires_at),
    'resource',jsonb_build_object('id',v_resource.id,'slug',v_resource.slug,'name',v_resource.name,'description',v_resource.description,'kind',v_resource.kind,'version',v_resource.version,'connection',v_resource.connection_instructions,'filesystem',v_resource.filesystem_instructions,'environment',v_resource.environment_instructions,'rules',v_resource.usage_rules,'project_restrictions',v_resource.project_restrictions,'tags',v_resource.tags,'metadata',v_resource.metadata),
    'heartbeat',jsonb_build_object('interval_seconds',v_session.heartbeat_interval_seconds,'timeout_seconds',v_session.heartbeat_timeout_seconds)
  );
end;
$$;

revoke all on function public.get_compute_session_bootstrap(text) from public;
grant execute on function public.get_compute_session_bootstrap(text) to anon, authenticated;

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
begin
  v_session_id := compute_private.resolve_session_id(p_token);
  if v_session_id is null then raise exception 'invalid session token' using errcode = '28000'; end if;
  update public.sessions set state='active',last_heartbeat_at=now(),activated_at=coalesce(activated_at,now()) where id=v_session_id returning * into v_session;
  select version into v_current_version from public.resources where id=v_session.resource_id;
  return jsonb_build_object('ok',true,'state',v_session.state,'resource_version',v_current_version,'refresh_required',p_resource_version is not null and p_resource_version<>v_current_version,'server_time',now());
end;
$$;

revoke all on function public.heartbeat_compute_session(text,bigint) from public;
grant execute on function public.heartbeat_compute_session(text,bigint) to anon, authenticated;

create or replace function public.release_compute_session(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  v_session_id := compute_private.resolve_session_id(p_token);
  if v_session_id is null then return false; end if;
  update public.sessions set state='released',released_at=now() where id=v_session_id;
  update public.session_credentials set revoked_at=coalesce(revoked_at,now()) where session_id=v_session_id;
  return true;
end;
$$;

revoke all on function public.release_compute_session(text) from public;
grant execute on function public.release_compute_session(text) to anon, authenticated;

create or replace function public.submit_compute_contribution(p_token text,p_resource_version bigint,p_section text,p_proposed_change text,p_rationale text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_session public.sessions%rowtype;
  v_id uuid;
begin
  v_session_id := compute_private.resolve_session_id(p_token);
  if v_session_id is null then raise exception 'invalid session token' using errcode = '28000'; end if;
  select * into v_session from public.sessions where id=v_session_id;
  if not v_session.allow_contributions then raise exception 'contributions are not enabled' using errcode='42501'; end if;
  insert into public.contributions(session_id,resource_id,resource_version,section,proposed_change,rationale)
  values (v_session_id,v_session.resource_id,p_resource_version,p_section,p_proposed_change,coalesce(p_rationale,'')) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_compute_contribution(text,bigint,text,text,text) from public;
grant execute on function public.submit_compute_contribution(text,bigint,text,text,text) to anon, authenticated;

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

  select status, archived_at into v_status, v_archived
  from public.resources
  where id = p_resource_id
  for update;

  if not found then raise exception 'resource not found'; end if;
  if v_archived is not null or v_status <> 'available'::public.resource_status then
    raise exception 'resource is not available';
  end if;
  if p_expires_at <= now() then raise exception 'session expiry must be in the future'; end if;

  update public.sessions
  set state = case
        when expires_at is not null and expires_at <= now() then 'expired'::public.session_state
        else 'stale'::public.session_state
      end,
      updated_at = now()
  where resource_id = p_resource_id
    and state in ('claimed'::public.session_state, 'active'::public.session_state)
    and (
      (expires_at is not null and expires_at <= now())
      or coalesce(last_heartbeat_at, claimed_at, created_at)
         + make_interval(secs => heartbeat_timeout_seconds) < now()
    );

  update public.session_credentials
  set revoked_at = coalesce(revoked_at, now())
  where session_id in (
    select id from public.sessions
    where resource_id = p_resource_id
      and state in ('stale'::public.session_state, 'expired'::public.session_state)
  );

  update public.sessions
  set state = 'revoked'::public.session_state,
      revoked_at = now(),
      updated_at = now()
  where resource_id = p_resource_id
    and state = 'reserved'::public.session_state;

  update public.session_credentials
  set revoked_at = coalesce(revoked_at, now())
  where session_id in (
    select id from public.sessions
    where resource_id = p_resource_id
      and state = 'revoked'::public.session_state
  );

  if exists (
    select 1 from public.sessions
    where resource_id = p_resource_id
      and state in ('claimed'::public.session_state, 'active'::public.session_state)
  ) then
    raise exception 'resource already has a claimed or active session; release or revoke it before creating another';
  end if;

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

revoke execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) from public, anon;
grant execute on function public.create_compute_session(uuid,text,text,text,boolean,timestamptz) to authenticated;

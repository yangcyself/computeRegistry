alter table public.sessions add column if not exists revocation_reason text;

create or replace function public.revoke_compute_session(p_session_id uuid, p_reason text default 'Revoked by registry owner')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource_id uuid;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  select s.resource_id into v_resource_id
  from public.sessions as s
  where s.id = p_session_id
  for update;

  if not found then return false; end if;

  update public.sessions as s
  set state = 'revoked'::public.session_state,
      revoked_at = coalesce(s.revoked_at, now()),
      revocation_reason = coalesce(nullif(btrim(p_reason), ''), 'Revoked by registry owner'),
      updated_at = now()
  where s.id = p_session_id
    and s.state <> 'released'::public.session_state;

  update public.session_credentials as c
  set revoked_at = coalesce(c.revoked_at, now())
  where c.session_id = p_session_id;

  insert into public.audit_events(actor_kind, actor_id, action, resource_id, session_id, metadata)
  values ('human', auth.uid()::text, 'session.revoke', v_resource_id, p_session_id,
          jsonb_build_object('reason', coalesce(nullif(btrim(p_reason), ''), 'Revoked by registry owner')));

  return true;
end;
$$;

revoke all on function public.revoke_compute_session(uuid,text) from public;
grant execute on function public.revoke_compute_session(uuid,text) to authenticated;
revoke execute on function public.revoke_compute_session(uuid,text) from anon;

create or replace function public.get_compute_session_token_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_reason text;
begin
  select s.* into v_session
  from public.session_credentials as c
  join public.sessions as s on s.id = c.session_id
  where c.kind = 'session'
    and c.token_hash = compute_private.session_token_hash(p_token)
  order by c.created_at desc
  limit 1;

  if not found then return jsonb_build_object('found', false); end if;

  v_reason := coalesce(v_session.revocation_reason, 'This compute assignment is no longer active.');

  return jsonb_build_object(
    'found', true,
    'session_id', v_session.id,
    'resource_id', v_session.resource_id,
    'state', v_session.state,
    'terminal', v_session.state in ('revoked'::public.session_state,'released'::public.session_state,'expired'::public.session_state,'stale'::public.session_state),
    'action', case
      when v_session.state in ('revoked'::public.session_state,'expired'::public.session_state,'stale'::public.session_state) then 'stop_using_resource'
      when v_session.state = 'released'::public.session_state then 'session_ended'
      else 'continue'
    end,
    'message', case
      when v_session.state = 'revoked'::public.session_state then 'This compute assignment has been revoked by the registry owner. Stop using the resource immediately, stop the heartbeat process, terminate work on this resource, and exit cleanly. Reason: ' || v_reason
      when v_session.state in ('expired'::public.session_state,'stale'::public.session_state) then 'This compute lease is no longer valid. Stop using the resource immediately and request a new session before doing more work.'
      when v_session.state = 'released'::public.session_state then 'This compute session has already ended. Do not resume use of the resource without a new assignment.'
      else 'Assignment is active.'
    end
  );
end;
$$;

revoke all on function public.get_compute_session_token_status(text) from public;
grant execute on function public.get_compute_session_token_status(text) to anon, authenticated;

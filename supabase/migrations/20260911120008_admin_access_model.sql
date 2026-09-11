create table compute_private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_compute_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from compute_private.admin_users a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_compute_admin() from public;
grant execute on function public.is_compute_admin() to authenticated;

create or replace function public.claim_first_compute_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if exists (select 1 from compute_private.admin_users) then
    return public.is_compute_admin();
  end if;

  insert into compute_private.admin_users(user_id) values (v_uid);
  insert into public.audit_events(actor_kind, actor_id, action, metadata)
  values ('human', v_uid::text, 'admin.bootstrap', '{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.claim_first_compute_admin() from public;
grant execute on function public.claim_first_compute_admin() to authenticated;

create policy resources_admin_all on public.resources
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());
create policy resource_revisions_admin_all on public.resource_revisions
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());
create policy sessions_admin_all on public.sessions
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());
create policy session_credentials_admin_all on public.session_credentials
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());
create policy contributions_admin_all on public.contributions
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());
create policy audit_events_admin_all on public.audit_events
  for all to authenticated
  using (public.is_compute_admin())
  with check (public.is_compute_admin());

grant select, insert, update, delete on public.resources to authenticated;
grant select, insert, update, delete on public.resource_revisions to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_credentials to authenticated;
grant select, insert, update, delete on public.contributions to authenticated;
grant select, insert, update, delete on public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to authenticated;

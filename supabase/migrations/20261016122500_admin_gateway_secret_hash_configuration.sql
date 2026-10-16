create or replace function public.set_compute_gateway_secret_hash(p_secret_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid SHA-256 hash';
  end if;

  insert into compute_private.gateway_config(singleton, secret_hash, updated_at)
  values (true, p_secret_hash, now())
  on conflict (singleton) do update
  set secret_hash = excluded.secret_hash,
      updated_at = now();

  insert into public.audit_events(actor_kind, actor_id, action, metadata)
  values (
    'human',
    auth.uid()::text,
    'gateway.secret.configure',
    '{}'::jsonb
  );

  return true;
end;
$$;

revoke all on function public.set_compute_gateway_secret_hash(text) from public;
grant execute on function public.set_compute_gateway_secret_hash(text) to authenticated;
revoke execute on function public.set_compute_gateway_secret_hash(text) from anon;

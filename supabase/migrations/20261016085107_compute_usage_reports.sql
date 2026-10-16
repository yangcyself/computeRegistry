alter table public.sessions
  add column if not exists compute_usage text not null default '',
  add column if not exists compute_usage_updated_at timestamptz;

create or replace function public.report_compute_public_session(
  p_public_status_id uuid,
  p_resource_version bigint default null,
  p_compute_usage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_usage text;
  v_reported boolean := false;
  v_status jsonb;
begin
  select s.id into v_session_id
  from public.sessions as s
  where s.public_status_id = p_public_status_id
    and s.public_status_enabled = true
  limit 1;

  if p_compute_usage is not null and v_session_id is not null then
    v_usage := btrim(
      regexp_replace(p_compute_usage, E'\r\n?', E'\n', 'g'),
      E' \t\n\r'
    );

    if char_length(v_usage) > 4000 then
      raise exception 'compute usage must be at most 4000 characters';
    end if;

    if array_length(string_to_array(v_usage, E'\n'), 1) > 8 then
      raise exception 'compute usage must be at most 8 lines';
    end if;

    update public.sessions as s
    set compute_usage = v_usage,
        compute_usage_updated_at = now(),
        updated_at = now()
    where s.id = v_session_id
      and s.state in (
        'reserved'::public.session_state,
        'claimed'::public.session_state,
        'active'::public.session_state
      );

    v_reported := found;
  end if;

  v_status := public.check_compute_public_session(
    p_public_status_id,
    p_resource_version
  );

  return v_status || jsonb_build_object(
    'usage_reported', v_reported
  );
end;
$$;

revoke all on function public.report_compute_public_session(uuid,bigint,text) from public;
grant execute on function public.report_compute_public_session(uuid,bigint,text) to anon, authenticated;

create or replace function public.save_compute_resource(
  p_resource_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_kind text,
  p_status public.resource_status,
  p_connection_instructions text,
  p_filesystem_instructions text,
  p_environment_instructions text,
  p_usage_rules text,
  p_project_restrictions text,
  p_tags text[],
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource public.resources%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null then raise exception 'name is required'; end if;
  if nullif(btrim(p_slug), '') is null then raise exception 'slug is required'; end if;

  if p_resource_id is null then
    insert into public.resources(
      slug, name, description, kind, status,
      connection_instructions, filesystem_instructions,
      environment_instructions, usage_rules, project_restrictions,
      tags, metadata
    ) values (
      lower(btrim(p_slug)), btrim(p_name), coalesce(p_description, ''),
      coalesce(nullif(btrim(p_kind), ''), 'compute'), p_status,
      coalesce(p_connection_instructions, ''), coalesce(p_filesystem_instructions, ''),
      coalesce(p_environment_instructions, ''), coalesce(p_usage_rules, ''),
      coalesce(p_project_restrictions, ''), coalesce(p_tags, '{}'::text[]),
      coalesce(p_metadata, '{}'::jsonb)
    ) returning * into v_resource;
  else
    select * into v_resource from public.resources where id = p_resource_id for update;
    if not found then raise exception 'resource not found'; end if;
    if v_resource.archived_at is not null then raise exception 'archived resources cannot be edited'; end if;

    update public.resources
    set slug = lower(btrim(p_slug)), name = btrim(p_name),
        description = coalesce(p_description, ''),
        kind = coalesce(nullif(btrim(p_kind), ''), 'compute'), status = p_status,
        connection_instructions = coalesce(p_connection_instructions, ''),
        filesystem_instructions = coalesce(p_filesystem_instructions, ''),
        environment_instructions = coalesce(p_environment_instructions, ''),
        usage_rules = coalesce(p_usage_rules, ''),
        project_restrictions = coalesce(p_project_restrictions, ''),
        tags = coalesce(p_tags, '{}'::text[]), metadata = coalesce(p_metadata, '{}'::jsonb),
        version = version + 1
    where id = p_resource_id
    returning * into v_resource;
  end if;

  v_snapshot := jsonb_build_object(
    'id', v_resource.id, 'slug', v_resource.slug, 'name', v_resource.name,
    'description', v_resource.description, 'kind', v_resource.kind, 'status', v_resource.status,
    'connection_instructions', v_resource.connection_instructions,
    'filesystem_instructions', v_resource.filesystem_instructions,
    'environment_instructions', v_resource.environment_instructions,
    'usage_rules', v_resource.usage_rules, 'project_restrictions', v_resource.project_restrictions,
    'tags', v_resource.tags, 'metadata', v_resource.metadata, 'version', v_resource.version
  );

  insert into public.resource_revisions(resource_id, version, snapshot, change_summary, author_kind, author_id)
  values (v_resource.id, v_resource.version, v_snapshot,
          case when p_resource_id is null then 'Resource created' else 'Resource updated' end,
          'human', auth.uid()::text);

  insert into public.audit_events(actor_kind, actor_id, action, resource_id, metadata)
  values ('human', auth.uid()::text,
          case when p_resource_id is null then 'resource.create' else 'resource.update' end,
          v_resource.id, jsonb_build_object('version', v_resource.version));

  return jsonb_build_object('id', v_resource.id, 'version', v_resource.version);
end;
$$;

revoke all on function public.save_compute_resource(uuid,text,text,text,text,public.resource_status,text,text,text,text,text,text[],jsonb) from public;
grant execute on function public.save_compute_resource(uuid,text,text,text,text,public.resource_status,text,text,text,text,text,text[],jsonb) to authenticated;
revoke execute on function public.save_compute_resource(uuid,text,text,text,text,public.resource_status,text,text,text,text,text,text[],jsonb) from anon;

create or replace function public.archive_compute_resource(p_resource_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource public.resources%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_compute_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  select * into v_resource from public.resources where id = p_resource_id for update;
  if not found then return false; end if;
  if v_resource.archived_at is not null then return true; end if;

  if exists (
    select 1 from public.sessions
    where resource_id = p_resource_id
      and state in ('reserved'::public.session_state, 'claimed'::public.session_state, 'active'::public.session_state)
  ) then
    raise exception 'resource has a live session';
  end if;

  update public.resources
  set archived_at = now(), status = 'disabled'::public.resource_status, version = version + 1
  where id = p_resource_id
  returning * into v_resource;

  v_snapshot := jsonb_build_object(
    'id', v_resource.id, 'slug', v_resource.slug, 'name', v_resource.name,
    'description', v_resource.description, 'kind', v_resource.kind, 'status', v_resource.status,
    'connection_instructions', v_resource.connection_instructions,
    'filesystem_instructions', v_resource.filesystem_instructions,
    'environment_instructions', v_resource.environment_instructions,
    'usage_rules', v_resource.usage_rules, 'project_restrictions', v_resource.project_restrictions,
    'tags', v_resource.tags, 'metadata', v_resource.metadata, 'version', v_resource.version,
    'archived_at', v_resource.archived_at
  );

  insert into public.resource_revisions(resource_id, version, snapshot, change_summary, author_kind, author_id)
  values (v_resource.id, v_resource.version, v_snapshot, 'Resource archived', 'human', auth.uid()::text);

  insert into public.audit_events(actor_kind, actor_id, action, resource_id, metadata)
  values ('human', auth.uid()::text, 'resource.archive', v_resource.id,
          jsonb_build_object('version', v_resource.version));

  return true;
end;
$$;

revoke all on function public.archive_compute_resource(uuid) from public;
grant execute on function public.archive_compute_resource(uuid) to authenticated;
revoke execute on function public.archive_compute_resource(uuid) from anon;

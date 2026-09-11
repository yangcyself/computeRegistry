-- Baseline schema for compute-registry.
-- Reconstructed from the live Supabase project kmulvwluatehngydgehb on 2026-09-11.

create schema if not exists compute_private;

create type public.resource_status as enum ('available', 'disabled', 'maintenance');
create type public.session_state as enum ('reserved', 'claimed', 'active', 'stale', 'released', 'revoked', 'expired');
create type public.contribution_state as enum ('pending', 'accepted', 'rejected');

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  description text not null default '',
  kind text not null default 'compute',
  status public.resource_status not null default 'available',
  connection_instructions text not null default '',
  filesystem_instructions text not null default '',
  environment_instructions text not null default '',
  usage_rules text not null default '',
  project_restrictions text not null default '',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.resource_revisions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  version bigint not null check (version > 0),
  snapshot jsonb not null,
  change_summary text not null default '',
  author_kind text not null default 'human' check (author_kind = any (array['human'::text, 'agent'::text, 'system'::text])),
  author_id text,
  created_at timestamptz not null default now(),
  unique (resource_id, version)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  label text not null default '',
  project text not null default '',
  agent_label text not null default '',
  state public.session_state not null default 'reserved',
  allow_contributions boolean not null default false,
  resource_version_at_claim bigint,
  heartbeat_interval_seconds integer not null default 30 check (heartbeat_interval_seconds >= 10 and heartbeat_interval_seconds <= 3600),
  heartbeat_timeout_seconds integer not null default 90,
  last_heartbeat_at timestamptz,
  claimed_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (heartbeat_timeout_seconds >= heartbeat_interval_seconds),
  check (expires_at is null or expires_at > created_at)
);

create table public.session_credentials (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  token_prefix text not null unique,
  token_hash text not null,
  kind text not null check (kind = any (array['claim'::text, 'session'::text])),
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  resource_version bigint not null check (resource_version > 0),
  section text not null,
  proposed_change text not null,
  rationale text not null default '',
  state public.contribution_state not null default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (state = 'pending'::public.contribution_state and reviewed_at is null)
    or
    (state = any (array['accepted'::public.contribution_state, 'rejected'::public.contribution_state]) and reviewed_at is not null)
  )
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_kind text not null check (actor_kind = any (array['human'::text, 'agent'::text, 'system'::text])),
  actor_id text,
  action text not null,
  resource_id uuid references public.resources(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index one_live_session_per_resource
  on public.sessions(resource_id)
  where state = any (array['reserved'::public.session_state, 'claimed'::public.session_state, 'active'::public.session_state]);

create index sessions_state_idx on public.sessions(state);
create index sessions_last_heartbeat_idx on public.sessions(last_heartbeat_at desc);
create index session_credentials_session_idx on public.session_credentials(session_id);
create index session_credentials_validity_idx on public.session_credentials(expires_at);
create index contributions_resource_state_idx on public.contributions(resource_id, state, created_at desc);
create index contributions_session_idx on public.contributions(session_id);
create index audit_events_created_idx on public.audit_events(created_at desc);
create index audit_events_resource_idx on public.audit_events(resource_id, created_at desc);
create index audit_events_session_idx on public.audit_events(session_id, created_at desc);

create or replace function compute_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger resources_set_updated_at
before update on public.resources
for each row execute function compute_private.set_updated_at();

create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function compute_private.set_updated_at();

alter table public.resources enable row level security;
alter table public.resource_revisions enable row level security;
alter table public.sessions enable row level security;
alter table public.session_credentials enable row level security;
alter table public.contributions enable row level security;
alter table public.audit_events enable row level security;

-- Intentionally no RLS policies yet. Until application authentication is wired,
-- client-side access to these tables remains closed by default.

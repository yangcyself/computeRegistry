# Supabase database workflow

This directory is the recoverable source of truth for the compute-registry database schema.

## Live project

Current Supabase project ref:

`kmulvwluatehngydgehb`

The checked-in baseline migration under `migrations/` was reconstructed from the live project on 2026-09-11, including enums, tables, constraints, indexes, RLS state, triggers, and the private `updated_at` trigger function.

## Manual setup on a fresh Supabase project

1. Install the Supabase CLI and authenticate.
2. From the repository root, link the new Supabase project:

```bash
supabase link --project-ref <new-project-ref>
```

3. Apply all checked-in migrations:

```bash
supabase db push
```

4. Run database advisors after schema changes:

```bash
supabase db advisors
```

The initial migration intentionally enables RLS without client policies. This means the public Data API cannot read or mutate these tables through normal anonymous/authenticated client access until explicit policies are added.

## Making future schema changes

Always create a migration file before editing schema:

```bash
supabase migration new describe_the_change
```

Edit the generated SQL file, review it, then apply it to the linked project:

```bash
supabase db push
```

Commit the migration together with the application code that depends on it.

Do not edit old applied migration files after they have been used in production. Add a new migration instead.

## Checking migration state

```bash
supabase migration list
```

If the live database was changed manually outside the repo, inspect and reconcile that drift before making further changes. The goal is that a fresh database built from the migration directory reproduces production structure.

## Secrets

Never commit database passwords, service-role keys, Supabase secret keys, session credentials, or claim tokens. Only public configuration variable names and safe project metadata belong in Git.

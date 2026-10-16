# Supabase database workflow

This directory is the recoverable source of truth for the compute-registry database schema.

## Live project

Current Supabase project ref:

`kmulvwluatehngydgehb`

The checked-in migrations include the database schema, RLS configuration, resource/session RPCs, the server-only public-session gateway, and database-backed rate limiting.

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

4. Configure the gateway secret as described below.
5. Run database advisors after schema changes:

```bash
supabase db advisors
```

## Public-session gateway secret

The agent-facing status endpoint is public, but direct anonymous access to the underlying status/report RPCs is revoked. The Next.js server calls protected gateway RPCs with a server-only secret.

Generate a high-entropy value:

```bash
openssl rand -hex 48
```

Store the plaintext value in Vercel as `COMPUTE_GATEWAY_SECRET` for Production, Preview, and Development. Never prefix it with `NEXT_PUBLIC_`.

Store only its SHA-256 hash in Supabase:

```bash
printf '%s' "$COMPUTE_GATEWAY_SECRET" | shasum -a 256
```

Then run this in the Supabase SQL editor, replacing the placeholder with the resulting hexadecimal hash:

```sql
insert into compute_private.gateway_config(singleton, secret_hash, updated_at)
values (true, '<sha256-hex>', now())
on conflict (singleton) do update
set secret_hash = excluded.secret_hash,
    updated_at = now();
```

Redeploy after changing the Vercel variable. To rotate the secret, generate a new value, update the Vercel variable and database hash, then redeploy. Keep the plaintext out of Git, logs, browser code, and agent prompts.

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

Never commit database passwords, service-role keys, Supabase secret keys, gateway secrets, session credentials, or claim tokens. Only public configuration variable names and safe project metadata belong in Git.

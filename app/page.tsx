export default function HomePage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Personal compute control plane</p>
        <h1>Compute Registry</h1>
        <p className="lede">
          Coordinate local, remote, organizational, and project-scoped compute
          resources across AI-agent sessions.
        </p>
      </section>

      <section className="status-grid" aria-label="Registry status">
        <article className="card">
          <span className="label">Database</span>
          <strong>{supabaseConfigured ? "Configured" : "Needs environment"}</strong>
          <p>Supabase Postgres is the source of truth for resources and leases.</p>
        </article>
        <article className="card">
          <span className="label">Resource access</span>
          <strong>Locked by default</strong>
          <p>RLS is enabled while authentication policies are being wired.</p>
        </article>
        <article className="card">
          <span className="label">Next milestone</span>
          <strong>Admin dashboard</strong>
          <p>Create resources, issue sessions, and inspect heartbeats.</p>
        </article>
      </section>
    </main>
  );
}

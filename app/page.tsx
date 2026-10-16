import Link from "next/link";
import { revokeSession, signOut } from "./actions";
import { LocalTime } from "./components/local-time";
import { createClient } from "../lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const { data: isAdmin } = await supabase.rpc("is_compute_admin");

  if (!claimsData?.claims || !isAdmin) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">Compute Registry</p>
          <h1>Admin access required</h1>
          <p className="lede">Sign in with the first Supabase Auth account to claim administration.</p>
        </section>
      </main>
    );
  }

  const [{ data: resources }, { data: sessions }] = await Promise.all([
    supabase.from("resources").select("*").is("archived_at", null).order("name"),
    supabase
      .from("sessions")
      .select("id,resource_id,label,agent_label,state,last_heartbeat_at,created_at,compute_usage,compute_usage_updated_at")
      .in("state", ["reserved", "claimed", "active"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  type LiveSession = NonNullable<typeof sessions>[number];
  const liveByResource = new Map<string, LiveSession>();
  for (const session of sessions ?? []) {
    if (!liveByResource.has(session.resource_id)) {
      liveByResource.set(session.resource_id, session);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Personal compute control plane</p>
          <h1>Compute Registry</h1>
        </div>
        <div className="topbar-actions">
          <Link className="button-link" href="/resources/new">Add resource</Link>
          <form action={signOut}><button className="secondary-button" type="submit">Sign out</button></form>
        </div>
      </header>

      <section className="resource-list">
        {(resources ?? []).length === 0 ? (
          <div className="empty-state">No resources yet. Add your first compute resource.</div>
        ) : (
          (resources ?? []).map((resource) => {
            const session = liveByResource.get(resource.id);
            const occupied = Boolean(session);
            return (
              <article className="resource-card" key={resource.id}>
                <div className="resource-heading">
                  <div>
                    <span className={`status-dot ${occupied ? "busy" : "free"}`} />
                    <strong>{resource.name}</strong>
                    <span className="slug">{resource.slug}</span>
                  </div>
                  <div className="card-actions">
                    <Link className="secondary-button" href={`/resources/${resource.id}`}>Edit</Link>
                    {session ? (
                      <>
                        <Link className="secondary-button" href={`/sessions/${session.id}/handoff`}>Handoff</Link>
                        <form action={revokeSession}>
                          <input type="hidden" name="session_id" value={session.id} />
                          <input type="hidden" name="reason" value="Revoked by registry owner" />
                          <button className="danger-button" type="submit">Revoke assignment</button>
                        </form>
                      </>
                    ) : (
                      <Link className="button-link" href={`/sessions/new?resource=${resource.id}`}>New session</Link>
                    )}
                  </div>
                </div>
                <p>{resource.description || "No description yet."}</p>
                <dl className="resource-meta">
                  <div><dt>Status</dt><dd>{session?.state ?? resource.status}</dd></div>
                  <div><dt>Version</dt><dd>v{resource.version}</dd></div>
                  <div><dt>Last heartbeat</dt><dd><LocalTime value={session?.last_heartbeat_at ?? null} /></dd></div>
                </dl>

                {session ? (
                  <section className="compute-usage-panel">
                    <div className="compute-usage-heading">
                      <div>
                        <span className="label">Compute usage</span>
                        {session.agent_label ? <span className="usage-agent">{session.agent_label}</span> : null}
                      </div>
                      <small>
                        Updated <LocalTime value={session.compute_usage_updated_at ?? null} />
                      </small>
                    </div>
                    <pre>{session.compute_usage?.trim() || "No usage report yet."}</pre>
                  </section>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}

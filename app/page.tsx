import Link from "next/link";
import { signOut } from "./actions";
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
    supabase.from("sessions").select("id,resource_id,label,agent_label,state,last_heartbeat_at,created_at,expires_at").order("created_at", { ascending: false }).limit(100),
  ]);

  const latestByResource = new Map<string, (typeof sessions extends (infer T)[] | null ? T : never)>();
  for (const session of sessions ?? []) {
    if (!latestByResource.has(session.resource_id)) latestByResource.set(session.resource_id, session);
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
            const session = latestByResource.get(resource.id);
            const occupied = session && ["reserved", "claimed", "active"].includes(session.state);
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
                    <Link className="button-link" href={`/sessions/new?resource=${resource.id}`}>New session</Link>
                  </div>
                </div>
                <p>{resource.description || "No description yet."}</p>
                <dl className="resource-meta">
                  <div><dt>Status</dt><dd>{occupied ? session?.state : resource.status}</dd></div>
                  <div><dt>Version</dt><dd>v{resource.version}</dd></div>
                  <div><dt>Last heartbeat</dt><dd>{session?.last_heartbeat_at ? new Date(session.last_heartbeat_at).toLocaleString() : "—"}</dd></div>
                </dl>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}

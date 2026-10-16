import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { CopyPanel } from "./copy-panel";

function Section({ title, value }: { title: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <section className="handoff-section">
      <h3>{title}</h3>
      <pre>{value}</pre>
    </section>
  );
}

export default async function SessionHandoffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id,resource_id,label,project,agent_label,state,public_status_id,public_status_enabled,heartbeat_interval_seconds")
    .eq("id", id)
    .single();

  if (sessionError || !session) notFound();

  const { data: resource, error: resourceError } = await supabase
    .from("resources")
    .select("name,slug,description,version,connection_instructions,filesystem_instructions,environment_instructions,usage_rules,project_restrictions,tags")
    .eq("id", session.resource_id)
    .single();

  if (resourceError || !resource) notFound();

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "compute-registry-yangcyself.vercel.app";
  const statusUrl =
    session.public_status_enabled && session.public_status_id
      ? `${proto}://${host}/api/v1/public-session/${session.public_status_id}/status?v=${resource.version}`
      : null;
  const intervalMinutes = Math.max(
    1,
    Math.round(session.heartbeat_interval_seconds / 60),
  );

  return (
    <main className="shell narrow-shell">
      <CopyPanel>
        <h2>Compute Registry assignment</h2>
        <p><strong>Resource:</strong> {resource.name} ({resource.slug})</p>
        <p><strong>Resource version:</strong> {resource.version}</p>
        {session.label ? <p><strong>Session:</strong> {session.label}</p> : null}
        {session.project ? <p><strong>Project:</strong> {session.project}</p> : null}
        {session.agent_label ? <p><strong>Agent:</strong> {session.agent_label}</p> : null}

        <Section title="Description" value={resource.description} />
        <Section title="Connection instructions" value={resource.connection_instructions} />
        <Section title="Filesystem / data instructions" value={resource.filesystem_instructions} />
        <Section title="Environment instructions" value={resource.environment_instructions} />
        <Section title="Usage rules" value={resource.usage_rules} />
        <Section title="Project restrictions" value={resource.project_restrictions} />

        {resource.tags?.length ? (
          <section className="handoff-section">
            <h3>Tags</h3>
            <p>{resource.tags.join(", ")}</p>
          </section>
        ) : null}

        {statusUrl ? (
          <section className="handoff-section">
            <h3>Heartbeat and compute usage report</h3>
            <p>
              About every {intervalMinutes} minutes, send an HTTP POST to this
              non-secret URL:
            </p>
            <pre>{statusUrl}</pre>
            <p>Use a JSON body with a <code>compute_usage</code> string:</p>
            <pre>{`{
  "compute_usage": "Busy: training experiment 14\nGPU job is running"
}`}</pre>
            <p>
              The report must be at most 8 lines. A simple description such as
              <code> Busy: training</code> or <code> Idle: waiting for work</code>
              is enough. Do not include passwords, tokens, private keys, or other
              sensitive information.
            </p>
            <p>
              Parse the response action: <code>continue</code>,
              <code> instructions_changed</code>, or
              <code> stop_using_resource</code>.
            </p>
            <p>
              If instructions changed, ask the owner for a new Compute Registry
              handoff. If told to stop, stop using the resource immediately.
            </p>
          </section>
        ) : null}
      </CopyPanel>
    </main>
  );
}

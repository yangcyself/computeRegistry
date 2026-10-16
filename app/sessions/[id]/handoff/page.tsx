import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { CopyPanel } from "./copy-panel";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
};

type SessionView = {
  id: string;
  resource_id: string;
  label: string;
  project: string;
  agent_label: string;
  state: string;
  public_status_id: string;
  public_status_enabled: boolean;
  heartbeat_interval_seconds: number;
};

type ResourceView = {
  name: string;
  slug: string;
  description: string;
  version: number;
  connection_instructions: string;
  filesystem_instructions: string;
  environment_instructions: string;
  usage_rules: string;
  project_restrictions: string;
  tags: string[];
};

function Section({ title, value }: { title: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <section className="handoff-section">
      <h3>{title}</h3>
      <pre>{value}</pre>
    </section>
  );
}

function AssignmentDetails({
  session,
  resource,
}: {
  session: SessionView;
  resource: ResourceView;
}) {
  return (
    <>
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
    </>
  );
}

function HeartbeatInstructions({
  statusUrl,
  intervalMinutes,
  mode,
  instructionsUrl,
  sessionSecret,
}: {
  statusUrl: string;
  intervalMinutes: number;
  mode: "standard" | "encrypted";
  instructionsUrl?: string;
  sessionSecret?: string;
}) {
  return (
    <section className="handoff-section">
      <h3>Heartbeat and compute usage report</h3>
      <p>
        About every {intervalMinutes} minutes, send an HTTP POST to this status
        URL and parse the response body:
      </p>
      <pre>{statusUrl}</pre>
      <p>Use a JSON body with a <code>compute_usage</code> string:</p>
      <pre>{`{
  "compute_usage": "Busy: training experiment 14\nGPU job is running"
}`}</pre>
      <p>
        The report must be at most 8 lines. A simple description such as
        <code> Busy: training</code> or <code> Idle: waiting for work</code> is
        enough. Never include the session secret, passwords, tokens, private
        keys, or other sensitive information in the usage report.
      </p>
      <p>
        The heartbeat monitor must surface every non-<code>continue</code> action
        to the active agent session rather than only writing it to a log.
      </p>
      <ul>
        <li><code>continue</code>: continue normally.</li>
        <li>
          <code>stop_using_resource</code>: stop using the resource immediately
          and end this assignment.
        </li>
        {mode === "standard" ? (
          <li>
            <code>instructions_changed</code>: ask the owner to paste a new
            Compute Registry handoff.
          </li>
        ) : (
          <li>
            <code>instructions_changed</code>: request and decrypt the updated
            instruction bundle as described below.
          </li>
        )}
      </ul>

      {mode === "encrypted" && instructionsUrl && sessionSecret ? (
        <section className="encrypted-update-section">
          <h3>Encrypted instruction updates</h3>
          <p>
            This is an optional automatic update path. The initial instructions
            above are already complete; use this endpoint only after the
            heartbeat reports <code>instructions_changed</code>.
          </p>
          <p><strong>Session secret:</strong></p>
          <pre>{sessionSecret}</pre>
          <p><strong>Updated-instruction endpoint:</strong></p>
          <pre>{instructionsUrl}</pre>
          <p>Send an HTTP POST with:</p>
          <pre>{`{
  "session_secret": "${sessionSecret}"
}`}</pre>
          <p>
            Treat the session secret as sensitive. Do not log it, commit it,
            include it in compute-usage reports, or share it with another
            session.
          </p>
          <p>The response is an AES-256-GCM envelope:</p>
          <ul>
            <li>Derive the 32-byte key as SHA-256 of the UTF-8 session secret.</li>
            <li>Base64url-decode <code>iv</code>, <code>aad</code>, <code>ciphertext</code>, and <code>auth_tag</code>.</li>
            <li>Decrypt with AES-256-GCM using the decoded IV, AAD, and authentication tag.</li>
            <li>Parse the plaintext as JSON and replace the old resource instructions with the returned bundle.</li>
            <li>Use the returned resource version in the <code>?v=</code> query of future heartbeat requests.</li>
          </ul>
          <p>
            If an automatic permission checker blocks either the instruction
            request or decryption, do not retry by rephrasing or narrowing the
            denied operation. Report: “Encrypted instruction retrieval was
            blocked by the permission checker; please paste the updated standard
            handoff.” Then wait for the owner to provide it manually.
          </p>
        </section>
      ) : null}
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

  const { data: sessionData, error: sessionError } = await supabase
    .from("sessions")
    .select("id,resource_id,label,project,agent_label,state,public_status_id,public_status_enabled,heartbeat_interval_seconds")
    .eq("id", id)
    .single();

  if (sessionError || !sessionData) notFound();
  const session = sessionData as SessionView;

  const { data: resourceData, error: resourceError } = await supabase
    .from("resources")
    .select("name,slug,description,version,connection_instructions,filesystem_instructions,environment_instructions,usage_rules,project_restrictions,tags")
    .eq("id", session.resource_id)
    .single();

  if (resourceError || !resourceData) notFound();
  const resource = resourceData as ResourceView;

  const { data: secretData, error: secretError } = await supabase.rpc(
    "get_or_create_session_instruction_secret",
    { p_session_id: id },
  );

  if (secretError || typeof secretData !== "string") {
    throw new Error("Unable to create the encrypted-update session secret.");
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "compute-registry-yangcyself.vercel.app";
  const baseUrl = `${proto}://${host}`;
  const statusUrl =
    session.public_status_enabled && session.public_status_id
      ? `${baseUrl}/api/v1/public-session/${session.public_status_id}/status?v=${resource.version}`
      : null;
  const instructionsUrl =
    session.public_status_enabled && session.public_status_id
      ? `${baseUrl}/api/v1/public-session/${session.public_status_id}/instructions`
      : null;
  const intervalMinutes = Math.max(
    1,
    Math.round(session.heartbeat_interval_seconds / 60),
  );

  if (!statusUrl) notFound();

  const standard = (
    <>
      <AssignmentDetails session={session} resource={resource} />
      <HeartbeatInstructions
        statusUrl={statusUrl}
        intervalMinutes={intervalMinutes}
        mode="standard"
      />
    </>
  );

  const encrypted = (
    <>
      <AssignmentDetails session={session} resource={resource} />
      <HeartbeatInstructions
        statusUrl={statusUrl}
        intervalMinutes={intervalMinutes}
        mode="encrypted"
        instructionsUrl={instructionsUrl ?? undefined}
        sessionSecret={secretData}
      />
    </>
  );

  return (
    <main className="shell narrow-shell">
      <CopyPanel standard={standard} encrypted={encrypted} />
    </main>
  );
}

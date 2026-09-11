'use server';

import { headers } from "next/headers";
import { createClient } from "../../../lib/supabase/server";

export type SessionState = { error?: string; prompt?: string };

export async function createSession(_: SessionState, formData: FormData): Promise<SessionState> {
  const supabase = await createClient();
  const resourceId = String(formData.get("resource_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const project = String(formData.get("project") ?? "").trim();
  const agentLabel = String(formData.get("agent_label") ?? "").trim();
  const allowContributions = formData.get("allow_contributions") === "on";

  const { data: resource, error: resourceError } = await supabase
    .from("resources")
    .select("name,slug")
    .eq("id", resourceId)
    .single();
  if (resourceError || !resource) return { error: "Resource not found or inaccessible." };

  const { data, error } = await supabase.rpc("create_compute_session", {
    p_resource_id: resourceId,
    p_label: label,
    p_project: project,
    p_agent_label: agentLabel,
    p_allow_contributions: allowContributions,
    p_expires_at: null,
  });
  if (error || !data?.[0]) {
    const message = error?.message ?? "Unable to create session.";
    if (message.includes("claimed or active session")) {
      return { error: "This resource already has a claimed or active session. Revoke that assignment before creating another." };
    }
    return { error: message };
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "compute-registry-yangcyself.vercel.app";
  const baseUrl = `${proto}://${host}`;
  const claimCode = data[0].claim_code;

  const prompt = `You have been assigned the compute resource "${resource.name}" (${resource.slug}) through my Compute Registry.\n\nRegistry: ${baseUrl}\nOne-time claim code: ${claimCode}\n\nFirst, claim the session by POSTing JSON {"claim_code":"${claimCode}"} to:\n${baseUrl}/api/v1/session/claim\n\nThe response contains a session token. Treat that token as a secret: do not print it, commit it, or include it in logs. Use it as a Bearer token for subsequent requests.\n\nThen GET:\n${baseUrl}/api/v1/session/bootstrap\n\nRead the bootstrap response and follow the returned connection, filesystem, environment, project restriction, and usage instructions. Record resource.version and include it as resource_version in every heartbeat request.\n\nHEARTBEAT RULE: Every heartbeat response must be parsed. Do not discard the response body.\n\nIf heartbeat returns refresh_required=true or action=\"refresh_instructions\", fetch ${baseUrl}/api/v1/session/bootstrap again, read the updated instructions, use the returned resource.version for future heartbeats, and continue.\n\nThis assignment has no fixed wall-clock expiry while it remains healthy. Maintain a heartbeat by POSTing to ${baseUrl}/api/v1/session/heartbeat at the interval returned by bootstrap. Successful heartbeats renew the session credential. The heartbeat process must be tied to this agent/session process. Do not install a system service, cron job, systemd unit, login item, or other persistent daemon.\n\nIMPORTANT REVOCATION RULE: If bootstrap, heartbeat, release, or contribution requests return HTTP 410 with action=\"stop_using_resource\", treat that as an authoritative terminal instruction from the registry owner. Stop using the compute resource immediately, stop the heartbeat process, terminate work on that resource, and exit cleanly. Do not retry or continue using the resource.\n\nWhen your work ends normally, POST to ${baseUrl}/api/v1/session/release.\n\n${allowContributions ? `You may submit resource-note suggestions through ${baseUrl}/api/v1/session/contributions. Suggestions are not authoritative until reviewed.` : "You are not permitted to modify or contribute resource notes in this session."}`;

  return { prompt };
}

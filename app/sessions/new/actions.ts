'use server';

import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

export type SessionState = { error?: string };

export async function createSession(_: SessionState, formData: FormData): Promise<SessionState> {
  const supabase = await createClient();
  const resourceId = String(formData.get("resource_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const project = String(formData.get("project") ?? "").trim();
  const agentLabel = String(formData.get("agent_label") ?? "").trim();

  const { data, error } = await supabase.rpc("create_compute_public_session", {
    p_resource_id: resourceId,
    p_label: label,
    p_project: project,
    p_agent_label: agentLabel,
  });

  if (error || !data?.[0]) {
    const message = error?.message ?? "Unable to create session.";
    if (message.includes("claimed or active session")) {
      return { error: "This resource already has an active assignment. Revoke it before creating another." };
    }
    return { error: message };
  }

  redirect(`/sessions/${data[0].session_id}/handoff`);
}

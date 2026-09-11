import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../lib/supabase/public";
import { getSessionTokenStatus } from "../../../../../lib/session-status";

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ error: "Bearer token required" }, { status: 401 });

  const status = await getSessionTokenStatus(token);
  if (status?.terminal) {
    return NextResponse.json({
      error: "assignment_terminated",
      state: status.state,
      action: status.action,
      message: status.message,
    }, { status: 410 });
  }

  const body = await request.json().catch(() => ({}));
  if (!Number.isFinite(body.resource_version) || typeof body.section !== "string" || typeof body.proposed_change !== "string") {
    return NextResponse.json({ error: "resource_version, section, and proposed_change are required" }, { status: 400 });
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("submit_compute_contribution", {
    p_token: token,
    p_resource_version: body.resource_version,
    p_section: body.section,
    p_proposed_change: body.proposed_change,
    p_rationale: typeof body.rationale === "string" ? body.rationale : "",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ contribution_id: data });
}

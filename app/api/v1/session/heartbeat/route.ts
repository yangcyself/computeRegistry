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
  const resourceVersion = Number.isFinite(body.resource_version) ? body.resource_version : null;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("heartbeat_compute_session", {
    p_token: token,
    p_resource_version: resourceVersion,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });
  return NextResponse.json(data);
}

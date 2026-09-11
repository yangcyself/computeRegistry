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

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("release_compute_session", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: data });
}

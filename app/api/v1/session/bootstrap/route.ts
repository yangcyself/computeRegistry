import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../lib/supabase/public";

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function GET(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ error: "Bearer token required" }, { status: 401 });
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_compute_session_bootstrap", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });
  return NextResponse.json(data);
}

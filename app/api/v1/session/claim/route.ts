import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../lib/supabase/public";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const claimCode = typeof body.claim_code === "string" ? body.claim_code : "";
  if (!claimCode) return NextResponse.json({ error: "claim_code is required" }, { status: 400 });

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("claim_compute_session", { p_claim_code: claimCode });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });
  return NextResponse.json(data);
}

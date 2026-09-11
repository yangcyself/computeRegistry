import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing resource id" }, { status: 400 });

  const { data, error } = await supabase.rpc("archive_compute_resource", {
    p_resource_id: id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: Boolean(data) });
}

import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json();
  const tags = Array.isArray(body.tags)
    ? body.tags.map((v: unknown) => String(v).trim()).filter(Boolean)
    : String(body.tags ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

  let metadata: Record<string, unknown> = {};
  if (body.metadata && typeof body.metadata === "object") {
    metadata = body.metadata;
  } else if (String(body.metadata ?? "").trim()) {
    try {
      metadata = JSON.parse(String(body.metadata));
    } catch {
      return NextResponse.json({ error: "Metadata must be valid JSON." }, { status: 400 });
    }
  }

  const { data, error } = await supabase.rpc("save_compute_resource", {
    p_resource_id: body.id || null,
    p_slug: String(body.slug ?? ""),
    p_name: String(body.name ?? ""),
    p_description: String(body.description ?? ""),
    p_kind: String(body.kind ?? "compute"),
    p_status: body.status ?? "available",
    p_connection_instructions: String(body.connection_instructions ?? ""),
    p_filesystem_instructions: String(body.filesystem_instructions ?? ""),
    p_environment_instructions: String(body.environment_instructions ?? ""),
    p_usage_rules: String(body.usage_rules ?? ""),
    p_project_restrictions: String(body.project_restrictions ?? ""),
    p_tags: tags,
    p_metadata: metadata,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

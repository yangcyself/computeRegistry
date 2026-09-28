import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../../lib/supabase/public";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const { statusId } = await params;
  const url = new URL(request.url);
  const rawVersion = url.searchParams.get("v");
  const resourceVersion = rawVersion === null ? null : Number(rawVersion);

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("check_compute_public_session", {
    p_public_status_id: statusId,
    p_resource_version: Number.isFinite(resourceVersion) ? resourceVersion : null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const body = data as { action?: string } | null;
  const status = body?.action === "stop_using_resource" ? 410 : 200;

  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../../lib/supabase/public";

function resourceVersion(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("v");
  const parsed = raw === null ? null : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusResponse(data: unknown) {
  const body = data as { action?: string } | null;
  const status = body?.action === "stop_using_resource" ? 410 : 200;

  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const { statusId } = await params;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("check_compute_public_session", {
    p_public_status_id: statusId,
    p_resource_version: resourceVersion(request),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return statusResponse(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const { statusId } = await params;
  const body = await request.json().catch(() => null);
  const usage = body?.compute_usage;

  if (typeof usage !== "string") {
    return NextResponse.json(
      { error: "compute_usage must be a string with at most 8 lines" },
      { status: 400 },
    );
  }

  const lineCount = usage.replace(/\r\n?/g, "\n").split("\n").length;
  if (lineCount > 8) {
    return NextResponse.json(
      { error: "compute_usage must be at most 8 lines" },
      { status: 400 },
    );
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("report_compute_public_session", {
    p_public_status_id: statusId,
    p_resource_version: resourceVersion(request),
    p_compute_usage: usage,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return statusResponse(data);
}

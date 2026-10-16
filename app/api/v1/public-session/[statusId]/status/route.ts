import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../../lib/supabase/public";

const MAX_BODY_BYTES = 8 * 1024;

function resourceVersion(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("v");
  const parsed = raw === null ? null : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function gatewaySecret() {
  return process.env.COMPUTE_GATEWAY_SECRET ?? "";
}

function clientFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return createHash("sha256").update(`${ip}\n${userAgent}`).digest("hex");
}

function gatewayUnavailable() {
  return NextResponse.json(
    { error: "Public session gateway is not configured" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function statusResponse(data: unknown) {
  const body = data as {
    action?: string;
    rate_limited?: boolean;
    retry_after_seconds?: number;
  } | null;

  if (body?.rate_limited) {
    const retryAfter = Math.max(1, body.retry_after_seconds ?? 600);
    return NextResponse.json(
      { error: "rate_limited", retry_after_seconds: retryAfter },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const status = body?.action === "stop_using_resource" ? 410 : 200;
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function gatewayError(message: string) {
  const configurationError = message.includes("gateway authentication failed");
  return NextResponse.json(
    { error: configurationError ? "Public session gateway is unavailable" : message },
    {
      status: configurationError ? 503 : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const secret = gatewaySecret();
  if (!secret) return gatewayUnavailable();

  const { statusId } = await params;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc(
    "gateway_check_compute_public_session",
    {
      p_gateway_secret: secret,
      p_public_status_id: statusId,
      p_resource_version: resourceVersion(request),
      p_client_fingerprint: clientFingerprint(request),
    },
  );

  if (error) return gatewayError(error.message);
  return statusResponse(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const secret = gatewaySecret();
  if (!secret) return gatewayUnavailable();

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: { compute_usage?: unknown } | null = null;
  try {
    body = JSON.parse(rawBody) as { compute_usage?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const usage = body?.compute_usage;
  if (typeof usage !== "string") {
    return NextResponse.json(
      { error: "compute_usage must be a string with at most 8 lines" },
      { status: 400 },
    );
  }

  const normalizedUsage = usage.replace(/\r\n?/g, "\n");
  if (normalizedUsage.split("\n").length > 8) {
    return NextResponse.json(
      { error: "compute_usage must be at most 8 lines" },
      { status: 400 },
    );
  }

  const { statusId } = await params;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc(
    "gateway_report_compute_public_session",
    {
      p_gateway_secret: secret,
      p_public_status_id: statusId,
      p_resource_version: resourceVersion(request),
      p_compute_usage: normalizedUsage,
      p_client_fingerprint: clientFingerprint(request),
    },
  );

  if (error) return gatewayError(error.message);
  return statusResponse(data);
}

import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { NextResponse } from "next/server";
import { createPublicClient } from "../../../../../../lib/supabase/public";

const MAX_BODY_BYTES = 4 * 1024;

function gatewaySecret() {
  return process.env.COMPUTE_GATEWAY_SECRET ?? "";
}

function clientFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return createHash("sha256").update(`${ip}\n${userAgent}`).digest("hex");
}

function base64url(value: Buffer) {
  return value.toString("base64url");
}

function errorResponse(message: string) {
  if (message.includes("gateway authentication failed")) {
    return NextResponse.json(
      { error: "instruction_gateway_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (message.includes("instruction access denied")) {
    return NextResponse.json(
      { error: "instruction_access_denied" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { error: "instruction_request_failed" },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ statusId: string }> },
) {
  const gateway = gatewaySecret();
  if (!gateway) {
    return NextResponse.json(
      { error: "instruction_gateway_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }

  let body: { session_secret?: unknown };
  try {
    body = JSON.parse(raw) as { session_secret?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionSecret = body.session_secret;
  if (
    typeof sessionSecret !== "string" ||
    !sessionSecret.startsWith("csk_") ||
    sessionSecret.length > 160
  ) {
    return NextResponse.json(
      { error: "invalid_session_secret" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { statusId } = await params;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc(
    "gateway_get_session_instruction_bundle",
    {
      p_gateway_secret: gateway,
      p_public_status_id: statusId,
      p_session_secret: sessionSecret,
      p_client_fingerprint: clientFingerprint(request),
    },
  );

  if (error) return errorResponse(error.message);

  const bundle = data as {
    action?: string;
    rate_limited?: boolean;
    retry_after_seconds?: number;
    resource?: { version?: number };
  } | null;

  if (bundle?.rate_limited) {
    const retryAfter = Math.max(1, bundle.retry_after_seconds ?? 600);
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

  if (bundle?.action === "stop_using_resource") {
    return NextResponse.json(
      { action: "stop_using_resource" },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  const key = createHash("sha256").update(sessionSecret, "utf8").digest();
  const iv = randomBytes(12);
  const version = bundle?.resource?.version ?? "unknown";
  const aadText = `compute-registry:v1:${statusId}:${version}`;
  const aad = Buffer.from(aadText, "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return NextResponse.json(
    {
      envelope_version: 1,
      algorithm: "AES-256-GCM",
      key_derivation: "SHA-256 of the UTF-8 session_secret",
      encoding: "base64url",
      resource_version: version,
      iv: base64url(iv),
      aad: base64url(aad),
      ciphertext: base64url(ciphertext),
      auth_tag: base64url(tag),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

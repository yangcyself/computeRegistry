'use server';

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "../../../lib/supabase/server";

export type GatewaySecretState = {
  error?: string;
  secret?: string;
};

export async function rotateGatewaySecret(
  _: GatewaySecretState,
): Promise<GatewaySecretState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: isAdmin } = await supabase.rpc("is_compute_admin");

  if (!claims?.claims || !isAdmin) {
    return { error: "Admin access is required." };
  }

  const secret = randomBytes(48).toString("hex");
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const { error } = await supabase.rpc("set_compute_gateway_secret_hash", {
    p_secret_hash: secretHash,
  });

  if (error) {
    return { error: error.message };
  }

  return { secret };
}

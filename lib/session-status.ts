import { createPublicClient } from "./supabase/public";

export async function getSessionTokenStatus(token: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_compute_session_token_status", { p_token: token });
  if (error) return null;
  return data as null | {
    found?: boolean;
    state?: string;
    terminal?: boolean;
    action?: string;
    message?: string;
  };
}

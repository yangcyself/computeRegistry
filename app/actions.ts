'use server';

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";

export async function createResource(formData: FormData) {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const description = String(formData.get("description") ?? "").trim();

  if (!name || !slug) return;

  const { error } = await supabase.from("resources").insert({ name, slug, description });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function revokeSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "Revoked by registry owner").trim();
  if (!sessionId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_compute_session", {
    p_session_id: sessionId,
    p_reason: reason || "Revoked by registry owner",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
}

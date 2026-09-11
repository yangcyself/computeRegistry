import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { SessionForm } from "./session-form";

export default async function NewSessionPage({ searchParams }: { searchParams: Promise<{ resource?: string }> }) {
  const { resource: resourceId } = await searchParams;
  if (!resourceId) notFound();

  const supabase = await createClient();
  const { data: resource, error } = await supabase
    .from("resources")
    .select("id,name")
    .eq("id", resourceId)
    .single();

  if (error || !resource) notFound();

  return (
    <main className="shell">
      <SessionForm resourceId={resource.id} resourceName={resource.name} />
    </main>
  );
}

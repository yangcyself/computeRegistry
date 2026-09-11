import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { ResourceEditor } from "../resource-editor";

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: resource, error } = await supabase
    .from("resources")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .single();

  if (error || !resource) notFound();

  return (
    <main className="shell narrow-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Resource registry</p>
          <h1>Edit {resource.name}</h1>
        </div>
        <Link className="secondary-button" href="/">Back</Link>
      </div>
      <section className="panel">
        <ResourceEditor
          initial={{
            id: resource.id,
            name: resource.name,
            slug: resource.slug,
            description: resource.description,
            kind: resource.kind,
            status: resource.status,
            connection_instructions: resource.connection_instructions,
            filesystem_instructions: resource.filesystem_instructions,
            environment_instructions: resource.environment_instructions,
            usage_rules: resource.usage_rules,
            project_restrictions: resource.project_restrictions,
            tags: resource.tags.join(", "),
            metadata: JSON.stringify(resource.metadata, null, 2),
          }}
        />
      </section>
    </main>
  );
}

import Link from "next/link";
import { ResourceEditor } from "../resource-editor";

export default function NewResourcePage() {
  return (
    <main className="shell narrow-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Resource registry</p>
          <h1>New resource</h1>
        </div>
        <Link className="secondary-button" href="/">Back</Link>
      </div>
      <section className="panel">
        <ResourceEditor />
      </section>
    </main>
  );
}

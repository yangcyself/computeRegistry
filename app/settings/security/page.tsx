import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { GatewaySecretPanel } from "./gateway-secret-panel";

export default async function SecuritySettingsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: isAdmin } = await supabase.rpc("is_compute_admin");

  if (!claims?.claims || !isAdmin) {
    redirect("/login");
  }

  return (
    <main className="shell narrow-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Compute Registry</p>
          <h1>Security</h1>
        </div>
        <Link className="secondary-button" href="/">Back to dashboard</Link>
      </header>

      <GatewaySecretPanel />

      <section className="panel">
        <h2>Current gateway model</h2>
        <p>
          Agents call only the public status route. The route applies request
          limits and authenticates to Supabase with the server-only gateway
          secret. The secret must never be placed in an agent handoff or a
          <code> NEXT_PUBLIC_*</code> variable.
        </p>
      </section>
    </main>
  );
}

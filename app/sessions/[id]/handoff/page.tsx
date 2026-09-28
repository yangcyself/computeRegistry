import Link from "next/link";

export default function SessionHandoffPage() {
  return (
    <main className="shell narrow-shell">
      <section className="panel">
        <p className="eyebrow">Session handoff</p>
        <h1>Session created</h1>
        <p className="lede">The assignment is active.</p>
        <Link className="secondary-button" href="/">Back to dashboard</Link>
      </section>
    </main>
  );
}

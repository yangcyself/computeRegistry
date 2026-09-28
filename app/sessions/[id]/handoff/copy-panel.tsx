'use client';

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

export function CopyPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    const text = ref.current?.innerText ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="panel prompt-panel">
      <div className="prompt-heading">
        <div>
          <p className="eyebrow">Session handoff</p>
          <h2>Copy this handoff</h2>
        </div>
        <div className="handoff-actions">
          <button type="button" onClick={copyAll}>{copied ? "Copied ✓" : "Copy all"}</button>
          <Link className="secondary-button" href="/">Back to dashboard</Link>
        </div>
      </div>
      <div ref={ref} className="handoff-content">{children}</div>
    </section>
  );
}

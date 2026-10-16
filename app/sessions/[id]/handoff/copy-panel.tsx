'use client';

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

type HandoffMode = "standard" | "encrypted";

export function CopyPanel({
  standard,
  encrypted,
}: {
  standard: ReactNode;
  encrypted: ReactNode;
}) {
  const router = useRouter();
  const standardRef = useRef<HTMLDivElement>(null);
  const encryptedRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<HandoffMode>("standard");
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");

  async function copyCurrent() {
    const ref = mode === "standard" ? standardRef : encryptedRef;
    const text = ref.current?.innerText ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function clearClipboardAndReturn() {
    setClearing(true);
    setClearError("");

    try {
      await navigator.clipboard.writeText("Clipboard cleared by Compute Registry");
      router.push("/");
    } catch {
      setClearError(
        "The browser did not allow clipboard clearing. Clear the clipboard manually before leaving.",
      );
      setClearing(false);
    }
  }

  return (
    <section className="panel prompt-panel">
      <div className="prompt-heading">
        <div>
          <p className="eyebrow">Session handoff</p>
          <h2>Copy this handoff</h2>
        </div>
        <div className="handoff-actions">
          <button type="button" onClick={copyCurrent}>
            {copied ? "Copied ✓" : "Copy current mode"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={clearClipboardAndReturn}
            disabled={clearing}
          >
            {clearing
              ? "Clearing clipboard…"
              : "Back to dashboard and clear clipboard"}
          </button>
        </div>
      </div>

      <div className="handoff-mode-tabs" role="tablist" aria-label="Handoff mode">
        <button
          type="button"
          className={mode === "standard" ? "mode-tab active" : "mode-tab"}
          onClick={() => {
            setMode("standard");
            setCopied(false);
          }}
        >
          Standard mode
        </button>
        <button
          type="button"
          className={mode === "encrypted" ? "mode-tab active" : "mode-tab"}
          onClick={() => {
            setMode("encrypted");
            setCopied(false);
          }}
        >
          Encrypted-update mode
        </button>
      </div>

      <p className="draft-note">
        Standard mode is simpler for automatic permission controls. Encrypted-update
        mode lets the agent retrieve later instruction revisions using a session
        secret, but that request may be blocked by an agent permission checker.
      </p>

      {clearError ? <p className="error-text">{clearError}</p> : null}

      <div
        ref={standardRef}
        className={mode === "standard" ? "handoff-content" : "handoff-content hidden"}
      >
        {standard}
      </div>
      <div
        ref={encryptedRef}
        className={mode === "encrypted" ? "handoff-content" : "handoff-content hidden"}
      >
        {encrypted}
      </div>
    </section>
  );
}

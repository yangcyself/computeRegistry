'use client';

import { useActionState, useState } from "react";
import { createSession, type SessionState } from "./actions";

const initialState: SessionState = {};

export function SessionForm({ resourceId, resourceName }: { resourceId: string; resourceName: string }) {
  const [state, action, pending] = useActionState(createSession, initialState);
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    if (!state.prompt) return;
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="session-layout">
      <form action={action} className="panel session-form">
        <input type="hidden" name="resource_id" value={resourceId} />
        <p className="eyebrow">New session</p>
        <h1>{resourceName}</h1>
        <label>Session label<input name="label" placeholder="e.g. ablation-run-7" /></label>
        <label>Project<input name="project" placeholder="e.g. diffusion-study" /></label>
        <label>Agent label<input name="agent_label" placeholder="e.g. codex / claude / cursor" /></label>
        <label className="checkbox-row"><input name="allow_contributions" type="checkbox" /> Allow agent note suggestions</label>
        <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create session"}</button>
        {state.error ? <p className="error-text">{state.error}</p> : null}
      </form>

      {state.prompt ? (
        <section className="panel prompt-panel">
          <div className="prompt-heading">
            <div><p className="eyebrow">Agent handoff</p><h2>Copy this prompt</h2></div>
            <button type="button" onClick={copyPrompt}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <pre>{state.prompt}</pre>
        </section>
      ) : null}
    </div>
  );
}

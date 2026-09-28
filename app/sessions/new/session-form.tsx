'use client';

import { useActionState } from "react";
import { createSession, type SessionState } from "./actions";

const initialState: SessionState = {};

export function SessionForm({ resourceId, resourceName }: { resourceId: string; resourceName: string }) {
  const [state, action, pending] = useActionState(createSession, initialState);

  return (
    <div className="session-layout">
      <form action={action} className="panel session-form">
        <input type="hidden" name="resource_id" value={resourceId} />
        <p className="eyebrow">New session</p>
        <h1>{resourceName}</h1>
        <label>Session label<input name="label" placeholder="e.g. ablation-run-7" /></label>
        <label>Project<input name="project" placeholder="e.g. diffusion-study" /></label>
        <label>Agent label<input name="agent_label" placeholder="e.g. codex / claude / cursor" /></label>
        <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create session"}</button>
        {state.error ? <p className="error-text">{state.error}</p> : null}
      </form>
    </div>
  );
}

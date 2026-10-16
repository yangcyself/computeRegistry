'use client';

import { useActionState, useState } from "react";
import {
  rotateGatewaySecret,
  type GatewaySecretState,
} from "./actions";

const initialState: GatewaySecretState = {};

export function GatewaySecretPanel() {
  const [state, action, pending] = useActionState(
    rotateGatewaySecret,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  async function copySecret() {
    if (!state.secret) return;
    await navigator.clipboard.writeText(state.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="panel security-panel">
      <p className="eyebrow">Server gateway</p>
      <h2>Gateway secret</h2>
      <p>
        Generate a new server-only secret, then store it in Vercel as
        <code> COMPUTE_GATEWAY_SECRET</code> for Production, Preview, and
        Development. Redeploy after saving it.
      </p>
      <p>
        Generating a new value invalidates the previous gateway secret
        immediately. Existing agent status URLs remain the same.
      </p>

      <form action={action}>
        <button type="submit" disabled={pending}>
          {pending ? "Generating…" : "Generate and rotate secret"}
        </button>
      </form>

      {state.error ? <p className="error-text">{state.error}</p> : null}

      {state.secret ? (
        <div className="secret-result">
          <p><strong>Copy this value now. It is shown only in this response.</strong></p>
          <pre>{state.secret}</pre>
          <button type="button" onClick={copySecret}>
            {copied ? "Copied ✓" : "Copy secret"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

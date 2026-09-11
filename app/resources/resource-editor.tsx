'use client';

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ResourceDraft = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  status: "available" | "disabled" | "maintenance";
  connection_instructions: string;
  filesystem_instructions: string;
  environment_instructions: string;
  usage_rules: string;
  project_restrictions: string;
  tags: string;
  metadata: string;
};

const blank: ResourceDraft = {
  name: "",
  slug: "",
  description: "",
  kind: "compute",
  status: "available",
  connection_instructions: "",
  filesystem_instructions: "",
  environment_instructions: "",
  usage_rules: "",
  project_restrictions: "",
  tags: "",
  metadata: "{}",
};

export function ResourceEditor({ initial }: { initial?: Partial<ResourceDraft> }) {
  const router = useRouter();
  const base = useMemo(() => ({ ...blank, ...initial }), [initial]);
  const [draft, setDraft] = useState<ResourceDraft>(base);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const draftKey = `compute-registry:resource-draft:${initial?.id ?? "new"}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ResourceDraft>;
        setDraft((current) => ({ ...current, ...parsed }));
        setMessage("Recovered an unsaved local draft.");
      }
    } catch {
      // Ignore malformed browser storage.
    }
  }, [draftKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, draftKey]);

  function field<K extends keyof ResourceDraft>(key: K, value: ResourceDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/resources/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed");
      localStorage.removeItem(draftKey);
      setMessage("Saved.");
      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!draft.id) return;
    if (!window.confirm(`Archive ${draft.name}? Existing history will be kept.`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/resources/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Archive failed");
      localStorage.removeItem(draftKey);
      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Archive failed");
      setSaving(false);
    }
  }

  return (
    <form className="editor-form" onSubmit={submit}>
      {message ? <div className="form-message">{message}</div> : null}

      <div className="form-grid two">
        <label>Name<input value={draft.name} onChange={(e) => field("name", e.target.value)} required /></label>
        <label>Slug<input value={draft.slug} onChange={(e) => field("slug", e.target.value.toLowerCase())} pattern="[a-z0-9][a-z0-9-]*" required /></label>
        <label>Kind<input value={draft.kind} onChange={(e) => field("kind", e.target.value)} /></label>
        <label>Status<select value={draft.status} onChange={(e) => field("status", e.target.value as ResourceDraft["status"])}><option value="available">available</option><option value="maintenance">maintenance</option><option value="disabled">disabled</option></select></label>
      </div>

      <label>Description<textarea rows={3} value={draft.description} onChange={(e) => field("description", e.target.value)} /></label>
      <label>Connection instructions<textarea rows={8} value={draft.connection_instructions} onChange={(e) => field("connection_instructions", e.target.value)} placeholder="SSH host, usernames, VPN/jump host requirements, authentication mechanism..." /></label>
      <label>Filesystem / data locations<textarea rows={8} value={draft.filesystem_instructions} onChange={(e) => field("filesystem_instructions", e.target.value)} placeholder="Working directories, datasets, scratch space, persistent storage..." /></label>
      <label>Environment setup<textarea rows={8} value={draft.environment_instructions} onChange={(e) => field("environment_instructions", e.target.value)} placeholder="Modules, containers, conda/venv, scheduler setup..." /></label>
      <label>Usage rules<textarea rows={8} value={draft.usage_rules} onChange={(e) => field("usage_rules", e.target.value)} placeholder="GPU allocation, scheduler rules, cleanup, heartbeat expectations..." /></label>
      <label>Project restrictions<textarea rows={6} value={draft.project_restrictions} onChange={(e) => field("project_restrictions", e.target.value)} placeholder="Allowed projects, grant expiry, data restrictions..." /></label>
      <label>Tags<input value={draft.tags} onChange={(e) => field("tags", e.target.value)} placeholder="gpu, cuda, project-x" /></label>
      <label>Metadata (JSON)<textarea rows={5} value={draft.metadata} onChange={(e) => field("metadata", e.target.value)} /></label>

      <div className="editor-actions">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save changes" : "Create resource"}</button>
        {draft.id ? <button type="button" className="danger-button" onClick={archive} disabled={saving}>Archive resource</button> : null}
      </div>
      <p className="draft-note">Draft text is saved in this browser while you type and cleared after a successful save.</p>
    </form>
  );
}

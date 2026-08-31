import { getPreferenceValues } from "@vicinae/api";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type Prefs = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
};

export type ResolvedConfig = {
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  systemPrompt?: string;
  source: string;
};

function tryRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Fallback source when preferences are left empty: the codex-pooled setup
// (CLIProxyAPI on adipurush). Reading it at call time means a rotated token
// in ~/.bashrc is picked up without touching the extension.
function pooledConfig(): { baseUrl?: string; apiKey?: string; model?: string } {
  const toml = tryRead(join(homedir(), "codex-pooled", "config.toml"));
  const baseUrl = toml.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1];
  const model = toml.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  const bashrc = tryRead(join(homedir(), ".bashrc"));
  const apiKey = bashrc.match(/CLIPROXY_API_KEY=([A-Za-z0-9._-]+)/)?.[1];
  return { baseUrl, apiKey, model };
}

export function resolveConfig(): ResolvedConfig {
  const prefs = getPreferenceValues<Prefs>();
  const needsFallback = !prefs.baseUrl?.trim() || !prefs.apiKey?.trim() || !prefs.model?.trim();
  const pooled = needsFallback ? pooledConfig() : {};

  const baseUrl = prefs.baseUrl?.trim() || pooled.baseUrl;
  if (!baseUrl) {
    throw new Error(
      "No API base URL: set one in the Quick AI preferences, or ensure ~/codex-pooled/config.toml exists.",
    );
  }
  return {
    baseUrl,
    apiKey: prefs.apiKey?.trim() || pooled.apiKey,
    defaultModel: prefs.model?.trim() || pooled.model,
    systemPrompt: prefs.systemPrompt,
    source: prefs.baseUrl?.trim() ? "preferences" : "codex-pooled",
  };
}

export function authHeaders(cfg: ResolvedConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  return headers;
}

export function apiUrl(cfg: ResolvedConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function listModels(cfg: ResolvedConfig): Promise<string[]> {
  const res = await fetch(apiUrl(cfg, "models"), { headers: authHeaders(cfg) });
  if (!res.ok) {
    throw new Error(`GET /models failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}

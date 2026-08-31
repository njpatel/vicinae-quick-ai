import { apiUrl, authHeaders, ResolvedConfig } from "../config";
import { attachmentDataUrl, attachmentText, isImage } from "./attachments";
import { ChatMessage } from "./store";

export async function streamChat(
  cfg: ResolvedConfig,
  model: string,
  history: ChatMessage[],
  systemPrompt: string | undefined | null, // null = no system prompt; undefined = config default
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<void> {
  const messages: { role: string; content: unknown }[] = [];
  const system = systemPrompt === null ? undefined : systemPrompt?.trim() || cfg.systemPrompt?.trim();
  if (system) messages.push({ role: "system", content: system });
  for (const m of history) {
    if (m.role === "user" && m.attachments?.length) {
      let text = m.content;
      const parts: unknown[] = [];
      for (const a of m.attachments) {
        if (isImage(a)) {
          parts.push({ type: "image_url", image_url: { url: await attachmentDataUrl(a) } });
        } else {
          text += `\n\n[attached file: ${a.name}]\n\`\`\`\n${await attachmentText(a)}\n\`\`\``;
        }
      }
      parts.unshift({ type: "text", text });
      messages.push({ role: m.role, content: parts.length > 1 ? parts : text });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const res = await fetch(apiUrl(cfg, "chat/completions"), {
    method: "POST",
    headers: authHeaders(cfg),
    signal,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 500)}` : ""}`);
  }
  if (!res.body) throw new Error("Response had no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || !line.startsWith("data:")) continue;
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // partial/keepalive line — ignore
      }
    }
  }
}

export async function completeOnce(
  cfg: ResolvedConfig,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<void> {
  return streamChat(cfg, model, [{ role: "user", content: prompt, ts: Date.now() }], null, signal, onChunk);
}

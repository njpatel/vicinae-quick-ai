import { LocalStorage } from "@vicinae/api";

import type { Attachment } from "./attachments";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  ts: number;
  attachments?: Attachment[];
};

export type Conversation = {
  id: string;
  title: string;
  model?: string;
  systemPrompt?: string;
  presetName?: string;
  contextLabel?: string; // "selection" | "clipboard" when seeded with context text
  contextText?: string;
  messages: ChatMessage[];
  created: number;
  updated: number;
};

export type Preset = {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string;
};

export type AiCommand = {
  id: string;
  name: string;
  prompt: string; // may contain {selection}, {clipboard}, {argument}
  model?: string;
  builtin?: boolean;
};

const CONVERSATIONS_KEY = "quick-ai.conversations";
const PRESETS_KEY = "quick-ai.presets";
const DEFAULT_PRESET_KEY = "quick-ai.default-preset";
const COMMANDS_KEY = "quick-ai.commands";
const MAX_CONVERSATIONS = 50;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- conversations ---

export async function loadConversations(): Promise<Conversation[]> {
  const all = await readJson<Conversation[]>(CONVERSATIONS_KEY, []);
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const all = await loadConversations();
  const rest = all.filter((c) => c.id !== conv.id);
  const next = [conv, ...rest].slice(0, MAX_CONVERSATIONS);
  await LocalStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(next));
}

export async function deleteConversation(id: string): Promise<void> {
  const all = await loadConversations();
  await LocalStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(all.filter((c) => c.id !== id)));
}

export async function clearConversations(): Promise<void> {
  await LocalStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([]));
}

/**
 * Raycast-style "Start New Chat" timer: reuse the most recent conversation if
 * it was active within `timeoutMinutes`; otherwise the caller starts fresh.
 * 0 = always start new; a negative value = never expire.
 */
export async function activeConversation(timeoutMinutes: number): Promise<Conversation | undefined> {
  if (timeoutMinutes === 0) return undefined;
  // Context-seeded chats (selection/clipboard) are one-off: plain Ask AI must
  // never resume them, only ordinary conversations.
  const latest = (await loadConversations()).find((c) => !c.contextLabel);
  if (!latest || latest.messages.length === 0) return undefined;
  if (timeoutMinutes < 0) return latest;
  const ageMs = Date.now() - latest.updated;
  return ageMs <= timeoutMinutes * 60_000 ? latest : undefined;
}

export function newConversation(init?: Partial<Conversation>): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "",
    messages: [],
    created: Date.now(),
    updated: Date.now(),
    ...init,
  };
}

export function truncateTitle(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

// --- presets ---

export async function loadPresets(): Promise<Preset[]> {
  return readJson<Preset[]>(PRESETS_KEY, []);
}

export async function savePreset(preset: Preset): Promise<void> {
  const all = await loadPresets();
  const idx = all.findIndex((p) => p.id === preset.id);
  if (idx >= 0) all[idx] = preset;
  else all.push(preset);
  await LocalStorage.setItem(PRESETS_KEY, JSON.stringify(all));
}

export async function deletePreset(id: string): Promise<void> {
  const all = await loadPresets();
  await LocalStorage.setItem(PRESETS_KEY, JSON.stringify(all.filter((p) => p.id !== id)));
  if ((await LocalStorage.getItem<string>(DEFAULT_PRESET_KEY)) === id) {
    await LocalStorage.removeItem(DEFAULT_PRESET_KEY);
  }
}

export async function getDefaultPreset(): Promise<Preset | undefined> {
  const id = await LocalStorage.getItem<string>(DEFAULT_PRESET_KEY);
  if (!id) return undefined;
  return (await loadPresets()).find((p) => p.id === id);
}

export async function setDefaultPreset(id: string | undefined): Promise<void> {
  if (id) await LocalStorage.setItem(DEFAULT_PRESET_KEY, id);
  else await LocalStorage.removeItem(DEFAULT_PRESET_KEY);
}

// --- AI commands ---

export const BUILTIN_COMMANDS: AiCommand[] = [
  {
    id: "builtin.fix-spelling",
    name: "Fix Spelling and Grammar",
    prompt:
      "Fix the spelling, grammar and punctuation of the following text. Keep the original language, meaning, tone and formatting. Reply with ONLY the corrected text, no explanations:\n\n{selection}",
    builtin: true,
  },
  {
    id: "builtin.improve-writing",
    name: "Improve Writing",
    prompt:
      "Improve the following text: fix grammar, make it clearer and more concise while keeping the original language, meaning and tone. Reply with ONLY the improved text, no explanations:\n\n{selection}",
    builtin: true,
  },
  {
    id: "builtin.explain-simply",
    name: "Explain This in Simple Terms",
    prompt: "Explain the following in simple terms a non-expert can understand:\n\n{selection}",
    builtin: true,
  },
  {
    id: "builtin.summarize",
    name: "Summarize",
    prompt: "Summarize the following text concisely, keeping the key points:\n\n{selection}",
    builtin: true,
  },
  {
    id: "builtin.professional",
    name: "Change Tone to Professional",
    prompt:
      "Rewrite the following text with a professional tone. Keep the original language and meaning. Reply with ONLY the rewritten text:\n\n{selection}",
    builtin: true,
  },
  {
    id: "builtin.translate",
    name: "Translate To…",
    prompt:
      'Translate the following text to {argument name="Language"}. Reply with ONLY the translation:\n\n{selection}',
    builtin: true,
  },
];

export async function loadCustomCommands(): Promise<AiCommand[]> {
  return readJson<AiCommand[]>(COMMANDS_KEY, []);
}

export async function saveCustomCommand(cmd: AiCommand): Promise<void> {
  const all = await loadCustomCommands();
  const idx = all.findIndex((c) => c.id === cmd.id);
  if (idx >= 0) all[idx] = cmd;
  else all.push(cmd);
  await LocalStorage.setItem(COMMANDS_KEY, JSON.stringify(all));
}

export async function deleteCustomCommand(id: string): Promise<void> {
  const all = await loadCustomCommands();
  await LocalStorage.setItem(COMMANDS_KEY, JSON.stringify(all.filter((c) => c.id !== id)));
}

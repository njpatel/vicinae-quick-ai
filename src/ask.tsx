import {
  Action,
  ActionPanel,
  clearSearchBar,
  Detail,
  getPreferenceValues,
  Icon,
  LaunchProps,
  List,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveConfig } from "./config";
import { streamChat } from "./lib/api";
import { Attachment, fileToAttachment, isImage, readClipboardAttachment } from "./lib/attachments";
import { Form, showToast, Toast } from "@vicinae/api";
import { currentModel, ModelList } from "./model-list";
import {
  activeConversation,
  Conversation,
  deleteConversation,
  getDefaultPreset,
  loadConversations,
  newConversation,
  saveConversation,
  truncateTitle,
} from "./lib/store";

type AskPrefs = { primaryAction?: string; newChatMinutes?: string; sidebarCount?: string };

function newChatTimeout(): number {
  const raw = getPreferenceValues<AskPrefs>().newChatMinutes?.trim().toLowerCase();
  if (!raw) return 0; // default: every launch starts a new chat
  if (raw === "never") return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function sidebarCount(): number {
  const n = Number(getPreferenceValues<AskPrefs>().sidebarCount?.trim() || "8");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}

export function contextConversation(label: string, text: string): Conversation {
  return newConversation({
    contextLabel: label,
    contextText: text,
    systemPrompt:
      `You are a quick-answer assistant inside a launcher. The user is asking about the following ${label}:\n\n` +
      `"""\n${text}\n"""\n\n` +
      `Answer directly and concisely in Markdown, grounded in that ${label}.`,
  });
}

function contextExcerpt(conv: Conversation, max = 160): string {
  const oneLine = (conv.contextText ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function contextBanner(conv: Conversation): string {
  return conv.contextLabel ? `> **${conv.contextLabel}:** ${contextExcerpt(conv)}\n\n` : "";
}

const FOLLOW_UP_NOTE = "\n\n \n\n*Type to ask a follow-up…*";

// The main pane: answers only, separated by rules, a dim italic follow-up hint
// after each finished answer.
//
// IMPORTANT: this document must only ever GROW by appending. Vicinae's
// markdown view keeps scroll pinned to the bottom only while each update is a
// strict prefix-extension of the previous one; anything else is a model reset
// that jumps to the top. That is why there is no trailing streaming cursor and
// why the follow-up note stays in place between answers (it doubles as part of
// the separator).
function answersMarkdown(conv: Conversation, streaming: boolean, error: string | null): string {
  if (conv.messages.length === 0) {
    const hint = conv.presetName ? `*Ask anything — preset: ${conv.presetName}…*` : "*Ask anything…*";
    return contextBanner(conv) + hint;
  }
  let body = contextBanner(conv);
  let firstExchange = true;
  for (let i = 0; i < conv.messages.length; i++) {
    const m = conv.messages[i];
    const lastMsg = i === conv.messages.length - 1;
    if (m.role === "user") {
      if (!firstExchange) body += "\n\n---\n\n";
      firstExchange = false;
      // Question as a quiet blockquote (thin bar, muted); input clears on submit.
      body += `> **${m.content.replace(/\n/g, "\n> ")}**\n\n`;
      if (m.attachments?.length) {
        body += m.attachments.map((a) => `*📎 ${a.name}*`).join("  ") + "\n\n";
      }
    } else {
      body += m.content;
      if (!(lastMsg && streaming)) body += FOLLOW_UP_NOTE; // answer finished
    }
  }
  if (error) body += `\n\n**Error:**\n\n\`\`\`\n${error}\n\`\`\``;
  return body;
}

function conversationMarkdown(conv: Conversation, streaming: boolean): string {
  const header = contextBanner(conv);
  if (conv.messages.length === 0) return header + "*Ask anything…*";
  const parts: string[] = header ? [header.trimEnd()] : [];
  for (let i = 0; i < conv.messages.length; i++) {
    const m = conv.messages[i];
    const last = i === conv.messages.length - 1;
    if (m.role === "user") {
      for (const a of m.attachments ?? []) {
        parts.push(isImage(a) ? `![${a.name}](file://${a.path})` : `📄 *${a.name}*`);
      }
      parts.push(`### ${m.content}`);
    } else {
      parts.push(m.content + (last && streaming ? " ▌" : ""));
      if (!last) parts.push("---");
    }
  }
  if (streaming && conv.messages[conv.messages.length - 1]?.role === "user") parts.push("▌");
  return parts.join("\n\n");
}

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Re-render on an interval so the pushed full transcript picks up streaming
// appends happening in the parent (state lives in a shared ref, not props).
function usePolling(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

type Shared = {
  conversation: Conversation;
  streaming: boolean;
  error: string | null;
};

function TranscriptView({
  shared,
  onRegenerate,
  onRegenerateWith,
}: {
  shared: React.RefObject<Shared>;
  onRegenerate: () => void;
  onRegenerateWith: (model: string) => void;
}) {
  const { pop } = useNavigation();
  usePolling(80);

  const prefs = getPreferenceValues<AskPrefs>();
  const state = shared.current!;
  const conv = state.conversation;
  const lastAnswer = [...conv.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const lastQuestion = [...conv.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const body = state.error
    ? conversationMarkdown(conv, false) + `\n\n**Error:**\n\n\`\`\`\n${state.error}\n\`\`\``
    : conversationMarkdown(conv, state.streaming);

  const pasteFirst = (prefs.primaryAction ?? "paste") === "paste";
  const outputActions = [
    <Action.Paste key="paste" title="Paste Answer" content={lastAnswer} />,
    <Action.CopyToClipboard key="copy" title="Copy Answer" content={lastAnswer} />,
  ];
  if (!pasteFirst) outputActions.reverse();

  return (
    <Detail
      navigationTitle={conv.model ? `Quick AI — ${conv.model}` : "Quick AI"}
      markdown={body}
      actions={
        <ActionPanel>
          <Action title="Ask Follow-Up" icon={Icon.SpeechBubble} onAction={() => pop()} />
          {lastAnswer && outputActions}
          {lastAnswer && (
            <Action.CopyToClipboard title="Copy Question and Answer" content={`Q: ${lastQuestion}\n\n${lastAnswer}`} />
          )}
          <Action
            title="Regenerate"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRegenerate}
          />
          <Action.Push
            title="Regenerate with Model…"
            icon={Icon.Switch}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            target={<ModelList onPicked={onRegenerateWith} />}
          />
        </ActionPanel>
      }
    />
  );
}

export default function Ask(
  props: LaunchProps<{ arguments: { query?: string } }> & {
    conversation?: Conversation;
    attachment?: Attachment;
  },
) {
  const { push } = useNavigation();
  // Sidebar model: active/draft conversation first, then recent ones. Order is
  // frozen for the session so selection doesn't jump around on updates.
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Attachment[]>(props.attachment ? [props.attachment] : []);
  const pendingRef = useRef<Attachment[]>(props.attachment ? [props.attachment] : []);

  const convsRef = useRef<Conversation[]>([]);
  convsRef.current = convs;
  const activeIdRef = useRef("");
  activeIdRef.current = activeId;
  const searchTextRef = useRef("");
  searchTextRef.current = searchText;

  const activeConv = convs.find((c) => c.id === activeId);

  // Two-frame reveal: when a conversation (re)becomes active, render a
  // one-character stub first, then the full document. The markdown view only
  // pins scroll to the bottom on APPENDS made while at the bottom — a
  // fully-loaded document starts at the top and never sticks. The stub is
  // "at bottom" trivially, so the append to full content lands pinned at the
  // end, where the newest answer is.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  useEffect(() => {
    setRevealedId(null);
    const t = setTimeout(() => setRevealedId(activeId), 50);
    return () => clearTimeout(t);
  }, [activeId]);

  const sharedRef = useRef<Shared>({ conversation: newConversation(), streaming: false, error: null });
  if (activeConv) {
    sharedRef.current = {
      conversation: activeConv,
      streaming: streamingId === activeId,
      error: error?.id === activeId ? error.msg : null,
    };
  }

  const abortRef = useRef<AbortController | null>(null);

  const persist = useCallback((conv: Conversation) => {
    setConvs((prev) => prev.map((c) => (c.id === conv.id ? { ...conv } : c)));
    void saveConversation(conv);
  }, []);

  const runCompletion = useCallback(
    async (conv: Conversation, modelOverride?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStreamingId(conv.id);

      try {
        const cfg = resolveConfig();
        const model = modelOverride || conv.model || (await currentModel());
        if (!model) throw new Error('No model selected — run "Select AI Model" first.');
        conv.model = model;

        const answer = { role: "assistant" as const, content: "", ts: Date.now() };
        conv.messages = [...conv.messages, answer];

        await streamChat(cfg, model, conv.messages.slice(0, -1), conv.systemPrompt, controller.signal, (chunk) => {
          answer.content += chunk;
          conv.updated = Date.now();
          persist(conv);
        });
        conv.updated = Date.now();
        persist(conv);
      } catch (e: any) {
        if (e?.name !== "AbortError") setError({ id: conv.id, msg: String(e?.message ?? e) });
      } finally {
        setStreamingId(null);
      }
    },
    [persist],
  );

  const ask = useCallback(
    async (question: string, conv: Conversation) => {
      if (!conv.title) conv.title = truncateTitle(question);
      const attachments = pendingRef.current.length ? pendingRef.current : undefined;
      pendingRef.current = [];
      setPending([]);
      conv.messages = [...conv.messages, { role: "user", content: question, ts: Date.now(), attachments }];
      conv.updated = Date.now();
      persist(conv);
      await runCompletion(conv);
    },
    [persist, runCompletion],
  );

  const addAttachments = useCallback(async (items: Attachment[]) => {
    if (!items.length) return;
    pendingRef.current = [...pendingRef.current, ...items];
    setPending([...pendingRef.current]);
    await showToast({
      style: Toast.Style.Success,
      title: `Attached ${items.map((a) => a.name).join(", ")}`,
      message: "Sent with your next question",
    });
  }, []);

  const attachFromClipboard = useCallback(async () => {
    const item = await readClipboardAttachment();
    if (!item) {
      await showToast({ style: Toast.Style.Failure, title: "Nothing attachable on the clipboard" });
      return;
    }
    await addAttachments([item]);
  }, [addAttachments]);

  const regenerate = useCallback(
    (modelOverride?: string) => {
      const conv = convsRef.current.find((c) => c.id === activeIdRef.current);
      if (!conv || conv.messages.length === 0) return;
      while (conv.messages.length && conv.messages[conv.messages.length - 1].role === "assistant") {
        conv.messages = conv.messages.slice(0, -1);
      }
      persist(conv);
      void runCompletion(conv, modelOverride);
    },
    [persist, runCompletion],
  );

  // When the user deliberately picks a chat in the sidebar, that intent
  // overrides the idle-timeout rollover — but only briefly. An unexpiring
  // flag here once suppressed the rollover hours later.
  const explicitPickAtRef = useRef(0);
  const explicitPickRecent = () => Date.now() - explicitPickAtRef.current < 2 * 60_000;


  const startNewChat = useCallback(async () => {
    const preset = await getDefaultPreset();
    const draft = newConversation({
      systemPrompt: preset?.systemPrompt,
      model: preset?.model,
      presetName: preset?.name,
    });
    setSearchText("");
    void clearSearchBar();
    setConvs((prev) => [draft, ...prev]);
    setActiveId(draft.id);
  }, []);

  // Initial load: pick the active conversation (explicit prop, or the recent
  // plain one within the new-chat window, or a fresh draft), then list the
  // last N conversations under it.
  useEffect(() => {
    const initial = props.arguments?.query?.trim() || props.fallbackText?.trim();
    (async () => {
      // A seeded attachment starts a fresh conversation, like other context chats.
      let active = props.conversation ?? (props.attachment ? undefined : await activeConversation(newChatTimeout()));
      if (!active && props.attachment) {
        // contextLabel keeps this out of plain Ask AI's continue-window
        active = newConversation({
          contextLabel: isImage(props.attachment) ? "image" : "file",
          contextText: props.attachment.name,
        });
      }
      if (!active) {
        const preset = await getDefaultPreset();
        active = newConversation({ systemPrompt: preset?.systemPrompt, model: preset?.model, presetName: preset?.name });
      }
      const recent = (await loadConversations()).filter((c) => c.id !== active!.id).slice(0, sidebarCount() - 1);
      setConvs([active, ...recent]);
      setActiveId(active.id);
      setLoaded(true);
      if (initial) {
        // Vicinae pre-fills the search bar with the fallback text; the
        // question now lives in the answer pane instead, so clear it.
        setSearchText("");
        void clearSearchBar();
        await ask(initial, active);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const q = searchText.trim();
    let conv = convsRef.current.find((c) => c.id === activeIdRef.current);
    if (!q || streamingId || !conv) return;
    setSearchText("");
    void clearSearchBar();

    // The extension session survives window hide/show, so the mount-time
    // continue-window check goes stale. Re-check at ask time: an active chat
    // that has been idle past the window rolls over to a fresh one — unless
    // the user explicitly selected it in the sidebar just now. With the
    // "always new on launch" setting (0), in-session follow-ups must still
    // continue, so idle rollover falls back to a 10-minute threshold.
    const timeout = newChatTimeout();
    const rollMinutes = timeout > 0 ? timeout : 10;
    const expired = timeout >= 0 && conv.messages.length > 0 && Date.now() - conv.updated > rollMinutes * 60_000;
    if (expired && !explicitPickRecent()) {
      void (async () => {
        const preset = await getDefaultPreset();
        const fresh = newConversation({
          systemPrompt: preset?.systemPrompt,
          model: preset?.model,
          presetName: preset?.name,
        });
        setConvs((prev) => [fresh, ...prev]);
        setActiveId(fresh.id);
        await ask(q, fresh);
      })();
      return;
    }
    explicitPickAtRef.current = 0;

    // Move the asked conversation to the top: recency order, and it makes the
    // list-model selection resets that typing triggers land on the right chat.
    setConvs((prev) => [conv!, ...prev.filter((c) => c.id !== conv!.id)]);
    void ask(q, conv);
  };

  const onInput = (text: string) => {
    // First real input: bubble the active chat to the top so the selection
    // reset that typing triggers keeps showing the chat being typed into.
    if (text && !searchTextRef.current) {
      const active = convsRef.current.find((c) => c.id === activeIdRef.current);
      if (active && convsRef.current[0]?.id !== active.id) {
        setConvs((prev) => [active, ...prev.filter((c) => c.id !== active.id)]);
      }
    }
    setSearchText(text);
  };

  const onSelect = (id: string) => {
    if (!id || id === activeIdRef.current) return;
    // Vicinae resets list selection to the first row whenever item props
    // change (every keystroke swaps the action panel). Ignore those spurious
    // jumps while the user has text in the input; real browsing happens with
    // an empty input.
    if (id === convsRef.current[0]?.id && searchTextRef.current.trim()) return;
    explicitPickAtRef.current = Date.now();
    setActiveId(id);
    setError(null);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    const rest = convsRef.current.filter((c) => c.id !== id);
    setConvs(rest);
    if (activeIdRef.current === id) {
      if (rest.length > 0) setActiveId(rest[0].id);
      else await startNewChat();
    }
  };

  const prefs = getPreferenceValues<AskPrefs>();
  const pasteFirst = (prefs.primaryAction ?? "paste") === "paste";

  return (
    <List
      filtering={false}
      isLoading={!loaded || streamingId !== null}
      isShowingDetail={convs.length > 0}
      searchText={searchText}
      onSearchTextChange={onInput}
      onSelectionChange={onSelect}
      searchBarPlaceholder={
        streamingId
          ? "Generating…"
          : pending.length
            ? "Ask about the attached image…"
            : activeConv?.messages.length
              ? "Ask follow-up…"
              : "Ask AI anything…"
      }
    >
      {convs.map((conv) => {
        const lastAnswer = [...conv.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
        const outputActions = [
          <Action.Paste key="paste" title="Paste Answer" content={lastAnswer} />,
          <Action.CopyToClipboard key="copy" title="Copy Answer" content={lastAnswer} />,
        ];
        if (!pasteFirst) outputActions.reverse();
        return (
          <List.Item
            key={conv.id}
            id={conv.id}
            title={conv.title || "New chat"}
            icon={
              conv.contextLabel === "selection"
                ? Icon.Text
                : conv.contextLabel === "clipboard"
                  ? Icon.CopyClipboard
                  : Icon.SpeechBubble
            }
            accessories={[
              ...(conv.id === activeId && pending.length ? [{ text: `📎${pending.length}` }] : []),
              ...(streamingId === conv.id
                ? [{ text: "…" }]
                : conv.messages.length
                  ? [{ text: when(conv.updated) }]
                  : []),
            ]}
            detail={
              <List.Item.Detail
                markdown={(() => {
                  const body = answersMarkdown(conv, streamingId === conv.id, error?.id === conv.id ? error.msg : null);
                  // stub frame of the two-frame reveal (see revealedId)
                  if (conv.id === activeId && revealedId !== activeId && conv.messages.length > 0) {
                    return body.slice(0, 1);
                  }
                  return body;
                })()}
              />
            }
            actions={
              <ActionPanel>
                {searchText.trim() && !streamingId && (
                  <Action title="Get Answer" icon={Icon.Bolt} onAction={submit} />
                )}
                {lastAnswer && outputActions}
                <Action
                  title="View Full Conversation"
                  icon={Icon.Eye}
                  shortcut={{ modifiers: ["ctrl"], key: "o" }}
                  onAction={() =>
                    push(
                      <TranscriptView
                        shared={sharedRef}
                        onRegenerate={() => regenerate()}
                        onRegenerateWith={(m) => regenerate(m)}
                      />,
                    )
                  }
                />
                <Action
                  title="Attach from Clipboard"
                  icon={Icon.Image}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
                  onAction={() => void attachFromClipboard()}
                />
                <Action.Push
                  title="Attach File…"
                  icon={Icon.Paperclip}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                  target={<AttachFileForm onAttach={(items) => void addAttachments(items)} />}
                />
                <Action
                  title="New Conversation"
                  icon={Icon.Plus}
                  shortcut={{ modifiers: ["cmd"], key: "n" }}
                  onAction={() => void startNewChat()}
                />
                <Action
                  title="Regenerate"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={() => regenerate()}
                />
                <Action.Push
                  title="Regenerate with Model…"
                  icon={Icon.Switch}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  target={<ModelList onPicked={(m) => regenerate(m)} />}
                />
                <Action
                  title="Delete Conversation"
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => void removeConversation(conv.id)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function AttachFileForm({ onAttach }: { onAttach: (items: Attachment[]) => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Attach File"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Attach"
            onSubmit={async (values) => {
              const paths = (values.files as string[] | undefined) ?? [];
              if (!paths.length) return;
              const items: Attachment[] = [];
              const errors: string[] = [];
              for (const p of paths) {
                try {
                  items.push(await fileToAttachment(p));
                } catch (e: any) {
                  errors.push(String(e?.message ?? e));
                }
              }
              if (errors.length) {
                await showToast({ style: Toast.Style.Failure, title: "Some files skipped", message: errors.join("; ") });
              }
              if (items.length) {
                onAttach(items);
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="files"
        title="Files"
        allowMultipleSelection
        canChooseDirectories={false}
        info="Images are sent for vision; text files are inlined as context."
      />
    </Form>
  );
}

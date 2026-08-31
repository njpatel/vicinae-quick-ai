import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  getPreferenceValues,
  getSelectedText,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useRef, useState } from "react";
import { resolveConfig } from "./config";
import { completeOnce } from "./lib/api";
import { currentModel } from "./model-list";
import {
  AiCommand,
  BUILTIN_COMMANDS,
  deleteCustomCommand,
  loadCustomCommands,
  saveCustomCommand,
} from "./lib/store";

const ARGUMENT_RE = /\{argument(?:\s+name="([^"]*)")?\}/;

async function inputText(): Promise<{ text: string; source: "selection" | "clipboard" }> {
  try {
    const sel = (await getSelectedText())?.trim();
    if (sel) return { text: sel, source: "selection" };
  } catch {
    // no selection available — fall through to clipboard
  }
  const clip = ((await Clipboard.readText()) ?? "").trim();
  return { text: clip, source: "clipboard" };
}

function CommandResult({ cmd, prompt, source }: { cmd: AiCommand; prompt: string; source: string }) {
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const outputRef = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    outputRef.current = "";
    setOutput("");
    setError(null);
    setLoading(true);

    (async () => {
      const cfg = resolveConfig();
      const model = cmd.model || (await currentModel());
      if (!model) throw new Error('No model selected — run "Select AI Model" first.');
      await completeOnce(cfg, model, prompt, controller.signal, (chunk) => {
        outputRef.current += chunk;
        setOutput(outputRef.current);
      });
    })()
      .catch((e) => {
        if (e?.name !== "AbortError") setError(String(e?.message ?? e));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [prompt, attempt]);

  const body = error
    ? `**Error:**\n\n\`\`\`\n${error}\n\`\`\``
    : (output || "") + (loading ? " ▌" : "");

  return (
    <Detail
      navigationTitle={cmd.name}
      markdown={`**${cmd.name}** *(input from ${source})*\n\n---\n\n${body}`}
      actions={
        <ActionPanel>
          {/* Pasting while the source app still holds the selection replaces it */}
          <Action.Paste title="Paste Result (replaces selection)" content={output} />
          <Action.CopyToClipboard title="Copy Result" content={output} />
          <Action
            title="Regenerate"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => setAttempt((n) => n + 1)}
          />
        </ActionPanel>
      }
    />
  );
}

function ArgumentForm({ cmd, argName, onSubmit }: { cmd: AiCommand; argName: string; onSubmit: (v: string) => void }) {
  return (
    <Form
      navigationTitle={cmd.name}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Run" onSubmit={(values) => onSubmit(String(values.argument ?? "").trim())} />
        </ActionPanel>
      }
    >
      <Form.TextField id="argument" title={argName || "Argument"} autoFocus />
    </Form>
  );
}

function CommandForm({ cmd, onSaved }: { cmd?: AiCommand; onSaved: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Command"
            onSubmit={async (values) => {
              const name = String(values.name ?? "").trim();
              const prompt = String(values.prompt ?? "").trim();
              if (!name || !prompt) {
                await showToast({ style: Toast.Style.Failure, title: "Name and prompt are required" });
                return;
              }
              await saveCustomCommand({ id: cmd?.id ?? crypto.randomUUID(), name, prompt });
              await showToast({ style: Toast.Style.Success, title: `Command "${name}" saved` });
              onSaved();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" defaultValue={cmd?.name} placeholder="e.g. Make It Shorter" />
      <Form.TextArea
        id="prompt"
        title="Prompt"
        defaultValue={cmd?.prompt}
        placeholder={'Use {selection} for the selected text, {clipboard} for clipboard, {argument name="X"} to ask.'}
      />
    </Form>
  );
}

export default function AiCommandsCommand() {
  const { push } = useNavigation();
  const [custom, setCustom] = useState<AiCommand[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setCustom(await loadCustomCommands());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const run = async (cmd: AiCommand, argValue?: string) => {
    let prompt = cmd.prompt;

    const argMatch = prompt.match(ARGUMENT_RE);
    if (argMatch && argValue === undefined) {
      push(<ArgumentForm cmd={cmd} argName={argMatch[1] ?? "Argument"} onSubmit={(v) => void run(cmd, v)} />);
      return;
    }
    if (argMatch) prompt = prompt.replace(ARGUMENT_RE, argValue ?? "");

    let source = "prompt";
    if (prompt.includes("{selection}") || prompt.includes("{clipboard}")) {
      const input = await inputText();
      if (!input.text) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Nothing to work on",
          message: "No text selection and clipboard is empty",
        });
        return;
      }
      source = input.source;
      prompt = prompt.replaceAll("{selection}", input.text).replaceAll("{clipboard}", input.text);
    }

    push(<CommandResult cmd={cmd} prompt={prompt} source={source} />);
  };

  const createAction = (
    <Action.Push
      title="Create Command"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={<CommandForm onSaved={() => void refresh()} />}
    />
  );

  const renderItem = (cmd: AiCommand) => (
    <List.Item
      key={cmd.id}
      title={cmd.name}
      subtitle={cmd.builtin ? "" : truncate(cmd.prompt)}
      icon={cmd.builtin ? Icon.Stars : Icon.Pencil}
      actions={
        <ActionPanel>
          <Action title="Run on Selection" icon={Icon.Bolt} onAction={() => void run(cmd)} />
          {!cmd.builtin && (
            <Action.Push
              title="Edit Command"
              icon={Icon.Pencil}
              shortcut={{ modifiers: ["cmd"], key: "e" }}
              target={<CommandForm cmd={cmd} onSaved={() => void refresh()} />}
            />
          )}
          {createAction}
          {!cmd.builtin && (
            <Action
              title="Delete Command"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["ctrl"], key: "x" }}
              onAction={async () => {
                await deleteCustomCommand(cmd.id);
                await refresh();
              }}
            />
          )}
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={loading} searchBarPlaceholder="Search AI commands…">
      <List.Section title="Custom">{custom.map(renderItem)}</List.Section>
      <List.Section title="Built-in">{BUILTIN_COMMANDS.map(renderItem)}</List.Section>
    </List>
  );
}

function truncate(text: string, max = 70): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

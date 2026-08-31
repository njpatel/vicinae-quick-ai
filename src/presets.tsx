import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import Ask from "./ask";
import { listModels, resolveConfig } from "./config";
import {
  deletePreset,
  getDefaultPreset,
  loadPresets,
  newConversation,
  Preset,
  savePreset,
  setDefaultPreset,
} from "./lib/store";

function PresetForm({ preset, onSaved }: { preset?: Preset; onSaved: () => void }) {
  const { pop } = useNavigation();
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setModels(await listModels(resolveConfig()));
      } catch {
        setModels([]);
      }
    })();
  }, []);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Preset"
            onSubmit={async (values) => {
              const name = String(values.name ?? "").trim();
              const systemPrompt = String(values.systemPrompt ?? "").trim();
              if (!name || !systemPrompt) {
                await showToast({ style: Toast.Style.Failure, title: "Name and system prompt are required" });
                return;
              }
              await savePreset({
                id: preset?.id ?? crypto.randomUUID(),
                name,
                systemPrompt,
                model: String(values.model ?? "") || undefined,
              });
              await showToast({ style: Toast.Style.Success, title: `Preset "${name}" saved` });
              onSaved();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" defaultValue={preset?.name} placeholder="e.g. Code Reviewer" />
      <Form.TextArea
        id="systemPrompt"
        title="System Prompt"
        defaultValue={preset?.systemPrompt}
        placeholder="You are a…"
      />
      <Form.Dropdown id="model" title="Model" defaultValue={preset?.model ?? ""}>
        <Form.Dropdown.Item value="" title="(current default)" />
        {models.map((m) => (
          <Form.Dropdown.Item key={m} value={m} title={m} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export default function PresetsCommand() {
  const { push } = useNavigation();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [defaultId, setDefaultId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setPresets(await loadPresets());
    setDefaultId((await getDefaultPreset())?.id);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const createAction = (
    <Action.Push
      title="Create Preset"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={<PresetForm onSaved={() => void refresh()} />}
    />
  );

  return (
    <List isLoading={loading} searchBarPlaceholder="Search presets…">
      {presets.length === 0 && !loading ? (
        <List.EmptyView
          title="No presets yet"
          description="Create one: a name + system prompt (+ optional model)"
          icon={Icon.Stars}
          actions={<ActionPanel>{createAction}</ActionPanel>}
        />
      ) : (
        presets.map((p) => (
          <List.Item
            key={p.id}
            title={p.name}
            subtitle={p.model ?? ""}
            accessories={p.id === defaultId ? [{ text: "default" }] : []}
            icon={p.id === defaultId ? Icon.Star : Icon.Circle}
            actions={
              <ActionPanel>
                <Action
                  title="Start Chat with Preset"
                  icon={Icon.SpeechBubble}
                  onAction={() =>
                    push(
                      <Ask
                        conversation={newConversation({
                          systemPrompt: p.systemPrompt,
                          model: p.model,
                          presetName: p.name,
                        })}
                        arguments={{}}
                        launchType={"userInitiated" as any}
                      />,
                    )
                  }
                />
                <Action
                  title={p.id === defaultId ? "Unset as Default" : "Set as Default"}
                  icon={Icon.Star}
                  onAction={async () => {
                    await setDefaultPreset(p.id === defaultId ? undefined : p.id);
                    await refresh();
                  }}
                />
                <Action.Push
                  title="Edit Preset"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={<PresetForm preset={p} onSaved={() => void refresh()} />}
                />
                {createAction}
                <Action
                  title="Delete Preset"
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={async () => {
                    await deletePreset(p.id);
                    await showToast({ style: Toast.Style.Success, title: "Deleted" });
                    await refresh();
                  }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

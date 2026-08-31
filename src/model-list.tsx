import {
  Action,
  ActionPanel,
  Icon,
  List,
  LocalStorage,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import { listModels, resolveConfig } from "./config";

export const MODEL_STORAGE_KEY = "quick-ai.model";

export async function currentModel(): Promise<string | undefined> {
  const stored = await LocalStorage.getItem<string>(MODEL_STORAGE_KEY);
  if (stored) return stored;
  try {
    return resolveConfig().defaultModel;
  } catch {
    return undefined;
  }
}

export function ModelList({ onPicked }: { onPicked?: (model: string) => void }) {
  const { pop } = useNavigation();
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cfg = resolveConfig();
        const [ids, current] = await Promise.all([listModels(cfg), currentModel()]);
        setModels(ids);
        setSelected(current);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pick = async (model: string) => {
    await LocalStorage.setItem(MODEL_STORAGE_KEY, model);
    setSelected(model);
    await showToast({ style: Toast.Style.Success, title: `Model set to ${model}` });
    if (onPicked) {
      onPicked(model);
      pop();
    }
  };

  return (
    <List isLoading={loading} searchBarPlaceholder="Filter models…">
      {error ? (
        <List.EmptyView title="Could not list models" description={error} icon={Icon.Warning} />
      ) : (
        models.map((id) => (
          <List.Item
            key={id}
            title={id}
            icon={id === selected ? Icon.CheckCircle : Icon.Circle}
            accessories={id === selected ? [{ text: "current" }] : []}
            actions={
              <ActionPanel>
                <Action title="Use This Model" onAction={() => pick(id)} />
                <Action.CopyToClipboard title="Copy Model Name" content={id} />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

export default function SelectModelCommand() {
  return <ModelList />;
}

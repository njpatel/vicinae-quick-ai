import {
  Action,
  ActionPanel,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import Ask from "./ask";
import { clearConversations, Conversation, deleteConversation, loadConversations } from "./lib/store";

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function HistoryCommand() {
  const { push } = useNavigation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setConversations(await loadConversations());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <List isLoading={loading} searchBarPlaceholder="Search conversations…">
      {conversations.length === 0 && !loading ? (
        <List.EmptyView title="No conversations yet" description="Ask AI something first" icon={Icon.SpeechBubble} />
      ) : (
        conversations.map((c) => (
          <List.Item
            key={c.id}
            title={c.title || "(untitled)"}
            subtitle={c.presetName ? `${c.presetName} · ${c.model ?? ""}` : (c.model ?? "")}
            accessories={[{ text: `${Math.ceil(c.messages.length / 2)} ✉ · ${when(c.updated)}` }]}
            icon={Icon.SpeechBubble}
            actions={
              <ActionPanel>
                <Action
                  title="Continue Conversation"
                  icon={Icon.ArrowRight}
                  onAction={() => push(<Ask conversation={c} arguments={{}} launchType={"userInitiated" as any} />)}
                />
                <Action.CopyToClipboard
                  title="Copy Conversation"
                  content={c.messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content}`).join("\n\n")}
                />
                <Action
                  title="Delete Conversation"
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={async () => {
                    await deleteConversation(c.id);
                    await showToast({ style: Toast.Style.Success, title: "Deleted" });
                    await refresh();
                  }}
                />
                <Action
                  title="Clear All History"
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
                  onAction={async () => {
                    await clearConversations();
                    await showToast({ style: Toast.Style.Success, title: "History cleared" });
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

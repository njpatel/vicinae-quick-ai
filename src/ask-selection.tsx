import { getSelectedText, Icon, LaunchProps, List } from "@vicinae/api";
import { execFile } from "child_process";
import { useEffect, useState } from "react";
import Ask, { contextConversation } from "./ask";

// Vicinae's getSelectedText only works on a fresh selection; the Wayland
// primary selection is still readable after that, so fall back to wl-paste.
function primarySelection(): Promise<string> {
  return new Promise((resolve) => {
    execFile("wl-paste", ["--primary", "--no-newline"], { timeout: 3000 }, (err, stdout) =>
      resolve(err ? "" : stdout),
    );
  });
}

export default function AskSelection(props: LaunchProps<{ arguments: { query?: string } }>) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      let sel = "";
      try {
        sel = (await getSelectedText())?.trim() ?? "";
      } catch {
        // fall through to primary selection
      }
      if (!sel) sel = (await primarySelection()).trim();
      if (sel) setText(sel);
      else setFailed(true);
    })();
  }, []);

  if (failed) {
    return (
      <List>
        <List.EmptyView
          title="No text selected"
          description="Select some text in another app first, then run Ask AI about Selection"
          icon={Icon.Warning}
        />
      </List>
    );
  }
  if (text === null) return <List isLoading searchBarPlaceholder="Reading selection…" />;
  return <Ask {...props} conversation={contextConversation("selection", text)} />;
}

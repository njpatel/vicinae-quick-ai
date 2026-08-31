import { Clipboard, Icon, LaunchProps, List } from "@vicinae/api";
import { useEffect, useState } from "react";
import Ask, { contextConversation } from "./ask";
import { Attachment, readClipboardAttachment } from "./lib/attachments";

export default function AskClipboard(props: LaunchProps<{ arguments: { query?: string } }>) {
  const [text, setText] = useState<string | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const clip = ((await Clipboard.readText()) ?? "").trim();
      const looksLikeFile = clip.startsWith("file://") || (clip.startsWith("/") && !clip.includes("\n"));
      if (clip && !looksLikeFile) {
        setText(clip);
        return;
      }
      const img = await readClipboardAttachment();
      if (img) setImage(img);
      else if (clip) setText(clip);
      else setFailed(true);
    })();
  }, []);

  if (failed) {
    return (
      <List>
        <List.EmptyView
          title="Clipboard is empty"
          description="Copy some text or an image first, then run Ask AI about Clipboard"
          icon={Icon.Warning}
        />
      </List>
    );
  }
  if (image) return <Ask {...props} attachment={image} />;
  if (text === null) return <List isLoading searchBarPlaceholder="Reading clipboard…" />;
  return <Ask {...props} conversation={contextConversation("clipboard", text)} />;
}

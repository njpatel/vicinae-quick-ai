import { Clipboard } from "@vicinae/api";
import { execFile } from "child_process";
import { existsSync, mkdirSync, promises as fs } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

// kind is optional for backwards compatibility: attachments saved before text
// support existed are all images.
export type Attachment = { name: string; path: string; mime: string; kind?: "image" | "text" };

const IMAGE_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_TEXT_BYTES = 256 * 1024;
const CACHE_DIR = join(homedir(), ".cache", "quick-ai");

function extMime(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT[ext] ?? null;
}

function wlPaste(args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      "wl-paste",
      args,
      { timeout: 5000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (err, stdout) => resolve(err ? null : (stdout as Buffer)),
    );
  });
}

/**
 * Turn a file path into an attachment: images ride along as vision input,
 * anything that reads as UTF-8 text gets inlined as context. Binary
 * non-image files are rejected with an explanatory error.
 */
export async function fileToAttachment(path: string): Promise<Attachment> {
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);
  const imageMime = extMime(path);
  if (imageMime) return { name: basename(path), path, mime: imageMime, kind: "image" };

  const stat = await fs.stat(path);
  if (stat.isDirectory()) throw new Error(`${basename(path)} is a directory`);
  if (stat.size > MAX_TEXT_BYTES) {
    throw new Error(`${basename(path)} is too large for text context (>${MAX_TEXT_BYTES / 1024}KB)`);
  }
  const head = await fs.readFile(path);
  if (head.includes(0)) throw new Error(`${basename(path)} looks binary — only images and text files are supported`);
  return { name: basename(path), path, mime: "text/plain", kind: "text" };
}

/**
 * Find something attachable on the clipboard: a copied file (path/uri, image
 * or text), or raw image data (screenshots). Raw data is written to the cache
 * dir so it survives until the message is sent (and for history).
 */
export async function readClipboardAttachment(): Promise<Attachment | null> {
  const c = await Clipboard.read().catch(() => ({}) as Clipboard.ReadContent);

  const candidates: string[] = [];
  if (c.file) candidates.push(String(c.file));
  for (const u of c.urls ?? []) {
    if (u.startsWith("file://")) candidates.push(decodeURIComponent(new URL(u).pathname));
  }
  const t = c.text?.trim();
  if (t?.startsWith("file://")) candidates.push(decodeURIComponent(new URL(t).pathname));
  else if (t?.startsWith("/") && !t.includes("\n")) candidates.push(t);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return await fileToAttachment(path);
    } catch {
      // unsupported file type — keep looking
    }
  }

  // Raw image data (screenshots etc.) via wl-paste
  const types = (await wlPaste(["--list-types"]))?.toString() ?? "";
  const imageType = types.split("\n").find((x) => x.startsWith("image/"));
  if (imageType) {
    const data = await wlPaste(["-t", imageType]);
    if (data && data.length > 0) {
      mkdirSync(CACHE_DIR, { recursive: true });
      const ext = imageType.split("/")[1].split("+")[0];
      const path = join(CACHE_DIR, `clip-${Date.now()}.${ext}`);
      await fs.writeFile(path, data);
      return { name: `clipboard image (${ext})`, path, mime: imageType.split("+")[0], kind: "image" };
    }
  }
  return null;
}

export async function attachmentDataUrl(a: Attachment): Promise<string> {
  const data = await fs.readFile(a.path);
  if (data.length > 20 * 1024 * 1024) throw new Error(`Attachment ${a.name} is too large (>20MB)`);
  return `data:${a.mime};base64,${data.toString("base64")}`;
}

export async function attachmentText(a: Attachment): Promise<string> {
  return fs.readFile(a.path, "utf8");
}

export function isImage(a: Attachment): boolean {
  return (a.kind ?? "image") === "image";
}

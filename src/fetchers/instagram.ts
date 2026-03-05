import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { ContentBundle } from "../types.js";

const execFileAsync = promisify(execFile);
const ytDlp = config.ytDlpPath;

/** Extrahiert Caption aus yt-dlp info.json (alle bekannten Strukturen) */
function extractDescription(info: Record<string, unknown>): string {
  const d = info.description ?? info.fulldescription ?? info.caption;
  if (typeof d === "string" && d.length > 0) return d;
  if (d && typeof d === "object" && "text" in d && typeof (d as { text: unknown }).text === "string") {
    return (d as { text: string }).text;
  }
  const edges = (info as { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } }).edge_media_to_caption?.edges;
  const text = edges?.[0]?.node?.text;
  if (typeof text === "string" && text.length > 0) return text;
  return "";
}

/**
 * Fetch Instagram content using yt-dlp.
 * Identisch zum Original-Repo: Download mit --write-info-json, Metadaten aus info.json.
 */
export async function fetchInstagram(
  url: string,
  tempDir: string
): Promise<ContentBundle> {
  const outTemplate = join(tempDir, "insta.%(ext)s");

  try {
    await execFileAsync(ytDlp, [
      "--write-info-json",
      "--write-thumbnail",
      "--no-playlist",
      "-o", outTemplate,
      url,
    ], { timeout: 60_000 });
  } catch {
    // yt-dlp kann teilweise erfolgreich sein und trotzdem info.json schreiben
  }

  const files = await readdir(tempDir);

  let title = "";
  let description = "";
  let imageUrls: string[] = [];
  let audioPath: string | undefined;

  // Alle .info.json lesen (Reels können mehrere erzeugen)
  const infoFiles = files.filter((f) => f.endsWith(".info.json"));
  for (const infoFile of infoFiles) {
    try {
      const info = JSON.parse(
        await readFile(join(tempDir, infoFile), "utf-8")
      ) as Record<string, unknown>;
      if (!title) title = String(info.title ?? info.fulltitle ?? "");
      const desc = extractDescription(info);
      if (desc.length > description.length) description = desc;

      if (info.thumbnail && !imageUrls.includes(String(info.thumbnail))) {
        imageUrls.push(String(info.thumbnail));
      }
      for (const t of (info.thumbnails as Array<{ url?: string }>) || []) {
        if (t?.url && !imageUrls.includes(t.url)) imageUrls.push(t.url);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Fallback: Keine Caption in info.json → --dump-json (evtl. anderer Extraktionspfad)
  if (!description) {
    try {
      const { stdout } = await execFileAsync(ytDlp, [
        "--dump-json",
        "--no-download",
        "--no-playlist",
        url,
      ], { timeout: 30_000 });
      const info = JSON.parse(stdout) as Record<string, unknown>;
      description = extractDescription(info);
      if (!title && (info.title || info.fulltitle)) {
        title = String(info.title ?? info.fulltitle);
      }
      if (info.thumbnail && !imageUrls.includes(String(info.thumbnail))) {
        imageUrls.unshift(String(info.thumbnail));
      }
    } catch {
      // ignore
    }
  }

  // Heruntergeladene Bilder (lokale Pfade)
  const imageFiles = files.filter((f) =>
    /\.(jpg|jpeg|png|webp)$/i.test(f)
  );
  for (const img of imageFiles) {
    imageUrls.push(join(tempDir, img));
  }

  // Heruntergeladenes Video/Audio für Whisper
  const mediaFile = files.find((f) =>
    /\.(mp4|m4a|webm|mp3)$/i.test(f)
  );
  if (mediaFile) {
    audioPath = join(tempDir, mediaFile);
  }

  return {
    url,
    type: "instagram",
    title,
    description,
    textContent: description,
    imageUrls: [...new Set(imageUrls)].slice(0, 5),
    audioPath,
    schemaRecipe: null,
  };
}

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const ENV_KEYS = [
  "EXPORT_BACKEND",
  "NOTION_TOKEN",
  "NOTION_DATABASE_ID",
  "NOTION_PARENT_PAGE_ID",
  "MEALIE_BASE_URL",
  "MEALIE_API_TOKEN",
  "OLLAMA_BASE_URL",
  "LLAMACPP_BASE_URL",
  "LLAMACPP_VISION_MODEL",
  "LLM_PROVIDER",
  "PORT",
] as const;

export interface EnvUpdates {
  EXPORT_BACKEND?: string;
  NOTION_TOKEN?: string;
  NOTION_DATABASE_ID?: string;
  NOTION_PARENT_PAGE_ID?: string;
  MEALIE_BASE_URL?: string;
  MEALIE_API_TOKEN?: string;
  OLLAMA_BASE_URL?: string;
  LLAMACPP_BASE_URL?: string;
  LLAMACPP_VISION_MODEL?: string;
  LLM_PROVIDER?: string;
  PORT?: string;
}

function getEnvPath(): string {
  const dir = process.env.CONFIG_DIR || process.env.ENV_PATH || process.cwd();
  return dir.endsWith(".env") ? dir : join(dir, ".env");
}

/**
 * Liest .env und parst einfache KEY=value Zeilen.
 */
async function readEnvFile(): Promise<Record<string, string>> {
  const path = getEnvPath();
  try {
    const content = await readFile(path, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Schreibt .env mit aktualisierten Werten.
 * Bestehende Zeilen werden beibehalten, angegebene Keys überschrieben.
 */
export async function updateEnv(updates: EnvUpdates): Promise<void> {
  const path = getEnvPath();
  const current = await readEnvFile();

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null && value !== "") {
      current[key] = value;
    } else if (key in current) {
      delete current[key];
    }
  }

  const lines: string[] = [
    "# Rezepti – generiert/aktualisiert durch Setup",
    "",
    ...ENV_KEYS.filter((k) => current[k] != null).map((k) => {
      const v = current[k];
      const needsQuotes = /[\s#="']/.test(v);
      return `${k}=${needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v}`;
    }),
    "",
  ];

  await writeFile(path, lines.join("\n"), "utf-8");
}

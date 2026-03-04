import dotenv from "dotenv";
import { join } from "node:path";

const configDir = process.env.CONFIG_DIR || process.env.ENV_PATH || process.cwd();
const envPath = configDir.endsWith(".env") ? configDir : join(configDir, ".env");
dotenv.config({ path: envPath });

export type ExportBackend = "notion" | "mealie";
export type LlmProvider = "llamacpp" | "ollama";

function getExportBackend(): ExportBackend {
  const raw = (process.env.EXPORT_BACKEND || "").toLowerCase();
  return raw === "mealie" ? "mealie" : "notion";
}

export const config = {
  get exportBackend() {
    return getExportBackend();
  },
  get notion() {
    return {
      token: process.env.NOTION_TOKEN || "",
      databaseId: process.env.NOTION_DATABASE_ID || "",
      parentPageId: process.env.NOTION_PARENT_PAGE_ID || "",
    };
  },
  get mealie() {
    return {
      baseUrl: (process.env.MEALIE_BASE_URL || "").replace(/\/$/, ""),
      apiToken: process.env.MEALIE_API_TOKEN || "",
    };
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    textModel: process.env.OLLAMA_TEXT_MODEL || "llama3.2:3b",
    visionModel: process.env.OLLAMA_VISION_MODEL || "llava:7b",
  },
  get llamaCpp() {
    return {
      baseUrl: (process.env.LLAMACPP_BASE_URL || "").replace(/\/$/, ""),
      visionModel: process.env.LLAMACPP_VISION_MODEL || "Qwen3VL-8B-Instruct-Q8_0.gguf",
    };
  },
  get llmProvider(): LlmProvider {
    const raw = (process.env.LLM_PROVIDER || "").toLowerCase();
    if (raw === "ollama") return "ollama";
    if (raw === "llamacpp") return "llamacpp";
    return process.env.LLAMACPP_BASE_URL ? "llamacpp" : "ollama";
  },
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  ytDlpPath: process.env.YT_DLP_PATH || "yt-dlp",
};

/** Prüft, ob ein Export-Backend konfiguriert ist. */
export function isExportConfigured(): boolean {
  if (config.exportBackend === "notion") {
    return !!config.notion.token;
  }
  if (config.exportBackend === "mealie") {
    return !!config.mealie.baseUrl && !!config.mealie.apiToken;
  }
  return false;
}

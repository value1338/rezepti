import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { config, isExportConfigured } from "./config.js";
import { processURL, processImage } from "./pipeline.js";
import { ensureDatabase } from "./notion.js";
import { updateEnv } from "./env.js";
import type { PipelineEvent } from "./types.js";
import { streamSSE } from "hono/streaming";
import dotenv from "dotenv";

const app = new Hono();

// Static file serving for public/
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

app.get("/setup", (c) => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "public", "setup.html"),
    "utf-8"
  );
  return c.html(html);
});

app.get("/", (c) => {
  if (!isExportConfigured()) {
    return c.redirect("/setup");
  }
  const html = readFileSync(
    join(import.meta.dirname, "..", "public", "index.html"),
    "utf-8"
  );
  return c.html(html);
});

// Design variants
for (const v of ["v1", "v2", "v3", "v4"]) {
  app.get(`/${v}`, (c) => {
    const html = readFileSync(
      join(import.meta.dirname, "..", "public", `${v}.html`),
      "utf-8"
    );
    return c.html(html);
  });
}

app.get("/public/*", (c) => {
  const filePath = c.req.path.replace("/public/", "");
  const fullPath = join(import.meta.dirname, "..", "public", filePath);
  const ext = extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const content = readFileSync(fullPath);
    return c.body(content, 200, { "Content-Type": contentType });
  } catch {
    return c.text("Not found", 404);
  }
});

// SSE endpoint for recipe processing
app.get("/api/extract", async (c) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "URL-Parameter fehlt" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const sendEvent = async (event: PipelineEvent) => {
      await stream.writeSSE({
        event: event.stage,
        data: JSON.stringify(event),
      });
    };

    await processURL(url, sendEvent);
  });
});

// Image upload endpoint – streamt SSE über fetch (kein EventSource nötig)
app.post("/api/extract-image", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("image");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "Kein Bild hochgeladen (Feld: image)" }, 400);
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return c.json(
      { error: `Nicht unterstütztes Bildformat: ${file.type}` },
      400
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);
  const mimeType = file.type;

  return streamSSE(c, async (stream) => {
    const sendEvent = async (event: PipelineEvent) => {
      await stream.writeSSE({
        event: event.stage,
        data: JSON.stringify(event),
      });
    };

    await processImage(imageBuffer, mimeType, sendEvent);
  });
});

// Setup API
app.get("/api/setup/status", (c) => {
  return c.json({
    configured: isExportConfigured(),
    backend: config.exportBackend,
    notion: {
      hasToken: !!config.notion.token,
      databaseId: config.notion.databaseId || undefined,
      parentPageId: config.notion.parentPageId || undefined,
    },
    mealie: {
      baseUrl: config.mealie.baseUrl || undefined,
      hasToken: !!config.mealie.apiToken,
    },
    llmProvider: config.llmProvider,
    llamaCpp: {
      baseUrl: config.llamaCpp.baseUrl || undefined,
      model: config.llamaCpp.visionModel,
    },
    ollama: {
      baseUrl: config.ollama.baseUrl,
      textModel: config.ollama.textModel,
      visionModel: config.ollama.visionModel,
    },
  });
});

app.post("/api/setup", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, string>;
    const updates: Record<string, string> = {};
    const allowed = [
      "EXPORT_BACKEND",
      "NOTION_TOKEN",
      "NOTION_DATABASE_ID",
      "NOTION_PARENT_PAGE_ID",
      "MEALIE_BASE_URL",
      "MEALIE_API_TOKEN",
      "LLM_PROVIDER",
      "LLAMACPP_BASE_URL",
      "LLAMACPP_VISION_MODEL",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = String(body[key]).trim();
    }
    await updateEnv(updates);
    const configDir = process.env.CONFIG_DIR || process.env.ENV_PATH || process.cwd();
    const envPath = configDir.endsWith(".env") ? configDir : join(configDir, ".env");
    dotenv.config({ path: envPath, override: true });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return c.json({ error: msg }, 500);
  }
});

// Health check
app.get("/api/health", async (c) => {
  const checks: Record<string, boolean> = {
    server: true,
  };

  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`);
    checks.ollama = res.ok;
  } catch {
    checks.ollama = false;
  }

  checks.export = isExportConfigured();
  checks.notion = !!config.notion.token;
  checks.mealie = !!(config.mealie.baseUrl && config.mealie.apiToken);

  return c.json(checks);
});

// Start server (host 0.0.0.0 = von allen IPs erreichbar, z.B. 192.168.1.168)
const port = config.port;
const host = config.host;
console.log(`Rezepti läuft auf http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);

if (config.exportBackend === "notion" && config.notion.token) {
  ensureDatabase()
    .then(() => console.log("Notion-Datenbank bereit."))
    .catch((e) => console.warn("Notion-Warnung:", e.message));
}

serve({ fetch: app.fetch, port, hostname: host });

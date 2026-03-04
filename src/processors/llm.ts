import { Ollama } from "ollama";
import { config } from "../config.js";
import { RecipeDataSchema, type RecipeData } from "../types.js";

const SYSTEM_PROMPT = `Du bist ein Rezept-Extraktor. Deine Aufgabe:

1. Extrahiere das Rezept aus dem gegebenen Text/Inhalt.
2. Übersetze ALLES ins Deutsche (Rezeptname, Zutaten, Schritte).
3. Konvertiere alle Mengenangaben in metrische Einheiten:
   - cups → ml (1 cup = 240ml)
   - oz → g (1 oz = 28g)
   - lbs → g (1 lb = 454g)
   - tbsp → EL, tsp → TL
   - Fahrenheit → Celsius
   - inches → cm
4. Schätze die Kalorien pro Portion (kcal).
5. Wähle passende deutsche Tags (z.B. Pasta, Vegan, Asiatisch, Schnell, Dessert).
6. Wähle ein passendes Emoji für das Rezept.
7. Bestimme die Zubereitungsdauer: "kurz" (<20min), "mittel" (20-60min), "lang" (>60min).
8. Schreibe die Zubereitungsschritte als reine Texte OHNE Nummern oder Präfixe (z.B. "1.", "-").

Antworte NUR mit dem JSON-Objekt, kein zusätzlicher Text.`;

function buildRecipeJsonSchema() {
  return {
    type: "object" as const,
    properties: {
      name: { type: "string" as const },
      duration: { type: "string" as const, enum: ["kurz", "mittel", "lang"] },
      tags: { type: "array" as const, items: { type: "string" as const } },
      imageUrl: { type: "string" as const },
      calories: { type: "number" as const },
      emoji: { type: "string" as const },
      servings: { type: "string" as const },
      ingredients: {
        type: "array" as const,
        items: { type: "string" as const },
      },
      steps: { type: "array" as const, items: { type: "string" as const } },
    },
    required: [
      "name",
      "duration",
      "tags",
      "emoji",
      "ingredients",
      "steps",
    ],
  };
}

// ── llama.cpp OpenAI-kompatible API ──────────────────────────

interface LlamaCppResponse {
  choices: Array<{ message: { content: string } }>;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

/**
 * Generischer Chat-Aufruf an llama.cpp (OpenAI-kompatibel).
 * Gibt den geparsten JSON-Inhalt zurück.
 */
async function llamaCppChat(
  messages: Array<{ role: string; content: string | unknown[] }>,
): Promise<Record<string, unknown>> {
  const { baseUrl, visionModel } = config.llamaCpp;
  if (!baseUrl) {
    throw new Error(
      "LLAMACPP_BASE_URL ist nicht konfiguriert. Bitte in den Einstellungen oder .env eintragen."
    );
  }

  const body = {
    model: visionModel,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `llama.cpp Fehler ${response.status}: ${errorText || response.statusText}`
    );
  }

  const result = (await response.json()) as LlamaCppResponse;
  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("llama.cpp hat keine Antwort zurückgegeben.");
  }

  return JSON.parse(extractJson(content));
}

// ── Ollama ───────────────────────────────────────────────────

function getOllama() {
  return new Ollama({ host: config.ollama.baseUrl });
}

async function ollamaChat(
  model: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
): Promise<Record<string, unknown>> {
  const response = await getOllama().chat({
    model,
    messages,
    format: buildRecipeJsonSchema(),
    options: { temperature: 0.3, num_predict: 4096 },
  });
  return JSON.parse(response.message.content);
}

// ── Exportierte Funktionen ───────────────────────────────────

export async function extractRecipeFromText(
  text: string,
  existingImageUrl?: string
): Promise<RecipeData> {
  const prompt = `Extrahiere das Rezept aus folgendem Inhalt:\n\n${text.slice(0, 8000)}`;

  let raw: Record<string, unknown>;

  if (config.llmProvider === "llamacpp") {
    raw = await llamaCppChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
  } else {
    raw = await ollamaChat(config.ollama.textModel, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
  }

  if (!raw.imageUrl && existingImageUrl) {
    raw.imageUrl = existingImageUrl;
  }

  return RecipeDataSchema.parse(raw);
}

export async function extractRecipeFromImage(
  imageUrl: string,
  additionalText?: string
): Promise<RecipeData> {
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const base64Image = imageBuffer.toString("base64");

  const prompt = additionalText
    ? `Extrahiere das Rezept aus diesem Bild. Zusätzlicher Kontext:\n${additionalText}`
    : "Extrahiere das Rezept aus diesem Bild.";

  let raw: Record<string, unknown>;

  if (config.llmProvider === "llamacpp") {
    const mimeType = imageUrl.match(/\.png/i) ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    raw = await llamaCppChat([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt },
        ],
      },
    ]);
  } else {
    raw = await ollamaChat(config.ollama.visionModel, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt, images: [base64Image] },
    ]);
  }

  if (!raw.imageUrl) {
    raw.imageUrl = imageUrl;
  }

  return RecipeDataSchema.parse(raw);
}

/**
 * Refine a partially extracted recipe (e.g. from schema.org fast path)
 * by translating and converting units via LLM.
 */
export async function refineRecipe(
  partial: Partial<RecipeData>
): Promise<RecipeData> {
  const prompt = `Übersetze und verfeinere dieses Rezept ins Deutsche. Konvertiere alle Einheiten ins metrische System. Schätze Kalorien. Wähle ein Emoji und Tags.\n\nRezept-Daten:\n${JSON.stringify(partial, null, 2)}`;

  let raw: Record<string, unknown>;

  if (config.llmProvider === "llamacpp") {
    raw = await llamaCppChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
  } else {
    raw = await ollamaChat(config.ollama.textModel, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
  }

  if (!raw.imageUrl && partial.imageUrl) {
    raw.imageUrl = partial.imageUrl;
  }
  // Fallback: LLM hat Steps/Ingredients weggelassen → Original behalten
  if ((!raw.steps || (raw.steps as unknown[]).length === 0) && partial.steps?.length) {
    raw.steps = partial.steps;
  }
  if ((!raw.ingredients || (raw.ingredients as unknown[]).length === 0) && partial.ingredients?.length) {
    raw.ingredients = partial.ingredients;
  }

  return RecipeDataSchema.parse(raw);
}

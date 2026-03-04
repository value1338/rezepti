import { Ollama } from "ollama";
import { config } from "../config.js";
import { RecipeDataSchema, type RecipeData } from "../types.js";

const SYSTEM_PROMPT = `Du bist ein OCR- und Rezept-Extraktor. Deine Aufgabe:

WICHTIG: Lies den tatsächlich im Bild sichtbaren Text (handgeschrieben oder gedruckt) und extrahiere NUR das, was dort steht. Erfinde KEINE Zutaten oder Schritte, die nicht im Bild stehen.

1. Lese den Text im Bild sorgfältig (OCR). Das Bild zeigt ein Rezept — handgeschrieben, gedruckt oder als Foto einer Rezeptkarte.
2. Extrahiere Rezeptname, Zutaten und Zubereitungsschritte AUSSCHLIESSLICH aus dem gelesenen Text.
3. Übersetze ALLES ins Deutsche (Rezeptname, Zutaten, Schritte).
4. Konvertiere alle Mengenangaben in metrische Einheiten:
   - cups → ml (1 cup = 240ml)
   - oz → g (1 oz = 28g)
   - lbs → g (1 lb = 454g)
   - tbsp → EL, tsp → TL
   - Fahrenheit → Celsius
   - inches → cm
5. Schätze die Kalorien pro Portion (kcal).
6. Wähle passende deutsche Tags (z.B. Pasta, Vegan, Asiatisch, Schnell, Dessert).
7. Wähle ein passendes Emoji für das Rezept.
8. Bestimme die Zubereitungsdauer: "kurz" (<20min), "mittel" (20-60min), "lang" (>60min).
9. Schreibe die Zubereitungsschritte als reine Texte OHNE Nummern oder Präfixe (z.B. "1.", "-").

Antworte NUR mit dem JSON-Objekt, kein zusätzlicher Text:
{
  "name": "...",
  "duration": "kurz"|"mittel"|"lang",
  "tags": ["..."],
  "calories": 123,
  "emoji": "🍽️",
  "servings": "4",
  "ingredients": ["..."],
  "steps": ["..."]
}`;

interface LlamaCppResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function buildRecipeJsonSchema() {
  return {
    type: "object" as const,
    properties: {
      name: { type: "string" as const },
      duration: { type: "string" as const, enum: ["kurz", "mittel", "lang"] },
      tags: { type: "array" as const, items: { type: "string" as const } },
      calories: { type: "number" as const },
      emoji: { type: "string" as const },
      servings: { type: "string" as const },
      ingredients: { type: "array" as const, items: { type: "string" as const } },
      steps: { type: "array" as const, items: { type: "string" as const } },
    },
    required: ["name", "duration", "tags", "emoji", "ingredients", "steps"],
  };
}

/**
 * Extrahiert JSON aus einem Text, der möglicherweise Markdown-Codeblöcke enthält.
 */
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
 * Extrahiert ein Rezept aus einem Foto.
 * Wählt automatisch den konfigurierten Vision-Provider (llama.cpp oder Ollama).
 */
export async function extractRecipeFromPhoto(
  imageBuffer: Buffer,
  mimeType: string
): Promise<RecipeData> {
  if (config.llmProvider === "ollama") {
    return extractViaOllama(imageBuffer);
  }
  return extractViaLlamaCpp(imageBuffer, mimeType);
}

/**
 * Vision via Ollama (nutzt das konfigurierte ollama.visionModel).
 */
async function extractViaOllama(imageBuffer: Buffer): Promise<RecipeData> {
  const ollama = new Ollama({ host: config.ollama.baseUrl });
  const base64Image = imageBuffer.toString("base64");

  const response = await ollama.chat({
    model: config.ollama.visionModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: "Lies den Text in diesem Bild sorgfältig (OCR) und extrahiere das Rezept ausschließlich aus dem sichtbaren Text. Erfinde nichts. Antworte ausschließlich mit dem JSON-Objekt.",
        images: [base64Image],
      },
    ],
    format: buildRecipeJsonSchema(),
    options: { temperature: 0.2, num_predict: 4096 },
  });

  const raw = JSON.parse(response.message.content);
  return RecipeDataSchema.parse(raw);
}

/**
 * Vision via llama.cpp (OpenAI-kompatible API).
 */
async function extractViaLlamaCpp(
  imageBuffer: Buffer,
  mimeType: string
): Promise<RecipeData> {
  const { baseUrl, visionModel } = config.llamaCpp;
  if (!baseUrl) {
    throw new Error(
      "LLAMACPP_BASE_URL ist nicht konfiguriert. Bitte in den Einstellungen oder .env eintragen."
    );
  }

  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const body = {
    model: visionModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: "Lies den Text in diesem Bild sorgfältig (OCR) und extrahiere das Rezept ausschließlich aus dem sichtbaren Text. Erfinde nichts. Antworte ausschließlich mit dem JSON-Objekt.",
          },
        ],
      },
    ],
    temperature: 0.2,
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
      `llama.cpp Vision-Server Fehler ${response.status}: ${errorText || response.statusText}`
    );
  }

  const result = (await response.json()) as LlamaCppResponse;
  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("llama.cpp hat keine Antwort zurückgegeben.");
  }

  const jsonStr = extractJson(content);
  const raw = JSON.parse(jsonStr);
  return RecipeDataSchema.parse(raw);
}

import { Ollama } from "ollama";
import { config } from "../config.js";
import { RecipeDataSchema, type RecipeData } from "../types.js";

const SYSTEM_PROMPT = `Du bist ein OCR- und Rezept-Extraktor. Deine Aufgabe:

WICHTIG: Lies den tatsächlich im Bild/in den Bildern sichtbaren Text sorgfältig. Falls mehrere Bilder vorhanden sind, kombiniere alle Informationen zu einem vollständigen Rezept.

1. Lese den gesamten sichtbaren Text (OCR): Titel, Beschreibung, Zutaten, Schritte — alles.
2. Rezeptname: Nimm den Titel oder Hauptnamen aus dem Text. Falls kein expliziter Titel sichtbar ist, leite einen passenden deutschen Namen aus der Beschreibung oder den Zutaten ab.
3. Zutaten: Extrahiere NUR die tatsächlich sichtbaren Zutaten. Erfinde keine Zutaten.
4. Zubereitungsschritte: Wenn explizite Schritte sichtbar sind, extrahiere diese. Falls KEINE Schritte sichtbar sind, aber eine Beschreibung vorhanden ist (z.B. "Brot mit Speck im Ofen überbacken"), leite sinnvolle Zubereitungsschritte daraus ab.
5. Übersetze ALLES ins Deutsche (Name, Zutaten, Schritte).
6. Konvertiere alle Mengenangaben in metrische Einheiten:
   - cups → ml (1 cup = 240ml)
   - oz → g (1 oz = 28g)
   - lbs → g (1 lb = 454g)
   - tbsp → EL, tsp → TL
   - Fahrenheit → Celsius
   - inches → cm
7. Schätze die Kalorien pro Portion (kcal).
8. Wähle passende deutsche Tags (z.B. Pasta, Vegan, Asiatisch, Schnell, Dessert).
9. Wähle ein passendes Emoji für das Rezept.
10. Bestimme die Zubereitungsdauer: "kurz" (<20min), "mittel" (20-60min), "lang" (>60min).
11. Schreibe die Zubereitungsschritte als reine Texte OHNE Nummern oder Präfixe (z.B. "1.", "-").

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

export interface PhotoInput {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Extrahiert ein Rezept aus einem oder mehreren Fotos.
 * Wählt automatisch den konfigurierten Vision-Provider (llama.cpp oder Ollama).
 */
export async function extractRecipeFromPhoto(
  images: PhotoInput | PhotoInput[]
): Promise<RecipeData> {
  const list = Array.isArray(images) ? images : [images];
  if (config.llmProvider === "ollama") {
    return extractViaOllama(list);
  }
  return extractViaLlamaCpp(list);
}

/**
 * Vision via Ollama (nutzt das konfigurierte ollama.visionModel).
 */
async function extractViaOllama(images: PhotoInput[]): Promise<RecipeData> {
  const ollama = new Ollama({ host: config.ollama.baseUrl });
  const base64Images = images.map((img) => img.buffer.toString("base64"));
  const pageHint = images.length > 1 ? ` (${images.length} Seiten, bitte alle kombinieren)` : "";

  const response = await ollama.chat({
    model: config.ollama.visionModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Lies den Text in ${images.length > 1 ? "diesen Bildern" : "diesem Bild"} sorgfältig (OCR)${pageHint} und extrahiere das Rezept ausschließlich aus dem sichtbaren Text. Erfinde nichts. Antworte ausschließlich mit dem JSON-Objekt.`,
        images: base64Images,
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
async function extractViaLlamaCpp(images: PhotoInput[]): Promise<RecipeData> {
  const { baseUrl, visionModel } = config.llamaCpp;
  if (!baseUrl) {
    throw new Error(
      "LLAMACPP_BASE_URL ist nicht konfiguriert. Bitte in den Einstellungen oder .env eintragen."
    );
  }

  const pageHint = images.length > 1 ? ` (${images.length} Seiten, bitte alle kombinieren)` : "";
  const imageContent = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString("base64")}` },
  }));

  const body = {
    model: visionModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: `Lies den Text in ${images.length > 1 ? "diesen Bildern" : "diesem Bild"} sorgfältig (OCR)${pageHint} und extrahiere das Rezept ausschließlich aus dem sichtbaren Text. Erfinde nichts. Antworte ausschließlich mit dem JSON-Objekt.`,
          },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 8192,
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

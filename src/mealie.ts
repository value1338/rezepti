import { config } from "./config.js";
import type { RecipeData } from "./types.js";

function getBaseUrl(): string {
  if (!config.mealie.baseUrl || !config.mealie.apiToken) {
    throw new Error(
      "Mealie nicht konfiguriert. MEALIE_BASE_URL und MEALIE_API_TOKEN in .env setzen."
    );
  }
  return config.mealie.baseUrl;
}

function getAuthHeader(): string {
  if (!config.mealie.apiToken) {
    throw new Error("MEALIE_API_TOKEN nicht gesetzt.");
  }
  return `Bearer ${config.mealie.apiToken}`;
}

/** Dauer-Kategorie zu ISO 8601 (PT20M etc.) */
function durationToIso(duration: string): { prepTime: string; totalTime: string } {
  switch (duration) {
    case "kurz":
      return { prepTime: "PT10M", totalTime: "PT15M" };
    case "lang":
      return { prepTime: "PT30M", totalTime: "PT90M" };
    case "mittel":
    default:
      return { prepTime: "PT15M", totalTime: "PT40M" };
  }
}

/**
 * Erstellt ein Rezept in Mealie via schema.org/Recipe JSON.
 * Mealie erwartet @context und @type für create/html-or-json.
 */
export async function createRecipe(
  recipe: RecipeData,
  sourceUrl: string,
  transcript?: string
): Promise<string> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();

  const schemaOrg: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    recipeIngredient: recipe.ingredients,
    recipeInstructions: recipe.steps,
    ...durationToIso(recipe.duration),
    recipeYield: recipe.servings || undefined,
    recipeCategory: recipe.tags.length > 0 ? recipe.tags : undefined,
  };

  if (recipe.imageUrl) {
    schemaOrg.image = recipe.imageUrl;
  }

  let notes = `Quelle: ${sourceUrl}`;
  if (transcript) {
    notes += `\n\n--- Transkript ---\n${transcript}`;
  }
  schemaOrg.notes = notes;

  // Extras für Mealie: Quelle, Kalorien
  const extras: Record<string, string> = {
    rezepti_source: sourceUrl,
  };
  if (recipe.calories) {
    extras.rezepti_calories = String(recipe.calories);
  }
  schemaOrg.extras = extras;
  schemaOrg.notes = notes;

  const body = JSON.stringify({ data: JSON.stringify(schemaOrg) });

  const res = await fetch(`${baseUrl}/api/recipes/create/html-or-json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mealie API Fehler: ${res.status} ${errText}`);
  }

  const responseText = await res.text();

  // Mealie gibt je nach Version einen String (Slug) oder ein Objekt zurück
  let slug: string | undefined;
  try {
    const parsed = JSON.parse(responseText);
    if (typeof parsed === "string") {
      slug = parsed;
    } else if (parsed && typeof parsed === "object") {
      slug = parsed.slug ?? parsed.id;
    }
  } catch {
    // Kein JSON — Antwort ist direkt der Slug als Text
    slug = responseText.replace(/^"|"$/g, "").trim();
  }

  if (!slug) {
    throw new Error(`Mealie: Keine Rezept-URL in Antwort erhalten. Response: ${responseText.slice(0, 200)}`);
  }

  return `${baseUrl}/g/home/r/${slug}`;
}

/**
 * Aktualisiert ein bestehendes Mealie-Rezept per PATCH.
 * Slug wird aus der exportUrl extrahiert (letztes Pfad-Segment).
 */
export async function updateRecipe(
  slug: string,
  recipe: RecipeData,
  sourceUrl: string,
  transcript?: string
): Promise<void> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();
  const { prepTime, totalTime } = durationToIso(recipe.duration);

  // Bestehendes Rezept laden um alle Pflichtfelder zu erhalten
  const getRes = await fetch(`${baseUrl}/api/recipes/${slug}`, {
    headers: { Authorization: auth },
  });
  if (!getRes.ok) {
    const errText = await getRes.text();
    throw new Error(`Mealie Fehler beim Laden: ${getRes.status} ${errText}`);
  }
  const existingData = await getRes.json() as Record<string, unknown>;

  let notes = `Quelle: ${sourceUrl}`;
  if (transcript) {
    notes += `\n\n--- Transkript ---\n${transcript}`;
  }

  // Bestehendes Rezept als Basis, nur geänderte Felder überschreiben
  const body: Record<string, unknown> = {
    ...existingData,
    name: recipe.name,
    recipeIngredient: recipe.ingredients.map((ing) => ({ note: ing })),
    recipeInstructions: recipe.steps.map((step) => ({ text: step })),
    prepTime,
    totalTime,
    notes: [{ title: "", text: notes }],
  };

  // PUT statt PATCH — Mealie PATCH hat einen Bug bei recipeIngredient/recipeInstructions
  // (github.com/mealie-recipes/mealie/issues/6802)
  const res = await fetch(`${baseUrl}/api/recipes/${slug}`, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mealie Update Fehler: ${res.status} ${errText}`);
  }
}

function mimeToExt(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Lädt das Hauptbild eines Mealie-Rezepts hoch.
 * Endpoint: PUT /api/recipes/{slug}/image
 */
export async function uploadRecipeImage(
  slug: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<void> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();

  const ext = mimeToExt(mimeType);
  const formData = new FormData();
  formData.append(
    "image",
    new Blob([new Uint8Array(imageBuffer)], { type: mimeType }),
    `recipe.${ext}`
  );
  formData.append("extension", ext);

  const res = await fetch(`${baseUrl}/api/recipes/${slug}/image`, {
    method: "PUT",
    headers: { Authorization: auth },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`Mealie Hauptbild-Upload fehlgeschlagen (${res.status}): ${errText}`);
  }
}

/**
 * Lädt ein zusätzliches Bild als Asset an ein Mealie-Rezept.
 * Endpoint: POST /api/recipes/{slug}/assets
 */
export async function uploadRecipeAsset(
  slug: string,
  imageBuffer: Buffer,
  mimeType: string,
  name: string
): Promise<void> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();

  const ext = mimeToExt(mimeType);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(imageBuffer)], { type: mimeType }),
    `${name}.${ext}`
  );
  formData.append("name", name);
  formData.append("extension", ext);
  formData.append("icon", "mdi-image");

  const res = await fetch(`${baseUrl}/api/recipes/${slug}/assets`, {
    method: "POST",
    headers: { Authorization: auth },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`Mealie Asset-Upload fehlgeschlagen (${res.status}): ${errText}`);
  }
}

import { config } from "./config.js";
import { createRecipePage } from "./notion.js";
import { createRecipe } from "./mealie.js";
import type { RecipeData } from "./types.js";

/**
 * Exportiert ein Rezept in das konfigurierte Backend (Notion oder Mealie).
 * Gibt die URL der erstellten Seite/Rezeptes zurück.
 */
export async function exportRecipe(
  recipe: RecipeData,
  sourceUrl: string,
  transcript?: string
): Promise<string> {
  if (config.exportBackend === "mealie") {
    return createRecipe(recipe, sourceUrl, transcript);
  }
  return createRecipePage(recipe, sourceUrl, transcript);
}

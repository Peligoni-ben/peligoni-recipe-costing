import { getRecipeImportFormat, recipeImportFormats } from "./formats";

export function listRecipeImportFormats() {
  return recipeImportFormats;
}

export function normalizeImportedRecipeSource({ formatId, payload }) {
  const format = getRecipeImportFormat(formatId);
  if (!format) {
    throw new Error(`Unsupported recipe import format: ${formatId}`);
  }

  return {
    formatId: format.id,
    formatLabel: format.label,
    output: format.normalize(payload),
  };
}

export const normalizedRecipesColumns = [
  "recipe_id",
  "restaurant",
  "name",
  "category",
  "selling_item_code",
  "service_note",
  "portion_count",
  "method",
  "presentation_notes",
  "current_sale_price",
  "roundup",
  "recipe_type",
  "batch_yield",
  "batch_yield_type",
  "recipe_complete",
  "pricing_complete",
  "source_cost",
];

export const normalizedRecipeComponentsColumns = [
  "recipe_id",
  "component_sort",
  "ingredient_name",
  "ingredient_item_code",
  "quantity_by_weight_grams",
  "component_cost",
];

export const normalizedDishIndexColumns = [
  "entry_id",
  "source_tab",
  "venue",
  "course",
  "dish_name",
  "old_flag",
];

export function createNormalizedRecipe(recipe) {
  return {
    recipe_id: recipe.recipe_id || "",
    restaurant: recipe.restaurant || "",
    name: recipe.name || "",
    category: recipe.category || "",
    selling_item_code: recipe.selling_item_code || "",
    service_note: recipe.service_note || "",
    portion_count: recipe.portion_count ?? "",
    method: recipe.method || "",
    presentation_notes: recipe.presentation_notes || "",
    current_sale_price: recipe.current_sale_price ?? "",
    roundup: recipe.roundup ?? "",
    recipe_type: recipe.recipe_type || "",
    batch_yield: recipe.batch_yield ?? "",
    batch_yield_type: recipe.batch_yield_type || "",
    recipe_complete: recipe.recipe_complete ?? "",
    pricing_complete: recipe.pricing_complete ?? "",
    source_cost: recipe.source_cost ?? "",
  };
}

export function createNormalizedRecipeComponent(component) {
  return {
    recipe_id: component.recipe_id || "",
    component_sort: component.component_sort ?? "",
    ingredient_name: component.ingredient_name || "",
    ingredient_item_code: component.ingredient_item_code || "",
    quantity_by_weight_grams: component.quantity_by_weight_grams ?? "",
    component_cost: component.component_cost ?? "",
  };
}

export function createNormalizedDishIndexEntry(entry) {
  return {
    entry_id: entry.entry_id || "",
    source_tab: entry.source_tab || "",
    venue: entry.venue || "",
    course: entry.course || "",
    dish_name: entry.dish_name || "",
    old_flag: entry.old_flag || "",
  };
}

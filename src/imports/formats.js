import {
  createNormalizedRecipe,
  createNormalizedRecipeComponent,
  createNormalizedDishIndexEntry,
} from "./contracts";

export const recipeImportFormats = [
  {
    id: "venue-dish-workbook-xlsx",
    label: "Venue dish workbook (.xlsx)",
    description:
      "A multi-sheet workbook of venue dish lists used to match existing recipes and build a recipe queue.",
    expectedFiles: ["venue_dishes.xlsx"],
    mapsTo: ["Dish_Index"],
    requiredColumns: {
      dish_index: [
        "entry_id",
        "source_tab",
        "venue",
        "course",
        "dish_name",
        "old_flag",
      ],
    },
    normalize({ dish_index = [] }) {
      return {
        Dish_Index: dish_index.map((entry) => createNormalizedDishIndexEntry(entry)),
      };
    },
  },
  {
    id: "normalized-workbook-pair",
    label: "Normalized workbook pair",
    description:
      "Two tabular files that already separate recipe headers from component rows.",
    expectedFiles: ["recipes.csv", "recipe_components.csv"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      recipes: [
        "recipe_id",
        "restaurant",
        "name",
        "category",
        "selling_item_code",
      ],
      recipe_components: [
        "recipe_id",
        "component_sort",
        "ingredient_name",
        "quantity_by_weight_grams",
      ],
    },
    normalize({ recipes = [], recipe_components = [] }) {
      return {
        Recipes: recipes.map((recipe) => createNormalizedRecipe(recipe)),
        Recipe_Components: recipe_components.map((component) =>
          createNormalizedRecipeComponent(component)
        ),
      };
    },
  },
  {
    id: "flat-component-export",
    label: "Flat component export",
    description:
      "A single file where each row repeats recipe metadata alongside one ingredient component.",
    expectedFiles: ["recipes_flat.csv"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      recipes_flat: [
        "recipe_id",
        "restaurant",
        "name",
        "category",
        "ingredient_name",
        "quantity_by_weight_grams",
      ],
    },
    normalize({ recipes_flat = [] }) {
      const recipeMap = new Map();
      const components = [];

      recipes_flat.forEach((row, index) => {
        if (!recipeMap.has(row.recipe_id)) {
          recipeMap.set(
            row.recipe_id,
            createNormalizedRecipe({
              recipe_id: row.recipe_id,
              restaurant: row.restaurant,
              name: row.name,
              category: row.category,
              selling_item_code: row.selling_item_code,
              current_sale_price: row.current_sale_price,
              roundup: row.roundup,
            })
          );
        }

        components.push(
          createNormalizedRecipeComponent({
            recipe_id: row.recipe_id,
            component_sort: row.component_sort || index + 1,
            ingredient_name: row.ingredient_name,
            ingredient_item_code: row.ingredient_item_code,
            quantity_by_weight_grams: row.quantity_by_weight_grams,
            component_cost: row.component_cost,
          })
        );
      });

      return {
        Recipes: Array.from(recipeMap.values()),
        Recipe_Components: components,
      };
    },
  },
  {
    id: "json-recipe-bundle",
    label: "JSON recipe bundle",
    description:
      "A structured JSON export containing recipes with nested component arrays.",
    expectedFiles: ["recipes.json"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      recipes_json: [
        "recipe_id",
        "restaurant",
        "name",
        "components[]",
      ],
    },
    normalize({ recipes_json = [] }) {
      return {
        Recipes: recipes_json.map((recipe) => createNormalizedRecipe(recipe)),
        Recipe_Components: recipes_json.flatMap((recipe) =>
          (recipe.components || []).map((component, index) =>
            createNormalizedRecipeComponent({
              recipe_id: recipe.recipe_id,
              component_sort: component.component_sort || index + 1,
              ingredient_name: component.ingredient_name,
              ingredient_item_code: component.ingredient_item_code,
              quantity_by_weight_grams: component.quantity_by_weight_grams,
              component_cost: component.component_cost,
            })
          )
        ),
      };
    },
  },
  {
    id: "soft1-recipe-sheet",
    label: "SOFT1 recipe sheet",
    description:
      "A single recipe sheet with title rows above a SOFT1 CODE / INGREDIENT / QTY / UNIT / METHOD table.",
    expectedFiles: ["soft1_recipe.csv"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      soft1_recipe: [
        "recipe_name",
        "soft1_code",
        "ingredient_name",
        "quantity_by_weight_grams",
      ],
    },
    normalize({ soft1_recipe = [] }) {
      const recipeRows = [];
      const componentRows = [];
      const seenRecipeIds = new Set();
      const sectionMap = new Map();

      soft1_recipe.forEach((row) => {
        if (!seenRecipeIds.has(row.recipe_id)) {
          seenRecipeIds.add(row.recipe_id);
          recipeRows.push(
            createNormalizedRecipe({
              recipe_id: row.recipe_id,
              restaurant: row.restaurant,
              name: row.recipe_name,
              category: row.category,
              selling_item_code: row.soft1_code,
              service_note: row.service_note,
              portion_count: row.portion_count,
              method: row.method,
              presentation_notes: row.presentation_notes,
              current_sale_price: row.current_sale_price,
              roundup: row.roundup,
            })
          );
        }

        const sectionKey = row.section_recipe_id || `${row.recipe_id}::${row.section_name || "main"}`;
        if (row.section_name && !sectionMap.has(sectionKey)) {
          sectionMap.set(sectionKey, {
            parent_recipe_id: row.recipe_id,
            recipe_id: row.section_recipe_id || sectionKey,
            name: row.section_name,
            selling_item_code: row.section_soft1_code || "",
            component_sort: row.section_sort || sectionMap.size + 1,
            batch_yield: row.portion_count || 1,
            batch_yield_type: "portion",
            method: row.section_method || "",
          });
        }

        componentRows.push(
          createNormalizedRecipeComponent({
            recipe_id: row.section_recipe_id || row.recipe_id,
            component_sort: row.component_sort,
            ingredient_name: row.ingredient_name,
            ingredient_item_code: row.ingredient_item_code,
            quantity_by_weight_grams: row.quantity_by_weight_grams,
            component_cost: row.component_cost,
          })
        );
      });

      Array.from(sectionMap.values()).forEach((section) => {
        recipeRows.push(
          createNormalizedRecipe({
            recipe_id: section.recipe_id,
            restaurant: "",
            name: section.name,
            category: "Batch",
            selling_item_code: section.selling_item_code,
            recipe_type: "batch",
            batch_yield: section.batch_yield,
            batch_yield_type: section.batch_yield_type,
            method: section.method,
            pricing_complete: "0",
            recipe_complete: "0",
          })
        );

        componentRows.push(
          createNormalizedRecipeComponent({
            recipe_id: section.parent_recipe_id || "",
            component_sort: section.component_sort,
            ingredient_name: section.name,
            ingredient_item_code: section.selling_item_code,
            quantity_by_weight_grams: 1,
            component_cost: "",
          })
        );
      });

      return {
        Recipes: recipeRows,
        Recipe_Components: componentRows,
      };
    },
  },
  {
    id: "soft1-workbook-xlsx",
    label: "SOFT1 workbook (.xlsx)",
    description:
      "A multi-sheet Excel workbook where each sheet contains one SOFT1 recipe layout.",
    expectedFiles: ["recipes.xlsx"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      soft1_recipe: [
        "recipe_name",
        "soft1_code",
        "ingredient_name",
        "quantity_by_weight_grams",
      ],
    },
    normalize({ soft1_recipe = [] }) {
      const soft1Format = recipeImportFormats.find((format) => format.id === "soft1-recipe-sheet");
      return soft1Format.normalize({ soft1_recipe });
    },
  },
  {
    id: "batch-workbook-wide",
    label: "Batch workbook (.xlsx)",
    description:
      "A wide Excel workbook with one batch recipe per row and repeated component columns across the sheet.",
    expectedFiles: ["batchs.xlsx"],
    mapsTo: ["Recipes", "Recipe_Components"],
    requiredColumns: {
      batch_workbook: [
        "recipe_id",
        "name",
        "selling_item_code",
        "batch_yield",
        "components",
      ],
    },
    normalize({ batch_workbook = [] }) {
      return {
        Recipes: batch_workbook.map((recipe) =>
          createNormalizedRecipe({
            recipe_id: recipe.recipe_id,
            restaurant: recipe.restaurant,
            name: recipe.name,
            category: recipe.category,
            selling_item_code: recipe.selling_item_code,
            current_sale_price: recipe.current_sale_price,
            roundup: recipe.roundup,
            recipe_type: "batch",
            batch_yield: recipe.batch_yield,
            batch_yield_type: recipe.batch_yield_type || "g",
            recipe_complete: recipe.recipe_complete,
            pricing_complete: recipe.pricing_complete,
            source_cost: recipe.source_cost,
          })
        ),
        Recipe_Components: batch_workbook.flatMap((recipe) =>
          (recipe.components || []).map((component, index) =>
            createNormalizedRecipeComponent({
              recipe_id: recipe.recipe_id,
              component_sort: component.component_sort || index + 1,
              ingredient_name: component.ingredient_name,
              ingredient_item_code: component.ingredient_item_code,
              quantity_by_weight_grams: component.quantity_by_weight_grams,
              component_cost: component.component_cost,
            })
          )
        ),
      };
    },
  },
];

export function getRecipeImportFormat(formatId) {
  return recipeImportFormats.find((format) => format.id === formatId) || null;
}

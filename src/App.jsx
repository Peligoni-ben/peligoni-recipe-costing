import { Component, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import workbook from "./data/workbook-data.json";
import { googleDriveConfigLocation } from "./imports/googleDriveConfig";
import { listRecipeImportFormats, normalizeImportedRecipeSource } from "./imports";
import { parseRecipeImportContents, parseRecipeImportFiles } from "./imports/parsers";
import { supportsGoogleSheetsImport, toGoogleSheetsCsvExportUrl } from "./imports/googleSheets";
import { supabase, supabaseAnonKey, supabaseEnabled, supabaseUrl } from "./lib/supabase";

const INGREDIENT_MASTER_STORAGE_KEY = "peligoni-ingredient-master";
const DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY = "peligoni-deleted-ingredient-signatures";
const RECIPES_STORAGE_KEY = "peligoni-working-recipes";
const MENUS_STORAGE_KEY = "peligoni-working-menus";
const VENUES_STORAGE_KEY = "peligoni-working-venues";
const DISH_INDEX_STORAGE_KEY = "peligoni-dish-index";
const BCH_AUDIT_STORAGE_KEY = "peligoni-bch-audit";
const REQUIRED_INGREDIENT_COLUMNS = [
  "ingredient_name",
  "ingredient_item_code",
  "unit_cost",
];
const OPTIONAL_INGREDIENT_COLUMNS = [
  "pack_size",
  "supplier",
  "category",
  "last_updated",
  "entry_type",
  "linked_recipe_id",
  "is_locked",
];
const DEFAULT_SERVICE_PERIODS = ["breakfast", "lunch", "dinner"];
const DEFAULT_VENUES = ["Tasi", "Terraces", "Courtyard"];
const VENUE_SERVICE_PERIODS = {
  Tasi: ["breakfast", "lunch", "dinner"],
  Terraces: ["lunch", "dinner"],
  Courtyard: ["lunch", "dinner"],
};
const VENUE_ALIASES = {
  cy: "Courtyard",
  courtyard: "Courtyard",
  tasi: "Tasi",
  terraces: "Terraces",
  "pop up": "Pop up",
  popup: "Pop up",
  dessert: "Dessert",
};

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function calculateRoundupTarget(recipeCost) {
  const cost = numberValue(recipeCost);
  if (cost <= 0) return 0;
  const minimumSalePrice = cost / 0.3;
  return Math.ceil(minimumSalePrice * 2) / 2;
}

function normalizeMatchKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCodeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getIngredientSignature({ ingredient_name = "", ingredient_item_code = "" }) {
  const codeKey = normalizeCodeKey(ingredient_item_code);
  if (codeKey) return `code:${codeKey}`;
  const nameKey = normalizeMatchKey(ingredient_name);
  if (nameKey) return `name:${nameKey}`;
  return "";
}

function parsePackSizeParts(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(g|kg)?$/i);

  return {
    value: match?.[1] || "",
    unit: (match?.[2] || "g").toLowerCase(),
  };
}

function formatPackSize(value, unit) {
  const numericText = String(value || "").trim();
  if (!numericText) return "";
  return `${numericText}${unit || "g"}`;
}

function getIngredientPricingSource(ingredient) {
  const baseUnitCost = numberValue(ingredient?.unit_cost);
  const packParts = parsePackSizeParts(ingredient?.pack_size);
  const packValue = numberValue(packParts.value);

  if (baseUnitCost <= 0) {
    return {
      sourceUnitCost: 0,
      sourceYieldType: "kg",
    };
  }

  if (packValue > 0) {
    const totalGrams = packParts.unit === "kg" ? packValue * 1000 : packValue;
    if (totalGrams > 0) {
      return {
        sourceUnitCost: (baseUnitCost / totalGrams) * 1000,
        sourceYieldType: "kg",
      };
    }
  }

  return {
    sourceUnitCost: baseUnitCost,
    sourceYieldType: "kg",
  };
}

function scoreIngredientRecordForMatching(ingredient) {
  if (!ingredient) return -1;
  let score = 0;
  if (numberValue(ingredient.unit_cost) > 0) score += 100;
  if (numberValue(parsePackSizeParts(ingredient.pack_size).value) > 0) score += 20;
  if (normalizeBooleanFlag(ingredient.is_locked)) score += 10;
  if (String(ingredient.ingredient_name || "").trim()) score += 5;
  if (String(ingredient.ingredient_item_code || "").trim()) score += 5;
  return score;
}

function pickPreferredIngredientRecord(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;
  return scoreIngredientRecordForMatching(candidate) >= scoreIngredientRecordForMatching(existing)
    ? candidate
    : existing;
}

function buildWorkbookIngredientPriceIndex() {
  const byCode = new Map();
  const byName = new Map();

  (workbook?.sheets?.Recipe_Components?.rows || []).forEach((component) => {
    const qty = numberValue(component.quantity_by_weight_grams);
    const cost = numberValue(component.component_cost);
    if (qty <= 0 || cost <= 0) return;

    const derivedUnitCost = (cost / qty) * 1000;
    const codeKey = normalizeCodeKey(component.ingredient_item_code);
    const nameKey = normalizeMatchKey(component.ingredient_name);

    if (codeKey) {
      const entry = byCode.get(codeKey) || { total: 0, count: 0 };
      entry.total += derivedUnitCost;
      entry.count += 1;
      byCode.set(codeKey, entry);
    }

    if (nameKey) {
      const entry = byName.get(nameKey) || { total: 0, count: 0 };
      entry.total += derivedUnitCost;
      entry.count += 1;
      byName.set(nameKey, entry);
    }
  });

  const finalize = (map) =>
    new Map(
      Array.from(map.entries()).map(([key, value]) => [
        key,
        value.count > 0 ? value.total / value.count : 0,
      ])
    );

  return {
    byCode: finalize(byCode),
    byName: finalize(byName),
  };
}

const workbookIngredientPriceIndex = buildWorkbookIngredientPriceIndex();

function restoreMissingIngredientPrices(rows) {
  return rows.map((ingredient) => {
    const hasUnitCost = numberValue(ingredient.unit_cost) > 0;
    const hasPackSize = Boolean(String(ingredient.pack_size || "").trim());
    if (hasUnitCost && hasPackSize) return ingredient;

    const codeKey = normalizeCodeKey(ingredient.ingredient_item_code);
    const nameKey = normalizeMatchKey(ingredient.ingredient_name);
    const recoveredUnitCost =
      (codeKey ? workbookIngredientPriceIndex.byCode.get(codeKey) : 0) ||
      (nameKey ? workbookIngredientPriceIndex.byName.get(nameKey) : 0) ||
      0;

    if (!hasUnitCost && recoveredUnitCost <= 0) return ingredient;

    return {
      ...ingredient,
      unit_cost: hasUnitCost ? ingredient.unit_cost : Number(recoveredUnitCost.toFixed(4)),
      pack_size: hasPackSize ? ingredient.pack_size : "1000g",
    };
  });
}

function classifyBchHeuristic(name) {
  const text = normalizeMatchKey(name);
  if (!text) return "needs-review";
  if (
    text.includes("sauce") ||
    text.includes("dressing") ||
    text.includes("dip") ||
    text.includes("gremolata") ||
    text.includes("relish") ||
    text.includes("hummus") ||
    text.includes("granola") ||
    text.includes("mix") ||
    text.includes("dough") ||
    text.includes("posset") ||
    text.includes("tzatsiki") ||
    text.includes("labneh") ||
    text.includes("muhammara") ||
    text.includes("babaganoush")
  ) {
    return "true-batch";
  }
  if (
    text.includes("fillet") ||
    text.includes("legs") ||
    text.includes("patti") ||
    text.includes("braised") ||
    text.includes("roasted") ||
    text.includes("firemade")
  ) {
    return "prep-item";
  }
  return "needs-review";
}

function findBestIngredientMatch(ingredientMaster, ingredientCode = "", ingredientName = "") {
  const codeKey = normalizeCodeKey(ingredientCode);
  const nameKey = normalizeMatchKey(ingredientName);

  if (codeKey) {
    const codeMatch = ingredientMaster.reduce((bestMatch, ingredient) => {
      if (normalizeCodeKey(ingredient.ingredient_item_code) !== codeKey) return bestMatch;
      return pickPreferredIngredientRecord(bestMatch, ingredient);
    }, null);
    if (codeMatch) return codeMatch;
  }

  if (!nameKey) return null;

  const exactNameMatch = ingredientMaster.reduce((bestMatch, ingredient) => {
    if (normalizeMatchKey(ingredient.ingredient_name) !== nameKey) return bestMatch;
    return pickPreferredIngredientRecord(bestMatch, ingredient);
  }, null);
  if (exactNameMatch) return exactNameMatch;

  const fuzzyNameMatch = ingredientMaster.reduce((bestMatch, ingredient) => {
    const ingredientNameKey = normalizeMatchKey(ingredient.ingredient_name);
    if (!ingredientNameKey) return bestMatch;
    const matchScore = scoreIngredientSuggestion(
      {
        ingredient_name: ingredient.ingredient_name,
        ingredient_item_code: ingredient.ingredient_item_code,
        category: ingredient.category,
        supplier: ingredient.supplier,
      },
      ingredientName
    );
    if (matchScore < 55) return bestMatch;
    if (!bestMatch) {
      return { ingredient, matchScore };
    }
    if (matchScore > bestMatch.matchScore) {
      return { ingredient, matchScore };
    }
    return {
      ingredient: pickPreferredIngredientRecord(bestMatch.ingredient, ingredient),
      matchScore,
    };
  }, null);

  return fuzzyNameMatch?.ingredient || null;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y", "locked"].includes(normalized);
}

function getBaseVenueName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/);
  const lastPart = parts[parts.length - 1]?.toLowerCase();
  return DEFAULT_SERVICE_PERIODS.includes(lastPart) ? parts.slice(0, -1).join(" ") : raw;
}

function normalizeVenueName(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  const aliasKey = normalizeMatchKey(raw);
  return VENUE_ALIASES[aliasKey] || raw;
}

function getVenueServiceOptions(restaurants) {
  return restaurants.flatMap((venue) => {
    const servicePeriods = VENUE_SERVICE_PERIODS[venue] || DEFAULT_SERVICE_PERIODS.filter((slot) => slot !== "breakfast");
    return servicePeriods.map((servicePeriod) => `${venue} ${servicePeriod}`);
  });
}

function getRecipeVenueLabel(recipe) {
  if (recipe?.recipeType === "batch" && !recipe?.restaurant?.trim()) {
    return "Batch";
  }
  return recipe?.restaurant?.trim() || "Blank";
}

function getRecipeVenueKey(recipe) {
  return getRecipeVenueLabel(recipe) || "";
}

function tokenizeMatchText(value) {
  return normalizeMatchKey(value)
    .split(" ")
    .filter(Boolean);
}

function getTokenOverlapScore(leftValue, rightValue) {
  const leftTokens = tokenizeMatchText(leftValue);
  const rightTokens = tokenizeMatchText(rightValue);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const rightSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter((token) => rightSet.has(token)).length;
  return sharedCount / Math.max(leftTokens.length, rightTokens.length);
}

function scoreIngredientSuggestion(ingredient, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const name = String(ingredient.ingredient_name || "").toLowerCase();
  const code = String(ingredient.ingredient_item_code || "").toLowerCase();
  const category = String(ingredient.category || "").toLowerCase();
  const supplier = String(ingredient.supplier || "").toLowerCase();

  if (name === normalizedQuery || code === normalizedQuery) return 100;
  if (name.startsWith(normalizedQuery)) return 80;
  if (code.startsWith(normalizedQuery)) return 75;
  if (name.includes(normalizedQuery)) return 60;
  if (code.includes(normalizedQuery)) return 55;
  if (category.includes(normalizedQuery) || supplier.includes(normalizedQuery)) return 30;

  const tokenScore = getTokenOverlapScore(normalizedQuery, `${name} ${category} ${supplier}`);
  return tokenScore > 0 ? Math.round(tokenScore * 40) : 0;
}

function buildIngredientSuggestions({ query, recipes, ingredientMaster }) {
  const batchRecipeSuggestions = recipes
    .filter((candidate) => candidate.recipeType === "batch")
    .map((candidate) => ({
      id: `batch-${candidate.id}`,
      ingredient_name: candidate.name,
      ingredient_item_code: candidate.sellingItemCode,
      unit_cost: getBatchUnitCost(candidate),
      pack_size: candidate.batchYield
        ? `${numberValue(candidate.batchYield)} ${getBatchYieldLabel(candidate)}`
        : "",
      supplier: candidate.restaurant,
      category: `Batch recipe · ${candidate.category || "Uncategorised"}`,
      sourceType: "batch",
      sourceRecipeId: candidate.id,
      sourceYieldType: candidate.batchYieldType || "",
    }));

  const masterSuggestions = ingredientMaster.map((ingredient) => ({
    ...ingredient,
    sourceType: "ingredient-master",
    sourceYieldType: "kg",
  }));

  return [...batchRecipeSuggestions, ...masterSuggestions]
    .map((ingredient) => ({
      ...ingredient,
      matchScore: scoreIngredientSuggestion(ingredient, query),
    }))
    .filter((ingredient) => !query || ingredient.matchScore > 0)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return String(left.ingredient_name || "").localeCompare(String(right.ingredient_name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, 6);
}

function getDishIndexMatch(row, recipes) {
  if (row.reviewState === "no-recipe") {
    return {
      status: "missing",
      confidence: "manual",
      score: 0,
      recipe: null,
      source: "manual-no-recipe",
    };
  }

  if (row.linkedRecipeId) {
    const linkedRecipe = recipes.find((recipe) => recipe.id === row.linkedRecipeId) || null;
    if (linkedRecipe) {
      return {
        status: "matched",
        confidence: "manual",
        score: 1,
        recipe: linkedRecipe,
        source: "manual-link",
      };
    }
  }

  const dishNameKey = normalizeMatchKey(row.dishName);
  const courseKey = normalizeMatchKey(row.course);
  const venueKey = normalizeMatchKey(normalizeVenueName(row.venue || row.sourceTab));
  const oldFlag = normalizeBooleanFlag(row.oldFlag);

  if (!dishNameKey) {
    return {
      status: "missing",
      confidence: "none",
      score: 0,
      recipe: null,
      source: "auto",
    };
  }

  const exactMatches = recipes.filter((recipe) => normalizeMatchKey(recipe.name) === dishNameKey);
  const exactVenueMatch =
    exactMatches.find((recipe) => normalizeMatchKey(getBaseVenueName(getRecipeVenueLabel(recipe))) === venueKey) ||
    exactMatches[0] ||
    null;

  if (exactVenueMatch) {
    return {
      status: "matched",
      confidence: "high",
      score: 1,
      recipe: exactVenueMatch,
      source: "auto",
    };
  }

  let bestRecipe = null;
  let bestScore = 0;

  recipes.forEach((recipe) => {
    const nameScore = getTokenOverlapScore(row.dishName, recipe.name);
    const venueScore =
      venueKey && normalizeMatchKey(getBaseVenueName(getRecipeVenueLabel(recipe))) === venueKey ? 0.15 : 0;
    const categoryScore = courseKey && normalizeMatchKey(recipe.category) === courseKey ? 0.1 : 0;
    const totalScore = Math.min(1, nameScore + venueScore + categoryScore);

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestRecipe = recipe;
    }
  });

  const possibleThreshold = oldFlag ? 0.45 : 0.55;
  if (bestRecipe && bestScore >= 0.85) {
    return {
      status: "matched",
      confidence: "high",
      score: bestScore,
      recipe: bestRecipe,
      source: "auto",
    };
  }

  if (bestRecipe && bestScore >= possibleThreshold) {
    return {
      status: "possible",
      confidence: bestScore >= 0.7 ? "medium" : "low",
      score: bestScore,
      recipe: bestRecipe,
      source: "auto",
    };
  }

  return {
    status: "missing",
    confidence: "none",
    score: bestScore,
    recipe: null,
    source: "auto",
  };
}

function mergeImportedDishIndexRows(currentRows, importedRows) {
  const importedIds = new Set(importedRows.map((row) => row.id));
  const preserved = currentRows.filter((row) => !importedIds.has(row.id));
  return [...importedRows, ...preserved];
}

function createRecipeDraft(defaultRestaurant = "Tasi") {
  return {
    restaurant: defaultRestaurant,
    name: "",
    category: "",
    sellingItemCode: "",
    currentSalePrice: 0,
    roundup: 0,
    recipeType: "dish",
    portionCount: 1,
    batchYield: 1,
    batchYieldType: "portion",
    methodSteps: [],
    presentationNotes: "",
    components: [
      {
        id: "draft-1",
        sort: 1,
        ingredient: "",
        code: "",
        qty: 0,
        cost: 0,
        sourceType: "",
        sourceRecipeId: "",
        sourceUnitCost: 0,
        sourceYieldType: "",
      },
    ],
  };
}

const tabs = [
  { id: "queue", label: "Queue", icon: "chart" },
  { id: "recipes", label: "Recipes", icon: "chef" },
  { id: "builder", label: "Builder", icon: "calculator" },
  { id: "menus", label: "Set menus", icon: "clipboard" },
  { id: "ingredients", label: "Ingredients", icon: "spark" },
  { id: "imports", label: "Imports", icon: "upload" },
  { id: "users", label: "Users", icon: "spark" },
];

const FOOD_APP_URL = "http://localhost:5174/";
const DRINKS_APP_URL = "http://localhost:5173/";

function Icon({ name }) {
  const paths = {
    chef: "M4 18h16M6 18v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3M8 9a4 4 0 1 1 8 0v1H8V9Z",
    calculator:
      "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h6M8 11h2m4 0h2M8 15h2m4 0h2",
    clipboard:
      "M9 4h6a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2Zm1-1h4a1 1 0 0 1 1 1v1H9V4a1 1 0 0 1 1-1Zm0 8h4m-4 4h6",
    chart: "M5 19V9m7 10V5m7 14v-7M3 19h18",
    back: "M15 18l-6-6 6-6M9 12h12",
    search: "m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M9 7V5h6v2m-7 4v6m4-6v6m4-6v6M6 7l1 12h10l1-12",
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
    upload: "M12 16V5m0 0-4 4m4-4 4 4M5 19h14",
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function createRecipes() {
  const componentsByRecipeId = new Map();

  workbook.sheets.Recipe_Components.rows.forEach((component) => {
    const recipeComponents = componentsByRecipeId.get(component.recipe_id) || [];
    recipeComponents.push({
      id: `${component.recipe_id}-${component.component_sort}`,
      sort: numberValue(component.component_sort),
      ingredient: component.ingredient_name,
      code: component.ingredient_item_code,
      qty: numberValue(component.quantity_by_weight_grams),
      cost: numberValue(component.component_cost),
      sourceType: "",
      sourceRecipeId: "",
      sourceUnitCost: 0,
      sourceYieldType: "",
    });
    componentsByRecipeId.set(component.recipe_id, recipeComponents);
  });

  return workbook.sheets.Recipes.rows.map((recipe) => ({
    id: recipe.recipe_id,
    sourceRow: recipe.source_row,
    restaurant: recipe.restaurant,
    name: recipe.name,
    category: recipe.category,
    sellingItemCode: recipe.selling_item_code,
    currentSalePrice: numberValue(recipe.current_sale_price),
    roundup: numberValue(recipe.roundup),
    netPriceSource: numberValue(recipe.net_price_source),
    grossPriceSource: numberValue(recipe.gross_price_source),
    sourceCost: numberValue(recipe.source_cost),
    posYtd: numberValue(recipe.pos_ytd),
    recipeComplete: recipe.recipe_complete,
    pricingComplete: recipe.pricing_complete,
    recipeType: "dish",
    portionCount: 1,
    batchYield: 1,
    batchYieldType: "portion",
    method: "",
    methodSteps: [],
    presentationNotes: "",
    presentationImage: "",
    workflowStage: "draft",
    isLocked: false,
    isLive: false,
    components: (componentsByRecipeId.get(recipe.recipe_id) || []).sort((a, b) => a.sort - b.sort),
  }));
}

function createMenus(recipes) {
  return workbook.sheets.Menus.rows.map((menu) => {
    const lines = workbook.sheets.Menu_Lines.rows
      .filter((line) => line.menu_id === menu.menu_id)
      .sort((a, b) => numberValue(a.line_sort) - numberValue(b.line_sort))
      .map((line) => {
        const recipe = recipes.find((item) => item.id === line.recipe_id);
        return {
          id: `${line.menu_id}-${line.line_sort}`,
          courseLabel: line.course_label,
          recipeId: line.recipe_id,
          dishName: line.dish_name,
          restaurant: line.restaurant,
          lineCost: numberValue(line.line_cost) || (recipe ? recipe.recipeCost : 0),
          lineSalePrice: numberValue(line.line_sale_price) || (recipe ? recipe.currentSalePrice : 0),
          category: line.category,
          recipe,
        };
      });

    return {
      id: menu.menu_id,
      name: menu.menu_name,
      restaurant: menu.restaurant,
      guestCount: numberValue(menu.guest_count),
      targetGp: numberValue(menu.target_gp),
      isLiveMenu: false,
      lines,
    };
  });
}

function validateRecipe(recipe) {
  const issues = [];
  const addIssue = (level, text, target) => issues.push({ level, text, target });
  const isBatch = recipe.recipeType === "batch";

  if (!recipe.name?.trim()) addIssue("error", "Missing dish name", { type: "field", field: "name" });
  if (!recipe.restaurant?.trim() && !isBatch) addIssue("error", "Missing venue", { type: "field", field: "restaurant" });
  if (!recipe.category?.trim()) addIssue("warn", "Missing category", { type: "field", field: "category" });
  if (!recipe.sellingItemCode?.trim()) {
    addIssue("error", "Missing item code", { type: "field", field: "sellingItemCode" });
  }
  if (!isBatch && numberValue(recipe.currentSalePrice) <= 0) {
    addIssue("error", "Missing sale price", { type: "field", field: "currentSalePrice" });
  }
  if (isBatch && numberValue(recipe.batchYield) <= 0) {
    addIssue("error", "Missing batch yield", { type: "field", field: "batchYield" });
  }
  if (isBatch && !recipe.batchYieldType?.trim()) {
    addIssue("warn", "Missing batch yield type", { type: "field", field: "batchYieldType" });
  }
  if (!recipe.components.length) {
    addIssue("error", "No components added", { type: "components" });
  }

  recipe.components.forEach((component) => {
    if (!component.ingredient?.trim()) {
      addIssue("error", `Component #${component.sort} is missing an ingredient name`, {
        type: "component",
        componentId: component.id,
        field: "ingredient",
      });
    }
    if (!component.code?.trim()) {
      addIssue("warn", `Component #${component.sort} is missing an ingredient code`, {
        type: "component",
        componentId: component.id,
        field: "code",
      });
    }
    if (numberValue(component.cost) <= 0) {
      addIssue("error", `Component #${component.sort} is missing a cost`, {
        type: "component",
        componentId: component.id,
        field: "cost",
      });
    }
    if (numberValue(component.qty) <= 0) {
      addIssue("warn", `Component #${component.sort} is missing a quantity`, {
        type: "component",
        componentId: component.id,
        field: "qty",
      });
    }
  });

  if (recipe.recipeComplete === "0") {
    addIssue("warn", "Recipe marked incomplete", { type: "meta", field: "recipeComplete" });
  }
  if (!isBatch && recipe.pricingComplete === "0") {
    addIssue("warn", "Pricing marked incomplete", { type: "meta", field: "pricingComplete" });
  }
  if (!isBatch && recipe.gp <= 0) {
    addIssue("error", "GP is zero or negative", { type: "meta", field: "gp" });
  }

  const hasErrors = issues.some((issue) => issue.level === "error");
  const hasWarnings = issues.some((issue) => issue.level === "warn");

  return {
    issues,
    reviewStatus: hasErrors ? "needs-review" : hasWarnings ? "warning" : "ready",
  };
}

function derivePricingComplete(recipe) {
  if (!recipe.components?.length) {
    return String(recipe.pricingComplete ?? "0");
  }

  const hasCompleteComponentPricing = recipe.components.every(
    (component) =>
      numberValue(component.qty) > 0 &&
      numberValue(component.cost) > 0
  );

  return hasCompleteComponentPricing ? "1" : String(recipe.pricingComplete ?? "0");
}

function enrichRecipeMetrics(recipe) {
  const recipeCost = recipe.components.reduce((sum, component) => sum + numberValue(component.cost), 0);
  const roundup = recipe.recipeType === "batch" ? numberValue(recipe.roundup) : calculateRoundupTarget(recipeCost);
  const gp = recipe.currentSalePrice > 0 ? (recipe.currentSalePrice - recipeCost) / recipe.currentSalePrice : 0;
  const variance = recipe.currentSalePrice - roundup;
  const pricingComplete = derivePricingComplete(recipe);
  return {
    ...recipe,
    roundup,
    pricingComplete,
    recipeCost,
    gp,
    variance,
    validation: validateRecipe({ ...recipe, roundup, pricingComplete, recipeCost, gp, variance }),
  };
}

function calculateMenuCard(menu, recipes) {
  const lines = menu.lines.map((line) => {
    const recipe = recipes.find((item) => item.id === line.recipeId) || null;
    const lineCost = recipe ? recipe.recipeCost : numberValue(line.lineCost);
    const lineSalePrice = recipe ? recipe.currentSalePrice : numberValue(line.lineSalePrice);

    return {
      ...line,
      recipe,
      dishName: recipe?.name || line.dishName || "Unknown recipe",
      restaurant: recipe?.restaurant || line.restaurant || menu.restaurant,
      category: recipe?.category || line.category || "",
      lineCost,
      lineSalePrice,
    };
  });

  const menuRecipes = recipes.filter((recipe) => lines.some((line) => line.recipeId === recipe.id));
  const perGuestCost = lines.reduce((sum, line) => sum + numberValue(line.lineCost), 0);
  const perGuestSell = lines.reduce((sum, line) => sum + numberValue(line.lineSalePrice), 0);
  const targetSellPerGuest = menu.targetGp < 1 ? perGuestCost / (1 - menu.targetGp) : 0;

  return {
    ...menu,
    lines,
    menuRecipes,
    perGuestCost,
    perGuestSell,
    targetSellPerGuest,
    totalFoodCost: perGuestCost * numberValue(menu.guestCount),
    totalFoodRevenue: perGuestSell * numberValue(menu.guestCount),
    menuGp: perGuestSell > 0 ? (perGuestSell - perGuestCost) / perGuestSell : 0,
    targetRevenue: targetSellPerGuest * numberValue(menu.guestCount),
  };
}

function getRestaurantLiveRecipeIds(menus) {
  const ids = new Set();
  menus
    .filter((menu) => menu.isLiveMenu)
    .forEach((menu) => {
      menu.lines.forEach((line) => {
        if (line.recipeId) ids.add(line.recipeId);
      });
    });
  return ids;
}

function getBatchUnitCost(recipe) {
  const batchYield = numberValue(recipe.batchYield);
  if (batchYield <= 0) return 0;
  return recipe.recipeCost / batchYield;
}

function getBatchYieldLabel(recipe) {
  return recipe.batchYieldType?.trim() || "unit";
}

function getLinkedBatchComponentQty(recipe, batchRecipe, fallbackQty = 0) {
  if (
    recipe?.recipeType !== "batch" &&
    batchRecipe?.batchYieldType === "portion" &&
    numberValue(recipe?.portionCount) > 0 &&
    numberValue(batchRecipe?.batchYield) > 0
  ) {
    return numberValue(batchRecipe.batchYield) / numberValue(recipe.portionCount);
  }

  return numberValue(fallbackQty);
}

function getChefPortionNote(recipe) {
  if (recipe.recipeType === "batch") {
    if (getBatchYieldLabel(recipe) === "portion" && numberValue(recipe.batchYield) > 0) {
      return `Makes ${numberValue(recipe.batchYield)} portions`;
    }
    if (numberValue(recipe.batchYield) > 0) {
      return `Batch yield: ${numberValue(recipe.batchYield)} ${getBatchYieldLabel(recipe)}`;
    }
    return "";
  }

  if (numberValue(recipe.portionCount) > 1) {
    return `Makes ${numberValue(recipe.portionCount)} portions`;
  }

  return "";
}

function getMethodSteps(recipe) {
  if (Array.isArray(recipe.methodSteps) && recipe.methodSteps.length) {
    return recipe.methodSteps.map((step) => String(step || "").trim()).filter(Boolean);
  }

  return String(recipe.method || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function calculateAutoComponentCost(qty, unitCost, yieldType) {
  const numericQty = numberValue(qty);
  const numericUnitCost = numberValue(unitCost);
  if (numericQty <= 0 || numericUnitCost <= 0) return 0;

  if (yieldType === "kg" || yieldType === "l") {
    return (numericQty / 1000) * numericUnitCost;
  }

  return numericQty * numericUnitCost;
}

function shouldAutoCostComponent(component) {
  return Boolean(component.sourceType) && Boolean(component.sourceYieldType) && numberValue(component.sourceUnitCost) > 0;
}

function getFieldIssues(validation, field) {
  return validation.issues.filter(
    (issue) => issue.target?.type === "field" && issue.target.field === field
  );
}

function getMetaIssues(validation, field) {
  return validation.issues.filter(
    (issue) => issue.target?.type === "meta" && issue.target.field === field
  );
}

function getComponentFieldIssues(validation, componentId, field) {
  return validation.issues.filter(
    (issue) =>
      issue.target?.type === "component" &&
      issue.target.componentId === componentId &&
      issue.target.field === field
  );
}

function getComponentIssues(validation, componentId) {
  return validation.issues.filter(
    (issue) => issue.target?.type === "component" && issue.target.componentId === componentId
  );
}

function getValidationIssueText(issue) {
  return typeof issue === "string" ? issue : issue?.text || String(issue || "");
}

function getIngredientSourceLabel(row) {
  return row.sourceKind === "ingredient-master" ? "ingredient master" : "recipe-backed batch";
}

function getIngredientRecipeEntityLabel(row) {
  const status = row.batchLink?.status;
  if (status === "not-applicable") return "not needed";
  if (status === "ready") return `linked ${row.batchLink.recipeName || ""}`.trim();
  if (status === "needs-review") return `recipe needs review ${row.batchLink.recipeName || ""}`.trim();
  if (status === "wrong-type") return `not a batch recipe ${row.batchLink.recipeName || ""}`.trim();
  if (status === "missing") return "missing batch recipe";
  if (status === "recipe-batch") return `recipe-backed batch ${row.batchLink.recipeName || ""}`.trim();
  return "";
}

function getIngredientStatusLabel(row) {
  const baseStatus = row.validation.reviewStatus === "needs-review" ? "needs review" : "ready";
  const lockText =
    row.sourceKind === "ingredient-master" && row.source.is_locked ? "locked" : "";
  const issueText = row.validation.issues.map((issue) => getValidationIssueText(issue)).join(" ");
  const syncText =
    row.sourceKind === "ingredient-master" && row.source.linked_recipe_id
      ? `synced to ${row.source.linked_recipe_id}`
      : "";
  const batchCodeText = row.rowType === "batch" ? row.displayCode || "batch id missing" : "";
  return [baseStatus, lockText, batchCodeText, syncText, issueText].filter(Boolean).join(" ");
}

function getIngredientColumnSearchText(row, column) {
  switch (column) {
    case "type":
      return row.rowType === "batch" ? "batch recipe" : "ingredient";
    case "ingredient":
      return row.displayName || "";
    case "code":
      return row.displayCode || "";
    case "price":
      return String(row.displayPrice ?? "");
    case "pack-size":
      return row.displayPackSize || "";
    case "category":
      return row.displayCategory || "";
    case "supplier":
      return row.displaySupplier || "";
    case "updated":
      return row.displayUpdated || row.source?.last_updated || "";
    case "used":
      return String(row.displayUsed ?? "");
    case "source":
      return getIngredientSourceLabel(row);
    case "recipe-entity":
      return getIngredientRecipeEntityLabel(row);
    case "status":
      return getIngredientStatusLabel(row);
    default:
      return [
        row.rowType === "batch" ? "batch recipe" : "ingredient",
        row.displayName,
        row.displayCode,
        String(row.displayPrice ?? ""),
        row.displayPackSize,
        row.displayCategory,
        row.displaySupplier,
        row.displayUpdated,
        String(row.displayUsed ?? ""),
        getIngredientSourceLabel(row),
        getIngredientRecipeEntityLabel(row),
        getIngredientStatusLabel(row),
      ]
        .filter(Boolean)
        .join(" ");
  }
}

function getIngredientSortValue(row, column) {
  switch (column) {
    case "type":
      return row.rowType === "batch" ? "batch recipe" : "ingredient";
    case "ingredient":
      return row.displayName || "";
    case "code":
      return row.displayCode || "";
    case "price":
      return numberValue(row.displayPrice);
    case "pack-size":
      return row.displayPackSize || "";
    case "category":
      return row.displayCategory || "";
    case "supplier":
      return row.displaySupplier || "";
    case "updated":
      return row.displayUpdated || row.source?.last_updated || "";
    case "used":
      return numberValue(row.displayUsed);
    case "source":
      return getIngredientSourceLabel(row);
    case "recipe-entity":
      return getIngredientRecipeEntityLabel(row);
    case "status":
      return getIngredientStatusLabel(row);
    default:
      return row.displayName || "";
  }
}

function getRecipeSortValue(recipe, column, restaurantLiveRecipeIds) {
  switch (column) {
    case "lock":
      return recipe.isLocked ? 1 : 0;
    case "venue":
      return getRecipeVenueLabel(recipe);
    case "dish":
      return recipe.name || "";
    case "category":
      return recipe.category || "";
    case "code":
      return recipe.sellingItemCode || "";
    case "status":
      return [
        recipe.recipeType === "batch" ? "batch" : "dish",
        recipe.validation.reviewStatus || "",
        recipe.workflowStage || "",
        recipe.isLocked ? "locked" : "",
        recipe.isLive ? "live" : "",
        restaurantLiveRecipeIds.has(recipe.id) ? "on live menu" : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "recipe-cost":
      return numberValue(recipe.recipeCost);
    case "sale-price":
      return recipe.recipeType === "batch" ? 0 : numberValue(recipe.currentSalePrice);
    case "gp":
      return recipe.recipeType === "batch" ? numberValue(getBatchUnitCost(recipe)) : numberValue(recipe.gp);
    default:
      return recipe.name || "";
  }
}

function isParentLinkedComponent(component) {
  return (
    component.sourceType === "batch" &&
    Boolean(component.sourceRecipeId) &&
    normalizeCodeKey(component.code).startsWith("BCH")
  );
}

function getComponentSourceRouteLabel(component) {
  if (isParentLinkedComponent(component)) {
    return "Source: parent batch recipe";
  }
  if (component.sourceType === "ingredient-master") {
    return "Source: ingredient master";
  }
  return "Source: this recipe";
}

function isIngredientBuilderRow(row) {
  return row.sourceKind === "ingredient-master" && !row.source.is_locked;
}

function createBlankIngredientRow(nextId) {
  return {
    id: nextId,
    ingredient_name: "",
    ingredient_item_code: "",
    unit_cost: "",
    pack_size: "",
    supplier: "",
    category: "",
    last_updated: getTodayDateString(),
    entry_type: "ingredient",
    linked_recipe_id: "",
    is_locked: false,
  };
}

function isEmptyIngredientDraftRow(ingredient) {
  if (!ingredient) return false;
  return (
    ingredient.sourceKind !== "recipe-batch" &&
    !ingredient.is_locked &&
    !ingredient.ingredient_name?.trim() &&
    !ingredient.ingredient_item_code?.trim() &&
    !String(ingredient.unit_cost ?? "").trim() &&
    !String(ingredient.pack_size ?? "").trim() &&
    !ingredient.supplier?.trim() &&
    !ingredient.category?.trim() &&
    !ingredient.linked_recipe_id?.trim()
  );
}

function sanitizeIngredientMasterRows(rows) {
  const sanitizedRows = [];
  let keptBlankDraft = false;

  restoreMissingIngredientPrices(rows).forEach((ingredient) => {
    const normalizedIngredient = {
      ...ingredient,
      supplier: "",
      category: "",
      is_locked: normalizeBooleanFlag(ingredient?.is_locked),
    };

    if (isEmptyIngredientDraftRow(normalizedIngredient)) {
      if (keptBlankDraft) return;
      keptBlankDraft = true;
    }

    sanitizedRows.push(normalizedIngredient);
  });

  return sanitizedRows;
}

function validateIngredient(ingredient, duplicates, batchLink) {
  const issues = [];

  if (!ingredient.ingredient_name?.trim()) issues.push("Missing ingredient name");
  if (!ingredient.ingredient_item_code?.trim()) issues.push("Missing item code");
  if (numberValue(ingredient.unit_cost) <= 0) issues.push("Missing or zero price");
  if (duplicates.code.has(ingredient.ingredient_item_code)) issues.push("Duplicate item code");
  if (duplicates.name.has(ingredient.ingredient_name.trim().toLowerCase())) issues.push("Duplicate ingredient name");
  if (ingredient.entry_type === "batch" && batchLink?.status === "missing") {
    issues.push("Missing batch recipe entity");
  }
  if (ingredient.entry_type === "batch" && batchLink?.status === "wrong-type") {
    issues.push("Linked recipe is not marked as batch");
  }
  if (ingredient.entry_type === "batch" && batchLink?.status === "needs-review") {
    issues.push("Linked batch recipe needs review");
  }

  return {
    issues,
    reviewStatus: issues.length ? "needs-review" : "ready",
  };
}

function Card({ children, className = "", onClick }) {
  return (
    <section className={`card ${className}`.trim()} onClick={onClick}>
      {children}
    </section>
  );
}

function StatCard({ label, value, tone = "", onClick = null }) {
  return (
    <Card
      className={`stat-card ${tone} ${onClick ? "stat-card-clickable" : ""}`.trim()}
      onClick={onClick ? onClick : undefined}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </Card>
  );
}

function Badge({ children, tone = "default" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <div className="card-header">
            <div>
              <div className="eyebrow">Tab error</div>
              <h2>Ingredients tab failed to render</h2>
            </div>
          </div>
          <p className="support-text error-text">
            {this.state.error?.message || "Unknown error"}
          </p>
        </Card>
      );
    }

    return this.props.children;
  }
}

function formatEditableDecimal(value, decimals = 2) {
  if (value === "" || value === null || value === undefined) return "";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "";
  return numericValue.toFixed(decimals);
}

function DecimalInput({
  value,
  onCommit,
  className = "",
  disabled = false,
  placeholder = "",
  decimals = 2,
}) {
  const [draftValue, setDraftValue] = useState(
    value === "" || value === null || value === undefined ? "" : String(value)
  );

  useEffect(() => {
    setDraftValue(
      value === "" || value === null || value === undefined
        ? ""
        : formatEditableDecimal(value, decimals)
    );
  }, [decimals, value]);

  const commitValue = () => {
    if (!onCommit) return;
    const committedValue = numberValue(draftValue);
    onCommit(committedValue);
    setDraftValue(formatEditableDecimal(committedValue, decimals));
  };

  return (
    <input
      inputMode="decimal"
      className={`numeric-input ${className}`.trim()}
      disabled={disabled}
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commitValue}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commitValue();
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
    />
  );
}

function loadIngredientMaster() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(INGREDIENT_MASTER_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? sanitizeIngredientMasterRows(parsed)
      : [];
  } catch {
    return [];
  }
}

function loadStoredCollection(storageKey) {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredCollection(storageKey, value) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage failures and leave the current in-memory state intact.
  }
}

function toHex32(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function buildStableUuid(input) {
  const source = String(input || "").trim();
  if (!source) {
    return "00000000-0000-4000-8000-000000000000";
  }
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 0x01000193);
    hashes[1] = Math.imul(hashes[1] ^ code, 0x85ebca6b);
    hashes[2] = Math.imul(hashes[2] ^ code, 0xc2b2ae35);
    hashes[3] = Math.imul(hashes[3] ^ code, 0x27d4eb2f);
  }
  const combined = hashes.map(toHex32).join("").slice(0, 32).split("");
  combined[12] = "4";
  combined[16] = ((parseInt(combined[16], 16) & 0x3) | 0x8).toString(16);
  return [
    combined.slice(0, 8).join(""),
    combined.slice(8, 12).join(""),
    combined.slice(12, 16).join(""),
    combined.slice(16, 20).join(""),
    combined.slice(20, 32).join(""),
  ].join("-");
}

function normalizeSupabaseIngredientId(ingredient) {
  const id = String(ingredient?.id || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const key = id
    || normalizeIngredientCode(ingredient?.ingredient_item_code)
    || normalizeNameKey(ingredient?.ingredient_name)
    || `ingredient-${Date.now()}`;
  return buildStableUuid(key);
}

function normalizeSupabaseRecipeComponentId(recipeId, component) {
  const id = String(component?.id || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  return buildStableUuid(
    `${recipeId}:${id || component?.sort || ""}:${component?.code || ""}:${component?.ingredient || ""}`
  );
}

function mapIngredientRowToSupabase(ingredient) {
  return {
    id: normalizeSupabaseIngredientId(ingredient),
    ingredient_name: ingredient.ingredient_name || "",
    ingredient_item_code: ingredient.ingredient_item_code || "",
    unit_cost: numberValue(ingredient.unit_cost),
    pack_size: ingredient.pack_size || "",
    supplier: ingredient.supplier || "",
    category: ingredient.category || "",
    last_updated: ingredient.last_updated || null,
    entry_type: ingredient.entry_type || "ingredient",
    linked_recipe_id: ingredient.linked_recipe_id || null,
    is_locked: normalizeBooleanFlag(ingredient.is_locked),
  };
}

function mapSupabaseIngredientRow(row) {
  return {
    id: row.id,
    ingredient_name: row.ingredient_name || "",
    ingredient_item_code: row.ingredient_item_code || "",
    unit_cost: numberValue(row.unit_cost),
    pack_size: row.pack_size || "",
    supplier: row.supplier || "",
    category: row.category || "",
    last_updated: row.last_updated || "",
    entry_type: row.entry_type || "ingredient",
    linked_recipe_id: row.linked_recipe_id || "",
    is_locked: Boolean(row.is_locked),
  };
}

function mapRecipeRowToSupabase(recipe) {
  const methodSteps = getMethodSteps(recipe);
  return {
    id: recipe.id,
    restaurant: recipe.restaurant || "",
    name: recipe.name || "",
    category: recipe.category || "",
    selling_item_code: recipe.sellingItemCode || "",
    current_sale_price: numberValue(recipe.currentSalePrice),
    roundup: numberValue(recipe.roundup),
    recipe_type: recipe.recipeType === "batch" ? "batch" : "dish",
    batch_yield: recipe.recipeType === "batch" ? numberValue(recipe.batchYield) : null,
    batch_yield_type: recipe.recipeType === "batch" ? recipe.batchYieldType || "portion" : null,
    portion_count: recipe.recipeType === "batch" ? null : numberValue(recipe.portionCount) || 1,
    method: methodSteps,
    presentation_notes: recipe.presentationNotes || "",
    recipe_complete: normalizeBooleanFlag(recipe.recipeComplete),
    pricing_complete: normalizeBooleanFlag(recipe.pricingComplete),
    is_live: normalizeBooleanFlag(recipe.isLive),
    is_locked: normalizeBooleanFlag(recipe.isLocked),
    workflow_stage: recipe.workflowStage || "draft",
  };
}

function mapRecipeComponentRowToSupabase(recipeId, component, index) {
  return {
    id: normalizeSupabaseRecipeComponentId(recipeId, component),
    recipe_id: recipeId,
    component_order: numberValue(component.sort) || index + 1,
    ingredient_name: component.ingredient || "",
    ingredient_item_code: component.code || "",
    qty: numberValue(component.qty),
    cost: numberValue(component.cost),
    source_type: component.sourceType || null,
    source_recipe_id: component.sourceRecipeId || null,
    source_unit_cost: numberValue(component.sourceUnitCost) || 0,
    source_yield_type: component.sourceYieldType || null,
  };
}

function mapSupabaseRecipeRow(row, components = []) {
  const methodSteps = Array.isArray(row.method)
    ? row.method.map((step) => String(step || "").trim()).filter(Boolean)
    : String(row.method || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

  return enrichRecipeMetrics({
    id: row.id,
    sourceRow: "",
    restaurant: row.restaurant || "",
    name: row.name || "",
    category: row.category || "",
    sellingItemCode: row.selling_item_code || "",
    currentSalePrice: numberValue(row.current_sale_price),
    roundup: numberValue(row.roundup),
    netPriceSource: 0,
    grossPriceSource: 0,
    sourceCost: 0,
    posYtd: 0,
    recipeComplete: row.recipe_complete ? "1" : "0",
    pricingComplete: row.pricing_complete ? "1" : "0",
    recipeType: row.recipe_type === "batch" ? "batch" : "dish",
    portionCount: row.recipe_type === "batch" ? 1 : numberValue(row.portion_count) || 1,
    batchYield: row.recipe_type === "batch" ? numberValue(row.batch_yield) || 1 : 1,
    batchYieldType: row.recipe_type === "batch" ? row.batch_yield_type || "portion" : "portion",
    method: methodSteps.join("\n"),
    methodSteps,
    presentationNotes: row.presentation_notes || "",
    presentationImage: "",
    workflowStage: row.workflow_stage || "draft",
    isLocked: Boolean(row.is_locked),
    isLive: Boolean(row.is_live),
    components: components.map((component, index) => ({
      id: component.id || `${row.id}-${index + 1}`,
      sort: numberValue(component.component_order) || index + 1,
      ingredient: component.ingredient_name || "",
      code: component.ingredient_item_code || "",
      qty: numberValue(component.qty),
      cost: numberValue(component.cost),
      sourceType: component.source_type || "",
      sourceRecipeId: component.source_recipe_id || "",
      sourceUnitCost: numberValue(component.source_unit_cost),
      sourceYieldType: component.source_yield_type || "",
    })),
  });
}

function hydrateSupabaseRecipes(recipeRows, componentRows, ingredientMaster) {
  const componentsByRecipeId = new Map();
  (componentRows || []).forEach((component) => {
    const recipeId = component.recipe_id;
    if (!recipeId) return;
    const nextComponents = componentsByRecipeId.get(recipeId) || [];
    nextComponents.push(component);
    componentsByRecipeId.set(recipeId, nextComponents);
  });

  const hydratedRecipes = (recipeRows || []).map((recipeRow) =>
    mapSupabaseRecipeRow(
      recipeRow,
      (componentsByRecipeId.get(recipeRow.id) || []).sort(
        (left, right) => numberValue(left.component_order) - numberValue(right.component_order)
      )
    )
  );

  return syncIngredientReferences(linkBatchReferences(hydratedRecipes), ingredientMaster);
}

function mapMenuRowToSupabase(menu) {
  return {
    id: menu.id,
    name: menu.name || "",
    venue: menu.restaurant || "",
    guest_count: Math.round(numberValue(menu.guestCount)),
    target_gp: numberValue(menu.targetGp),
    is_live: normalizeBooleanFlag(menu.isLiveMenu),
  };
}

function mapMenuLineRowToSupabase(menuId, line, index) {
  return {
    id: buildStableUuid(`${menuId}:${line.id || index + 1}`),
    menu_id: menuId,
    recipe_id: line.recipeId || null,
    line_order: index + 1,
  };
}

function hydrateSupabaseMenus(menuRows, menuLineRows, recipes) {
  const linesByMenuId = new Map();
  (menuLineRows || []).forEach((line) => {
    const menuId = line.menu_id;
    if (!menuId) return;
    const nextLines = linesByMenuId.get(menuId) || [];
    nextLines.push(line);
    linesByMenuId.set(menuId, nextLines);
  });

  return (menuRows || []).map((menuRow) => {
    const lines = (linesByMenuId.get(menuRow.id) || [])
      .sort((left, right) => numberValue(left.line_order) - numberValue(right.line_order))
      .map((line, index) => {
        const recipe = recipes.find((item) => item.id === line.recipe_id) || null;
        return {
          id: line.id || `${menuRow.id}-${index + 1}`,
          courseLabel: "",
          recipeId: line.recipe_id || "",
          dishName: recipe?.name || "",
          restaurant: recipe?.restaurant || menuRow.venue || "",
          lineCost: recipe ? recipe.recipeCost : 0,
          lineSalePrice: recipe ? recipe.currentSalePrice : 0,
          category: recipe?.category || "",
          recipe,
        };
      });

    return {
      id: menuRow.id,
      name: menuRow.name || "",
      restaurant: menuRow.venue || "",
      guestCount: Math.round(numberValue(menuRow.guest_count)),
      targetGp: numberValue(menuRow.target_gp),
      isLiveMenu: Boolean(menuRow.is_live),
      lines,
    };
  });
}

function mapDishIndexRowToSupabase(row) {
  return {
    id: row.id,
    source_tab: row.sourceTab || "",
    venue: row.venue || "",
    course: row.course || "",
    dish_name: row.dishName || "",
    old_flag: row.oldFlag || "",
    linked_recipe_id: row.linkedRecipeId || null,
    review_state: row.reviewState || null,
    is_archived: Boolean(row.isArchived),
  };
}

function mapSupabaseDishIndexRow(row) {
  return {
    id: row.id || row.entry_id || "",
    sourceTab: row.source_tab || row.sourceTab || "",
    venue: normalizeVenueName(row.venue, row.source_tab || row.sourceTab || ""),
    course: row.course || "",
    dishName: row.dish_name || row.dishName || "",
    oldFlag: row.old_flag || row.oldFlag || "",
    linkedRecipeId: row.linked_recipe_id || row.linkedRecipeId || "",
    reviewState: row.review_state || row.reviewState || "",
    isArchived: Boolean(row.is_archived || row.isArchived),
  };
}

function mapBchAuditDecisionToSupabase(decision) {
  return {
    id: normalizeCodeKey(decision.code),
    code: normalizeCodeKey(decision.code),
    component_name: decision.componentName || null,
    classification: decision.classification || "needs-review",
    notes: decision.notes || "",
  };
}

function mapSupabaseBchAuditDecision(row) {
  return {
    code: normalizeCodeKey(row.code || row.id || ""),
    classification: row.classification || "needs-review",
    notes: row.notes || "",
  };
}

function mergeSupabaseRecipesIntoCurrent(currentRecipes, sharedRecipes, ingredientMaster) {
  const sharedById = new Map((sharedRecipes || []).map((recipe) => [recipe.id, recipe]));
  const mergedRecipes = [
    ...(sharedRecipes || []),
    ...(currentRecipes || []).filter((recipe) => !sharedById.has(recipe.id)),
  ];
  return syncIngredientReferences(linkBatchReferences(mergedRecipes), ingredientMaster);
}

function mergeSupabaseMenusIntoCurrent(currentMenus, sharedMenus, recipes) {
  const sharedById = new Map((sharedMenus || []).map((menu) => [menu.id, menu]));
  return [
    ...(sharedMenus || []),
    ...(currentMenus || []).filter((menu) => !sharedById.has(menu.id)),
  ];
}

function mergeSupabaseDishIndexRowsIntoCurrent(currentRows, sharedRows) {
  const sharedById = new Map((sharedRows || []).map((row) => [row.id, row]));
  return [
    ...(sharedRows || []),
    ...(currentRows || []).filter((row) => !sharedById.has(row.id)),
  ];
}

function mergeSupabaseBchAuditIntoCurrent(currentRows, sharedRows) {
  const sharedByCode = new Map((sharedRows || []).map((row) => [normalizeCodeKey(row.code), row]));
  return [
    ...(sharedRows || []),
    ...(currentRows || []).filter((row) => !sharedByCode.has(normalizeCodeKey(row.code))),
  ];
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += character;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeIngredientMaster(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error("The ingredient upload file is empty.");
  }

  const headers = rows[0].map((header) => header.trim());
  const rawPricingFormatHeaders = [
    "Ingredient name",
    "PLU Code",
    "Description",
    "Grams. / Mililitre",
    "Cost per kilo",
  ];
  const isRawPricingSheet = rawPricingFormatHeaders.every((header) => headers.includes(header));

  if (isRawPricingSheet) {
    const headerIndex = new Map(headers.map((header, index) => [header, index]));
    return rows
      .slice(1)
      .map((row, index) => {
        const getValue = (column) => (row[headerIndex.get(column)] || "").trim();
        const rawCost = getValue("Cost per kilo").replace(/[^\d.-]/g, "");
        return {
          id: `${getValue("PLU Code") || "ingredient"}-${index + 1}`,
          ingredient_name: getValue("Ingredient name"),
          ingredient_item_code: getValue("PLU Code"),
          unit_cost: numberValue(rawCost),
          pack_size: getValue("Grams. / Mililitre"),
          supplier: "",
          category: getValue("Description"),
          last_updated: "",
          entry_type: "ingredient",
          linked_recipe_id: "",
          is_locked: false,
        };
      })
      .filter((ingredient) => ingredient.ingredient_name && ingredient.ingredient_item_code);
  }

  const missingColumns = REQUIRED_INGREDIENT_COLUMNS.filter((header) => !headers.includes(header));
  if (missingColumns.length) {
    throw new Error(
      `Missing required columns: ${missingColumns.join(", ")}. Or upload the raw pricing format with headers: ${rawPricingFormatHeaders.join(", ")}`
    );
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const ingredients = rows.slice(1).map((row, index) => {
    const getValue = (column) => (row[headerIndex.get(column)] || "").trim();
    return {
      id: `${getValue("ingredient_item_code") || "ingredient"}-${index + 1}`,
      ingredient_name: getValue("ingredient_name"),
      ingredient_item_code: getValue("ingredient_item_code"),
      unit_cost: numberValue(getValue("unit_cost")),
      pack_size: getValue("pack_size"),
      supplier: getValue("supplier"),
      category: getValue("category"),
      last_updated: getValue("last_updated"),
      entry_type: getValue("entry_type") || "ingredient",
      linked_recipe_id: getValue("linked_recipe_id"),
      is_locked: normalizeBooleanFlag(getValue("is_locked")),
    };
  });

  return ingredients.filter(
    (ingredient) => ingredient.ingredient_name && ingredient.ingredient_item_code
  );
}

function downloadIngredientTemplate() {
  const headers = REQUIRED_INGREDIENT_COLUMNS.concat(OPTIONAL_INGREDIENT_COLUMNS);
  const sampleRows = [
    headers.join(","),
    "chicken breast,101.CHI9,1.36,1kg,Example Supplier,Poultry,2026-03-23,ingredient,",
  ].join("\n");

  const blob = new Blob([sampleRows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ingredient_master_template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportIngredientMaster(ingredients) {
  const headers = REQUIRED_INGREDIENT_COLUMNS.concat(OPTIONAL_INGREDIENT_COLUMNS);
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = ingredients.map((ingredient) =>
    [
      ingredient.ingredient_name,
      ingredient.ingredient_item_code,
      numberValue(ingredient.unit_cost),
      ingredient.pack_size,
      ingredient.supplier,
      ingredient.category,
      ingredient.last_updated,
      ingredient.entry_type || "ingredient",
      ingredient.linked_recipe_id || "",
      ingredient.is_locked ? "true" : "false",
    ]
      .map(escapeCsv)
      .join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ingredient_master_reviewed.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatQuantityCell(value) {
  const numericValue = numberValue(value);
  if (!numericValue) return "0.000";
  return numericValue.toFixed(3);
}

function buildChefPrintSheetHtml(recipe) {
  const methodLines = getMethodSteps(recipe);
  const presentationLines = String(recipe.presentationNotes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const portionNote = getChefPortionNote(recipe);

  const componentsHtml = recipe.components
    .map(
      (component) => `
        <tr>
          <td>${escapeHtml(component.ingredient || "Missing ingredient")}</td>
          <td>${escapeHtml(component.code || "-")}</td>
          <td>${escapeHtml(component.qty || 0)}</td>
          <td>${escapeHtml(component.sourceYieldType || "g")}</td>
          <td>${escapeHtml(money(component.cost))}</td>
        </tr>
      `
    )
    .join("");

  const methodHtml = methodLines.length
    ? methodLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
    : "<li>Add method notes in the app before printing.</li>";
  const presentationHtml = presentationLines.length
    ? presentationLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
    : "<li>Add plating or presentation notes in the app before printing.</li>";

  const heroImageHtml = recipe.presentationImage
    ? `<div class="hero-image"><img src="${recipe.presentationImage}" alt="Completed dish" /></div>`
    : `<div class="hero-placeholder">Add a completed dish image in the app to include it here.</div>`;

  const priceBlock =
    recipe.recipeType === "batch"
      ? `<div class="stat"><span>Batch yield</span><strong>${escapeHtml(`${numberValue(recipe.batchYield)} ${getBatchYieldLabel(recipe)}`)}</strong></div>
         <div class="stat"><span>Cost per ${escapeHtml(getBatchYieldLabel(recipe))}</span><strong>${escapeHtml(money(getBatchUnitCost(recipe)))}</strong></div>`
      : `<div class="stat"><span>Sale price</span><strong>${escapeHtml(money(recipe.currentSalePrice))}</strong></div>
         <div class="stat"><span>Gross profit</span><strong>${escapeHtml(percent(recipe.gp))}</strong></div>`;

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(recipe.name)} chef sheet</title>
        <style>
          body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
          .page { max-width: 980px; margin: 0 auto; padding: 32px; }
          .header { display: flex; justify-content: space-between; gap: 24px; align-items: start; margin-bottom: 24px; }
          .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
          h1 { margin: 6px 0 10px; font-size: 34px; }
          .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
          .stat { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px; }
          .stat span { display: block; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
          .stat strong { font-size: 20px; }
          .layout { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; }
          .card { background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 20px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 14px; }
          th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
          th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
          ul { margin: 0; padding-left: 18px; line-height: 1.7; }
          .hero-image img { width: 100%; border-radius: 16px; display: block; object-fit: cover; }
          .hero-placeholder { min-height: 220px; border: 1px dashed #cbd5e1; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #64748b; text-align: center; padding: 18px; background: #f8fafc; }
          .tag { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #e2e8f0; font-size: 12px; font-weight: 700; margin-right: 8px; }
          @media print { body { background: white; } .page { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <div class="eyebrow">Peligoni chef sheet</div>
              <h1>${escapeHtml(recipe.name)}</h1>
              <div>
                <span class="tag">${escapeHtml(recipe.recipeType === "batch" ? "Batch recipe" : "Dish recipe")}</span>
                <span class="tag">${escapeHtml(getRecipeVenueLabel(recipe) || "No venue")}</span>
                <span class="tag">${escapeHtml(recipe.category || "No category")}</span>
              </div>
            </div>
            <div>
              <div class="eyebrow">Item code</div>
              <strong>${escapeHtml(recipe.sellingItemCode || "Missing")}</strong>
            </div>
          </div>

          <div class="meta">
            <div class="stat"><span>Recipe cost</span><strong>${escapeHtml(money(recipe.recipeCost))}</strong></div>
            ${priceBlock}
            <div class="stat"><span>Components</span><strong>${escapeHtml(recipe.components.length)}</strong></div>
          </div>

          <div class="layout">
            <div>
              <div class="card">
                <div class="eyebrow">Ingredients</div>
                <table>
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Code</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>${componentsHtml}</tbody>
                </table>
              </div>
              <div class="card">
                <div class="eyebrow">Method</div>
                ${portionNote ? `<p><strong>${escapeHtml(portionNote)}</strong></p>` : ""}
                <ul>${methodHtml}</ul>
              </div>
            </div>
            <div>
              <div class="card">
                <div class="eyebrow">Presentation</div>
                ${heroImageHtml}
              </div>
              <div class="card">
                <div class="eyebrow">Plating notes</div>
                <ul>${presentationHtml}</ul>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>`;
}

function buildRecipeCostSheetHtml(recipe, componentRows) {
  const recipeDescriptor = recipe.name || "";
  const itemCode = recipe.sellingItemCode || recipe.id || "";
  const componentRowsHtml = componentRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.ingredientCode || "")}</td>
          <td>${escapeHtml(row.description || "")}</td>
          <td>${escapeHtml(row.unitOfMeasure || "")}</td>
          <td class="numeric">${escapeHtml(row.unitPrice || "")}</td>
          <td class="numeric">${escapeHtml(row.quantityUsed || "")}</td>
          <td class="numeric">${escapeHtml(row.cost || "")}</td>
        </tr>
      `
    )
    .join("");

  const totalQuantity = formatQuantityCell(
    componentRows.reduce((sum, row) => sum + numberValue(row.rawQty), 0)
  );

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(recipe.name)} recipe cost</title>
        <style>
          body { margin: 0; background: #eef2f7; color: #111827; font-family: Arial, Helvetica, sans-serif; }
          .page { max-width: 1080px; margin: 0 auto; padding: 24px; }
          table { width: 100%; border-collapse: collapse; background: white; table-layout: fixed; }
          col.meta-image { width: 10%; }
          col.meta-label { width: 14%; }
          col.meta-value { width: 18%; }
          col.component-code { width: 20%; }
          col.component-desc { width: 30%; }
          col.component-unit { width: 12%; }
          col.component-price { width: 14%; }
          col.component-qty { width: 14%; }
          col.component-cost { width: 10%; }
          th, td { border: 1px solid #b8c1cc; padding: 7px 8px; font-size: 12px; vertical-align: middle; }
          .title-row th { background: #ececec; font-size: 16px; text-align: center; font-weight: 700; }
          .meta-label-cell { background: #f3f3f3; font-weight: 700; }
          .meta-value-cell { background: #fff; }
          .meta-image-cell { background: #fafafa; text-align: center; font-size: 11px; color: #64748b; }
          .header-row th { background: #f3f3f3; font-weight: 700; text-align: left; vertical-align: bottom; }
          .numeric { text-align: right; font-variant-numeric: tabular-nums; }
          .total-label { font-style: italic; font-weight: 700; background: #fafafa; }
          .total-number { font-style: italic; font-weight: 700; background: #fafafa; }
          .recipe-name-cell { font-weight: 700; }
          .muted { color: #475569; }
          @media print { body { background: white; } .page { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="page">
          <table>
            <colgroup>
              <col class="component-code" />
              <col class="component-desc" />
              <col class="component-unit" />
              <col class="component-price" />
              <col class="component-qty" />
              <col class="component-cost" />
            </colgroup>
            <tr class="title-row">
              <th colspan="6">Recipe cost</th>
            </tr>
            <tr>
              <td class="meta-label-cell">Recipe code</td>
              <td class="meta-value-cell">${escapeHtml(recipe.id || "")}</td>
              <td class="meta-label-cell">Descr.</td>
              <td class="meta-value-cell recipe-name-cell">${escapeHtml(recipeDescriptor)}</td>
              <td class="meta-label-cell">Item code</td>
              <td class="meta-value-cell">${escapeHtml(itemCode)}</td>
            </tr>
            <tr>
              <td class="meta-image-cell muted">${recipe.presentationImage ? "Image in chef sheet" : ""}</td>
              <td class="meta-value-cell">${escapeHtml(getRecipeVenueLabel(recipe) || "")}</td>
              <td class="meta-image-cell muted">Recipe cost</td>
              <td class="meta-value-cell">${escapeHtml(money(recipe.recipeCost))}</td>
              <td class="meta-image-cell muted">Roundup</td>
              <td class="meta-value-cell">${escapeHtml(recipe.recipeType === "batch" ? "-" : money(recipe.roundup))}</td>
            </tr>
            <tr class="header-row">
              <th>Ingr. Code</th>
              <th>Descr Code</th>
              <th>Unit of meas.</th>
              <th>Price per kilo</th>
              <th>Quantity used in the recipe</th>
              <th>Cost</th>
            </tr>
            ${componentRowsHtml}
            <tr>
              <td colspan="4" class="total-label">Total</td>
              <td class="numeric total-number">${escapeHtml(totalQuantity)}</td>
              <td class="numeric total-number">${escapeHtml(money(recipe.recipeCost))}</td>
            </tr>
          </table>
        </div>
      </body>
    </html>`;
}

function buildRecipeCostSheetCsv(recipe, componentRows) {
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = [
    ["Recipe code", recipe.id || "", "Descr.", recipe.name || "", "Item code", recipe.sellingItemCode || ""],
    ["Ingr. Code", "Descr Code", "Unit of meas.", "Price per kilo", "Quantity used in the recipe", "Cost"],
    ...componentRows.map((row) => [
      row.ingredientCode || "",
      row.description || "",
      row.unitOfMeasure || "",
      row.unitPrice || "",
      row.quantityUsed || "",
      row.cost || "",
    ]),
    [
      "Total",
      "",
      "",
      "",
      formatQuantityCell(componentRows.reduce((sum, row) => sum + numberValue(row.rawQty), 0)),
      money(recipe.recipeCost),
    ],
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function fromNormalizedImport({ Recipes = [], Recipe_Components = [] }) {
  const componentsByRecipeId = new Map();

  Recipe_Components.forEach((component) => {
    const recipeComponents = componentsByRecipeId.get(component.recipe_id) || [];
    recipeComponents.push({
      id: `${component.recipe_id}-${component.component_sort}`,
      sort: numberValue(component.component_sort),
      ingredient: component.ingredient_name || "",
      code: component.ingredient_item_code || "",
      qty: numberValue(component.quantity_by_weight_grams),
      cost: numberValue(component.component_cost),
      sourceType: "",
      sourceRecipeId: "",
      sourceUnitCost: 0,
      sourceYieldType: "",
    });
    componentsByRecipeId.set(component.recipe_id, recipeComponents);
  });

  return Recipes.map((recipe) => {
    const components = (componentsByRecipeId.get(recipe.recipe_id) || []).sort(
      (a, b) => a.sort - b.sort
    );
    const currentSalePrice = numberValue(recipe.current_sale_price);
    const roundup = numberValue(recipe.roundup);
    const recipeType = recipe.recipe_type === "batch" ? "batch" : "dish";
    const batchYieldType = recipe.batch_yield_type || "portion";

    return enrichRecipeMetrics({
      id: recipe.recipe_id,
      sourceRow: "",
      restaurant: recipe.restaurant || "",
      name: recipe.name || "",
      category: recipe.category || "",
      sellingItemCode: recipe.selling_item_code || "",
      currentSalePrice,
      roundup,
      netPriceSource: 0,
      grossPriceSource: 0,
      sourceCost: numberValue(recipe.source_cost),
      posYtd: 0,
      recipeComplete: String(recipe.recipe_complete ?? "0"),
      pricingComplete: String(recipe.pricing_complete ?? "0"),
      recipeType,
      portionCount:
        recipeType === "batch" ? 1 : numberValue(recipe.portion_count) || numberValue(recipe.batch_yield) || 1,
      batchYield: recipeType === "batch" ? numberValue(recipe.batch_yield) || 1 : 1,
      batchYieldType: recipeType === "batch" ? batchYieldType : "portion",
      method: recipe.method || "",
      methodSteps: String(recipe.method || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      presentationNotes: recipe.presentation_notes || recipe.service_note || "",
      presentationImage: "",
      workflowStage: "draft",
      isLocked: false,
      isLive: false,
      components,
    });
  });
}

function linkBatchReferences(recipes) {
  const batchById = new Map();
  const batchByCode = new Map();

  recipes.forEach((recipe) => {
    if (recipe.recipeType !== "batch") return;
    batchById.set(recipe.id, recipe);
    const codeKey = normalizeCodeKey(recipe.sellingItemCode || recipe.id);
    if (codeKey) batchByCode.set(codeKey, recipe);
  });

  return recipes.map((recipe) => {
    if (recipe.recipeType === "batch") return recipe;

    let changed = false;
    const components = recipe.components.map((component) => {
      const matchedBatch =
        (component.sourceRecipeId ? batchById.get(component.sourceRecipeId) : null) ||
        batchByCode.get(normalizeCodeKey(component.code));

      if (!matchedBatch || matchedBatch.id === recipe.id) {
        if (component.sourceType === "batch") {
          changed = true;
          return {
            ...component,
            sourceType: "",
            sourceRecipeId: "",
            sourceUnitCost: 0,
            sourceYieldType: "",
          };
        }
        return component;
      }

      const nextQty = getLinkedBatchComponentQty(recipe, matchedBatch, component.qty);
      const nextCost = calculateAutoComponentCost(
        nextQty,
        getBatchUnitCost(matchedBatch),
        matchedBatch.batchYieldType
      );

      const nextComponent = {
        ...component,
        ingredient: component.ingredient || matchedBatch.name,
        code: matchedBatch.sellingItemCode || matchedBatch.id,
        qty: nextQty,
        sourceType: "batch",
        sourceRecipeId: matchedBatch.id,
        sourceUnitCost: getBatchUnitCost(matchedBatch),
        sourceYieldType: matchedBatch.batchYieldType || "",
        cost: nextCost,
      };

      if (
        nextComponent.ingredient !== component.ingredient ||
        nextComponent.code !== component.code ||
        nextComponent.qty !== component.qty ||
        nextComponent.sourceType !== component.sourceType ||
        nextComponent.sourceRecipeId !== component.sourceRecipeId ||
        nextComponent.sourceUnitCost !== component.sourceUnitCost ||
        nextComponent.sourceYieldType !== component.sourceYieldType ||
        nextComponent.cost !== component.cost
      ) {
        changed = true;
      }

      return nextComponent;
    });

    return changed ? enrichRecipeMetrics({ ...recipe, components }) : recipe;
  });
}

function syncIngredientReferences(recipes, ingredientMaster) {
  const ingredientByCode = new Map();
  const ingredientByName = new Map();

  ingredientMaster.forEach((ingredient) => {
    const codeKey = normalizeCodeKey(ingredient.ingredient_item_code);
    const nameKey = normalizeMatchKey(ingredient.ingredient_name);
    if (codeKey) {
      ingredientByCode.set(
        codeKey,
        pickPreferredIngredientRecord(ingredientByCode.get(codeKey), ingredient)
      );
    }
    if (nameKey) {
      ingredientByName.set(
        nameKey,
        pickPreferredIngredientRecord(ingredientByName.get(nameKey), ingredient)
      );
    }
  });

  const recipesWithIngredientSync = recipes.map((recipe) => {
    let changed = false;
    const components = recipe.components.map((component) => {
      if (component.sourceType === "batch") {
        return component;
      }

      const matchedIngredient =
        findBestIngredientMatch(ingredientMaster, component.code, component.ingredient) ||
        ingredientByCode.get(normalizeCodeKey(component.code)) ||
        ingredientByName.get(normalizeMatchKey(component.ingredient)) ||
        null;

      if (!matchedIngredient) {
        if (component.sourceType === "ingredient-master") {
          changed = true;
          return {
            ...component,
            sourceType: "",
            sourceRecipeId: "",
            sourceUnitCost: 0,
            sourceYieldType: "",
          };
        }
        return component;
      }

      const ingredientSource = getIngredientPricingSource(matchedIngredient);
      const nextUnitCost = ingredientSource.sourceUnitCost;
      const nextCost = calculateAutoComponentCost(component.qty, nextUnitCost, ingredientSource.sourceYieldType);
      const nextComponent = {
        ...component,
        ingredient: component.ingredient || matchedIngredient.ingredient_name,
        code: matchedIngredient.ingredient_item_code || component.code,
        sourceType: "ingredient-master",
        sourceRecipeId: "",
        sourceUnitCost: nextUnitCost,
        sourceYieldType: ingredientSource.sourceYieldType,
        cost: nextCost,
      };

      if (
        nextComponent.ingredient !== component.ingredient ||
        nextComponent.code !== component.code ||
        nextComponent.sourceType !== component.sourceType ||
        nextComponent.sourceUnitCost !== component.sourceUnitCost ||
        nextComponent.sourceYieldType !== component.sourceYieldType ||
        nextComponent.cost !== component.cost
      ) {
        changed = true;
      }

      return nextComponent;
    });

    return changed ? enrichRecipeMetrics({ ...recipe, components }) : recipe;
  });

  return linkBatchReferences(recipesWithIngredientSync);
}

function mergeImportedRecipes(currentRecipes, importedRecipes, ingredientMaster = []) {
  const importedIds = new Set(importedRecipes.map((recipe) => recipe.id));
  const preserved = currentRecipes.filter((recipe) => !importedIds.has(recipe.id));
  return syncIngredientReferences(linkBatchReferences([...preserved, ...importedRecipes]), ingredientMaster);
}

function deriveComponentUnitCost(component) {
  const explicitSourceUnitCost = numberValue(component?.sourceUnitCost);
  if (explicitSourceUnitCost > 0) return explicitSourceUnitCost;

  const quantityInGrams = numberValue(component?.qty);
  const componentCost = numberValue(component?.cost);
  if (quantityInGrams > 0 && componentCost > 0) {
    return (componentCost / quantityInGrams) * 1000;
  }

  return 0;
}

function seedImportedIngredientRows(currentIngredientMaster, importedRecipes, deletedIngredientSignatures = new Set()) {
  const byCode = new Map();
  const byName = new Map();

  currentIngredientMaster.forEach((ingredient) => {
    const codeKey = normalizeCodeKey(ingredient.ingredient_item_code);
    const nameKey = normalizeMatchKey(ingredient.ingredient_name);
    if (codeKey) byCode.set(codeKey, ingredient);
    if (nameKey) byName.set(nameKey, ingredient);
  });

  const seededRows = [...currentIngredientMaster];
  let nextSeedIndex = 1;
  const makeSeedId = () => {
    const nextId = `imported-ingredient-${String(seededRows.length + nextSeedIndex).padStart(4, "0")}`;
    nextSeedIndex += 1;
    return nextId;
  };

  importedRecipes.forEach((recipe) => {
    if (recipe.recipeType === "batch") {
      const batchCodeKey = normalizeCodeKey(recipe.sellingItemCode || recipe.id);
      const batchNameKey = normalizeMatchKey(recipe.name);
      const batchSignature = getIngredientSignature({
        ingredient_name: recipe.name,
        ingredient_item_code: recipe.sellingItemCode || recipe.id,
      });
      if (!byCode.has(batchCodeKey) && !byName.has(batchNameKey) && !deletedIngredientSignatures.has(batchSignature)) {
        const row = {
          id: makeSeedId(),
          ingredient_name: recipe.name || recipe.id,
          ingredient_item_code: recipe.sellingItemCode || recipe.id,
          unit_cost: getBatchUnitCost(recipe),
          pack_size: `${numberValue(recipe.batchYield)} ${getBatchYieldLabel(recipe)}`.trim(),
          supplier: recipe.restaurant || "",
          category: recipe.category || "Batch",
          last_updated: getTodayDateString(),
          entry_type: "batch",
          linked_recipe_id: recipe.id,
          is_locked: false,
        };
        seededRows.push(row);
        if (batchCodeKey) byCode.set(batchCodeKey, row);
        if (batchNameKey) byName.set(batchNameKey, row);
      }
      return;
    }

    recipe.components.forEach((component) => {
      const codeKey = normalizeCodeKey(component.code);
      const nameKey = normalizeMatchKey(component.ingredient);
      const isBatchReference =
        component.sourceType === "batch" || codeKey.startsWith("BCH");
      const ingredientSignature = getIngredientSignature({
        ingredient_name: component.ingredient,
        ingredient_item_code: component.code,
      });

      if (isBatchReference) return;
      if (!component.ingredient?.trim() && !component.code?.trim()) return;
      if (deletedIngredientSignatures.has(ingredientSignature)) return;
      const matchedExistingIngredient =
        (codeKey && byCode.get(codeKey)) ||
        (nameKey && byName.get(nameKey)) ||
        null;
      const derivedUnitCost = deriveComponentUnitCost(component);

      if (matchedExistingIngredient) {
        if (numberValue(matchedExistingIngredient.unit_cost) <= 0 && derivedUnitCost > 0) {
          matchedExistingIngredient.unit_cost = derivedUnitCost;
        }
        return;
      }

      const row = {
        id: makeSeedId(),
        ingredient_name: component.ingredient || component.code || "Imported ingredient",
        ingredient_item_code: component.code || "",
        unit_cost: derivedUnitCost,
        pack_size: "",
        supplier: recipe.restaurant || "",
        category: recipe.category || "",
        last_updated: getTodayDateString(),
        entry_type: "ingredient",
        linked_recipe_id: "",
        is_locked: false,
      };
      seededRows.push(row);
      if (codeKey) byCode.set(codeKey, row);
      if (nameKey) byName.set(nameKey, row);
    });
  });

  return seededRows;
}

function hydrateStoredRecipes(storedRecipes) {
  return linkBatchReferences(
    storedRecipes.map((recipe) =>
      enrichRecipeMetrics({
        sourceRow: "",
        netPriceSource: 0,
        grossPriceSource: 0,
        sourceCost: 0,
        posYtd: 0,
        recipeComplete: "0",
        pricingComplete: "0",
        recipeType: "dish",
        portionCount: 1,
        batchYield: 1,
        batchYieldType: "portion",
        method: "",
        methodSteps: [],
        presentationNotes: "",
        presentationImage: "",
        workflowStage: "draft",
        isLocked: false,
        isLive: false,
        ...recipe,
        components: (recipe.components || []).map((component, index) => ({
          id: component.id || `${recipe.id}-${index + 1}`,
          sort: numberValue(component.sort) || index + 1,
          ingredient: component.ingredient || "",
          code: component.code || "",
          qty: numberValue(component.qty),
          cost: numberValue(component.cost),
          sourceType: component.sourceType || "",
          sourceRecipeId: component.sourceRecipeId || "",
          sourceUnitCost: numberValue(component.sourceUnitCost),
          sourceYieldType: component.sourceYieldType || "",
        })),
      })
    )
  );
}

function getBaselineRecipes() {
  const workbookRecipes = createRecipes().map((recipe) => enrichRecipeMetrics(recipe));
  const storedRecipes = loadStoredCollection(RECIPES_STORAGE_KEY);
  if (!storedRecipes.length) return workbookRecipes;

  const hydratedStoredRecipes = hydrateStoredRecipes(storedRecipes);
  const storedById = new Map(hydratedStoredRecipes.map((recipe) => [recipe.id, recipe]));
  return [
    ...hydratedStoredRecipes,
    ...workbookRecipes.filter((recipe) => !storedById.has(recipe.id)),
  ];
}

function getBaselineMenus(recipes) {
  const workbookMenus = createMenus(recipes);
  const storedMenus = loadStoredCollection(MENUS_STORAGE_KEY);
  if (!storedMenus.length) return workbookMenus;

  const storedById = new Map(storedMenus.map((menu) => [menu.id, menu]));
  return [
    ...storedMenus,
    ...workbookMenus.filter((menu) => !storedById.has(menu.id)),
  ];
}

function App() {
  const [recipes, setRecipes] = useState(() => {
    return getBaselineRecipes();
  });
  const [menus, setMenus] = useState(() => {
    return getBaselineMenus(getBaselineRecipes());
  });
  const [venues, setVenues] = useState(() => {
    const storedVenues = loadStoredCollection(VENUES_STORAGE_KEY)
      .map((venue) => String(venue || "").trim())
      .filter(Boolean);
    return Array.from(new Set([...DEFAULT_VENUES, ...storedVenues]));
  });
  const [dishIndexRows, setDishIndexRows] = useState(() => {
    const storedDishIndex = loadStoredCollection(DISH_INDEX_STORAGE_KEY);
    return Array.isArray(storedDishIndex)
      ? storedDishIndex.map((row) => ({
          id: row.id || row.entry_id || "",
          sourceTab: row.sourceTab || row.source_tab || "",
          venue: normalizeVenueName(row.venue, row.sourceTab || row.source_tab || ""),
          course: row.course || "",
          dishName: row.dishName || row.dish_name || "",
          oldFlag: row.oldFlag || row.old_flag || "",
          linkedRecipeId: row.linkedRecipeId || row.linked_recipe_id || "",
          reviewState: row.reviewState || row.review_state || "",
          isArchived: Boolean(row.isArchived || row.is_archived),
        }))
      : [];
  });
  const [bchAuditDecisions, setBchAuditDecisions] = useState(() => {
    const stored = loadStoredCollection(BCH_AUDIT_STORAGE_KEY);
    return Array.isArray(stored) ? stored : [];
  });
  const [deletedIngredientSignatures, setDeletedIngredientSignatures] = useState(() => {
    const stored = loadStoredCollection(DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY);
    return Array.isArray(stored) ? stored.filter(Boolean) : [];
  });
  const [activeTab, setActiveTab] = useState("queue");
  const [search, setSearch] = useState("");
  const [restaurant, setRestaurant] = useState("all");
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipes[0]?.id || null);
  const [ingredientMaster, setIngredientMaster] = useState(() => loadIngredientMaster());
  const [ingredientUploadMessage, setIngredientUploadMessage] = useState("");
  const [ingredientUploadError, setIngredientUploadError] = useState("");
  const [ingredientReturnTarget, setIngredientReturnTarget] = useState(null);
  const [activeLookup, setActiveLookup] = useState(null);
  const [activeDraftLookupId, setActiveDraftLookupId] = useState(null);
  const [ingredientTypeFilter, setIngredientTypeFilter] = useState("all");
  const [ingredientBatchLinkFilter, setIngredientBatchLinkFilter] = useState("all");
  const [ingredientColumnFilter, setIngredientColumnFilter] = useState("all-columns");
  const [ingredientSortColumn, setIngredientSortColumn] = useState("ingredient");
  const [ingredientSortDirection, setIngredientSortDirection] = useState("asc");
  const [recipeSortColumn, setRecipeSortColumn] = useState("dish");
  const [recipeSortDirection, setRecipeSortDirection] = useState("asc");
  const [activeIngredientDraftId, setActiveIngredientDraftId] = useState(null);
  const [ingredientEditLookup, setIngredientEditLookup] = useState("");
  const [ingredientEditLookupQuery, setIngredientEditLookupQuery] = useState("");
  const [ingredientEditLookupOpen, setIngredientEditLookupOpen] = useState(false);
  const [selectedImportFormat, setSelectedImportFormat] = useState("flat-component-export");
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [googleSheetsUrls, setGoogleSheetsUrls] = useState({
    recipes_flat: "",
    recipes: "",
    recipe_components: "",
  });
  const [selectedMenuId, setSelectedMenuId] = useState(
    () => createMenus(createRecipes().map((recipe) => enrichRecipeMetrics(recipe)))[0]?.id || null
  );
  const [reviewFilter, setReviewFilter] = useState("all");
  const [recipeListTypeFilter, setRecipeListTypeFilter] = useState("all");
  const [builderMode, setBuilderMode] = useState("create");
  const [builderRecipeFilter, setBuilderRecipeFilter] = useState("all");
  const [builderBringBatchesForward, setBuilderBringBatchesForward] = useState(false);
  const [recipeEditLookup, setRecipeEditLookup] = useState("");
  const [recipeLookupQuery, setRecipeLookupQuery] = useState("");
  const [exportPreview, setExportPreview] = useState(null);
  const [quickPanel, setQuickPanel] = useState(null);
  const [newRecipeDraft, setNewRecipeDraft] = useState(() =>
    createRecipeDraft(recipes[0]?.restaurant || "Tasi")
  );
  const [newVenueName, setNewVenueName] = useState("");
  const [backendStatus, setBackendStatus] = useState(
    supabaseEnabled ? "Supabase connected (setup mode)" : "Local mode only"
  );
  const [authSession, setAuthSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authProfile, setAuthProfile] = useState(null);
  const [userProfiles, setUserProfiles] = useState([]);
  const [authLoading, setAuthLoading] = useState(supabaseEnabled);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [userAdminMessage, setUserAdminMessage] = useState("");
  const [userAdminError, setUserAdminError] = useState("");
  const [dishIndexStatusFilter, setDishIndexStatusFilter] = useState("all");
  const [dishIndexSearch, setDishIndexSearch] = useState("");
  const [activeDishIndexLookupId, setActiveDishIndexLookupId] = useState(null);
  const [dishIndexLookupQuery, setDishIndexLookupQuery] = useState("");
  const [showArchivedDishIndexRows, setShowArchivedDishIndexRows] = useState(false);
  const [pageHistory, setPageHistory] = useState([]);
  const exportPreviewFrameRef = useRef(null);
  const previousActiveTabRef = useRef("recipes");
  const ingredientNavigationTargetRef = useRef(null);
  const previousIngredientsTabOpenRef = useRef(false);
  const currentUserRole =
    authProfile?.role
    || (String(authUser?.email || "").trim().toLowerCase() === "ben@peligoni.com" ? "manager" : "viewer");
  const canEditSharedData = !supabaseEnabled || !authUser || ["manager", "editor"].includes(currentUserRole);

  useEffect(() => {
    window.localStorage.setItem(INGREDIENT_MASTER_STORAGE_KEY, JSON.stringify(ingredientMaster));
  }, [ingredientMaster]);

  useEffect(() => {
    window.localStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(recipes));
  }, [recipes]);

  useEffect(() => {
    window.localStorage.setItem(MENUS_STORAGE_KEY, JSON.stringify(menus));
  }, [menus]);

  useEffect(() => {
    window.localStorage.setItem(VENUES_STORAGE_KEY, JSON.stringify(venues));
  }, [venues]);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let isCancelled = false;
    const loadingTimeout = window.setTimeout(() => {
      if (isCancelled) return;
      setAuthLoading(false);
      setAuthError("Session check took too long. Please try signing in again.");
    }, 5000);

    const loadProfile = async (user) => {
      if (!user) {
        if (!isCancelled) {
          setAuthProfile(null);
        }
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (isCancelled) return;

      if (error) {
        setAuthProfile({
          id: user.id,
          email: user.email || "",
          full_name: "",
          role: "viewer",
          profileError: error.message,
        });
        return;
      }

      if (!data && user.email) {
        const { data: emailData, error: emailError } = await supabase
          .from("profiles")
          .select("id, email, full_name, role")
          .eq("email", user.email)
          .maybeSingle();

        if (isCancelled) return;

        if (emailError) {
          setAuthProfile({
            id: user.id,
            email: user.email || "",
            full_name: "",
            role: "viewer",
            profileError: emailError.message,
          });
          return;
        }

        if (emailData) {
          setAuthProfile(emailData);
          return;
        }
      }

      setAuthProfile(
        data || {
          id: user.id,
          email: user.email || "",
          full_name: "",
          role: "viewer",
          profileError: "No matching profile row was found for this signed-in user.",
        }
      );
    };

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          setAuthError(error.message || "Could not check the current session.");
          setAuthLoading(false);
          return;
        }
        setAuthSession(data.session || null);
        setAuthUser(data.session?.user || null);
        await loadProfile(data.session?.user || null);
        if (!isCancelled) setAuthLoading(false);
      })
      .catch((error) => {
        if (isCancelled) return;
        setAuthError(error?.message || "Could not check the current session.");
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (isCancelled) return;
      setAuthSession(session || null);
      setAuthUser(session?.user || null);
      setAuthError("");
      await loadProfile(session?.user || null);
      if (!isCancelled) setAuthLoading(false);
    });

    return () => {
      isCancelled = true;
      window.clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateSharedData() {
      if (!supabaseEnabled || !supabase) return;
      if (authLoading || !authUser) return;

      try {
        const [
          { data: venueRows, error: venueError },
          { data: ingredientRows, error: ingredientError },
          { data: recipeRows, error: recipeError },
          { data: componentRows, error: componentError },
          { data: menuRows, error: menuError },
          { data: menuLineRows, error: menuLineError },
          { data: dishIndexRowsShared, error: dishIndexError },
          { data: bchAuditRowsShared, error: bchAuditError },
        ] =
          await Promise.all([
            supabase.from("venues").select("name").order("name"),
            supabase.from("ingredients").select("*").order("ingredient_name"),
            supabase.from("recipes").select("*").order("name"),
            supabase.from("recipe_components").select("*").order("component_order"),
            supabase.from("menus").select("*").order("name"),
            supabase.from("menu_lines").select("*").order("line_order"),
            supabase.from("dish_index").select("*").order("dish_name"),
            supabase.from("bch_audit").select("*").order("code"),
          ]);

        if (venueError) throw venueError;
        if (ingredientError) throw ingredientError;
        if (recipeError) throw recipeError;
        if (componentError) throw componentError;
        if (menuError) throw menuError;
        if (menuLineError) throw menuLineError;
        if (dishIndexError) throw dishIndexError;
        if (bchAuditError) throw bchAuditError;
        if (isCancelled) return;

        if (Array.isArray(venueRows) && venueRows.length) {
          setVenues(Array.from(new Set([...DEFAULT_VENUES, ...venueRows.map((row) => String(row.name || "").trim()).filter(Boolean)])));
        }

        const mappedIngredients = Array.isArray(ingredientRows) && ingredientRows.length
          ? sanitizeIngredientMasterRows(ingredientRows.map(mapSupabaseIngredientRow))
          : null;
        const baselineRecipes = getBaselineRecipes();
        const baselineMenus = getBaselineMenus(baselineRecipes);

        if (Array.isArray(ingredientRows) && ingredientRows.length) {
          setIngredientMaster(mappedIngredients);
          setRecipes((current) => syncIngredientReferences(current, mappedIngredients));
        }

        if (Array.isArray(recipeRows) && recipeRows.length) {
          const sharedRecipes = hydrateSupabaseRecipes(
            recipeRows,
            componentRows || [],
            mappedIngredients || ingredientMaster
          );
          const nextRecipes = mergeSupabaseRecipesIntoCurrent(
            baselineRecipes,
            sharedRecipes,
            mappedIngredients || ingredientMaster
          );
          setRecipes(nextRecipes);
          setSelectedRecipeId((current) => current || nextRecipes[0]?.id || null);
          if (Array.isArray(menuRows) && menuRows.length) {
            const sharedMenus = hydrateSupabaseMenus(menuRows, menuLineRows || [], nextRecipes);
            const nextMenus = mergeSupabaseMenusIntoCurrent(baselineMenus, sharedMenus, nextRecipes);
            setMenus(nextMenus);
            setSelectedMenuId((current) => current || nextMenus[0]?.id || null);
          }
        } else if (Array.isArray(menuRows) && menuRows.length) {
          const sharedMenus = hydrateSupabaseMenus(menuRows, menuLineRows || [], baselineRecipes);
          const nextMenus = mergeSupabaseMenusIntoCurrent(baselineMenus, sharedMenus, baselineRecipes);
          setMenus(nextMenus);
          setSelectedMenuId((current) => current || nextMenus[0]?.id || null);
        }

        if (Array.isArray(dishIndexRowsShared) && dishIndexRowsShared.length) {
          const nextDishIndexRows = mergeSupabaseDishIndexRowsIntoCurrent(
            dishIndexRows,
            dishIndexRowsShared.map(mapSupabaseDishIndexRow)
          );
          setDishIndexRows(nextDishIndexRows);
        }

        if (Array.isArray(bchAuditRowsShared) && bchAuditRowsShared.length) {
          const nextBchAuditDecisions = mergeSupabaseBchAuditIntoCurrent(
            bchAuditDecisions,
            bchAuditRowsShared.map(mapSupabaseBchAuditDecision)
          );
          setBchAuditDecisions(nextBchAuditDecisions);
        }

        setBackendStatus("Supabase connected");
      } catch (error) {
        if (isCancelled) return;
        setBackendStatus("Supabase connected, but shared data could not be loaded yet");
      }
    }

    hydrateSharedData();

    return () => {
      isCancelled = true;
    };
  }, [authLoading, authUser]);

  useEffect(() => {
    if (!supabaseEnabled || !supabase || !authUser || currentUserRole !== "manager") {
      if (currentUserRole !== "manager") {
        setUserProfiles([]);
      }
      return;
    }

    if (activeTab !== "users") return;

    let isCancelled = false;

    loadUserProfiles().catch((error) => {
      if (isCancelled) return;
      setUserAdminError(`Could not load users: ${error.message}`);
    });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, authUser, currentUserRole]);

  useEffect(() => {
    window.localStorage.setItem(DISH_INDEX_STORAGE_KEY, JSON.stringify(dishIndexRows));
  }, [dishIndexRows]);

  useEffect(() => {
    window.localStorage.setItem(BCH_AUDIT_STORAGE_KEY, JSON.stringify(bchAuditDecisions));
  }, [bchAuditDecisions]);

  const requireEditAccess = () => {
    if (canEditSharedData) return false;
    setImportError("Your account is in viewer mode. You can review data, but only editors and managers can make changes.");
    return true;
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!supabaseEnabled || !supabase) return;

    setAuthError("");
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });

    if (error) {
      setAuthError(error.message || "Could not sign in.");
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabaseEnabled || !supabase) return;
    await supabase.auth.signOut();
    setAuthProfile(null);
    setAuthSession(null);
    setAuthUser(null);
  };

  const loadUserProfiles = async () => {
    if (!supabaseEnabled || !supabase || !authUser || currentUserRole !== "manager") return;
    const accessToken = authSession?.access_token;
    if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
      setUserAdminError("Could not verify the signed-in session for loading users. Please sign out and back in.");
      return;
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=id,email,full_name,role,created_at&order=email.asc`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setUserAdminError(`Could not load users: ${payload?.message || payload?.error || `Request failed with ${response.status}`}`);
      return;
    }

    const rows = Array.isArray(payload) ? payload : [];
    setUserProfiles(rows);
    setUserAdminError("");
    setUserAdminMessage(`Loaded ${rows.length} user${rows.length === 1 ? "" : "s"}.`);
  };

  const updateUserRole = async (profileId, role) => {
    if (!supabaseEnabled || !supabase || currentUserRole !== "manager") return;

    setUserAdminError("");
    setUserAdminMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", profileId);

    if (error) {
      setUserAdminError(`Could not update user role: ${error.message}`);
      return;
    }

    await loadUserProfiles();

    if (authProfile?.id === profileId) {
      setAuthProfile((current) => (current ? { ...current, role } : current));
    }

    setUserAdminMessage("Updated user role.");
    setBackendStatus("Supabase connected");
  };

  const handleRefreshUsersButton = () => {
    setUserAdminError("");
    setUserAdminMessage("");
    void loadUserProfiles().catch((error) => {
      setUserAdminError(`Could not load users: ${error.message}`);
    });
  };

  useEffect(() => {
    setIngredientMaster((current) => {
      const sanitized = sanitizeIngredientMasterRows(current);
      if (sanitized.length !== current.length) {
        return sanitized;
      }
      const hasChanged = sanitized.some((ingredient, index) => {
        const currentIngredient = current[index];
        return (
          ingredient !== currentIngredient &&
          JSON.stringify(ingredient) !== JSON.stringify(currentIngredient)
        );
      });
      return hasChanged ? sanitized : current;
    });
  }, []);

  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    if (previousTab !== activeTab) {
      setPageHistory((current) => {
        if (current[current.length - 1] === previousTab) {
          return current;
        }
        return [...current, previousTab].slice(-25);
      });
      previousActiveTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    window.localStorage.setItem(
      DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY,
      JSON.stringify(deletedIngredientSignatures)
    );
  }, [deletedIngredientSignatures]);

  useEffect(() => {
    const deletedSet = new Set(deletedIngredientSignatures);
    setIngredientMaster((current) => {
      const seeded = seedImportedIngredientRows(current, recipes, deletedSet);
      return seeded.length === current.length ? current : seeded;
    });
  }, [deletedIngredientSignatures, recipes]);

  useEffect(() => {
    setRecipes((current) => syncIngredientReferences(current, ingredientMaster));
  }, [ingredientMaster]);

  useEffect(() => {
    if (!exportPreview?.autoPrint) return;
    const frame = exportPreviewFrameRef.current;
    if (!frame) return;

    const printFrame = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };

    frame.addEventListener("load", printFrame, { once: true });
    return () => frame.removeEventListener("load", printFrame);
  }, [exportPreview]);

  useEffect(() => {
    if (!exportPreview) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [exportPreview]);

  const restaurants = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set([...venues, ...recipes.map((recipe) => getRecipeVenueKey(recipe)).filter(Boolean)])
      ),
    ],
    [recipes, venues]
  );
  const venueOptions = useMemo(() => {
    const derivedOptions = getVenueServiceOptions(
      venues.filter((item) => item !== "Batch" && item !== "Blank")
    );
    return Array.from(new Set([...menus.map((menu) => menu.restaurant).filter(Boolean), ...derivedOptions]));
  }, [menus, venues]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((recipe) => {
      const matchesRestaurant = restaurant === "all" || getRecipeVenueKey(recipe) === restaurant;
      const matchesReview =
        reviewFilter === "all" ||
        (reviewFilter === "needs-review" && recipe.validation.reviewStatus === "needs-review") ||
        (reviewFilter === "warning" && recipe.validation.reviewStatus === "warning") ||
        (reviewFilter === "ready" && recipe.validation.reviewStatus === "ready") ||
        (reviewFilter === "live" && recipe.isLive);
      const matchesSearch =
        q.length === 0 ||
        recipe.name.toLowerCase().includes(q) ||
        recipe.category.toLowerCase().includes(q) ||
        recipe.sellingItemCode.toLowerCase().includes(q) ||
        recipe.components.some((component) => component.ingredient.toLowerCase().includes(q));
      return matchesRestaurant && matchesSearch && matchesReview;
    });
  }, [recipes, restaurant, reviewFilter, search]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedRecipeId) || filteredRecipes[0] || null,
    [filteredRecipes, recipes, selectedRecipeId]
  );
  const builderRecipes = useMemo(() => {
    const scopedRecipes = recipes.filter((recipe) => {
      if (builderRecipeFilter === "batch") return recipe.recipeType === "batch";
      if (builderRecipeFilter === "dish") return recipe.recipeType !== "batch";
      return true;
    });

    const sorted = [...scopedRecipes].sort((left, right) => {
      if (builderBringBatchesForward && left.recipeType !== right.recipeType) {
        return left.recipeType === "batch" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    if (selectedRecipeId && !sorted.some((recipe) => recipe.id === selectedRecipeId)) {
      const selected = recipes.find((recipe) => recipe.id === selectedRecipeId);
      if (selected) return [selected, ...sorted];
    }

    return sorted;
  }, [builderBringBatchesForward, builderRecipeFilter, recipes, selectedRecipeId]);
  const recipeEditOptions = useMemo(() => {
    const sortedRecipes = [...recipes].sort((left, right) => {
      if (builderBringBatchesForward && left.recipeType !== right.recipeType) {
        return left.recipeType === "batch" ? -1 : 1;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    return sortedRecipes.map((recipe) => ({
      id: recipe.id,
      recipeType: recipe.recipeType,
      label: `${recipe.name || "Untitled recipe"}${recipe.sellingItemCode ? ` (${recipe.sellingItemCode})` : ""}${
        recipe.recipeType === "batch" ? " · Batch" : ""
      }`,
      searchText: [
        recipe.name || "",
        recipe.sellingItemCode || "",
        recipe.category || "",
        getRecipeVenueLabel(recipe),
        recipe.recipeType === "batch" ? "batch" : "dish",
      ]
        .join(" ")
        .toLowerCase(),
    }));
  }, [builderBringBatchesForward, recipes]);
  const filteredRecipeEditOptions = useMemo(() => {
    const query = recipeLookupQuery.trim().toLowerCase();
    return recipeEditOptions
      .filter((option) => {
        if (builderRecipeFilter === "batch") return option.recipeType === "batch";
        if (builderRecipeFilter === "dish") return option.recipeType !== "batch";
        return true;
      })
      .filter((option) => !query || option.searchText.includes(query))
      .slice(0, 12);
  }, [builderRecipeFilter, recipeEditOptions, recipeLookupQuery]);
  const dishIndexRowsWithMatches = useMemo(
    () =>
      dishIndexRows.map((row) => ({
        ...row,
        venue: normalizeVenueName(row.venue, row.sourceTab),
        match: getDishIndexMatch(row, recipes),
      })),
    [dishIndexRows, recipes]
  );
  const filteredDishIndexRows = useMemo(() => {
    const query = normalizeMatchKey(dishIndexSearch);
    return dishIndexRowsWithMatches.filter((row) => {
      const matchesArchive = showArchivedDishIndexRows ? row.isArchived : !row.isArchived;
      const matchesStatus = dishIndexStatusFilter === "all" || row.match.status === dishIndexStatusFilter;
      const matchesSearch =
        !query ||
        normalizeMatchKey(
          [row.venue, row.sourceTab, row.course, row.dishName, row.match.recipe?.name || ""].join(" ")
        ).includes(query);
      return matchesArchive && matchesStatus && matchesSearch;
    });
  }, [dishIndexRowsWithMatches, dishIndexSearch, dishIndexStatusFilter, showArchivedDishIndexRows]);
  const dishIndexSummary = useMemo(
    () => {
      const visibleRows = dishIndexRowsWithMatches.filter((row) =>
        showArchivedDishIndexRows ? row.isArchived : !row.isArchived
      );
      return {
        total: visibleRows.length,
        matched: visibleRows.filter((row) => row.match.status === "matched").length,
        possible: visibleRows.filter((row) => row.match.status === "possible").length,
        missing: visibleRows.filter((row) => row.match.status === "missing").length,
      };
    },
    [dishIndexRowsWithMatches, showArchivedDishIndexRows]
  );
  const dishIndexLookupOptions = useMemo(() => {
    const query = dishIndexLookupQuery.trim().toLowerCase();
    return [...recipes]
      .sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .filter((recipe) => {
        if (!query) return true;
        const searchText = [
          recipe.name || "",
          recipe.sellingItemCode || "",
          recipe.category || "",
          getRecipeVenueLabel(recipe),
          recipe.recipeType === "batch" ? "batch" : "dish",
        ]
          .join(" ")
          .toLowerCase();
        return searchText.includes(query);
      })
      .slice(0, 10);
  }, [dishIndexLookupQuery, recipes]);

  const selectedRecipeComponentCount = selectedRecipe ? selectedRecipe.components.length : 0;
  const selectedRecipeResolved = selectedRecipe?.validation.reviewStatus === "ready";
  const selectedRecipeLocked = Boolean(selectedRecipe?.isLocked);

  const summary = useMemo(() => {
    const recipeCount = filteredRecipes.length;
    const totalCost = filteredRecipes.reduce((sum, recipe) => sum + recipe.recipeCost, 0);
    const totalSales = filteredRecipes.reduce((sum, recipe) => sum + numberValue(recipe.currentSalePrice), 0);
    const avgGp = recipeCount ? filteredRecipes.reduce((sum, recipe) => sum + recipe.gp, 0) / recipeCount : 0;
    return { recipeCount, totalCost, totalSales, avgGp };
  }, [filteredRecipes]);

  const venueSummary = useMemo(() => {
    const grouped = new Map();
    recipes.forEach((recipe) => {
      const venueKey = getRecipeVenueKey(recipe);
      if (!grouped.has(venueKey)) {
        grouped.set(venueKey, {
          restaurant: venueKey,
          dishes: 0,
          recipeCost: 0,
          saleValue: 0,
        });
      }
      const item = grouped.get(venueKey);
      item.dishes += 1;
      item.recipeCost += recipe.recipeCost;
      item.saleValue += numberValue(recipe.currentSalePrice);
    });
    return Array.from(grouped.values()).map((item) => ({
      ...item,
      gp: item.saleValue > 0 ? (item.saleValue - item.recipeCost) / item.saleValue : 0,
    }));
  }, [recipes]);

  const menuCards = useMemo(
    () =>
      menus
        .map((menu) => calculateMenuCard(menu, recipes))
        .filter((menu) => restaurant === "all" || getBaseVenueName(menu.restaurant) === restaurant),
    [menus, recipes, restaurant]
  );
  const selectedMenu =
    menuCards.find((menu) => menu.id === selectedMenuId) || menuCards[0] || null;
  const restaurantLiveRecipeIds = useMemo(() => getRestaurantLiveRecipeIds(menuCards), [menuCards]);
  const recipeListRows = useMemo(
    () =>
      filteredRecipes
        .filter((recipe) => {
          if (recipeListTypeFilter === "batch") return recipe.recipeType === "batch";
          if (recipeListTypeFilter === "dish") return recipe.recipeType !== "batch";
          return true;
        })
        .sort((leftRecipe, rightRecipe) => {
          const leftPinned =
            leftRecipe.workflowStage === "draft" || String(leftRecipe.recipeComplete || "0") !== "1";
          const rightPinned =
            rightRecipe.workflowStage === "draft" || String(rightRecipe.recipeComplete || "0") !== "1";
          if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

          const leftValue = getRecipeSortValue(leftRecipe, recipeSortColumn, restaurantLiveRecipeIds);
          const rightValue = getRecipeSortValue(rightRecipe, recipeSortColumn, restaurantLiveRecipeIds);
          let comparison = 0;

          if (typeof leftValue === "number" && typeof rightValue === "number") {
            comparison = leftValue - rightValue;
          } else {
            comparison = String(leftValue || "").localeCompare(String(rightValue || ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }

          if (comparison === 0) {
            comparison = String(leftRecipe.name || "").localeCompare(String(rightRecipe.name || ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }

          return recipeSortDirection === "asc" ? comparison : comparison * -1;
        }),
    [filteredRecipes, recipeListTypeFilter, recipeSortColumn, recipeSortDirection, restaurantLiveRecipeIds]
  );
  const reviewCounts = useMemo(
    () => ({
      needsReview: recipes.filter((recipe) => recipe.validation.reviewStatus === "needs-review").length,
      warnings: recipes.filter((recipe) => recipe.validation.reviewStatus === "warning").length,
      live: recipes.filter((recipe) => recipe.recipeType !== "batch" && recipe.isLive).length,
    }),
    [recipes]
  );
  const batchUsage = useMemo(() => {
    if (!selectedRecipe || selectedRecipe.recipeType !== "batch") return [];

    return recipes
      .filter((recipe) => recipe.id !== selectedRecipe.id)
      .map((recipe) => {
        const matchedComponents = recipe.components.filter(
          (component) =>
            component.sourceType === "batch" && component.sourceRecipeId === selectedRecipe.id
        );

        if (!matchedComponents.length) return null;

        const liveMenusUsingRecipe = menuCards.filter(
          (menu) =>
            menu.isLiveMenu && menu.lines.some((line) => line.recipeId === recipe.id)
        );

        return {
          recipeId: recipe.id,
          recipeName: recipe.name,
          restaurant: recipe.restaurant,
          isLive: recipe.isLive,
          liveMenusUsingRecipe,
          matchedComponents,
        };
      })
      .filter(Boolean);
  }, [menuCards, recipes, selectedRecipe]);
  const batchImpact = useMemo(() => {
    const liveRecipeCount = batchUsage.filter((usage) => usage.isLive).length;
    const liveMenuCount = batchUsage.reduce(
      (sum, usage) => sum + usage.liveMenusUsingRecipe.length,
      0
    );

    return {
      linkedRecipeCount: batchUsage.length,
      liveRecipeCount,
      liveMenuCount,
      severity:
        liveMenuCount > 0
          ? "high"
          : liveRecipeCount > 0
            ? "medium"
            : batchUsage.length > 0
              ? "low"
              : "none",
    };
  }, [batchUsage]);
  const ingredientCatalog = useMemo(() => {
    const codeCounts = new Map();
    const nameCounts = new Map();
    const batchRecipeByCode = new Map();
    const batchRecipeByName = new Map();
    const anyRecipeByCode = new Map();
    const anyRecipeByName = new Map();
    const batchRecipes = recipes.filter((recipe) => recipe.recipeType === "batch");

    ingredientMaster.forEach((ingredient) => {
      const code = normalizeCodeKey(ingredient.ingredient_item_code);
      const name = ingredient.ingredient_name?.trim().toLowerCase();
      if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });

    recipes.forEach((recipe) => {
      const code = normalizeCodeKey(recipe.sellingItemCode || recipe.id);
      const nameKey = normalizeMatchKey(recipe.name);

      if (code) anyRecipeByCode.set(code, recipe);
      if (nameKey) anyRecipeByName.set(nameKey, recipe);

      if (recipe.recipeType === "batch") {
        if (code) batchRecipeByCode.set(code, recipe);
        if (nameKey) batchRecipeByName.set(nameKey, recipe);
      }
    });

    const duplicates = {
      code: new Set(Array.from(codeCounts.entries()).filter(([, count]) => count > 1).map(([code]) => code)),
      name: new Set(Array.from(nameCounts.entries()).filter(([, count]) => count > 1).map(([name]) => name)),
    };

    return ingredientMaster
      .map((ingredient) => {
        const code = normalizeCodeKey(ingredient.ingredient_item_code);
        const nameKey = normalizeMatchKey(ingredient.ingredient_name);
        const linkedBatchRecipe = ingredient.linked_recipe_id
          ? batchRecipes.find((recipe) => recipe.id === ingredient.linked_recipe_id) || null
          : null;
        const matchedBatchRecipe =
          linkedBatchRecipe ||
          (code ? batchRecipeByCode.get(code) : null) ||
          (nameKey ? batchRecipeByName.get(nameKey) : null) ||
          null;
        const matchedAnyRecipe =
          (code ? anyRecipeByCode.get(code) : null) || (nameKey ? anyRecipeByName.get(nameKey) : null) || null;
        const batchLink =
          ingredient.entry_type === "batch"
            ? matchedBatchRecipe
              ? {
                  status:
                    matchedBatchRecipe.validation.reviewStatus === "ready"
                      ? "ready"
                      : "needs-review",
                  recipeId: matchedBatchRecipe.id,
                  recipeName: matchedBatchRecipe.name,
                  recipeReviewStatus: matchedBatchRecipe.validation.reviewStatus,
                }
              : matchedAnyRecipe
                ? {
                    status: "wrong-type",
                    recipeId: matchedAnyRecipe.id,
                    recipeName: matchedAnyRecipe.name,
                    recipeReviewStatus: matchedAnyRecipe.validation.reviewStatus,
                  }
                : {
                    status: "missing",
                    recipeId: "",
                    recipeName: "",
                    recipeReviewStatus: "",
                  }
            : {
                status: "not-applicable",
                recipeId: "",
                recipeName: "",
                recipeReviewStatus: "",
              };
        const validation = validateIngredient(ingredient, duplicates, batchLink);
        const usageCount = recipes.reduce(
          (sum, recipe) =>
            sum +
            recipe.components.filter(
              (component) =>
                component.code?.trim() &&
                component.code.trim() === ingredient.ingredient_item_code?.trim()
            ).length,
          0
        );

        return {
          ...ingredient,
          entry_type: ingredient.entry_type || "ingredient",
          is_locked: normalizeBooleanFlag(ingredient.is_locked),
          batchLink,
          validation,
          usageCount,
        };
      })
      .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name));
  }, [ingredientMaster, recipes]);
  const ingredientSummary = useMemo(
    () => ({
      total: ingredientCatalog.length,
      needsReview: ingredientCatalog.filter((ingredient) => ingredient.validation.reviewStatus === "needs-review").length,
      ready: ingredientCatalog.filter((ingredient) => ingredient.validation.reviewStatus === "ready").length,
      used: ingredientCatalog.filter((ingredient) => ingredient.usageCount > 0).length,
      batchRows: ingredientCatalog.filter((ingredient) => (ingredient.entry_type || "ingredient") === "batch").length,
      linkedBatchRows: ingredientCatalog.filter(
        (ingredient) =>
          (ingredient.entry_type || "ingredient") === "batch" &&
          ["ready", "needs-review"].includes(ingredient.batchLink?.status)
      ).length,
      unlinkedBatchRows: ingredientCatalog.filter(
        (ingredient) =>
          (ingredient.entry_type || "ingredient") === "batch" &&
          ["missing", "wrong-type"].includes(ingredient.batchLink?.status)
      ).length,
    }),
    [ingredientCatalog]
  );
  const batchCatalog = useMemo(
    () =>
      recipes
        .filter((recipe) => recipe.recipeType === "batch")
        .map((recipe) => {
          const linkedRecipes = recipes.filter(
            (candidate) =>
              candidate.id !== recipe.id &&
              candidate.components.some(
                (component) =>
                  component.sourceType === "batch" && component.sourceRecipeId === recipe.id
              )
          );
          const liveMenuCount = menuCards.filter(
            (menu) =>
              menu.isLiveMenu && menu.lines.some((line) => linkedRecipes.some((recipeItem) => recipeItem.id === line.recipeId))
          ).length;

          return {
            ...recipe,
            batchIdentifier: recipe.sellingItemCode || recipe.id,
            linkedRecipeCount: linkedRecipes.length,
            liveRecipeCount: linkedRecipes.filter((item) => item.isLive).length,
            liveMenuCount,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [menuCards, recipes]
  );
  const batchSummary = useMemo(
    () => ({
      total: batchCatalog.length,
      needsReview: batchCatalog.filter((batch) => batch.validation.reviewStatus === "needs-review").length,
      ready: batchCatalog.filter((batch) => batch.validation.reviewStatus === "ready").length,
      linked: batchCatalog.filter((batch) => batch.linkedRecipeCount > 0).length,
    }),
    [batchCatalog]
  );
  const bchAuditRows = useMemo(() => {
    const grouped = new Map();

    recipes.forEach((recipe) => {
      recipe.components.forEach((component) => {
        const codeKey = normalizeCodeKey(component.code);
        if (!codeKey.startsWith("BCH")) return;

        const current = grouped.get(codeKey) || {
          code: codeKey,
          name: component.ingredient || codeKey,
          usageCount: 0,
          usedInRecipes: [],
          resolvedBatchRecipeId: "",
          resolvedBatchRecipeName: "",
          resolvedBatchReviewStatus: "",
        };

        current.usageCount += 1;
        current.usedInRecipes.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          venue: getRecipeVenueLabel(recipe),
          qty: component.qty,
          componentName: component.ingredient || codeKey,
        });

        const matchedBatch =
          recipes.find(
            (candidate) =>
              candidate.recipeType === "batch" &&
              normalizeCodeKey(candidate.sellingItemCode || candidate.id) === codeKey
          ) || null;

        if (matchedBatch) {
          current.resolvedBatchRecipeId = matchedBatch.id;
          current.resolvedBatchRecipeName = matchedBatch.name;
          current.resolvedBatchReviewStatus = matchedBatch.validation.reviewStatus;
        }

        grouped.set(codeKey, current);
      });
    });

    return Array.from(grouped.values())
      .map((row) => {
        const savedDecision =
          bchAuditDecisions.find((decision) => normalizeCodeKey(decision.code) === row.code) || null;
        const heuristic = classifyBchHeuristic(row.name);
        const classification = savedDecision?.classification || heuristic;
        return {
          ...row,
          heuristic,
          classification,
          notes: savedDecision?.notes || "",
          hasBatchRecipe: Boolean(row.resolvedBatchRecipeId),
        };
      })
      .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
  }, [bchAuditDecisions, recipes]);
  const bchAuditSummary = useMemo(
    () => ({
      total: bchAuditRows.length,
      linked: bchAuditRows.filter((row) => row.hasBatchRecipe).length,
      missing: bchAuditRows.filter((row) => !row.hasBatchRecipe).length,
      needsReview: bchAuditRows.filter((row) => row.classification === "needs-review").length,
    }),
    [bchAuditRows]
  );
  const queueRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.validation.reviewStatus !== "ready" ||
          recipe.workflowStage === "draft" ||
          String(recipe.recipeComplete || "0") !== "1"
      ),
    [recipes]
  );
  const queueIngredients = useMemo(
    () =>
      ingredientCatalog.filter(
        (ingredient) =>
          ingredient.validation.reviewStatus !== "ready" ||
          ["missing", "wrong-type"].includes(ingredient.batchLink?.status)
      ),
    [ingredientCatalog]
  );
  const queueDishIndex = useMemo(
    () =>
      dishIndexRowsWithMatches.filter(
        (row) => !row.isArchived && row.match.status !== "matched"
      ),
    [dishIndexRowsWithMatches]
  );
  const queueTotal = queueRecipes.length + queueIngredients.length + queueDishIndex.length;
  const combinedIngredientCatalog = useMemo(
    () => {
      const linkedRecipeBatchIds = new Set(
        ingredientCatalog
          .filter(
            (ingredient) =>
              (ingredient.entry_type || "ingredient") === "batch" &&
              ["ready", "needs-review"].includes(ingredient.batchLink?.status) &&
              ingredient.batchLink?.recipeId
          )
          .map((ingredient) => ingredient.batchLink.recipeId)
      );

      return [
        ...ingredientCatalog
          .filter((ingredient) => {
            if ((ingredient.entry_type || "ingredient") !== "batch") return true;
            return !(
              ["ready", "needs-review"].includes(ingredient.batchLink?.status) &&
              ingredient.batchLink?.recipeId &&
              linkedRecipeBatchIds.has(ingredient.batchLink.recipeId)
            );
          })
          .map((ingredient) => ({
          id: ingredient.id,
          rowType: ingredient.entry_type === "batch" ? "batch" : "ingredient",
          sourceKind: "ingredient-master",
          displayName: ingredient.ingredient_name,
          displayCode: ingredient.ingredient_item_code,
          displayPrice: ingredient.unit_cost,
          displayPackSize: ingredient.pack_size,
          displayCategory: ingredient.category,
          displaySupplier: ingredient.supplier,
          displayUpdated: ingredient.last_updated,
          displayUsed: ingredient.usageCount,
          batchLink: ingredient.batchLink,
          validation: ingredient.validation,
          source: ingredient,
        })),
        ...batchCatalog.map((batch) => ({
          id: `catalog-batch-${batch.id}`,
          rowType: "batch",
          sourceKind: "recipe-batch",
          displayName: batch.name,
          displayCode: batch.batchIdentifier,
          displayPrice: getBatchUnitCost(batch),
          displayPackSize: `${numberValue(batch.batchYield)} ${getBatchYieldLabel(batch)}`,
          displayCategory: batch.category,
          displaySupplier: batch.restaurant,
          displayUpdated: "",
          displayUsed: batch.linkedRecipeCount,
          batchLink: {
            status: "recipe-batch",
            recipeId: batch.id,
            recipeName: batch.name,
            recipeReviewStatus: batch.validation.reviewStatus,
          },
          validation: batch.validation,
          source: batch,
        })),
      ].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    },
    [batchCatalog, ingredientCatalog]
  );
  const ingredientCatalogueSummary = useMemo(
    () => ({
      total: combinedIngredientCatalog.length,
      needsReview: combinedIngredientCatalog.filter((row) => row.validation.reviewStatus === "needs-review").length,
      ready: combinedIngredientCatalog.filter((row) => row.validation.reviewStatus === "ready").length,
      unlinkedBatchRows: combinedIngredientCatalog.filter(
        (row) =>
          row.rowType === "batch" &&
          row.sourceKind === "ingredient-master" &&
          ["missing", "wrong-type"].includes(row.batchLink?.status)
      ).length,
    }),
    [combinedIngredientCatalog]
  );
  const filteredIngredientCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredRows = combinedIngredientCatalog.filter((row) => {
      const matchesType = ingredientTypeFilter === "all" || row.rowType === ingredientTypeFilter;
      const matchesCatalogueFilter =
        ingredientBatchLinkFilter === "all" ||
        (ingredientBatchLinkFilter === "needs-review" &&
          row.validation.reviewStatus === "needs-review") ||
        (ingredientBatchLinkFilter === "ready" &&
          row.validation.reviewStatus === "ready") ||
        (ingredientBatchLinkFilter === "ingredient-master" &&
          row.sourceKind === "ingredient-master" &&
          row.rowType === "batch") ||
        (ingredientBatchLinkFilter === "recipe-batch" && row.sourceKind === "recipe-batch") ||
        (ingredientBatchLinkFilter === "linked" &&
          row.sourceKind === "ingredient-master" &&
          ["ready", "needs-review"].includes(row.batchLink?.status)) ||
        (ingredientBatchLinkFilter === "unlinked" &&
          row.sourceKind === "ingredient-master" &&
          ["missing", "wrong-type"].includes(row.batchLink?.status));
      if (!matchesType || !matchesCatalogueFilter) return false;
      if (!q) return true;
      return getIngredientColumnSearchText(row, ingredientColumnFilter).toLowerCase().includes(q);
    });

    return [...filteredRows].sort((leftRow, rightRow) => {
      const leftPinned = isIngredientBuilderRow(leftRow);
      const rightPinned = isIngredientBuilderRow(rightRow);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      const leftValue = getIngredientSortValue(leftRow, ingredientSortColumn);
      const rightValue = getIngredientSortValue(rightRow, ingredientSortColumn);
      let comparison = 0;

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = String(leftValue || "").localeCompare(String(rightValue || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      if (comparison === 0) {
        comparison = String(leftRow.displayName || "").localeCompare(String(rightRow.displayName || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return ingredientSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [
    combinedIngredientCatalog,
    ingredientBatchLinkFilter,
    ingredientColumnFilter,
    ingredientSortColumn,
    ingredientSortDirection,
    ingredientTypeFilter,
    search,
  ]);

  const importFormats = listRecipeImportFormats();
  const selectedImportFormatDefinition =
    importFormats.find((format) => format.id === selectedImportFormat) || importFormats[0];
  const googleSheetsEnabled = supportsGoogleSheetsImport(selectedImportFormat);

  const ingredientSuggestions = useMemo(() => {
    if (!activeLookup) return [];

    const recipe = recipes.find((item) => item.id === activeLookup.recipeId);
    const component = recipe?.components.find((item) => item.id === activeLookup.componentId);
    const query = component?.ingredient?.trim().toLowerCase() || "";
    return buildIngredientSuggestions({ query, recipes, ingredientMaster });
  }, [activeLookup, ingredientMaster, recipes]);
  const draftIngredientSuggestions = useMemo(() => {
    if (!activeDraftLookupId) return [];

    const component = newRecipeDraft.components.find((item) => item.id === activeDraftLookupId);
    const query = component?.ingredient?.trim().toLowerCase() || "";
    return buildIngredientSuggestions({ query, recipes, ingredientMaster });
  }, [activeDraftLookupId, ingredientMaster, newRecipeDraft.components, recipes]);

  const resolveComponentSource = (ingredientName, code, options = {}) => {
    const normalizedCode = normalizeCodeKey(code);
    const normalizedName = normalizeMatchKey(ingredientName);
    const allowNameBatchMatch = options.allowNameBatchMatch !== false;

    const matchedBatch =
      recipes.find(
        (recipe) =>
          recipe.recipeType === "batch" &&
          ((normalizedCode && normalizeCodeKey(recipe.sellingItemCode || recipe.id) === normalizedCode) ||
            (allowNameBatchMatch && normalizedName && normalizeMatchKey(recipe.name) === normalizedName))
      ) || null;

    if (matchedBatch) {
      return {
        sourceType: "batch",
        sourceRecipeId: matchedBatch.id,
        sourceUnitCost: getBatchUnitCost(matchedBatch),
        sourceYieldType: matchedBatch.batchYieldType || "",
      };
    }

    const matchedIngredient = findBestIngredientMatch(
      ingredientMaster,
      normalizedCode,
      normalizedName
    );

    if (matchedIngredient) {
      const ingredientSource = getIngredientPricingSource(matchedIngredient);
      return {
        sourceType: "ingredient-master",
        sourceRecipeId: "",
        sourceUnitCost: ingredientSource.sourceUnitCost,
        sourceYieldType: ingredientSource.sourceYieldType,
      };
    }

    return {
      sourceType: "",
      sourceRecipeId: "",
      sourceUnitCost: 0,
      sourceYieldType: "",
    };
  };

  const updateRecipeField = (recipeId, field, value) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked && field !== "isLocked") return recipe;
        const nextRecipe = { ...recipe, [field]: value };
        if (field === "recipeType" && value === "batch") {
          nextRecipe.isLive = false;
        }
        if (field === "portionCount") {
          nextRecipe.components = recipe.components.map((component) => {
            if (component.sourceType !== "batch") return component;
            const matchedBatch =
              current.find((item) => item.id === component.sourceRecipeId) ||
              current.find(
                (item) =>
                  item.recipeType === "batch" &&
                  normalizeCodeKey(item.sellingItemCode || item.id) === normalizeCodeKey(component.code)
              ) ||
              null;
            if (!matchedBatch) return component;
            const nextQty = getLinkedBatchComponentQty(nextRecipe, matchedBatch, component.qty);
            return {
              ...component,
              qty: nextQty,
              sourceUnitCost: getBatchUnitCost(matchedBatch),
              sourceYieldType: matchedBatch.batchYieldType || "",
              cost: calculateAutoComponentCost(
                nextQty,
                getBatchUnitCost(matchedBatch),
                matchedBatch.batchYieldType
              ),
            };
          });
        }
        return enrichRecipeMetrics(nextRecipe);
      })
    );
  };

  const openRecipeInBuilder = (recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId) || null;
    setSelectedRecipeId(recipeId);
    setRecipeEditLookup(recipeId);
    setRecipeLookupQuery("");
    setActiveLookup(null);
    setActiveDraftLookupId(null);
    setBuilderRecipeFilter(recipe?.recipeType === "batch" ? "batch" : "all");
    setBuilderBringBatchesForward(recipe?.recipeType === "batch");
    setBuilderMode("edit");
    setActiveTab("builder");
  };

  const createRecipeFromDishIndex = (row) => {
    if (requireEditAccess()) return;
    const nextVenue = normalizeVenueName(row.venue, row.sourceTab) || "Tasi";
    const nextDraft = {
      ...createRecipeDraft(nextVenue),
      restaurant: nextVenue,
      name: row.dishName || "",
      category: row.course || "",
    };

    setNewRecipeDraft(nextDraft);
    setBuilderMode("create");
    setActiveTab("builder");
  };

  const updateDishIndexRow = async (rowId, updates) => {
    let nextRow = null;
    setDishIndexRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        nextRow = { ...row, ...updates };
        return nextRow;
      })
    );
    if (nextRow && supabaseEnabled && supabase) {
      const { error } = await syncDishIndexRowToSupabase(nextRow);
      if (error) {
        setImportError(`Saved dish index change locally, but could not sync to Supabase: ${error.message}`);
      } else {
        setBackendStatus("Supabase connected");
      }
    }
  };

  const confirmDishIndexMatch = async (rowId, recipeId) => {
    await updateDishIndexRow(rowId, {
      linkedRecipeId: recipeId,
      reviewState: "confirmed",
    });
    setActiveDishIndexLookupId(null);
    setDishIndexLookupQuery("");
  };

  const markDishIndexNoRecipe = async (rowId) => {
    await updateDishIndexRow(rowId, {
      linkedRecipeId: "",
      reviewState: "no-recipe",
    });
    setActiveDishIndexLookupId(null);
    setDishIndexLookupQuery("");
  };

  const clearDishIndexDecision = async (rowId) => {
    await updateDishIndexRow(rowId, {
      linkedRecipeId: "",
      reviewState: "",
      isArchived: false,
    });
    setActiveDishIndexLookupId(null);
    setDishIndexLookupQuery("");
  };

  const openDishIndexLookup = (row) => {
    setActiveDishIndexLookupId(row.id);
    setDishIndexLookupQuery(row.dishName || "");
  };

  const updateBchAuditDecision = async (code, updates) => {
    if (requireEditAccess()) return;
    let nextDecision = null;
    setBchAuditDecisions((current) => {
      const normalizedCode = normalizeCodeKey(code);
      const existing = current.find((decision) => normalizeCodeKey(decision.code) === normalizedCode);
      if (!existing) {
        nextDecision = { code: normalizedCode, classification: "needs-review", notes: "", ...updates };
        return [...current, nextDecision];
      }
      return current.map((decision) => {
        if (normalizeCodeKey(decision.code) !== normalizedCode) return decision;
        nextDecision = { ...decision, ...updates };
        return nextDecision;
      });
    });
    if (nextDecision && supabaseEnabled && supabase) {
      const { error } = await syncBchAuditDecisionToSupabase(nextDecision);
      if (error) {
        setImportError(`Saved BCH audit change locally, but could not sync to Supabase: ${error.message}`);
      } else {
        setBackendStatus("Supabase connected");
      }
    }
  };

  const archiveDishIndexRow = async (rowId) => {
    await updateDishIndexRow(rowId, { isArchived: true });
    setActiveDishIndexLookupId(null);
  };

  const unarchiveDishIndexRow = async (rowId) => {
    await updateDishIndexRow(rowId, { isArchived: false });
  };

  const updateComponentField = (recipeId, componentId, field, value) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const components = recipe.components.map((component) =>
          component.id === componentId
            ? (() => {
                const nextComponent = {
                  ...component,
                  [field]: field === "qty" || field === "cost" ? numberValue(value) : value,
                };

                if (field === "ingredient" || field === "code") {
                  const sourceMatch = resolveComponentSource(nextComponent.ingredient, nextComponent.code, {
                    allowNameBatchMatch: field !== "ingredient",
                  });
                  nextComponent.sourceType = sourceMatch.sourceType;
                  nextComponent.sourceRecipeId = sourceMatch.sourceRecipeId;
                  nextComponent.sourceUnitCost = sourceMatch.sourceUnitCost;
                  nextComponent.sourceYieldType = sourceMatch.sourceYieldType;
                  if (shouldAutoCostComponent(nextComponent)) {
                    nextComponent.cost = calculateAutoComponentCost(
                      nextComponent.qty,
                      nextComponent.sourceUnitCost,
                      nextComponent.sourceYieldType
                    );
                  }
                }

                if (field === "qty" && !nextComponent.sourceType) {
                  const sourceMatch = resolveComponentSource(nextComponent.ingredient, nextComponent.code, {
                    allowNameBatchMatch: false,
                  });
                  nextComponent.sourceType = sourceMatch.sourceType;
                  nextComponent.sourceRecipeId = sourceMatch.sourceRecipeId;
                  nextComponent.sourceUnitCost = sourceMatch.sourceUnitCost;
                  nextComponent.sourceYieldType = sourceMatch.sourceYieldType;
                }

                if (field === "qty" && shouldAutoCostComponent(nextComponent)) {
                  nextComponent.cost = calculateAutoComponentCost(
                    nextComponent.qty,
                    nextComponent.sourceUnitCost,
                    nextComponent.sourceYieldType
                  );
                }

                if (field === "cost" && shouldAutoCostComponent(nextComponent)) {
                  nextComponent.sourceType = "";
                  nextComponent.sourceRecipeId = "";
                  nextComponent.sourceUnitCost = 0;
                  nextComponent.sourceYieldType = "";
                }

                return nextComponent;
              })()
            : component
        );
        return enrichRecipeMetrics({ ...recipe, components });
      })
    );
  };

  const addRecipe = () => {
    if (requireEditAccess()) return;
    const next = String(recipes.length + 1).padStart(3, "0");
    const newRecipe = {
      id: `NEW-${next}`,
      sourceRow: "",
      restaurant: restaurant === "all" || restaurant === "Batch" ? "Tasi" : restaurant,
      name: "New Dish",
      category: "Uncategorised",
      sellingItemCode: `NEW${next}`,
      currentSalePrice: 0,
      roundup: 0,
      netPriceSource: 0,
      grossPriceSource: 0,
      sourceCost: 0,
      posYtd: 0,
      recipeComplete: "0",
      pricingComplete: "0",
      recipeType: "dish",
      portionCount: 1,
      batchYield: 1,
      batchYieldType: "portion",
      method: "",
      methodSteps: [],
      presentationNotes: "",
      presentationImage: "",
      workflowStage: "draft",
      isLocked: false,
      isLive: false,
      components: [
        {
          id: `NEW-${next}-1`,
          sort: 1,
          ingredient: "",
          code: "",
          qty: 0,
          cost: 0,
          sourceType: "",
          sourceRecipeId: "",
          sourceUnitCost: 0,
          sourceYieldType: "",
        },
      ],
    };
    setRecipes((current) => [enrichRecipeMetrics(newRecipe), ...current]);
    setSelectedRecipeId(newRecipe.id);
    setBuilderMode("edit");
    setActiveTab("builder");
  };

  const createBatchRecipeFromIngredient = (ingredient) => {
    if (requireEditAccess()) return;
    const next = String(recipes.length + 1).padStart(3, "0");
    const inferredRestaurant = restaurant !== "all" && restaurant !== "Batch" ? restaurant : "";
    const name = ingredient.ingredient_name?.trim() || `New Batch ${next}`;
    const sellingItemCode = ingredient.ingredient_item_code?.trim() || `BATCH${next}`;
    const newRecipe = enrichRecipeMetrics({
      id: `BATCH-${next}`,
      sourceRow: "",
      restaurant: inferredRestaurant,
      name,
      category: ingredient.category?.trim() || "Batch",
      sellingItemCode,
      currentSalePrice: 0,
      roundup: 0,
      netPriceSource: 0,
      grossPriceSource: 0,
      sourceCost: 0,
      posYtd: 0,
      recipeComplete: "0",
      pricingComplete: "1",
      recipeType: "batch",
      portionCount: 1,
      batchYield: numberValue(ingredient.pack_size) > 0 ? numberValue(ingredient.pack_size) : 1,
      batchYieldType: "portion",
      method: "",
      methodSteps: [],
      presentationNotes: "",
      presentationImage: "",
      workflowStage: "draft",
      isLocked: false,
      isLive: false,
      components: [
        {
          id: `BATCH-${next}-1`,
          sort: 1,
          ingredient: "",
          code: "",
          qty: 0,
          cost: 0,
          sourceType: "",
          sourceRecipeId: "",
          sourceUnitCost: 0,
          sourceYieldType: "",
        },
      ],
    });

    setRecipes((current) => [newRecipe, ...current]);
    setSelectedRecipeId(newRecipe.id);
    setBuilderMode("edit");
    setActiveTab("builder");
  };

  const resetNewRecipeDraft = (recipeType = "dish") => {
    const defaultRestaurant =
      restaurant === "all" || restaurant === "Batch" ? recipes[0]?.restaurant || "Tasi" : restaurant;
    setActiveDraftLookupId(null);
    setNewRecipeDraft({
      ...createRecipeDraft(defaultRestaurant),
      recipeType,
      restaurant: recipeType === "batch" ? "" : defaultRestaurant,
      batchYieldType: recipeType === "batch" ? "g" : "portion",
    });
  };

  const updateNewRecipeField = (field, value) => {
    setNewRecipeDraft((current) => {
      const nextDraft = { ...current, [field]: value };
      if (field === "recipeType") {
        if (value === "batch") {
          nextDraft.restaurant = "";
          nextDraft.currentSalePrice = 0;
          nextDraft.batchYieldType = current.batchYieldType === "portion" ? "g" : current.batchYieldType;
        } else {
          nextDraft.restaurant =
            current.restaurant ||
            (restaurant === "all" || restaurant === "Batch" ? recipes[0]?.restaurant || "Tasi" : restaurant);
          nextDraft.batchYieldType = "portion";
        }
      }
      if (field === "portionCount") {
        nextDraft.components = current.components.map((component) => {
          if (component.sourceType !== "batch") return component;
          const matchedBatch =
            recipes.find((item) => item.id === component.sourceRecipeId) ||
            recipes.find(
              (item) =>
                item.recipeType === "batch" &&
                normalizeCodeKey(item.sellingItemCode || item.id) === normalizeCodeKey(component.code)
            ) ||
            null;
          if (!matchedBatch) return component;
          const nextQty = getLinkedBatchComponentQty(nextDraft, matchedBatch, component.qty);
          return {
            ...component,
            qty: nextQty,
            sourceUnitCost: getBatchUnitCost(matchedBatch),
            sourceYieldType: matchedBatch.batchYieldType || "",
            cost: calculateAutoComponentCost(nextQty, getBatchUnitCost(matchedBatch), matchedBatch.batchYieldType),
          };
        });
      }
      return nextDraft;
    });
  };

  const updateNewComponentField = (componentId, field, value) => {
    setNewRecipeDraft((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.id === componentId
          ? (() => {
              const nextComponent = {
                ...component,
                [field]: field === "qty" || field === "cost" ? numberValue(value) : value,
              };

              if (field === "ingredient" || field === "code") {
                const sourceMatch = resolveComponentSource(nextComponent.ingredient, nextComponent.code, {
                  allowNameBatchMatch: field !== "ingredient",
                });
                nextComponent.sourceType = sourceMatch.sourceType;
                nextComponent.sourceRecipeId = sourceMatch.sourceRecipeId;
                nextComponent.sourceUnitCost = sourceMatch.sourceUnitCost;
                nextComponent.sourceYieldType = sourceMatch.sourceYieldType;
                if (shouldAutoCostComponent(nextComponent)) {
                  nextComponent.cost = calculateAutoComponentCost(
                    nextComponent.qty,
                    nextComponent.sourceUnitCost,
                    nextComponent.sourceYieldType
                  );
                }
              }

              if (field === "qty" && !nextComponent.sourceType) {
                const sourceMatch = resolveComponentSource(nextComponent.ingredient, nextComponent.code, {
                  allowNameBatchMatch: false,
                });
                nextComponent.sourceType = sourceMatch.sourceType;
                nextComponent.sourceRecipeId = sourceMatch.sourceRecipeId;
                nextComponent.sourceUnitCost = sourceMatch.sourceUnitCost;
                nextComponent.sourceYieldType = sourceMatch.sourceYieldType;
              }

              if (field === "qty" && shouldAutoCostComponent(nextComponent)) {
                nextComponent.cost = calculateAutoComponentCost(
                  nextComponent.qty,
                  nextComponent.sourceUnitCost,
                  nextComponent.sourceYieldType
                );
              }

              if (field === "cost" && shouldAutoCostComponent(nextComponent)) {
                nextComponent.sourceType = "";
                nextComponent.sourceRecipeId = "";
                nextComponent.sourceUnitCost = 0;
                nextComponent.sourceYieldType = "";
              }

              return nextComponent;
            })()
          : component
      ),
    }));
  };

  const addNewDraftComponent = () => {
    setNewRecipeDraft((current) => {
      const nextSort = Math.max(0, ...current.components.map((component) => numberValue(component.sort))) + 1;
      return {
        ...current,
        components: [
          ...current.components,
          {
            id: `draft-${nextSort}`,
            sort: nextSort,
            ingredient: "",
            code: "",
            qty: 0,
            cost: 0,
            sourceType: "",
            sourceRecipeId: "",
            sourceUnitCost: 0,
            sourceYieldType: "",
          },
        ],
      };
    });
  };

  const removeNewDraftComponent = (componentId) => {
    setNewRecipeDraft((current) => {
      const nextComponents = current.components.filter((component) => component.id !== componentId);
      return {
        ...current,
        components: nextComponents.length ? nextComponents : createRecipeDraft(current.restaurant || "Tasi").components,
      };
    });
  };

  const addNewMethodStep = () => {
    setNewRecipeDraft((current) => ({
      ...current,
      methodSteps: [...(current.methodSteps || []), ""],
    }));
  };

  const updateNewMethodStep = (index, value) => {
    setNewRecipeDraft((current) => {
      const methodSteps = [...(current.methodSteps || [])];
      methodSteps[index] = value;
      return { ...current, methodSteps };
    });
  };

  const removeNewMethodStep = (index) => {
    setNewRecipeDraft((current) => ({
      ...current,
      methodSteps: (current.methodSteps || []).filter((_, stepIndex) => stepIndex !== index),
    }));
  };

  const getNextBatchCode = () => {
    const maxExisting = recipes.reduce((maxValue, recipe) => {
      const match = normalizeCodeKey(recipe.sellingItemCode || recipe.id).match(/^BCH(\d+)$/);
      if (!match) return maxValue;
      return Math.max(maxValue, Number(match[1]));
    }, 0);
    return `BCH${String(maxExisting + 1).padStart(3, "0")}`;
  };

  const saveNewRecipeDraft = () => {
    if (requireEditAccess()) return;
    const next = String(recipes.length + 1).padStart(3, "0");
    const generatedBatchCode =
      newRecipeDraft.recipeType === "batch"
        ? newRecipeDraft.sellingItemCode?.trim() || getNextBatchCode()
        : newRecipeDraft.sellingItemCode?.trim() || `NEW${next}`;
    const recipeId = newRecipeDraft.recipeType === "batch" ? generatedBatchCode : `NEW-${next}`;
    const savedRecipe = enrichRecipeMetrics({
      id: recipeId,
      sourceRow: "",
      restaurant: newRecipeDraft.recipeType === "batch" ? "" : newRecipeDraft.restaurant,
      name: newRecipeDraft.name || (newRecipeDraft.recipeType === "batch" ? "New Batch" : "New Dish"),
      category: newRecipeDraft.category || (newRecipeDraft.recipeType === "batch" ? "Batch" : "Uncategorised"),
      sellingItemCode: generatedBatchCode,
      currentSalePrice: newRecipeDraft.recipeType === "batch" ? 0 : numberValue(newRecipeDraft.currentSalePrice),
      roundup: newRecipeDraft.recipeType === "batch" ? 0 : newRecipeDraftRoundupTarget,
      netPriceSource: 0,
      grossPriceSource: 0,
      sourceCost: 0,
      posYtd: 0,
      recipeComplete: "0",
      pricingComplete: "0",
      recipeType: newRecipeDraft.recipeType,
      portionCount: newRecipeDraft.recipeType === "batch" ? 1 : numberValue(newRecipeDraft.portionCount) || 1,
      batchYield: newRecipeDraft.recipeType === "batch" ? numberValue(newRecipeDraft.batchYield) || 1 : 1,
      batchYieldType: newRecipeDraft.recipeType === "batch" ? newRecipeDraft.batchYieldType || "g" : "portion",
      method: (newRecipeDraft.methodSteps || []).filter(Boolean).join("\n"),
      methodSteps: (newRecipeDraft.methodSteps || []).filter((step) => String(step || "").trim()),
      presentationNotes: newRecipeDraft.presentationNotes || "",
      presentationImage: "",
      workflowStage: "draft",
      isLocked: false,
      isLive: false,
      components: newRecipeDraft.components.map((component, index) => ({
        ...component,
        id: `${recipeId}-${index + 1}`,
        sort: index + 1,
        ingredient: component.ingredient || "",
        code: component.code || "",
        qty: numberValue(component.qty),
        cost: numberValue(component.cost),
        sourceType: "",
        sourceRecipeId: "",
        sourceUnitCost: 0,
        sourceYieldType: "",
      })),
    });

    setRecipes((current) => linkBatchReferences([savedRecipe, ...current.filter((recipe) => recipe.id !== savedRecipe.id)]));
    setActiveDraftLookupId(null);
    if (savedRecipe.recipeType === "batch") {
      setIngredientMaster((current) => {
        const existingRow = current.find(
          (ingredient) =>
            ingredient.linked_recipe_id === savedRecipe.id ||
            normalizeCodeKey(ingredient.ingredient_item_code) === normalizeCodeKey(savedRecipe.sellingItemCode)
        );
        const nextRow = {
          id: existingRow?.id || `linked-batch-${savedRecipe.id}`,
          ingredient_name: savedRecipe.name,
          ingredient_item_code: savedRecipe.sellingItemCode,
          unit_cost: getBatchUnitCost(savedRecipe),
          pack_size: `${numberValue(savedRecipe.batchYield)} ${getBatchYieldLabel(savedRecipe)}`.trim(),
          supplier: savedRecipe.restaurant || "",
          category: savedRecipe.category || "Batch",
          last_updated: getTodayDateString(),
          entry_type: "batch",
          linked_recipe_id: savedRecipe.id,
          is_locked: existingRow?.is_locked || false,
        };
        if (!existingRow) return [...current, nextRow];
        return current.map((ingredient) => (ingredient.id === existingRow.id ? nextRow : ingredient));
      });
    }
    setSelectedRecipeId(savedRecipe.id);
    setBuilderMode("edit");
    setImportMessage(
      savedRecipe.recipeType === "batch"
        ? `Created batch recipe ${savedRecipe.name} and generated batch ingredient ${savedRecipe.sellingItemCode}.`
        : `Created recipe ${savedRecipe.name} with an automatic roundup target of ${money(newRecipeDraftRoundupTarget)}.`
    );
    resetNewRecipeDraft("dish");
  };

  const addComponent = () => {
    if (!selectedRecipe) return;
    if (selectedRecipe.isLocked) return;
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== selectedRecipe.id) return recipe;
        const nextSort = Math.max(0, ...recipe.components.map((component) => numberValue(component.sort))) + 1;
        return enrichRecipeMetrics({
          ...recipe,
          components: [
            ...recipe.components,
            {
              id: `${recipe.id}-${nextSort}`,
              sort: nextSort,
              ingredient: "",
              code: "",
              qty: 0,
              cost: 0,
              sourceType: "",
              sourceRecipeId: "",
              sourceUnitCost: 0,
              sourceYieldType: "",
            },
          ],
        });
      })
    );
  };

  const removeComponent = (recipeId, componentId) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const components = recipe.components.filter((component) => component.id !== componentId);
        const nextComponents = components.length
          ? components
          : [
              {
                id: `${recipe.id}-1`,
                sort: 1,
                ingredient: "",
                code: "",
                qty: 0,
                cost: 0,
                sourceType: "",
                sourceRecipeId: "",
                sourceUnitCost: 0,
                sourceYieldType: "",
              },
            ];
        return enrichRecipeMetrics({ ...recipe, components: nextComponents });
      })
    );
  };

  const applyIngredientMatch = (recipeId, componentId, ingredient) => {
    const ingredientPricingSource =
      ingredient.sourceType === "batch"
        ? {
            sourceUnitCost: numberValue(ingredient.unit_cost),
            sourceYieldType:
              ingredient.sourceYieldType ||
              recipes.find((item) => item.id === ingredient.sourceRecipeId)?.batchYieldType ||
              "",
          }
        : getIngredientPricingSource(ingredient);
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const components = recipe.components.map((component) =>
          component.id === componentId
            ? {
                ...component,
                ingredient: ingredient.ingredient_name,
                code: ingredient.ingredient_item_code,
                sourceType: ingredient.sourceType || "",
                sourceRecipeId: ingredient.sourceRecipeId || "",
                sourceUnitCost: ingredientPricingSource.sourceUnitCost,
                sourceYieldType: ingredientPricingSource.sourceYieldType,
                cost:
                  ingredient.sourceType
                    ? calculateAutoComponentCost(
                        component.qty,
                        ingredientPricingSource.sourceUnitCost,
                        ingredientPricingSource.sourceYieldType
                      )
                    : ingredientPricingSource.sourceUnitCost,
              }
            : component
        );
        return enrichRecipeMetrics({ ...recipe, components });
      })
    );
    setActiveLookup(null);
  };

  const applyIngredientMatchToDraft = (componentId, ingredient) => {
    const ingredientPricingSource =
      ingredient.sourceType === "batch"
        ? {
            sourceUnitCost: numberValue(ingredient.unit_cost),
            sourceYieldType:
              ingredient.sourceYieldType ||
              recipes.find((item) => item.id === ingredient.sourceRecipeId)?.batchYieldType ||
              "",
          }
        : getIngredientPricingSource(ingredient);
    setNewRecipeDraft((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              ingredient: ingredient.ingredient_name,
              code: ingredient.ingredient_item_code,
              sourceType: ingredient.sourceType || "",
              sourceRecipeId: ingredient.sourceRecipeId || "",
              sourceUnitCost: ingredientPricingSource.sourceUnitCost,
              sourceYieldType: ingredientPricingSource.sourceYieldType,
              cost:
                ingredient.sourceType
                  ? calculateAutoComponentCost(
                      component.qty,
                      ingredientPricingSource.sourceUnitCost,
                      ingredientPricingSource.sourceYieldType
                    )
                  : ingredientPricingSource.sourceUnitCost,
            }
          : component
      ),
    }));
    setActiveDraftLookupId(null);
  };

  const handleIngredientUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const ingredients = normalizeIngredientMaster(text);
      if (!ingredients.length) {
        throw new Error("No ingredient rows were found after validation.");
      }
      setIngredientMaster(ingredients);
      setIngredientUploadError("");
      setIngredientUploadMessage(
        `Loaded ${ingredients.length} ingredients. Lookup is now available in recipe components, alongside batch recipes.`
      );
    } catch (error) {
      setIngredientUploadMessage("");
      setIngredientUploadError(error.message || "Ingredient upload failed.");
    } finally {
      event.target.value = "";
    }
  };

  const handlePresentationImageUpload = async (recipeId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const recipe = recipes.find((item) => item.id === recipeId);
    if (recipe?.isLocked) {
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateRecipeField(recipeId, "presentationImage", String(reader.result || ""));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const updateIngredientField = (ingredientId, field, value) => {
    setIngredientMaster((current) => {
      const nextIngredients = current.map((ingredient) =>
        ingredient.id === ingredientId
          ? ingredient.is_locked && field !== "is_locked"
            ? ingredient
            : {
                ...ingredient,
                [field]: field === "is_locked" ? Boolean(value) : value,
                last_updated: field === "last_updated" ? value : getTodayDateString(),
              }
          : ingredient
      );
      setRecipes((recipesCurrent) => syncIngredientReferences(recipesCurrent, nextIngredients));
      return nextIngredients;
    });
  };

  const updateIngredientPackSize = (ingredientId, part, value) => {
    setIngredientMaster((current) => {
      const nextIngredients = current.map((ingredient) => {
        if (ingredient.id !== ingredientId) return ingredient;
        if (ingredient.is_locked) return ingredient;
        const packParts = parsePackSizeParts(ingredient.pack_size);
        const nextValue = part === "value" ? value : packParts.value;
        const nextUnit = part === "unit" ? value : packParts.unit;
        return {
          ...ingredient,
          pack_size: formatPackSize(nextValue, nextUnit),
          last_updated: getTodayDateString(),
        };
      });
      setRecipes((recipesCurrent) => syncIngredientReferences(recipesCurrent, nextIngredients));
      return nextIngredients;
    });
  };

  const saveIngredientMasterChanges = () => {
    if (requireEditAccess()) return;
    saveStoredCollection(INGREDIENT_MASTER_STORAGE_KEY, ingredientMaster);
    setRecipes((current) => syncIngredientReferences(current, ingredientMaster));
    setIngredientUploadError("");
    setIngredientUploadMessage(`Saved ${ingredientMaster.length} ingredient rows and refreshed linked recipe costs.`);

    if (supabaseEnabled && supabase) {
      supabase
        .from("ingredients")
        .upsert(ingredientMaster.map(mapIngredientRowToSupabase), { onConflict: "id" })
        .then(({ error }) => {
          if (error) {
            setIngredientUploadError(`Saved locally, but could not sync ingredients to Supabase: ${error.message}`);
            return;
          }
          setBackendStatus("Supabase connected");
          setIngredientUploadMessage(
            `Saved ${ingredientMaster.length} ingredient rows locally and to Supabase.`
          );
        });
    }
  };

  const syncRecipeToSupabase = async (recipe) => {
    if (!supabaseEnabled || !supabase || !recipe) return { error: null };

    const recipePayload = mapRecipeRowToSupabase(recipe);
    const componentPayload = (recipe.components || []).map((component, index) =>
      mapRecipeComponentRowToSupabase(recipe.id, component, index)
    );

    const { error: recipeError } = await supabase.from("recipes").upsert(recipePayload, { onConflict: "id" });
    if (recipeError) return { error: recipeError };

    const { error: deleteError } = await supabase.from("recipe_components").delete().eq("recipe_id", recipe.id);
    if (deleteError) return { error: deleteError };

    if (componentPayload.length) {
      const { error: componentError } = await supabase.from("recipe_components").insert(componentPayload);
      if (componentError) return { error: componentError };
    }

    return { error: null };
  };

  const syncRecipeCollectionToSupabase = async (recipesToSync) => {
    const syncTargets = Array.isArray(recipesToSync) ? recipesToSync.filter(Boolean) : [];
    let syncedCount = 0;
    const failed = [];

    for (const recipe of syncTargets) {
      const { error } = await syncRecipeToSupabase(recipe);
      if (error) {
        failed.push({
          recipeId: recipe.id,
          recipeName: recipe.name || recipe.id,
          message: error.message,
        });
      } else {
        syncedCount += 1;
      }
    }

    return {
      syncedCount,
      failed,
    };
  };

  const syncDishIndexRowToSupabase = async (row) => {
    if (!supabaseEnabled || !supabase || !row) return { error: null };
    const { error } = await supabase
      .from("dish_index")
      .upsert(mapDishIndexRowToSupabase(row), { onConflict: "id" });
    return { error };
  };

  const syncDishIndexCollectionToSupabase = async (rows) => {
    const syncTargets = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!supabaseEnabled || !supabase || !syncTargets.length) {
      return { error: null, syncedCount: 0 };
    }
    const { error } = await supabase
      .from("dish_index")
      .upsert(syncTargets.map(mapDishIndexRowToSupabase), { onConflict: "id" });
    return {
      error,
      syncedCount: error ? 0 : syncTargets.length,
    };
  };

  const syncBchAuditDecisionToSupabase = async (decision) => {
    if (!supabaseEnabled || !supabase || !decision) return { error: null };
    const { error } = await supabase
      .from("bch_audit")
      .upsert(mapBchAuditDecisionToSupabase(decision), { onConflict: "id" });
    return { error };
  };

  const saveCurrentRecipeChanges = async () => {
    if (requireEditAccess()) return;
    if (!selectedRecipe) return;

    const syncedRecipes = syncIngredientReferences(recipes, ingredientMaster);
    setRecipes(syncedRecipes);
    saveStoredCollection(RECIPES_STORAGE_KEY, syncedRecipes);
    const syncedSelectedRecipe =
      syncedRecipes.find((recipe) => recipe.id === selectedRecipe.id) || selectedRecipe;

    if (syncedSelectedRecipe.recipeType === "batch") {
      setTimeout(() => {
        syncBatchIngredientsWithRecipes();
      }, 0);
    }

    setActiveLookup(null);
    setActiveDraftLookupId(null);
    setRecipeLookupQuery("");
    setImportError("");
    setImportMessage(
      `Saved ${syncedSelectedRecipe.recipeType === "batch" ? "batch" : "recipe"} ${
        syncedSelectedRecipe.name || syncedSelectedRecipe.id
      }.`
    );

    if (supabaseEnabled && supabase) {
      const { error } = await syncRecipeToSupabase(syncedSelectedRecipe);
      if (error) {
        setImportError(
          `Saved locally, but could not sync ${syncedSelectedRecipe.recipeType === "batch" ? "batch" : "recipe"} to Supabase: ${error.message}`
        );
        return;
      }
      setBackendStatus("Supabase connected");
      setImportMessage(
        `Saved ${syncedSelectedRecipe.recipeType === "batch" ? "batch" : "recipe"} ${
          syncedSelectedRecipe.name || syncedSelectedRecipe.id
        } locally and to Supabase.`
      );
    }
  };

  const syncMenuToSupabase = async (menu) => {
    if (!supabaseEnabled || !supabase || !menu) return { error: null };

    const menuPayload = mapMenuRowToSupabase(menu);
    const linePayload = (menu.lines || []).map((line, index) =>
      mapMenuLineRowToSupabase(menu.id, line, index)
    );

    const { error: menuError } = await supabase.from("menus").upsert(menuPayload, { onConflict: "id" });
    if (menuError) return { error: menuError };

    const { error: deleteError } = await supabase.from("menu_lines").delete().eq("menu_id", menu.id);
    if (deleteError) return { error: deleteError };

    if (linePayload.length) {
      const { error: lineError } = await supabase.from("menu_lines").insert(linePayload);
      if (lineError) return { error: lineError };
    }

    return { error: null };
  };

  const saveMenuChanges = async () => {
    if (requireEditAccess()) return;
    saveStoredCollection(MENUS_STORAGE_KEY, menus);
    setImportError("");
    setImportMessage(
      `Saved ${selectedMenu?.name || "menu"}${selectedMenu?.restaurant ? ` for ${selectedMenu.restaurant}` : ""}.`
    );

    if (supabaseEnabled && supabase && selectedMenu) {
      const { error } = await syncMenuToSupabase(selectedMenu);
      if (error) {
        setImportError(
          `Saved locally, but could not sync menu ${selectedMenu.name || selectedMenu.id} to Supabase: ${error.message}`
        );
        return;
      }
      setBackendStatus("Supabase connected");
      setImportMessage(
        `Saved ${selectedMenu.name || "menu"}${selectedMenu.restaurant ? ` for ${selectedMenu.restaurant}` : ""} locally and to Supabase.`
      );
    }
  };

  const addVenue = () => {
    if (requireEditAccess()) return;
    const trimmedVenue = newVenueName.trim();
    if (!trimmedVenue) {
      setImportError("Enter a venue name before adding it.");
      setImportMessage("");
      return;
    }

    setVenues((current) => {
      if (current.some((venue) => venue.toLowerCase() === trimmedVenue.toLowerCase())) {
        return current;
      }
      return [...current, trimmedVenue].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" })
      );
    });
    setNewVenueName("");
    setImportError("");
    setImportMessage(`Added venue ${trimmedVenue}.`);

    if (supabaseEnabled && supabase) {
      supabase.from("venues").upsert({ name: trimmedVenue }, { onConflict: "name" }).then(({ error }) => {
        if (error) {
          setImportError(`Added venue locally, but could not sync ${trimmedVenue} to Supabase: ${error.message}`);
          return;
        }
        setBackendStatus("Supabase connected");
      });
    }
  };

  const addIngredientRow = () => {
    if (requireEditAccess()) return;
    const next = String(ingredientMaster.length + 1).padStart(3, "0");
    const nextId = `local-ingredient-${next}`;
    setActiveTab("ingredients");
    setIngredientTypeFilter("all");
    setIngredientBatchLinkFilter("all");
    setIngredientColumnFilter("all-columns");
    setSearch("");
    setIngredientUploadError("");
    setIngredientUploadMessage("Added a new blank ingredient row at the top of the catalogue.");
    setActiveIngredientDraftId(nextId);
    setIngredientEditLookup("");
    setIngredientEditLookupQuery("");
    setIngredientMaster((current) => [
      createBlankIngredientRow(nextId),
      ...current,
    ]);
  };

  const deleteIngredientRow = (ingredient) => {
    if (requireEditAccess()) return;
    if (!ingredient || ingredient.is_locked) {
      setIngredientUploadError("Unlock the ingredient before deleting it.");
      setIngredientUploadMessage("");
      return;
    }

    const confirmed = window.confirm(
      `Delete ingredient "${ingredient.ingredient_name || "Untitled ingredient"}"${
        ingredient.ingredient_item_code ? ` (${ingredient.ingredient_item_code})` : ""
      }? This cannot be undone.`
    );
    if (!confirmed) return;

    const deletedSignature = getIngredientSignature(ingredient);
    if (deletedSignature) {
      setDeletedIngredientSignatures((current) =>
        current.includes(deletedSignature) ? current : [...current, deletedSignature]
      );
    }
    setIngredientMaster((current) => current.filter((item) => item.id !== ingredient.id));
    if (activeIngredientDraftId === ingredient.id) {
      setActiveIngredientDraftId(null);
      setIngredientEditLookup("");
    }
    setIngredientUploadError("");
    setIngredientUploadMessage(
      `Deleted ingredient ${ingredient.ingredient_name || ingredient.ingredient_item_code || ingredient.id}.`
    );
  };

  const deleteRecipe = (recipe) => {
    if (requireEditAccess()) return;
    if (!recipe || recipe.isLocked) {
      setImportError("Unlock the recipe before deleting it.");
      setImportMessage("");
      return;
    }

    const confirmed = window.confirm(
      `Delete recipe "${recipe.name || "Untitled recipe"}"${
        recipe.sellingItemCode ? ` (${recipe.sellingItemCode})` : ""
      }? This will also remove it from any set menus and cannot be undone.`
    );
    if (!confirmed) return;

    setRecipes((current) =>
      syncIngredientReferences(
        current.filter((item) => item.id !== recipe.id),
        ingredientMaster
      )
    );
    setMenus((current) =>
      current.map((menu) => ({
        ...menu,
        lines: menu.lines.filter((line) => line.recipeId !== recipe.id),
      }))
    );
    if (recipe.recipeType === "batch") {
      setIngredientMaster((current) =>
        current.filter((ingredient) => ingredient.linked_recipe_id !== recipe.id)
      );
    }
    if (selectedRecipeId === recipe.id) {
      const nextRecipe = recipes.find((item) => item.id !== recipe.id) || null;
      setSelectedRecipeId(nextRecipe?.id || null);
      setRecipeEditLookup(nextRecipe?.id || "");
      if (!nextRecipe) {
        setBuilderMode("create");
      }
    }
    setImportError("");
    setImportMessage(`Deleted recipe ${recipe.name || recipe.id}.`);
  };

  const activeIngredientDraft = useMemo(
    () =>
      combinedIngredientCatalog.find(
        (row) => row.sourceKind === "ingredient-master" && row.source.id === activeIngredientDraftId
      ) || null,
    [activeIngredientDraftId, combinedIngredientCatalog]
  );
  const quickPanelIngredient =
    quickPanel?.type === "ingredient"
      ? ingredientCatalog.find((ingredient) => ingredient.id === quickPanel.ingredientId) || null
      : null;
  const quickPanelBatch =
    quickPanel?.type === "batch"
      ? recipes.find((recipe) => recipe.id === quickPanel.recipeId) || null
      : null;

  const ingredientEditOptions = useMemo(
    () =>
      ingredientCatalog
        .map((ingredient) => ({
          id: ingredient.id,
          label: `${ingredient.ingredient_name || "Unnamed ingredient"}${
            ingredient.ingredient_item_code ? ` (${ingredient.ingredient_item_code})` : ""
          }`,
        }))
        .sort((left, right) =>
          left.label.localeCompare(right.label, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        ),
    [ingredientCatalog]
  );
  const filteredIngredientEditOptions = useMemo(() => {
    const query = normalizeMatchKey(ingredientEditLookupQuery);
    if (!query) {
      return ingredientEditOptions.slice(0, 12);
    }

    return ingredientEditOptions
      .map((option) => ({
        ...option,
        score: scoreIngredientSuggestion(
          {
            ingredient_name: option.label,
            ingredient_item_code: option.label,
            category: "",
            supplier: "",
          },
          ingredientEditLookupQuery
        ),
      }))
      .filter((option) => option.score > 0 || normalizeMatchKey(option.label).includes(query))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      })
      .slice(0, 12);
  }, [ingredientEditLookupQuery, ingredientEditOptions]);

  useEffect(() => {
    if (activeTab !== "ingredients") return;
    if (previousIngredientsTabOpenRef.current) return;
    previousIngredientsTabOpenRef.current = true;
    const navigationTargetId = ingredientNavigationTargetRef.current;
    if (navigationTargetId) {
      const targetedIngredient =
        ingredientMaster.find((ingredient) => ingredient.id === navigationTargetId) || null;
      if (targetedIngredient) {
        setActiveIngredientDraftId(navigationTargetId);
        setIngredientEditLookup(navigationTargetId);
        const matchedOption = ingredientEditOptions.find((option) => option.id === navigationTargetId);
        setIngredientEditLookupQuery(matchedOption?.label || "");
        ingredientNavigationTargetRef.current = null;
        return;
      }
      ingredientNavigationTargetRef.current = null;
    }
    const existingBlankRow = ingredientMaster.find((ingredient) =>
      isEmptyIngredientDraftRow(ingredient)
    );
    if (existingBlankRow) {
      setActiveIngredientDraftId(existingBlankRow.id);
      setIngredientEditLookup(existingBlankRow.id);
      setIngredientEditLookupQuery("");
      return;
    }
    const next = String(ingredientMaster.length + 1).padStart(3, "0");
    const nextId = `local-ingredient-${next}`;
    setActiveIngredientDraftId(nextId);
    setIngredientEditLookup(nextId);
    setIngredientEditLookupQuery("");
    setIngredientMaster((current) => [createBlankIngredientRow(nextId), ...current]);
  }, [activeTab, ingredientEditOptions, ingredientMaster]);

  useEffect(() => {
    if (activeTab !== "ingredients") {
      previousIngredientsTabOpenRef.current = false;
    }
  }, [activeTab]);
  const newRecipeDraftCost = useMemo(
    () => newRecipeDraft.components.reduce((sum, component) => sum + numberValue(component.cost), 0),
    [newRecipeDraft.components]
  );
  const newRecipeDraftRoundupTarget = useMemo(
    () => (newRecipeDraft.recipeType === "batch" ? 0 : calculateRoundupTarget(newRecipeDraftCost)),
    [newRecipeDraft.recipeType, newRecipeDraftCost]
  );

  const toggleIngredientSort = (column) => {
    if (ingredientSortColumn === column) {
      setIngredientSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setIngredientSortColumn(column);
    setIngredientSortDirection("asc");
  };

  const renderIngredientSortHeader = (label, column) => (
    <button
      type="button"
      className={`table-sort-button ${ingredientSortColumn === column ? "active" : ""}`}
      onClick={() => toggleIngredientSort(column)}
    >
      <span>{label}</span>
      <span className="table-sort-indicator">
        {ingredientSortColumn === column ? (ingredientSortDirection === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  const toggleRecipeSort = (column) => {
    if (recipeSortColumn === column) {
      setRecipeSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setRecipeSortColumn(column);
    setRecipeSortDirection("asc");
  };

  const renderRecipeSortHeader = (label, column) => (
    <button
      type="button"
      className={`table-sort-button ${recipeSortColumn === column ? "active" : ""}`}
      onClick={() => toggleRecipeSort(column)}
    >
      <span>{label}</span>
      <span className="table-sort-indicator">
        {recipeSortColumn === column ? (recipeSortDirection === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  const clearRecipeLookup = () => {
    setRecipeLookupQuery("");
  };

  const syncBatchIngredientsWithRecipes = () => {
    const batchRecipes = recipes.filter((recipe) => recipe.recipeType === "batch");
    const usedRecipeIds = new Set();
    let matchedCount = 0;
    let clearedCount = 0;
    let createdCount = 0;

    setIngredientMaster((current) => {
      const nextRows = current.map((ingredient) => {
        if ((ingredient.entry_type || "ingredient") !== "batch") {
          return ingredient;
        }

        const ingredientCode = normalizeCodeKey(ingredient.ingredient_item_code);
        const ingredientNameKey = normalizeMatchKey(ingredient.ingredient_name);
        const linkedById = ingredient.linked_recipe_id
          ? batchRecipes.find((recipe) => recipe.id === ingredient.linked_recipe_id)
          : null;
        const matchedRecipe =
          linkedById ||
          batchRecipes.find((recipe) => normalizeCodeKey(recipe.sellingItemCode || recipe.id) === ingredientCode) ||
          batchRecipes.find((recipe) => normalizeMatchKey(recipe.name) === ingredientNameKey) ||
          null;

        if (!matchedRecipe) {
          clearedCount += ingredient.linked_recipe_id ? 1 : 0;
          return {
            ...ingredient,
            linked_recipe_id: "",
          };
        }

        usedRecipeIds.add(matchedRecipe.id);
        matchedCount += 1;
          return {
            ...ingredient,
            ingredient_name: matchedRecipe.name || ingredient.ingredient_name,
            ingredient_item_code: matchedRecipe.sellingItemCode || ingredient.ingredient_item_code,
          unit_cost: getBatchUnitCost(matchedRecipe),
          pack_size: `${numberValue(matchedRecipe.batchYield)} ${getBatchYieldLabel(matchedRecipe)}`.trim(),
          supplier: matchedRecipe.restaurant || ingredient.supplier,
            category: matchedRecipe.category || ingredient.category || "Batch",
            entry_type: "batch",
            linked_recipe_id: matchedRecipe.id,
            last_updated: getTodayDateString(),
            is_locked: normalizeBooleanFlag(ingredient.is_locked),
          };
      });

      const missingBatchRows = batchRecipes
        .filter((recipe) => !usedRecipeIds.has(recipe.id))
        .filter((recipe) => {
          const recipeCode = normalizeCodeKey(recipe.sellingItemCode || recipe.id);
          const recipeNameKey = normalizeMatchKey(recipe.name);
          return !nextRows.some((ingredient) => {
            if ((ingredient.entry_type || "ingredient") !== "batch") return false;
            if (ingredient.linked_recipe_id === recipe.id) return true;
            if (recipeCode && normalizeCodeKey(ingredient.ingredient_item_code) === recipeCode) return true;
            return normalizeMatchKey(ingredient.ingredient_name) === recipeNameKey;
          });
        })
        .map((recipe, index) => {
          createdCount += 1;
          return {
            id: `linked-batch-${recipe.id}-${index + 1}`,
            ingredient_name: recipe.name,
            ingredient_item_code: recipe.sellingItemCode || recipe.id,
            unit_cost: getBatchUnitCost(recipe),
            pack_size: `${numberValue(recipe.batchYield)} ${getBatchYieldLabel(recipe)}`.trim(),
            supplier: recipe.restaurant || "",
            category: recipe.category || "Batch",
            last_updated: getTodayDateString(),
            entry_type: "batch",
            linked_recipe_id: recipe.id,
            is_locked: false,
          };
        });

      return [...nextRows, ...missingBatchRows];
    });

    setIngredientTypeFilter("batch");
    setSearch("");
    setIngredientUploadError("");
    setIngredientUploadMessage(
      `Batch link complete. Matched ${matchedCount} row${matchedCount === 1 ? "" : "s"}, added ${createdCount} missing batch ingredient row${createdCount === 1 ? "" : "s"}, cleared ${clearedCount} stale link${clearedCount === 1 ? "" : "s"}.`
    );
  };

  const updateMethodStep = (recipeId, stepIndex, value) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const methodSteps = [...(recipe.methodSteps || [])];
        methodSteps[stepIndex] = value;
        return enrichRecipeMetrics({ ...recipe, methodSteps, method: methodSteps.join("\n") });
      })
    );
  };

  const addMethodStep = (recipeId) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const methodSteps = [...getMethodSteps(recipe), ""];
        return enrichRecipeMetrics({ ...recipe, methodSteps, method: methodSteps.join("\n") });
      })
    );
  };

  const removeMethodStep = (recipeId, stepIndex) => {
    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked) return recipe;
        const methodSteps = getMethodSteps(recipe).filter((_, index) => index !== stepIndex);
        return enrichRecipeMetrics({ ...recipe, methodSteps, method: methodSteps.join("\n") });
      })
    );
  };

  const handleRecipeImportFiles = async (event) => {
    if (requireEditAccess()) return;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    try {
      const payload = await parseRecipeImportFiles({
        formatId: selectedImportFormat,
        files,
      });
      const normalized = normalizeImportedRecipeSource({
        formatId: selectedImportFormat,
        payload,
      });
      setImportPreview(normalized);
      setImportError("");
      if (normalized.output.Dish_Index) {
        setImportMessage(`Prepared ${normalized.output.Dish_Index.length} dish index rows for review.`);
      } else {
        setImportMessage(
          `Prepared ${normalized.output.Recipes.length} recipes and ${normalized.output.Recipe_Components.length} components for import.`
        );
      }
      setActiveTab("imports");
    } catch (error) {
      setImportPreview(null);
      setImportMessage("");
      setImportError(error.message || "Recipe import parsing failed.");
    } finally {
      event.target.value = "";
    }
  };

  const handleGoogleSheetsImport = async () => {
    if (requireEditAccess()) return;
    try {
      const urlEntries =
        selectedImportFormat === "normalized-workbook-pair"
          ? [
              { key: "recipes", name: "recipes.csv", url: googleSheetsUrls.recipes },
              {
                key: "recipe_components",
                name: "recipe_components.csv",
                url: googleSheetsUrls.recipe_components,
              },
            ]
          : [{ key: "recipes_flat", name: "recipes_flat.csv", url: googleSheetsUrls.recipes_flat }];

      const missingUrl = urlEntries.find((entry) => !entry.url.trim());
      if (missingUrl) {
        throw new Error("Please provide every required Google Sheets URL for this format.");
      }

      const responses = await Promise.all(
        urlEntries.map(async (entry) => {
          const response = await fetch(toGoogleSheetsCsvExportUrl(entry.url.trim()));
          if (!response.ok) {
            throw new Error(
              `Could not fetch ${entry.name}. Make sure the sheet is public or shared as anyone with the link can view.`
            );
          }
          return {
            name: entry.name,
            text: await response.text(),
            type: "csv",
          };
        })
      );

      const payload = parseRecipeImportContents({
        formatId: selectedImportFormat,
        contents: responses,
      });
      const normalized = normalizeImportedRecipeSource({
        formatId: selectedImportFormat,
        payload,
      });

      setImportPreview(normalized);
      setImportError("");
      setImportMessage(
        `Prepared ${normalized.output.Recipes.length} recipes and ${normalized.output.Recipe_Components.length} components from Google Sheets.`
      );
    } catch (error) {
      setImportPreview(null);
      setImportMessage("");
      setImportError(error.message || "Google Sheets import failed.");
    }
  };

  const applyRecipeImport = async () => {
    if (requireEditAccess()) return;
    if (!importPreview) return;

    if (importPreview.output.Dish_Index) {
      const importedDishIndexRows = importPreview.output.Dish_Index.map((row) => ({
        id: row.entry_id,
        sourceTab: row.source_tab,
        venue: normalizeVenueName(row.venue, row.source_tab),
        course: row.course,
        dishName: row.dish_name,
        oldFlag: row.old_flag,
        linkedRecipeId: "",
        reviewState: "",
        isArchived: false,
      }));
      setDishIndexRows((current) => mergeImportedDishIndexRows(current, importedDishIndexRows));
      setVenues((current) =>
        Array.from(
          new Set([
            ...current,
            ...importedDishIndexRows
              .map((row) => normalizeVenueName(row.venue, row.sourceTab))
              .filter((venue) => venue && venue !== "Blank" && venue !== "Batch"),
          ])
        )
      );
      setImportMessage(
        `Imported ${importedDishIndexRows.length} dish index rows. Review them in Queue.`
      );
      if (supabaseEnabled && supabase && importedDishIndexRows.length) {
        const { error, syncedCount } = await syncDishIndexCollectionToSupabase(importedDishIndexRows);
        if (error) {
          setImportError(`Imported dish index locally, but could not sync to Supabase: ${error.message}`);
        } else {
          setBackendStatus("Supabase connected");
          setImportMessage(
            `Imported ${importedDishIndexRows.length} dish index rows locally and synced ${syncedCount} to Supabase.`
          );
        }
      }
      setActiveTab("queue");
      return;
    }

    const importedRecipes = fromNormalizedImport(importPreview.output);
    const deletedSet = new Set(deletedIngredientSignatures);
    setIngredientMaster((current) => seedImportedIngredientRows(current, importedRecipes, deletedSet));
    setRecipes((current) => mergeImportedRecipes(current, importedRecipes, ingredientMaster));
    if (importedRecipes[0]?.id) {
      setSelectedRecipeId(importedRecipes[0].id);
    }
    setImportError("");
    setImportMessage(
      `Imported ${importedRecipes.length} recipes into the working dataset. Matching recipe IDs were replaced.`
    );

    if (supabaseEnabled && supabase && importedRecipes.length) {
      const { syncedCount, failed } = await syncRecipeCollectionToSupabase(importedRecipes);
      if (failed.length) {
        setImportError(
          `Imported locally, but ${failed.length} recipe sync${failed.length === 1 ? "" : "s"} to Supabase failed. First issue: ${
            failed[0].recipeName
          } - ${failed[0].message}`
        );
      } else {
        setBackendStatus("Supabase connected");
        setImportMessage(
          `Imported ${importedRecipes.length} recipes locally and synced ${syncedCount} to Supabase.`
        );
      }
    }
  };

  const buildRecipeCostSheetRows = (recipe) =>
    recipe.components.map((component) => {
      const matchedBatch =
        component.sourceRecipeId && component.sourceType === "batch"
          ? recipes.find((item) => item.id === component.sourceRecipeId) || null
          : null;
      const matchedIngredient =
        ingredientMaster.find(
          (ingredient) =>
            normalizeCodeKey(ingredient.ingredient_item_code) === normalizeCodeKey(component.code) ||
            normalizeMatchKey(ingredient.ingredient_name) === normalizeMatchKey(component.ingredient)
        ) || null;

      const sourceYieldType =
        component.sourceYieldType ||
        (matchedBatch
          ? matchedBatch.batchYieldType || ""
          : matchedIngredient
            ? getIngredientPricingSource(matchedIngredient).sourceYieldType
            : "");
      const unitOfMeasure =
        sourceYieldType === "kg"
          ? "Kg"
          : sourceYieldType === "g"
            ? "g"
            : sourceYieldType === "l"
              ? "L"
              : sourceYieldType === "ml"
                ? "ml"
                : sourceYieldType === "portion"
                  ? "Portion"
                  : sourceYieldType === "tray"
                    ? "Tray"
                    : sourceYieldType === "jar"
                      ? "Jar"
                      : sourceYieldType === "bottle"
                        ? "Bottle"
                        : matchedIngredient
                          ? "Kg"
                          : "Pcs";
      const sourceUnitCost =
        numberValue(component.sourceUnitCost) ||
        (matchedBatch
          ? getBatchUnitCost(matchedBatch)
          : matchedIngredient
            ? getIngredientPricingSource(matchedIngredient).sourceUnitCost
            : 0);

      return {
        ingredientCode: component.code || "",
        description: component.ingredient || "",
        unitOfMeasure,
        unitPrice: money(sourceUnitCost),
        quantityUsed: formatQuantityCell(component.qty),
        rawQty: component.qty,
        cost: money(component.cost),
      };
    });

  const openRecipeCostSheetForRecipe = (recipe, options = {}) => {
    const componentRows = buildRecipeCostSheetRows(recipe);
    setExportPreview({
      title: `${recipe.name} cost sheet`,
      html: buildRecipeCostSheetHtml(recipe, componentRows),
      csvContent: buildRecipeCostSheetCsv(recipe, componentRows),
      csvFileName: `${normalizeMatchKey(recipe.name || recipe.id).replace(/\s+/g, "-") || "recipe"}-cost-sheet.csv`,
      autoPrint: Boolean(options.print),
    });
  };

  const openChefSheetPreviewForRecipe = (recipe, options = {}) => {
    setExportPreview({
      title: `${recipe.name} chef sheet`,
      html: buildChefPrintSheetHtml(recipe),
      csvContent: "",
      csvFileName: "",
      autoPrint: Boolean(options.print),
    });
  };

  const closeExportPreview = () => setExportPreview(null);

  const downloadExportPreviewCsv = () => {
    if (!exportPreview?.csvContent) return;
    const blob = new Blob([exportPreview.csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportPreview.csvFileName || "recipe-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const printExportPreview = () => {
    const frame = exportPreviewFrameRef.current;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const findBatchRecipeMatch = (component) =>
    (component.sourceType === "batch" && component.sourceRecipeId
      ? recipes.find((item) => item.id === component.sourceRecipeId)
      : null) ||
    recipes.find(
      (item) =>
        item.recipeType === "batch" &&
        normalizeCodeKey(item.sellingItemCode || item.id) === normalizeCodeKey(component.code)
    ) ||
    null;

  const findIngredientMasterMatch = (component) => {
    return findBestIngredientMatch(ingredientMaster, component.code, component.ingredient);
  };

  const openIngredientQuickPanel = (ingredient) => {
    if (!ingredient) return;
    setQuickPanel({
      type: "ingredient",
      ingredientId: ingredient.id,
    });
  };

  const openBatchQuickPanel = (recipe) => {
    if (!recipe) return;
    setQuickPanel({
      type: "batch",
      recipeId: recipe.id,
    });
  };

  const importBundledBatchWorkbook = async () => {
    if (requireEditAccess()) return;
    try {
      const response = await fetch("/batchs.xlsx");
      if (!response.ok) {
        throw new Error("Could not load the bundled batch workbook.");
      }
      const blob = await response.blob();
      const file = new File([blob], "batchs.xlsx", { type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const payload = await parseRecipeImportFiles({
        formatId: "batch-workbook-wide",
        files: [file],
      });
      const normalized = normalizeImportedRecipeSource({
        formatId: "batch-workbook-wide",
        payload,
      });
      const importedRecipes = fromNormalizedImport(normalized.output);
      const deletedSet = new Set(deletedIngredientSignatures);
      setIngredientMaster((current) => seedImportedIngredientRows(current, importedRecipes, deletedSet));
      setRecipes((current) => mergeImportedRecipes(current, importedRecipes, ingredientMaster));
      setActiveTab("recipes");
      setRestaurant("all");
      setRecipeListTypeFilter("batch");
      setSelectedRecipeId(importedRecipes[0]?.id || null);
      setImportPreview(normalized);
      setImportError("");
      setImportMessage(
        `Re-imported ${importedRecipes.length} batch recipes from batchs.xlsx and switched the recipe list to batch view.`
      );

      if (supabaseEnabled && supabase && importedRecipes.length) {
        const { syncedCount, failed } = await syncRecipeCollectionToSupabase(importedRecipes);
        if (failed.length) {
          setImportError(
            `Re-imported locally, but ${failed.length} batch recipe sync${failed.length === 1 ? "" : "s"} to Supabase failed. First issue: ${
              failed[0].recipeName
            } - ${failed[0].message}`
          );
        } else {
          setBackendStatus("Supabase connected");
          setImportMessage(
            `Re-imported ${importedRecipes.length} batch recipes locally and synced ${syncedCount} to Supabase.`
          );
        }
      }
    } catch (error) {
      setImportError(error.message || "Batch workbook import failed.");
      setImportMessage("");
    }
  };

  const syncBchRecipeLinks = () => {
    if (requireEditAccess()) return;
    setRecipes((current) => linkBatchReferences(current));
    setImportMessage("Linked BCH-coded dish components to the imported batch recipe records.");
    setImportError("");
  };

  const jumpToLinkedBatchRecipe = (component) => {
    const matchedBatch = findBatchRecipeMatch(component);

    if (!matchedBatch) {
      setImportError("Could not find the linked batch recipe for this BCH component.");
      setImportMessage("");
      return;
    }
    openRecipeInBuilder(matchedBatch.id);
    setImportError("");
    setImportMessage(`Opened linked batch recipe ${matchedBatch.name}.`);
  };

  const jumpToIngredientRecord = (component) => {
    const matchedIngredient = findIngredientMasterMatch(component);
    if (matchedIngredient) {
      if (selectedRecipeId) {
        setIngredientReturnTarget({
          recipeId: selectedRecipeId,
          recipeName: selectedRecipe?.name || "",
        });
      }
      openIngredientInCatalogue(matchedIngredient);
      return;
    }
    if (selectedRecipeId) {
      setIngredientReturnTarget({
        recipeId: selectedRecipeId,
        recipeName: selectedRecipe?.name || "",
      });
    }
    const nextId = `local-ingredient-${String(ingredientMaster.length + 1).padStart(3, "0")}`;
    const draftedIngredient = {
      ...createBlankIngredientRow(nextId),
      ingredient_name: component.ingredient || "",
      ingredient_item_code: component.code || "",
      supplier: selectedRecipe?.restaurant || "",
      category: selectedRecipe?.category || "",
    };
    setIngredientMaster((current) => [draftedIngredient, ...current]);
    openIngredientsWorkspace({
      typeFilter: "ingredient",
      batchLinkFilter: "all",
      columnFilter: "all-columns",
      searchText: "",
      targetIngredient: draftedIngredient,
      preserveReturnTarget: true,
    });
    setIngredientUploadError("");
    setIngredientUploadMessage(
      `Started a new ingredient from component ${component.ingredient || component.code || component.id}.`
    );
  };

  const returnToIngredientSourceRecipe = () => {
    if (!ingredientReturnTarget?.recipeId) return;
    setSelectedRecipeId(ingredientReturnTarget.recipeId);
    setBuilderMode("edit");
    setActiveTab("builder");
  };

  const openIngredientsWorkspace = ({
    typeFilter = "all",
    batchLinkFilter = "all",
    columnFilter = "all-columns",
    searchText = "",
    targetIngredient = null,
    targetLabel = "",
    preserveReturnTarget = false,
  } = {}) => {
    ingredientNavigationTargetRef.current = targetIngredient?.id || null;
    setIngredientTypeFilter(typeFilter);
    setIngredientBatchLinkFilter(batchLinkFilter);
    setIngredientColumnFilter(columnFilter);
    setSearch(searchText);
    setIngredientEditLookup(targetIngredient?.id || "");
    setActiveIngredientDraftId(targetIngredient?.id || null);
    setIngredientEditLookupQuery(targetLabel || "");
    setIngredientEditLookupOpen(false);
    if (!preserveReturnTarget) {
      setIngredientReturnTarget(null);
    }
    setActiveTab("ingredients");
  };

  const focusIngredientDraft = (ingredientId, label = "") => {
    setIngredientEditLookup(ingredientId || "");
    setActiveIngredientDraftId(ingredientId || null);
    if (label) {
      setIngredientEditLookupQuery(label);
    }
    setIngredientEditLookupOpen(false);
  };

  const openIngredientInCatalogue = (ingredient) => {
    const label = `${ingredient.ingredient_name || "Unnamed ingredient"}${
      ingredient.ingredient_item_code ? ` (${ingredient.ingredient_item_code})` : ""
    }`;
    if (activeTab === "ingredients") {
      focusIngredientDraft(ingredient.id || "", label);
      return;
    }
    openIngredientsWorkspace({
      typeFilter: (ingredient.entry_type || "ingredient") === "batch" ? "batch" : "ingredient",
      batchLinkFilter: "all",
      columnFilter: "all-columns",
      searchText: ingredient.ingredient_item_code || ingredient.ingredient_name || "",
      targetIngredient: ingredient,
      targetLabel: label,
      preserveReturnTarget: true,
    });
  };

  const focusIngredientCatalogueRow = (ingredientId) => {
    if (!ingredientId) return;
    const matchedIngredient =
      ingredientMaster.find((ingredient) => ingredient.id === ingredientId) || null;
    setActiveIngredientDraftId(ingredientId);
    setIngredientEditLookup(ingredientId);
    setIngredientEditLookupQuery(
      matchedIngredient
        ? `${matchedIngredient.ingredient_name || "Unnamed ingredient"}${
            matchedIngredient.ingredient_item_code ? ` (${matchedIngredient.ingredient_item_code})` : ""
          }`
        : ""
    );
    setIngredientEditLookupOpen(false);
  };

  const addMenu = () => {
    if (requireEditAccess()) return;
    const next = String(menus.length + 1).padStart(3, "0");
    const nextVenue =
      restaurant === "all"
        ? venueOptions[0] || `${recipes[0]?.restaurant || "Tasi"} lunch`
        : `${restaurant} lunch`;
    const menu = {
      id: `LOCAL-MENU-${next}`,
      name: "New Menu",
      restaurant: nextVenue,
      guestCount: 40,
      targetGp: 0.75,
      isLiveMenu: false,
      lines: [],
    };
    setMenus((current) => [...current, menu]);
    setSelectedMenuId(menu.id);
  };

  const updateMenuField = (menuId, field, value) => {
    setMenus((current) => {
      const selected = current.find((item) => item.id === menuId);
      const nextRestaurant =
        field === "restaurant" ? value : selected?.restaurant || "";

      return current.map((menu) => {
        if (menu.id === menuId) {
          return { ...menu, [field]: value };
        }

        if (
          field === "isLiveMenu" &&
          value === true &&
          menu.restaurant === nextRestaurant
        ) {
          return { ...menu, isLiveMenu: false };
        }

        if (
          field === "restaurant" &&
          selected?.isLiveMenu &&
          menu.restaurant === value
        ) {
          return { ...menu, isLiveMenu: false };
        }

        return menu;
      });
    });
  };

  const addMenuLine = () => {
    if (!selectedMenu) return;
    const menuBaseVenue = getBaseVenueName(selectedMenu.restaurant);
    const venueRecipes = recipes.filter(
      (recipe) =>
        recipe.recipeType !== "batch" &&
        (recipe.restaurant === menuBaseVenue || selectedMenu.restaurant === "")
    );
    const recipe = venueRecipes[0] || recipes[0];
    const nextSort = selectedMenu.lines.length + 1;
    setMenus((current) =>
      current.map((menu) =>
        menu.id === selectedMenu.id
          ? {
              ...menu,
              lines: [
                ...menu.lines,
                {
                  id: `${menu.id}-${nextSort}`,
                  courseLabel: `Course ${nextSort}`,
                  recipeId: recipe?.id || "",
                  dishName: recipe?.name || "",
                  restaurant: recipe?.restaurant || menu.restaurant,
                  lineCost: recipe?.recipeCost || 0,
                  lineSalePrice: recipe?.currentSalePrice || 0,
                  category: recipe?.category || "",
                },
              ],
            }
          : menu
      )
    );
  };

  const updateMenuLine = (menuId, lineId, field, value) => {
    setMenus((current) =>
      current.map((menu) => {
        if (menu.id !== menuId) return menu;
        return {
          ...menu,
          lines: menu.lines.map((line) => {
            if (line.id !== lineId) return line;
            if (field === "recipeId") {
              const recipe = recipes.find((item) => item.id === value);
              return {
                ...line,
                recipeId: value,
                dishName: recipe?.name || "",
                restaurant: recipe?.restaurant || menu.restaurant,
                lineCost: recipe?.recipeCost || 0,
                lineSalePrice: recipe?.currentSalePrice || 0,
                category: recipe?.category || "",
              };
            }
            return { ...line, [field]: value };
          }),
        };
      })
    );
  };

  const removeMenuLine = (menuId, lineId) => {
    setMenus((current) =>
      current.map((menu) =>
        menu.id === menuId
          ? { ...menu, lines: menu.lines.filter((line) => line.id !== lineId) }
          : menu
      )
    );
  };

  const goBackToPreviousPage = () => {
    setPageHistory((current) => {
      if (!current.length) return current;
      const nextHistory = [...current];
      const previousTab = nextHistory.pop();
      previousActiveTabRef.current = previousTab || activeTab;
      if (previousTab) {
        setActiveTab(previousTab);
      }
      return nextHistory;
    });
  };

  const resetAppToSeedData = () => {
    if (typeof window !== "undefined") {
      [
        INGREDIENT_MASTER_STORAGE_KEY,
        DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY,
        RECIPES_STORAGE_KEY,
        MENUS_STORAGE_KEY,
        VENUES_STORAGE_KEY,
        DISH_INDEX_STORAGE_KEY,
        BCH_AUDIT_STORAGE_KEY,
      ].forEach((storageKey) => window.localStorage.removeItem(storageKey));
    }

    const seededRecipes = createRecipes().map((recipe) => enrichRecipeMetrics(recipe));
    const seededMenus = createMenus(seededRecipes);
    setDeletedIngredientSignatures([]);
    setIngredientMaster([]);
    setRecipes(seededRecipes);
    setMenus(seededMenus);
    setVenues([...DEFAULT_VENUES]);
    setDishIndexRows([]);
    setBchAuditDecisions([]);
    setSelectedRecipeId(seededRecipes[0]?.id || null);
    setSelectedMenuId(seededMenus[0]?.id || null);
    setActiveTab("queue");
    setImportError("");
    setImportMessage("Reset browser-stored test data and restored the workbook-backed seed state.");
  };

  if (supabaseEnabled && authLoading) {
    return (
      <div className="app-page">
        <div className="app-shell">
          <Card className="auth-card">
            <div className="eyebrow">Peligoni internal tool</div>
            <h1>Recipe Cost Calculator</h1>
            <p className="support-text">Checking your Supabase session…</p>
          </Card>
        </div>
      </div>
    );
  }

  if (supabaseEnabled && !authUser) {
    return (
      <div className="app-page">
        <div className="app-shell">
          <Card className="auth-card">
            <div className="eyebrow">Peligoni internal tool</div>
            <h1>Sign in to continue</h1>
            <p className="support-text">
              Use your Supabase email and password. For now, new users should be created in the Supabase dashboard.
            </p>
            <form className="support-stack" onSubmit={handleSignIn}>
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="you@peligoni.com"
                  autoComplete="email"
                />
              </label>
              <label className="form-field">
                <span>Password</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </label>
              <div className="upload-actions">
                <button type="submit" className="primary-button">
                  Sign in
                </button>
              </div>
              {authError ? <p className="support-text error-text">{authError}</p> : null}
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <div className="app-shell">
        <div className="page-header">
          <div>
            <div className="eyebrow">Peligoni internal tool</div>
            <h1>Recipe Cost Calculator</h1>
            <p>
              Workbook-backed first version using the verified normalized spreadsheet, presented in the
              tabbed card layout you sketched.
            </p>
            <p className="support-text">{backendStatus}</p>
            {supabaseEnabled && authUser ? (
              <p className="support-text">
                Signed in as {authProfile?.full_name || authUser.email || "user"} · role: {currentUserRole}
              </p>
            ) : null}
            {authProfile?.profileError ? (
              <p className="support-text error-text">
                Profile lookup issue: {authProfile.profileError}
              </p>
            ) : null}
          </div>
          <div className="page-header-actions">
            {supabaseEnabled && authUser ? (
              <>
                <a href={FOOD_APP_URL} className="secondary-button">Food app</a>
                <a href={DRINKS_APP_URL} className="secondary-button">Drinks app</a>
              </>
            ) : null}
            {supabaseEnabled && authUser ? (
              <button
                type="button"
                className="secondary-button"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={resetAppToSeedData}
            >
              Reset test data
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={goBackToPreviousPage}
              disabled={!pageHistory.length}
            >
              <Icon name="back" />
              Back
            </button>
          </div>
        </div>

        {supabaseEnabled && authUser && !canEditSharedData ? (
          <div className="callout callout-default">
            <strong>Viewer mode</strong>
            <span>You can review data, but only editors and managers can make shared changes.</span>
          </div>
        ) : null}

        <div className="stats-grid">
          <StatCard
            label="Queue items"
            value={queueTotal}
            onClick={() => {
              setActiveTab("queue");
            }}
          />
          <StatCard
            label="Recipes"
            value={summary.recipeCount}
            onClick={() => {
              setActiveTab("recipes");
              setReviewFilter("all");
              setRecipeListTypeFilter("all");
            }}
          />
          <StatCard
            label="Needs review"
            value={reviewCounts.needsReview}
            tone={reviewCounts.needsReview ? "negative" : ""}
            onClick={() => {
              setActiveTab("queue");
            }}
          />
          <StatCard
            label="Live dishes"
            value={reviewCounts.live}
            onClick={() => {
              setActiveTab("recipes");
              setReviewFilter("live");
              setRecipeListTypeFilter("dish");
            }}
          />
        </div>

        <div className="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon name={tab.icon} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "recipes" ? (
          <div className="toolbar toolbar-below-tabs">
            <div className="search-box">
              <span className="search-icon"><Icon name="search" /></span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dish, code or ingredient"
              />
            </div>
            <select value={restaurant} onChange={(event) => setRestaurant(event.target.value)}>
              {restaurants.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "All venues" : item}
                </option>
              ))}
            </select>
            <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}>
              <option value="all">All recipes</option>
              <option value="needs-review">Needs review</option>
              <option value="warning">Warnings</option>
              <option value="ready">Ready</option>
              <option value="live">Live only</option>
            </select>
            <button
              type="button"
              className="secondary-button"
              onClick={() => openIngredientsWorkspace()}
            >
              Ingredients
            </button>
          </div>
        ) : null}

        {activeTab === "queue" && (
          <div className="tab-panel">
            <div className="stats-grid">
              <StatCard label="Recipes to review" value={queueRecipes.length} onClick={() => setActiveTab("recipes")} />
              <StatCard
                label="Ingredients to review"
                value={queueIngredients.length}
                onClick={() => openIngredientsWorkspace()}
              />
              <StatCard
                label="Dish matches to resolve"
                value={queueDishIndex.length}
                onClick={() => {
                  setShowArchivedDishIndexRows(false);
                  setActiveTab("dish-index");
                }}
              />
              <StatCard
                label="BCH audit items"
                value={bchAuditSummary.total}
                tone={bchAuditSummary.missing || bchAuditSummary.needsReview ? "warning" : ""}
                onClick={() => setActiveTab("bch-audit")}
              />
              <StatCard label="Live dishes" value={reviewCounts.live} onClick={() => {
                setActiveTab("recipes");
                setReviewFilter("live");
              }} />
            </div>

            <div className="panel-stack">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Queue</div>
                    <h2>Recipes needing attention</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setActiveTab("recipes");
                      setReviewFilter("all");
                    }}
                  >
                    Open recipes
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="recipe-list-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        <th>Recipe</th>
                        <th>Status</th>
                        <th>Issue</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueRecipes.slice(0, 12).map((recipe) => (
                        <tr key={recipe.id}>
                          <td>{getRecipeVenueLabel(recipe)}</td>
                          <td className="strong-cell">{recipe.name}</td>
                          <td>
                            <Badge tone={recipe.validation.reviewStatus === "needs-review" ? "bad" : "warn"}>
                              {recipe.validation.reviewStatus === "needs-review" ? "Needs review" : "Warning"}
                            </Badge>
                          </td>
                          <td>{recipe.validation.issues[0]?.text || "Draft or incomplete"}</td>
                          <td>
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              onClick={() => openRecipeInBuilder(recipe.id)}
                            >
                              Open recipe
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!queueRecipes.length ? (
                        <tr>
                          <td colSpan="5" className="empty-cell">No recipes are waiting for review.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Queue</div>
                    <h2>Ingredients needing attention</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openIngredientsWorkspace()}
                  >
                    Open ingredients
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="dish-index-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Ingredient</th>
                        <th>Code</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueIngredients.slice(0, 12).map((ingredient) => (
                        <tr key={ingredient.id}>
                          <td>{ingredient.entry_type === "batch" ? "Batch" : "Ingredient"}</td>
                          <td className="strong-cell">{ingredient.ingredient_name}</td>
                          <td>{ingredient.ingredient_item_code || "Missing"}</td>
                          <td>
                            <Badge tone={ingredient.validation.reviewStatus === "needs-review" ? "bad" : "warn"}>
                              {ingredient.validation.reviewStatus === "needs-review" ? "Needs review" : "Check"}
                            </Badge>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              onClick={() => openIngredientInCatalogue(ingredient)}
                            >
                              Open ingredient
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!queueIngredients.length ? (
                        <tr>
                          <td colSpan="5" className="empty-cell">No ingredients are waiting for review.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Queue</div>
                    <h2>Dish matches to resolve</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setActiveTab("dish-index")}
                  >
                    Open dish matcher
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="dish-index-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        <th>Course</th>
                        <th>Dish</th>
                        <th>Match</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueDishIndex.slice(0, 12).map((row) => (
                        <tr key={row.id}>
                          <td>{row.venue || "Blank"}</td>
                          <td>{row.course || "Uncategorised"}</td>
                          <td className="strong-cell">{row.dishName}</td>
                          <td>
                            <Badge tone={row.match.status === "possible" ? "warn" : "bad"}>
                              {row.match.status === "possible" ? "Possible match" : "Missing recipe"}
                            </Badge>
                          </td>
                          <td>
                            {row.match.recipe ? (
                              <button
                                type="button"
                                className="secondary-button table-action-button"
                                onClick={() => openRecipeInBuilder(row.match.recipe.id)}
                              >
                                Open match
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="secondary-button table-action-button"
                                onClick={() => createRecipeFromDishIndex(row)}
                              >
                                Create recipe
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!queueDishIndex.length ? (
                        <tr>
                          <td colSpan="5" className="empty-cell">No dish matches are waiting for review.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Queue</div>
                    <h2>BCH audit</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setActiveTab("bch-audit")}
                  >
                    Open BCH audit
                  </button>
                </div>
                <div className="badge-row compact">
                  <Badge tone={bchAuditSummary.missing ? "warn" : "good"}>
                    {bchAuditSummary.linked} linked batch recipe{bchAuditSummary.linked === 1 ? "" : "s"}
                  </Badge>
                  <Badge tone={bchAuditSummary.missing ? "bad" : "default"}>
                    {bchAuditSummary.missing} missing parent batch recipe{bchAuditSummary.missing === 1 ? "" : "s"}
                  </Badge>
                  <Badge tone={bchAuditSummary.needsReview ? "warn" : "default"}>
                    {bchAuditSummary.needsReview} need classification review
                  </Badge>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "recipes" && (
          <div className="tab-panel">
            <div className="panel-actions">
              <select
                value={recipeListTypeFilter}
                onChange={(event) => setRecipeListTypeFilter(event.target.value)}
              >
                <option value="all">All recipe types</option>
                <option value="dish">Dish recipes</option>
                <option value="batch">Batch recipes</option>
              </select>
              <button type="button" className="secondary-button" onClick={importBundledBatchWorkbook}>
                Re-import batch workbook
              </button>
              <button type="button" className="secondary-button" onClick={syncBchRecipeLinks}>
                Link BCH components
              </button>
              <button type="button" className="primary-button" onClick={addRecipe}>
                <Icon name="plus" />
                Add recipe
              </button>
            </div>
            {importMessage ? <p className="support-text success-text">{importMessage}</p> : null}
            {importError ? <p className="support-text error-text">{importError}</p> : null}

            <div className="panel-stack">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Recipes</div>
                    <h2>Recipe list</h2>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="recipe-list-table">
                    <thead>
                      <tr>
                        <th>{renderRecipeSortHeader("Lock", "lock")}</th>
                        <th>{renderRecipeSortHeader("Venue", "venue")}</th>
                        <th>{renderRecipeSortHeader("Dish", "dish")}</th>
                        <th>{renderRecipeSortHeader("Category", "category")}</th>
                        <th>{renderRecipeSortHeader("Code", "code")}</th>
                        <th>{renderRecipeSortHeader("Status", "status")}</th>
                        <th>{renderRecipeSortHeader("Recipe cost", "recipe-cost")}</th>
                        <th>{renderRecipeSortHeader("Sale price", "sale-price")}</th>
                        <th>{renderRecipeSortHeader("GP", "gp")}</th>
                        <th>Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeListRows.map((recipe) => (
                      <tr
                        key={recipe.id}
                        className="clickable-row"
                        onClick={() => {
                            setSelectedRecipeId(recipe.id);
                            setRecipeEditLookup(recipe.id);
                            setBuilderMode("edit");
                            setActiveTab("builder");
                          }}
                        >
                          <td className="lock-cell" onClick={(event) => event.stopPropagation()}>
                            <label className="lock-toggle" aria-label={`Lock ${recipe.name || "recipe"}`}>
                              <input
                                type="checkbox"
                                checked={Boolean(recipe.isLocked)}
                                onChange={(event) =>
                                  updateRecipeField(recipe.id, "isLocked", event.target.checked)
                                }
                              />
                            </label>
                          </td>
                          <td>{getRecipeVenueLabel(recipe)}</td>
                          <td className="strong-cell">{recipe.name}</td>
                          <td>{recipe.category}</td>
                          <td>{recipe.sellingItemCode}</td>
                          <td>
                            <div className="badge-row compact">
                              {recipe.recipeType === "batch" ? <Badge tone="default">Batch</Badge> : null}
                              <Badge
                                tone={
                                  recipe.validation.reviewStatus === "needs-review"
                                    ? "bad"
                                    : recipe.validation.reviewStatus === "warning"
                                      ? "warn"
                                      : "good"
                                }
                              >
                              {recipe.validation.reviewStatus === "needs-review"
                                  ? "Needs review"
                                  : recipe.validation.reviewStatus === "warning"
                                    ? "Warning"
                                    : "Ready"}
                              </Badge>
                              {recipe.workflowStage === "draft" ? <Badge tone="default">Draft</Badge> : null}
                              {recipe.isLocked ? <Badge tone="default">Locked</Badge> : null}
                              {recipe.isLive && recipe.recipeType !== "batch" ? <Badge tone="good">Live</Badge> : null}
                              {restaurantLiveRecipeIds.has(recipe.id) ? <Badge tone="default">On live menu</Badge> : null}
                            </div>
                          </td>
                          <td>{money(recipe.recipeCost)}</td>
                          <td>{recipe.recipeType === "batch" ? "Batch" : money(recipe.currentSalePrice)}</td>
                          <td>
                            {recipe.recipeType === "batch" ? (
                              <Badge tone="default">{money(getBatchUnitCost(recipe))}/{getBatchYieldLabel(recipe)}</Badge>
                            ) : (
                              <Badge tone={recipe.gp >= 0.75 ? "good" : recipe.gp >= 0.6 ? "warn" : "bad"}>
                                {percent(recipe.gp)}
                              </Badge>
                            )}
                          </td>
                          <td onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              disabled={recipe.isLocked}
                              onClick={() => deleteRecipe(recipe)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "builder" && (
          <div className="tab-panel">
            <div className="builder-mode-bar">
              <button
                type="button"
                className={`tab-button ${builderMode === "edit" ? "active" : ""}`}
                onClick={() => setBuilderMode("edit")}
              >
                Edit existing
              </button>
              <button
                type="button"
                className={`tab-button ${builderMode === "create" ? "active" : ""}`}
                onClick={() => {
                  setBuilderMode("create");
                  resetNewRecipeDraft(newRecipeDraft.recipeType || "dish");
                }}
              >
                Create new
              </button>
            </div>
            {builderMode === "create" ? (
              <div className="panel-stack">
                <Card>
                  <div className="card-header">
                    <div>
                      <div className="eyebrow">New recipe builder</div>
                      <h2>Create dish or batch</h2>
                    </div>
                    <div className="badge-row compact">
                      <Badge tone="default">
                        {newRecipeDraft.recipeType === "batch" ? "Batch recipe" : "Dish recipe"}
                      </Badge>
                      {newRecipeDraft.recipeType === "batch" ? (
                        <Badge tone="good">{newRecipeDraft.sellingItemCode?.trim() || getNextBatchCode()}</Badge>
                      ) : null}
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setBuilderMode("edit")}
                      >
                        Find recipe to edit
                      </button>
                    </div>
                  </div>

                  <div className="builder-summary-banner">
                    <div>
                      <div className="mini-heading">Draft cost</div>
                      <strong>{money(newRecipeDraftCost)}</strong>
                    </div>
                    {newRecipeDraft.recipeType !== "batch" ? (
                      <div>
                        <div className="mini-heading">Auto roundup target</div>
                        <strong>{money(newRecipeDraftRoundupTarget)}</strong>
                      </div>
                    ) : null}
                    <div>
                      <div className="mini-heading">
                        {newRecipeDraft.recipeType === "batch" ? "Generated code" : "Selected venue"}
                      </div>
                      <strong>
                        {newRecipeDraft.recipeType === "batch"
                          ? newRecipeDraft.sellingItemCode || getNextBatchCode()
                          : newRecipeDraft.restaurant || "Missing"}
                      </strong>
                    </div>
                    <div>
                      <div className="mini-heading">Components</div>
                      <strong>{newRecipeDraft.components.length}</strong>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Recipe type</span>
                      <select
                        value={newRecipeDraft.recipeType}
                        onChange={(event) => updateNewRecipeField("recipeType", event.target.value)}
                      >
                        <option value="dish">Dish recipe</option>
                        <option value="batch">Batch recipe</option>
                      </select>
                    </label>
                    <label>
                      <span>Name</span>
                      <input
                        value={newRecipeDraft.name}
                        onChange={(event) => updateNewRecipeField("name", event.target.value)}
                        placeholder={newRecipeDraft.recipeType === "batch" ? "Tzatziki batch" : "Greek salad"}
                      />
                    </label>
                    <label>
                      <span>Category</span>
                      <input
                        value={newRecipeDraft.category}
                        onChange={(event) => updateNewRecipeField("category", event.target.value)}
                        placeholder={newRecipeDraft.recipeType === "batch" ? "Batch" : "Starters"}
                      />
                    </label>
                    <label>
                      <span>{newRecipeDraft.recipeType === "batch" ? "Batch code" : "Item code"}</span>
                      <input
                        value={newRecipeDraft.sellingItemCode}
                        onChange={(event) => updateNewRecipeField("sellingItemCode", event.target.value)}
                        placeholder={newRecipeDraft.recipeType === "batch" ? `${getNextBatchCode()} if blank` : "Item code"}
                      />
                    </label>
                    {newRecipeDraft.recipeType !== "batch" ? (
                      <>
                        <label>
                          <span>Venue</span>
                          <select
                            value={newRecipeDraft.restaurant}
                            onChange={(event) => updateNewRecipeField("restaurant", event.target.value)}
                          >
                            {venues.map((venue) => (
                              <option key={venue} value={venue}>
                                {venue}
                              </option>
                            ))}
                            <option value="">Blank</option>
                          </select>
                        </label>
                        <label>
                          <span>Sale price</span>
                          <DecimalInput
                            value={newRecipeDraft.currentSalePrice}
                            onCommit={(value) => updateNewRecipeField("currentSalePrice", value)}
                          />
                        </label>
                        <label>
                          <span>Portions made</span>
                          <input
                            value={newRecipeDraft.portionCount}
                            onChange={(event) => updateNewRecipeField("portionCount", numberValue(event.target.value))}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label>
                          <span>Batch yield</span>
                          <input
                            value={newRecipeDraft.batchYield}
                            onChange={(event) => updateNewRecipeField("batchYield", numberValue(event.target.value))}
                          />
                        </label>
                        <label>
                          <span>Yield type</span>
                          <select
                            value={newRecipeDraft.batchYieldType}
                            onChange={(event) => updateNewRecipeField("batchYieldType", event.target.value)}
                          >
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                            <option value="ml">ml</option>
                            <option value="l">l</option>
                            <option value="portion">portion</option>
                            <option value="tray">tray</option>
                            <option value="bottle">bottle</option>
                            <option value="jar">jar</option>
                          </select>
                        </label>
                      </>
                    )}
                    <label>
                      <span>Roundup target</span>
                      <input
                        value={
                          newRecipeDraft.recipeType === "batch"
                            ? "Batch recipes do not use roundup"
                            : money(newRecipeDraftRoundupTarget)
                        }
                        readOnly
                      />
                    </label>
                  </div>

                  <div className="section-row">
                    <div>
                      <div className="eyebrow">Components</div>
                      <h3>Build the recipe structure</h3>
                      <p className="support-text">
                        Type free text, or choose from ingredient and batch suggestions to link a source.
                      </p>
                    </div>
                    <button type="button" className="secondary-button" onClick={addNewDraftComponent}>
                      <Icon name="plus" />
                      Add component
                    </button>
                  </div>

                  <div className="component-stack">
                    {newRecipeDraft.components.map((component) => {
                      const componentReadOnly = isParentLinkedComponent(component);
                      return (
                        <div key={component.id} className="component-card">
                          <div className="component-meta">
                            <div className="badge-row compact">
                              <Badge tone="default">#{component.sort}</Badge>
                              {component.sourceType === "batch" ? <Badge tone="good">Linked batch</Badge> : null}
                              {component.sourceType === "ingredient-master" ? <Badge tone="default">Linked ingredient</Badge> : null}
                              {componentReadOnly ? <Badge tone="default">Managed by parent batch</Badge> : null}
                            </div>
                            <button
                              type="button"
                              className="icon-button"
                              disabled={componentReadOnly}
                              onClick={() => removeNewDraftComponent(component.id)}
                              aria-label="Remove component"
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                          <label>
                            <span>Ingredient</span>
                            <input
                              disabled={componentReadOnly}
                              value={component.ingredient}
                              onChange={(event) => updateNewComponentField(component.id, "ingredient", event.target.value)}
                              onFocus={() => !componentReadOnly && setActiveDraftLookupId(component.id)}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveDraftLookupId((current) => (current === component.id ? null : current));
                                }, 120);
                              }}
                              placeholder="Ingredient"
                            />
                            {activeDraftLookupId === component.id && !componentReadOnly && draftIngredientSuggestions.length ? (
                              <div className="lookup-panel">
                                {draftIngredientSuggestions.map((ingredient) => (
                                  <button
                                    key={ingredient.id}
                                    type="button"
                                    className="lookup-option"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      applyIngredientMatchToDraft(component.id, ingredient);
                                    }}
                                  >
                                    <div className="lookup-main">
                                      <strong>{ingredient.ingredient_name}</strong>
                                      <span>{ingredient.ingredient_item_code}</span>
                                    </div>
                                    <div className="lookup-meta">
                                      <span>{money(ingredient.unit_cost)}</span>
                                      <span>
                                        {ingredient.sourceType === "batch"
                                          ? `${ingredient.category} · ${ingredient.pack_size || "Batch"}`
                                          : ingredient.supplier || ingredient.category || "Ingredient master"}
                                      </span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </label>
                          <label>
                            <span>Code</span>
                            <input
                              disabled={componentReadOnly}
                              value={component.code}
                              onChange={(event) => updateNewComponentField(component.id, "code", event.target.value)}
                              placeholder="Code"
                            />
                          </label>
                          <label>
                            <span>Qty</span>
                            <input
                              disabled={componentReadOnly}
                              value={component.qty}
                              onChange={(event) => updateNewComponentField(component.id, "qty", event.target.value)}
                              placeholder={component.sourceType === "batch" ? `Qty (${component.sourceYieldType || "yield units"})` : "Qty"}
                            />
                            {shouldAutoCostComponent(component) ? (
                              <small className="field-help field-help-info">
                                Auto-costing from {component.sourceType === "batch" ? "batch" : "ingredient"} at {money(component.sourceUnitCost)}/{component.sourceYieldType}
                              </small>
                            ) : null}
                          </label>
                          <label>
                            <span>Cost</span>
                            <DecimalInput
                              disabled={componentReadOnly}
                              value={component.cost}
                              onCommit={(value) => updateNewComponentField(component.id, "cost", value)}
                              placeholder="Cost"
                            />
                            {componentReadOnly ? (
                              <small className="field-help">
                                Edit the linked batch recipe instead of changing this component here.
                              </small>
                            ) : shouldAutoCostComponent(component) ? (
                              <small className="field-help field-help-info">
                                Editing cost manually will disconnect this row from auto-costing.
                              </small>
                            ) : null}
                          </label>
                        </div>
                      );
                    })}
                  </div>

                  <div className="editor-block">
                    <div className="editor-label">
                      <span>Method steps</span>
                      <div className="method-step-stack">
                        {(newRecipeDraft.methodSteps || []).length ? (
                          newRecipeDraft.methodSteps.map((step, index) => (
                            <div key={`draft-step-${index}`} className="method-step-row">
                              <div className="method-step-number">{index + 1}</div>
                              <textarea
                                value={step}
                                onChange={(event) => updateNewMethodStep(index, event.target.value)}
                                placeholder={`Step ${index + 1}`}
                                rows={3}
                              />
                              <button
                                type="button"
                                className="icon-button"
                                onClick={() => removeNewMethodStep(index)}
                                aria-label="Remove method step"
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="presentation-placeholder">No method steps yet. Add the first step below.</div>
                        )}
                      </div>
                      <button type="button" className="secondary-button" onClick={addNewMethodStep}>
                        <Icon name="plus" />
                        Add method step
                      </button>
                    </div>
                    <label className="editor-label">
                      <span>Presentation notes</span>
                      <textarea
                        value={newRecipeDraft.presentationNotes}
                        onChange={(event) => updateNewRecipeField("presentationNotes", event.target.value)}
                        rows={5}
                        placeholder="Add plating, garnish, or service notes"
                      />
                    </label>
                  </div>

                  <div className="upload-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => resetNewRecipeDraft(newRecipeDraft.recipeType)}
                    >
                      Reset draft
                    </button>
                    <button type="button" className="primary-button" onClick={saveNewRecipeDraft}>
                      Save new {newRecipeDraft.recipeType === "batch" ? "batch" : "recipe"}
                    </button>
                  </div>
                </Card>
              </div>
            ) : selectedRecipe ? (
            <div className="panel-stack">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Existing recipe builder</div>
                    <h2>Edit dish or batch</h2>
                  </div>
                  <div className="badge-row compact">
                    <Badge tone="default">
                      {selectedRecipe.recipeType === "batch" ? "Batch recipe" : "Dish recipe"}
                    </Badge>
                    <Badge tone="default">{selectedRecipe.id}</Badge>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setBuilderMode("create");
                        setRecipeEditLookup("");
                        resetNewRecipeDraft("dish");
                      }}
                    >
                      Start new recipe
                    </button>
                  </div>
                </div>
                {importMessage ? <p className="support-text success-text">{importMessage}</p> : null}
                {importError ? <p className="support-text error-text">{importError}</p> : null}

                <div className="recipe-context">
                  <details className="recipe-picker" open={false}>
                    <summary className="recipe-picker-header">
                      <div>
                        <div className="mini-heading">Find recipe to edit</div>
                        <p className="support-text">
                          Open this lookup when you want to jump to another existing recipe.
                        </p>
                      </div>
                    </summary>
                    <div className="recipe-picker-controls">
                      <select
                        value={builderRecipeFilter}
                        onChange={(event) => setBuilderRecipeFilter(event.target.value)}
                      >
                        <option value="all">All recipe types</option>
                        <option value="dish">Dish recipes</option>
                        <option value="batch">Batch recipes</option>
                      </select>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={builderBringBatchesForward}
                          onChange={(event) => setBuilderBringBatchesForward(event.target.checked)}
                        />
                        <span>Bring batch recipes forward</span>
                      </label>
                    </div>
                    <label className="form-field recipe-lookup-field recipe-search-field">
                      <span>Recipe lookup</span>
                      <div className="search-input-row">
                        <input
                          value={recipeLookupQuery}
                          onChange={(event) => setRecipeLookupQuery(event.target.value)}
                          placeholder="Start typing a recipe name, code, category or venue"
                        />
                        {recipeLookupQuery ? (
                          <button
                            type="button"
                            className="secondary-button table-action-button"
                            onClick={clearRecipeLookup}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </label>
                    <div className="lookup-panel recipe-search-panel">
                      {filteredRecipeEditOptions.length ? (
                        filteredRecipeEditOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`lookup-option ${(recipeEditLookup || selectedRecipe.id) === option.id ? "lookup-option-active" : ""}`}
                            onClick={() => {
                              setRecipeEditLookup(option.id);
                              setSelectedRecipeId(option.id);
                            }}
                          >
                            <div className="lookup-main">
                              <strong>{option.label}</strong>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="presentation-placeholder">No matching recipes found.</div>
                      )}
                    </div>
                  </details>

                  <div className="builder-summary-banner">
                    <div>
                      <div className="mini-heading">Recipe cost</div>
                      <strong>{money(selectedRecipe.recipeCost)}</strong>
                    </div>
                    <div>
                      <div className="mini-heading">
                        {selectedRecipe.recipeType === "batch" ? "Batch yield" : "Sale price"}
                      </div>
                      <strong>
                        {selectedRecipe.recipeType === "batch"
                          ? `${numberValue(selectedRecipe.batchYield)} ${getBatchYieldLabel(selectedRecipe)}`
                          : money(selectedRecipe.currentSalePrice)}
                      </strong>
                    </div>
                    <div>
                      <div className="mini-heading">
                        {selectedRecipe.recipeType === "batch" ? "Cost per yield unit" : "Roundup target"}
                      </div>
                      <strong>
                        {selectedRecipe.recipeType === "batch"
                          ? `${money(getBatchUnitCost(selectedRecipe))}/${getBatchYieldLabel(selectedRecipe)}`
                          : money(selectedRecipe.roundup)}
                      </strong>
                    </div>
                    <div>
                      <div className="mini-heading">Components</div>
                      <strong>{selectedRecipeComponentCount}</strong>
                    </div>
                    <div>
                      <div className="mini-heading">Venue</div>
                      <strong>{getRecipeVenueLabel(selectedRecipe)}</strong>
                    </div>
                    <div>
                      <div className="mini-heading">Item code</div>
                      <strong>{selectedRecipe.sellingItemCode || "Missing"}</strong>
                    </div>
                  </div>
                </div>

                <div className="card-header">
                  <div>
                    <div className="eyebrow">Recipe detail</div>
                    <h2>Recipe editor</h2>
                  </div>
                  <div className="badge-row compact">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveCurrentRecipeChanges}
                    >
                      Save {selectedRecipe.recipeType === "batch" ? "batch" : "recipe"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openRecipeCostSheetForRecipe(selectedRecipe)}
                    >
                      Open cost sheet
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openRecipeCostSheetForRecipe(selectedRecipe, { print: true })}
                    >
                      Print cost sheet
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openChefSheetPreviewForRecipe(selectedRecipe)}
                    >
                      Open chef sheet
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openChefSheetPreviewForRecipe(selectedRecipe, { print: true })}
                    >
                      Print chef sheet
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={selectedRecipe.isLocked}
                      onClick={() => deleteRecipe(selectedRecipe)}
                    >
                      Delete recipe
                    </button>
                  </div>
                </div>

                <div className="review-panel">
                  <div className="review-panel-header">
                    <div>
                      <div className="mini-heading">Validation</div>
                      <strong>
                        {selectedRecipe.validation.reviewStatus === "needs-review"
                          ? "Needs review"
                          : selectedRecipe.validation.reviewStatus === "warning"
                            ? "Warnings"
                            : "Ready"}
                      </strong>
                    </div>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={selectedRecipe.isLive}
                        disabled={selectedRecipe.recipeType === "batch" || selectedRecipeLocked}
                        onChange={(event) =>
                          updateRecipeField(selectedRecipe.id, "isLive", event.target.checked)
                        }
                      />
                      <span>{selectedRecipe.recipeType === "batch" ? "Batch recipes are not live dishes" : "Recipe live"}</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={selectedRecipeLocked}
                        onChange={(event) =>
                          updateRecipeField(selectedRecipe.id, "isLocked", event.target.checked)
                        }
                      />
                      <span>{selectedRecipeLocked ? "Recipe locked" : "Lock recipe"}</span>
                    </label>
                  </div>
                  <div className="badge-row compact">
                    {selectedRecipe.validation.issues.length ? (
                      selectedRecipe.validation.issues.map((issue, index) => (
                        <Badge key={`${issue.text}-${index}`} tone={issue.level === "error" ? "bad" : "warn"}>
                          {issue.text}
                        </Badge>
                      ))
                    ) : (
                      <Badge tone="good">Confirmed complete</Badge>
                    )}
                    {selectedRecipe.workflowStage === "draft" ? <Badge tone="default">Draft workflow stage</Badge> : null}
                    {selectedRecipeResolved ? <Badge tone="good">Ready to go live</Badge> : null}
                    {selectedRecipeLocked ? <Badge tone="default">Editing disabled until unlocked</Badge> : null}
                    {restaurantLiveRecipeIds.has(selectedRecipe.id) ? (
                      <Badge tone="default">Included on a live menu</Badge>
                    ) : null}
                  </div>
                </div>

                {selectedRecipe.recipeType === "batch" && batchImpact.severity !== "none" ? (
                  <div
                    className={`impact-panel ${
                      batchImpact.severity === "high"
                        ? "impact-panel-high"
                        : batchImpact.severity === "medium"
                          ? "impact-panel-medium"
                          : "impact-panel-low"
                    }`}
                  >
                    <div className="impact-panel-header">
                      <div>
                        <div className="mini-heading">Batch impact warning</div>
                        <strong>
                          {batchImpact.severity === "high"
                            ? "This batch is affecting live service right now"
                            : batchImpact.severity === "medium"
                              ? "This batch feeds live dishes"
                              : "This batch is reused in other recipes"}
                        </strong>
                      </div>
                      <div className="badge-row compact">
                        <Badge tone={batchImpact.severity === "high" ? "bad" : batchImpact.severity === "medium" ? "warn" : "default"}>
                          {batchImpact.linkedRecipeCount} linked recipe{batchImpact.linkedRecipeCount === 1 ? "" : "s"}
                        </Badge>
                        {batchImpact.liveRecipeCount ? (
                          <Badge tone="warn">
                            {batchImpact.liveRecipeCount} live dish{batchImpact.liveRecipeCount === 1 ? "" : "es"}
                          </Badge>
                        ) : null}
                        {batchImpact.liveMenuCount ? (
                          <Badge tone="bad">
                            {batchImpact.liveMenuCount} live menu{batchImpact.liveMenuCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="support-text">
                      Changes to this batch can cascade into every linked dish. Review the dependency list before
                      updating quantities, costs, or yield settings.
                    </p>
                  </div>
                ) : null}

                <div className="form-grid">
                  <label className={getFieldIssues(selectedRecipe.validation, "name").length ? "field-error" : ""}>
                    <span>Dish name</span>
                    <input
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.name}
                      onChange={(event) => updateRecipeField(selectedRecipe.id, "name", event.target.value)}
                    />
                    {getFieldIssues(selectedRecipe.validation, "name").map((issue) => (
                      <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                    ))}
                  </label>
                  <label className={getFieldIssues(selectedRecipe.validation, "restaurant").length ? "field-error" : ""}>
                    <span>Venue</span>
                    <select
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.restaurant}
                      onChange={(event) =>
                        updateRecipeField(selectedRecipe.id, "restaurant", event.target.value)
                      }
                    >
                      <option value="">Blank</option>
                      {venues.map((venue) => (
                        <option key={venue} value={venue}>
                          {venue}
                        </option>
                      ))}
                    </select>
                    {getFieldIssues(selectedRecipe.validation, "restaurant").map((issue) => (
                      <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                    ))}
                  </label>
                  <label className={getFieldIssues(selectedRecipe.validation, "category").length ? "field-error" : ""}>
                    <span>Category</span>
                    <input
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.category}
                      onChange={(event) => updateRecipeField(selectedRecipe.id, "category", event.target.value)}
                    />
                    {getFieldIssues(selectedRecipe.validation, "category").map((issue) => (
                      <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                    ))}
                  </label>
                  <label>
                    <span>Recipe type</span>
                    <select
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.recipeType}
                      onChange={(event) => updateRecipeField(selectedRecipe.id, "recipeType", event.target.value)}
                    >
                      <option value="dish">Dish recipe</option>
                      <option value="batch">Batch recipe</option>
                    </select>
                  </label>
                  <label className={getFieldIssues(selectedRecipe.validation, "sellingItemCode").length ? "field-error" : ""}>
                    <span>Item code</span>
                    <input
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.sellingItemCode}
                      onChange={(event) =>
                        updateRecipeField(selectedRecipe.id, "sellingItemCode", event.target.value)
                      }
                    />
                    {getFieldIssues(selectedRecipe.validation, "sellingItemCode").map((issue) => (
                      <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                    ))}
                  </label>
                  <label className={getFieldIssues(selectedRecipe.validation, "currentSalePrice").length ? "field-error" : ""}>
                    <span>Sale price</span>
                    <DecimalInput
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.currentSalePrice}
                      onCommit={(value) => updateRecipeField(selectedRecipe.id, "currentSalePrice", value)}
                      className=""
                    />
                    {getFieldIssues(selectedRecipe.validation, "currentSalePrice").map((issue) => (
                      <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                    ))}
                  </label>
                  {selectedRecipe.recipeType !== "batch" ? (
                    <label>
                      <span>Portions made</span>
                      <input
                        disabled={selectedRecipeLocked}
                        value={selectedRecipe.portionCount}
                        onChange={(event) =>
                          updateRecipeField(selectedRecipe.id, "portionCount", numberValue(event.target.value))
                        }
                      />
                    </label>
                  ) : null}
                  {selectedRecipe.recipeType === "batch" ? (
                    <label className={getFieldIssues(selectedRecipe.validation, "batchYield").length ? "field-error" : ""}>
                      <span>Batch yield</span>
                      <input
                        disabled={selectedRecipeLocked}
                        value={selectedRecipe.batchYield}
                        onChange={(event) =>
                          updateRecipeField(selectedRecipe.id, "batchYield", numberValue(event.target.value))
                        }
                      />
                      {getFieldIssues(selectedRecipe.validation, "batchYield").map((issue) => (
                        <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                      ))}
                    </label>
                  ) : null}
                  {selectedRecipe.recipeType === "batch" ? (
                    <label className={getFieldIssues(selectedRecipe.validation, "batchYieldType").length ? "field-error" : ""}>
                      <span>Yield type</span>
                      <select
                        disabled={selectedRecipeLocked}
                        value={selectedRecipe.batchYieldType}
                        onChange={(event) => updateRecipeField(selectedRecipe.id, "batchYieldType", event.target.value)}
                      >
                        <option value="portion">portion</option>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="ml">ml</option>
                        <option value="l">l</option>
                        <option value="tray">tray</option>
                        <option value="bottle">bottle</option>
                        <option value="jar">jar</option>
                      </select>
                      {getFieldIssues(selectedRecipe.validation, "batchYieldType").map((issue) => (
                        <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                      ))}
                    </label>
                  ) : null}
                  <label>
                    <span>Roundup target</span>
                    {selectedRecipe.recipeType === "batch" ? (
                      <DecimalInput
                        disabled={selectedRecipeLocked}
                        value={selectedRecipe.roundup}
                        onCommit={(value) => updateRecipeField(selectedRecipe.id, "roundup", value)}
                      />
                    ) : (
                      <input
                        value={money(selectedRecipe.roundup)}
                        readOnly
                      />
                    )}
                  </label>
                  <label className={getMetaIssues(selectedRecipe.validation, "recipeComplete").length ? "field-error" : ""}>
                    <span>Recipe complete</span>
                    <select
                      disabled={selectedRecipeLocked}
                      value={String(selectedRecipe.recipeComplete ?? "0")}
                      onChange={(event) => updateRecipeField(selectedRecipe.id, "recipeComplete", event.target.value)}
                    >
                      <option value="0">Incomplete</option>
                      <option value="1">Complete</option>
                    </select>
                    {getMetaIssues(selectedRecipe.validation, "recipeComplete").map((issue) => (
                      <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                    ))}
                  </label>
                  {selectedRecipe.recipeType !== "batch" ? (
                    <label className={getMetaIssues(selectedRecipe.validation, "pricingComplete").length ? "field-error" : ""}>
                      <span>Pricing complete</span>
                      <select
                        disabled={selectedRecipeLocked}
                        value={String(selectedRecipe.pricingComplete ?? "0")}
                        onChange={(event) => updateRecipeField(selectedRecipe.id, "pricingComplete", event.target.value)}
                      >
                        <option value="0">Incomplete</option>
                        <option value="1">Complete</option>
                      </select>
                      {getMetaIssues(selectedRecipe.validation, "pricingComplete").map((issue) => (
                        <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                      ))}
                    </label>
                  ) : null}
                </div>

                <div className="editor-block">
                  <div className="editor-label">
                    <span>Method steps</span>
                    <div className="method-step-stack">
                      {getMethodSteps(selectedRecipe).length ? (
                        getMethodSteps(selectedRecipe).map((step, index) => (
                          <div key={`${selectedRecipe.id}-step-${index}`} className="method-step-row">
                            <div className="method-step-number">{index + 1}</div>
                            <textarea
                              disabled={selectedRecipeLocked}
                              value={step}
                              onChange={(event) =>
                                updateMethodStep(selectedRecipe.id, index, event.target.value)
                              }
                              placeholder={`Step ${index + 1}`}
                              rows={3}
                            />
                            <button
                              type="button"
                              className="icon-button"
                              disabled={selectedRecipeLocked}
                              onClick={() => removeMethodStep(selectedRecipe.id, index)}
                              aria-label="Remove method step"
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="presentation-placeholder">No method steps yet. Add the first step below.</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={selectedRecipeLocked}
                      onClick={() => addMethodStep(selectedRecipe.id)}
                    >
                      <Icon name="plus" />
                      Add method step
                    </button>
                    {getChefPortionNote(selectedRecipe) ? (
                      <p className="support-text">
                        Chef note: {getChefPortionNote(selectedRecipe)}
                      </p>
                    ) : null}
                  </div>
                  <label className="editor-label">
                    <span>Presentation notes</span>
                    <textarea
                      disabled={selectedRecipeLocked}
                      value={selectedRecipe.presentationNotes}
                      onChange={(event) =>
                        updateRecipeField(selectedRecipe.id, "presentationNotes", event.target.value)
                      }
                      placeholder="Add plating, garnish, and pass notes"
                      rows={5}
                    />
                  </label>
                  <div className="image-upload-card">
                    <div>
                      <div className="mini-heading">Completed dish image</div>
                      <p className="support-text">
                        Add a final plated image so it appears on the chef print sheet.
                      </p>
                    </div>
                    <label className="secondary-button file-button">
                      <input
                        type="file"
                        accept="image/*"
                        disabled={selectedRecipeLocked}
                        onChange={(event) => handlePresentationImageUpload(selectedRecipe.id, event)}
                      />
                      Upload image
                    </label>
                    {selectedRecipe.presentationImage ? (
                      <div className="presentation-preview">
                        <img src={selectedRecipe.presentationImage} alt={`${selectedRecipe.name} presentation`} />
                      </div>
                    ) : (
                      <div className="presentation-placeholder">No completed dish image uploaded yet.</div>
                    )}
                  </div>
                </div>

                {getMetaIssues(selectedRecipe.validation, "gp").length ? (
                  <div className="field-summary">
                    {getMetaIssues(selectedRecipe.validation, "gp").map((issue) => (
                      <p key={issue.text} className="field-help field-help-error">{issue.text}</p>
                    ))}
                  </div>
                ) : null}

                <div className="section-row">
                  <div>
                    <div className="eyebrow">Components</div>
                    <h3>Linked recipe components</h3>
                    <p className="support-text">
                      Change costs at the source: ingredients in `Ingredients`, BCH items in the parent batch recipe.
                    </p>
                  </div>
                  <button type="button" className="secondary-button" onClick={addComponent} disabled={selectedRecipeLocked}>
                    <Icon name="plus" />
                    Add component
                  </button>
                </div>

                <div className="component-stack">
                  {selectedRecipe.components.map((component) => {
                    const componentIssues = getComponentIssues(selectedRecipe.validation, component.id);
                    const componentReadOnly = selectedRecipeLocked || isParentLinkedComponent(component);
                    const matchedBatchSource = findBatchRecipeMatch(component);
                    const hasOpenableBatchSource = Boolean(matchedBatchSource);
                    return (
                    <div
                      key={component.id}
                      className={`component-card ${componentIssues.length ? "component-card-error" : ""}`}
                    >
                      <div className="component-meta">
                        <div className="badge-row compact">
                          <Badge tone="default">#{component.sort}</Badge>
                          {component.sourceType === "batch" ? <Badge tone="good">Linked batch</Badge> : null}
                          {component.sourceType === "ingredient-master" ? <Badge tone="default">Linked ingredient</Badge> : null}
                          {isParentLinkedComponent(component) ? <Badge tone="default">Managed by parent batch</Badge> : null}
                          {normalizeCodeKey(component.code).startsWith("BCH") && !hasOpenableBatchSource ? (
                            <Badge tone="warn">Batch recipe not linked yet</Badge>
                          ) : null}
                        </div>
                        <div className="component-actions">
                          {hasOpenableBatchSource ? (
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                jumpToLinkedBatchRecipe(component);
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                jumpToLinkedBatchRecipe(component);
                              }}
                            >
                              Edit batch source
                            </button>
                          ) : null}
                          {!isParentLinkedComponent(component) ? (
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                jumpToIngredientRecord(component);
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                jumpToIngredientRecord(component);
                              }}
                            >
                              Edit ingredient source
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="icon-button"
                            disabled={componentReadOnly}
                            onClick={() => removeComponent(selectedRecipe.id, component.id)}
                            aria-label="Remove component"
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                      <label>
                          <span>Ingredient</span>
                          <input
                            disabled={componentReadOnly}
                            value={component.ingredient}
                            className={
                              getComponentFieldIssues(selectedRecipe.validation, component.id, "ingredient").length
                                ? "input-error"
                                : ""
                            }
                            onChange={(event) =>
                              updateComponentField(selectedRecipe.id, component.id, "ingredient", event.target.value)
                            }
                          onFocus={() =>
                            !componentReadOnly &&
                            setActiveLookup({
                              recipeId: selectedRecipe.id,
                              componentId: component.id,
                            })
                          }
                          onBlur={() => {
                            window.setTimeout(() => {
                              setActiveLookup((current) => {
                                if (
                                  current?.recipeId === selectedRecipe.id &&
                                  current?.componentId === component.id
                                ) {
                                  return null;
                                }
                                return current;
                              });
                            }, 120);
                          }}
                          placeholder="Ingredient"
                          />
                          {getComponentFieldIssues(selectedRecipe.validation, component.id, "ingredient").map((issue) => (
                            <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                          ))}
                        {activeLookup?.recipeId === selectedRecipe.id &&
                        activeLookup?.componentId === component.id &&
                        !componentReadOnly &&
                        ingredientSuggestions.length ? (
                          <div className="lookup-panel">
                            {ingredientSuggestions.map((ingredient) => (
                              <button
                                key={ingredient.id}
                                type="button"
                                className="lookup-option"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  applyIngredientMatch(selectedRecipe.id, component.id, ingredient);
                                }}
                              >
                                <div className="lookup-main">
                                  <strong>{ingredient.ingredient_name}</strong>
                                  <span>{ingredient.ingredient_item_code}</span>
                                </div>
                                <div className="lookup-meta">
                                  <span>{money(ingredient.unit_cost)}</span>
                                  <span>
                                    {ingredient.sourceType === "batch"
                                      ? `${ingredient.category} · ${ingredient.pack_size || "Batch"}`
                                      : ingredient.supplier || ingredient.category || "Ingredient master"}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </label>
                      <label>
                        <span>Code</span>
                        <input
                          disabled={componentReadOnly}
                          value={component.code}
                          className={
                            getComponentFieldIssues(selectedRecipe.validation, component.id, "code").length
                              ? "input-warn"
                              : ""
                          }
                          onChange={(event) =>
                            updateComponentField(selectedRecipe.id, component.id, "code", event.target.value)
                          }
                          placeholder="Code"
                        />
                        {getComponentFieldIssues(selectedRecipe.validation, component.id, "code").map((issue) => (
                          <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                        ))}
                      </label>
                      <label>
                        <span>Qty (g)</span>
                        <input
                          disabled={componentReadOnly}
                          value={component.qty}
                          className={
                            getComponentFieldIssues(selectedRecipe.validation, component.id, "qty").length
                              ? "input-warn"
                              : ""
                          }
                          onChange={(event) =>
                            updateComponentField(selectedRecipe.id, component.id, "qty", event.target.value)
                          }
                          placeholder={
                            component.sourceType === "batch"
                              ? `Qty (${component.sourceYieldType || "yield units"})`
                              : "Qty (g)"
                          }
                        />
                        {getComponentFieldIssues(selectedRecipe.validation, component.id, "qty").map((issue) => (
                          <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
                        ))}
                        {shouldAutoCostComponent(component) ? (
                          <small className="field-help field-help-info">
                            Auto-costing from {component.sourceType === "batch" ? "batch" : "ingredient"} at {money(component.sourceUnitCost)}/{component.sourceYieldType}
                          </small>
                        ) : null}
                      </label>
                      <label>
                        <span>Cost</span>
                        <DecimalInput
                          disabled={componentReadOnly}
                          value={component.cost}
                          className={
                            getComponentFieldIssues(selectedRecipe.validation, component.id, "cost").length
                              ? "input-error"
                              : ""
                          }
                          onCommit={(value) =>
                            updateComponentField(selectedRecipe.id, component.id, "cost", value)
                          }
                          placeholder="Cost"
                        />
                        {getComponentFieldIssues(selectedRecipe.validation, component.id, "cost").map((issue) => (
                          <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                        ))}
                        <small className="field-help field-help-info">
                          {getComponentSourceRouteLabel(component)}
                        </small>
                        {shouldAutoCostComponent(component) ? (
                          <small className="field-help field-help-info">
                            {isParentLinkedComponent(component)
                              ? "This row is managed by the linked batch recipe."
                              : "Editing cost manually will disconnect this row from auto-costing."}
                          </small>
                        ) : null}
                        {isParentLinkedComponent(component) ? (
                          <small className="field-help field-help-info">
                            Use `Open batch recipe` to change the parent batch and let this row update from the source.
                          </small>
                        ) : null}
                        {normalizeCodeKey(component.code).startsWith("BCH") && !hasOpenableBatchSource ? (
                          <small className="field-help field-help-warn">
                            This BCH code does not currently resolve to a batch recipe. Link or import the batch recipe first.
                          </small>
                        ) : null}
                      </label>
                    </div>
                  )})}
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Workbook alignment</div>
                    <h2>Source fields</h2>
                  </div>
                </div>
                <div className="key-value-list">
                  <div><span>Recipe ID</span><strong>{selectedRecipe.id}</strong></div>
                  <div><span>Source row</span><strong>{selectedRecipe.sourceRow || "N/A"}</strong></div>
                  <div><span>Source cost</span><strong>{money(selectedRecipe.sourceCost)}</strong></div>
                  <div><span>Source net price</span><strong>{money(selectedRecipe.netPriceSource)}</strong></div>
                  <div><span>Source gross price</span><strong>{money(selectedRecipe.grossPriceSource)}</strong></div>
                  <div><span>POS YTD</span><strong>{selectedRecipe.posYtd}</strong></div>
                  <div><span>Recipe complete</span><strong>{selectedRecipe.recipeComplete === "1" ? "Complete" : "Incomplete"}</strong></div>
                  <div><span>Pricing complete</span><strong>{selectedRecipe.pricingComplete === "1" ? "Complete" : "Incomplete"}</strong></div>
                  <div><span>Recipe type</span><strong>{selectedRecipe.recipeType}</strong></div>
                  <div><span>Batch yield</span><strong>{numberValue(selectedRecipe.batchYield) || "N/A"}</strong></div>
                  <div><span>Yield type</span><strong>{selectedRecipe.recipeType === "batch" ? getBatchYieldLabel(selectedRecipe) : "N/A"}</strong></div>
                </div>
              </Card>

              {selectedRecipe.recipeType === "batch" ? (
                <Card>
                  <div className="card-header">
                    <div>
                      <div className="eyebrow">Batch traceability</div>
                      <h2>Used in recipes</h2>
                    </div>
                    <Badge tone={batchUsage.length ? "good" : "default"}>
                      {batchUsage.length} linked
                    </Badge>
                  </div>
                  {batchUsage.length ? (
                    <div className="usage-stack">
                      {batchUsage.map((usage) => (
                        <div key={usage.recipeId} className="usage-card">
                          <div className="usage-top">
                            <div>
                              <strong>{usage.recipeName}</strong>
                              <p>{usage.restaurant}</p>
                            </div>
                            <div className="badge-row compact">
                              {usage.isLive ? <Badge tone="good">Recipe live</Badge> : null}
                              {usage.liveMenusUsingRecipe.length ? (
                                <Badge tone="default">
                                  On {usage.liveMenusUsingRecipe.length} live menu{usage.liveMenusUsingRecipe.length > 1 ? "s" : ""}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="badge-row compact">
                            {usage.matchedComponents.map((component) => (
                              <Badge key={component.id} tone="default">
                                {component.ingredient} · {numberValue(component.qty)} {component.sourceYieldType || "unit"}
                              </Badge>
                            ))}
                          </div>
                          {usage.liveMenusUsingRecipe.length ? (
                            <div className="badge-row compact">
                              {usage.liveMenusUsingRecipe.map((menu) => (
                                <Badge key={menu.id} tone="good">
                                  {menu.name}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="support-text">
                      This batch is not currently used in any other recipe.
                    </p>
                  )}
                </Card>
              ) : null}

              <Card className="hint-card">
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Ingredient master</div>
                    <h2>Upload and lookup</h2>
                  </div>
                  <Icon name="spark" />
                </div>
                <div className="upload-format-card">
                  <div className="mini-heading">Required columns</div>
                  <div className="badge-row compact">
                    {REQUIRED_INGREDIENT_COLUMNS.map((column) => (
                      <Badge key={column} tone="good">
                        {column}
                      </Badge>
                    ))}
                  </div>
                  <div className="mini-heading">Optional columns</div>
                  <div className="badge-row compact">
                    {OPTIONAL_INGREDIENT_COLUMNS.map((column) => (
                      <Badge key={column} tone="default">
                        {column}
                      </Badge>
                    ))}
                  </div>
                  <div className="mini-heading">Also accepted directly</div>
                  <div className="badge-row compact">
                    {["Ingredient name", "PLU Code", "Description", "Grams. / Mililitre", "Cost per kilo"].map(
                      (column) => (
                        <Badge key={column} tone="default">
                          {column}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
                <div className="upload-actions">
                  <label className="secondary-button file-button">
                    <input type="file" accept=".csv,text/csv" onChange={handleIngredientUpload} />
                    Upload ingredient master
                  </label>
                  <button type="button" className="secondary-button" onClick={downloadIngredientTemplate}>
                    Download template
                  </button>
                </div>
                <div className="support-stack">
                  <p className="support-text">
                    Upload a CSV and the builder will suggest matches as chefs type ingredient names like
                    “chicken breast”, then fill the ingredient code and current cost into the row.
                  </p>
                  <p className="support-text">
                    You can upload either the app-ready ingredient master format or the raw pricing sheet format
                    with `Ingredient name`, `PLU Code`, `Grams. / Mililitre`, and `Cost per kilo`.
                  </p>
                  <p className="support-text">Ingredients loaded: {ingredientMaster.length}</p>
                  {ingredientUploadMessage ? (
                    <p className="support-text success-text">{ingredientUploadMessage}</p>
                  ) : null}
                  {ingredientUploadError ? (
                    <p className="support-text error-text">{ingredientUploadError}</p>
                  ) : null}
                </div>
              </Card>
            </div>
            ) : (
              <Card>
                <p className="support-text">Select a recipe to edit, or switch to `Create new` to build one from scratch.</p>
              </Card>
            )}
          </div>
        )}

        {activeTab === "menus" && (
          <div className="tab-panel">
            <div className="split-layout">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Menu builder</div>
                    <h2>Create and edit menus</h2>
                  </div>
                  <button type="button" className="primary-button" onClick={addMenu}>
                    <Icon name="plus" />
                    Add menu
                  </button>
                </div>

                {selectedMenu ? (
                  <div className="support-stack">
                    <div className="upload-actions">
                      <button type="button" className="primary-button" onClick={saveMenuChanges}>
                        Save menu changes
                      </button>
                    </div>
                    <label className="form-field">
                      <span>Selected menu</span>
                      <select
                        value={selectedMenu.id}
                        onChange={(event) => setSelectedMenuId(event.target.value)}
                      >
                        {menuCards.map((menu) => (
                          <option key={menu.id} value={menu.id}>
                            {menu.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="form-grid">
                      <label>
                        <span>Menu name</span>
                        <input
                          value={selectedMenu.name}
                          onChange={(event) =>
                            updateMenuField(selectedMenu.id, "name", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Venue</span>
                        <select
                          value={selectedMenu.restaurant}
                          onChange={(event) =>
                            updateMenuField(selectedMenu.id, "restaurant", event.target.value)
                          }
                        >
                          {venueOptions.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Guest count</span>
                        <input
                          value={selectedMenu.guestCount}
                          onChange={(event) =>
                            updateMenuField(selectedMenu.id, "guestCount", numberValue(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        <span>Target GP</span>
                        <input
                          value={selectedMenu.targetGp}
                          onChange={(event) =>
                            updateMenuField(selectedMenu.id, "targetGp", numberValue(event.target.value))
                          }
                        />
                      </label>
                    </div>

                    <div className="review-panel">
                      <div className="review-panel-header">
                        <div>
                          <div className="mini-heading">Live service state</div>
                          <strong>{selectedMenu.isLiveMenu ? "This is the live menu" : "Draft menu"}</strong>
                        </div>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedMenu.isLiveMenu)}
                            onChange={(event) =>
                              updateMenuField(selectedMenu.id, "isLiveMenu", event.target.checked)
                            }
                          />
                          <span>Set as live menu</span>
                        </label>
                      </div>
                      <div className="badge-row compact">
                        <Badge tone={selectedMenu.isLiveMenu ? "good" : "default"}>
                          {selectedMenu.isLiveMenu
                            ? `Live for ${selectedMenu.restaurant}`
                            : `Not live for ${selectedMenu.restaurant}`}
                        </Badge>
                        <Badge tone="default">
                          Only one live menu per venue can be active at a time
                        </Badge>
                      </div>
                    </div>

                    <div className="section-row">
                      <div>
                        <div className="eyebrow">Menu lines</div>
                        <h3>{selectedMenu.lines.length} selected dishes</h3>
                      </div>
                      <button type="button" className="secondary-button" onClick={addMenuLine}>
                        <Icon name="plus" />
                        Add dish
                      </button>
                    </div>

                    <div className="component-stack">
                      {selectedMenu.lines.map((line, index) => (
                        <div key={line.id} className="component-card menu-line-card">
                          <div className="component-meta">
                            <Badge tone="default">#{index + 1}</Badge>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => removeMenuLine(selectedMenu.id, line.id)}
                              aria-label="Remove menu line"
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                          <label>
                            <span>Course</span>
                            <input
                              value={line.courseLabel}
                              onChange={(event) =>
                                updateMenuLine(selectedMenu.id, line.id, "courseLabel", event.target.value)
                              }
                            />
                          </label>
                          <label>
                            <span>Recipe</span>
                            <select
                              value={line.recipeId}
                              onChange={(event) =>
                                updateMenuLine(selectedMenu.id, line.id, "recipeId", event.target.value)
                              }
                            >
                              {recipes
                                .filter(
                                  (recipe) =>
                                    recipe.recipeType !== "batch" &&
                                    recipe.restaurant === getBaseVenueName(selectedMenu.restaurant)
                                )
                                .map((recipe) => (
                                  <option key={recipe.id} value={recipe.id}>
                                    {recipe.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            <span>Dish</span>
                            <input value={line.dishName} readOnly />
                          </label>
                          <label>
                            <span>Cost</span>
                            <input value={money(line.lineCost)} readOnly />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="support-text">Create a menu to start building summaries.</p>
                )}
              </Card>

              <div className="builder-side">
                {selectedMenu ? (
                  <Card>
                  <div className="card-header">
                    <div>
                      <div className="eyebrow">Live menu summary</div>
                      <h2>{selectedMenu.name}</h2>
                    </div>
                    <div className="badge-row compact">
                      <Badge tone={selectedMenu.menuGp >= selectedMenu.targetGp ? "good" : "warn"}>
                        Target {percent(selectedMenu.targetGp)}
                      </Badge>
                      {selectedMenu.isLiveMenu ? <Badge tone="good">Live menu</Badge> : null}
                    </div>
                  </div>
                    <div className="stats-grid two-up">
                      <StatCard label="Per guest cost" value={money(selectedMenu.perGuestCost)} />
                      <StatCard label="Per guest sell" value={money(selectedMenu.perGuestSell)} />
                      <StatCard label="Total food cost" value={money(selectedMenu.totalFoodCost)} />
                      <StatCard label="Menu GP" value={percent(selectedMenu.menuGp)} />
                    </div>
                  </Card>
                ) : null}

                <div className="card-grid">
              {menuCards.map((menu) => (
                <Card key={menu.id}>
                  <div className="card-header">
                    <div>
                      <div className="eyebrow">Menu summary</div>
                      <h2>{menu.name}</h2>
                      <p>{menu.restaurant} · {menu.guestCount} guests</p>
                    </div>
                    <div className="badge-row compact">
                      <Badge tone={menu.menuGp >= menu.targetGp ? "good" : "warn"}>
                        Target {percent(menu.targetGp)}
                      </Badge>
                      {menu.isLiveMenu ? <Badge tone="good">Live menu</Badge> : null}
                    </div>
                  </div>

                  <div className="menu-stats">
                    <div><span>Per guest cost</span><strong>{money(menu.perGuestCost)}</strong></div>
                    <div><span>Per guest sell</span><strong>{money(menu.perGuestSell)}</strong></div>
                    <div><span>Target sell per guest</span><strong>{money(menu.targetSellPerGuest)}</strong></div>
                    <div><span>Menu GP</span><strong>{percent(menu.menuGp)}</strong></div>
                    <div><span>Total food cost</span><strong>{money(menu.totalFoodCost)}</strong></div>
                    <div><span>Target revenue</span><strong>{money(menu.targetRevenue)}</strong></div>
                  </div>

                  <div className="badge-row">
                    {menu.menuRecipes.map((recipe) => (
                      <span key={recipe.id} className="badge">
                        {recipe.name}
                      </span>
                    ))}
                  </div>

                  <div className="table-wrap compact-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Course</th>
                          <th>Dish</th>
                          <th>Cost</th>
                          <th>Sale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menu.lines.map((line) => (
                          <tr key={line.id}>
                            <td>{line.courseLabel}</td>
                            <td>{line.dishName}</td>
                            <td>{money(line.lineCost)}</td>
                            <td>{money(line.lineSalePrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "ingredients" && (
          <TabErrorBoundary resetKey={`${activeTab}-${ingredientTypeFilter}-${ingredientBatchLinkFilter}-${ingredientColumnFilter}-${search}`}>
          <div className="tab-panel">
            <div className="stats-grid">
              <StatCard
                label="Catalogue rows"
                value={ingredientCatalogueSummary.total}
                onClick={() => {
                  setActiveTab("ingredients");
                  setIngredientTypeFilter("all");
                  setIngredientBatchLinkFilter("all");
                  setIngredientColumnFilter("all-columns");
                  setSearch("");
                }}
              />
              <StatCard
                label="Need review"
                value={ingredientCatalogueSummary.needsReview}
                tone={ingredientCatalogueSummary.needsReview ? "negative" : ""}
                onClick={() => {
                  setActiveTab("ingredients");
                  setIngredientTypeFilter("all");
                  setIngredientBatchLinkFilter("needs-review");
                  setIngredientColumnFilter("all-columns");
                  setSearch("");
                }}
              />
              <StatCard
                label="Reviewed"
                value={ingredientCatalogueSummary.ready}
                onClick={() => {
                  setActiveTab("ingredients");
                  setIngredientTypeFilter("all");
                  setIngredientBatchLinkFilter("ready");
                  setIngredientColumnFilter("all-columns");
                  setSearch("");
                }}
              />
              <StatCard
                label="Batch links to resolve"
                value={ingredientCatalogueSummary.unlinkedBatchRows}
                tone={ingredientCatalogueSummary.unlinkedBatchRows ? "negative" : ""}
                onClick={() => {
                  setActiveTab("ingredients");
                  setIngredientTypeFilter("batch");
                  setIngredientBatchLinkFilter("unlinked");
                  setIngredientColumnFilter("all-columns");
                  setSearch("");
                }}
              />
            </div>

            <div className="ingredients-layout">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Ingredient builder</div>
                    <h2>New ingredient first, edit by lookup</h2>
                  </div>
                  <div className="badge-row compact">
                    <button type="button" className="secondary-button" onClick={addIngredientRow}>
                      <Icon name="plus" />
                      Add ingredient
                    </button>
                    <Badge tone="default">
                      {combinedIngredientCatalog.filter((row) => isIngredientBuilderRow(row)).length} unlocked
                    </Badge>
                  </div>
                </div>
                {activeIngredientDraft ? (
                  <div className="ingredient-builder-card">
                    <div className="ingredient-builder-top">
                      <label className="form-field recipe-search-field">
                        <span>Find ingredient to edit</span>
                        <div className="search-input-row">
                          <input
                            value={ingredientEditLookupQuery}
                            onFocus={() => setIngredientEditLookupOpen(true)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setIngredientEditLookupOpen(false);
                              }, 120);
                            }}
                            onChange={(event) => {
                              setIngredientEditLookupQuery(event.target.value);
                              setIngredientEditLookup("");
                              setIngredientEditLookupOpen(true);
                            }}
                            placeholder="Start typing an ingredient name or code"
                          />
                          {ingredientEditLookupQuery ? (
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              onClick={() => {
                                setIngredientEditLookupQuery("");
                                setIngredientEditLookup("");
                                setIngredientEditLookupOpen(false);
                                const existingBlankRow = ingredientMaster.find((ingredient) =>
                                  isEmptyIngredientDraftRow(ingredient)
                                );
                                if (existingBlankRow) {
                                  focusIngredientDraft(existingBlankRow.id);
                                } else {
                                  addIngredientRow();
                                }
                              }}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                        {ingredientEditLookupOpen && filteredIngredientEditOptions.length ? (
                          <div className="lookup-panel recipe-search-panel">
                            {filteredIngredientEditOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={`lookup-option ${
                                  ingredientEditLookup === option.id ? "lookup-option-active" : ""
                                }`}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  focusIngredientDraft(option.id, option.label);
                                }}
                              >
                                <div className="lookup-main">
                                  <strong>{option.label}</strong>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : ingredientEditLookupOpen && ingredientEditLookupQuery ? (
                          <div className="lookup-panel recipe-search-panel">
                            <div className="presentation-placeholder">No matching ingredients found.</div>
                          </div>
                        ) : null}
                      </label>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={Boolean(activeIngredientDraft.source.is_locked)}
                          onChange={(event) =>
                            updateIngredientField(
                              activeIngredientDraft.source.id,
                              "is_locked",
                              event.target.checked
                            )
                          }
                        />
                        <span>Lock ingredient when complete</span>
                      </label>
                    </div>
                    <div className="ingredient-builder-grid">
                      <label className="form-field">
                        <span>Type</span>
                        <select
                          value={activeIngredientDraft.source.entry_type || "ingredient"}
                          onChange={(event) =>
                            updateIngredientField(
                              activeIngredientDraft.source.id,
                              "entry_type",
                              event.target.value
                            )
                          }
                        >
                          <option value="ingredient">Ingredient</option>
                          <option value="batch">Batch</option>
                        </select>
                      </label>
                      <label className="form-field">
                        <span>Ingredient name</span>
                        <input
                          value={activeIngredientDraft.source.ingredient_name}
                          disabled={activeIngredientDraft.source.is_locked}
                          onChange={(event) =>
                            updateIngredientField(
                              activeIngredientDraft.source.id,
                              "ingredient_name",
                              event.target.value
                            )
                          }
                          placeholder="Ingredient name"
                        />
                      </label>
                      <label className="form-field">
                        <span>Item code</span>
                        <input
                          value={activeIngredientDraft.source.ingredient_item_code}
                          disabled={activeIngredientDraft.source.is_locked}
                          onChange={(event) =>
                            updateIngredientField(
                              activeIngredientDraft.source.id,
                              "ingredient_item_code",
                              event.target.value
                            )
                          }
                          placeholder="Item code"
                        />
                      </label>
                      <label className="form-field">
                        <span>Unit price</span>
                        <input
                          inputMode="decimal"
                          value={activeIngredientDraft.source.unit_cost}
                          disabled={activeIngredientDraft.source.is_locked}
                          onChange={(event) =>
                            updateIngredientField(activeIngredientDraft.source.id, "unit_cost", event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <label className="form-field">
                        <span>Pack size</span>
                        <div className="pack-size-cell">
                          <input
                            inputMode="decimal"
                            className="table-input numeric-input pack-size-value"
                            value={parsePackSizeParts(activeIngredientDraft.source.pack_size).value}
                            disabled={activeIngredientDraft.source.is_locked}
                            onChange={(event) =>
                              updateIngredientPackSize(
                                activeIngredientDraft.source.id,
                                "value",
                                event.target.value
                              )
                            }
                            placeholder="500"
                          />
                          <select
                            className="table-input pack-size-unit"
                            value={parsePackSizeParts(activeIngredientDraft.source.pack_size).unit}
                            disabled={activeIngredientDraft.source.is_locked}
                            onChange={(event) =>
                              updateIngredientPackSize(
                                activeIngredientDraft.source.id,
                                "unit",
                                event.target.value
                              )
                            }
                          >
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                          </select>
                        </div>
                      </label>
                      <label className="form-field">
                        <span>Category</span>
                        <input
                          value={activeIngredientDraft.source.category}
                          disabled={activeIngredientDraft.source.is_locked}
                          onChange={(event) =>
                            updateIngredientField(activeIngredientDraft.source.id, "category", event.target.value)
                          }
                          placeholder="Category"
                        />
                      </label>
                      <label className="form-field">
                        <span>Supplier</span>
                        <input
                          value={activeIngredientDraft.source.supplier}
                          disabled={activeIngredientDraft.source.is_locked}
                          onChange={(event) =>
                            updateIngredientField(activeIngredientDraft.source.id, "supplier", event.target.value)
                          }
                          placeholder="Supplier"
                        />
                      </label>
                    </div>
                    <div className="badge-row compact">
                      <Badge tone="default">
                        {activeIngredientDraft.source.ingredient_name?.trim() ? "Editing ingredient" : "New ingredient"}
                      </Badge>
                      <Badge
                        tone={
                          activeIngredientDraft.validation.reviewStatus === "needs-review" ? "bad" : "good"
                        }
                      >
                        {activeIngredientDraft.validation.reviewStatus === "needs-review"
                          ? "Needs review"
                          : "Ready to lock"}
                      </Badge>
                      {activeIngredientDraft.validation.issues.map((issue) => (
                        <Badge
                          key={`${activeIngredientDraft.id}-${getValidationIssueText(issue)}`}
                          tone="warn"
                        >
                          {getValidationIssueText(issue)}
                        </Badge>
                        ))}
                    </div>
                    <div className="upload-actions">
                      {ingredientReturnTarget?.recipeId ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={returnToIngredientSourceRecipe}
                        >
                          Back to recipe{ingredientReturnTarget.recipeName ? `: ${ingredientReturnTarget.recipeName}` : ""}
                        </button>
                      ) : null}
                      <label className="secondary-button file-button">
                        <input type="file" accept=".csv,text/csv" onChange={handleIngredientUpload} />
                        Upload ingredient master
                      </label>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={saveIngredientMasterChanges}
                        disabled={!ingredientMaster.length}
                      >
                        Save ingredient changes
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={syncBatchIngredientsWithRecipes}
                        disabled={!recipes.some((recipe) => recipe.recipeType === "batch")}
                      >
                        Link batch recipes
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => exportIngredientMaster(ingredientMaster)}
                        disabled={!ingredientMaster.length}
                      >
                        Export reviewed CSV
                      </button>
                      <button type="button" className="secondary-button" onClick={downloadIngredientTemplate}>
                        Download template
                      </button>
                    </div>
                    <p className="support-text">
                      Upload, review, save, and export ingredient pricing here. Use `Link batch recipes` after batch imports to refresh BCH-linked ingredient rows.
                    </p>
                    {ingredientUploadMessage ? (
                      <p className="support-text success-text">{ingredientUploadMessage}</p>
                    ) : null}
                    {ingredientUploadError ? (
                      <p className="support-text error-text">{ingredientUploadError}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="support-stack">
                    <p className="support-text">
                      Add a new ingredient to start building, or use the lookup above to pull an existing ingredient
                      into the editor.
                    </p>
                  </div>
                )}
              </Card>

              <Card className="ingredients-table-card">
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Catalogue</div>
                    <h2>Ingredients and batch recipes</h2>
                  </div>
                  <div className="table-filter-row">
                    <label className="filter-control">
                      <span className="filter-label">Type</span>
                      <select
                        value={ingredientTypeFilter}
                        onChange={(event) => setIngredientTypeFilter(event.target.value)}
                      >
                        <option value="all">All rows</option>
                        <option value="ingredient">Ingredients only</option>
                        <option value="batch">Batches only</option>
                      </select>
                    </label>
                    <label className="filter-control">
                      <span className="filter-label">Filter</span>
                      <select
                        value={ingredientBatchLinkFilter}
                        onChange={(event) => setIngredientBatchLinkFilter(event.target.value)}
                      >
                        <option value="all">All rows</option>
                        <option value="needs-review">Needs review</option>
                        <option value="ready">Ready</option>
                        <option value="ingredient-master">Batch ingredient rows</option>
                        <option value="recipe-batch">Recipe-backed batches</option>
                        <option value="linked">Linked batch rows</option>
                        <option value="unlinked">Unlinked batch rows</option>
                      </select>
                    </label>
                    <label className="filter-control">
                      <span className="filter-label">Search in</span>
                      <select
                        value={ingredientColumnFilter}
                        onChange={(event) => setIngredientColumnFilter(event.target.value)}
                      >
                        <option value="all-columns">All columns</option>
                        <option value="type">Type</option>
                        <option value="ingredient">Ingredient</option>
                        <option value="code">Code</option>
                        <option value="price">Price</option>
                        <option value="pack-size">Pack size</option>
                        <option value="category">Category</option>
                        <option value="supplier">Supplier</option>
                        <option value="updated">Updated</option>
                        <option value="used">Used</option>
                        <option value="recipe-entity">Recipe entity</option>
                        <option value="status">Status</option>
                      </select>
                    </label>
                  </div>
                </div>
                {combinedIngredientCatalog.length ? (
                  <div className="table-wrap ingredient-table-wrap">
                    <table className="ingredient-table">
                      <colgroup>
                        <col className="ingredient-col-lock" />
                        <col className="ingredient-col-type" />
                        <col className="ingredient-col-name" />
                        <col className="ingredient-col-code" />
                        <col className="ingredient-col-price" />
                        <col className="ingredient-col-pack" />
                        <col className="ingredient-col-category" />
                        <col className="ingredient-col-supplier" />
                      <col className="ingredient-col-updated" />
                      <col className="ingredient-col-used" />
                      <col className="ingredient-col-link" />
                      <col className="ingredient-col-status" />
                      <col className="ingredient-col-delete" />
                    </colgroup>
                      <thead>
                        <tr>
                          <th>Lock</th>
                          <th>{renderIngredientSortHeader("Type", "type")}</th>
                          <th>{renderIngredientSortHeader("Ingredient", "ingredient")}</th>
                          <th>{renderIngredientSortHeader("Code", "code")}</th>
                          <th>{renderIngredientSortHeader("Price", "price")}</th>
                          <th>{renderIngredientSortHeader("Pack size", "pack-size")}</th>
                          <th>{renderIngredientSortHeader("Category", "category")}</th>
                          <th>{renderIngredientSortHeader("Supplier", "supplier")}</th>
                          <th>{renderIngredientSortHeader("Updated", "updated")}</th>
                          <th>{renderIngredientSortHeader("Used", "used")}</th>
                          <th>{renderIngredientSortHeader("Recipe link", "recipe-entity")}</th>
                          <th>{renderIngredientSortHeader("Status", "status")}</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredIngredientCatalog.map((row) => (
                            <tr
                              key={row.id}
                              className={`${row.validation.reviewStatus === "needs-review" ? "review-row" : ""} ${
                                row.sourceKind === "ingredient-master" && row.source.is_locked ? "locked-row" : ""
                              }`.trim()}
                            >
                              <td className="lock-cell">
                                {row.sourceKind === "ingredient-master" ? (
                                  <label className="lock-toggle" aria-label={`Lock ${row.displayName || "ingredient"}`}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(row.source.is_locked)}
                                      onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                      onChange={(event) =>
                                        updateIngredientField(row.source.id, "is_locked", event.target.checked)
                                      }
                                    />
                                  </label>
                                ) : (
                                  <div className="table-static">-</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <select
                                    className="table-input"
                                    value={row.rowType}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "entry_type", event.target.value)
                                    }
                                  >
                                    <option value="ingredient">Ingredient</option>
                                    <option value="batch">Batch</option>
                                  </select>
                                ) : (
                                  <div className="badge-row compact">
                                    <Badge tone="default">Batch recipe</Badge>
                                  </div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <input
                                    className={`table-input ${
                                      row.validation.issues.includes("Missing ingredient name") ? "input-error" : ""
                                    }`}
                                    value={row.source.ingredient_name}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "ingredient_name", event.target.value)
                                    }
                                    placeholder="Ingredient name"
                                  />
                                ) : (
                                  <div className="table-static strong-cell">{row.displayName || "Missing"}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <input
                                    className={`table-input ${
                                      row.validation.issues.some((issue) => issue.includes("item code")) ? "input-error" : ""
                                    }`}
                                    value={row.source.ingredient_item_code}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "ingredient_item_code", event.target.value)
                                    }
                                    placeholder="Item code"
                                  />
                                ) : (
                                  <div className="table-static">{row.displayCode || "Missing"}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <input
                                    inputMode="decimal"
                                    className={`table-input numeric-input ${
                                      row.validation.issues.some((issue) => issue.includes("price")) ? "input-error" : ""
                                    }`}
                                    value={row.source.unit_cost}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "unit_cost", event.target.value)
                                    }
                                    placeholder="0.00"
                                  />
                                ) : (
                                  <div className="table-static">{money(row.displayPrice)}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <div className="pack-size-cell">
                                    <input
                                      inputMode="decimal"
                                      className="table-input numeric-input pack-size-value"
                                      value={parsePackSizeParts(row.source.pack_size).value}
                                      disabled={row.source.is_locked}
                                      onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                      onChange={(event) =>
                                        updateIngredientPackSize(row.source.id, "value", event.target.value)
                                      }
                                      placeholder="500"
                                      aria-label="Pack size value"
                                    />
                                    <select
                                      className="table-input pack-size-unit"
                                      value={parsePackSizeParts(row.source.pack_size).unit}
                                      disabled={row.source.is_locked}
                                      onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                      onChange={(event) =>
                                        updateIngredientPackSize(row.source.id, "unit", event.target.value)
                                      }
                                      aria-label="Pack size unit"
                                    >
                                      <option value="g">g</option>
                                      <option value="kg">kg</option>
                                    </select>
                                  </div>
                                ) : (
                                  <div className="table-static">{row.displayPackSize || "N/A"}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <input
                                    className="table-input"
                                    value={row.source.category}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "category", event.target.value)
                                    }
                                    placeholder="Category"
                                  />
                                ) : (
                                  <div className="table-static">{row.displayCategory || "N/A"}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <input
                                    className="table-input"
                                    value={row.source.supplier}
                                    disabled={row.source.is_locked}
                                    onFocus={() => focusIngredientCatalogueRow(row.source.id)}
                                    onChange={(event) =>
                                      updateIngredientField(row.source.id, "supplier", event.target.value)
                                    }
                                    placeholder="Supplier"
                                  />
                                ) : (
                                  <div className="table-static">{row.displaySupplier || "N/A"}</div>
                                )}
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <div className="table-static">{row.source.last_updated || "Auto"}</div>
                                ) : (
                                  <div className="table-static">{row.displayUpdated || "N/A"}</div>
                                )}
                              </td>
                              <td>{row.displayUsed}</td>
                              <td>
                                <div className="badge-row compact">
                                  {row.batchLink?.status === "not-applicable" ? (
                                    <Badge tone="default">Not needed</Badge>
                                  ) : null}
                                  {row.batchLink?.status === "ready" ? (
                                    <>
                                      <Badge tone="good">Linked</Badge>
                                      <Badge tone="default">{row.batchLink.recipeName}</Badge>
                                      <button
                                        type="button"
                                        className="secondary-button table-action-button"
                                        onClick={() => openRecipeInBuilder(row.batchLink.recipeId)}
                                      >
                                        Open recipe
                                      </button>
                                    </>
                                  ) : null}
                                  {row.batchLink?.status === "needs-review" ? (
                                    <>
                                      <Badge tone="warn">Recipe needs review</Badge>
                                      <Badge tone="default">{row.batchLink.recipeName}</Badge>
                                      <button
                                        type="button"
                                        className="secondary-button table-action-button"
                                        onClick={() => openRecipeInBuilder(row.batchLink.recipeId)}
                                      >
                                        Open recipe
                                      </button>
                                    </>
                                  ) : null}
                                  {row.batchLink?.status === "wrong-type" ? (
                                    <>
                                      <Badge tone="bad">Not a batch recipe</Badge>
                                      <Badge tone="default">{row.batchLink.recipeName}</Badge>
                                      <button
                                        type="button"
                                        className="secondary-button table-action-button"
                                        onClick={() => openRecipeInBuilder(row.batchLink.recipeId)}
                                      >
                                        Open recipe
                                      </button>
                                    </>
                                  ) : null}
                                  {row.batchLink?.status === "missing" ? (
                                    <>
                                      <Badge tone="bad">Missing batch recipe</Badge>
                                      {row.sourceKind === "ingredient-master" ? (
                                        <button
                                          type="button"
                                          className="secondary-button table-action-button"
                                          onClick={() => createBatchRecipeFromIngredient(row.source)}
                                        >
                                          Create batch recipe
                                        </button>
                                      ) : null}
                                    </>
                                  ) : null}
                                  {row.batchLink?.status === "recipe-batch" ? (
                                    <>
                                      <Badge tone="good">Recipe-backed batch</Badge>
                                      <Badge tone="default">{row.batchLink.recipeName}</Badge>
                                      <button
                                        type="button"
                                        className="secondary-button table-action-button"
                                        onClick={() => openRecipeInBuilder(row.batchLink.recipeId)}
                                      >
                                        Open recipe
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div className="badge-row compact">
                                  <Badge tone={row.validation.reviewStatus === "needs-review" ? "bad" : "good"}>
                                    {row.validation.reviewStatus === "needs-review" ? "Needs review" : "Ready"}
                                  </Badge>
                                  {row.sourceKind === "ingredient-master" && row.source.is_locked ? (
                                    <Badge tone="default">Locked</Badge>
                                  ) : null}
                                  {row.rowType === "batch" ? <Badge tone="default">{row.displayCode || "Batch ID missing"}</Badge> : null}
                                  {row.sourceKind === "ingredient-master" && row.source.linked_recipe_id ? (
                                    <Badge tone="good">Synced to {row.source.linked_recipe_id}</Badge>
                                  ) : null}
                                  {row.validation.issues.map((issue) => (
                                    <Badge key={`${row.id}-${getValidationIssueText(issue)}`} tone="warn">
                                      {getValidationIssueText(issue)}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                              <td>
                                {row.sourceKind === "ingredient-master" ? (
                                  <button
                                    type="button"
                                    className="secondary-button table-action-button"
                                    disabled={row.source.is_locked}
                                    onClick={() => deleteIngredientRow(row.source)}
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <div className="table-static">-</div>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="support-text">
                    Upload an ingredient master to review prices and codes in one place.
                  </p>
                )}
              </Card>
            </div>
          </div>
          </TabErrorBoundary>
        )}

        {activeTab === "imports" && (
          <div className="tab-panel">
            <div className="two-column">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Local import</div>
                    <h2>Alternate source files</h2>
                  </div>
                </div>
                <div className="support-stack">
                  <label className="form-field">
                    <span>Source format</span>
                    <select
                      value={selectedImportFormat}
                      onChange={(event) => setSelectedImportFormat(event.target.value)}
                    >
                      {importFormats.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="upload-format-card">
                    <div className="mini-heading">Expected files</div>
                    <div className="badge-row compact">
                      {selectedImportFormatDefinition.expectedFiles.map((file) => (
                        <Badge key={file} tone="default">
                          {file}
                        </Badge>
                      ))}
                    </div>
                    <p className="support-text">{selectedImportFormatDefinition.description}</p>
                  </div>
                  <label className="secondary-button file-button">
                    <input
                      type="file"
                      multiple
                      accept=".csv,text/csv,.json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleRecipeImportFiles}
                    />
                    Upload source file(s)
                  </label>
                  {googleSheetsEnabled ? (
                    <div className="google-sheets-card">
                      <div className="mini-heading">Google Sheets import</div>
                      <p className="support-text">
                        Paste public Google Sheets tab links. The app will fetch CSV exports and route them through
                        the same normalization flow.
                      </p>
                      {selectedImportFormat === "normalized-workbook-pair" ? (
                        <div className="support-stack">
                          <label className="form-field">
                            <span>Recipes sheet URL</span>
                            <input
                              value={googleSheetsUrls.recipes}
                              onChange={(event) =>
                                setGoogleSheetsUrls((current) => ({
                                  ...current,
                                  recipes: event.target.value,
                                }))
                              }
                              placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
                            />
                          </label>
                          <label className="form-field">
                            <span>Recipe components sheet URL</span>
                            <input
                              value={googleSheetsUrls.recipe_components}
                              onChange={(event) =>
                                setGoogleSheetsUrls((current) => ({
                                  ...current,
                                  recipe_components: event.target.value,
                                }))
                              }
                              placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="form-field">
                          <span>Sheet URL</span>
                          <input
                            value={googleSheetsUrls.recipes_flat}
                            onChange={(event) =>
                              setGoogleSheetsUrls((current) => ({
                                ...current,
                                recipes_flat: event.target.value,
                              }))
                            }
                            placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=..."
                          />
                        </label>
                      )}
                      <button type="button" className="secondary-button" onClick={handleGoogleSheetsImport}>
                        <Icon name="upload" />
                        Import from Google Sheets
                      </button>
                    </div>
                  ) : (
                    <div className="google-sheets-card">
                      <div className="mini-heading">Google Sheets import</div>
                      <p className="support-text">
                        Google Sheets paste-in is currently available for CSV-based formats only.
                      </p>
                    </div>
                  )}
                  {importMessage ? <p className="support-text success-text">{importMessage}</p> : null}
                  {importError ? <p className="support-text error-text">{importError}</p> : null}
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Google Drive handoff</div>
                    <h2>Folder config location</h2>
                  </div>
                </div>
                <div className="key-value-list">
                  <div><span>Example file</span><strong>{googleDriveConfigLocation.exampleFile}</strong></div>
                  <div><span>Local config</span><strong>{googleDriveConfigLocation.localFile}</strong></div>
                </div>
                <div className="support-stack import-notes">
                  {googleDriveConfigLocation.notes.map((note) => (
                    <p key={note} className="support-text">{note}</p>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Normalized preview</div>
                  <h2>
                    {importPreview?.output?.Dish_Index
                      ? "Dish index rows ready to load"
                      : "Recipes and components ready to merge"}
                  </h2>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={applyRecipeImport}
                  disabled={!importPreview}
                >
                  <Icon name="upload" />
                  Merge import
                </button>
              </div>
              {importPreview ? (
                <div className="import-preview-grid">
                  {importPreview.output.Dish_Index ? (
                    <>
                      <div className="stats-grid two-up">
                        <StatCard label="Dish index rows" value={importPreview.output.Dish_Index.length} />
                        <StatCard
                          label="Venue tabs"
                          value={new Set(importPreview.output.Dish_Index.map((row) => row.source_tab)).size}
                        />
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Source tab</th>
                              <th>Venue</th>
                              <th>Course</th>
                              <th>Dish</th>
                              <th>Old</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.output.Dish_Index.slice(0, 12).map((row) => (
                              <tr key={row.entry_id}>
                                <td>{row.source_tab}</td>
                                <td>{normalizeVenueName(row.venue, row.source_tab)}</td>
                                <td>{row.course}</td>
                                <td className="strong-cell">{row.dish_name}</td>
                                <td>{normalizeBooleanFlag(row.old_flag) ? "Yes" : "No"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="stats-grid two-up">
                        <StatCard label="Recipes" value={importPreview.output.Recipes.length} />
                        <StatCard
                          label="Components"
                          value={importPreview.output.Recipe_Components.length}
                        />
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Recipe ID</th>
                              <th>Restaurant</th>
                              <th>Name</th>
                              <th>Category</th>
                              <th>Code</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.output.Recipes.slice(0, 10).map((recipe) => (
                              <tr key={recipe.recipe_id}>
                                <td>{recipe.recipe_id}</td>
                                <td>{getRecipeVenueLabel(recipe)}</td>
                                <td className="strong-cell">{recipe.name}</td>
                                <td>{recipe.category}</td>
                                <td>{recipe.selling_item_code}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="support-text">
                  Choose a source format and upload the relevant file set to preview the normalized import output.
                </p>
              )}
            </Card>
          </div>
        )}

        {activeTab === "dish-index" && (
          <div className="tab-panel">
            <div className="stats-grid">
              <StatCard
                label="Indexed dishes"
                value={dishIndexSummary.total}
                onClick={() => setDishIndexStatusFilter("all")}
              />
              <StatCard
                label="Matched"
                value={dishIndexSummary.matched}
                tone={dishIndexSummary.matched ? "positive" : ""}
                onClick={() => setDishIndexStatusFilter("matched")}
              />
              <StatCard
                label="Possible matches"
                value={dishIndexSummary.possible}
                tone={dishIndexSummary.possible ? "warning" : ""}
                onClick={() => setDishIndexStatusFilter("possible")}
              />
              <StatCard
                label="Missing recipes"
                value={dishIndexSummary.missing}
                tone={dishIndexSummary.missing ? "negative" : ""}
                onClick={() => setDishIndexStatusFilter("missing")}
              />
            </div>
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Dish index</div>
                  <h2>Imported venue dishes</h2>
                </div>
              </div>
              <div className="toolbar-row">
                <label className="form-field compact">
                  <span>Status</span>
                  <select
                    value={dishIndexStatusFilter}
                    onChange={(event) => setDishIndexStatusFilter(event.target.value)}
                  >
                    <option value="all">All rows</option>
                    <option value="matched">Matched</option>
                    <option value="possible">Possible matches</option>
                    <option value="missing">Missing recipes</option>
                  </select>
                </label>
                <label className="form-field grow">
                  <span>Search</span>
                  <input
                    value={dishIndexSearch}
                    onChange={(event) => setDishIndexSearch(event.target.value)}
                    placeholder="Search venue, course, dish or matched recipe"
                  />
                </label>
                <label className="checkbox-field dish-index-archive-toggle">
                  <input
                    type="checkbox"
                    checked={showArchivedDishIndexRows}
                    onChange={(event) => setShowArchivedDishIndexRows(event.target.checked)}
                  />
                  <span>Show archived</span>
                </label>
              </div>
              <div className="table-wrap">
                <table className="dish-index-table">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Course</th>
                      <th>Dish</th>
                      <th>Old</th>
                      <th>Match</th>
                      <th>Confidence</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDishIndexRows.map((row) => (
                      <Fragment key={row.id}>
                        <tr>
                          <td>
                            <div>{row.venue || "Blank"}</div>
                            <div className="support-text">{row.sourceTab}</div>
                          </td>
                          <td>{row.course || "Uncategorised"}</td>
                          <td className="strong-cell">{row.dishName}</td>
                          <td>{normalizeBooleanFlag(row.oldFlag) ? "Yes" : "No"}</td>
                          <td>
                            <Badge
                              tone={
                                row.match.status === "matched"
                                  ? "positive"
                                  : row.match.status === "possible"
                                    ? "warning"
                                    : "negative"
                              }
                            >
                              {row.match.status === "matched"
                                ? "Matched"
                                : row.match.status === "possible"
                                  ? "Possible"
                                  : "Missing"}
                            </Badge>
                            {row.match.recipe ? (
                              <div className="support-text">{row.match.recipe.name}</div>
                            ) : (
                              <div className="support-text">No recipe linked yet</div>
                            )}
                            {row.match.source === "manual-link" ? (
                              <div className="support-text success-text">Confirmed manually</div>
                            ) : null}
                            {row.match.source === "manual-no-recipe" ? (
                              <div className="support-text">Marked as no recipe yet</div>
                            ) : null}
                            {row.isArchived ? (
                              <div className="support-text">Archived</div>
                            ) : null}
                          </td>
                          <td>{row.match.confidence === "none" ? "Low" : row.match.confidence}</td>
                          <td>
                            <div className="inline-actions">
                              {row.match.recipe ? (
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={() => openRecipeInBuilder(row.match.recipe.id)}
                                >
                                  Open match
                                </button>
                              ) : null}
                              {row.match.recipe && row.match.source !== "manual-link" ? (
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={() => confirmDishIndexMatch(row.id, row.match.recipe.id)}
                                >
                                  Confirm match
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={() =>
                                  activeDishIndexLookupId === row.id
                                    ? setActiveDishIndexLookupId(null)
                                    : openDishIndexLookup(row)
                                }
                              >
                                {activeDishIndexLookupId === row.id ? "Close search" : "Search another recipe"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={() => createRecipeFromDishIndex(row)}
                              >
                                Create recipe
                              </button>
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={() => markDishIndexNoRecipe(row.id)}
                              >
                                No recipe yet
                              </button>
                              {(row.reviewState || row.linkedRecipeId) ? (
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={() => clearDishIndexDecision(row.id)}
                                >
                                  Clear review
                                </button>
                              ) : null}
                              {row.match.source === "manual-link" && !row.isArchived ? (
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={() => archiveDishIndexRow(row.id)}
                                >
                                  Archive
                                </button>
                              ) : null}
                              {row.isArchived ? (
                                <button
                                  type="button"
                                  className="secondary-button small"
                                  onClick={() => unarchiveDishIndexRow(row.id)}
                                >
                                  Unarchive
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {activeDishIndexLookupId === row.id ? (
                          <tr className="dish-index-search-row">
                            <td colSpan="7">
                              <div className="dish-index-search-panel">
                                <div className="toolbar-row">
                                  <label className="form-field grow">
                                    <span>Find recipe</span>
                                    <input
                                      value={dishIndexLookupQuery}
                                      onChange={(event) => setDishIndexLookupQuery(event.target.value)}
                                      placeholder="Type recipe name, code, category or venue"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => setDishIndexLookupQuery("")}
                                  >
                                    Clear
                                  </button>
                                </div>
                                <div className="dish-index-search-results">
                                  {dishIndexLookupOptions.map((recipe) => (
                                    <button
                                      key={recipe.id}
                                      type="button"
                                      className="lookup-option"
                                      onClick={() => confirmDishIndexMatch(row.id, recipe.id)}
                                    >
                                      <div className="lookup-main">
                                        <strong>{recipe.name || "Untitled recipe"}</strong>
                                        <span>{recipe.sellingItemCode || "No code"}</span>
                                      </div>
                                      <div className="lookup-meta">
                                        <span>{getRecipeVenueLabel(recipe)}</span>
                                        <span>{recipe.category || "Uncategorised"}</span>
                                      </div>
                                    </button>
                                  ))}
                                  {!dishIndexLookupOptions.length ? (
                                    <div className="empty-cell">No recipes match that search yet.</div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                    {!filteredDishIndexRows.length ? (
                      <tr>
                        <td colSpan="7" className="empty-cell">
                          No dish index rows match the current filters yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {activeTab === "summary" && (
          <div className="tab-panel">
            <div className="stats-grid">
              <StatCard label="Venues" value={venueSummary.length} />
              <StatCard label="Recipes loaded" value={recipes.length} />
              <StatCard
                label="Workbook components"
                value={workbook.sheets.Recipe_Components.rows.length}
              />
              <StatCard label="Menus loaded" value={menus.length} />
            </div>
            <div className="two-column">
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Import layer</div>
                    <h2>Supported recipe source formats</h2>
                  </div>
                </div>
                <div className="import-format-list">
                  {importFormats.map((format) => (
                    <div key={format.id} className="import-format-card">
                      <div className="import-format-top">
                        <strong>{format.label}</strong>
                        <Badge tone="default">{format.id}</Badge>
                      </div>
                      <p className="support-text">{format.description}</p>
                      <p className="support-text">Files: {format.expectedFiles.join(", ")}</p>
                      <div className="badge-row compact">
                        {format.mapsTo.map((target) => (
                          <Badge key={target} tone="good">
                            {target}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Google Drive config</div>
                    <h2>Folder configuration</h2>
                  </div>
                </div>
                <div className="key-value-list">
                  <div><span>Example file</span><strong>{googleDriveConfigLocation.exampleFile}</strong></div>
                  <div><span>Local config</span><strong>{googleDriveConfigLocation.localFile}</strong></div>
                </div>
                <div className="support-stack import-notes">
                  {googleDriveConfigLocation.notes.map((note) => (
                    <p key={note} className="support-text">{note}</p>
                  ))}
                </div>
              </Card>
            </div>
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Venue summary</div>
                  <h2>Workbook rollup</h2>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Dishes</th>
                      <th>Recipe cost</th>
                      <th>Sale value</th>
                      <th>GP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venueSummary.map((row) => (
                      <tr key={row.restaurant}>
                        <td className="strong-cell">{row.restaurant}</td>
                        <td>{row.dishes}</td>
                        <td>{money(row.recipeCost)}</td>
                        <td>{money(row.saleValue)}</td>
                        <td>{percent(row.gp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Venue manager</div>
                  <h2>Add and review venues</h2>
                </div>
              </div>
              <div className="support-stack">
                <div className="form-grid">
                  <label>
                    <span>New venue</span>
                    <input
                      value={newVenueName}
                      onChange={(event) => setNewVenueName(event.target.value)}
                      placeholder="Courtyard"
                    />
                  </label>
                  <label>
                    <span>Action</span>
                    <button type="button" className="primary-button" onClick={addVenue}>
                      <Icon name="plus" />
                      Add venue
                    </button>
                  </label>
                </div>
                <div className="badge-row compact">
                  {venues.map((venue) => (
                    <Badge key={venue} tone="default">{venue}</Badge>
                  ))}
                </div>
                <p className="support-text">
                  Recipe venue fields now use this shared list. Menus will generate lunch and dinner service options from it.
                </p>
              </div>
            </Card>
          </div>
        )}

        {activeTab === "users" && (
          <div className="tab-panel">
            {currentUserRole !== "manager" ? (
              <Card>
                <p className="support-text">Only managers can access user administration.</p>
              </Card>
            ) : (
              <Card>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">User administration</div>
                    <h2>Manage access roles</h2>
                  </div>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="tab-button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleRefreshUsersButton();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        handleRefreshUsersButton();
                      }}
                    >
                      Refresh users
                    </button>
                  </div>
                </div>
                <p className="support-text">
                  Use this screen to set each signed-in user as `viewer`, `editor`, or `manager`.
                </p>
                <div className="review-box">
                  <strong>Create users in Supabase</strong>
                  <p className="support-text">
                    Add new users in Supabase `Authentication &gt; Users`, then come back here to assign each person as
                    `viewer`, `editor`, or `manager`.
                  </p>
                </div>
                {userAdminMessage ? <p className="support-text success-text">{userAdminMessage}</p> : null}
                {userAdminError ? <p className="support-text error-text">{userAdminError}</p> : null}
                <div className="table-wrap">
                  <table className="dish-index-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userProfiles.map((profile) => (
                        <tr key={profile.id}>
                          <td className="strong-cell">{profile.email || "No email"}</td>
                          <td>{profile.full_name || "—"}</td>
                          <td>
                            <select
                              value={profile.role || "viewer"}
                              onChange={(event) => updateUserRole(profile.id, event.target.value)}
                            >
                              <option value="viewer">Viewer</option>
                              <option value="editor">Editor</option>
                              <option value="manager">Manager</option>
                            </select>
                          </td>
                          <td>{profile.created_at ? String(profile.created_at).slice(0, 10) : "—"}</td>
                        </tr>
                      ))}
                      {!userProfiles.length ? (
                        <tr>
                          <td colSpan="4" className="empty-cell">No user profiles found yet.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === "bch-audit" && (
          <div className="tab-panel">
            <div className="stats-grid">
              <StatCard label="BCH codes" value={bchAuditSummary.total} onClick={() => setActiveTab("bch-audit")} />
              <StatCard label="Linked" value={bchAuditSummary.linked} tone={bchAuditSummary.linked ? "positive" : ""} />
              <StatCard label="Missing parent recipe" value={bchAuditSummary.missing} tone={bchAuditSummary.missing ? "negative" : ""} />
              <StatCard label="Need classification" value={bchAuditSummary.needsReview} tone={bchAuditSummary.needsReview ? "warning" : ""} />
            </div>
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">BCH audit</div>
                  <h2>Review BCH-coded component recipes</h2>
                </div>
              </div>
              <div className="table-wrap">
                <table className="dish-index-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Parent recipe</th>
                      <th>Used in</th>
                      <th>Classification</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bchAuditRows.map((row) => (
                      <tr key={row.code}>
                        <td className="strong-cell">{row.code}</td>
                        <td>
                          <div className="strong-cell">{row.name}</div>
                          <div className="support-text">Heuristic: {row.heuristic}</div>
                        </td>
                        <td>
                          {row.hasBatchRecipe ? (
                            <>
                              <Badge tone={row.resolvedBatchReviewStatus === "ready" ? "good" : "warn"}>
                                {row.resolvedBatchRecipeName}
                              </Badge>
                              <div className="support-text">{row.resolvedBatchRecipeId}</div>
                            </>
                          ) : (
                            <>
                              <Badge tone="bad">Missing</Badge>
                              <div className="support-text">No batch recipe currently resolves for this BCH code</div>
                            </>
                          )}
                        </td>
                        <td>{row.usageCount}</td>
                        <td>
                          <label className="form-field compact">
                            <span>Type</span>
                            <select
                              value={row.classification}
                              onChange={(event) =>
                                updateBchAuditDecision(row.code, { classification: event.target.value })
                              }
                            >
                              <option value="needs-review">Needs review</option>
                              <option value="true-batch">True batch</option>
                              <option value="prep-item">Prep item</option>
                              <option value="scaled-dish">Scaled dish</option>
                            </select>
                          </label>
                        </td>
                        <td>
                          <div className="inline-actions">
                            {row.hasBatchRecipe ? (
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={() => openRecipeInBuilder(row.resolvedBatchRecipeId)}
                              >
                                Open batch recipe
                              </button>
                            ) : null}
                            {row.usedInRecipes[0] ? (
                              <button
                                type="button"
                                className="secondary-button small"
                                onClick={() => openRecipeInBuilder(row.usedInRecipes[0].recipeId)}
                              >
                                Open first usage
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!bchAuditRows.length ? (
                      <tr>
                        <td colSpan="6" className="empty-cell">No BCH component codes found in the current recipe set.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

      </div>
      {exportPreview && typeof document !== "undefined"
        ? createPortal(
            <div className="export-modal-overlay" onClick={closeExportPreview}>
              <div className="export-modal" onClick={(event) => event.stopPropagation()}>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Export preview</div>
                    <h2>{exportPreview.title}</h2>
                  </div>
                  <div className="badge-row compact">
                    {exportPreview.csvContent ? (
                      <button type="button" className="secondary-button" onClick={downloadExportPreviewCsv}>
                        Download CSV
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={printExportPreview}>
                      Print / Save PDF
                    </button>
                    <button type="button" className="secondary-button" onClick={closeExportPreview}>
                      Close
                    </button>
                  </div>
                </div>
                <iframe
                  ref={exportPreviewFrameRef}
                  className="export-preview-frame"
                  title={exportPreview.title}
                  srcDoc={exportPreview.html}
                />
              </div>
            </div>,
            document.body
          )
        : null}
      {quickPanel && typeof document !== "undefined"
        ? createPortal(
            <div className="quick-panel-overlay" onClick={() => setQuickPanel(null)}>
              <aside className="quick-panel-drawer" onClick={(event) => event.stopPropagation()}>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Quick edit</div>
                    <h2>
                      {quickPanelIngredient
                        ? quickPanelIngredient.ingredient_name || "Ingredient source"
                        : quickPanelBatch?.name || "Source"}
                    </h2>
                  </div>
                  <div className="badge-row compact">
                    {quickPanelIngredient ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          openIngredientInCatalogue(quickPanelIngredient);
                          setQuickPanel(null);
                        }}
                      >
                        Open full ingredient
                      </button>
                    ) : null}
                    {quickPanelBatch ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          openRecipeInBuilder(quickPanelBatch.id);
                          setQuickPanel(null);
                        }}
                      >
                        Open full batch recipe
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => setQuickPanel(null)}>
                      Close
                    </button>
                  </div>
                </div>

                {quickPanelIngredient ? (
                  <div className="support-stack">
                    <div className="ingredient-builder-grid">
                      <label className="form-field">
                        <span>Type</span>
                        <select
                          value={quickPanelIngredient.entry_type || "ingredient"}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "entry_type", event.target.value)
                          }
                        >
                          <option value="ingredient">Ingredient</option>
                          <option value="batch">Batch</option>
                        </select>
                      </label>
                      <label className="form-field">
                        <span>Ingredient name</span>
                        <input
                          value={quickPanelIngredient.ingredient_name}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "ingredient_name", event.target.value)
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>Item code</span>
                        <input
                          value={quickPanelIngredient.ingredient_item_code}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(
                              quickPanelIngredient.id,
                              "ingredient_item_code",
                              event.target.value
                            )
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>Unit price</span>
                        <input
                          inputMode="decimal"
                          value={quickPanelIngredient.unit_cost}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "unit_cost", event.target.value)
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>Pack size</span>
                        <div className="pack-size-cell">
                          <input
                            inputMode="decimal"
                            className="table-input numeric-input pack-size-value"
                            value={parsePackSizeParts(quickPanelIngredient.pack_size).value}
                            disabled={quickPanelIngredient.is_locked}
                            onChange={(event) =>
                              updateIngredientField(
                                quickPanelIngredient.id,
                                "pack_size",
                                formatPackSize(
                                  event.target.value,
                                  parsePackSizeParts(quickPanelIngredient.pack_size).unit
                                )
                              )
                            }
                          />
                          <select
                            className="table-input pack-size-unit"
                            value={parsePackSizeParts(quickPanelIngredient.pack_size).unit}
                            disabled={quickPanelIngredient.is_locked}
                            onChange={(event) =>
                              updateIngredientField(
                                quickPanelIngredient.id,
                                "pack_size",
                                formatPackSize(
                                  parsePackSizeParts(quickPanelIngredient.pack_size).value,
                                  event.target.value
                                )
                              )
                            }
                          >
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                          </select>
                        </div>
                      </label>
                      <label className="form-field">
                        <span>Category</span>
                        <input
                          value={quickPanelIngredient.category}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "category", event.target.value)
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>Supplier</span>
                        <input
                          value={quickPanelIngredient.supplier}
                          disabled={quickPanelIngredient.is_locked}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "supplier", event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className="badge-row compact">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={Boolean(quickPanelIngredient.is_locked)}
                          onChange={(event) =>
                            updateIngredientField(quickPanelIngredient.id, "is_locked", event.target.checked)
                          }
                        />
                        <span>Lock ingredient</span>
                      </label>
                      <Badge
                        tone={
                          quickPanelIngredient.validation.reviewStatus === "needs-review" ? "bad" : "good"
                        }
                      >
                        {quickPanelIngredient.validation.reviewStatus === "needs-review"
                          ? "Needs review"
                          : "Ready"}
                      </Badge>
                    </div>
                    {quickPanelIngredient.validation.issues.length ? (
                      <div className="badge-row compact">
                        {quickPanelIngredient.validation.issues.map((issue) => (
                          <Badge
                            key={`${quickPanelIngredient.id}-${getValidationIssueText(issue)}`}
                            tone="bad"
                          >
                            {getValidationIssueText(issue)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {quickPanelBatch ? (
                  <div className="support-stack">
                    <div className="summary-banner">
                      <div>
                        <span>Batch code</span>
                        <strong>{quickPanelBatch.sellingItemCode || quickPanelBatch.id}</strong>
                      </div>
                      <div>
                        <span>Yield</span>
                        <strong>
                          {numberValue(quickPanelBatch.batchYield)} {getBatchYieldLabel(quickPanelBatch)}
                        </strong>
                      </div>
                      <div>
                        <span>Unit cost</span>
                        <strong>{money(getBatchUnitCost(quickPanelBatch))}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong>
                          {quickPanelBatch.validation.reviewStatus === "needs-review"
                            ? "Needs review"
                            : "Ready"}
                        </strong>
                      </div>
                    </div>
                    <div className="support-text">
                      Batch recipes are still edited in the full builder because they have components, yield, method, and traceability. This pop-out is here to confirm you have the right source before jumping away.
                    </div>
                  </div>
                ) : null}
              </aside>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default App;

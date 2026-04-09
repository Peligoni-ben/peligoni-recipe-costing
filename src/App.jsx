import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import workbook from "./data/workbook-data.json";
import { googleDriveConfigLocation } from "./imports/googleDriveConfig";
import { listRecipeImportFormats, normalizeImportedRecipeSource } from "./imports";
import { parseRecipeImportContents, parseRecipeImportFiles } from "./imports/parsers";
import { supportsGoogleSheetsImport, toGoogleSheetsCsvExportUrl } from "./imports/googleSheets";
import { supabase, supabaseAnonKey, supabaseEnabled, supabaseUrl } from "./lib/supabase";
import BuilderTab from "./tabs/BuilderTab";
import ExistingRecipeEditor from "./tabs/ExistingRecipeEditor";
import DishInventoryTab from "./tabs/DishInventoryTab";
import IngredientsTab from "./tabs/IngredientsTab";
import MenusTab from "./tabs/MenusTab";
import NewRecipeBuilder from "./tabs/NewRecipeBuilder";
import RecipesTab from "./tabs/RecipesTab";
import SetMenusTab from "./tabs/SetMenusTab";

const INGREDIENT_MASTER_STORAGE_KEY = "peligoni-ingredient-master";
const DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY = "peligoni-deleted-ingredient-signatures";
const RECIPES_STORAGE_KEY = "peligoni-working-recipes";
const MENUS_STORAGE_KEY = "peligoni-working-menus";
const VENUES_STORAGE_KEY = "peligoni-working-venues";
const DISH_INDEX_STORAGE_KEY = "peligoni-dish-index";
const BCH_AUDIT_STORAGE_KEY = "peligoni-bch-audit";
const RECIPE_AVAILABLE_VENUES_STORAGE_KEY = "peligoni-recipe-available-venues";
const EDIT_SESSION_STALE_MS = 90 * 1000;
const REQUIRED_INGREDIENT_COLUMNS = [
  "ingredient_name",
  "ingredient_item_code",
  "unit_cost",
];
const OPTIONAL_INGREDIENT_COLUMNS = [
  "purchase_vat_rate",
  "pack_size",
  "supplier",
  "category",
  "last_updated",
  "entry_type",
  "linked_recipe_id",
  "is_locked",
];
const MENU_COURSE_PRESETS = ["Starter", "Main", "Dessert", "Side", "Small plates", "Large plates"];
const FOOD_SALE_VAT_RATE = 0.13;
const FOOD_TARGET_COST_RATIO = 0.3;
const FOOD_PURCHASE_VAT_OPTIONS = [0.13, 0.24];
const MANUAL_COMPONENT_SOURCE_TYPE = "manual";
const DEFAULT_SERVICE_PERIODS = ["breakfast", "brunch", "lunch", "aperitivo", "dinner", "all day"];
const DEFAULT_VENUES = [
  "Tasi",
  "Terraces",
  "Courtyard",
  "Pop up Kitchen",
  "The Deli Kitchen",
  "Mikro Nisi",
  "Special Events",
];
const VENUE_SERVICE_PERIODS = Object.fromEntries(
  DEFAULT_VENUES.map((venue) => [venue, DEFAULT_SERVICE_PERIODS])
);
const VENUE_ALIASES = {
  cy: "Courtyard",
  courtyard: "Courtyard",
  tasi: "Tasi",
  terraces: "Terraces",
  "pop up": "Pop up Kitchen",
  popup: "Pop up Kitchen",
  "pop up kitchen": "Pop up Kitchen",
  "popup kitchen": "Pop up Kitchen",
  deli: "The Deli Kitchen",
  "the deli": "The Deli Kitchen",
  "deli kitchen": "The Deli Kitchen",
  "the deli kitchen": "The Deli Kitchen",
  mikronisi: "Mikro Nisi",
  "mikro nisi": "Mikro Nisi",
  "special event": "Special Events",
  "special events": "Special Events",
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

function toTitleCaseWords(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-\/(])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function calculateRoundupTarget(recipeCost) {
  const cost = numberValue(recipeCost);
  if (cost <= 0) return 0;
  const targetNetSalePrice = cost / FOOD_TARGET_COST_RATIO;
  const targetGrossSalePrice = targetNetSalePrice * (1 + FOOD_SALE_VAT_RATE);
  return Math.ceil(targetGrossSalePrice * 2) / 2;
}

function getFoodNetSalePrice(grossSalePrice) {
  const gross = numberValue(grossSalePrice);
  if (gross <= 0) return 0;
  return gross / (1 + FOOD_SALE_VAT_RATE);
}

function getRecipeComponentTotalCost(recipe) {
  return (recipe?.components || []).reduce((sum, component) => sum + numberValue(component.cost), 0);
}

function getDishPortionCount(recipe) {
  return Math.max(1, numberValue(recipe?.portionCount) || 1);
}

function getRecipeCostValue(recipe) {
  const totalComponentCost = getRecipeComponentTotalCost(recipe);
  if (recipe?.recipeType === "batch") {
    return totalComponentCost;
  }

  return totalComponentCost / getDishPortionCount(recipe);
}

function normalizePurchaseVatRate(value) {
  const numericValue = numberValue(value);
  if (numericValue >= 1) {
    const normalizedPercent = numericValue / 100;
    return FOOD_PURCHASE_VAT_OPTIONS.includes(normalizedPercent) ? normalizedPercent : FOOD_PURCHASE_VAT_OPTIONS[0];
  }
  return FOOD_PURCHASE_VAT_OPTIONS.includes(numericValue) ? numericValue : FOOD_PURCHASE_VAT_OPTIONS[0];
}

function percentFromRate(rate) {
  return `${Math.round(normalizePurchaseVatRate(rate) * 100)}%`;
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
    .match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l)?$/i);

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
  const purchaseVatRate =
    String(ingredient?.entry_type || "").trim() === "batch"
      ? 0
      : normalizePurchaseVatRate(ingredient?.purchase_vat_rate);
  const grossUnitCost = baseUnitCost > 0 ? baseUnitCost * (1 + purchaseVatRate) : 0;
  const packParts = parsePackSizeParts(ingredient?.pack_size);
  const packValue = numberValue(packParts.value);

  if (grossUnitCost <= 0) {
    return {
      sourceUnitCost: 0,
      sourceYieldType: "kg",
    };
  }

  if (packValue > 0) {
    const isLiquid = packParts.unit === "ml" || packParts.unit === "l";
    const totalBaseUnits = packParts.unit === "kg" || packParts.unit === "l" ? packValue * 1000 : packValue;
    if (totalBaseUnits > 0) {
      return {
        sourceUnitCost: (grossUnitCost / totalBaseUnits) * 1000,
        sourceYieldType: isLiquid ? "l" : "kg",
      };
    }
  }

  return {
    sourceUnitCost: grossUnitCost,
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
  const matchedService = [...DEFAULT_SERVICE_PERIODS]
    .sort((left, right) => right.length - left.length)
    .find((service) => raw.toLowerCase().endsWith(` ${service}`));
  if (!matchedService) return raw;
  return raw.slice(0, raw.length - matchedService.length).trim();
}

function getMenuServicePeriod(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const matchedService = [...DEFAULT_SERVICE_PERIODS]
    .sort((left, right) => right.length - left.length)
    .find((service) => raw.toLowerCase().endsWith(` ${service}`));
  return matchedService || "";
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

function getAvailableVenueListForRecipe(recipe, availableVenueMap = {}) {
  if (!recipe || recipe.recipeType === "batch") return [];
  const recipeVenues = Array.isArray(recipe.availableVenues)
    ? recipe.availableVenues.map((venue) => String(venue || "").trim()).filter(Boolean)
    : [];
  if (recipeVenues.length) {
    return Array.from(new Set(recipeVenues)).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
    );
  }
  const storedVenues = Array.isArray(availableVenueMap?.[recipe.id])
    ? availableVenueMap[recipe.id].map((venue) => String(venue || "").trim()).filter(Boolean)
    : [];
  if (storedVenues.length) {
    return Array.from(new Set(storedVenues)).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
    );
  }
  const primaryVenue = String(recipe.restaurant || "").trim();
  return primaryVenue ? [primaryVenue] : [];
}

function getSecondaryVenueListForRecipe(recipe, availableVenueMap = {}) {
  const primaryVenue = String(recipe?.restaurant || "").trim();
  return getAvailableVenueListForRecipe(recipe, availableVenueMap).filter((venue) => venue !== primaryVenue);
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
      purchase_vat_rate: 0,
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
  const dishRecipes = (recipes || []).filter((recipe) => recipe?.recipeType !== "batch");
  const linkedRecipe = row.linkedRecipeId
    ? (recipes || []).find((recipe) => recipe.id === row.linkedRecipeId) || null
    : null;

  if (row.reviewState === "no-recipe") {
    return {
      status: "missing",
      confidence: "manual",
      score: 0,
      recipe: null,
      source: "manual-no-recipe",
    };
  }

  if (linkedRecipe && linkedRecipe.recipeType !== "batch") {
    return {
      status: "matched",
      confidence: "manual",
      score: 1,
      recipe: linkedRecipe,
      source: "manual-link",
    };
  }

  if (linkedRecipe && linkedRecipe.recipeType === "batch") {
    return {
      status: "invalid",
      confidence: "manual",
      score: 0,
      recipe: linkedRecipe,
      source: "invalid-batch-link",
    };
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

  const exactMatches = dishRecipes.filter((recipe) => normalizeMatchKey(recipe.name) === dishNameKey);
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

  dishRecipes.forEach((recipe) => {
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
  const currentById = new Map((currentRows || []).map((row) => [row.id, row]));
  const nextImportedRows = (importedRows || []).map((row) => {
    const existing = currentById.get(row.id);
    if (!existing) return row;
    return {
      ...row,
      linkedRecipeId: existing.linkedRecipeId || "",
      reviewState: existing.reviewState || "",
      isArchived: Boolean(existing.isArchived),
    };
  });
  const importedIds = new Set(nextImportedRows.map((row) => row.id));
  const preserved = (currentRows || []).filter((row) => !importedIds.has(row.id));
  return [...nextImportedRows, ...preserved];
}

function resolveServiceMenuTarget(currentMenus, menuRestaurant) {
  const exactMatch = (currentMenus || []).find((menu) => menu.restaurant === menuRestaurant) || null;
  if (exactMatch) return exactMatch;

  const baseVenue = getBaseVenueName(menuRestaurant);
  const requestedService = getMenuServicePeriod(menuRestaurant);
  if (!baseVenue || !requestedService) return null;

  const unscopedVenueMenus = (currentMenus || []).filter(
    (menu) => getBaseVenueName(menu.restaurant) === baseVenue && !getMenuServicePeriod(menu.restaurant)
  );

  return unscopedVenueMenus.length === 1 ? unscopedVenueMenus[0] : null;
}

function createRecipeDraft(defaultRestaurant = "Tasi") {
  return {
    restaurant: defaultRestaurant,
    secondaryVenues: [],
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

const RECIPE_PASTE_HEADINGS = {
  ingredients: ["ingredients", "ingredient list", "for the ingredients"],
  method: ["method", "instructions", "preparation", "directions", "to make", "steps"],
};

const RECIPE_PASTE_UNITS = new Set([
  "g",
  "kg",
  "ml",
  "l",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
  "cup",
  "cups",
  "oz",
  "lb",
  "lbs",
  "pinch",
  "pinches",
  "clove",
  "cloves",
  "sprig",
  "sprigs",
  "bunch",
  "bunches",
  "slice",
  "slices",
  "piece",
  "pieces",
]);

const RECIPE_PASTE_METADATA_PREFIXES = [
  "serves",
  "serving",
  "servings",
  "yield",
  "makes",
  "prep time",
  "cook time",
  "total time",
  "ready in",
  "difficulty",
];

const RECIPE_PASTE_FRACTIONS = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const RECIPE_PASTE_WORD_NUMBERS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
  quarter: 0.25,
};

function normalizePastedRecipeLine(line) {
  return String(line || "")
    .replace(/\r/g, "")
    .replace(/\u2022/g, "-")
    .trim();
}

function isRecipePasteHeading(line, type) {
  const normalized = normalizeMatchKey(line).replace(/:$/, "");
  return RECIPE_PASTE_HEADINGS[type].includes(normalized);
}

function isLikelyMethodLine(line) {
  const normalized = String(line || "").trim();
  if (!normalized) return false;
  if (/^\d+[\).\s-]/.test(normalized)) return true;
  if (/^step\s*\d+/i.test(normalized)) return true;
  return /^(mix|whisk|stir|add|cook|bake|heat|combine|place|roast|blend|pour|serve|season|fold|marinate|grill)\b/i.test(
    normalized
  );
}

function isRecipeMetadataLine(line) {
  const normalized = normalizeMatchKey(line);
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+servings?$/.test(normalized)) return true;
  return RECIPE_PASTE_METADATA_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseRecipeQuantity(quantityText) {
  const raw = String(quantityText || "").trim();
  if (!raw) return 0;
  const normalized = normalizeMatchKey(raw);
  if (RECIPE_PASTE_WORD_NUMBERS[normalized] != null) return RECIPE_PASTE_WORD_NUMBERS[normalized];
  if (RECIPE_PASTE_FRACTIONS[raw]) return RECIPE_PASTE_FRACTIONS[raw];
  if (raw.includes(" ")) {
    const [wholeText, fractionText] = raw.split(/\s+/, 2);
    if (RECIPE_PASTE_WORD_NUMBERS[normalizeMatchKey(wholeText)] != null && !fractionText?.includes("/")) {
      return RECIPE_PASTE_WORD_NUMBERS[normalizeMatchKey(wholeText)];
    }
    if (fractionText?.includes("/")) {
      const [top, bottom] = fractionText.split("/").map(Number);
      return Number(wholeText) + (bottom ? top / bottom : 0);
    }
  }
  if (raw.includes("/")) {
    const [top, bottom] = raw.split("/").map(Number);
    return bottom ? top / bottom : 0;
  }
  return Number(raw);
}

function looksLikeIngredientLine(line) {
  const cleaned = String(line || "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[\).\s-]+/, "")
    .trim();
  if (!cleaned) return false;
  if (isRecipeMetadataLine(cleaned) || isLikelyMethodLine(cleaned)) return false;
  if (/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*/.test(cleaned)) return true;
  if (/^[-*]\s+/.test(line || "")) return true;
  if (/[,:-]\s*(\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\b/.test(cleaned)) return true;
  return cleaned.split(/\s+/).length <= 6;
}

function parseRecipeIngredientLine(line, fallbackSort) {
  const cleaned = String(line || "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[\).\s-]+/, "")
    .trim();

  if (!cleaned || cleaned.endsWith(":") || isRecipeMetadataLine(cleaned)) return null;

  let qty = 0;
  let remainder = cleaned;
  let quantityMatch = cleaned.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s+(.*)$/i);

  if (quantityMatch) {
    const quantityText = quantityMatch[1];
    remainder = quantityMatch[2].trim();
    qty = parseRecipeQuantity(quantityText);

    const unitMatch = remainder.match(/^([A-Za-z]+)\b\.?\s*(.*)$/);
    if (unitMatch && RECIPE_PASTE_UNITS.has(unitMatch[1].toLowerCase())) {
      remainder = unitMatch[2].trim();
    }
  } else {
    quantityMatch = cleaned.match(
      /^(\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])([A-Za-z]+)\s+(.*)$/i
    );
    if (quantityMatch && RECIPE_PASTE_UNITS.has(String(quantityMatch[2] || "").toLowerCase())) {
      qty = parseRecipeQuantity(quantityMatch[1]);
      remainder = quantityMatch[3].trim();
    } else {
    quantityMatch = cleaned.match(/^(.*?)[,:-]\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+([A-Za-z]+))?$/i);
    if (quantityMatch) {
      remainder = quantityMatch[1].trim();
      qty = parseRecipeQuantity(quantityMatch[2]);
    } else {
      quantityMatch = cleaned.match(
        /^(.*?)(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*([A-Za-z]+)\.?$/i
      );
      if (quantityMatch && RECIPE_PASTE_UNITS.has(String(quantityMatch[3] || "").toLowerCase())) {
        remainder = quantityMatch[1].trim();
        qty = parseRecipeQuantity(quantityMatch[2]);
      } else {
        quantityMatch = cleaned.match(
          /^(one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|a|an)\s+(.*)$/i
        );
        if (quantityMatch) {
          qty = parseRecipeQuantity(quantityMatch[1]);
          remainder = quantityMatch[2].trim().replace(/^of\s+/i, "");
        }
      }
    }
    }
  }

  return {
    id: `draft-${fallbackSort}`,
    sort: fallbackSort,
    ingredient: toTitleCaseWords(remainder || cleaned),
    code: "",
    qty: Number.isFinite(qty) ? qty : 0,
    cost: 0,
    sourceType: "",
    sourceRecipeId: "",
    sourceUnitCost: 0,
    sourceYieldType: "",
  };
}

function parsePastedRecipeText(input) {
  const lines = String(input || "")
    .split("\n")
    .map(normalizePastedRecipeLine)
    .filter(Boolean);

  if (!lines.length) {
    return { name: "", category: "", ingredients: [], methodSteps: [], portionCount: 1 };
  }

  const servingLine = lines.find((line) => {
    const normalized = normalizeMatchKey(line);
    return (
      /^serves\s+/.test(normalized) ||
      /^servings?\s+/.test(normalized) ||
      /^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+servings?$/.test(normalized)
    );
  });
  const portionCountMatch = servingLine
    ? normalizeMatchKey(servingLine).match(
        /(?:serves|servings?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+servings?$/
      )
    : null;
  const portionCount = portionCountMatch
    ? parseRecipeQuantity(portionCountMatch[1] || portionCountMatch[2] || "")
    : 1;

  const firstHeadingIndex = lines.findIndex(
    (line) => isRecipePasteHeading(line, "ingredients") || isRecipePasteHeading(line, "method")
  );
  const titleCandidate = firstHeadingIndex === 0 || isRecipeMetadataLine(lines[0]) ? "" : lines[0];
  const name = toTitleCaseWords(titleCandidate.replace(/:$/, ""));

  const contentLines = (titleCandidate ? lines.slice(1) : [...lines]).filter((line) => !isRecipeMetadataLine(line));
  let mode = "unknown";
  const ingredientLines = [];
  const methodLines = [];

  contentLines.forEach((line) => {
    if (isRecipePasteHeading(line, "ingredients")) {
      mode = "ingredients";
      return;
    }
    if (isRecipePasteHeading(line, "method")) {
      mode = "method";
      return;
    }
    if (mode === "ingredients") {
      ingredientLines.push(line);
      return;
    }
    if (mode === "method") {
      methodLines.push(line);
      return;
    }
    if (isLikelyMethodLine(line)) {
      mode = "method";
      methodLines.push(line);
      return;
    }
    if (mode !== "method") {
      ingredientLines.push(line);
      return;
    }
    if (looksLikeIngredientLine(line)) {
      ingredientLines.push(line);
      return;
    }
    methodLines.push(line);
  });

  if (!ingredientLines.length && !methodLines.length) {
    contentLines.forEach((line) => {
      if (isLikelyMethodLine(line)) {
        methodLines.push(line);
      } else {
        ingredientLines.push(line);
      }
    });
  }

  const ingredients = ingredientLines
    .map((line, index) => parseRecipeIngredientLine(line, index + 1))
    .filter(Boolean);

  const methodSteps = methodLines
    .map((line) => line.replace(/^step\s*\d+[:.)\s-]*/i, "").replace(/^\d+[\).\s-]+/, "").trim())
    .filter(Boolean);

  return {
    name,
    category: "",
    ingredients,
    methodSteps,
    portionCount: Number.isFinite(portionCount) && portionCount > 0 ? portionCount : 1,
  };
}

function parseStructuredRecipeFields({ name = "", portions = "", ingredientsText = "", methodText = "" }) {
  const ingredientLines = String(ingredientsText || "")
    .split("\n")
    .map(normalizePastedRecipeLine)
    .filter(Boolean);
  const methodSteps = String(methodText || "")
    .split("\n")
    .map(normalizePastedRecipeLine)
    .map((line) => line.replace(/^step\s*\d+[:.)\s-]*/i, "").replace(/^\d+[\).\s-]+/, "").trim())
    .filter(Boolean);

  return {
    name: toTitleCaseWords(String(name || "").trim()),
    category: "",
    portionCount: Math.max(1, numberValue(portions) || 1),
    ingredients: ingredientLines.map((line, index) => parseRecipeIngredientLine(line, index + 1)).filter(Boolean),
    methodSteps,
  };
}

const tabs = [
  { id: "queue", label: "Queue", icon: "chart" },
  { id: "recipes", label: "Recipes", icon: "chef" },
  { id: "builder", label: "Builder", icon: "calculator" },
  { id: "dish-inventory", label: "Dish inventory", icon: "clipboard" },
  { id: "venue-menus", label: "Menus", icon: "clipboard" },
  { id: "menus", label: "Set menus", icon: "clipboard" },
  { id: "ingredients", label: "Ingredients", icon: "spark" },
  { id: "imports", label: "Imports", icon: "upload" },
  { id: "users", label: "Users", icon: "spark" },
];

const LIVE_FOOD_APP_URL = "https://peligoni-recipe-costing.vercel.app/";
const LIVE_DRINKS_APP_URL = "https://drinks-recipe-app.vercel.app/";
const LOCAL_FOOD_APP_URL = "http://localhost:5174/";
const LOCAL_DRINKS_APP_URL = "http://localhost:5173/";

const getAppSwitcherLinks = () => {
  if (typeof window === "undefined") {
    return {
      food: LIVE_FOOD_APP_URL,
      drinks: LIVE_DRINKS_APP_URL,
    };
  }

  const hostname = window.location.hostname;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  return {
    food: isLocalHost ? LOCAL_FOOD_APP_URL : LIVE_FOOD_APP_URL,
    drinks: isLocalHost ? LOCAL_DRINKS_APP_URL : LIVE_DRINKS_APP_URL,
  };
};

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
    edit: "M4 20h4l10-10-4-4L4 16v4Zm11-13 4 4m-2-6 2 2",
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

function inferMenuCourseFromRecipe(recipe) {
  const text = `${recipe?.category || ""} ${recipe?.name || ""}`.toLowerCase();
  if (text.includes("dessert")) return "Dessert";
  if (text.includes("side")) return "Side";
  if (text.includes("snack")) return "Snack";
  if (text.includes("small")) return "Small plates";
  if (text.includes("large")) return "Large plates";
  if (text.includes("starter")) return "Starter";
  if (text.includes("main")) return "Main";
  return recipe?.category || "Menu";
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
  const recipeCost = getRecipeCostValue(recipe);
  const roundup = recipe.recipeType === "batch" ? numberValue(recipe.roundup) : calculateRoundupTarget(recipeCost);
  const currentNetSalePrice = getFoodNetSalePrice(recipe.currentSalePrice);
  const gp = currentNetSalePrice > 0 ? (currentNetSalePrice - recipeCost) / currentNetSalePrice : 0;
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
  const perGuestSellNet = lines.reduce((sum, line) => sum + getFoodNetSalePrice(line.lineSalePrice), 0);
  const targetSellPerGuest = menu.targetGp < 1 ? perGuestCost / (1 - menu.targetGp) : 0;

  return {
    ...menu,
    lines,
    menuRecipes,
    perGuestCost,
    perGuestSell,
    perGuestSellNet,
    targetSellPerGuest,
    totalFoodCost: perGuestCost * numberValue(menu.guestCount),
    totalFoodRevenue: perGuestSell * numberValue(menu.guestCount),
    menuGp: perGuestSellNet > 0 ? (perGuestSellNet - perGuestCost) / perGuestSellNet : 0,
    targetRevenue: targetSellPerGuest * numberValue(menu.guestCount),
  };
}

function getMenuCourseGroups(menu) {
  const grouped = new Map();
  const preferredOrder = ["starter", "main", "side", "dessert", "unassigned"];

  (menu?.lines || []).forEach((line) => {
    const courseLabel = String(line.courseLabel || "Unassigned").trim() || "Unassigned";
    const currentGroup = grouped.get(courseLabel) || [];
    currentGroup.push(line);
    grouped.set(courseLabel, currentGroup);
  });

  return Array.from(grouped.entries())
    .map(([courseLabel, lines]) => ({
      courseLabel,
      lines,
    }))
    .sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(String(left.courseLabel || "").trim().toLowerCase());
      const rightIndex = preferredOrder.indexOf(String(right.courseLabel || "").trim().toLowerCase());
      const normalizedLeftIndex = leftIndex === -1 ? preferredOrder.length - 2 : leftIndex;
      const normalizedRightIndex = rightIndex === -1 ? preferredOrder.length - 2 : rightIndex;

      if (normalizedLeftIndex !== normalizedRightIndex) {
        return normalizedLeftIndex - normalizedRightIndex;
      }

      if (leftIndex === -1 && rightIndex === -1) {
        return String(left.courseLabel || "").localeCompare(String(right.courseLabel || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }

      return 0;
    });
}

function buildMenuPrintSheetHtml(menu) {
  const courseGroups = getMenuCourseGroups(menu);
  const groupedHtml = courseGroups
    .map(
      (group) => `
        <section class="course-block">
          <h2>${escapeHtml(group.courseLabel)}</h2>
          <table>
            <thead>
              <tr>
                <th>Dish</th>
                <th>Category</th>
                <th>Food cost</th>
                <th>Current price</th>
                <th>Suggested price</th>
              </tr>
            </thead>
            <tbody>
              ${group.lines
                .map((line) => {
                  const suggestedPrice = line.recipe?.roundup ? money(line.recipe.roundup) : "N/A";
                  return `
                    <tr>
                      <td>${escapeHtml(line.dishName || "Untitled dish")}</td>
                      <td>${escapeHtml(line.category || "Uncategorised")}</td>
                      <td>${escapeHtml(money(line.lineCost))}</td>
                      <td>${escapeHtml(money(line.lineSalePrice))}</td>
                      <td>${escapeHtml(suggestedPrice)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `
    )
    .join("");

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(menu.name)} menu sheet</title>
        <style>
          body { margin: 0; background: #f8fafc; color: #0f172a; font-family: "Helvetica Neue", Arial, sans-serif; }
          .page { max-width: 1080px; margin: 0 auto; padding: 32px; }
          .header { display: flex; justify-content: space-between; gap: 24px; align-items: start; margin-bottom: 24px; }
          .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
          h1 { margin: 6px 0 10px; font-size: 34px; }
          .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
          .stat { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px; }
          .stat span { display: block; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
          .stat strong { font-size: 20px; }
          .course-block { background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 20px; margin-bottom: 20px; }
          .course-block h2 { margin: 0 0 14px; font-size: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 14px; }
          th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
          @media print { body { background: white; } .page { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <div class="eyebrow">Peligoni venue menu</div>
              <h1>${escapeHtml(menu.name)}</h1>
              <div>${escapeHtml(menu.restaurant || "No venue")}</div>
            </div>
            <div>
              <div class="eyebrow">Live state</div>
              <strong>${escapeHtml(menu.isLiveMenu ? "Live menu" : "Draft menu")}</strong>
            </div>
          </div>
          <div class="meta">
            <div class="stat"><span>Guests</span><strong>${escapeHtml(Math.round(numberValue(menu.guestCount)))}</strong></div>
            <div class="stat"><span>Per guest cost</span><strong>${escapeHtml(money(menu.perGuestCost))}</strong></div>
            <div class="stat"><span>Per guest sell</span><strong>${escapeHtml(money(menu.perGuestSell))}</strong></div>
            <div class="stat"><span>Menu GP</span><strong>${escapeHtml(percent(menu.menuGp))}</strong></div>
          </div>
          ${groupedHtml || '<div class="course-block"><p>No menu lines added yet.</p></div>'}
        </div>
      </body>
    </html>`;
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
  const numericFallbackQty = numberValue(fallbackQty);
  if (numericFallbackQty > 0) return numericFallbackQty;

  if (
    recipe?.recipeType !== "batch" &&
    batchRecipe?.batchYieldType === "portion" &&
    numberValue(recipe?.portionCount) > 0 &&
    numberValue(batchRecipe?.batchYield) > 0
  ) {
    return numberValue(batchRecipe.batchYield) / numberValue(recipe.portionCount);
  }

  return numericFallbackQty;
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
    case "purchase-vat":
      return row.displayPurchaseVat || "";
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
        row.displayPurchaseVat,
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
    case "purchase-vat":
      return row.displayPurchaseVat || "";
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
    purchase_vat_rate: FOOD_PURCHASE_VAT_OPTIONS[0],
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

function getIngredientDuplicateKey(ingredient, mode) {
  if (!ingredient) return "";
  if (mode === "code") {
    return normalizeCodeKey(ingredient.ingredient_item_code);
  }
  return normalizeMatchKey(ingredient.ingredient_name);
}

function scoreDuplicateMergeCandidate(ingredient) {
  if (!ingredient) return -1;
  return [
    ingredient.ingredient_name?.trim() ? 3 : 0,
    ingredient.ingredient_item_code?.trim() ? 4 : 0,
    numberValue(ingredient.unit_cost) > 0 ? 3 : 0,
    String(ingredient.pack_size || "").trim() ? 2 : 0,
    String(ingredient.category || "").trim() ? 1 : 0,
    String(ingredient.supplier || "").trim() ? 1 : 0,
    String(ingredient.linked_recipe_id || "").trim() ? 2 : 0,
    normalizeBooleanFlag(ingredient.is_locked) ? 1 : 0,
    numberValue(ingredient.usageCount) * 5,
  ].reduce((sum, value) => sum + value, 0);
}

function pickPrimaryIngredientForMerge(ingredients) {
  return [...ingredients].sort((left, right) => {
    const scoreDifference = scoreDuplicateMergeCandidate(right) - scoreDuplicateMergeCandidate(left);
    if (scoreDifference !== 0) return scoreDifference;
    return String(left.ingredient_name || "").localeCompare(String(right.ingredient_name || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  })[0] || null;
}

function mergeIngredientRecords(primaryIngredient, duplicateIngredients) {
  const allIngredients = [primaryIngredient, ...duplicateIngredients].filter(Boolean);
  const firstFilledValue = (field, fallback = "") =>
    allIngredients.find((ingredient) => String(ingredient?.[field] || "").trim())?.[field] || fallback;
  const firstPositiveNumber = (field) => {
    const match = allIngredients.find((ingredient) => numberValue(ingredient?.[field]) > 0);
    return match ? match[field] : primaryIngredient?.[field] || "";
  };

  return {
    ...primaryIngredient,
    ingredient_name: firstFilledValue("ingredient_name", primaryIngredient?.ingredient_name || ""),
    ingredient_item_code: firstFilledValue("ingredient_item_code", primaryIngredient?.ingredient_item_code || ""),
    unit_cost: firstPositiveNumber("unit_cost"),
    purchase_vat_rate:
      allIngredients.find((ingredient) => ingredient?.purchase_vat_rate != null)?.purchase_vat_rate
      ?? primaryIngredient?.purchase_vat_rate
      ?? FOOD_PURCHASE_VAT_OPTIONS[0],
    pack_size: firstFilledValue("pack_size", primaryIngredient?.pack_size || ""),
    supplier: firstFilledValue("supplier", primaryIngredient?.supplier || ""),
    category: firstFilledValue("category", primaryIngredient?.category || ""),
    linked_recipe_id: firstFilledValue("linked_recipe_id", primaryIngredient?.linked_recipe_id || ""),
    entry_type: firstFilledValue("entry_type", primaryIngredient?.entry_type || "ingredient"),
    is_locked: allIngredients.some((ingredient) => normalizeBooleanFlag(ingredient.is_locked)),
    last_updated: getTodayDateString(),
  };
}

function sanitizeIngredientMasterRows(rows) {
  const sanitizedRows = [];
  let keptBlankDraft = false;

  restoreMissingIngredientPrices(rows).forEach((ingredient) => {
    const normalizedIngredient = {
      ...ingredient,
      purchase_vat_rate: normalizePurchaseVatRate(ingredient?.purchase_vat_rate),
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
  if (!FOOD_PURCHASE_VAT_OPTIONS.includes(normalizePurchaseVatRate(ingredient.purchase_vat_rate))) {
    issues.push("Missing purchase VAT");
  }
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

function loadStoredObject(storageKey) {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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
    purchase_vat_rate: normalizePurchaseVatRate(ingredient.purchase_vat_rate),
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
    purchase_vat_rate: normalizePurchaseVatRate(row.purchase_vat_rate),
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
    available_venues: recipe.recipeType === "batch" ? [] : getAvailableVenueListForRecipe(recipe),
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
    availableVenues: Array.isArray(row.available_venues)
      ? row.available_venues.map((venue) => String(venue || "").trim()).filter(Boolean)
      : [],
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
    course_label: String(line.courseLabel || "").trim(),
    dish_name: String(line.dishName || "").trim(),
    restaurant: String(line.restaurant || "").trim(),
    line_cost: numberValue(line.lineCost),
    line_sale_price: numberValue(line.lineSalePrice),
    category: String(line.category || "").trim(),
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
          courseLabel: String(line.course_label || "").trim(),
          recipeId: line.recipe_id || "",
          dishName: recipe?.name || line.dish_name || "",
          restaurant: recipe?.restaurant || line.restaurant || menuRow.venue || "",
          lineCost: recipe ? recipe.recipeCost : numberValue(line.line_cost),
          lineSalePrice: recipe ? recipe.currentSalePrice : numberValue(line.line_sale_price),
          category: recipe?.category || line.category || "",
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

function mergeSupabaseRecipesIntoCurrent(
  currentRecipes,
  sharedRecipes,
  ingredientMaster,
  pendingRecipesById = new Map()
) {
  const currentById = new Map((currentRecipes || []).map((recipe) => [recipe.id, recipe]));
  const nextRecipesById = new Map();

  (sharedRecipes || []).forEach((recipe) => {
    const existing = currentById.get(recipe.id) || null;
    const pendingSnapshot = pendingRecipesById.get(recipe.id) || null;

    if (existing && pendingSnapshot) {
      if (recipeSyncSnapshot(recipe) === pendingSnapshot) {
        pendingRecipesById.delete(recipe.id);
      } else {
        nextRecipesById.set(recipe.id, existing);
        return;
      }
    }

    nextRecipesById.set(recipe.id, recipe);
  });

  currentById.forEach((recipe, recipeId) => {
    if (!nextRecipesById.has(recipeId)) {
      nextRecipesById.set(recipeId, recipe);
      return;
    }

    if (pendingRecipesById.has(recipeId)) {
      nextRecipesById.set(recipeId, recipe);
    }
  });

  return syncIngredientReferences(linkBatchReferences(Array.from(nextRecipesById.values())), ingredientMaster);
}

function mergeSupabaseMenusIntoCurrent(currentMenus, sharedMenus, recipes) {
  return [...(sharedMenus || [])];
}

function dishIndexDecisionSnapshot(row) {
  return {
    linkedRecipeId: row?.linkedRecipeId || "",
    reviewState: row?.reviewState || "",
    isArchived: Boolean(row?.isArchived),
  };
}

function recipeSyncSnapshot(recipe) {
  return JSON.stringify({
    id: recipe?.id || "",
    restaurant: recipe?.restaurant || "",
    availableVenues: Array.isArray(recipe?.availableVenues) ? recipe.availableVenues : [],
    name: recipe?.name || "",
    category: recipe?.category || "",
    sellingItemCode: recipe?.sellingItemCode || "",
    currentSalePrice: numberValue(recipe?.currentSalePrice),
    roundup: numberValue(recipe?.roundup),
    recipeType: recipe?.recipeType || "dish",
    batchYield: numberValue(recipe?.batchYield),
    batchYieldType: recipe?.batchYieldType || "",
    portionCount: numberValue(recipe?.portionCount),
    methodSteps: Array.isArray(recipe?.methodSteps) ? recipe.methodSteps : [],
    presentationNotes: recipe?.presentationNotes || "",
    recipeComplete: recipe?.recipeComplete || "",
    pricingComplete: recipe?.pricingComplete || "",
    isLive: Boolean(recipe?.isLive),
    isLocked: Boolean(recipe?.isLocked),
    workflowStage: recipe?.workflowStage || "",
    components: (recipe?.components || []).map((component) => ({
      id: component?.id || "",
      sort: numberValue(component?.sort),
      ingredient: component?.ingredient || "",
      code: component?.code || "",
      qty: numberValue(component?.qty),
      cost: numberValue(component?.cost),
      sourceType: component?.sourceType || "",
      sourceRecipeId: component?.sourceRecipeId || "",
      sourceUnitCost: numberValue(component?.sourceUnitCost),
      sourceYieldType: component?.sourceYieldType || "",
    })),
  });
}

function hasDishIndexExplicitDecision(row) {
  return Boolean(row?.reviewState || row?.linkedRecipeId || row?.isArchived);
}

function dishIndexDecisionMatches(left, right) {
  return (
    (left?.linkedRecipeId || "") === (right?.linkedRecipeId || "") &&
    (left?.reviewState || "") === (right?.reviewState || "") &&
    Boolean(left?.isArchived) === Boolean(right?.isArchived)
  );
}

function mergeSupabaseDishIndexRowsIntoCurrent(currentRows, sharedRows, pendingDecisionsById = new Map()) {
  const currentById = new Map((currentRows || []).map((row) => [row.id, row]));
  const nextSharedRows = (sharedRows || []).map((row) => {
    const existing = currentById.get(row.id);
    if (!existing) return row;

    const pendingDecision = pendingDecisionsById.get(row.id) || null;
    if (pendingDecision) {
      if (dishIndexDecisionMatches(row, pendingDecision)) {
        pendingDecisionsById.delete(row.id);
      } else {
        return {
          ...row,
          linkedRecipeId: existing.linkedRecipeId || "",
          reviewState: existing.reviewState || "",
          isArchived: Boolean(existing.isArchived),
        };
      }
    }

    if (hasDishIndexExplicitDecision(row)) {
      return {
        ...row,
        linkedRecipeId: row.linkedRecipeId || "",
        reviewState: row.reviewState || "",
        isArchived: Boolean(row.isArchived),
      };
    }

    if (!hasDishIndexExplicitDecision(existing)) {
      return row;
    }

    return {
      ...row,
      linkedRecipeId: existing.linkedRecipeId || "",
      reviewState: existing.reviewState || "",
      isArchived: Boolean(existing.isArchived),
    };
  });

  const sharedIds = new Set(nextSharedRows.map((row) => row.id));
  const preserved = (currentRows || []).filter((row) => !sharedIds.has(row.id));
  return [...nextSharedRows, ...preserved];
}

function mergeSupabaseBchAuditIntoCurrent(currentRows, sharedRows) {
  return [...(sharedRows || [])];
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
          purchase_vat_rate: FOOD_PURCHASE_VAT_OPTIONS[0],
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
      purchase_vat_rate: normalizePurchaseVatRate(getValue("purchase_vat_rate")),
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
    "chicken breast,101.CHI9,1.36,0.13,1kg,Example Supplier,Poultry,2026-03-23,ingredient,",
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
          <td class="numeric">${escapeHtml(money(row.unitPrice || 0))}</td>
          <td class="numeric">${escapeHtml(row.quantityUsed || "")}</td>
          <td class="numeric">${escapeHtml(money(row.cost || 0))}</td>
        </tr>
      `
    )
    .join("");

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
              <th>Unit price</th>
              <th>Qty used</th>
              <th>Cost</th>
            </tr>
            ${componentRowsHtml}
            <tr>
              <td colspan="4" class="total-label">Total</td>
              <td class="numeric total-number">Mixed units</td>
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

  const csvMoney = (value) => numberValue(value).toFixed(2);

  const rows = [
    ["Recipe code", recipe.id || "", "Descr.", recipe.name || "", "Item code", recipe.sellingItemCode || ""],
    ["Ingr. Code", "Descr Code", "Unit of meas.", "Unit price (EUR)", "Qty used", "Cost (EUR)"],
    ...componentRows.map((row) => [
      row.ingredientCode || "",
      row.description || "",
      row.unitOfMeasure || "",
      csvMoney(row.unitPrice || 0),
      row.quantityUsed || "",
      csvMoney(row.cost || 0),
    ]),
    [
      "Total",
      "",
      "",
      "",
      "Mixed units",
      csvMoney(recipe.recipeCost),
    ],
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function getSourceUnitLabel(sourceYieldType = "", matchedIngredient = null) {
  return sourceYieldType === "kg"
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
}

function getComponentQuantityUnitLabel(sourceYieldType = "", matchedIngredient = null) {
  if (sourceYieldType === "kg" || sourceYieldType === "g") return "g";
  if (sourceYieldType === "l" || sourceYieldType === "ml") return "ml";
  if (sourceYieldType === "portion") return "portion";
  if (sourceYieldType === "tray") return "tray";
  if (sourceYieldType === "jar") return "jar";
  if (sourceYieldType === "bottle") return "bottle";

  if (matchedIngredient) {
    const packUnit = parsePackSizeParts(matchedIngredient.pack_size).unit;
    if (packUnit === "kg" || packUnit === "g") return "g";
    if (packUnit === "l" || packUnit === "ml") return "ml";
  }

  return "pcs";
}

function formatCostSheetQuantity(value, sourceYieldType = "", matchedIngredient = null) {
  const numericValue = numberValue(value);
  if (!numericValue) return "0";

  if (sourceYieldType === "kg") {
    return `${(numericValue / 1000).toFixed(3)} kg`;
  }

  if (sourceYieldType === "l") {
    return `${(numericValue / 1000).toFixed(3)} L`;
  }

  const quantityUnit = getComponentQuantityUnitLabel(sourceYieldType, matchedIngredient);
  const decimals = quantityUnit === "pcs" || quantityUnit === "portion" || quantityUnit === "tray" || quantityUnit === "jar" || quantityUnit === "bottle" ? 0 : 3;
  return `${numericValue.toFixed(decimals)} ${quantityUnit}`;
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

      if (component.sourceType === MANUAL_COMPONENT_SOURCE_TYPE) {
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
          purchase_vat_rate: 0,
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
          purchase_vat_rate: FOOD_PURCHASE_VAT_OPTIONS[0],
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
    return supabaseEnabled ? [] : getBaselineRecipes();
  });
  const [menus, setMenus] = useState(() => {
    return supabaseEnabled ? [] : getBaselineMenus(getBaselineRecipes());
  });
  const [venues, setVenues] = useState(() => {
    if (supabaseEnabled) {
      return [...DEFAULT_VENUES];
    }
    const storedVenues = loadStoredCollection(VENUES_STORAGE_KEY)
      .map((venue) => normalizeVenueName(String(venue || "").trim()))
      .filter(Boolean);
    return Array.from(new Set([...DEFAULT_VENUES, ...storedVenues]));
  });
  const [dishIndexRows, setDishIndexRows] = useState(() => {
    if (supabaseEnabled) return [];
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
    if (supabaseEnabled) return [];
    const stored = loadStoredCollection(BCH_AUDIT_STORAGE_KEY);
    return Array.isArray(stored) ? stored : [];
  });
  const [recipeAvailableVenues, setRecipeAvailableVenues] = useState(() =>
    supabaseEnabled ? {} : loadStoredObject(RECIPE_AVAILABLE_VENUES_STORAGE_KEY)
  );
  const [deletedIngredientSignatures, setDeletedIngredientSignatures] = useState(() => {
    const stored = loadStoredCollection(DELETED_INGREDIENT_SIGNATURES_STORAGE_KEY);
    return Array.isArray(stored) ? stored.filter(Boolean) : [];
  });
  const [activeTab, setActiveTab] = useState("queue");
  const [search, setSearch] = useState("");
  const [restaurant, setRestaurant] = useState("all");
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipes[0]?.id || null);
  const [ingredientMaster, setIngredientMaster] = useState(() => (supabaseEnabled ? [] : loadIngredientMaster()));
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
  const [availabilitySearch, setAvailabilitySearch] = useState("");
  const [availabilityVenueFilter, setAvailabilityVenueFilter] = useState("all");
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
  const [menuDashboardVenue, setMenuDashboardVenue] = useState("all");
  const [menuDashboardService, setMenuDashboardService] = useState("all");
  const [menuLiveVenueFilter, setMenuLiveVenueFilter] = useState("all");
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
  const [recipePasteText, setRecipePasteText] = useState("");
  const [structuredRecipeName, setStructuredRecipeName] = useState("");
  const [structuredRecipePortions, setStructuredRecipePortions] = useState("");
  const [structuredRecipeIngredients, setStructuredRecipeIngredients] = useState("");
  const [structuredRecipeMethod, setStructuredRecipeMethod] = useState("");
  const [recipePasteMessage, setRecipePasteMessage] = useState("");
  const [recipePasteError, setRecipePasteError] = useState("");
  const [newVenueName, setNewVenueName] = useState("");
  const [backendStatus, setBackendStatus] = useState(
    supabaseEnabled ? "Supabase connected (setup mode)" : "Local mode only"
  );
  const [authSession, setAuthSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authProfile, setAuthProfile] = useState(null);
  const [userProfiles, setUserProfiles] = useState([]);
  const [authLoading, setAuthLoading] = useState(supabaseEnabled);
  const [sharedDataRefreshing, setSharedDataRefreshing] = useState(supabaseEnabled);
  const [sharedDashboardSnapshot, setSharedDashboardSnapshot] = useState(null);
  const [activeEditSessions, setActiveEditSessions] = useState([]);
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
  const menuBuilderRef = useRef(null);
  const exportPreviewFrameRef = useRef(null);
  const previousActiveTabRef = useRef("recipes");
  const pendingRecipeSyncRef = useRef(new Map());
  const pendingDishIndexDecisionSyncRef = useRef(new Map());
  const ingredientNavigationTargetRef = useRef(null);
  const previousIngredientsTabOpenRef = useRef(false);
  const currentUserRole =
    authProfile?.role
    || (String(authUser?.email || "").trim().toLowerCase() === "ben@peligoni.com" ? "manager" : "viewer");
  const canEditSharedData = !supabaseEnabled || !authUser || ["manager", "editor"].includes(currentUserRole);

  const refreshAuthProfile = async (user, session = null) => {
    if (!user) {
      setAuthProfile(null);
      return;
    }

    const accessToken = session?.access_token || authSession?.access_token || "";

    const fetchProfileRows = async (filterQuery) => {
      if (!supabaseUrl || !supabaseAnonKey || !accessToken) return null;

      const response = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=id,email,full_name,role&limit=1&${filterQuery}`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `Request failed with ${response.status}`);
      }

      return Array.isArray(payload) ? payload : [];
    };

    try {
      const idRows = await fetchProfileRows(`id=eq.${encodeURIComponent(user.id)}`);
      if (idRows?.[0]) {
        setAuthProfile({ ...idRows[0], profileError: "" });
        return;
      }

      if (user.email) {
        const emailRows = await fetchProfileRows(`email=eq.${encodeURIComponent(user.email)}`);
        if (emailRows?.[0]) {
          setAuthProfile({ ...emailRows[0], profileError: "" });
          return;
        }
      }
    } catch (restError) {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, full_name, role")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data) {
          setAuthProfile({ ...data, profileError: "" });
          return;
        }

        if (user.email) {
          const { data: emailData, error: emailError } = await supabase
            .from("profiles")
            .select("id, email, full_name, role")
            .eq("email", user.email)
            .maybeSingle();

          if (emailError) {
            throw emailError;
          }

          if (emailData) {
            setAuthProfile({ ...emailData, profileError: "" });
            return;
          }
        }
      } catch (fallbackError) {
        setAuthProfile({
          id: user.id,
          email: user.email || "",
          full_name: "",
          role: "viewer",
          profileError: fallbackError?.message || restError?.message || "Could not load the signed-in profile.",
        });
        return;
      }
    }

    setAuthProfile({
      id: user.id,
      email: user.email || "",
      full_name: "",
      role: "viewer",
      profileError: "No matching profile row was found for this signed-in user.",
    });
  };

  useEffect(() => {
    if (supabaseEnabled) return;
    window.localStorage.setItem(INGREDIENT_MASTER_STORAGE_KEY, JSON.stringify(ingredientMaster));
  }, [ingredientMaster]);

  useEffect(() => {
    if (supabaseEnabled) return;
    window.localStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(recipes));
  }, [recipes]);
  useEffect(() => {
    if (supabaseEnabled) return;
    saveStoredCollection(RECIPE_AVAILABLE_VENUES_STORAGE_KEY, recipeAvailableVenues);
  }, [recipeAvailableVenues]);

  useEffect(() => {
    if (supabaseEnabled) return;
    window.localStorage.setItem(MENUS_STORAGE_KEY, JSON.stringify(menus));
  }, [menus]);

  useEffect(() => {
    if (supabaseEnabled) return;
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
        await refreshAuthProfile(data.session?.user || null, data.session || null);
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
      await refreshAuthProfile(session?.user || null, session || null);
      if (!isCancelled) setAuthLoading(false);
    });

    return () => {
      isCancelled = true;
      window.clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabaseEnabled || !supabase || !authUser || !authSession) return undefined;

    let isCancelled = false;

    const runRefresh = async () => {
      if (isCancelled) return;
      await refreshAuthProfile(authUser, authSession);
    };

    runRefresh();

    const handleFocus = () => {
      runRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authSession, authUser]);

  const refreshSharedData = useCallback(async () => {
    if (!supabaseEnabled || !supabase) return;
    if (authLoading || !authUser) return;
    if (["builder", "ingredients", "venue-menus", "menus"].includes(activeTab)) return;

    try {
      setSharedDataRefreshing(true);
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
        let nextRecipes = [];
        setRecipes((current) => {
          nextRecipes = mergeSupabaseRecipesIntoCurrent(
            current,
            sharedRecipes,
            mappedIngredients || ingredientMaster,
            pendingRecipeSyncRef.current
          );
          return nextRecipes;
        });
        setRecipeAvailableVenues(() =>
          Object.fromEntries(
            nextRecipes
              .filter((recipe) => recipe.recipeType !== "batch" && Array.isArray(recipe.availableVenues) && recipe.availableVenues.length)
              .map((recipe) => [recipe.id, recipe.availableVenues])
          )
        );
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
        setDishIndexRows((current) =>
          mergeSupabaseDishIndexRowsIntoCurrent(
            current,
            dishIndexRowsShared.map(mapSupabaseDishIndexRow),
            pendingDishIndexDecisionSyncRef.current
          )
        );
      }

      if (Array.isArray(bchAuditRowsShared) && bchAuditRowsShared.length) {
        setBchAuditDecisions((current) =>
          mergeSupabaseBchAuditIntoCurrent(current, bchAuditRowsShared.map(mapSupabaseBchAuditDecision))
        );
      }

      setBackendStatus("Supabase connected");
    } catch (error) {
      setBackendStatus("Supabase connected, but shared data could not be loaded yet");
    } finally {
      setSharedDataRefreshing(false);
    }
  }, [activeTab, authLoading, authUser, ingredientMaster]);

  useEffect(() => {
    refreshSharedData();
  }, [refreshSharedData]);

  useEffect(() => {
    if (!supabaseEnabled || !supabase || authLoading || !authUser) return undefined;

    let refreshTimeout = null;

    const scheduleRefresh = () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshSharedData();
      }, 200);
    };

    const handleFocus = () => {
      scheduleRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authLoading, authUser, refreshSharedData]);

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
    if (supabaseEnabled) return;
    window.localStorage.setItem(DISH_INDEX_STORAGE_KEY, JSON.stringify(dishIndexRows));
  }, [dishIndexRows]);

  useEffect(() => {
    if (supabaseEnabled) return;
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
    const accessToken = authSession?.access_token;
    if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
      setUserAdminError("Could not verify the signed-in session for updating roles. Please sign out and back in.");
      return;
    }

    setUserAdminError("");
    setUserAdminMessage("");

    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        role,
        updated_at: new Date().toISOString(),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setUserAdminError(
        `Could not update user role: ${payload?.message || payload?.error || `Request failed with ${response.status}`}`
      );
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
    if (supabaseEnabled) return;
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
  const liveMenuRecipeIds = useMemo(() => getRestaurantLiveRecipeIds(menus), [menus]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((recipe) => {
      const matchesRestaurant = restaurant === "all" || getRecipeVenueKey(recipe) === restaurant;
      const appearsLive = recipe.isLive || liveMenuRecipeIds.has(recipe.id);
      const matchesReview =
        reviewFilter === "all" ||
        (reviewFilter === "needs-review" && recipe.validation.reviewStatus === "needs-review") ||
        (reviewFilter === "warning" && recipe.validation.reviewStatus === "warning") ||
        (reviewFilter === "ready" && recipe.validation.reviewStatus === "ready") ||
        (reviewFilter === "live" && appearsLive);
      const matchesSearch =
        q.length === 0 ||
        recipe.name.toLowerCase().includes(q) ||
        recipe.category.toLowerCase().includes(q) ||
        recipe.sellingItemCode.toLowerCase().includes(q) ||
        recipe.components.some((component) => component.ingredient.toLowerCase().includes(q));
      return matchesRestaurant && matchesSearch && matchesReview;
    });
  }, [liveMenuRecipeIds, recipes, restaurant, reviewFilter, search]);
  const liveRecipeVenueSummary = useMemo(() => {
    const grouped = new Map();

    recipes
      .filter((recipe) => recipe.recipeType !== "batch" && (recipe.isLive || liveMenuRecipeIds.has(recipe.id)))
      .forEach((recipe) => {
        const venueLabel = getRecipeVenueKey(recipe) || "Blank";
        grouped.set(venueLabel, (grouped.get(venueLabel) || 0) + 1);
      });

    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true, sensitivity: "base" }))
      .map(([venue, count]) => ({ venue, count }));
  }, [liveMenuRecipeIds, recipes]);
  const availabilityVenueSummary = useMemo(() => {
    const grouped = new Map();

    recipes
      .filter((recipe) => recipe.recipeType !== "batch")
      .forEach((recipe) => {
        const availableVenues = getAvailableVenueListForRecipe(recipe, recipeAvailableVenues);
        availableVenues.forEach((venue) => {
          grouped.set(venue, (grouped.get(venue) || 0) + 1);
        });
      });

    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true, sensitivity: "base" }))
      .map(([venue, count]) => ({ venue, count }));
  }, [recipeAvailableVenues, recipes]);

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
  const availabilityRows = useMemo(() => {
    const query = availabilitySearch.trim().toLowerCase();
    const recipeRows = recipes
      .filter((recipe) => recipe.recipeType !== "batch")
      .map((recipe) => ({
        ...recipe,
        rowSource: "recipe",
        availableVenues: getAvailableVenueListForRecipe(recipe, recipeAvailableVenues),
      }));
    const inventoryRows = dishIndexRowsWithMatches
      .filter((row) => !row.isArchived && !row.match.recipe)
      .map((row) => ({
        id: `inventory-${row.id}`,
        inventoryId: row.id,
        rowSource: "inventory",
        name: row.dishName,
        category: row.course || "",
        sellingItemCode: "",
        restaurant: row.venue || "",
        availableVenues: row.venue ? [row.venue] : [],
        inventoryRow: row,
      }));

    return [...recipeRows, ...inventoryRows]
      .filter((row) => {
        const matchesVenue =
          availabilityVenueFilter === "all" || row.availableVenues.includes(availabilityVenueFilter);
        if (!matchesVenue) return false;
        if (!query) return true;
        return (
          String(row.name || "").toLowerCase().includes(query) ||
          String(row.category || "").toLowerCase().includes(query) ||
          String(row.sellingItemCode || "").toLowerCase().includes(query) ||
          row.availableVenues.some((venue) => String(venue || "").toLowerCase().includes(query))
        );
      })
      .sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [availabilitySearch, availabilityVenueFilter, dishIndexRowsWithMatches, recipeAvailableVenues, recipes]);
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
  const [dishInventorySearch, setDishInventorySearch] = useState("");
  const [dishInventoryStatusFilter, setDishInventoryStatusFilter] = useState("all");
  const dishInventoryRows = useMemo(() => {
    const query = normalizeMatchKey(dishInventorySearch);
    return dishIndexRowsWithMatches.filter((row) => {
      if (row.isArchived) return false;
      const ready = Boolean(row.match.recipe);
      const matchesStatus =
        dishInventoryStatusFilter === "all" ||
        (dishInventoryStatusFilter === "ready" && ready) ||
        (dishInventoryStatusFilter === "missing" && !ready);
      const matchesSearch =
        !query ||
        normalizeMatchKey([row.venue, row.course, row.dishName, row.match.recipe?.name || ""].join(" ")).includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [dishIndexRowsWithMatches, dishInventorySearch, dishInventoryStatusFilter]);
  const dishInventorySummary = useMemo(
    () => ({
      total: dishIndexRowsWithMatches.filter((row) => !row.isArchived).length,
      ready: dishIndexRowsWithMatches.filter((row) => !row.isArchived && row.match.recipe).length,
      missing: dishIndexRowsWithMatches.filter((row) => !row.isArchived && !row.match.recipe).length,
    }),
    [dishIndexRowsWithMatches]
  );
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
    return recipes
      .filter((recipe) => recipe.recipeType !== "batch")
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
  const activeVenueMenus = useMemo(
    () => menuCards.filter((menu) => menu.isLiveMenu),
    [menuCards]
  );
  const activeVenueMenuSummary = useMemo(() => {
    const grouped = new Map();

    activeVenueMenus.forEach((menu) => {
      const venueLabel = menu.restaurant || "Unassigned";
      const current = grouped.get(venueLabel) || { menuCount: 0, dishCount: 0 };
      grouped.set(venueLabel, {
        menuCount: current.menuCount + 1,
        dishCount: current.dishCount + (menu.lines?.length || 0),
      });
    });

    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true, sensitivity: "base" }))
      .map(([venue, counts]) => ({ venue, ...counts }));
  }, [activeVenueMenus]);
  const activeVenueMenuDishCount = useMemo(
    () => activeVenueMenus.reduce((sum, menu) => sum + (menu.lines?.length || 0), 0),
    [activeVenueMenus]
  );
  const filteredActiveVenueMenus = useMemo(() => {
    if (menuLiveVenueFilter === "all") return activeVenueMenus;
    return activeVenueMenus.filter((menu) => (menu.restaurant || "Unassigned") === menuLiveVenueFilter);
  }, [activeVenueMenus, menuLiveVenueFilter]);
  const menuDashboardSummary = useMemo(() => {
    const inventoryByVenue = new Map();

    recipes
      .filter((recipe) => recipe.recipeType !== "batch")
      .forEach((recipe) => {
        const availableVenues = getAvailableVenueListForRecipe(recipe, recipeAvailableVenues);
        availableVenues.forEach((venue) => {
          const baseVenue = getBaseVenueName(venue) || venue || "Unassigned";
          inventoryByVenue.set(baseVenue, (inventoryByVenue.get(baseVenue) || 0) + 1);
        });
      });

    const menuCountsByVenue = new Map();
    menuCards.forEach((menu) => {
      const baseVenue = getBaseVenueName(menu.restaurant) || menu.restaurant || "Unassigned";
      const current = menuCountsByVenue.get(baseVenue) || { menuCount: 0, liveCount: 0, dishCount: 0 };
      menuCountsByVenue.set(baseVenue, {
        menuCount: current.menuCount + 1,
        liveCount: current.liveCount + (menu.isLiveMenu ? 1 : 0),
        dishCount: current.dishCount + (menu.lines?.length || 0),
      });
    });

    const allVenues = Array.from(
      new Set([...DEFAULT_VENUES, ...venues, ...inventoryByVenue.keys(), ...menuCountsByVenue.keys()])
    )
      .map((venue) => normalizeVenueName(venue))
      .filter(Boolean);
    return allVenues
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
      .map((venue) => {
        const menuCounts = menuCountsByVenue.get(venue) || { menuCount: 0, liveCount: 0, dishCount: 0 };
        return {
          venue,
          inventoryCount: inventoryByVenue.get(venue) || 0,
          ...menuCounts,
        };
      });
  }, [menuCards, recipeAvailableVenues, recipes, venues]);
  const dashboardVenueMenus = useMemo(() => {
    if (menuDashboardVenue === "all") return menuCards;
    return menuCards.filter((menu) => getBaseVenueName(menu.restaurant) === menuDashboardVenue);
  }, [menuCards, menuDashboardVenue]);
  const dashboardServiceSummary = useMemo(() => {
    if (menuDashboardVenue === "all") return [];
    const serviceCounts = new Map();
    dashboardVenueMenus.forEach((menu) => {
      const service = getMenuServicePeriod(menu.restaurant) || "unspecified";
      const current = serviceCounts.get(service) || { menuCount: 0, liveCount: 0, dishCount: 0 };
      serviceCounts.set(service, {
        menuCount: current.menuCount + 1,
        liveCount: current.liveCount + (menu.isLiveMenu ? 1 : 0),
        dishCount: current.dishCount + (menu.lines?.length || 0),
      });
    });
    const knownServices = VENUE_SERVICE_PERIODS[menuDashboardVenue] || DEFAULT_SERVICE_PERIODS;
    const allServices = Array.from(new Set([...knownServices, ...serviceCounts.keys()]));
    return allServices.map((service) => {
      const counts = serviceCounts.get(service) || { menuCount: 0, liveCount: 0, dishCount: 0 };
      return {
        service,
        ...counts,
      };
    });
  }, [dashboardVenueMenus, menuDashboardVenue]);
  const filteredDashboardVenueMenus = useMemo(() => {
    if (menuDashboardService === "all") return dashboardVenueMenus;
    return dashboardVenueMenus.filter(
      (menu) => (getMenuServicePeriod(menu.restaurant) || "unspecified") === menuDashboardService
    );
  }, [dashboardVenueMenus, menuDashboardService]);
  const dashboardMenu = useMemo(() => {
    if (!filteredDashboardVenueMenus.length) return null;
    return filteredDashboardVenueMenus.find((menu) => menu.isLiveMenu) || filteredDashboardVenueMenus[0];
  }, [filteredDashboardVenueMenus]);
  const currentEditTarget = useMemo(() => {
    if (!supabaseEnabled || !supabase || !authUser || !canEditSharedData) return null;
    if (activeTab === "builder" && builderMode === "edit" && selectedRecipe) {
      return {
        entityType: "recipe",
        entityId: selectedRecipe.id,
      };
    }
    if (activeTab === "venue-menus" && dashboardMenu) {
      return {
        entityType: "menu",
        entityId: dashboardMenu.id,
      };
    }
    if (activeTab === "menus" && selectedMenu) {
      return {
        entityType: "menu",
        entityId: selectedMenu.id,
      };
    }
    return null;
  }, [activeTab, authUser, builderMode, canEditSharedData, dashboardMenu, selectedMenu, selectedRecipe]);
  const currentEditWarning = useMemo(() => {
    if (!currentEditTarget || !authUser) return "";
    const otherEditors = activeEditSessions.filter((session) => session.user_id !== authUser.id);
    if (!otherEditors.length) return "";
    const names = otherEditors.map((session) => session.user_name || session.user_email || "Another user");
    const entityLabel = currentEditTarget.entityType === "recipe" ? "recipe" : "menu";
    if (names.length === 1) {
      return `${names[0]} is also editing this ${entityLabel}. Save carefully to avoid overwriting their changes.`;
    }
    return `${names.join(", ")} are also editing this ${entityLabel}. Save carefully to avoid overwriting their changes.`;
  }, [activeEditSessions, authUser, currentEditTarget]);
  useEffect(() => {
    if (!supabaseEnabled || !supabase || !authUser || !currentEditTarget) {
      setActiveEditSessions([]);
      return undefined;
    }

    let isCancelled = false;
    const sessionId = `${currentEditTarget.entityType}:${currentEditTarget.entityId}:${authUser.id}`;

    const loadSessions = async () => {
      const cutoffIso = new Date(Date.now() - EDIT_SESSION_STALE_MS).toISOString();
      const { data, error } = await supabase
        .from("edit_sessions")
        .select("*")
        .eq("entity_type", currentEditTarget.entityType)
        .eq("entity_id", currentEditTarget.entityId)
        .gt("last_seen_at", cutoffIso)
        .order("last_seen_at", { ascending: false });

      if (isCancelled || error) return;
      setActiveEditSessions(Array.isArray(data) ? data : []);
    };

    const heartbeat = async () => {
      const { error } = await supabase.from("edit_sessions").upsert(
        {
          id: sessionId,
          entity_type: currentEditTarget.entityType,
          entity_id: currentEditTarget.entityId,
          user_id: authUser.id,
          user_email: authUser.email || "",
          user_name: authProfile?.full_name || authUser.email || "",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (isCancelled || error) return;
      await loadSessions();
    };

    heartbeat();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        heartbeat();
      }
    }, 15000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      supabase.from("edit_sessions").delete().eq("id", sessionId);
    };
  }, [authProfile?.full_name, authUser, currentEditTarget]);
  const dashboardInventoryRecipes = useMemo(() => {
    if (menuDashboardVenue === "all") return [];
    return recipes.filter(
      (recipe) =>
        recipe.recipeType !== "batch" &&
        getAvailableVenueListForRecipe(recipe, recipeAvailableVenues).some(
          (venue) => getBaseVenueName(venue) === menuDashboardVenue
        )
    );
  }, [menuDashboardVenue, recipeAvailableVenues, recipes]);
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
      live: recipes.filter(
        (recipe) => recipe.recipeType !== "batch" && (recipe.isLive || liveMenuRecipeIds.has(recipe.id))
      ).length,
    }),
    [liveMenuRecipeIds, recipes]
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
  const duplicateIngredientGroups = useMemo(() => {
    const grouped = new Map();
    const signatures = new Set();
    const ingredientRows = ingredientCatalog.filter((ingredient) => !isEmptyIngredientDraftRow(ingredient));

    ingredientRows.forEach((ingredient) => {
      ["code", "name"].forEach((mode) => {
        const value = getIngredientDuplicateKey(ingredient, mode);
        if (!value) return;
        const groupKey = `${mode}:${ingredient.entry_type || "ingredient"}:${value}`;
        const currentGroup = grouped.get(groupKey) || [];
        currentGroup.push(ingredient);
        grouped.set(groupKey, currentGroup);
      });
    });

    return Array.from(grouped.entries())
      .filter(([, ingredients]) => ingredients.length > 1)
      .map(([groupKey, ingredients]) => {
        const [mode] = groupKey.split(":");
        const uniqueIngredients = Array.from(
          new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])).values()
        );
        if (uniqueIngredients.length <= 1) return null;
        const sortedIngredients = [...uniqueIngredients].sort((left, right) =>
          String(left.ingredient_name || "").localeCompare(String(right.ingredient_name || ""), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
        const signature = sortedIngredients
          .map((ingredient) => ingredient.id)
          .sort((left, right) => left.localeCompare(right))
          .join("|");
        if (signatures.has(signature)) return null;
        signatures.add(signature);
        const primaryIngredient = pickPrimaryIngredientForMerge(sortedIngredients);
        return {
          id: groupKey,
          mode,
          value: mode === "code" ? primaryIngredient?.ingredient_item_code || "" : primaryIngredient?.ingredient_name || "",
          ingredients: sortedIngredients,
          primaryIngredient,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.ingredients.length !== left.ingredients.length) {
          return right.ingredients.length - left.ingredients.length;
        }
        return left.value.localeCompare(right.value, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [ingredientCatalog]);
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
  useEffect(() => {
    if (supabaseEnabled && sharedDataRefreshing) return;
    setSharedDashboardSnapshot({
      queueTotal,
      summaryRecipeCount: summary.recipeCount,
      reviewNeedsReview: reviewCounts.needsReview,
      reviewLive: reviewCounts.live,
      queueRecipes: queueRecipes.length,
      queueIngredients: queueIngredients.length,
      queueDishIndex: queueDishIndex.length,
      bchAuditTotal: bchAuditSummary.total,
    });
  }, [
    bchAuditSummary.total,
    queueDishIndex.length,
    queueIngredients.length,
    queueRecipes.length,
    queueTotal,
    reviewCounts.live,
    reviewCounts.needsReview,
    sharedDataRefreshing,
    summary.recipeCount,
  ]);
  const displayQueueTotal = sharedDashboardSnapshot?.queueTotal ?? queueTotal;
  const displayRecipeCount = sharedDashboardSnapshot?.summaryRecipeCount ?? summary.recipeCount;
  const displayNeedsReviewCount = sharedDashboardSnapshot?.reviewNeedsReview ?? reviewCounts.needsReview;
  const displayLiveCount = sharedDashboardSnapshot?.reviewLive ?? reviewCounts.live;
  const displayQueueRecipesCount = sharedDashboardSnapshot?.queueRecipes ?? queueRecipes.length;
  const displayQueueIngredientsCount = sharedDashboardSnapshot?.queueIngredients ?? queueIngredients.length;
  const displayQueueDishIndexCount = sharedDashboardSnapshot?.queueDishIndex ?? queueDishIndex.length;
  const displayBchAuditTotal = sharedDashboardSnapshot?.bchAuditTotal ?? bchAuditSummary.total;
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
          displayPurchaseVat: percentFromRate(ingredient.purchase_vat_rate),
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
          displayPurchaseVat: "0%",
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

  const ingredientExistsByNameOrCode = (ingredientName = "", ingredientCode = "") => {
    const normalizedName = normalizeMatchKey(ingredientName);
    const normalizedCode = normalizeCodeKey(ingredientCode);

    return ingredientMaster.some((ingredient) => {
      if (normalizedCode && normalizeCodeKey(ingredient.ingredient_item_code) === normalizedCode) return true;
      if (normalizedName && normalizeMatchKey(ingredient.ingredient_name) === normalizedName) return true;
      return false;
    });
  };

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
    if (field === "restaurant") {
      setRecipeAvailableVenues((current) => {
        const existing = Array.isArray(current?.[recipeId]) ? current[recipeId] : [];
        if (!existing.length) return current;

        const previousPrimary = String(recipes.find((recipe) => recipe.id === recipeId)?.restaurant || "").trim();
        const nextPrimary = String(value || "").trim();
        const nextVenues = Array.from(
          new Set([nextPrimary, ...existing.filter((venue) => venue !== previousPrimary && venue !== nextPrimary)].filter(Boolean))
        ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

        if (nextVenues.length <= 1 && nextVenues[0] === nextPrimary) {
          const nextMap = { ...current };
          delete nextMap[recipeId];
          return nextMap;
        }

        return {
          ...current,
          [recipeId]: nextVenues,
        };
      });
    }

    setRecipes((current) =>
      current.map((recipe) => {
        if (recipe.id !== recipeId) return recipe;
        if (recipe.isLocked && field !== "isLocked") return recipe;
        const normalizedValue = field === "name" ? toTitleCaseWords(value) : value;
        const nextRecipe = { ...recipe, [field]: normalizedValue };
        if (field === "restaurant" && recipe.recipeType !== "batch") {
          const existingAvailableVenues = getAvailableVenueListForRecipe(recipe, recipeAvailableVenues);
          nextRecipe.availableVenues = Array.from(
            new Set([String(normalizedValue || "").trim(), ...existingAvailableVenues.filter((venue) => venue !== recipe.restaurant && venue !== normalizedValue)].filter(Boolean))
          ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
        }
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
      name: toTitleCaseWords(row.dishName || ""),
      category: row.course || "",
    };

    setNewRecipeDraft(nextDraft);
    setBuilderMode("create");
    setActiveTab("builder");
  };

  const createDraftRecipeFromDishInventory = async (row, { menuRestaurant = "", courseLabel = "" } = {}) => {
    if (requireEditAccess()) return null;
    const targetMenu = menuRestaurant ? menus.find((menu) => menu.restaurant === menuRestaurant) || null : null;
    if (targetMenu?.isLiveMenu) {
      setImportError(`Switch ${targetMenu.name} back to draft before adding dishes.`);
      setImportMessage("");
      return null;
    }
    const next = String(recipes.length + 1).padStart(3, "0");
    const nextVenue = normalizeVenueName(row.venue, row.sourceTab) || "Tasi";
    const draftRecipe = enrichRecipeMetrics({
      id: `NEW-${next}`,
      sourceRow: row.id || "",
      restaurant: nextVenue,
      name: toTitleCaseWords(row.dishName || "New Dish"),
      category: row.course || "Uncategorised",
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
    });

    setRecipes((current) => [draftRecipe, ...current]);

    if (menuRestaurant) {
      if (supabaseEnabled && supabase) {
        setSelectedRecipeId(draftRecipe.id);
        setBuilderMode("edit");
        setActiveTab("builder");
        setImportError("");
        setImportMessage(`Created draft recipe ${draftRecipe.name}. Save it before adding it to ${menuRestaurant}.`);
        return draftRecipe;
      }

      const update = buildServiceMenuPublishUpdate(menus, draftRecipe, menuRestaurant, courseLabel || row.course || "");
      if (update) {
        setMenus(update.nextMenus);
        setSelectedMenuId(update.nextMenu.id);
        setMenuDashboardVenue(getBaseVenueName(update.nextMenu.restaurant));
        setMenuDashboardService(getMenuServicePeriod(update.nextMenu.restaurant) || "all");
        setImportError("");
        setImportMessage(`Created draft recipe and added ${draftRecipe.name} to ${update.nextMenu.name}.`);
      }
    }

    return draftRecipe;
  };

  const openMenusForDishInventoryRow = (row) => {
    const venue = normalizeVenueName(row.venue, row.sourceTab) || "Tasi";
    setAvailabilityVenueFilter(venue);
    focusMenuDashboardVenue(venue);
    setActiveTab("venue-menus");
  };

  const updateDishIndexRow = async (rowId, updates) => {
    const currentRow = dishIndexRows.find((row) => row.id === rowId) || null;
    if (!currentRow) return;

    const nextRow = { ...currentRow, ...updates };
    setDishIndexRows((current) => current.map((row) => (row.id === rowId ? nextRow : row)));

    pendingDishIndexDecisionSyncRef.current.set(rowId, dishIndexDecisionSnapshot(nextRow));

    const result = await runOptionalSharedSync({
      enabled: true,
      sync: () => syncDishIndexRowToSupabase(nextRow),
      onError: (error) =>
        setImportError(`Saved dish index change locally, but could not sync to Supabase: ${error.message}`),
    });

    if (!supabaseEnabled || result?.skipped) {
      pendingDishIndexDecisionSyncRef.current.delete(rowId);
    }
  };

  const confirmDishIndexMatch = async (rowId, recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId) || null;
    if (!recipe || recipe.recipeType === "batch") {
      setImportError("Dish inventory can only link to dish recipes, not batch recipes.");
      return;
    }

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

  const unlinkDishIndexRecipe = async (rowId) => {
    await updateDishIndexRow(rowId, {
      linkedRecipeId: "",
      reviewState: "no-recipe",
      isArchived: false,
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
    await runOptionalSharedSync({
      enabled: Boolean(nextDecision),
      sync: () => syncBchAuditDecisionToSupabase(nextDecision),
      onError: (error) =>
        setImportError(`Saved BCH audit change locally, but could not sync to Supabase: ${error.message}`),
    });
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
                  nextComponent.sourceType = MANUAL_COMPONENT_SOURCE_TYPE;
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
      batchYield: numberValue(parsePackSizeParts(ingredient.pack_size).value) > 0
        ? numberValue(parsePackSizeParts(ingredient.pack_size).value)
        : 1,
      batchYieldType: ["g", "kg", "ml", "l"].includes(parsePackSizeParts(ingredient.pack_size).unit)
        ? parsePackSizeParts(ingredient.pack_size).unit
        : "portion",
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

  const importPastedRecipeText = () => {
    const parsedRecipe = parsePastedRecipeText(recipePasteText);
    if (!parsedRecipe.name && !parsedRecipe.ingredients.length && !parsedRecipe.methodSteps.length) {
      setRecipePasteError("Paste a recipe first, then I can turn it into a draft.");
      setRecipePasteMessage("");
      return;
    }

    const defaultRestaurant =
      restaurant === "all" || restaurant === "Batch" ? recipes[0]?.restaurant || "Tasi" : restaurant;
    const baseDraft = createRecipeDraft(defaultRestaurant);
    const nextComponents = parsedRecipe.ingredients.length
      ? parsedRecipe.ingredients
      : baseDraft.components;

    setActiveDraftLookupId(null);
    setNewRecipeDraft({
      ...baseDraft,
      recipeType: "dish",
      restaurant: defaultRestaurant,
      name: parsedRecipe.name || "Imported Draft Recipe",
      category: parsedRecipe.category || "",
      portionCount: parsedRecipe.portionCount || 1,
      methodSteps: parsedRecipe.methodSteps,
      components: nextComponents,
    });
    setBuilderMode("create");
    setRecipePasteError("");
    setRecipePasteMessage(
      `Loaded ${parsedRecipe.name || "draft recipe"} with ${parsedRecipe.portionCount || 1} portion${
        parsedRecipe.portionCount === 1 ? "" : "s"
      }, ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}, and ${
        parsedRecipe.methodSteps.length
      } method step${parsedRecipe.methodSteps.length === 1 ? "" : "s"}.`
    );
  };

  const importStructuredRecipeText = () => {
    const parsedRecipe = parseStructuredRecipeFields({
      name: structuredRecipeName,
      portions: structuredRecipePortions,
      ingredientsText: structuredRecipeIngredients,
      methodText: structuredRecipeMethod,
    });

    if (!parsedRecipe.name && !parsedRecipe.ingredients.length && !parsedRecipe.methodSteps.length) {
      setRecipePasteError("Add some recipe details first, then I can build the draft.");
      setRecipePasteMessage("");
      return;
    }

    const defaultRestaurant =
      restaurant === "all" || restaurant === "Batch" ? recipes[0]?.restaurant || "Tasi" : restaurant;
    const baseDraft = createRecipeDraft(defaultRestaurant);
    const nextComponents = parsedRecipe.ingredients.length ? parsedRecipe.ingredients : baseDraft.components;

    setActiveDraftLookupId(null);
    setNewRecipeDraft({
      ...baseDraft,
      recipeType: "dish",
      restaurant: defaultRestaurant,
      name: parsedRecipe.name || "Imported Draft Recipe",
      category: parsedRecipe.category || "",
      portionCount: parsedRecipe.portionCount || 1,
      methodSteps: parsedRecipe.methodSteps,
      components: nextComponents,
    });
    setBuilderMode("create");
    setRecipePasteError("");
    setRecipePasteMessage(
      `Loaded ${parsedRecipe.name || "draft recipe"} with ${parsedRecipe.portionCount || 1} portion${
        parsedRecipe.portionCount === 1 ? "" : "s"
      }, ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}, and ${
        parsedRecipe.methodSteps.length
      } method step${parsedRecipe.methodSteps.length === 1 ? "" : "s"}.`
    );
  };

  const updateNewRecipeField = (field, value) => {
    setNewRecipeDraft((current) => {
      const normalizedValue = field === "name" ? toTitleCaseWords(value) : value;
      const nextDraft = { ...current, [field]: normalizedValue };
      if (field === "restaurant") {
        nextDraft.secondaryVenues = (current.secondaryVenues || []).filter((venue) => venue !== value);
      }
      if (field === "recipeType") {
        if (value === "batch") {
          nextDraft.restaurant = "";
          nextDraft.secondaryVenues = [];
          nextDraft.currentSalePrice = 0;
          nextDraft.batchYieldType = current.batchYieldType === "portion" ? "g" : current.batchYieldType;
        } else {
          nextDraft.restaurant =
            current.restaurant ||
            (restaurant === "all" || restaurant === "Batch" ? recipes[0]?.restaurant || "Tasi" : restaurant);
          nextDraft.secondaryVenues = current.secondaryVenues || [];
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

  const toggleNewRecipeSecondaryVenue = (venue, checked) => {
    setNewRecipeDraft((current) => {
      const existing = Array.isArray(current.secondaryVenues) ? current.secondaryVenues : [];
      const nextSecondaryVenues = checked
        ? Array.from(new Set([...existing, venue]))
        : existing.filter((item) => item !== venue);
      return {
        ...current,
        secondaryVenues: nextSecondaryVenues
          .filter((item) => item !== current.restaurant)
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })),
      };
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
                nextComponent.sourceType = MANUAL_COMPONENT_SOURCE_TYPE;
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

  const saveNewRecipeDraft = async () => {
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
      availableVenues:
        newRecipeDraft.recipeType === "batch"
          ? []
          : Array.from(
              new Set([String(newRecipeDraft.restaurant || "").trim(), ...(newRecipeDraft.secondaryVenues || [])].filter(Boolean))
            ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })),
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
    if (savedRecipe.recipeType !== "batch") {
      const primaryVenue = String(savedRecipe.restaurant || "").trim();
      const nextAvailableVenues = Array.from(
        new Set([primaryVenue, ...(newRecipeDraft.secondaryVenues || [])].filter(Boolean))
      );
      setRecipeAvailableVenues((current) => {
        if (nextAvailableVenues.length <= 1 && nextAvailableVenues[0] === primaryVenue) {
          const nextMap = { ...current };
          delete nextMap[savedRecipe.id];
          return nextMap;
        }
        return {
          ...current,
          [savedRecipe.id]: nextAvailableVenues.sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
          ),
        };
      });
    }
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
          purchase_vat_rate: 0,
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
    setImportError("");
    setImportMessage(
      savedRecipe.recipeType === "batch"
        ? `Created batch recipe ${savedRecipe.name} and generated batch ingredient ${savedRecipe.sellingItemCode}.`
        : `Created recipe ${savedRecipe.name} with an automatic roundup target of ${money(newRecipeDraftRoundupTarget)}.`
    );
    resetNewRecipeDraft("dish");

    await runOptionalSharedSync({
      sync: () => syncRecipeToSupabase(savedRecipe),
      onError: (error) =>
        setImportError(
          `Created locally, but could not sync ${savedRecipe.recipeType === "batch" ? "batch" : "recipe"} to Supabase: ${error.message}`
        ),
      onSuccess: () =>
        setImportMessage(
          savedRecipe.recipeType === "batch"
            ? `Created batch recipe ${savedRecipe.name} locally and in Supabase.`
            : `Created recipe ${savedRecipe.name} locally and in Supabase.`
        ),
    });
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

  const createIngredientFromRecipeBuilder = ({
    ingredientName = "",
    ingredientCode = "",
    supplier = "",
    category = "",
    recipeId = "",
    recipeName = "",
    draftComponentId = "",
    componentId = "",
  }) => {
    if (requireEditAccess()) return;
    const trimmedIngredientName = String(ingredientName || "").trim();
    const trimmedIngredientCode = String(ingredientCode || "").trim();

    setIngredientReturnTarget({
      recipeId,
      recipeName,
      componentId,
      draftComponentId,
    });
    addIngredientRow({
      openQuickEdit: true,
      ingredientName: trimmedIngredientName,
      ingredientCode: trimmedIngredientCode,
      supplier,
      category,
      switchToIngredients: false,
    });
    setActiveLookup(null);
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
      const normalizedValue =
        field === "ingredient_name"
          ? toTitleCaseWords(value)
          : field === "purchase_vat_rate"
            ? normalizePurchaseVatRate(value)
            : value;
      const nextIngredients = current.map((ingredient) =>
        ingredient.id === ingredientId
          ? ingredient.is_locked && field !== "is_locked"
            ? ingredient
            : {
                ...ingredient,
                [field]: field === "is_locked" ? Boolean(value) : normalizedValue,
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

  const normalizeExistingNames = () => {
    if (requireEditAccess()) return;

    const normalizedIngredientMaster = ingredientMaster.map((ingredient) => ({
      ...ingredient,
      ingredient_name: toTitleCaseWords(ingredient.ingredient_name),
      last_updated: ingredient.ingredient_name !== toTitleCaseWords(ingredient.ingredient_name)
        ? getTodayDateString()
        : ingredient.last_updated,
    }));

    const normalizedRecipes = recipes.map((recipe) =>
      enrichRecipeMetrics({
        ...recipe,
        name: toTitleCaseWords(recipe.name),
        components: (recipe.components || []).map((component) => ({
          ...component,
          ingredient: toTitleCaseWords(component.ingredient),
        })),
      })
    );

    const syncedRecipes = syncIngredientReferences(normalizedRecipes, normalizedIngredientMaster);

    setIngredientMaster(normalizedIngredientMaster);
    setRecipes(syncedRecipes);
    setIngredientUploadError("");
    setIngredientUploadMessage("Normalized existing ingredient, batch, and recipe names to title case.");
  };

  const createMissingIngredientRowsFromRecipes = () => {
    if (requireEditAccess()) return;
    const deletedSet = new Set(deletedIngredientSignatures);
    const seededIngredientMaster = seedImportedIngredientRows(ingredientMaster, recipes, deletedSet);
    const nextIngredientMaster = seededIngredientMaster.map((ingredient) => ({
      ...ingredient,
      is_locked: true,
      last_updated: getTodayDateString(),
    }));
    const addedRows = seededIngredientMaster.length - ingredientMaster.length;
    const addedBatchRows = seededIngredientMaster
      .slice(ingredientMaster.length)
      .filter((ingredient) => (ingredient.entry_type || "ingredient") === "batch").length;
    const addedIngredientRows = addedRows - addedBatchRows;

    setIngredientMaster(nextIngredientMaster);
    setRecipes((current) => syncIngredientReferences(current, nextIngredientMaster));
    setIngredientUploadError("");
    setIngredientUploadMessage(
      addedRows > 0
        ? `Added ${addedRows} missing ingredient row${addedRows === 1 ? "" : "s"} from recipes and batches (${addedIngredientRows} ingredient, ${addedBatchRows} batch) and locked the ingredient master.`
        : "No missing ingredient rows were found in the current recipes and batches. Locked the ingredient master."
    );
  };

  const refreshRecipeComponentSources = () => {
    if (requireEditAccess()) return;
    const refreshedRecipes = syncIngredientReferences(recipes, ingredientMaster);
    setRecipes(refreshedRecipes);
    setIngredientUploadError("");
    setIngredientUploadMessage(
      "Refreshed recipe component source costs and units from the current ingredient master and batch recipes."
    );
  };

  const toggleRecipeAvailableVenue = (recipeId, venue, checked) => {
    setRecipeAvailableVenues((current) => {
      const existing = Array.isArray(current?.[recipeId]) ? current[recipeId] : [];
      const nextVenues = checked
        ? Array.from(new Set([...existing, venue]))
        : existing.filter((item) => item !== venue);

      if (!nextVenues.length) {
        const nextMap = { ...current };
        delete nextMap[recipeId];
        return nextMap;
      }

      return {
        ...current,
        [recipeId]: nextVenues.sort((left, right) =>
          left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
        ),
      };
    });
  };

  const setRecipeSecondaryVenues = (recipeId, primaryVenue, secondaryVenues) => {
    const nextAvailableVenues = Array.from(
      new Set([String(primaryVenue || "").trim(), ...(secondaryVenues || [])].filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

    setRecipes((current) =>
      current.map((recipe) =>
        recipe.id !== recipeId
          ? recipe
          : {
              ...recipe,
              availableVenues: nextAvailableVenues,
            }
      )
    );

    setRecipeAvailableVenues((current) => {
      if (nextAvailableVenues.length <= 1 && nextAvailableVenues[0] === String(primaryVenue || "").trim()) {
        const nextMap = { ...current };
        delete nextMap[recipeId];
        return nextMap;
      }
      return {
        ...current,
        [recipeId]: nextAvailableVenues,
      };
    });
  };

  const saveIngredientMasterChanges = async () => {
    if (requireEditAccess()) return;
    if (!supabaseEnabled) {
      saveStoredCollection(INGREDIENT_MASTER_STORAGE_KEY, ingredientMaster);
    }
    setRecipes((current) => syncIngredientReferences(current, ingredientMaster));
    setIngredientUploadError("");
    setIngredientUploadMessage(`Saved ${ingredientMaster.length} ingredient rows and refreshed linked recipe costs.`);

    await runOptionalSharedSync({
      sync: () =>
        supabase
          .from("ingredients")
          .upsert(ingredientMaster.map(mapIngredientRowToSupabase), { onConflict: "id" }),
      onError: (error) =>
        setIngredientUploadError(`Saved locally, but could not sync ingredients to Supabase: ${error.message}`),
      onSuccess: () =>
        setIngredientUploadMessage(
          `Saved ${ingredientMaster.length} ingredient rows locally and to Supabase.`
        ),
    });
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

  const validateRecipeIdsForSupabase = async (recipeIds) => {
    if (!supabaseEnabled || !supabase) {
      return { error: null, missingRecipeIds: [] };
    }

    const uniqueRecipeIds = Array.from(new Set((recipeIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
    if (!uniqueRecipeIds.length) {
      return { error: null, missingRecipeIds: [] };
    }

    const { data, error } = await supabase.from("recipes").select("id").in("id", uniqueRecipeIds);
    if (error) {
      return { error, missingRecipeIds: [] };
    }

    const sharedRecipeIds = new Set((Array.isArray(data) ? data : []).map((row) => String(row.id || "").trim()));
    const missingRecipeIds = uniqueRecipeIds.filter((id) => !sharedRecipeIds.has(id));

    return { error: null, missingRecipeIds };
  };

  const validateMenuRecipeIdsForSupabase = async (menu) => {
    if (!supabaseEnabled || !supabase || !menu) {
      return { error: null, missingRecipeIds: [] };
    }

    return validateRecipeIdsForSupabase((menu.lines || []).map((line) => line.recipeId));
  };

  const runOptionalSharedSync = async ({ enabled = true, sync, onSuccess, onError } = {}) => {
    if (!enabled || !supabaseEnabled || !supabase || typeof sync !== "function") {
      return { error: null, skipped: true };
    }

    const result = await sync();
    const error = result?.error || null;

    if (error) {
      if (typeof onError === "function") {
        onError(error);
      }
      return { error, skipped: false };
    }

    setBackendStatus("Supabase connected");
    if (typeof onSuccess === "function") {
      onSuccess(result);
    }

    return { error: null, skipped: false };
  };

  const saveCurrentRecipeChanges = async () => {
    if (requireEditAccess()) return;
    if (!selectedRecipe) return;

    let syncedRecipes = [];
    let syncedSelectedRecipe = selectedRecipe;
    setRecipes((current) => {
      syncedRecipes = syncIngredientReferences(current, ingredientMaster);
      syncedSelectedRecipe =
        syncedRecipes.find((recipe) => recipe.id === selectedRecipe.id) || selectedRecipe;
      return syncedRecipes;
    });
    if (!supabaseEnabled) {
      saveStoredCollection(RECIPES_STORAGE_KEY, syncedRecipes);
    }

    pendingRecipeSyncRef.current.set(
      syncedSelectedRecipe.id,
      recipeSyncSnapshot(syncedSelectedRecipe)
    );

    if (syncedSelectedRecipe.recipeType === "batch") {
      setTimeout(() => {
        syncBatchIngredientsWithRecipes(syncedRecipes);
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

    await runOptionalSharedSync({
      sync: () => syncRecipeToSupabase(syncedSelectedRecipe),
      onError: (error) =>
        setImportError(
          `Saved locally, but could not sync ${syncedSelectedRecipe.recipeType === "batch" ? "batch" : "recipe"} to Supabase: ${error.message}`
        ),
      onSuccess: () =>
        setImportMessage(
          `Saved ${syncedSelectedRecipe.recipeType === "batch" ? "batch" : "recipe"} ${
            syncedSelectedRecipe.name || syncedSelectedRecipe.id
          } locally and to Supabase.`
        ),
    });
  };

  const syncMenuToSupabase = async (menu) => {
    if (!supabaseEnabled || !supabase || !menu) return { error: null };

    const { error: validationError, missingRecipeIds } = await validateMenuRecipeIdsForSupabase(menu);
    if (validationError) return { error: validationError };
    if (missingRecipeIds.length) {
      return {
        error: new Error(
          `Menu contains recipe ids not yet saved to Supabase: ${missingRecipeIds.slice(0, 5).join(", ")}${
            missingRecipeIds.length > 5 ? "..." : ""
          }`
        ),
      };
    }

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

  const saveMenuChanges = async (menuToSave = null) => {
    if (requireEditAccess()) return;
    const targetMenu = menuToSave || selectedMenu;
    if (!targetMenu) return;
    if (!supabaseEnabled) {
      saveStoredCollection(MENUS_STORAGE_KEY, menus);
    }
    setImportError("");
    setImportMessage(
      `Saved ${targetMenu.name || "menu"}${targetMenu.restaurant ? ` for ${targetMenu.restaurant}` : ""}.`
    );

    await runOptionalSharedSync({
      enabled: Boolean(targetMenu),
      sync: () => syncMenuToSupabase(targetMenu),
      onError: (error) =>
        setImportError(
          `Saved locally, but could not sync menu ${targetMenu.name || targetMenu.id} to Supabase: ${error.message}`
        ),
      onSuccess: () =>
        setImportMessage(
          `Saved ${targetMenu.name || "menu"}${targetMenu.restaurant ? ` for ${targetMenu.restaurant}` : ""} locally and to Supabase.`
        ),
    });
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

  const addIngredientRow = ({
    openQuickEdit = false,
    ingredientName = "",
    ingredientCode = "",
    supplier = "",
    category = "",
    switchToIngredients = true,
  } = {}) => {
    if (requireEditAccess()) return;
    const trimmedIngredientName = toTitleCaseWords(ingredientName);
    const trimmedIngredientCode = String(ingredientCode || "").trim();
    const trimmedSupplier = String(supplier || "").trim();
    const trimmedCategory = String(category || "").trim();
    if (switchToIngredients) {
      setActiveTab("ingredients");
      setIngredientTypeFilter("all");
      setIngredientBatchLinkFilter("all");
      setIngredientColumnFilter("all-columns");
      setSearch("");
    }
    setIngredientUploadError("");
    setIngredientEditLookup("");
    setIngredientEditLookupQuery(trimmedIngredientName);

    const existingBlankRow = ingredientMaster.find((ingredient) => isEmptyIngredientDraftRow(ingredient));
    if (existingBlankRow) {
      setIngredientUploadMessage(
        trimmedIngredientName
          ? `Started a new ingredient draft for ${trimmedIngredientName}.`
          : "Added a new blank ingredient row at the top of the catalogue."
      );
      setActiveIngredientDraftId(existingBlankRow.id);
      setIngredientMaster((current) =>
        current.map((ingredient) =>
          ingredient.id === existingBlankRow.id
            ? {
                ...ingredient,
                ingredient_name: trimmedIngredientName || ingredient.ingredient_name,
                ingredient_item_code: trimmedIngredientCode || ingredient.ingredient_item_code,
                supplier: trimmedSupplier || ingredient.supplier,
                category: trimmedCategory || ingredient.category,
              }
            : ingredient
        )
      );
      if (openQuickEdit) {
        setQuickPanel({
          type: "ingredient",
          ingredientId: existingBlankRow.id,
        });
      }
      return;
    }

    const next = String(ingredientMaster.length + 1).padStart(3, "0");
    const nextId = `local-ingredient-${next}`;
    const draftedIngredient = {
      ...createBlankIngredientRow(nextId),
      ingredient_name: trimmedIngredientName,
      ingredient_item_code: trimmedIngredientCode,
      supplier: trimmedSupplier,
      category: trimmedCategory,
    };
    setIngredientUploadMessage(
      trimmedIngredientName
        ? `Started a new ingredient draft for ${trimmedIngredientName}.`
        : "Added a new blank ingredient row at the top of the catalogue."
    );
    setActiveIngredientDraftId(nextId);
    setIngredientMaster((current) => [draftedIngredient, ...current]);
    if (openQuickEdit) {
      setQuickPanel({
        type: "ingredient",
        ingredientId: nextId,
      });
    }
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

  const mergeDuplicateIngredientGroup = (group) => {
    if (requireEditAccess()) return;
    if (!group?.ingredients?.length || !group.primaryIngredient) return;

    const primaryId = group.primaryIngredient.id;
    const duplicateIds = group.ingredients
      .map((ingredient) => ingredient.id)
      .filter((ingredientId) => ingredientId !== primaryId);
    if (!duplicateIds.length) return;

    setIngredientMaster((current) => {
      const currentGroupIngredients = group.ingredients
        .map((ingredient) => current.find((row) => row.id === ingredient.id))
        .filter(Boolean);
      const livePrimaryIngredient =
        current.find((ingredient) => ingredient.id === primaryId) ||
        pickPrimaryIngredientForMerge(currentGroupIngredients);
      if (!livePrimaryIngredient) return current;

      const liveDuplicateIngredients = currentGroupIngredients.filter(
        (ingredient) => ingredient.id !== livePrimaryIngredient.id
      );
      const mergedIngredient = mergeIngredientRecords(livePrimaryIngredient, liveDuplicateIngredients);
      const nextIngredients = current
        .filter((ingredient) => !liveDuplicateIngredients.some((duplicate) => duplicate.id === ingredient.id))
        .map((ingredient) => (ingredient.id === livePrimaryIngredient.id ? mergedIngredient : ingredient));

      if (activeIngredientDraftId && duplicateIds.includes(activeIngredientDraftId)) {
        setActiveIngredientDraftId(livePrimaryIngredient.id);
      }
      if (ingredientEditLookup && duplicateIds.includes(ingredientEditLookup)) {
        setIngredientEditLookup(livePrimaryIngredient.id);
      }
      if (quickPanel?.type === "ingredient" && duplicateIds.includes(quickPanel.ingredientId)) {
        setQuickPanel({
          type: "ingredient",
          ingredientId: livePrimaryIngredient.id,
        });
      }

      setRecipes((recipesCurrent) => syncIngredientReferences(recipesCurrent, nextIngredients));
      return nextIngredients;
    });

    setIngredientUploadError("");
    setIngredientUploadMessage(
      `Merged ${group.ingredients.length} duplicate rows into ${group.primaryIngredient.ingredient_name || "one ingredient"}.`
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
    setActiveIngredientDraftId(null);
    setIngredientEditLookup("");
    setIngredientEditLookupQuery("");
  }, [activeTab, ingredientEditOptions, ingredientMaster]);

  useEffect(() => {
    if (activeTab !== "ingredients") {
      previousIngredientsTabOpenRef.current = false;
    }
  }, [activeTab]);
  const newRecipeDraftCost = useMemo(() => getRecipeCostValue(newRecipeDraft), [
    newRecipeDraft.components,
    newRecipeDraft.portionCount,
    newRecipeDraft.recipeType,
  ]);
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

  const renderIngredientCatalogRow = (row) => (
    <tr
      key={row.id}
      className={`${row.validation.reviewStatus === "needs-review" ? "review-row" : ""}`.trim()}
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
          <button
            type="button"
            className="secondary-button table-action-button"
            onClick={() => {
              focusIngredientCatalogueRow(row.source.id);
              openIngredientQuickPanel(row.source);
            }}
          >
            Edit
          </button>
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
              <option value="ml">ml</option>
              <option value="l">l</option>
            </select>
          </div>
        ) : (
          <div className="table-static">{row.displayPackSize || "N/A"}</div>
        )}
      </td>
      <td>
        {row.sourceKind === "ingredient-master" ? (
          <select
            className="table-input"
            value={String(normalizePurchaseVatRate(row.source.purchase_vat_rate))}
            disabled={row.source.is_locked || row.source.entry_type === "batch"}
            onFocus={() => focusIngredientCatalogueRow(row.source.id)}
            onChange={(event) =>
              updateIngredientField(row.source.id, "purchase_vat_rate", Number(event.target.value))
            }
          >
            {FOOD_PURCHASE_VAT_OPTIONS.map((rate) => (
              <option key={`purchase-vat-${rate}`} value={String(rate)}>
                {percentFromRate(rate)}
              </option>
            ))}
          </select>
        ) : (
          <div className="table-static">{row.displayPurchaseVat || "0%"}</div>
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
          {row.batchLink?.status === "not-applicable" ? <Badge tone="default">Not needed</Badge> : null}
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
          {row.rowType === "batch" ? (
            <Badge tone="default">{row.displayCode || "Batch ID missing"}</Badge>
          ) : null}
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

  const renderRecipeListRow = (recipe) => (
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
  );

  const clearRecipeLookup = () => {
    setRecipeLookupQuery("");
  };

  const syncBatchIngredientsWithRecipes = (recipesSource = recipes) => {
    const batchRecipes = (recipesSource || []).filter((recipe) => recipe.recipeType === "batch");
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
          purchase_vat_rate: 0,
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
            purchase_vat_rate: 0,
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

  const buildRecipeCostSheetRows = (recipe) => {
    const flattenComponent = (component, prefix = "", visitedBatchIds = new Set()) => {
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

      if (matchedBatch && !visitedBatchIds.has(matchedBatch.id) && numberValue(matchedBatch.batchYield) > 0) {
        const nextVisited = new Set(visitedBatchIds);
        nextVisited.add(matchedBatch.id);
        const scaleFactor = numberValue(component.qty) / numberValue(matchedBatch.batchYield);

        return matchedBatch.components.flatMap((batchComponent) => {
          const scaledComponent = {
            ...batchComponent,
            qty: numberValue(batchComponent.qty) * scaleFactor,
            cost: numberValue(batchComponent.cost) * scaleFactor,
          };
          return flattenComponent(
            scaledComponent,
            `${prefix}${matchedBatch.name || component.ingredient || "Batch"} > `,
            nextVisited
          );
        });
      }

      const sourceYieldType =
        component.sourceYieldType ||
        (matchedBatch
          ? matchedBatch.batchYieldType || ""
          : matchedIngredient
            ? getIngredientPricingSource(matchedIngredient).sourceYieldType
            : "");
      const sourceUnitCost =
        numberValue(component.sourceUnitCost) ||
        (matchedBatch
          ? getBatchUnitCost(matchedBatch)
          : matchedIngredient
            ? getIngredientPricingSource(matchedIngredient).sourceUnitCost
            : 0);

      return [
        {
          ingredientCode: component.code || "",
          description: `${prefix}${component.ingredient || ""}`.trim(),
          unitOfMeasure: getSourceUnitLabel(sourceYieldType, matchedIngredient),
          unitPrice: sourceUnitCost,
          quantityUsed: formatCostSheetQuantity(component.qty, sourceYieldType, matchedIngredient),
          cost: numberValue(component.cost),
        },
      ];
    };

    return recipe.components.flatMap((component) => flattenComponent(component));
  };

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

  const openMenuSheetPreview = (menu, options = {}) => {
    if (!menu) return;
    setExportPreview({
      title: `${menu.name} menu sheet`,
      html: buildMenuPrintSheetHtml(menu),
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

  const saveQuickPanelIngredientAndReturn = () => {
    if (!quickPanelIngredient) return;
    saveIngredientMasterChanges();

    if (ingredientReturnTarget?.draftComponentId) {
      applyIngredientMatchToDraft(ingredientReturnTarget.draftComponentId, quickPanelIngredient);
    } else if (ingredientReturnTarget?.recipeId && ingredientReturnTarget?.componentId) {
      applyIngredientMatch(ingredientReturnTarget.recipeId, ingredientReturnTarget.componentId, quickPanelIngredient);
      setSelectedRecipeId(ingredientReturnTarget.recipeId);
      setBuilderMode("edit");
      setActiveTab("builder");
    }

    setIngredientReturnTarget(null);
    setQuickPanel(null);
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
    const selectedService =
      menuDashboardService !== "all"
        ? menuDashboardService
        : (VENUE_SERVICE_PERIODS[menuDashboardVenue]?.[0] || "lunch");
    const dashboardVenueOption =
      menuDashboardVenue === "all"
        ? ""
        : venueOptions.find((item) => item === `${menuDashboardVenue} ${selectedService}`) ||
          venueOptions.find((item) => getBaseVenueName(item) === menuDashboardVenue) ||
          `${menuDashboardVenue} ${selectedService}`;
    const nextVenue =
      dashboardVenueOption ||
      (restaurant === "all"
        ? venueOptions[0] || `${recipes[0]?.restaurant || "Tasi"} lunch`
        : `${restaurant} lunch`);
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

  const focusMenuDashboardVenue = (venue) => {
    setMenuDashboardVenue(venue);
    const defaultService = venue === "all" ? "all" : (VENUE_SERVICE_PERIODS[venue]?.[0] || DEFAULT_SERVICE_PERIODS[0]);
    setMenuDashboardService(defaultService);
    const scopedMenus =
      venue === "all" ? menuCards : menuCards.filter((menu) => getBaseVenueName(menu.restaurant) === venue);
    const targetMenu =
      (venue === "all"
        ? scopedMenus.find((menu) => menu.isLiveMenu) || scopedMenus[0]
        : scopedMenus.find(
            (menu) =>
              (getMenuServicePeriod(menu.restaurant) || DEFAULT_SERVICE_PERIODS[0]) === defaultService &&
              menu.isLiveMenu
          ) ||
          scopedMenus.find(
            (menu) => (getMenuServicePeriod(menu.restaurant) || DEFAULT_SERVICE_PERIODS[0]) === defaultService
          ) ||
          scopedMenus.find((menu) => menu.isLiveMenu) ||
          scopedMenus[0]) ||
      null;
    if (targetMenu) {
      setSelectedMenuId(targetMenu.id);
    }
  };

  const focusMenuBuilder = (menuId) => {
    setActiveTab("menus");
    if (menuId) {
      setSelectedMenuId(menuId);
    }
    window.requestAnimationFrame(() => {
      menuBuilderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  const addMenuLine = (courseLabel = "") => {
    if (!selectedMenu) return;
    const menuBaseVenue = getBaseVenueName(selectedMenu.restaurant);
    const venueRecipes = recipes.filter(
      (recipe) =>
        recipe.recipeType !== "batch" &&
        (selectedMenu.restaurant === "" ||
          getAvailableVenueListForRecipe(recipe, recipeAvailableVenues).some(
            (venue) => getBaseVenueName(venue) === menuBaseVenue
          ))
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
                  courseLabel: courseLabel || `Course ${nextSort}`,
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
        if (menu.isLiveMenu) return menu;
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

  const buildMenuPublishUpdate = (currentMenus, recipe, venue, courseLabel = "") => {
    if (!recipe || !venue) return null;

    const baseVenue = getBaseVenueName(venue);
    const existingVenueMenus = currentMenus.filter((menu) => getBaseVenueName(menu.restaurant) === baseVenue);
    const targetMenu =
      existingVenueMenus.find((menu) => menu.isLiveMenu) ||
      existingVenueMenus[0] ||
      {
        id: `LOCAL-MENU-${String(currentMenus.length + 1).padStart(3, "0")}`,
        name: `${baseVenue} Menu`,
        restaurant: venueOptions.find((item) => getBaseVenueName(item) === baseVenue) || `${baseVenue} lunch`,
        guestCount: 40,
        targetGp: 0.75,
        isLiveMenu: false,
        lines: [],
      };

    const alreadyIncluded = targetMenu.lines.some((line) => line.recipeId === recipe.id);
    if (alreadyIncluded) {
      return {
        nextMenus: currentMenus,
        nextMenu: targetMenu,
        baseVenue,
        alreadyIncluded: true,
      };
    }

    const nextLine = {
      id: `${targetMenu.id}-${targetMenu.lines.length + 1}`,
      courseLabel: courseLabel || inferMenuCourseFromRecipe(recipe),
      recipeId: recipe.id,
      dishName: recipe.name || "",
      restaurant: recipe.restaurant || targetMenu.restaurant,
      lineCost: recipe.recipeCost || 0,
      lineSalePrice: recipe.currentSalePrice || 0,
      category: recipe.category || "",
      recipe,
    };

    const nextMenu = {
      ...targetMenu,
      lines: [...targetMenu.lines, nextLine],
    };

    const nextMenus = existingVenueMenus.length
      ? currentMenus.map((menu) => (menu.id === nextMenu.id ? nextMenu : menu))
      : [...currentMenus, nextMenu];

    return {
      nextMenus,
      nextMenu,
      baseVenue,
      alreadyIncluded: false,
    };
  };

  const buildServiceMenuPublishUpdate = (currentMenus, recipe, menuRestaurant, courseLabel = "") => {
    if (!recipe || !menuRestaurant) return null;

    const targetMenu = resolveServiceMenuTarget(currentMenus, menuRestaurant) || {
      id: `LOCAL-MENU-${String(currentMenus.length + 1).padStart(3, "0")}`,
      name: `${menuRestaurant} Menu`,
      restaurant: menuRestaurant,
      guestCount: 40,
      targetGp: 0.75,
      isLiveMenu: false,
      lines: [],
    };

    const alreadyIncluded = targetMenu.lines.some((line) => line.recipeId === recipe.id);
    if (alreadyIncluded) {
      return {
        nextMenus: currentMenus,
        nextMenu: targetMenu,
        alreadyIncluded: true,
      };
    }

    const nextLine = {
      id: `${targetMenu.id}-${targetMenu.lines.length + 1}`,
      courseLabel: courseLabel || inferMenuCourseFromRecipe(recipe),
      recipeId: recipe.id,
      dishName: recipe.name || "",
      restaurant: recipe.restaurant || targetMenu.restaurant,
      lineCost: recipe.recipeCost || 0,
      lineSalePrice: recipe.currentSalePrice || 0,
      category: recipe.category || "",
      recipe,
    };

    const nextMenu = {
      ...targetMenu,
      lines: [...targetMenu.lines, nextLine],
    };

    const nextMenus = currentMenus.some((menu) => menu.id === nextMenu.id)
      ? currentMenus.map((menu) => (menu.id === nextMenu.id ? nextMenu : menu))
      : [...currentMenus, nextMenu];

    return {
      nextMenus,
      nextMenu,
      alreadyIncluded: false,
    };
  };

  const publishRecipeToVenueMenus = async (recipe, venuesToPublish, courseLabel = "") => {
    if (!recipe || !venuesToPublish?.length) return;
    if (requireEditAccess()) return;

    let workingMenus = menus;
    const changedMenus = [];
    const skippedVenues = [];
    let lastMenu = null;
    let lastVenue = menuDashboardVenue;

    venuesToPublish.forEach((venue) => {
      const update = buildMenuPublishUpdate(workingMenus, recipe, venue, courseLabel);
      if (!update) return;
      workingMenus = update.nextMenus;
      lastMenu = update.nextMenu;
      lastVenue = update.baseVenue;
      if (update.alreadyIncluded) {
        skippedVenues.push(update.baseVenue);
      } else {
        changedMenus.push(update.nextMenu);
      }
    });

    if (!changedMenus.length && lastMenu) {
      setSelectedMenuId(lastMenu.id);
      setImportError("");
      setImportMessage(
        skippedVenues.length > 1
          ? `${recipe.name} is already on the selected menus.`
          : `${recipe.name} is already on ${lastMenu.name}.`
      );
      return;
    }

    setMenus(workingMenus);
    if (lastMenu) {
      setSelectedMenuId(lastMenu.id);
    }
    setMenuDashboardVenue(lastVenue);
    setImportError("");
    setImportMessage(
      `Added ${recipe.name} to ${changedMenus.length} menu${changedMenus.length === 1 ? "" : "s"}.${
        skippedVenues.length ? ` Skipped ${skippedVenues.length} already-linked venue${skippedVenues.length === 1 ? "" : "s"}.` : ""
      }`
    );

    if (supabaseEnabled && supabase && changedMenus.length) {
      for (const menu of changedMenus) {
        const { error } = await syncMenuToSupabase(menu);
        if (error) {
          setImportError(`Added locally, but could not sync ${menu.name} to Supabase: ${error.message}`);
          return;
        }
      }
      setBackendStatus("Supabase connected");
      setImportMessage(
        `Added ${recipe.name} to ${changedMenus.length} menu${changedMenus.length === 1 ? "" : "s"} locally and to Supabase.${
          skippedVenues.length ? ` Skipped ${skippedVenues.length} already-linked venue${skippedVenues.length === 1 ? "" : "s"}.` : ""
        }`
      );
    }
  };

  const publishRecipeToVenueMenu = async (recipe, venue, courseLabel = "") => {
    await publishRecipeToVenueMenus(recipe, venue ? [venue] : [], courseLabel);
  };

  const publishRecipeToServiceMenu = async (recipe, menuRestaurant, courseLabel = "") => {
    if (!recipe || !menuRestaurant) return;
    if (requireEditAccess()) return;
    if (supabaseEnabled && supabase) {
      const { error, missingRecipeIds } = await validateRecipeIdsForSupabase([recipe.id]);
      if (error) {
        setImportError(`Could not verify recipe before adding it to the menu: ${error.message}`);
        setImportMessage("");
        return;
      }
      if (missingRecipeIds.length) {
        setImportError(`Save ${recipe.name || "this recipe"} to shared data before adding it to ${menuRestaurant}.`);
        setImportMessage("");
        return;
      }
    }

    const targetMenu = resolveServiceMenuTarget(menus, menuRestaurant);
    if (targetMenu?.isLiveMenu) {
      setImportError(`Switch ${targetMenu.name} back to draft before changing its dishes.`);
      setImportMessage("");
      return;
    }

    const update = buildServiceMenuPublishUpdate(menus, recipe, menuRestaurant, courseLabel);
    if (!update) return;

    setMenus(update.nextMenus);
    setSelectedMenuId(update.nextMenu.id);
    setMenuDashboardVenue(getBaseVenueName(update.nextMenu.restaurant));
    setMenuDashboardService(getMenuServicePeriod(update.nextMenu.restaurant) || "all");
    setImportError("");

    if (update.alreadyIncluded) {
      setImportMessage(`${recipe.name} is already on ${update.nextMenu.name}.`);
      return;
    }

    setImportMessage(`Added ${recipe.name} to ${update.nextMenu.name}.`);

    await runOptionalSharedSync({
      sync: () => syncMenuToSupabase(update.nextMenu),
      onError: (error) =>
        setImportError(`Added locally, but could not sync ${update.nextMenu.name} to Supabase: ${error.message}`),
      onSuccess: () =>
        setImportMessage(`Added ${recipe.name} to ${update.nextMenu.name} locally and to Supabase.`),
    });
  };

  const publishRecipesToServiceMenus = async (recipesToPublish, venuesToPublish, servicePeriod = "", courseLabel = "") => {
    if (!recipesToPublish?.length || !venuesToPublish?.length || !servicePeriod) return;
    if (requireEditAccess()) return;

    let workingMenus = menus;
    const changedMenus = new Map();
    let addedCount = 0;
    let skippedCount = 0;

    venuesToPublish.forEach((venue) => {
      const menuRestaurant = `${venue} ${servicePeriod}`;
      recipesToPublish.forEach((recipe) => {
        if (!recipe?.availableVenues?.includes(venue)) {
          skippedCount += 1;
          return;
        }
        const update = buildServiceMenuPublishUpdate(workingMenus, recipe, menuRestaurant, courseLabel);
        if (!update) return;
        workingMenus = update.nextMenus;
        changedMenus.set(update.nextMenu.id, update.nextMenu);
        if (update.alreadyIncluded) {
          skippedCount += 1;
        } else {
          addedCount += 1;
        }
      });
    });

    if (!changedMenus.size) {
      setImportError("");
      setImportMessage("No new menu lines were added from the selected dishes and venues.");
      return;
    }

    const nextMenus = Array.from(changedMenus.values());
    const lastMenu = nextMenus[nextMenus.length - 1];
    setMenus(workingMenus);
    setSelectedMenuId(lastMenu.id);
    setMenuDashboardVenue(getBaseVenueName(lastMenu.restaurant));
    setMenuDashboardService(getMenuServicePeriod(lastMenu.restaurant) || "all");
    setImportError("");
    setImportMessage(
      `Added ${addedCount} menu line${addedCount === 1 ? "" : "s"} across ${nextMenus.length} menu${
        nextMenus.length === 1 ? "" : "s"
      }.${skippedCount ? ` Skipped ${skippedCount} already-on-menu or unavailable combination${skippedCount === 1 ? "" : "s"}.` : ""}`
    );

    await runOptionalSharedSync({
      sync: async () => {
        for (const menu of nextMenus) {
          const { error } = await syncMenuToSupabase(menu);
          if (error) throw error;
        }
      },
      onError: (error) =>
        setImportError(`Added locally, but could not sync one or more menus to Supabase: ${error.message}`),
      onSuccess: () =>
        setImportMessage(
          `Added ${addedCount} menu line${addedCount === 1 ? "" : "s"} across ${nextMenus.length} menu${
            nextMenus.length === 1 ? "" : "s"
          } locally and to Supabase.${skippedCount ? ` Skipped ${skippedCount} already-on-menu or unavailable combination${skippedCount === 1 ? "" : "s"}.` : ""}`
        ),
    });
  };

  const removeRecipeFromVenueMenus = async (recipe, venuesToRemove) => {
    if (!recipe || !venuesToRemove?.length) return;
    if (requireEditAccess()) return;

    let workingMenus = menus;
    const changedMenus = [];
    const skippedVenues = [];
    let lastMenu = null;
    let lastVenue = menuDashboardVenue;

    venuesToRemove.forEach((venue) => {
      const baseVenue = getBaseVenueName(venue);
      const targetMenu = workingMenus.find(
        (menu) => getBaseVenueName(menu.restaurant) === baseVenue && menu.lines.some((line) => line.recipeId === recipe.id)
      );

      if (!targetMenu) {
        skippedVenues.push(baseVenue);
        return;
      }

      const nextMenu = {
        ...targetMenu,
        lines: targetMenu.lines.filter((line) => line.recipeId !== recipe.id),
      };

      workingMenus = workingMenus.map((menu) => (menu.id === nextMenu.id ? nextMenu : menu));
      changedMenus.push(nextMenu);
      lastMenu = nextMenu;
      lastVenue = baseVenue;
    });

    if (!changedMenus.length) {
      setImportError("");
      setImportMessage(
        skippedVenues.length > 1
          ? `${recipe.name} was not on the selected menus.`
          : `${recipe.name} was not on the selected menu.`
      );
      return;
    }

    setMenus(workingMenus);
    if (lastMenu) {
      setSelectedMenuId(lastMenu.id);
    }
    setMenuDashboardVenue(lastVenue);
    setImportError("");
    setImportMessage(
      `Removed ${recipe.name} from ${changedMenus.length} menu${changedMenus.length === 1 ? "" : "s"}.${
        skippedVenues.length ? ` Skipped ${skippedVenues.length} venue${skippedVenues.length === 1 ? "" : "s"} where it was not present.` : ""
      }`
    );

    if (supabaseEnabled && supabase) {
      for (const menu of changedMenus) {
        const { error } = await syncMenuToSupabase(menu);
        if (error) {
          setImportError(`Removed locally, but could not sync ${menu.name} to Supabase: ${error.message}`);
          return;
        }
      }
      setBackendStatus("Supabase connected");
      setImportMessage(
        `Removed ${recipe.name} from ${changedMenus.length} menu${changedMenus.length === 1 ? "" : "s"} locally and to Supabase.${
          skippedVenues.length ? ` Skipped ${skippedVenues.length} venue${skippedVenues.length === 1 ? "" : "s"} where it was not present.` : ""
        }`
      );
    }
  };

  const removeRecipeFromServiceMenu = async (recipe, menuRestaurant) => {
    if (!recipe || !menuRestaurant) return;
    if (requireEditAccess()) return;

    const targetMenu = menus.find(
      (menu) => menu.restaurant === menuRestaurant && menu.lines.some((line) => line.recipeId === recipe.id)
    );

    if (targetMenu?.isLiveMenu) {
      setImportError(`Switch ${targetMenu.name} back to draft before changing its dishes.`);
      setImportMessage("");
      return;
    }

    if (!targetMenu) {
      setImportError("");
      setImportMessage(`${recipe.name} was not on ${menuRestaurant}.`);
      return;
    }

    const nextMenu = {
      ...targetMenu,
      lines: targetMenu.lines.filter((line) => line.recipeId !== recipe.id),
    };
    const nextMenus = menus.map((menu) => (menu.id === nextMenu.id ? nextMenu : menu));

    setMenus(nextMenus);
    setSelectedMenuId(nextMenu.id);
    setMenuDashboardVenue(getBaseVenueName(menuRestaurant));
    setMenuDashboardService(getMenuServicePeriod(menuRestaurant) || "all");
    setImportError("");
    setImportMessage(`Removed ${recipe.name} from ${nextMenu.name}.`);

    await runOptionalSharedSync({
      sync: () => syncMenuToSupabase(nextMenu),
      onError: (error) =>
        setImportError(`Removed locally, but could not sync ${nextMenu.name} to Supabase: ${error.message}`),
      onSuccess: () =>
        setImportMessage(`Removed ${recipe.name} from ${nextMenu.name} locally and to Supabase.`),
    });
  };

  const removeRecipesFromServiceMenus = async (recipesToRemove, venuesToRemove, servicePeriod = "") => {
    if (!recipesToRemove?.length || !venuesToRemove?.length || !servicePeriod) return;
    if (requireEditAccess()) return;

    let workingMenus = menus;
    const changedMenus = new Map();
    let removedCount = 0;
    let skippedCount = 0;

    venuesToRemove.forEach((venue) => {
      const menuRestaurant = `${venue} ${servicePeriod}`;
      recipesToRemove.forEach((recipe) => {
        const targetMenu = workingMenus.find(
          (menu) => menu.restaurant === menuRestaurant && menu.lines.some((line) => line.recipeId === recipe.id)
        );
        if (!targetMenu) {
          skippedCount += 1;
          return;
        }
        const nextMenu = {
          ...targetMenu,
          lines: targetMenu.lines.filter((line) => line.recipeId !== recipe.id),
        };
        workingMenus = workingMenus.map((menu) => (menu.id === nextMenu.id ? nextMenu : menu));
        changedMenus.set(nextMenu.id, nextMenu);
        removedCount += 1;
      });
    });

    if (!changedMenus.size) {
      setImportError("");
      setImportMessage("None of the selected dishes were on the chosen service menus.");
      return;
    }

    const nextMenus = Array.from(changedMenus.values());
    const lastMenu = nextMenus[nextMenus.length - 1];
    setMenus(workingMenus);
    setSelectedMenuId(lastMenu.id);
    setMenuDashboardVenue(getBaseVenueName(lastMenu.restaurant));
    setMenuDashboardService(getMenuServicePeriod(lastMenu.restaurant) || "all");
    setImportError("");
    setImportMessage(
      `Removed ${removedCount} menu line${removedCount === 1 ? "" : "s"} across ${nextMenus.length} menu${
        nextMenus.length === 1 ? "" : "s"
      }.${skippedCount ? ` Skipped ${skippedCount} combination${skippedCount === 1 ? "" : "s"} that were not present.` : ""}`
    );

    await runOptionalSharedSync({
      sync: async () => {
        for (const menu of nextMenus) {
          const { error } = await syncMenuToSupabase(menu);
          if (error) throw error;
        }
      },
      onError: (error) =>
        setImportError(`Removed locally, but could not sync one or more menus to Supabase: ${error.message}`),
      onSuccess: () =>
        setImportMessage(
          `Removed ${removedCount} menu line${removedCount === 1 ? "" : "s"} across ${nextMenus.length} menu${
            nextMenus.length === 1 ? "" : "s"
          } locally and to Supabase.${skippedCount ? ` Skipped ${skippedCount} combination${skippedCount === 1 ? "" : "s"} that were not present.` : ""}`
        ),
    });
  };

  const isRecipeOnVenueMenu = (recipeId, venue) => {
    if (!recipeId || !venue) return false;
    const targetMenu = getMenuServicePeriod(venue)
      ? menus.find((menu) => menu.restaurant === venue)
      : menus.find((menu) => getBaseVenueName(menu.restaurant) === getBaseVenueName(venue) && menu.isLiveMenu) ||
        menus.find((menu) => getBaseVenueName(menu.restaurant) === getBaseVenueName(venue)) ||
        null;
    if (!targetMenu) return false;
    return targetMenu.lines.some((line) => line.recipeId === recipeId);
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

  const appSwitcherLinks = getAppSwitcherLinks();

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
                <a href={appSwitcherLinks.food} className="secondary-button">Food app</a>
                <a href={appSwitcherLinks.drinks} className="secondary-button">Drinks app</a>
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
            value={displayQueueTotal}
            onClick={() => {
              setActiveTab("queue");
            }}
          />
          <StatCard
            label="Recipes"
            value={displayRecipeCount}
            onClick={() => {
              setActiveTab("recipes");
              setReviewFilter("all");
              setRecipeListTypeFilter("all");
            }}
          />
          <StatCard
            label="Needs review"
            value={displayNeedsReviewCount}
            tone={displayNeedsReviewCount ? "negative" : ""}
            onClick={() => {
              setActiveTab("queue");
            }}
          />
          <StatCard
            label="Live dishes"
            value={displayLiveCount}
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
              <StatCard label="Recipes to review" value={displayQueueRecipesCount} onClick={() => setActiveTab("recipes")} />
              <StatCard
                label="Ingredients to review"
                value={displayQueueIngredientsCount}
                onClick={() => openIngredientsWorkspace()}
              />
              <StatCard
                label="Dish matches to resolve"
                value={displayQueueDishIndexCount}
                onClick={() => {
                  setShowArchivedDishIndexRows(false);
                  setActiveTab("dish-index");
                }}
              />
              <StatCard
                label="BCH audit items"
                value={displayBchAuditTotal}
                tone={bchAuditSummary.missing || bchAuditSummary.needsReview ? "warning" : ""}
                onClick={() => setActiveTab("bch-audit")}
              />
              <StatCard label="Live dishes" value={displayLiveCount} onClick={() => {
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
          <RecipesTab
            Card={Card}
            Badge={Badge}
            Icon={Icon}
            recipeListTypeFilter={recipeListTypeFilter}
            setRecipeListTypeFilter={setRecipeListTypeFilter}
            importBundledBatchWorkbook={importBundledBatchWorkbook}
            syncBchRecipeLinks={syncBchRecipeLinks}
            addRecipe={addRecipe}
            liveRecipeVenueSummary={liveRecipeVenueSummary}
            reviewFilter={reviewFilter}
            restaurant={restaurant}
            setReviewFilter={setReviewFilter}
            setRestaurant={setRestaurant}
            setSearch={setSearch}
            reviewCounts={reviewCounts}
            importMessage={importMessage}
            importError={importError}
            renderRecipeSortHeader={renderRecipeSortHeader}
            recipeListRows={recipeListRows}
            renderRecipeListRow={renderRecipeListRow}
          />
        )}

        {activeTab === "builder" && (
          <BuilderTab
            Card={Card}
            builderMode={builderMode}
            setBuilderMode={setBuilderMode}
            resetNewRecipeDraft={resetNewRecipeDraft}
            newRecipeDraft={newRecipeDraft}
            recipePasteText={recipePasteText}
            setRecipePasteText={setRecipePasteText}
            structuredRecipeName={structuredRecipeName}
            setStructuredRecipeName={setStructuredRecipeName}
            structuredRecipePortions={structuredRecipePortions}
            setStructuredRecipePortions={setStructuredRecipePortions}
            structuredRecipeIngredients={structuredRecipeIngredients}
            setStructuredRecipeIngredients={setStructuredRecipeIngredients}
            structuredRecipeMethod={structuredRecipeMethod}
            setStructuredRecipeMethod={setStructuredRecipeMethod}
            recipePasteMessage={recipePasteMessage}
            recipePasteError={recipePasteError}
            importPastedRecipeText={importPastedRecipeText}
            importStructuredRecipeText={importStructuredRecipeText}
          >
            {builderMode === "create" ? (
              <NewRecipeBuilder
                Card={Card}
                Badge={Badge}
                Icon={Icon}
                DecimalInput={DecimalInput}
                newRecipeDraft={newRecipeDraft}
                getNextBatchCode={getNextBatchCode}
                setBuilderMode={setBuilderMode}
                money={money}
                newRecipeDraftCost={newRecipeDraftCost}
                newRecipeDraftRoundupTarget={newRecipeDraftRoundupTarget}
                updateNewRecipeField={updateNewRecipeField}
                venues={venues}
                toggleNewRecipeSecondaryVenue={toggleNewRecipeSecondaryVenue}
                numberValue={numberValue}
                addNewDraftComponent={addNewDraftComponent}
                isParentLinkedComponent={isParentLinkedComponent}
                removeNewDraftComponent={removeNewDraftComponent}
                setActiveDraftLookupId={setActiveDraftLookupId}
                activeDraftLookupId={activeDraftLookupId}
                draftIngredientSuggestions={draftIngredientSuggestions}
                applyIngredientMatchToDraft={applyIngredientMatchToDraft}
                ingredientExistsByNameOrCode={ingredientExistsByNameOrCode}
                createIngredientFromRecipeBuilder={createIngredientFromRecipeBuilder}
                toTitleCaseWords={toTitleCaseWords}
                shouldAutoCostComponent={shouldAutoCostComponent}
                updateNewComponentField={updateNewComponentField}
                addNewMethodStep={addNewMethodStep}
                updateNewMethodStep={updateNewMethodStep}
                removeNewMethodStep={removeNewMethodStep}
                resetNewRecipeDraft={resetNewRecipeDraft}
                saveNewRecipeDraft={saveNewRecipeDraft}
              />
            ) : selectedRecipe ? (
              <ExistingRecipeEditor
                Card={Card}
                Badge={Badge}
                Icon={Icon}
                DecimalInput={DecimalInput}
                selectedRecipe={selectedRecipe}
                editWarning={currentEditTarget?.entityType === "recipe" ? currentEditWarning : ""}
                importMessage={importMessage}
                importError={importError}
                setBuilderMode={setBuilderMode}
                setRecipeEditLookup={setRecipeEditLookup}
                resetNewRecipeDraft={resetNewRecipeDraft}
                builderRecipeFilter={builderRecipeFilter}
                setBuilderRecipeFilter={setBuilderRecipeFilter}
                builderBringBatchesForward={builderBringBatchesForward}
                setBuilderBringBatchesForward={setBuilderBringBatchesForward}
                recipeLookupQuery={recipeLookupQuery}
                setRecipeLookupQuery={setRecipeLookupQuery}
                clearRecipeLookup={clearRecipeLookup}
                filteredRecipeEditOptions={filteredRecipeEditOptions}
                recipeEditLookup={recipeEditLookup}
                setSelectedRecipeId={setSelectedRecipeId}
                money={money}
                numberValue={numberValue}
                getBatchYieldLabel={getBatchYieldLabel}
                getBatchUnitCost={getBatchUnitCost}
                selectedRecipeComponentCount={selectedRecipeComponentCount}
                getRecipeVenueLabel={getRecipeVenueLabel}
                saveCurrentRecipeChanges={saveCurrentRecipeChanges}
                openRecipeCostSheetForRecipe={openRecipeCostSheetForRecipe}
                openChefSheetPreviewForRecipe={openChefSheetPreviewForRecipe}
                deleteRecipe={deleteRecipe}
                selectedRecipeLocked={selectedRecipeLocked}
                updateRecipeField={updateRecipeField}
                selectedRecipeResolved={selectedRecipeResolved}
                restaurantLiveRecipeIds={restaurantLiveRecipeIds}
                batchImpact={batchImpact}
                getFieldIssues={getFieldIssues}
                getMetaIssues={getMetaIssues}
                venues={venues}
                selectedRecipeSecondaryVenues={getSecondaryVenueListForRecipe(selectedRecipe, recipeAvailableVenues)}
                setRecipeSecondaryVenues={setRecipeSecondaryVenues}
                getMethodSteps={getMethodSteps}
                updateMethodStep={updateMethodStep}
                removeMethodStep={removeMethodStep}
                addMethodStep={addMethodStep}
                getChefPortionNote={getChefPortionNote}
                handlePresentationImageUpload={handlePresentationImageUpload}
                addComponent={addComponent}
                getComponentIssues={getComponentIssues}
                isParentLinkedComponent={isParentLinkedComponent}
                findBatchRecipeMatch={findBatchRecipeMatch}
                normalizeCodeKey={normalizeCodeKey}
                jumpToLinkedBatchRecipe={jumpToLinkedBatchRecipe}
                jumpToIngredientRecord={jumpToIngredientRecord}
                removeComponent={removeComponent}
                activeLookup={activeLookup}
                setActiveLookup={setActiveLookup}
                getComponentFieldIssues={getComponentFieldIssues}
                updateComponentField={updateComponentField}
                ingredientSuggestions={ingredientSuggestions}
                applyIngredientMatch={applyIngredientMatch}
                ingredientExistsByNameOrCode={ingredientExistsByNameOrCode}
                createIngredientFromRecipeBuilder={createIngredientFromRecipeBuilder}
                toTitleCaseWords={toTitleCaseWords}
                shouldAutoCostComponent={shouldAutoCostComponent}
                getComponentSourceRouteLabel={getComponentSourceRouteLabel}
                batchUsage={batchUsage}
              />
            ) : (
              <Card>
                <p className="support-text">Select a recipe to edit, or switch to `Create new` to build one from scratch.</p>
              </Card>
            )}
          </BuilderTab>
        )}

        {activeTab === "venue-menus" && (
          <MenusTab
            Card={Card}
            StatCard={StatCard}
            Badge={Badge}
            availabilitySearch={availabilitySearch}
            setAvailabilitySearch={setAvailabilitySearch}
            recipes={recipes}
            availabilityVenueFilter={availabilityVenueFilter}
            setAvailabilityVenueFilter={setAvailabilityVenueFilter}
            availabilityVenueSummary={availabilityVenueSummary}
            availabilityRows={availabilityRows}
            venues={venues}
            venueOptions={venueOptions}
            toggleRecipeAvailableVenue={toggleRecipeAvailableVenue}
            publishRecipeToVenueMenu={publishRecipeToVenueMenu}
            publishRecipeToVenueMenus={publishRecipeToVenueMenus}
            removeRecipeFromVenueMenus={removeRecipeFromVenueMenus}
            isRecipeOnVenueMenu={isRecipeOnVenueMenu}
            menuCoursePresets={MENU_COURSE_PRESETS}
            servicePeriodOptions={DEFAULT_SERVICE_PERIODS}
            inferMenuCourseFromRecipe={inferMenuCourseFromRecipe}
            activeVenueMenus={activeVenueMenus}
            activeVenueMenuDishCount={activeVenueMenuDishCount}
            menuLiveVenueFilter={menuLiveVenueFilter}
            setMenuLiveVenueFilter={setMenuLiveVenueFilter}
            activeVenueMenuSummary={activeVenueMenuSummary}
            filteredActiveVenueMenus={filteredActiveVenueMenus}
            openMenuSheetPreview={openMenuSheetPreview}
            money={money}
            percent={percent}
            getMenuCourseGroups={getMenuCourseGroups}
            menuDashboardSummary={menuDashboardSummary}
            menuDashboardVenue={menuDashboardVenue}
            menuDashboardService={menuDashboardService}
            setMenuDashboardService={setMenuDashboardService}
            dashboardServiceSummary={dashboardServiceSummary}
            focusMenuDashboardVenue={focusMenuDashboardVenue}
            dashboardInventoryRecipes={dashboardInventoryRecipes}
            dashboardMenu={dashboardMenu}
            dashboardEditWarning={currentEditTarget?.entityType === "menu" ? currentEditWarning : ""}
            updateMenuField={updateMenuField}
            publishRecipeToServiceMenu={publishRecipeToServiceMenu}
            publishRecipesToServiceMenus={publishRecipesToServiceMenus}
            removeRecipeFromServiceMenu={removeRecipeFromServiceMenu}
            removeRecipesFromServiceMenus={removeRecipesFromServiceMenus}
            createDraftRecipeFromDishInventory={createDraftRecipeFromDishInventory}
            openRecipeInBuilder={openRecipeInBuilder}
            getMenuServicePeriod={getMenuServicePeriod}
            focusMenuBuilder={focusMenuBuilder}
            updateMenuLine={updateMenuLine}
            saveMenuChanges={saveMenuChanges}
            importMessage={importMessage}
            importError={importError}
          />
        )}

        {activeTab === "dish-inventory" && (
          <DishInventoryTab
            Card={Card}
            StatCard={StatCard}
            Badge={Badge}
            dishInventoryRows={dishInventoryRows}
            dishInventorySummary={dishInventorySummary}
            dishInventorySearch={dishInventorySearch}
            setDishInventorySearch={setDishInventorySearch}
            dishInventoryStatusFilter={dishInventoryStatusFilter}
            setDishInventoryStatusFilter={setDishInventoryStatusFilter}
            openRecipeInBuilder={openRecipeInBuilder}
            createRecipeFromDishIndex={createRecipeFromDishIndex}
            openMenusForDishInventoryRow={openMenusForDishInventoryRow}
            unlinkDishIndexRecipe={unlinkDishIndexRecipe}
          />
        )}

        {activeTab === "menus" && (
          <SetMenusTab
            Card={Card}
            StatCard={StatCard}
            Badge={Badge}
            Icon={Icon}
            menuBuilderRef={menuBuilderRef}
            addMenu={addMenu}
            selectedMenu={selectedMenu}
            saveMenuChanges={saveMenuChanges}
            openMenuSheetPreview={openMenuSheetPreview}
            setSelectedMenuId={setSelectedMenuId}
            menuDashboardVenue={menuDashboardVenue}
            menuCards={menuCards}
            dashboardVenueMenus={dashboardVenueMenus}
            updateMenuField={updateMenuField}
            venueOptions={venueOptions}
            numberValue={numberValue}
            MENU_COURSE_PRESETS={MENU_COURSE_PRESETS}
            addMenuLine={addMenuLine}
            removeMenuLine={removeMenuLine}
            updateMenuLine={updateMenuLine}
            recipes={recipes}
            getAvailableVenueListForRecipe={getAvailableVenueListForRecipe}
            recipeAvailableVenues={recipeAvailableVenues}
            getBaseVenueName={getBaseVenueName}
            money={money}
            percent={percent}
            getMenuCourseGroups={getMenuCourseGroups}
          />
        )}

        {activeTab === "ingredients" && (
          <TabErrorBoundary resetKey={`${activeTab}-${ingredientTypeFilter}-${ingredientBatchLinkFilter}-${ingredientColumnFilter}-${search}`}>
            <IngredientsTab
              Card={Card}
              StatCard={StatCard}
              Badge={Badge}
              Icon={Icon}
              ingredientCatalogueSummary={ingredientCatalogueSummary}
              setActiveTab={setActiveTab}
              setIngredientTypeFilter={setIngredientTypeFilter}
              setIngredientBatchLinkFilter={setIngredientBatchLinkFilter}
              setIngredientColumnFilter={setIngredientColumnFilter}
              setSearch={setSearch}
              addIngredientRow={addIngredientRow}
              combinedIngredientCatalog={combinedIngredientCatalog}
              unlockedIngredientCount={
                combinedIngredientCatalog.filter((row) => isIngredientBuilderRow(row)).length
              }
              ingredientEditLookupQuery={ingredientEditLookupQuery}
              setIngredientEditLookupQuery={setIngredientEditLookupQuery}
              setIngredientEditLookup={setIngredientEditLookup}
              setIngredientEditLookupOpen={setIngredientEditLookupOpen}
              ingredientEditLookupOpen={ingredientEditLookupOpen}
              filteredIngredientEditOptions={filteredIngredientEditOptions}
              focusIngredientDraft={focusIngredientDraft}
              ingredientCatalog={ingredientCatalog}
              openIngredientQuickPanel={openIngredientQuickPanel}
              activeIngredientDraft={activeIngredientDraft}
              money={money}
              getValidationIssueText={getValidationIssueText}
              ingredientUploadMessage={ingredientUploadMessage}
              ingredientUploadError={ingredientUploadError}
              duplicateIngredientGroups={duplicateIngredientGroups}
              mergeDuplicateIngredientGroup={mergeDuplicateIngredientGroup}
              ingredientReturnTarget={ingredientReturnTarget}
              returnToIngredientSourceRecipe={returnToIngredientSourceRecipe}
              handleIngredientUpload={handleIngredientUpload}
              saveIngredientMasterChanges={saveIngredientMasterChanges}
              ingredientMaster={ingredientMaster}
              normalizeExistingNames={normalizeExistingNames}
              recipes={recipes}
              createMissingIngredientRowsFromRecipes={createMissingIngredientRowsFromRecipes}
              refreshRecipeComponentSources={refreshRecipeComponentSources}
              syncBatchIngredientsWithRecipes={syncBatchIngredientsWithRecipes}
              exportIngredientMaster={exportIngredientMaster}
              downloadIngredientTemplate={downloadIngredientTemplate}
              ingredientTypeFilter={ingredientTypeFilter}
              ingredientBatchLinkFilter={ingredientBatchLinkFilter}
              ingredientColumnFilter={ingredientColumnFilter}
              renderIngredientSortHeader={renderIngredientSortHeader}
              filteredIngredientCatalog={filteredIngredientCatalog}
              renderIngredientCatalogRow={renderIngredientCatalogRow}
            />
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
                                    : row.match.status === "invalid"
                                      ? "negative"
                                      : "negative"
                              }
                            >
                              {row.match.status === "matched"
                                ? "Matched"
                                : row.match.status === "possible"
                                  ? "Possible"
                                  : row.match.status === "invalid"
                                    ? "Invalid batch link"
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
                            {row.match.source === "invalid-batch-link" ? (
                              <div className="support-text">Batch recipes cannot be linked here. Unlink it and choose a dish recipe instead.</div>
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
                              {row.match.recipe && !["manual-link", "invalid-batch-link"].includes(row.match.source) ? (
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
                                  onClick={() => unlinkDishIndexRecipe(row.id)}
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
                    <div className="panel-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={saveQuickPanelIngredientAndReturn}
                      >
                        <Icon name="save" />
                        Save ingredient changes
                      </button>
                    </div>
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
                        <span>Unit price (net)</span>
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
                        <span>Purchase VAT</span>
                        <select
                          value={String(normalizePurchaseVatRate(quickPanelIngredient.purchase_vat_rate))}
                          disabled={quickPanelIngredient.is_locked || quickPanelIngredient.entry_type === "batch"}
                          onChange={(event) =>
                            updateIngredientField(
                              quickPanelIngredient.id,
                              "purchase_vat_rate",
                              Number(event.target.value)
                            )
                          }
                        >
                          {FOOD_PURCHASE_VAT_OPTIONS.map((rate) => (
                            <option key={`quick-vat-${rate}`} value={String(rate)}>
                              {percentFromRate(rate)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field ingredient-pack-size-field">
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
                            <option value="ml">ml</option>
                            <option value="l">l</option>
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

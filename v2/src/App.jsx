import { Component, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ingredientMasterSample from "./data/ingredient-master-sample-50.json";
import ingredientLearningRuleSeed from "./data/ingredient-learning-rules.json";
import { supabase, supabaseEnabled } from "../../src/lib/supabase";
import { parseCsv, readXlsxWorkbookSheets } from "../../src/imports/parsers";
import {
  resolveImportSourceRowState as resolveIngredientImportSourceRowState,
  resolveImportSourceRows,
  summarizeResolvedImportSourceRows,
} from "./lib/ingredientWorkflow";
import { buildIngredientsPanelState } from "./lib/ingredientMasterPanel";

const sections = [
  { id: "ingredients", label: "Ingredients" },
  { id: "batches", label: "Components" },
  { id: "recipes", label: "Recipes" },
  { id: "menus", label: "Menus" },
  { id: "substitutions", label: "Substitutions", groupStart: true },
  { id: "exports", label: "Exports" },
  { id: "settings", label: "Settings", groupStart: true },
];

const LEARNING_RULES_STORAGE_KEY = "peligoni-v2-ingredient-learning-rules";
const INGREDIENT_MASTER_REVIEW_STORAGE_KEY = "peligoni-v2-ingredient-master-review";
const INGREDIENT_TRADE_CATEGORY_STORAGE_KEY = "peligoni-v2-ingredient-trade-category";
const INGREDIENT_SOURCE_CODE_REDIRECT_STORAGE_KEY = "peligoni-v2-ingredient-source-code-redirect";
const IGNORED_IMPORT_ROW_STORAGE_KEY = "peligoni-v2-ignored-import-rows";
const RESOLVED_IMPORT_ROW_STORAGE_KEY = "peligoni-v2-resolved-import-rows";
const RECIPE_REVIEW_FLAG_STORAGE_KEY = "peligoni-v2-recipe-review-flags";
const BATCH_REVIEW_FLAG_STORAGE_KEY = "peligoni-v2-batch-review-flags";
const PENDING_INGREDIENT_DELETION_STORAGE_KEY = "peligoni-v2-pending-ingredient-deletions";
const DELETED_INGREDIENT_TOMBSTONE_STORAGE_KEY = "peligoni-v2-deleted-ingredient-tombstones";
const SOFT1_SOURCE_ROWS_STORAGE_KEY = "peligoni-v2-soft1-source-rows";
const SOFT1_SOURCE_META_STORAGE_KEY = "peligoni-v2-soft1-source-meta";
const INGREDIENT_REVIEW_STATE_RULE_FIELD = "__ingredient_review_state__";
const INGREDIENT_SUBSTITUTION_STATE_RULE_FIELD = "__ingredient_substitution_state__";
const INGREDIENT_TRADE_CATEGORY_RULE_FIELD = "__ingredient_trade_category__";
const INGREDIENT_SOURCE_CODE_REDIRECT_RULE_FIELD = "__ingredient_source_code_redirect__";
const IGNORED_IMPORT_ROW_RULE_FIELD = "__ignored_import_row__";
const RECIPE_REVIEW_FLAG_RULE_FIELD = "__recipe_review_flag__";
const BATCH_REVIEW_FLAG_RULE_FIELD = "__batch_review_flag__";
const EDIT_SESSION_STALE_MS = 90 * 1000;
const SHARED_LOAD_TIMEOUT_MS = 15000;
const LIVE_FOOD_APP_URL = "https://peligoni-recipe-costing.vercel.app/";
const LIVE_DRINKS_APP_URL = "https://drinks-recipe-app.vercel.app/";
const LOCAL_FOOD_APP_URL = "http://localhost:5174/";
const LOCAL_DRINKS_APP_URL = "http://localhost:5173/";

function withTimeout(promise, timeoutMs = SHARED_LOAD_TIMEOUT_MS, label = "Request") {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function getAppSwitcherLinks() {
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
}

const initialIngredients = [
  {
    id: "ing-1",
    name: "Beef fillet - Aberdeen angus - frozen (Argentinian)",
    code: "101.BEEF10",
    sourceCode: "101.BEEF10",
    aliases: ["Argentinian Aberdeen angus beef filet frozen"],
    status: "review",
    packSize: "1kg",
    supplier: "Soft1 import",
    category: "Frozen meats",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 38.67,
    costUnit: "kg",
    portionCostHint: 3.48,
    usedInRecipeIds: ["rec-2"],
    batchId: "",
    archived: false,
    notes: "This ingredient already exists in the catalogue and is the likely point of truth for this source code.",
  },
  {
    id: "ing-2",
    name: "Greek yoghurt",
    code: "YOG001",
    sourceCode: "YOG001",
    aliases: ["Greek yoghurt 1kg", "Greek yoghurt tub 1kg"],
    status: "ready",
    packSize: "1kg",
    supplier: "Local dairy",
    category: "Dairy",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 8,
    costUnit: "kg",
    portionCostHint: 0.32,
    usedInRecipeIds: ["rec-1", "rec-3"],
    batchId: "bat-1",
    archived: false,
    notes: "Linked to the yoghurt dip component recipe.",
  },
  {
    id: "ing-3",
    name: "Chicken breast - frozen",
    code: "101.CHI9",
    sourceCode: "101.CHI9",
    aliases: ["Frozen chicken breast"],
    status: "ready",
    packSize: "1kg",
    supplier: "Soft1 import",
    category: "Frozen meats",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 12.5,
    costUnit: "kg",
    portionCostHint: 2.15,
    usedInRecipeIds: [],
    batchId: "",
    archived: false,
    notes: "Stable example of a clean ingredient record.",
  },
  {
    id: "ing-4",
    name: "Lamb mince - frozen",
    code: "101.LAM7",
    sourceCode: "101.LAM7",
    aliases: ["Frozen lamb mince"],
    status: "ready",
    packSize: "1kg",
    supplier: "Soft1 import",
    category: "Frozen meats",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 15,
    costUnit: "kg",
    portionCostHint: 2.7,
    usedInRecipeIds: ["rec-1"],
    batchId: "",
    archived: false,
    notes: "Useful anchor ingredient for dish workflow examples.",
  },
  {
    id: "ing-5",
    name: "Tomatoes",
    code: "VEG001",
    sourceCode: "VEG001",
    aliases: ["Tomatoes fresh"],
    status: "ready",
    packSize: "1kg",
    supplier: "Produce market",
    category: "Perishable foods",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 4.67,
    costUnit: "kg",
    portionCostHint: 0.56,
    usedInRecipeIds: ["rec-3"],
    batchId: "",
    archived: false,
    notes: "Simple fresh ingredient example for salads and cold dishes.",
  },
  {
    id: "ing-6",
    name: "Feta",
    code: "CHE001",
    sourceCode: "CHE001",
    aliases: ["Greek feta"],
    status: "ready",
    packSize: "400g",
    supplier: "Local dairy",
    category: "Dairy",
    sourceType: "soft1",
    soft1Status: "in_soft1",
    sourceRecordLabel: "Soft1 import",
    lastImportedAt: "",
    unitCost: 17.33,
    costUnit: "kg",
    portionCostHint: 0.78,
    usedInRecipeIds: ["rec-3"],
    batchId: "",
    archived: false,
    notes: "Cheese example for menu dishes and dietary tagging later.",
  },
];

const initialBatches = [
  {
    id: "bat-1",
    name: "Yoghurt dip base",
    code: "BCH022",
    status: "ready",
    usedInRecipeIds: ["rec-1"],
    productType: "Dip",
    publishedIngredientId: "",
    archived: false,
    ingredientLines: [
      { ingredientId: "ing-2", quantity: "2000", unit: "g", estimatedCost: 16 },
    ],
    ingredientIds: ["ing-2"],
    yieldAmount: 2,
    yieldUnit: "kg",
    yieldLabel: "2kg",
    unitCost: 8.5,
    costUnit: "kg",
    portionCostHint: 0.34,
    methodSteps: [
      "Mix the yoghurt base until smooth and evenly seasoned.",
      "Check the texture, then adjust with seasoning before chilling.",
      "Store covered and hold chilled for service.",
    ],
    prepNotes: "Best made ahead so the flavour settles before service.",
  },
  {
    id: "bat-2",
    name: "Tomato dressing",
    code: "BCH031",
    status: "draft",
    usedInRecipeIds: ["rec-3"],
    productType: "Dressing",
    publishedIngredientId: "",
    archived: false,
    ingredientLines: [
      { ingredientId: "ing-5", quantity: "1200", unit: "g", estimatedCost: 5.6 },
    ],
    ingredientIds: ["ing-5"],
    yieldAmount: 1.5,
    yieldUnit: "l",
    yieldLabel: "1.5l",
    unitCost: 9.6,
    costUnit: "l",
    portionCostHint: 0.24,
    methodSteps: [
      "Blend the dressing ingredients until emulsified.",
      "Taste and balance the acidity before passing.",
      "Hold chilled and shake before service.",
    ],
    prepNotes: "Check consistency before service and loosen if needed.",
  },
];

const initialRecipes = [
  {
    id: "rec-1",
    name: "Lamb kofta",
    code: "DISH104",
    status: "draft",
    category: "Grill",
    menuDescription: "Chargrilled lamb kofta with yoghurt dip and herbs.",
    methodSteps: [
      "Mix the lamb mince with the spice blend and seasoning until evenly combined.",
      "Form onto skewers, then chill until firm enough to handle cleanly in service.",
      "Grill to order until caramelised outside and cooked through.",
    ],
    prepNotes: "Form the kofta mix ahead of service and hold chilled for quick firing.",
    platingNotes: "Swipe yoghurt dip onto the plate, rest kofta on top, then finish with herbs and olive oil.",
    chefNotes: "This is a good example of a dish using one core ingredient plus one component recipe.",
    finishedDishImage: "",
    portions: 4,
    salePrice: 16,
    serviceSuitability: ["Dinner"],
    ingredientLines: [
      { ingredientId: "ing-4", quantity: "180", unit: "g", estimatedCost: 2.7 },
    ],
    batchLines: [
      { batchId: "bat-1", quantity: "40", unit: "g", estimatedCost: 0.34 },
    ],
    ingredientIds: ["ing-4"],
    batchIds: ["bat-1"],
    menuIds: ["men-1"],
    archived: false,
  },
  {
    id: "rec-2",
    name: "Beef carpaccio",
    code: "DISH118",
    status: "review",
    category: "Starter",
    menuDescription: "Thin-sliced beef fillet with capers and parmesan.",
    methodSteps: [
      "Slice the beef fillet thinly and keep it well chilled for clean handling.",
      "Lay the slices flat across a chilled plate in an even layer.",
      "Season lightly just before finishing the plate.",
    ],
    prepNotes: "Portion and flatten the beef in advance so plating is fast during service.",
    platingNotes: "Finish with capers, parmesan, lemon, and olive oil at the pass.",
    chefNotes: "Clean simple dish where the quality of the core ingredient matters most.",
    finishedDishImage: "",
    portions: 1,
    salePrice: 19,
    serviceSuitability: ["Lunch", "Dinner"],
    ingredientLines: [
      { ingredientId: "ing-1", quantity: "90", unit: "g", estimatedCost: 3.48 },
    ],
    batchLines: [],
    ingredientIds: ["ing-1"],
    batchIds: [],
    menuIds: ["men-2"],
    archived: false,
  },
  {
    id: "rec-3",
    name: "Greek salad",
    code: "DISH011",
    status: "live",
    category: "Salad",
    menuDescription: "Tomatoes, cucumber, olives, feta, oregano.",
    methodSteps: [
      "Cut the tomatoes and feta into generous service pieces.",
      "Arrange loosely with the remaining salad components.",
      "Dress lightly just before serving so the salad stays bright.",
    ],
    prepNotes: "Hold the tomatoes at room temperature and keep the feta drained and chilled.",
    platingNotes: "Build loosely in a bowl and finish with oregano and dressing at the end.",
    chefNotes: "Good example of a cold dish with simple components and one component recipe.",
    finishedDishImage: "",
    portions: 1,
    salePrice: 14,
    serviceSuitability: ["Lunch", "Dinner"],
    ingredientLines: [
      { ingredientId: "ing-5", quantity: "120", unit: "g", estimatedCost: 0.56 },
      { ingredientId: "ing-6", quantity: "45", unit: "g", estimatedCost: 0.78 },
    ],
    batchLines: [
      { batchId: "bat-2", quantity: "25", unit: "ml", estimatedCost: 0.24 },
    ],
    ingredientIds: ["ing-5", "ing-6"],
    batchIds: ["bat-2"],
    menuIds: ["men-1"],
    archived: false,
  },
];

const recipeWorkflowSteps = [
  { id: "basics", label: "Basics" },
  { id: "components", label: "Ingredients" },
  { id: "method", label: "Method" },
  { id: "pricing", label: "Portions & pricing" },
  { id: "usage", label: "Usage" },
];

const batchWorkflowSteps = [
  { id: "basics", label: "Basics" },
  { id: "components", label: "Ingredients" },
  { id: "method", label: "Method" },
  { id: "yield", label: "Yield & cost" },
  { id: "usage", label: "Usage" },
];

const measurementUnitOptions = ["kg", "g", "l", "ml", "piece"];
const recipeCategoryOptions = ["Starter", "Main", "Dessert", "Side", "Small plate", "Large plate", "Special"];
const recipeServiceOptions = ["Breakfast", "Lunch", "Dinner", "Bar", "All day"];
const componentProductTypeOptions = ["Sauce", "Dressing", "Dip", "Garnish", "Base", "Prep", "Stock", "Marinade", "Condiment"];
const batchStatusOptions = ["draft", "review", "ready"];
const ingredientSourceTypeOptions = ["soft1", "manual"];
const soft1SyncStatusOptions = ["in_soft1", "pending"];
const FOOD_SALE_VAT_RATE = 0.13;
const FOOD_TARGET_COST_RATIO = 0.3;

const initialRestaurants = [
  {
    id: "rest-tasi",
    name: "Tasi",
    venueType: "Restaurant",
    servicePattern: "Mostly breakfast and lunch, with occasional dinner service.",
    primaryServices: ["Breakfast", "Lunch"],
    secondaryServices: ["Dinner"],
    eventUses: [],
  },
  {
    id: "rest-terraces",
    name: "Terraces",
    venueType: "Restaurant",
    servicePattern: "Predominantly lunch and dinner, with occasional event use.",
    primaryServices: ["Lunch", "Dinner"],
    secondaryServices: ["Events"],
    eventUses: ["Events"],
  },
  {
    id: "rest-mikro-nisi",
    name: "Mikro Nisi",
    venueType: "Restaurant",
    servicePattern: "Used in much the same way as Terraces: lunch, dinner, and occasional events.",
    primaryServices: ["Lunch", "Dinner"],
    secondaryServices: ["Events"],
    eventUses: ["Events"],
  },
  {
    id: "rest-deli-kitchen",
    name: "Deli Kitchen",
    venueType: "Deli / all-day spot",
    servicePattern: "Breakfast and brunch-led, with dinner and takeaway menus as well.",
    primaryServices: ["Breakfast", "Brunch"],
    secondaryServices: ["Dinner", "Takeaway"],
    eventUses: [],
  },
  {
    id: "rest-courtyard",
    name: "Courtyard",
    venueType: "Event-led dining space",
    servicePattern: "Hosts three weekly evening feasts and is also used for wedding receptions.",
    primaryServices: ["Evening feasts"],
    secondaryServices: ["Wedding receptions"],
    eventUses: ["Wedding receptions"],
  },
  {
    id: "rest-pop-up-kitchen",
    name: "Pop up kitchen",
    venueType: "Pop-up",
    servicePattern: "Runs a very small changing menu, usually at lunchtime.",
    primaryServices: ["Lunch"],
    secondaryServices: ["Daily changing menu"],
    eventUses: [],
  },
];

const initialMenus = [
  {
    id: "men-1",
    restaurantId: "rest-tasi",
    restaurant: "Tasi",
    service: "Dinner",
    name: "Tasi dinner menu",
    status: "live",
    items: [
      {
        id: "menu-item-1",
        recipeId: "rec-1",
        dishName: "Lamb kofta",
        description: "Chargrilled lamb kofta with yoghurt dip and herbs.",
      },
      {
        id: "menu-item-2",
        recipeId: "rec-3",
        dishName: "Greek salad",
        description: "Tomatoes, cucumber, olives, feta, oregano.",
      },
    ],
  },
  {
    id: "men-2",
    restaurantId: "rest-terraces",
    restaurant: "Terraces",
    service: "Dinner",
    name: "Terraces dinner menu",
    status: "draft",
    items: [
      {
        id: "menu-item-3",
        recipeId: "rec-2",
        dishName: "Beef carpaccio",
        description: "Thin-sliced beef fillet with capers and parmesan.",
      },
    ],
  },
  {
    id: "men-3",
    restaurantId: "rest-deli-kitchen",
    restaurant: "Deli Kitchen",
    service: "Brunch",
    name: "Deli Kitchen brunch menu",
    status: "draft",
    items: [
      {
        id: "menu-item-4",
        recipeId: "rec-3",
        dishName: "Greek salad",
        description: "Tomatoes, cucumber, olives, feta, oregano.",
      },
    ],
  },
];

const initialUsers = [
  { id: "usr-1", name: "Operations admin", email: "ops@peligoni.com", role: "Admin", status: "active" },
  { id: "usr-2", name: "Head chef", email: "chef@peligoni.com", role: "Editor", status: "active" },
  { id: "usr-3", name: "Menu viewer", email: "menus@peligoni.com", role: "Chef", status: "inactive" },
];

const ingredientIndexFields = [
  { key: "brand", label: "Brand", partOfName: true },
  { key: "product", label: "Product", partOfName: true },
  { key: "cut", label: "Cut / type", partOfName: true },
  { key: "quality", label: "Quality / breed", partOfName: true },
  { key: "dietary", label: "Dietary", partOfName: true },
  { key: "state", label: "State", partOfName: true },
  { key: "origin", label: "Origin", partOfName: false, suffixStyle: "parenthetical" },
  { key: "style", label: "Extra style", partOfName: true },
];

const knownBrandPhrases = [
  "alexaki",
  "karamolegos",
  "rummo",
  "schar",
  "grecian living",
  "la molisana",
  "la mosilana",
  "la molina",
  "barilla",
  "papadopoulou",
  "papadopoulos",
  "caputo",
  "cipriani",
  "philadelphia",
  "planteese",
  "plantese",
  "delta",
  "olympos",
  "barista",
  "debic",
  "de cecco",
  "mutti",
  "kyknos",
  "hellmann",
  "hellmanns",
  "heinz",
  "volife",
  "kikkoman",
  "yutaka",
  "torres",
  "kettle",
  "garofalo",
  "eat real",
  "hey baby",
  "go pure",
  "protein ball co",
  "the great british porridge",
  "lameloise",
  "la meloise",
  "bonne maman",
  "nutella",
  "kelloggs",
  "melissa",
  "organix",
  "tabasco",
  "alta gusto",
  "oreo",
  "agrino",
  "pringles",
  "beyondmeat",
  "beyond meat",
  "lurpak",
  "vitam",
  "kaitoglou",
  "zeo",
  "bulteman",
  "ethos",
  "cdo sel",
  "magic",
  "ion",
  "real",
  "st. nicolas",
  "takahiro",
  "b&j",
  "ben & jerry's",
  "ben and jerry's",
];
const originTriggerMap = [
  { trigger: "domestic", value: "Greece" },
  { trigger: "greek", value: "Greece" },
  { trigger: "greece", value: "Greece" },
  { trigger: "zakynthian", value: "Greece" },
  { trigger: "argentinian", value: "Argentina" },
  { trigger: "argentina", value: "Argentina" },
  { trigger: "dutch", value: "Holland" },
  { trigger: "holland", value: "Holland" },
];
const stateWords = ["frozen", "fresh"];

const cleanNameFieldOrder = ["product", "cut", "brand", "quality", "dietary", "style", "state"];
const learningRuleTriggerPhrases = {
  brand: knownBrandPhrases,
  dietary: ["gluten-free", "gluten free", "gl.free", "gl free", "g.free", "gf", "vegan", "vegetarian", "dairy-free", "dairy free"],
  origin: originTriggerMap.map((item) => item.trigger),
  state: stateWords,
};
const initialLearningRules = Array.isArray(ingredientLearningRuleSeed) ? ingredientLearningRuleSeed : [];

function numberValue(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSharedKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textIncludesWholePhrase(text = "", phrase = "") {
  const normalizedText = String(text || "").trim().toLowerCase();
  const normalizedPhrase = String(phrase || "").trim().toLowerCase();
  if (!normalizedText || !normalizedPhrase) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedPhrase)}([^a-z0-9]|$)`, "i");
  return pattern.test(normalizedText);
}

function readMethodSteps(value) {
  if (Array.isArray(value)) {
    return value.map((step) => String(step || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferMenuServiceFromName(name = "") {
  const normalized = normalizeSharedKey(name);
  if (normalized.includes("breakfast")) return "Breakfast";
  if (normalized.includes("brunch")) return "Brunch";
  if (normalized.includes("lunch")) return "Lunch";
  if (normalized.includes("dinner")) return "Dinner";
  if (normalized.includes("takeaway")) return "Takeaway";
  if (normalized.includes("wedding")) return "Wedding receptions";
  if (normalized.includes("event")) return "Events";
  if (normalized.includes("feast")) return "Evening feasts";
  return "Menu";
}

function mapProfileRoleToV2(role = "") {
  const normalized = normalizeSharedKey(role);
  if (normalized === "manager") return "Admin";
  if (normalized === "editor") return "Editor";
  return "Chef";
}

function mapV2RoleToProfileRole(role = "") {
  const normalized = normalizeSharedKey(role);
  if (normalized === "admin") return "manager";
  if (normalized === "editor") return "editor";
  return "viewer";
}

function buildRestaurantsFromSharedData(baseRestaurants = [], menus = [], recipes = []) {
  const knownByKey = new Map(baseRestaurants.map((restaurant) => [normalizeSharedKey(restaurant.name), restaurant]));
  const venueNames = new Set([
    ...menus.map((menu) => menu.restaurant),
    ...recipes.map((recipe) => recipe.restaurantName),
  ].filter(Boolean));

  const generatedRestaurants = Array.from(venueNames)
    .filter((name) => !knownByKey.has(normalizeSharedKey(name)))
    .map((name) => ({
      id: `rest-${slugifyLabel(name)}`,
      name,
      venueType: "Restaurant",
      servicePattern: "Imported from shared menu data.",
      primaryServices: [],
      secondaryServices: [],
      eventUses: [],
    }));

  return [...baseRestaurants, ...generatedRestaurants];
}

function hydrateSharedDataToV2({
  ingredientRows = [],
  recipeRows = [],
  componentRows = [],
  menuRows = [],
  menuLineRows = [],
  profileRows = [],
  ingredientReviewState = {},
  ingredientSubstitutionState = {},
  ingredientTradeCategoryState = {},
  recipeReviewFlagState = {},
  batchReviewFlagState = {},
}) {
  let mappedIngredients = (ingredientRows || []).map((row) => {
    const sharedRecordId = String(row.id || "").trim();
    const sharedUpdatedAt = String(row.updated_at || row.last_updated || "").trim();
    const isPublishedComponent = String(row.entry_type || "").trim() === "batch";
    const rawIngredientCode = String(row.ingredient_item_code || "").trim();
    const hasBchIngredientCode = hasBchCode(rawIngredientCode || row.id || "");
    const soft1SourceCode = getSharedSoft1Code(row);
    const internalCode = getSharedInternalIngredientCode(row);
    const hasSoft1SourceCode = Boolean(soft1SourceCode);
    const storedReviewState = sharedRecordId ? ingredientReviewState[sharedRecordId] || null : null;
    const storedTradeCategory = sharedRecordId ? ingredientTradeCategoryState[sharedRecordId]?.value || "" : "";
    const categoryFields = deriveImportCategoryFields({
      category: row.category,
      tradeCategory: storedTradeCategory || row.trade_category || "",
      sourceCode: soft1SourceCode,
    });

    return {
      id: String(row.id || `ing-${Date.now()}`),
      name: String(row.ingredient_name || "").trim() || "Untitled ingredient",
      code: internalCode || soft1SourceCode || String(row.id || "").trim(),
      sourceCode: hasSoft1SourceCode ? soft1SourceCode : "",
      aliases: dedupeTextList(storedReviewState?.aliases || []).filter(Boolean),
      referenceRawName: String(storedReviewState?.referenceRawName || "").trim(),
      status: "ready",
      packSize: String(row.pack_size || "").trim(),
      supplier: String(row.supplier || "").trim(),
      category: categoryFields.category,
      tradeCategory: categoryFields.tradeCategory,
      sourceType: hasSoft1SourceCode ? "soft1" : "manual",
      soft1Status: hasSoft1SourceCode ? "in_soft1" : "pending",
      sourceRecordLabel: isPublishedComponent ? "Published from component" : "Shared ingredients",
      lastImportedAt: String(row.last_updated || "").trim(),
      unitCost: numberValue(row.unit_cost),
      purchaseVatRate: normalizeVatPercent(row.purchase_vat_rate, 13),
      costUnit: inferPricingUnit(String(row.pack_size || "").trim()),
      portionCostHint: numberValue(row.unit_cost),
      usedInRecipeIds: [],
      batchId: String(row.linked_recipe_id || "").trim(),
      archived: Boolean(row.is_archived),
      notes: "",
      needsSubstitutionReview: Boolean(
        storedReviewState?.flagged || (sharedRecordId && ingredientSubstitutionState[sharedRecordId]?.flagged)
      ),
      needsReviewFlag: Boolean(storedReviewState?.forReview),
      sharedRecordId,
      sharedUpdatedAt,
      masterReviewStatus: resolveHydratedIngredientReviewStatus({
        storedReviewState,
        isPublishedComponent,
        hasBchIngredientCode,
        hasSoft1SourceCode,
      }),
      sharedDirty: false,
    };
  });

  const componentsByRecipeId = new Map();
  (componentRows || []).forEach((component) => {
    const recipeId = String(component.recipe_id || "").trim();
    if (!recipeId) return;
    const current = componentsByRecipeId.get(recipeId) || [];
    current.push(component);
    componentsByRecipeId.set(recipeId, current);
  });

  const batchRecipeRows = (recipeRows || []).filter((row) => String(row.recipe_type || "").trim() === "batch");
  const batchRecipeRowsById = new Map(batchRecipeRows.map((row) => [String(row.id), row]));
  const batchRecipeRowsByCode = new Map();
  const batchRecipeRowsByName = new Map();
  batchRecipeRows.forEach((row) => {
    const codeKey = normalizeSharedKey(String(row.selling_item_code || row.id || "").trim());
    const nameKey = normalizeSharedKey(String(row.name || "").trim());
    if (codeKey && !batchRecipeRowsByCode.has(codeKey)) batchRecipeRowsByCode.set(codeKey, String(row.id));
    if (nameKey && !batchRecipeRowsByName.has(nameKey)) batchRecipeRowsByName.set(nameKey, String(row.id));
  });
  mappedIngredients = mappedIngredients.map((ingredient) => {
    if (String(ingredient.batchId || "").trim()) return ingredient;
    if (String(ingredient.sourceRecordLabel || "").trim() !== "Published from component") return ingredient;

    const batchIdFromCode = batchRecipeRowsByCode.get(normalizeSharedKey(String(ingredient.code || "").trim())) || "";
    const batchIdFromName = batchRecipeRowsByName.get(normalizeSharedKey(String(ingredient.name || "").trim())) || "";
    const fallbackBatchId = batchIdFromCode || batchIdFromName;
    if (!fallbackBatchId) return ingredient;

    return {
      ...ingredient,
      batchId: fallbackBatchId,
    };
  });

  const ingredientsByCode = new Map();
  const ingredientsByName = new Map();
  mappedIngredients.forEach((ingredient) => {
    const codeKey = normalizeSharedKey(ingredient.code || ingredient.sourceCode);
    const nameKey = normalizeSharedKey(ingredient.name);
    if (codeKey && !ingredientsByCode.has(codeKey)) ingredientsByCode.set(codeKey, ingredient);
    if (nameKey && !ingredientsByName.has(nameKey)) ingredientsByName.set(nameKey, ingredient);
  });

  const mappedIngredientsById = new Map(mappedIngredients.map((ingredient) => [ingredient.id, ingredient]));
  const batchPublishedIngredientByRecipeId = new Map(
    mappedIngredients
      .filter((ingredient) => ingredient.batchId)
      .map((ingredient) => [ingredient.batchId, ingredient.id])
  );

  function buildFlattenedSharedBatchIngredientLines(recipeId = "", visitedRecipeIds = new Set()) {
    const safeRecipeId = String(recipeId || "").trim();
    if (!safeRecipeId || visitedRecipeIds.has(safeRecipeId)) {
      return {
        lines: [],
        hasNestedBatchLayers: false,
        unmatchedCount: 0,
        unmatchedLabels: [],
      };
    }

    const nextVisited = new Set(visitedRecipeIds);
    nextVisited.add(safeRecipeId);
    const linkedComponents = (componentsByRecipeId.get(safeRecipeId) || []).sort(
      (left, right) => numberValue(left.component_order) - numberValue(right.component_order)
    );

    let hasNestedBatchLayers = false;
    const flattenedLines = [];
    const unmatchedLabels = [];
    const unmatchedDetails = [];

    linkedComponents.forEach((component) => {
      const explicitSourceRecipeId = String(component.source_recipe_id || "").trim();
      const explicitIngredientId =
        String(component.source_type || "").trim().toLowerCase() === "ingredient"
          ? explicitSourceRecipeId
          : "";
      const codeKey = normalizeSharedKey(component.ingredient_item_code);
      const nameKey = normalizeSharedKey(component.ingredient_name);
      const matchedIngredient =
        (explicitIngredientId && mappedIngredientsById.get(explicitIngredientId)) ||
        (codeKey && ingredientsByCode.get(codeKey)) ||
        (nameKey && ingredientsByName.get(nameKey)) ||
        null;
      const nestedSourceRecipeId =
        (explicitSourceRecipeId && batchRecipeRowsById.has(explicitSourceRecipeId) && explicitSourceRecipeId) ||
        (matchedIngredient?.batchId && batchRecipeRowsById.has(matchedIngredient.batchId) ? matchedIngredient.batchId : "");

      if (nestedSourceRecipeId) {
        hasNestedBatchLayers = true;

        const nestedBatchRow = batchRecipeRowsById.get(nestedSourceRecipeId);
        const nestedYield = getSharedYieldAmountInLineUnit(
          nestedBatchRow?.batch_yield,
          nestedBatchRow?.batch_yield_type
        );
        const componentUnit = explicitSourceRecipeId
          ? mapSharedSourceYieldTypeToLineUnit(component.source_yield_type, nestedYield.unit)
          : resolveSharedIngredientLineUnit(component, matchedIngredient);
        const componentQuantity = numberValue(component.qty);
        const convertedQuantity = convertMeasurementQuantity(componentQuantity, componentUnit, nestedYield.unit);

        if (!(nestedYield.amount > 0) || !(convertedQuantity > 0)) {
          const detail = buildMissingSharedSourceLineDetail(component);
          unmatchedLabels.push(detail.label);
          unmatchedDetails.push(detail);
          return;
        }

        const usageRatio = convertedQuantity / nestedYield.amount;
        if (!(usageRatio > 0)) {
          const publishedIngredientId = batchPublishedIngredientByRecipeId.get(nestedSourceRecipeId) || "";
          if (publishedIngredientId) {
            const publishedIngredient = mappedIngredientsById.get(publishedIngredientId) || null;
            flattenedLines.push({
              ingredientId: publishedIngredientId,
              quantity: formatEditableQuantity(numberValue(component.qty)),
              unit: resolveSharedIngredientLineUnit(component, publishedIngredient),
              estimatedCost: numberValue(component.cost),
            });
          }
          return;
        }

        const nestedResult = buildFlattenedSharedBatchIngredientLines(nestedSourceRecipeId, nextVisited);
        hasNestedBatchLayers = hasNestedBatchLayers || nestedResult.hasNestedBatchLayers;
        unmatchedLabels.push(...(nestedResult.unmatchedLabels || []));
        unmatchedDetails.push(...(nestedResult.unmatchedDetails || []));

        if (nestedResult.lines.length) {
          nestedResult.lines.forEach((line) => {
            const scaledQuantity = parseNumericQuantity(line.quantity) * usageRatio;
            if (!(scaledQuantity > 0)) return;
            flattenedLines.push({
              ...line,
              quantity: formatEditableQuantity(scaledQuantity),
              estimatedCost: Number(line.estimatedCost || 0) * usageRatio,
            });
          });
          return;
        }

        const publishedIngredientId = batchPublishedIngredientByRecipeId.get(nestedSourceRecipeId) || "";
        if (publishedIngredientId) {
          const publishedIngredient = mappedIngredientsById.get(publishedIngredientId) || null;
          flattenedLines.push({
            ingredientId: publishedIngredientId,
            quantity: formatEditableQuantity(numberValue(component.qty)),
            unit: resolveSharedIngredientLineUnit(component, publishedIngredient),
            estimatedCost: numberValue(component.cost),
          });
        }
        return;
      }

      const ingredient = matchedIngredient;
      if (!ingredient) {
        const detail = buildMissingSharedSourceLineDetail(component);
        unmatchedLabels.push(detail.label);
        unmatchedDetails.push(detail);
        return;
      }

      flattenedLines.push({
        ingredientId: ingredient.id,
        quantity: formatEditableQuantity(numberValue(component.qty)),
        unit: resolveSharedIngredientLineUnit(component, ingredient),
        estimatedCost: numberValue(component.cost),
      });
    });

    return {
      lines: mergeSharedIngredientLines(flattenedLines),
      hasNestedBatchLayers,
      unmatchedCount: unmatchedLabels.length,
      unmatchedLabels: dedupeTextList(unmatchedLabels.filter(Boolean)),
      unmatchedDetails,
    };
  }

  const mappedBatches = batchRecipeRows.map((row) => {
    const methodSteps = readMethodSteps(row.method);
    const flattenedBatchResult = buildFlattenedSharedBatchIngredientLines(row.id);
    const ingredientLines = flattenedBatchResult.lines;

    const yieldAmount = Math.max(1, numberValue(row.batch_yield, 1));
    const yieldUnit = String(row.batch_yield_type || "portion").trim() || "portion";
    const publishedIngredientId = batchPublishedIngredientByRecipeId.get(row.id) || "";
    const publishedIngredient = publishedIngredientId ? mappedIngredientsById.get(publishedIngredientId) || null : null;
    const hasBchBatchCode = hasBchCode(row.selling_item_code || row.id || "") || hasBchCode(publishedIngredient?.code || publishedIngredient?.sourceCode || "");
    const needsReview =
      yieldUnit === "portion" ||
      flattenedBatchResult.hasNestedBatchLayers ||
      flattenedBatchResult.unmatchedCount > 0 ||
      hasBchBatchCode;
    const workflowStage = String(row.workflow_stage || "").trim().toLowerCase();
    const status =
      workflowStage === "draft"
        ? "draft"
        : needsReview
          ? "review"
          : publishedIngredientId
            ? "ready"
            : workflowStage === "review"
              ? "review"
              : "draft";

    return syncBatchRecord({
      id: String(row.id),
      name: String(row.name || "").trim() || "Untitled component",
      code: String(row.selling_item_code || row.id || "").trim(),
      status,
      needsReviewFlag: Boolean(batchReviewFlagState[String(row.id)]?.flagged),
      sharedDirty: false,
      sharedPersisted: true,
      usedInRecipeIds: [],
      productType: String(row.category || "").trim(),
      publishedIngredientId,
      archived: false,
      ingredientLines,
      ingredientIds: ingredientLines.map((line) => line.ingredientId),
      sharedMissingLineCount: flattenedBatchResult.unmatchedCount,
      sharedMissingLineLabels: flattenedBatchResult.unmatchedLabels,
      sharedMissingLineDetails: flattenedBatchResult.unmatchedDetails,
      yieldAmount,
      yieldUnit,
      yieldLabel: formatBatchYieldLabel(yieldAmount, yieldUnit),
      unitCost: 0,
      costUnit: yieldUnit,
      portionCostHint: 0,
      methodSteps,
      prepNotes: String(row.presentation_notes || "").trim(),
    });
  });

  const batchById = new Map(mappedBatches.map((batch) => [batch.id, batch]));
  mappedIngredients.forEach((ingredient) => {
    if (!ingredient.batchId) return;
    const linkedBatch = batchById.get(ingredient.batchId);
    if (!linkedBatch) return;
    const isPublishedIngredient = String(linkedBatch.publishedIngredientId || "").trim() === String(ingredient.id || "").trim();
    ingredient.status = isPublishedIngredient ? "ready" : linkedBatch.status === "draft" ? "draft" : linkedBatch.status === "review" ? "review" : "ready";
  });
  const dishRecipeRows = (recipeRows || []).filter((row) => String(row.recipe_type || "").trim() !== "batch");

  const mappedRecipes = dishRecipeRows.map((row) => {
    const methodSteps = readMethodSteps(row.method);
    const linkedComponents = (componentsByRecipeId.get(row.id) || []).sort(
      (left, right) => numberValue(left.component_order) - numberValue(right.component_order)
    );
    const ingredientLines = [];
    const batchLines = [];
    const unmatchedLabels = [];
    const unmatchedDetails = [];

    linkedComponents.forEach((component) => {
      const sourceRecipeId = String(component.source_recipe_id || "").trim();
      if (sourceRecipeId && batchById.has(sourceRecipeId)) {
        const batch = batchById.get(sourceRecipeId);
        const publishedIngredient = findPublishedIngredientForBatch(batch, mappedIngredients);
        if (publishedIngredient?.id) {
          ingredientLines.push({
            ingredientId: publishedIngredient.id,
            quantity: formatEditableQuantity(numberValue(component.qty)),
            unit: mapSharedSourceYieldTypeToLineUnit(
              component.source_yield_type,
              batch?.yieldUnit || publishedIngredient.costUnit || "portion"
            ),
            estimatedCost: numberValue(component.cost),
          });
        } else {
          batchLines.push({
            batchId: sourceRecipeId,
            quantity: formatEditableQuantity(numberValue(component.qty)),
            unit: mapSharedSourceYieldTypeToLineUnit(component.source_yield_type, batch?.yieldUnit || "portion"),
            estimatedCost: numberValue(component.cost),
          });
        }
        return;
      }

      if (sourceRecipeId && String(component.source_type || "").trim().toLowerCase() === "batch" && !batchById.has(sourceRecipeId)) {
        const detail = buildMissingSharedSourceLineDetail(component);
        unmatchedLabels.push(detail.label);
        unmatchedDetails.push(detail);
        return;
      }

      const explicitIngredientId =
        String(component.source_type || "").trim().toLowerCase() === "ingredient"
          ? sourceRecipeId
          : "";
      const codeKey = normalizeSharedKey(component.ingredient_item_code);
      const nameKey = normalizeSharedKey(component.ingredient_name);
      const ingredient =
        (explicitIngredientId && mappedIngredientsById.get(explicitIngredientId)) ||
        (codeKey && ingredientsByCode.get(codeKey)) ||
        (nameKey && ingredientsByName.get(nameKey)) ||
        null;
      if (!ingredient) {
        const detail = buildMissingSharedSourceLineDetail(component);
        unmatchedLabels.push(detail.label);
        unmatchedDetails.push(detail);
        return;
      }

      const linkedBatchId =
        ingredient.batchId && batchById.has(ingredient.batchId)
          ? ingredient.batchId
          : "";
      if (linkedBatchId) {
        const batch = batchById.get(linkedBatchId);
        ingredientLines.push({
          ingredientId: ingredient.id,
          quantity: formatEditableQuantity(numberValue(component.qty)),
          unit: resolveSharedIngredientLineUnit(component, ingredient),
          estimatedCost: numberValue(component.cost),
        });
        return;
      }

      ingredientLines.push({
        ingredientId: ingredient.id,
        quantity: formatEditableQuantity(numberValue(component.qty)),
        unit: resolveSharedIngredientLineUnit(component, ingredient),
        estimatedCost: numberValue(component.cost),
      });
    });

    const workflowStage = String(row.workflow_stage || "").trim().toLowerCase();
    const status = Boolean(row.is_live) ? "live" : workflowStage === "review" ? "review" : "draft";

    return normalizeRecipePublishedComponentLines(
      syncRecipeRelations(
        syncRecipeStatusFromIngredientState(
          {
            id: String(row.id),
            name: String(row.name || "").trim() || "Untitled recipe",
            code: String(row.selling_item_code || row.id || "").trim(),
            status,
            needsReviewFlag: Boolean(recipeReviewFlagState[String(row.id)]?.flagged),
            sharedDirty: false,
            sharedPersisted: true,
            category: String(row.category || "").trim() || "Main",
            menuDescription: "",
            methodSteps,
            prepNotes: "",
            platingNotes: String(row.presentation_notes || "").trim(),
            chefNotes: "",
            portions: Math.max(1, numberValue(row.portion_count, 1)),
            salePrice: numberValue(row.current_sale_price),
            serviceSuitability: dedupeTextList(Array.isArray(row.service_suitability) ? row.service_suitability : []),
            ingredientLines,
            batchLines,
            sharedMissingLineCount: unmatchedLabels.length,
            sharedMissingLineLabels: dedupeTextList(unmatchedLabels.filter(Boolean)),
            sharedMissingLineDetails: unmatchedDetails,
            ingredientIds: ingredientLines.map((line) => line.ingredientId),
            batchIds: batchLines.map((line) => line.batchId),
            menuIds: [],
            archived: false,
          },
          mappedIngredientsById
        )
      ),
      mappedIngredientsById,
      batchById
    );
  });

  const restaurants = buildRestaurantsFromSharedData(initialRestaurants, menuRows, dishRecipeRows.map((row) => ({
    restaurantName: String(row.restaurant || "").trim(),
  })));
  const restaurantsByName = new Map(restaurants.map((restaurant) => [normalizeSharedKey(restaurant.name), restaurant]));
  const recipesById = new Map(mappedRecipes.map((recipe) => [recipe.id, recipe]));
  const menuLinesByMenuId = new Map();
  (menuLineRows || []).forEach((line) => {
    const menuId = String(line.menu_id || "").trim();
    if (!menuId) return;
    const current = menuLinesByMenuId.get(menuId) || [];
    current.push(line);
    menuLinesByMenuId.set(menuId, current);
  });

  const mappedMenus = (menuRows || []).map((row) => {
    const restaurantName = String(row.venue || "").trim() || "Unknown restaurant";
    const restaurant = restaurantsByName.get(normalizeSharedKey(restaurantName)) || null;
    const service = inferMenuServiceFromName(row.name);
    const items = (menuLinesByMenuId.get(row.id) || [])
      .sort((left, right) => numberValue(left.line_order) - numberValue(right.line_order))
      .map((line, index) => {
        const recipe = recipesById.get(String(line.recipe_id || "").trim()) || null;
        return {
          id: String(line.id || `${row.id}-${index + 1}`),
          recipeId: recipe?.id || String(line.recipe_id || "").trim(),
          dishName: String(line.dish_name || recipe?.name || "").trim(),
          description: String(line.description || recipe?.menuDescription || ""),
        };
      });

    return syncMenuRecord({
      id: String(row.id),
      restaurantId: restaurant?.id || `rest-${slugifyLabel(restaurantName)}`,
      restaurant: restaurantName,
      service,
      name: String(row.name || "").trim() || buildDefaultMenuName(restaurantName, service),
      status: row.is_live ? "live" : "draft",
      archived: false,
      sharedDirty: false,
      items,
    });
  });

  const mappedUsers = Array.isArray(profileRows) && profileRows.length
    ? profileRows.map((profile) => ({
        id: String(profile.id || `usr-${Date.now()}`),
        name: String(profile.full_name || profile.email || "User").trim(),
        email: String(profile.email || "").trim(),
        role: mapProfileRoleToV2(profile.role),
        status: "active",
        isSharedProfile: true,
      }))
    : initialUsers;

  return {
    ingredients: mappedIngredients,
    recipes: mappedRecipes,
    batches: mappedBatches,
    restaurants,
    menus: mappedMenus,
    users: mappedUsers,
  };
}

function titleCaseWords(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function createVariationCode(baseCode, index) {
  const suffix = String.fromCharCode(64 + index);
  return `${baseCode}-${suffix}`;
}

function normalizeIngredientKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[/-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isUuidLike(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function isInternalIngredientCode(value = "") {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return false;
  return code.startsWith("INT.") || code.startsWith("BCH") || /^ING\d+$/i.test(code) || code.startsWith("MAN-");
}

function isLikelySoft1IngredientCode(value = "") {
  const code = String(value || "").trim();
  if (!code) return false;
  if (isUuidLike(code) || isInternalIngredientCode(code)) return false;
  return /^\d{3}\.[A-Z]/i.test(code);
}

function normalizeVatPercent(value, fallback = 13) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric <= 0) return 0;
  if (numeric <= 0.02) return Number((numeric * 10000).toFixed(4));
  if (numeric <= 1) return Number((numeric * 100).toFixed(4));
  return Number(numeric.toFixed(4));
}

function extractDisplayIngredientName(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  const primaryPart = rawValue.split(" - ")[0] || rawValue;
  return titleCaseWords(primaryPart);
}

function formatNaturalList(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function extractMenuFinishText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";

  const finishMatch = text.match(/finish(?:ed)? with ([^.]+?)(?: at .*| before .*|$|\.)/i);
  if (finishMatch?.[1]) {
    return `Finished with ${finishMatch[1].trim()}.`;
  }

  return "";
}

function suggestMenuDishName(recipe) {
  return titleCaseWords(recipe?.name || recipe?.code || "New dish");
}

function suggestMenuDescription(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const directDescription = String(recipe?.menuDescription || "").trim();
  if (directDescription) return directDescription;

  const ingredientNames = (recipe?.ingredientLines || [])
    .map((line) => ingredientMap.get(line.ingredientId))
    .filter(Boolean)
    .map((ingredient) => extractDisplayIngredientName(ingredient.name));
  const batchNames = (recipe?.batchLines || [])
    .map((line) => batchMap.get(line.batchId))
    .filter(Boolean)
    .map((batch) => extractDisplayIngredientName(batch.name));
  const componentNames = dedupeTextList([...ingredientNames, ...batchNames]).slice(0, 3);
  const finishText = extractMenuFinishText(recipe?.platingNotes || "");

  if (componentNames.length) {
    const componentSentence = `Featuring ${formatNaturalList(componentNames)}.`;
    return [componentSentence, finishText].filter(Boolean).join(" ");
  }

  const methodFallback = String((recipe?.methodSteps || []).find((step) => String(step || "").trim()) || "").trim();
  if (methodFallback) {
    return `${methodFallback.replace(/\.+$/, "")}.`;
  }

  return "";
}

function normalizeSearchText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\byoghurts\b/g, "yogurts")
    .replace(/\byoghurt\b/g, "yogurt")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value = "") {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function levenshteinDistance(left = "", right = "") {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }

    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[b.length];
}

function scoreSearchToken(queryToken = "", candidateToken = "") {
  const query = normalizeSearchText(queryToken);
  const candidate = normalizeSearchText(candidateToken);
  if (!query || !candidate) return 0;
  if (query === candidate) return 100;
  if (candidate.startsWith(query)) return 82;
  if (candidate.includes(query)) return 70;

  const distance = levenshteinDistance(query, candidate);
  const maxLength = Math.max(query.length, candidate.length);
  if (maxLength <= 4 && distance <= 1) return 64;
  if (maxLength <= 8 && distance <= 2) return 54;
  if (distance <= 1) return 48;
  return 0;
}

function scoreIngredientSearchMatch(ingredient, rawQuery = "") {
  const query = normalizeSearchText(rawQuery);
  const queryTokens = tokenizeSearchText(rawQuery);
  if (!query || !queryTokens.length) return 0;

  const parsedNameIndex = parseIngredientIndexBase(ingredient.name, ingredient.packSize);
  const aliasIndexes = (ingredient.aliases || []).map((alias) =>
    parseIngredientIndexBase(alias, ingredient.packSize)
  );
  const indexedTerms = dedupeTextList([
    parsedNameIndex.product,
    parsedNameIndex.cut,
    parsedNameIndex.quality,
    parsedNameIndex.dietary,
    parsedNameIndex.state,
    parsedNameIndex.origin,
    ...aliasIndexes.flatMap((index) => [
      index.product,
      index.cut,
      index.quality,
      index.dietary,
      index.state,
      index.origin,
    ]),
  ]);

  const weightedFields = [
    { value: ingredient.name, weight: 1.5 },
    { value: ingredient.code, weight: 1.45 },
    { value: ingredient.sourceCode, weight: 1.35 },
    { value: ingredient.category, weight: 0.7 },
    { value: ingredient.supplier, weight: 0.6 },
    ...indexedTerms.map((term) => ({ value: term, weight: 1.3 })),
    ...((ingredient.aliases || []).map((alias) => ({ value: alias, weight: 1.2 }))),
  ];

  const normalizedFields = weightedFields.map((field) => ({
    ...field,
    normalizedValue: normalizeSearchText(field.value),
    tokens: tokenizeSearchText(field.value),
  }));

  let score = 0;

  normalizedFields.forEach((field) => {
    if (!field.normalizedValue) return;
    if (field.normalizedValue === query) {
      score = Math.max(score, 220 * field.weight);
      return;
    }
    if (field.normalizedValue.startsWith(query)) {
      score = Math.max(score, 180 * field.weight);
    } else if (field.normalizedValue.includes(query)) {
      score = Math.max(score, 145 * field.weight);
    }
  });

  const tokenScores = queryTokens.map((queryToken) =>
    Math.max(
      0,
      ...normalizedFields.flatMap((field) => field.tokens.map((token) => scoreSearchToken(queryToken, token) * field.weight))
    )
  );

  const strongTokenMatches = tokenScores.filter((tokenScore) => tokenScore >= 50).length;
  const averageTokenScore = tokenScores.length
    ? tokenScores.reduce((sum, tokenScore) => sum + tokenScore, 0) / tokenScores.length
    : 0;

  if (strongTokenMatches === queryTokens.length) {
    score += averageTokenScore + 32;
  } else if (strongTokenMatches > 0) {
    score += averageTokenScore;
  }

  return score;
}

function getSuggestedIngredientsForMissingSharedSourceLine(detail = {}, ingredients = [], limit = 3) {
  const query = String(detail?.label || "").trim();
  if (!query) return [];

  return ingredients
    .map((ingredient) => ({
      ingredient,
      score: scoreIngredientSearchMatch(ingredient, query),
    }))
    .filter((match) => match.score >= 60)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.ingredient.name.localeCompare(right.ingredient.name);
    })
    .slice(0, limit);
}

function scoreBatchSearchMatch(batch, rawQuery = "", ingredientMap = new Map()) {
  const query = normalizeSearchText(rawQuery);
  const queryTokens = tokenizeSearchText(rawQuery);
  if (!query || !queryTokens.length) return 0;

  const weightedFields = [
    { value: batch.name, weight: 1.5 },
    { value: batch.code, weight: 1.45 },
    { value: batch.yieldLabel, weight: 1.1 },
    { value: batch.productType || "", weight: 1.2 },
  ];

  const normalizedFields = weightedFields.map((field) => ({
    ...field,
    normalizedValue: normalizeSearchText(field.value),
    tokens: tokenizeSearchText(field.value),
  }));

  let score = 0;

  normalizedFields.forEach((field) => {
    if (!field.normalizedValue) return;
    if (field.normalizedValue === query) {
      score = Math.max(score, 220 * field.weight);
      return;
    }
    if (field.normalizedValue.startsWith(query)) {
      score = Math.max(score, 180 * field.weight);
    } else if (field.normalizedValue.includes(query)) {
      score = Math.max(score, 145 * field.weight);
    }
  });

  const tokenScores = queryTokens.map((queryToken) =>
    Math.max(
      0,
      ...normalizedFields.flatMap((field) => field.tokens.map((token) => scoreSearchToken(queryToken, token) * field.weight))
    )
  );

  const strongTokenMatches = tokenScores.filter((tokenScore) => tokenScore >= 50).length;
  const averageTokenScore = tokenScores.length
    ? tokenScores.reduce((sum, tokenScore) => sum + tokenScore, 0) / tokenScores.length
    : 0;

  if (strongTokenMatches === queryTokens.length) {
    score += averageTokenScore + 28;
  } else if (strongTokenMatches > 0) {
    score += averageTokenScore;
  }

  return score;
}

function loadStoredLearningRules() {
  if (typeof window === "undefined") return initialLearningRules;

  try {
    const stored = window.localStorage.getItem(LEARNING_RULES_STORAGE_KEY);
    if (!stored) return initialLearningRules;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : initialLearningRules;
  } catch (error) {
    return initialLearningRules;
  }
}

function loadStoredIngredientMasterReviewState() {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(INGREDIENT_MASTER_REVIEW_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function serializeIngredientMasterReviewState(state = {}) {
  return JSON.stringify(state || {});
}

function loadStoredFlagState(storageKey = "") {
  if (typeof window === "undefined" || !String(storageKey || "").trim()) return {};

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function loadStoredIdList(storageKey = "") {
  if (typeof window === "undefined" || !String(storageKey || "").trim()) return [];

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean)));
  } catch (_error) {
    return [];
  }
}

function loadStoredSoft1SourceRows() {
  if (typeof window === "undefined") return defaultSoft1Rows;

  try {
    const stored = window.localStorage.getItem(SOFT1_SOURCE_ROWS_STORAGE_KEY);
    if (!stored) return defaultSoft1Rows;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length ? parsed : defaultSoft1Rows;
  } catch (_error) {
    return defaultSoft1Rows;
  }
}

function loadStoredSoft1SourceMeta() {
  const fallback = {
    label: ingredientMasterSample?.source_workbook || "Bundled sample",
    sheet: ingredientMasterSample?.source_sheet || "",
    rowCount: defaultSoft1Rows.length,
    imported: false,
  };

  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(SOFT1_SOURCE_META_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object"
      ? {
          ...fallback,
          ...parsed,
          rowCount: Number(parsed?.rowCount || fallback.rowCount),
          imported: Boolean(parsed?.imported),
        }
      : fallback;
  } catch (_error) {
    return fallback;
  }
}

function isMissingNamingRulesTableError(message = "") {
  const normalized = String(message || "").toLowerCase();
  return (
    (normalized.includes("ingredient_naming_rules") && normalized.includes("schema cache")) ||
    normalized.includes("relation \"public.ingredient_naming_rules\" does not exist") ||
    normalized.includes("relation \"ingredient_naming_rules\" does not exist")
  );
}

function buildIngredientReviewStateRuleId(sharedRecordId = "") {
  return `ingredient-review-${String(sharedRecordId || "").trim()}`;
}

function buildIngredientSubstitutionStateRuleId(sharedRecordId = "") {
  return `ingredient-substitution-${String(sharedRecordId || "").trim()}`;
}

function buildIngredientTradeCategoryRuleId(sharedRecordId = "") {
  return `ingredient-trade-category-${String(sharedRecordId || "").trim()}`;
}

function buildIngredientSourceCodeRedirectRuleId(sourceCode = "") {
  return `ingredient-source-code-redirect-${normalizeIngredientCodeToken(sourceCode)}`;
}

function buildIgnoredImportRowRuleId(ignoreKey = "") {
  return `ignored-import-row-${String(ignoreKey || "").trim()}`;
}

function buildRecipeReviewFlagRuleId(recipeId = "") {
  return `recipe-review-${String(recipeId || "").trim()}`;
}

function buildBatchReviewFlagRuleId(batchId = "") {
  return `batch-review-${String(batchId || "").trim()}`;
}

function serializeIngredientReviewStateEntry(entry = {}) {
  return JSON.stringify({
    status: String(entry?.status || "review").trim() || "review",
    sharedUpdatedAt: String(entry?.sharedUpdatedAt || "").trim(),
    flagged: Boolean(entry?.flagged),
    forReview: Boolean(entry?.forReview),
    ruleCatchupSignature: String(entry?.ruleCatchupSignature || "").trim(),
    referenceRawName: String(entry?.referenceRawName || "").trim(),
    aliases: dedupeTextList(entry?.aliases || []).filter(Boolean),
  });
}

function serializeIngredientSubstitutionStateEntry(entry = {}) {
  return JSON.stringify({
    flagged: Boolean(entry?.flagged),
  });
}

function serializeIngredientTradeCategoryEntry(entry = {}) {
  return JSON.stringify({
    value: String(entry?.value || "").trim(),
  });
}

function serializeIngredientSourceCodeRedirectEntry(entry = {}) {
  return JSON.stringify({
    targetIngredientId: String(entry?.targetIngredientId || "").trim(),
  });
}

function parseSharedIngredientReviewStateRows(rows = []) {
  return (rows || []).reduce((map, row) => {
    const triggerText = String(row?.trigger_text || row?.trigger || "").trim();
    const rawValue = String(row?.rule_value || row?.value || "").trim();
    if (!triggerText || !rawValue) return map;

    try {
      const parsed = JSON.parse(rawValue);
      map[triggerText] = {
        status: String(parsed?.status || "review").trim() || "review",
        sharedUpdatedAt: String(parsed?.sharedUpdatedAt || "").trim(),
        flagged: Boolean(parsed?.flagged),
        forReview: Boolean(parsed?.forReview),
        ruleCatchupSignature: String(parsed?.ruleCatchupSignature || "").trim(),
        referenceRawName: String(parsed?.referenceRawName || "").trim(),
        aliases: dedupeTextList(parsed?.aliases || []).filter(Boolean),
      };
      return map;
    } catch (error) {
      return map;
    }
  }, {});
}

function parseSharedFlagRows(rows = []) {
  return (rows || []).reduce((map, row) => {
    const triggerText = String(row?.trigger_text || row?.trigger || "").trim();
    const rawValue = String(row?.rule_value || row?.value || "").trim();
    if (!triggerText || !rawValue) return map;

    try {
      const parsed = JSON.parse(rawValue);
      map[triggerText] = {
        flagged: Boolean(parsed?.flagged),
      };
      return map;
    } catch (error) {
      return map;
    }
  }, {});
}

function buildIgnoredImportRowKey(sourceCode = "", rawName = "") {
  const normalizedSourceCode = normalizeIngredientKey(sourceCode);
  const normalizedRawName = normalizeIngredientKey(rawName);
  if (!normalizedSourceCode && !normalizedRawName) return "";
  return `${normalizedSourceCode}::${normalizedRawName}`;
}

function isImportRowIgnored(row = {}, ignoredMap = {}) {
  const ignoreKey = buildIgnoredImportRowKey(row?.sourceCode, row?.rawName);
  return Boolean(ignoreKey && ignoredMap?.[ignoreKey]?.flagged);
}

function isImportRowResolved(row = {}, resolvedMap = {}) {
  const resolveKey = buildIgnoredImportRowKey(row?.sourceCode, row?.rawName);
  return Boolean(resolveKey && resolvedMap?.[resolveKey]?.flagged);
}

function parseSharedIngredientSubstitutionStateRows(rows = []) {
  return (rows || []).reduce((map, row) => {
    const triggerText = String(row?.trigger_text || row?.trigger || "").trim();
    const rawValue = String(row?.rule_value || row?.value || "").trim();
    if (!triggerText || !rawValue) return map;

    try {
      const parsed = JSON.parse(rawValue);
      map[triggerText] = {
        flagged: Boolean(parsed?.flagged),
      };
      return map;
    } catch (error) {
      return map;
    }
  }, {});
}

function parseSharedIngredientTradeCategoryRows(rows = []) {
  return (rows || []).reduce((map, row) => {
    const triggerText = String(row?.trigger_text || row?.trigger || "").trim();
    const rawValue = String(row?.rule_value || row?.value || "").trim();
    if (!triggerText || !rawValue) return map;

    try {
      const parsed = JSON.parse(rawValue);
      map[triggerText] = {
        value: String(parsed?.value || "").trim(),
      };
      return map;
    } catch (error) {
      return map;
    }
  }, {});
}

function parseSharedIngredientSourceCodeRedirectRows(rows = []) {
  return (rows || []).reduce((map, row) => {
    const triggerText = normalizeIngredientCodeToken(row?.trigger_text || row?.trigger || "");
    const rawValue = String(row?.rule_value || row?.value || "").trim();
    if (!triggerText || !rawValue) return map;

    try {
      const parsed = JSON.parse(rawValue);
      const targetIngredientId = String(parsed?.targetIngredientId || "").trim();
      if (!targetIngredientId) return map;
      map[triggerText] = {
        targetIngredientId,
      };
      return map;
    } catch (error) {
      return map;
    }
  }, {});
}

function createLearningRuleId(field = "", trigger = "") {
  const normalizedField = normalizeIngredientKey(field).replace(/\s+/g, "-");
  const normalizedTrigger = normalizeIngredientKey(trigger).replace(/\s+/g, "-");
  return `rule-${normalizedField}-${normalizedTrigger}`;
}

function normalizeLearningRule(rule, fallbackIndex = 0) {
  const field = String(rule?.field || rule?.rule_field || "").trim();
  const trigger = String(rule?.trigger || rule?.trigger_text || "").trim();
  const value = String(rule?.value || rule?.rule_value || "").trim();
  if (!field || !trigger || !value) return null;

  const fieldLabel = ingredientIndexFields.find((item) => item.key === field)?.label || titleCaseWords(field);

  return {
    id: String(rule?.id || createLearningRuleId(field, trigger) || `rule-${fallbackIndex + 1}`),
    field,
    label: String(rule?.label || rule?.rule_label || fieldLabel).trim(),
    trigger,
    value,
  };
}

function mergeLearningRules(...ruleSets) {
  const merged = new Map();

  ruleSets.flat().forEach((rule, index) => {
    const normalized = normalizeLearningRule(rule, index);
    if (!normalized) return;
    merged.set(normalized.id, normalized);
  });

  return Array.from(merged.values()).sort((left, right) =>
    `${left.field}-${left.trigger}`.localeCompare(`${right.field}-${right.trigger}`)
  );
}

function serializeLearningRules(rules = []) {
  return JSON.stringify(
    mergeLearningRules(rules).map((rule) => ({
      id: rule.id,
      field: rule.field,
      label: rule.label,
      trigger: rule.trigger,
      value: rule.value,
    }))
  );
}

function dedupeTextList(values) {
  const seen = new Set();

  return values.filter((value) => {
    const key = normalizeIngredientKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePackSizeComponents(packSize = "") {
  const text = String(packSize || "").trim().toLowerCase();
  if (!text) return null;

  const measureMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|l|lt)\b/i);
  const countMatch = text.match(/(?:\(|\b)(\d+(?:[.,]\d+)?)\s*(pc|pcs|piece|pieces)\b\)?/i);

  const count = countMatch ? Number(String(countMatch[1] || "0").replace(",", ".")) : 0;
  const normalizedCount = Number.isFinite(count) && count > 0 ? count : 0;

  if (measureMatch) {
    const amount = Number(String(measureMatch[1] || "0").replace(",", "."));
    const rawUnit = String(measureMatch[2] || "").toLowerCase();
    if (!(amount > 0)) return null;

    if (rawUnit === "kg") {
      return {
        amount,
        unit: "kg",
        count: normalizedCount,
        totalAmount: normalizedCount > 0 ? amount * normalizedCount : amount,
        totalUnit: "kg",
      };
    }

    if (rawUnit === "g" || rawUnit === "gr") {
      const amountKg = amount / 1000;
      return {
        amount,
        unit: "g",
        count: normalizedCount,
        totalAmount: normalizedCount > 0 ? amountKg * normalizedCount : amountKg,
        totalUnit: "kg",
      };
    }

    if (rawUnit === "l" || rawUnit === "lt") {
      return {
        amount,
        unit: "l",
        count: normalizedCount,
        totalAmount: normalizedCount > 0 ? amount * normalizedCount : amount,
        totalUnit: "l",
      };
    }

    if (rawUnit === "ml") {
      const amountL = amount / 1000;
      return {
        amount,
        unit: "ml",
        count: normalizedCount,
        totalAmount: normalizedCount > 0 ? amountL * normalizedCount : amountL,
        totalUnit: "l",
      };
    }
  }

  if (normalizedCount > 0) {
    return {
      amount: normalizedCount,
      unit: "piece",
      count: normalizedCount,
      totalAmount: normalizedCount,
      totalUnit: "piece",
    };
  }

  return null;
}

function extractPackSize(rawName = "", unit = "") {
  const text = String(rawName || "").trim();
  const parsedPack = parsePackSizeComponents(text);
  if (parsedPack?.amount > 0) {
    const baseLabel =
      parsedPack.unit === "g" || parsedPack.unit === "ml"
        ? `${Number(parsedPack.amount.toFixed(3)).toString().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")}${parsedPack.unit}`
        : `${Number(parsedPack.amount.toFixed(3)).toString().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")}${parsedPack.unit}`;
    if (parsedPack.count > 0 && parsedPack.totalUnit !== "piece") {
      return `${baseLabel} (${parsedPack.count}pcs)`;
    }
    return baseLabel;
  }

  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (normalizedUnit === "kg") return "1kg";
  if (normalizedUnit === "l") return "1l";
  if (normalizedUnit === "pc") return "1pc";
  return normalizedUnit || "";
}

function isWholeEggImportRow(rawName = "", sourceCode = "") {
  if (getSoft1CodeFamily(sourceCode) !== "EGG") return false;
  const text = normalizeIngredientParserText(rawName);
  return /\beggs?\b/.test(text) && !/\begg white\b|\begg yolk\b|\byolk\b|\bwhite\b/.test(text);
}

function extractWholeEggPackSize(rawName = "", sourceCode = "") {
  if (!isWholeEggImportRow(rawName, sourceCode)) return "";
  const text = normalizeIngredientParserText(rawName);
  const packMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*pack\b/);
  if (!packMatch) return "";
  const count = Number(String(packMatch[1] || "0").replace(",", "."));
  if (!(count > 0)) return "";
  return `${Number.isInteger(count) ? count : Number(count.toFixed(3))}pc`;
}

function isPieceLikeUnit(unit = "") {
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  return ["pc", "pcs", "piece", "pieces"].includes(normalizedUnit);
}

function requiresImportPackSizeReview(rawName = "", unit = "", packSize = "", sourceCode = "") {
  const normalizedPackSize = String(packSize || "").trim();
  if (!isPieceLikeUnit(unit)) return false;
  if (!normalizedPackSize) return true;
  const parsedFromPackSize = parsePackSizeComponents(normalizedPackSize);
  if (
    isWholeEggImportRow(rawName, sourceCode) &&
    parsedFromPackSize?.totalUnit === "piece" &&
    parsedFromPackSize.totalAmount > 1
  ) {
    return false;
  }
  const parsedFromRawName = parsePackSizeComponents(rawName);
  if (!parsedFromRawName) return true;
  if (parsedFromRawName.totalUnit === "piece") return true;
  return normalizeIngredientKey(normalizedPackSize) === "1pc";
}

function isLikelyMultipackSnackImport(rawName = "", unit = "", averagePrice = 0, sourceCode = "") {
  if (!isPieceLikeUnit(unit)) return false;
  const family = getSoft1CodeFamily(sourceCode);
  if (!["CER", "ASPR"].includes(family)) return false;
  const text = normalizeIngredientParserText(rawName);
  const suspiciousSnackCue =
    /\bprotein ball\b|\bprotein balls\b|\bbars?\b|\bballs?\b|\bbiscuits?\b|\bchips?\b|\bcrisps?\b|\bpuffs?\b/.test(text);
  return suspiciousSnackCue && Number(averagePrice || 0) >= 6;
}

function titleCaseCategory(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => titleCaseWords(part))
    .join(" ");
}

function formatImportRecordLabel(sourceWorkbook = "", sourceSheet = "") {
  const parts = [sourceWorkbook, sourceSheet].map((value) => String(value || "").trim()).filter(Boolean);
  return parts.join(" / ");
}

function getTodayImportDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIngredientUploadHeader(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0370-\u03ff]+/g, "");
}

function parseSoft1IngredientUploadMatrix(rows = [], { sourceWorkbook = "", sourceSheet = "", rowIdPrefix = "raw-import" } = {}) {
  if (!rows.length) {
    throw new Error("The Soft1 ingredient upload file is empty.");
  }

  const headerRowIndex = rows.findIndex((row) => {
    const normalizedHeaders = row.map((header) => normalizeIngredientUploadHeader(header));

    const hasSoft1CostHeaders =
      normalizedHeaders.includes("ingrsoft1code") &&
      normalizedHeaders.includes("description") &&
      normalizedHeaders.includes("averageprice");
    const hasNormalizedImportHeaders =
      normalizedHeaders.includes("ingredientname") &&
      normalizedHeaders.includes("ingredientitemcode") &&
      normalizedHeaders.includes("unitcost");
    const hasRawPricingHeaders =
      normalizedHeaders.includes("ingredientname") &&
      normalizedHeaders.includes("plucode") &&
      normalizedHeaders.includes("description") &&
      normalizedHeaders.includes("costperkilo");

    return hasSoft1CostHeaders || hasNormalizedImportHeaders || hasRawPricingHeaders;
  });

  if (headerRowIndex === -1) {
    throw new Error(
      "Could not find a supported Soft1 ingredient header row. Use the Soft1 Ingredients Cost export, the reviewed ingredient CSV, or the raw pricing export."
    );
  }

  const headers = rows[headerRowIndex].map((header) => String(header || "").trim());
  const normalizedHeaders = headers.map((header) => normalizeIngredientUploadHeader(header));
  const headerIndex = new Map(normalizedHeaders.map((header, index) => [header, index]));
  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => String(value || "").trim()));
  const read = (row, aliases) => {
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    const matchIndex = aliasList
      .map((alias) => headerIndex.get(normalizeIngredientUploadHeader(alias)))
      .find((index) => index !== undefined);
    return matchIndex === undefined ? "" : String(row[matchIndex] || "").trim();
  };

  const isSoft1CostSheet =
    headerIndex.has("ingrsoft1code") &&
    headerIndex.has("description") &&
    headerIndex.has("averageprice");
  const isNormalizedImport =
    headerIndex.has("ingredientname") &&
    headerIndex.has("ingredientitemcode") &&
    headerIndex.has("unitcost");
  const isRawPricingSheet =
    headerIndex.has("ingredientname") &&
    headerIndex.has("plucode") &&
    headerIndex.has("description") &&
    headerIndex.has("costperkilo");

  const parsedRows = dataRows
    .map((row, index) => {
      if (isSoft1CostSheet) {
        const sourceUnit = read(row, ["Unit", "pack_size"]);
        const rawName = read(row, ["Description", "Ingredient name", "ingredient_name"]);
        const sourceCode = read(row, ["Ingr. Soft1 Code", "ingredient_item_code"]);
        const packSize = extractWholeEggPackSize(rawName, sourceCode) || extractPackSize(rawName, sourceUnit);
        const nameIndex = parseIngredientIndex(rawName, packSize, [], sourceCode);
        return {
          id: `${rowIdPrefix}-${index + 1}`,
          sourceCode,
          rawName,
          averagePrice: numberValue(read(row, ["Average Price", "unit_cost"]), 0),
          packSize,
          sourceUnit,
          category: deriveImportCategoryFields({
            productCategory: read(row, ["Product Category", "product_category"]),
            tradeCategory: read(row, ["Εμπορ. κατηγορία", "Trade Category", "trade_category"]),
            sourceCode: read(row, ["Ingr. Soft1 Code", "ingredient_item_code"]),
            rawName,
            nameIndex,
          }).category,
          productCategory: deriveImportCategoryFields({
            productCategory: read(row, ["Product Category", "product_category"]),
            tradeCategory: read(row, ["Εμπορ. κατηγορία", "Trade Category", "trade_category"]),
            sourceCode: read(row, ["Ingr. Soft1 Code", "ingredient_item_code"]),
            rawName,
            nameIndex,
          }).productCategory,
          tradeCategory: deriveImportCategoryFields({
            productCategory: read(row, ["Product Category", "product_category"]),
            tradeCategory: read(row, ["Εμπορ. κατηγορία", "Trade Category", "trade_category"]),
            sourceCode: read(row, ["Ingr. Soft1 Code", "ingredient_item_code"]),
            rawName,
            nameIndex,
          }).tradeCategory,
          supplier: read(row, ["Supplier", "supplier"]),
          sourceRecordLabel: formatImportRecordLabel(sourceWorkbook, sourceSheet),
          importedAt: getTodayImportDate(),
        };
      }

      if (isNormalizedImport) {
        const sourceCode = read(row, ["ingredient_item_code", "Ingr. Soft1 Code"]);
        const sourceUnit = read(row, ["pack_size", "Unit"]);
        const rawName = read(row, ["ingredient_name", "Ingredient name"]);
        const nameIndex = parseIngredientIndex(rawName, extractWholeEggPackSize(rawName, sourceCode) || String(sourceUnit || "").trim(), [], sourceCode);
        const categoryFields = deriveImportCategoryFields({
          productCategory: read(row, ["category", "Product Category", "product_category"]),
          tradeCategory: read(row, ["trade_category", "Trade Category"]),
          sourceCode,
          rawName,
          nameIndex,
        });
        return {
          id: `${rowIdPrefix}-${index + 1}`,
          sourceCode,
          rawName,
          averagePrice: numberValue(read(row, ["unit_cost", "Average Price"]), 0),
          packSize: extractWholeEggPackSize(rawName, sourceCode) || String(sourceUnit || "").trim(),
          sourceUnit,
          category: categoryFields.category,
          productCategory: categoryFields.productCategory,
          tradeCategory: categoryFields.tradeCategory,
          supplier: read(row, ["supplier", "Supplier"]),
          sourceRecordLabel: formatImportRecordLabel(sourceWorkbook, sourceSheet),
          importedAt: String(read(row, ["last_updated", "Last Updated"]) || getTodayImportDate()).trim(),
        };
      }

      if (isRawPricingSheet) {
        const sourceCode = read(row, ["PLU Code", "ingredient_item_code"]);
        const description = read(row, ["Description", "Ingredient name"]);
        const sourceUnit = read(row, ["Grams. / Mililitre", "pack_size"]);
        const rawName = read(row, ["Ingredient name", "ingredient_name"]) || description;
        const packSize = extractWholeEggPackSize(rawName, sourceCode) || String(sourceUnit || extractPackSize(description, "")).trim();
        const nameIndex = parseIngredientIndex(rawName, packSize, [], sourceCode);
        const categoryFields = deriveImportCategoryFields({
          tradeCategory: read(row, ["Description"]),
          sourceCode,
          rawName,
          nameIndex,
        });
        return {
          id: `${rowIdPrefix}-${index + 1}`,
          sourceCode,
          rawName,
          averagePrice: numberValue(read(row, ["Cost per kilo", "unit_cost"]), 0),
          packSize,
          sourceUnit,
          category: categoryFields.category,
          productCategory: categoryFields.productCategory,
          tradeCategory: categoryFields.tradeCategory,
          supplier: "",
          sourceRecordLabel: formatImportRecordLabel(sourceWorkbook, sourceSheet),
          importedAt: getTodayImportDate(),
        };
      }

      return null;
    })
    .filter((row) => row && (String(row.rawName || "").trim() || String(row.sourceCode || "").trim()));

  if (!parsedRows.length) {
    throw new Error("No ingredient rows were found in the uploaded slice.");
  }

  return parsedRows;
}

function createSoft1RowsFromSample(sample) {
  return (sample?.rows || []).map((row, index) => {
    const rawName = row.description;
    const packSize = extractWholeEggPackSize(rawName, row.source_code) || extractPackSize(row.description, row.unit);
    const nameIndex = parseIngredientIndex(rawName, packSize, [], row.source_code);
    const categoryFields = deriveImportCategoryFields({
      tradeCategory: row.trade_category,
      productCategory: row.product_category,
      sourceCode: row.source_code,
      rawName,
      nameIndex,
    });

    return {
      id: `raw-${index + 1}`,
      sourceCode: row.source_code,
      rawName,
      averagePrice: numberValue(row.average_price, 0),
      packSize,
      sourceUnit: String(row.unit || "").trim(),
      category: categoryFields.category,
      productCategory: categoryFields.productCategory,
      tradeCategory: categoryFields.tradeCategory,
      supplier: String(row.supplier || "").trim(),
      sourceRecordLabel: formatImportRecordLabel(sample?.source_workbook, sample?.source_sheet),
      importedAt: getTodayImportDate(),
    };
  });
}

const defaultSoft1Rows = createSoft1RowsFromSample(ingredientMasterSample);

function normalizeIngredientCodeToken(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function getEffectiveIngredientSourceCode(ingredient = {}) {
  const directSourceCode = String(ingredient?.sourceCode || "").trim();
  if (directSourceCode) return directSourceCode;

  const legacySourceCode = String(ingredient?.code || "").trim();
  return isLikelySoft1IngredientCode(legacySourceCode) ? legacySourceCode : "";
}

function compactIngredientKey(value = "") {
  return normalizeIngredientKey(value).replace(/\s+/g, "");
}

function boundedLevenshteinDistance(left = "", right = "", maxDistance = 2) {
  const source = String(left || "");
  const target = String(right || "");
  if (!source || !target) return Number.POSITIVE_INFINITY;
  if (source === target) return 0;
  if (Math.abs(source.length - target.length) > maxDistance) return Number.POSITIVE_INFINITY;

  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let rowIndex = 1; rowIndex <= source.length; rowIndex += 1) {
    const current = [rowIndex];
    let rowMin = current[0];

    for (let columnIndex = 1; columnIndex <= target.length; columnIndex += 1) {
      const substitutionCost = source[rowIndex - 1] === target[columnIndex - 1] ? 0 : 1;
      const nextValue = Math.min(
        previous[columnIndex] + 1,
        current[columnIndex - 1] + 1,
        previous[columnIndex - 1] + substitutionCost
      );
      current[columnIndex] = nextValue;
      if (nextValue < rowMin) rowMin = nextValue;
    }

    if (rowMin > maxDistance) return Number.POSITIVE_INFINITY;
    for (let columnIndex = 0; columnIndex < current.length; columnIndex += 1) {
      previous[columnIndex] = current[columnIndex];
    }
  }

  return previous[target.length];
}

function scoreFuzzyIngredientNameMatch(left = "", right = "") {
  const source = compactIngredientKey(left);
  const target = compactIngredientKey(right);
  if (!source || !target || source === target) return 0;

  const shortestLength = Math.min(source.length, target.length);
  if (shortestLength < 6) return 0;

  const maxDistance = shortestLength >= 10 ? 2 : 1;
  const distance = boundedLevenshteinDistance(source, target, maxDistance);
  if (!Number.isFinite(distance)) return 0;
  if (distance === 0) return 0;
  if (distance === 1) return 54;
  if (distance === 2 && shortestLength >= 10) return 36;
  return 0;
}

function getIngredientCodeStem(name = "", packSize = "") {
  const parsed = parseIngredientIndexBase(name, packSize);
  const preferred =
    parsed.product ||
    parsed.category ||
    parsed.cut ||
    parsed.brand ||
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join("");

  const stem = normalizeIngredientCodeToken(preferred).slice(0, 6);
  return stem || "ITEM";
}

function generateIngredientCodeFromDraft(draft = {}, ingredients = [], currentIngredientId = "") {
  const stem = getIngredientCodeStem(draft.name, draft.packSize);
  const familyPrefix = `INT.${stem}.`;
  const familyCodes = ingredients
    .filter((ingredient) => ingredient.id !== currentIngredientId)
    .map((ingredient) => String(ingredient.code || "").trim().toUpperCase())
    .filter((code) => code.startsWith(familyPrefix));

  const usedIndexes = new Set(
    familyCodes
      .map((code) => {
        const match = code.match(/^INT\.[A-Z0-9]{1,6}\.(\d{3})$/);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value))
  );

  let index = 1;
  while (usedIndexes.has(index)) {
    index += 1;
  }

  return `INT.${stem}.${String(index).padStart(3, "0")}`;
}

function getIngredientCodeConflict(ingredients = [], code = "", currentIngredientId = "") {
  const normalizedCode = normalizeIngredientCodeToken(code);
  if (!normalizedCode) return null;
  const currentIngredient =
    (ingredients || []).find((ingredient) => ingredient.id === currentIngredientId) || null;
  const currentSharedRecordId = String(currentIngredient?.sharedRecordId || "").trim();
  return (
    ingredients.find(
      (ingredient) => {
        if (ingredient.archived) return false;
        if (ingredient.id === currentIngredientId) return false;
        if (
          currentSharedRecordId &&
          String(ingredient.sharedRecordId || "").trim() &&
          String(ingredient.sharedRecordId || "").trim() === currentSharedRecordId
        ) {
          return false;
        }
        return normalizeIngredientCodeToken(ingredient.code) === normalizedCode;
      }
    ) || null
  );
}

function getIngredientSourceCodeConflict(ingredients = [], sourceCode = "", currentIngredientId = "") {
  const normalizedCode = normalizeIngredientCodeToken(sourceCode);
  if (!normalizedCode) return null;
  return (
    ingredients.find(
      (ingredient) => {
        if (ingredient.id === currentIngredientId) return false;
        const ingredientSourceCode = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(ingredient));
        return Boolean(ingredientSourceCode && ingredientSourceCode === normalizedCode);
      }
    ) || null
  );
}

function isIngredientSourceCodeUniqueConstraintError(message = "") {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("ingredients_code_unique");
}

function isIngredientInternalCodeUniqueConstraintError(message = "") {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("ingredients_internal_code_unique");
}

function buildIngredientCodeConflictMessage(code = "", conflict = null) {
  const safeCode = String(code || "").trim() || "this code";
  if (!conflict) {
    return `Ingredient code ${safeCode} is already in use. Choose another code before saving.`;
  }

  return `Ingredient code ${safeCode} is already used by "${conflict.name}" (${conflict.code}). Choose another code before saving.`;
}

function buildIngredientSourceCodeConflictMessage(sourceCode = "", conflict = null) {
  const safeCode = String(sourceCode || "").trim() || "this Soft1 code";
  if (!conflict) {
    return `Soft1 code ${safeCode} is already in use. Merge into the existing ingredient instead of creating another one.`;
  }

  const conflictFlags = [
    conflict.archived ? "archived" : "",
    conflict.batchId ? "published from component" : "",
  ].filter(Boolean);

  return `Soft1 code ${safeCode} is already used by "${conflict.name}" (${conflict.sourceCode || conflict.code})${conflictFlags.length ? `, ${conflictFlags.join(", ")}` : ""}. Merge into that existing ingredient instead of creating another one.`;
}

function isIngredientCodeLocked(record = {}) {
  return Boolean(record.sourceCode && getIngredientSourceType(record) === "soft1");
}

function normalizeIngredientParserText(rawName = "") {
  return String(rawName || "")
    .trim()
    .toLowerCase()
    .replace(/\blamp\b/g, "lamb")
    .replace(/\bfroz(?:en)?\.\b/g, "frozen")
    .replace(/\bfrozon\b/g, "frozen")
    .replace(/\barugula\b/g, "rocket")
    .replace(/\beggplant\b/g, "aubergine")
    .replace(/\bzucchini\b/g, "courgette")
    .replace(/\bcilantro\b/g, "coriander")
    .replace(/\bscallions?\b/g, "spring onion")
    .replace(/\bbeets?\b/g, "beetroot")
    .replace(/\bpickles ginger\b/g, "pickled ginger")
    .replace(/\bcarry paste\b/g, "curry paste");
}

function isSeafoodSoft1Family(family = "") {
  return ["SEA", "WHSEA", "FIFI"].includes(String(family || "").trim().toUpperCase());
}

function isFruitSoft1Family(family = "") {
  return ["FRU", "FRFRU"].includes(String(family || "").trim().toUpperCase());
}

function getSoft1CodeFamilyCategoryRules() {
  return [
    { family: "FRFRU", category: "Fresh fruit" },
    { family: "FRU", category: "Fruit" },
    { family: "FRVEG", category: "Fresh produce" },
    { family: "SEA", category: "Seafood" },
    { family: "WHSEA", category: "Whole seafood" },
    { family: "FIFI", category: "Fish fillets" },
    { family: "BEEF", category: "Beef" },
    { family: "CHI", category: "Chicken" },
    { family: "LAM", category: "Lamb" },
    { family: "PORK", category: "Pork" },
    { family: "CHE", category: "Dairy" },
    { family: "YOG", category: "Dairy" },
    { family: "EGG", category: "Eggs" },
    { family: "OIL", category: "Oil" },
    { family: "VIN", category: "Vinegar" },
    { family: "BRE", category: "Bread / bakery" },
    { family: "PAS", category: "Pastries / pies" },
    { family: "PAST", category: "Pasta" },
    { family: "FLO", category: "Flour / baking" },
    { family: "NUT", category: "Nuts / seeds" },
    { family: "DRFO", category: "Dried foods" },
    { family: "SPIC", category: "Spices / seasoning" },
    { family: "LEG", category: "Pulses" },
    { family: "BUT", category: "Dairy" },
    { family: "MILK", category: "Dairy" },
    { family: "HECR", category: "Dairy" },
    { family: "ASPR", category: "International pantry" },
    { family: "REMA", category: "Ready-made products" },
    { family: "VARPA", category: "Pastry products" },
    { family: "SUG", category: "Sugar" },
    { family: "JAM", category: "Jams" },
    { family: "HON", category: "Honey" },
    { family: "SYR", category: "Syrups" },
    { family: "PIC", category: "Pickles" },
    { family: "LEM", category: "Lemon juice" },
    { family: "OLI", category: "Oils / olives" },
    { family: "MAMU", category: "Condiments" },
    { family: "SAU", category: "Sauces" },
    { family: "WHIW", category: "White wine" },
    { family: "REDW", category: "Red wine" },
    { family: "COCU", category: "Cured meats" },
    { family: "GLFRE", category: "Gluten free products" },
    { family: "CER", category: "Cereals" },
    { family: "BIS", category: "Biscuits" },
    { family: "RUB", category: "Rusks / breadsticks" },
    { family: "CAN", category: "Canned goods" },
    { family: "RIC", category: "Rice" },
    { family: "ICEC", category: "Ice creams" },
    { family: "CHO", category: "Chocolate products" },
    { family: "PRA", category: "Chocolate spreads" },
    { family: "SCEN", category: "Pastry flavourings" },
    { family: "PREP", category: "Prepped by supplier" },
  ];
}

function getSoft1CodeFamily(code = "") {
  const text = String(code || "").trim().toUpperCase();
  if (!text) return "";
  const match = text.match(/^\d{3}\.([A-Z]+)/);
  return match?.[1] || "";
}

function getSoft1CodeCategorySuggestion(code = "", nameIndex = null, rawName = "") {
  const family = getSoft1CodeFamily(code);
  if (!family) return "";
  if (family === "ASPR") {
    const productKey = normalizeIngredientKey(nameIndex?.product || "");
    const rawKey = normalizeIngredientKey(rawName);
    if (
      [
        "soy sauce",
        "oyster sauce",
        "ponzu",
        "yuzu juice",
        "chilli paste",
        "curry paste",
        "nori",
        "wakame",
        "seaweed",
      ].includes(productKey)
    ) {
      return "Asian pantry";
    }
    if (
      [
        "tortilla chips",
        "crackers",
        "spring rolls",
        "jalapenos",
        "snacks",
        "breadcrumbs",
      ].includes(productKey) ||
      /\bcrisps?\b|\bchips?\b|\bpuffs?\b|\bbiscuits?\b/.test(rawKey)
    ) {
      return "Snacks";
    }
    return "International pantry";
  }
  if (family === "NUT") {
    const productKey = normalizeIngredientKey(nameIndex?.product || "");
    const rawKey = normalizeIngredientKey(rawName);
    if (
      [
        "almond",
        "cashews",
        "pistachio",
        "hazelnut",
        "walnut",
        "sesame",
        "sunflower seeds",
        "poppy seeds",
        "chia",
        "fennel seeds",
        "nutmeg",
      ].includes(productKey)
    ) {
      return "Nuts / seeds";
    }
    if (
      ["crisps", "chips", "biscuits", "snacks"].includes(productKey) ||
      /\bpringles\b|\bcrisps?\b|\bchips?\b|\bbiscuits?\b|\bpoppers?\b/.test(rawKey)
    ) {
      return "Snacks";
    }
    return "Nuts / seeds";
  }
  if (family === "RIC") {
    const productKey = normalizeIngredientKey(nameIndex?.product || "");
    const rawKey = normalizeIngredientKey(rawName);
    if (["bulgur", "couscous"].includes(productKey) || /\bbulgur\b|\bcouscous\b/.test(rawKey)) {
      return "Grains";
    }
    return "Rice";
  }
  if (family === "OLI") {
    const productKey = normalizeIngredientKey(nameIndex?.product || "");
    if (productKey === "olives") {
      return "Olives";
    }
    return "Oil";
  }
  if (family === "BRE") {
    const productKey = normalizeIngredientKey(nameIndex?.product || "");
    if (productKey === "pasta") {
      return "Pasta";
    }
  }
  return getSoft1CodeFamilyCategoryRules().find((rule) => rule.family === family)?.category || "";
}

function isWeakIngredientCategory(value = "") {
  const normalized = normalizeIngredientKey(value);
  return !normalized || ["perishable foods", "no category", "uncategorised", "uncategorized"].includes(normalized);
}

function isLegacyCategoryCatchupTarget(currentCategory = "", suggestedCategory = "", sourceCode = "") {
  const currentKey = normalizeIngredientKey(currentCategory);
  const suggestedKey = normalizeIngredientKey(suggestedCategory);
  const family = getSoft1CodeFamily(sourceCode);
  if (!currentKey || !suggestedKey || currentKey === suggestedKey) return false;

  if (family === "ASPR") {
    return ["asian products", "international pantry", "snacks"].includes(currentKey);
  }
  if (family === "NUT") {
    return ["nuts / seeds", "snacks"].includes(currentKey);
  }
  if (family === "RIC") {
    return ["rice", "grains"].includes(currentKey);
  }
  if (family === "OLI") {
    return ["oil", "olives", "oils / olives"].includes(currentKey);
  }
  if (family === "MAMU") {
    return ["mayonnaise", "condiments"].includes(currentKey);
  }

  return false;
}

function getStateAwareCategoryKind(value = "") {
  const normalized = normalizeIngredientKey(value);
  if (!normalized) return "";
  if (normalized.includes("frozen") && normalized.includes("fruit")) {
    return "frozen fruit";
  }
  if (normalized.includes("fresh") && normalized.includes("fruit")) {
    return "fresh fruit";
  }
  if (
    normalized.includes("frozen") &&
    (normalized.includes("fruits vegetables") ||
      normalized.includes("fruits-vegetables") ||
      normalized.includes("vegetables"))
  ) {
    return "frozen produce";
  }
  if (normalized.includes("fresh") && (normalized.includes("fruits") || normalized.includes("vegetables") || normalized.includes("produce"))) {
    return "fresh produce";
  }
  if (normalized.includes("frozen") && (normalized.includes("fish sea foods") || normalized.includes("seafood"))) {
    return "frozen seafood";
  }
  if (normalized.includes("fresh") && normalized.includes("seafood")) {
    return "fresh seafood";
  }
  if (normalized.includes("frozen") && normalized.includes("meat")) {
    return "frozen meats";
  }
  if (normalized.includes("fresh") && normalized.includes("meat")) {
    return "fresh meats";
  }
  return "";
}

function deriveImportCategoryFields({
  category = "",
  tradeCategory = "",
  productCategory = "",
  sourceCode = "",
  rawName = "",
  parsedState = "",
  nameIndex = null,
} = {}) {
  const normalizedCategory = titleCaseCategory(category);
  const normalizedTradeCategory = String(tradeCategory || "").trim();
  const normalizedProductCategory = titleCaseCategory(productCategory);
  const codeSuggestion = getSoft1CodeCategorySuggestion(sourceCode, nameIndex, rawName);
  const family = getSoft1CodeFamily(sourceCode);
  const normalizedRawName = normalizeIngredientParserText(rawName);
  const rawExplicitState =
    String(parsedState || "").trim().toLowerCase() ||
    (/\bfresh\b/.test(normalizedRawName) ? "fresh" : /\bfrozen\b/.test(normalizedRawName) ? "frozen" : "");
  const isMeatFamily = ["BEEF", "CHI", "LAM", "PORK"].includes(family);
  const isSeafoodFamily = isSeafoodSoft1Family(family);
  const isVegFamily = family === "VEG";
  const isFruitFamily = isFruitSoft1Family(family);
  const categoryKindCandidates = [
    getStateAwareCategoryKind(normalizedProductCategory),
    getStateAwareCategoryKind(normalizedCategory),
    getStateAwareCategoryKind(normalizedTradeCategory),
  ].filter(Boolean);
  const assumedFreshSeafood =
    isSeafoodFamily &&
    !rawExplicitState &&
    categoryKindCandidates.includes("frozen seafood");
  const assumedFrozenProduce =
    isVegFamily &&
    !rawExplicitState &&
    categoryKindCandidates.includes("frozen produce");
  const assumedFrozenFruit =
    family === "FRU" &&
    !rawExplicitState &&
    (categoryKindCandidates.includes("frozen fruit") || categoryKindCandidates.includes("frozen produce"));
  const explicitState = assumedFreshSeafood
    ? "fresh"
    : assumedFrozenProduce || assumedFrozenFruit
      ? "frozen"
      : rawExplicitState;
  const desiredStateCategory =
    isMeatFamily && explicitState
      ? titleCaseCategory(`${explicitState} meats`)
      : isSeafoodFamily && explicitState
        ? titleCaseCategory(`${explicitState} seafood`)
        : isVegFamily && explicitState
          ? titleCaseCategory(`${explicitState} produce`)
          : isFruitFamily && explicitState
            ? titleCaseCategory(`${explicitState} fruit`)
        : "";
  const categoryStateConflict = Boolean(
    desiredStateCategory &&
      ((normalizedCategory &&
        normalizeIngredientKey(normalizedCategory) !== normalizeIngredientKey(desiredStateCategory) &&
        ["fresh meats", "frozen meats", "fresh seafood", "frozen seafood", "fresh produce", "frozen produce", "fresh fruit", "frozen fruit"].includes(getStateAwareCategoryKind(normalizedCategory))) ||
        (normalizedProductCategory &&
          normalizeIngredientKey(normalizedProductCategory) !== normalizeIngredientKey(desiredStateCategory) &&
          ["fresh meats", "frozen meats", "fresh seafood", "frozen seafood", "fresh produce", "frozen produce", "fresh fruit", "frozen fruit"].includes(getStateAwareCategoryKind(normalizedProductCategory))) ||
        (normalizedTradeCategory &&
          normalizeIngredientKey(normalizedTradeCategory) !== normalizeIngredientKey(desiredStateCategory) &&
          ["fresh meats", "frozen meats", "fresh seafood", "frozen seafood", "fresh produce", "frozen produce", "fresh fruit", "frozen fruit"].includes(getStateAwareCategoryKind(normalizedTradeCategory))))
  );
  const nextProductCategory = desiredStateCategory
    ? desiredStateCategory
    : normalizedProductCategory || (!isWeakIngredientCategory(normalizedCategory) ? normalizedCategory : codeSuggestion);
  const nextCategory = desiredStateCategory
    ? desiredStateCategory
    : normalizedCategory;
  const preferredProductCategory =
    nextProductCategory;
  const effectiveCategory =
    preferredProductCategory ||
    nextCategory ||
    titleCaseCategory(normalizedTradeCategory) ||
    codeSuggestion;

  return {
    productCategory: preferredProductCategory,
    tradeCategory: normalizedTradeCategory,
    category: effectiveCategory,
    codeSuggestion,
    categoryStateConflict,
    explicitState: titleCaseWords(explicitState),
    assumedFreshSeafood,
    assumedFrozenProduce,
    assumedFrozenFruit,
  };
}

function buildIngredientCategoryOptions(...valueGroups) {
  const seen = new Set();

  return valueGroups
    .flat()
    .map((value) => titleCaseCategory(value))
    .filter((value) => {
      const normalized = normalizeIngredientKey(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

function getSharedSoft1Code(row = {}) {
  const rawIngredientCode = String(row?.ingredient_item_code || "").trim();
  const isPublishedComponent = String(row?.entry_type || "").trim() === "batch";
  return !isPublishedComponent && isLikelySoft1IngredientCode(rawIngredientCode)
    ? rawIngredientCode
    : "";
}

function getSharedInternalIngredientCode(row = {}) {
  const explicitInternalCode = String(row?.internal_code || "").trim();
  if (explicitInternalCode) return explicitInternalCode;

  const rawIngredientCode = String(row?.ingredient_item_code || "").trim();
  const soft1Code = getSharedSoft1Code(row);
  if (rawIngredientCode && rawIngredientCode !== soft1Code) {
    return rawIngredientCode;
  }

  return "";
}

function parseIngredientIndexBase(rawName, packSize = "") {
  const text = normalizeIngredientParserText(rawName);
  const knownBrands = knownBrandPhrases;
  const countryMap = originTriggerMap;
  const qualityPhrases = ["aberdeen angus", "black angus", "full fat", "wholewheat", "extra virgin"];
  const stylePhrases = ["pan blanco", "breakfast", "toast", "sourdough"];
  const dietaryPhrases = [
    "gluten free",
    "gluten-free",
    "gl.free",
    "gl free",
    "g.free",
    "gf",
    "vegan",
    "vegetarian",
    "dairy free",
    "dairy-free",
  ];
  const productOrder = [
    "olive oil",
    "cherry tomatoes",
    "cherry tomato",
    "white grapes",
    "red grapes",
    "tomatoes",
    "baby prawns",
    "king prawns",
    "breakfast beans",
    "syrup",
    "sorbet",
    "ice cream",
    "grapes",
    "cabbage",
    "leeks",
    "potatoes",
    "potato",
    "horseradish",
    "milk",
    "egg yolk",
    "eggs",
    "cheese",
    "gouda",
    "edam",
    "falafel",
    "beans",
    "octopus",
    "swordfish",
    "anchovy",
    "lamb",
    "burger",
    "steak",
    "flank steak",
    "pork fillet",
    "chicken leg",
    "linguine",
    "tagliatelle",
    "tomato",
    "chia seeds",
    "oat flakes",
    "pickled ginger",
    "ginger",
    "butter",
    "almond butter",
    "paste",
    "vanilla essence",
    "cocoa",
    "apple strudel",
    "corn flour",
    "flour",
    "yeast",
    "penne rigate",
    "pasta",
    "beef",
    "chicken",
    "pork",
    "lamb",
    "yoghurt",
  ];
  const cutMap = {
    filet: "fillet",
    fillet: "fillet",
    slices: "slices",
    breast: "breast",
    pancetta: "pancetta",
    souvlaki: "souvlaki",
    yoghurt: "yoghurt",
    flour: "flour",
    yeast: "yeast",
    "corn flour": "corn flour",
    "penne rigate": "penne rigate",
    tagliatelle: "tagliatelle",
    steak: "steak",
    burger: "burger",
    fillet: "fillet",
    "pork fillet": "fillet",
    "chicken leg": "leg",
  };

  const brand = knownBrands.find((item) => textIncludesWholePhrase(text, item)) || "";
  const country = countryMap.find((item) => text.includes(item.trigger)) || null;
  const stylePhrase = stylePhrases.find((item) => text.includes(item)) || "";
  const state = stateWords.find((item) => text.includes(item)) || "";
  const dietaryTerm = dietaryPhrases.find((item) => text.includes(item)) || "";
  const product = [...productOrder]
    .filter((item) => text.includes(item))
    .sort((left, right) => right.length - left.length)[0] || "";
  const cut = Object.keys(cutMap).find((item) => text.includes(item) && item !== product) || "";
  const hasDoubleZeroCue = /\b00\b/.test(text) && /\bflour\b/.test(text);
  const quality = qualityPhrases.find((item) => text.includes(item)) || (hasDoubleZeroCue ? "00" : "");
  const style = cut === "souvlaki" && text.includes("breast") ? "breast" : stylePhrase || "";
  const dietaryMap = {
    "gluten free": "Gluten Free",
    "gluten-free": "Gluten Free",
    "gl.free": "Gluten Free",
    "gl free": "Gluten Free",
    "g.free": "Gluten Free",
    gf: "Gluten Free",
    vegan: "Vegan",
    vegetarian: "Vegetarian",
    "dairy free": "Dairy-free",
    "dairy-free": "Dairy-free",
  };

  return {
    brand: brand ? titleCaseWords(brand) : "",
    product: product ? titleCaseWords(product) : "",
    cut: cut ? titleCaseWords(cutMap[cut]) : "",
    quality: quality ? titleCaseWords(quality) : "",
    dietary: dietaryTerm ? dietaryMap[dietaryTerm] || titleCaseWords(dietaryTerm) : "",
    state: state ? titleCaseWords(state) : "",
    origin: country?.value ? titleCaseWords(country.value) : "",
    style: style ? titleCaseWords(style) : "",
    packSize: packSize || "",
  };
}

function applyLearningRulesToIndex(nameIndex, rawName, learningRules = []) {
  const rawKey = normalizeIngredientKey(rawName);

  return (learningRules || []).reduce((current, rule) => {
    if (!rule?.trigger || !rule?.field || !rule?.value) return current;
    const triggerKey = normalizeIngredientKey(rule.trigger);
    if (!triggerKey || !rawKey.includes(triggerKey)) return current;
    return {
      ...current,
      [rule.field]: rule.value,
    };
  }, nameIndex);
}

function getAppliedLearningRuleHits(rawName, learningRules = []) {
  const rawKey = normalizeIngredientKey(rawName);

  return dedupeTextList(
    (learningRules || [])
      .filter((rule) => {
        const triggerKey = normalizeIngredientKey(rule?.trigger);
        return Boolean(rule?.field && rule?.value && triggerKey && rawKey.includes(triggerKey));
      })
      .map((rule) => `${rule.field}::${rule.value}::${rule.trigger}`)
  ).map((entry) => {
    const [field, value, trigger] = String(entry || "").split("::");
    return {
      field,
      value,
      trigger,
      label: ingredientIndexFields.find((item) => item.key === field)?.label || titleCaseWords(field),
    };
  });
}

function applySoft1CodeHintsToIndex(nameIndex, rawName = "", sourceCode = "") {
  const nextIndex = { ...nameIndex };
  const normalizedCode = String(sourceCode || "").trim().toUpperCase();
  const family = getSoft1CodeFamily(normalizedCode);
  const text = normalizeIngredientParserText(rawName);

  if (family === "PORK" && /\bfilet\b|\bfillet\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Fillet";
  }

  if (family === "PORK" && /\bminced\b|\bmince\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Minced";
  }

  if (family === "PORK" && /\bgyros\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Gyros";
  }

  if (family === "PORK" && /\bsteak\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Steak";
  }

  if (family === "PORK" && /\bwhole pork\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Whole";
  }

  if (family === "PORK" && /\bshoulder\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Shoulder";
  }

  if (family === "PORK" && /\bneck\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Neck";
  }

  if (family === "PORK" && /\bsouvlaki\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Souvlaki";
  }

  if (family === "PORK" && /\bpancetta\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Pancetta";
  }

  if (family === "PORK" && /\bspare ribs?\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Pork";
    if (!nextIndex.cut) nextIndex.cut = "Spare ribs";
  }

  if (family === "PORK" && /\bgreek\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Greece";
  }

  if (family === "PORK" && /\bdutch\b|\bnetherlands\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Netherlands";
  }

  if (family === "PORK" && /\bsmoked\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Smoked";
  }

  if (family === "BEEF" && /\bflank steak\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Flank steak";
  }

  if (family === "BEEF" && /\bbresaola\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Bresaola";
  }

  if (family === "BEEF" && /\bcheeks?\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Cheeks";
  }

  if (family === "BEEF" && /\bminced\b|\bmince\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Minced";
  }

  if (family === "BEEF" && /\bpicanha\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Picanha";
  }

  if (family === "BEEF" && /\bcarpaccio\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Carpaccio";
  }

  if (family === "BEEF" && /\brib ?eye\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Ribeye";
  }

  if (family === "BEEF" && /\bbrisket\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Brisket";
  }

  if (family === "BEEF" && /\bfillet\b|\bfilet\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Fillet";
  }

  if (family === "BEEF" && /\bburger\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Burger";
  }

  if (family === "BEEF" && /\bmeatballs?\b/.test(text)) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Meatballs";
  }

  if (family === "BEEF" && /\bbones?\b/.test(text) && !nextIndex.cut) {
    nextIndex.product = "Beef";
    nextIndex.cut = "Bones";
  }

  if (family === "BEEF" && /\bsteak\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Beef";
    if (!nextIndex.cut) nextIndex.cut = "Steak";
  }

  if (family === "CHI" && /\bleg\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Leg";
  }

  if (family === "CHI" && /\bwhole chicken\b/.test(text)) {
    nextIndex.product = "Chicken";
    nextIndex.cut = "Whole";
  }

  if (family === "CHI" && /\bfillet\b|\bfilet\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Fillet";
  }

  if (family === "CHI" && /\bbreast\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Breast";
  }

  if (family === "CHI" && /\bwings?\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Wings";
  }

  if (family === "CHI" && /\bnuggets?\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Nuggets";
  }

  if (family === "CHI" && /\bschnitzel\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Schnitzel";
  }

  if (family === "CHI" && /\bsouvlaki\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Chicken";
    if (!nextIndex.cut) nextIndex.cut = "Souvlaki";
  }

  if (family === "CHI" && /\bgreek\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Greece";
  }

  if (family === "LAM" && /\bleg\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Lamb";
    if (!nextIndex.cut) nextIndex.cut = "Leg";
  }

  if (family === "LAM" && /\bminced\b|\bmince\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Lamb";
    if (!nextIndex.cut) nextIndex.cut = "Minced";
  }

  if (family === "LAM" && /\bfrench-?cut\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Lamb";
    if (!nextIndex.cut) nextIndex.cut = "French-cut";
  }

  if (family === "LAM" && /\bgreek\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Greece";
  }

  if (family === "LAM" && /\bnew zealand\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "New Zealand";
  }

  if (isSeafoodSoft1Family(family) && /\bsmoked salmon\b/.test(text)) {
    nextIndex.product = "Salmon";
    nextIndex.cut = "Smoked";
  }

  if (isSeafoodSoft1Family(family) && /\bcod fish\b/.test(text)) {
    nextIndex.product = "Cod";
  }

  if (isSeafoodSoft1Family(family) && /\bsalmon\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Salmon";
  }

  if (isSeafoodSoft1Family(family) && /\btuna\b/.test(text)) {
    nextIndex.product = "Tuna";
  }

  if (isSeafoodSoft1Family(family) && /\bcuttlefish\b/.test(text)) {
    nextIndex.product = "Cuttlefish";
  }

  if (isSeafoodSoft1Family(family) && /\btaramas\b/.test(text)) {
    nextIndex.product = "Taramas";
  }

  if (family === "FIFI" && /\bfillet\b|\bfilet\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Fillet";
  }

  if (isSeafoodSoft1Family(family) && /\bfish fillet\b|\bfish filet\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Fish";
    if (!nextIndex.cut) nextIndex.cut = "Fillet";
  }

  if (isSeafoodSoft1Family(family) && /\bsea ?bream\b|\bseabream\b/.test(text)) {
    nextIndex.product = "Sea bream";
  }

  if (isSeafoodSoft1Family(family) && /\bshrimps?\b/.test(text)) {
    nextIndex.product = "Shrimp";
  }

  if (isSeafoodSoft1Family(family) && /\bsea ?bass\b/.test(text)) {
    nextIndex.product = "Sea bass";
  }

  if (isSeafoodSoft1Family(family) && /\bbaby prawns?\b/.test(text)) {
    nextIndex.product = "Baby prawns";
  } else if (isSeafoodSoft1Family(family) && /\bking prawns?\b/.test(text)) {
    nextIndex.product = "King prawns";
  } else if (isSeafoodSoft1Family(family) && /\bprawns?\b/.test(text)) {
    nextIndex.product = "Prawns";
  }

  if (isSeafoodSoft1Family(family) && /\bmussels?\b/.test(text)) {
    nextIndex.product = "Mussels";
  }

  if (isSeafoodSoft1Family(family) && /\bclams?\b/.test(text)) {
    nextIndex.product = "Clams";
  }

  if (isSeafoodSoft1Family(family) && /\bcalamari\b/.test(text)) {
    nextIndex.product = "Squid";
    if (!nextIndex.cut) nextIndex.cut = "Calamari";
  }

  if (isSeafoodSoft1Family(family) && /\boctopus\b/.test(text)) {
    nextIndex.product = "Octopus";
  }

  if (isSeafoodSoft1Family(family) && /\banglerfish\b/.test(text)) {
    nextIndex.product = "Anglerfish";
  }

  if (isSeafoodSoft1Family(family) && /\bswordfish\b/.test(text)) {
    nextIndex.product = "Swordfish";
  }

  if (isSeafoodSoft1Family(family) && /\banchov(?:y|ies)\b/.test(text)) {
    nextIndex.product = "Anchovy";
  }

  if (isSeafoodSoft1Family(family) && /\bmackerel\b/.test(text)) {
    nextIndex.product = "Mackerel";
  }

  if (isSeafoodSoft1Family(family) && /\bpargus\b/.test(text)) {
    nextIndex.product = "Pargus";
  }

  if (isSeafoodSoft1Family(family) && /\bnorway\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Norway";
  }

  if (isSeafoodSoft1Family(family) && /\bargentin(?:e|ian)\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Argentina";
  }

  if (isSeafoodSoft1Family(family) && /\bspanish\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Spain";
  }

  if (isSeafoodSoft1Family(family) && /\bchilean\b/.test(text) && !nextIndex.origin) {
    nextIndex.origin = "Chile";
  }

  if (isSeafoodSoft1Family(family) && /\bin oil\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "In oil";
  }

  if (family === "BRE" && /\bbread\s?crumbs\b|\bbreadcrumbs\b/.test(text)) {
    nextIndex.product = "Breadcrumbs";
    if (/\bpanko\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Panko";
    }
  }

  if (family === "BRE" && /\bbread\b/.test(text) && !/\bbreaded\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Bread";
  }

  if (family === "BRE" && /\blasagne\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Lasagne";
  }

  if (family === "BRE" && /\bbagels?\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Bagel";
  }

  if (family === "BRE" && /\bsandwich bread\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Sandwich bread";
  }

  if (family === "BRE" && /\bclub sandwich\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Club sandwich bread";
  }

  if (family === "BRE" && /\bciabatta\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Ciabatta";
  }

  if (family === "BRE" && /\bbaguette\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Baguette";
  }

  if (family === "BRE" && /\bbrioche?d?\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Brioche";
  }

  if (family === "BRE" && /\benglish muffin\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "English muffin";
  }

  if (family === "BRE" && /\bburger buns?\b|\bhamburger bread\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Burger bun";
  }

  if (family === "BRE" && /\bbao bun\b|\bbao\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Bao bun";
  }

  if (family === "BRE" && /\btortilla\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Tortilla";
  }

  if (family === "BRE" && /\bkoulouri\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Koulouri";
  }

  if (family === "BRE" && /\btsoureki\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Tsoureki";
  }

  if (family === "BRE" && /\bpita bread\b|\bpitta bread\b|\bpita\b|\bpitta\b/.test(text)) {
    nextIndex.product = "Bread";
    nextIndex.cut = "Pitta";
  }

  if (family === "BRE" && /\btoast\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Toast";
  }

  if (family === "BRE" && /\bloaf\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Loaf";
  }

  if (family === "BRE" && /\bsourdough\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Sourdough";
  }

  if (family === "BRE" && /\bwholemeal\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Wholemeal";
  }

  if (family === "BRE" && /\bwhole grain\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Whole grain";
  }

  if (family === "BRE" && /\bmulti-?seed\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Multi-seed";
  }

  if (family === "BRE" && /\bsesame\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Sesame";
  }

  if (family === "BRE" && /\brye\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Rye";
  }

  if (family === "BRE" && /\bpre-?baked\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Pre-baked";
  }

  if (family === "PAS" && /\bcroissant\b/.test(text)) {
    nextIndex.product = "Croissant";
  }

  if (family === "PAS" && /\bpuff pastry\b/.test(text)) {
    nextIndex.product = "Pastry";
    if (!nextIndex.cut) nextIndex.cut = "Puff";
  }

  if (family === "PAS" && /\bapple strudel\b/.test(text)) {
    nextIndex.product = "Strudel";
    if (!nextIndex.cut) nextIndex.cut = "Apple";
  }

  if (family === "PAS" && /\bspinach pie\b/.test(text)) {
    nextIndex.product = "Pie";
    if (!nextIndex.cut) nextIndex.cut = "Spinach";
  }

  if (family === "PAS" && /\bcheese ?pie\b/.test(text)) {
    nextIndex.product = "Pie";
    if (!nextIndex.cut) nextIndex.cut = "Cheese";
  }

  if (family === "PAS" && /\bchicken pie\b/.test(text)) {
    nextIndex.product = "Pie";
    if (!nextIndex.cut) nextIndex.cut = "Chicken";
  }

  if (family === "PAS" && /\bkataifi\b/.test(text)) {
    nextIndex.product = "Pastry";
    if (!nextIndex.cut) nextIndex.cut = "Kataifi";
  }

  if (family === "PAS" && /\bcinnamon bun\b/.test(text)) {
    nextIndex.product = "Bun";
    if (!nextIndex.cut) nextIndex.cut = "Cinnamon";
  }

  if (family === "PAS" && /\bpizza margharita\b|\bpizza margherita\b/.test(text)) {
    nextIndex.product = "Pizza";
    if (!nextIndex.cut) nextIndex.cut = "Margherita";
    if (/\bmini\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Mini";
    }
  }

  if (family === "PAS" && /\bbutter\b/.test(text) && /\bcroissant\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Butter";
  }

  if (family === "PAS" && /\bchocolate\b/.test(text) && /\bcroissant\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Chocolate";
  }

  if (family === "BUT" && /\bpeanut butter\b/.test(text)) {
    nextIndex.product = "Peanut butter";
  }

  if (family === "BUT" && /\balmond butter\b/.test(text)) {
    nextIndex.product = "Almond butter";
  }

  if (family === "BUT" && /\bbutter\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Butter";
  }

  if (family === "BUT" && /\bsoft\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Soft";
  }

  if (family === "BUT" && /\bsalted\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Salted";
  }

  if (family === "BUT" && /\bunsalted\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Unsalted";
  }

  if (family === "BUT" && /\bblock\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Block";
  }

  if (family === "BUT" && /\bsmooth\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Smooth";
  }

  if (family === "MILK") {
    if (/\balmond milk\b/.test(text)) {
      nextIndex.product = "Almond milk";
      if (!nextIndex.dietary) nextIndex.dietary = "Dairy-free";
    }
    if (/\boat milk\b/.test(text)) {
      nextIndex.product = "Oat milk";
      if (!nextIndex.dietary) nextIndex.dietary = "Dairy-free";
    }
    if (/\bsoy drink\b|\bsoy milk\b/.test(text)) {
      nextIndex.product = "Soy milk";
      if (!nextIndex.dietary) nextIndex.dietary = "Dairy-free";
    }
    if (/\bcoconut milk\b/.test(text)) {
      nextIndex.product = "Coconut milk";
      if (!nextIndex.dietary) nextIndex.dietary = "Dairy-free";
    }
    if (/\bcondensed milk\b/.test(text)) {
      nextIndex.product = "Condensed milk";
    }
    if (/\bchocolate milk\b/.test(text)) {
      nextIndex.product = "Chocolate milk";
    }
    if (/\bmilk powder\b/.test(text)) {
      nextIndex.product = "Milk powder";
    }
    if (/\bmilk\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Milk";
    }
    if (/\bfull fat\b/.test(text) && !nextIndex.quality) {
      nextIndex.quality = "Full fat";
    }
    if (/\bskimmed\b/.test(text) && !nextIndex.quality) {
      nextIndex.quality = "Skimmed";
    }
    if (/\blactose free\b/.test(text) && !nextIndex.dietary) {
      nextIndex.dietary = "Lactose-free";
    }
    if (/\bbarista\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Barista";
    }
    if (/\bcooking\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Cooking";
    }
    const fatPercentMatch = text.match(/\b(\d(?:[.,]\d+)?)\s*%/);
    if (fatPercentMatch && !nextIndex.quality) {
      nextIndex.quality = `${String(fatPercentMatch[1] || "").replace(",", ".")}%`;
    }
  }

  if (family === "HECR") {
    if (/\bheavy cream\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Heavy cream";
    }
    const fatPercentMatch = text.match(/\b(\d(?:[.,]\d+)?)\s*%/);
    if (fatPercentMatch && !nextIndex.quality) {
      nextIndex.quality = `${String(fatPercentMatch[1] || "").replace(",", ".")}%`;
    }
  }

  if (family === "MAMU") {
    if (/\bhummus\b/.test(text)) nextIndex.product = "Hummus";
    if (/\bketchup\b/.test(text)) nextIndex.product = "Ketchup";
    if (/\bmustard\b/.test(text)) nextIndex.product = "Mustard";
    if (/\bmayonna?ise\b|\bmayo\b/.test(text)) nextIndex.product = "Mayonnaise";
    if (/\btzatziki\b/.test(text)) nextIndex.product = "Tzatziki";
    if (/\btomato\b/.test(text) && /\bketchup\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Tomato";
    }
  }

  if (family === "SAU") {
    if (/\bfish sauce\b/.test(text)) nextIndex.product = "Fish sauce";
    if (/\bmirin\b/.test(text)) nextIndex.product = "Mirin";
    if (/\bsoya? paste\b/.test(text)) nextIndex.product = "Soy paste";
    if (/\bsour cream sauce\b/.test(text)) {
      nextIndex.product = "Sauce";
      if (!nextIndex.cut) nextIndex.cut = "Sour cream";
    }
    if (/\bteryaki\b|\bteriyaki\b/.test(text)) nextIndex.product = "Teriyaki sauce";
    if (/\bworcester(?:shire)? sauce\b/.test(text)) nextIndex.product = "Worcestershire sauce";
    if (/\bpesto\b/.test(text)) {
      nextIndex.product = "Pesto";
      if (/\bbasilico\b|\bbasil\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Basil";
    }
    if (/\bbbq sauce\b/.test(text)) nextIndex.product = "BBQ sauce";
    if (/\bchilli sauce\b/.test(text)) nextIndex.product = "Chilli sauce";
    if (/\btabasco\b/.test(text) && !nextIndex.product) nextIndex.product = "Hot sauce";
    if (/\btruffle paste\b/.test(text)) nextIndex.product = "Truffle paste";
    if (/\bnduja\b/.test(text)) nextIndex.product = "Nduja";
    if (/\bred hot pepper\b/.test(text) && !nextIndex.style) nextIndex.style = "Red hot pepper";
  }

  if (family === "FRVEG") {
    if (/\bhot peppers?\b/.test(text)) {
      nextIndex.product = "Peppers";
      if (!nextIndex.style) nextIndex.style = "Hot";
    }
    if (/\bmixed peppers?\b/.test(text)) {
      nextIndex.product = "Peppers";
      if (!nextIndex.style) nextIndex.style = "Mixed";
    }
    if (/\bjalapeno peppers?\b/.test(text)) {
      nextIndex.product = "Peppers";
      if (!nextIndex.cut) nextIndex.cut = "Jalapeno";
    }
    if (/\bmushrooms?\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Mushrooms";
    }
    if (/\bportobello mushrooms?\b/.test(text)) {
      nextIndex.product = "Mushrooms";
      if (!nextIndex.cut) nextIndex.cut = "Portobello";
    }
    if (/\bpleurotus mushrooms?\b/.test(text)) {
      nextIndex.product = "Mushrooms";
      if (!nextIndex.cut) nextIndex.cut = "Pleurotus";
    }
    if (/\bgiant mushrooms?\b/.test(text)) {
      nextIndex.product = "Mushrooms";
      if (!nextIndex.cut) nextIndex.cut = "Giant";
    }
    if (/\bmint\b/.test(text)) nextIndex.product = "Mint";
    if (/\bbasil\b/.test(text)) nextIndex.product = "Basil";
    if (/\bthyme\b/.test(text)) nextIndex.product = "Thyme";
    if (/\btarragon\b/.test(text)) nextIndex.product = "Tarragon";
    if (/\bdill\b/.test(text)) nextIndex.product = "Dill";
    if (/\bparsley\b/.test(text)) nextIndex.product = "Parsley";
    if (/\bchives?\b/.test(text)) nextIndex.product = "Chives";
    if (/\boregano\b/.test(text)) nextIndex.product = "Oregano";
    if (/\bcoriander\b/.test(text)) nextIndex.product = "Coriander";
    if (/\bcelery\b/.test(text)) nextIndex.product = "Celery";
    if (/\bleeks?\b/.test(text)) nextIndex.product = "Leeks";
    if (/\bspring onion\b/.test(text)) nextIndex.product = "Spring onions";
    if (/\bonions?\b/.test(text) && !/\bspring onions?\b/.test(text) && !/\bfresh onions?\b/.test(text)) nextIndex.product = "Onions";
    if (/\bshallots?\b/.test(text)) nextIndex.product = "Shallots";
    if (/\bgarlic\b/.test(text)) nextIndex.product = "Garlic";
    if (/\bcarrots?\b/.test(text)) nextIndex.product = "Carrots";
    if (/\bcucumber\b/.test(text)) nextIndex.product = "Cucumber";
    if (/\bavocado\b/.test(text)) nextIndex.product = "Avocado";
    if (/\baubergine\b/.test(text)) nextIndex.product = "Aubergine";
    if (/\bendives?\b/.test(text)) nextIndex.product = "Endives";
    if (/\bfennel\b/.test(text)) nextIndex.product = "Fennel";
    if (/\brocket\b/.test(text)) nextIndex.product = "Rocket";
    if (/\bbeetroot\b/.test(text)) nextIndex.product = "Beetroot";
    if (/\bspinach\b/.test(text)) nextIndex.product = "Spinach";
    if (/\bsweet potatoes?\b/.test(text)) nextIndex.product = "Sweet potatoes";
    if (/\bparsnips?\b/.test(text)) nextIndex.product = "Parsnips";
    if (/\bpeas\b/.test(text)) nextIndex.product = "Peas";
    if (/\bpumpkins?\b/.test(text)) nextIndex.product = "Pumpkin";
    if (/\blemons?\b/.test(text)) nextIndex.product = "Lemon";
    if (/\blimes?\b/.test(text)) nextIndex.product = "Lime";
    if (/\bbroccoli\b/.test(text)) nextIndex.product = "Broccoli";
    if (/\bcauliflower\b/.test(text)) nextIndex.product = "Cauliflower";
    if (/\bcabbage\b/.test(text) && !nextIndex.product) nextIndex.product = "Cabbage";
    if (/\bhibiscus\b/.test(text)) nextIndex.product = "Hibiscus";
    if (/\bhorseradish\b/.test(text)) nextIndex.product = "Horseradish";
    if (/\bpotatoes?\b/.test(text) && !nextIndex.product) nextIndex.product = "Potatoes";
    if (/\bagata\b/.test(text) && !nextIndex.quality) nextIndex.quality = "Agata";
  }

  if (family === "FRFRU") {
    if (/\bvanilla pods?\b/.test(text)) {
      nextIndex.product = "Vanilla";
      if (!nextIndex.cut) nextIndex.cut = "Pods";
    }
    if (/\bmelons?\b/.test(text)) nextIndex.product = "Melon";
    if (/\bpassion fruit\b/.test(text)) nextIndex.product = "Passion fruit";
    if (/\bpeaches?\b/.test(text)) nextIndex.product = "Peach";
    if (/\bpineapple\b/.test(text)) nextIndex.product = "Pineapple";
    if (/\bwatermelons?\b/.test(text)) nextIndex.product = "Watermelon";
    if (/\bblackberries?\b/.test(text)) nextIndex.product = "Blackberries";
    if (/\bpears?\b/.test(text)) nextIndex.product = "Pear";
    if (/\bapricots?\b/.test(text)) nextIndex.product = "Apricot";
    if (/\bbananas?\b/.test(text)) nextIndex.product = "Banana";
    if (/\bcherries?\b/.test(text)) nextIndex.product = "Cherry";
    if (/\bblueberries?\b/.test(text)) nextIndex.product = "Blueberries";
    if (/\bfigs?\b/.test(text)) nextIndex.product = "Fig";
    if (/\bgrapefruit\b/.test(text)) nextIndex.product = "Grapefruit";
    if (/\bstrawberries?\b/.test(text)) nextIndex.product = "Strawberry";
    if (/\bkiwi\b/.test(text)) nextIndex.product = "Kiwi";
    if (/\bnectarines?\b/.test(text)) nextIndex.product = "Nectarine";
    if (/\bapples?\b/.test(text)) nextIndex.product = "Apple";
    if (/\bmango\b/.test(text)) nextIndex.product = "Mango";
    if (/\braspberries?\b/.test(text)) nextIndex.product = "Raspberry";
    if (/\bpomegranates?\b/.test(text)) nextIndex.product = "Pomegranate";
    if (/\bwhite grapes?\b/.test(text)) {
      nextIndex.product = "Grapes";
      if (!nextIndex.style) nextIndex.style = "White";
    }
    if (/\bred grapes?\b/.test(text)) {
      nextIndex.product = "Grapes";
      if (!nextIndex.style) nextIndex.style = "Red";
    }
    if (/\bgrapes?\b/.test(text) && !nextIndex.product) nextIndex.product = "Grapes";
    if (/\bgreek\b/.test(text) && !nextIndex.origin) nextIndex.origin = "Greece";
    if (/\bimport(?:ed)?\b/.test(text) && !nextIndex.style) nextIndex.style = "Imported";
    if (/\bdomestic\b/.test(text) && !nextIndex.style) nextIndex.style = "Domestic";
    if (/\bgranny-smith\b/.test(text) && !nextIndex.quality) nextIndex.quality = "Granny Smith";
    if (/\bstarkin\b/.test(text) && !nextIndex.quality) nextIndex.quality = "Starkin";
  }

  if (family === "DRFO") {
    if (/\bquinoa\b/.test(text)) nextIndex.product = "Quinoa";
    if (/\braisins?\b/.test(text)) nextIndex.product = "Raisins";
    if (/\bplums?\b/.test(text)) nextIndex.product = "Plum";
    if (/\bblack currant\b/.test(text)) nextIndex.product = "Black currant";
    if (/\bdried figs?\b/.test(text)) nextIndex.product = "Fig";
    if (/\bcoconut\b/.test(text) && !/\bcoconut milk\b/.test(text)) nextIndex.product = "Coconut";
    if (/\bpecan\b/.test(text)) nextIndex.product = "Pecan";
    if (/\bcranberry\b/.test(text)) nextIndex.product = "Cranberry";
    if (/\bcorn on the cob\b/.test(text)) {
      nextIndex.product = "Corn";
      if (!nextIndex.cut) nextIndex.cut = "On the cob";
    }
    if (/\bguajillo\b/.test(text)) nextIndex.product = "Guajillo chilli";
    if (/\bdried\b/.test(text) && !nextIndex.style) nextIndex.style = "Dried";
    if (/\bblonde\b/.test(text) && !nextIndex.style) nextIndex.style = "Blonde";
    if (/\bdry porchini\b|\bdry porcini\b/.test(text)) {
      nextIndex.product = "Porcini";
      if (!nextIndex.style) nextIndex.style = "Dried";
    }
    if (/\bmulticolor\b/.test(text) && !nextIndex.style) nextIndex.style = "Multicolour";
    if (/\btricolor\b/.test(text) && !nextIndex.style) nextIndex.style = "Tricolour";
    if (/\bwhole\b/.test(text) && /\bred chilli\b/.test(text)) {
      nextIndex.product = "Red chilli";
      if (!nextIndex.style) nextIndex.style = "Whole";
    }
  }

  if (family === "ASPR") {
    if (/\bsoy sauce\b/.test(text)) nextIndex.product = "Soy sauce";
    if (/\boyster sauce\b/.test(text)) nextIndex.product = "Oyster sauce";
    if (/\bponzu\b/.test(text)) nextIndex.product = "Ponzu";
    if (/\byuzu\b/.test(text) && /\bjuice\b/.test(text)) nextIndex.product = "Yuzu juice";
    if (/\bchilli paste\b|\bchili paste\b/.test(text)) nextIndex.product = "Chilli paste";
    if (/\bcurry paste\b/.test(text)) nextIndex.product = "Curry paste";
    if (/\bsushi nori\b|\bnori\b/.test(text)) nextIndex.product = "Nori";
    if (/\bwakame\b/.test(text)) nextIndex.product = "Wakame";
    if (/\bseaweed\b/.test(text) && !nextIndex.product) nextIndex.product = "Seaweed";
    if (/\bpanko\b/.test(text)) {
      nextIndex.product = "Breadcrumbs";
      if (!nextIndex.style) nextIndex.style = "Panko";
    }
    if (/\btortilla\b/.test(text)) {
      nextIndex.product = "Tortilla chips";
      if (/\bcorn\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Corn";
    }
    if (/\bcrackerbread\b/.test(text)) nextIndex.product = "Crackers";
    if (/\bspring rolls?\b/.test(text)) nextIndex.product = "Spring rolls";
    if (/\btruffle\b/.test(text) && !nextIndex.style) nextIndex.style = "Truffle";
    if (/\bjalapenos?\b/.test(text)) {
      nextIndex.product = "Jalapenos";
      if (/\bsliced\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Sliced";
    }
    if (/\bpaprika\b/.test(text) && /\bcrisp|chips?\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Paprika";
    }
    if (/\bsea salt\b/.test(text) && /\bcrisp|chips?\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Sea salt";
    }
    if (/\bsour cream\b/.test(text) && /\bcrisp|chips?\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Sour cream";
    }
    if (/\bhoney bbq\b/.test(text) && !nextIndex.style) nextIndex.style = "Honey BBQ";
    if (/\blime\b/.test(text) && /\bchips?\b/.test(text) && !nextIndex.style) nextIndex.style = "Lime";
    if (/\bginger\b/.test(text) && /\bchips?\b/.test(text) && !nextIndex.style) nextIndex.style = "Ginger";
    if (/\bmaize puffs?\b/.test(text) || /\bcorn puffs?\b/.test(text) || /\bbeaning biscuits\b/.test(text)) {
      nextIndex.product = "Snacks";
    }
    if (/\bcream\b/.test(text) && /\bpuffs?\b/.test(text) && !nextIndex.style) nextIndex.style = "Cream";
    if (/\bbanana\b/.test(text) && /\bbiscuits?\b/.test(text) && !nextIndex.style) nextIndex.style = "Banana";
    if (/\bstrawberry\b/.test(text) && /\bbiscuits?\b/.test(text) && !nextIndex.style) nextIndex.style = "Strawberry";
    if (/\bmelon\b/.test(text) && /\btomato slices?\b/.test(text)) nextIndex.product = "Tomato";
  }

  if (family === "SUG") {
    if (/\bsugar\b/.test(text) && !nextIndex.product) nextIndex.product = "Sugar";
    if (/\bbrown sugar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Brown";
    if (/\bwhite sugar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "White";
    if (/\bpowder\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Powdered";
    if (/\bsticks?\b/.test(text) && !nextIndex.style) nextIndex.style = "Sticks";
  }

  if (family === "CHE" && /\bgouda\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Gouda";
  }

  if (family === "CHE" && /\bedam\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Edam";
  }

  if (family === "CHE" && /\bbrie\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Brie";
  }

  if (family === "CHE" && /(\bcream cheese\b|\bcheese cream\b)/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Cream";
  }

  if (family === "CHE" && /\bhalloumi\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Halloumi";
  }

  if (family === "CHE" && /(\broquefort\b|\brouquefort\b)/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Roquefort";
  }

  if (family === "CHE" && /\bfeta\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Feta";
  }

  if (family === "CHE" && /(\bburrata\b|\bburata\b)/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Burrata";
    if (/\bfresh\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Fresh";
    }
  }

  if (family === "CHE" && /\bgorgonzola\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Gorgonzola";
  }

  if (family === "CHE" && /\bparm(?:esan|igiano)?\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Parmesan";
    if (/\bflakes?\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Flakes";
    }
  }

  if (family === "CHE" && /\breggiano\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Parmesan";
  }

  if (family === "CHE" && /\bjagueva? del abuelo\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Jagueva del Abuelo";
  }

  if (family === "CHE" && /\bmozzarella\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Mozzarella";
    if (/\bsmoked\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Smoked";
    }
  }

  if (family === "CHE" && /\bmanouri\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Manouri";
  }

  if (family === "CHE" && /\bmascarpone\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Mascarpone";
  }

  if (family === "CHE" && /\bmetsovone\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Metsovone";
    if (/\bsmoked\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Smoked";
    }
  }

  if (family === "CHE" && /\banthotyro\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Anthotyro";
  }

  if (family === "CHE" && /\bcheddar\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Cheddar";
  }

  if (family === "CHE" && /\bricotta\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Ricotta";
  }

  if (family === "CHE" && /\bsaganaki\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Saganaki";
  }

  if (family === "CHE" && /\bpecorino\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Pecorino";
  }

  if (family === "CHE" && /\bblue cheese\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Blue";
  }

  if (family === "CHE" && /\bmizithra\b/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Mizithra";
  }

  if (family === "CHE" && /(\bchevre\b|\bgoat cheese\b)/.test(text)) {
    nextIndex.product = "Cheese";
    if (!nextIndex.cut) nextIndex.cut = "Goat";
  }

  if (family === "CHE" && /\bcheese\b/.test(text) && /\bvegan\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Cheese";
    if (!nextIndex.dietary) nextIndex.dietary = "Vegan";
  }

  if (family === "CER") {
    if (/\bcorn flakes\b/.test(text)) {
      nextIndex.product = "Corn flakes";
    }
    if (/\brice ?crackers?\b/.test(text)) {
      nextIndex.product = "Rice crackers";
    }
    if (/\bcoco pops?\b/.test(text)) {
      nextIndex.product = "Cereal";
      if (!nextIndex.cut) nextIndex.cut = "Coco Pops";
    }
    if (/\bcornflakes?\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Corn flakes";
    }
    if (/\boat flakes\b/.test(text)) {
      nextIndex.product = "Oats";
      nextIndex.cut = "Flakes";
    }
    if (/\btahini\b/.test(text)) {
      nextIndex.product = "Tahini";
    }
    if (/\bpeanut butter\b/.test(text)) {
      nextIndex.product = "Peanut butter";
    }
    if (/\bprotein ball\b/.test(text)) {
      nextIndex.product = "Protein ball";
    }
    if (/\bporridge\b/.test(text)) {
      nextIndex.product = "Porridge";
    }
    if (/\bmuesli\b/.test(text)) {
      nextIndex.product = "Muesli";
    }
    if (/\bgranola\b/.test(text)) {
      nextIndex.product = "Granola";
    }
    if (/\boat bars?\b/.test(text)) {
      nextIndex.product = "Oat bar";
    }
    if (/\bbanana raw bars?\b/.test(text)) {
      nextIndex.product = "Raw bar";
      if (!nextIndex.cut) nextIndex.cut = "Banana";
    }
    if (/\bchoco balls?\b/.test(text)) {
      nextIndex.product = "Snack balls";
      if (!nextIndex.cut) nextIndex.cut = "Chocolate";
    }
    if (/\bpasteli\b/.test(text)) {
      nextIndex.product = "Pasteli";
    }
    if (/\bbeet bites?\b/.test(text)) {
      nextIndex.product = "Snack bites";
      if (!nextIndex.cut) nextIndex.cut = "Beet";
    }
    if (/\bchoco munchies?\b/.test(text)) {
      nextIndex.product = "Snack bites";
      if (!nextIndex.cut) nextIndex.cut = "Chocolate";
    }
    if (/\bspinach crunchies?\b/.test(text)) {
      nextIndex.product = "Snack bites";
      if (!nextIndex.cut) nextIndex.cut = "Spinach";
    }
    if (/\bblueberry\b/.test(text) && /\bbar|porridge\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Blueberry";
    }
    if (/\bapple\b/.test(text) && /\bbar|porridge\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Apple";
    }
    if (/\bcinnamon\b/.test(text) && /\bbar|porridge\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Cinnamon";
    }
    if (/\bstraw\b/.test(text) && /\bpeanut ?butter\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Strawberry & peanut butter";
    }
    if (/\bsalted caramel\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Salted caramel";
    }
    if (/\bcacao\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Cacao";
    }
    if (/\bchocolate\b/.test(text) && /\bclassic\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Classic chocolate";
    }
    if (/\bvegan\b/.test(text) && !nextIndex.dietary) {
      nextIndex.dietary = "Vegan";
    }
    if (/\bgl\.? free\b|\bgluten free\b/.test(text) && !nextIndex.dietary) {
      nextIndex.dietary = "Gluten Free";
    }
  }

  if (family === "RIC") {
    if (/\bbasmati\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Basmati";
    }
    if (/\bwild rice\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Wild";
    }
    if (/\bbonet\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Bonet";
    }
    if (/\barborio\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Arborio";
    }
    if (/\bcarolina\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Carolina";
    }
    if (/\bparboiled\b/.test(text)) {
      nextIndex.product = "Rice";
      if (!nextIndex.cut) nextIndex.cut = "Parboiled";
    }
    if (/\bbulgur\b/.test(text)) {
      nextIndex.product = "Bulgur";
    }
    if (/\bcouscous\b/.test(text)) {
      nextIndex.product = "Couscous";
    }
  }

  if (family === "LEG") {
    if (/\blentils?\b/.test(text)) {
      nextIndex.product = "Lentils";
    }
    if (/\bfava\b/.test(text)) {
      nextIndex.product = "Fava beans";
    }
    if (/\bbeluga\b|\bbelluga\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Beluga";
    }
    if (/\bomega\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Omega";
    }
  }

  if (family === "CAN") {
    if (/\bbaked beans?\b/.test(text)) nextIndex.product = "Baked beans";
    if (/\bchopped tomatoes?\b/.test(text)) {
      nextIndex.product = "Tomato";
      if (!nextIndex.cut) nextIndex.cut = "Chopped";
    }
    if (/\btomato juice\b/.test(text)) {
      nextIndex.product = "Tomato juice";
    }
    if (/\bpolpa tomato\b/.test(text)) {
      nextIndex.product = "Tomato";
      nextIndex.cut = "Polpa";
    }
    if (/\bstuffed vine leaves\b/.test(text)) {
      nextIndex.product = "Vine leaves";
      if (!nextIndex.cut) nextIndex.cut = "Stuffed";
    }
    if (/\bsun-?dried tomato\b/.test(text)) {
      nextIndex.product = "Tomato";
      if (!nextIndex.style) nextIndex.style = "Sun-dried";
    }
    if (/\banchov(?:y|ies)\b/.test(text)) {
      nextIndex.product = "Anchovy";
      if (/\bfillet\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Fillet";
      if (/\bin oil\b/.test(text) && !nextIndex.style) nextIndex.style = "In oil";
      if (/\bmarinated\b/.test(text) && !nextIndex.style) nextIndex.style = "Marinated";
    }
    if (/\btuna\b/.test(text)) {
      nextIndex.product = "Tuna";
      if (/\bfillet\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Fillet";
      if (/\bin water\b/.test(text) && !nextIndex.style) nextIndex.style = "In water";
    }
    if (/\bcorn\b/.test(text) && !nextIndex.product) nextIndex.product = "Corn";
    if (/\bchickpeas?\b/.test(text)) nextIndex.product = "Chickpeas";
    if (/\bartichoke\b/.test(text)) nextIndex.product = "Artichoke";
    if (/\bblack beans?\b/.test(text)) nextIndex.product = "Black beans";
    if (/\bwhite beans?\b/.test(text)) nextIndex.product = "White beans";
    if (/\bbeetroot\b/.test(text) && !nextIndex.product) nextIndex.product = "Beetroot";
    if (/\bcaper\b/.test(text)) nextIndex.product = "Capers";
    if (/\beggplant pure[eé]\b|\baubergine pure[eé]\b/.test(text)) {
      nextIndex.product = "Aubergine";
      if (!nextIndex.cut) nextIndex.cut = "Puree";
    }
    if (/\bhoney\b/.test(text)) nextIndex.product = "Honey";
    if (/\bpine\b/.test(text) && /\bhoney\b/.test(text) && !nextIndex.style) nextIndex.style = "Pine";
    if (/\bbotanical\b/.test(text) && /\bhoney\b/.test(text) && !nextIndex.style) nextIndex.style = "Botanical";
  }

  if (family === "JAM") {
    if (/\bmarmalade\b/.test(text)) {
      nextIndex.product = "Marmalade";
    }
    if (/\bjam\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Jam";
    }
    if (/\borange\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Orange";
    if (/\bapricot\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Apricot";
    if (/\bfig\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Fig";
    if (/\bstrawberry\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Strawberry";
    if (/\bgrape ?juice\b|\bgrapejuice\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "With grape juice";
    }
    if (/\bmini\b/.test(text) && !nextIndex.style) {
      nextIndex.style = nextIndex.style ? `${nextIndex.style} Mini` : "Mini";
    }
  }

  if (family === "HON") {
    if (/\bhoney\b/.test(text)) nextIndex.product = "Honey";
    if (/\bflower\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Flower";
    if (/\borange\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Orange";
    if (/\bsticks?\b/.test(text) && !nextIndex.style) nextIndex.style = "Sticks";
    if (/\battica\b/.test(text) && !nextIndex.origin) nextIndex.origin = "Greece";
  }

  if (family === "PIC") {
    if (/\bpickled pepper\b/.test(text)) {
      nextIndex.product = "Peppers";
      if (!nextIndex.style) nextIndex.style = "Pickled";
    } else if (/\bpickles?\b/.test(text)) {
      nextIndex.product = "Pickles";
    }
  }

  if (family === "PRA") {
    if (/\bspread\b/.test(text) || /\bnutella\b/.test(text)) {
      nextIndex.product = "Chocolate spread";
    }
  }

  if (family === "BIS") {
    if (/\bbiscuits?\b|\bcookies?\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Biscuits";
    }
    if (/\bdigestive\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Digestive";
    }
    if (/\bcookies?\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Cookies";
    }
    if (/\bchocolate\b/.test(text) && /\bfilling\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Chocolate-filled";
    }
  }

  if (family === "RUB") {
    if (/\bbreadsticks?\b/.test(text)) {
      nextIndex.product = "Breadsticks";
    }
    if (/\brusks?\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Rusks";
    }
    if (/\bwhole wheat\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Whole wheat";
    }
    if (/\bsea salt\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Sea salt";
    }
    if (/\bwholemeal\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Wholemeal";
    }
  }

  if (family === "YOG") {
    if (/\byogh?urt\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Yoghurt";
    }
    if (/\bgreek\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Greek";
    }
    if (/\blactose free\b/.test(text) && !nextIndex.dietary) {
      nextIndex.dietary = "Lactose-free";
    }
    if (/\bkids?\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Kids";
    }
    if (/\bpear\b/.test(text) && !nextIndex.cut) {
      nextIndex.cut = "Pear";
    }
  }

  if (family === "EGG") {
    const packMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*pack\b/);
    const packCount = packMatch ? Number(String(packMatch[1] || "0").replace(",", ".")) : 0;

    if (/\begg yolk\b/.test(text)) {
      nextIndex.product = "Egg";
      nextIndex.cut = "Yolk";
      if (/\bpasteuri[sz]ed\b/.test(text) && !nextIndex.style) nextIndex.style = "Pasteurised";
    } else if (/\begg white\b/.test(text)) {
      nextIndex.product = "Egg";
      nextIndex.cut = "White";
      if (/\bpasteuri[sz]ed\b/.test(text) && !nextIndex.style) nextIndex.style = "Pasteurised";
    } else if (/\beggs?\b/.test(text)) {
      nextIndex.product = "Eggs";
      if (packCount > 0 && !nextIndex.cut) {
        nextIndex.cut = `${Number.isInteger(packCount) ? packCount : Number(packCount.toFixed(3))} pack`;
      }
    }
  }

  if (family === "CER" && /\boat flakes\b/.test(text)) {
    nextIndex.product = "Oats";
    nextIndex.cut = "Flakes";
  }

  if (family === "NUT" && /\bchia seeds?\b/.test(text)) {
    nextIndex.product = "Chia";
    nextIndex.cut = "Seeds";
  }

  if (family === "NUT") {
    if (/\balmond fillet\b|\balmond flakes?\b/.test(text)) {
      nextIndex.product = "Almond";
      if (!nextIndex.cut) nextIndex.cut = "Flakes";
    } else if (/\bwhole almonds?\b|\balmonds?\b/.test(text) && !/\balmond butter\b/.test(text)) {
      nextIndex.product = "Almond";
      if (/\bwhole\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Whole";
      if (/\bsmoked\b/.test(text) && !nextIndex.style) nextIndex.style = "Smoked";
    }
    if (/\bcashews?\b/.test(text) && !nextIndex.product) nextIndex.product = "Cashews";
    if (/\bpistachio\b/.test(text)) nextIndex.product = "Pistachio";
    if (/\bhazelnut\b/.test(text)) nextIndex.product = "Hazelnut";
    if (/\bwalnuts?\b/.test(text)) nextIndex.product = "Walnut";
    if (/\bsesame\b/.test(text)) nextIndex.product = "Sesame";
    if (/\bsunflower seeds?\b/.test(text)) nextIndex.product = "Sunflower seeds";
    if (/\bpoppy seeds?\b/.test(text)) nextIndex.product = "Poppy seeds";
    if (/\bfennel seeds?\b/.test(text)) nextIndex.product = "Fennel seeds";
    if (/\bnutmeg\b/.test(text)) nextIndex.product = "Nutmeg";
    if (/\bblack sesame\b/.test(text)) {
      nextIndex.product = "Sesame";
      if (!nextIndex.style) nextIndex.style = "Black";
    }
    if (/\bwhole\b/.test(text) && ["Cashews", "Pistachio", "Hazelnut", "Walnut"].includes(nextIndex.product) && !nextIndex.cut) {
      nextIndex.cut = "Whole";
    }
    if (/\bpringles\b|\bcrisps?\b|\bchips?\b/.test(text)) {
      nextIndex.product = "Crisps";
    }
    if (/\bbiscuits?\b/.test(text)) {
      nextIndex.product = "Biscuits";
    }
    if ((/\bsalt\b/.test(text) || /\bsalted\b/.test(text)) && !nextIndex.style) nextIndex.style = "Salted";
    if (/\bcream onion\b|\bsour cream\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Sour cream & onion";
    }
  }

  if (family === "CAN" && /\bpolpa tomato\b/.test(text)) {
    nextIndex.product = "Tomato";
    nextIndex.cut = "Polpa";
  }

  if (family === "SPIC" && /\bcurry paste\b/.test(text)) {
    nextIndex.product = "Curry paste";
    if (/\bgreen\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Green";
    }
  }

  if (["OIL", "OLI"].includes(family)) {
    if (/\bextra virgin olive oil\b|\bolive oil\b/.test(text)) {
      nextIndex.product = "Olive oil";
      if (/\bextra virgin\b/.test(text) && !nextIndex.quality) nextIndex.quality = "Extra virgin";
    }
    if (/\bsesame oil\b/.test(text)) nextIndex.product = "Sesame oil";
    if (/\bsunflower oil\b/.test(text)) nextIndex.product = "Sunflower oil";
    if (/\bgrape ?oil\b|\bgrapeseed oil\b/.test(text)) nextIndex.product = "Grapeseed oil";
    if (/\bgreen olives\b/.test(text)) {
      nextIndex.product = "Olives";
      if (!nextIndex.style) nextIndex.style = "Green";
    }
    if (/\bkalamon olives\b|\bolives kalamon\b/.test(text)) {
      nextIndex.product = "Olives";
      if (!nextIndex.cut) nextIndex.cut = "Kalamon";
    }
  }

  if (family === "LEM" && /\blemon\b/.test(text)) {
    nextIndex.product = "Lemon juice";
  }

  if (family === "VIN") {
    if (/\bvinegar\b/.test(text) && !nextIndex.product) {
      nextIndex.product = "Vinegar";
    }
    if (/\bbalsamic\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Balsamic";
    if (/\brice vinegar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Rice";
    if (/\bapple cider vinegar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Apple cider";
    if (/\bvinegar white\b|\bwhite vinegar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "White";
    if (/\bvinegar red\b|\bred vinegar\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Red";
  }

  if (family === "GLFRE" && !nextIndex.dietary) {
    nextIndex.dietary = "Gluten Free";
  }

  if (family === "GLFRE" && /\bpenne rigate\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Penne rigate";
  }

  if (family === "GLFRE" && /\bspaghetti\b/.test(text)) {
    nextIndex.product = "Pasta";
    if (!nextIndex.cut) nextIndex.cut = "Spaghetti";
  }

  if (family === "GLFRE" && /\bbread\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Bread";
  }

  if (family === "GLFRE" && /\btoast\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Toast";
  }

  if (family === "GLFRE" && /\bbread slices?\b|\bslices?\b/.test(text) && /\bbread\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Slices";
  }

  if (/\bbreaded\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Breaded";
  }

  if (family === "FLO" && /\byeast\b/.test(text)) {
    nextIndex.product = "Yeast";
  }

  if (family === "FLO" && /\bnutritional yeast\b/.test(text)) {
    nextIndex.product = "Yeast";
    if (!nextIndex.cut) nextIndex.cut = "Nutritional";
  }

  if (family === "FLO" && /\bcorn flour\b/.test(text)) {
    nextIndex.product = "Flour";
    nextIndex.cut = "Corn flour";
  }

  if (family === "FLO" && /\brice flour\b/.test(text)) {
    nextIndex.product = "Flour";
    nextIndex.cut = "Rice flour";
  }

  if (family === "FLO" && /\bself raise flour\b|\bself raising flour\b|\bself-raising flour\b/.test(text)) {
    nextIndex.product = "Flour";
    nextIndex.cut = "Self-raising";
  }

  if (family === "FLO" && /\bpizza base\b/.test(text)) {
    nextIndex.product = "Flour";
    if (!nextIndex.cut) nextIndex.cut = "Pizza flour";
  }

  if (family === "FLO" && /\bpizza napoletana\b/.test(text)) {
    nextIndex.product = "Flour";
    if (!nextIndex.cut) nextIndex.cut = "Pizza flour";
    if (!nextIndex.style) nextIndex.style = "Napoletana";
  }

  if (family === "FLO" && /\b00\b/.test(text) && /\bpizza\b/.test(text) && !nextIndex.cut) {
    nextIndex.cut = "Pizza flour";
  }

  if (family === "FLO" && /\bflour\b/.test(text) && !nextIndex.product) {
    nextIndex.product = "Flour";
  }

  if (family === "PAST" && /\blasagn[ae]\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Lasagne";
  }

  if (family === "PAST" && /\bgnocchi\b/.test(text)) {
    nextIndex.product = "Gnocchi";
  }

  if (family === "PAST" && /\bnoodles\b/.test(text)) {
    nextIndex.product = "Noodles";
  }

  if (family === "PAST" && /\borzo\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Orzo";
  }

  if (family === "ICEC" && /\bfrozen yo(?:g|gh)urt\b/.test(text)) {
    nextIndex.product = "Frozen yoghurt";
  }

  if (family === "ICEC" && /\bmilkshake ice cream\b/.test(text)) {
    nextIndex.product = "Ice cream";
    if (!nextIndex.cut) nextIndex.cut = "Milkshake";
  }

  if (family === "ICEC" && /\bcornetto\b/.test(text)) {
    nextIndex.product = "Ice cream";
    if (!nextIndex.cut) nextIndex.cut = "Cornetto";
  }

  if (family === "ICEC" && /\bcalippo\b/.test(text)) {
    nextIndex.product = "Ice lolly";
    if (!nextIndex.cut) nextIndex.cut = "Calippo";
  }

  if (family === "ICEC" && /\btwister\b/.test(text)) {
    nextIndex.product = "Ice lolly";
    if (!nextIndex.cut) nextIndex.cut = "Twister";
  }

  if (family === "ICEC" && /\bcone\b/.test(text) && !/\bice cream\b/.test(text)) {
    nextIndex.product = "Ice cream";
    if (!nextIndex.cut) nextIndex.cut = "Cone";
  }

  if (family === "PAST" && /\blinguine\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Linguine";
  }

  if (family === "PAST" && /\btagliatelle\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Tagliatelle";
  }

  if (family === "PAST" && /\brecchiette\b|\borecchiette\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Orecchiette";
  }

  if (family === "PAST" && /\bpennes?\b/.test(text)) {
    nextIndex.product = "Pasta";
    if (!nextIndex.cut) nextIndex.cut = "Penne";
  }

  if (family === "PAST" && /\bpappardelle\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Pappardelle";
  }

  if (family === "PAST" && /\bhilopites?\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Hilopites";
  }

  if (family === "PAST" && /\bspaghett?i\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Spaghetti";
  }

  if (family === "PAST" && /\bmacaroni\b|\bmacaroni #?\d+\b|\bmacaroni n[oº]?\s*\d+\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Macaroni";
  }

  if (family === "PAST" && /\brigatoni\b/.test(text)) {
    nextIndex.product = "Pasta";
    nextIndex.cut = "Rigatoni";
  }

  if (family === "PAST" && /\bsemolina\b/.test(text)) {
    nextIndex.product = "Semolina";
  }

  if (family === "PAST" && /\bfillo(?:ites)?\b|\bfilo\b/.test(text)) {
    nextIndex.product = "Pastry";
    nextIndex.cut = "Filo";
  }

  if (family === "SCEN" && /\bvanilla essence\b/.test(text)) {
    nextIndex.product = "Vanilla";
    nextIndex.cut = "Essence";
  }

  if (family === "SYR") {
    if (/\bsyrups?\b|\bsyrup\b/.test(text)) {
      nextIndex.product = "Syrup";
    }
    if (/\bvanilla\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Vanilla";
    if (/\bcaramel\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Caramel";
    if (/\bhazelnut\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Hazelnut";
    if (/\bstrawberry\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Strawberry";
    if (/\bsour cherry\b/.test(text) && !nextIndex.cut) nextIndex.cut = "Sour cherry";
  }

  if (family === "CHO") {
    if (/\bwhite chocolate\b/.test(text)) {
      nextIndex.product = "Chocolate";
      if (!nextIndex.cut) nextIndex.cut = "White";
    }
    if (/\bmilk chocolate\b/.test(text)) {
      nextIndex.product = "Chocolate";
      if (!nextIndex.cut) nextIndex.cut = "Milk";
    }
    if (/\bdark chocolate\b/.test(text)) {
      nextIndex.product = "Chocolate";
      if (!nextIndex.cut) nextIndex.cut = "Dark";
    }
    if (/\bcouverture\b/.test(text)) {
      nextIndex.product = "Chocolate";
      if (!nextIndex.style) nextIndex.style = "Couverture";
    }
    if (/\bdrops?\b/.test(text) && /\bchocolate\b|\bcouverture\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Drops";
    }
  }

  if (family === "VARPA") {
    if (/\brose ?water\b/.test(text)) nextIndex.product = "Rosewater";
    if (/\bcoco lopez\b/.test(text)) {
      nextIndex.product = "Coconut cream";
    }
    if (/\bagave\b/.test(text)) nextIndex.product = "Agave syrup";
    if (/\bgelatin\b/.test(text)) nextIndex.product = "Gelatin";
    if (/\bmaple syrup\b/.test(text)) nextIndex.product = "Maple syrup";
    if (/\bmolasses?\b|\bmelasse\b/.test(text)) nextIndex.product = "Molasses";
    if (/\btruffle\b/.test(text) && /\bchocolate\b/.test(text)) nextIndex.product = "Chocolate truffle";
    if (/\bcand(?:y|ies)\b|\bmoam\b/.test(text)) nextIndex.product = "Candies";
    if (/\bagar agar\b/.test(text)) nextIndex.product = "Agar agar";
    if (/\bsweetened milk\b/.test(text)) nextIndex.product = "Sweetened milk";
    if (/\bpistachio praline\b/.test(text)) {
      nextIndex.product = "Praline";
      if (!nextIndex.cut) nextIndex.cut = "Pistachio";
    }
    if (/\bfragola\b/.test(text) && /\bpuree\b/.test(text)) {
      nextIndex.product = "Puree";
      if (!nextIndex.cut) nextIndex.cut = "Strawberry";
    }
    if (/\bglycos[ea]\b/.test(text)) nextIndex.product = "Glucose";
  }

  if (family === "PREP" && /\bburger\b/.test(text)) {
    if (!nextIndex.cut) nextIndex.cut = "Burger";
  }

  if (family === "REMA" && /\bvegetable burger\b/.test(text)) {
    nextIndex.product = "Burger";
    if (!nextIndex.cut) nextIndex.cut = "Vegetable";
    if (!nextIndex.dietary) nextIndex.dietary = "Vegetarian";
  }

  if (family === "REMA" && /\bstuffed tomatoes?\b/.test(text)) {
    nextIndex.product = "Tomato";
    if (!nextIndex.cut) nextIndex.cut = "Stuffed";
  }

  if (family === "REMA" && /\bstuffed zucchini\b|\bstuffed courgette\b/.test(text)) {
    nextIndex.product = "Courgette";
    if (!nextIndex.cut) nextIndex.cut = "Stuffed";
  }

  if (family === "REMA" && /\bpastitsio\b/.test(text)) {
    nextIndex.product = "Pastitsio";
  }

  if (family === "REMA" && /\bmousakas?\b|\bmoussaka\b/.test(text)) {
    nextIndex.product = "Moussaka";
  }

  if (family === "REMA" && /\bfalafel\b/.test(text)) {
    nextIndex.product = "Falafel";
    if (/\bbaked\b/.test(text) && !nextIndex.style) {
      nextIndex.style = "Baked";
    }
  }

  if (family === "REMA" && /\bfried onions?\b/.test(text)) {
    nextIndex.product = "Onion";
    if (!nextIndex.style) nextIndex.style = "Fried";
  }

  if (family === "REMA" && /\btzatziki\b/.test(text)) {
    nextIndex.product = "Tzatziki";
  }

  if (family === "COCU" && /\bpepperoni\b/.test(text)) {
    nextIndex.product = "Pepperoni";
  }

  if (family === "COCU" && /\bchorizo\b/.test(text)) {
    nextIndex.product = "Chorizo";
  }

  if (family === "COCU" && /\bprosciutto\b/.test(text)) {
    nextIndex.product = "Prosciutto";
  }

  if (family === "COCU" && /\bbacon\b/.test(text)) {
    nextIndex.product = "Bacon";
  }

  if (family === "COCU" && /\bguanciale\b/.test(text)) {
    nextIndex.product = "Guanciale";
  }

  if (family === "COCU" && /\bcoppa\b/.test(text)) {
    nextIndex.product = "Coppa";
  }

  if (family === "COCU" && /\bnduja\b/.test(text)) {
    nextIndex.product = "Nduja";
  }

  if (family === "COCU" && /\bsalami\b/.test(text)) {
    if (!nextIndex.product) nextIndex.product = "Salami";
  }

  if (family === "COCU" && /\bpork sausage\b/.test(text)) {
    nextIndex.product = "Sausage";
    if (!nextIndex.cut) nextIndex.cut = "Pork";
  }

  if (family === "COCU" && /\bcocktail sausage\b/.test(text)) {
    nextIndex.product = "Sausage";
    if (!nextIndex.cut) nextIndex.cut = "Cocktail";
  }

  if (family === "COCU" && /\bbreakfast bacon\b/.test(text)) {
    nextIndex.product = "Bacon";
    if (!nextIndex.cut) nextIndex.cut = "Breakfast";
  }

  if (family === "COCU" && /\bspicy\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Spicy";
  }

  if (family === "COCU" && /\bsmoked\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Smoked";
  }

  if (family === "COCU" && /\bnapoli\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Napoli";
  }

  if (family === "COCU" && /\bmilano\b/.test(text) && !nextIndex.style) {
    nextIndex.style = "Milano";
  }

  if (/\bbeyondmeat\b|\bbeyond meat\b/.test(text)) {
    if (!nextIndex.brand) nextIndex.brand = "Beyondmeat";
    if (!nextIndex.dietary) nextIndex.dietary = "Vegan";
    if (/\bburger\b/.test(text)) {
      if (!nextIndex.product) nextIndex.product = "Burger";
      if (!nextIndex.cut) nextIndex.cut = "Burger";
    }
  }

  return nextIndex;
}

function parseIngredientIndexWithLearning(rawName, packSize = "", learningRules = [], sourceCode = "") {
  const baseIndex = parseIngredientIndexBase(rawName, packSize);
  const learnedIndex = applyLearningRulesToIndex(baseIndex, rawName, learningRules);
  return {
    nameIndex: applySoft1CodeHintsToIndex(learnedIndex, rawName, sourceCode),
    appliedRules: getAppliedLearningRuleHits(rawName, learningRules),
  };
}

function parseIngredientIndex(rawName, packSize = "", learningRules = [], sourceCode = "") {
  return parseIngredientIndexWithLearning(rawName, packSize, learningRules, sourceCode).nameIndex;
}

function scoreIngredientIndexConfidence(nameIndex, rawName = "") {
  const rawText = String(rawName || "").trim();
  const rawLower = rawText.toLowerCase();
  const recognizedFields = [
    nameIndex.brand,
    nameIndex.product,
    nameIndex.cut,
    nameIndex.quality,
    nameIndex.dietary,
    nameIndex.state,
    nameIndex.origin,
    nameIndex.style,
  ].filter(Boolean).length;

  let score = 20;
  if (nameIndex.product) score += 30;
  if (nameIndex.cut) score += 10;
  if (nameIndex.brand) score += 8;
  if (nameIndex.dietary) score += 10;
  if (nameIndex.origin) score += 8;
  if (nameIndex.state) score += 6;
  if (nameIndex.style) score += 4;
  if (nameIndex.quality) score += 4;
  if (nameIndex.packSize) score += 6;
  if (recognizedFields >= 3) score += 8;
  if (recognizedFields >= 5) score += 6;
  if (rawLower.includes("/") || rawLower.includes(" / ")) score -= 4;
  if (!nameIndex.product) score -= 18;
  if (rawText.length > 32 && recognizedFields < 2) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function getConfidenceLabel(score = 0) {
  if (score >= 75) return "High confidence";
  if (score >= 50) return "Medium confidence";
  return "Needs attention";
}

function explainIngredientIndexConfidence(nameIndex, rawName = "") {
  const recognized = ingredientIndexFields
    .filter((field) => String(nameIndex?.[field.key] || "").trim())
    .map((field) => field.label);

  const missingCore = ingredientIndexFields
    .filter((field) => ["product", "cut", "brand", "dietary", "origin", "state"].includes(field.key))
    .filter((field) => !String(nameIndex?.[field.key] || "").trim())
    .map((field) => field.label);

  const needsAttention = [];
  const rawText = String(rawName || "");
  const normalizedRawText = normalizeIngredientParserText(rawText);
  if (!String(nameIndex?.product || "").trim()) {
    needsAttention.push("Product type was not recognized");
  }
  if (/\blamb\b/.test(normalizedRawText) && /\bbeef\b/.test(normalizedRawText)) {
    needsAttention.push("Species conflict in source wording");
  }
  if (rawText.includes("/") || rawText.includes(" / ")) {
    needsAttention.push("Slash-style wording may need manual cleanup");
  }
  if (rawText.length > 32 && recognized.length < 2) {
    needsAttention.push("Long source name with limited structured matches");
  }

  return {
    recognized,
    missingCore,
    needsAttention,
  };
}

function composeCleanIngredientName(nameIndex, fallbackRawName = "") {
  const isCheeseWithType =
    normalizeIngredientKey(nameIndex.product) === "cheese" && Boolean(String(nameIndex.cut || "").trim());
  const base = isCheeseWithType
    ? `${nameIndex.cut} cheese`
    : [nameIndex.product, nameIndex.cut].filter(Boolean).join(" ");
  if (!base) return titleCaseWords(fallbackRawName);

  const segments = cleanNameFieldOrder.reduce((list, key) => {
    const value = nameIndex[key];
    if (!value) return list;
    if (key === "product" || key === "cut") {
      if (!list.length) return [base];
      return list;
    }
    return [...list, value];
  }, [base]);

  return `${segments.map((segment) => titleCaseWords(segment)).join(" - ")}${nameIndex.origin ? ` (${titleCaseWords(nameIndex.origin)})` : ""}`;
}

function formatCanonicalIngredientName(rawName, packSize = "") {
  return composeCleanIngredientName(parseIngredientIndex(rawName, packSize), rawName);
}

function countIngredientNameTokens(value = "") {
  return normalizeIngredientKey(value)
    .split(" ")
    .filter(Boolean).length;
}

function isOverGenericIngredientSuggestion(nameIndex = {}, suggestedName = "", currentName = "", referenceName = "") {
  const suggestedKey = normalizeIngredientKey(suggestedName || "");
  const productKey = normalizeIngredientKey(nameIndex?.product || "");
  if (!suggestedKey || !productKey || suggestedKey !== productKey) return false;

  const onlyHasBroadProduct = ![
    nameIndex?.brand,
    nameIndex?.cut,
    nameIndex?.quality,
    nameIndex?.dietary,
    nameIndex?.state,
    nameIndex?.origin,
    nameIndex?.style,
  ].some((value) => String(value || "").trim());

  if (!onlyHasBroadProduct) return false;

  return Math.max(countIngredientNameTokens(currentName || ""), countIngredientNameTokens(referenceName || "")) > 1;
}

const broadLearningRuleTerms = new Set([
  "anchovy",
  "beans",
  "bread",
  "burger",
  "cheese",
  "chicken",
  "clams",
  "corn flour",
  "curry paste",
  "egg",
  "edam",
  "fillet",
  "flour",
  "gluten free",
  "gouda",
  "grapes",
  "king prawns",
  "leg",
  "linguine",
  "milk",
  "mussels",
  "octopus",
  "oat flakes",
  "olive oil",
  "pasta",
  "penne rigate",
  "polpa tomato",
  "pork",
  "prawns",
  "salmon",
  "sea bass",
  "smoked",
  "steak",
  "swordfish",
  "tomato",
  "tomatoes",
  "vanilla",
  "vegan",
  "yeast",
]);

function getLearningRuleRisk(rule = {}) {
  const normalizedTrigger = normalizeIngredientKey(rule.trigger || "");
  if (!normalizedTrigger) {
    return {
      isBroad: false,
      reasons: [],
    };
  }

  const tokens = normalizedTrigger.split(" ").filter(Boolean);
  const reasons = [];
  const isVeryShort = normalizedTrigger.length > 0 && normalizedTrigger.length <= 3;
  const isSingleToken = tokens.length === 1;
  const isGenericFoodTerm = broadLearningRuleTerms.has(normalizedTrigger);
  const isGenericQualifier =
    ["fresh", "frozen", "green", "red", "white", "full fat", "extra virgin", "00"].includes(normalizedTrigger);

  if (isVeryShort) reasons.push("Very short trigger");
  if (isSingleToken) reasons.push("One-word trigger");
  if (isGenericFoodTerm) reasons.push("Generic food term");
  if (isGenericQualifier) reasons.push("Generic qualifier");
  if ((rule.field === "product" || rule.field === "cut") && tokens.length <= 2) {
    reasons.push("Directly sets a core name field");
  }

  return {
    isBroad: reasons.length > 0,
    reasons,
  };
}

function getIngredientRuleCatchupSuggestion(ingredient = {}, learningRules = [], sourceRows = []) {
  if (!ingredient || ingredient.archived) return null;

  const rawReference = getIngredientMasterReferenceRawName(ingredient, sourceRows);
  const effectiveSourceCode = getEffectiveIngredientSourceCode(ingredient);
  const { nameIndex } = parseIngredientIndexWithLearning(
    rawReference,
    ingredient.packSize,
    learningRules,
    effectiveSourceCode
  );
  const suggestedName = composeCleanIngredientName(nameIndex, rawReference);
  const suggestedCategory = getSoft1CodeCategorySuggestion(effectiveSourceCode, nameIndex, rawReference);
  const currentNameKey = normalizeIngredientKey(ingredient.name || "");
  const suggestedNameKey = normalizeIngredientKey(suggestedName || "");
  const currentCategoryKey = normalizeIngredientKey(ingredient.category || "");
  const suggestedCategoryKey = normalizeIngredientKey(suggestedCategory || "");
  const currentNameTokenCount = countIngredientNameTokens(ingredient.name || "");
  const suggestedNameTokenCount = countIngredientNameTokens(suggestedName || "");
  const suggestedNameLooksLessSpecific =
    Boolean(suggestedNameKey) &&
    suggestedNameTokenCount > 0 &&
    currentNameTokenCount > suggestedNameTokenCount &&
    currentNameKey.includes(suggestedNameKey);
  const suggestedNameTooGeneric = isOverGenericIngredientSuggestion(
    nameIndex,
    suggestedName,
    ingredient.name || "",
    rawReference
  );

  const nameChanged = Boolean(
    suggestedNameKey &&
    suggestedNameKey !== currentNameKey &&
    !suggestedNameLooksLessSpecific &&
    !suggestedNameTooGeneric
  );
  const categoryChanged = Boolean(
    suggestedCategoryKey &&
    (isWeakIngredientCategory(ingredient.category || "") ||
      isLegacyCategoryCatchupTarget(ingredient.category || "", suggestedCategory || "", effectiveSourceCode)) &&
    suggestedCategoryKey !== currentCategoryKey
  );

  if (!nameChanged && !categoryChanged) return null;

  return {
    suggestedName,
    suggestedCategory,
    nameChanged,
    categoryChanged,
  };
}

function getIngredientRuleCatchupSignature(suggestion = null) {
  if (!suggestion) return "";
  return JSON.stringify({
    suggestedName: String(suggestion?.suggestedName || "").trim(),
    suggestedCategory: String(suggestion?.suggestedCategory || "").trim(),
    nameChanged: Boolean(suggestion?.nameChanged),
    categoryChanged: Boolean(suggestion?.categoryChanged),
  });
}

function inferLearningTrigger(rawName, field, value) {
  const rawKey = normalizeIngredientKey(rawName);
  const valueKey = normalizeIngredientKey(value);
  const triggerOptions = learningRuleTriggerPhrases[field] || [];

  const matchedTrigger = triggerOptions.find((phrase) => rawKey.includes(normalizeIngredientKey(phrase)));
  if (matchedTrigger) return matchedTrigger;
  if (valueKey && rawKey.includes(valueKey)) return value;
  return "";
}

function getLearningRuleCandidates(row, learningRules = []) {
  if (!row) return [];

  const baseIndex = parseIngredientIndexBase(row.rawName, row.packSize);

  return ingredientIndexFields
    .map((field) => {
      const nextValue = String(row.nameIndex?.[field.key] || "").trim();
      const previousValue = String(baseIndex?.[field.key] || "").trim();
      if (!nextValue || normalizeIngredientKey(nextValue) === normalizeIngredientKey(previousValue)) {
        return null;
      }

      const trigger = inferLearningTrigger(row.rawName, field.key, nextValue);
      if (!trigger) return null;

      const duplicateRule = (learningRules || []).some(
        (rule) =>
          rule.field === field.key &&
          normalizeIngredientKey(rule.trigger) === normalizeIngredientKey(trigger) &&
          normalizeIngredientKey(rule.value) === normalizeIngredientKey(nextValue)
      );
      if (duplicateRule) return null;

      return {
        id: `${field.key}-${normalizeIngredientKey(trigger)}`,
        field: field.key,
        label: field.label,
        trigger,
        value: nextValue,
      };
    })
    .filter(Boolean);
}

function findIngredientBySourceCode(ingredients, sourceCode) {
  const normalizedSourceCode = normalizeIngredientCodeToken(sourceCode);
  if (!normalizedSourceCode) return null;

  const liveMatch =
    ingredients.find((ingredient) => {
      const ingredientSourceCode = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(ingredient));
      return !ingredient.archived && Boolean(ingredientSourceCode && ingredientSourceCode === normalizedSourceCode);
    }) || null;
  if (liveMatch) return liveMatch;

  return (
    ingredients.find((ingredient) => {
      const ingredientSourceCode = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(ingredient));
      return Boolean(ingredientSourceCode && ingredientSourceCode === normalizedSourceCode);
    }) || null
  );
}

function findIngredientByImportedSourceCode(ingredients, sourceCode, redirectState = {}) {
  const normalizedSourceCode = normalizeIngredientCodeToken(sourceCode);
  if (!normalizedSourceCode) return null;

  const directMatch = findIngredientBySourceCode(ingredients, normalizedSourceCode);
  if (directMatch && !directMatch.archived) return directMatch;

  const redirectedTargetId = String(redirectState?.[normalizedSourceCode]?.targetIngredientId || "").trim();
  if (!redirectedTargetId) return directMatch && !directMatch.archived ? directMatch : null;

  const redirectedTarget =
    (ingredients || []).find((ingredient) => ingredient.id === redirectedTargetId && !ingredient.archived) || null;
  return redirectedTarget || (directMatch && !directMatch.archived ? directMatch : null);
}

function findIngredientByInternalCode(ingredients, code) {
  const key = normalizeIngredientKey(code);
  return ingredients.find((ingredient) => normalizeIngredientKey(ingredient.code) === key) || null;
}

function findIngredientByName(ingredients, name) {
  const key = normalizeIngredientKey(name);
  return ingredients.find((ingredient) => normalizeIngredientKey(ingredient.name) === key) || null;
}

function findIngredientByAlias(ingredients, name) {
  const key = normalizeIngredientKey(name);
  return (
    ingredients.find((ingredient) =>
      (ingredient.aliases || []).some((alias) => normalizeIngredientKey(alias) === key)
    ) || null
  );
}

function isLikelyReconcileMatch(baseIngredient, candidateIngredient, suggestedName, rawName) {
  if (!candidateIngredient || !baseIngredient) return false;

  const baseCategory = normalizeIngredientKey(baseIngredient.category);
  const candidateCategory = normalizeIngredientKey(candidateIngredient.category);
  if (baseCategory && candidateCategory && baseCategory !== candidateCategory) return false;

  const basePack = normalizeIngredientKey(baseIngredient.packSize);
  const candidatePack = normalizeIngredientKey(candidateIngredient.packSize);
  if (basePack && candidatePack && basePack !== candidatePack) return false;

  const baseNameKey = normalizeIngredientKey(suggestedName || rawName || baseIngredient.name);
  const candidateNameKey = normalizeIngredientKey(candidateIngredient.name);
  if (baseNameKey && candidateNameKey && baseNameKey !== candidateNameKey) {
    const rawKey = normalizeIngredientKey(rawName);
    const candidateAliasMatch = (candidateIngredient.aliases || []).some(
      (alias) => normalizeIngredientKey(alias) === rawKey
    );
    if (!candidateAliasMatch) return false;
  }

  return true;
}

function findReconcileMatch(ingredient, trustedIngredients, suggestedName, rawName) {
  const sourceCode = String(ingredient?.sourceCode || ingredient?.code || "").trim();
  const internalCode = String(ingredient?.code || "").trim();
  const currentId = ingredient?.id || "";

  const strongSourceMatch =
    sourceCode &&
    trustedIngredients.find(
      (candidate) => candidate.id !== currentId && String(candidate.sourceCode || "").trim() === sourceCode
    );
  if (strongSourceMatch) {
    return {
      ingredient: strongSourceMatch,
      type: "source-code",
      autoMerge: true,
    };
  }

  const strongInternalMatch =
    internalCode &&
    trustedIngredients.find(
      (candidate) => candidate.id !== currentId && normalizeIngredientKey(candidate.code) === normalizeIngredientKey(internalCode)
    );
  if (strongInternalMatch) {
    return {
      ingredient: strongInternalMatch,
      type: "internal-code",
      autoMerge: true,
    };
  }

  const exactNameMatch = findIngredientByName(trustedIngredients, suggestedName);
  if (
    exactNameMatch &&
    exactNameMatch.id !== currentId &&
    isLikelyReconcileMatch(ingredient, exactNameMatch, suggestedName, rawName)
  ) {
    return {
      ingredient: exactNameMatch,
      type: "name",
      autoMerge: false,
    };
  }

  const aliasMatch = findIngredientByAlias(trustedIngredients, rawName);
  if (
    aliasMatch &&
    aliasMatch.id !== currentId &&
    isLikelyReconcileMatch(ingredient, aliasMatch, suggestedName, rawName)
  ) {
    return {
      ingredient: aliasMatch,
      type: "alias",
      autoMerge: false,
    };
  }

  return null;
}

function scoreMergeTargetCandidate(row, ingredient) {
  if (!row || !ingredient) return 0;

  let score = 0;
  const rowSourceCode = normalizeIngredientKey(row.sourceCode);
  const rowInternalCode = normalizeIngredientKey(row.internalCode);
  const ingredientSourceCode = normalizeIngredientKey(getEffectiveIngredientSourceCode(ingredient));
  const ingredientCode = normalizeIngredientKey(ingredient.code);
  const rowSuggestedName = normalizeIngredientKey(row.suggestedName || row.chosenName || "");
  const rowRawName = normalizeIngredientKey(row.rawName);
  const ingredientName = normalizeIngredientKey(ingredient.name);
  const rowSuggestedCompact = compactIngredientKey(row.suggestedName || row.chosenName || "");
  const rowRawCompact = compactIngredientKey(row.rawName);
  const ingredientNameCompact = compactIngredientKey(ingredient.name);
  const ingredientAliases = (ingredient.aliases || []).map((alias) => normalizeIngredientKey(alias));
  const ingredientAliasCompacts = (ingredient.aliases || []).map((alias) => compactIngredientKey(alias));
  const rowProduct = normalizeIngredientKey(row.nameIndex?.product || "");
  const ingredientProduct = normalizeIngredientKey(parseIngredientIndexBase(ingredient.name, ingredient.packSize).product || "");
  const rowCategory = normalizeIngredientKey(row.productCategory || row.tradeCategory || row.category || "");
  const ingredientCategory = normalizeIngredientKey(ingredient.category || "");
  const rowPackSize = normalizeIngredientKey(row.packSize || "");
  const ingredientPackSize = normalizeIngredientKey(ingredient.packSize || "");

  if (rowSourceCode && ingredientSourceCode && rowSourceCode === ingredientSourceCode) score += 220;
  if (rowInternalCode && ingredientCode && rowInternalCode === ingredientCode) score += 180;
  if (rowSuggestedName && ingredientName && rowSuggestedName === ingredientName) score += 120;
  if (rowRawName && ingredientName && rowRawName === ingredientName) score += 110;
  if (rowRawName && ingredientAliases.includes(rowRawName)) score += 100;
  if (rowSuggestedName && ingredientAliases.includes(rowSuggestedName)) score += 90;
  if (rowSuggestedCompact && ingredientNameCompact && rowSuggestedCompact === ingredientNameCompact) score += 90;
  if (rowRawCompact && ingredientNameCompact && rowRawCompact === ingredientNameCompact) score += 80;
  if (rowRawCompact && ingredientAliasCompacts.includes(rowRawCompact)) score += 70;
  if (rowSuggestedCompact && ingredientAliasCompacts.includes(rowSuggestedCompact)) score += 65;

  const fuzzyNameScore = Math.max(
    scoreFuzzyIngredientNameMatch(row.suggestedName || row.chosenName || "", ingredient.name),
    scoreFuzzyIngredientNameMatch(row.rawName, ingredient.name),
    ...ingredient.aliases.map((alias) =>
      Math.max(
        scoreFuzzyIngredientNameMatch(row.suggestedName || row.chosenName || "", alias),
        scoreFuzzyIngredientNameMatch(row.rawName, alias)
      )
    )
  );
  score += fuzzyNameScore;

  if (rowProduct && ingredientProduct && rowProduct === ingredientProduct) score += 35;
  if (rowCategory && ingredientCategory && rowCategory === ingredientCategory) score += 24;
  if (rowPackSize && ingredientPackSize && rowPackSize === ingredientPackSize) score += 12;

  ["brand", "dietary", "origin", "state"].forEach((field) => {
    const rowValue = normalizeIngredientKey(row.nameIndex?.[field] || "");
    const ingredientValue = normalizeIngredientKey(parseIngredientIndexBase(ingredient.name, ingredient.packSize)?.[field] || "");
    if (rowValue && ingredientValue && rowValue === ingredientValue) {
      score += 8;
    }
  });

  return score;
}

function buildIngredientAliases(existingAliases = [], row) {
  return dedupeTextList([
    ...existingAliases,
    row.rawName,
    row.suggestedName !== row.chosenName ? row.suggestedName : "",
  ]).filter((alias) => normalizeIngredientKey(alias) !== normalizeIngredientKey(row.chosenName));
}

function getReconcileReferenceRawName(ingredient = {}) {
  const storedReference = String(ingredient.referenceRawName || "").trim();
  if (storedReference) return storedReference;
  const ingredientNameKey = normalizeIngredientKey(ingredient.name || "");
  const aliasReference = (ingredient.aliases || []).find(
    (alias) => normalizeIngredientKey(alias) && normalizeIngredientKey(alias) !== ingredientNameKey
  );

  return String(aliasReference || ingredient.name || "").trim() || "Untitled ingredient";
}

function findSoft1SourceRowByCode(sourceRows = [], sourceCode = "") {
  const normalizedCode = normalizeIngredientCodeToken(sourceCode);
  if (!normalizedCode) return null;
  return (
    (sourceRows || []).find((row) => normalizeIngredientCodeToken(row?.sourceCode || "") === normalizedCode) || null
  );
}

function getIngredientMasterReferenceRawName(ingredient = {}, sourceRows = []) {
  const matchedSourceRow = findSoft1SourceRowByCode(sourceRows, getEffectiveIngredientSourceCode(ingredient));
  const sourceRawName = String(matchedSourceRow?.rawName || "").trim();
  if (sourceRawName) return sourceRawName;
  return getReconcileReferenceRawName(ingredient);
}

function getIngredientRedirectedSourceDetails(ingredient = {}, redirectState = {}, sourceRows = []) {
  const targetId = String(ingredient?.id || "").trim();
  if (!targetId) {
    return {
      sourceCodes: [],
      rawNames: [],
    };
  }

  const sourceRowByNormalizedCode = new Map(
    (sourceRows || []).map((row) => [normalizeIngredientCodeToken(row?.sourceCode || ""), row]).filter(([key]) => Boolean(key))
  );

  const redirectedEntries = Object.entries(redirectState || {}).filter(([, entry]) => {
    return String(entry?.targetIngredientId || "").trim() === targetId;
  });

  const sourceCodes = dedupeTextList(
    redirectedEntries.map(([normalizedCode]) => {
      const matchedRow = sourceRowByNormalizedCode.get(normalizedCode);
      return String(matchedRow?.sourceCode || normalizedCode || "").trim();
    })
  );

  const rawNames = dedupeTextList(
    redirectedEntries.map(([normalizedCode]) => {
      const matchedRow = sourceRowByNormalizedCode.get(normalizedCode);
      return String(matchedRow?.rawName || "").trim();
    })
  );

  return {
    sourceCodes,
    rawNames,
  };
}

function getIngredientSearchCorpusParts(
  ingredient = {},
  { batchMap = new Map(), sourceRows = [], redirectState = {} } = {}
) {
  const componentIdentifier = getIngredientComponentIdentifier(ingredient, batchMap);
  const effectiveSourceCode = getEffectiveIngredientSourceCode(ingredient);
  const effectiveReferenceRawName = getIngredientMasterReferenceRawName(ingredient, sourceRows);
  const redirectedSourceDetails = getIngredientRedirectedSourceDetails(ingredient, redirectState, sourceRows);
  const searchAliases = Array.isArray(ingredient.aliases) ? ingredient.aliases : [];

  return dedupeTextList([
    ingredient.name,
    ingredient.code,
    ingredient.sourceCode,
    effectiveSourceCode,
    ingredient.supplier,
    ingredient.category,
    componentIdentifier,
    ingredient.referenceRawName,
    effectiveReferenceRawName,
    ...searchAliases,
    ...(redirectedSourceDetails.sourceCodes || []),
    ...(redirectedSourceDetails.rawNames || []),
  ]);
}

function getIngredientSearchCorpusText(
  ingredient = {},
  { batchMap = new Map(), sourceRows = [], redirectState = {} } = {}
) {
  return getIngredientSearchCorpusParts(ingredient, { batchMap, sourceRows, redirectState })
    .map((value) => normalizeSearchText(value))
    .join(" ");
}

function buildIngredientReviewNamingContext(ingredient = {}, sourceRows = [], existingEntry = {}) {
  const rawReference = getIngredientMasterReferenceRawName(ingredient, sourceRows);
  const ingredientNameKey = normalizeIngredientKey(ingredient.name || "");
  const aliases = dedupeTextList([
    ...(existingEntry?.aliases || []),
    ...(ingredient?.aliases || []),
    rawReference,
  ]).filter((alias) => normalizeIngredientKey(alias) && normalizeIngredientKey(alias) !== ingredientNameKey);

  return {
    referenceRawName: rawReference || String(existingEntry?.referenceRawName || "").trim(),
    aliases,
  };
}

function withIngredientReviewNamingContext(entry = {}, ingredient = {}, sourceRows = [], existingEntry = {}) {
  return {
    ...entry,
    ...buildIngredientReviewNamingContext(ingredient, sourceRows, existingEntry),
  };
}

function isImportRowAlreadyRepresentedInMaster(row = {}, ingredients = [], sourceCodeRedirectState = {}) {
  return Boolean(findTrustedImportCoverageTarget(row, ingredients, sourceCodeRedirectState));
}

function findTrustedImportCoverageTarget(row = {}, ingredients = [], sourceCodeRedirectState = {}) {
  const trustedIngredients = (ingredients || []).filter(
    (ingredient) => !ingredient.archived && getIngredientMasterReviewStatus(ingredient) !== "review"
  );
  const sourceCode = String(row?.sourceCode || "").trim();
  if (sourceCode) {
    return findIngredientByImportedSourceCode(trustedIngredients, sourceCode, sourceCodeRedirectState);
  }

  const rawName = String(row?.rawName || "").trim();
  if (!rawName) return null;

  return findIngredientByName(trustedIngredients, rawName) || findIngredientByAlias(trustedIngredients, rawName) || null;
}

function findAnyImportCoverageOwner(row = {}, ingredients = [], sourceCodeRedirectState = {}) {
  const sourceCode = String(row?.sourceCode || "").trim();
  if (sourceCode) {
    return findIngredientBySourceCode(ingredients || [], sourceCode) || null;
  }

  const rawName = String(row?.rawName || "").trim();
  if (!rawName) return null;

  return findIngredientByAlias(ingredients || [], rawName) || findIngredientByName(ingredients || [], rawName) || null;
}

function findLiveImportCoverageTarget(row = {}, ingredients = [], sourceCodeRedirectState = {}) {
  const liveIngredients = (ingredients || []).filter((ingredient) => !ingredient.archived);
  const sourceCode = String(row?.sourceCode || "").trim();
  if (sourceCode) {
    const sourceCodeMatch = findIngredientByImportedSourceCode(liveIngredients, sourceCode, sourceCodeRedirectState);
    if (sourceCodeMatch) return sourceCodeMatch;
  }

  const rawName = String(row?.rawName || "").trim();
  if (!rawName) return null;

  return findIngredientByAlias(liveIngredients, rawName) || findIngredientByName(liveIngredients, rawName) || null;
}

function isImportCoverageTargetSearchable(
  row = {},
  ingredient = null,
  { batchMap = new Map(), sourceRows = [], redirectState = {} } = {}
) {
  if (!ingredient) return false;

  const searchCorpus = getIngredientSearchCorpusText(ingredient, {
    batchMap,
    sourceRows,
    redirectState,
  });
  const sourceCodeSearch = normalizeSearchText(row?.sourceCode || "");
  const rawNameSearch = normalizeSearchText(row?.rawName || "");

  return Boolean((sourceCodeSearch && searchCorpus.includes(sourceCodeSearch)) || (rawNameSearch && searchCorpus.includes(rawNameSearch)));
}

function resolveImportSourceRowState(
  row = {},
  options = {}
) {
  return resolveIngredientImportSourceRowState(row, {
    ...options,
    buildIgnoredImportRowKey,
    isImportRowIgnored,
    isImportRowResolved,
    findAnyImportCoverageOwner,
    findTrustedImportCoverageTarget,
    findLiveImportCoverageTarget,
    isImportCoverageTargetSearchable,
  });
}

function annotatePossibleDuplicateImportRows(rows = []) {
  const groups = (rows || []).reduce((map, row) => {
    const nameKey = normalizeIngredientKey(row.suggestedName || row.chosenName || row.rawName || "");
    const packKey = normalizeIngredientKey(row.packSize || "");
    if (!nameKey || !packKey) return map;
    const groupKey = `${nameKey}__${packKey}`;
    const current = map.get(groupKey) || [];
    current.push(row);
    map.set(groupKey, current);
    return map;
  }, new Map());

  return (rows || []).map((row) => {
    const nameKey = normalizeIngredientKey(row.suggestedName || row.chosenName || row.rawName || "");
    const packKey = normalizeIngredientKey(row.packSize || "");
    const groupKey = nameKey && packKey ? `${nameKey}__${packKey}` : "";
    const matches = groupKey ? groups.get(groupKey) || [] : [];
    const distinctSourceCodes = new Set(matches.map((item) => normalizeIngredientCodeToken(item.sourceCode || ""))).size;
    const possibleDuplicateReview = matches.length > 1 && distinctSourceCodes > 1;
    return {
      ...row,
      possibleDuplicateReview,
      possibleDuplicateCount: possibleDuplicateReview ? matches.length : 0,
    };
  });
}

function buildImportRows(
  rows,
  ingredients,
  learningRules = [],
  ignoredImportRows = {},
  resolvedImportRows = {},
  sourceCodeRedirectState = {}
) {
  const activeRows = (rows || []).filter((row) => {
    const resolution = resolveImportSourceRowState(row, {
      ingredients,
      ignoredImportRows,
      resolvedImportRows,
      sourceCodeRedirectState,
    });
    return resolution.state === "review";
  });
  const counts = activeRows.reduce((map, row) => {
    map.set(row.sourceCode, (map.get(row.sourceCode) || 0) + 1);
    return map;
  }, new Map());

  const orderMap = new Map();

  const builtRows = activeRows.map((row) => {
    const { nameIndex, appliedRules } = parseIngredientIndexWithLearning(row.rawName, row.packSize, learningRules, row.sourceCode);
    const categoryFields = deriveImportCategoryFields({
      category: row.category,
      tradeCategory: row.tradeCategory,
      productCategory: row.productCategory,
      sourceCode: row.sourceCode,
      rawName: row.rawName,
      parsedState: nameIndex.state,
      nameIndex,
    });
    const suggestion = composeCleanIngredientName(nameIndex, row.rawName);
    const confidenceScore = scoreIngredientIndexConfidence(nameIndex, row.rawName);
    const confidenceBreakdown = explainIngredientIndexConfidence(nameIndex, row.rawName);
    const existingByCode = findIngredientByImportedSourceCode(ingredients, row.sourceCode, sourceCodeRedirectState);
    const existingByName = findIngredientByName(ingredients, suggestion);
    const existingByAlias = findIngredientByAlias(ingredients, row.rawName);
    if (existingByCode) {
      return null;
    }
    const updateIngredient = existingByCode || null;
    const mergeIngredient = !updateIngredient ? existingByAlias || null : null;
    const matchedIngredient = updateIngredient || mergeIngredient;
    const suggestedMergeIngredient = !matchedIngredient ? existingByName || null : null;
    const duplicateCount = counts.get(row.sourceCode) || 1;
    const nextIndex = (orderMap.get(row.sourceCode) || 0) + 1;
    orderMap.set(row.sourceCode, nextIndex);
    const packSizeNeedsReview = requiresImportPackSizeReview(row.rawName, row.sourceUnit, row.packSize, row.sourceCode);
    const likelyMultipackReview = isLikelyMultipackSnackImport(row.rawName, row.sourceUnit, row.averagePrice, row.sourceCode);

    const variationCode = duplicateCount > 1 ? createVariationCode(row.sourceCode, nextIndex) : row.sourceCode;
    const strategy = updateIngredient ? "update" : mergeIngredient ? "merge" : "create";
    const targetId = matchedIngredient?.id || "";
    const targetName = matchedIngredient?.name || "";
    const needsCodeReview = duplicateCount > 1;
    const aliasCandidate = normalizeIngredientKey(row.rawName) !== normalizeIngredientKey(targetName || suggestion) ? row.rawName : "";

    return {
      ...row,
      category: categoryFields.category,
      productCategory: categoryFields.productCategory,
      tradeCategory: categoryFields.tradeCategory,
      nameIndex,
      suggestedName: suggestion,
      confidenceScore,
      confidenceLabel: getConfidenceLabel(confidenceScore),
      confidenceBreakdown,
      appliedLearningRules: appliedRules,
      packSizeNeedsReview,
      likelyMultipackReview,
      categoryStateConflict: categoryFields.categoryStateConflict,
      explicitState: categoryFields.explicitState,
      assumedFreshSeafood: categoryFields.assumedFreshSeafood,
      assumedFrozenProduce: categoryFields.assumedFrozenProduce,
      assumedFrozenFruit: categoryFields.assumedFrozenFruit,
      chosenName: matchedIngredient?.name || suggestion,
      useSuggestedName: !matchedIngredient,
      internalCode: matchedIngredient?.code || variationCode,
      strategy,
      targetId,
      targetName,
      existingIngredientId: updateIngredient?.id || "",
      existingSharedRecordId: updateIngredient?.sharedRecordId || "",
      suggestedTargetId: suggestedMergeIngredient?.id || "",
      suggestedTargetName: suggestedMergeIngredient?.name || "",
      duplicateCount,
      needsCodeReview,
      aliasCandidate,
      reviewStatus: "review",
      decisionNote: needsCodeReview
        ? "Shared source code found. Decide which row keeps the base code and which should publish as a variation."
        : likelyMultipackReview
          ? "This piece-based snack line looks too expensive to be a single unit. Review whether the source row is really a retail box or multipack before publishing."
        : categoryFields.assumedFreshSeafood
          ? "This seafood row sits in a frozen trade bucket, but the source name does not say frozen, so it has been treated as fresh for review."
        : categoryFields.assumedFrozenProduce
          ? "This produce row sits in a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review."
        : categoryFields.assumedFrozenFruit
          ? "This fruit row sits in a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review."
        : categoryFields.categoryStateConflict
          ? `The source wording says ${String(categoryFields.explicitState || "").toLowerCase()}, so the meat category was adjusted away from the imported category before publishing.`
        : packSizeNeedsReview
          ? "This source row looks like a piece-based pack without a clear pack size. Review the pack details before publishing."
        : existingByCode
          ? "Matched live ingredient by source code. Review and approve to refresh the master ingredient, including pricing."
          : existingByAlias
            ? "Matched by a stored alias from a previous import"
            : suggestedMergeIngredient
              ? "Possible merge candidate found by exact clean name. Review it manually if you want to consolidate."
              : "Review this row, then mark it ready when you’re happy with the clean ingredient.",
      published: false,
      reconcileMode: Boolean(updateIngredient),
    };
  });

  return annotatePossibleDuplicateImportRows(builtRows.filter(Boolean)).map((row) => ({
    ...row,
    decisionNote: row.possibleDuplicateReview && !row.needsCodeReview
      ? `Possible duplicate: ${row.possibleDuplicateCount} rows share the same clean name and pack size. Review before publishing.`
      : row.decisionNote,
  }));
}

function buildReconcileImportRows(reviewIngredients = [], trustedIngredients = [], learningRules = [], sourceRows = [], ignoredImportRows = {}) {
  const sourceRowsByCode = (sourceRows || []).reduce((map, row) => {
    const sourceCode = String(row?.sourceCode || "").trim();
    if (sourceCode && !map.has(sourceCode)) {
      map.set(sourceCode, row);
    }
    return map;
  }, new Map());

  return (reviewIngredients || [])
    .filter((ingredient) => {
      const rawName = getReconcileReferenceRawName(ingredient);
      const sourceCode = String(ingredient?.sourceCode || ingredient?.code || "").trim();
      const ignoreKey = buildIgnoredImportRowKey(sourceCode, rawName);
      return !ignoreKey || !ignoredImportRows?.[ignoreKey]?.flagged;
    })
    .map((ingredient, index) => {
    const rawName = getReconcileReferenceRawName(ingredient);
    const packSize = String(ingredient.packSize || "").trim();
    const sourceCode = String(ingredient.sourceCode || ingredient.code || "").trim();
    const internalCode = String(ingredient.code || "").trim();
    const matchedSourceRow = sourceRowsByCode.get(sourceCode) || null;
    const { nameIndex, appliedRules } = parseIngredientIndexWithLearning(rawName, packSize, learningRules, sourceCode);
    const categoryFields = deriveImportCategoryFields({
      category: ingredient.category,
      tradeCategory: ingredient.tradeCategory || matchedSourceRow?.tradeCategory || "",
      productCategory: matchedSourceRow?.productCategory || "",
      sourceCode,
      rawName,
      parsedState: nameIndex.state,
      nameIndex,
    });
    const packSizeNeedsReview = requiresImportPackSizeReview(
      rawName,
      matchedSourceRow?.sourceUnit || "",
      packSize,
      sourceCode
    );
    const likelyMultipackReview = isLikelyMultipackSnackImport(
      rawName,
      matchedSourceRow?.sourceUnit || "",
      Number(ingredient.unitCost || 0),
      sourceCode
    );
    const suggestedName = composeCleanIngredientName(nameIndex, rawName);
    const confidenceScore = scoreIngredientIndexConfidence(nameIndex, rawName);
    const confidenceBreakdown = explainIngredientIndexConfidence(nameIndex, rawName);
    const matchedIngredient = findReconcileMatch(ingredient, trustedIngredients, suggestedName, rawName);
    const autoMergeIngredient = matchedIngredient?.autoMerge ? matchedIngredient.ingredient : null;
    const suggestedMergeIngredient = !matchedIngredient?.autoMerge ? matchedIngredient?.ingredient || null : null;
    const strategy = autoMergeIngredient ? "merge" : "update";
    const targetIngredient = autoMergeIngredient || ingredient;

    return {
      id: `reconcile-${ingredient.id || index + 1}`,
      rawName,
      sourceCode,
      supplier: ingredient.supplier || "",
      packSize,
      category: categoryFields.category,
      tradeCategory: categoryFields.tradeCategory,
      productCategory: categoryFields.productCategory,
      averagePrice:
        matchedSourceRow && Number(matchedSourceRow.averagePrice || 0) > 0
          ? Number(matchedSourceRow.averagePrice || 0)
          : Number(ingredient.unitCost || 0),
      importedAt: matchedSourceRow?.importedAt || ingredient.lastImportedAt || getTodayImportDate(),
      sourceRecordLabel: matchedSourceRow?.sourceRecordLabel || ingredient.sourceRecordLabel || "Shared ingredient reconciliation",
      existingIngredientId: ingredient.id,
      existingSharedRecordId: ingredient.sharedRecordId || "",
      nameIndex,
      suggestedName,
      confidenceScore,
      confidenceLabel: getConfidenceLabel(confidenceScore),
      confidenceBreakdown,
      appliedLearningRules: appliedRules,
      packSizeNeedsReview,
      likelyMultipackReview,
      categoryStateConflict: categoryFields.categoryStateConflict,
      explicitState: categoryFields.explicitState,
      assumedFreshSeafood: categoryFields.assumedFreshSeafood,
      assumedFrozenProduce: categoryFields.assumedFrozenProduce,
      assumedFrozenFruit: categoryFields.assumedFrozenFruit,
      chosenName: autoMergeIngredient ? autoMergeIngredient.name : suggestedName,
      useSuggestedName: true,
      internalCode: internalCode || sourceCode,
      strategy,
      targetId: targetIngredient?.id || "",
      targetName: targetIngredient?.name || "",
      suggestedTargetId: suggestedMergeIngredient?.id || "",
      suggestedTargetName: suggestedMergeIngredient?.name || "",
      matchReason: matchedIngredient?.type || "",
      duplicateCount: 1,
      needsCodeReview: false,
      aliasCandidate: normalizeIngredientKey(rawName) !== normalizeIngredientKey(suggestedName) ? rawName : "",
      reviewStatus: "review",
      decisionNote: autoMergeIngredient
        ? matchedIngredient.type === "source-code"
          ? "Strong source-code match found. This row is set to merge into the trusted ingredient."
          : "Strong internal-code match found. This row is set to merge into the trusted ingredient."
        : likelyMultipackReview
          ? "This piece-based snack line looks too expensive to be a single unit. Review whether the source row is really a retail box or multipack before publishing."
        : categoryFields.assumedFreshSeafood
          ? "This seafood row sits in a frozen trade bucket, but the source name does not say frozen, so it has been treated as fresh for review."
        : categoryFields.assumedFrozenProduce
          ? "This produce row sits in a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review."
        : categoryFields.assumedFrozenFruit
          ? "This fruit row sits in a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review."
        : categoryFields.categoryStateConflict
          ? `The source wording says ${String(categoryFields.explicitState || "").toLowerCase()}, so the meat category was adjusted away from the imported category before publishing.`
        : packSizeNeedsReview
          ? "This live ingredient still needs pack-size detail review before it looks trustworthy in master."
        : suggestedMergeIngredient
          ? matchedIngredient.type === "name"
            ? "Possible merge candidate found by exact clean name. Review it manually if you want to consolidate."
            : "Possible merge candidate found by stored alias. Review it manually if you want to consolidate."
          : "Review this live ingredient, then publish the cleaned record back into the trusted master.",
      published: false,
      reconcileMode: true,
    };
  });
}

function summarizeImportRows(rows) {
  const importedCount = rows.filter((row) => !row.published).length;
  const reviewCount = rows.filter((row) => row.reviewStatus === "review" && !row.published).length;
  const readyCount = rows.filter((row) => row.reviewStatus === "ready" && !row.published).length;
  const publishedCount = rows.filter((row) => row.published).length;
  const codeConflictCount = rows.filter((row) => row.needsCodeReview && !row.published).length;

  return {
    total: importedCount,
    reviewCount,
    readyCount,
    publishedCount,
    codeConflictCount,
  };
}

function summarizeImportSourceRows(
  sourceRows = [],
  ingredients = [],
  ignoredImportRows = {},
  resolvedImportRows = {},
  queueRows = [],
  sourceCodeRedirectState = {}
) {
  const resolutions = resolveImportSourceRows(sourceRows, {
    ingredients,
    ignoredImportRows,
    resolvedImportRows,
    sourceCodeRedirectState,
    buildIgnoredImportRowKey,
    isImportRowIgnored,
    isImportRowResolved,
    findAnyImportCoverageOwner,
    findTrustedImportCoverageTarget,
    findLiveImportCoverageTarget,
    isImportCoverageTargetSearchable,
  });

  return summarizeResolvedImportSourceRows(resolutions, {
    queueRows,
    buildIgnoredImportRowKey,
  });
}

function formatImportComparisonDisplayValue(value, type = "text") {
  if (type === "price") {
    const numericValue = Number(value || 0);
    return numericValue > 0 ? formatCurrency(numericValue) : "Not set";
  }

  const text = String(value || "").trim();
  return text || "Not set";
}

function buildImportComparisonRows(row = {}, ingredient = null) {
  if (!ingredient) return [];

  const reviewCategory = String(row.productCategory || row.category || "").trim();
  const reviewTradeCategory = String(row.tradeCategory || "").trim();
  const reviewSourceCode = String(row.sourceCode || "").trim();
  const reviewInternalCode = String(row.internalCode || "").trim();
  const reviewPrice = Number(row.averagePrice || 0);
  const masterSourceCode = String(getEffectiveIngredientSourceCode(ingredient) || "").trim();

  const rows = [
    {
      key: "name",
      label: "Name",
      reviewValue: String(row.chosenName || "").trim(),
      masterValue: String(ingredient.name || "").trim(),
      changed: normalizeIngredientKey(row.chosenName || "") !== normalizeIngredientKey(ingredient.name || ""),
    },
    {
      key: "internal_code",
      label: "Internal code",
      reviewValue: reviewInternalCode,
      masterValue: String(ingredient.code || "").trim(),
      changed: normalizeIngredientKey(reviewInternalCode) !== normalizeIngredientKey(ingredient.code || ""),
    },
    {
      key: "source_code",
      label: "Soft1 code",
      reviewValue: reviewSourceCode,
      masterValue: masterSourceCode,
      changed: normalizeIngredientKey(reviewSourceCode) !== normalizeIngredientKey(masterSourceCode),
    },
    {
      key: "pack_size",
      label: "Pack size",
      reviewValue: String(row.packSize || "").trim(),
      masterValue: String(ingredient.packSize || "").trim(),
      changed: normalizeIngredientKey(row.packSize || "") !== normalizeIngredientKey(ingredient.packSize || ""),
    },
    {
      key: "product_category",
      label: "Product category",
      reviewValue: reviewCategory,
      masterValue: String(ingredient.category || "").trim(),
      changed: normalizeIngredientKey(reviewCategory) !== normalizeIngredientKey(ingredient.category || ""),
    },
    {
      key: "trade_category",
      label: "Trade category",
      reviewValue: reviewTradeCategory,
      masterValue: String(ingredient.tradeCategory || "").trim(),
      changed: normalizeIngredientKey(reviewTradeCategory) !== normalizeIngredientKey(ingredient.tradeCategory || ""),
    },
    {
      key: "price",
      label: "Average price",
      reviewValue: reviewPrice,
      masterValue: Number(ingredient.unitCost || 0),
      changed: Math.abs(reviewPrice - Number(ingredient.unitCost || 0)) > 0.009,
      type: "price",
    },
  ];

  return rows;
}

function getIngredientComponentIdentifier(ingredient = {}, batchMap = new Map()) {
  if (!ingredient?.batchId) return "";
  const linkedBatch = batchMap?.get?.(ingredient.batchId) || null;
  if (!linkedBatch) return String(ingredient.batchId || "").trim();

  const code = String(linkedBatch.code || "").trim();
  const name = String(linkedBatch.name || "").trim();
  if (code && name) return `${code} · ${name}`;
  return code || name || String(ingredient.batchId || "").trim();
}

function formatCurrency(value = 0) {
  return `EUR ${Number(value || 0).toFixed(2)}`;
}

function parseReferencePackSize(packSize = "") {
  const parsedPack = parsePackSizeComponents(packSize);
  if (!parsedPack?.totalAmount || !parsedPack?.totalUnit) return null;
  if (parsedPack.totalUnit === "kg" || parsedPack.totalUnit === "l") {
    return {
      amount: parsedPack.totalAmount,
      unit: parsedPack.totalUnit,
      count: parsedPack.count || 0,
    };
  }
  return null;
}

function getIngredientReferencePrice(ingredient = {}) {
  const unitCost = Number(ingredient?.unitCost || 0);
  if (!(unitCost > 0)) return null;

  const parsedPack = parseReferencePackSize(ingredient?.packSize || "");
  if (parsedPack?.amount > 0 && (parsedPack.unit === "kg" || parsedPack.unit === "l")) {
    return {
      value: unitCost / parsedPack.amount,
      unit: parsedPack.unit,
    };
  }

  const costUnit = String(ingredient?.costUnit || "").trim().toLowerCase();
  if (costUnit === "kg" || costUnit === "l") {
    return {
      value: unitCost,
      unit: costUnit,
    };
  }

  return null;
}

function getNormalizedIngredientCostUnit(unit = "") {
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (normalizedUnit === "pc" || normalizedUnit === "pcs" || normalizedUnit === "piece" || normalizedUnit === "pieces") {
    return "piece";
  }
  return normalizedUnit;
}

function getIngredientPriceReviewIssue(ingredient = {}) {
  if (ingredient?.lastImportPriceMissing) {
    return {
      kind: "missing_import_price",
      label: "Price review",
      message: "The latest import matched this ingredient but did not contain a readable price. Review pricing before trusting this ingredient.",
    };
  }

  const unitCost = Number(ingredient?.unitCost || 0);
  if (!(unitCost > 0)) {
    return {
      kind: "missing_price",
      label: "Price review",
      message: "No price is saved yet, so this ingredient still needs a pricing pass before it can be trusted.",
    };
  }

  const packSize = String(ingredient?.packSize || "").trim();
  const normalizedCostUnit = getNormalizedIngredientCostUnit(ingredient?.costUnit || inferMeasurementUnit(packSize));
  const pieceLikeUnit = normalizedCostUnit === "piece";
  if (
    pieceLikeUnit &&
    isLikelyMultipackSnackImport(
      ingredient?.name || "",
      normalizedCostUnit,
      unitCost,
      ingredient?.sourceCode || ""
    )
  ) {
    return {
      kind: "likely_multipack",
      label: "Price review",
      message: "This looks like a boxed or multipack snack product being priced as a single piece. Review the pack detail before trusting the price.",
    };
  }

  return null;
}

function ingredientNeedsReviewAttention(ingredient = {}) {
  return Boolean(getIngredientMasterReviewStatus(ingredient) === "review" || getIngredientPriceReviewIssue(ingredient));
}

function getIngredientReviewAttentionReasons(ingredient = {}, ingredientRuleCatchupMap = null) {
  const reasons = [];
  if (getIngredientMasterReviewStatus(ingredient) === "review") reasons.push("manual_review");
  if (getIngredientPriceReviewIssue(ingredient)) reasons.push("price_review");
  if (ingredientRuleCatchupMap?.has?.(ingredient?.id)) reasons.push("rule_catchup");
  return reasons;
}

function getIngredientMasterParsedIndex(ingredient = {}, learningRules = [], sourceRows = []) {
  const rawReference = getIngredientMasterReferenceRawName(ingredient, sourceRows);
  const effectiveSourceCode = getEffectiveIngredientSourceCode(ingredient);
  return parseIngredientIndexWithLearning(
    rawReference || ingredient?.name || "",
    ingredient?.packSize || "",
    learningRules,
    effectiveSourceCode
  ).nameIndex;
}

function getIngredientCatalogueDisplayName(ingredient = {}, catchupSuggestion = null) {
  return String(ingredient?.name || "").trim() || "Untitled ingredient";
}

function formatIngredientReferencePrice(referencePrice = null, compact = false) {
  if (!referencePrice?.unit || !Number.isFinite(referencePrice?.value)) return "";
  const unitLabel = referencePrice.unit === "l" ? (compact ? "l" : "litre") : "kg";
  return compact
    ? `${formatCurrency(referencePrice.value)}/${unitLabel}`
    : `${formatCurrency(referencePrice.value)} / ${unitLabel}`;
}

function formatPercent(value = 0) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function parseNumericQuantity(value = 0) {
  const parsed = Number.parseFloat(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function convertMeasurementQuantity(quantity = 0, fromUnit = "", toUnit = "") {
  const amount = parseNumericQuantity(quantity);
  const from = String(fromUnit || "").trim().toLowerCase();
  const to = String(toUnit || "").trim().toLowerCase();
  if (!amount || !from || !to) return 0;
  if (from === to) return amount;

  const massUnits = new Set(["kg", "g"]);
  const volumeUnits = new Set(["l", "ml"]);

  if (massUnits.has(from) && massUnits.has(to)) {
    const grams = from === "kg" ? amount * 1000 : amount;
    return to === "kg" ? grams / 1000 : grams;
  }

  if (volumeUnits.has(from) && volumeUnits.has(to)) {
    const millilitres = from === "l" ? amount * 1000 : amount;
    return to === "l" ? millilitres / 1000 : millilitres;
  }

  if (from === "piece" && to === "piece") {
    return amount;
  }

  return 0;
}

function calculateLineEstimatedCost(line, sourceRecord) {
  if (!line) return 0;
  if (!sourceRecord) return Number(line.estimatedCost || 0);

  const quantity = parseNumericQuantity(line.quantity);
  if (!(quantity > 0)) return 0;
  const lineUnit = String(line.unit || "").trim().toLowerCase();
  const basisUnit = String(sourceRecord.costUnit || "").trim().toLowerCase();
  const unitCost = Number(sourceRecord.unitCost || 0);

  if (quantity > 0 && lineUnit && basisUnit && unitCost > 0) {
    const convertedQuantity = convertMeasurementQuantity(quantity, lineUnit, basisUnit);
    if (convertedQuantity > 0) {
      return convertedQuantity * unitCost;
    }
  }

  return Number(sourceRecord.portionCostHint || line.estimatedCost || 0);
}

function syncRecipeRelations(recipe) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  const menuIds = Array.isArray(recipe?.menuIds) ? recipe.menuIds : [];
  const serviceSuitabilityInput = Array.isArray(recipe?.serviceSuitability) ? recipe.serviceSuitability : [];
  const ingredientIds = dedupeTextList(ingredientLines.map((line) => line.ingredientId).filter(Boolean));
  const batchIds = dedupeTextList(batchLines.map((line) => line.batchId).filter(Boolean));
  const serviceSuitability = dedupeTextList(serviceSuitabilityInput);

  return {
    ...recipe,
    sharedDirty: Boolean(recipe.sharedDirty),
    sharedPersisted: Boolean(recipe.sharedPersisted),
    ingredientLines,
    batchLines,
    menuIds: dedupeTextList(menuIds),
    ingredientIds,
    batchIds,
    serviceSuitability,
  };
}

function normalizeRecipePublishedComponentLines(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? [...recipe.ingredientLines] : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  if (!batchLines.length) return recipe;

  const remainingBatchLines = [];

  batchLines.forEach((line) => {
    const batch = batchMap.get(line.batchId) || null;
    const publishedIngredient = findPublishedIngredientForBatch(batch, ingredientMap);
    if (!publishedIngredient?.id) {
      remainingBatchLines.push(line);
      return;
    }

    const normalizedLine = {
      ingredientId: publishedIngredient.id,
      quantity: String(line.quantity || "").trim() || "1",
      unit:
        String(line.unit || "").trim() ||
        inferMeasurementUnit(publishedIngredient.packSize) ||
        String(publishedIngredient.costUnit || "").trim() ||
        "g",
      estimatedCost: Number(
        line.estimatedCost ||
          calculateLineEstimatedCost(line, getIngredientCostSource(publishedIngredient, ingredientMap, batchMap)) ||
          0
      ),
    };

    const existingIndex = ingredientLines.findIndex((existingLine) => existingLine.ingredientId === publishedIngredient.id);
    if (existingIndex >= 0) {
      ingredientLines[existingIndex] = {
        ...ingredientLines[existingIndex],
        ...normalizedLine,
      };
      return;
    }

    ingredientLines.push(normalizedLine);
  });

  if (remainingBatchLines.length === batchLines.length) return recipe;

  return {
    ...recipe,
    ingredientLines,
    batchLines: remainingBatchLines,
  };
}

function syncMenuRecord(menu) {
  const items = (menu.items || []).map((item, index) => ({
    id: item.id || `menu-item-${menu.id}-${index + 1}`,
    recipeId: item.recipeId || "",
    dishName: String(item.dishName || ""),
    description: String(item.description || ""),
  }));
  const recipeIds = dedupeTextList(items.map((item) => item.recipeId).filter(Boolean));

  return {
    ...menu,
    archived: Boolean(menu.archived),
    sharedDirty: Boolean(menu.sharedDirty),
    items,
    recipeIds,
  };
}

function createClientUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const nextValue = character === "x" ? random : (random & 0x3) | 0x8;
    return nextValue.toString(16);
  });
}

function getRestaurantServicePool(restaurant = {}) {
  return dedupeTextList([
    ...(restaurant.primaryServices || []),
    ...(restaurant.secondaryServices || []),
    ...(restaurant.eventUses || []),
  ]);
}

function buildDefaultMenuName(restaurantName = "", service = "") {
  const safeRestaurant = String(restaurantName || "").trim();
  const safeService = String(service || "").trim();
  if (!safeRestaurant) return "New menu";
  if (!safeService) return `${safeRestaurant} menu`;
  return `${safeRestaurant} ${safeService.toLowerCase()} menu`;
}

function createEmptyMenuDraft(restaurant, existingMenus = [], initialService = "") {
  const servicePool = getRestaurantServicePool(restaurant);
  const existingServices = existingMenus
    .filter((menu) => menu.restaurantId === restaurant.id)
    .map((menu) => menu.service);
  const nextAvailableService =
    initialService ||
    servicePool.find((service) => !existingServices.includes(service)) ||
    servicePool[0] ||
    restaurant?.primaryServices?.[0] ||
    "Service";

  return syncMenuRecord({
    id: `men-${Date.now()}`,
    restaurantId: restaurant.id,
    restaurant: restaurant.name,
    service: nextAvailableService,
    name: buildDefaultMenuName(restaurant.name, nextAvailableService),
    status: "draft",
    sharedDirty: true,
    items: [],
  });
}

function calculateRecipeComponentTotalCost(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  const ingredientCost = ingredientLines.reduce((sum, line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    return sum + calculateLineEstimatedCost(line, getIngredientCostSource(ingredient, ingredientMap, batchMap));
  }, 0);
  const batchCost = batchLines.reduce((sum, line) => {
    const batch = batchMap.get(line.batchId);
    const batchCostSource = getBatchCostSource(batch, ingredientMap);
    return sum + calculateLineEstimatedCost(line, batchCostSource);
  }, 0);

  return ingredientCost + batchCost;
}

function calculateBatchComponentTotalCost(batch, ingredientMap = new Map()) {
  return (batch?.ingredientLines || []).reduce((sum, line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    return sum + calculateLineEstimatedCost(line, getIngredientCostSource(ingredient, ingredientMap));
  }, 0);
}

function getBatchCostSource(batch, ingredientMap = new Map()) {
  if (!batch) return null;

  const totalComponentCost = calculateBatchComponentTotalCost(batch, ingredientMap);
  const rawYieldAmount = Math.max(0, Number(batch?.yieldAmount || 0));
  const rawCostUnit = String(batch?.yieldUnit || batch?.costUnit || "").trim().toLowerCase() || "kg";
  const normalizedCostUnit =
    rawCostUnit === "g"
      ? "kg"
      : rawCostUnit === "ml"
        ? "l"
        : rawCostUnit;
  const yieldAmount =
    rawCostUnit === "g"
      ? rawYieldAmount / 1000
      : rawCostUnit === "ml"
        ? rawYieldAmount / 1000
        : rawYieldAmount;
  const fallbackUnitCost = Number(batch?.unitCost || 0);
  const costUnit = normalizedCostUnit || "kg";
  const unitCost = totalComponentCost > 0 && yieldAmount > 0 ? totalComponentCost / yieldAmount : fallbackUnitCost;
  const portionCostHint = unitCost > 0 ? unitCost : Number(batch?.portionCostHint || 0);

  return {
    ...batch,
    unitCost,
    costUnit,
    portionCostHint,
    totalComponentCost,
  };
}

function getIngredientCostSource(ingredient, ingredientMap = new Map(), batchMap = new Map()) {
  if (!ingredient) return null;
  const linkedBatchId = String(ingredient.batchId || "").trim();
  if (!linkedBatchId) return ingredient;
  const linkedBatch = batchMap.get(linkedBatchId);
  if (!linkedBatch) return ingredient;
  const batchCostSource = getBatchCostSource(linkedBatch, ingredientMap);
  if (!batchCostSource) return ingredient;
  return {
    ...ingredient,
    unitCost: Number(batchCostSource.unitCost || 0),
    costUnit: String(batchCostSource.costUnit || ingredient.costUnit || "").trim() || ingredient.costUnit || "",
    portionCostHint: Number(batchCostSource.portionCostHint || ingredient.portionCostHint || 0),
  };
}

function getDishPortionCount(recipe) {
  return Math.max(1, Number(recipe?.portions || 0) || 1);
}

function calculateRecipeEstimatedCost(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  return calculateRecipeComponentTotalCost(recipe, ingredientMap, batchMap) / getDishPortionCount(recipe);
}

function calculateRoundupTarget(recipeCost = 0) {
  const cost = Number(recipeCost || 0);
  if (cost <= 0) return 0;
  const targetNetSalePrice = cost / FOOD_TARGET_COST_RATIO;
  const targetGrossSalePrice = targetNetSalePrice * (1 + FOOD_SALE_VAT_RATE);
  return Math.ceil(targetGrossSalePrice * 2) / 2;
}

function getFoodNetSalePrice(grossSalePrice = 0) {
  const gross = Number(grossSalePrice || 0);
  if (gross <= 0) return 0;
  return gross / (1 + FOOD_SALE_VAT_RATE);
}

function derivePricingComplete(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  const allLines = [...ingredientLines, ...batchLines];
  if (!allLines.length) return "0";

  const hasCompletePricing = [
    ...ingredientLines.map((line) => ({
      line,
      source: ingredientMap.get(line.ingredientId),
    })),
    ...batchLines.map((line) => ({
      line,
      source: getBatchCostSource(batchMap.get(line.batchId), ingredientMap),
    })),
  ].every(({ line, source }) => parseNumericQuantity(line.quantity) > 0 && calculateLineEstimatedCost(line, source) > 0);

  return hasCompletePricing ? "1" : "0";
}

function calculateRecipeGrossProfit(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const currentNetSalePrice = getFoodNetSalePrice(recipe.salePrice);
  if (!currentNetSalePrice) return 0;
  const cost = calculateRecipeEstimatedCost(recipe, ingredientMap, batchMap);
  return ((currentNetSalePrice - cost) / currentNetSalePrice) * 100;
}

function getRecipePricingMetrics(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const totalComponentCost = calculateRecipeComponentTotalCost(recipe, ingredientMap, batchMap);
  const recipeCost = calculateRecipeEstimatedCost(recipe, ingredientMap, batchMap);
  const netSalePrice = getFoodNetSalePrice(recipe.salePrice);
  const grossProfit = netSalePrice > 0 ? ((netSalePrice - recipeCost) / netSalePrice) * 100 : 0;
  const roundup = calculateRoundupTarget(recipeCost);
  const variance = Number(recipe.salePrice || 0) - roundup;
  const pricingComplete = derivePricingComplete(recipe, ingredientMap, batchMap);

  return {
    totalComponentCost,
    recipeCost,
    netSalePrice,
    grossProfit,
    roundup,
    variance,
    pricingComplete,
  };
}

function getRecipeWorkflowProgress(recipe) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  const methodSteps = Array.isArray(recipe?.methodSteps) ? recipe.methodSteps : [];
  const menuIds = Array.isArray(recipe?.menuIds) ? recipe.menuIds : [];
  const checks = [
    Boolean(recipe.name && recipe.code && recipe.category),
    Boolean(ingredientLines.length || batchLines.length),
    Boolean(methodSteps.some((step) => String(step || "").trim())),
    Boolean(Number(recipe.portions || 0) > 0 && Number(recipe.salePrice || 0) > 0),
    Boolean(menuIds.length),
  ];
  const completeCount = checks.filter(Boolean).length;

  return {
    completeCount,
    total: checks.length,
  };
}

function isRecipeReadyToPublish(recipe) {
  const progress = getRecipeWorkflowProgress(recipe);
  return progress.completeCount === progress.total;
}

function getRecipeWorkflowMissingItems(recipe) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const batchLines = Array.isArray(recipe?.batchLines) ? recipe.batchLines : [];
  const methodSteps = Array.isArray(recipe?.methodSteps) ? recipe.methodSteps : [];
  const menuIds = Array.isArray(recipe?.menuIds) ? recipe.menuIds : [];
  const missing = [];

  if (!(recipe.name && recipe.code && recipe.category)) {
    missing.push("basics");
  }
  if (!(ingredientLines.length || batchLines.length)) {
    missing.push("ingredients");
  }
  if (!methodSteps.some((step) => String(step || "").trim())) {
    missing.push("method");
  }
  if (!(Number(recipe.portions || 0) > 0 && Number(recipe.salePrice || 0) > 0)) {
    missing.push("portions and pricing");
  }
  if (!menuIds.length) {
    missing.push("usage");
  }

  return missing;
}

function syncRecipeStatusFromIngredientState(recipe, ingredientMap = new Map()) {
  const ingredientLines = Array.isArray(recipe?.ingredientLines) ? recipe.ingredientLines : [];
  const linkedDraftIngredient = ingredientLines
    .map((line) => ingredientMap.get(line.ingredientId))
    .find((ingredient) => ingredient?.status === "draft");

  if (!linkedDraftIngredient) return recipe;

  const nextChefNotes = dedupeTextList([
    String(recipe?.chefNotes || "").trim(),
    `Ingredient ${String(linkedDraftIngredient.name || linkedDraftIngredient.code || "dependency").trim()} is in draft. This recipe has been moved back to draft for review.`,
  ]).join(" ");

  return {
    ...recipe,
    status: "draft",
    chefNotes: nextChefNotes,
  };
}

function getRecipeStageLabel(status = "") {
  if (status === "review") return "ready";
  return status || "draft";
}

function getMenuStageLabel(status = "") {
  if (status === "review") return "approved";
  return status || "draft";
}

function getMenuCourseLabel(item, recipe) {
  const category = String(recipe?.category || "").trim().toLowerCase();
  if (category === "dessert") return "Desserts";
  if (category === "starter" || category === "small plate" || category === "side" || category === "salad" || category === "special") {
    return "Starters";
  }
  return "Mains";
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8;") {
  if (typeof window === "undefined") return;
  const isCsv = String(mimeType || "").toLowerCase().includes("text/csv");
  const normalizedContent = isCsv
    ? `\uFEFF${String(content ?? "").replace(/\r?\n/g, "\r\n")}`
    : content;
  const blob = new Blob([normalizedContent], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function slugifyLabel(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";
}

function buildMenuPreviewGroups(menu, recipeMap = new Map()) {
  return ["Starters", "Mains", "Desserts"].map((course) => ({
    course,
    items: (menu?.items || [])
      .map((item) => {
        const recipe = item.recipeId ? recipeMap.get(item.recipeId) : null;
        return {
          ...item,
          recipe,
          course: getMenuCourseLabel(item, recipe),
          price: Number(recipe?.salePrice || 0),
        };
      })
      .filter((item) => item.course === course),
  }));
}

function buildRecipeCostingCsv(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const pricing = getRecipePricingMetrics(recipe, ingredientMap, batchMap);
  const portionCount = getDishPortionCount(recipe);
  const ingredientRows = (recipe.ingredientLines || []).map((line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    const ingredientCostSource = getIngredientCostSource(ingredient, ingredientMap, batchMap);
    const perPortionQuantity = parseNumericQuantity(line.quantity) / portionCount;
    return {
      lineType: "Ingredient",
      name: ingredient?.name || "Unknown ingredient",
      code: ingredient?.code || "",
      qty: formatEditableQuantity(perPortionQuantity),
      unit: line.unit || "",
      estimatedCost: calculateLineEstimatedCost(
        {
          ...line,
          quantity: perPortionQuantity,
        },
        ingredientCostSource
      ),
    };
  });
  const batchRows = (recipe.batchLines || []).flatMap((line) => {
    const batch = batchMap.get(line.batchId);
    const expandedRows = buildExpandedBatchRowsForRecipeExport(line, batch, ingredientMap, batchMap, portionCount);
    if (expandedRows.length) {
      return expandedRows.map((row) => ({
        lineType: "Ingredient",
        name: row.description || "Unknown ingredient",
        code: row.ingredientCode || "",
        qty: row.quantityUsed,
        unit: row.unitOfMeasure || "",
        estimatedCost: row.cost || 0,
      }));
    }

    const batchCostSource = getBatchCostSource(batch, ingredientMap);
    const perPortionQuantity = parseNumericQuantity(line.quantity) / portionCount;
    return [
      {
        lineType: "Component",
        name: batch?.name || "Unknown component",
        code: batch?.code || "",
        qty: formatEditableQuantity(perPortionQuantity),
        unit: line.unit || "",
        estimatedCost: calculateLineEstimatedCost(
          {
            ...line,
            quantity: perPortionQuantity,
          },
          {
          unitCost: batchCostSource?.unitCost,
          costUnit: batchCostSource?.costUnit,
          }
        ),
      },
    ];
  });

  const rows = [
    ["recipe_name", recipe.name],
    ["recipe_code", recipe.code],
    ["category", recipe.category],
    ["portions", recipe.portions],
    ["gross_sale_price", Number(recipe.salePrice || 0).toFixed(2)],
    ["net_sale_price", pricing.netSalePrice.toFixed(2)],
    ["recipe_cost_per_portion", pricing.recipeCost.toFixed(2)],
    ["component_total", pricing.totalComponentCost.toFixed(2)],
    ["gp_net_percent", (pricing.grossProfit * 100).toFixed(1)],
    [],
    ["line_type", "name", "code", "qty", "unit", "estimated_cost"],
    ...[...ingredientRows, ...batchRows].map((row) => [
      row.lineType,
      row.name,
      row.code,
      row.qty,
      row.unit,
      row.estimatedCost.toFixed(2),
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function buildRecipeChefSheetText(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const ingredientLines = (recipe.ingredientLines || [])
    .map((line) => {
      const ingredient = ingredientMap.get(line.ingredientId);
      return `- ${ingredient?.name || "Unknown ingredient"}: ${formatEditableQuantity(line.quantity)} ${line.unit || ""}`.trim();
    })
    .join("\n");

  const batchLines = (recipe.batchLines || [])
    .map((line) => {
      const batch = batchMap.get(line.batchId);
      return `- ${batch?.name || "Unknown component"}: ${formatEditableQuantity(line.quantity)} ${line.unit || ""}`.trim();
    })
    .join("\n");

  const methodSteps = (recipe.methodSteps || [])
    .map((step, index) => String(step || "").trim())
    .filter(Boolean)
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");

  return [
    recipe.name,
    `${recipe.code} · ${recipe.category}`,
    "",
    `Menu description: ${recipe.menuDescription || ""}`,
    `Portions: ${recipe.portions || 0}`,
    "",
    "Ingredients",
    ingredientLines || "- None added",
    "",
    "Component recipes",
    batchLines || "- None added",
    "",
    "Method",
    methodSteps || "No method steps added.",
    "",
    `Prep notes: ${recipe.prepNotes || ""}`,
    `Plating notes: ${recipe.platingNotes || ""}`,
    `Service notes: ${recipe.chefNotes || ""}`,
  ].join("\n");
}

function buildMenuExportCsv(menu, recipeMap = new Map()) {
  const rows = [
    ["menu_name", menu.name],
    ["restaurant", menu.restaurant],
    ["service", menu.service],
    ["stage", getMenuStageLabel(menu.status)],
    [],
    ["course", "dish_name", "description", "price"],
  ];

  buildMenuPreviewGroups(menu, recipeMap).forEach((group) => {
    group.items.forEach((item) => {
      rows.push([
        group.course,
        item.name || item.recipe?.name || "",
        item.description || item.recipe?.menuDescription || "",
        Number(item.price || 0).toFixed(2),
      ]);
    });
  });

  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function buildIngredientMasterExportCsv(ingredients = []) {
  const rows = [
    [
      "ingredient_name",
      "ingredient_code",
      "source_code",
      "category",
      "pack_size",
      "supplier",
      "unit_cost",
      "purchase_vat_rate",
      "cost_unit",
      "portion_cost_hint",
      "record_status",
      "source_type",
      "added_to_soft1",
      "archived",
      "source_record",
      "last_pricing_import",
      "aliases",
      "notes",
    ],
    ...ingredients.map((ingredient) => [
      ingredient.name || "",
      ingredient.code || "",
      ingredient.sourceCode || "",
      ingredient.category || "",
      ingredient.packSize || "",
      ingredient.supplier || "",
      String(ingredient.unitCost ?? 0),
      String(ingredient.purchaseVatRate ?? 13),
      ingredient.costUnit || "",
      String(ingredient.portionCostHint ?? 0),
      ingredient.status || "",
      getIngredientSourceType(ingredient),
      getIngredientSoft1Status(ingredient) === "in_soft1" ? "yes" : "no",
      ingredient.archived ? "yes" : "no",
      ingredient.sourceRecordLabel || "",
      ingredient.lastImportedAt || "",
      (ingredient.aliases || []).join(" | "),
      ingredient.notes || "",
    ]),
  ];

  return rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
}

function buildIngredientMasterExportHtml(ingredients = []) {
  const rowsHtml = ingredients
    .map(
      (ingredient) => `
        <tr>
          <td>${ingredient.name || ""}</td>
          <td>${ingredient.code || ""}</td>
          <td>${ingredient.category || ""}</td>
          <td>${ingredient.packSize || ""}</td>
          <td>${ingredient.supplier || ""}</td>
          <td>${formatCurrency(ingredient.unitCost || 0)}</td>
          <td>${ingredient.costUnit || ""}</td>
          <td>${ingredient.archived ? "Archived" : "Active"}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Ingredient master export</title>
      <style>
        body { margin: 0; background: #eef2f7; color: #111827; font-family: Arial, Helvetica, sans-serif; }
        .page { max-width: 1200px; margin: 0 auto; padding: 24px; }
        .sheet { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08); }
        h1 { margin: 0 0 8px; font-size: 28px; }
        p { margin: 0 0 18px; color: #52606d; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #d9dde3; padding: 8px 10px; font-size: 12px; text-align: left; vertical-align: top; }
        th { background: #f5f3ef; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #5b5147; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="sheet">
          <h1>Ingredient master</h1>
          <p>${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"} in the current export.</p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Pack size</th>
                <th>Supplier</th>
                <th>Unit cost</th>
                <th>Cost unit</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    </body>
  </html>`;
}

function buildMenuPrintHtml(menu, recipeMap = new Map()) {
  const groups = buildMenuPreviewGroups(menu, recipeMap);
  const groupHtml = groups
    .map((group) => {
      if (!group.items.length) return "";
      const itemHtml = group.items
        .map(
          (item) => `
            <tr>
              <td>${item.name || item.recipe?.name || ""}</td>
              <td>${item.description || item.recipe?.menuDescription || ""}</td>
              <td>${formatCurrency(item.price || 0)}</td>
            </tr>
          `
        )
        .join("");
      return `
        <section class="course-block">
          <h2>${group.course}</h2>
          <table>
            <thead>
              <tr><th>Name</th><th>Description</th><th>Price</th></tr>
            </thead>
            <tbody>${itemHtml}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${menu.name}</title>
    <style>
      body { font-family: Georgia, serif; background: #f5efe8; margin: 0; padding: 24px; color: #241d18; }
      .paper { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fffdfb; padding: 18mm; box-sizing: border-box; }
      h1 { margin: 0 0 8px; font-size: 26px; }
      .meta { margin-bottom: 18px; color: #6f6257; font-size: 13px; }
      .course-block { margin-top: 20px; }
      h2 { margin: 0 0 8px; font-size: 16px; letter-spacing: 0.08em; text-transform: uppercase; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #eadfd4; vertical-align: top; font-size: 14px; }
      th { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7f7267; }
      td:last-child, th:last-child { text-align: right; white-space: nowrap; }
    </style>
  </head>
  <body>
    <div class="paper">
      <h1>${menu.name}</h1>
      <div class="meta">${menu.restaurant} · ${menu.service}</div>
      ${groupHtml}
    </div>
  </body>
</html>`;
}

function formatExportUnitLabel(unit = "") {
  const normalized = String(unit || "").trim().toLowerCase();
  if (normalized === "kg") return "Kg";
  if (normalized === "g") return "g";
  if (normalized === "l") return "L";
  if (normalized === "ml") return "ml";
  if (normalized === "piece") return "Pcs";
  if (normalized === "portion") return "Portion";
  return unit || "";
}

function formatExportQuantity(value = 0, unit = "") {
  const numericValue = Number(value || 0);
  if (!numericValue) return "0";
  const formatCompact = (amount, maximumDecimals = 2) =>
    Number(amount.toFixed(maximumDecimals)).toString();
  if (unit === "kg") return `${formatCompact(numericValue, 2)} kg`;
  if (unit === "l") return `${formatCompact(numericValue, 2)} L`;
  if (unit === "g" || unit === "ml") return `${formatCompact(numericValue, 2)} ${unit}`;
  if (unit === "portion") return `${numericValue.toFixed(0)} portion`;
  if (unit === "piece") return `${numericValue.toFixed(0)} pcs`;
  return `${numericValue} ${unit || ""}`.trim();
}

function buildExpandedBatchRowsForRecipeExport(line, batch, ingredientMap = new Map(), batchMap = new Map(), portionDivisor = 1) {
  if (!batch) return [];

  const yieldAmount = parseNumericQuantity(batch.yieldAmount);
  const recipeQuantity = parseNumericQuantity(line.quantity) / Math.max(1, Number(portionDivisor || 1));
  const batchYieldUnit = String(batch.yieldUnit || batch.costUnit || "").trim().toLowerCase();
  const recipeUnit = String(line.unit || "").trim().toLowerCase();

  if (!(yieldAmount > 0) || !(recipeQuantity > 0) || !batchYieldUnit || !recipeUnit) {
    return [];
  }

  const convertedRecipeQuantity = convertMeasurementQuantity(recipeQuantity, recipeUnit, batchYieldUnit);
  if (!(convertedRecipeQuantity > 0)) {
    return [];
  }

  const usageRatio = convertedRecipeQuantity / yieldAmount;
  if (!(usageRatio > 0)) {
    return [];
  }

  return (batch.ingredientLines || [])
    .map((batchLine) => {
      const ingredient = ingredientMap.get(batchLine.ingredientId);
      const ingredientCostSource = getIngredientCostSource(ingredient, ingredientMap, batchMap);
      const scaledQuantity = parseNumericQuantity(batchLine.quantity) * usageRatio;
      if (!(scaledQuantity > 0)) return null;

      const exportLine = {
        ...batchLine,
        quantity: scaledQuantity,
      };

      return {
        ingredientCode: ingredient?.code || "",
        description: ingredient?.name || "",
        unitOfMeasure: formatExportUnitLabel(ingredientCostSource?.costUnit || batchLine.unit || ""),
        unitPrice: Number(ingredientCostSource?.unitCost || 0),
        quantityUsed: formatExportQuantity(scaledQuantity, batchLine.unit),
        cost: calculateLineEstimatedCost(exportLine, ingredientCostSource),
      };
    })
    .filter(Boolean);
}

function buildExpandedPublishedIngredientRowsForRecipeExport(
  line,
  ingredient,
  ingredientMap = new Map(),
  batchMap = new Map(),
  portionDivisor = 1
) {
  if (!ingredient?.batchId) return [];
  const linkedBatch = batchMap.get(ingredient.batchId);
  if (!linkedBatch) return [];
  return buildExpandedBatchRowsForRecipeExport(line, linkedBatch, ingredientMap, batchMap, portionDivisor);
}

function buildRecipeCostSheetRowsV2(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const portionCount = getDishPortionCount(recipe);
  const ingredientRows = (recipe.ingredientLines || []).flatMap((line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    const ingredientCostSource = getIngredientCostSource(ingredient, ingredientMap, batchMap);
    const expandedRows = buildExpandedPublishedIngredientRowsForRecipeExport(
      line,
      ingredient,
      ingredientMap,
      batchMap,
      portionCount
    );
    if (expandedRows.length) return expandedRows;

    const perPortionQuantity = parseNumericQuantity(line.quantity) / portionCount;
    const exportLine = {
      ...line,
      quantity: perPortionQuantity,
    };
    return [
      {
        ingredientCode: ingredient?.code || "",
        description: ingredient?.name || "",
        unitOfMeasure: formatExportUnitLabel(ingredientCostSource?.costUnit || line.unit || ""),
        unitPrice: Number(ingredientCostSource?.unitCost || 0),
        quantityUsed: formatExportQuantity(perPortionQuantity, line.unit),
        cost: calculateLineEstimatedCost(exportLine, ingredientCostSource),
      },
    ];
  });

  const batchRows = (recipe.batchLines || []).flatMap((line) => {
    const batch = batchMap.get(line.batchId);
    const expandedRows = buildExpandedBatchRowsForRecipeExport(line, batch, ingredientMap, batchMap, portionCount);
    if (expandedRows.length) return expandedRows;

    const batchCostSource = getBatchCostSource(batch, ingredientMap);
    const perPortionQuantity = parseNumericQuantity(line.quantity) / portionCount;
    const exportLine = {
      ...line,
      quantity: perPortionQuantity,
    };
    return [
      {
        ingredientCode: batch?.code || "",
        description: batch?.name || "",
        unitOfMeasure: formatExportUnitLabel(batchCostSource?.costUnit || line.unit || ""),
        unitPrice: Number(batchCostSource?.unitCost || 0),
        quantityUsed: formatExportQuantity(perPortionQuantity, line.unit),
        cost: calculateLineEstimatedCost(exportLine, {
          unitCost: batchCostSource?.unitCost,
          costUnit: batchCostSource?.costUnit,
        }),
      },
    ];
  });

  return [...ingredientRows, ...batchRows];
}

function buildRecipeChefSheetRowsV2(recipe, ingredientMap = new Map(), batchMap = new Map()) {
  const ingredientRows = (recipe.ingredientLines || []).map((line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    const ingredientCostSource = getIngredientCostSource(ingredient, ingredientMap, batchMap);
    return {
      ingredientCode: ingredient?.code || "",
      description: ingredient?.name || "",
      unitOfMeasure: formatExportUnitLabel(line.unit || ingredientCostSource?.costUnit || ""),
      quantityUsed: formatExportQuantity(line.quantity, line.unit),
      cost: calculateLineEstimatedCost(line, ingredientCostSource),
    };
  });

  const batchRows = (recipe.batchLines || []).map((line) => {
    const batch = batchMap.get(line.batchId);
    const batchCostSource = getBatchCostSource(batch, ingredientMap);
    return {
      ingredientCode: batch?.code || "",
      description: batch?.name || "",
      unitOfMeasure: formatExportUnitLabel(line.unit || batchCostSource?.costUnit || ""),
      quantityUsed: formatExportQuantity(line.quantity, line.unit),
      cost: calculateLineEstimatedCost(line, {
        unitCost: batchCostSource?.unitCost,
        costUnit: batchCostSource?.costUnit,
      }),
    };
  });

  return [...ingredientRows, ...batchRows];
}

function buildBatchCostSheetRowsV2(batch, ingredientMap = new Map(), batchMap = new Map()) {
  return (batch.ingredientLines || []).map((line) => {
    const ingredient = ingredientMap.get(line.ingredientId);
    const ingredientCostSource = getIngredientCostSource(ingredient, ingredientMap, batchMap);
    return {
      ingredientCode: ingredient?.code || "",
      description: ingredient?.name || "",
      unitOfMeasure: formatExportUnitLabel(ingredientCostSource?.costUnit || line.unit || ""),
      unitPrice: Number(ingredientCostSource?.unitCost || 0),
      quantityUsed: formatExportQuantity(line.quantity, line.unit),
      cost: calculateLineEstimatedCost(line, ingredientCostSource),
    };
  });
}

function buildCostSheetCsvBlock({ code = "", name = "", itemCode = "", totalCost = 0, componentRows = [] }) {
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const csvMoney = (value) => Number(value || 0).toFixed(2);

  const rows = [
    ["Recipe code", code, "Descr.", name, "Item code", itemCode],
    ["Ingr. Code", "Descr Code", "Unit of meas.", "Unit price (EUR)", "Qty used", "Cost (EUR)"],
    ...componentRows.map((row) => [
      row.ingredientCode || "",
      row.description || "",
      row.unitOfMeasure || "",
      csvMoney(row.unitPrice || 0),
      row.quantityUsed || "",
      csvMoney(row.cost || 0),
    ]),
    ["Total", "", "", "", "Mixed units", csvMoney(totalCost)],
  ];

  return ["sep=,", ...rows.map((row) => row.map(escapeCsv).join(","))].join("\r\n");
}

function buildCostSheetHtmlV2({ title, code = "", name = "", itemCode = "", totalCost = 0, roundup = "", componentRows = [] }) {
  const componentRowsHtml = componentRows
    .map(
      (row) => `
        <tr>
          <td>${row.ingredientCode || ""}</td>
          <td>${row.description || ""}</td>
          <td>${row.unitOfMeasure || ""}</td>
          <td class="numeric">${formatCurrency(row.unitPrice || 0)}</td>
          <td class="numeric">${row.quantityUsed || ""}</td>
          <td class="numeric">${formatCurrency(row.cost || 0)}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { margin: 0; background: #eef2f7; color: #111827; font-family: Arial, Helvetica, sans-serif; }
        .page { max-width: 1080px; margin: 0 auto; padding: 24px; }
        table { width: 100%; border-collapse: collapse; background: white; table-layout: fixed; }
        th, td { border: 1px solid #b8c1cc; padding: 7px 8px; font-size: 12px; vertical-align: middle; }
        .title-row th { background: #ececec; font-size: 16px; text-align: center; font-weight: 700; }
        .meta-label-cell { background: #f3f3f3; font-weight: 700; }
        .meta-value-cell { background: #fff; }
        .header-row th { background: #f3f3f3; font-weight: 700; text-align: left; vertical-align: bottom; }
        .numeric { text-align: right; font-variant-numeric: tabular-nums; }
        .total-label, .total-number { font-style: italic; font-weight: 700; background: #fafafa; }
      </style>
    </head>
    <body>
      <div class="page">
        <table>
          <tr class="title-row"><th colspan="6">${title}</th></tr>
          <tr>
            <td class="meta-label-cell">Recipe code</td>
            <td class="meta-value-cell">${code}</td>
            <td class="meta-label-cell">Descr.</td>
            <td class="meta-value-cell">${name}</td>
            <td class="meta-label-cell">Item code</td>
            <td class="meta-value-cell">${itemCode}</td>
          </tr>
          <tr>
            <td class="meta-label-cell">Recipe cost</td>
            <td class="meta-value-cell">${formatCurrency(totalCost)}</td>
            <td class="meta-label-cell">Roundup</td>
            <td class="meta-value-cell">${roundup || "-"}</td>
            <td class="meta-label-cell">Rows</td>
            <td class="meta-value-cell">${componentRows.length}</td>
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
            <td class="numeric total-number">${formatCurrency(totalCost)}</td>
          </tr>
        </table>
      </div>
    </body>
  </html>`;
}

function buildCostSheetPackHtmlV2(menu, recipesForMenu = [], ingredientMap = new Map(), batchMap = new Map()) {
  const sectionsHtml = recipesForMenu
    .map((recipe) => {
      const componentRows = buildRecipeCostSheetRowsV2(recipe, ingredientMap, batchMap);
      const pricing = getRecipePricingMetrics(recipe, ingredientMap, batchMap);
      const componentRowsHtml = componentRows
        .map(
          (row) => `
            <tr>
              <td>${row.ingredientCode || ""}</td>
              <td>${row.description || ""}</td>
              <td>${row.unitOfMeasure || ""}</td>
              <td class="numeric">${formatCurrency(row.unitPrice || 0)}</td>
              <td class="numeric">${row.quantityUsed || ""}</td>
              <td class="numeric">${formatCurrency(row.cost || 0)}</td>
            </tr>
          `
        )
        .join("");

      return `
        <section class="sheet">
          <table>
            <tr class="title-row"><th colspan="6">Recipe cost</th></tr>
            <tr>
              <td class="meta-label-cell">Recipe code</td>
              <td class="meta-value-cell">${recipe.id || recipe.code || ""}</td>
              <td class="meta-label-cell">Descr.</td>
              <td class="meta-value-cell">${recipe.name || ""}</td>
              <td class="meta-label-cell">Item code</td>
              <td class="meta-value-cell">${recipe.code || ""}</td>
            </tr>
            <tr>
              <td class="meta-label-cell">Recipe cost</td>
              <td class="meta-value-cell">${formatCurrency(pricing.recipeCost)}</td>
              <td class="meta-label-cell">Roundup</td>
              <td class="meta-value-cell">${formatCurrency(pricing.roundup)}</td>
              <td class="meta-label-cell">Menu</td>
              <td class="meta-value-cell">${menu.name}</td>
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
              <td class="numeric total-number">${formatCurrency(pricing.recipeCost)}</td>
            </tr>
          </table>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${menu.name} costing pack</title>
      <style>
        body { margin: 0; background: #eef2f7; color: #111827; font-family: Arial, Helvetica, sans-serif; }
        .page { max-width: 1120px; margin: 0 auto; padding: 24px; }
        .page-header { margin-bottom: 20px; }
        .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
        h1 { margin: 8px 0 6px; font-size: 28px; }
        p { margin: 0; color: #5b6472; }
        .sheet { margin: 0 0 24px; page-break-after: always; }
        .sheet:last-child { page-break-after: auto; }
        table { width: 100%; border-collapse: collapse; background: white; table-layout: fixed; box-shadow: 0 12px 32px rgba(17, 24, 39, 0.06); }
        th, td { border: 1px solid #b8c1cc; padding: 7px 8px; font-size: 12px; vertical-align: middle; }
        .title-row th { background: #ececec; font-size: 16px; text-align: center; font-weight: 700; }
        .meta-label-cell { background: #f3f3f3; font-weight: 700; }
        .meta-value-cell { background: #fff; }
        .header-row th { background: #f3f3f3; font-weight: 700; text-align: left; vertical-align: bottom; }
        .numeric { text-align: right; font-variant-numeric: tabular-nums; }
        .total-label, .total-number { font-style: italic; font-weight: 700; background: #fafafa; }
        @media print { body { background: white; } .page { padding: 0; } .sheet { box-shadow: none; } }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="page-header">
          <div class="eyebrow">Menu costing pack</div>
          <h1>${menu.name}</h1>
          <p>${menu.restaurant} · ${menu.service}</p>
        </div>
        ${sectionsHtml}
      </div>
    </body>
  </html>`;
}

function buildChefSheetHtmlV2(record, componentRows = [], options = {}) {
  const isBatch = options.type === "batch";
  const methodLines = (record.methodSteps || []).map((step) => String(step || "").trim()).filter(Boolean);
  const componentsHtml = componentRows
    .map(
      (row) => `
        <tr>
          <td>${row.description || ""}</td>
          <td>${row.ingredientCode || ""}</td>
          <td>${row.quantityUsed || ""}</td>
          <td>${row.unitOfMeasure || ""}</td>
          <td>${formatCurrency(row.cost || 0)}</td>
        </tr>
      `
    )
    .join("");
  const methodHtml = methodLines.length ? methodLines.map((line) => `<li>${line}</li>`).join("") : "<li>Add method notes in the app before printing.</li>";
  const imageHtml =
    !isBatch && record.finishedDishImage
      ? `<div class="hero-image"><img src="${record.finishedDishImage}" alt="Completed dish" /></div>`
      : `<div class="hero-placeholder">${isBatch ? "Component recipe print sheet" : "Add a completed dish image in the app to include it here."}</div>`;
  const metaRight = isBatch
    ? `<div class="stat"><span>Yield</span><strong>${record.yieldLabel || ""}</strong></div>
       <div class="stat"><span>Cost per unit</span><strong>${formatCurrency(options.unitCost || 0)}</strong></div>`
    : `<div class="stat"><span>Sale price</span><strong>${formatCurrency(record.salePrice || 0)}</strong></div>
       <div class="stat"><span>Gross profit</span><strong>${formatPercent(options.grossProfit || 0)}</strong></div>`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${record.name} chef sheet</title>
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
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div>
            <div class="eyebrow">Peligoni chef sheet</div>
            <h1>${record.name}</h1>
            <div>
              <span class="tag">${isBatch ? "Component recipe" : "Dish recipe"}</span>
              <span class="tag">${isBatch ? record.productType || "No product type" : record.category || "No category"}</span>
            </div>
          </div>
          <div><div class="eyebrow">Item code</div><strong>${record.code || "Missing"}</strong></div>
        </div>
        <div class="meta">
          <div class="stat"><span>Recipe cost</span><strong>${formatCurrency(options.totalCost || 0)}</strong></div>
          ${metaRight}
          <div class="stat"><span>Components</span><strong>${componentRows.length}</strong></div>
        </div>
        <div class="layout">
          <div>
            <div class="card">
              <div class="eyebrow">Ingredients</div>
              <table>
                <thead><tr><th>Ingredient</th><th>Code</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead>
                <tbody>${componentsHtml}</tbody>
              </table>
            </div>
            <div class="card">
              <div class="eyebrow">Method</div>
              <ul>${methodHtml}</ul>
            </div>
          </div>
          <div>
            <div class="card">
              <div class="eyebrow">${isBatch ? "Reference" : "Presentation"}</div>
              ${imageHtml}
            </div>
            <div class="card">
              <div class="eyebrow">${isBatch ? "Prep notes" : "Plating notes"}</div>
              <ul><li>${isBatch ? (record.prepNotes || "Add notes in the app before printing.") : (record.platingNotes || "Add plating notes in the app before printing.")}</li></ul>
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

function getBatchWorkflowProgress(batch, ingredientMap = new Map()) {
  const batchCostSource = getBatchCostSource(batch, ingredientMap);
  const checks = [
    Boolean(batch.name && batch.code && batch.productType),
    Boolean((batch.ingredientLines || []).length),
    Boolean((batch.methodSteps || []).some((step) => String(step || "").trim())),
    Boolean(Number(batch.yieldAmount || 0) > 0 && Number(batchCostSource.totalComponentCost || 0) > 0),
  ];
  const completeCount = checks.filter(Boolean).length;

  return {
    completeCount,
    total: checks.length,
  };
}

function batchHasMethod(batch) {
  return Boolean((batch?.methodSteps || []).some((step) => String(step || "").trim()));
}

function getBatchWorkflowMissingItems(batch, ingredientMap = new Map(), { includeOptional = false } = {}) {
  const batchCostSource = getBatchCostSource(batch, ingredientMap);
  const missing = [];

  if (!(batch.name && batch.code && batch.productType)) {
    missing.push("basics");
  }
  if (!((batch.ingredientLines || []).length)) {
    missing.push("ingredients");
  }
  if (includeOptional && !batchHasMethod(batch)) {
    missing.push("method");
  }
  if (!(Number(batch.yieldAmount || 0) > 0 && Number(batchCostSource.totalComponentCost || 0) > 0)) {
    missing.push("yield and cost");
  }

  return missing;
}

function isBatchReadyToPublish(batch, ingredientMap = new Map()) {
  const batchCostSource = getBatchCostSource(batch, ingredientMap);
  return Boolean(
    batch?.name &&
    batch?.code &&
    batch?.productType &&
    (batch?.ingredientLines || []).length &&
    Number(batch?.yieldAmount || 0) > 0 &&
    Number(batchCostSource.totalComponentCost || 0) > 0
  );
}

function getBatchStageLabel(status = "") {
  if (status === "review") return "ready";
  if (status === "ready") return "published";
  return status || "draft";
}

function createEmptyRecipe(recipeCount = 0) {
  const nextNumber = recipeCount + 120;
  return syncRecipeRelations({
    id: `rec-${Date.now()}`,
    name: "New dish",
    code: `DISH${nextNumber}`,
    status: "draft",
    sharedDirty: true,
    sharedPersisted: false,
    category: "Main",
    menuDescription: "",
    methodSteps: ["", "", ""],
    prepNotes: "",
    platingNotes: "",
    chefNotes: "",
    finishedDishImage: "",
    portions: 1,
    salePrice: 0,
    serviceSuitability: [],
    ingredientLines: [],
    batchLines: [],
    ingredientIds: [],
    batchIds: [],
    menuIds: [],
    archived: false,
  });
}

function formatBatchYieldLabel(amount = 0, unit = "") {
  const numericAmount = Number(amount || 0);
  const displayAmount = Number.isInteger(numericAmount) ? String(numericAmount) : String(numericAmount || "");
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (!displayAmount || !normalizedUnit) return "";
  if (normalizedUnit === "piece") {
    return `${displayAmount} ${numericAmount === 1 ? "piece" : "pieces"}`;
  }
  return `${displayAmount}${normalizedUnit}`;
}

function syncBatchRecord(batch) {
  const yieldAmount = Number(batch?.yieldAmount || 0);
  const yieldUnit = String(batch?.yieldUnit || "").trim().toLowerCase();
  const ingredientIds = dedupeTextList((batch?.ingredientLines || []).map((line) => line.ingredientId).filter(Boolean));

  return {
    ...batch,
    sharedDirty: Boolean(batch?.sharedDirty),
    sharedPersisted: Boolean(batch?.sharedPersisted),
    yieldAmount,
    yieldUnit,
    ingredientIds,
    yieldLabel: formatBatchYieldLabel(yieldAmount, yieldUnit),
  };
}

function createEmptyBatch(batchCount = 0) {
  const nextNumber = batchCount + 20;
  return syncBatchRecord({
    id: `bat-${Date.now()}`,
    name: "New component",
    code: `BCH${String(nextNumber).padStart(3, "0")}`,
    status: "draft",
    sharedDirty: true,
    sharedPersisted: false,
    usedInRecipeIds: [],
    productType: "",
    publishedIngredientId: "",
    ingredientLines: [],
    ingredientIds: [],
    yieldAmount: 1,
    yieldUnit: "kg",
    unitCost: 0,
    costUnit: "kg",
    portionCostHint: 0,
    methodSteps: [""],
    prepNotes: "",
    archived: false,
  });
}

function deriveBatchYieldFromIngredient(ingredient = {}) {
  const packSize = String(ingredient.packSize || "").trim().toLowerCase();
  const parsedPack = parsePackSizeComponents(packSize);

  if (parsedPack?.totalAmount > 0) {
    const unit =
      parsedPack.totalUnit === "piece"
        ? "piece"
        : parsedPack.totalUnit === "kg"
          ? "kg"
          : parsedPack.totalUnit === "l"
            ? "l"
            : inferMeasurementUnit(packSize);
    return {
      yieldAmount: parsedPack.totalAmount,
      yieldUnit: unit || "kg",
    };
  }

  const fallbackUnit = String(ingredient.costUnit || inferMeasurementUnit(packSize) || "kg").trim().toLowerCase();
  const normalizedFallbackUnit =
    fallbackUnit === "pc" ? "piece" :
    fallbackUnit || "kg";

  return {
    yieldAmount: 1,
    yieldUnit: normalizedFallbackUnit,
  };
}

function createBatchDraftFromIngredient(ingredient = {}, batchCount = 0) {
  const emptyBatch = createEmptyBatch(batchCount);
  const parsedIndex = parseIngredientIndexBase(ingredient.name, ingredient.packSize);
  const { yieldAmount, yieldUnit } = deriveBatchYieldFromIngredient(ingredient);

  return syncBatchRecord({
    ...emptyBatch,
    name: String(ingredient.name || "").trim() || emptyBatch.name,
    code: hasBchCode(ingredient.code || "") ? String(ingredient.code || "").trim() : emptyBatch.code,
    productType: parsedIndex.product || "",
    publishedIngredientId: ingredient.id || "",
    ingredientLines: [],
    ingredientIds: [],
    yieldAmount,
    yieldUnit,
    unitCost: Number(ingredient.unitCost || 0),
    costUnit: String(ingredient.costUnit || yieldUnit || "kg").trim() || "kg",
    portionCostHint: Number(ingredient.portionCostHint || 0),
    prepNotes: `Draft component created from ingredient ${String(ingredient.code || ingredient.name || "").trim()}. Rebuild the underlying ingredient lines here.`,
  });
}

function createRecipeDraftFromBatch(batch = {}, recipeCount = 0) {
  const emptyRecipe = createEmptyRecipe(recipeCount);
  const yieldAmount = Number(batch.yieldAmount || 0);
  const yieldUnit = String(batch.yieldUnit || "").trim().toLowerCase();
  const inferredPortions =
    yieldUnit === "portion" && yieldAmount > 0
      ? Math.max(1, Math.round(yieldAmount))
      : 1;

  return syncRecipeRelations({
    ...emptyRecipe,
    name: String(batch.name || "").trim() || emptyRecipe.name,
    category: "Special",
    menuDescription: "",
    methodSteps: (batch.methodSteps || []).length ? [...batch.methodSteps] : emptyRecipe.methodSteps,
    prepNotes: String(batch.prepNotes || "").trim(),
    platingNotes: "",
    chefNotes: `Converted from component ${String(batch.code || batch.id || "").trim()}. Review portions, category, and menu wording before publishing.`,
    portions: inferredPortions,
    ingredientLines: (batch.ingredientLines || []).map((line) => ({
      ingredientId: line.ingredientId,
      quantity: String(line.quantity || "").trim(),
      unit: String(line.unit || "").trim(),
      estimatedCost: Number(line.estimatedCost || 0),
    })),
    batchLines: [],
    ingredientIds: dedupeTextList((batch.ingredientLines || []).map((line) => line.ingredientId).filter(Boolean)),
    batchIds: [],
    menuIds: [],
    status: "draft",
    sharedDirty: true,
    sharedPersisted: false,
  });
}

function createEmptyIngredient(ingredientCount = 0) {
  const nextNumber = ingredientCount + 1;
  return {
    id: `ing-${Date.now()}`,
    name: "New ingredient",
    code: `INT.ITEM.${String(nextNumber).padStart(3, "0")}`,
    sourceCode: "",
    aliases: [],
    status: "review",
    packSize: "",
    supplier: "",
    category: "",
    tradeCategory: "",
    sourceType: "manual",
    soft1Status: "pending",
    sourceRecordLabel: "Manual ingredient creation",
    lastImportedAt: "",
    unitCost: 0,
    purchaseVatRate: 13,
    costUnit: "kg",
    portionCostHint: 0,
    usedInRecipeIds: [],
    batchId: "",
    archived: false,
    sharedRecordId: "",
    sharedUpdatedAt: "",
    lastImportPriceMissing: false,
    masterReviewStatus: "ready",
    sharedDirty: false,
    notes: "Manual ingredient record created from the clean ingredient master.",
  };
}

function sanitizeIngredientDraft(draft, ingredientCount = 0) {
  const fallback = createEmptyIngredient(ingredientCount);
  return {
    ...fallback,
    ...draft,
    name: String(draft?.name || fallback.name).trim() || fallback.name,
    code: String(draft?.code || fallback.code).trim() || fallback.code,
    sourceCode: String(draft?.sourceCode || "").trim(),
    aliases: dedupeTextList(draft?.aliases || []),
    packSize: String(draft?.packSize || "").trim(),
    supplier: String(draft?.supplier || "").trim(),
    category: String(draft?.category || "").trim(),
    tradeCategory: String(draft?.tradeCategory || "").trim(),
    sourceType: draft?.sourceType || fallback.sourceType,
    soft1Status: draft?.soft1Status || fallback.soft1Status,
    sourceRecordLabel: String(draft?.sourceRecordLabel || fallback.sourceRecordLabel).trim() || fallback.sourceRecordLabel,
    lastImportedAt: String(draft?.lastImportedAt || "").trim(),
    unitCost: Number(draft?.unitCost || 0),
    purchaseVatRate: normalizeVatPercent(draft?.purchaseVatRate, fallback.purchaseVatRate),
    costUnit: String(draft?.costUnit || fallback.costUnit).trim() || fallback.costUnit,
    portionCostHint: Number(draft?.portionCostHint || 0),
    archived: Boolean(draft?.archived),
    sharedRecordId: String(draft?.sharedRecordId || "").trim(),
    sharedUpdatedAt: String(draft?.sharedUpdatedAt || "").trim(),
    lastImportPriceMissing: Boolean(draft?.lastImportPriceMissing),
    masterReviewStatus: draft?.masterReviewStatus || fallback.masterReviewStatus,
    sharedDirty: Boolean(draft?.sharedDirty),
    notes: String(draft?.notes || "").trim() || fallback.notes,
  };
}

function inferMeasurementUnit(label = "") {
  const text = String(label || "").trim().toLowerCase();
  if (text.includes("kg")) return "kg";
  if (text.includes("gr") || text.includes(" g") || text.includes("g")) return "g";
  if (text.includes(" ml") || text.includes("ml")) return "ml";
  if (text.includes("lt") || text.includes(" l") || text.endsWith("l")) return "l";
  if (text.includes("pc") || text.includes("piece")) return "piece";
  return "g";
}

function inferPricingUnit(label = "") {
  const lineUnit = inferMeasurementUnit(label);
  if (lineUnit === "g" || lineUnit === "kg") return "kg";
  if (lineUnit === "ml" || lineUnit === "l") return "l";
  if (lineUnit === "piece") return "piece";
  return lineUnit || "kg";
}

function getMeasurementUnitFamily(unit = "") {
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (normalizedUnit === "g" || normalizedUnit === "kg") return "mass";
  if (normalizedUnit === "ml" || normalizedUnit === "l") return "volume";
  if (normalizedUnit === "piece" || normalizedUnit === "pc" || normalizedUnit === "pcs") return "piece";
  if (normalizedUnit === "portion") return "portion";
  if (normalizedUnit === "tray") return "tray";
  if (normalizedUnit === "jar") return "jar";
  if (normalizedUnit === "bottle") return "bottle";
  return normalizedUnit;
}

function mapSharedSourceYieldTypeToLineUnit(sourceYieldType = "", fallbackLabel = "") {
  const normalized = String(sourceYieldType || "").trim().toLowerCase();
  const normalizedFallback = String(fallbackLabel || "").trim().toLowerCase();
  if (normalized === "kg") return "kg";
  if (normalized === "g") return "g";
  if (normalized === "l") return "l";
  if (normalized === "ml") return "ml";
  if (normalized === "portion") return "portion";
  if (normalized === "tray") return "tray";
  if (normalized === "jar") return "jar";
  if (normalized === "bottle") return "bottle";
  if (normalizedFallback === "portion") return "portion";
  if (normalizedFallback === "tray") return "tray";
  if (normalizedFallback === "jar") return "jar";
  if (normalizedFallback === "bottle") return "bottle";
  return inferMeasurementUnit(fallbackLabel);
}

function getIngredientUsageLineUnit(ingredient = {}) {
  const normalizedCostUnit = getNormalizedIngredientCostUnit(ingredient?.costUnit || "");
  if (normalizedCostUnit === "kg" || normalizedCostUnit === "g") return "g";
  if (normalizedCostUnit === "l" || normalizedCostUnit === "ml") return "ml";
  if (normalizedCostUnit === "piece") return "piece";

  const inferredPackUnit = inferMeasurementUnit(ingredient?.packSize || "");
  if (inferredPackUnit === "kg" || inferredPackUnit === "g") return "g";
  if (inferredPackUnit === "l" || inferredPackUnit === "ml") return "ml";
  if (inferredPackUnit === "piece") return "piece";

  return "g";
}

function resolveSharedIngredientLineUnit(component = {}, ingredient = null) {
  const explicitSourceUnit = String(component?.source_yield_type || "").trim();
  if (explicitSourceUnit) {
    return mapSharedSourceYieldTypeToLineUnit(explicitSourceUnit, ingredient?.packSize || ingredient?.costUnit || "");
  }

  return getIngredientUsageLineUnit(ingredient);
}

function getSharedYieldAmountInLineUnit(yieldAmount = 0, yieldType = "") {
  const amount = numberValue(yieldAmount);
  const normalizedType = String(yieldType || "").trim().toLowerCase();
  if (!(amount > 0)) {
    return {
      amount: 0,
      unit: mapSharedSourceYieldTypeToLineUnit(normalizedType, normalizedType),
    };
  }

  if (normalizedType === "kg") return { amount: amount * 1000, unit: "g" };
  if (normalizedType === "g") return { amount, unit: "g" };
  if (normalizedType === "l") return { amount: amount * 1000, unit: "ml" };
  if (normalizedType === "ml") return { amount, unit: "ml" };
  if (normalizedType === "portion") return { amount, unit: "portion" };
  if (normalizedType === "tray") return { amount, unit: "tray" };
  if (normalizedType === "jar") return { amount, unit: "jar" };
  if (normalizedType === "bottle") return { amount, unit: "bottle" };

  return {
    amount,
    unit: mapSharedSourceYieldTypeToLineUnit(normalizedType, normalizedType),
  };
}

function mergeSharedIngredientLines(lines = []) {
  const merged = new Map();

  (lines || []).forEach((line) => {
    if (!line?.ingredientId) return;
    const unit = String(line.unit || "").trim().toLowerCase();
    const key = `${line.ingredientId}::${unit}`;
    const quantity = parseNumericQuantity(line.quantity);
    const estimatedCost = Number(line.estimatedCost || 0);

    if (!merged.has(key)) {
      merged.set(key, {
        ...line,
        unit,
        quantity: formatEditableQuantity(quantity),
        estimatedCost,
      });
      return;
    }

    const current = merged.get(key);
    current.quantity = formatEditableQuantity(parseNumericQuantity(current.quantity) + quantity);
    current.estimatedCost = Number(current.estimatedCost || 0) + estimatedCost;
  });

  return Array.from(merged.values());
}

function buildMissingSharedSourceLineDetail(component = {}) {
  return {
    label: String(component?.ingredient_name || component?.ingredient_item_code || "Unknown source line").trim(),
    quantity: formatEditableQuantity(numberValue(component?.qty)),
    unit: String(component?.source_yield_type || "").trim(),
    cost: numberValue(component?.cost),
  };
}

function formatMissingSharedSourceLineDetail(detail = {}) {
  const label = String(detail?.label || "Unknown source line").trim();
  const quantity = String(detail?.quantity || "").trim();
  const unit = String(detail?.unit || "").trim();
  const qtyLabel = [quantity, unit].filter(Boolean).join(" ").trim();
  return qtyLabel ? `${label} · ${qtyLabel}` : label;
}

function isSameMissingSharedSourceLineDetail(left = {}, right = {}) {
  return (
    String(left?.label || "").trim() === String(right?.label || "").trim() &&
    String(left?.quantity || "").trim() === String(right?.quantity || "").trim() &&
    String(left?.unit || "").trim() === String(right?.unit || "").trim()
  );
}

function getIngredientSourceType(ingredient = {}) {
  if (ingredient.sourceType) return ingredient.sourceType;
  return ingredient.sourceCode ? "soft1" : "manual";
}

function getIngredientSoft1Status(ingredient = {}) {
  if (ingredient.soft1Status) return ingredient.soft1Status;
  return getIngredientSourceType(ingredient) === "manual" ? "pending" : "in_soft1";
}

function hasBchCode(value = "") {
  return String(value || "").trim().toUpperCase().startsWith("BCH");
}

function getIngredientMasterReviewStatus(ingredient = {}) {
  if (ingredient.masterReviewStatus) return ingredient.masterReviewStatus;
  return getIngredientSourceType(ingredient) === "manual" ? "ready" : ingredient.status === "review" ? "review" : "ready";
}

function resolveHydratedIngredientReviewStatus({
  storedReviewState = null,
  isPublishedComponent = false,
  hasBchIngredientCode = false,
  hasSoft1SourceCode = false,
}) {
  if (storedReviewState) {
    return String(storedReviewState.status || "ready").trim() || "ready";
  }

  if (isPublishedComponent) {
    return hasBchIngredientCode ? "review" : "ready";
  }

  if (hasSoft1SourceCode) {
    return "ready";
  }

  return "ready";
}

function resolvePublishedIngredientCode(batch = {}, ingredients = [], currentIngredientId = "") {
  const preferredCode = String(batch.code || "").trim();
  if (preferredCode && !getIngredientCodeConflict(ingredients, preferredCode, currentIngredientId)) {
    return preferredCode;
  }

  return generateIngredientCodeFromDraft(
    {
      name: batch.name,
      packSize: formatBatchYieldLabel(batch.yieldAmount, batch.yieldUnit),
    },
    ingredients,
    currentIngredientId
  );
}

function buildPublishedIngredientFromBatch(batch = {}, existingIngredient = null, ingredients = []) {
  const nextId = existingIngredient?.id || `ing-${Date.now()}`;
  const nextCode = resolvePublishedIngredientCode(batch, ingredients, existingIngredient?.id || "");
  const nextCategory =
    String(existingIngredient?.category || "").trim() ||
    String(batch?.productType || "").trim() ||
    "Component recipes";

  return sanitizeIngredientDraft(
    {
      ...existingIngredient,
      id: nextId,
      name: String(batch.name || "").trim() || existingIngredient?.name || "New ingredient",
      code: nextCode,
      sourceCode: "",
      status: "ready",
      packSize: formatBatchYieldLabel(batch.yieldAmount, batch.yieldUnit),
      supplier: existingIngredient?.supplier || "",
      category: nextCategory,
      sourceType: "manual",
      soft1Status: "pending",
      sourceRecordLabel: "Published from component",
      lastImportedAt: "",
      unitCost: Number(batch.unitCost || 0),
      purchaseVatRate: Number(existingIngredient?.purchaseVatRate ?? 13),
      costUnit: String(batch.costUnit || batch.yieldUnit || "kg").trim() || "kg",
      portionCostHint: Number(batch.portionCostHint || 0),
      batchId: batch.id,
      notes:
        String(existingIngredient?.notes || "").trim() ||
        "Published from a component so it can be used from the ingredient master.",
    },
    ingredients.length
  );
}

function findPublishedIngredientForBatch(batch = {}, ingredientSource = []) {
  if (!batch) return null;
  const batchId = String(batch.id || "").trim();
  const publishedIngredientId = String(batch.publishedIngredientId || "").trim();
  const ingredientList =
    ingredientSource instanceof Map
      ? Array.from(ingredientSource.values())
      : Array.isArray(ingredientSource)
        ? ingredientSource
        : [];

  if (publishedIngredientId) {
    if (ingredientSource instanceof Map) {
      const directMatch = ingredientSource.get(publishedIngredientId) || null;
      if (directMatch) return directMatch;
    } else {
      const directMatch = ingredientList.find((ingredient) => ingredient.id === publishedIngredientId) || null;
      if (directMatch) return directMatch;
    }
  }

  if (!batchId) return null;
  return (
    ingredientList.find((ingredient) => String(ingredient.batchId || "").trim() === batchId && !ingredient.archived) ||
    ingredientList.find((ingredient) => String(ingredient.batchId || "").trim() === batchId) ||
    null
  );
}

function statusTone(status) {
  if (status === "live" || status === "ready") return "good";
  if (status === "review") return "warn";
  return "default";
}

function getRecordArchiveLabel(record = {}) {
  return record?.archived ? "archived" : "active";
}

function buildIngredientImpactSummary(ingredient, relationshipMaps, batchMap = new Map()) {
  const recipeCount = (relationshipMaps?.ingredientRecipes?.get(ingredient.id) || []).length;
  const componentLinks = Array.from(batchMap.values()).filter((batch) =>
    (batch.ingredientIds || []).includes(ingredient.id)
  );

  return `${recipeCount} recipe${recipeCount === 1 ? "" : "s"} and ${componentLinks.length} component${componentLinks.length === 1 ? "" : "s"}`;
}

function buildRecipeImpactSummary(recipe, menuMap = new Map()) {
  const menuCount = (recipe.menuIds || []).filter((menuId) => menuMap.has(menuId)).length;
  return `${menuCount} menu${menuCount === 1 ? "" : "s"}`;
}

function buildBatchImpactSummary(batch, relationshipMaps, ingredientMap = new Map()) {
  const recipeCount = (relationshipMaps?.batchRecipes?.get(batch.id) || []).length;
  const hasPublishedIngredient = Boolean(
    batch.publishedIngredientId && ingredientMap.has(batch.publishedIngredientId)
  );
  return `${recipeCount} recipe${recipeCount === 1 ? "" : "s"}${hasPublishedIngredient ? " and 1 published ingredient" : ""}`;
}

function buildMenuImpactSummary(menu) {
  const dishCount = (menu?.items || []).length;
  return `${dishCount} dish${dishCount === 1 ? "" : "es"}`;
}

function formatEditableQuantity(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return String(value || "");
  if (Number.isInteger(numericValue)) return String(numericValue);
  return String(Number(numericValue.toFixed(3)));
}

function substituteIngredientLines(lines = [], fromIngredientId = "", toIngredientId = "") {
  const sourceLines = lines.filter((line) => line.ingredientId === fromIngredientId);
  if (!sourceLines.length || !toIngredientId) {
    return {
      lines,
      touched: false,
      applied: false,
      merged: false,
      conflict: false,
    };
  }

  const replacementLine = lines.find((line) => line.ingredientId === toIngredientId) || null;
  if (!replacementLine) {
    return {
      lines: lines.map((line) =>
        line.ingredientId === fromIngredientId
          ? {
              ...line,
              ingredientId: toIngredientId,
            }
          : line
      ),
      touched: true,
      applied: true,
      merged: false,
      conflict: false,
    };
  }

  const mergeable = sourceLines.every(
    (line) =>
      String(line.unit || "").trim().toLowerCase() === String(replacementLine.unit || "").trim().toLowerCase() &&
      Number.isFinite(Number(line.quantity || 0))
  );

  if (!mergeable || !Number.isFinite(Number(replacementLine.quantity || 0))) {
    return {
      lines,
      touched: true,
      applied: false,
      merged: false,
      conflict: true,
    };
  }

  const mergedQuantity = sourceLines.reduce((sum, line) => sum + Number(line.quantity || 0), Number(replacementLine.quantity || 0));
  const nextLines = [];
  let replacementAdded = false;

  lines.forEach((line) => {
    if (line.ingredientId === fromIngredientId) return;
    if (line.ingredientId === toIngredientId) {
      nextLines.push({
        ...line,
        quantity: formatEditableQuantity(mergedQuantity),
      });
      replacementAdded = true;
      return;
    }
    nextLines.push(line);
  });

  if (!replacementAdded) {
    nextLines.push({
      ...replacementLine,
      quantity: formatEditableQuantity(mergedQuantity),
    });
  }

  return {
    lines: nextLines,
    touched: true,
    applied: true,
    merged: true,
    conflict: false,
  };
}

function calculateIngredientSubstitutionImpact(fromIngredientId = "", toIngredientId = "", recipes = [], batches = []) {
  const summarize = (records, getLines) =>
    records.reduce(
      (summary, record) => {
        const outcome = substituteIngredientLines(getLines(record), fromIngredientId, toIngredientId);
        if (!outcome.touched) return summary;

        summary.touched += 1;
        if (outcome.applied) {
          summary.updated += 1;
          if (outcome.merged) {
            summary.merged += 1;
          }
          summary.updatedRecords.push(record);
        }
        if (outcome.conflict) {
          summary.conflicts += 1;
          summary.conflictRecords.push(record);
        }
        return summary;
      },
      {
        touched: 0,
        updated: 0,
        merged: 0,
        conflicts: 0,
        updatedRecords: [],
        conflictRecords: [],
      }
    );

  const recipeSummary = summarize(recipes, (record) => record.ingredientLines || []);
  const batchSummary = summarize(batches, (record) => record.ingredientLines || []);

  return {
    recipes: recipeSummary,
    batches: batchSummary,
    totalTouched: recipeSummary.touched + batchSummary.touched,
    totalUpdated: recipeSummary.updated + batchSummary.updated,
    totalMerged: recipeSummary.merged + batchSummary.merged,
    totalConflicts: recipeSummary.conflicts + batchSummary.conflicts,
  };
}

function buildIngredientSubstitutionOpportunities(ingredients = [], recipes = [], batches = [], menus = []) {
  const menuMap = new Map(menus.map((menu) => [menu.id, menu]));

  const ingredientUsage = ingredients.map((ingredient) => {
    const recipeLinks = recipes.filter((recipe) => (recipe.ingredientIds || []).includes(ingredient.id));
    const batchLinks = batches.filter((batch) => (batch.ingredientIds || []).includes(ingredient.id));
    const parentRecipeLinks = Array.from(
      new Map(
        batchLinks
          .flatMap((batch) => recipes.filter((recipe) => (recipe.batchIds || []).includes(batch.id)))
          .map((recipe) => [recipe.id, recipe])
      ).values()
    );
    const menuLinks = Array.from(
      new Map(
        [...recipeLinks, ...parentRecipeLinks]
          .flatMap((recipe) => (recipe.menuIds || []).map((menuId) => menuMap.get(menuId)))
          .filter(Boolean)
          .map((menu) => [menu.id, menu])
      ).values()
    );
    const restaurants = Array.from(new Set(menuLinks.map((menu) => menu.restaurant).filter(Boolean)));

    return {
      ingredient,
      nameIndex: parseIngredientIndexBase(ingredient.name, ingredient.packSize),
      recipeLinks,
      batchLinks,
      parentRecipeLinks,
      menuLinks,
      restaurants,
    };
  });

  return ingredientUsage
    .map((source) => {
      const sourceProduct = normalizeIngredientKey(source.nameIndex.product);
      const sourceDietary = normalizeIngredientKey(source.nameIndex.dietary);
      const sourceState = normalizeIngredientKey(source.nameIndex.state);
      const sourceUnit = normalizeIngredientKey(source.ingredient.costUnit || "");
      if (!sourceProduct || !sourceUnit || !Number(source.ingredient.unitCost || 0)) return null;

      const candidates = ingredientUsage
        .filter((candidate) => candidate.ingredient.id !== source.ingredient.id)
        .filter((candidate) => normalizeIngredientKey(candidate.nameIndex.product) === sourceProduct)
        .filter((candidate) => normalizeIngredientKey(candidate.ingredient.costUnit || "") === sourceUnit)
        .filter((candidate) =>
          sourceDietary && normalizeIngredientKey(candidate.nameIndex.dietary)
            ? normalizeIngredientKey(candidate.nameIndex.dietary) === sourceDietary
            : true
        )
        .filter((candidate) =>
          sourceState && normalizeIngredientKey(candidate.nameIndex.state)
            ? normalizeIngredientKey(candidate.nameIndex.state) === sourceState
            : true
        )
        .map((candidate) => {
          const savingsPerUnit = Number(source.ingredient.unitCost || 0) - Number(candidate.ingredient.unitCost || 0);
          const confidence =
            normalizeIngredientKey(candidate.ingredient.category) === normalizeIngredientKey(source.ingredient.category)
              ? "strong"
              : "possible";
          return {
            ingredient: candidate.ingredient,
            savingsPerUnit,
            confidence,
          };
        })
        .filter((candidate) => candidate.savingsPerUnit > 0)
        .sort((left, right) => right.savingsPerUnit - left.savingsPerUnit);

      if (!candidates.length) return null;

      const usageWeight =
        source.recipeLinks.length * 3 +
        source.batchLinks.length * 2 +
        source.parentRecipeLinks.length * 3 +
        source.menuLinks.length * 4 +
        source.restaurants.length * 5;
      const bestCandidate = candidates[0];
      const estimatedImpact = Number((bestCandidate.savingsPerUnit * Math.max(1, usageWeight)).toFixed(2));

      return {
        sourceIngredient: source.ingredient,
        product: source.nameIndex.product || "Unclassified",
        recipeCount: source.recipeLinks.length,
        componentCount: source.batchLinks.length,
        menuCount: source.menuLinks.length,
        restaurantCount: source.restaurants.length,
        usageWeight,
        bestSavingsPerUnit: bestCandidate.savingsPerUnit,
        estimatedImpact,
        candidates: candidates.slice(0, 3),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.estimatedImpact !== left.estimatedImpact) return right.estimatedImpact - left.estimatedImpact;
      if (right.usageWeight !== left.usageWeight) return right.usageWeight - left.usageWeight;
      return left.sourceIngredient.name.localeCompare(right.sourceIngredient.name);
    });
}

function workspaceTone(value) {
  if (value === "review") return "warn";
  if (value === "good") return "good";
  return "default";
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("V2 runtime error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="v2-app">
          <main className="v2-main">
            <div className="v2-panel v2-detail-panel">
              <div className="v2-inline-callout warn">
                <strong>Could not render this screen</strong>
                <span>{this.state.error?.message || "Unknown runtime error"}</span>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [activeSection, setActiveSection] = useState("ingredients");
  const [ingredientMaster, setIngredientMaster] = useState(initialIngredients);
  const [ingredientMasterReviewState, setIngredientMasterReviewState] = useState(() =>
    loadStoredIngredientMasterReviewState()
  );
  const [ingredientSubstitutionState, setIngredientSubstitutionState] = useState({});
  const [ignoredImportRows, setIgnoredImportRows] = useState(() =>
    loadStoredFlagState(IGNORED_IMPORT_ROW_STORAGE_KEY)
  );
  const [resolvedImportRows, setResolvedImportRows] = useState(() =>
    loadStoredFlagState(RESOLVED_IMPORT_ROW_STORAGE_KEY)
  );
  const [ingredientSourceCodeRedirectState, setIngredientSourceCodeRedirectState] = useState(() =>
    loadStoredFlagState(INGREDIENT_SOURCE_CODE_REDIRECT_STORAGE_KEY)
  );
  const [recipeReviewFlagState, setRecipeReviewFlagState] = useState(() =>
    loadStoredFlagState(RECIPE_REVIEW_FLAG_STORAGE_KEY)
  );
  const [batchReviewFlagState, setBatchReviewFlagState] = useState(() =>
    loadStoredFlagState(BATCH_REVIEW_FLAG_STORAGE_KEY)
  );
  const [learningRules, setLearningRules] = useState(() =>
    mergeLearningRules(initialLearningRules, loadStoredLearningRules())
  );
  const [learningRulesSyncState, setLearningRulesSyncState] = useState(supabaseEnabled ? "syncing" : "local");
  const [learningRulesSyncMessage, setLearningRulesSyncMessage] = useState(
    supabaseEnabled ? "Loading shared naming rules..." : "Naming rules are being stored locally in this browser."
  );
  const [lastSharedLearningRuleSignature, setLastSharedLearningRuleSignature] = useState("");
  const [lastSharedLearningRuleIds, setLastSharedLearningRuleIds] = useState([]);
  const [sharedLearningRulesReady, setSharedLearningRulesReady] = useState(!supabaseEnabled);
  const [soft1SourceRows, setSoft1SourceRows] = useState(() => loadStoredSoft1SourceRows());
  const [soft1SourceMeta, setSoft1SourceMeta] = useState(() => loadStoredSoft1SourceMeta());
  const [soft1ImportState, setSoft1ImportState] = useState("");
  const [ingredientImportRows, setIngredientImportRows] = useState(() =>
    buildImportRows(
      loadStoredSoft1SourceRows(),
      initialIngredients,
      mergeLearningRules(initialLearningRules, loadStoredLearningRules()),
      loadStoredFlagState(IGNORED_IMPORT_ROW_STORAGE_KEY),
      loadStoredFlagState(RESOLVED_IMPORT_ROW_STORAGE_KEY),
      loadStoredFlagState(INGREDIENT_SOURCE_CODE_REDIRECT_STORAGE_KEY)
    )
  );
  const [recipes, setRecipes] = useState(initialRecipes.map((recipe) => syncRecipeRelations(recipe)));
  const [batches, setBatches] = useState(initialBatches.map((batch) => syncBatchRecord(batch)));
  const [pendingIngredientDeletionIds, setPendingIngredientDeletionIds] = useState(() =>
    loadStoredIdList(PENDING_INGREDIENT_DELETION_STORAGE_KEY)
  );
  const [deletedIngredientTombstoneIds, setDeletedIngredientTombstoneIds] = useState(() =>
    loadStoredIdList(DELETED_INGREDIENT_TOMBSTONE_STORAGE_KEY)
  );
  const [pendingRecipeDeletionIds, setPendingRecipeDeletionIds] = useState([]);
  const [pendingBatchDeletionIds, setPendingBatchDeletionIds] = useState([]);
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [menus, setMenus] = useState(initialMenus.map((menu) => syncMenuRecord(menu)));
  const [pendingMenuDeletionIds, setPendingMenuDeletionIds] = useState([]);
  const [users, setUsers] = useState(initialUsers);
  const [authSession, setAuthSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(supabaseEnabled);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [sharedDataLoading, setSharedDataLoading] = useState(supabaseEnabled);
  const [sharedDataLoadFailed, setSharedDataLoadFailed] = useState(false);
  const [sharedDataStatus, setSharedDataStatus] = useState(
    supabaseEnabled ? "Checking shared session..." : "Running on prototype data."
  );
  const [userSyncMessage, setUserSyncMessage] = useState("");
  const [userSyncState, setUserSyncState] = useState("idle");
  const [ingredientWorkspaceView, setIngredientWorkspaceView] = useState("catalogue");
  const [recipeEditorStep, setRecipeEditorStep] = useState("basics");
  const [batchEditorStep, setBatchEditorStep] = useState("basics");
  const [menuEditorStep, setMenuEditorStep] = useState("build");
  const [ingredientMakerModal, setIngredientMakerModal] = useState({
    isOpen: false,
    draft: createEmptyIngredient(initialIngredients.length),
    attachToRecipeId: "",
    attachToBatchId: "",
    openRecordAfterSave: true,
  });
  const [ingredientSubstitutionModal, setIngredientSubstitutionModal] = useState({
    isOpen: false,
    sourceIngredientId: "",
    replacementIngredientId: "",
    archiveOriginal: true,
  });
  const [ingredientMergeModal, setIngredientMergeModal] = useState({
    isOpen: false,
    sourceIngredientId: "",
    targetIngredientId: "",
  });
  const [menuMakerModal, setMenuMakerModal] = useState({
    isOpen: false,
    restaurantId: "",
    draft: null,
  });
  const [recordPreviewModal, setRecordPreviewModal] = useState({
    isOpen: false,
    type: "",
    id: "",
  });
  const [menuPreviewModal, setMenuPreviewModal] = useState({
    isOpen: false,
    id: "",
  });
  const [exportPreviewModal, setExportPreviewModal] = useState({
    isOpen: false,
    title: "",
    html: "",
    csvContent: "",
    csvFileName: "",
  });
  const [ingredientProductFilter, setIngredientProductFilter] = useState("all");
  const [ingredientSourceFilter, setIngredientSourceFilter] = useState("all");
  const [ingredientRecordFilter, setIngredientRecordFilter] = useState("all");
  const [ingredientStatusFilter, setIngredientStatusFilter] = useState("all");
  const [recipeCategoryFilter, setRecipeCategoryFilter] = useState("all");
  const [recipeRestaurantFilter, setRecipeRestaurantFilter] = useState("all");
  const [recipeStatusFilter, setRecipeStatusFilter] = useState("all");
  const [batchStatusFilter, setBatchStatusFilter] = useState("all");
  const [substitutionFilter, setSubstitutionFilter] = useState("all");
  const [exportObjectType, setExportObjectType] = useState("recipe");
  const [exportSearchQuery, setExportSearchQuery] = useState("");
  const [recipeExportMode, setRecipeExportMode] = useState("search");
  const [ingredientCodeAlerts, setIngredientCodeAlerts] = useState({});
  const [ingredientSharedSyncState, setIngredientSharedSyncState] = useState({});
  const [ingredientArchiveColumnAvailable, setIngredientArchiveColumnAvailable] = useState(true);
  const [recipeServiceSuitabilityColumnAvailable, setRecipeServiceSuitabilityColumnAvailable] = useState(true);
  const [menuLineDescriptionColumnAvailable, setMenuLineDescriptionColumnAvailable] = useState(true);
  const [ingredientTradeCategoryState, setIngredientTradeCategoryState] = useState(() =>
    loadStoredFlagState(INGREDIENT_TRADE_CATEGORY_STORAGE_KEY)
  );
  const [recipeSharedSyncState, setRecipeSharedSyncState] = useState({});
  const [batchSharedSyncState, setBatchSharedSyncState] = useState({});
  const [menuSharedSyncState, setMenuSharedSyncState] = useState({});
  const [ingredientEditingId, setIngredientEditingId] = useState("");
  const [activeEditSessions, setActiveEditSessions] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState({ type: "ingredient", id: "ing-1" });
  const [selectedImportRowId, setSelectedImportRowId] = useState(() => loadStoredSoft1SourceRows()[0]?.id || "");
  const selectedRecordRef = useRef(selectedRecord);
  const activeSectionRef = useRef(activeSection);
  const ingredientMasterRef = useRef(ingredientMaster);
  const recipesRef = useRef(recipes);
  const batchesRef = useRef(batches);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) {
      setAuthLoading(false);
      setSharedDataLoading(false);
      return undefined;
    }

    let isCancelled = false;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (isCancelled) return;
        if (error) {
          setAuthError(error.message || "Could not check the current session.");
          setAuthLoading(false);
          return;
        }

        setAuthSession(data.session || null);
        setAuthUser(data.session?.user || null);
        setAuthLoading(false);
      })
      .catch((error) => {
        if (isCancelled) return;
        setAuthError(error?.message || "Could not check the current session.");
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isCancelled) return;
      setAuthSession(session || null);
      setAuthUser(session?.user || null);
      setAuthError("");
      setAuthLoading(false);
    });

    return () => {
      isCancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;
    if (authLoading) return undefined;
    if (!authUser) {
      setSharedDataLoading(false);
      setSharedDataLoadFailed(false);
      setSharedDataStatus("Sign in to load shared data.");
      return undefined;
    }

    let isCancelled = false;

    const loadSharedData = async () => {
      try {
        setSharedDataLoading(true);
        setSharedDataLoadFailed(false);
        setSharedDataStatus("Loading shared ingredients, components, recipes, menus, and users...");

        const [
          { data: ingredientRows, error: ingredientError },
          { data: recipeRows, error: recipeError },
          { data: componentRows, error: componentError },
          { data: menuRows, error: menuError },
          { data: menuLineRows, error: menuLineError },
        ] = await Promise.all([
          withTimeout(
            supabase.from("ingredients").select("*").order("ingredient_name"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared ingredients"
          ),
          withTimeout(
            supabase.from("recipes").select("*").order("name"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared recipes"
          ),
          withTimeout(
            supabase.from("recipe_components").select("*").order("component_order"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared components"
          ),
          withTimeout(
            supabase.from("menus").select("*").order("name"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared menus"
          ),
          withTimeout(
            supabase.from("menu_lines").select("*").order("line_order"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared menu lines"
          ),
        ]);

        const [ingredientWorkflowResult, profilesResult] = await Promise.allSettled([
          withTimeout(
            supabase
              .from("ingredient_naming_rules")
              .select("*")
              .in("rule_field", [
                INGREDIENT_REVIEW_STATE_RULE_FIELD,
                INGREDIENT_SUBSTITUTION_STATE_RULE_FIELD,
                INGREDIENT_TRADE_CATEGORY_RULE_FIELD,
                INGREDIENT_SOURCE_CODE_REDIRECT_RULE_FIELD,
                IGNORED_IMPORT_ROW_RULE_FIELD,
                RECIPE_REVIEW_FLAG_RULE_FIELD,
                BATCH_REVIEW_FLAG_RULE_FIELD,
              ]),
            SHARED_LOAD_TIMEOUT_MS,
            "Ingredient workflow sidecar"
          ),
          withTimeout(
            supabase.from("profiles").select("id,email,full_name,role").order("email"),
            SHARED_LOAD_TIMEOUT_MS,
            "Shared users"
          ),
        ]);

        const ingredientWorkflowData =
          ingredientWorkflowResult.status === "fulfilled" ? ingredientWorkflowResult.value?.data || [] : [];
        const ingredientWorkflowError =
          ingredientWorkflowResult.status === "fulfilled"
            ? ingredientWorkflowResult.value?.error || null
            : ingredientWorkflowResult.reason || null;
        const profileRows =
          profilesResult.status === "fulfilled" && !profilesResult.value?.error ? profilesResult.value?.data || [] : [];
        const profilesError =
          profilesResult.status === "fulfilled" ? profilesResult.value?.error || null : profilesResult.reason || null;

        if (ingredientError) throw ingredientError;
        if (recipeError) throw recipeError;
        if (componentError) throw componentError;
        if (menuError) throw menuError;
        if (menuLineError) throw menuLineError;
        const mergedIngredientReviewState = {
          ...ingredientMasterReviewState,
          ...(ingredientWorkflowError
            ? {}
            : parseSharedIngredientReviewStateRows(
                ingredientWorkflowData.filter((row) => row.rule_field === INGREDIENT_REVIEW_STATE_RULE_FIELD)
              )),
        };
        const mergedIngredientSubstitutionState = {
          ...ingredientSubstitutionState,
          ...(ingredientWorkflowError
            ? {}
            : parseSharedIngredientSubstitutionStateRows(
                ingredientWorkflowData.filter((row) => row.rule_field === INGREDIENT_SUBSTITUTION_STATE_RULE_FIELD)
              )),
        };
        const mergedIngredientTradeCategoryState = {
          ...ingredientTradeCategoryState,
          ...(ingredientWorkflowError
            ? {}
            : parseSharedIngredientTradeCategoryRows(
                ingredientWorkflowData.filter((row) => row.rule_field === INGREDIENT_TRADE_CATEGORY_RULE_FIELD)
              )),
        };
        const mergedIngredientSourceCodeRedirectState = {
          ...ingredientSourceCodeRedirectState,
          ...(ingredientWorkflowError
            ? {}
            : parseSharedIngredientSourceCodeRedirectRows(
                ingredientWorkflowData.filter((row) => row.rule_field === INGREDIENT_SOURCE_CODE_REDIRECT_RULE_FIELD)
              )),
        };
        const mergedIgnoredImportRows = ingredientWorkflowError
          ? ignoredImportRows
          : {
              ...ignoredImportRows,
              ...parseSharedFlagRows(
                ingredientWorkflowData.filter((row) => row.rule_field === IGNORED_IMPORT_ROW_RULE_FIELD)
              ),
            };
        const mergedRecipeReviewFlagState = ingredientWorkflowError
          ? recipeReviewFlagState
          : {
              ...recipeReviewFlagState,
              ...parseSharedFlagRows(
                ingredientWorkflowData.filter((row) => row.rule_field === RECIPE_REVIEW_FLAG_RULE_FIELD)
              ),
            };
        const mergedBatchReviewFlagState = ingredientWorkflowError
          ? batchReviewFlagState
          : {
              ...batchReviewFlagState,
              ...parseSharedFlagRows(
                ingredientWorkflowData.filter((row) => row.rule_field === BATCH_REVIEW_FLAG_RULE_FIELD)
              ),
            };

        const visibleIngredientRows = (ingredientRows || []).filter(
          (row) => {
            const rowId = String(row?.id || "").trim();
            return (
              !pendingIngredientDeletionIds.includes(rowId) &&
              !deletedIngredientTombstoneIds.includes(rowId)
            );
          }
        );

        const sharedData = hydrateSharedDataToV2({
          ingredientRows: visibleIngredientRows,
          recipeRows: recipeRows || [],
          componentRows: componentRows || [],
          menuRows: menuRows || [],
          menuLineRows: menuLineRows || [],
          profileRows: profilesError ? [] : profileRows,
          ingredientReviewState: mergedIngredientReviewState,
          ingredientSubstitutionState: mergedIngredientSubstitutionState,
          ingredientTradeCategoryState: mergedIngredientTradeCategoryState,
          recipeReviewFlagState: mergedRecipeReviewFlagState,
          batchReviewFlagState: mergedBatchReviewFlagState,
        });

        if (isCancelled) return;

        const nextImportQueueRows = buildImportRows(
          soft1SourceRows,
          sharedData.ingredients,
          learningRules,
          mergedIgnoredImportRows,
          resolvedImportRows,
          mergedIngredientSourceCodeRedirectState
        );

        setIngredientMaster(sharedData.ingredients);
        setIngredientMasterReviewState(mergedIngredientReviewState);
        setIngredientSubstitutionState(mergedIngredientSubstitutionState);
        setIngredientTradeCategoryState(mergedIngredientTradeCategoryState);
        setIngredientSourceCodeRedirectState(mergedIngredientSourceCodeRedirectState);
        setIgnoredImportRows(mergedIgnoredImportRows);
        setRecipeReviewFlagState(mergedRecipeReviewFlagState);
        setBatchReviewFlagState(mergedBatchReviewFlagState);
        setIngredientImportRows(nextImportQueueRows);
        setRecipes(sharedData.recipes);
        setBatches(sharedData.batches);
        setRestaurants(sharedData.restaurants);
        setMenus(sharedData.menus);
        setUsers(sharedData.users);
        setIngredientWorkspaceView((current) => {
          if (current === "catalogue") return "catalogue";
          return nextImportQueueRows.some((row) => row.reviewStatus === "review")
            ? "review"
            : "catalogue";
        });
        setSelectedImportRowId(nextImportQueueRows[0]?.id || "");
        const currentSelection = selectedRecordRef.current;
        const currentSection = activeSectionRef.current;
        const nextRecordMaps = {
          ingredient: new Map(sharedData.ingredients.map((item) => [item.id, item])),
          recipe: new Map(sharedData.recipes.map((item) => [item.id, item])),
          batch: new Map(sharedData.batches.map((item) => [item.id, item])),
          menu: new Map(sharedData.menus.map((item) => [item.id, item])),
        };
        const canPreserveSelection =
          currentSelection?.type &&
          currentSelection?.id &&
          currentSection !== "ingredients" &&
          nextRecordMaps[currentSelection.type]?.has(currentSelection.id);

        if (canPreserveSelection) {
          setSelectedRecord(currentSelection);
        } else {
          setSelectedRecord(
            nextImportQueueRows.length
              ? { type: "", id: "" }
              : (
                  sharedData.ingredients.find((ingredient) => getIngredientMasterReviewStatus(ingredient) !== "review") ||
                  sharedData.ingredients[0]
                )
                ? {
                    type: "ingredient",
                    id: (
                      sharedData.ingredients.find((ingredient) => getIngredientMasterReviewStatus(ingredient) !== "review") ||
                      sharedData.ingredients[0]
                    ).id,
                  }
                : { type: "", id: "" }
          );
        }
        setSharedDataStatus(
          `${ingredientWorkflowError
            ? "Loaded shared workspace, but could not load ingredient workflow sidecar. "
            : ""}${profilesError
            ? "Loaded shared workspace, but could not load shared users. "
            : ""}Loaded ${sharedData.ingredients.length} ingredients, ${sharedData.batches.length} components, ${sharedData.recipes.length} recipes, and ${sharedData.menus.length} menus from shared data.`
        );
      } catch (error) {
        if (isCancelled) return;
        setSharedDataLoadFailed(true);
        setSharedDataStatus(error?.message || "Could not load shared data.");
      } finally {
        if (!isCancelled) {
          setSharedDataLoading(false);
        }
      }
    };

    loadSharedData();

    return () => {
      isCancelled = true;
    };
  }, [authLoading, authUser, pendingIngredientDeletionIds, deletedIngredientTombstoneIds]);

  const signInToSharedData = async () => {
    if (!supabaseEnabled || !supabase) return;
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setAuthError(error.message || "Could not sign in.");
    }
  };

  const signOutOfSharedData = async () => {
    if (!supabaseEnabled || !supabase) return;
    if (hasPendingSharedChanges && typeof window !== "undefined") {
      const confirmed = window.confirm(
        `There are still pending shared changes.\n\n${sharedSaveSummary || "Some edits have not finished saving yet."}\n\nSign out anyway?`
      );
      if (!confirmed) return;
    }
    await supabase.auth.signOut();
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LEARNING_RULES_STORAGE_KEY, JSON.stringify(learningRules));
  }, [learningRules]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      INGREDIENT_MASTER_REVIEW_STORAGE_KEY,
      serializeIngredientMasterReviewState(ingredientMasterReviewState)
    );
  }, [ingredientMasterReviewState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      INGREDIENT_TRADE_CATEGORY_STORAGE_KEY,
      JSON.stringify(ingredientTradeCategoryState || {})
    );
  }, [ingredientTradeCategoryState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      INGREDIENT_SOURCE_CODE_REDIRECT_STORAGE_KEY,
      JSON.stringify(ingredientSourceCodeRedirectState || {})
    );
  }, [ingredientSourceCodeRedirectState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(IGNORED_IMPORT_ROW_STORAGE_KEY, JSON.stringify(ignoredImportRows || {}));
  }, [ignoredImportRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESOLVED_IMPORT_ROW_STORAGE_KEY, JSON.stringify(resolvedImportRows || {}));
  }, [resolvedImportRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RECIPE_REVIEW_FLAG_STORAGE_KEY, JSON.stringify(recipeReviewFlagState || {}));
  }, [recipeReviewFlagState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PENDING_INGREDIENT_DELETION_STORAGE_KEY,
      JSON.stringify(pendingIngredientDeletionIds || [])
    );
  }, [pendingIngredientDeletionIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      DELETED_INGREDIENT_TOMBSTONE_STORAGE_KEY,
      JSON.stringify(deletedIngredientTombstoneIds || [])
    );
  }, [deletedIngredientTombstoneIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BATCH_REVIEW_FLAG_STORAGE_KEY, JSON.stringify(batchReviewFlagState || {}));
  }, [batchReviewFlagState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOFT1_SOURCE_ROWS_STORAGE_KEY, JSON.stringify(soft1SourceRows || []));
  }, [soft1SourceRows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOFT1_SOURCE_META_STORAGE_KEY, JSON.stringify(soft1SourceMeta || {}));
  }, [soft1SourceMeta]);

  useEffect(() => {
    const recipeMenuMap = recipes.reduce((map, recipe) => {
      map.set(recipe.id, []);
      return map;
    }, new Map());

    menus.forEach((menu) => {
      (menu.recipeIds || []).forEach((recipeId) => {
        if (!recipeMenuMap.has(recipeId)) {
          recipeMenuMap.set(recipeId, []);
        }
        recipeMenuMap.get(recipeId).push(menu.id);
      });
    });

    setRecipes((current) =>
      current.map((recipe) =>
        syncRecipeRelations({
          ...recipe,
          menuIds: dedupeTextList(recipeMenuMap.get(recipe.id) || []),
        })
      )
    );
  }, [menus]);

  const recordMaps = useMemo(
    () => ({
      ingredient: new Map(ingredientMaster.map((item) => [item.id, item])),
      recipe: new Map(recipes.map((item) => [item.id, item])),
      batch: new Map(batches.map((item) => [item.id, item])),
      restaurant: new Map(restaurants.map((item) => [item.id, item])),
      menu: new Map(menus.map((item) => [item.id, item])),
    }),
    [ingredientMaster, recipes, batches, restaurants, menus]
  );

  const ingredientCategoryOptions = useMemo(
    () =>
      buildIngredientCategoryOptions(
        ingredientMaster.map((ingredient) => ingredient.category),
        ingredientImportRows.flatMap((row) => [row.productCategory, row.category]),
        soft1SourceRows.flatMap((row) => [row.productCategory, row.category]),
        getSoft1CodeFamilyCategoryRules().map((rule) => rule.category)
      ),
    [ingredientImportRows, ingredientMaster]
  );

  const ingredientTradeCategoryOptions = useMemo(
    () =>
      buildIngredientCategoryOptions(
        ingredientMaster.map((ingredient) => ingredient.tradeCategory),
        ingredientImportRows.map((row) => row.tradeCategory),
        soft1SourceRows.map((row) => row.tradeCategory)
      ),
    [ingredientImportRows, ingredientMaster]
  );

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;

    const dirtyIngredients = ingredientMaster.filter(
      (ingredient) => ingredient.sharedDirty && !ingredient.archived
    );
    const ingredientDeletionIds = [...pendingIngredientDeletionIds];
    if (!dirtyIngredients.length && !ingredientDeletionIds.length) return undefined;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      for (const ingredient of dirtyIngredients) {
        if (cancelled) return;
        await syncIngredientToSharedData(ingredient.id, { quiet: true });
      }

      if (!ingredientDeletionIds.length || cancelled) return;

      const { error: deleteIngredientsError } = await supabase.from("ingredients").delete().in("id", ingredientDeletionIds);
      if (deleteIngredientsError) {
        if (typeof window !== "undefined") {
          window.alert(deleteIngredientsError.message || "Could not remove deleted ingredients from shared data.");
        }
        return;
      }

      if (!cancelled) {
        setPendingIngredientDeletionIds((current) => current.filter((id) => !ingredientDeletionIds.includes(id)));
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [ingredientMaster, pendingIngredientDeletionIds]);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;

    const dirtyMenus = menus.filter((menu) => menu.sharedDirty && !menu.archived);
    const deletionIds = [...pendingMenuDeletionIds];
    if (!dirtyMenus.length && !deletionIds.length) return undefined;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      for (const menu of dirtyMenus) {
        if (cancelled) return;
        await syncMenuToSharedData(menu);
      }

      if (!deletionIds.length || cancelled) return;

      const { error: deleteLinesError } = await supabase.from("menu_lines").delete().in("menu_id", deletionIds);
      if (deleteLinesError) {
        if (typeof window !== "undefined") {
          window.alert(deleteLinesError.message || "Could not remove deleted menu lines from shared data.");
        }
        return;
      }

      const { error: deleteMenusError } = await supabase.from("menus").delete().in("id", deletionIds);
      if (deleteMenusError) {
        if (typeof window !== "undefined") {
          window.alert(deleteMenusError.message || "Could not remove deleted menus from shared data.");
        }
        return;
      }

      if (!cancelled) {
        setPendingMenuDeletionIds((current) => current.filter((id) => !deletionIds.includes(id)));
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [menus, pendingMenuDeletionIds, recipes, recordMaps.ingredient, recordMaps.batch]);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;

    const dirtyRecipes = recipes.filter((recipe) => recipe.sharedDirty && !recipe.archived);
    const dirtyBatches = batches.filter((batch) => batch.sharedDirty && !batch.archived);
    const recipeDeletionIds = [...pendingRecipeDeletionIds];
    const batchDeletionIds = [...pendingBatchDeletionIds];
    if (!dirtyRecipes.length && !dirtyBatches.length && !recipeDeletionIds.length && !batchDeletionIds.length) {
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      for (const recipe of dirtyRecipes) {
        if (cancelled) return;
        await syncRecipeRecordToSharedData(recipe, "dish");
      }

      for (const batch of dirtyBatches) {
        if (cancelled) return;
        await syncRecipeRecordToSharedData(batch, "batch");
      }

      const allDeletionIds = dedupeTextList([...recipeDeletionIds, ...batchDeletionIds]);
      if (!allDeletionIds.length || cancelled) return;

      const { error: deleteParentComponentRefsError } = await supabase
        .from("recipe_components")
        .delete()
        .in("source_recipe_id", allDeletionIds);
      if (deleteParentComponentRefsError) {
        if (typeof window !== "undefined") {
          window.alert(deleteParentComponentRefsError.message || "Could not remove deleted recipe/component references from shared data.");
        }
        return;
      }

      const { error: deleteRecipesError } = await supabase.from("recipes").delete().in("id", allDeletionIds);
      if (deleteRecipesError) {
        if (typeof window !== "undefined") {
          window.alert(deleteRecipesError.message || "Could not remove deleted recipes/components from shared data.");
        }
        return;
      }

      if (!cancelled) {
        setPendingRecipeDeletionIds((current) => current.filter((id) => !recipeDeletionIds.includes(id)));
        setPendingBatchDeletionIds((current) => current.filter((id) => !batchDeletionIds.includes(id)));
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [recipes, batches, pendingRecipeDeletionIds, pendingBatchDeletionIds, menus, recordMaps.ingredient, recordMaps.batch]);

  const relationshipMaps = useMemo(() => {
    const ingredientRecipes = new Map(ingredientMaster.map((item) => [item.id, []]));
    const batchRecipes = new Map(batches.map((item) => [item.id, []]));
    const restaurantMenus = new Map(restaurants.map((item) => [item.id, []]));

    recipes.forEach((recipe) => {
      (recipe.ingredientIds || []).forEach((ingredientId) => {
        if (!ingredientRecipes.has(ingredientId)) {
          ingredientRecipes.set(ingredientId, []);
        }
        ingredientRecipes.get(ingredientId).push(recipe.id);
      });

      (recipe.batchIds || []).forEach((batchId) => {
        if (!batchRecipes.has(batchId)) {
          batchRecipes.set(batchId, []);
        }
        batchRecipes.get(batchId).push(recipe.id);
      });
    });

    menus.forEach((menu) => {
      const restaurantId = menu.restaurantId;
      if (!restaurantId) return;
      if (!restaurantMenus.has(restaurantId)) {
        restaurantMenus.set(restaurantId, []);
      }
      restaurantMenus.get(restaurantId).push(menu.id);
    });

    return {
      ingredientRecipes,
      batchRecipes,
      restaurantMenus,
    };
  }, [ingredientMaster, batches, recipes, restaurants, menus]);

  const selectedImportRow =
    activeSection === "ingredients" && ["review", "attention", "conflicts"].includes(ingredientWorkspaceView)
      ? ingredientImportRows.find((row) => row.id === selectedImportRowId) || null
      : null;
  const selectedLearningCandidates = selectedImportRow
    ? getLearningRuleCandidates(selectedImportRow, learningRules)
    : [];
  const ingredientMakerCodeConflict = getIngredientCodeConflict(
    ingredientMaster,
    ingredientMakerModal.draft?.code,
    ingredientMakerModal.draft?.id
  );
  const ingredientSubstitutionSource = ingredientSubstitutionModal.sourceIngredientId
    ? recordMaps.ingredient.get(ingredientSubstitutionModal.sourceIngredientId) || null
    : null;
  const ingredientSubstitutionReplacement = ingredientSubstitutionModal.replacementIngredientId
    ? recordMaps.ingredient.get(ingredientSubstitutionModal.replacementIngredientId) || null
    : null;
  const ingredientSubstitutionImpact = calculateIngredientSubstitutionImpact(
    ingredientSubstitutionModal.sourceIngredientId,
    ingredientSubstitutionModal.replacementIngredientId,
    recipes,
    batches
  );

  useEffect(() => {
    if (!selectedImportRow || !supabaseEnabled || !supabase) return undefined;

    const sourceCode = String(selectedImportRow.sourceCode || "").trim();
    if (!sourceCode) return undefined;

    const localConflict = getIngredientSourceCodeConflict(
      ingredientMaster,
      sourceCode,
      selectedImportRow.reconcileMode ? selectedImportRow.existingIngredientId || "" : selectedImportRow.targetId || ""
    );
    if (localConflict) return undefined;

    let cancelled = false;

    const loadMissingSourceCodeOwner = async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .eq("ingredient_item_code", sourceCode)
        .limit(5);

      if (cancelled || error || !(data || []).length) return;

      const hydratedMatches = (data || []).map((row) => hydrateSharedIngredientRowToV2(row)).filter(Boolean);
      if (!hydratedMatches.length) return;

      setIngredientMaster((current) => {
        let changed = false;
        const next = [...current];

        hydratedMatches.forEach((match) => {
          const matchSourceCodeKey = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(match));
          const existingIndex = next.findIndex((item) => {
            if (match.sharedRecordId && item.sharedRecordId && item.sharedRecordId === match.sharedRecordId) return true;
            if (item.id === match.id) return true;
            return Boolean(
              matchSourceCodeKey &&
                normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(item)) === matchSourceCodeKey
            );
          });

          if (existingIndex >= 0) {
            const existing = next[existingIndex];
            const merged = {
              ...existing,
              ...match,
              aliases: dedupeTextList([...(existing.aliases || []), ...(match.aliases || [])]),
            };
            if (JSON.stringify(existing) !== JSON.stringify(merged)) {
              next[existingIndex] = merged;
              changed = true;
            }
            return;
          }

          next.push(match);
          changed = true;
        });

        return changed ? next : current;
      });
    };

    loadMissingSourceCodeOwner();

    return () => {
      cancelled = true;
    };
  }, [
    selectedImportRow?.id,
    selectedImportRow?.sourceCode,
    selectedImportRow?.existingIngredientId,
    selectedImportRow?.targetId,
    selectedImportRow?.reconcileMode,
    supabaseEnabled,
    supabase,
    ingredientMaster,
    ingredientMasterReviewState,
    ingredientSubstitutionState,
    ingredientTradeCategoryState,
  ]);
  const ingredientMergeSource = ingredientMergeModal.sourceIngredientId
    ? recordMaps.ingredient.get(ingredientMergeModal.sourceIngredientId) || null
    : null;
  const ingredientMergeTarget = ingredientMergeModal.targetIngredientId
    ? recordMaps.ingredient.get(ingredientMergeModal.targetIngredientId) || null
    : null;
  const ingredientMergeImpact = calculateIngredientSubstitutionImpact(
    ingredientMergeModal.sourceIngredientId,
    ingredientMergeModal.targetIngredientId,
    recipes,
    batches
  );

  const selectedData =
    selectedImportRow
      ? null
      : selectedRecord.type && selectedRecord.id
        ? recordMaps[selectedRecord.type]?.get(selectedRecord.id) || null
        : null;

  const currentLocation = useMemo(() => {
    if (selectedImportRow) {
      return {
        kind: "importRow",
        id: selectedImportRow.id,
        section: "ingredients",
        workspaceView: ingredientWorkspaceView,
      };
    }

    if (selectedRecord?.type && selectedRecord?.id) {
      return {
        kind: "record",
        type: selectedRecord.type,
        id: selectedRecord.id,
        section: activeSection,
      };
    }

    return {
      kind: "section",
      section: activeSection,
    };
  }, [activeSection, ingredientWorkspaceView, selectedImportRow, selectedRecord]);

  useEffect(() => {
    selectedRecordRef.current = selectedRecord;
  }, [selectedRecord]);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    ingredientMasterRef.current = ingredientMaster;
  }, [ingredientMaster]);

  useEffect(() => {
    recipesRef.current = recipes;
  }, [recipes]);

  useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  const pushCurrentLocationToHistory = () => {
    setHistory((current) => {
      if (!currentLocation) return current;
      return [...current, currentLocation].slice(-20);
    });
  };

  const importRowsForWorkspace = (workspaceView) => {
    const unpublishedRows = ingredientImportRows.filter((row) => !row.published);
    if (workspaceView === "attention") {
      return unpublishedRows
        .filter((row) => row.confidenceScore < 50)
        .sort((left, right) => left.confidenceScore - right.confidenceScore);
    }
    if (workspaceView === "conflicts") {
      return unpublishedRows.filter((row) => row.needsCodeReview);
    }
    return unpublishedRows;
  };

  const setIngredientWorkspace = (workspaceView) => {
    setActiveSection("ingredients");
    setIngredientWorkspaceView(workspaceView);

    if (workspaceView === "catalogue") {
      setSelectedImportRowId("");
      const selectedIngredient =
        selectedRecord.type === "ingredient" && recordMaps.ingredient.has(selectedRecord.id)
          ? recordMaps.ingredient.get(selectedRecord.id)
          : null;
      const reviewStateVisibleFilters = new Set(["manual_review", "needs_attention"]);
      const selectedStillVisible =
        Boolean(
          selectedIngredient &&
            !selectedIngredient.archived &&
            (getIngredientMasterReviewStatus(selectedIngredient) !== "review" ||
              reviewStateVisibleFilters.has(ingredientStatusFilter))
        );

      if (ingredientMaster.length && !selectedStillVisible) {
        const nextIngredient =
          ingredientMaster.find(
            (item) =>
              !item.archived &&
              (getIngredientMasterReviewStatus(item) !== "review" || reviewStateVisibleFilters.has(ingredientStatusFilter))
          ) ||
          ingredientMaster.find((item) => !item.archived) ||
          ingredientMaster[0];
        setSelectedRecord(nextIngredient ? { type: "ingredient", id: nextIngredient.id } : { type: "", id: "" });
      }
      return;
    }

    const workspaceRows = importRowsForWorkspace(workspaceView);
    const existingRowStillVisible = workspaceRows.some((row) => row.id === selectedImportRowId);
    setSelectedImportRowId(existingRowStillVisible ? selectedImportRowId : workspaceRows[0]?.id || "");
  };

  const setSectionSelection = (sectionId) => {
    if (sectionId === "ingredients") {
      setIngredientWorkspace("catalogue");
      return;
    }

    setActiveSection(sectionId);
    setSelectedImportRowId("");
    setIngredientEditingId("");

    if (sectionId === "recipes") {
      setSelectedRecord((current) =>
        current.type === "recipe" && recordMaps.recipe.has(current.id)
          ? current
          : recipes.find((item) => !item.archived) || recipes[0]
            ? { type: "recipe", id: (recipes.find((item) => !item.archived) || recipes[0]).id }
            : { type: "", id: "" }
      );
      return;
    }

    if (sectionId === "batches") {
      setSelectedRecord((current) =>
        current.type === "batch" && recordMaps.batch.has(current.id)
          ? current
          : batches.find((item) => !item.archived) || batches[0]
            ? { type: "batch", id: (batches.find((item) => !item.archived) || batches[0]).id }
            : { type: "", id: "" }
      );
      return;
    }

    if (sectionId === "substitutions") {
      setSelectedRecord((current) =>
        current.type === "ingredient" && substitutionOpportunityMap.has(current.id)
          ? current
          : substitutionOpportunities[0]
            ? { type: "ingredient", id: substitutionOpportunities[0].sourceIngredient.id }
            : { type: "", id: "" }
      );
      return;
    }

    if (sectionId === "exports") {
      setSelectedRecord((current) => {
        if (exportObjectType === "ingredient") {
          return { type: "", id: "" };
        }
        if (exportObjectType === "menu") {
          return current.type === "menu" && recordMaps.menu.has(current.id)
            ? current
            : menus.find((item) => !item.archived) || menus[0]
              ? { type: "menu", id: (menus.find((item) => !item.archived) || menus[0]).id }
              : { type: "", id: "" };
        }

        return current.type === "recipe" && recordMaps.recipe.has(current.id)
          ? current
          : recipes.find((item) => !item.archived) || recipes[0]
            ? { type: "recipe", id: (recipes.find((item) => !item.archived) || recipes[0]).id }
            : { type: "", id: "" };
      });
      return;
    }

    if (sectionId === "menus") {
      setMenuEditorStep("build");
      setSelectedRecord((current) =>
        current.type === "menu" && recordMaps.menu.has(current.id)
          ? current
          : menus.find((item) => !item.archived) || menus[0]
            ? { type: "menu", id: (menus.find((item) => !item.archived) || menus[0]).id }
            : { type: "", id: "" }
      );
      return;
    }

    setSelectedRecord({ type: "", id: "" });
  };

  const rebuildIngredientImportQueue = (
    sourceRows = soft1SourceRows,
    nextIngredientMaster = ingredientMaster,
    nextLearningRules = learningRules,
    nextIgnoredImportRows = ignoredImportRows,
    nextResolvedImportRows = resolvedImportRows,
    nextSourceCodeRedirectState = ingredientSourceCodeRedirectState
  ) => {
    return buildImportRows(
      sourceRows,
      nextIngredientMaster,
      nextLearningRules,
      nextIgnoredImportRows,
      nextResolvedImportRows,
      nextSourceCodeRedirectState
    );
  };

  const openRecord = (type, id) => {
    if (!type || !id) return;
    pushCurrentLocationToHistory();
    setSelectedImportRowId("");
    setIngredientEditingId("");
    setSelectedRecord({ type, id });
    if (type === "ingredient") {
      setActiveSection("ingredients");
      setIngredientWorkspaceView("catalogue");
    }
    if (type === "recipe") setActiveSection("recipes");
    if (type === "batch") setActiveSection("batches");
    if (type === "restaurant") setActiveSection("menus");
    if (type === "menu") {
      setActiveSection("menus");
      const nextMenu = recordMaps.menu.get(id);
      setMenuEditorStep(nextMenu?.status === "draft" ? "build" : "preview");
    }
  };

  const openRecordPreview = (type, id) => {
    if (!type || !id) return;
    setRecordPreviewModal({
      isOpen: true,
      type,
      id,
    });
    if (type === "recipe") {
      setRecipeEditorStep("basics");
    }
    if (type === "batch") {
      setBatchEditorStep("basics");
    }
  };

  const closeRecordPreview = async () => {
    const previewType = recordPreviewModal.type;
    const previewId = recordPreviewModal.id;

    if (previewType === "recipe") {
      const recipe = recipesRef.current.find((item) => item.id === previewId);
      if (recipe?.sharedDirty && saveRecipeToSharedData) {
        const saved = await saveRecipeToSharedData(previewId, { quiet: true });
        if (!saved) return;
      }
    }

    if (previewType === "batch") {
      const batch = batchesRef.current.find((item) => item.id === previewId);
      if (batch?.sharedDirty && saveBatchToSharedData) {
        const saved = await saveBatchToSharedData(previewId, { quiet: true });
        if (!saved) return;
      }
    }

    setRecordPreviewModal({
      isOpen: false,
      type: "",
      id: "",
    });
  };

  const openMenuPreview = (menuId) => {
    if (!menuId) return;
    setMenuPreviewModal({
      isOpen: true,
      id: menuId,
    });
  };

  const closeMenuPreview = () => {
    setMenuPreviewModal({
      isOpen: false,
      id: "",
    });
  };

  const openImportRow = (rowId, workspaceView) => {
    if (!rowId) return;
    pushCurrentLocationToHistory();
    setActiveSection("ingredients");
    setIngredientEditingId("");
    setIngredientWorkspaceView(
      workspaceView || (activeSection === "ingredients" && ingredientWorkspaceView !== "catalogue" ? ingredientWorkspaceView : "review")
    );
    setSelectedImportRowId(rowId);
  };

  const goBack = () => {
    setHistory((current) => {
      if (!current.length) return current;
      const next = [...current];
      const previous = next.pop();
      if (!previous) return next;

      if (previous.kind === "importRow") {
        setActiveSection("ingredients");
        setIngredientWorkspaceView(previous.workspaceView || "review");
        setSelectedImportRowId(previous.id);
        return next;
      }

      if (previous.kind === "record") {
        setActiveSection(previous.section || "ingredients");
        if (previous.type === "ingredient") {
          setIngredientWorkspaceView("catalogue");
        }
        setSelectedImportRowId("");
        setSelectedRecord({ type: previous.type, id: previous.id });
        return next;
      }

      if (previous.kind === "section") {
        setActiveSection(previous.section || "ingredients");
        if ((previous.section || "ingredients") !== "ingredients") {
          setSelectedImportRowId("");
        }
      }

      return next;
    });
  };

  const updateImportRow = (rowId, updater) => {
    setIngredientImportRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)));
  };

  const updateIngredient = (ingredientId, updater) => {
    setIngredientMaster((current) =>
      current.map((ingredient) => (ingredient.id === ingredientId ? updater(ingredient) : ingredient))
    );
  };

  const buildSharedIngredientPayload = (ingredient, { includeArchived = ingredientArchiveColumnAvailable } = {}) => {
    const payload = {
      ingredient_name: String(ingredient.name || "").trim(),
      ingredient_item_code: String(
        isIngredientCodeLocked(ingredient) ? ingredient.sourceCode || "" : ""
      ).trim() || null,
      internal_code: String(
        isIngredientCodeLocked(ingredient) ? "" : ingredient.code || ""
      ).trim() || null,
      unit_cost: Number(ingredient.unitCost || 0),
      purchase_vat_rate: Number(ingredient.purchaseVatRate ?? 13) / 100,
      pack_size: String(ingredient.packSize || "").trim(),
      supplier: String(ingredient.supplier || "").trim() || null,
      category: String(ingredient.category || "").trim() || null,
      last_updated: getTodayImportDate(),
      entry_type: String(ingredient.batchId || "").trim() ? "batch" : "ingredient",
      linked_recipe_id: String(ingredient.batchId || "").trim() || null,
      is_locked: getIngredientSourceType(ingredient) === "soft1",
    };

    if (includeArchived) {
      payload.is_archived = Boolean(ingredient.archived);
    }

    return payload;
  };

  const isMissingIngredientArchivedColumnError = (message = "") => {
    const normalized = String(message || "").toLowerCase();
    return normalized.includes("is_archived") && normalized.includes("ingredients");
  };

  const isMissingRecipeServiceSuitabilityColumnError = (message = "") => {
    const normalized = String(message || "").toLowerCase();
    return normalized.includes("service_suitability") && normalized.includes("recipes");
  };

  const isMissingMenuLineDescriptionColumnError = (message = "") => {
    const normalized = String(message || "").toLowerCase();
    return normalized.includes("description") && normalized.includes("menu_lines");
  };

  const runSharedIngredientMutation = async ({ mode = "update", ingredient, sharedRecordId = "" }) => {
    const execute = async (includeArchived) => {
      const payload = buildSharedIngredientPayload(ingredient, { includeArchived });
      if (mode === "insert") {
        return supabase.from("ingredients").insert(payload).select("*").single();
      }
      return supabase
        .from("ingredients")
        .update(payload)
        .eq("id", sharedRecordId)
        .select("*")
        .single();
    };

    let result = await execute(ingredientArchiveColumnAvailable);
    if (result?.error && ingredientArchiveColumnAvailable && isMissingIngredientArchivedColumnError(result.error.message || "")) {
      setIngredientArchiveColumnAvailable(false);
      result = await execute(false);
    }
    return result;
  };

  const getMenuSyncSignature = (menu = {}) =>
    JSON.stringify({
      name: String(menu.name || "").trim(),
      restaurant: String(menu.restaurant || "").trim(),
      restaurantId: String(menu.restaurantId || "").trim(),
      service: String(menu.service || "").trim(),
      status: String(menu.status || "").trim(),
      archived: Boolean(menu.archived),
      items: (menu.items || []).map((item) => ({
        recipeId: String(item.recipeId || "").trim(),
        dishName: String(item.dishName || "").trim(),
        description: String(item.description || "").trim(),
      })),
    });

  const buildSharedMenuPayload = (menu = {}) => ({
    id: String(menu.id || "").trim(),
    name: String(menu.name || "").trim() || buildDefaultMenuName(menu.restaurant, menu.service),
    venue: String(menu.restaurant || "").trim() || null,
    guest_count: Number((menu.items || []).length || 0),
    target_gp: 0,
    is_live: menu.status === "live",
  });

  const buildSharedMenuLinePayloads = (menu = {}, { includeDescription = menuLineDescriptionColumnAvailable } = {}) => {
    const normalizedItems = (menu.items || []).map((item) => ({
      ...item,
      id: isUuidLike(item.id) ? item.id : createClientUuid(),
    }));

    const payload = normalizedItems.map((item, index) => {
      const recipe = item.recipeId ? recipes.find((entry) => entry.id === item.recipeId) || null : null;
      const recipeIsShared = Boolean(recipe?.sharedPersisted);
      const pricing = recipe ? getRecipePricingMetrics(recipe, recordMaps.ingredient, recordMaps.batch) : null;

      const row = {
        id: item.id,
        menu_id: String(menu.id || "").trim(),
        recipe_id: recipeIsShared ? recipe.id : null,
        line_order: index,
        course_label: String(recipe?.category || "").trim() || null,
        dish_name: String(item.dishName || recipe?.name || "").trim() || null,
        restaurant: String(menu.restaurant || "").trim() || null,
        line_cost: Number(pricing?.recipeCost || 0),
        line_sale_price: Number(recipe?.salePrice || 0),
        category: String(recipe?.category || "").trim() || null,
      };

      if (includeDescription) {
        row.description = String(item.description || "").trim() || null;
      }

      return row;
    });

    return {
      normalizedItems,
      payload,
    };
  };

  const syncMenuToSharedData = async (menu) => {
    if (!supabaseEnabled || !supabase || !menu?.id) return true;

    setMenuSharedSyncState((current) => ({
      ...current,
      [menu.id]: "syncing",
    }));

    const syncSignature = getMenuSyncSignature(menu);
    const executeMenuLineInsert = async (includeDescription = menuLineDescriptionColumnAvailable) => {
      const { payload } = buildSharedMenuLinePayloads(menu, { includeDescription });
      if (!payload.length) return { error: null };
      return supabase.from("menu_lines").insert(payload);
    };
    const { normalizedItems } = buildSharedMenuLinePayloads(menu, { includeDescription: menuLineDescriptionColumnAvailable });
    const menuPayload = buildSharedMenuPayload({
      ...menu,
      items: normalizedItems,
    });

    const { error: menuError } = await supabase.from("menus").upsert(menuPayload, { onConflict: "id" });
    if (menuError) {
      setMenuSharedSyncState((current) => ({
        ...current,
        [menu.id]: menuError.message || "error",
      }));
      if (typeof window !== "undefined") {
        window.alert(menuError.message || `Could not save menu "${menu.name}".`);
      }
      return false;
    }

    const { error: deleteLineError } = await supabase.from("menu_lines").delete().eq("menu_id", menu.id);
    if (deleteLineError) {
      setMenuSharedSyncState((current) => ({
        ...current,
        [menu.id]: deleteLineError.message || "error",
      }));
      if (typeof window !== "undefined") {
        window.alert(deleteLineError.message || `Could not refresh menu lines for "${menu.name}".`);
      }
      return false;
    }

    if (normalizedItems.length) {
      let { error: insertLineError } = await executeMenuLineInsert();
      if (
        insertLineError &&
        menuLineDescriptionColumnAvailable &&
        isMissingMenuLineDescriptionColumnError(insertLineError.message || "")
      ) {
        setMenuLineDescriptionColumnAvailable(false);
        ({ error: insertLineError } = await executeMenuLineInsert(false));
      }
      if (insertLineError) {
        setMenuSharedSyncState((current) => ({
          ...current,
          [menu.id]: insertLineError.message || "error",
        }));
        if (typeof window !== "undefined") {
          window.alert(insertLineError.message || `Could not save dishes for "${menu.name}".`);
        }
        return false;
      }
    }

    setMenus((current) =>
      current.map((item) => {
        if (item.id !== menu.id) return item;
        if (getMenuSyncSignature(item) !== syncSignature) return item;
        return syncMenuRecord({
          ...item,
          items: normalizedItems,
          sharedDirty: false,
        });
      })
    );

    setMenuSharedSyncState((current) => ({
      ...current,
      [menu.id]: "saved",
    }));

    return true;
  };

  const getRecordSharedSyncSignature = (record = {}, recordType = "dish") =>
    JSON.stringify({
      recordType,
      name: String(record.name || "").trim(),
      code: String(record.code || "").trim(),
      status: String(record.status || "").trim(),
      category: String(record.category || record.productType || "").trim(),
      menuDescription: String(record.menuDescription || "").trim(),
      methodSteps: (record.methodSteps || []).map((step) => String(step || "").trim()),
      prepNotes: String(record.prepNotes || "").trim(),
      platingNotes: String(record.platingNotes || "").trim(),
      chefNotes: String(record.chefNotes || "").trim(),
      serviceSuitability: dedupeTextList(record.serviceSuitability || []),
      portions: Number(record.portions || 0),
      salePrice: Number(record.salePrice || 0),
      yieldAmount: Number(record.yieldAmount || 0),
      yieldUnit: String(record.yieldUnit || "").trim(),
      ingredientLines: (record.ingredientLines || []).map((line) => ({
        ingredientId: String(line.ingredientId || "").trim(),
        quantity: String(line.quantity || "").trim(),
        unit: String(line.unit || "").trim(),
        estimatedCost: Number(line.estimatedCost || 0),
      })),
      batchLines: (record.batchLines || []).map((line) => ({
        batchId: String(line.batchId || "").trim(),
        quantity: String(line.quantity || "").trim(),
        unit: String(line.unit || "").trim(),
        estimatedCost: Number(line.estimatedCost || 0),
      })),
    });

  const buildSharedRecipePayload = (
    record = {},
    recordType = "dish",
    { includeServiceSuitability = recipeServiceSuitabilityColumnAvailable } = {}
  ) => {
    const linkedMenus = menus.filter((menu) => (record.menuIds || []).includes(menu.id));
    const availableVenues = dedupeTextList(linkedMenus.map((menu) => menu.restaurant).filter(Boolean));
    const primaryRestaurant = availableVenues[0] || null;
    const pricing = recordType === "dish" ? getRecipePricingMetrics(record, recordMaps.ingredient, recordMaps.batch) : null;
    const payload = {
      id: String(record.id || "").trim(),
      restaurant: primaryRestaurant,
      available_venues: availableVenues,
      name: String(record.name || "").trim() || (recordType === "batch" ? "Untitled component" : "Untitled recipe"),
      category: String(record.category || record.productType || "").trim() || null,
      selling_item_code: String(record.code || "").trim() || null,
      current_sale_price: recordType === "dish" ? Number(record.salePrice || 0) : 0,
      roundup: recordType === "dish" ? Number(pricing?.roundup || 0) : 0,
      recipe_type: recordType === "batch" ? "batch" : "dish",
      batch_yield: recordType === "batch" ? Number(record.yieldAmount || 0) : null,
      batch_yield_type: recordType === "batch" ? String(record.yieldUnit || "").trim() || null : null,
      portion_count: recordType === "dish" ? Number(record.portions || 0) : null,
      method: (record.methodSteps || []).map((step) => String(step || "").trim()).filter(Boolean),
      presentation_notes:
        recordType === "batch"
          ? String(record.prepNotes || "").trim() || null
          : String(record.platingNotes || "").trim() || null,
      recipe_complete:
        recordType === "batch"
          ? Boolean(record.name && record.code && (record.ingredientLines || []).length && (record.methodSteps || []).some((step) => String(step || "").trim()))
          : Boolean(
              record.name &&
              record.code &&
              record.category &&
              ((record.ingredientLines || []).length || (record.batchLines || []).length) &&
              (record.methodSteps || []).some((step) => String(step || "").trim())
            ),
      pricing_complete:
        recordType === "batch"
          ? Boolean(Number(record.yieldAmount || 0) > 0 && Number(getBatchCostSource(record, recordMaps.ingredient).totalComponentCost || 0) > 0)
          : derivePricingComplete(record, recordMaps.ingredient, recordMaps.batch),
      is_live: record.status === "live",
      is_locked: false,
      workflow_stage: record.status === "draft" ? "draft" : "review",
    };

    if (includeServiceSuitability && recordType === "dish") {
      payload.service_suitability = dedupeTextList(record.serviceSuitability || []);
    }

    return payload;
  };

  const buildSharedRecipeComponentPayloads = (
    record = {},
    recordType = "dish",
    ingredientSource = recordMaps.ingredient,
    batchSource = recordMaps.batch
  ) => {
    const normalizedIngredientRows = [];

    (record.ingredientLines || []).forEach((line) => {
      const ingredient = ingredientSource.get(line.ingredientId) || null;
      const ingredientCostSource = getIngredientCostSource(ingredient, ingredientSource, batchSource);
      normalizedIngredientRows.push({
        recipe_id: String(record.id || "").trim(),
        ingredient_name: String(ingredient?.name || "").trim() || null,
        ingredient_item_code: String(ingredient?.sourceCode || ingredient?.code || "").trim() || null,
        qty: parseNumericQuantity(line.quantity),
        cost: Number(line.estimatedCost || calculateLineEstimatedCost(line, ingredientCostSource) || 0),
        source_type: "ingredient",
        source_recipe_id: String(ingredient?.sharedRecordId || ingredient?.id || line.ingredientId || "").trim() || null,
        source_unit_cost: Number(ingredientCostSource?.unitCost || 0),
        source_yield_type: String(line.unit || "").trim() || null,
      });
    });

    const ingredientRows = normalizedIngredientRows.map((row, index) => ({
      ...row,
      component_order: index,
    }));

    const batchRows =
      recordType === "dish"
        ? (record.batchLines || []).flatMap((line) => {
            const batch = batchSource.get(line.batchId) || null;
            const publishedIngredient = findPublishedIngredientForBatch(batch, ingredientSource);
            if (publishedIngredient?.id) {
              const ingredientCostSource = getIngredientCostSource(publishedIngredient, ingredientSource, batchSource);
              return [
                {
                  recipe_id: String(record.id || "").trim(),
                  ingredient_name: String(publishedIngredient.name || batch?.name || "").trim() || null,
                  ingredient_item_code: String(publishedIngredient.sourceCode || publishedIngredient.code || batch?.code || "").trim() || null,
                  qty: parseNumericQuantity(line.quantity),
                  cost: Number(line.estimatedCost || calculateLineEstimatedCost(line, ingredientCostSource) || 0),
                  source_type: "ingredient",
                  source_recipe_id: String(publishedIngredient.sharedRecordId || publishedIngredient.id || "").trim() || null,
                  source_unit_cost: Number(ingredientCostSource?.unitCost || 0),
                  source_yield_type: String(line.unit || "").trim() || null,
                },
              ];
            }

            return [
              {
                recipe_id: String(record.id || "").trim(),
                ingredient_name: String(batch?.name || "").trim() || null,
                ingredient_item_code: String(batch?.code || "").trim() || null,
                qty: parseNumericQuantity(line.quantity),
                cost: Number(line.estimatedCost || 0),
                source_type: "batch",
                source_recipe_id: String(line.batchId || "").trim() || null,
                source_unit_cost: Number(batch?.unitCost || 0),
                source_yield_type: String(line.unit || "").trim() || null,
              },
            ];
          }).map((row, index) => ({
            ...row,
            component_order: ingredientRows.length + index,
          }))
        : [];

    return [...ingredientRows, ...batchRows];
  };

  const syncRecipeRecordToSharedData = async (record, recordType = "dish") => {
    if (!supabaseEnabled || !supabase || !record?.id) return true;

    if (recordType === "dish") {
      setRecipeSharedSyncState((current) => ({
        ...current,
        [record.id]: "syncing",
      }));
    }
    if (recordType === "batch") {
      setBatchSharedSyncState((current) => ({
        ...current,
        [record.id]: "syncing",
      }));
    }

    const syncSignature = getRecordSharedSyncSignature(record, recordType);
    const ingredientSourceForSync = new Map(recordMaps.ingredient);
    const referencedIngredientIds = dedupeTextList((record.ingredientLines || []).map((line) => line.ingredientId).filter(Boolean));

    for (const ingredientId of referencedIngredientIds) {
      const referencedIngredient =
        ingredientSourceForSync.get(ingredientId) ||
        ingredientMasterRef.current.find((item) => item.id === ingredientId) ||
        null;
      if (!referencedIngredient || referencedIngredient.archived) continue;
      if (!referencedIngredient.sharedDirty && referencedIngredient.sharedRecordId) continue;

      const syncedIngredient = await syncIngredientToSharedData(ingredientId, { quiet: true });
      if (!syncedIngredient) {
        if (recordType === "dish") {
          setRecipeSharedSyncState((current) => ({
            ...current,
            [record.id]: "Could not sync one or more linked ingredients first.",
          }));
        }
        if (recordType === "batch") {
          setBatchSharedSyncState((current) => ({
            ...current,
            [record.id]: "Could not sync one or more linked ingredients first.",
          }));
        }
        if (typeof window !== "undefined") {
          window.alert(`Could not save ${recordType === "batch" ? "component" : "recipe"} "${record.name}" because one of its linked ingredients is not yet saved to shared data.`);
        }
        return false;
      }

      ingredientSourceForSync.set(ingredientId, syncedIngredient);
    }

    const executeRecipeUpsert = async (includeServiceSuitability = recipeServiceSuitabilityColumnAvailable) => {
      const recipePayload = buildSharedRecipePayload(record, recordType, {
        includeServiceSuitability,
      });
      return supabase.from("recipes").upsert(recipePayload, { onConflict: "id" });
    };
    const componentPayload = buildSharedRecipeComponentPayloads(record, recordType, ingredientSourceForSync, recordMaps.batch);

    let { error: recipeError } = await executeRecipeUpsert();
    if (
      recipeError &&
      recipeServiceSuitabilityColumnAvailable &&
      isMissingRecipeServiceSuitabilityColumnError(recipeError.message || "")
    ) {
      setRecipeServiceSuitabilityColumnAvailable(false);
      ({ error: recipeError } = await executeRecipeUpsert(false));
    }
    if (recipeError) {
      if (recordType === "dish") {
        setRecipeSharedSyncState((current) => ({
          ...current,
          [record.id]: recipeError.message || "error",
        }));
      }
      if (recordType === "batch") {
        setBatchSharedSyncState((current) => ({
          ...current,
          [record.id]: recipeError.message || "error",
        }));
      }
      if (typeof window !== "undefined") {
        window.alert(recipeError.message || `Could not save ${recordType === "batch" ? "component" : "recipe"} "${record.name}".`);
      }
      return false;
    }

    const { error: deleteComponentError } = await supabase.from("recipe_components").delete().eq("recipe_id", record.id);
    if (deleteComponentError) {
      if (recordType === "dish") {
        setRecipeSharedSyncState((current) => ({
          ...current,
          [record.id]: deleteComponentError.message || "error",
        }));
      }
      if (recordType === "batch") {
        setBatchSharedSyncState((current) => ({
          ...current,
          [record.id]: deleteComponentError.message || "error",
        }));
      }
      if (typeof window !== "undefined") {
        window.alert(deleteComponentError.message || `Could not refresh ${recordType === "batch" ? "component" : "recipe"} lines for "${record.name}".`);
      }
      return false;
    }

    if (componentPayload.length) {
      const { error: insertComponentError } = await supabase.from("recipe_components").insert(componentPayload);
      if (insertComponentError) {
        if (recordType === "dish") {
          setRecipeSharedSyncState((current) => ({
            ...current,
            [record.id]: insertComponentError.message || "error",
          }));
        }
        if (recordType === "batch") {
          setBatchSharedSyncState((current) => ({
            ...current,
            [record.id]: insertComponentError.message || "error",
          }));
        }
        if (typeof window !== "undefined") {
          window.alert(insertComponentError.message || `Could not save ${recordType === "batch" ? "component" : "recipe"} lines for "${record.name}".`);
        }
        return false;
      }
    }

    if (recordType === "dish") {
      setRecipes((current) =>
        current.map((item) => {
          if (item.id !== record.id) return item;
          if (getRecordSharedSyncSignature(item, "dish") !== syncSignature) return item;
          return syncRecipeRelations({
            ...item,
            sharedDirty: false,
            sharedPersisted: true,
          });
        })
      );
      if (!record.sharedPersisted) {
        setMenus((current) =>
          current.map((menu) =>
            (menu.recipeIds || []).includes(record.id)
              ? syncMenuRecord({
                  ...menu,
                  sharedDirty: true,
                })
              : menu
          )
        );
      }
      setRecipeSharedSyncState((current) => ({
        ...current,
        [record.id]: "saved",
      }));
      return true;
    }

    setBatches((current) =>
      current.map((item) => {
        if (item.id !== record.id) return item;
        if (getRecordSharedSyncSignature(item, "batch") !== syncSignature) return item;
        return syncBatchRecord({
          ...item,
          sharedDirty: false,
          sharedPersisted: true,
        });
      })
    );

    setBatchSharedSyncState((current) => ({
      ...current,
      [record.id]: "saved",
    }));

    return true;
  };

  const saveBatchToSharedData = async (batchId, { quiet = false } = {}) => {
    const batch = batchesRef.current.find((item) => item.id === batchId);
    if (!batch) return false;
    const saved = await syncRecipeRecordToSharedData(batch, "batch");
    if (!saved && quiet) {
      return false;
    }
    return saved;
  };

  const saveRecipeToSharedData = async (recipeId, { quiet = false } = {}) => {
    const recipe = recipesRef.current.find((item) => item.id === recipeId);
    if (!recipe) return false;
    const saved = await syncRecipeRecordToSharedData(recipe, "dish");
    if (!saved && quiet) {
      return false;
    }
    return saved;
  };

  const saveMenuToSharedData = async (menuId, { quiet = false } = {}) => {
    const menu = menus.find((item) => item.id === menuId);
    if (!menu) return false;
    const saved = await syncMenuToSharedData(menu);
    if (!saved && quiet) {
      return false;
    }
    return saved;
  };

  const markIngredientMasterReviewed = (ingredientId, nextStatus = "ready") => {
    const ingredient = ingredientMasterRef.current.find((item) => item.id === ingredientId);
    if (!ingredient) return;
    const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
    const sharedUpdatedAt = ingredient.sharedUpdatedAt || ingredient.lastImportedAt || "";
    const existingEntry = ingredientMasterReviewState[sharedRecordId] || {};
    const isManualReview = nextStatus === "review";
    const currentCatchupSuggestion = getIngredientRuleCatchupSuggestion(ingredient, learningRules, soft1SourceRows);
    const nextEntry = withIngredientReviewNamingContext({
      status: nextStatus,
      sharedUpdatedAt,
      flagged: Boolean(existingEntry.flagged || ingredient.needsSubstitutionReview),
      forReview: isManualReview,
      ruleCatchupSignature: isManualReview ? "" : getIngredientRuleCatchupSignature(currentCatchupSuggestion),
    }, ingredient, soft1SourceRows, existingEntry);

    setIngredientMasterReviewState((current) => ({
      ...current,
      [sharedRecordId]: nextEntry,
    }));

    updateIngredient(ingredientId, (current) => ({
      ...current,
      masterReviewStatus: nextStatus,
      needsReviewFlag: isManualReview,
    }));

    persistIngredientMasterReviewStateEntry(sharedRecordId, nextEntry);
  };

  const moveIngredientToMasterReview = (ingredientId) => {
    markIngredientMasterReviewed(ingredientId, "review");
    setActiveSection("ingredients");
    setIngredientWorkspaceView("catalogue");
    setIngredientStatusFilter("manual_review");
    setSelectedImportRowId("");
    setSelectedRecord({ type: "ingredient", id: ingredientId });
  };

  const removeIngredientFromReviewQueue = (rowId, options = {}) => {
    const { decisionNote = "Removed from review without changes." } = options;
    const row = ingredientImportRows.find((item) => item.id === rowId);
    const ingredientId = row?.existingIngredientId || "";
    if (!ingredientId) return;

    markIngredientMasterReviewed(ingredientId, "ready");

    setIngredientImportRows((current) =>
      current.map((item) =>
        item.id === rowId
          ? {
              ...item,
              reviewStatus: "ready",
              published: true,
              approvedPersisted: true,
              decisionNote,
            }
          : item
      )
    );

    if (selectedImportRowId === rowId) {
      const nextVisibleRow = ingredientImportRows.find((item) => item.id !== rowId && !item.published);
      setSelectedImportRowId(nextVisibleRow?.id || "");
    }
  };

  const bulkMarkIngredientRowsReviewed = async (rowIds = [], options = {}) => {
    const { skipConfirm = false, decisionNote = "Marked reviewed from the visible review queue." } = options;
    const safeRowIds = Array.from(new Set((rowIds || []).filter(Boolean)));
    if (!safeRowIds.length) return;

    const candidateRows = ingredientImportRows.filter(
      (row) =>
        safeRowIds.includes(row.id) &&
        row.reconcileMode &&
        row.strategy === "update" &&
        row.existingIngredientId &&
        !row.published
    );

    if (!candidateRows.length) return;

    if (!skipConfirm && typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Mark ${candidateRows.length} visible ingredient${candidateRows.length === 1 ? "" : "s"} as reviewed?\n\nThis will move them out of Review import and back into the master list.`
      );
      if (!confirmed) return;
    }

    const reviewEntries = {};
    const ingredientIds = new Set();

    candidateRows.forEach((row) => {
      const ingredient = ingredientMaster.find((item) => item.id === row.existingIngredientId);
      if (!ingredient) return;
      const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
      const sharedUpdatedAt = ingredient.sharedUpdatedAt || ingredient.lastImportedAt || "";
      const existingEntry = ingredientMasterReviewState[sharedRecordId] || {};
      const currentCatchupSuggestion = getIngredientRuleCatchupSuggestion(ingredient, learningRules, soft1SourceRows);
      reviewEntries[sharedRecordId] = withIngredientReviewNamingContext({
        status: "ready",
        sharedUpdatedAt,
        flagged: Boolean(existingEntry.flagged || ingredient.needsSubstitutionReview),
        forReview: false,
        ruleCatchupSignature: getIngredientRuleCatchupSignature(currentCatchupSuggestion),
      }, ingredient, soft1SourceRows, existingEntry);
      ingredientIds.add(ingredient.id);
    });

    setIngredientMasterReviewState((current) => ({
      ...current,
      ...reviewEntries,
    }));

    setIngredientMaster((current) =>
      current.map((ingredient) =>
        ingredientIds.has(ingredient.id)
          ? {
              ...ingredient,
              masterReviewStatus: "ready",
              needsReviewFlag: false,
            }
          : ingredient
      )
    );

    setIngredientImportRows((current) =>
      current.map((row) =>
        safeRowIds.includes(row.id)
          ? {
              ...row,
              reviewStatus: "ready",
              published: true,
              decisionNote,
            }
          : row
      )
    );

    if (safeRowIds.includes(selectedImportRowId)) {
      const nextVisibleRow = ingredientImportRows.find((row) => !safeRowIds.includes(row.id) && !row.published);
      setSelectedImportRowId(nextVisibleRow?.id || "");
    }

    const persistResults = await Promise.all(
      Object.entries(reviewEntries).map(([sharedRecordId, entry]) =>
        persistIngredientMasterReviewStateEntry(sharedRecordId, entry)
      )
    );

    if (persistResults.some((result) => !result) && typeof window !== "undefined") {
      window.alert("Marked the visible ingredients as reviewed locally, but some review-state updates could not be synced to shared data.");
    }
  };

  const promoteSimpleSoft1RowsToMaster = async (rowIds = []) => {
    const safeRowIds = Array.from(new Set((rowIds || []).filter(Boolean)));
    if (!safeRowIds.length) return;

    const candidateRows = ingredientImportRows.filter(
      (row) =>
        safeRowIds.includes(row.id) &&
        row.reconcileMode &&
        row.strategy === "update" &&
        row.existingIngredientId &&
        !row.published &&
        isLikelySoft1IngredientCode(row.sourceCode)
    );

    if (!candidateRows.length) return;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Move ${candidateRows.length} simple Soft1 ingredient${candidateRows.length === 1 ? "" : "s"} into the master list?\n\nThis will first save the current review-row values back to the live ingredient record, then mark them reviewed.`
      );
      if (!confirmed) return;
    }

    const successfulRowIds = [];
    const failedNames = [];

    for (const row of candidateRows) {
      const saved = await saveApprovedImportRowToIngredient(row);
      if (saved) {
        successfulRowIds.push(row.id);
      } else {
        failedNames.push(row.chosenName || row.rawName || "Untitled ingredient");
      }
    }

    if (successfulRowIds.length) {
      await bulkMarkIngredientRowsReviewed(successfulRowIds, {
        skipConfirm: true,
        decisionNote: "Saved from the review queue and moved into the master list.",
      });
    }

    if (failedNames.length && typeof window !== "undefined") {
      window.alert(
        `Saved ${successfulRowIds.length} simple Soft1 ingredient${successfulRowIds.length === 1 ? "" : "s"} to the master list.\n\nCould not save: ${failedNames.join(", ")}`
      );
    }
  };

  const getSoft1CategorySuggestionTargets = () =>
    ingredientMaster
      .filter((ingredient) => !ingredient.archived && String(ingredient.sourceCode || "").trim())
      .map((ingredient) => {
        const suggestedCategory = getSoft1CodeCategorySuggestion(ingredient.sourceCode);
        if (!suggestedCategory) return null;
        if (normalizeIngredientKey(ingredient.category || "") === normalizeIngredientKey(suggestedCategory)) {
          return null;
        }
        if (!isWeakIngredientCategory(ingredient.category || "")) {
          return null;
        }

        return {
          ingredient,
          suggestedCategory,
        };
      })
      .filter(Boolean);

  const applySoft1CategorySuggestionsToIngredients = async () => {
    const targets = getSoft1CategorySuggestionTargets();
    if (!targets.length) {
      if (typeof window !== "undefined") {
        window.alert("There are no obvious Soft1 category suggestions waiting to be saved right now.");
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Apply and save ${targets.length} obvious Soft1 product categor${targets.length === 1 ? "y" : "ies"} to live ingredients?\n\nThis will update weak or missing ingredient categories using the approved Soft1 code-family mappings and save them to shared data now.`
      );
      if (!confirmed) return;
    }

    const pendingState = {};
    targets.forEach(({ ingredient }) => {
      pendingState[ingredient.id] = "syncing";
    });
    setIngredientSharedSyncState((current) => ({
      ...current,
      ...pendingState,
    }));

    let savedCount = 0;
    const failedNames = [];

    for (const { ingredient, suggestedCategory } of targets) {
      const updatedIngredient = {
        ...ingredient,
        category: suggestedCategory,
        sharedDirty: Boolean(ingredient.sharedRecordId),
      };

      updateIngredient(ingredient.id, (current) => ({
        ...current,
        category: suggestedCategory,
        sharedDirty: Boolean(current.sharedRecordId),
      }));

      setIngredientImportRows((current) =>
        current.map((row) =>
          row.existingIngredientId === ingredient.id &&
          (!String(row.productCategory || "").trim() || isWeakIngredientCategory(row.category || ""))
            ? {
                ...row,
                productCategory: suggestedCategory,
                category: suggestedCategory,
                decisionNote: `Applied approved Soft1 category suggestion: ${suggestedCategory}.`,
              }
            : row
        )
      );

      if (!updatedIngredient.sharedRecordId || !supabaseEnabled || !supabase) {
        setIngredientSharedSyncState((current) => ({
          ...current,
          [ingredient.id]: "saved",
        }));
        savedCount += 1;
        continue;
      }

      const { data, error } = await runSharedIngredientMutation({
        mode: "update",
        ingredient: updatedIngredient,
        sharedRecordId: updatedIngredient.sharedRecordId,
      });

      if (error) {
        failedNames.push(ingredient.name);
        setIngredientSharedSyncState((current) => ({
          ...current,
          [ingredient.id]: error.message || "error",
        }));
        continue;
      }

      const nextSharedUpdatedAt = String(data?.updated_at || data?.last_updated || getTodayImportDate()).trim();

      updateIngredient(ingredient.id, (current) => ({
        ...current,
        name: String(data?.ingredient_name || current.name).trim(),
        code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || current.code).trim(),
        sourceCode: String(getSharedSoft1Code(data) || "").trim(),
        packSize: String(data?.pack_size || current.packSize).trim(),
        supplier: String(data?.supplier || "").trim(),
        category: String(data?.category || suggestedCategory).trim(),
        sourceType: getSharedSoft1Code(data) ? "soft1" : "manual",
        soft1Status: getSharedSoft1Code(data) ? "in_soft1" : "pending",
        purchaseVatRate: normalizeVatPercent(data?.purchase_vat_rate, current.purchaseVatRate ?? 13),
        lastImportedAt: String(data?.last_updated || current.lastImportedAt).trim(),
        sharedUpdatedAt: nextSharedUpdatedAt,
        sharedDirty: false,
      }));

      setIngredientSharedSyncState((current) => ({
        ...current,
        [ingredient.id]: "saved",
      }));
      savedCount += 1;
    }

    if (typeof window !== "undefined") {
      window.alert(
        failedNames.length
          ? `Saved ${savedCount} Soft1 category update${savedCount === 1 ? "" : "s"}.\n\nCould not save: ${failedNames.join(", ")}`
          : `Saved ${savedCount} Soft1 category update${savedCount === 1 ? "" : "s"} to live ingredients.`
      );
    }
  };

  const syncIngredientToSharedData = async (ingredientId, { markReviewed = false, quiet = false } = {}) => {
    if (!supabaseEnabled || !supabase) {
      if (!quiet && typeof window !== "undefined") {
        window.alert("Shared data is not enabled in this v2 session.");
      }
      return false;
    }

    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient) return false;

    setIngredientSharedSyncState((current) => ({
      ...current,
      [ingredientId]: "syncing",
    }));

    const mutationMode = ingredient.sharedRecordId ? "update" : "insert";
    const { data, error } = await runSharedIngredientMutation({
      mode: mutationMode,
      ingredient,
      sharedRecordId: ingredient.sharedRecordId,
    });

    if (error) {
      setIngredientSharedSyncState((current) => ({
        ...current,
        [ingredientId]: error.message || "error",
      }));
      if (!quiet && typeof window !== "undefined") {
        window.alert(error.message || "Could not update this ingredient in shared data.");
      }
      return false;
    }

    const nextSharedUpdatedAt = String(data?.updated_at || data?.last_updated || getTodayImportDate()).trim();
    const nextSharedRecordId = String(data?.id || ingredient.sharedRecordId || "").trim();
    const storedTradeCategory =
      ingredientTradeCategoryState[nextSharedRecordId || ingredient.sharedRecordId || ingredient.id]?.value ||
      ingredient.tradeCategory ||
      "";
    const syncedIngredient = {
      ...ingredient,
      name: String(data?.ingredient_name || ingredient.name).trim(),
      code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || ingredient.code).trim(),
      sourceCode: String(getSharedSoft1Code(data) || "").trim(),
      packSize: String(data?.pack_size || ingredient.packSize).trim(),
      supplier: String(data?.supplier || "").trim(),
      category: String(data?.category || "").trim(),
      tradeCategory: storedTradeCategory,
      sourceType: getSharedSoft1Code(data) ? "soft1" : "manual",
      soft1Status: getSharedSoft1Code(data) ? "in_soft1" : "pending",
      purchaseVatRate: normalizeVatPercent(data?.purchase_vat_rate, ingredient.purchaseVatRate ?? 13),
      lastImportedAt: String(data?.last_updated || ingredient.lastImportedAt).trim(),
      sharedRecordId: nextSharedRecordId,
      sharedUpdatedAt: nextSharedUpdatedAt,
      archived: Boolean(data?.is_archived),
      sharedDirty: false,
      masterReviewStatus: markReviewed ? "ready" : ingredient.masterReviewStatus,
      status: markReviewed ? "ready" : ingredient.status,
      needsReviewFlag: markReviewed ? false : ingredient.needsReviewFlag,
    };

    updateIngredient(ingredientId, (current) => ({
      ...current,
      ...syncedIngredient,
    }));

    setIngredientSharedSyncState((current) => ({
      ...current,
      [ingredientId]: "saved",
    }));

    if (markReviewed) {
      const existingReviewEntry = ingredientMasterReviewState[nextSharedRecordId] || {};
      const currentCatchupSuggestion = getIngredientRuleCatchupSuggestion(syncedIngredient, learningRules, soft1SourceRows);
      const nextReviewEntry = withIngredientReviewNamingContext({
          status: "ready",
          sharedUpdatedAt: nextSharedUpdatedAt,
          flagged: Boolean(existingReviewEntry.flagged || syncedIngredient.needsSubstitutionReview),
          forReview: false,
          ruleCatchupSignature: getIngredientRuleCatchupSignature(currentCatchupSuggestion),
        }, syncedIngredient, soft1SourceRows, existingReviewEntry);
      setIngredientMasterReviewState((current) => ({
        ...current,
        [nextSharedRecordId]: nextReviewEntry,
      }));
      await persistIngredientMasterReviewStateEntry(nextSharedRecordId, nextReviewEntry);
      setIngredientWorkspaceView("catalogue");
    }

    return syncedIngredient;
  };

  const hydrateSharedIngredientRowToV2 = (row = {}) => {
    const sharedRecordId = String(row.id || "").trim();
    const sharedUpdatedAt = String(row.updated_at || row.last_updated || "").trim();
    const isPublishedComponent = String(row.entry_type || "").trim() === "batch";
    const rawIngredientCode = String(row.ingredient_item_code || "").trim();
    const hasBchIngredientCode = hasBchCode(rawIngredientCode || row.id || "");
    const soft1SourceCode = getSharedSoft1Code(row);
    const internalCode = getSharedInternalIngredientCode(row);
    const hasSoft1SourceCode = Boolean(soft1SourceCode);
    const storedReviewState = sharedRecordId ? ingredientMasterReviewState[sharedRecordId] || null : null;
    const storedTradeCategory = sharedRecordId ? ingredientTradeCategoryState[sharedRecordId]?.value || "" : "";
    const categoryFields = deriveImportCategoryFields({
      category: row.category,
      tradeCategory: storedTradeCategory || row.trade_category || "",
      sourceCode: soft1SourceCode,
    });

    return {
      id: String(row.id || `ing-${Date.now()}`),
      name: String(row.ingredient_name || "").trim() || "Untitled ingredient",
      code: internalCode || soft1SourceCode || String(row.id || "").trim(),
      sourceCode: hasSoft1SourceCode ? soft1SourceCode : "",
      aliases: dedupeTextList(storedReviewState?.aliases || []).filter(Boolean),
      referenceRawName: String(storedReviewState?.referenceRawName || "").trim(),
      status: "ready",
      packSize: String(row.pack_size || "").trim(),
      supplier: String(row.supplier || "").trim(),
      category: categoryFields.category,
      tradeCategory: categoryFields.tradeCategory,
      sourceType: hasSoft1SourceCode ? "soft1" : "manual",
      soft1Status: hasSoft1SourceCode ? "in_soft1" : "pending",
      sourceRecordLabel: isPublishedComponent ? "Published from component" : "Shared ingredients",
      lastImportedAt: String(row.last_updated || "").trim(),
      unitCost: numberValue(row.unit_cost),
      purchaseVatRate: normalizeVatPercent(row.purchase_vat_rate, 13),
      costUnit: inferPricingUnit(String(row.pack_size || "").trim()),
      portionCostHint: numberValue(row.unit_cost),
      usedInRecipeIds: [],
      batchId: String(row.linked_recipe_id || "").trim(),
      archived: false,
      notes: "",
      needsSubstitutionReview: Boolean(
        storedReviewState?.flagged || (sharedRecordId && ingredientSubstitutionState[sharedRecordId]?.flagged)
      ),
      needsReviewFlag: Boolean(storedReviewState?.forReview),
      sharedRecordId,
      sharedUpdatedAt,
      masterReviewStatus: resolveHydratedIngredientReviewStatus({
        storedReviewState,
        isPublishedComponent,
        hasBchIngredientCode,
        hasSoft1SourceCode,
      }),
      sharedDirty: false,
    };
  };

  const saveApprovedImportRowToIngredient = async (row) => {
    if (!row?.reconcileMode || row.strategy !== "update" || !row.existingIngredientId) {
      return true;
    }

    const existingTarget = ingredientMaster.find((item) => item.id === row.existingIngredientId);
    if (!existingTarget) return false;
    const nextCode = isIngredientCodeLocked(existingTarget) ? existingTarget.code : row.internalCode;
    const codeConflict = isIngredientCodeLocked(existingTarget)
      ? null
      : getIngredientCodeConflict(ingredientMaster, nextCode, existingTarget.id);
    if (codeConflict) {
      if (typeof window !== "undefined") {
        window.alert(buildIngredientCodeConflictMessage(nextCode, codeConflict));
      }
      return false;
    }

    const updatedIngredient = sanitizeIngredientDraft(
      {
        ...existingTarget,
        name: row.chosenName,
        code: nextCode,
        sourceCode: existingTarget.sourceCode,
        aliases: buildIngredientAliases(existingTarget.aliases || [], row),
        packSize: row.packSize,
        supplier: row.supplier || existingTarget.supplier,
        category: row.category || existingTarget.category,
        tradeCategory: row.tradeCategory || existingTarget.tradeCategory || "",
        unitCost: row.averagePrice > 0 ? row.averagePrice : existingTarget.unitCost,
        lastImportPriceMissing: !(Number(row.averagePrice || 0) > 0),
        costUnit: inferPricingUnit(row.packSize || existingTarget.packSize || ""),
        sourceType: existingTarget.sourceType,
        soft1Status: existingTarget.soft1Status,
        sourceRecordLabel: row.sourceRecordLabel || existingTarget.sourceRecordLabel,
        lastImportedAt: row.importedAt || existingTarget.lastImportedAt || getTodayImportDate(),
        sharedDirty: Boolean(existingTarget.sharedRecordId),
        masterReviewStatus: existingTarget.masterReviewStatus || "review",
        notes: existingTarget.notes || "",
      },
      ingredientMaster.length
    );

    setIngredientMaster((current) =>
      current.map((ingredient) => (ingredient.id === updatedIngredient.id ? updatedIngredient : ingredient))
    );

    if (updatedIngredient.sharedRecordId) {
      const { data, error } = await runSharedIngredientMutation({
        mode: "update",
        ingredient: updatedIngredient,
        sharedRecordId: updatedIngredient.sharedRecordId,
      });

      if (error) {
        setIngredientSharedSyncState((current) => ({
          ...current,
          [updatedIngredient.id]: error.message || "error",
        }));
        if (typeof window !== "undefined") {
          window.alert(
            isIngredientInternalCodeUniqueConstraintError(error.message)
              ? buildIngredientCodeConflictMessage(nextCode, codeConflict)
              : error.message || `Could not save approved ingredient "${updatedIngredient.name}" to shared data.`
          );
        }
        return false;
      }

      const nextSharedUpdatedAt = String(data?.updated_at || data?.last_updated || getTodayImportDate()).trim();

      setIngredientMaster((current) =>
        current.map((ingredient) =>
          ingredient.id === updatedIngredient.id
            ? {
                ...ingredient,
                name: String(data?.ingredient_name || ingredient.name).trim(),
                code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || ingredient.code).trim(),
                sourceCode: String(getSharedSoft1Code(data) || "").trim(),
                packSize: String(data?.pack_size || ingredient.packSize).trim(),
                supplier: String(data?.supplier || "").trim(),
                category: String(data?.category || "").trim(),
                tradeCategory: row.tradeCategory || ingredient.tradeCategory || "",
                sourceType: getSharedSoft1Code(data) ? "soft1" : "manual",
                soft1Status: getSharedSoft1Code(data) ? "in_soft1" : "pending",
                purchaseVatRate: normalizeVatPercent(data?.purchase_vat_rate, ingredient.purchaseVatRate ?? 13),
                lastImportedAt: String(data?.last_updated || ingredient.lastImportedAt).trim(),
                lastImportPriceMissing: !(Number(row.averagePrice || 0) > 0),
                sharedUpdatedAt: nextSharedUpdatedAt,
                sharedDirty: false,
              }
            : ingredient
        )
      );

      setIngredientSharedSyncState((current) => ({
        ...current,
        [updatedIngredient.id]: "saved",
      }));
    }

    updateImportRow(row.id, (current) => ({
      ...current,
      approvedPersisted: true,
      decisionNote: "Approved changes saved to the live ingredient.",
    }));

    if ((updatedIngredient.sharedRecordId || existingTarget.sharedRecordId) && String(row.tradeCategory || "").trim()) {
      await persistIngredientTradeCategoryForRecord(updatedIngredient.id, row.tradeCategory);
    }

    return true;
  };

  const persistIngredientMasterReviewStateEntry = async (sharedRecordId, entry) => {
    if (!supabaseEnabled || !supabase || !String(sharedRecordId || "").trim()) return false;

    const payload = {
      id: buildIngredientReviewStateRuleId(sharedRecordId),
      rule_field: INGREDIENT_REVIEW_STATE_RULE_FIELD,
      rule_label: "Ingredient review state",
      trigger_text: String(sharedRecordId || "").trim(),
      rule_value: serializeIngredientReviewStateEntry(entry),
    };

    const { error } = await supabase
      .from("ingredient_naming_rules")
      .upsert(payload, { onConflict: "rule_field,trigger_text" });
    if (error) {
      if (isMissingNamingRulesTableError(error.message || "")) {
        console.warn("ingredient_naming_rules is missing in the live database; keeping ingredient review state locally for now.");
        return true;
      }
      console.error("Could not persist ingredient review state", error);
      return false;
    }

    return true;
  };

  const persistSharedFlagEntry = async ({
    id = "",
    ruleField = "",
    label = "",
    entityId = "",
    flagged = false,
  }) => {
    if (!supabaseEnabled || !supabase || !String(entityId || "").trim() || !String(id || "").trim()) {
      return {
        ok: false,
        error: "Shared data is not enabled for this session.",
      };
    }

    const payload = {
      id: String(id).trim(),
      rule_field: String(ruleField).trim(),
      rule_label: String(label).trim(),
      trigger_text: String(entityId).trim(),
      rule_value: JSON.stringify({ flagged: Boolean(flagged) }),
    };

    const { error } = await supabase
      .from("ingredient_naming_rules")
      .upsert(payload, { onConflict: "rule_field,trigger_text" });
    if (error) {
      if (isMissingNamingRulesTableError(error.message || "")) {
        console.warn(`${label || "Shared flag"} could not be synced because ingredient_naming_rules is missing; keeping it locally for now.`);
        return {
          ok: true,
          localOnly: true,
          error: error.message || "",
        };
      }
      console.error(`Could not persist ${label || "shared flag"}`, error);
      return {
        ok: false,
        error: error.message || `Could not persist ${label || "shared flag"}.`,
      };
    }

    return {
      ok: true,
      error: "",
    };
  };

  const persistIngredientSubstitutionStateEntry = async (sharedRecordId, entry) => {
    if (!supabaseEnabled || !supabase || !String(sharedRecordId || "").trim()) return false;

    const payload = {
      id: buildIngredientSubstitutionStateRuleId(sharedRecordId),
      rule_field: INGREDIENT_SUBSTITUTION_STATE_RULE_FIELD,
      rule_label: "Ingredient substitution state",
      trigger_text: String(sharedRecordId || "").trim(),
      rule_value: serializeIngredientSubstitutionStateEntry(entry),
    };

    const { error } = await supabase
      .from("ingredient_naming_rules")
      .upsert(payload, { onConflict: "rule_field,trigger_text" });
    if (error) {
      if (isMissingNamingRulesTableError(error.message || "")) {
        console.warn("ingredient_naming_rules is missing in the live database; keeping ingredient substitution state locally for now.");
        return true;
      }
      console.error("Could not persist ingredient substitution state", error);
      return false;
    }

    return true;
  };

  const persistIngredientTradeCategoryStateEntry = async (sharedRecordId, entry) => {
    if (!supabaseEnabled || !supabase || !String(sharedRecordId || "").trim()) return false;

    const payload = {
      id: buildIngredientTradeCategoryRuleId(sharedRecordId),
      rule_field: INGREDIENT_TRADE_CATEGORY_RULE_FIELD,
      rule_label: "Ingredient trade category",
      trigger_text: String(sharedRecordId || "").trim(),
      rule_value: serializeIngredientTradeCategoryEntry(entry),
    };

    const { error } = await supabase
      .from("ingredient_naming_rules")
      .upsert(payload, { onConflict: "rule_field,trigger_text" });
    if (error) {
      if (isMissingNamingRulesTableError(error.message || "")) {
        console.warn("ingredient_naming_rules is missing in the live database; keeping ingredient trade category locally for now.");
        return true;
      }
      console.error("Could not persist ingredient trade category", error);
      return false;
    }

    return true;
  };

  const persistIngredientSourceCodeRedirectEntry = async (sourceCode, entry) => {
    const normalizedSourceCode = normalizeIngredientCodeToken(sourceCode);
    if (!supabaseEnabled || !supabase || !normalizedSourceCode) return false;

    const payload = {
      id: buildIngredientSourceCodeRedirectRuleId(normalizedSourceCode),
      rule_field: INGREDIENT_SOURCE_CODE_REDIRECT_RULE_FIELD,
      rule_label: "Ingredient source code redirect",
      trigger_text: normalizedSourceCode,
      rule_value: serializeIngredientSourceCodeRedirectEntry(entry),
    };

    const { error } = await supabase
      .from("ingredient_naming_rules")
      .upsert(payload, { onConflict: "rule_field,trigger_text" });
    if (error) {
      if (isMissingNamingRulesTableError(error.message || "")) {
        console.warn("ingredient_naming_rules is missing in the live database; keeping ingredient source-code redirects locally for now.");
        return true;
      }
      console.error("Could not persist ingredient source-code redirect", error);
      return false;
    }

    return true;
  };

  const toggleIngredientSubstitutionReview = async (ingredientId, nextFlagged = null) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient) return false;

    const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
    const flagged =
      typeof nextFlagged === "boolean" ? nextFlagged : !Boolean(ingredient.needsSubstitutionReview);
    const existingReviewEntry = ingredientMasterReviewState[sharedRecordId] || {};
    const nextReviewEntry = withIngredientReviewNamingContext({
      status: String(existingReviewEntry.status || ingredient.masterReviewStatus || "review").trim() || "review",
      sharedUpdatedAt: String(existingReviewEntry.sharedUpdatedAt || ingredient.sharedUpdatedAt || ingredient.lastImportedAt || "").trim(),
      flagged,
      forReview: Boolean(existingReviewEntry.forReview || ingredient.needsReviewFlag),
    }, ingredient, soft1SourceRows, existingReviewEntry);

    updateIngredient(ingredientId, (current) => ({
      ...current,
      needsSubstitutionReview: flagged,
    }));

    setIngredientMasterReviewState((current) => ({
      ...current,
      [sharedRecordId]: {
        ...(current[sharedRecordId] || {}),
        ...nextReviewEntry,
      },
    }));

    setIngredientSubstitutionState((current) => ({
      ...current,
      [sharedRecordId]: {
        flagged,
      },
    }));

    const persisted = await persistIngredientMasterReviewStateEntry(sharedRecordId, nextReviewEntry);
    if (!persisted && typeof window !== "undefined") {
      window.alert(
        flagged
          ? "Tagged the ingredient for substitution locally, but could not sync that tag to shared data."
          : "Removed the substitution tag locally, but could not sync that change to shared data."
      );
    }

    return persisted;
  };

  const persistIngredientTradeCategoryForRecord = async (ingredientId, tradeCategoryValue) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient) return false;

    const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
    const nextEntry = {
      value: String(tradeCategoryValue || "").trim(),
    };

    setIngredientTradeCategoryState((current) => ({
      ...current,
      [sharedRecordId]: nextEntry,
    }));

    const persisted = await persistIngredientTradeCategoryStateEntry(sharedRecordId, nextEntry);
    if (!persisted && typeof window !== "undefined") {
      window.alert("Saved the trade category locally, but could not sync that change to shared data.");
    }

    return persisted;
  };

  const toggleIngredientReviewFlag = async (ingredientId, nextFlagged = null) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient) return false;

    const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
    const flagged = typeof nextFlagged === "boolean" ? nextFlagged : !Boolean(ingredient.needsReviewFlag);
    const existingReviewEntry = ingredientMasterReviewState[sharedRecordId] || {};
    const nextReviewEntry = withIngredientReviewNamingContext({
      status: String(existingReviewEntry.status || ingredient.masterReviewStatus || "review").trim() || "review",
      sharedUpdatedAt: String(existingReviewEntry.sharedUpdatedAt || ingredient.sharedUpdatedAt || ingredient.lastImportedAt || "").trim(),
      flagged: Boolean(existingReviewEntry.flagged || ingredient.needsSubstitutionReview),
      forReview: flagged,
    }, ingredient, soft1SourceRows, existingReviewEntry);

    updateIngredient(ingredientId, (current) => ({
      ...current,
      needsReviewFlag: flagged,
    }));

    setIngredientMasterReviewState((current) => ({
      ...current,
      [sharedRecordId]: {
        ...(current[sharedRecordId] || {}),
        ...nextReviewEntry,
      },
    }));

    const persisted = await persistIngredientMasterReviewStateEntry(sharedRecordId, nextReviewEntry);
    if (!persisted && typeof window !== "undefined") {
      window.alert(
        flagged
          ? "Tagged the ingredient for review locally, but could not sync that tag to shared data."
          : "Removed the ingredient review tag locally, but could not sync that change to shared data."
      );
    }

    return persisted;
  };

  const toggleRecipeReviewFlag = async (recipeId, nextFlagged = null) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe) return false;

    const flagged = typeof nextFlagged === "boolean" ? nextFlagged : !Boolean(recipe.needsReviewFlag);

    setRecipes((current) =>
      current.map((item) =>
        item.id === recipeId
          ? {
              ...item,
              needsReviewFlag: flagged,
            }
          : item
      )
    );

    setRecipeReviewFlagState((current) => ({
      ...current,
      [String(recipeId)]: {
        flagged,
      },
    }));

    if (!recipe.sharedPersisted || recipe.sharedDirty) {
      const saved = await saveRecipeToSharedData(recipeId, { quiet: true });
      if (!saved && typeof window !== "undefined") {
        window.alert(
          flagged
            ? "Tagged the recipe for review locally, but the recipe itself could not be saved to shared data first."
            : "Removed the recipe review tag locally, but the recipe itself could not be saved to shared data first."
        );
        return false;
      }
    }

    const persistResult = await persistSharedFlagEntry({
      id: buildRecipeReviewFlagRuleId(recipeId),
      ruleField: RECIPE_REVIEW_FLAG_RULE_FIELD,
      label: "Recipe review flag",
      entityId: recipeId,
      flagged,
    });

    if (!persistResult.ok && typeof window !== "undefined") {
      window.alert(
        flagged
          ? `Tagged the recipe for review locally, but could not sync that tag to shared data. ${persistResult.error || ""}`.trim()
          : `Removed the recipe review tag locally, but could not sync that change to shared data. ${persistResult.error || ""}`.trim()
      );
    }

    return persistResult.ok;
  };

  const toggleBatchReviewFlag = async (batchId, nextFlagged = null) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return false;

    const flagged = typeof nextFlagged === "boolean" ? nextFlagged : !Boolean(batch.needsReviewFlag);

    setBatches((current) =>
      current.map((item) =>
        item.id === batchId
          ? {
              ...item,
              needsReviewFlag: flagged,
            }
          : item
      )
    );

    setBatchReviewFlagState((current) => ({
      ...current,
      [String(batchId)]: {
        flagged,
      },
    }));

    if (!batch.sharedPersisted || batch.sharedDirty) {
      const saved = await saveBatchToSharedData(batchId, { quiet: true });
      if (!saved && typeof window !== "undefined") {
        window.alert(
          flagged
            ? "Tagged the component for review locally, but the component itself could not be saved to shared data first."
            : "Removed the component review tag locally, but the component itself could not be saved to shared data first."
        );
        return false;
      }
    }

    const persistResult = await persistSharedFlagEntry({
      id: buildBatchReviewFlagRuleId(batchId),
      ruleField: BATCH_REVIEW_FLAG_RULE_FIELD,
      label: "Component review flag",
      entityId: batchId,
      flagged,
    });

    if (!persistResult.ok && typeof window !== "undefined") {
      window.alert(
        flagged
          ? `Tagged the component for review locally, but could not sync that tag to shared data. ${persistResult.error || ""}`.trim()
          : `Removed the component review tag locally, but could not sync that change to shared data. ${persistResult.error || ""}`.trim()
      );
    }

    return persistResult.ok;
  };

  const selectFallbackRecord = (sectionId, excludedId = "") => {
    if (sectionId === "ingredients") {
      const nextIngredient =
        ingredientMaster.find((item) => item.id !== excludedId && !item.archived) ||
        ingredientMaster.find((item) => item.id !== excludedId);
      if (nextIngredient) {
        setActiveSection("ingredients");
        setIngredientWorkspaceView("catalogue");
        setSelectedImportRowId("");
        setSelectedRecord({ type: "ingredient", id: nextIngredient.id });
      } else {
        setSelectedRecord({ type: "", id: "" });
      }
      return;
    }

    if (sectionId === "substitutions") {
      const nextOpportunity = substitutionOpportunities.find((item) => item.sourceIngredient.id !== excludedId);
      setActiveSection("substitutions");
      setSelectedImportRowId("");
      setSelectedRecord(nextOpportunity ? { type: "ingredient", id: nextOpportunity.sourceIngredient.id } : { type: "", id: "" });
      return;
    }

    if (sectionId === "recipes") {
      const nextRecipe =
        recipes.find((item) => item.id !== excludedId && !item.archived) ||
        recipes.find((item) => item.id !== excludedId);
      setActiveSection("recipes");
      setSelectedImportRowId("");
      setSelectedRecord(nextRecipe ? { type: "recipe", id: nextRecipe.id } : { type: "", id: "" });
      return;
    }

    if (sectionId === "batches") {
      const nextBatch =
        batches.find((item) => item.id !== excludedId && !item.archived) ||
        batches.find((item) => item.id !== excludedId);
      setActiveSection("batches");
      setSelectedImportRowId("");
      setSelectedRecord(nextBatch ? { type: "batch", id: nextBatch.id } : { type: "", id: "" });
      return;
    }

    if (sectionId === "menus") {
      const nextMenu =
        menus.find((item) => item.id !== excludedId && !item.archived) ||
        menus.find((item) => item.id !== excludedId);
      setActiveSection("menus");
      setSelectedImportRowId("");
      setSelectedRecord(nextMenu ? { type: "menu", id: nextMenu.id } : { type: "", id: "" });
      return;
    }
  };

  const archiveIngredient = (ingredientId) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient || ingredient.archived) return;
    const impactSummary = buildIngredientImpactSummary(ingredient, relationshipMaps, recordMaps.batch);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Archive "${ingredient.name}"?\n\nThis record is currently linked to ${impactSummary}.\n\nYou can restore it later from the archived filter.`
      );
      if (!confirmed) return;
    }
    updateIngredient(ingredientId, (current) => ({
      ...current,
      archived: true,
    }));
  };

  const restoreIngredient = (ingredientId) => {
    updateIngredient(ingredientId, (current) => ({
      ...current,
      archived: false,
    }));
    setIngredientStatusFilter("all");
  };

  const deleteIngredientPermanently = async (ingredientId) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient || !ingredient.archived) return;
    const impactSummary = buildIngredientImpactSummary(ingredient, relationshipMaps, recordMaps.batch);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${ingredient.name}" permanently?\n\nThis will remove it from ${impactSummary} and cannot be undone.`
      );
      if (!confirmed) return;
    }

    const pendingSharedRecordId = String(ingredient.sharedRecordId || "").trim();
    if (pendingSharedRecordId) {
      setPendingIngredientDeletionIds((current) =>
        current.includes(pendingSharedRecordId) ? current : [...current, pendingSharedRecordId]
      );
      setDeletedIngredientTombstoneIds((current) =>
        current.includes(pendingSharedRecordId) ? current : [...current, pendingSharedRecordId]
      );
    }

    setIngredientMaster((current) => current.filter((item) => item.id !== ingredientId));
    setRecipes((current) =>
      current.map((recipe) =>
        syncRecipeRelations({
          ...recipe,
          ingredientLines: (recipe.ingredientLines || []).filter((line) => line.ingredientId !== ingredientId),
        })
      )
    );
    setBatches((current) =>
      current.map((batch) =>
        syncBatchRecord({
          ...batch,
          ingredientLines: (batch.ingredientLines || []).filter((line) => line.ingredientId !== ingredientId),
          publishedIngredientId: batch.publishedIngredientId === ingredientId ? "" : batch.publishedIngredientId,
        })
      )
    );

    if (selectedRecord.type === "ingredient" && selectedRecord.id === ingredientId) {
      selectFallbackRecord("ingredients", ingredientId);
    }

    if (pendingSharedRecordId && supabaseEnabled && supabase) {
      const { error } = await supabase.from("ingredients").delete().eq("id", pendingSharedRecordId);
      if (error) {
        if (typeof window !== "undefined") {
          window.alert(error.message || "Could not remove deleted ingredient from shared data.");
        }
        return;
      }

      setPendingIngredientDeletionIds((current) => current.filter((id) => id !== pendingSharedRecordId));
    }
  };

  const bulkDeleteArchivedIngredients = async (ingredientIds = []) => {
    const safeIds = Array.from(new Set((ingredientIds || []).filter(Boolean)));
    const ingredientsToDelete = ingredientMaster.filter(
      (item) => safeIds.includes(item.id) && item.archived
    );
    if (!ingredientsToDelete.length) return;

    const impactSummary = ingredientsToDelete.length === 1
      ? buildIngredientImpactSummary(ingredientsToDelete[0], relationshipMaps, recordMaps.batch)
      : `${ingredientsToDelete.length} archived ingredients`;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete ${ingredientsToDelete.length} archived ingredient${ingredientsToDelete.length === 1 ? "" : "s"} permanently?\n\nThis will remove them from ${impactSummary} and cannot be undone.`
      );
      if (!confirmed) return;
    }

    const ingredientIdsToDelete = new Set(ingredientsToDelete.map((item) => item.id));
    const sharedIdsToDelete = Array.from(
      new Set(
        ingredientsToDelete
          .map((item) => String(item.sharedRecordId || "").trim())
          .filter(Boolean)
      )
    );

    if (sharedIdsToDelete.length) {
      setPendingIngredientDeletionIds((current) =>
        Array.from(new Set([...current, ...sharedIdsToDelete]))
      );
      setDeletedIngredientTombstoneIds((current) =>
        Array.from(new Set([...current, ...sharedIdsToDelete]))
      );
    }

    setIngredientMaster((current) =>
      current.filter((item) => !ingredientIdsToDelete.has(item.id))
    );
    setRecipes((current) =>
      current.map((recipe) =>
        syncRecipeRelations({
          ...recipe,
          ingredientLines: (recipe.ingredientLines || []).filter((line) => !ingredientIdsToDelete.has(line.ingredientId)),
        })
      )
    );
    setBatches((current) =>
      current.map((batch) =>
        syncBatchRecord({
          ...batch,
          ingredientLines: (batch.ingredientLines || []).filter((line) => !ingredientIdsToDelete.has(line.ingredientId)),
          publishedIngredientId: ingredientIdsToDelete.has(batch.publishedIngredientId) ? "" : batch.publishedIngredientId,
        })
      )
    );

    if (selectedRecord.type === "ingredient" && ingredientIdsToDelete.has(selectedRecord.id)) {
      selectFallbackRecord("ingredients", selectedRecord.id);
    }

    if (sharedIdsToDelete.length && supabaseEnabled && supabase) {
      const { error } = await supabase.from("ingredients").delete().in("id", sharedIdsToDelete);
      if (error) {
        if (typeof window !== "undefined") {
          window.alert(error.message || "Could not remove deleted ingredients from shared data.");
        }
        return;
      }

      setPendingIngredientDeletionIds((current) => current.filter((id) => !sharedIdsToDelete.includes(id)));
    }
  };

  const deleteBatchAndPublishedIngredient = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;

    const publishedIngredient = batch.publishedIngredientId
      ? ingredientMaster.find((ingredient) => ingredient.id === batch.publishedIngredientId) || null
      : null;
    if (!publishedIngredient) return;

    const linkedRecipeIds = relationshipMaps?.batchRecipes?.get(batch.id) || [];
    const publishedIngredientRecipeIds = relationshipMaps?.ingredientRecipes?.get(publishedIngredient.id) || [];
    const otherBatchLinks = batches.filter(
      (item) =>
        item.id !== batchId &&
        (item.ingredientLines || []).some((line) => line.ingredientId === publishedIngredient.id)
    );

    if (linkedRecipeIds.length || publishedIngredientRecipeIds.length || otherBatchLinks.length) {
      if (typeof window !== "undefined") {
        const otherBatchNames = otherBatchLinks.slice(0, 8).map((item) => item.name).join(", ");
        window.alert(
          [
            `Cannot delete "${batch.name}" and "${publishedIngredient.name}" together yet.`,
            "",
            linkedRecipeIds.length
              ? `The component is still linked to ${linkedRecipeIds.length} recipe${linkedRecipeIds.length === 1 ? "" : "s"}.`
              : "",
            publishedIngredientRecipeIds.length
              ? `The published ingredient is still linked to ${publishedIngredientRecipeIds.length} recipe${publishedIngredientRecipeIds.length === 1 ? "" : "s"}.`
              : "",
            otherBatchLinks.length
              ? `The published ingredient is still used in ${otherBatchLinks.length} other component${otherBatchLinks.length === 1 ? "" : "s"}${otherBatchNames ? `: ${otherBatchNames}` : ""}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${batch.name}" and its published ingredient "${publishedIngredient.name}"?\n\nThis will remove both from the live system in one step.`
      );
      if (!confirmed) return;
    }

    if (publishedIngredient.sharedRecordId) {
      setPendingIngredientDeletionIds((current) =>
        current.includes(publishedIngredient.sharedRecordId)
          ? current
          : [...current, publishedIngredient.sharedRecordId]
      );
    }

    setPendingBatchDeletionIds((current) => (current.includes(batchId) ? current : [...current, batchId]));
    setBatches((current) => current.filter((item) => item.id !== batchId));
    setIngredientMaster((current) => current.filter((item) => item.id !== publishedIngredient.id));
    setRecipes((current) =>
      current.map((recipe) =>
        syncRecipeRelations({
          ...recipe,
          batchLines: (recipe.batchLines || []).filter((line) => line.batchId !== batchId),
          ingredientLines: (recipe.ingredientLines || []).filter((line) => line.ingredientId !== publishedIngredient.id),
        })
      )
    );

    if (selectedRecord.type === "batch" && selectedRecord.id === batchId) {
      selectFallbackRecord("batches", batchId);
    }
  };

  const deletePublishedIngredientFromBatch = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;

    const publishedIngredient = batch.publishedIngredientId
      ? ingredientMaster.find((ingredient) => ingredient.id === batch.publishedIngredientId) || null
      : null;
    if (!publishedIngredient) return;

    const publishedIngredientRecipeIds = relationshipMaps?.ingredientRecipes?.get(publishedIngredient.id) || [];
    const otherBatchLinks = batches.filter(
      (item) =>
        item.id !== batchId &&
        (item.ingredientLines || []).some((line) => line.ingredientId === publishedIngredient.id)
    );

    if (publishedIngredientRecipeIds.length || otherBatchLinks.length) {
      if (typeof window !== "undefined") {
        const otherBatchNames = otherBatchLinks.slice(0, 8).map((item) => item.name).join(", ");
        window.alert(
          [
            `Cannot delete published ingredient "${publishedIngredient.name}" yet.`,
            "",
            publishedIngredientRecipeIds.length
              ? `It is still linked to ${publishedIngredientRecipeIds.length} recipe${publishedIngredientRecipeIds.length === 1 ? "" : "s"}.`
              : "",
            otherBatchLinks.length
              ? `It is still used in ${otherBatchLinks.length} other component${otherBatchLinks.length === 1 ? "" : "s"}${otherBatchNames ? `: ${otherBatchNames}` : ""}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete the published ingredient "${publishedIngredient.name}"?\n\nThe component will stay in place, but it will move back to Ready so it can be published again later if needed.`
      );
      if (!confirmed) return;
    }

    if (publishedIngredient.sharedRecordId) {
      setPendingIngredientDeletionIds((current) =>
        current.includes(publishedIngredient.sharedRecordId)
          ? current
          : [...current, publishedIngredient.sharedRecordId]
      );
    }

    setIngredientMaster((current) => current.filter((item) => item.id !== publishedIngredient.id));
    setBatches((current) =>
      current.map((item) =>
        item.id === batchId
          ? syncBatchRecord({
              ...item,
              publishedIngredientId: "",
              status: "review",
              sharedDirty: true,
            })
          : item
      )
    );

    if (selectedRecord.type === "ingredient" && selectedRecord.id === publishedIngredient.id) {
      selectFallbackRecord("ingredients", publishedIngredient.id);
    }

    if (typeof window !== "undefined") {
      window.alert(
        `Deleted published ingredient "${publishedIngredient.name}".\n\nThe component remains in place and has been moved back to Ready so it can be published again later if needed.`
      );
    }
  };

  const archiveRecipe = (recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe || recipe.archived) return;
    const impactSummary = buildRecipeImpactSummary(recipe, recordMaps.menu);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Archive "${recipe.name}"?\n\nThis recipe is currently linked to ${impactSummary}.\n\nYou can restore it later from the archived filter.`
      );
      if (!confirmed) return;
    }
    updateRecipe(recipeId, (current) => ({
      ...current,
      archived: true,
    }));
  };

  const restoreRecipe = (recipeId) => {
    updateRecipe(recipeId, (current) => ({
      ...current,
      archived: false,
    }));
    setRecipeStatusFilter("all");
  };

  const deleteRecipePermanently = (recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe || !recipe.archived) return;
    const impactSummary = buildRecipeImpactSummary(recipe, recordMaps.menu);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${recipe.name}" permanently?\n\nThis will remove it from ${impactSummary} and cannot be undone.`
      );
      if (!confirmed) return;
    }

    setPendingRecipeDeletionIds((current) => (current.includes(recipeId) ? current : [...current, recipeId]));
    setRecipes((current) => current.filter((item) => item.id !== recipeId));
    setMenus((current) =>
      current.map((menu) =>
        syncMenuRecord({
          ...menu,
          items: (menu.items || []).map((item) =>
            item.recipeId === recipeId
              ? {
                  ...item,
                  recipeId: "",
                }
              : item
          ),
          sharedDirty: (menu.items || []).some((item) => item.recipeId === recipeId) ? true : menu.sharedDirty,
        })
      )
    );
    if (selectedRecord.type === "recipe" && selectedRecord.id === recipeId) {
      selectFallbackRecord("recipes", recipeId);
    }
  };

  const archiveBatch = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch || batch.archived) return;
    const impactSummary = buildBatchImpactSummary(batch, relationshipMaps, recordMaps.ingredient);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Archive "${batch.name}"?\n\nThis component is currently linked to ${impactSummary}.\n\nYou can restore it later from the archived filter.`
      );
      if (!confirmed) return;
    }
    updateBatch(batchId, (current) => ({
      ...current,
      archived: true,
    }));
  };

  const restoreBatch = (batchId) => {
    updateBatch(batchId, (current) => ({
      ...current,
      archived: false,
    }));
    setBatchStatusFilter("all");
  };

  const deleteBatchPermanently = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch || !batch.archived) return;
    const impactSummary = buildBatchImpactSummary(batch, relationshipMaps, recordMaps.ingredient);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${batch.name}" permanently?\n\nThis will remove it from ${impactSummary} and cannot be undone.`
      );
      if (!confirmed) return;
    }

    setPendingBatchDeletionIds((current) => (current.includes(batchId) ? current : [...current, batchId]));
    setBatches((current) => current.filter((item) => item.id !== batchId));
    setRecipes((current) =>
      current.map((recipe) =>
        syncRecipeRelations({
          ...recipe,
          batchLines: (recipe.batchLines || []).filter((line) => line.batchId !== batchId),
        })
      )
    );
    setIngredientMaster((current) =>
      current.map((ingredient) =>
        ingredient.batchId === batchId
          ? {
              ...ingredient,
              batchId: "",
            }
          : ingredient
      )
    );

    if (selectedRecord.type === "batch" && selectedRecord.id === batchId) {
      selectFallbackRecord("batches", batchId);
    }
  };

  const archiveMenu = (menuId) => {
    const menu = menus.find((item) => item.id === menuId);
    if (!menu || menu.archived) return;
    const impactSummary = buildMenuImpactSummary(menu);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Archive "${menu.name}"?\n\nThis menu currently contains ${impactSummary}.\n\nYou can restore it later from the archived filter.`
      );
      if (!confirmed) return;
    }
    updateMenu(menuId, (current) => ({
      ...current,
      archived: true,
    }));
  };

  const restoreMenu = (menuId) => {
    updateMenu(menuId, (current) => ({
      ...current,
      archived: false,
    }));
  };

  const deleteMenuPermanently = (menuId) => {
    const menu = menus.find((item) => item.id === menuId);
    if (!menu || !menu.archived) return;
    const impactSummary = buildMenuImpactSummary(menu);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${menu.name}" permanently?\n\nThis will remove the menu record and its ${impactSummary}. Linked dishes and recipes will not be deleted.`
      );
      if (!confirmed) return;
    }

    setPendingMenuDeletionIds((current) => (current.includes(menuId) ? current : [...current, menuId]));
    setMenus((current) => current.filter((item) => item.id !== menuId));
    if (selectedRecord.type === "menu" && selectedRecord.id === menuId) {
      selectFallbackRecord("menus", menuId);
    }
  };

  const moveIngredientBackToReview = (ingredient) => {
    if (!ingredient?.id || !ingredient?.sourceCode) return;

    let nextSelectedImportRowId = "";

    setIngredientImportRows((current) =>
      current.map((row) => {
        const matchesIngredient = row.targetId === ingredient.id || row.sourceCode === ingredient.sourceCode;
        if (!matchesIngredient) return row;
        if (!nextSelectedImportRowId) {
          nextSelectedImportRowId = row.id;
        }
        return {
          ...row,
          published: false,
          reviewStatus: "review",
          strategy: "merge",
          targetId: ingredient.id,
          targetName: ingredient.name,
          decisionNote: "Moved back to review from the clean ingredient master.",
        };
      })
    );

    if (nextSelectedImportRowId) {
      setActiveSection("ingredients");
      setIngredientWorkspaceView("review");
      setSelectedImportRowId(nextSelectedImportRowId);
    }
  };

  const updateIngredientField = (ingredientId, field, value) => {
    const numericFields = new Set(["unitCost", "purchaseVatRate", "portionCostHint"]);
    const existingIngredient = ingredientMaster.find((item) => item.id === ingredientId) || null;
    let ingredientForReviewShift = null;
    let ingredientStatusForRecipeSync = "";
    let ingredientNameForRecipeSync = "";
    updateIngredient(ingredientId, (ingredient) => {
      const nextValue = numericFields.has(field) ? Number(value || 0) : value;
      const nextIngredient = {
        ...ingredient,
        ...(field === "sourceType"
          ? { soft1Status: value === "soft1" ? "in_soft1" : "pending" }
          : {}),
        [field]: nextValue,
        ...(ingredient.sharedRecordId
          ? { sharedDirty: true, masterReviewStatus: getIngredientMasterReviewStatus(ingredient) === "ready" ? "review" : ingredient.masterReviewStatus }
          : {}),
      };

      if (field === "sourceCode" || field === "sourceType") {
        if (isIngredientCodeLocked(nextIngredient)) {
          nextIngredient.code = String(nextIngredient.sourceCode || "").trim();
        }
      }

      if (field === "soft1Status" && value === "in_soft1" && String(nextIngredient.sourceCode || "").trim()) {
        nextIngredient.sourceType = "soft1";
        nextIngredient.code = String(nextIngredient.sourceCode || "").trim();
      }

      if (field === "code") {
        const duplicate = getIngredientCodeConflict(ingredientMaster, nextIngredient.code, ingredientId);
        if (duplicate) {
          setIngredientCodeAlerts((current) => ({
            ...current,
            [ingredientId]: `Code already used by ${duplicate.name} (${duplicate.code}).`,
          }));
          return ingredient;
        }
      }

      setIngredientCodeAlerts((current) => {
        if (!current[ingredientId]) return current;
        const nextAlerts = { ...current };
        delete nextAlerts[ingredientId];
        return nextAlerts;
      });

      if (field === "status" && nextIngredient.status === "review") {
        ingredientForReviewShift = nextIngredient;
      }
      if (field === "status" && nextIngredient.status === "draft") {
        ingredientStatusForRecipeSync = "draft";
        ingredientNameForRecipeSync = nextIngredient.name;
      }

      return nextIngredient;
    });

    if (
      ingredientForReviewShift &&
      getIngredientSourceType(ingredientForReviewShift) === "soft1" &&
      String(ingredientForReviewShift.sourceCode || "").trim()
    ) {
      moveIngredientBackToReview(ingredientForReviewShift);
    }

    if (ingredientStatusForRecipeSync === "draft") {
      syncRecipesForIngredientStatus(ingredientId, "draft", ingredientNameForRecipeSync);
    }

    if (existingIngredient?.sharedRecordId) {
      setIngredientMasterReviewState((current) => ({
        ...current,
        [existingIngredient.sharedRecordId]: {
          status: "review",
          sharedUpdatedAt: existingIngredient.sharedUpdatedAt || existingIngredient.lastImportedAt || "",
        },
      }));
    }

    if (field === "tradeCategory" && existingIngredient?.sharedRecordId) {
      persistIngredientTradeCategoryForRecord(ingredientId, value);
    }
  };

  const updateIngredientAliases = (ingredientId, rawValue) => {
    const existingIngredient = ingredientMaster.find((item) => item.id === ingredientId) || null;
    updateIngredient(ingredientId, (ingredient) => ({
      ...ingredient,
      aliases: dedupeTextList(
        String(rawValue || "")
          .split(/\n|,/)
          .map((value) => value.trim())
          .filter(Boolean)
      ),
      ...(ingredient.sharedRecordId ? { sharedDirty: true, masterReviewStatus: "review" } : {}),
    }));

    if (existingIngredient?.sharedRecordId) {
      setIngredientMasterReviewState((current) => ({
        ...current,
        [existingIngredient.sharedRecordId]: {
          status: "review",
          sharedUpdatedAt: existingIngredient.sharedUpdatedAt || existingIngredient.lastImportedAt || "",
        },
      }));
    }
  };

  const openIngredientMaker = ({ attachToRecipeId = "", attachToBatchId = "", openRecordAfterSave = true } = {}) => {
    setIngredientMakerModal({
      isOpen: true,
      draft: createEmptyIngredient(ingredientMaster.length),
      attachToRecipeId,
      attachToBatchId,
      openRecordAfterSave,
    });
  };

  const closeIngredientMaker = () => {
    setIngredientMakerModal((current) => ({
      ...current,
      isOpen: false,
    }));
  };

  const openIngredientSubstitution = (ingredientId, replacementIngredientId = "") => {
    setIngredientSubstitutionModal({
      isOpen: true,
      sourceIngredientId: ingredientId,
      replacementIngredientId,
      archiveOriginal: true,
    });
  };

  const closeIngredientSubstitution = () => {
    setIngredientSubstitutionModal({
      isOpen: false,
      sourceIngredientId: "",
      replacementIngredientId: "",
      archiveOriginal: true,
    });
  };

  const openIngredientMerge = (ingredientId, targetIngredientId = "") => {
    setIngredientMergeModal({
      isOpen: true,
      sourceIngredientId: ingredientId,
      targetIngredientId,
    });
  };

  const closeIngredientMerge = () => {
    setIngredientMergeModal({
      isOpen: false,
      sourceIngredientId: "",
      targetIngredientId: "",
    });
  };

  const updateIngredientSubstitutionField = (field, value) => {
    setIngredientSubstitutionModal((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateIngredientMergeField = (field, value) => {
    setIngredientMergeModal((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateIngredientMakerField = (field, value) => {
    setIngredientMakerModal((current) => ({
      ...current,
      draft: sanitizeIngredientDraft(
        (() => {
          const nextDraft = {
          ...current.draft,
          [field]: ["unitCost", "purchaseVatRate", "portionCostHint"].includes(field) ? Number(value || 0) : value,
          ...(field === "sourceType" ? { soft1Status: value === "soft1" ? "in_soft1" : "pending" } : {}),
          };

          if ((field === "sourceCode" || field === "sourceType") && isIngredientCodeLocked(nextDraft)) {
            nextDraft.code = String(nextDraft.sourceCode || "").trim();
          }

          if (field === "soft1Status" && value === "in_soft1" && String(nextDraft.sourceCode || "").trim()) {
            nextDraft.sourceType = "soft1";
            nextDraft.code = String(nextDraft.sourceCode || "").trim();
          }

          return nextDraft;
        })(),
        ingredientMaster.length
      ),
    }));
  };

  const generateIngredientCode = (ingredientId) => {
    updateIngredient(ingredientId, (ingredient) => ({
      ...ingredient,
      code: generateIngredientCodeFromDraft(ingredient, ingredientMaster, ingredientId),
    }));
    setIngredientCodeAlerts((current) => {
      if (!current[ingredientId]) return current;
      const nextAlerts = { ...current };
      delete nextAlerts[ingredientId];
      return nextAlerts;
    });
  };

  const generateIngredientMakerCode = () => {
    setIngredientMakerModal((current) => ({
      ...current,
      draft: sanitizeIngredientDraft(
        {
          ...current.draft,
          code: generateIngredientCodeFromDraft(current.draft, ingredientMaster, current.draft?.id),
        },
        ingredientMaster.length
      ),
    }));
  };

  const updateIngredientMakerAliases = (rawValue) => {
    setIngredientMakerModal((current) => ({
      ...current,
      draft: sanitizeIngredientDraft(
        {
          ...current.draft,
          aliases: String(rawValue || "")
            .split(/\n|,/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
        ingredientMaster.length
      ),
    }));
  };

  const saveIngredientMaker = () => {
    const nextIngredient = sanitizeIngredientDraft(ingredientMakerModal.draft, ingredientMaster.length);
    const codeConflict = getIngredientCodeConflict(ingredientMaster, nextIngredient.code, nextIngredient.id);
    if (codeConflict) {
      return;
    }

    setIngredientMaster((current) => [nextIngredient, ...current]);

    if (ingredientMakerModal.attachToRecipeId) {
      setRecipes((current) =>
        current.map((recipe) => {
          if (recipe.id !== ingredientMakerModal.attachToRecipeId) return recipe;
          const alreadyLinked = (recipe.ingredientLines || []).some((line) => line.ingredientId === nextIngredient.id);
          if (alreadyLinked) return recipe;

          return syncRecipeRelations({
            ...recipe,
            ingredientLines: [
              ...(recipe.ingredientLines || []),
              {
                ingredientId: nextIngredient.id,
                quantity: "1",
                unit: inferMeasurementUnit(nextIngredient.packSize),
                estimatedCost: Number(nextIngredient.portionCostHint || 0),
              },
            ],
          });
        })
      );
    }

    if (ingredientMakerModal.attachToBatchId) {
      setBatches((current) =>
        current.map((batch) => {
          if (batch.id !== ingredientMakerModal.attachToBatchId) return batch;
          const alreadyLinked = (batch.ingredientLines || []).some((line) => line.ingredientId === nextIngredient.id);
          if (alreadyLinked) return batch;

          return syncBatchRecord({
            ...batch,
            ingredientLines: [
              ...(batch.ingredientLines || []),
              {
                ingredientId: nextIngredient.id,
                quantity: "1",
                unit: inferMeasurementUnit(nextIngredient.packSize),
                estimatedCost: Number(nextIngredient.portionCostHint || 0),
              },
            ],
          });
        })
      );
    }

    if (ingredientMakerModal.attachToBatchId) {
      setSelectedImportRowId("");
      setSelectedRecord({ type: "batch", id: ingredientMakerModal.attachToBatchId });
      setActiveSection("batches");
      setBatchEditorStep("components");
    } else if (ingredientMakerModal.openRecordAfterSave && !ingredientMakerModal.attachToRecipeId) {
      setSelectedImportRowId("");
      setSelectedRecord({ type: "ingredient", id: nextIngredient.id });
      setActiveSection("ingredients");
      setIngredientWorkspaceView("catalogue");
    }

    closeIngredientMaker();
  };

  const applyIngredientSubstitution = () => {
    const sourceIngredient = ingredientSubstitutionSource;
    const replacementIngredient = ingredientSubstitutionReplacement;
    if (!sourceIngredient || !replacementIngredient) return;

    const impact = calculateIngredientSubstitutionImpact(sourceIngredient.id, replacementIngredient.id, recipes, batches);
    if (!impact.totalTouched) {
      if (typeof window !== "undefined") {
        window.alert("This ingredient is not currently linked to any recipes or components.");
      }
      return;
    }

    if (!impact.totalUpdated) {
      if (typeof window !== "undefined") {
        window.alert("These links need manual review because the replacement ingredient is already present with incompatible units.");
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Substitute "${sourceIngredient.name}" with "${replacementIngredient.name}"?\n\n` +
          `Recipes updating: ${impact.recipes.updated}\n` +
          `Component recipes updating: ${impact.batches.updated}\n` +
          `Needs manual review: ${impact.totalConflicts}\n\n` +
          (ingredientSubstitutionModal.archiveOriginal ? "The original ingredient will be archived after substitution." : "The original ingredient will stay active.")
      );
      if (!confirmed) return;
    }

    setRecipes((current) =>
      current.map((recipe) => {
        const outcome = substituteIngredientLines(recipe.ingredientLines || [], sourceIngredient.id, replacementIngredient.id);
        if (!outcome.applied) return recipe;
        return syncRecipeRelations({
          ...recipe,
          ingredientLines: outcome.lines,
        });
      })
    );

    setBatches((current) =>
      current.map((batch) => {
        const outcome = substituteIngredientLines(batch.ingredientLines || [], sourceIngredient.id, replacementIngredient.id);
        if (!outcome.applied) return batch;
        return syncBatchRecord({
          ...batch,
          ingredientLines: outcome.lines,
        });
      })
    );

    setIngredientMaster((current) =>
      current.map((ingredient) => {
        if (ingredient.id === sourceIngredient.id) {
          const nextNote = `Substituted with ${replacementIngredient.name} on ${getTodayImportDate()}.`;
          return {
            ...ingredient,
            archived: ingredientSubstitutionModal.archiveOriginal ? true : ingredient.archived,
            notes: [String(ingredient.notes || "").trim(), nextNote].filter(Boolean).join(" "),
          };
        }
        if (ingredient.id === replacementIngredient.id) {
          const nextNote = `Substitution target for ${sourceIngredient.name} on ${getTodayImportDate()}.`;
          return {
            ...ingredient,
            notes: [String(ingredient.notes || "").trim(), nextNote].filter(Boolean).join(" "),
          };
        }
        return ingredient;
      })
    );

    closeIngredientSubstitution();
  };

  const applyIngredientMerge = async () => {
    const sourceIngredient = ingredientMergeSource;
    const targetIngredient = ingredientMergeTarget;
    if (!sourceIngredient || !targetIngredient || sourceIngredient.id === targetIngredient.id) return;

    if (sourceIngredient.batchId || targetIngredient.batchId) {
      if (typeof window !== "undefined") {
        window.alert(
          "Published component ingredients should be cleaned up from the component screen first. Master-list merge is only available for normal ingredients right now."
        );
      }
      return;
    }

    const impact = calculateIngredientSubstitutionImpact(sourceIngredient.id, targetIngredient.id, recipes, batches);
    if (!impact.totalUpdated || impact.totalConflicts) {
      if (!impact.totalTouched && !impact.totalConflicts) {
        // Allow unlinked duplicates to merge by carrying aliases/details onto the keeper.
      } else if (impact.totalConflicts) {
        if (typeof window !== "undefined") {
          const recipeConflictNames = (impact.recipes.conflictRecords || []).slice(0, 6).map((recipe) => recipe.name);
          const batchConflictNames = (impact.batches.conflictRecords || []).slice(0, 6).map((batch) => batch.name);
          window.alert(
            [
              `Cannot merge "${sourceIngredient.name}" into "${targetIngredient.name}" yet.`,
              "",
              "Some linked recipes or components already contain both ingredients with incompatible units, so this needs manual review first.",
              recipeConflictNames.length ? `Recipe conflicts: ${recipeConflictNames.join(", ")}` : "",
              batchConflictNames.length ? `Component conflicts: ${batchConflictNames.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          );
        }
        return;
      } else if (impact.totalTouched && !impact.totalUpdated) {
        if (typeof window !== "undefined") {
          window.alert("These linked records need manual review first because the duplicate and keeper are already present with incompatible units.");
        }
        return;
      }
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        [
          `Merge "${sourceIngredient.name}" into "${targetIngredient.name}"?`,
          "",
          "This will:",
          `- move ${impact.recipes.updated} recipe link${impact.recipes.updated === 1 ? "" : "s"} to the keeper`,
          `- move ${impact.batches.updated} component link${impact.batches.updated === 1 ? "" : "s"} to the keeper`,
          impact.totalMerged ? `- merge ${impact.totalMerged} duplicate line${impact.totalMerged === 1 ? "" : "s"} where units already match` : "",
          impact.totalTouched ? "" : "- keeper details and aliases will still be updated even though no linked records need moving",
          "- carry the duplicate name and aliases onto the keeper",
          "- archive the duplicate ingredient instead of deleting it",
        ]
          .filter(Boolean)
          .join("\n")
      );
      if (!confirmed) return;
    }

    const shouldCarryTradeCategory =
      !String(targetIngredient.tradeCategory || "").trim() && Boolean(String(sourceIngredient.tradeCategory || "").trim());

    const updatedTargetIngredient = sanitizeIngredientDraft(
      {
        ...targetIngredient,
        aliases: dedupeTextList([
          ...(targetIngredient.aliases || []),
          sourceIngredient.name,
          ...(sourceIngredient.aliases || []),
        ]).filter((alias) => normalizeIngredientKey(alias) !== normalizeIngredientKey(targetIngredient.name)),
        supplier: String(targetIngredient.supplier || "").trim() || String(sourceIngredient.supplier || "").trim(),
        packSize: String(targetIngredient.packSize || "").trim() || String(sourceIngredient.packSize || "").trim(),
        category: isWeakIngredientCategory(targetIngredient.category || "")
          ? String(sourceIngredient.category || "").trim() || targetIngredient.category
          : targetIngredient.category,
        tradeCategory: String(targetIngredient.tradeCategory || "").trim() || String(sourceIngredient.tradeCategory || "").trim(),
        notes: dedupeTextList([
          String(targetIngredient.notes || "").trim(),
          `Merged duplicate ingredient ${String(sourceIngredient.name || sourceIngredient.code || sourceIngredient.id).trim()} on ${getTodayImportDate()}.`,
        ]).join(" "),
        needsReviewFlag: Boolean(targetIngredient.needsReviewFlag || sourceIngredient.needsReviewFlag),
        needsSubstitutionReview: Boolean(targetIngredient.needsSubstitutionReview || sourceIngredient.needsSubstitutionReview),
        masterReviewStatus: targetIngredient.masterReviewStatus || "ready",
        sharedDirty: targetIngredient.sharedRecordId ? true : targetIngredient.sharedDirty,
      },
      ingredientMaster.length
    );

    const updatedSourceIngredient = sanitizeIngredientDraft(
      {
        ...sourceIngredient,
        archived: true,
        notes: dedupeTextList([
          String(sourceIngredient.notes || "").trim(),
          `Merged into ${String(targetIngredient.name || targetIngredient.code || targetIngredient.id).trim()} on ${getTodayImportDate()}.`,
        ]).join(" "),
        needsReviewFlag: false,
        needsSubstitutionReview: false,
        masterReviewStatus: sourceIngredient.sharedRecordId ? "ready" : sourceIngredient.masterReviewStatus,
        sharedDirty: sourceIngredient.sharedRecordId ? true : sourceIngredient.sharedDirty,
      },
      ingredientMaster.length
    );

    setRecipes((current) =>
      current.map((recipe) => {
        const outcome = substituteIngredientLines(recipe.ingredientLines || [], sourceIngredient.id, targetIngredient.id);
        if (!outcome.applied) return recipe;
        return syncRecipeRelations({
          ...recipe,
          ingredientLines: outcome.lines,
          sharedDirty: true,
        });
      })
    );

    setBatches((current) =>
      current.map((batch) => {
        const outcome = substituteIngredientLines(batch.ingredientLines || [], sourceIngredient.id, targetIngredient.id);
        if (!outcome.applied) return batch;
        return syncBatchRecord({
          ...batch,
          ingredientLines: outcome.lines,
          sharedDirty: true,
        });
      })
    );

    setIngredientMaster((current) =>
      current.map((ingredient) => {
        if (ingredient.id === targetIngredient.id) {
          return updatedTargetIngredient;
        }

        if (ingredient.id === sourceIngredient.id) {
          return updatedSourceIngredient;
        }

        return ingredient;
      })
    );

    setIngredientImportRows((current) =>
      current.map((row) => {
        const existingIngredientId = row.existingIngredientId === sourceIngredient.id ? targetIngredient.id : row.existingIngredientId;
        const targetId = row.targetId === sourceIngredient.id ? targetIngredient.id : row.targetId;
        const targetName = row.targetId === sourceIngredient.id ? targetIngredient.name : row.targetName;
        if (
          existingIngredientId === row.existingIngredientId &&
          targetId === row.targetId &&
          targetName === row.targetName
        ) {
          return row;
        }
        return {
          ...row,
          existingIngredientId,
          targetId,
          targetName,
        };
      })
    );

    if (sourceIngredient.sharedRecordId || targetIngredient.sharedRecordId) {
      const nextTargetReviewEntry = targetIngredient.sharedRecordId
        ? {
            ...(ingredientMasterReviewState[targetIngredient.sharedRecordId] || {}),
            status: String(
              (ingredientMasterReviewState[targetIngredient.sharedRecordId] || {}).status ||
                targetIngredient.masterReviewStatus ||
                "ready"
            ).trim() || "ready",
            sharedUpdatedAt: targetIngredient.sharedUpdatedAt || targetIngredient.lastImportedAt || "",
            flagged: Boolean(
              (ingredientMasterReviewState[targetIngredient.sharedRecordId] || {}).flagged ||
              targetIngredient.needsSubstitutionReview ||
              sourceIngredient.needsSubstitutionReview
            ),
            forReview: Boolean(
              (ingredientMasterReviewState[targetIngredient.sharedRecordId] || {}).forReview ||
              targetIngredient.needsReviewFlag ||
              sourceIngredient.needsReviewFlag
            ),
          }
        : null;
      const nextSourceReviewEntry = sourceIngredient.sharedRecordId
        ? {
            ...(ingredientMasterReviewState[sourceIngredient.sharedRecordId] || {}),
            status: "ready",
            sharedUpdatedAt: sourceIngredient.sharedUpdatedAt || sourceIngredient.lastImportedAt || "",
            flagged: false,
            forReview: false,
          }
        : null;

      setIngredientMasterReviewState((current) => ({
        ...current,
        ...(targetIngredient.sharedRecordId ? { [targetIngredient.sharedRecordId]: nextTargetReviewEntry } : {}),
        ...(sourceIngredient.sharedRecordId ? { [sourceIngredient.sharedRecordId]: nextSourceReviewEntry } : {}),
      }));

      if (targetIngredient.sharedRecordId && nextTargetReviewEntry) {
        persistIngredientMasterReviewStateEntry(targetIngredient.sharedRecordId, nextTargetReviewEntry);
      }
      if (sourceIngredient.sharedRecordId && nextSourceReviewEntry) {
        persistIngredientMasterReviewStateEntry(sourceIngredient.sharedRecordId, nextSourceReviewEntry);
      }
    }

    const mergedSourceCode = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(sourceIngredient));
    const keeperIngredientId = String(targetIngredient.id || "").trim();
    if (mergedSourceCode && keeperIngredientId) {
      const nextRedirectEntry = {
        targetIngredientId: keeperIngredientId,
      };
      setIngredientSourceCodeRedirectState((current) => ({
        ...current,
        [mergedSourceCode]: nextRedirectEntry,
      }));
      await persistIngredientSourceCodeRedirectEntry(mergedSourceCode, nextRedirectEntry);
    }

    if (shouldCarryTradeCategory) {
      await persistIngredientTradeCategoryForRecord(targetIngredient.id, sourceIngredient.tradeCategory || "");
    }

    if (targetIngredient.sharedRecordId && supabaseEnabled && supabase) {
      const { data } = await runSharedIngredientMutation({
        mode: "update",
        ingredient: updatedTargetIngredient,
        sharedRecordId: targetIngredient.sharedRecordId,
      });

      if (data) {
        updateIngredient(targetIngredient.id, (current) => ({
          ...current,
          name: String(data?.ingredient_name || current.name).trim(),
          code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || current.code).trim(),
          sourceCode: String(getSharedSoft1Code(data) || "").trim(),
          packSize: String(data?.pack_size || current.packSize).trim(),
          supplier: String(data?.supplier || "").trim(),
          category: String(data?.category || current.category).trim(),
          lastImportedAt: String(data?.last_updated || current.lastImportedAt).trim(),
          sharedUpdatedAt: String(data?.updated_at || data?.last_updated || current.sharedUpdatedAt || "").trim(),
          archived: Boolean(data?.is_archived),
          sharedDirty: false,
        }));
      }
    }

    if (sourceIngredient.sharedRecordId && supabaseEnabled && supabase) {
      const { data } = await runSharedIngredientMutation({
        mode: "update",
        ingredient: updatedSourceIngredient,
        sharedRecordId: sourceIngredient.sharedRecordId,
      });

      if (data) {
        updateIngredient(sourceIngredient.id, (current) => ({
          ...current,
          name: String(data?.ingredient_name || current.name).trim(),
          code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || current.code).trim(),
          sourceCode: String(getSharedSoft1Code(data) || "").trim(),
          packSize: String(data?.pack_size || current.packSize).trim(),
          supplier: String(data?.supplier || "").trim(),
          category: String(data?.category || current.category).trim(),
          lastImportedAt: String(data?.last_updated || current.lastImportedAt).trim(),
          sharedUpdatedAt: String(data?.updated_at || data?.last_updated || current.sharedUpdatedAt || "").trim(),
          archived: Boolean(data?.is_archived),
          sharedDirty: false,
          needsReviewFlag: false,
          needsSubstitutionReview: false,
          masterReviewStatus: "ready",
        }));
      }
    }

    setSelectedImportRowId("");
    setSelectedRecord({ type: "ingredient", id: targetIngredient.id });
    setActiveSection("ingredients");
    setIngredientWorkspaceView("catalogue");
    closeIngredientMerge();
  };

  const unlockIngredientEditing = (ingredientId) => {
    if (!ingredientId) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Unlock this ingredient for editing? Changes in the master list save immediately while editing is unlocked."
      );
      if (!confirmed) return;
    }
    setIngredientEditingId(ingredientId);
  };

  const lockIngredientEditing = () => {
    setIngredientEditingId("");
  };

  const updateRecipe = (recipeId, updater) => {
    setRecipes((current) =>
      current.map((recipe) =>
        recipe.id === recipeId
          ? normalizeRecipePublishedComponentLines(
              syncRecipeRelations({
                ...updater(recipe),
                sharedDirty: true,
              }),
              recordMaps.ingredient,
              recordMaps.batch
            )
          : recipe
      )
    );
  };

  const updateRecipeField = (recipeId, field, value) => {
    const numericFields = new Set(["portions", "salePrice"]);
    const nextValue = numericFields.has(field) ? Number(value || 0) : value;
    updateRecipe(recipeId, (recipe) => ({
      ...recipe,
      [field]: nextValue,
    }));
  };

  const toggleRecipeServiceSuitability = (recipeId, service) => {
    updateRecipe(recipeId, (recipe) => {
      const currentValues = recipe.serviceSuitability || [];
      const hasService = currentValues.includes(service);

      return {
        ...recipe,
        serviceSuitability: hasService
          ? currentValues.filter((item) => item !== service)
          : [...currentValues, service],
      };
    });
  };

  const updateRecipeFinishedDishImage = (recipeId, imageDataUrl) => {
    updateRecipe(recipeId, (recipe) => ({
      ...recipe,
      finishedDishImage: imageDataUrl || "",
    }));
  };

  const updateRecipeMethodStep = (recipeId, index, value) => {
    updateRecipe(recipeId, (recipe) => {
      const currentSteps = [...(recipe.methodSteps || ["", "", ""])];
      currentSteps[index] = value;
      return {
        ...recipe,
        methodSteps: currentSteps,
      };
    });
  };

  const addRecipeMethodStep = (recipeId) => {
    updateRecipe(recipeId, (recipe) => ({
      ...recipe,
      methodSteps: [...(recipe.methodSteps || []), ""],
    }));
  };

  const updateRecipeIngredientLine = (recipeId, ingredientId, field, value) => {
    const numericFields = new Set(["estimatedCost"]);
    updateRecipe(recipeId, (recipe) => ({
      ...recipe,
      ingredientLines: (recipe.ingredientLines || []).map((line) =>
        line.ingredientId === ingredientId
          ? {
              ...line,
              [field]: numericFields.has(field) ? Number(value || 0) : value,
            }
          : line
      ),
    }));
  };

  const updateRecipeBatchLine = (recipeId, batchId, field, value) => {
    const numericFields = new Set(["estimatedCost"]);
    updateRecipe(recipeId, (recipe) => ({
      ...recipe,
      batchLines: (recipe.batchLines || []).map((line) =>
        line.batchId === batchId
          ? {
              ...line,
              [field]: numericFields.has(field) ? Number(value || 0) : value,
            }
          : line
      ),
    }));
  };

  const toggleRecipeIngredientLink = (recipeId, ingredient) => {
    if (!ingredient) return;

    updateRecipe(recipeId, (recipe) => {
      const currentLines = recipe.ingredientLines || [];
      const exists = currentLines.some((line) => line.ingredientId === ingredient.id);

      return {
        ...recipe,
        ingredientLines: exists
          ? currentLines.filter((line) => line.ingredientId !== ingredient.id)
          : [
              ...currentLines,
              {
                ingredientId: ingredient.id,
                quantity: "1",
                unit: inferMeasurementUnit(ingredient.packSize),
                estimatedCost: Number(ingredient.portionCostHint || 0),
              },
            ],
      };
    });
  };

  const toggleRecipeBatchLink = (recipeId, batch) => {
    if (!batch) return;
    const batchCostSource = getBatchCostSource(batch, recordMaps.ingredient);

    updateRecipe(recipeId, (recipe) => {
      const currentLines = recipe.batchLines || [];
      const exists = currentLines.some((line) => line.batchId === batch.id);

      return {
        ...recipe,
        batchLines: exists
          ? currentLines.filter((line) => line.batchId !== batch.id)
          : [
              ...currentLines,
              {
                batchId: batch.id,
                quantity: "1",
                unit: inferMeasurementUnit(batch.yieldLabel),
                estimatedCost: Number(batchCostSource?.portionCostHint || batch.portionCostHint || 0),
              },
            ],
      };
    });
  };

  const createRecipe = () => {
    const nextRecipe = createEmptyRecipe(recipes.length);
    setRecipes((current) => [nextRecipe, ...current]);
    setSelectedImportRowId("");
    setSelectedRecord({ type: "recipe", id: nextRecipe.id });
    setActiveSection("recipes");
    setRecipeEditorStep("basics");
  };

  const markRecipeReady = (recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe) return;
    if (!isRecipeReadyToPublish(recipe)) {
      if (typeof window !== "undefined") {
        const missing = getRecipeWorkflowMissingItems(recipe);
        window.alert(`This recipe is not ready yet. Finish: ${missing.join(", ")}.`);
      }
      return;
    }
    updateRecipe(recipeId, (current) => ({
      ...current,
      status: "review",
    }));
  };

  const publishRecipeLive = (recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId);
    if (!recipe || !isRecipeReadyToPublish(recipe)) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Publish this recipe live?");
      if (!confirmed) return;
    }
    updateRecipe(recipeId, (current) => ({
      ...current,
      status: "live",
    }));
  };

  const publishReadyRecipes = () => {
    const readyRecipes = recipes.filter((recipe) => !recipe.archived && recipe.status === "review" && isRecipeReadyToPublish(recipe));
    if (!readyRecipes.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Publish ${readyRecipes.length} ready recipe${readyRecipes.length === 1 ? "" : "s"} live?`);
      if (!confirmed) return;
    }
    setRecipes((current) =>
      current.map((recipe) =>
        !recipe.archived && recipe.status === "review" && isRecipeReadyToPublish(recipe)
          ? syncRecipeRelations({
              ...recipe,
              status: "live",
            })
          : recipe
      )
    );
  };

  const moveRecipeToDraft = (recipeId) => {
    updateRecipe(recipeId, (current) => ({
      ...current,
      status: "draft",
    }));
  };

  const unpublishRecipe = (recipeId) => {
    updateRecipe(recipeId, (current) => ({
      ...current,
      status: "review",
    }));
  };

  const updateBatch = (batchId, updater) => {
    const currentBatch = batches.find((batch) => batch.id === batchId);
    if (!currentBatch) return;

    const nextBatch = syncBatchRecord({
      ...updater(currentBatch),
      sharedDirty: true,
    });

    setBatches((current) => current.map((batch) => (batch.id === batchId ? nextBatch : batch)));

    if (nextBatch.publishedIngredientId) {
      setIngredientMaster((currentIngredients) => {
        const existingPublishedIngredient =
          currentIngredients.find((ingredient) => ingredient.id === nextBatch.publishedIngredientId) || null;
        if (!existingPublishedIngredient) return currentIngredients;
        const batchCostSource = getBatchCostSource(nextBatch, recordMaps.ingredient);
        const nextPublishedIngredient = buildPublishedIngredientFromBatch(
          {
            ...nextBatch,
            ...batchCostSource,
            status: existingPublishedIngredient.status || "ready",
          },
          existingPublishedIngredient,
          currentIngredients
        );
        return currentIngredients.map((ingredient) =>
          ingredient.id === nextPublishedIngredient.id ? nextPublishedIngredient : ingredient
        );
      });
    }
  };

  const updateBatchField = (batchId, field, value) => {
    const numericFields = new Set(["yieldAmount", "unitCost", "portionCostHint"]);
    updateBatch(batchId, (batch) => ({
      ...batch,
      [field]: numericFields.has(field) ? Number(value || 0) : value,
    }));
  };

  const updateBatchMethodStep = (batchId, stepIndex, value) => {
    updateBatch(batchId, (batch) => ({
      ...batch,
      methodSteps: (batch.methodSteps || []).map((step, index) => (index === stepIndex ? value : step)),
    }));
  };

  const addBatchMethodStep = (batchId) => {
    updateBatch(batchId, (batch) => ({
      ...batch,
      methodSteps: [...(batch.methodSteps || []), ""],
    }));
  };

  const syncRecipesForIngredientStatus = (ingredientId, nextIngredientStatus, ingredientName = "") => {
    if (nextIngredientStatus !== "draft") return;

    setRecipes((current) =>
      current.map((recipe) => {
        const usesIngredient = (recipe.ingredientLines || []).some((line) => line.ingredientId === ingredientId);
        if (!usesIngredient) return recipe;

        const nextChefNotes = dedupeTextList([
          String(recipe.chefNotes || "").trim(),
          `Ingredient ${String(ingredientName || ingredientId).trim()} is in draft. This recipe has been moved back to draft for review.`,
        ]).join(" ");

        return syncRecipeRelations({
          ...recipe,
          status: "draft",
          chefNotes: nextChefNotes,
          sharedDirty: true,
        });
      })
    );
  };

  const syncPublishedIngredientStatusForBatch = (batchId, nextStatus) => {
    const batch = batches.find((item) => item.id === batchId);
    const publishedIngredientId = String(batch?.publishedIngredientId || "").trim();
    if (!publishedIngredientId) return;

    setIngredientMaster((current) =>
      current.map((ingredient) =>
        ingredient.id === publishedIngredientId
          ? {
              ...ingredient,
              status: "ready",
            }
          : ingredient
      )
    );
  };

  const movePublishedIngredientRecipesToDraft = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;

    const publishedIngredientId = String(batch.publishedIngredientId || "").trim();
    if (!publishedIngredientId) {
      if (typeof window !== "undefined") {
        window.alert("This component does not have a published ingredient yet.");
      }
      return;
    }

    const publishedIngredient = ingredientMaster.find((item) => item.id === publishedIngredientId) || null;
    const linkedRecipeIds = relationshipMaps?.ingredientRecipes?.get(publishedIngredientId) || [];
    const linkedRecipes = linkedRecipeIds
      .map((id) => recipes.find((recipe) => recipe.id === id) || null)
      .filter(Boolean);

    if (!linkedRecipes.length) {
      if (typeof window !== "undefined") {
        window.alert("No recipes are currently using this published ingredient.");
      }
      return;
    }

    const liveRecipeCount = linkedRecipes.filter((recipe) => recipe.status === "live").length;
    const ingredientName = String(publishedIngredient?.name || batch.name || publishedIngredientId).trim();
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Move ${linkedRecipes.length} recipe${linkedRecipes.length === 1 ? "" : "s"} using published ingredient "${ingredientName}" back to draft for review?${liveRecipeCount ? ` ${liveRecipeCount} live recipe${liveRecipeCount === 1 ? "" : "s"} will also be pulled back to draft.` : ""}`
          );
    if (!confirmed) return;

    setRecipes((current) =>
      current.map((recipe) => {
        if (!linkedRecipeIds.includes(recipe.id)) return recipe;

        const nextChefNotes = dedupeTextList([
          String(recipe.chefNotes || "").trim(),
          `Published ingredient ${ingredientName} is under review from component ${String(batch.name || batch.code || batch.id).trim()}. This recipe has been moved back to draft for review.`,
        ]).join(" ");

        return syncRecipeRelations({
          ...recipe,
          status: "draft",
          chefNotes: nextChefNotes,
          sharedDirty: true,
        });
      })
    );

    if (typeof window !== "undefined") {
      const recipeNames = linkedRecipes.map((recipe) => `- ${recipe.name}`).join("\n");
      window.alert(
        `Moved ${linkedRecipes.length} recipe${linkedRecipes.length === 1 ? "" : "s"} using published ingredient "${ingredientName}" back to draft:\n${recipeNames}`
      );
    }
  };

  const markBatchReady = (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;
    if (!isBatchReadyToPublish(batch, recordMaps.ingredient)) {
      if (typeof window !== "undefined") {
        const missing = getBatchWorkflowMissingItems(batch, recordMaps.ingredient);
        window.alert(`This component is not ready yet. Finish: ${missing.join(", ")}.`);
      }
      return;
    }
    updateBatch(batchId, (current) => ({
      ...current,
      status: "review",
    }));
    syncPublishedIngredientStatusForBatch(batchId, "review");
  };

  const moveBatchToDraft = (batchId) => {
    updateBatch(batchId, (current) => ({
      ...current,
      status: "draft",
    }));
    syncPublishedIngredientStatusForBatch(batchId, "draft");
  };

  const returnBatchToReady = (batchId) => {
    updateBatch(batchId, (current) => ({
      ...current,
      status: "review",
    }));
    syncPublishedIngredientStatusForBatch(batchId, "review");
  };

  const updateBatchIngredientLine = (batchId, ingredientId, field, value) => {
    const numericFields = new Set(["estimatedCost"]);
    updateBatch(batchId, (batch) => ({
      ...batch,
      ingredientLines: (batch.ingredientLines || []).map((line) =>
        line.ingredientId === ingredientId
          ? {
              ...line,
              [field]: numericFields.has(field) ? Number(value || 0) : value,
            }
          : line
      ),
    }));
  };

  const toggleBatchIngredientLink = (batchId, ingredient) => {
    if (!ingredient) return;

    updateBatch(batchId, (batch) => {
      const currentLines = batch.ingredientLines || [];
      const exists = currentLines.some((line) => line.ingredientId === ingredient.id);

      return {
        ...batch,
        ingredientLines: exists
          ? currentLines.filter((line) => line.ingredientId !== ingredient.id)
          : [
              ...currentLines,
              {
                ingredientId: ingredient.id,
                quantity: "1",
                unit: inferMeasurementUnit(ingredient.packSize),
                estimatedCost: Number(ingredient.portionCostHint || 0),
              },
            ],
      };
    });
  };

  const applyMissingSharedBatchIngredientSuggestion = (batchId, ingredient, detail = {}) => {
    if (!ingredient) return;

    updateBatch(batchId, (batch) => {
      const currentLines = batch.ingredientLines || [];
      const exists = currentLines.some((line) => line.ingredientId === ingredient.id);
      const nextLines = exists
        ? currentLines
        : [
            ...currentLines,
            {
              ingredientId: ingredient.id,
              quantity: String(detail?.quantity || "1").trim() || "1",
              unit: String(detail?.unit || "").trim() || inferMeasurementUnit(ingredient.packSize),
              estimatedCost: Number(detail?.cost || ingredient.portionCostHint || 0),
            },
          ];
      const remainingMissingDetails = [];
      let removed = false;
      (batch.sharedMissingLineDetails || []).forEach((item) => {
        if (!removed && isSameMissingSharedSourceLineDetail(item, detail)) {
          removed = true;
          return;
        }
        remainingMissingDetails.push(item);
      });

      return {
        ...batch,
        ingredientLines: nextLines,
        sharedMissingLineDetails: remainingMissingDetails,
        sharedMissingLineLabels: dedupeTextList(remainingMissingDetails.map((item) => item.label).filter(Boolean)),
        sharedMissingLineCount: remainingMissingDetails.length,
        needsReviewFlag:
          Boolean(batch.needsReviewFlag) ||
          remainingMissingDetails.length > 0 ||
          !batchHasMethod(batch),
      };
    });
  };

  const publishBatchToIngredient = async (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;
    if (!isBatchReadyToPublish(batch, recordMaps.ingredient)) {
      if (typeof window !== "undefined") {
        const missing = getBatchWorkflowMissingItems(batch, recordMaps.ingredient);
        window.alert(`This component is not ready to publish yet. Finish: ${missing.join(", ")}.`);
      }
      return;
    }
    if (batch.status !== "review" && batch.status !== "ready") return;
    if (typeof window !== "undefined" && batch.status !== "ready") {
      const confirmed = window.confirm("Publish this component to the ingredient list?");
      if (!confirmed) return;
    }

    if (supabaseEnabled && supabase) {
      const batchSaved = await syncRecipeRecordToSharedData(
        syncBatchRecord({
          ...batch,
          sharedDirty: true,
        }),
        "batch"
      );
      if (!batchSaved) {
        return;
      }
    }

    const batchCostSource = getBatchCostSource(batch, recordMaps.ingredient);

    const existingPublishedIngredient = batch.publishedIngredientId
      ? ingredientMaster.find((ingredient) => ingredient.id === batch.publishedIngredientId) || null
      : null;
    const nextIngredient = buildPublishedIngredientFromBatch(
      {
        ...batchCostSource,
        status: "ready",
      },
      existingPublishedIngredient,
      ingredientMaster
    );

    if (supabaseEnabled && supabase) {
      const { data, error } = await runSharedIngredientMutation({
        mode: existingPublishedIngredient?.sharedRecordId ? "update" : "insert",
        ingredient: nextIngredient,
        sharedRecordId: String(existingPublishedIngredient?.sharedRecordId || "").trim(),
      });

      if (error) {
        if (typeof window !== "undefined") {
          window.alert(error.message || `Could not publish "${batch.name}" to the shared ingredient list.`);
        }
        return;
      }

      nextIngredient.id = String(data?.id || nextIngredient.id);
      nextIngredient.sharedRecordId = String(data?.id || existingPublishedIngredient?.sharedRecordId || "").trim();
      nextIngredient.sharedUpdatedAt = String(data?.updated_at || data?.last_updated || "").trim();
      nextIngredient.lastImportedAt = String(data?.last_updated || nextIngredient.lastImportedAt || "").trim();
      nextIngredient.sharedDirty = false;
      nextIngredient.archived = Boolean(data?.is_archived);
      nextIngredient.code = String(
        getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || nextIngredient.code
      ).trim();
      nextIngredient.packSize = String(data?.pack_size || nextIngredient.packSize).trim();
      nextIngredient.category = String(data?.category || nextIngredient.category || "").trim();
      nextIngredient.supplier = String(data?.supplier || nextIngredient.supplier || "").trim();
      nextIngredient.purchaseVatRate = normalizeVatPercent(data?.purchase_vat_rate, nextIngredient.purchaseVatRate ?? 13);
    }

    setIngredientMaster((current) => {
      const exists = current.some((ingredient) => ingredient.id === nextIngredient.id);
      if (!exists) {
        return [nextIngredient, ...current];
      }

      return current.map((ingredient) => (ingredient.id === nextIngredient.id ? nextIngredient : ingredient));
    });

    setBatches((current) =>
      current.map((item) =>
        item.id === batchId
          ? {
              ...item,
              publishedIngredientId: nextIngredient.id,
              status: "ready",
              sharedDirty: true,
            }
          : item
      )
    );

    if (nextIngredient.id) {
      setIngredientSharedSyncState((current) => ({
        ...current,
        [nextIngredient.id]: "saved",
      }));
    }
  };

  const publishReadyBatches = () => {
    const readyBatches = batches.filter((batch) => !batch.archived && batch.status === "review" && isBatchReadyToPublish(batch, recordMaps.ingredient));
    if (!readyBatches.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Publish ${readyBatches.length} ready component${readyBatches.length === 1 ? "" : "s"} to the ingredient list?`);
      if (!confirmed) return;
    }

    readyBatches.forEach((batch) => {
      const batchCostSource = getBatchCostSource(batch, recordMaps.ingredient);
      const existingPublishedIngredient = batch.publishedIngredientId
        ? ingredientMaster.find((ingredient) => ingredient.id === batch.publishedIngredientId) || null
        : null;
      const nextIngredient = buildPublishedIngredientFromBatch(
        {
          ...batchCostSource,
          status: "ready",
        },
        existingPublishedIngredient,
        ingredientMaster
      );

      setIngredientMaster((current) => {
        const exists = current.some((ingredient) => ingredient.id === nextIngredient.id);
        if (!exists) {
          return [nextIngredient, ...current];
        }

        return current.map((ingredient) => (ingredient.id === nextIngredient.id ? nextIngredient : ingredient));
      });

      setBatches((current) =>
        current.map((item) =>
          item.id === batch.id
            ? {
                ...item,
                publishedIngredientId: nextIngredient.id,
                status: "ready",
              }
            : item
        )
      );
    });
  };

  const convertBatchToRecipeDraft = async (batchId) => {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) return;
    const linkedRecipes = recipes.filter((recipe) => (recipe.batchLines || []).some((line) => line.batchId === batchId));
    const liveLinkedRecipes = linkedRecipes.filter((recipe) => recipe.status === "live");
    const publishedIngredient = batch.publishedIngredientId
      ? ingredientMaster.find((ingredient) => ingredient.id === batch.publishedIngredientId) || null
      : null;
    const publishedIngredientRecipeLinks = publishedIngredient
      ? (relationshipMaps?.ingredientRecipes?.get(publishedIngredient.id) || [])
          .map((id) => recipes.find((recipe) => recipe.id === id) || null)
          .filter(Boolean)
      : [];
    const publishedIngredientBatchLinks = publishedIngredient
      ? batches.filter(
          (item) =>
            item.id !== batchId &&
            (item.ingredientLines || []).some((line) => line.ingredientId === publishedIngredient.id)
        )
      : [];
    const canDeletePublishedIngredient =
      Boolean(publishedIngredient) &&
      !publishedIngredientRecipeLinks.length &&
      !publishedIngredientBatchLinks.length;

    const existingRecipe =
      batch.convertedRecipeId
        ? recipes.find((recipe) => recipe.id === batch.convertedRecipeId) || null
        : null;

    if (existingRecipe) {
      setSelectedImportRowId("");
      setSelectedRecord({ type: "recipe", id: existingRecipe.id });
      setActiveSection("recipes");
      setRecipeEditorStep("basics");
      return;
    }

    if (typeof window !== "undefined") {
      const linkedRecipeSummary = linkedRecipes.length
        ? [
            "",
            `This component is still linked to ${linkedRecipes.length} recipe${linkedRecipes.length === 1 ? "" : "s"}:`,
            ...linkedRecipes.slice(0, 8).map((recipe) => `- ${recipe.name}`),
            linkedRecipes.length > 8 ? `- and ${linkedRecipes.length - 8} more` : "",
            "",
            "Those recipes will not be deleted automatically.",
            "Their component link will be removed, so you can decide whether they should be rebuilt or deleted afterwards.",
            liveLinkedRecipes.length
              ? `Any live recipes in that list will be moved back to Draft automatically for review (${liveLinkedRecipes.length} affected).`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "";
      const confirmationMessage = [
        `Create a draft recipe from "${batch.name}" and delete the component version?`,
        "",
        "This will:",
        "- save a new draft recipe using the current component ingredients and method",
        "- remove this component from the component library",
        "- remove this component from any parent recipes that still reference it",
        publishedIngredient
          ? canDeletePublishedIngredient
            ? `- delete the incorrect published ingredient "${publishedIngredient.name}" at the same time`
            : `- leave the published ingredient "${publishedIngredient.name}" in place because it is still linked elsewhere`
          : "",
        "",
        publishedIngredient && !canDeletePublishedIngredient && publishedIngredientRecipeLinks.length
          ? `The published ingredient is still linked to ${publishedIngredientRecipeLinks.length} recipe${publishedIngredientRecipeLinks.length === 1 ? "" : "s"}.`
          : "",
        publishedIngredient && !canDeletePublishedIngredient && publishedIngredientBatchLinks.length
          ? `The published ingredient is still used in ${publishedIngredientBatchLinks.length} other component${publishedIngredientBatchLinks.length === 1 ? "" : "s"}.`
          : "",
        linkedRecipeSummary,
      ].join("\n");
      const confirmed = window.confirm(confirmationMessage);
      if (!confirmed) return;
    }

    const nextRecipe = createRecipeDraftFromBatch(batch, recipes.length);
    setRecipes((current) => [nextRecipe, ...current]);
    const recipeSaved = await syncRecipeRecordToSharedData(nextRecipe, "dish");
    if (!recipeSaved) {
      if (typeof window !== "undefined") {
        window.alert(`Could not save the draft recipe for "${batch.name}". The component has been left in place.`);
      }
      return;
    }

    setPendingBatchDeletionIds((current) => (current.includes(batchId) ? current : [...current, batchId]));
    setBatches((current) => current.filter((item) => item.id !== batchId));
    if (publishedIngredient && canDeletePublishedIngredient) {
      if (publishedIngredient.sharedRecordId) {
        setPendingIngredientDeletionIds((current) =>
          current.includes(publishedIngredient.sharedRecordId)
            ? current
            : [...current, publishedIngredient.sharedRecordId]
        );
      }
      setIngredientMaster((current) => current.filter((item) => item.id !== publishedIngredient.id));
    }
    setRecipes((current) =>
      current.map((recipe) =>
        linkedRecipes.some((linkedRecipe) => linkedRecipe.id === recipe.id)
          ? syncRecipeRelations({
              ...recipe,
              batchLines: (recipe.batchLines || []).filter((line) => line.batchId !== batchId),
              status: recipe.status === "live" ? "draft" : recipe.status,
              chefNotes:
                recipe.status === "live" && !String(recipe.chefNotes || "").includes(`Converted component ${String(batch.code || batch.id || "").trim()}`)
                  ? dedupeTextList([
                      String(recipe.chefNotes || "").trim(),
                      `Converted component ${String(batch.code || batch.id || "").trim()} removed. This recipe has been moved back to draft for review.`,
                    ]).join(" ")
                  : recipe.chefNotes,
              sharedDirty: recipe.status === "live" ? true : recipe.sharedDirty,
            })
          : recipe
      )
    );
    setIngredientMaster((current) =>
      current.map((ingredient) =>
        ingredient.batchId === batchId
          ? {
              ...ingredient,
              batchId: "",
            }
          : ingredient
      )
    );

    setSelectedImportRowId("");
    setSelectedRecord({ type: "recipe", id: nextRecipe.id });
    setActiveSection("recipes");
    setRecipeEditorStep("basics");

    if (typeof window !== "undefined") {
      const linkedRecipeMessage = linkedRecipes.length
        ? `\n\nReview these recipes next:\n${linkedRecipes
            .slice(0, 8)
            .map((recipe) => `- ${recipe.name}`)
            .join("\n")}${linkedRecipes.length > 8 ? `\n- and ${linkedRecipes.length - 8} more` : ""}`
        : "";
      const liveRecipeMessage = liveLinkedRecipes.length
        ? `\n\nMoved back to draft automatically:\n${liveLinkedRecipes
            .slice(0, 8)
            .map((recipe) => `- ${recipe.name}`)
            .join("\n")}${liveLinkedRecipes.length > 8 ? `\n- and ${liveLinkedRecipes.length - 8} more` : ""}`
        : "";
      const publishedIngredientMessage = publishedIngredient
        ? canDeletePublishedIngredient
          ? `\n\nDeleted incorrect published ingredient:\n- ${publishedIngredient.name}`
          : `\n\nPublished ingredient kept for manual review:\n- ${publishedIngredient.name}`
        : "";
      window.alert(
        `Saved draft recipe "${nextRecipe.name}" and queued "${batch.name}" for deletion from components.${publishedIngredientMessage}${linkedRecipeMessage}${liveRecipeMessage}`
      );
    }
  };

  const createBatch = () => {
    const nextBatch = createEmptyBatch(batches.length);
    setBatches((current) => [nextBatch, ...current]);
    setSelectedImportRowId("");
    setSelectedRecord({ type: "batch", id: nextBatch.id });
    setActiveSection("batches");
    setBatchEditorStep("basics");
  };

  const moveIngredientToBatchDraft = (ingredientId) => {
    const ingredient = ingredientMaster.find((item) => item.id === ingredientId);
    if (!ingredient) return;

    const existingBatch =
      (ingredient.batchId && batches.find((item) => item.id === ingredient.batchId)) ||
      batches.find((item) => item.publishedIngredientId === ingredient.id) ||
      null;

    if (existingBatch && typeof window !== "undefined") {
      const confirmed = window.confirm(
        `This ingredient is already derived from the component "${existingBatch.name}".\n\nOpening or reusing it as a component draft can create a component-on-component loop.\n\nAre you sure you want to continue?`
      );
      if (!confirmed) return;
    }

    if (existingBatch) {
      setSelectedImportRowId("");
      setSelectedRecord({ type: "batch", id: existingBatch.id });
      setActiveSection("batches");
      setBatchEditorStep("basics");
      return;
    }

    const nextBatch = createBatchDraftFromIngredient(ingredient, batches.length);

    setBatches((current) => [nextBatch, ...current]);
    setIngredientMaster((current) =>
      current.map((item) =>
        item.id === ingredientId
          ? {
              ...item,
              batchId: nextBatch.id,
            }
          : item
      )
    );
    setSelectedImportRowId("");
    setSelectedRecord({ type: "batch", id: nextBatch.id });
    setActiveSection("batches");
    setBatchEditorStep("basics");
  };

  const openMenuMaker = (restaurantId, initialService = "") => {
    const restaurant = restaurants.find((item) => item.id === restaurantId);
    if (!restaurant) return;
    setMenuMakerModal({
      isOpen: true,
      restaurantId,
      draft: createEmptyMenuDraft(restaurant, menus, initialService),
    });
  };

  const closeMenuMaker = () => {
    setMenuMakerModal({
      isOpen: false,
      restaurantId: "",
      draft: null,
    });
  };

  const updateMenuMakerField = (field, value) => {
    setMenuMakerModal((current) => {
      if (!current.draft) return current;
      const previousDefaultName = buildDefaultMenuName(current.draft.restaurant, current.draft.service);
      const nextDraft = {
        ...current.draft,
        [field]: value,
      };

      if (field === "service") {
        const nextDefaultName = buildDefaultMenuName(nextDraft.restaurant, value);
        if (!String(current.draft.name || "").trim() || current.draft.name === previousDefaultName) {
          nextDraft.name = nextDefaultName;
        }
      }

      return {
        ...current,
        draft: nextDraft,
      };
    });
  };

  const saveMenuMaker = () => {
    const nextMenu = menuMakerModal.draft ? syncMenuRecord(menuMakerModal.draft) : null;
    if (!nextMenu) return;

    setMenus((current) => [nextMenu, ...current]);
    setSelectedImportRowId("");
    setSelectedRecord({ type: "menu", id: nextMenu.id });
    setActiveSection("menus");
    setMenuEditorStep("build");
    closeMenuMaker();
  };

  const updateMenu = (menuId, updater) => {
    setMenus((current) =>
      current.map((menu) =>
        menu.id === menuId
          ? syncMenuRecord({
              ...updater(menu),
              sharedDirty: true,
            })
          : menu
      )
    );
  };

  const updateMenuField = (menuId, field, value) => {
    updateMenu(menuId, (menu) => ({
      ...menu,
      [field]: value,
    }));
  };

  const approveMenu = (menuId) => {
    updateMenuField(menuId, "status", "review");
    setMenuEditorStep("preview");
    openMenuPreview(menuId);
  };

  const publishMenuLive = (menuId) => {
    updateMenuField(menuId, "status", "live");
    setMenuEditorStep("preview");
  };

  const returnMenuToDraft = (menuId) => {
    updateMenuField(menuId, "status", "draft");
    setMenuEditorStep("build");
  };

  const addMenuItem = (menuId) => {
    updateMenu(menuId, (menu) => ({
      ...menu,
      items: [
        ...(menu.items || []),
        {
          id: createClientUuid(),
          recipeId: "",
          dishName: "",
          description: "",
        },
      ],
    }));
  };

  const updateMenuItemField = (menuId, itemId, field, value) => {
    updateMenu(menuId, (menu) => ({
      ...menu,
      items: (menu.items || []).map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: value,
            }
          : item
      ),
    }));
  };

  const selectMenuItemRecipe = (menuId, itemId, recipeId) => {
    const recipe = recipes.find((item) => item.id === recipeId) || null;
    updateMenu(menuId, (menu) => ({
      ...menu,
      items: (menu.items || []).map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipeId,
              dishName: item.dishName || suggestMenuDishName(recipe),
              description: item.description || suggestMenuDescription(recipe, recordMaps.ingredient, recordMaps.batch),
            }
          : item
      ),
    }));
  };

  const createDraftRecipeForMenuItem = (menuId, itemId) => {
    const menu = menus.find((entry) => entry.id === menuId);
    const menuItem = menu?.items?.find((entry) => entry.id === itemId) || null;
    const seededName = String(menuItem?.dishName || "").trim();
    const nextRecipe = {
      ...createEmptyRecipe(recipes.length),
      name: seededName || "New dish",
      menuDescription: String(menuItem?.description || "").trim(),
      status: "draft",
    };

    setRecipes((current) => [syncRecipeRelations(nextRecipe), ...current]);
    selectMenuItemRecipe(menuId, itemId, nextRecipe.id);
  };

  const removeMenuItem = (menuId, itemId) => {
    updateMenu(menuId, (menu) => ({
      ...menu,
      items: (menu.items || []).filter((item) => item.id !== itemId),
    }));
  };

  const addUser = (draft) => {
    const nextUser = {
      id: `usr-${Date.now()}`,
      name: String(draft?.name || "").trim(),
      email: String(draft?.email || "").trim(),
      role: String(draft?.role || "Chef").trim() || "Chef",
      status: String(draft?.status || "active").trim() || "active",
      isSharedProfile: false,
    };
    if (!(nextUser.name && nextUser.email)) return false;
    setUsers((current) => [nextUser, ...current]);
    return true;
  };

  const persistSharedUserRole = async (userId, nextRole) => {
    const previousUser = users.find((user) => user.id === userId) || null;
    if (!previousUser?.isSharedProfile) {
      setUserSyncState("error");
      setUserSyncMessage(
        "This user is local-only, not a real shared login. Create them in Supabase Authentication first before assigning real edit rights."
      );
      return false;
    }
    if (!supabaseEnabled || !supabase) {
      setUserSyncState("idle");
      setUserSyncMessage("User roles are only saved locally while shared data is disabled.");
      return false;
    }
    if (currentUserRole !== "Admin") {
      setUserSyncState("error");
      setUserSyncMessage("Only Admin users can change shared user rights.");
      return false;
    }

    setUserSyncState("syncing");
    setUserSyncMessage("Saving user role...");

    const { data, error } = await supabase
      .from("profiles")
      .update({
        role: mapV2RoleToProfileRole(nextRole),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id,email,full_name,role")
      .single();

    if (error) {
      setUserSyncState("error");
      setUserSyncMessage(error.message || "Could not save the user role.");
      return false;
    }

    const mappedUser = {
      id: String(data?.id || userId),
      name: String(data?.full_name || previousUser?.name || data?.email || "User").trim(),
      email: String(data?.email || "").trim(),
      role: mapProfileRoleToV2(data?.role),
      status: "active",
      isSharedProfile: true,
    };

    setUsers((current) =>
      current.map((user) => (user.id === mappedUser.id ? { ...user, ...mappedUser } : user))
    );

    if (String(authUser?.id || "").trim() === mappedUser.id) {
      setAuthProfile((current) => ({
        ...(current || {}),
        id: mappedUser.id,
        email: mappedUser.email,
        full_name: mappedUser.name,
        role: mapV2RoleToProfileRole(mappedUser.role),
        profileError: "",
      }));
    }

    setUserSyncState("saved");
    setUserSyncMessage(`Saved ${mappedUser.name || mappedUser.email || "user"} as ${mappedUser.role}.`);
    return true;
  };

  const updateUser = async (userId, field, value) => {
    const previousUser = users.find((user) => user.id === userId) || null;
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              [field]: value,
            }
          : user
      )
    );

    if (field !== "role") return true;

    const didPersist = await persistSharedUserRole(userId, value);
    if (!didPersist && previousUser) {
      setUsers((current) =>
        current.map((user) =>
          user.id === userId
            ? {
                ...user,
                role: previousUser.role,
              }
            : user
        )
      );
    }
    return didPersist;
  };

  const toggleUserStatus = (userId) => {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              status: user.status === "active" ? "inactive" : "active",
            }
          : user
      )
    );
  };

  const refreshImportRowsWithLearningRules = (nextRules) => {
    setIngredientImportRows((current) =>
      current.map((row) => {
        const { nameIndex: nextNameIndex, appliedRules } = parseIngredientIndexWithLearning(
          row.rawName,
          row.packSize,
          nextRules,
          row.sourceCode
        );
        const nextSuggestedName = composeCleanIngredientName(nextNameIndex, row.rawName);
        return {
          ...row,
          nameIndex: nextNameIndex,
          suggestedName: nextSuggestedName,
          appliedLearningRules: appliedRules,
          chosenName: row.useSuggestedName ? nextSuggestedName : row.chosenName,
        };
      })
    );
  };

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;

    let cancelled = false;

    const loadSharedLearningRules = async () => {
      setLearningRulesSyncState("syncing");
      setLearningRulesSyncMessage("Loading shared naming rules...");

      const { data, error } = await supabase
        .from("ingredient_naming_rules")
        .select("*")
        .neq("rule_field", INGREDIENT_REVIEW_STATE_RULE_FIELD)
        .neq("rule_field", INGREDIENT_SUBSTITUTION_STATE_RULE_FIELD)
        .neq("rule_field", INGREDIENT_TRADE_CATEGORY_RULE_FIELD)
        .neq("rule_field", INGREDIENT_SOURCE_CODE_REDIRECT_RULE_FIELD)
        .neq("rule_field", IGNORED_IMPORT_ROW_RULE_FIELD)
        .neq("rule_field", RECIPE_REVIEW_FLAG_RULE_FIELD)
        .neq("rule_field", BATCH_REVIEW_FLAG_RULE_FIELD)
        .order("rule_field")
        .order("trigger_text");

      if (cancelled) return;

      if (error) {
        setLearningRulesSyncState("error");
        setLearningRulesSyncMessage("Using local naming rules for now. Shared rules table is not ready yet.");
        setSharedLearningRulesReady(true);
        return;
      }

      const sharedRules = mergeLearningRules(data || []);
      const mergedRules = mergeLearningRules(initialLearningRules, loadStoredLearningRules(), sharedRules);
      const sharedSignature = serializeLearningRules(sharedRules);

      setLearningRules(mergedRules);
      refreshImportRowsWithLearningRules(mergedRules);
      setLastSharedLearningRuleSignature(sharedSignature);
      setLastSharedLearningRuleIds(sharedRules.map((rule) => rule.id));
      setLearningRulesSyncState("shared");
      setLearningRulesSyncMessage(
        sharedRules.length
          ? `Loaded ${sharedRules.length} naming rule${sharedRules.length === 1 ? "" : "s"} from shared data.`
          : "Connected to shared naming rules. No shared rules saved yet."
      );
      setSharedLearningRulesReady(true);
    };

    loadSharedLearningRules();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) return undefined;
    if (!sharedLearningRulesReady) return undefined;

    const currentSignature = serializeLearningRules(learningRules);
    if (!currentSignature || currentSignature === lastSharedLearningRuleSignature) {
      return undefined;
    }

    let cancelled = false;

    const syncSharedLearningRules = async () => {
      setLearningRulesSyncState("syncing");
      setLearningRulesSyncMessage("Saving naming rules to shared data...");

      const removedIds = lastSharedLearningRuleIds.filter(
        (ruleId) => !learningRules.some((rule) => rule.id === ruleId)
      );
      const payload = learningRules.map((rule) => ({
        id: rule.id,
        rule_field: rule.field,
        rule_label: rule.label,
        trigger_text: rule.trigger,
        rule_value: rule.value,
      }));

      if (removedIds.length) {
      const { error: deleteError } = await supabase
        .from("ingredient_naming_rules")
        .delete()
        .in("id", removedIds);

        if (cancelled) return;

        if (deleteError) {
          setLearningRulesSyncState("error");
          setLearningRulesSyncMessage(
            `Saved naming rules locally, but could not remove old shared rules. ${deleteError.message || ""}`.trim()
          );
          return;
        }
      }

      const { error } = await supabase
        .from("ingredient_naming_rules")
        .upsert(payload, { onConflict: "id" });

      if (cancelled) return;

      if (error) {
        setLearningRulesSyncState("error");
        setLearningRulesSyncMessage(
          `Saved naming rules locally, but could not sync them to shared data. ${error.message || ""}`.trim()
        );
        return;
      }

      setLastSharedLearningRuleSignature(currentSignature);
      setLastSharedLearningRuleIds(learningRules.map((rule) => rule.id));
      setLearningRulesSyncState("shared");
      setLearningRulesSyncMessage(
        `Saved ${learningRules.length} naming rule${learningRules.length === 1 ? "" : "s"} to shared data.`
      );
    };

    syncSharedLearningRules();

    return () => {
      cancelled = true;
    };
  }, [lastSharedLearningRuleIds, lastSharedLearningRuleSignature, learningRules, sharedLearningRulesReady]);

  const setImportRowStrategy = (rowId, strategy) => {
    updateImportRow(rowId, (row) => {
      const sourceCodeConflictIngredient =
        String(row.sourceCode || "").trim()
          ? getIngredientSourceCodeConflict(
              ingredientMaster,
              row.sourceCode,
              row.reconcileMode ? row.existingIngredientId || "" : row.targetId || ""
            )
          : null;
      const nextStrategy =
        strategy === "create" && sourceCodeConflictIngredient && !row.reconcileMode ? "merge" : strategy;
      const existingSelf = ingredientMaster.find((item) => item.id === row.existingIngredientId) || null;
      const currentExternalTargetId =
        row.targetId && row.targetId !== row.existingIngredientId ? row.targetId : "";
      const nextTargetId =
        nextStrategy === "create"
          ? ""
          : nextStrategy === "update"
            ? existingSelf?.id || row.existingIngredientId || ""
            : currentExternalTargetId || sourceCodeConflictIngredient?.id || row.suggestedTargetId || "";
      const nextTargetName =
        nextStrategy === "create"
          ? ""
          : nextStrategy === "update"
            ? existingSelf?.name || row.rawName
            : currentExternalTargetId
              ? row.targetName
              : sourceCodeConflictIngredient?.name || row.suggestedTargetName || "";

      return {
        ...row,
        strategy: nextStrategy,
        targetId: nextTargetId,
        targetName: nextTargetName,
        reviewStatus: row.published ? row.reviewStatus : "review",
        decisionNote:
          nextStrategy === "merge"
            ? nextTargetId
              ? sourceCodeConflictIngredient && nextTargetId === sourceCodeConflictIngredient.id
                ? "Soft1 code is already owned in master, so this row will merge into that ingredient."
                : "Will merge into the chosen clean ingredient"
              : "Choose an existing clean ingredient"
            : nextStrategy === "update"
              ? "Will update this existing ingredient in place."
              : row.needsCodeReview
                ? "Create a new clean ingredient after assigning a variation code"
                : "Create a new clean ingredient, then mark this row ready when you’re happy.",
      };
    });
  };

  const assignImportTarget = (rowId, targetId) => {
    const target = ingredientMaster.find((item) => item.id === targetId) || null;
    updateImportRow(rowId, (row) => ({
      ...row,
      strategy: target ? "merge" : "create",
      targetId: target?.id || "",
      targetName: target?.name || "",
      chosenName: target?.name || row.chosenName,
      internalCode: target?.code || row.internalCode,
      reviewStatus: row.published ? row.reviewStatus : "review",
      decisionNote: target ? "Manually mapped to an existing clean ingredient" : row.decisionNote,
    }));
  };

  const updateImportField = (rowId, field, value) => {
    const numericFields = new Set(["averagePrice"]);
    updateImportRow(rowId, (row) => {
      const nextValue = numericFields.has(field) ? numberValue(value, 0) : value;
      const nextRow = {
        ...row,
        [field]: nextValue,
        useSuggestedName: field === "chosenName" ? false : row.useSuggestedName,
        reviewStatus: row.published ? row.reviewStatus : "review",
      };

      if (field === "productCategory") {
        const normalizedProductCategory = titleCaseCategory(nextValue);
        nextRow.productCategory = normalizedProductCategory;
        nextRow.category =
          normalizedProductCategory ||
          titleCaseCategory(nextRow.tradeCategory || "") ||
          getSoft1CodeCategorySuggestion(nextRow.sourceCode) ||
          "";
      } else if (field === "tradeCategory") {
        nextRow.tradeCategory = String(nextValue || "").trim();
        if (!String(nextRow.productCategory || "").trim()) {
          nextRow.category =
            titleCaseCategory(nextRow.tradeCategory) ||
            getSoft1CodeCategorySuggestion(nextRow.sourceCode) ||
            "";
        }
      } else if (field === "sourceCode") {
        if (!String(nextRow.productCategory || "").trim() && isWeakIngredientCategory(nextRow.category)) {
          nextRow.category = getSoft1CodeCategorySuggestion(nextValue) || "";
        }
      }

      return nextRow;
    });
  };

  const updateImportIndexPart = (rowId, field, value) => {
    updateImportRow(rowId, (row) => {
      const nextIndex = {
        ...row.nameIndex,
        [field]: value,
      };
      const nextSuggestedName = composeCleanIngredientName(nextIndex, row.rawName);
      const nextChosenName = row.useSuggestedName ? nextSuggestedName : row.chosenName;

      return {
        ...row,
        nameIndex: nextIndex,
        suggestedName: nextSuggestedName,
        chosenName: nextChosenName,
      };
    });
  };

  const useSuggestedName = (rowId) => {
    updateImportRow(rowId, (row) => ({
      ...row,
      chosenName: row.suggestedName,
      useSuggestedName: true,
      decisionNote: "Using the indexed clean-name suggestion for this row.",
    }));
  };

  const saveLearningRulesFromRow = (rowId) => {
    const row = ingredientImportRows.find((item) => item.id === rowId);
    if (!row) return;

    const candidates = getLearningRuleCandidates(row, learningRules);
    if (!candidates.length) {
      updateImportRow(rowId, (current) => ({
        ...current,
        decisionNote: "No reusable learning rules were detected from this edit.",
      }));
      return;
    }

    const nextRules = mergeLearningRules(
      learningRules,
      candidates.map((candidate) => ({
        id: createLearningRuleId(candidate.field, candidate.trigger),
        field: candidate.field,
        label: candidate.label,
        trigger: candidate.trigger,
        value: candidate.value,
      }))
    );

    setLearningRules(nextRules);
    refreshImportRowsWithLearningRules(nextRules);
    updateImportRow(rowId, (current) => ({
      ...current,
      decisionNote: `Saved ${candidates.length} future rule${candidates.length === 1 ? "" : "s"} from this edit.`,
    }));
  };

  const applyRowFieldsToSimilar = (rowId) => {
    const sourceRow = ingredientImportRows.find((item) => item.id === rowId);
    if (!sourceRow) return;

    const transferableFields = ["brand", "product", "cut", "quality", "dietary", "state", "origin", "style"];
    const sourceProduct = normalizeIngredientKey(sourceRow.nameIndex.product);
    const sourceTradeCategory = normalizeIngredientKey(
      sourceRow.productCategory || sourceRow.tradeCategory || sourceRow.category || ""
    );
    const sourceSignals = [
      sourceRow.nameIndex.brand,
      sourceRow.nameIndex.dietary,
      sourceRow.nameIndex.origin,
      sourceRow.nameIndex.state,
    ]
      .map((value) => normalizeIngredientKey(value))
      .filter(Boolean);

    const rowMatchesSimilarStructure = (row) => {
      if (row.id === rowId || row.published) return false;

      const rowProduct = normalizeIngredientKey(row.nameIndex.product);
      const rowTradeCategory = normalizeIngredientKey(row.productCategory || row.tradeCategory || row.category || "");
      const rawKey = normalizeIngredientKey(row.rawName);
      const matchedSignals = sourceSignals.filter((signal) => rawKey.includes(signal)).length;
      const productMatches = Boolean(sourceProduct && rowProduct && rowProduct === sourceProduct);
      const categoryMatches = Boolean(sourceTradeCategory && rowTradeCategory && rowTradeCategory === sourceTradeCategory);

      if (productMatches && (matchedSignals >= 1 || categoryMatches)) return true;
      if (!sourceProduct && categoryMatches && matchedSignals >= 2) return true;
      return false;
    };

    const candidateCount = ingredientImportRows.filter(rowMatchesSimilarStructure).length;

    if (!candidateCount) {
      if (typeof window !== "undefined") {
        window.alert("No strongly similar rows were found for this apply action.");
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Apply this indexed structure to ${candidateCount} similar row${candidateCount === 1 ? "" : "s"}?\n\nOnly rows with a strong product/category-style match will be updated.`
      );
      if (!confirmed) return;
    }

    setIngredientImportRows((current) =>
      current.map((row) => {
        if (!rowMatchesSimilarStructure(row)) return row;

        const nextNameIndex = { ...row.nameIndex };
        transferableFields.forEach((field) => {
          if (sourceRow.nameIndex[field]) {
            nextNameIndex[field] = sourceRow.nameIndex[field];
          }
        });

        const nextSuggestedName = composeCleanIngredientName(nextNameIndex, row.rawName);
        const nextConfidenceScore = scoreIngredientIndexConfidence(nextNameIndex, row.rawName);

        return {
          ...row,
          nameIndex: nextNameIndex,
          suggestedName: nextSuggestedName,
          chosenName: row.useSuggestedName ? nextSuggestedName : row.chosenName,
          confidenceScore: nextConfidenceScore,
          confidenceLabel: getConfidenceLabel(nextConfidenceScore),
          confidenceBreakdown: explainIngredientIndexConfidence(nextNameIndex, row.rawName),
          decisionNote: `Applied similar field structure from ${sourceRow.rawName} after strong-match review.`,
        };
      })
    );

    updateImportRow(rowId, (current) => ({
      ...current,
      decisionNote: `Applied this row's indexed structure to ${candidateCount} strongly similar row${candidateCount === 1 ? "" : "s"} in the review set.`,
    }));
  };

  const discardImportRows = (rowIds = []) => {
    if (!rowIds.length) return;
    const idSet = new Set(rowIds);
    setIngredientImportRows((current) => current.filter((row) => !idSet.has(row.id)));
    if (selectedImportRowId && idSet.has(selectedImportRowId)) {
      setSelectedImportRowId("");
    }
  };

  const discardImportRow = (rowId) => {
    const row = ingredientImportRows.find((item) => item.id === rowId);
    if (!row) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Discard "${row.rawName}" from this import review?\n\nThis only removes the raw import row from the review queue. It does not archive or delete any clean ingredient in the master list.`
      );
      if (!confirmed) return;
    }
    discardImportRows([rowId]);
  };

  const discardImportGroup = (sourceCode) => {
    const groupRows = ingredientImportRows.filter((row) => row.sourceCode === sourceCode && !row.published);
    if (!groupRows.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Discard ${groupRows.length} import row${groupRows.length === 1 ? "" : "s"} for source code ${sourceCode}?\n\nThis only clears these raw import rows from the review queue.`
      );
      if (!confirmed) return;
    }
    discardImportRows(groupRows.map((row) => row.id));
  };

  const markImportRowsResolved = (rows = []) => {
    const nextEntries = (rows || []).reduce((map, row) => {
      const resolveKey = buildIgnoredImportRowKey(row?.sourceCode, row?.rawName);
      if (!resolveKey) return map;
      map[resolveKey] = {
        flagged: true,
      };
      return map;
    }, {});
    if (!Object.keys(nextEntries).length) return;
    setResolvedImportRows((current) => ({
      ...current,
      ...nextEntries,
    }));
  };

  const clearResolvedImportRows = (rows = []) => {
    const keysToClear = dedupeTextList(
      (rows || []).map((row) => buildIgnoredImportRowKey(row?.sourceCode, row?.rawName)).filter(Boolean)
    );
    if (!keysToClear.length) return {};
    const keySet = new Set(keysToClear);
    const nextResolvedImportRows = { ...resolvedImportRows };
    keysToClear.forEach((key) => {
      delete nextResolvedImportRows[key];
    });
    setResolvedImportRows(nextResolvedImportRows);
    return nextResolvedImportRows;
  };

  const repairImportCoverageIssue = async (issue = {}) => {
    const row = issue?.row || null;
    if (!row) return false;

    const liveTarget = findLiveImportCoverageTarget(row, ingredientMaster, ingredientSourceCodeRedirectState);
    if (!liveTarget) {
      if (issue?.ingredient?.id) {
        setIngredientWorkspaceView("catalogue");
        setSelectedImportRowId("");
        setSelectedRecord({ type: "ingredient", id: issue.ingredient.id });
        return true;
      }
      const nextResolvedImportRows = clearResolvedImportRows([row]);
      const nextQueueRows = rebuildIngredientImportQueue(
        soft1SourceRows,
        ingredientMaster,
        learningRules,
        ignoredImportRows,
        nextResolvedImportRows,
        ingredientSourceCodeRedirectState
      );
      setIngredientImportRows(nextQueueRows);
      setIngredientWorkspaceView("review");
      setSelectedImportRowId(row.id || nextQueueRows[0]?.id || "");
      setSelectedRecord({ type: "", id: "" });
      return true;
    }

    let updatedIngredient = sanitizeIngredientDraft(
      {
        ...liveTarget,
        aliases: dedupeTextList([
          ...(liveTarget.aliases || []),
          row.rawName,
          row.suggestedName && normalizeIngredientKey(row.suggestedName) !== normalizeIngredientKey(liveTarget.name)
            ? row.suggestedName
            : "",
        ]),
        unitCost: Number(row.averagePrice || 0) > 0 ? Number(row.averagePrice) : liveTarget.unitCost,
        lastImportedAt: String(row.importedAt || liveTarget.lastImportedAt || getTodayImportDate()).trim(),
        sourceRecordLabel: String(row.sourceRecordLabel || liveTarget.sourceRecordLabel || "Soft1 import").trim(),
        lastImportPriceMissing: !(Number(row.averagePrice || 0) > 0),
        needsReviewFlag: false,
        masterReviewStatus: "ready",
        sharedDirty: Boolean(liveTarget.sharedRecordId),
      },
      ingredientMaster.length
    );

    const nextReviewState = { ...ingredientMasterReviewState };

    if (updatedIngredient.sharedRecordId && supabaseEnabled && supabase) {
      const { data, error } = await runSharedIngredientMutation({
        mode: "update",
        ingredient: updatedIngredient,
        sharedRecordId: updatedIngredient.sharedRecordId,
      });

      if (error) {
        if (typeof window !== "undefined") {
          window.alert(error.message || `Could not repair coverage for ${row.rawName || row.sourceCode}.`);
        }
        return false;
      }

      updatedIngredient = {
        ...updatedIngredient,
        name: String(data?.ingredient_name || updatedIngredient.name).trim(),
        code: String(
          getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || updatedIngredient.code
        ).trim(),
        sourceCode: String(getSharedSoft1Code(data) || "").trim(),
        packSize: String(data?.pack_size || updatedIngredient.packSize).trim(),
        supplier: String(data?.supplier || "").trim(),
        category: String(data?.category || updatedIngredient.category || "").trim(),
        purchaseVatRate: normalizeVatPercent(data?.purchase_vat_rate, updatedIngredient.purchaseVatRate ?? 13),
        lastImportedAt: String(data?.last_updated || updatedIngredient.lastImportedAt).trim(),
        sharedUpdatedAt: String(data?.updated_at || data?.last_updated || updatedIngredient.sharedUpdatedAt || "").trim(),
        archived: Boolean(data?.is_archived),
        sharedDirty: false,
      };
    }

    if (updatedIngredient.sharedRecordId) {
      const existingReviewEntry = ingredientMasterReviewState[updatedIngredient.sharedRecordId] || {};
      const nextReviewEntry = withIngredientReviewNamingContext(
        {
          status: "ready",
          sharedUpdatedAt: updatedIngredient.sharedUpdatedAt || updatedIngredient.lastImportedAt || "",
          flagged: Boolean(existingReviewEntry.flagged || updatedIngredient.needsSubstitutionReview),
          forReview: false,
          ruleCatchupSignature: String(existingReviewEntry.ruleCatchupSignature || "").trim(),
        },
        updatedIngredient,
        soft1SourceRows,
        existingReviewEntry
      );
      nextReviewState[updatedIngredient.sharedRecordId] = nextReviewEntry;
      await persistIngredientMasterReviewStateEntry(updatedIngredient.sharedRecordId, nextReviewEntry);
    }

    const nextIngredientMaster = ingredientMaster.map((ingredient) =>
      ingredient.id === liveTarget.id ? updatedIngredient : ingredient
    );
    const nextResolvedImportRows = {
      ...resolvedImportRows,
      [buildIgnoredImportRowKey(row?.sourceCode, row?.rawName)]: {
        flagged: true,
      },
    };
    const nextQueueRows = rebuildIngredientImportQueue(
      soft1SourceRows,
      nextIngredientMaster,
      learningRules,
      ignoredImportRows,
      nextResolvedImportRows,
      ingredientSourceCodeRedirectState
    );

    setIngredientMaster(nextIngredientMaster);
    setIngredientMasterReviewState(nextReviewState);
    setResolvedImportRows(nextResolvedImportRows);
    setIngredientImportRows(nextQueueRows);
    setIngredientWorkspaceView("catalogue");
    setSelectedImportRowId("");
    setSelectedRecord({ type: "ingredient", id: updatedIngredient.id });
    return true;
  };

  const ignoreImportRowPermanently = async (rowId) => {
    const row = ingredientImportRows.find((item) => item.id === rowId);
    if (!row) return;

    const ignoreKey = buildIgnoredImportRowKey(row.sourceCode, row.rawName);
    if (!ignoreKey) return;

    if (typeof window !== "undefined") {
      const confirmationMessage =
        row.reconcileMode && row.existingIngredientId
          ? `Ignore "${row.rawName}" from future imports?\n\nThis removes the raw source item from Review import and keeps it out of future queue rebuilds. The linked live ingredient will be kept in the master list.`
          : `Ignore "${row.rawName}" from future imports?\n\nThis removes the raw source item from Review import and keeps it out of future queue rebuilds. It does not create or delete a live ingredient record.`;
      const confirmed = window.confirm(confirmationMessage);
      if (!confirmed) return;
    }

    setIgnoredImportRows((current) => ({
      ...current,
      [ignoreKey]: {
        flagged: true,
      },
    }));

    if (row.reconcileMode && row.existingIngredientId) {
      markIngredientMasterReviewed(row.existingIngredientId, "ready");
    }

    discardImportRows([rowId]);

    const persistResult = await persistSharedFlagEntry({
      id: buildIgnoredImportRowRuleId(ignoreKey),
      ruleField: IGNORED_IMPORT_ROW_RULE_FIELD,
      label: "Ignored import row",
      entityId: ignoreKey,
      flagged: true,
    });

    if (!persistResult.ok && typeof window !== "undefined") {
      window.alert(
        `Ignored this import row locally, but could not sync that ignore state to shared data. ${persistResult.error || ""}`.trim()
      );
    }
  };

  const importSoft1IngredientSlice = async (file) => {
    if (!file) return false;

    try {
      setSoft1ImportState("Importing Soft1 ingredient slice...");
      const lowerName = String(file.name || "").toLowerCase();
      const importTimestamp = Date.now();
      let importedRows = [];

      if (lowerName.endsWith(".xlsx")) {
        const workbookSheets = await readXlsxWorkbookSheets(file);
        importedRows = workbookSheets.flatMap((sheet, sheetIndex) => {
          try {
            return parseSoft1IngredientUploadMatrix(sheet.rows || [], {
              sourceWorkbook: file.name,
              sourceSheet: sheet.name,
              rowIdPrefix: `raw-upload-${importTimestamp}-${sheetIndex + 1}`,
            });
          } catch (_error) {
            return [];
          }
        });

        if (!importedRows.length) {
          throw new Error(
            "Could not find a supported ingredient sheet in that workbook. Use the Soft1 Ingredients Cost export or a reviewed ingredient CSV."
          );
        }
      } else {
        const text = await file.text();
        importedRows = parseSoft1IngredientUploadMatrix(parseCsv(text), {
          sourceWorkbook: file.name,
          sourceSheet: "",
          rowIdPrefix: `raw-upload-${importTimestamp}`,
        });
      }

      let nextIngredientMaster = [...ingredientMaster];
      const nextIngredientReviewState = { ...ingredientMasterReviewState };
      const autoResolvedEntries = {};
      const failedAutoRefreshCodes = [];
      let autoRefreshedCount = 0;

      for (const row of importedRows) {
        const matchedIngredient = findIngredientByImportedSourceCode(
          nextIngredientMaster,
          row.sourceCode,
          ingredientSourceCodeRedirectState
        );
        if (!matchedIngredient || matchedIngredient.archived) continue;

        const nextUnitCost = numberValue(row.averagePrice, 0);
        const priceMissingFromImport = !(nextUnitCost > 0);
        const updatedIngredient = {
          ...matchedIngredient,
          unitCost: nextUnitCost > 0 ? nextUnitCost : matchedIngredient.unitCost,
          lastImportedAt: String(row.importedAt || matchedIngredient.lastImportedAt || getTodayImportDate()).trim(),
          sourceRecordLabel: String(row.sourceRecordLabel || matchedIngredient.sourceRecordLabel || "Soft1 import").trim(),
          lastImportPriceMissing: priceMissingFromImport,
          masterReviewStatus: "ready",
          needsReviewFlag: false,
          sharedDirty: Boolean(matchedIngredient.sharedRecordId),
        };

        if (updatedIngredient.sharedRecordId && supabaseEnabled && supabase) {
          const { data, error } = await runSharedIngredientMutation({
            mode: "update",
            ingredient: updatedIngredient,
            sharedRecordId: updatedIngredient.sharedRecordId,
          });

          if (error) {
            failedAutoRefreshCodes.push(String(row.sourceCode || matchedIngredient.sourceCode || matchedIngredient.code || "").trim());
            setIngredientSharedSyncState((current) => ({
              ...current,
              [matchedIngredient.id]: error.message || "error",
            }));
            continue;
          }

          const nextSharedUpdatedAt = String(data?.updated_at || data?.last_updated || getTodayImportDate()).trim();
          const hydratedIngredient = {
            ...updatedIngredient,
            name: String(data?.ingredient_name || updatedIngredient.name).trim(),
            code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || updatedIngredient.code).trim(),
            sourceCode: String(getSharedSoft1Code(data) || "").trim(),
            packSize: String(data?.pack_size || updatedIngredient.packSize).trim(),
            supplier: String(data?.supplier || "").trim(),
            category: String(data?.category || updatedIngredient.category || "").trim(),
            purchaseVatRate: normalizeVatPercent(data?.purchase_vat_rate, updatedIngredient.purchaseVatRate ?? 13),
            lastImportedAt: String(data?.last_updated || updatedIngredient.lastImportedAt).trim(),
            sharedUpdatedAt: nextSharedUpdatedAt,
            archived: Boolean(data?.is_archived),
            lastImportPriceMissing: priceMissingFromImport,
            masterReviewStatus: "ready",
            needsReviewFlag: false,
            sharedDirty: false,
          };

        if (hydratedIngredient.sharedRecordId) {
          const existingReviewEntry = ingredientMasterReviewState[hydratedIngredient.sharedRecordId] || {};
          const nextReviewEntry = withIngredientReviewNamingContext({
            status: "ready",
            sharedUpdatedAt: nextSharedUpdatedAt,
            flagged: Boolean(existingReviewEntry.flagged || hydratedIngredient.needsSubstitutionReview),
            forReview: false,
            ruleCatchupSignature: String(existingReviewEntry.ruleCatchupSignature || "").trim(),
          }, hydratedIngredient, soft1SourceRows, existingReviewEntry);
          nextIngredientReviewState[hydratedIngredient.sharedRecordId] = nextReviewEntry;
          await persistIngredientMasterReviewStateEntry(hydratedIngredient.sharedRecordId, nextReviewEntry);
        }

          nextIngredientMaster = nextIngredientMaster.map((ingredient) =>
            ingredient.id === matchedIngredient.id ? hydratedIngredient : ingredient
          );
          setIngredientSharedSyncState((current) => ({
            ...current,
            [matchedIngredient.id]: "saved",
          }));
        } else {
          nextIngredientMaster = nextIngredientMaster.map((ingredient) =>
            ingredient.id === matchedIngredient.id
              ? {
                  ...updatedIngredient,
                  lastImportPriceMissing: priceMissingFromImport,
                  masterReviewStatus: "ready",
                  needsReviewFlag: false,
                  sharedDirty: false,
                }
              : ingredient
          );
        }

        const resolveKey = buildIgnoredImportRowKey(row?.sourceCode, row?.rawName);
        if (resolveKey) {
          autoResolvedEntries[resolveKey] = {
            flagged: true,
          };
        }
        autoRefreshedCount += 1;
      }

      if (autoRefreshedCount) {
        setIngredientMaster(nextIngredientMaster);
        setIngredientMasterReviewState(nextIngredientReviewState);
      }

      const nextResolvedImportRows = Object.keys(autoResolvedEntries).length
        ? {
            ...resolvedImportRows,
            ...autoResolvedEntries,
          }
        : resolvedImportRows;

      if (Object.keys(autoResolvedEntries).length) {
        setResolvedImportRows((current) => ({
          ...current,
          ...autoResolvedEntries,
        }));
      }

      const nextQueueRows = rebuildIngredientImportQueue(
        importedRows,
        nextIngredientMaster,
        learningRules,
        ignoredImportRows,
        nextResolvedImportRows,
        ingredientSourceCodeRedirectState
      );

      setSoft1SourceRows(importedRows);
      setSoft1SourceMeta({
        label: file.name || "Imported Soft1 slice",
        sheet: "",
        rowCount: importedRows.length,
        imported: true,
      });
      setIngredientImportRows(nextQueueRows);
      setIngredientWorkspaceView("review");
      setActiveSection("ingredients");
      setSelectedImportRowId(nextQueueRows[0]?.id || "");
      setSelectedRecord({ type: "", id: "" });
      setSoft1ImportState(
        `Loaded ${importedRows.length} Soft1 ingredient row${importedRows.length === 1 ? "" : "s"} from ${file.name}.`
      );

      if (typeof window !== "undefined") {
        window.alert(
          [
            `Loaded ${importedRows.length} Soft1 ingredient row${importedRows.length === 1 ? "" : "s"} from ${file.name}.`,
            autoRefreshedCount
              ? `${autoRefreshedCount} source-coded ingredient${autoRefreshedCount === 1 ? "" : "s"} had pricing refreshed automatically in master.`
              : "",
            nextQueueRows.length
              ? `${nextQueueRows.length} row${nextQueueRows.length === 1 ? "" : "s"} still need review.`
              : "No new rows need review.",
            failedAutoRefreshCodes.length
              ? `Could not auto-refresh: ${failedAutoRefreshCodes.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      }
      return true;
    } catch (error) {
      const message = error?.message || "Could not import that Soft1 ingredient slice.";
      setSoft1ImportState(message);
      if (typeof window !== "undefined") {
        window.alert(message);
      }
      return false;
    }
  };

  const resetSoft1IngredientSlice = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Reset Review import back to the bundled sample ingredient source?\n\nThis only resets the current import source rows. It does not change the live master ingredients."
      );
      if (!confirmed) return;
    }

    const nextQueueRows = rebuildIngredientImportQueue(
      defaultSoft1Rows,
      ingredientMaster,
      learningRules,
      ignoredImportRows,
      resolvedImportRows
    );

    setSoft1SourceRows(defaultSoft1Rows);
    setSoft1SourceMeta({
      label: ingredientMasterSample?.source_workbook || "Bundled sample",
      sheet: ingredientMasterSample?.source_sheet || "",
      rowCount: defaultSoft1Rows.length,
      imported: false,
    });
    setIngredientImportRows(nextQueueRows);
    setIngredientWorkspaceView("review");
    setSelectedImportRowId(nextQueueRows[0]?.id || "");
    setSelectedRecord({ type: "", id: "" });
    setSoft1ImportState("Using the bundled sample ingredient source again.");
  };

  const updateLearningRule = (ruleId, nextDraft) => {
    const nextField = String(nextDraft?.field || "").trim();
    const nextTrigger = String(nextDraft?.trigger || "").trim();
    const nextValue = String(nextDraft?.value || "").trim();
    if (!ruleId || !nextField || !nextTrigger || !nextValue) return false;

    const nextLabel = ingredientIndexFields.find((field) => field.key === nextField)?.label || titleCaseWords(nextField);

    setLearningRules((current) =>
      mergeLearningRules(
        current.map((rule) =>
          rule.id === ruleId
            ? {
                ...rule,
                field: nextField,
                label: nextLabel,
                trigger: nextTrigger,
                value: nextValue,
              }
            : rule
        )
      )
    );

    return true;
  };

  const deleteLearningRule = (ruleId) => {
    if (!ruleId) return;
    setLearningRules((current) => current.filter((rule) => rule.id !== ruleId));
  };

  const exportLearningRules = () => {
    if (typeof window === "undefined" || !learningRules.length) return;

    const payload = JSON.stringify(learningRules, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "ingredient-learning-rules.json";
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const exportManualIngredients = () => {
    if (typeof window === "undefined") return;

    const pendingManualIngredients = ingredientMaster.filter(
      (ingredient) =>
        !ingredient.archived &&
        (getIngredientSourceType(ingredient) === "manual" || getIngredientSoft1Status(ingredient) === "pending")
    );
    if (!pendingManualIngredients.length) return;

    const rows = [
      [
        "ingredient_name_clean",
        "ingredient_code",
        "source_code",
        "pack_size",
        "supplier",
        "category",
        "unit_cost",
        "purchase_vat_rate",
        "cost_unit",
        "portion_cost_hint",
        "source_type",
        "added_to_soft1",
        "aliases",
        "notes",
      ],
      ...pendingManualIngredients.map((ingredient) => [
        ingredient.name,
        ingredient.code,
        ingredient.sourceCode || "",
        ingredient.packSize || "",
        ingredient.supplier || "",
        ingredient.category || "",
        String(ingredient.unitCost ?? 0),
        String(ingredient.purchaseVatRate ?? 13),
        ingredient.costUnit || "",
        String(ingredient.portionCostHint ?? 0),
        getIngredientSourceType(ingredient),
        getIngredientSoft1Status(ingredient) === "in_soft1" ? "yes" : "no",
        (ingredient.aliases || []).join(" | "),
        ingredient.notes || "",
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "manual-ingredients-for-soft1.csv";
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const runIngredientCleanupOverReviewMaster = () => {
    const queueRows = ingredientImportRows.filter((row) => !row.published);

    if (!queueRows.length) {
      if (typeof window !== "undefined") {
        window.alert("There are no review rows to refresh right now.");
      }
      return;
    }

    let updatedRowCount = 0;
    let renamedRowCount = 0;
    let populatedFieldCount = 0;

    setIngredientImportRows((current) =>
      current.map((row) => {
        if (row.published) return row;

        const { nameIndex: nextNameIndex, appliedRules } = parseIngredientIndexWithLearning(
          row.rawName,
          row.packSize,
          learningRules,
          row.sourceCode
        );
        const suggestedName = composeCleanIngredientName(nextNameIndex, row.rawName);
        const currentNameKey = normalizeIngredientKey(row.suggestedName || row.chosenName || row.rawName);
        const suggestedNameKey = normalizeIngredientKey(suggestedName);
        const allowSuggestedName = !isOverGenericIngredientSuggestion(
          nextNameIndex,
          suggestedName,
          row.chosenName || row.suggestedName || "",
          row.rawName || ""
        );
        const nextAppliedRuleKeys = new Set(
          (appliedRules || []).map((rule) => `${rule.field}:${normalizeIngredientKey(rule.value)}`)
        );
        const previousAppliedRuleKeys = new Set(
          (row.appliedLearningRules || []).map((rule) => `${rule.field}:${normalizeIngredientKey(rule.value)}`)
        );

        let fieldChangesForRow = 0;
        ingredientIndexFields.forEach((field) => {
          const previousValue = normalizeIngredientKey(row.nameIndex?.[field.key] || "");
          const nextValue = normalizeIngredientKey(nextNameIndex?.[field.key] || "");
          if (previousValue !== nextValue && nextAppliedRuleKeys.has(`${field.key}:${nextValue}`)) {
            fieldChangesForRow += 1;
          }
        });

        const suggestedNameChanged = Boolean(allowSuggestedName && suggestedNameKey && currentNameKey !== suggestedNameKey);
        const appliedRuleSetChanged =
          nextAppliedRuleKeys.size !== previousAppliedRuleKeys.size ||
          [...nextAppliedRuleKeys].some((key) => !previousAppliedRuleKeys.has(key));

        if (!suggestedNameChanged && !fieldChangesForRow && !appliedRuleSetChanged) return row;

        updatedRowCount += 1;
        if (suggestedNameChanged) renamedRowCount += 1;
        populatedFieldCount += fieldChangesForRow;

        return {
          ...row,
          nameIndex: nextNameIndex,
          suggestedName: allowSuggestedName ? suggestedName : row.suggestedName,
          appliedLearningRules: appliedRules,
          chosenName: row.useSuggestedName && allowSuggestedName ? suggestedName : row.chosenName,
          confidenceScore: scoreIngredientIndexConfidence(nextNameIndex, row.rawName),
          confidenceLabel: getConfidenceLabel(scoreIngredientIndexConfidence(nextNameIndex, row.rawName)),
          confidenceBreakdown: explainIngredientIndexConfidence(nextNameIndex, row.rawName),
          decisionNote:
            fieldChangesForRow || appliedRuleSetChanged
              ? `Refreshed this row from current parser rules. ${fieldChangesForRow ? `${fieldChangesForRow} field${fieldChangesForRow === 1 ? "" : "s"} populated by rules.` : ""}`.trim()
              : "Refreshed this row from current parser rules.",
        };
      })
    );

    if (typeof window !== "undefined") {
      window.alert(
        updatedRowCount
          ? `Refreshed ${updatedRowCount} review row${updatedRowCount === 1 ? "" : "s"} from current parser rules.\n\n${renamedRowCount} name suggestion${renamedRowCount === 1 ? "" : "s"} changed.\n${populatedFieldCount} field${populatedFieldCount === 1 ? "" : "s"} populated by rules.`
          : "No review rows changed from the current parser and naming rules."
      );
    }
  };

  const applyRuleCatchupToIngredients = async (ingredientIds = []) => {
    const safeIngredientIds = Array.from(new Set((ingredientIds || []).filter(Boolean)));
    if (!safeIngredientIds.length) return;

    const candidateIngredients = ingredientMaster.filter((ingredient) => {
      if (!safeIngredientIds.includes(ingredient.id) || ingredient.archived) return false;
      return Boolean(getIngredientRuleCatchupSuggestion(ingredient, learningRules, soft1SourceRows));
    });

    if (!candidateIngredients.length) {
      if (typeof window !== "undefined") {
        window.alert("No visible master ingredients need a rule catch-up right now.");
      }
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Refresh ${candidateIngredients.length} visible ingredient${candidateIngredients.length === 1 ? "" : "s"} from the current parser rules?\n\nThis will apply obvious name/category updates and save them back to the live ingredient records.`
      );
      if (!confirmed) return;
    }

    let savedCount = 0;
    const failedNames = [];

    for (const ingredient of candidateIngredients) {
      const suggestion = getIngredientRuleCatchupSuggestion(ingredient, learningRules, soft1SourceRows);
      if (!suggestion) continue;

      const rawReference = getIngredientMasterReferenceRawName(ingredient, soft1SourceRows);
      const updatedIngredient = sanitizeIngredientDraft(
        {
          ...ingredient,
          name: suggestion.nameChanged ? suggestion.suggestedName : ingredient.name,
          category: suggestion.categoryChanged ? suggestion.suggestedCategory : ingredient.category,
          aliases: suggestion.nameChanged
            ? dedupeTextList([
                ...(ingredient.aliases || []),
                ingredient.name,
                rawReference,
              ]).filter(
                (alias) =>
                  normalizeIngredientKey(alias) !==
                  normalizeIngredientKey(suggestion.suggestedName || ingredient.name)
              )
            : ingredient.aliases || [],
          sharedDirty: Boolean(ingredient.sharedRecordId),
        },
        ingredientMaster.length
      );

      updateIngredient(ingredient.id, () => updatedIngredient);

      const sharedRecordId = updatedIngredient.sharedRecordId || updatedIngredient.id;
      const existingReviewEntry = ingredientMasterReviewState[sharedRecordId] || {};
      const nextReviewEntry = withIngredientReviewNamingContext({
        status: String(existingReviewEntry.status || updatedIngredient.masterReviewStatus || "ready").trim() || "ready",
        sharedUpdatedAt: String(
          existingReviewEntry.sharedUpdatedAt || updatedIngredient.sharedUpdatedAt || updatedIngredient.lastImportedAt || ""
        ).trim(),
        flagged: Boolean(existingReviewEntry.flagged || updatedIngredient.needsSubstitutionReview),
        forReview: Boolean(existingReviewEntry.forReview || updatedIngredient.needsReviewFlag),
        ruleCatchupSignature: getIngredientRuleCatchupSignature(suggestion),
      }, updatedIngredient, soft1SourceRows, existingReviewEntry);

      setIngredientMasterReviewState((current) => ({
        ...current,
        [sharedRecordId]: nextReviewEntry,
      }));

      if (updatedIngredient.sharedRecordId) {
        const { data, error } = await runSharedIngredientMutation({
          mode: "update",
          ingredient: updatedIngredient,
          sharedRecordId: updatedIngredient.sharedRecordId,
        });

        if (error) {
          failedNames.push(ingredient.name || "Untitled ingredient");
          setIngredientSharedSyncState((current) => ({
            ...current,
            [ingredient.id]: error.message || "error",
          }));
          continue;
        }

        const nextSharedUpdatedAt = String(data?.updated_at || data?.last_updated || getTodayImportDate()).trim();
        updateIngredient(ingredient.id, (current) => ({
          ...current,
          name: String(data?.ingredient_name || current.name).trim(),
          code: String(getSharedInternalIngredientCode(data) || getSharedSoft1Code(data) || current.code).trim(),
          sourceCode: String(getSharedSoft1Code(data) || "").trim(),
          packSize: String(data?.pack_size || current.packSize).trim(),
          supplier: String(data?.supplier || "").trim(),
          category: String(data?.category || current.category).trim(),
          sharedUpdatedAt: nextSharedUpdatedAt,
          lastImportedAt: String(data?.last_updated || current.lastImportedAt).trim(),
          sharedDirty: false,
        }));

        const persistedReviewEntry = {
          ...nextReviewEntry,
          sharedUpdatedAt: nextSharedUpdatedAt,
        };
        setIngredientMasterReviewState((current) => ({
          ...current,
          [sharedRecordId]: persistedReviewEntry,
        }));
        await persistIngredientMasterReviewStateEntry(sharedRecordId, persistedReviewEntry);

        setIngredientSharedSyncState((current) => ({
          ...current,
          [ingredient.id]: "saved",
        }));
      } else {
        await persistIngredientMasterReviewStateEntry(sharedRecordId, nextReviewEntry);
      }

      savedCount += 1;
    }

    if (typeof window !== "undefined") {
      window.alert(
        failedNames.length
          ? `Updated ${savedCount} ingredient${savedCount === 1 ? "" : "s"} from the current rules.\n\nCould not save: ${failedNames.join(", ")}`
          : `Updated ${savedCount} ingredient${savedCount === 1 ? "" : "s"} from the current rules.`
      );
    }
  };

  const buildIngredientReconcileQueue = () => {
    const nextQueueRows = rebuildIngredientImportQueue(
      soft1SourceRows,
      ingredientMaster,
      learningRules,
      ignoredImportRows,
      resolvedImportRows,
      ingredientSourceCodeRedirectState
    );
    setIngredientImportRows(nextQueueRows);
    setIngredientWorkspaceView("review");
    setSelectedImportRowId(nextQueueRows[0]?.id || "");
    setSelectedRecord({ type: "", id: "" });
  };

  const openIngredientMasterExportPreview = () => {
    const exportIngredients = [...ingredientMaster].sort((left, right) => left.name.localeCompare(right.name));
    openExportPreview({
      title: "Ingredient master",
      html: buildIngredientMasterExportHtml(exportIngredients),
      csvContent: buildIngredientMasterExportCsv(exportIngredients),
      csvFileName: "ingredient-master.csv",
    });
  };

  const openMenuSheetPreview = (menuId) => {
    const menu = recordMaps.menu.get(menuId);
    if (!menu) return;
    const csv = buildMenuExportCsv(menu, recordMaps.recipe);
    const html = buildMenuPrintHtml(menu, recordMaps.recipe);
    openExportPreview({
      title: `${menu.name} menu proof`,
      html,
      csvContent: csv,
      csvFileName: `${slugifyLabel(menu.name || "menu")}-menu.csv`,
    });
  };

  const openExportPreview = ({ title, html, csvContent = "", csvFileName = "" }) => {
    setExportPreviewModal({
      isOpen: true,
      title,
      html,
      csvContent,
      csvFileName,
    });
  };

  const closeExportPreview = () => {
    setExportPreviewModal({
      isOpen: false,
      title: "",
      html: "",
      csvContent: "",
      csvFileName: "",
    });
  };

  const downloadExportPreviewCsv = () => {
    if (!exportPreviewModal.csvContent) return;
    downloadTextFile(exportPreviewModal.csvFileName || "export.csv", exportPreviewModal.csvContent, "text/csv;charset=utf-8;");
  };

  const printExportPreview = () => {
    if (typeof window === "undefined" || !exportPreviewModal.html) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=900");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(exportPreviewModal.html);
    printWindow.document.close();
    printWindow.focus();
  };

  const openRecipeCostSheetPreview = (recipeId) => {
    const recipe = recordMaps.recipe.get(recipeId);
    if (!recipe) return;
    const componentRows = buildRecipeCostSheetRowsV2(recipe, recordMaps.ingredient, recordMaps.batch);
    const pricing = getRecipePricingMetrics(recipe, recordMaps.ingredient, recordMaps.batch);
    openExportPreview({
      title: `${recipe.name} cost sheet`,
      html: buildCostSheetHtmlV2({
        title: "Recipe cost",
        code: recipe.id || recipe.code,
        name: recipe.name,
        itemCode: recipe.code,
        totalCost: pricing.recipeCost,
        roundup: formatCurrency(pricing.roundup),
        componentRows,
      }),
      csvContent: buildCostSheetCsvBlock({
        code: recipe.id || recipe.code,
        name: recipe.name,
        itemCode: recipe.code,
        totalCost: pricing.recipeCost,
        componentRows,
      }),
      csvFileName: `${slugifyLabel(recipe.name || recipe.code || "recipe")}-cost-sheet.csv`,
    });
  };

  const openRecipeChefSheetPreview = (recipeId) => {
    const recipe = recordMaps.recipe.get(recipeId);
    if (!recipe) return;
    const componentRows = buildRecipeChefSheetRowsV2(recipe, recordMaps.ingredient, recordMaps.batch);
    const pricing = getRecipePricingMetrics(recipe, recordMaps.ingredient, recordMaps.batch);
    openExportPreview({
      title: `${recipe.name} chef sheet`,
      html: buildChefSheetHtmlV2(recipe, componentRows, {
        type: "recipe",
        totalCost: pricing.recipeCost,
        grossProfit: pricing.grossProfit,
      }),
      csvContent: "",
      csvFileName: "",
    });
  };

  const openBatchCostSheetPreview = (batchId) => {
    const batch = recordMaps.batch.get(batchId);
    if (!batch) return;
    const componentRows = buildBatchCostSheetRowsV2(batch, recordMaps.ingredient, recordMaps.batch);
    const batchCostSource = getBatchCostSource(batch, recordMaps.ingredient);
    openExportPreview({
      title: `${batch.name} cost sheet`,
      html: buildCostSheetHtmlV2({
        title: "Component recipe cost",
        code: batch.id || batch.code,
        name: batch.name,
        itemCode: batch.code,
        totalCost: batchCostSource.totalComponentCost,
        roundup: "-",
        componentRows,
      }),
      csvContent: buildCostSheetCsvBlock({
        code: batch.id || batch.code,
        name: batch.name,
        itemCode: batch.code,
        totalCost: batchCostSource.totalComponentCost,
        componentRows,
      }),
      csvFileName: `${slugifyLabel(batch.name || batch.code || "component")}-cost-sheet.csv`,
    });
  };

  const openBatchChefSheetPreview = (batchId) => {
    const batch = recordMaps.batch.get(batchId);
    if (!batch) return;
    const componentRows = buildBatchCostSheetRowsV2(batch, recordMaps.ingredient, recordMaps.batch);
    const batchCostSource = getBatchCostSource(batch, recordMaps.ingredient);
    openExportPreview({
      title: `${batch.name} chef sheet`,
      html: buildChefSheetHtmlV2(batch, componentRows, {
        type: "batch",
        totalCost: batchCostSource.totalComponentCost,
        unitCost: batchCostSource.unitCost,
      }),
      csvContent: "",
      csvFileName: "",
    });
  };

  const openMenuBulkCostSheetPreview = (menuId) => {
    const menu = recordMaps.menu.get(menuId);
    if (!menu) return;
    const recipesForMenu = (menu.recipeIds || []).map((recipeId) => recordMaps.recipe.get(recipeId)).filter(Boolean);
    if (!recipesForMenu.length) return;
    const csvContent = recipesForMenu
      .map((recipe) => {
        const componentRows = buildRecipeCostSheetRowsV2(recipe, recordMaps.ingredient, recordMaps.batch);
        const pricing = getRecipePricingMetrics(recipe, recordMaps.ingredient, recordMaps.batch);
        return buildCostSheetCsvBlock({
          code: recipe.id || recipe.code,
          name: recipe.name,
          itemCode: recipe.code,
          totalCost: pricing.recipeCost,
          componentRows,
        });
      })
      .join("\n\n");
    const html = buildCostSheetPackHtmlV2(menu, recipesForMenu, recordMaps.ingredient, recordMaps.batch);
    openExportPreview({
      title: `${menu.name} costing pack`,
      html,
      csvContent,
      csvFileName: `${slugifyLabel(menu.name || "menu")}-costing-pack.csv`,
    });
  };

  const createVariationForRow = (rowId) => {
    updateImportRow(rowId, (row) => {
      const siblingRows = ingredientImportRows.filter((item) => item.sourceCode === row.sourceCode);
      const nextIndex = siblingRows.findIndex((item) => item.id === row.id) + 1;
      const nextCode = createVariationCode(row.sourceCode, nextIndex || 1);

      return {
        ...row,
        internalCode: nextCode,
        reviewStatus: row.published ? row.reviewStatus : "review",
        decisionNote: "Variation code assigned for duplicate source code. Mark this row ready once it looks correct.",
      };
    });
  };

  const generateImportRowInternalCode = (rowId) => {
    const row = ingredientImportRows.find((item) => item.id === rowId);
    if (!row) return;

    updateImportRow(rowId, (current) => {
      if (current.strategy === "merge" && current.targetId) {
        return {
          ...current,
          decisionNote: "This row is merging into an existing ingredient, so it keeps the target ingredient code.",
        };
      }

      const nextCode = generateIngredientCodeFromDraft(
        {
          name: current.chosenName || current.suggestedName || current.rawName,
          packSize: current.packSize,
          category: current.productCategory || current.category || current.tradeCategory || "",
        },
        ingredientMaster,
        current.strategy === "update" ? current.targetId || current.existingIngredientId || "" : ""
      );

      return {
        ...current,
        internalCode: nextCode,
        reviewStatus: current.published ? current.reviewStatus : "review",
        decisionNote: "Generated a new internal ingredient code for this row.",
      };
    });
  };

  const createVariationGroup = (sourceCode) => {
    setIngredientImportRows((current) => {
      const groupRows = current.filter((row) => row.sourceCode === sourceCode && !row.published);

      return current.map((row) => {
        if (row.sourceCode !== sourceCode || row.published) return row;

        const rowIndex = groupRows.findIndex((item) => item.id === row.id);
        const baseTarget = groupRows.find((item) => item.targetId)?.targetId || "";

        if (rowIndex === 0 && baseTarget && row.targetId) {
          return {
            ...row,
            strategy: "merge",
            reviewStatus: row.published ? row.reviewStatus : "review",
            decisionNote: "Primary row keeps the base source code and merges into the clean ingredient. Mark it ready once reviewed.",
          };
        }

        return {
          ...row,
          strategy: rowIndex === 0 && !baseTarget ? "create" : row.strategy,
          targetId: rowIndex === 0 && !baseTarget ? "" : row.targetId,
          targetName: rowIndex === 0 && !baseTarget ? "" : row.targetName,
          internalCode: rowIndex === 0 && !baseTarget ? row.sourceCode : createVariationCode(sourceCode, rowIndex + 1),
          reviewStatus: row.published ? row.reviewStatus : "review",
          decisionNote:
            rowIndex === 0 && !baseTarget
              ? "Primary row keeps the base source code. Mark it ready once reviewed."
              : "Variation code assigned for this duplicate source-code group. Mark it ready once reviewed.",
        };
      });
    });
  };

  const acceptGroup = (sourceCode) => {
    setIngredientImportRows((current) =>
      current.map((row) =>
        row.sourceCode === sourceCode && !row.published
          ? {
              ...row,
              reviewStatus:
                row.strategy === "merge" ? (row.targetId ? "ready" : "review") : row.internalCode.trim() ? "ready" : "review",
              decisionNote:
                row.strategy === "merge"
                  ? row.targetId
                    ? "Group reviewed and ready to merge."
                    : "Choose a clean ingredient target before this row can be published."
                  : "Group reviewed and ready to publish as a clean ingredient.",
            }
          : row
      )
    );
  };

  const acceptSuggestion = async (rowId) => {
    const currentRow = ingredientImportRows.find((row) => row.id === rowId);
    if (!currentRow) return;

    const hasTarget = currentRow.strategy !== "merge" || Boolean(String(currentRow.targetId || "").trim());
    const hasCode = Boolean(String(currentRow.internalCode || "").trim());
    const nextReviewStatus = hasCode && hasTarget ? "ready" : "review";
    const nextDecisionNote =
      !hasCode
        ? "Add an internal ingredient code before marking this row ready."
        : currentRow.strategy === "merge"
          ? hasTarget
            ? "Ready to merge into the clean ingredient"
            : "Choose a clean ingredient target before this row can be marked ready."
          : currentRow.strategy === "update"
            ? "Ready to update this ingredient in place"
            : "Ready to publish as a clean ingredient";

    const nextRow = {
      ...currentRow,
      reviewStatus: nextReviewStatus,
      decisionNote: nextDecisionNote,
    };

    updateImportRow(rowId, () => nextRow);

    if (nextReviewStatus === "ready" && nextRow.reconcileMode && nextRow.strategy === "update") {
      const saved = await saveApprovedImportRowToIngredient(nextRow);
      if (saved) {
        removeIngredientFromReviewQueue(rowId, {
          decisionNote: "Saved to master and removed from review.",
        });
      }
      return;
    }

    if (nextReviewStatus === "ready") {
      const saved = await publishImportRowsToMaster([rowId], { skipConfirm: true });
      if (saved) {
        setActiveSection("ingredients");
        setIngredientWorkspaceView("review");
      }
    }
  };

  const publishImportRowsToMaster = async (rowIds = [], options = {}) => {
    const { skipConfirm = false, confirmMessage = "" } = options;
    const safeRowIds = Array.from(new Set((rowIds || []).filter(Boolean)));
    const readyRows = ingredientImportRows.filter((row) => safeRowIds.includes(row.id) && !row.published);
    if (!readyRows.length) return false;
    if (!skipConfirm && typeof window !== "undefined") {
      const confirmed = window.confirm(
        confirmMessage ||
          `Publish ${readyRows.length} approved ingredient row${readyRows.length === 1 ? "" : "s"} into the clean ingredient master?`
      );
      if (!confirmed) return false;
    }

    let nextIngredientMaster = [...ingredientMaster];
    const nextReviewState = { ...ingredientMasterReviewState };

    for (const row of readyRows) {
      const isReconcileRow = Boolean(row.reconcileMode);
      const targetId =
        isReconcileRow && row.strategy === "create"
          ? ""
          : row.targetId || row.existingIngredientId || "";
      const existingTarget = nextIngredientMaster.find((item) => item.id === targetId) || null;

      if (existingTarget) {
        const nextCode = row.strategy === "merge" || isIngredientCodeLocked(existingTarget)
          ? existingTarget.code
          : row.internalCode;
        const codeConflict = row.strategy === "merge" || isIngredientCodeLocked(existingTarget)
          ? null
          : getIngredientCodeConflict(nextIngredientMaster, nextCode, existingTarget.id);
        if (codeConflict) {
          if (typeof window !== "undefined") {
            window.alert(buildIngredientCodeConflictMessage(nextCode, codeConflict));
          }
          return;
        }

        const updatedIngredient = sanitizeIngredientDraft(
          {
            ...existingTarget,
            name: row.chosenName,
            code: nextCode,
            sourceCode: existingTarget.sourceCode,
            aliases: buildIngredientAliases(existingTarget.aliases || [], row),
        packSize: row.packSize,
        supplier: row.supplier || existingTarget.supplier,
            category: row.category,
            tradeCategory: row.tradeCategory || existingTarget.tradeCategory || "",
            unitCost: row.averagePrice > 0 ? row.averagePrice : existingTarget.unitCost,
            costUnit: inferPricingUnit(row.packSize || existingTarget.packSize || ""),
            sourceType: String(row.sourceCode || "").trim() ? "soft1" : existingTarget.sourceType || "manual",
            soft1Status: String(row.sourceCode || "").trim() ? "in_soft1" : existingTarget.soft1Status || "pending",
            needsReviewFlag: false,
            lastImportPriceMissing: !(Number(row.averagePrice || 0) > 0),
            sourceRecordLabel: row.sourceRecordLabel || existingTarget.sourceRecordLabel || "Soft1 import",
            lastImportedAt: row.importedAt || existingTarget.lastImportedAt || getTodayImportDate(),
            status: "ready",
            sharedDirty: Boolean(existingTarget.sharedRecordId),
            masterReviewStatus: "ready",
            notes: isReconcileRow
              ? `Reconciled from live ingredient review row ${row.id}.`
              : `Updated from Soft1 import row ${row.id}; supplier naming retained as aliases for de-duplication.`,
          },
          nextIngredientMaster.length
        );

        if (supabaseEnabled && supabase && updatedIngredient.sharedRecordId) {
          const { data, error } = await runSharedIngredientMutation({
            mode: "update",
            ingredient: updatedIngredient,
            sharedRecordId: updatedIngredient.sharedRecordId,
          });

          if (error) {
            if (typeof window !== "undefined") {
              window.alert(
                isIngredientInternalCodeUniqueConstraintError(error.message)
                  ? buildIngredientCodeConflictMessage(nextCode, codeConflict)
                  : error.message || `Could not publish ${updatedIngredient.name} to shared data.`
              );
            }
            return false;
          }

          updatedIngredient.lastImportedAt = String(data?.last_updated || updatedIngredient.lastImportedAt).trim();
          updatedIngredient.sharedUpdatedAt = String(data?.updated_at || data?.last_updated || updatedIngredient.sharedUpdatedAt).trim();
          updatedIngredient.sharedDirty = false;
        }

        if (updatedIngredient.sharedRecordId && String(updatedIngredient.tradeCategory || "").trim()) {
          await persistIngredientTradeCategoryForRecord(updatedIngredient.id, updatedIngredient.tradeCategory);
        }

        let mergedSourceIngredient = null;
        if (
          isReconcileRow &&
          row.strategy === "merge" &&
          row.existingIngredientId &&
          row.existingIngredientId !== updatedIngredient.id
        ) {
          const sourceIngredient = nextIngredientMaster.find((item) => item.id === row.existingIngredientId) || null;
          if (sourceIngredient) {
            mergedSourceIngredient = sanitizeIngredientDraft(
              {
                ...sourceIngredient,
                archived: true,
                needsReviewFlag: false,
                needsSubstitutionReview: false,
                masterReviewStatus: "ready",
                status: "ready",
                notes: dedupeTextList([
                  String(sourceIngredient.notes || "").trim(),
                  `Merged into ${String(updatedIngredient.name || updatedIngredient.code || updatedIngredient.id).trim()} from review import on ${getTodayImportDate()}.`,
                ]).join(" "),
                sharedDirty: Boolean(sourceIngredient.sharedRecordId),
              },
              nextIngredientMaster.length
            );

            const mergedSourceCode = normalizeIngredientCodeToken(getEffectiveIngredientSourceCode(sourceIngredient));
            if (mergedSourceCode) {
              const nextRedirectEntry = {
                targetIngredientId: updatedIngredient.id,
              };
              setIngredientSourceCodeRedirectState((current) => ({
                ...current,
                [mergedSourceCode]: nextRedirectEntry,
              }));
              await persistIngredientSourceCodeRedirectEntry(mergedSourceCode, nextRedirectEntry);
            }

            if (mergedSourceIngredient.sharedRecordId && supabaseEnabled && supabase) {
              const { data: sourceData, error: sourceError } = await runSharedIngredientMutation({
                mode: "update",
                ingredient: mergedSourceIngredient,
                sharedRecordId: mergedSourceIngredient.sharedRecordId,
              });

              if (sourceError) {
                if (typeof window !== "undefined") {
                  window.alert(sourceError.message || `Could not archive merged ingredient ${mergedSourceIngredient.name}.`);
                }
                return false;
              }

              mergedSourceIngredient = {
                ...mergedSourceIngredient,
                name: String(sourceData?.ingredient_name || mergedSourceIngredient.name).trim(),
                code: String(
                  getSharedInternalIngredientCode(sourceData) || getSharedSoft1Code(sourceData) || mergedSourceIngredient.code
                ).trim(),
                sourceCode: String(getSharedSoft1Code(sourceData) || "").trim(),
                packSize: String(sourceData?.pack_size || mergedSourceIngredient.packSize).trim(),
                supplier: String(sourceData?.supplier || "").trim(),
                category: String(sourceData?.category || mergedSourceIngredient.category).trim(),
                lastImportedAt: String(sourceData?.last_updated || mergedSourceIngredient.lastImportedAt).trim(),
                sharedUpdatedAt: String(
                  sourceData?.updated_at || sourceData?.last_updated || mergedSourceIngredient.sharedUpdatedAt || ""
                ).trim(),
                archived: Boolean(sourceData?.is_archived),
                sharedDirty: false,
              };
            }
          }
        }

        nextIngredientMaster = nextIngredientMaster.map((item) => {
          if (item.id === updatedIngredient.id) return updatedIngredient;
          if (mergedSourceIngredient && item.id === mergedSourceIngredient.id) return mergedSourceIngredient;
          return item;
        });
        if (updatedIngredient.sharedRecordId) {
          const nextEntry = withIngredientReviewNamingContext({
            status: "ready",
            sharedUpdatedAt: updatedIngredient.sharedUpdatedAt || updatedIngredient.lastImportedAt || "",
            flagged: Boolean(updatedIngredient.needsSubstitutionReview),
            forReview: false,
          }, updatedIngredient, soft1SourceRows, ingredientMasterReviewState[updatedIngredient.sharedRecordId] || {});
          nextReviewState[updatedIngredient.sharedRecordId] = nextEntry;
          const persisted = await persistIngredientMasterReviewStateEntry(updatedIngredient.sharedRecordId, nextEntry);
          if (!persisted && typeof window !== "undefined") {
            window.alert(`Published "${updatedIngredient.name}", but could not persist its reviewed state. It may come back into review after reload.`);
          }
        }
        if (mergedSourceIngredient?.sharedRecordId) {
          const nextSourceEntry = withIngredientReviewNamingContext({
            status: "ready",
            sharedUpdatedAt: mergedSourceIngredient.sharedUpdatedAt || mergedSourceIngredient.lastImportedAt || "",
            flagged: false,
            forReview: false,
          }, mergedSourceIngredient, soft1SourceRows, ingredientMasterReviewState[mergedSourceIngredient.sharedRecordId] || {});
          nextReviewState[mergedSourceIngredient.sharedRecordId] = nextSourceEntry;
          const persisted = await persistIngredientMasterReviewStateEntry(
            mergedSourceIngredient.sharedRecordId,
            nextSourceEntry
          );
          if (!persisted && typeof window !== "undefined") {
            window.alert(
              `Merged "${mergedSourceIngredient.name}" locally, but could not persist its reviewed state. It may come back into review after reload.`
            );
          }
        }
        continue;
      }

      const newIngredient = sanitizeIngredientDraft(
        {
          id: `ing-${nextIngredientMaster.length + 1}`,
          name: row.chosenName,
          code: row.internalCode,
          sourceCode: row.sourceCode,
          aliases: buildIngredientAliases([], row),
          status: "ready",
          packSize: row.packSize,
          supplier: row.supplier || "",
          category: row.category,
          tradeCategory: row.tradeCategory || "",
          unitCost: row.averagePrice > 0 ? row.averagePrice : 0,
          costUnit: inferPricingUnit(row.packSize || ""),
          sourceType: String(row.sourceCode || "").trim() ? "soft1" : "manual",
          soft1Status: String(row.sourceCode || "").trim() ? "in_soft1" : "pending",
          needsReviewFlag: false,
          lastImportPriceMissing: !(Number(row.averagePrice || 0) > 0),
          sourceRecordLabel: row.sourceRecordLabel || "Soft1 import",
          lastImportedAt: row.importedAt || getTodayImportDate(),
          usedInRecipeIds: [],
          batchId: "",
          masterReviewStatus: "ready",
          notes: `Published from ingredient import row ${row.id} with raw source naming stored as aliases.`,
        },
        nextIngredientMaster.length
      );
      const newIngredientCodeConflict = getIngredientCodeConflict(nextIngredientMaster, newIngredient.code, newIngredient.id);
      const newIngredientSourceCodeConflict = getIngredientSourceCodeConflict(
        nextIngredientMaster,
        newIngredient.sourceCode,
        newIngredient.id
      );
        if (newIngredientCodeConflict) {
          if (typeof window !== "undefined") {
            window.alert(buildIngredientCodeConflictMessage(newIngredient.code, newIngredientCodeConflict));
          }
          return false;
        }
        if (newIngredientSourceCodeConflict) {
          if (typeof window !== "undefined") {
            window.alert(buildIngredientSourceCodeConflictMessage(newIngredient.sourceCode, newIngredientSourceCodeConflict));
          }
          return false;
        }

      if (supabaseEnabled && supabase) {
        const { data, error } = await runSharedIngredientMutation({
          mode: "insert",
          ingredient: newIngredient,
        });

        if (error) {
          if (typeof window !== "undefined") {
            window.alert(
              isIngredientSourceCodeUniqueConstraintError(error.message)
                ? buildIngredientSourceCodeConflictMessage(newIngredient.sourceCode, newIngredientSourceCodeConflict)
                : isIngredientInternalCodeUniqueConstraintError(error.message)
                  ? buildIngredientCodeConflictMessage(newIngredient.code, newIngredientCodeConflict)
                : error.message || `Could not create ${newIngredient.name} in shared data.`
            );
          }
          return false;
        }

        newIngredient.id = String(data?.id || newIngredient.id);
        newIngredient.sharedRecordId = String(data?.id || "").trim();
        newIngredient.sharedUpdatedAt = String(data?.updated_at || data?.last_updated || "").trim();
        newIngredient.lastImportedAt = String(data?.last_updated || newIngredient.lastImportedAt).trim();
        newIngredient.sharedDirty = false;
        if (newIngredient.sharedRecordId && String(newIngredient.tradeCategory || "").trim()) {
          await persistIngredientTradeCategoryForRecord(newIngredient.id, newIngredient.tradeCategory);
        }
        if (newIngredient.sharedRecordId) {
          const nextEntry = withIngredientReviewNamingContext({
            status: "ready",
            sharedUpdatedAt: newIngredient.sharedUpdatedAt || newIngredient.lastImportedAt || "",
            flagged: Boolean(newIngredient.needsSubstitutionReview),
            forReview: false,
          }, newIngredient, soft1SourceRows, ingredientMasterReviewState[newIngredient.sharedRecordId] || {});
          nextReviewState[newIngredient.sharedRecordId] = nextEntry;
          const persisted = await persistIngredientMasterReviewStateEntry(newIngredient.sharedRecordId, nextEntry);
          if (!persisted && typeof window !== "undefined") {
            window.alert(`Published "${newIngredient.name}", but could not persist its reviewed state. It may come back into review after reload.`);
          }
        }
      }

      nextIngredientMaster = [newIngredient, ...nextIngredientMaster];
    }

    setIngredientMaster(nextIngredientMaster);
    setIngredientMasterReviewState(nextReviewState);
    markImportRowsResolved(readyRows);

    setIngredientImportRows((current) =>
      current.map((row) =>
        safeRowIds.includes(row.id) && !row.published
          ? { ...row, published: true, decisionNote: "Published into the clean ingredient master" }
          : row
      )
    );
    if (safeRowIds.includes(selectedImportRowId)) {
      const nextVisibleRow = ingredientImportRows.find((row) => !safeRowIds.includes(row.id) && !row.published);
      setSelectedImportRowId(nextVisibleRow?.id || "");
    }

    return true;
  };

  const publishReadyRows = async () => {
    const readyRows = ingredientImportRows.filter((row) => row.reviewStatus === "ready" && !row.published);
    if (!readyRows.length) return;
    const saved = await publishImportRowsToMaster(
      readyRows.map((row) => row.id),
      {
        confirmMessage: `Publish ${readyRows.length} approved ingredient row${readyRows.length === 1 ? "" : "s"} into the clean ingredient master?`,
      }
    );
    if (!saved) return;
    setActiveSection("ingredients");
    setIngredientWorkspaceView("catalogue");
    setIngredientStatusFilter("all");
    setSelectedImportRowId("");
  };

  const ingredientRuleCatchupMap = useMemo(
    () =>
      new Map(
        ingredientMaster
          .map((ingredient) => {
            const suggestion = getIngredientRuleCatchupSuggestion(ingredient, learningRules, soft1SourceRows);
            if (!suggestion) return [ingredient.id, null];
            const sharedRecordId = ingredient.sharedRecordId || ingredient.id;
            const acknowledgedSignature = String(
              ingredientMasterReviewState?.[sharedRecordId]?.ruleCatchupSignature || ""
            ).trim();
            const suggestionSignature = getIngredientRuleCatchupSignature(suggestion);
            if (acknowledgedSignature && suggestionSignature === acknowledgedSignature) {
              return [ingredient.id, null];
            }
            return [ingredient.id, suggestion];
          })
          .filter(([, suggestion]) => Boolean(suggestion))
      ),
    [ingredientMaster, learningRules, soft1SourceRows, ingredientMasterReviewState]
  );
  const ingredientNeedsMasterReviewAttention = (ingredient) =>
    getIngredientReviewAttentionReasons(ingredient, ingredientRuleCatchupMap).length > 0;

  const trimmedSearchQuery = normalizeSearchText(deferredSearch);
  const ingredientSearchCorpusMap = useMemo(
    () =>
      new Map(
        ingredientMaster.map((item) => [
          item.id,
          getIngredientSearchCorpusText(item, {
            batchMap: recordMaps.batch,
            sourceRows: soft1SourceRows,
            redirectState: ingredientSourceCodeRedirectState,
          }),
        ])
      ),
    [ingredientMaster, recordMaps.batch, soft1SourceRows, ingredientSourceCodeRedirectState]
  );
  const ingredientParsedIndexMap = useMemo(
    () =>
      new Map(
        ingredientMaster.map((item) => [item.id, getIngredientMasterParsedIndex(item, learningRules, soft1SourceRows)])
      ),
    [ingredientMaster, learningRules, soft1SourceRows]
  );
  const ingredientProductOptions = useMemo(
    () =>
      Array.from(new Set(Array.from(ingredientParsedIndexMap.values()).map((index) => index?.product).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [ingredientParsedIndexMap]
  );

  const ingredientCatalogueBaseRows = ingredientMaster.filter((item) => {
    const sharedRecordId = String(item.sharedRecordId || "").trim();
    if (sharedRecordId && pendingIngredientDeletionIds.includes(sharedRecordId)) {
      return false;
    }
    if (sharedRecordId && deletedIngredientTombstoneIds.includes(sharedRecordId)) {
      return false;
    }
    const query = trimmedSearchQuery;
    const sourceType = getIngredientSourceType(item);
    const soft1Status = getIngredientSoft1Status(item);
    const visibleInMaster =
      query
        ? true
        : getIngredientMasterReviewStatus(item) !== "review" ||
          ingredientStatusFilter === "manual_review" ||
          ingredientStatusFilter === "needs_attention";
    if (!visibleInMaster) return false;
    const matchesQuery = !query
      ? true
      : String(ingredientSearchCorpusMap.get(item.id) || "").includes(query);
    const product = ingredientParsedIndexMap.get(item.id)?.product || "";
    const matchesProduct = ingredientProductFilter === "all" ? true : normalizeIngredientKey(product) === normalizeIngredientKey(ingredientProductFilter);
    const matchesSource =
      ingredientSourceFilter === "all"
        ? true
        : ingredientSourceFilter === "manual"
          ? sourceType === "manual"
          : ingredientSourceFilter === "pending"
            ? soft1Status === "pending"
            : sourceType === "soft1";

    return matchesQuery && matchesProduct && matchesSource;
  });
  const ingredientGroupRows = ingredientCatalogueBaseRows.filter((item) =>
    ingredientRecordFilter === "component_derived"
      ? Boolean(item.batchId)
      : ingredientRecordFilter === "simple"
        ? !item.batchId
        : true
  );
  const ingredientRows = ingredientGroupRows.filter((item) =>
    ingredientStatusFilter === "archived"
      ? Boolean(item.archived)
      : ingredientStatusFilter === "manual_review"
        ? !item.archived && getIngredientMasterReviewStatus(item) === "review"
        : ingredientStatusFilter === "price_review"
          ? !item.archived && Boolean(getIngredientPriceReviewIssue(item))
          : ingredientStatusFilter === "rule_catchup"
            ? !item.archived && ingredientRuleCatchupMap.has(item.id)
            : ingredientStatusFilter === "needs_attention"
              ? !item.archived && ingredientNeedsMasterReviewAttention(item)
              : !item.archived
  );
  const ingredientMasterReviewRows = ingredientMaster.filter((item) => {
    if (item.archived) return false;
    const query = trimmedSearchQuery;
    const matchesQuery = !query
      ? true
      : String(ingredientSearchCorpusMap.get(item.id) || "").includes(query);
    return matchesQuery && getIngredientMasterReviewStatus(item) === "review";
  });
  const markIngredientManualReviewDone = async (ingredientId) => {
    const currentRows = ingredientRows;
    const currentIndex = currentRows.findIndex((row) => row.id === ingredientId);
    const nextCandidate =
      (currentIndex >= 0 ? currentRows[currentIndex + 1] : null) ||
      (currentIndex > 0 ? currentRows[currentIndex - 1] : null) ||
      null;
    const saved = await syncIngredientToSharedData(ingredientId, { markReviewed: true });
    if (!saved) return false;

    if (
      activeSection === "ingredients" &&
      ingredientWorkspaceView === "catalogue" &&
      (ingredientStatusFilter === "rule_catchup" || ingredientStatusFilter === "manual_review") &&
      selectedRecord.type === "ingredient" &&
      selectedRecord.id === ingredientId
    ) {
      if (nextCandidate?.id && nextCandidate.id !== ingredientId) {
        setSelectedRecord({ type: "ingredient", id: nextCandidate.id });
      } else {
        setSelectedRecord({ type: "", id: "" });
      }
    }

    return true;
  };
  const trustedIngredientMaster = ingredientMaster.filter(
    (item) => {
      const sharedRecordId = String(item.sharedRecordId || "").trim();
      if (item.archived) return false;
      if (sharedRecordId && pendingIngredientDeletionIds.includes(sharedRecordId)) return false;
      if (sharedRecordId && deletedIngredientTombstoneIds.includes(sharedRecordId)) return false;
      return true;
    }
  );
  const substitutionOpportunities = useMemo(
    () => buildIngredientSubstitutionOpportunities(trustedIngredientMaster, recipes, batches, menus),
    [trustedIngredientMaster, recipes, batches, menus]
  );
  const substitutionRows = substitutionOpportunities.filter((opportunity) => {
    const query = trimmedSearchQuery;
    const matchesQuery = !query
      ? true
      : [
          opportunity.sourceIngredient.name,
          opportunity.sourceIngredient.code,
          opportunity.product,
          ...opportunity.candidates.map((candidate) => candidate.ingredient.name),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

    if (!matchesQuery) return false;
    if (substitutionFilter === "menus") return opportunity.menuCount > 0;
    if (substitutionFilter === "components") return opportunity.componentCount > 0;
    if (substitutionFilter === "strong") return opportunity.candidates[0]?.confidence === "strong";
    return true;
  });
  const substitutionOpportunityMap = useMemo(
    () => new Map(substitutionOpportunities.map((opportunity) => [opportunity.sourceIngredient.id, opportunity])),
    [substitutionOpportunities]
  );
  const selectedSubstitutionOpportunity =
    activeSection === "substitutions" && selectedRecord.type === "ingredient"
      ? substitutionOpportunityMap.get(selectedRecord.id) || null
      : null;
  const pendingManualIngredientCount = ingredientMaster.filter(
    (ingredient) =>
      !ingredient.archived &&
      (getIngredientSourceType(ingredient) === "manual" || getIngredientSoft1Status(ingredient) === "pending")
  ).length;
  const recipeCategoryOptionsForFilter = Array.from(new Set(recipes.map((recipe) => recipe.category).filter(Boolean))).sort();
  const recipeRestaurantOptionsForFilter = Array.from(
    new Set(
      menus
        .flatMap((menu) => menu.recipeIds.map(() => menu.restaurant))
        .filter(Boolean)
    )
  ).sort();

  const recipeLibraryBaseRows = recipes.filter((item) => {
    const query = trimmedSearchQuery;
    const matchesQuery = !query
      ? true
      : [item.name, item.code, item.menuDescription, item.category, item.status]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesCategory = recipeCategoryFilter === "all" ? true : item.category === recipeCategoryFilter;
    const recipeRestaurants = menus
      .filter((menu) => (item.menuIds || []).includes(menu.id))
      .map((menu) => menu.restaurant);
    const matchesRestaurant =
      recipeRestaurantFilter === "all" ? true : recipeRestaurants.includes(recipeRestaurantFilter);

    return matchesQuery && matchesCategory && matchesRestaurant;
  });

  const recipeLibraryRows = recipeLibraryBaseRows.filter((item) =>
    recipeStatusFilter === "archived" ? Boolean(item.archived) : !item.archived
  );

  const recipeRows = recipeLibraryRows.filter((item) => {
    if (recipeStatusFilter === "all" || recipeStatusFilter === "archived") return true;
    if (recipeStatusFilter === "needs_attention") {
      return Boolean(item.needsReviewFlag || item.sharedMissingLineCount);
    }
    return item.status === recipeStatusFilter;
  });

  const batchLibraryBaseRows = batches.filter((item) => {
    const query = trimmedSearchQuery;
    if (!query) return true;
    return [item.name, item.code, item.yieldLabel].join(" ").toLowerCase().includes(query);
  });

  const batchLibraryRows = batchLibraryBaseRows.filter((item) =>
    batchStatusFilter === "archived" ? Boolean(item.archived) : !item.archived
  );

  const batchRows = batchLibraryRows.filter((item) => {
    if (batchStatusFilter === "all" || batchStatusFilter === "archived") return true;
    if (batchStatusFilter === "for_review") return Boolean(item.needsReviewFlag);
    if (item.needsReviewFlag) return false;
    return item.status === batchStatusFilter;
  });

  const menuRows = restaurants.filter((item) => {
    const query = trimmedSearchQuery;
    if (!query) return true;
    const restaurantMenuNames = (relationshipMaps?.restaurantMenus?.get(item.id) || [])
      .map((menuId) => recordMaps.menu.get(menuId))
      .filter(Boolean)
      .flatMap((menu) => [menu.name, menu.service]);
    return [
      item.name,
      item.venueType,
      item.servicePattern,
      ...(item.primaryServices || []),
      ...(item.secondaryServices || []),
      ...(item.eventUses || []),
      ...restaurantMenuNames,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const exportRecipeRows = recipes
    .filter((item) => {
      if (item.archived) return false;
      const query = exportSearchQuery.trim().toLowerCase();
      if (!query) return recipeExportMode === "browse";
      return [item.name, item.code, item.category, item.menuDescription, item.status].join(" ").toLowerCase().includes(query);
    })
    .slice(0, 18);
  const exportMenuRows = menus
    .filter((item) => {
      if (item.archived) return false;
      const query = exportSearchQuery.trim().toLowerCase();
      if (!query) return true;
      return [item.name, item.restaurant, item.service, item.status].join(" ").toLowerCase().includes(query);
    })
    .slice(0, 18);
  const exportRows = exportObjectType === "menu" ? exportMenuRows : exportRecipeRows;
  const ingredientExportSummary = {
    total: ingredientMaster.length,
    active: ingredientMaster.filter((item) => !item.archived).length,
    archived: ingredientMaster.filter((item) => item.archived).length,
  };

  const duplicateGroups = useMemo(() => {
    const grouped = ingredientImportRows.reduce((map, row) => {
      if (!row.needsCodeReview || row.published) return map;
      const current = map.get(row.sourceCode) || [];
      current.push(row);
      map.set(row.sourceCode, current);
      return map;
    }, new Map());

    return Array.from(grouped.entries()).map(([sourceCode, rows]) => ({
      sourceCode,
      rows,
      suggestedTargetId: rows.find((row) => row.targetId)?.targetId || "",
      suggestedTargetName: rows.find((row) => row.targetName)?.targetName || "",
      aliasCandidates: dedupeTextList(rows.map((row) => row.aliasCandidate).filter(Boolean)),
      readyCount: rows.filter((row) => row.reviewStatus === "ready").length,
    }));
  }, [ingredientImportRows]);

  const visibleSearchableIngredients = useMemo(
    () =>
      ingredientMaster.filter((item) => {
        const sharedRecordId = String(item.sharedRecordId || "").trim();
        if (item.archived) return false;
        if (sharedRecordId && pendingIngredientDeletionIds.includes(sharedRecordId)) return false;
        if (sharedRecordId && deletedIngredientTombstoneIds.includes(sharedRecordId)) return false;
        return true;
      }),
    [ingredientMaster, pendingIngredientDeletionIds, deletedIngredientTombstoneIds]
  );

  const importSourceResolutions = useMemo(
    () =>
      resolveImportSourceRows(soft1SourceRows, {
        ingredients: ingredientMaster,
        ignoredImportRows,
        resolvedImportRows,
        sourceCodeRedirectState: ingredientSourceCodeRedirectState,
        searchableIngredients: visibleSearchableIngredients,
        searchContext: {
          batchMap: recordMaps.batch,
          sourceRows: soft1SourceRows,
        },
        buildIgnoredImportRowKey,
        isImportRowIgnored,
        isImportRowResolved,
        findAnyImportCoverageOwner,
        findTrustedImportCoverageTarget,
        findLiveImportCoverageTarget,
        isImportCoverageTargetSearchable,
      }),
    [
      soft1SourceRows,
      ingredientMaster,
      ignoredImportRows,
      resolvedImportRows,
      ingredientSourceCodeRedirectState,
      visibleSearchableIngredients,
      recordMaps.batch,
    ]
  );

  const importCoverageIssues = useMemo(() => {
    return (importSourceResolutions || [])
      .map((resolution) => {
        if (resolution.state === "ignored") return null;

        const rowKey = resolution.rowKey;
        const isQueued = ingredientImportRows.some(
          (queueRow) => !queueRow.published && buildIgnoredImportRowKey(queueRow?.sourceCode, queueRow?.rawName) === rowKey
        );
        if (isQueued) return null;

        if (resolution.state !== "coverage_issue" || !resolution.issueKind) return null;

        return {
          id: `${resolution.row?.sourceCode || resolution.row?.rawName}-${resolution.issueKind}`,
          row: resolution.row,
          ingredient: resolution.targetIngredient,
          kind: resolution.issueKind,
        };
      })
      .filter(Boolean);
  }, [
    importSourceResolutions,
    ingredientImportRows,
  ]);

  const importSummary = summarizeImportRows(ingredientImportRows);
  const importSourceSummary = useMemo(
    () =>
      summarizeResolvedImportSourceRows(importSourceResolutions, {
        queueRows: ingredientImportRows,
        buildIgnoredImportRowKey,
      }),
    [importSourceResolutions, ingredientImportRows]
  );

  useEffect(() => {
    if (activeSection !== "substitutions") return;
    const currentStillVisible =
      selectedRecord.type === "ingredient" && substitutionRows.some((opportunity) => opportunity.sourceIngredient.id === selectedRecord.id);
    if (currentStillVisible) return;
    const nextOpportunity = substitutionRows[0] || substitutionOpportunities[0] || null;
    setSelectedImportRowId("");
    setSelectedRecord(nextOpportunity ? { type: "ingredient", id: nextOpportunity.sourceIngredient.id } : { type: "", id: "" });
  }, [activeSection, selectedRecord, substitutionRows, substitutionOpportunities]);

  useEffect(() => {
    if (activeSection !== "exports") return;
    if (exportObjectType === "ingredient") {
      if (selectedRecord.type || selectedRecord.id) {
        setSelectedRecord({ type: "", id: "" });
      }
      return;
    }
    if (exportObjectType === "menu") {
      const currentStillVisible = selectedRecord.type === "menu" && exportMenuRows.some((row) => row.id === selectedRecord.id);
      if (currentStillVisible) return;
      const nextMenu = exportMenuRows[0] || null;
      setSelectedRecord(nextMenu ? { type: "menu", id: nextMenu.id } : { type: "", id: "" });
      return;
    }

    const currentStillVisible = selectedRecord.type === "recipe" && exportRecipeRows.some((row) => row.id === selectedRecord.id);
    if (currentStillVisible) return;
    const nextRecipe = exportRecipeRows[0] || null;
    setSelectedRecord(nextRecipe ? { type: "recipe", id: nextRecipe.id } : { type: "", id: "" });
  }, [activeSection, exportObjectType, exportMenuRows, exportRecipeRows, selectedRecord]);

  const breadcrumbs = useMemo(() => {
    if (selectedImportRow) {
      return ["ingredients", ingredientWorkspaceView, selectedImportRow.rawName];
    }
    if (!selectedData) return [activeSection];
    return [activeSection, selectedRecord.type, selectedData.name || selectedData.restaurant || selectedData.code];
  }, [activeSection, ingredientWorkspaceView, selectedData, selectedImportRow, selectedRecord.type]);

  const currentUserRecord = useMemo(() => {
    if (!authUser) return null;
    return (
      users.find((user) => String(user.id || "").trim() === String(authUser.id || "").trim()) ||
      users.find((user) => String(user.email || "").trim().toLowerCase() === String(authUser.email || "").trim().toLowerCase()) ||
      null
    );
  }, [authUser, users]);
  const currentUserName = useMemo(() => {
    if (!authUser) return "";
    return currentUserRecord?.name || authUser.email || "User";
  }, [authUser, currentUserRecord]);
  const currentUserRole = useMemo(() => {
    return currentUserRecord?.role || "Chef";
  }, [currentUserRecord]);
  const appSwitcherLinks = useMemo(() => getAppSwitcherLinks(), []);

  const currentEditTarget = useMemo(() => {
    if (!supabaseEnabled || !supabase || !authUser) return null;
    if (activeSection === "recipes" && selectedRecord.type === "recipe" && selectedRecord.id) {
      return { entityType: "recipe", entityId: selectedRecord.id };
    }
    if (activeSection === "batches" && selectedRecord.type === "batch" && selectedRecord.id) {
      return { entityType: "batch", entityId: selectedRecord.id };
    }
    if (activeSection === "menus" && selectedRecord.type === "menu" && selectedRecord.id) {
      return { entityType: "menu", entityId: selectedRecord.id };
    }
    return null;
  }, [activeSection, authUser, selectedRecord]);

  const currentEditWarning = useMemo(() => {
    if (!currentEditTarget || !authUser) return "";
    const otherEditors = activeEditSessions.filter((session) => session.user_id !== authUser.id);
    if (!otherEditors.length) return "";
    const names = otherEditors.map((session) => session.user_name || session.user_email || "Another user");
    const entityLabel =
      currentEditTarget.entityType === "recipe"
        ? "recipe"
        : currentEditTarget.entityType === "batch"
          ? "component"
          : "menu";
    if (names.length === 1) {
      return `${names[0]} is also editing this ${entityLabel}. Save carefully to avoid overwriting their changes.`;
    }
    return `${names.join(", ")} are also editing this ${entityLabel}. Save carefully to avoid overwriting their changes.`;
  }, [activeEditSessions, authUser, currentEditTarget]);

  const dirtyIngredientCount = ingredientMaster.filter(
    (ingredient) => ingredient.sharedRecordId && ingredient.sharedDirty && !ingredient.archived
  ).length;
  const pendingIngredientDeletionCount = pendingIngredientDeletionIds.length;
  const readyImportRowCount = ingredientImportRows.filter((row) => row.reviewStatus === "ready" && !row.published).length;
  const dirtyRecipeCount = recipes.filter((recipe) => recipe.sharedDirty && !recipe.archived).length;
  const dirtyBatchCount = batches.filter((batch) => batch.sharedDirty && !batch.archived).length;
  const dirtyMenuCount = menus.filter((menu) => menu.sharedDirty && !menu.archived).length;
  const pendingDeletionCount =
    pendingIngredientDeletionCount + pendingRecipeDeletionIds.length + pendingBatchDeletionIds.length + pendingMenuDeletionIds.length;

  const hasPendingSharedChanges =
    dirtyIngredientCount > 0 ||
    pendingIngredientDeletionCount > 0 ||
    readyImportRowCount > 0 ||
    dirtyRecipeCount > 0 ||
    dirtyBatchCount > 0 ||
    dirtyMenuCount > 0 ||
    pendingDeletionCount > 0;

  const sharedSaveSummary = useMemo(() => {
    const parts = [];
    if (dirtyIngredientCount) parts.push(`${dirtyIngredientCount} ingredient edit${dirtyIngredientCount === 1 ? "" : "s"} need saving`);
    if (pendingIngredientDeletionCount) parts.push(`${pendingIngredientDeletionCount} ingredient delete action${pendingIngredientDeletionCount === 1 ? "" : "s"} syncing`);
    if (readyImportRowCount) parts.push(`${readyImportRowCount} ingredient review row${readyImportRowCount === 1 ? "" : "s"} ready to publish`);
    if (dirtyRecipeCount) parts.push(`${dirtyRecipeCount} recipe edit${dirtyRecipeCount === 1 ? "" : "s"} syncing`);
    if (dirtyBatchCount) parts.push(`${dirtyBatchCount} component edit${dirtyBatchCount === 1 ? "" : "s"} syncing`);
    if (dirtyMenuCount) parts.push(`${dirtyMenuCount} menu edit${dirtyMenuCount === 1 ? "" : "s"} syncing`);
    if (pendingDeletionCount) parts.push(`${pendingDeletionCount} delete action${pendingDeletionCount === 1 ? "" : "s"} syncing`);
    return parts.join(" · ");
  }, [
    dirtyIngredientCount,
    pendingIngredientDeletionCount,
    readyImportRowCount,
    dirtyRecipeCount,
    dirtyBatchCount,
    dirtyMenuCount,
    pendingDeletionCount,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasPendingSharedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingSharedChanges]);

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
          user_name: currentUserName,
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
  }, [authUser, currentEditTarget, currentUserName]);

  if (supabaseEnabled && authLoading) {
    return (
      <SharedDataAuthScreen
        title="Checking shared session"
        message="V2 is set to use shared Supabase data. Checking whether you already have an active session."
        drinksLink={appSwitcherLinks.drinks}
      />
    );
  }

  if (supabaseEnabled && !authUser) {
    return (
      <SharedDataAuthScreen
        title="Sign in to shared data"
        message="Use the same Supabase login as v1 to load the live ingredients, components, recipes, menus, and users into v2."
        email={authEmail}
        password={authPassword}
        setEmail={setAuthEmail}
        setPassword={setAuthPassword}
        error={authError}
        onSubmit={signInToSharedData}
        drinksLink={appSwitcherLinks.drinks}
      />
    );
  }

  if (supabaseEnabled && sharedDataLoading) {
    return (
      <SharedDataAuthScreen
        title="Loading shared workspace"
        message={sharedDataStatus}
        drinksLink={appSwitcherLinks.drinks}
      />
    );
  }

  if (supabaseEnabled && sharedDataLoadFailed) {
    return (
      <SharedDataAuthScreen
        title="Could not load shared workspace"
        message={sharedDataStatus}
        drinksLink={appSwitcherLinks.drinks}
      />
    );
  }

  return (
    <AppErrorBoundary>
    <div className="v2-app">
      <aside className="v2-sidebar">
        <div className="v2-brand">
          <div className="v2-eyebrow">Peligoni</div>
          <h1>Food Ops V2</h1>
          <p>Operations workspace for ingredients, components, recipes, menus, and exports.</p>
        </div>

        <nav className="v2-nav">
          {sections.map((section) => (
            <div key={section.id} className="v2-nav-item">
              {section.groupStart ? <div className="v2-nav-divider" /> : null}
              <button
                type="button"
                className={`v2-nav-button ${activeSection === section.id ? "active" : ""}`}
                onClick={() => {
                  setSectionSelection(section.id);
                }}
              >
                {section.label}
              </button>
            </div>
          ))}
        </nav>

        <div className="v2-sidebar-card">
          <div className="v2-eyebrow">Current area</div>
          <strong>{sectionTitle(activeSection)}</strong>
          <p>{sectionSummary(activeSection)}</p>
          <div className="v2-micro-note">{sharedDataStatus}</div>
        </div>
      </aside>

      <main className="v2-main">
        <header className="v2-header">
          <div>
            <div className="v2-breadcrumbs">{breadcrumbs.join(" / ")}</div>
            <h2>{sectionTitle(activeSection)}</h2>
            <p>{sectionSummary(activeSection)}</p>
          </div>
          <div className="v2-header-actions">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ingredients, recipes, components, menus"
            />
            <a href={appSwitcherLinks.drinks} className="v2-secondary-button">
              Drinks app
            </a>
            {supabaseEnabled ? (
              <button type="button" className="v2-secondary-button" onClick={signOutOfSharedData}>
                Sign out
              </button>
            ) : null}
            <button type="button" className="v2-secondary-button" onClick={goBack} disabled={!history.length}>
              Back
            </button>
          </div>
        </header>

        {supabaseEnabled ? (
          <div className={`v2-inline-callout ${hasPendingSharedChanges ? "warn" : ""}`}>
            <strong>{hasPendingSharedChanges ? "Shared changes pending" : "Shared workspace live"}</strong>
            <span>
              {hasPendingSharedChanges
                ? sharedSaveSummary
                : "Ingredient, recipe, component, and menu record edits sync automatically. Review-queue rows still need Mark ready and Publish approved rows."}
            </span>
          </div>
        ) : null}

        {currentEditWarning ? (
          <div className="v2-inline-callout warn">
            <strong>Live edit warning</strong>
            <span>{currentEditWarning}</span>
          </div>
        ) : null}

        <div className="v2-layout">
          <section className="v2-panel v2-list-panel">
            {activeSection === "queue" ? <QueuePanel openRecord={openRecord} openImportRow={openImportRow} /> : null}
            {activeSection === "ingredients" ? (
              <IngredientsPanel
                rows={ingredientRows}
                allIngredients={ingredientMaster}
                catalogueBaseRows={ingredientCatalogueBaseRows}
                batchMap={recordMaps.batch}
                importRows={ingredientImportRows}
                importSummary={importSummary}
                importSourceSummary={importSourceSummary}
                importCoverageIssues={importCoverageIssues}
                repairImportCoverageIssue={repairImportCoverageIssue}
                duplicateGroups={duplicateGroups}
                workspaceView={ingredientWorkspaceView}
                setWorkspaceView={setIngredientWorkspace}
                selectedRecord={selectedRecord}
                selectedImportRowId={selectedImportRowId}
                openRecord={openRecord}
                openImportRow={openImportRow}
                publishReadyRows={publishReadyRows}
                createVariationGroup={createVariationGroup}
                acceptGroup={acceptGroup}
                discardImportGroup={discardImportGroup}
                openIngredientMaker={openIngredientMaker}
                openIngredientSubstitution={openIngredientSubstitution}
                exportManualIngredients={exportManualIngredients}
                pendingManualIngredientCount={pendingManualIngredientCount}
                learningRules={learningRules}
                ingredientProductFilter={ingredientProductFilter}
                setIngredientProductFilter={setIngredientProductFilter}
                ingredientProductOptions={ingredientProductOptions}
                ingredientSourceFilter={ingredientSourceFilter}
                setIngredientSourceFilter={setIngredientSourceFilter}
                ingredientRecordFilter={ingredientRecordFilter}
                setIngredientRecordFilter={setIngredientRecordFilter}
                ingredientStatusFilter={ingredientStatusFilter}
                setIngredientStatusFilter={setIngredientStatusFilter}
                ingredientRuleCatchupMap={ingredientRuleCatchupMap}
                runIngredientCleanupOverReviewMaster={runIngredientCleanupOverReviewMaster}
                applyRuleCatchupToIngredients={applyRuleCatchupToIngredients}
                buildIngredientReconcileQueue={buildIngredientReconcileQueue}
                bulkMarkIngredientRowsReviewed={bulkMarkIngredientRowsReviewed}
                applySoft1CategorySuggestionsToIngredients={applySoft1CategorySuggestionsToIngredients}
                importSoft1IngredientSlice={importSoft1IngredientSlice}
                resetSoft1IngredientSlice={resetSoft1IngredientSlice}
                bulkDeleteArchivedIngredients={bulkDeleteArchivedIngredients}
                soft1SourceMeta={soft1SourceMeta}
                soft1SourceRows={soft1SourceRows}
                soft1ImportState={soft1ImportState}
                searchQuery={trimmedSearchQuery}
                ingredientParsedIndexMap={ingredientParsedIndexMap}
              />
            ) : null}
            {activeSection === "substitutions" ? (
              <SubstitutionsPanel
                opportunities={substitutionRows}
                selectedRecord={selectedRecord}
                openOpportunity={(ingredientId) => setSelectedRecord({ type: "ingredient", id: ingredientId })}
                substitutionFilter={substitutionFilter}
                setSubstitutionFilter={setSubstitutionFilter}
              />
            ) : null}
            {activeSection === "recipes" ? (
              <RecipesPanel
                rows={recipeRows}
                allRows={recipeLibraryRows}
                baseRows={recipeLibraryBaseRows}
                selectedRecord={selectedRecord}
                openRecord={openRecord}
                createRecipe={createRecipe}
                publishReadyRecipes={publishReadyRecipes}
                maps={recordMaps}
                recipeCategoryFilter={recipeCategoryFilter}
                setRecipeCategoryFilter={setRecipeCategoryFilter}
                recipeCategoryOptions={recipeCategoryOptionsForFilter}
                recipeRestaurantFilter={recipeRestaurantFilter}
                setRecipeRestaurantFilter={setRecipeRestaurantFilter}
                recipeRestaurantOptions={recipeRestaurantOptionsForFilter}
                recipeStatusFilter={recipeStatusFilter}
                setRecipeStatusFilter={setRecipeStatusFilter}
              />
            ) : null}
            {activeSection === "batches" ? (
              <BatchesPanel
                rows={batchRows}
                allRows={batchLibraryRows}
                baseRows={batchLibraryBaseRows}
                selectedRecord={selectedRecord}
                openRecord={openRecord}
                createBatch={createBatch}
                publishReadyBatches={publishReadyBatches}
                batchStatusFilter={batchStatusFilter}
                setBatchStatusFilter={setBatchStatusFilter}
                ingredientMap={recordMaps.ingredient}
              />
            ) : null}
            {activeSection === "menus" ? (
              <MenusPanel
                rows={menuRows}
                selectedRecord={selectedRecord}
                openRecord={openRecord}
                relationshipMaps={relationshipMaps}
                maps={recordMaps}
                createMenuForRestaurant={openMenuMaker}
              />
            ) : null}
            {activeSection === "exports" ? (
              <ExportsPanel
                exportObjectType={exportObjectType}
                setExportObjectType={setExportObjectType}
                exportSearchQuery={exportSearchQuery}
                setExportSearchQuery={setExportSearchQuery}
                recipeExportMode={recipeExportMode}
                setRecipeExportMode={setRecipeExportMode}
                rows={exportRows}
                ingredientExportSummary={ingredientExportSummary}
                selectedRecord={selectedRecord}
                selectExportRecord={(type, id) => setSelectedRecord({ type, id })}
              />
            ) : null}
            {activeSection === "settings" ? (
              <SettingsPanel
                learningRules={learningRules}
                exportLearningRules={exportLearningRules}
                learningRulesSyncState={learningRulesSyncState}
                learningRulesSyncMessage={learningRulesSyncMessage}
                updateLearningRule={updateLearningRule}
                deleteLearningRule={deleteLearningRule}
                users={users}
                addUser={addUser}
                updateUser={updateUser}
                toggleUserStatus={toggleUserStatus}
                userSyncState={userSyncState}
                userSyncMessage={userSyncMessage}
                currentUserRole={currentUserRole}
              />
            ) : null}
          </section>

          <section className="v2-panel v2-detail-panel">
            {selectedImportRow ? (
              <ImportRowDetail
                row={selectedImportRow}
                ingredients={ingredientMaster}
                productCategoryOptions={ingredientCategoryOptions}
                tradeCategoryOptions={ingredientTradeCategoryOptions}
                batchMap={recordMaps.batch}
                assignImportTarget={assignImportTarget}
                setImportRowStrategy={setImportRowStrategy}
                updateImportField={updateImportField}
                updateImportIndexPart={updateImportIndexPart}
                useSuggestedName={useSuggestedName}
                learningCandidates={selectedLearningCandidates}
                saveLearningRulesFromRow={saveLearningRulesFromRow}
                applyRowFieldsToSimilar={applyRowFieldsToSimilar}
                createVariationForRow={createVariationForRow}
                generateImportRowInternalCode={generateImportRowInternalCode}
                acceptSuggestion={acceptSuggestion}
                removeIngredientFromReviewQueue={removeIngredientFromReviewQueue}
                discardImportRow={discardImportRow}
                ignoreImportRowPermanently={ignoreImportRowPermanently}
                openRecord={openRecord}
                moveIngredientToBatchDraft={moveIngredientToBatchDraft}
                toggleIngredientReviewFlag={toggleIngredientReviewFlag}
                archiveIngredient={archiveIngredient}
                openIngredientSubstitution={openIngredientSubstitution}
              />
            ) : activeSection === "substitutions" && selectedSubstitutionOpportunity ? (
              <SubstitutionsDetail
                opportunity={selectedSubstitutionOpportunity}
                openIngredientSubstitution={openIngredientSubstitution}
                openRecord={openRecord}
              />
            ) : activeSection === "exports" && exportObjectType === "ingredient" ? (
              <ExportDetail
                record={ingredientExportSummary}
                recordType="ingredient_master"
                maps={recordMaps}
                openRecipeCostSheetPreview={openRecipeCostSheetPreview}
                openRecipeChefSheetPreview={openRecipeChefSheetPreview}
                openMenuSheetPreview={openMenuSheetPreview}
                openMenuBulkCostSheetPreview={openMenuBulkCostSheetPreview}
                openIngredientMasterExportPreview={openIngredientMasterExportPreview}
              />
            ) : activeSection === "exports" && selectedData ? (
              <ExportDetail
                record={selectedData}
                recordType={selectedRecord.type}
                maps={recordMaps}
                openRecipeCostSheetPreview={openRecipeCostSheetPreview}
                openRecipeChefSheetPreview={openRecipeChefSheetPreview}
                openMenuSheetPreview={openMenuSheetPreview}
                openMenuBulkCostSheetPreview={openMenuBulkCostSheetPreview}
                openIngredientMasterExportPreview={openIngredientMasterExportPreview}
              />
            ) : selectedData ? (
              <RecordDetail
                record={selectedData}
                recordType={selectedRecord.type}
                openRecord={openRecord}
                maps={recordMaps}
                relationshipMaps={relationshipMaps}
                recipeEditorStep={recipeEditorStep}
                setRecipeEditorStep={setRecipeEditorStep}
                batchEditorStep={batchEditorStep}
                setBatchEditorStep={setBatchEditorStep}
                menuEditorStep={menuEditorStep}
                setMenuEditorStep={setMenuEditorStep}
                ingredientMaster={trustedIngredientMaster}
                ingredientCategoryOptions={ingredientCategoryOptions}
                ingredientTradeCategoryOptions={ingredientTradeCategoryOptions}
                batches={batches}
                updateRecipeField={updateRecipeField}
                markRecipeReady={markRecipeReady}
                publishRecipeLive={publishRecipeLive}
                moveRecipeToDraft={moveRecipeToDraft}
                unpublishRecipe={unpublishRecipe}
                toggleRecipeServiceSuitability={toggleRecipeServiceSuitability}
                updateRecipeFinishedDishImage={updateRecipeFinishedDishImage}
                updateRecipeMethodStep={updateRecipeMethodStep}
                addRecipeMethodStep={addRecipeMethodStep}
                saveRecipeToSharedData={saveRecipeToSharedData}
                recipeSharedSyncState={selectedRecord.type === "recipe" ? recipeSharedSyncState[selectedRecord.id] || "" : ""}
                toggleRecipeReviewFlag={toggleRecipeReviewFlag}
                updateRecipeIngredientLine={updateRecipeIngredientLine}
              updateRecipeBatchLine={updateRecipeBatchLine}
              toggleRecipeIngredientLink={toggleRecipeIngredientLink}
              toggleRecipeBatchLink={toggleRecipeBatchLink}
              openIngredientMaker={openIngredientMaker}
              openIngredientSubstitution={openIngredientSubstitution}
              openIngredientMerge={openIngredientMerge}
	              openRecipeCostSheetPreview={openRecipeCostSheetPreview}
	              openRecipeChefSheetPreview={openRecipeChefSheetPreview}
	              openBatchCostSheetPreview={openBatchCostSheetPreview}
	              openBatchChefSheetPreview={openBatchChefSheetPreview}
	              learningRules={learningRules}
	              ingredientRuleCatchupMap={ingredientRuleCatchupMap}
	              updateIngredientField={updateIngredientField}
                updateIngredientAliases={updateIngredientAliases}
                generateIngredientCode={generateIngredientCode}
                ingredientCodeAlert={selectedRecord.type === "ingredient" ? ingredientCodeAlerts[selectedRecord.id] || "" : ""}
                ingredientSharedSyncState={selectedRecord.type === "ingredient" ? ingredientSharedSyncState[selectedRecord.id] || "" : ""}
                ingredientEditingId={ingredientEditingId}
                unlockIngredientEditing={unlockIngredientEditing}
                lockIngredientEditing={lockIngredientEditing}
                markIngredientMasterReviewed={markIngredientMasterReviewed}
                moveIngredientToMasterReview={moveIngredientToMasterReview}
                moveIngredientToBatchDraft={moveIngredientToBatchDraft}
                toggleIngredientReviewFlag={toggleIngredientReviewFlag}
                toggleIngredientSubstitutionReview={toggleIngredientSubstitutionReview}
                markIngredientManualReviewDone={markIngredientManualReviewDone}
                syncIngredientToSharedData={syncIngredientToSharedData}
                updateBatchField={updateBatchField}
                updateBatchIngredientLine={updateBatchIngredientLine}
                toggleBatchIngredientLink={toggleBatchIngredientLink}
                applyMissingSharedBatchIngredientSuggestion={applyMissingSharedBatchIngredientSuggestion}
                updateBatchMethodStep={updateBatchMethodStep}
                addBatchMethodStep={addBatchMethodStep}
                saveBatchToSharedData={saveBatchToSharedData}
                batchSharedSyncState={selectedRecord.type === "batch" ? batchSharedSyncState[selectedRecord.id] || "" : ""}
                toggleBatchReviewFlag={toggleBatchReviewFlag}
                markBatchReady={markBatchReady}
                moveBatchToDraft={moveBatchToDraft}
                returnBatchToReady={returnBatchToReady}
                publishBatchToIngredient={publishBatchToIngredient}
                deleteBatchAndPublishedIngredient={deleteBatchAndPublishedIngredient}
                deletePublishedIngredientFromBatch={deletePublishedIngredientFromBatch}
                movePublishedIngredientRecipesToDraft={movePublishedIngredientRecipesToDraft}
                convertBatchToRecipeDraft={convertBatchToRecipeDraft}
                archiveIngredient={archiveIngredient}
                restoreIngredient={restoreIngredient}
                deleteIngredientPermanently={deleteIngredientPermanently}
                archiveRecipe={archiveRecipe}
                restoreRecipe={restoreRecipe}
                deleteRecipePermanently={deleteRecipePermanently}
                archiveBatch={archiveBatch}
                restoreBatch={restoreBatch}
                deleteBatchPermanently={deleteBatchPermanently}
                archiveMenu={archiveMenu}
                restoreMenu={restoreMenu}
                deleteMenuPermanently={deleteMenuPermanently}
                saveMenuToSharedData={saveMenuToSharedData}
                menuSharedSyncState={selectedRecord.type === "menu" ? menuSharedSyncState[selectedRecord.id] || "" : ""}
                createMenuForRestaurant={openMenuMaker}
                openRecipePreview={openRecordPreview}
                openMenuPreview={openMenuPreview}
                approveMenu={approveMenu}
                publishMenuLive={publishMenuLive}
                returnMenuToDraft={returnMenuToDraft}
              updateMenuField={updateMenuField}
              addMenuItem={addMenuItem}
              updateMenuItemField={updateMenuItemField}
              selectMenuItemRecipe={selectMenuItemRecipe}
              createDraftRecipeForMenuItem={createDraftRecipeForMenuItem}
              removeMenuItem={removeMenuItem}
            />
            ) : (
              <EmptyDetail />
            )}
          </section>
        </div>

        {ingredientMakerModal.isOpen ? (
          <IngredientMakerModal
            draft={ingredientMakerModal.draft}
            productCategoryOptions={ingredientCategoryOptions}
            tradeCategoryOptions={ingredientTradeCategoryOptions}
            onFieldChange={updateIngredientMakerField}
            onAliasesChange={updateIngredientMakerAliases}
            onGenerateCode={generateIngredientMakerCode}
            codeConflict={ingredientMakerCodeConflict}
            onClose={closeIngredientMaker}
            onSave={saveIngredientMaker}
          />
        ) : null}

        {ingredientSubstitutionModal.isOpen && ingredientSubstitutionSource ? (
          <IngredientSubstitutionModal
            sourceIngredient={ingredientSubstitutionSource}
            replacementIngredient={ingredientSubstitutionReplacement}
            trustedIngredients={trustedIngredientMaster.filter((ingredient) => ingredient.id !== ingredientSubstitutionSource.id)}
            impact={ingredientSubstitutionImpact}
            archiveOriginal={ingredientSubstitutionModal.archiveOriginal}
            onFieldChange={updateIngredientSubstitutionField}
            onClose={closeIngredientSubstitution}
            onApply={applyIngredientSubstitution}
          />
        ) : null}

        {ingredientMergeModal.isOpen && ingredientMergeSource ? (
          <IngredientMergeModal
            sourceIngredient={ingredientMergeSource}
            targetIngredient={ingredientMergeTarget}
            trustedIngredients={trustedIngredientMaster.filter(
              (ingredient) => ingredient.id !== ingredientMergeSource.id && !ingredient.batchId
            )}
            impact={ingredientMergeImpact}
            onFieldChange={updateIngredientMergeField}
            onClose={closeIngredientMerge}
            onApply={applyIngredientMerge}
          />
        ) : null}

        {menuMakerModal.isOpen && menuMakerModal.draft ? (
          <MenuMakerModal
            restaurant={restaurants.find((item) => item.id === menuMakerModal.restaurantId) || null}
            draft={menuMakerModal.draft}
            serviceOptions={getRestaurantServicePool(
              restaurants.find((item) => item.id === menuMakerModal.restaurantId) || {}
            )}
            onFieldChange={updateMenuMakerField}
            onClose={closeMenuMaker}
            onSave={saveMenuMaker}
          />
        ) : null}

        {recordPreviewModal.isOpen && recordPreviewModal.type === "recipe" && recordMaps.recipe.has(recordPreviewModal.id) ? (
          <div className="v2-modal-shell">
            <button type="button" className="v2-picker-backdrop" onClick={closeRecordPreview} aria-label="Close recipe preview" />
            <div className="v2-modal-panel v2-modal-panel-wide">
              <div className="v2-panel-header">
                <div>
                  <div className="v2-eyebrow">Recipe pop-out</div>
                  <h3>{recordMaps.recipe.get(recordPreviewModal.id)?.name || "Recipe"}</h3>
                </div>
                <button type="button" className="v2-secondary-button" onClick={closeRecordPreview}>
                  Close
                </button>
              </div>
              <RecordDetail
                record={recordMaps.recipe.get(recordPreviewModal.id)}
                recordType="recipe"
                openRecord={openRecord}
                maps={recordMaps}
                relationshipMaps={relationshipMaps}
                recipeEditorStep={recipeEditorStep}
                setRecipeEditorStep={setRecipeEditorStep}
                batchEditorStep={batchEditorStep}
                setBatchEditorStep={setBatchEditorStep}
                menuEditorStep={menuEditorStep}
                setMenuEditorStep={setMenuEditorStep}
                ingredientMaster={trustedIngredientMaster}
                batches={batches}
                updateRecipeField={updateRecipeField}
                markRecipeReady={markRecipeReady}
                publishRecipeLive={publishRecipeLive}
                moveRecipeToDraft={moveRecipeToDraft}
                unpublishRecipe={unpublishRecipe}
                toggleRecipeServiceSuitability={toggleRecipeServiceSuitability}
                updateRecipeFinishedDishImage={updateRecipeFinishedDishImage}
                updateRecipeMethodStep={updateRecipeMethodStep}
                addRecipeMethodStep={addRecipeMethodStep}
                saveRecipeToSharedData={saveRecipeToSharedData}
                recipeSharedSyncState={recordPreviewModal.type === "recipe" ? recipeSharedSyncState[recordPreviewModal.id] || "" : ""}
                toggleRecipeReviewFlag={toggleRecipeReviewFlag}
                updateRecipeIngredientLine={updateRecipeIngredientLine}
                updateRecipeBatchLine={updateRecipeBatchLine}
                toggleRecipeIngredientLink={toggleRecipeIngredientLink}
                toggleRecipeBatchLink={toggleRecipeBatchLink}
                openIngredientMaker={openIngredientMaker}
                openIngredientMerge={openIngredientMerge}
	                openRecipeCostSheetPreview={openRecipeCostSheetPreview}
	                openRecipeChefSheetPreview={openRecipeChefSheetPreview}
	                openBatchCostSheetPreview={openBatchCostSheetPreview}
	                openBatchChefSheetPreview={openBatchChefSheetPreview}
	                learningRules={learningRules}
	                ingredientRuleCatchupMap={ingredientRuleCatchupMap}
	                updateIngredientField={updateIngredientField}
                updateIngredientAliases={updateIngredientAliases}
                generateIngredientCode={generateIngredientCode}
                ingredientCodeAlert=""
                ingredientSharedSyncState=""
                ingredientEditingId={ingredientEditingId}
                unlockIngredientEditing={unlockIngredientEditing}
                lockIngredientEditing={lockIngredientEditing}
                markIngredientMasterReviewed={markIngredientMasterReviewed}
                moveIngredientToMasterReview={moveIngredientToMasterReview}
                moveIngredientToBatchDraft={moveIngredientToBatchDraft}
                toggleIngredientReviewFlag={toggleIngredientReviewFlag}
                toggleIngredientSubstitutionReview={toggleIngredientSubstitutionReview}
                syncIngredientToSharedData={syncIngredientToSharedData}
                updateBatchField={updateBatchField}
                updateBatchIngredientLine={updateBatchIngredientLine}
                toggleBatchIngredientLink={toggleBatchIngredientLink}
                applyMissingSharedBatchIngredientSuggestion={applyMissingSharedBatchIngredientSuggestion}
                updateBatchMethodStep={updateBatchMethodStep}
                addBatchMethodStep={addBatchMethodStep}
                saveBatchToSharedData={saveBatchToSharedData}
                batchSharedSyncState={recordPreviewModal.type === "batch" ? batchSharedSyncState[recordPreviewModal.id] || "" : ""}
                toggleBatchReviewFlag={toggleBatchReviewFlag}
                markBatchReady={markBatchReady}
                moveBatchToDraft={moveBatchToDraft}
                returnBatchToReady={returnBatchToReady}
                publishBatchToIngredient={publishBatchToIngredient}
                deleteBatchAndPublishedIngredient={deleteBatchAndPublishedIngredient}
                deletePublishedIngredientFromBatch={deletePublishedIngredientFromBatch}
                toggleIngredientSubstitutionReview={toggleIngredientSubstitutionReview}
                movePublishedIngredientRecipesToDraft={movePublishedIngredientRecipesToDraft}
                convertBatchToRecipeDraft={convertBatchToRecipeDraft}
                archiveIngredient={archiveIngredient}
                restoreIngredient={restoreIngredient}
                deleteIngredientPermanently={deleteIngredientPermanently}
                archiveRecipe={archiveRecipe}
                restoreRecipe={restoreRecipe}
                deleteRecipePermanently={deleteRecipePermanently}
                archiveBatch={archiveBatch}
                restoreBatch={restoreBatch}
                deleteBatchPermanently={deleteBatchPermanently}
                archiveMenu={archiveMenu}
                restoreMenu={restoreMenu}
                deleteMenuPermanently={deleteMenuPermanently}
                saveMenuToSharedData={saveMenuToSharedData}
                menuSharedSyncState={recordPreviewModal.type === "menu" ? menuSharedSyncState[recordPreviewModal.id] || "" : ""}
                createMenuForRestaurant={openMenuMaker}
                openRecipePreview={openRecordPreview}
                openMenuPreview={openMenuPreview}
                approveMenu={approveMenu}
                publishMenuLive={publishMenuLive}
                returnMenuToDraft={returnMenuToDraft}
                updateMenuField={updateMenuField}
                addMenuItem={addMenuItem}
                updateMenuItemField={updateMenuItemField}
                selectMenuItemRecipe={selectMenuItemRecipe}
                createDraftRecipeForMenuItem={createDraftRecipeForMenuItem}
                removeMenuItem={removeMenuItem}
              />
            </div>
          </div>
        ) : null}

        {menuPreviewModal.isOpen && recordMaps.menu.has(menuPreviewModal.id) ? (
          <MenuPreviewModal
            menu={recordMaps.menu.get(menuPreviewModal.id)}
            recipeMap={recordMaps.recipe}
            onClose={closeMenuPreview}
          />
        ) : null}

        {exportPreviewModal.isOpen ? (
          <ExportPreviewModal
            title={exportPreviewModal.title}
            html={exportPreviewModal.html}
            csvContent={exportPreviewModal.csvContent}
            onClose={closeExportPreview}
            onDownloadCsv={downloadExportPreviewCsv}
            onPrint={printExportPreview}
          />
        ) : null}
      </main>
    </div>
    </AppErrorBoundary>
  );
}

function QueuePanel({ openRecord, openImportRow }) {
  const items = [
    {
      id: "q1",
      title: "Branded gluten-free naming needs review",
      note: "Papadopoulos and Schar rows are strong tests for brand plus dietary indexing.",
      action: () => openImportRow("raw-1"),
    },
    {
      id: "q2",
      title: "Pantry ingredient parsing should be checked",
      note: "Flour and yeast rows test brand, product type, and pack-size handling.",
      action: () => openImportRow("raw-6"),
    },
    {
      id: "q3",
      title: "Dietary classification needs approval",
      note: "Vegan cheese and dessert rows help test dietary indexing beyond gluten-free.",
      action: () => openImportRow("raw-9"),
    },
  ];

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Review Queue</div>
          <h3>What needs action first</h3>
        </div>
      </div>
      <div className="v2-stack">
        {items.map((item) => (
          <button key={item.id} type="button" className="v2-card-button" onClick={item.action}>
            <strong>{item.title}</strong>
            <span>{item.note}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function IngredientsPanel({
  rows,
  allIngredients,
  catalogueBaseRows,
  batchMap,
  importRows,
  importSummary,
  importSourceSummary,
  importCoverageIssues,
  repairImportCoverageIssue,
  duplicateGroups,
  workspaceView,
  setWorkspaceView,
  selectedRecord,
  selectedImportRowId,
  openRecord,
  openImportRow,
  publishReadyRows,
  createVariationGroup,
  acceptGroup,
  discardImportGroup,
  openIngredientMaker,
  exportManualIngredients,
  pendingManualIngredientCount,
  learningRules,
  ingredientProductFilter,
  setIngredientProductFilter,
  ingredientProductOptions,
  ingredientSourceFilter,
  setIngredientSourceFilter,
  ingredientRecordFilter,
  setIngredientRecordFilter,
  ingredientStatusFilter,
  setIngredientStatusFilter,
  ingredientRuleCatchupMap,
  runIngredientCleanupOverReviewMaster,
  applyRuleCatchupToIngredients,
  buildIngredientReconcileQueue,
  bulkMarkIngredientRowsReviewed,
  applySoft1CategorySuggestionsToIngredients,
  importSoft1IngredientSlice,
  resetSoft1IngredientSlice,
  bulkDeleteArchivedIngredients,
  soft1SourceMeta,
  soft1SourceRows,
  soft1ImportState,
  searchQuery,
  ingredientParsedIndexMap,
}) {
  const [importStatusFilter, setImportStatusFilter] = useState("all");
  const importFileInputRef = useRef(null);
  const panelState = useMemo(
    () =>
      buildIngredientsPanelState({
        rows,
        allIngredients,
        catalogueBaseRows,
        importRows,
        pendingManualIngredientCount,
        workspaceView,
        searchQuery,
        ingredientRecordFilter,
        ingredientRuleCatchupMap,
        getIngredientReviewAttentionReasons,
        isLikelySoft1IngredientCode,
        getSoft1CodeCategorySuggestion,
        normalizeIngredientKey,
        isWeakIngredientCategory,
      }),
    [
      rows,
      allIngredients,
      catalogueBaseRows,
      importRows,
      pendingManualIngredientCount,
      workspaceView,
      searchQuery,
      ingredientRecordFilter,
      ingredientRuleCatchupMap,
    ]
  );
  const {
    query,
    isCatalogueView,
    activeCatalogueCount,
    rowNeedsManualReview,
    rowNeedsPriceReview,
    rowNeedsRuleCatchup,
    simpleCatalogueCount,
    componentDerivedCatalogueCount,
    allCatalogueCount,
    archivedCatalogueCount,
    forReviewCatalogueCount,
    manualReviewCatalogueCount,
    priceReviewCatalogueCount,
    ruleCatchupCatalogueCount,
    visibleRuleCatchupRowIds,
    visibleArchivedRowIds,
    catalogueActionLabel,
    ingredientById,
    soft1CategorySuggestionCount,
    buildReviewListRows,
    buildBulkReviewableRowIds,
    buildBulkSimpleSoft1RowIds,
  } = panelState;
  const reviewListRows = useMemo(() => buildReviewListRows(importStatusFilter), [buildReviewListRows, importStatusFilter]);
  const bulkReviewableRowIds = useMemo(() => buildBulkReviewableRowIds(reviewListRows), [buildBulkReviewableRowIds, reviewListRows]);
  const bulkSimpleSoft1RowIds = useMemo(
    () => buildBulkSimpleSoft1RowIds(reviewListRows),
    [buildBulkSimpleSoft1RowIds, reviewListRows]
  );

  const applyImportFilter = (filter) => {
    setImportStatusFilter(filter);
    if (filter === "conflicts") {
      setWorkspaceView("conflicts");
      return;
    }
    setWorkspaceView("review");
  };

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Ingredients</div>
          <h3>{isCatalogueView ? "Ingredient master" : "Review import"}</h3>
        </div>
        <div className="v2-link-list">
          {isCatalogueView ? (
            <>
              <button type="button" className="v2-primary-button" onClick={() => openIngredientMaker()}>
                Add new
              </button>
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => applyRuleCatchupToIngredients(visibleRuleCatchupRowIds)}
                disabled={!visibleRuleCatchupRowIds.length}
              >
                {visibleRuleCatchupRowIds.length
                  ? `Refresh visible from rules (${visibleRuleCatchupRowIds.length})`
                  : "Refresh visible from rules"}
              </button>
              <button
                type="button"
                className="v2-secondary-button"
                onClick={applySoft1CategorySuggestionsToIngredients}
                disabled={!soft1CategorySuggestionCount}
              >
                {soft1CategorySuggestionCount
                  ? `Apply Soft1 categories (${soft1CategorySuggestionCount})`
                  : "Apply Soft1 categories"}
              </button>
              <button
                type="button"
                className="v2-secondary-button"
                onClick={exportManualIngredients}
                disabled={!pendingManualIngredientCount}
              >
                {catalogueActionLabel}
              </button>
            </>
          ) : (
            <>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  await importSoft1IngredientSlice(file);
                  event.target.value = "";
                }}
              />
              <button type="button" className="v2-primary-button" onClick={runIngredientCleanupOverReviewMaster}>
                Run cleanup suggestions
              </button>
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => importFileInputRef.current?.click()}
              >
                Import Soft1 slice
              </button>
              <button
                type="button"
                className="v2-secondary-button"
                onClick={resetSoft1IngredientSlice}
                disabled={!soft1SourceMeta?.imported}
              >
                Reset source
              </button>
              {workspaceView === "review" && importStatusFilter !== "ready" ? (
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => promoteSimpleSoft1RowsToMaster(bulkSimpleSoft1RowIds)}
                  disabled={!bulkSimpleSoft1RowIds.length}
                >
                  {bulkSimpleSoft1RowIds.length
                    ? `Move simple Soft1 to master (${bulkSimpleSoft1RowIds.length})`
                    : "Move simple Soft1 to master"}
                </button>
              ) : null}
              {workspaceView === "review" && importStatusFilter !== "ready" ? (
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => bulkMarkIngredientRowsReviewed(bulkReviewableRowIds)}
                  disabled={!bulkReviewableRowIds.length}
                >
                  {bulkReviewableRowIds.length
                    ? `Mark visible reviewed (${bulkReviewableRowIds.length})`
                    : "Mark visible reviewed"}
                </button>
              ) : null}
              <button type="button" className="v2-secondary-button" onClick={buildIngredientReconcileQueue}>
                Refresh review queue
              </button>
            </>
          )}
        </div>
      </div>

      <div className="v2-workspace-switch">
        <button
          type="button"
          className={`v2-pill ${workspaceView === "catalogue" ? "active" : ""}`}
          onClick={() => setWorkspaceView("catalogue")}
        >
          Master list
        </button>
        <button
          type="button"
          className={`v2-pill ${workspaceView === "attention" ? "active" : ""}`}
          onClick={() => setWorkspaceView("attention")}
        >
          Import issues
        </button>
        <button
          type="button"
          className={`v2-pill ${workspaceView === "review" ? "active" : ""}`}
          onClick={() => setWorkspaceView("review")}
        >
          Review import
        </button>
        <button
          type="button"
          className={`v2-pill ${workspaceView === "conflicts" ? "active" : ""}`}
          onClick={() => setWorkspaceView("conflicts")}
        >
          Duplicate codes
        </button>
      </div>

      {!isCatalogueView ? (
        <IngredientsImportSummaryCards
          importSourceSummary={importSourceSummary}
          importSummary={importSummary}
          workspaceView={workspaceView}
          importStatusFilter={importStatusFilter}
          applyImportFilter={applyImportFilter}
        />
      ) : null}

      {workspaceView === "review" ? (
        <IngredientsReviewWorkspace
          soft1SourceMeta={soft1SourceMeta}
          importSourceSummary={importSourceSummary}
          importSummary={importSummary}
          importCoverageIssues={importCoverageIssues}
          soft1ImportState={soft1ImportState}
          importStatusFilter={importStatusFilter}
          publishReadyRows={publishReadyRows}
          reviewListRows={reviewListRows}
          ingredientById={ingredientById}
          selectedImportRowId={selectedImportRowId}
          openImportRow={openImportRow}
        />
      ) : null}

      {workspaceView === "attention" ? (
        <IngredientsImportIssuesWorkspace
          importCoverageIssues={importCoverageIssues}
          importRows={importRows}
          selectedImportRowId={selectedImportRowId}
          openImportRow={openImportRow}
          openRecord={openRecord}
          repairImportCoverageIssue={repairImportCoverageIssue}
        />
      ) : null}

      {workspaceView === "conflicts" ? (
        <IngredientsDuplicateCodesWorkspace
          duplicateGroups={duplicateGroups}
          query={query}
          createVariationGroup={createVariationGroup}
          acceptGroup={acceptGroup}
          discardImportGroup={discardImportGroup}
          openImportRow={openImportRow}
          openRecord={openRecord}
        />
      ) : null}

      {workspaceView === "catalogue" ? (
        <IngredientsCatalogueWorkspace
          pendingManualIngredientCount={pendingManualIngredientCount}
          ingredientRecordFilter={ingredientRecordFilter}
          setIngredientRecordFilter={setIngredientRecordFilter}
          allCatalogueCount={allCatalogueCount}
          simpleCatalogueCount={simpleCatalogueCount}
          componentDerivedCatalogueCount={componentDerivedCatalogueCount}
          ingredientStatusFilter={ingredientStatusFilter}
          setIngredientStatusFilter={setIngredientStatusFilter}
          forReviewCatalogueCount={forReviewCatalogueCount}
          manualReviewCatalogueCount={manualReviewCatalogueCount}
          priceReviewCatalogueCount={priceReviewCatalogueCount}
          ruleCatchupCatalogueCount={ruleCatchupCatalogueCount}
          archivedCatalogueCount={archivedCatalogueCount}
          ingredientProductFilter={ingredientProductFilter}
          setIngredientProductFilter={setIngredientProductFilter}
          ingredientProductOptions={ingredientProductOptions}
          ingredientSourceFilter={ingredientSourceFilter}
          setIngredientSourceFilter={setIngredientSourceFilter}
          visibleArchivedRowIds={visibleArchivedRowIds}
          bulkDeleteArchivedIngredients={bulkDeleteArchivedIngredients}
          rows={rows}
          rowNeedsManualReview={rowNeedsManualReview}
          rowNeedsPriceReview={rowNeedsPriceReview}
          rowNeedsRuleCatchup={rowNeedsRuleCatchup}
          learningRules={learningRules}
          soft1SourceRows={soft1SourceRows}
          ingredientRuleCatchupMap={ingredientRuleCatchupMap}
          ingredientParsedIndexMap={ingredientParsedIndexMap}
          batchMap={batchMap}
          selectedRecord={selectedRecord}
          openRecord={openRecord}
        />
      ) : null}
    </>
  );
}

const IngredientsImportSummaryCards = memo(function IngredientsImportSummaryCards({
  importSourceSummary,
  importSummary,
  workspaceView,
  importStatusFilter,
  applyImportFilter,
}) {
  return (
    <div className="v2-summary-grid v2-summary-grid-library">
      <SummaryCard
        label="Loaded source rows"
        value={String(importSourceSummary?.totalSourceRows || 0)}
        tone="default"
      />
      <SummaryCard
        label="Rows needing action"
        value={String(importSummary.reviewCount)}
        tone="warn"
        active={workspaceView === "review" && importStatusFilter === "review"}
        onClick={() => applyImportFilter("review")}
      />
      <SummaryCard
        label="Approved"
        value={String(importSummary.readyCount)}
        tone="good"
        active={workspaceView === "review" && importStatusFilter === "ready"}
        onClick={() => applyImportFilter("ready")}
      />
      <SummaryCard
        label="Already covered"
        value={String(importSourceSummary?.filteredOutCount || 0)}
        tone="default"
      />
      <SummaryCard
        label="Duplicate source codes"
        value={String(importSummary.codeConflictCount)}
        tone="warn"
        active={workspaceView === "conflicts"}
        onClick={() => applyImportFilter("conflicts")}
      />
    </div>
  );
});

const IngredientsReviewWorkspace = memo(function IngredientsReviewWorkspace({
  soft1SourceMeta,
  importSourceSummary,
  importSummary,
  importCoverageIssues,
  soft1ImportState,
  importStatusFilter,
  publishReadyRows,
  reviewListRows,
  ingredientById,
  selectedImportRowId,
  openImportRow,
}) {
  return (
    <div className="v2-stack">
      <div className="v2-inline-callout">
        <strong>
          Source rows: {soft1SourceMeta?.label || "Bundled sample"}
          {soft1SourceMeta?.sheet ? ` / ${soft1SourceMeta.sheet}` : ""}
        </strong>
        <span>
          Loaded {importSourceSummary?.totalSourceRows || 0} Soft1 ingredient row
          {importSourceSummary?.totalSourceRows === 1 ? "" : "s"}.
          {importSourceSummary?.representedCount
            ? ` ${importSourceSummary.representedCount} ${importSourceSummary.representedCount === 1 ? "is" : "are"} already represented in master.`
            : ""}
          {importSourceSummary?.resolvedCount
            ? ` ${importSourceSummary.resolvedCount} ${importSourceSummary.resolvedCount === 1 ? "has" : "have"} already been accepted into master from this source.`
            : ""}
          {importSourceSummary?.ignoredCount
            ? ` ${importSourceSummary.ignoredCount} ${importSourceSummary.ignoredCount === 1 ? "has" : "have"} been deleted from future imports.`
            : ""}
          {importSummary.reviewCount
            ? ` ${importSummary.reviewCount} ${importSummary.reviewCount === 1 ? "row still needs" : "rows still need"} review.`
            : " No source rows currently need review."}
          {importSummary.readyCount
            ? ` ${importSummary.readyCount} ${importSummary.readyCount === 1 ? "row is" : "rows are"} approved and waiting to publish.`
            : ""}
          {importSourceSummary?.reconcileQueueCount
            ? ` ${importSourceSummary.reconcileQueueCount} live ${importSourceSummary.reconcileQueueCount === 1 ? "ingredient is" : "ingredients are"} also flagged for review.`
            : ""}
          {importCoverageIssues?.length
            ? ` ${importCoverageIssues.length} covered ${importCoverageIssues.length === 1 ? "row has" : "rows have"} a coverage issue and should be checked in Import issues.`
            : ""}
          {soft1ImportState ? ` ${soft1ImportState}` : ""}
        </span>
      </div>
      {importStatusFilter === "ready" ? (
        <div className="v2-link-list">
          <button type="button" className="v2-primary-button" onClick={publishReadyRows} disabled={!importSummary.readyCount}>
            Publish approved rows
          </button>
        </div>
      ) : null}
      {reviewListRows.map((row) => {
        const linkedIngredient = row.existingIngredientId ? ingredientById.get(row.existingIngredientId) || null : null;
        const hasLinkedComponentDraft = Boolean(linkedIngredient?.batchId);
        const actionLabel =
          row.strategy === "merge"
            ? `merge to ${row.targetName || "choose target"}`
            : row.strategy === "update"
              ? "update current ingredient"
              : "new clean ingredient";
        const needsAttention = row.confidenceLabel !== "High confidence";
        const ruleSummary = (row.appliedLearningRules || [])
          .map((rule) => rule.label)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ");
        const tradeCategoryLabel = (row.tradeCategory || linkedIngredient?.tradeCategory || "").trim();
        return (
          <button
            key={row.id}
            type="button"
            className={`v2-record-row ${selectedImportRowId === row.id ? "active" : ""}`}
            onClick={() => openImportRow(row.id, "review")}
          >
            <div>
              <strong>{row.chosenName}</strong>
              <div className="v2-tag-row">
                {row.sourceCode ? <span className="v2-tag">{row.sourceCode}</span> : null}
                {tradeCategoryLabel ? <span className="v2-tag">Trade: {tradeCategoryLabel}</span> : null}
                <span className="v2-tag">{actionLabel}</span>
                {row.assumedFreshSeafood ? <span className="v2-tag">Assumed fresh</span> : null}
                {row.assumedFrozenProduce ? <span className="v2-tag">Assumed frozen</span> : null}
                {row.assumedFrozenFruit ? <span className="v2-tag">Assumed frozen</span> : null}
                {row.categoryStateConflict ? <span className="v2-tag">State/category conflict</span> : null}
                {row.packSizeNeedsReview ? <span className="v2-tag">Pack size review</span> : null}
                {row.likelyMultipackReview ? <span className="v2-tag">Likely multipack</span> : null}
                {row.possibleDuplicateReview ? <span className="v2-tag">Possible duplicate</span> : null}
                {ruleSummary ? <span className="v2-tag">Rule: {ruleSummary}</span> : null}
                {needsAttention ? <span className="v2-tag">{row.confidenceLabel}</span> : null}
              </div>
            </div>
            <div className="v2-record-status-stack">
              <StatusBadge status={row.reviewStatus} />
              {hasLinkedComponentDraft ? <span className="v2-tag">Component draft</span> : null}
            </div>
          </button>
        );
      })}
      {!reviewListRows.length ? (
        <div className="v2-empty-state">
          <div className="v2-eyebrow">Clear</div>
          <h3>No rows in this filter</h3>
          <p>Try another summary filter, or switch to review groups if you’re resolving duplicate source codes.</p>
        </div>
      ) : null}
    </div>
  );
});

const IngredientsImportIssuesWorkspace = memo(function IngredientsImportIssuesWorkspace({
  importCoverageIssues,
  importRows,
  selectedImportRowId,
  openImportRow,
  openRecord,
  repairImportCoverageIssue,
}) {
  const lowConfidenceRows = (importRows || [])
    .filter((row) => !row.published && row.confidenceScore < 50)
    .sort((left, right) => left.confidenceScore - right.confidenceScore);

  return (
    <div className="v2-stack">
      {importCoverageIssues?.length ? (
        <div className="v2-inline-callout warn">
          <strong>Import coverage issues</strong>
          <span>
            {importCoverageIssues.length} source row{importCoverageIssues.length === 1 ? "" : "s"} are being treated as covered, but the
            linked live ingredient is missing or not findable by the current source code/name.
          </span>
        </div>
      ) : null}
      {(importCoverageIssues || []).map((issue) => (
        <div key={issue.id} className="v2-info-card">
          <strong>{issue.row?.rawName || issue.row?.sourceCode || "Source row"}</strong>
          <span>{issue.row?.sourceCode ? `Source code: ${issue.row.sourceCode}` : "No source code on this row."}</span>
          <span>
            {issue.kind === "resolved_without_target"
              ? "Marked as accepted from this source, but no live ingredient target can be found."
              : issue.kind === "represented_without_target"
                ? "Counted as already represented in master, but no live ingredient target can be found."
                : "A live target exists, but it is not findable by the current source code or raw source name."}
          </span>
          <div className="v2-link-list">
            {issue.ingredient ? (
              <button
                type="button"
                className="v2-link-chip"
                onClick={() => openRecord("ingredient", issue.ingredient.id)}
              >
                Open matched ingredient
              </button>
            ) : null}
            <button
              type="button"
              className="v2-link-chip"
              onClick={() => repairImportCoverageIssue(issue)}
            >
              {issue.ingredient
                ? issue.ingredient.archived || getIngredientMasterReviewStatus(issue.ingredient) === "review"
                  ? "Open owner to repair"
                  : "Repair with master ingredient"
                : "Send back to review"}
            </button>
            <button
              type="button"
              className="v2-link-chip"
              onClick={() => {
                if (issue.row?.id) {
                  openImportRow(issue.row.id, "attention");
                }
              }}
              disabled={!issue.row?.id}
            >
              Open source row
            </button>
          </div>
        </div>
      ))}
      {lowConfidenceRows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={`v2-record-row ${selectedImportRowId === row.id ? "active" : ""}`}
          onClick={() => openImportRow(row.id, "attention")}
        >
          <div>
            <strong>{row.chosenName}</strong>
            <span>{row.rawName}</span>
            <span>{row.confidenceLabel} · score {row.confidenceScore}</span>
            {row.confidenceBreakdown.recognized.length ? (
              <span>Recognized: {row.confidenceBreakdown.recognized.join(", ")}</span>
            ) : null}
            {row.confidenceBreakdown.missingCore.length ? (
              <span>Missing: {row.confidenceBreakdown.missingCore.join(", ")}</span>
            ) : null}
          </div>
          <StatusBadge status={row.reviewStatus} />
        </button>
      ))}
      {!importCoverageIssues?.length && !lowConfidenceRows.length ? (
        <div className="v2-empty-state">
          <div className="v2-eyebrow">Clear</div>
          <h3>No import issues right now</h3>
          <p>The current import queue doesn’t have any low-confidence rows that need extra attention.</p>
        </div>
      ) : null}
    </div>
  );
});

const IngredientsDuplicateCodesWorkspace = memo(function IngredientsDuplicateCodesWorkspace({
  duplicateGroups,
  query,
  createVariationGroup,
  acceptGroup,
  discardImportGroup,
  openImportRow,
  openRecord,
}) {
  const filteredGroups = (duplicateGroups || []).filter((group) => {
    if (!query) return true;
    return [
      group.sourceCode,
      group.suggestedTargetName,
      ...(group.aliasCandidates || []),
      ...group.rows.flatMap((row) => [row.rawName, row.chosenName, row.internalCode]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    <div className="v2-stack">
      {filteredGroups.length ? (
        filteredGroups.map((group) => (
          <div key={group.sourceCode} className="v2-info-card">
            <strong>{group.sourceCode}</strong>
            <span>
              {group.rows.length} imported rows share this source item code. {group.readyCount} already ready.
            </span>
            {group.suggestedTargetName ? <span>Suggested target: {group.suggestedTargetName}</span> : null}
            {group.aliasCandidates.length ? (
              <div className="v2-tag-row">
                {group.aliasCandidates.map((alias) => (
                  <span key={alias} className="v2-tag">
                    Alias: {alias}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="v2-link-list">
              {group.rows.map((row) => (
                <button key={row.id} type="button" className="v2-link-chip" onClick={() => openImportRow(row.id, "conflicts")}>
                  {row.internalCode} · {row.rawName}
                </button>
              ))}
            </div>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => createVariationGroup(group.sourceCode)}>
                Suggest group variations
              </button>
              <button type="button" className="v2-primary-button" onClick={() => acceptGroup(group.sourceCode)}>
                Mark reviewed group ready
              </button>
              <button type="button" className="v2-secondary-button" onClick={() => discardImportGroup(group.sourceCode)}>
                Discard group
              </button>
              {group.suggestedTargetId ? (
                <button type="button" className="v2-secondary-button" onClick={() => openRecord("ingredient", group.suggestedTargetId)}>
                  Open clean ingredient
                </button>
              ) : null}
            </div>
          </div>
        ))
      ) : (
        <div className="v2-empty-state">
          <div className="v2-eyebrow">Clear</div>
          <h3>No duplicate source-code groups left</h3>
          <p>The current import queue no longer has any grouped duplicate reviews waiting.</p>
        </div>
      )}
    </div>
  );
});

const IngredientsCatalogueWorkspace = memo(function IngredientsCatalogueWorkspace({
  pendingManualIngredientCount,
  ingredientRecordFilter,
  setIngredientRecordFilter,
  allCatalogueCount,
  simpleCatalogueCount,
  componentDerivedCatalogueCount,
  ingredientStatusFilter,
  setIngredientStatusFilter,
  forReviewCatalogueCount,
  manualReviewCatalogueCount,
  priceReviewCatalogueCount,
  ruleCatchupCatalogueCount,
  archivedCatalogueCount,
  ingredientProductFilter,
  setIngredientProductFilter,
  ingredientProductOptions,
  ingredientSourceFilter,
  setIngredientSourceFilter,
  visibleArchivedRowIds,
  bulkDeleteArchivedIngredients,
  rows,
  rowNeedsManualReview,
  rowNeedsPriceReview,
  rowNeedsRuleCatchup,
  learningRules,
  soft1SourceRows,
  ingredientRuleCatchupMap,
  ingredientParsedIndexMap,
  batchMap,
  selectedRecord,
  openRecord,
}) {
  return (
    <div className="v2-stack">
      {pendingManualIngredientCount ? (
        <div className="v2-inline-callout">
          <strong>{pendingManualIngredientCount} pending for Soft1</strong>
          <span>Export these when you’re ready.</span>
        </div>
      ) : null}
      <div className="v2-workspace-switch">
        <button
          type="button"
          className={`v2-pill ${ingredientRecordFilter === "all" ? "active" : ""}`}
          onClick={() => setIngredientRecordFilter("all")}
        >
          All ({allCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientRecordFilter === "simple" ? "active" : ""}`}
          onClick={() => setIngredientRecordFilter("simple")}
        >
          Simple ({simpleCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientRecordFilter === "component_derived" ? "active" : ""}`}
          onClick={() => setIngredientRecordFilter("component_derived")}
        >
          Component-derived ({componentDerivedCatalogueCount})
        </button>
      </div>
      <div className="v2-workspace-switch">
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "all" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("all")}
        >
          Active
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "needs_attention" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("needs_attention")}
        >
          Needs attention ({forReviewCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "manual_review" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("manual_review")}
        >
          Manual review ({manualReviewCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "price_review" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("price_review")}
        >
          Price review ({priceReviewCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "rule_catchup" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("rule_catchup")}
        >
          Rule catch-up ({ruleCatchupCatalogueCount})
        </button>
        <button
          type="button"
          className={`v2-pill ${ingredientStatusFilter === "archived" ? "active" : ""}`}
          onClick={() => setIngredientStatusFilter("archived")}
        >
          Archived ({archivedCatalogueCount})
        </button>
      </div>
      <div className="v2-form-grid">
        <label className="v2-field">
          <span>Filter by product</span>
          <select value={ingredientProductFilter} onChange={(event) => setIngredientProductFilter(event.target.value)}>
            <option value="all">All products</option>
            {ingredientProductOptions.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </select>
        </label>
        <label className="v2-field">
          <span>Filter by source</span>
          <select value={ingredientSourceFilter} onChange={(event) => setIngredientSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            <option value="soft1">Soft1 / import</option>
            <option value="manual">Manual</option>
            <option value="pending">Pending in Soft1</option>
          </select>
        </label>
      </div>
      {ingredientStatusFilter === "archived" ? (
        <div className="v2-link-list">
          <button
            type="button"
            className="v2-secondary-button"
            onClick={() => bulkDeleteArchivedIngredients(visibleArchivedRowIds)}
            disabled={!visibleArchivedRowIds.length}
          >
            Delete visible archived ({visibleArchivedRowIds.length})
          </button>
        </div>
      ) : null}
      {rows.length ? (
        rows.map((row) => {
          const parsedIndex =
            ingredientParsedIndexMap?.get(row.id) || getIngredientMasterParsedIndex(row, learningRules, soft1SourceRows);
          const catchupSuggestion = ingredientRuleCatchupMap?.get(row.id) || null;
          const componentIdentifier = getIngredientComponentIdentifier(row, batchMap);
          const needsManualReview = rowNeedsManualReview?.(row) || false;
          const needsRuleCatchup = rowNeedsRuleCatchup?.(row) || false;
          const needsPriceReview = rowNeedsPriceReview?.(row) || false;
          const displayName = getIngredientCatalogueDisplayName(row, catchupSuggestion);
          return (
            <button
              key={row.id}
              type="button"
              className={`v2-record-row ${selectedRecord.type === "ingredient" && selectedRecord.id === row.id ? "active" : ""}`}
              onClick={() => openRecord("ingredient", row.id)}
            >
              <div className="v2-record-summary">
                <strong>{displayName}</strong>
                <span className="v2-record-meta">
                  {row.code} · source {row.sourceCode} · {row.category}
                  {row.tradeCategory ? ` · trade ${row.tradeCategory}` : ""}
                  {componentIdentifier ? ` · from ${componentIdentifier}` : ""}
                  {row.aliases?.length ? ` · ${row.aliases.length} aliases` : ""}
                </span>
                <div className="v2-record-tags">
                  <span className="v2-tag">
                    {getIngredientSourceType(row) === "manual" ? "Manual record" : "Soft1-linked"}
                  </span>
                  <span className="v2-tag">
                    {getIngredientSoft1Status(row) === "in_soft1" ? "Added to Soft1" : "Pending in Soft1"}
                  </span>
                  {row.category ? <span className="v2-tag">Category: {row.category}</span> : null}
                  {catchupSuggestion?.nameChanged ? <span className="v2-tag">Suggested name: {catchupSuggestion.suggestedName}</span> : null}
                  {parsedIndex.product ? <span className="v2-tag">Product: {parsedIndex.product}</span> : null}
                  {parsedIndex.cut ? <span className="v2-tag">Type: {parsedIndex.cut}</span> : null}
                  {parsedIndex.brand ? <span className="v2-tag">Brand: {parsedIndex.brand}</span> : null}
                  {parsedIndex.dietary ? <span className="v2-tag">{parsedIndex.dietary}</span> : null}
                  {needsManualReview ? <span className="v2-tag">Manual review</span> : null}
                  {needsRuleCatchup ? <span className="v2-tag">Rule catch-up</span> : null}
                  {needsPriceReview ? <span className="v2-tag">Price review</span> : null}
                  {row.batchId ? <span className="v2-tag">Published from component</span> : null}
                  {componentIdentifier ? <span className="v2-tag">From: {componentIdentifier}</span> : null}
                  {row.needsSubstitutionReview ? <span className="v2-tag">Needs substitution</span> : null}
                </div>
              </div>
              <StatusBadge status={row.status} />
            </button>
          );
        })
      ) : (
        <div className="v2-empty-state">
          <div className="v2-eyebrow">No matches</div>
          <h3>No ingredients match the current filters</h3>
          <p>Try a broader search, clear the product filter, or switch the source view.</p>
        </div>
      )}
    </div>
  );
});

function SubstitutionsPanel({
  opportunities,
  selectedRecord,
  openOpportunity,
  substitutionFilter,
  setSubstitutionFilter,
}) {
  const onMenusCount = opportunities.filter((opportunity) => opportunity.menuCount > 0).length;
  const componentCount = opportunities.filter((opportunity) => opportunity.componentCount > 0).length;
  const strongCount = opportunities.filter((opportunity) => opportunity.candidates[0]?.confidence === "strong").length;

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Substitutions</div>
          <h3>High-impact opportunities</h3>
        </div>
      </div>
      <div className="v2-summary-grid v2-summary-grid-library">
        <SummaryCard
          label="Opportunities"
          value={String(opportunities.length)}
          tone="default"
          active={substitutionFilter === "all"}
          onClick={() => setSubstitutionFilter("all")}
        />
        <SummaryCard
          label="On menus"
          value={String(onMenusCount)}
          tone="warn"
          active={substitutionFilter === "menus"}
          onClick={() => setSubstitutionFilter("menus")}
        />
        <SummaryCard
          label="In components"
          value={String(componentCount)}
          tone="default"
          active={substitutionFilter === "components"}
          onClick={() => setSubstitutionFilter("components")}
        />
        <SummaryCard
          label="Strong match"
          value={String(strongCount)}
          tone="good"
          active={substitutionFilter === "strong"}
          onClick={() => setSubstitutionFilter("strong")}
        />
      </div>
      <div className="v2-stack">
        {opportunities.length ? (
          opportunities.map((opportunity) => {
            const topCandidate = opportunity.candidates[0];
            return (
              <button
                key={opportunity.sourceIngredient.id}
                type="button"
                className={`v2-record-row ${selectedRecord.type === "ingredient" && selectedRecord.id === opportunity.sourceIngredient.id ? "active" : ""}`}
                onClick={() => openOpportunity(opportunity.sourceIngredient.id)}
              >
                <div>
                  <strong>{opportunity.sourceIngredient.name}</strong>
                  <span>
                    {opportunity.product} · {formatCurrency(opportunity.sourceIngredient.unitCost)} / {opportunity.sourceIngredient.costUnit || "unit"}
                  </span>
                  <span>
                    Top alternative {topCandidate.ingredient.name} · save {formatCurrency(topCandidate.savingsPerUnit)} /{" "}
                    {opportunity.sourceIngredient.costUnit || "unit"}
                  </span>
                  <span>
                    {opportunity.recipeCount} recipes · {opportunity.componentCount} components · {opportunity.menuCount} menus ·{" "}
                    {opportunity.restaurantCount} restaurants
                  </span>
                </div>
                <span className="v2-tag">{topCandidate.confidence === "strong" ? "Strong match" : "Possible match"}</span>
              </button>
            );
          })
        ) : (
          <div className="v2-empty-state">
            <div className="v2-eyebrow">No matches</div>
            <h3>No substitution opportunities in this filter</h3>
            <p>Try another filter or clear search to bring back the wider opportunity list.</p>
          </div>
        )}
      </div>
    </>
  );
}

function SubstitutionsDetail({ opportunity, openIngredientSubstitution, openRecord }) {
  const sourceIngredient = opportunity.sourceIngredient;
  const topCandidate = opportunity.candidates[0] || null;

  return (
    <>
      <DetailHeader
        title={sourceIngredient.name}
        subtitle={`${sourceIngredient.code} · ${opportunity.product}`}
        status="review"
        statusLabel="substitution"
      />
      <div className="v2-detail-grid v2-detail-grid-inline-four">
        <DetailStat
          label="Current price"
          value={`${formatCurrency(sourceIngredient.unitCost)} / ${sourceIngredient.costUnit || "unit"}`}
        />
        <DetailStat label="Recipes" value={String(opportunity.recipeCount)} />
        <DetailStat label="Components" value={String(opportunity.componentCount)} />
        <DetailStat label="Menus" value={String(opportunity.menuCount)} />
      </div>
      <div className="v2-detail-grid">
        <DetailStat label="Restaurants" value={String(opportunity.restaurantCount)} />
        <DetailStat label="Pack size" value={sourceIngredient.packSize || "Not set"} />
        <DetailStat label="Supplier" value={sourceIngredient.supplier || "No supplier set"} />
      </div>
      <DetailSection title="Why it surfaced">
        <div className="v2-inline-callout">
          <strong>{opportunity.candidates.length} possible substitutes found</strong>
          <span>
            This ingredient reaches {opportunity.recipeCount} recipes and {opportunity.componentCount} components,
            with menu impact across {opportunity.menuCount} menus and {opportunity.restaurantCount} restaurants.
          </span>
        </div>
        {topCandidate ? (
          <div className="v2-micro-note">
            Best current saving: {formatCurrency(topCandidate.savingsPerUnit)} / {sourceIngredient.costUnit || "unit"} against{" "}
            {topCandidate.ingredient.name}.
          </div>
        ) : null}
      </DetailSection>
      <DetailSection title="Suggested alternatives">
        <div className="v2-stack">
          {opportunity.candidates.map((candidate) => (
            <div key={candidate.ingredient.id} className="v2-line-card">
              <div className="v2-detail-toolbar">
                <div>
                  <strong>{candidate.ingredient.name}</strong>
                  <span>
                    {candidate.ingredient.code} · {candidate.ingredient.category || "No category set"}
                  </span>
                </div>
                <span className="v2-tag">{candidate.confidence === "strong" ? "Strong match" : "Possible match"}</span>
              </div>
              <div className="v2-detail-grid v2-detail-grid-inline-four">
                <DetailStat
                  label="Candidate price"
                  value={`${formatCurrency(candidate.ingredient.unitCost)} / ${candidate.ingredient.costUnit || "unit"}`}
                />
                <DetailStat
                  label="Saving / unit"
                  value={`${formatCurrency(candidate.savingsPerUnit)} / ${sourceIngredient.costUnit || "unit"}`}
                />
                <DetailStat label="Supplier" value={candidate.ingredient.supplier || "No supplier set"} />
                <DetailStat label="Pack size" value={candidate.ingredient.packSize || "Not set"} />
              </div>
              <div className="v2-link-list">
                <button
                  type="button"
                  className="v2-primary-button"
                  onClick={() => openIngredientSubstitution(sourceIngredient.id, candidate.ingredient.id)}
                >
                  Compare and substitute
                </button>
                <button type="button" className="v2-secondary-button" onClick={() => openRecord("ingredient", candidate.ingredient.id)}>
                  Open ingredient
                </button>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>
    </>
  );
}

function RecipesPanel({
  rows,
  allRows,
  baseRows,
  selectedRecord,
  openRecord,
  createRecipe,
  publishReadyRecipes,
  maps,
  recipeCategoryFilter,
  setRecipeCategoryFilter,
  recipeCategoryOptions,
  recipeRestaurantFilter,
  setRecipeRestaurantFilter,
  recipeRestaurantOptions,
  recipeStatusFilter,
  setRecipeStatusFilter,
}) {
  const activeRows = baseRows.filter((row) => !row.archived);
  const archivedCount = baseRows.filter((row) => row.archived).length;
  const draftCount = activeRows.filter((row) => row.status === "draft").length;
  const liveCount = activeRows.filter((row) => row.status === "live").length;
  const reviewCount = activeRows.filter((row) => row.status === "review").length;
  const needsAttentionCount = activeRows.filter((row) => Boolean(row.needsReviewFlag || row.sharedMissingLineCount)).length;

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Recipes</div>
          <h3>Recipe library</h3>
        </div>
        <button type="button" className="v2-primary-button" onClick={createRecipe}>
          New recipe
        </button>
      </div>
      <div className="v2-summary-grid v2-summary-grid-library">
        <SummaryCard
          label="All"
          value={String(activeRows.length)}
          tone="default"
          active={recipeStatusFilter === "all"}
          onClick={() => setRecipeStatusFilter("all")}
        />
        <SummaryCard
          label="Draft"
          value={String(draftCount)}
          tone="warn"
          active={recipeStatusFilter === "draft"}
          onClick={() => setRecipeStatusFilter("draft")}
        />
        <SummaryCard
          label="Ready"
          value={String(reviewCount)}
          tone="warn"
          active={recipeStatusFilter === "review"}
          onClick={() => setRecipeStatusFilter("review")}
        />
        <SummaryCard
          label="Live"
          value={String(liveCount)}
          tone="good"
          active={recipeStatusFilter === "live"}
          onClick={() => setRecipeStatusFilter("live")}
        />
        <SummaryCard
          label="Needs attention"
          value={String(needsAttentionCount)}
          tone="warn"
          active={recipeStatusFilter === "needs_attention"}
          onClick={() => setRecipeStatusFilter("needs_attention")}
        />
        <SummaryCard
          label="Archived"
          value={String(archivedCount)}
          tone="default"
          active={recipeStatusFilter === "archived"}
          onClick={() => setRecipeStatusFilter("archived")}
        />
      </div>
      {recipeStatusFilter === "review" ? (
        <div className="v2-link-list">
          <button type="button" className="v2-primary-button" onClick={publishReadyRecipes} disabled={!reviewCount}>
            Publish ready recipes
          </button>
        </div>
      ) : null}
      <div className="v2-form-grid">
        <label className="v2-field">
          <span>Filter by category</span>
          <select value={recipeCategoryFilter} onChange={(event) => setRecipeCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {recipeCategoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="v2-field">
          <span>Filter by restaurant</span>
          <select value={recipeRestaurantFilter} onChange={(event) => setRecipeRestaurantFilter(event.target.value)}>
            <option value="all">All restaurants</option>
            {recipeRestaurantOptions.map((restaurant) => (
              <option key={restaurant} value={restaurant}>
                {restaurant}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="v2-stack">
        {rows.length ? (
          rows.map((row) => (
            (() => {
              const pricing = getRecipePricingMetrics(row, maps.ingredient, maps.batch);
              const progress = getRecipeWorkflowProgress(row);
              const serviceSuitability = Array.isArray(row.serviceSuitability) ? row.serviceSuitability : [];
              const serviceCount = serviceSuitability.length;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`v2-record-row ${selectedRecord.type === "recipe" && selectedRecord.id === row.id ? "active" : ""}`}
                  onClick={() => openRecord("recipe", row.id)}
                >
                  <div className="v2-record-summary">
                    <strong>{row.name}</strong>
                    <span className="v2-record-meta">
                      {[row.code, row.category || "No category", `${row.portions} portion${row.portions === 1 ? "" : "s"}`].join(" · ")}
                    </span>
                    <div className="v2-record-tags">
                      <span className="v2-tag">{progress.completeCount}/{progress.total} steps ready</span>
                      <span className="v2-tag">Recipe cost {formatCurrency(pricing.recipeCost)}</span>
                      <span className="v2-tag">GP {formatPercent(pricing.grossProfit)}</span>
                      {row.needsReviewFlag ? <span className="v2-tag">Needs attention</span> : null}
                      {row.sharedMissingLineCount ? (
                        <span className="v2-tag">Missing {row.sharedMissingLineCount} source line{row.sharedMissingLineCount === 1 ? "" : "s"}</span>
                      ) : null}
                      {serviceCount ? (
                        <span className="v2-tag">{serviceSuitability.join(", ")}</span>
                      ) : (
                        <span className="v2-tag">No service suitability</span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={row.status} label={getRecipeStageLabel(row.status)} />
                </button>
              );
            })()
          ))
        ) : (
          <div className="v2-empty-state">
            <div className="v2-eyebrow">No matches</div>
            <h3>No recipes match the current filters</h3>
            <p>Try a different status, clear a filter, or start a new recipe.</p>
          </div>
        )}
      </div>
    </>
  );
}

function BatchesPanel({
  rows,
  allRows,
  baseRows,
  selectedRecord,
  openRecord,
  createBatch,
  publishReadyBatches,
  batchStatusFilter,
  setBatchStatusFilter,
  ingredientMap,
}) {
  const activeRows = baseRows.filter((row) => !row.archived);
  const standardRows = activeRows.filter((row) => !row.needsReviewFlag);
  const archivedCount = baseRows.filter((row) => row.archived).length;
  const draftCount = standardRows.filter((row) => row.status === "draft").length;
  const readyCount = standardRows.filter((row) => row.status === "review").length;
  const publishedCount = standardRows.filter((row) => row.status === "ready").length;
  const forReviewCount = activeRows.filter((row) => row.needsReviewFlag).length;

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Components</div>
          <h3>Component library</h3>
        </div>
        <button type="button" className="v2-primary-button" onClick={createBatch}>
          New component
        </button>
      </div>
      <div className="v2-summary-grid v2-summary-grid-library">
        <SummaryCard
          label="All"
          value={String(activeRows.length)}
          tone="default"
          active={batchStatusFilter === "all"}
          onClick={() => setBatchStatusFilter("all")}
        />
        <SummaryCard
          label="Draft"
          value={String(draftCount)}
          tone="warn"
          active={batchStatusFilter === "draft"}
          onClick={() => setBatchStatusFilter("draft")}
        />
        <SummaryCard
          label="Ready"
          value={String(readyCount)}
          tone="warn"
          active={batchStatusFilter === "review"}
          onClick={() => setBatchStatusFilter("review")}
        />
        <SummaryCard
          label="Published"
          value={String(publishedCount)}
          tone="good"
          active={batchStatusFilter === "ready"}
          onClick={() => setBatchStatusFilter("ready")}
        />
        <SummaryCard
          label="Needs attention"
          value={String(forReviewCount)}
          tone="warn"
          active={batchStatusFilter === "for_review"}
          onClick={() => setBatchStatusFilter("for_review")}
        />
        <SummaryCard
          label="Archived"
          value={String(archivedCount)}
          tone="default"
          active={batchStatusFilter === "archived"}
          onClick={() => setBatchStatusFilter("archived")}
        />
      </div>
      {batchStatusFilter === "review" ? (
        <div className="v2-link-list">
          <button type="button" className="v2-primary-button" onClick={publishReadyBatches} disabled={!readyCount}>
            Publish ready components
          </button>
        </div>
      ) : null}
      <div className="v2-stack">
        {rows.length ? (
          rows.map((row) => (
            (() => {
              const batchCostSource = getBatchCostSource(row, ingredientMap);
              const progress = getBatchWorkflowProgress(row, ingredientMap);
              const missingMethod = !batchHasMethod(row);
              return (
            <button
              key={row.id}
              type="button"
              className={`v2-record-row ${selectedRecord.type === "batch" && selectedRecord.id === row.id ? "active" : ""}`}
              onClick={() => openRecord("batch", row.id)}
            >
              <div className="v2-record-summary">
                <strong>{row.name}</strong>
                <span className="v2-record-meta">{[row.code, row.yieldLabel || "No yield set yet"].join(" · ")}</span>
                <div className="v2-record-tags">
                  <span className="v2-tag">{progress.completeCount}/{progress.total} steps ready</span>
                  <span className="v2-tag">Cost / unit {formatCurrency(batchCostSource.unitCost)}</span>
                  <span className="v2-tag">Total {formatCurrency(batchCostSource.totalComponentCost || 0)}</span>
                  {missingMethod ? <span className="v2-tag">Method missing</span> : null}
                  {row.sharedMissingLineCount ? (
                    <span className="v2-tag">Missing {row.sharedMissingLineCount} source line{row.sharedMissingLineCount === 1 ? "" : "s"}</span>
                  ) : null}
                  {row.needsReviewFlag ? <span className="v2-tag">Needs attention</span> : null}
                  {row.productType ? <span className="v2-tag">{row.productType}</span> : null}
                </div>
              </div>
              <StatusBadge status={row.status} label={getBatchStageLabel(row.status)} />
            </button>
              );
            })()
          ))
        ) : (
          <div className="v2-empty-state">
            <div className="v2-eyebrow">No matches</div>
            <h3>No components match the current filters</h3>
            <p>Try a different stage, clear a filter, or start a new component.</p>
          </div>
        )}
      </div>
    </>
  );
}

function MenusPanel({
  rows,
  selectedRecord,
  openRecord,
  relationshipMaps,
  maps,
  createMenuForRestaurant,
}) {
  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Menus</div>
          <h3>Restaurant profiles</h3>
        </div>
      </div>
      <div className="v2-stack v2-restaurant-stack">
        {rows.map((row) => (
          <div key={row.id} className="v2-info-card v2-restaurant-card">
            <div className="v2-restaurant-row">
              <div className="v2-restaurant-summary">
                <strong>{row.name}</strong>
                <span>{row.venueType}</span>
              </div>
              <div className="v2-link-list">
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => createMenuForRestaurant(row.id)}
                >
                  Add menu
                </button>
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => openRecord("restaurant", row.id)}
                >
                  Profile
                </button>
              </div>
            </div>
            <div className="v2-link-list v2-menu-toggle-row">
              {(relationshipMaps?.restaurantMenus?.get(row.id) || [])
                .map((menuId) => maps.menu.get(menuId))
                .filter(Boolean)
                .map((menu, index, list) => {
                  const duplicateCount = list.filter((item) => item.service === menu.service).length;
                  const duplicateIndex =
                    list.filter((item, itemIndex) => item.service === menu.service && itemIndex <= index).length;
                  const label =
                    duplicateCount > 1 ? `${menu.service} ${duplicateIndex}` : menu.service;

                  return (
                    <button
                      key={menu.id}
                      type="button"
                      className={`v2-link-chip v2-menu-toggle v2-menu-toggle-${statusTone(menu.status)} ${menu.archived ? "archived" : ""} ${selectedRecord.type === "menu" && selectedRecord.id === menu.id ? "active" : ""}`}
                      onClick={() => openRecord("menu", menu.id)}
                    >
                      {label}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ExportsPanel({
  exportObjectType,
  setExportObjectType,
  exportSearchQuery,
  setExportSearchQuery,
  recipeExportMode,
  setRecipeExportMode,
  rows,
  ingredientExportSummary,
  selectedRecord,
  selectExportRecord,
}) {
  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Exports</div>
          <h3>Choose what to export</h3>
        </div>
      </div>
      <div className="v2-workspace-switch">
        <button
          type="button"
          className={`v2-pill ${exportObjectType === "recipe" ? "active" : ""}`}
          onClick={() => {
            setExportObjectType("recipe");
            setExportSearchQuery("");
            setRecipeExportMode("search");
          }}
        >
          Recipes
        </button>
        <button
          type="button"
          className={`v2-pill ${exportObjectType === "menu" ? "active" : ""}`}
          onClick={() => {
            setExportObjectType("menu");
            setExportSearchQuery("");
          }}
        >
          Menus
        </button>
        <button
          type="button"
          className={`v2-pill ${exportObjectType === "ingredient" ? "active" : ""}`}
          onClick={() => {
            setExportObjectType("ingredient");
            setExportSearchQuery("");
          }}
        >
          Ingredients
        </button>
      </div>
      {exportObjectType === "recipe" ? (
        <div className="v2-workspace-switch">
          <button
            type="button"
            className={`v2-pill ${recipeExportMode === "search" ? "active" : ""}`}
            onClick={() => setRecipeExportMode("search")}
          >
            Search
          </button>
          <button
            type="button"
            className={`v2-pill ${recipeExportMode === "browse" ? "active" : ""}`}
            onClick={() => setRecipeExportMode("browse")}
          >
            Browse
          </button>
        </div>
      ) : null}
      {exportObjectType !== "ingredient" ? (
        <label className="v2-field">
          <span>{exportObjectType === "recipe" ? "Find recipes to export" : "Browse or search menus to export"}</span>
          <input
            value={exportSearchQuery}
            onChange={(event) => setExportSearchQuery(event.target.value)}
            placeholder={exportObjectType === "recipe" ? "Type a recipe name or code" : "Type a menu, restaurant, or service"}
          />
        </label>
      ) : null}
      <div className="v2-stack">
        {exportObjectType === "ingredient" ? (
          <div className="v2-line-card">
            <strong>Full ingredient master</strong>
            <p>Export the complete ingredient master as a CSV, with a printable preview available first.</p>
            <div className="v2-detail-grid v2-detail-grid-inline-four">
              <DetailStat label="Total" value={String(ingredientExportSummary.total)} />
              <DetailStat label="Active" value={String(ingredientExportSummary.active)} />
              <DetailStat label="Archived" value={String(ingredientExportSummary.archived)} />
            </div>
          </div>
        ) : exportObjectType === "recipe" && recipeExportMode === "search" && !exportSearchQuery.trim() ? (
          <div className="v2-empty-state">
            <div className="v2-eyebrow">Search first</div>
            <h3>Start typing to find an export</h3>
            <p>Search by recipe name, code, category, or menu description.</p>
          </div>
        ) : rows.length ? (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`v2-record-row ${selectedRecord.type === exportObjectType && selectedRecord.id === row.id ? "active" : ""}`}
              onClick={() => selectExportRecord(exportObjectType, row.id)}
            >
              <div>
                <strong>{row.name}</strong>
                <span>
                  {exportObjectType === "recipe"
                    ? `${row.code} · ${row.category} · ${getRecipeStageLabel(row.status)}`
                    : `${row.restaurant} · ${row.service} · ${getMenuStageLabel(row.status)}`}
                </span>
              </div>
              <StatusBadge
                status={row.status}
                label={exportObjectType === "recipe" ? getRecipeStageLabel(row.status) : getMenuStageLabel(row.status)}
              />
            </button>
          ))
        ) : (
          <div className="v2-empty-state">
            <div className="v2-eyebrow">No matches</div>
            <h3>No exports match that view</h3>
            <p>
              {exportObjectType === "recipe"
                ? "Try a broader recipe search or switch to browse."
                : "Try a broader menu search."}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function ExportDetail({
  record,
  recordType,
  maps,
  openRecipeCostSheetPreview,
  openRecipeChefSheetPreview,
  openMenuSheetPreview,
  openMenuBulkCostSheetPreview,
  openIngredientMasterExportPreview,
}) {
  if (recordType === "ingredient_master") {
    return (
      <>
        <DetailHeader
          title="Ingredient master"
          subtitle="Full export of the clean ingredient list"
          status="ready"
          statusLabel="export"
        />
        <div className="v2-detail-grid v2-detail-grid-inline-four">
          <DetailStat label="Total" value={String(record.total || 0)} />
          <DetailStat label="Active" value={String(record.active || 0)} />
          <DetailStat label="Archived" value={String(record.archived || 0)} />
        </div>
        <DetailSection title="Export options">
          <div className="v2-stack">
            <div className="v2-line-card">
              <strong>Full ingredient list</strong>
              <p>Preview the ingredient master, then print/save PDF or download the complete CSV from the same pop-out.</p>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={openIngredientMasterExportPreview}>
                  Open ingredient list
                </button>
              </div>
            </div>
          </div>
        </DetailSection>
      </>
    );
  }

  if (recordType === "recipe") {
    const pricing = getRecipePricingMetrics(record, maps.ingredient, maps.batch);
    return (
      <>
        <DetailHeader
          title={record.name}
          subtitle={`${record.code} · ${record.category}`}
          status={record.status}
          statusLabel={getRecipeStageLabel(record.status)}
        />
        <div className="v2-detail-grid v2-detail-grid-inline-four">
          <DetailStat label="Portions" value={String(record.portions || 0)} />
          <DetailStat label="Recipe cost" value={formatCurrency(pricing.recipeCost)} />
          <DetailStat label="Gross sale price" value={formatCurrency(record.salePrice || 0)} />
          <DetailStat label="GP (net)" value={formatPercent(pricing.grossProfit)} />
        </div>
        <DetailSection title="Export options">
          <div className="v2-stack">
            <div className="v2-line-card">
              <strong>Costing sheet</strong>
              <p>CSV export with recipe summary, ingredient lines, component lines, and estimated costs.</p>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={() => openRecipeCostSheetPreview(record.id)}>
                  Open cost sheet
                </button>
              </div>
            </div>
            <div className="v2-line-card">
              <strong>Chef sheet</strong>
              <p>Kitchen-facing text export with menu description, ingredient list, method steps, and notes.</p>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={() => openRecipeChefSheetPreview(record.id)}>
                  Open chef sheet
                </button>
              </div>
            </div>
          </div>
        </DetailSection>
      </>
    );
  }

  if (recordType === "menu") {
    const menuSaveState = String(menuSharedSyncState || "").trim();
    const goToMenuStep = async (nextMenuStep) => {
      if (nextMenuStep === menuEditorStep) return;
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      setMenuEditorStep(nextMenuStep);
    };

    const approveMenuWithSave = async () => {
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      approveMenu(record.id);
    };

    const publishMenuLiveWithSave = async () => {
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      publishMenuLive(record.id);
    };

    return (
      <>
        <DetailHeader
          title={record.name}
          subtitle={`${record.restaurant} · ${record.service}`}
          status={record.status}
          statusLabel={getMenuStageLabel(record.status)}
        />
        <div className="v2-detail-grid v2-detail-grid-inline-four">
          <DetailStat label="Restaurant" value={record.restaurant} />
          <DetailStat label="Service" value={record.service} />
          <DetailStat label="Dishes" value={String((record.items || []).length)} />
          <DetailStat label="Stage" value={titleCaseWords(getMenuStageLabel(record.status))} />
        </div>
        <DetailSection title="Export options">
          <div className="v2-stack">
            <div className="v2-line-card">
              <strong>Menu proof</strong>
              <p>Preview the printable menu, then either print/save PDF or download the CSV from the same pop-out.</p>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={() => openMenuSheetPreview(record.id)}>
                  Open menu proof
                </button>
              </div>
            </div>
            <div className="v2-line-card">
              <strong>Costing pack</strong>
              <p>Bulk export for the whole menu, stacking each dish one after the next in the v1 cost-sheet CSV format.</p>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={() => openMenuBulkCostSheetPreview(record.id)}>
                  Open costing pack
                </button>
              </div>
            </div>
          </div>
        </DetailSection>
      </>
    );
  }

  return <EmptyDetail />;
}

function SettingsPanel({
  learningRules,
  exportLearningRules,
  learningRulesSyncState,
  learningRulesSyncMessage,
  updateLearningRule,
  deleteLearningRule,
  users,
  addUser,
  updateUser,
  toggleUserStatus,
  userSyncState,
  userSyncMessage,
  currentUserRole,
}) {
  const userRoles = [
    {
      name: "Admin",
      note: "Controls structure, naming rules, users, and publishing setup.",
    },
    {
      name: "Editor",
      note: "Manages ingredients, components, recipes, menus, and exports.",
    },
    {
      name: "Chef",
      note: "Uses recipes, menu proofs, and chef sheets without changing system setup.",
    },
  ];
  const [settingsView, setSettingsView] = useState("structure");
  const [userDraft, setUserDraft] = useState({
    name: "",
    email: "",
    role: "Chef",
    status: "active",
  });
  const [editingRuleId, setEditingRuleId] = useState("");
  const [ruleDrafts, setRuleDrafts] = useState({});
  const activeUserCount = users.filter((user) => user.status === "active").length;
  const adminUserCount = users.filter((user) => user.role === "Admin").length;
  const reviewedLearningRules = (learningRules || []).map((rule) => ({
    ...rule,
    risk: getLearningRuleRisk(rule),
  }));
  const broadLearningRuleCount = reviewedLearningRules.filter((rule) => rule.risk.isBroad).length;
  const builtInTriggerGroups = [
    {
      label: "Brand",
      triggers: knownBrandPhrases.map((item) => titleCaseWords(item)),
    },
    {
      label: "Origin",
      triggers: originTriggerMap.map((item) => `${item.trigger} -> ${item.value}`),
    },
    {
      label: "State",
      triggers: stateWords.map((item) => titleCaseWords(item)),
    },
    {
      label: "Dietary",
      triggers: learningRuleTriggerPhrases.dietary.map((item) => titleCaseWords(item)),
    },
  ];

  const startEditingRule = (rule) => {
    setEditingRuleId(rule.id);
    setRuleDrafts((current) => ({
      ...current,
      [rule.id]: {
        field: rule.field,
        trigger: rule.trigger,
        value: rule.value,
      },
    }));
  };

  const cancelEditingRule = () => {
    setEditingRuleId("");
  };

  const saveEditedRule = (ruleId) => {
    const draft = ruleDrafts[ruleId];
    if (!draft) return;
    const didSave = updateLearningRule(ruleId, draft);
    if (didSave) {
      setEditingRuleId("");
    }
  };

  const updateRuleDraft = (ruleId, field, value) => {
    setRuleDrafts((current) => ({
      ...current,
      [ruleId]: {
        ...current[ruleId],
        [field]: value,
      },
    }));
  };

  const handleCreateUser = () => {
    const didAdd = addUser(userDraft);
    if (!didAdd) return;
    setUserDraft({
      name: "",
      email: "",
      role: "Chef",
      status: "active",
    });
  };

  return (
    <>
      <div className="v2-panel-header">
        <div>
          <div className="v2-eyebrow">Settings</div>
          <h3>Admin structure</h3>
        </div>
      </div>
      <div className="v2-summary-grid v2-summary-grid-library">
        <SummaryCard label="Structure" value="Restaurants" tone="default" active={settingsView === "structure"} onClick={() => setSettingsView("structure")} />
        <SummaryCard label="Users" value={String(users.length)} tone="good" active={settingsView === "users"} onClick={() => setSettingsView("users")} />
        <SummaryCard label="Naming rules" value={String(learningRules?.length || 0)} tone="warn" active={settingsView === "rules"} onClick={() => setSettingsView("rules")} />
      </div>
      <div className="v2-stack">
        {settingsView === "structure" ? (
          <>
            <div className="v2-info-card">
              <strong>Restaurants and services</strong>
              <span>Use settings for the overall restaurant and service framework, then build the operational menus in the main Menus workspace.</span>
            </div>
            <div className="v2-info-card">
              <strong>Categories and types</strong>
              <span>Keep shared pick-lists consistent so recipes and components classify cleanly across the app.</span>
              <div className="v2-tag-row">
                {recipeCategoryOptions.map((category) => (
                  <span key={category} className="v2-tag">
                    {category}
                  </span>
                ))}
              </div>
              <div className="v2-tag-row">
                {componentProductTypeOptions.map((type) => (
                  <span key={type} className="v2-tag">
                    {type}
                  </span>
                ))}
              </div>
            </div>
            <div className="v2-info-card">
              <strong>Clean-name structure</strong>
              <span>The ingredient review grid is driven from one field model, so we can extend the clean-name pattern without rebuilding the workflow each time.</span>
              <div className="v2-tag-row">
                {ingredientIndexFields.map((field) => (
                  <span key={field.key} className="v2-tag">
                    {field.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="v2-info-card">
              <strong>Exports and templates</strong>
              <span>Keep future printable templates, branded menu outputs, and export profiles here rather than scattering those decisions through the operational screens.</span>
              <div className="v2-tag-row">
                <span className="v2-tag">Recipe cost sheet</span>
                <span className="v2-tag">Chef sheet</span>
                <span className="v2-tag">Menu proof</span>
                <span className="v2-tag">Menu costing pack</span>
              </div>
            </div>
            <div className="v2-info-card">
              <strong>Sync and integrations</strong>
              <span>Use this area for shared naming rules, future Soft1 loops, and any live integrations that need to be monitored.</span>
              <div className={`v2-inline-callout ${learningRulesSyncState === "error" ? "warn" : ""}`}>
                <strong>Shared sync: {learningRulesSyncState}</strong>
                <span>{learningRulesSyncMessage}</span>
              </div>
            </div>
          </>
        ) : null}

        {settingsView === "users" ? (
          <>
            <div className="v2-summary-grid v2-summary-grid-library">
              <SummaryCard label="Users" value={String(users.length)} tone="default" />
              <SummaryCard label="Active" value={String(activeUserCount)} tone="good" />
              <SummaryCard label="Admins" value={String(adminUserCount)} tone="warn" />
            </div>
            <div className={`v2-inline-callout ${userSyncState === "error" ? "warn" : ""}`}>
              <strong>User sync: {userSyncState}</strong>
              <span>
                {userSyncMessage ||
                  (currentUserRole === "Admin"
                    ? "Role changes save back to the shared user profile immediately."
                    : "Only Admin users can change shared user rights.")}
              </span>
            </div>
            <div className="v2-info-card">
              <strong>User roles</strong>
              <span>Keep roles simple for now, then add deeper workspace permissions later if we need them.</span>
              <div className="v2-stack">
                {userRoles.map((role) => (
                  <div key={role.name} className="v2-rule-card">
                    <div>
                      <strong>{role.name}</strong>
                      <span>{role.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="v2-info-card">
              <strong>Add user</strong>
              <span>
                This currently creates a local placeholder row in v2 only. To give someone real sign-in and edit rights, they must also exist in Supabase Authentication with a matching shared profile.
              </span>
              <div className="v2-form-grid">
                <label className="v2-field">
                  <span>Name</span>
                  <input value={userDraft.name} onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="v2-field">
                  <span>Email</span>
                  <input value={userDraft.email} onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))} />
                </label>
                <label className="v2-field">
                  <span>Role</span>
                  <select value={userDraft.role} onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value }))}>
                    {userRoles.map((role) => (
                      <option key={role.name} value={role.name}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="v2-link-list">
                <button
                  type="button"
                  className="v2-primary-button"
                  onClick={handleCreateUser}
                  disabled={!String(userDraft.name || "").trim() || !String(userDraft.email || "").trim()}
                >
                  Add user
                </button>
              </div>
            </div>
            <div className="v2-info-card">
              <strong>Current users</strong>
              <div className="v2-rule-list">
                {users.map((user) => (
                  <div key={user.id} className="v2-rule-card">
                    <div className="v2-rule-edit-grid">
                      <label className="v2-field">
                        <span>Name</span>
                        <input value={user.name} onChange={(event) => updateUser(user.id, "name", event.target.value)} />
                      </label>
                      <label className="v2-field">
                        <span>Email</span>
                        <input value={user.email} onChange={(event) => updateUser(user.id, "email", event.target.value)} />
                      </label>
                      <label className="v2-field">
                        <span>Role</span>
                        <select
                          value={user.role}
                          onChange={(event) => updateUser(user.id, "role", event.target.value)}
                          disabled={currentUserRole !== "Admin" || !user.isSharedProfile}
                        >
                          {userRoles.map((role) => (
                            <option key={role.name} value={role.name}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="v2-link-list">
                      <span className="v2-tag">{user.status === "active" ? "Active" : "Inactive"}</span>
                      <span className="v2-tag">{user.isSharedProfile ? "Shared login" : "Local only"}</span>
                      <button type="button" className="v2-secondary-button" onClick={() => toggleUserStatus(user.id)}>
                        {user.status === "active" ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {settingsView === "rules" ? (
          <div className="v2-info-card">
            <strong>Ingredient naming rules</strong>
            <span>
              Reusable corrections saved from review edits. These are stored locally and, when available, synced to shared data for the live launch.
            </span>
            <div className="v2-rule-list">
              <div className="v2-rule-card">
                <div>
                  <strong>Built-in parser triggers</strong>
                  <span>Default triggers the parser already recognises before any learned rules are added.</span>
                </div>
                <div className="v2-stack">
                  {builtInTriggerGroups.map((group) => (
                    <div key={group.label}>
                      <strong>{group.label}</strong>
                      <div className="v2-tag-row">
                        {group.triggers.map((trigger) => (
                          <span key={`${group.label}-${trigger}`} className="v2-tag">
                            {trigger}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {learningRules?.length ? (
              <div className={`v2-inline-callout ${broadLearningRuleCount ? "warn" : ""}`}>
                <strong>Learned rule review</strong>
                <span>
                  {learningRules.length} learned rule{learningRules.length === 1 ? "" : "s"} saved.{" "}
                  {broadLearningRuleCount
                    ? `${broadLearningRuleCount} broad trigger${broadLearningRuleCount === 1 ? "" : "s"} should be reviewed carefully before running master catch-up.`
                    : "No broad learned triggers are currently flagged."}
                </span>
              </div>
            ) : null}
            <div className="v2-link-list">
              <button
                type="button"
                className="v2-secondary-button"
                onClick={exportLearningRules}
                disabled={!learningRules?.length}
              >
                Export learned rules
              </button>
            </div>
            {learningRules?.length ? (
              <div className="v2-rule-list">
                {reviewedLearningRules.map((rule) => (
                  <div key={rule.id} className="v2-rule-card">
                    {editingRuleId === rule.id ? (
                      <>
                        <div className="v2-rule-edit-grid">
                          <label className="v2-field">
                            <span>Field</span>
                            <select
                              value={ruleDrafts[rule.id]?.field || rule.field}
                              onChange={(event) => updateRuleDraft(rule.id, "field", event.target.value)}
                            >
                              {ingredientIndexFields.map((field) => (
                                <option key={field.key} value={field.key}>
                                  {field.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="v2-field">
                            <span>Trigger</span>
                            <input
                              value={ruleDrafts[rule.id]?.trigger || ""}
                              onChange={(event) => updateRuleDraft(rule.id, "trigger", event.target.value)}
                            />
                          </label>
                          <label className="v2-field">
                            <span>Value</span>
                            <input
                              value={ruleDrafts[rule.id]?.value || ""}
                              onChange={(event) => updateRuleDraft(rule.id, "value", event.target.value)}
                            />
                          </label>
                        </div>
                        {rule.risk.isBroad ? (
                          <div className="v2-tag-row">
                            <span className="v2-tag v2-tag-warn">Broad trigger</span>
                            {rule.risk.reasons.map((reason) => (
                              <span key={`${rule.id}-${reason}`} className="v2-tag">
                                {reason}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="v2-link-list">
                          <button
                            type="button"
                            className="v2-primary-button"
                            onClick={() => saveEditedRule(rule.id)}
                            disabled={
                              !String(ruleDrafts[rule.id]?.field || "").trim() ||
                              !String(ruleDrafts[rule.id]?.trigger || "").trim() ||
                              !String(ruleDrafts[rule.id]?.value || "").trim()
                            }
                          >
                            Save rule
                          </button>
                          <button type="button" className="v2-secondary-button" onClick={cancelEditingRule}>
                            Cancel
                          </button>
                          <button type="button" className="v2-secondary-button" onClick={() => deleteLearningRule(rule.id)}>
                            Delete rule
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <strong>
                            {rule.label}: "{rule.trigger}" to {rule.value}
                          </strong>
                          <span>Field: {rule.field}</span>
                          {rule.risk.isBroad ? (
                            <div className="v2-tag-row">
                              <span className="v2-tag v2-tag-warn">Broad trigger</span>
                              {rule.risk.reasons.map((reason) => (
                                <span key={`${rule.id}-${reason}`} className="v2-tag">
                                  {reason}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="v2-link-list">
                          <button type="button" className="v2-secondary-button" onClick={() => startEditingRule(rule)}>
                            Edit
                          </button>
                          <button type="button" className="v2-secondary-button" onClick={() => deleteLearningRule(rule.id)}>
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="v2-micro-note">No learned rules yet. Save one from an edited import row to start teaching the system.</div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

function ImportRowDetail({
  row,
  ingredients,
  productCategoryOptions,
  tradeCategoryOptions,
  batchMap,
  assignImportTarget,
  setImportRowStrategy,
  updateImportField,
  updateImportIndexPart,
  useSuggestedName,
  learningCandidates,
  saveLearningRulesFromRow,
  applyRowFieldsToSimilar,
  createVariationForRow,
  generateImportRowInternalCode,
  acceptSuggestion,
  ignoreImportRowPermanently,
  openRecord,
}) {
  const linkedIngredient = row.existingIngredientId
    ? ingredients.find((ingredient) => ingredient.id === row.existingIngredientId) || null
    : null;
  const selectedTargetIngredient = row.targetId
    ? ingredients.find((ingredient) => ingredient.id === row.targetId) || null
    : null;
  const suggestedTargetIngredient =
    !selectedTargetIngredient && row.suggestedTargetId
      ? ingredients.find((ingredient) => ingredient.id === row.suggestedTargetId) || null
      : null;
  const sourceCodeConflictIngredient =
    String(row.sourceCode || "").trim()
      ? getIngredientSourceCodeConflict(
          ingredients,
          row.sourceCode,
          row.reconcileMode ? row.existingIngredientId || "" : row.targetId || ""
        )
      : null;
  const comparisonIngredient =
    row.reconcileMode && linkedIngredient
      ? linkedIngredient
      : row.strategy === "merge"
        ? selectedTargetIngredient || suggestedTargetIngredient
        : suggestedTargetIngredient || sourceCodeConflictIngredient;
  const comparisonLabel =
    row.reconcileMode && linkedIngredient
      ? "Current master ingredient"
      : selectedTargetIngredient
        ? "Selected master ingredient"
        : suggestedTargetIngredient
          ? "Possible master match"
          : sourceCodeConflictIngredient
            ? "Existing ingredient already using this Soft1 code"
            : "";
  const comparisonRows = comparisonIngredient ? buildImportComparisonRows(row, comparisonIngredient) : [];
  const changedComparisonRows = comparisonRows.filter((item) => item.changed);
  const linkedBatch = linkedIngredient?.batchId ? batchMap.get(linkedIngredient.batchId) || null : null;
  const canUseSourceCodeConflictAsMergeTarget = Boolean(
    sourceCodeConflictIngredient &&
      sourceCodeConflictIngredient.id !== row.existingIngredientId &&
      row.targetId !== sourceCodeConflictIngredient.id
  );
  const comparisonMessage =
    sourceCodeConflictIngredient && comparisonIngredient?.id === sourceCodeConflictIngredient.id
      ? comparisonIngredient.archived
        ? "This Soft1 code is already owned by an archived ingredient. Open it first so you can restore, review, or merge deliberately before creating anything new."
        : "This Soft1 code is already owned by a master ingredient. Use that ingredient as the merge target instead of creating another one."
      : row.reconcileMode && comparisonIngredient
        ? changedComparisonRows.length
          ? `This already exists in master and differs on ${changedComparisonRows.length} key field${changedComparisonRows.length === 1 ? "" : "s"}. Review the differences below, then use Approve into master if the review row is better.`
          : "This already exists in master and the main fields already match. If you do not need this review row, use Delete review item to clear it permanently."
        : row.strategy === "merge" && comparisonIngredient
          ? selectedTargetIngredient
            ? "This row is set to merge into the selected master ingredient. Check the differences below, then use Merge into master if it is the right target."
            : "A likely master match has been found. If it is the same ingredient, switch to Merge into existing and confirm the target."
          : suggestedTargetIngredient
            ? "A possible master match has been found by clean name. Review it manually, then decide whether to merge or keep this as a separate ingredient."
          : "This row is not currently linked to a master ingredient. If it is genuinely new, use Add to master.";
  const [showAllMergeTargets, setShowAllMergeTargets] = useState(false);
  const [mergeTargetQuery, setMergeTargetQuery] = useState("");

  useEffect(() => {
    setShowAllMergeTargets(false);
    setMergeTargetQuery("");
  }, [row.id]);

  const mergeTargetOptions = ingredients
    .filter((ingredient) => !row.reconcileMode || ingredient.id !== row.existingIngredientId)
    .map((ingredient) => ({
      ingredient,
      score: scoreMergeTargetCandidate(row, ingredient),
    }))
    .sort((left, right) => right.score - left.score || left.ingredient.name.localeCompare(right.ingredient.name));

  const likelyMergeTargets = mergeTargetOptions.filter((item) => item.score >= 35);
  const trimmedMergeTargetQuery = mergeTargetQuery.trim();
  const searchedMergeTargets = trimmedMergeTargetQuery
    ? mergeTargetOptions
        .map((item) => ({
          ...item,
          searchScore: scoreIngredientSearchMatch(item.ingredient, trimmedMergeTargetQuery),
        }))
        .filter((item) => item.searchScore >= 50)
        .sort(
          (left, right) =>
            right.searchScore - left.searchScore ||
            right.score - left.score ||
            left.ingredient.name.localeCompare(right.ingredient.name)
        )
    : [];
  const visibleMergeTargets = trimmedMergeTargetQuery
    ? searchedMergeTargets
    : (showAllMergeTargets ? mergeTargetOptions : (likelyMergeTargets.length ? likelyMergeTargets : mergeTargetOptions.slice(0, 10)));

  return (
    <>
      <DetailHeader title={row.chosenName} subtitle={`${row.sourceCode} -> ${row.internalCode}`} status={row.reviewStatus} />
      <DetailSection title="Update ingredient">
        <div className="v2-form-grid">
          <label className="v2-field">
            <span>Raw Soft1 name</span>
            <input value={row.rawName || ""} readOnly />
          </label>
          <label className="v2-field">
            <span>Average price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={Number(row.averagePrice || 0)}
              onChange={(event) => updateImportField(row.id, "averagePrice", event.target.value)}
            />
          </label>
          <label className="v2-field">
            <span>Pack size</span>
            <input value={row.packSize || ""} onChange={(event) => updateImportField(row.id, "packSize", event.target.value)} />
          </label>
          <label className="v2-field">
            <span>Trade category</span>
            <input
              value={row.tradeCategory || ""}
              list={`trade-category-options-${row.id}`}
              onChange={(event) => updateImportField(row.id, "tradeCategory", event.target.value)}
            />
            <datalist id={`trade-category-options-${row.id}`}>
              {(tradeCategoryOptions || []).map((category) => (
                <option key={`${row.id}-trade-${category}`} value={category} />
              ))}
            </datalist>
          </label>
          <label className="v2-field">
            <span>Product category</span>
            <input
              value={row.productCategory || ""}
              list={`product-category-options-${row.id}`}
              onChange={(event) => updateImportField(row.id, "productCategory", event.target.value)}
            />
            <datalist id={`product-category-options-${row.id}`}>
              {(productCategoryOptions || []).map((category) => (
                <option key={`${row.id}-${category}`} value={category} />
              ))}
            </datalist>
          </label>
          <label className="v2-field">
            <span>Source code</span>
            <input value={row.sourceCode || ""} readOnly={Boolean(row.reconcileMode)} onChange={(event) => updateImportField(row.id, "sourceCode", event.target.value)} />
          </label>
        </div>
      </DetailSection>
      {row.packSizeNeedsReview ? (
        <div className="v2-inline-callout warn">
          <strong>Pack size needs review</strong>
          <span>
            This source row looks piece-based but does not include a clear pack size in the description. Add the pack detail before trusting pricing or choosing between variations.
          </span>
        </div>
      ) : null}
      {row.likelyMultipackReview ? (
        <div className="v2-inline-callout warn">
          <strong>Likely multipack</strong>
          <span>
            This piece-based snack row looks too expensive to be a single unit. It likely represents a retail box or multipack, so add the pack detail before publishing it into master.
          </span>
        </div>
      ) : null}
      {row.assumedFreshSeafood ? (
        <div className="v2-inline-callout warn">
          <strong>Assumed fresh seafood</strong>
          <span>
            This seafood row came from a frozen fish/seafood trade bucket, but the source name does not say frozen, so it has been treated as fresh for review.
          </span>
        </div>
      ) : null}
      {row.assumedFrozenProduce ? (
        <div className="v2-inline-callout warn">
          <strong>Assumed frozen produce</strong>
          <span>
            This produce row came from a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review.
          </span>
        </div>
      ) : null}
      {row.assumedFrozenFruit ? (
        <div className="v2-inline-callout warn">
          <strong>Assumed frozen fruit</strong>
          <span>
            This fruit row came from a frozen fruit/vegetable trade bucket and does not say fresh, so it has been treated as frozen for review.
          </span>
        </div>
      ) : null}
      {row.categoryStateConflict ? (
        <div className="v2-inline-callout warn">
          <strong>State/category conflict</strong>
          <span>
            The source wording explicitly says {String(row.explicitState || "").toLowerCase()}, so the category has been adjusted away from the imported category for this review row.
          </span>
        </div>
      ) : null}
      <div className="v2-tag-row">
        <span className="v2-tag">{row.confidenceLabel}</span>
        <span className="v2-tag">Score {row.confidenceScore}</span>
        {(row.appliedLearningRules || []).map((rule) => (
          <span key={`${rule.field}-${rule.trigger}-${rule.value}`} className="v2-tag">
            Rule: {rule.label}
          </span>
        ))}
        {linkedBatch ? <span className="v2-tag">Linked component draft: {linkedBatch.name}</span> : null}
      </div>
      <DetailSection title="Master comparison">
        <div className={`v2-inline-callout ${comparisonIngredient ? (changedComparisonRows.length ? "warn" : "") : ""}`}>
          <strong>
            {comparisonIngredient
              ? `${comparisonLabel}: ${comparisonIngredient.name}`
              : "No master ingredient linked yet"}
          </strong>
          <span>{comparisonMessage}</span>
        </div>
        {comparisonIngredient ? (
          <>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => openRecord("ingredient", comparisonIngredient.id)}>
                Open master ingredient
              </button>
              {canUseSourceCodeConflictAsMergeTarget ? (
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => assignImportTarget(row.id, sourceCodeConflictIngredient.id)}
                >
                  Use this as merge target
                </button>
              ) : null}
            </div>
            <div className="v2-compare-list">
              {comparisonRows.map((item) => (
                <div key={item.key} className={`v2-compare-row ${item.changed ? "changed" : ""}`}>
                  <strong>{item.label}</strong>
                  <span>Review: {formatImportComparisonDisplayValue(item.reviewValue, item.type)}</span>
                  <span>Master: {formatImportComparisonDisplayValue(item.masterValue, item.type)}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </DetailSection>
      {row.confidenceBreakdown?.recognized?.length || row.confidenceBreakdown?.missingCore?.length || row.confidenceBreakdown?.needsAttention?.length ? (
        <DetailSection title="Confidence breakdown">
          {row.confidenceBreakdown.recognized.length ? (
            <div className="v2-micro-note">Recognized: {row.confidenceBreakdown.recognized.join(", ")}</div>
          ) : null}
          {row.confidenceBreakdown.missingCore.length ? (
            <div className="v2-micro-note">Still missing: {row.confidenceBreakdown.missingCore.join(", ")}</div>
          ) : null}
          {row.confidenceBreakdown.needsAttention.length ? (
            <div className="v2-tag-row">
              {row.confidenceBreakdown.needsAttention.map((item) => (
                <span key={item} className="v2-tag">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      <DetailSection title="Ingredient name - clean">
        <div className="v2-index-grid">
          {ingredientIndexFields.map((field) => (
            <label key={field.key} className="v2-field">
              <span>{field.label}</span>
              <input value={row.nameIndex[field.key] || ""} onChange={(event) => updateImportIndexPart(row.id, field.key, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="v2-inline-callout">
          <strong>Indexed suggestion</strong>
          <span>{row.suggestedName}</span>
        </div>
        <label className="v2-field">
          <span>Chosen ingredient name - clean</span>
          <input value={row.chosenName} onChange={(event) => updateImportField(row.id, "chosenName", event.target.value)} />
        </label>
        <div className="v2-link-list">
          <button type="button" className="v2-secondary-button" onClick={() => useSuggestedName(row.id)}>
            Use indexed suggestion
          </button>
        </div>
        {learningCandidates.length || row.confidenceScore >= 50 ? (
          <div className="v2-micro-note">
            Advanced cleanup tools are still available below if you want to spread or save a pattern deliberately.
          </div>
        ) : null}
        {learningCandidates.length ? (
          <div className="v2-tag-row">
            {learningCandidates.map((candidate) => (
              <span key={candidate.id} className="v2-tag">
                Learn {candidate.label}: "{candidate.trigger}" to {candidate.value}
              </span>
            ))}
          </div>
        ) : null}
        <p>{row.decisionNote}</p>
      </DetailSection>

      <DetailSection title="Aliases">
        {row.aliasCandidate ? <div className="v2-tag-row"><span className="v2-tag">Alias to retain: {row.aliasCandidate}</span></div> : null}
        {row.targetId ? (
          <div className="v2-micro-note">
            Existing aliases on this clean ingredient: {(ingredients.find((ingredient) => ingredient.id === row.targetId)?.aliases || []).length}
          </div>
        ) : null}
      </DetailSection>

      {learningCandidates.length || row.strategy !== "merge" ? (
        <DetailSection title="Advanced cleanup tools">
          <div className="v2-micro-note">
            Use these only when you want to deliberately spread a cleanup pattern, not for routine row-by-row review.
          </div>
          <div className="v2-link-list">
            {row.strategy !== "merge" ? (
              <button type="button" className="v2-secondary-button" onClick={() => applyRowFieldsToSimilar(row.id)}>
                Apply to similar rows
              </button>
            ) : null}
            <button
              type="button"
              className="v2-secondary-button"
              onClick={() => saveLearningRulesFromRow(row.id)}
              disabled={!learningCandidates.length}
            >
              Learn from this edit
            </button>
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="Choose path">
        <div className="v2-link-list">
          {row.reconcileMode ? (
            <button
              type="button"
              className={`v2-link-chip ${row.strategy === "update" ? "active" : ""}`}
              onClick={() => setImportRowStrategy(row.id, "update")}
            >
              Update current ingredient
            </button>
          ) : null}
          <button
            type="button"
            className={`v2-link-chip ${row.strategy === "merge" ? "active" : ""}`}
            onClick={() => setImportRowStrategy(row.id, "merge")}
          >
            Merge into existing
          </button>
          <button
            type="button"
            className={`v2-link-chip ${row.strategy === "create" ? "active" : ""}`}
            onClick={() => setImportRowStrategy(row.id, "create")}
            disabled={Boolean(sourceCodeConflictIngredient && !row.reconcileMode)}
          >
            Create clean ingredient
          </button>
        </div>
        {sourceCodeConflictIngredient && row.strategy !== "merge" ? (
          <div className="v2-inline-callout warn">
            <strong>Soft1 code already exists in master</strong>
            <span>
              {sourceCodeConflictIngredient.name} already owns {row.sourceCode}.
              {sourceCodeConflictIngredient.archived ? " It is archived, so open it first before deciding whether to restore or merge." : " Use it as the merge target instead of creating a second ingredient."}
            </span>
          </div>
        ) : null}
        {row.suggestedTargetId && row.strategy !== "merge" ? (
          <div className="v2-inline-callout">
            <strong>Possible merge candidate</strong>
            <span>{row.suggestedTargetName}</span>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => assignImportTarget(row.id, row.suggestedTargetId)}>
                Use this merge target
              </button>
            </div>
          </div>
        ) : null}
      </DetailSection>

      {row.strategy !== "merge" || row.needsCodeReview ? (
      <DetailSection title="Code handling">
        <label className="v2-field">
          <span>Internal ingredient code</span>
          <input value={row.internalCode} onChange={(event) => updateImportField(row.id, "internalCode", event.target.value)} />
        </label>
        <div className="v2-link-list">
          <button
            type="button"
            className="v2-secondary-button"
            onClick={() => generateImportRowInternalCode(row.id)}
            disabled={row.strategy === "merge" && Boolean(row.targetId)}
          >
            Generate internal code
          </button>
        </div>
        {row.needsCodeReview ? (
          <div className="v2-inline-callout warn">
            <strong>Variation code required</strong>
            <span>This source item code appears more than once. Keep the source code, but publish a system variation code too.</span>
          </div>
        ) : null}
        {row.needsCodeReview ? (
          <button type="button" className="v2-secondary-button" onClick={() => createVariationForRow(row.id)}>
            Suggest variation code
          </button>
        ) : null}
      </DetailSection>
      ) : null}

      {row.strategy === "merge" ? (
        <DetailSection title="Merge target">
          <label className="v2-field">
            <span>Search existing ingredients</span>
            <input
              value={mergeTargetQuery}
              onChange={(event) => setMergeTargetQuery(event.target.value)}
              placeholder="Search by name, code, alias, supplier, or category"
            />
          </label>
          <div className="v2-select-list">
            {visibleMergeTargets.map(({ ingredient, score }) => (
              <button
                key={ingredient.id}
                type="button"
                className={`v2-select-row ${row.targetId === ingredient.id ? "active" : ""}`}
                onClick={() => assignImportTarget(row.id, ingredient.id)}
              >
                <strong>{ingredient.name}</strong>
                <span>{ingredient.code} · source {ingredient.sourceCode}</span>
                <span>Match score {Math.round(score)}</span>
              </button>
            ))}
          </div>
          {trimmedMergeTargetQuery && !visibleMergeTargets.length ? (
            <div className="v2-micro-note">No existing ingredients match that search yet.</div>
          ) : null}
          {!trimmedMergeTargetQuery && mergeTargetOptions.length > visibleMergeTargets.length ? (
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => setShowAllMergeTargets((current) => !current)}>
                {showAllMergeTargets ? "Show likely targets only" : `Show all targets (${mergeTargetOptions.length})`}
              </button>
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      <DetailSection title="Choose outcome">
        <div className="v2-micro-note">
          Pick one outcome only: approve into master, merge into an existing ingredient, or delete this review item permanently.
        </div>
        <div className="v2-link-list">
          <button type="button" className="v2-primary-button" onClick={() => acceptSuggestion(row.id)}>
            {row.strategy === "merge"
              ? "Merge into master"
              : row.reconcileMode
                ? "Approve into master"
                : "Add to master"}
          </button>
          <button type="button" className="v2-secondary-button" onClick={() => ignoreImportRowPermanently(row.id)}>
            Delete review item
          </button>
        </div>
      </DetailSection>
    </>
  );
}

function RecipeWorkflowDetail({
  record,
  openRecord,
  maps,
  recipeEditorStep,
  setRecipeEditorStep,
  ingredientMaster,
  batches,
  updateRecipeField,
  markRecipeReady,
  publishRecipeLive,
  moveRecipeToDraft,
  unpublishRecipe,
  toggleRecipeServiceSuitability,
  updateRecipeFinishedDishImage,
  updateRecipeMethodStep,
  addRecipeMethodStep,
  saveRecipeToSharedData,
  recipeSharedSyncState,
  toggleRecipeReviewFlag,
  updateRecipeIngredientLine,
  updateRecipeBatchLine,
  toggleRecipeIngredientLink,
  toggleRecipeBatchLink,
  openIngredientMaker,
  openRecipeCostSheetPreview,
  openRecipeChefSheetPreview,
  archiveRecipe,
  restoreRecipe,
  deleteRecipePermanently,
}) {
  const safeIngredientLines = Array.isArray(record?.ingredientLines) ? record.ingredientLines : [];
  const safeBatchLines = Array.isArray(record?.batchLines) ? record.batchLines : [];
  const safeMenuIds = Array.isArray(record?.menuIds) ? record.menuIds : [];
  const safeServiceSuitability = Array.isArray(record?.serviceSuitability) ? record.serviceSuitability : [];
  const safeMethodSteps = Array.isArray(record?.methodSteps) ? record.methodSteps : [];
  const [ingredientPickerQuery, setIngredientPickerQuery] = useState("");
  const [batchPickerQuery, setBatchPickerQuery] = useState("");
  const [activePicker, setActivePicker] = useState("");
  const deferredIngredientPickerQuery = useDeferredValue(ingredientPickerQuery);
  const deferredBatchPickerQuery = useDeferredValue(batchPickerQuery);
  const ingredientLinks = safeIngredientLines
    .map((line) => ({
      ...line,
      ingredient: maps.ingredient.get(line.ingredientId),
      estimatedCost: calculateLineEstimatedCost(
        line,
        getIngredientCostSource(maps.ingredient.get(line.ingredientId), maps.ingredient, maps.batch)
      ),
    }))
    .filter((line) => line.ingredient);
  const batchLinks = safeBatchLines
    .map((line) => ({
      ...line,
      batch: maps.batch.get(line.batchId),
      estimatedCost: calculateLineEstimatedCost(line, getBatchCostSource(maps.batch.get(line.batchId), maps.ingredient)),
    }))
    .filter((line) => line.batch);
  const menuLinks = safeMenuIds.map((id) => maps.menu.get(id)).filter(Boolean);
  const pricingMetrics = getRecipePricingMetrics(record, maps.ingredient, maps.batch);
  const progress = getRecipeWorkflowProgress(record);
  const recipeReadyToPublish = progress.completeCount === progress.total;
  const currentStepIndex = recipeWorkflowSteps.findIndex((step) => step.id === recipeEditorStep);
  const previousStep = currentStepIndex > 0 ? recipeWorkflowSteps[currentStepIndex - 1] : null;
  const nextStep =
    currentStepIndex >= 0 && currentStepIndex < recipeWorkflowSteps.length - 1
      ? recipeWorkflowSteps[currentStepIndex + 1]
      : null;
  const footerPrimaryLabel = nextStep
    ? "Next step"
    : record.status === "draft"
      ? "Mark ready"
      : record.status === "review"
        ? recipeReadyToPublish
          ? "Publish live"
          : "Needs work"
        : "Live";
  const footerPrimaryDisabled = !nextStep && (record.status === "live" || (record.status === "review" && !recipeReadyToPublish));
  const ingredientPickerResults = useMemo(() => {
    const query = deferredIngredientPickerQuery.trim();
    if (!query) return [];

    return ingredientMaster
      .map((ingredient) => ({
        ingredient,
        score: scoreIngredientSearchMatch(ingredient, query),
      }))
      .filter((match) => match.score >= 50)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.ingredient.name.localeCompare(right.ingredient.name);
      })
      .slice(0, 18);
  }, [deferredIngredientPickerQuery, ingredientMaster]);
  const batchPickerResults = useMemo(() => {
    const query = deferredBatchPickerQuery.trim();
    if (!query) return [];

    return batches
      .map((batch) => ({
        batch,
        score: scoreBatchSearchMatch(batch, query, maps.ingredient),
      }))
      .filter((match) => match.score >= 50)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.batch.name.localeCompare(right.batch.name);
      })
      .slice(0, 18);
  }, [batches, deferredBatchPickerQuery, maps.ingredient]);
  const handleFinishedDishImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      updateRecipeFinishedDishImage(record.id, typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  };

  const openIngredientPicker = () => {
    setIngredientPickerQuery("");
    setActivePicker("ingredient");
  };

  const openBatchPicker = () => {
    setBatchPickerQuery("");
    setActivePicker("batch");
  };

  const closePicker = () => {
    setActivePicker("");
  };

  const chooseIngredientFromPicker = (ingredient) => {
    toggleRecipeIngredientLink(record.id, ingredient);
    closePicker();
  };

  const createIngredientFromPicker = () => {
    closePicker();
    openIngredientMaker({ attachToRecipeId: record.id, openRecordAfterSave: false });
  };
  const menuRestaurants = Array.from(new Set(menuLinks.map((menu) => menu.restaurant).filter(Boolean))).sort();
  const menuServices = Array.from(new Set(menuLinks.map((menu) => menu.service).filter(Boolean))).sort();
  const recipeSaveState = String(recipeSharedSyncState || "").trim();
  const goToRecipeStep = async (nextRecipeStep) => {
    if (nextRecipeStep === recipeEditorStep) return;
    if (record.sharedDirty && saveRecipeToSharedData) {
      const saved = await saveRecipeToSharedData(record.id, { quiet: true });
      if (!saved) return;
    }
    setRecipeEditorStep(nextRecipeStep);
  };

  const handleFooterPrimaryAction = async () => {
    if (nextStep) {
      if (record.sharedDirty && saveRecipeToSharedData) {
        const saved = await saveRecipeToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      setRecipeEditorStep(nextStep.id);
      return;
    }

    if (record.status === "draft") {
      markRecipeReady(record.id);
      return;
    }

    if (record.status === "review" && recipeReadyToPublish) {
      publishRecipeLive(record.id);
    }
  };

  return (
    <div className={`v2-recipe-shell ${activePicker ? "picker-open" : ""}`}>
      <div className="v2-recipe-main">
      <DetailHeader title={record.name} subtitle={`${record.code} · ${record.category}`} status={record.status} statusLabel={getRecipeStageLabel(record.status)} />
      <div className="v2-detail-grid">
        <DetailStat label="Portions" value={`${record.portions}`} />
        <DetailStat label="Recipe cost" value={formatCurrency(pricingMetrics.recipeCost)} />
        <DetailStat label="Gross sale price" value={formatCurrency(record.salePrice)} />
        <DetailStat label="GP (net)" value={formatPercent(pricingMetrics.grossProfit)} />
      </div>
      <div className="v2-tag-row">
        <span className="v2-tag">
          {progress.completeCount}/{progress.total} steps ready
        </span>
        {record.sharedMissingLineCount ? (
          <span className="v2-tag">Missing {record.sharedMissingLineCount} source line{record.sharedMissingLineCount === 1 ? "" : "s"}</span>
        ) : null}
      </div>
      {record.sharedMissingLineCount ? (
        <div className="v2-inline-callout warn">
          <strong>Some source lines could not be matched on load.</strong>
          <span>
            {record.sharedMissingLineDetails?.length
              ? `Missing: ${record.sharedMissingLineDetails.map(formatMissingSharedSourceLineDetail).join("; ")}.`
              : record.sharedMissingLineLabels?.length
              ? `Missing: ${record.sharedMissingLineLabels.join(", ")}.`
              : "This recipe may be incomplete and should be reviewed before use."}
          </span>
        </div>
      ) : null}
      <div className="v2-step-nav">
        {recipeWorkflowSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`v2-step-button ${recipeEditorStep === step.id ? "active" : ""}`}
            onClick={() => goToRecipeStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </div>

      {recipeEditorStep === "basics" ? (
        <DetailSection title="Basics">
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Dish name</span>
              <input value={record.name} onChange={(event) => updateRecipeField(record.id, "name", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Recipe code</span>
              <input value={record.code} onChange={(event) => updateRecipeField(record.id, "code", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Category</span>
              <select value={record.category} onChange={(event) => updateRecipeField(record.id, "category", event.target.value)}>
                {recipeCategoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="v2-field">
              <span>Stage</span>
              <input value={titleCaseWords(getRecipeStageLabel(record.status))} readOnly />
            </label>
          </div>
          <div className="v2-field">
            <span>Service suitability</span>
            <div className="v2-chip-grid">
              {recipeServiceOptions.map((service) => {
                const isActive = safeServiceSuitability.includes(service);
                return (
                  <button
                    key={service}
                    type="button"
                    className={`v2-link-chip ${isActive ? "active" : ""}`}
                    onClick={() => toggleRecipeServiceSuitability(record.id, service)}
                  >
                    {service}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="v2-field">
            <span>Menu description</span>
            <textarea value={record.menuDescription} onChange={(event) => updateRecipeField(record.id, "menuDescription", event.target.value)} />
          </label>
        </DetailSection>
      ) : null}

      {recipeEditorStep === "components" ? (
        <DetailSection title="Ingredients">
          <div className="v2-editor-block">
            <div className="v2-detail-toolbar">
              <div>
                <strong>Recipe lines</strong>
                <span>Add simple ingredients or reusable components into one recipe line list.</span>
              </div>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={openIngredientPicker}>
                  Add ingredient
                </button>
              </div>
            </div>
            {ingredientLinks.length || batchLinks.length ? (
              <div className="v2-stack">
                {ingredientLinks.map((line) => (
                  <div key={line.ingredientId} className="v2-line-card">
                    <div>
                      <strong>{line.ingredient.name}</strong>
                      <span>{line.ingredient.code} · {line.ingredient.packSize}</span>
                    </div>
                    <div className="v2-form-grid compact">
                      <label className="v2-field">
                        <span>Qty</span>
                        <input value={line.quantity} onChange={(event) => updateRecipeIngredientLine(record.id, line.ingredientId, "quantity", event.target.value)} />
                      </label>
                      <label className="v2-field">
                        <span>Unit</span>
                        <select value={line.unit} onChange={(event) => updateRecipeIngredientLine(record.id, line.ingredientId, "unit", event.target.value)}>
                          {measurementUnitOptions.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="v2-field">
                        <span>Estimated cost</span>
                        <input value={formatCurrency(line.estimatedCost)} readOnly />
                      </label>
                    </div>
                    <div className="v2-link-list">
                      <button type="button" className="v2-secondary-button" onClick={() => openRecord("ingredient", line.ingredientId)}>
                        Open ingredient
                      </button>
                      <button type="button" className="v2-secondary-button" onClick={() => toggleRecipeIngredientLink(record.id, line.ingredient)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v2-micro-note">No ingredient or component lines yet.</div>
            )}
            {batchLinks.length ? (
              <div className="v2-inline-callout warn">
                <strong>Legacy direct component links still need repair.</strong>
                <span>
                  This recipe still has {batchLinks.length} direct component link{batchLinks.length === 1 ? "" : "s"}. Publish those
                  components into the ingredient master, then re-add them as ingredients so the recipe matches the ingredient-only workflow.
                </span>
              </div>
            ) : null}
          </div>

        </DetailSection>
      ) : null}

      {recipeEditorStep === "method" ? (
        <DetailSection title="Method">
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Method steps</span>
                <div className="v2-step-list">
                {safeMethodSteps.map((step, index) => (
                  <div key={`method-step-${index}`} className="v2-step-list-row">
                    <div className="v2-step-index">{index + 1}</div>
                    <textarea
                      value={step}
                      onChange={(event) => updateRecipeMethodStep(record.id, index, event.target.value)}
                      placeholder={`Step ${index + 1}`}
                    />
                  </div>
                ))}
              </div>
              <button type="button" className="v2-secondary-button" onClick={() => addRecipeMethodStep(record.id)}>
                Add method step
              </button>
            </label>
            <label className="v2-field">
              <span>Prep notes</span>
              <textarea value={record.prepNotes} onChange={(event) => updateRecipeField(record.id, "prepNotes", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Plating notes</span>
              <textarea value={record.platingNotes} onChange={(event) => updateRecipeField(record.id, "platingNotes", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Service notes</span>
              <textarea value={record.chefNotes} onChange={(event) => updateRecipeField(record.id, "chefNotes", event.target.value)} />
            </label>
          </div>
          <div className="v2-editor-block">
            <strong>Finished dish image</strong>
            <label className="v2-field">
              <span>Upload plating reference</span>
              <input type="file" accept="image/*" onChange={handleFinishedDishImageChange} />
            </label>
            {record.finishedDishImage ? (
              <div className="v2-image-preview">
                <img src={record.finishedDishImage} alt={`${record.name} finished dish`} />
              </div>
            ) : null}
          </div>
        </DetailSection>
      ) : null}

      {recipeEditorStep === "pricing" ? (
        <DetailSection title="Portions and pricing">
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Portions</span>
              <input type="number" min="1" value={record.portions} onChange={(event) => updateRecipeField(record.id, "portions", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Gross sale price</span>
              <input type="number" min="0" step="0.01" value={record.salePrice} onChange={(event) => updateRecipeField(record.id, "salePrice", event.target.value)} />
            </label>
          </div>
          <div className="v2-summary-grid v2-summary-grid-pricing-main">
            <SummaryCard label="Recipe Cost / Portion" value={formatCurrency(pricingMetrics.recipeCost)} tone="default" />
            <SummaryCard label="Gross Sale Price" value={formatCurrency(record.salePrice)} tone="default" />
            <SummaryCard label="Net Sale Price" value={formatCurrency(pricingMetrics.netSalePrice)} tone="default" />
            <SummaryCard label="GP (Net)" value={formatPercent(pricingMetrics.grossProfit)} tone={pricingMetrics.grossProfit >= 75 ? "good" : "review"} />
          </div>
          <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
            <SummaryCard label="Component Total" value={formatCurrency(pricingMetrics.totalComponentCost)} tone="default" />
            <SummaryCard label="Roundup Target" value={formatCurrency(pricingMetrics.roundup)} tone="default" />
            <SummaryCard label="Variance" value={formatCurrency(pricingMetrics.variance)} tone={pricingMetrics.variance >= 0 ? "good" : "review"} />
            <SummaryCard label="Pricing Ready" value={pricingMetrics.pricingComplete === "1" ? "Yes" : "No"} tone={pricingMetrics.pricingComplete === "1" ? "good" : "review"} />
          </div>
        </DetailSection>
      ) : null}

      {recipeEditorStep === "usage" ? (
        <DetailSection title="Usage">
          <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
            <SummaryCard label="Menus" value={String(menuLinks.length)} tone="default" />
            <SummaryCard label="Restaurants" value={String(menuRestaurants.length)} tone="default" />
            <SummaryCard label="Services" value={String(menuServices.length)} tone="default" />
            <SummaryCard label="Stage" value={titleCaseWords(getRecipeStageLabel(record.status))} tone={record.status === "live" ? "good" : "review"} />
          </div>
          <div className="v2-editor-block">
            <strong>Workflow</strong>
            <div className="v2-micro-note">
              {recipeReadyToPublish
                ? "All recipe steps are complete and this dish can move through the publish flow."
                : `${progress.completeCount}/${progress.total} steps are complete. Finish the remaining steps before marking this recipe ready.`}
            </div>
            <div className={`v2-inline-callout ${record.status === "live" ? "" : "warn"}`}>
              <strong>
                {record.status === "live"
                  ? "This recipe is live"
                  : record.status === "review" && recipeReadyToPublish
                    ? "This recipe is ready in the library"
                    : record.status === "review"
                      ? "This recipe needs attention before it can stay ready"
                    : "This recipe is still in draft"}
              </strong>
              <span>
                {record.status === "live"
                  ? "It is available as a live recipe and can be pulled back to ready or draft if you need to revise it."
                  : record.status === "review" && recipeReadyToPublish
                    ? "Use Publish live below, or open the Ready filter in the recipe library if you want to publish several dishes together."
                    : record.status === "review"
                      ? `${progress.completeCount}/${progress.total} steps are complete. Finish the remaining steps or move this recipe back to draft so the workflow status matches the work left to do.`
                    : "Finish the missing workflow steps, then use Mark ready to move it into the library's Ready stage."}
              </span>
            </div>
            <div className={`v2-inline-callout ${recipeSaveState && recipeSaveState !== "saved" ? "warn" : ""}`}>
              <strong>
                {recipeSaveState === "syncing"
                  ? "Saving recipe..."
                  : recipeSaveState && recipeSaveState !== "saved"
                    ? "Recipe save error"
                    : record.sharedDirty
                      ? "Unsaved recipe changes"
                      : "Recipe saved"}
              </strong>
              <span>
                {recipeSaveState === "syncing"
                  ? "This recipe is syncing to shared data now."
                  : recipeSaveState && recipeSaveState !== "saved"
                    ? recipeSaveState
                    : record.sharedDirty
                      ? "Use Save now if you want to force the shared save before moving on."
                      : "The latest recipe edits are saved to shared data."}
              </span>
            </div>
            <div className="v2-link-list">
              {record.status === "draft" && recipeReadyToPublish ? (
                <button type="button" className="v2-primary-button" onClick={() => markRecipeReady(record.id)}>
                  Mark ready
                </button>
              ) : null}
              {record.status === "review" && recipeReadyToPublish ? (
                <button type="button" className="v2-primary-button" onClick={() => publishRecipeLive(record.id)}>
                  Publish live
                </button>
              ) : null}
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => saveRecipeToSharedData(record.id)}
                disabled={recipeSaveState === "syncing" || !record.sharedDirty}
              >
                {recipeSaveState === "syncing" ? "Saving..." : "Save now"}
              </button>
              {record.status === "live" ? (
                <button type="button" className="v2-secondary-button" onClick={() => unpublishRecipe(record.id)}>
                  Return to ready
                </button>
              ) : null}
              {record.status !== "draft" ? (
                <button type="button" className="v2-secondary-button" onClick={() => moveRecipeToDraft(record.id)}>
                  Back to draft
                </button>
              ) : null}
              {record.archived ? (
                <>
                  <button type="button" className="v2-secondary-button" onClick={() => restoreRecipe(record.id)}>
                    Restore recipe
                  </button>
                  <button type="button" className="v2-secondary-button" onClick={() => deleteRecipePermanently(record.id)}>
                    Delete permanently
                  </button>
                </>
              ) : (
                <button type="button" className="v2-secondary-button" onClick={() => archiveRecipe(record.id)}>
                  Archive recipe
                </button>
              )}
            </div>
          </div>
          <div className="v2-editor-block">
            <strong>Exports</strong>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => openRecipeCostSheetPreview(record.id)}>
                Open cost sheet
              </button>
              <button type="button" className="v2-secondary-button" onClick={() => openRecipeChefSheetPreview(record.id)}>
                Open chef sheet
              </button>
            </div>
          </div>
          <div className="v2-editor-block">
            <strong>Menu usage</strong>
            <UsagePreviewList
              items={menuLinks}
              emptyMessage="This dish is not linked to a menu yet."
              renderItem={(menu) => (
                <button key={menu.id} type="button" className="v2-record-row v2-usage-row" onClick={() => openRecord("menu", menu.id)}>
                  <div>
                    <strong>{menu.restaurant} · {menu.service}</strong>
                    <span>{menu.name}</span>
                  </div>
                  <StatusBadge status={menu.status} label={getMenuStageLabel(menu.status)} />
                </button>
              )}
            />
          </div>
        </DetailSection>
      ) : null}

      <div className="v2-step-footer">
        <button type="button" className="v2-secondary-button" onClick={() => previousStep && setRecipeEditorStep(previousStep.id)} disabled={!previousStep}>
          Previous step
        </button>
        <button type="button" className="v2-primary-button" onClick={handleFooterPrimaryAction} disabled={footerPrimaryDisabled}>
          {footerPrimaryLabel}
        </button>
      </div>
      </div>

      {activePicker === "ingredient" ? (
        <aside className="v2-picker-panel v2-picker-panel-inline">
          <div className="v2-panel-header">
            <div>
              <div className="v2-eyebrow">Ingredient Picker</div>
              <h3>Add ingredient</h3>
            </div>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={createIngredientFromPicker}>
                Create ingredient
              </button>
              <button type="button" className="v2-secondary-button" onClick={closePicker}>
                Close
              </button>
            </div>
          </div>
          <label className="v2-field">
            <span>Search ingredients</span>
            <input
              value={ingredientPickerQuery}
              onChange={(event) => setIngredientPickerQuery(event.target.value)}
              placeholder="Start with a broad product like beef, milk, or bread"
            />
          </label>
          {!ingredientPickerQuery.trim() ? null : ingredientPickerResults.length ? (
            <div className="v2-select-list v2-picker-list">
              {ingredientPickerResults.map(({ ingredient, score }) => {
                const isActive = (record.ingredientIds || []).includes(ingredient.id);
                const referencePrice = getIngredientReferencePrice(ingredient);
                const componentIdentifier = getIngredientComponentIdentifier(ingredient, maps.batch);
                return (
                  <button
                    key={ingredient.id}
                    type="button"
                    className={`v2-select-row ${isActive ? "active" : ""}`}
                    onClick={() => chooseIngredientFromPicker(ingredient)}
                  >
                    <strong>{ingredient.name}</strong>
                    <span>{ingredient.code} · {ingredient.packSize} · {ingredient.category}</span>
                    {componentIdentifier ? <span>From: {componentIdentifier}</span> : null}
                    {referencePrice ? (
                      <div className="v2-tag-row">
                        <span className="v2-tag">{formatIngredientReferencePrice(referencePrice, true)}</span>
                        {componentIdentifier ? <span className="v2-tag">Component-derived</span> : null}
                      </div>
                    ) : componentIdentifier ? (
                      <div className="v2-tag-row">
                        <span className="v2-tag">Component-derived</span>
                      </div>
                    ) : null}
                    <span>{isActive ? "Already added to this recipe" : `Estimated cost ${formatCurrency(ingredient.portionCostHint)}`}</span>
                    <span>Search confidence {Math.round(score)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="v2-micro-note">No ingredients match that search.</div>
          )}
        </aside>
      ) : null}

    </div>
  );
}

function BatchWorkflowDetail({
  record,
  openRecord,
  maps,
  relationshipMaps,
  batchEditorStep,
  setBatchEditorStep,
  ingredientMaster,
  updateBatchField,
  updateBatchIngredientLine,
  toggleBatchIngredientLink,
  applyMissingSharedBatchIngredientSuggestion,
  updateBatchMethodStep,
  addBatchMethodStep,
  saveBatchToSharedData,
  batchSharedSyncState,
  toggleBatchReviewFlag,
  markBatchReady,
  moveBatchToDraft,
  returnBatchToReady,
  publishBatchToIngredient,
  openIngredientMaker,
  openIngredientSubstitution,
  openBatchCostSheetPreview,
  openBatchChefSheetPreview,
  archiveBatch,
  restoreBatch,
  deleteBatchPermanently,
  deleteBatchAndPublishedIngredient,
  deletePublishedIngredientFromBatch,
  toggleIngredientSubstitutionReview,
  movePublishedIngredientRecipesToDraft,
  convertBatchToRecipeDraft,
  createMenuForRestaurant,
  updateMenuField,
  addMenuItem,
  updateMenuItemField,
  selectMenuItemRecipe,
  removeMenuItem,
}) {
  const safeIngredientLines = Array.isArray(record?.ingredientLines) ? record.ingredientLines : [];
  const safeMethodSteps = Array.isArray(record?.methodSteps) ? record.methodSteps : [];
  const [ingredientPickerQuery, setIngredientPickerQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const deferredIngredientPickerQuery = useDeferredValue(ingredientPickerQuery);
  const publishedIngredient = record.publishedIngredientId ? maps.ingredient.get(record.publishedIngredientId) : null;
  const ingredientLinks = safeIngredientLines
    .map((line) => ({
      ...line,
      ingredient: maps.ingredient.get(line.ingredientId),
      estimatedCost: calculateLineEstimatedCost(
        line,
        getIngredientCostSource(maps.ingredient.get(line.ingredientId), maps.ingredient, maps.batch)
      ),
    }))
    .filter((line) => line.ingredient);
  const recipeLinks = (relationshipMaps?.batchRecipes?.get(record.id) || [])
    .map((id) => maps.recipe.get(id))
    .filter(Boolean);
  const publishedIngredientRecipeLinks = publishedIngredient
    ? (relationshipMaps?.ingredientRecipes?.get(publishedIngredient.id) || [])
        .map((id) => maps.recipe.get(id))
        .filter(Boolean)
    : [];
  const publishedIngredientBatchLinks = publishedIngredient
    ? Array.from(maps.batch.values()).filter(
        (batch) =>
          batch.id !== record.id &&
          (batch.ingredientLines || []).some((line) => line.ingredientId === publishedIngredient.id)
      )
    : [];
  const canDeletePublishedPair =
    Boolean(publishedIngredient) &&
    !recipeLinks.length &&
    !publishedIngredientRecipeLinks.length &&
    !publishedIngredientBatchLinks.length;
  const convertedRecipe = record.convertedRecipeId ? maps.recipe.get(record.convertedRecipeId) || null : null;
  const batchMenuLinks = Array.from(
    new Map(
      recipeLinks
        .flatMap((recipe) => (recipe.menuIds || []).map((menuId) => maps.menu.get(menuId)))
        .filter(Boolean)
        .map((menu) => [menu.id, menu])
    ).values()
  );
  const batchRestaurants = Array.from(new Set(batchMenuLinks.map((menu) => menu.restaurant).filter(Boolean))).sort();
  const batchServices = Array.from(new Set(batchMenuLinks.map((menu) => menu.service).filter(Boolean))).sort();
  const batchCostSource = getBatchCostSource(record, maps.ingredient);
  const progress = getBatchWorkflowProgress(record, maps.ingredient);
  const batchReadyToPublish = progress.completeCount === progress.total;
  const batchYieldUnitKey = String(record.yieldUnit || "").trim().toLowerCase();
  const batchCostUnitKey = String(batchCostSource?.costUnit || record.costUnit || "").trim().toLowerCase();
  const batchYieldUnitFamily = getMeasurementUnitFamily(batchYieldUnitKey);
  const batchCostUnitFamily = getMeasurementUnitFamily(batchCostUnitKey);
  const batchYieldLabelText = String(record.yieldLabel || "").trim().toLowerCase();
  const batchMissingMethod = !batchHasMethod(record);
  const batchHasPortionYieldSignal =
    batchYieldUnitKey === "portion" ||
    batchCostUnitKey === "portion" ||
    batchYieldLabelText.includes("portion");
  const batchHasYieldConflict = Boolean(
    batchYieldUnitKey &&
      batchCostUnitKey &&
      batchYieldUnitFamily &&
      batchCostUnitFamily &&
      batchYieldUnitFamily !== batchCostUnitFamily
  );
  const batchLooksRecipeLike = batchHasPortionYieldSignal || batchHasYieldConflict;
  const ingredientPickerResults = useMemo(() => {
    const query = deferredIngredientPickerQuery.trim();
    if (!query) return [];

    return ingredientMaster
      .map((ingredient) => ({
        ingredient,
        score: scoreIngredientSearchMatch(ingredient, query),
      }))
      .filter((match) => match.score >= 50)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.ingredient.name.localeCompare(right.ingredient.name);
      })
      .slice(0, 18);
  }, [ingredientMaster, deferredIngredientPickerQuery]);
  const missingIngredientSuggestions = useMemo(
    () =>
      (record.sharedMissingLineDetails || [])
        .map((detail) => ({
          detail,
          suggestions: getSuggestedIngredientsForMissingSharedSourceLine(detail, ingredientMaster).filter(
            ({ ingredient }) => !(record.ingredientIds || []).includes(ingredient.id)
          ),
        }))
        .filter((item) => item.suggestions.length),
    [record.sharedMissingLineDetails, ingredientMaster, record.ingredientIds]
  );
  const currentStepIndex = batchWorkflowSteps.findIndex((step) => step.id === batchEditorStep);
  const previousStep = currentStepIndex > 0 ? batchWorkflowSteps[currentStepIndex - 1] : null;
  const nextStep =
    currentStepIndex >= 0 && currentStepIndex < batchWorkflowSteps.length - 1
      ? batchWorkflowSteps[currentStepIndex + 1]
      : null;
  const footerPrimaryLabel = nextStep
    ? "Next step"
    : record.status === "draft"
      ? "Mark ready"
      : record.status === "review"
        ? "Publish to ingredients"
        : publishedIngredient
          ? "Open published ingredient"
          : "Published";
  const footerPrimaryDisabled = nextStep
    ? false
    : record.status === "draft"
      ? false
      : record.status === "review"
        ? false
        : false;
  const stageBackAction = record.status === "ready" ? "ready" : record.status === "review" ? "draft" : "";
  const stageBackLabel =
    stageBackAction === "ready" ? "Move back to ready" : stageBackAction === "draft" ? "Move back to draft" : "";

  const handleFooterPrimaryAction = async () => {
    if (nextStep) {
      if (record.sharedDirty && saveBatchToSharedData) {
        const saved = await saveBatchToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      setBatchEditorStep(nextStep.id);
      return;
    }

    if (record.status === "draft") {
      markBatchReady(record.id);
      return;
    }

    if (record.status === "review") {
      publishBatchToIngredient(record.id);
      return;
    }

    if (record.status === "ready" && publishedIngredient) {
      openRecord("ingredient", publishedIngredient.id);
    }
  };

  const handleStageBackAction = () => {
    if (stageBackAction === "ready") {
      returnBatchToReady(record.id);
      return;
    }
    if (stageBackAction === "draft") {
      moveBatchToDraft(record.id);
    }
  };

  const closePicker = () => {
    setPickerOpen(false);
    setIngredientPickerQuery("");
  };

  const chooseIngredientFromPicker = (ingredient) => {
    toggleBatchIngredientLink(record.id, ingredient);
    closePicker();
  };

  const createIngredientFromPicker = () => {
    closePicker();
    openIngredientMaker({ attachToBatchId: record.id, openRecordAfterSave: false });
  };

  const batchSaveState = String(batchSharedSyncState || "").trim();

  const normalizeComponentYield = () => {
    const normalizedUnit =
      batchYieldUnitKey && batchYieldUnitKey !== "portion"
        ? batchYieldUnitKey
        : "piece";
    updateBatchField(record.id, "yieldUnit", normalizedUnit);
    updateBatchField(record.id, "costUnit", normalizedUnit);
  };

  return (
    <div className={`v2-recipe-shell ${pickerOpen ? "picker-open" : ""}`}>
      <div className="v2-recipe-main">
      <DetailHeader title={record.name} subtitle={`${record.code} · ${record.yieldLabel || "No yield set"}`} status={record.status} statusLabel={getBatchStageLabel(record.status)} />
      <div className="v2-detail-grid">
        <DetailStat label="Yield" value={record.yieldLabel || "Not set"} />
        <DetailStat label="Cost / unit" value={formatCurrency(batchCostSource.unitCost)} />
        <DetailStat label="Total component cost" value={formatCurrency(batchCostSource.totalComponentCost)} />
        <DetailStat label="Published ingredient" value={publishedIngredient ? publishedIngredient.name : "Not published yet"} />
      </div>
      <div className="v2-step-nav">
        {batchWorkflowSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`v2-step-button ${batchEditorStep === step.id ? "active" : ""}`}
            onClick={() => setBatchEditorStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </div>
      {record.needsReviewFlag ? (
        <div className="v2-tag-row">
          <span className="v2-tag">Needs attention</span>
          {batchMissingMethod ? <span className="v2-tag">Method missing</span> : null}
          {record.sharedMissingLineCount ? (
            <span className="v2-tag">Missing {record.sharedMissingLineCount} source line{record.sharedMissingLineCount === 1 ? "" : "s"}</span>
          ) : null}
        </div>
      ) : record.sharedMissingLineCount ? (
        <div className="v2-tag-row">
          <span className="v2-tag">Missing {record.sharedMissingLineCount} source line{record.sharedMissingLineCount === 1 ? "" : "s"}</span>
        </div>
      ) : batchMissingMethod ? (
        <div className="v2-tag-row">
          <span className="v2-tag">Method missing</span>
        </div>
      ) : null}
      {record.sharedMissingLineCount ? (
        <div className="v2-inline-callout warn">
          <strong>Some source lines could not be matched on load.</strong>
          <span>
            {record.sharedMissingLineDetails?.length
              ? `Missing: ${record.sharedMissingLineDetails.map(formatMissingSharedSourceLineDetail).join("; ")}.`
              : record.sharedMissingLineLabels?.length
              ? `Missing: ${record.sharedMissingLineLabels.join(", ")}.`
              : "This component may be incomplete and should be reviewed before use."}
          </span>
        </div>
      ) : null}
      {missingIngredientSuggestions.length ? (
        <div className="v2-editor-block">
          <strong>Suggested ingredient matches</strong>
          <div className="v2-micro-note">
            We found a few likely ingredient alternatives for the unmatched source lines below. Applying one will add it to this
            component and clear that missing line from the import warning.
          </div>
          <div className="v2-stack">
            {missingIngredientSuggestions.map(({ detail, suggestions }) => (
              <div key={`missing-suggestion-${formatMissingSharedSourceLineDetail(detail)}`} className="v2-line-card">
                <div>
                  <strong>{String(detail?.label || "Unknown source line").trim()}</strong>
                  <span>{[String(detail?.quantity || "").trim(), String(detail?.unit || "").trim()].filter(Boolean).join(" ") || "No qty set"}</span>
                </div>
                <div className="v2-link-list">
                  {suggestions.map(({ ingredient, score }) => (
                    <button
                      key={`${detail.label}-${ingredient.id}`}
                      type="button"
                      className="v2-link-chip"
                      onClick={() => applyMissingSharedBatchIngredientSuggestion(record.id, ingredient, detail)}
                    >
                      Use {ingredient.name} ({Math.round(score)})
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {batchEditorStep === "basics" ? (
        <DetailSection title="Basics">
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Component name</span>
              <input value={record.name} onChange={(event) => updateBatchField(record.id, "name", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Component code</span>
              <input value={record.code} onChange={(event) => updateBatchField(record.id, "code", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Stage</span>
              <input value={titleCaseWords(getBatchStageLabel(record.status))} readOnly />
            </label>
            <label className="v2-field">
              <span>Product type</span>
              <select value={record.productType || ""} onChange={(event) => updateBatchField(record.id, "productType", event.target.value)}>
                <option value="">No product type yet</option>
                {componentProductTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </DetailSection>
      ) : null}

      {batchEditorStep === "components" ? (
        <DetailSection title="Ingredients">
          <div className="v2-editor-block">
            <div className="v2-detail-toolbar">
              <div>
                <strong>Ingredient lines</strong>
                <span>Build this component from ingredient lines before publishing it into the ingredient library.</span>
              </div>
              <div className="v2-link-list">
                <button type="button" className="v2-primary-button" onClick={() => setPickerOpen(true)}>
                  Add ingredient
                </button>
              </div>
            </div>
            {ingredientLinks.length ? (
              <div className="v2-stack">
                {ingredientLinks.map((line) => (
                  <div key={line.ingredientId} className="v2-line-card">
                    <div>
                      <strong>{line.ingredient.name}</strong>
                      <span>{line.ingredient.code} · {line.ingredient.packSize}</span>
                    </div>
                    <div className="v2-form-grid compact">
                      <label className="v2-field">
                        <span>Qty</span>
                        <input value={line.quantity} onChange={(event) => updateBatchIngredientLine(record.id, line.ingredientId, "quantity", event.target.value)} />
                      </label>
                      <label className="v2-field">
                        <span>Unit</span>
                        <select value={line.unit} onChange={(event) => updateBatchIngredientLine(record.id, line.ingredientId, "unit", event.target.value)}>
                          {measurementUnitOptions.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="v2-field">
                        <span>Estimated cost</span>
                        <input value={formatCurrency(line.estimatedCost)} readOnly />
                      </label>
                    </div>
                    <div className="v2-link-list">
                      <button type="button" className="v2-secondary-button" onClick={() => openRecord("ingredient", line.ingredientId)}>
                        Open ingredient
                      </button>
                      <button type="button" className="v2-secondary-button" onClick={() => toggleBatchIngredientLink(record.id, line.ingredient)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v2-micro-note">No ingredient lines linked yet.</div>
            )}
          </div>
        </DetailSection>
      ) : null}

      {batchEditorStep === "method" ? (
        <DetailSection title="Method">
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Method steps</span>
              <div className="v2-step-list">
                {safeMethodSteps.map((step, index) => (
                  <div key={`component-method-step-${index}`} className="v2-step-list-row">
                    <div className="v2-step-index">{index + 1}</div>
                    <textarea
                      value={step}
                      onChange={(event) => updateBatchMethodStep(record.id, index, event.target.value)}
                      placeholder={`Step ${index + 1}`}
                    />
                  </div>
                ))}
              </div>
              <button type="button" className="v2-secondary-button" onClick={() => addBatchMethodStep(record.id)}>
                Add method step
              </button>
            </label>
            <label className="v2-field">
              <span>Prep notes</span>
              <textarea value={record.prepNotes || ""} onChange={(event) => updateBatchField(record.id, "prepNotes", event.target.value)} />
            </label>
          </div>
        </DetailSection>
      ) : null}

      {batchEditorStep === "yield" ? (
        <DetailSection title="Yield and cost">
          {batchLooksRecipeLike ? (
            <div className="v2-inline-callout warn">
              <strong>{batchHasPortionYieldSignal ? "This component is using portion-style yield" : "This component has conflicting yield signals"}</strong>
              <span>
                Recipes should use portions. Components should use a reusable yield like kg, l, or piece. If this is really a dish, convert it to a recipe instead of trying to cost it like a prep base.
              </span>
              <div className="v2-link-list">
                <button type="button" className="v2-secondary-button" onClick={() => convertBatchToRecipeDraft(record.id)}>
                  Save recipe and delete component
                </button>
                <button type="button" className="v2-secondary-button" onClick={normalizeComponentYield}>
                  {batchHasPortionYieldSignal ? "Keep as component using pieces" : "Match cost to yield"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="v2-form-grid">
            <label className="v2-field">
              <span>Yield amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={record.yieldAmount ?? 0}
                onChange={(event) => updateBatchField(record.id, "yieldAmount", event.target.value)}
              />
            </label>
            <label className="v2-field">
              <span>Yield unit</span>
              <select value={record.yieldUnit || "kg"} onChange={(event) => updateBatchField(record.id, "yieldUnit", event.target.value)}>
                {measurementUnitOptions.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="v2-field">
              <span>Cost per unit</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={Number(batchCostSource.unitCost || 0).toFixed(2)}
                readOnly
              />
            </label>
            <label className="v2-field">
              <span>Cost unit</span>
              <input value={batchCostSource.costUnit || record.yieldUnit || "kg"} readOnly />
            </label>
            <label className="v2-field">
              <span>Total component cost</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={Number(batchCostSource.totalComponentCost || 0).toFixed(2)}
                readOnly
              />
            </label>
          </div>
        </DetailSection>
      ) : null}

      {batchEditorStep === "usage" ? (
        <DetailSection title="Usage">
          <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
            <SummaryCard label="Published ingredient" value={publishedIngredient ? "Yes" : "No"} tone={publishedIngredient ? "good" : "review"} />
            <SummaryCard label="Component recipes" value={String(recipeLinks.length)} tone="default" />
            <SummaryCard label="Ingredient recipes" value={String(publishedIngredientRecipeLinks.length)} tone="default" />
            <SummaryCard label="Restaurants" value={String(batchRestaurants.length)} tone="default" />
          </div>
          <div className="v2-editor-block">
            <strong>Status</strong>
            <div className="v2-micro-note">
              {batchReadyToPublish
                ? batchMissingMethod
                  ? "This component can move to ready without a method, but it is tagged so the missing method stays visible."
                  : "All required steps are complete and this component can move through the publish flow."
                : `${progress.completeCount}/${progress.total} steps are complete. Finish the remaining required steps before marking this component ready.`}
            </div>
            <div className={`v2-inline-callout ${batchSaveState && batchSaveState !== "saved" ? "warn" : ""}`}>
              <strong>
                {batchSaveState === "syncing"
                  ? "Saving component..."
                  : batchSaveState && batchSaveState !== "saved"
                    ? "Component save error"
                    : record.sharedDirty
                      ? "Unsaved component changes"
                      : "Component saved"}
              </strong>
              <span>
                {batchSaveState === "syncing"
                  ? "This component is syncing to shared data now."
                  : batchSaveState && batchSaveState !== "saved"
                    ? batchSaveState
                    : record.sharedDirty
                      ? "Use Save now if you want to force the shared save before moving on."
                      : "The latest component edits are saved to shared data."}
              </span>
            </div>
            <div className="v2-micro-note">
              {record.status === "draft"
                ? "Draft components are still being built. When the core details are in place, move this to Ready."
                : record.status === "review"
                  ? "Ready means this component is prepared and waiting to be published into the ingredient library."
                  : "Published means this component already has a live ingredient linked to it."}
            </div>
            <div className="v2-link-list">
              <button type="button" className="v2-primary-button" onClick={handleFooterPrimaryAction} disabled={footerPrimaryDisabled}>
                {footerPrimaryLabel}
              </button>
              {record.status === "ready" ? <span className="v2-tag">Already published to ingredients</span> : null}
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => saveBatchToSharedData(record.id)}
                disabled={batchSaveState === "syncing" || !record.sharedDirty}
              >
                {batchSaveState === "syncing" ? "Saving..." : "Save now"}
              </button>
              {stageBackAction ? (
                <button type="button" className="v2-secondary-button" onClick={handleStageBackAction}>
                  {stageBackLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => toggleBatchReviewFlag(record.id)}
              >
                {record.needsReviewFlag ? "Remove attention tag" : "Tag for attention"}
              </button>
            </div>
          </div>
          <div className="v2-tag-row">
            {record.productType ? <span className="v2-tag">Product type: {record.productType}</span> : null}
            <span className="v2-tag">Stage: {titleCaseWords(getBatchStageLabel(record.status))}</span>
            {record.needsReviewFlag ? <span className="v2-tag">Needs attention</span> : null}
            {convertedRecipe ? <span className="v2-tag">Converted draft recipe: {convertedRecipe.name}</span> : null}
          </div>
          {publishedIngredient ? (
            <div className="v2-editor-block">
              <strong>Published ingredient</strong>
              <div className="v2-link-list">
                <button type="button" className="v2-link-chip" onClick={() => openRecord("ingredient", publishedIngredient.id)}>
                  {publishedIngredient.name}
                </button>
                <button type="button" className="v2-secondary-button" onClick={() => openIngredientSubstitution(publishedIngredient.id)}>
                  Open substitution
                </button>
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => toggleIngredientSubstitutionReview(publishedIngredient.id)}
                >
                  {publishedIngredient.needsSubstitutionReview ? "Remove substitution tag" : "Tag for substitution"}
                </button>
                <button type="button" className="v2-secondary-button" onClick={() => deletePublishedIngredientFromBatch(record.id)}>
                  Delete ingredient
                </button>
                {publishedIngredientRecipeLinks.length ? (
                  <button type="button" className="v2-secondary-button" onClick={() => movePublishedIngredientRecipesToDraft(record.id)}>
                    Move linked ingredient recipes to draft
                  </button>
                ) : null}
              </div>
              {!canDeletePublishedPair ? (
                <div className="v2-micro-note">
                  Keep this published ingredient while it is still linked elsewhere. One-step delete only appears when both records are unused.
                </div>
              ) : null}
              {publishedIngredient.needsSubstitutionReview ? (
                <div className="v2-tag-row">
                  <span className="v2-tag">Needs substitution</span>
                </div>
              ) : null}
              {publishedIngredientRecipeLinks.length ? (
                <div className="v2-micro-note">
                  This published ingredient is still used directly in {publishedIngredientRecipeLinks.length} recipe{publishedIngredientRecipeLinks.length === 1 ? "" : "s"}.
                </div>
              ) : null}
            </div>
          ) : null}
          {publishedIngredientRecipeLinks.length ? (
            <div className="v2-editor-block">
              <strong>Recipes using published ingredient</strong>
              <UsagePreviewList
                items={publishedIngredientRecipeLinks}
                emptyMessage="This published ingredient is not linked to any recipes yet."
                renderItem={(recipe) => (
                  <button key={recipe.id} type="button" className="v2-record-row v2-usage-row" onClick={() => openRecord("recipe", recipe.id)}>
                    <div>
                      <strong>{recipe.name}</strong>
                      <span>{recipe.code} · {recipe.category}</span>
                    </div>
                    <StatusBadge status={recipe.status} label={getRecipeStageLabel(recipe.status)} />
                  </button>
                )}
              />
            </div>
          ) : null}
          <div className="v2-editor-block">
            <strong>Recipes using this component</strong>
            {recipeLinks.length ? (
              <div className="v2-micro-note">
                If this is really a bulked dish and not a true component, converting it will leave these recipes in place for review. They are not deleted automatically.
              </div>
            ) : null}
            <UsagePreviewList
              items={recipeLinks}
              emptyMessage="This component is not linked to any recipes yet."
              renderItem={(recipe) => (
                <button key={recipe.id} type="button" className="v2-record-row v2-usage-row" onClick={() => openRecord("recipe", recipe.id)}>
                  <div>
                    <strong>{recipe.name}</strong>
                    <span>{recipe.code} · {recipe.category}</span>
                  </div>
                  <StatusBadge status={recipe.status} label={getRecipeStageLabel(recipe.status)} />
                </button>
              )}
            />
          </div>
          <div className="v2-editor-block">
            <strong>Actions</strong>
            <div className="v2-micro-note">
              Archive keeps this component recoverable. Convert when this record should really become a plated recipe instead, and the component version should be removed.
            </div>
            <div className="v2-link-list">
              {!record.archived ? (
                <button type="button" className="v2-secondary-button" onClick={() => convertBatchToRecipeDraft(record.id)}>
                  {convertedRecipe ? "Open converted recipe" : "Save recipe and delete component"}
                </button>
              ) : null}
              {!record.archived && canDeletePublishedPair ? (
                <button type="button" className="v2-secondary-button" onClick={() => deleteBatchAndPublishedIngredient(record.id)}>
                  Delete component and ingredient
                </button>
              ) : null}
              {record.archived ? (
                <>
                  <button type="button" className="v2-secondary-button" onClick={() => restoreBatch(record.id)}>
                    Restore component
                  </button>
                  <button type="button" className="v2-secondary-button" onClick={() => deleteBatchPermanently(record.id)}>
                    Delete permanently
                  </button>
                </>
              ) : (
                <button type="button" className="v2-secondary-button" onClick={() => archiveBatch(record.id)}>
                  Archive component
                </button>
              )}
            </div>
          </div>
          <div className="v2-editor-block">
            <strong>Exports</strong>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={() => openBatchCostSheetPreview(record.id)}>
                Open cost sheet
              </button>
              <button type="button" className="v2-secondary-button" onClick={() => openBatchChefSheetPreview(record.id)}>
                Open chef sheet
              </button>
            </div>
          </div>
        </DetailSection>
      ) : null}

      <div className="v2-step-footer">
        <button type="button" className="v2-secondary-button" onClick={() => previousStep && setBatchEditorStep(previousStep.id)} disabled={!previousStep}>
          Previous step
        </button>
        {batchEditorStep === "usage" ? null : (
          <button type="button" className="v2-primary-button" onClick={handleFooterPrimaryAction} disabled={footerPrimaryDisabled}>
            {footerPrimaryLabel}
          </button>
        )}
      </div>
      </div>

      {pickerOpen ? (
        <aside className="v2-picker-panel v2-picker-panel-inline">
          <div className="v2-panel-header">
            <div>
              <div className="v2-eyebrow">Ingredient Picker</div>
              <h3>Add ingredient</h3>
            </div>
            <div className="v2-link-list">
              <button type="button" className="v2-secondary-button" onClick={createIngredientFromPicker}>
                Create ingredient
              </button>
              <button type="button" className="v2-secondary-button" onClick={closePicker}>
                Close
              </button>
            </div>
          </div>
          <label className="v2-field">
            <span>Search ingredients</span>
            <input
              value={ingredientPickerQuery}
              onChange={(event) => setIngredientPickerQuery(event.target.value)}
              placeholder="Start with a broad product like beef, milk, or bread"
            />
          </label>
          {!ingredientPickerQuery.trim() ? null : ingredientPickerResults.length ? (
            <div className="v2-select-list v2-picker-list">
              {ingredientPickerResults.map(({ ingredient, score }) => {
                const isActive = (record.ingredientIds || []).includes(ingredient.id);
                const referencePrice = getIngredientReferencePrice(ingredient);
                const componentIdentifier = getIngredientComponentIdentifier(ingredient, maps.batch);
                return (
                  <button
                    key={ingredient.id}
                    type="button"
                    className={`v2-select-row ${isActive ? "active" : ""}`}
                    onClick={() => chooseIngredientFromPicker(ingredient)}
                  >
                    <strong>{ingredient.name}</strong>
                    <span>{ingredient.code} · {ingredient.packSize} · {ingredient.category}</span>
                    {componentIdentifier ? <span>From: {componentIdentifier}</span> : null}
                    {referencePrice ? (
                      <div className="v2-tag-row">
                        <span className="v2-tag">{formatIngredientReferencePrice(referencePrice, true)}</span>
                        {componentIdentifier ? <span className="v2-tag">Component-derived</span> : null}
                      </div>
                    ) : componentIdentifier ? (
                      <div className="v2-tag-row">
                        <span className="v2-tag">Component-derived</span>
                      </div>
                    ) : null}
                    <span>{isActive ? "Already added to this component" : `Estimated cost ${formatCurrency(ingredient.portionCostHint)}`}</span>
                    <span>Search confidence {Math.round(score)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="v2-micro-note">No ingredients match that search.</div>
          )}
        </aside>
      ) : null}
    </div>
  );
}

function IngredientEditorFields({
  record,
  learningRules,
  productCategoryOptions = [],
  tradeCategoryOptions = [],
  onFieldChange,
  onAliasesChange,
  onGenerateCode,
  codeConflict,
  codeAlert,
  pricingOverride = null,
  pricingLocked = false,
  pricingNote = "",
  readOnly = false,
}) {
  const codeLocked = isIngredientCodeLocked(record);
  const sourceCodeLocked = Boolean(String(record.sourceCode || "").trim());
  const [indexDraft, setIndexDraft] = useState(() => parseIngredientIndex(record.name, record.packSize, learningRules));
  const categoryListId = `ingredient-category-options-${record.id || "draft"}`;
  const tradeCategoryListId = `ingredient-trade-category-options-${record.id || "draft"}`;

  useEffect(() => {
    setIndexDraft(parseIngredientIndex(record.name, record.packSize, learningRules));
  }, [record.id, record.name, record.packSize, learningRules]);

  const indexedSuggestion = composeCleanIngredientName(indexDraft, record.name);
  const indexedSuggestionMatchesName =
    normalizeIngredientKey(indexedSuggestion) === normalizeIngredientKey(record.name);
  const hasStructuredParts = ingredientIndexFields.some((field) => normalizeIngredientKey(indexDraft[field.key] || ""));
  const pricingRecord = pricingOverride
    ? {
        ...record,
        unitCost: pricingOverride.unitCost,
        costUnit: pricingOverride.costUnit,
      }
    : record;
  const pricingReadOnly = readOnly || pricingLocked;

  return (
    <>
      <div className="v2-editor-block">
        <strong>Core details</strong>
        <div className="v2-form-grid">
          <label className="v2-field">
            <span>Ingredient name</span>
            <input value={record.name} onChange={(event) => onFieldChange("name", event.target.value)} disabled={readOnly} />
          </label>
          <label className="v2-field">
            <span>{codeLocked ? "Ingredient code (Soft1)" : "Internal ingredient code"}</span>
            <div className={`v2-inline-field ${codeLocked ? "compact" : ""}`}>
              <input
                value={record.code}
                onChange={(event) => onFieldChange("code", event.target.value)}
                disabled={readOnly || codeLocked}
              />
              {!codeLocked ? (
                <button type="button" className="v2-secondary-button" onClick={onGenerateCode} disabled={readOnly}>
                  Generate
                </button>
              ) : null}
            </div>
            {codeLocked ? <div className="v2-micro-note">Using Soft1 code</div> : null}
            {codeConflict ? (
              <div className="v2-inline-callout warn">
                <strong>Duplicate code</strong>
                <span>{codeConflict.name} already uses this ingredient code.</span>
              </div>
            ) : null}
            {codeAlert ? (
              <div className="v2-inline-callout warn">
                <strong>Code not changed</strong>
                <span>{codeAlert}</span>
              </div>
            ) : null}
          </label>
          <label className="v2-field">
            <span>Soft1 source code</span>
            <input
              value={record.sourceCode}
              onChange={(event) => onFieldChange("sourceCode", event.target.value)}
              disabled={readOnly || sourceCodeLocked}
              placeholder={sourceCodeLocked ? "" : "Leave blank until a real Soft1 code exists"}
            />
            {sourceCodeLocked ? <div className="v2-micro-note">Locked to the imported Soft1 source code.</div> : null}
          </label>
          <label className="v2-field">
            <span>Pack size</span>
            <input value={record.packSize} onChange={(event) => onFieldChange("packSize", event.target.value)} disabled={readOnly} />
          </label>
          <label className="v2-field">
            <span>Supplier</span>
            <input value={record.supplier} onChange={(event) => onFieldChange("supplier", event.target.value)} disabled={readOnly} />
          </label>
          <label className="v2-field">
            <span>Product category</span>
            <input
              value={record.category}
              list={categoryListId}
              placeholder="Choose existing or type a new category"
              onChange={(event) => onFieldChange("category", event.target.value)}
              disabled={readOnly}
            />
            <datalist id={categoryListId}>
              {productCategoryOptions.map((category) => (
                <option key={`${categoryListId}-${category}`} value={category} />
              ))}
            </datalist>
          </label>
          <label className="v2-field">
            <span>Trade category</span>
            <input
              value={record.tradeCategory || ""}
              list={tradeCategoryListId}
              placeholder="Choose existing or type a new trade category"
              onChange={(event) => onFieldChange("tradeCategory", event.target.value)}
              disabled={readOnly}
            />
            <datalist id={tradeCategoryListId}>
              {tradeCategoryOptions.map((category) => (
                <option key={`${tradeCategoryListId}-${category}`} value={category} />
              ))}
            </datalist>
          </label>
        </div>
      </div>

      <div className="v2-editor-block">
        <strong>Pricing</strong>
        <div className="v2-form-grid">
          <label className="v2-field">
            <span>Cost per unit</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pricingRecord.unitCost ?? 0}
              onChange={(event) => onFieldChange("unitCost", event.target.value)}
              disabled={pricingReadOnly}
            />
          </label>
          <label className="v2-field">
            <span>Cost unit</span>
            <select value={pricingRecord.costUnit || "kg"} onChange={(event) => onFieldChange("costUnit", event.target.value)} disabled={pricingReadOnly}>
              {measurementUnitOptions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            {pricingNote ? <div className="v2-micro-note">{pricingNote}</div> : null}
          </label>
          <label className="v2-field">
            <span>Purchase VAT %</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={record.purchaseVatRate ?? 13}
              onChange={(event) => onFieldChange("purchaseVatRate", event.target.value)}
              disabled={readOnly}
            />
          </label>
        </div>
      </div>
      <details className="v2-collapsible-panel">
        <summary>
          <span>Name structure</span>
          <span>
            {indexedSuggestionMatchesName
              ? hasStructuredParts
                ? "Matches current name"
                : "Optional"
              : "Suggestion available"}
          </span>
        </summary>
        <div className="v2-editor-block">
          <div className="v2-index-grid">
            {ingredientIndexFields.map((field) => (
              <label key={field.key} className="v2-field">
                <span>{field.label}</span>
                <input
                  value={indexDraft[field.key] || ""}
                  onChange={(event) =>
                    setIndexDraft((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  disabled={readOnly}
                />
              </label>
            ))}
          </div>
          <div className="v2-inline-callout">
            <strong>Indexed suggestion</strong>
            <span>{indexedSuggestion}</span>
          </div>
          <div className="v2-link-list">
            <button
              type="button"
              className="v2-secondary-button"
              onClick={() => onFieldChange("name", indexedSuggestion)}
              disabled={readOnly || indexedSuggestionMatchesName}
            >
              Use indexed suggestion
            </button>
          </div>
        </div>
      </details>
      <details className="v2-collapsible-panel">
        <summary>Other names and notes</summary>
        <label className="v2-field">
          <span>Aliases</span>
          <textarea
            value={(record.aliases || []).join("\n")}
            onChange={(event) => onAliasesChange(event.target.value)}
            placeholder="One alias per line"
            disabled={readOnly}
          />
        </label>
        <label className="v2-field">
          <span>Notes</span>
          <textarea value={record.notes || ""} onChange={(event) => onFieldChange("notes", event.target.value)} disabled={readOnly} />
        </label>
      </details>
    </>
  );
}

function IngredientMakerModal({
  draft,
  productCategoryOptions = [],
  tradeCategoryOptions = [],
  onFieldChange,
  onAliasesChange,
  onGenerateCode,
  codeConflict,
  onClose,
  onSave,
}) {
  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close ingredient maker" />
      <div className="v2-modal-panel">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Ingredient Maker</div>
            <h3>Create ingredient</h3>
          </div>
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <IngredientEditorFields
          record={draft}
          productCategoryOptions={productCategoryOptions}
          tradeCategoryOptions={tradeCategoryOptions}
          onFieldChange={onFieldChange}
          onAliasesChange={onAliasesChange}
          onGenerateCode={onGenerateCode}
          codeConflict={codeConflict}
        />
        <div className="v2-step-footer">
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="v2-primary-button" onClick={onSave} disabled={Boolean(codeConflict)}>
            Save ingredient
          </button>
        </div>
      </div>
    </div>
  );
}

function IngredientSubstitutionModal({
  sourceIngredient,
  replacementIngredient,
  trustedIngredients,
  impact,
  archiveOriginal,
  onFieldChange,
  onClose,
  onApply,
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const replacementResults = useMemo(() => {
    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) return trustedIngredients.slice(0, 10);

    return trustedIngredients
      .map((ingredient) => ({
        ingredient,
        score: scoreIngredientSearchMatch(ingredient, trimmedQuery),
      }))
      .filter((match) => match.score >= 50)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.ingredient.name.localeCompare(right.ingredient.name);
      })
      .slice(0, 12)
      .map((match) => match.ingredient);
  }, [deferredQuery, trustedIngredients]);

  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close ingredient substitution" />
      <div className="v2-modal-panel">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Ingredient substitution</div>
            <h3>Replace ingredient across records</h3>
            <p>{sourceIngredient.name}</p>
          </div>
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="v2-inline-callout">
          <strong>Use for true replacements</strong>
          <span>Best when recipes and components should now point at a different ingredient record, rather than simply updating supplier or price on the same ingredient.</span>
        </div>

        <label className="v2-field">
          <span>Find replacement ingredient</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by ingredient name, code, supplier, or category"
          />
        </label>

        <div className="v2-select-list v2-picker-list">
          {replacementResults.map((ingredient) => (
            <button
              key={ingredient.id}
              type="button"
              className={`v2-select-row ${replacementIngredient?.id === ingredient.id ? "active" : ""}`}
              onClick={() => onFieldChange("replacementIngredientId", ingredient.id)}
            >
              <strong>{ingredient.name}</strong>
              <span>{ingredient.code} · {ingredient.packSize || "No pack size"} · {ingredient.category || "No category"}</span>
            </button>
          ))}
        </div>

        {replacementIngredient ? (
          <>
            <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
              <SummaryCard label="Recipes updating" value={String(impact.recipes.updated)} tone="default" />
              <SummaryCard label="Components updating" value={String(impact.batches.updated)} tone="default" />
              <SummaryCard label="Merged duplicates" value={String(impact.totalMerged)} tone="default" />
              <SummaryCard label="Manual review" value={String(impact.totalConflicts)} tone={impact.totalConflicts ? "warn" : "good"} />
            </div>

            <div className="v2-editor-block">
              <strong>Impact preview</strong>
              <div className="v2-micro-note">
                Direct ingredient links will be updated across recipes and components. Records that already contain the replacement ingredient with incompatible units will be left unchanged for manual review.
              </div>
              <label className="v2-checkbox-row">
                <input
                  type="checkbox"
                  checked={archiveOriginal}
                  onChange={(event) => onFieldChange("archiveOriginal", event.target.checked)}
                />
                <span>Archive original ingredient after substitution</span>
              </label>
              <UsagePreviewList
                items={[...impact.recipes.updatedRecords, ...impact.batches.updatedRecords]}
                limit={6}
                emptyMessage="No recipes or components will update."
                renderItem={(record) => (
                  <div key={record.id} className="v2-record-row v2-usage-row">
                    <div>
                      <strong>{record.name}</strong>
                      <span>{record.code}</span>
                    </div>
                    <StatusBadge
                      status={record.status}
                      label={record.yieldUnit ? getBatchStageLabel(record.status) : getRecipeStageLabel(record.status)}
                    />
                  </div>
                )}
              />
              {impact.totalConflicts ? (
                <div className="v2-inline-callout warn">
                  <strong>{impact.totalConflicts} record{impact.totalConflicts === 1 ? "" : "s"} need manual review</strong>
                  <span>The replacement ingredient is already present there with different units, so those links will be left untouched.</span>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="v2-step-footer">
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="v2-primary-button" onClick={onApply} disabled={!replacementIngredient}>
            Apply substitution
          </button>
        </div>
      </div>
    </div>
  );
}

function IngredientMergeModal({
  sourceIngredient,
  targetIngredient,
  trustedIngredients,
  impact,
  onFieldChange,
  onClose,
  onApply,
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const mergeResults = useMemo(() => {
    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) return trustedIngredients.slice(0, 12);

    return trustedIngredients
      .map((ingredient) => ({
        ingredient,
        score: scoreIngredientSearchMatch(ingredient, trimmedQuery),
      }))
      .filter((match) => match.score >= 50)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.ingredient.name.localeCompare(right.ingredient.name);
      })
      .slice(0, 14)
      .map((match) => match.ingredient);
  }, [deferredQuery, trustedIngredients]);

  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close ingredient merge" />
      <div className="v2-modal-panel">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Ingredient merge</div>
            <h3>Merge duplicate into keeper</h3>
            <p>{sourceIngredient.name}</p>
          </div>
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="v2-inline-callout warn">
          <strong>Careful merge</strong>
          <span>The keeper stays active and the duplicate is archived afterwards. This is for normal ingredient duplicates, not published component ingredients.</span>
        </div>

        <label className="v2-field">
          <span>Choose keeper ingredient</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by ingredient name, code, supplier, or category"
          />
        </label>

        <div className="v2-select-list v2-picker-list">
          {mergeResults.map((ingredient) => {
            const isActive = targetIngredient?.id === ingredient.id;
            const referencePrice = getIngredientReferencePrice(ingredient);
            return (
              <button
                key={ingredient.id}
                type="button"
                className={`v2-select-row ${isActive ? "active" : ""}`}
                onClick={() => onFieldChange("targetIngredientId", ingredient.id)}
              >
                <strong>{ingredient.name}</strong>
                <span>{ingredient.code} · source {ingredient.sourceCode || "manual"} · {ingredient.category || "No category"}</span>
                <div className="v2-tag-row">
                  {ingredient.packSize ? <span className="v2-tag">{ingredient.packSize}</span> : null}
                  {ingredient.tradeCategory ? <span className="v2-tag">Trade: {ingredient.tradeCategory}</span> : null}
                  {referencePrice ? <span className="v2-tag">{formatIngredientReferencePrice(referencePrice, true)}</span> : null}
                </div>
              </button>
            );
          })}
        </div>

        {targetIngredient ? (
          <>
            <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
              <SummaryCard label="Recipes moving" value={String(impact.recipes.updated)} tone="default" />
              <SummaryCard label="Components moving" value={String(impact.batches.updated)} tone="default" />
              <SummaryCard label="Merged lines" value={String(impact.totalMerged)} tone="default" />
              <SummaryCard label="Manual review" value={String(impact.totalConflicts)} tone={impact.totalConflicts ? "warn" : "good"} />
            </div>
            <div className="v2-editor-block">
              <strong>What happens</strong>
              <div className="v2-micro-note">
                The keeper retains the live identity. Links from recipes and components move across, the duplicate name and aliases are carried onto the keeper, and the duplicate ingredient is archived rather than hard-deleted.
              </div>
              {impact.totalConflicts ? (
                <div className="v2-inline-callout warn">
                  <strong>Manual review needed first</strong>
                  <span>Some linked recipes or components already contain both ingredients with incompatible units, so this merge is blocked until those records are cleaned manually.</span>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="v2-micro-note">Choose the keeper ingredient first. This keeps the merge deliberate and reversible.</div>
        )}

        <div className="v2-step-footer">
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="v2-primary-button" onClick={onApply} disabled={!targetIngredient || impact.totalConflicts > 0}>
            Merge and archive duplicate
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuMakerModal({ restaurant, draft, serviceOptions, onFieldChange, onClose, onSave }) {
  const serviceListId = `menu-maker-service-options-${restaurant?.id || "default"}`;
  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close menu maker" />
      <div className="v2-modal-panel v2-modal-panel-compact">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Menu maker</div>
            <h3>Create menu</h3>
            <p>{restaurant ? restaurant.name : "Restaurant"}</p>
          </div>
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="v2-form-grid">
          <label className="v2-field">
            <span>Menu name</span>
            <input value={draft.name} onChange={(event) => onFieldChange("name", event.target.value)} />
          </label>
          <label className="v2-field">
            <span>Service</span>
            <input
              value={draft.service}
              list={serviceListId}
              onChange={(event) => onFieldChange("service", event.target.value)}
              placeholder="Breakfast, Lunch, Dinner..."
            />
            <datalist id={serviceListId}>
              {serviceOptions.map((service) => (
                <option key={service} value={service} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="v2-step-footer">
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="v2-primary-button" onClick={onSave}>
            Create menu
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuPreviewModal({ menu, recipeMap, onClose }) {
  const previewGroups = buildMenuPreviewGroups(menu, recipeMap);
  const draftDishCount = previewGroups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.recipe?.status === "draft").length,
    0
  );

  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close menu preview" />
      <div className="v2-modal-panel v2-modal-panel-paper">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Menu proof</div>
            <h3>{menu.name}</h3>
            <p>{menu.restaurant} · {menu.service}</p>
          </div>
          <button type="button" className="v2-secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="v2-menu-paper">
          <div className="v2-menu-paper-header">
            <div className="v2-eyebrow">{menu.restaurant}</div>
            <h2>{menu.name}</h2>
            <p>{menu.service}</p>
          </div>
          {draftDishCount ? (
            <div className="v2-inline-callout warn">
              <strong>{draftDishCount} draft dish{draftDishCount === 1 ? "" : "es"} on this menu</strong>
              <span>Draft dishes stay on the menu for review, but they should be checked before this menu is treated as fully trusted.</span>
            </div>
          ) : null}
          <div className="v2-menu-paper-columns">
            <span>Name</span>
            <span>Description</span>
            <span>Price</span>
          </div>
          <div className="v2-menu-paper-body">
            {previewGroups.map((group) => (
              <div key={group.course} className="v2-menu-paper-course">
                <div className="v2-menu-paper-course-title">{group.course}</div>
                {group.items.length ? (
                  group.items.map((item) => (
                    <div key={item.id} className="v2-menu-paper-row">
                      <div className="v2-menu-paper-name">
                        <strong>{item.dishName || item.recipe?.name || "Untitled dish"}</strong>
                        {item.recipe?.status === "draft" ? <span className="v2-tag">Draft</span> : null}
                      </div>
                      <span>{item.description || item.recipe?.menuDescription || ""}</span>
                      <span>{item.price ? formatCurrency(item.price) : ""}</span>
                    </div>
                  ))
                ) : (
                  <div className="v2-menu-paper-empty">No {group.course.toLowerCase()} on this menu yet.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportPreviewModal({ title, html, csvContent, onClose, onDownloadCsv, onPrint }) {
  return (
    <div className="v2-modal-shell">
      <button type="button" className="v2-picker-backdrop" onClick={onClose} aria-label="Close export preview" />
      <div className="v2-modal-panel v2-modal-panel-wide">
        <div className="v2-panel-header">
          <div>
            <div className="v2-eyebrow">Export preview</div>
            <h3>{title}</h3>
          </div>
          <div className="v2-link-list">
            {csvContent ? (
              <button type="button" className="v2-secondary-button" onClick={onDownloadCsv}>
                Download CSV
              </button>
            ) : null}
            <button type="button" className="v2-secondary-button" onClick={onPrint}>
              Print / Save PDF
            </button>
            <button type="button" className="v2-secondary-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <iframe className="v2-export-frame" title={title} srcDoc={html} />
      </div>
    </div>
  );
}

function UsagePreviewList({ items, limit = 5, emptyMessage, renderItem }) {
  const visibleItems = items.slice(0, limit);
  const remainingCount = Math.max(0, items.length - visibleItems.length);

  if (!items.length) {
    return <div className="v2-micro-note">{emptyMessage}</div>;
  }

  return (
    <div className="v2-stack">
      {visibleItems.map((item, index) => renderItem(item, index))}
      {remainingCount ? <div className="v2-micro-note">And {remainingCount} more.</div> : null}
    </div>
  );
}

function MenuEditorCard({
  menu,
  maps,
  openRecord,
  openRecipePreview,
  updateMenuField,
  addMenuItem,
  updateMenuItemField,
  selectMenuItemRecipe,
  createDraftRecipeForMenuItem,
  removeMenuItem,
  compact = false,
}) {
  const [pickerItemId, setPickerItemId] = useState("");
  const [recipePickerQuery, setRecipePickerQuery] = useState("");
  const deferredRecipePickerQuery = useDeferredValue(recipePickerQuery);
  const pickerOpen = Boolean(pickerItemId);
  const draftDishCount = (menu.items || []).filter((item) => {
    const recipe = item.recipeId ? maps.recipe.get(item.recipeId) : null;
    return recipe?.status === "draft";
  }).length;
  const recipePickerResults = useMemo(() => {
    const query = deferredRecipePickerQuery.trim().toLowerCase();
    if (!query) return [];

    return Array.from(maps.recipe.values())
      .filter((recipeRow) => !recipeRow.archived)
      .map((recipeRow) => {
        const searchText = [
          recipeRow.name,
          recipeRow.code,
          recipeRow.category,
          recipeRow.menuDescription,
          recipeRow.status,
        ]
          .join(" ")
          .toLowerCase();

        let score = 0;
        if (searchText.includes(query)) score += 60;
        if (String(recipeRow.name || "").toLowerCase().startsWith(query)) score += 25;
        if (String(recipeRow.code || "").toLowerCase().includes(query)) score += 20;
        return {
          recipe: recipeRow,
          score,
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.recipe.name.localeCompare(right.recipe.name);
      })
      .slice(0, 16);
  }, [deferredRecipePickerQuery, maps.recipe]);

  const openRecipePicker = (itemId) => {
    setPickerItemId(itemId);
    setRecipePickerQuery("");
  };

  const closeRecipePicker = () => {
    setPickerItemId("");
    setRecipePickerQuery("");
  };

  const chooseRecipeForMenuItem = (itemId, recipeId) => {
    selectMenuItemRecipe(menu.id, itemId, recipeId);
    closeRecipePicker();
  };

  return (
    <div className={`v2-recipe-shell ${pickerOpen ? "picker-open" : ""}`}>
      {pickerOpen ? <button type="button" className="v2-picker-backdrop" onClick={closeRecipePicker} aria-label="Close recipe picker" /> : null}
      <div className="v2-recipe-main">
        <div className={`v2-line-card ${compact ? "v2-menu-basics-card" : ""}`}>
          {draftDishCount ? (
            <div className="v2-inline-callout warn">
              <strong>{draftDishCount} draft dish{draftDishCount === 1 ? "" : "es"} on this menu</strong>
              <span>Keep them on the menu for planning, but review those dishes before treating this menu as fully ready.</span>
            </div>
          ) : null}
          <div className={`v2-form-grid ${compact ? "v2-form-grid-menu-basics" : ""}`}>
            <label className="v2-field">
              <span>Menu name</span>
              <input value={menu.name} onChange={(event) => updateMenuField(menu.id, "name", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Service</span>
              <input value={menu.service} onChange={(event) => updateMenuField(menu.id, "service", event.target.value)} />
            </label>
            <label className="v2-field">
              <span>Stage</span>
              <select value={menu.status} onChange={(event) => updateMenuField(menu.id, "status", event.target.value)}>
                <option value="draft">Draft</option>
                <option value="review">Approved</option>
                <option value="live">Live</option>
              </select>
            </label>
          </div>
          {(menu.items || []).length ? (
            <div className="v2-stack">
              {(menu.items || []).map((item) => {
                const recipe = item.recipeId ? maps.recipe.get(item.recipeId) : null;
                return (
                  <div key={item.id} className="v2-line-card">
                    <div className="v2-tag-row">
                      {recipe?.status === "draft" ? <span className="v2-tag">Draft dish</span> : null}
                      {recipe?.status === "review" ? <span className="v2-tag">Ready dish</span> : null}
                      {recipe?.status === "live" ? <span className="v2-tag">Live dish</span> : null}
                    </div>
                    <div className="v2-form-grid">
                      <label className="v2-field">
                        <span>Recipe</span>
                        <button type="button" className="v2-secondary-button v2-menu-recipe-button" onClick={() => openRecipePicker(item.id)}>
                          {recipe ? `${recipe.name} (${recipe.code})` : "Choose recipe"}
                        </button>
                      </label>
                      <label className="v2-field">
                        <span>Dish name on menu</span>
                        <input value={item.dishName || ""} onChange={(event) => updateMenuItemField(menu.id, item.id, "dishName", event.target.value)} />
                      </label>
                      <label className="v2-field">
                        <span>Description</span>
                        <textarea value={item.description || ""} onChange={(event) => updateMenuItemField(menu.id, item.id, "description", event.target.value)} />
                      </label>
                    </div>
                    <div className="v2-link-list">
                      {recipe ? (
                        <button type="button" className="v2-secondary-button" onClick={() => (openRecipePreview ? openRecipePreview("recipe", recipe.id) : openRecord("recipe", recipe.id))}>
                          Open recipe
                        </button>
                      ) : null}
                      <button type="button" className="v2-secondary-button" onClick={() => removeMenuItem(menu.id, item.id)}>
                        Remove dish
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="v2-micro-note">No dishes on this menu yet.</div>
          )}
          <div className="v2-link-list">
            <button type="button" className="v2-primary-button" onClick={() => addMenuItem(menu.id)}>
              Add dish
            </button>
            {!compact ? (
              <button type="button" className="v2-secondary-button" onClick={() => openRecord("menu", menu.id)}>
                Open menu record
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {pickerOpen ? (
        <aside className="v2-picker-panel">
          <div className="v2-panel-header">
            <div>
              <div className="v2-eyebrow">Recipe Picker</div>
              <h3>Choose recipe</h3>
            </div>
            <div className="v2-link-list">
              <button
                type="button"
                className="v2-secondary-button"
                onClick={() => {
                  if (!pickerItemId) return;
                  createDraftRecipeForMenuItem(menu.id, pickerItemId);
                  closeRecipePicker();
                }}
              >
                Create draft recipe
              </button>
              <button type="button" className="v2-secondary-button" onClick={closeRecipePicker}>
                Close
              </button>
            </div>
          </div>
          <label className="v2-field">
            <span>Search recipes</span>
            <input
              value={recipePickerQuery}
              onChange={(event) => setRecipePickerQuery(event.target.value)}
              placeholder="Start with dish name, code, or category"
            />
          </label>
          {!recipePickerQuery.trim() ? (
            <div className="v2-micro-note">Start typing to find the right recipe for this menu line.</div>
          ) : recipePickerResults.length ? (
            <div className="v2-select-list v2-picker-list">
              {recipePickerResults.map(({ recipe, score }) => {
                const isActive = (menu.items || []).some((item) => item.recipeId === recipe.id);
                return (
                  <button
                    key={recipe.id}
                    type="button"
                    className={`v2-select-row ${isActive ? "active" : ""}`}
                    onClick={() => chooseRecipeForMenuItem(pickerItemId, recipe.id)}
                  >
                    <strong>{recipe.name}</strong>
                    <span>{recipe.code} · {recipe.category}</span>
                    <span>{recipe.menuDescription || "No menu description yet"}</span>
                    <span>{isActive ? "Already used on this menu" : `Search confidence ${Math.round(score)}`}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="v2-micro-note">No recipes match that search.</div>
          )}
        </aside>
      ) : null}
    </div>
  );
}

const IngredientRecordDetail = memo(function IngredientRecordDetail({
  record,
  openRecord,
  maps,
  ingredientCategoryOptions,
  ingredientTradeCategoryOptions,
  ingredientRuleCatchupMap,
  learningRules,
  updateIngredientField,
  updateIngredientAliases,
  generateIngredientCode,
  ingredientCodeAlert,
  ingredientSharedSyncState,
  moveIngredientToMasterReview,
  moveIngredientToBatchDraft,
  toggleIngredientReviewFlag,
  markIngredientManualReviewDone,
  syncIngredientToSharedData,
  openIngredientSubstitution,
  openIngredientMerge,
  archiveIngredient,
  restoreIngredient,
  deleteIngredientPermanently,
}) {
  const recipeLinks = (maps.relationshipMaps?.ingredientRecipes?.get(record.id) || [])
    .map((id) => maps.recordMaps.recipe.get(id))
    .filter(Boolean);
  const batchLink = record.batchId ? maps.recordMaps.batch.get(record.batchId) : null;
  const ingredientCostSource = getIngredientCostSource(record, maps.recordMaps.ingredient, maps.recordMaps.batch);
  const componentIdentifier = getIngredientComponentIdentifier(record, maps.recordMaps.batch);
  const masterReviewStatus = getIngredientMasterReviewStatus(record);
  const effectiveIngredientRecord =
    ingredientCostSource && ingredientCostSource !== record
      ? {
          ...record,
          unitCost: Number(ingredientCostSource.unitCost || 0),
          costUnit: String(ingredientCostSource.costUnit || record.costUnit || "").trim() || record.costUnit || "",
          portionCostHint: Number(ingredientCostSource.portionCostHint || record.portionCostHint || 0),
        }
      : record;
  const referencePrice = getIngredientReferencePrice(effectiveIngredientRecord);
  const priceReviewIssue = getIngredientPriceReviewIssue(effectiveIngredientRecord);
  const needsRuleCatchup = ingredientRuleCatchupMap?.has?.(record.id);
  const ingredientRestaurants = Array.from(
    new Set(
      recipeLinks
        .flatMap((recipe) => (recipe.menuIds || []).map((menuId) => maps.recordMaps.menu.get(menuId)?.restaurant))
        .filter(Boolean)
    )
  ).sort();
  const effectiveSourceCode = getEffectiveIngredientSourceCode(record);

  return (
    <>
      <DetailHeader title={record.name} subtitle={`${record.code} · source ${effectiveSourceCode}`} status={record.status} />
      <div className="v2-detail-grid">
        <DetailStat label="Pack size" value={record.packSize} />
        <DetailStat label="Supplier" value={record.supplier} />
        <DetailStat label="Product category" value={record.category} />
        <DetailStat label="Trade category" value={record.tradeCategory || "Not set"} />
        <DetailStat label="Used in" value={`${recipeLinks.length} recipes`} />
      </div>
      <div className="v2-detail-grid">
        {componentIdentifier ? <DetailStat label="Derived from component" value={componentIdentifier} /> : null}
        <DetailStat label="Source record" value={record.sourceRecordLabel || "Manual ingredient creation"} />
        <DetailStat label="Last pricing import" value={record.lastImportedAt || "Not imported yet"} />
        <DetailStat
          label={referencePrice?.unit === "l" ? "Price / litre" : "Price / kg"}
          value={referencePrice ? formatIngredientReferencePrice(referencePrice) : "Not available"}
        />
        <DetailStat label="Master review" value={masterReviewStatus === "review" ? "Needs review" : "Reviewed"} />
      </div>
      {batchLink ? (
        <div className="v2-tag-row">
          <span className="v2-tag">Linked component draft: {batchLink.name}</span>
          {componentIdentifier ? <span className="v2-tag">From: {componentIdentifier}</span> : null}
          {record.needsReviewFlag ? <span className="v2-tag">Manual review</span> : null}
          {needsRuleCatchup ? <span className="v2-tag">Rule catch-up</span> : null}
          {priceReviewIssue ? <span className="v2-tag">Price review</span> : null}
          {record.needsSubstitutionReview ? <span className="v2-tag">Needs substitution</span> : null}
        </div>
      ) : record.needsReviewFlag || needsRuleCatchup || priceReviewIssue || record.needsSubstitutionReview ? (
        <div className="v2-tag-row">
          {record.needsReviewFlag ? <span className="v2-tag">Manual review</span> : null}
          {needsRuleCatchup ? <span className="v2-tag">Rule catch-up</span> : null}
          {priceReviewIssue ? <span className="v2-tag">Price review</span> : null}
          {record.needsSubstitutionReview ? <span className="v2-tag">Needs substitution</span> : null}
        </div>
      ) : null}
      {priceReviewIssue ? (
        <div className="v2-inline-callout warn">
          <strong>Price review needed</strong>
          <span>{priceReviewIssue.message}</span>
        </div>
      ) : null}
      {record.sharedRecordId ? (
        <DetailSection title="Actions">
          <div className={`v2-inline-callout ${masterReviewStatus === "review" ? "warn" : ""}`}>
            <strong>
              {masterReviewStatus === "review" ? "This live ingredient is in manual review" : "This live ingredient has been manually reviewed"}
            </strong>
            <span>
              {record.sharedDirty
                ? "Ingredient edits are syncing to shared data in the background."
                : "Ingredient field edits save automatically. Use this step to finish manual review when you're happy with it."}
            </span>
          </div>
          <div className="v2-link-list">
            <button
              type="button"
              className="v2-primary-button"
              onClick={() => markIngredientManualReviewDone(record.id)}
              disabled={ingredientSharedSyncState === "syncing"}
            >
              {ingredientSharedSyncState === "syncing" ? "Saving..." : "Mark manual review done"}
            </button>
            <button
              type="button"
              className="v2-secondary-button"
              onClick={() => syncIngredientToSharedData(record.id)}
              disabled={ingredientSharedSyncState === "syncing"}
            >
              Save now
            </button>
            {masterReviewStatus !== "review" ? (
              <button type="button" className="v2-secondary-button" onClick={() => moveIngredientToMasterReview(record.id)}>
                Move to manual review
              </button>
            ) : null}
            {!record.archived ? (
              <button type="button" className="v2-secondary-button" onClick={() => toggleIngredientReviewFlag(record.id)}>
                {record.needsReviewFlag ? "Remove manual review tag" : "Tag for manual review"}
              </button>
            ) : null}
            {!record.archived ? (
              <button type="button" className="v2-secondary-button" onClick={() => moveIngredientToBatchDraft(record.id)}>
                {batchLink ? "Open component draft" : "Create component draft"}
              </button>
            ) : null}
            {!record.archived ? (
              <button type="button" className="v2-secondary-button" onClick={() => openIngredientSubstitution(record.id)}>
                Open substitution tool
              </button>
            ) : null}
            {!record.archived ? (
              <button type="button" className="v2-secondary-button" onClick={() => openIngredientMerge(record.id)}>
                Merge into another ingredient
              </button>
            ) : null}
            {record.archived ? (
              <>
                <button type="button" className="v2-secondary-button" onClick={() => restoreIngredient(record.id)}>
                  Restore ingredient
                </button>
                <button type="button" className="v2-secondary-button" onClick={() => deleteIngredientPermanently(record.id)}>
                  Delete permanently
                </button>
              </>
            ) : (
              <button type="button" className="v2-secondary-button" onClick={() => archiveIngredient(record.id)}>
                Archive ingredient
              </button>
            )}
          </div>
          {ingredientSharedSyncState && ingredientSharedSyncState !== "syncing" ? (
            <div className="v2-micro-note">Shared sync: {ingredientSharedSyncState}</div>
          ) : null}
        </DetailSection>
      ) : null}
      <DetailSection title="Ingredient details">
        <div className="v2-detail-toolbar">
          <div>
            <strong>Editing</strong>
            <span>Changes save immediately.</span>
          </div>
        </div>
        <IngredientEditorFields
          record={record}
          learningRules={learningRules}
          productCategoryOptions={ingredientCategoryOptions}
          tradeCategoryOptions={ingredientTradeCategoryOptions}
          onFieldChange={(field, value) => updateIngredientField(record.id, field, value)}
          onAliasesChange={(value) => updateIngredientAliases(record.id, value)}
          onGenerateCode={() => generateIngredientCode(record.id)}
          codeAlert={ingredientCodeAlert}
          pricingOverride={batchLink ? ingredientCostSource : null}
          pricingLocked={Boolean(batchLink)}
          pricingNote={
            batchLink
              ? "Pricing is derived from the linked component and updates from that component recipe."
              : ""
          }
          readOnly={false}
        />
      </DetailSection>
      <DetailSection title="Usage">
        <div className="v2-summary-grid v2-summary-grid-pricing-secondary">
          <SummaryCard label="Recipes" value={String(recipeLinks.length)} tone="default" />
          <SummaryCard label="From component" value={batchLink ? "Yes" : "No"} tone="default" />
          <SummaryCard label="Restaurants" value={String(ingredientRestaurants.length)} tone="default" />
        </div>
        {batchLink ? (
          <div className="v2-editor-block">
            <strong>Published from component</strong>
            <div className="v2-link-list">
              <button type="button" className="v2-link-chip" onClick={() => openRecord("batch", batchLink.id)}>
                {batchLink.name}
              </button>
            </div>
          </div>
        ) : null}
        <div className="v2-editor-block">
          <strong>Recipes using this ingredient</strong>
          <UsagePreviewList
            items={recipeLinks}
            emptyMessage="This ingredient is not linked to any recipes yet."
            renderItem={(recipe) => (
              <button key={recipe.id} type="button" className="v2-record-row v2-usage-row" onClick={() => openRecord("recipe", recipe.id)}>
                <div>
                  <strong>{recipe.name}</strong>
                  <span>{recipe.code} · {recipe.category}</span>
                </div>
                <StatusBadge status={recipe.status} label={getRecipeStageLabel(recipe.status)} />
              </button>
            )}
          />
        </div>
      </DetailSection>
    </>
  );
});

function RecordDetail({
  record,
  recordType,
  openRecord,
  maps,
  relationshipMaps,
  recipeEditorStep,
  setRecipeEditorStep,
  batchEditorStep,
  setBatchEditorStep,
  menuEditorStep,
  setMenuEditorStep,
  ingredientMaster,
  ingredientCategoryOptions,
  ingredientTradeCategoryOptions,
  ingredientRuleCatchupMap,
  batches,
  updateRecipeField,
  markRecipeReady,
  publishRecipeLive,
  moveRecipeToDraft,
  unpublishRecipe,
  toggleRecipeServiceSuitability,
  updateRecipeFinishedDishImage,
  updateRecipeMethodStep,
  addRecipeMethodStep,
  saveRecipeToSharedData,
  recipeSharedSyncState,
  toggleRecipeReviewFlag,
  updateRecipeIngredientLine,
  updateRecipeBatchLine,
  toggleRecipeIngredientLink,
  toggleRecipeBatchLink,
  openIngredientMaker,
  openIngredientSubstitution,
  openIngredientMerge,
  openRecipeCostSheetPreview,
  openRecipeChefSheetPreview,
  openBatchCostSheetPreview,
  openBatchChefSheetPreview,
  learningRules,
  updateIngredientField,
  updateIngredientAliases,
  generateIngredientCode,
  ingredientCodeAlert,
  ingredientSharedSyncState,
  ingredientEditingId,
  unlockIngredientEditing,
  lockIngredientEditing,
  markIngredientMasterReviewed,
  moveIngredientToMasterReview,
  moveIngredientToBatchDraft,
  toggleIngredientReviewFlag,
  toggleIngredientSubstitutionReview,
  markIngredientManualReviewDone,
  syncIngredientToSharedData,
  updateBatchField,
  updateBatchIngredientLine,
  toggleBatchIngredientLink,
  applyMissingSharedBatchIngredientSuggestion,
  updateBatchMethodStep,
  addBatchMethodStep,
  saveBatchToSharedData,
  batchSharedSyncState,
  toggleBatchReviewFlag,
  markBatchReady,
  moveBatchToDraft,
  returnBatchToReady,
  publishBatchToIngredient,
  deleteBatchAndPublishedIngredient,
  deletePublishedIngredientFromBatch,
  movePublishedIngredientRecipesToDraft,
  convertBatchToRecipeDraft,
  archiveIngredient,
  restoreIngredient,
  deleteIngredientPermanently,
  archiveRecipe,
  restoreRecipe,
  deleteRecipePermanently,
  archiveBatch,
  restoreBatch,
  deleteBatchPermanently,
  archiveMenu,
  restoreMenu,
  deleteMenuPermanently,
  saveMenuToSharedData,
  menuSharedSyncState,
  createMenuForRestaurant,
  openRecipePreview,
  openMenuPreview,
  approveMenu,
  publishMenuLive,
  returnMenuToDraft,
  updateMenuField,
  addMenuItem,
  updateMenuItemField,
  selectMenuItemRecipe,
  createDraftRecipeForMenuItem,
  removeMenuItem,
}) {
  if (recordType === "ingredient") {
    return (
      <IngredientRecordDetail
        record={record}
        openRecord={openRecord}
        maps={{ recordMaps: maps, relationshipMaps }}
        ingredientCategoryOptions={ingredientCategoryOptions}
        ingredientTradeCategoryOptions={ingredientTradeCategoryOptions}
        ingredientRuleCatchupMap={ingredientRuleCatchupMap}
        learningRules={learningRules}
        updateIngredientField={updateIngredientField}
        updateIngredientAliases={updateIngredientAliases}
        generateIngredientCode={generateIngredientCode}
        ingredientCodeAlert={ingredientCodeAlert}
        ingredientSharedSyncState={ingredientSharedSyncState}
        moveIngredientToMasterReview={moveIngredientToMasterReview}
        moveIngredientToBatchDraft={moveIngredientToBatchDraft}
        toggleIngredientReviewFlag={toggleIngredientReviewFlag}
        markIngredientManualReviewDone={markIngredientManualReviewDone}
        syncIngredientToSharedData={syncIngredientToSharedData}
        openIngredientSubstitution={openIngredientSubstitution}
        openIngredientMerge={openIngredientMerge}
        archiveIngredient={archiveIngredient}
        restoreIngredient={restoreIngredient}
        deleteIngredientPermanently={deleteIngredientPermanently}
      />
    );
  }

  if (recordType === "recipe") {
    return (
      <RecipeWorkflowDetail
        record={record}
        openRecord={openRecord}
        maps={maps}
        recipeEditorStep={recipeEditorStep}
        setRecipeEditorStep={setRecipeEditorStep}
        ingredientMaster={ingredientMaster}
        batches={batches}
        updateRecipeField={updateRecipeField}
        markRecipeReady={markRecipeReady}
        publishRecipeLive={publishRecipeLive}
        moveRecipeToDraft={moveRecipeToDraft}
        unpublishRecipe={unpublishRecipe}
        toggleRecipeServiceSuitability={toggleRecipeServiceSuitability}
        updateRecipeFinishedDishImage={updateRecipeFinishedDishImage}
        updateRecipeMethodStep={updateRecipeMethodStep}
        addRecipeMethodStep={addRecipeMethodStep}
        saveRecipeToSharedData={saveRecipeToSharedData}
        recipeSharedSyncState={recipeSharedSyncState}
        toggleRecipeReviewFlag={toggleRecipeReviewFlag}
        updateRecipeIngredientLine={updateRecipeIngredientLine}
        updateRecipeBatchLine={updateRecipeBatchLine}
        toggleRecipeIngredientLink={toggleRecipeIngredientLink}
        toggleRecipeBatchLink={toggleRecipeBatchLink}
        openIngredientMaker={openIngredientMaker}
        openRecipeCostSheetPreview={openRecipeCostSheetPreview}
        openRecipeChefSheetPreview={openRecipeChefSheetPreview}
        archiveRecipe={archiveRecipe}
        restoreRecipe={restoreRecipe}
        deleteRecipePermanently={deleteRecipePermanently}
      />
    );
  }

  if (recordType === "batch") {
    return (
      <BatchWorkflowDetail
        record={record}
        openRecord={openRecord}
        maps={maps}
        relationshipMaps={relationshipMaps}
        batchEditorStep={batchEditorStep}
        setBatchEditorStep={setBatchEditorStep}
        ingredientMaster={ingredientMaster}
        updateBatchField={updateBatchField}
        updateBatchIngredientLine={updateBatchIngredientLine}
        toggleBatchIngredientLink={toggleBatchIngredientLink}
        applyMissingSharedBatchIngredientSuggestion={applyMissingSharedBatchIngredientSuggestion}
        updateBatchMethodStep={updateBatchMethodStep}
        addBatchMethodStep={addBatchMethodStep}
        saveBatchToSharedData={saveBatchToSharedData}
        batchSharedSyncState={batchSharedSyncState?.[record.id] || ""}
        toggleBatchReviewFlag={toggleBatchReviewFlag}
        markBatchReady={markBatchReady}
        moveBatchToDraft={moveBatchToDraft}
        returnBatchToReady={returnBatchToReady}
        publishBatchToIngredient={publishBatchToIngredient}
        openIngredientSubstitution={openIngredientSubstitution}
        deleteBatchAndPublishedIngredient={deleteBatchAndPublishedIngredient}
        deletePublishedIngredientFromBatch={deletePublishedIngredientFromBatch}
        toggleIngredientSubstitutionReview={toggleIngredientSubstitutionReview}
        movePublishedIngredientRecipesToDraft={movePublishedIngredientRecipesToDraft}
        convertBatchToRecipeDraft={convertBatchToRecipeDraft}
        openIngredientMaker={openIngredientMaker}
        openBatchCostSheetPreview={openBatchCostSheetPreview}
        openBatchChefSheetPreview={openBatchChefSheetPreview}
        archiveBatch={archiveBatch}
        restoreBatch={restoreBatch}
        deleteBatchPermanently={deleteBatchPermanently}
      />
    );
  }

  if (recordType === "menu") {
    const menuSaveState = String(menuSharedSyncState || "").trim();
    const goToMenuStep = async (nextMenuStep) => {
      if (nextMenuStep === menuEditorStep) return;
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      setMenuEditorStep(nextMenuStep);
    };

    const approveMenuWithSave = async () => {
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      approveMenu(record.id);
    };

    const publishMenuLiveWithSave = async () => {
      if (record.sharedDirty && saveMenuToSharedData) {
        const saved = await saveMenuToSharedData(record.id, { quiet: true });
        if (!saved) return;
      }
      publishMenuLive(record.id);
    };

    return (
      <>
        <DetailHeader
          title={record.name}
          subtitle={`${record.restaurant} · ${record.service}`}
          status={record.status}
          statusLabel={getMenuStageLabel(record.status)}
        />
        <div className="v2-detail-grid v2-detail-grid-inline-four">
          <DetailStat label="Restaurant" value={record.restaurant} />
          <DetailStat label="Service" value={record.service} />
          <DetailStat label="Dishes" value={String((record.items || []).length)} />
          <DetailStat label="Stage" value={titleCaseWords(getMenuStageLabel(record.status))} />
        </div>
        <div className="v2-step-nav">
          <button
            type="button"
            className={`v2-step-button ${menuEditorStep === "build" ? "active" : ""}`}
            onClick={() => goToMenuStep("build")}
          >
            Build
          </button>
          <button
            type="button"
            className={`v2-step-button ${menuEditorStep === "preview" ? "active" : ""}`}
            onClick={() => goToMenuStep("preview")}
          >
            Preview
          </button>
        </div>
        <div className={`v2-inline-callout ${menuSaveState && menuSaveState !== "saved" ? "warn" : ""}`}>
          <strong>
            {menuSaveState === "syncing"
              ? "Saving menu..."
              : menuSaveState && menuSaveState !== "saved"
                ? "Menu save error"
                : record.sharedDirty
                  ? "Unsaved menu changes"
                  : "Menu saved"}
          </strong>
          <span>
            {menuSaveState === "syncing"
              ? "This menu is syncing to shared data now."
              : menuSaveState && menuSaveState !== "saved"
                ? menuSaveState
                : record.sharedDirty
                  ? "Use Save now if you want to force the shared save before moving on."
                  : "The latest menu edits are saved to shared data."}
          </span>
        </div>
        {menuEditorStep === "build" ? (
          <>
            <DetailSection title="Menu basics">
              <MenuEditorCard
                menu={record}
                maps={maps}
                openRecord={openRecord}
                openRecipePreview={openRecipePreview}
                updateMenuField={updateMenuField}
                addMenuItem={addMenuItem}
                updateMenuItemField={updateMenuItemField}
                selectMenuItemRecipe={selectMenuItemRecipe}
                createDraftRecipeForMenuItem={createDraftRecipeForMenuItem}
                removeMenuItem={removeMenuItem}
                compact
              />
            </DetailSection>
            <div className="v2-step-footer">
              <div className="v2-link-list">
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => saveMenuToSharedData(record.id)}
                  disabled={menuSaveState === "syncing" || !record.sharedDirty}
                >
                  {menuSaveState === "syncing" ? "Saving..." : "Save now"}
                </button>
                {!record.archived ? (
                  <button type="button" className="v2-secondary-button" onClick={() => archiveMenu(record.id)}>
                    Archive menu
                  </button>
                ) : (
                  <>
                    <button type="button" className="v2-secondary-button" onClick={() => restoreMenu(record.id)}>
                      Restore menu
                    </button>
                    <button type="button" className="v2-secondary-button" onClick={() => deleteMenuPermanently(record.id)}>
                      Delete permanently
                    </button>
                  </>
                )}
              </div>
              {!record.archived ? (
                <button type="button" className="v2-primary-button" onClick={approveMenuWithSave}>
                  Approve menu
                </button>
              ) : (
                <span className="v2-micro-note">Archived menus stay out of the live build flow.</span>
              )}
            </div>
          </>
        ) : (
          <>
            <DetailSection title="Menu preview">
              <div className="v2-inline-callout">
                <strong>Open menu proof</strong>
                <span>Review this menu in an A4-style preview with single-line columns for dish name, description, and price.</span>
              </div>
            </DetailSection>
            <div className="v2-step-footer">
              <div className="v2-link-list">
                <button
                  type="button"
                  className="v2-secondary-button"
                  onClick={() => saveMenuToSharedData(record.id)}
                  disabled={menuSaveState === "syncing" || !record.sharedDirty}
                >
                  {menuSaveState === "syncing" ? "Saving..." : "Save now"}
                </button>
                {!record.archived ? (
                  <>
                    <button type="button" className="v2-secondary-button" onClick={() => returnMenuToDraft(record.id)}>
                      Back to draft
                    </button>
                    <button type="button" className="v2-secondary-button" onClick={() => openMenuPreview(record.id)}>
                      Open preview
                    </button>
                    <button type="button" className="v2-secondary-button" onClick={() => archiveMenu(record.id)}>
                      Archive menu
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="v2-secondary-button" onClick={() => restoreMenu(record.id)}>
                      Restore menu
                    </button>
                    <button type="button" className="v2-secondary-button" onClick={() => deleteMenuPermanently(record.id)}>
                      Delete permanently
                    </button>
                  </>
                )}
              </div>
              {!record.archived && record.status !== "live" ? (
                <button type="button" className="v2-primary-button" onClick={publishMenuLiveWithSave}>
                  Make live
                </button>
              ) : (
                <span className="v2-micro-note">
                  {record.archived ? "Archived menus cannot be made live." : "This menu is already live."}
                </span>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  if (recordType === "restaurant") {
    const restaurantMenus = (relationshipMaps?.restaurantMenus?.get(record.id) || [])
      .map((menuId) => maps.menu.get(menuId))
      .filter(Boolean);
    const services = Array.from(
      new Set([
        ...(record.primaryServices || []),
        ...(record.secondaryServices || []),
        ...restaurantMenus.map((menu) => menu.service).filter(Boolean),
      ])
    );
    const serviceGroups = services.map((service) => ({
      service,
      menus: restaurantMenus.filter((menu) => menu.service === service),
    }));

    return (
      <>
        <DetailHeader title={record.name} subtitle={record.venueType} status="ready" statusLabel="profile" />
        <div className="v2-detail-grid">
          <DetailStat label="Primary services" value={String((record.primaryServices || []).length)} />
          <DetailStat label="Secondary services" value={String((record.secondaryServices || []).length)} />
          <DetailStat label="Menus" value={String(restaurantMenus.length)} />
        </div>
        <DetailSection title="How it is used">
          <p>{record.servicePattern}</p>
          <div className="v2-tag-row">
            {(record.primaryServices || []).map((service) => (
              <span key={`primary-${service}`} className="v2-tag">
                Primary: {service}
              </span>
            ))}
            {(record.secondaryServices || []).map((service) => (
              <span key={`secondary-${service}`} className="v2-tag">
                Also used for: {service}
              </span>
            ))}
            {(record.eventUses || []).map((eventUse) => (
              <span key={`event-${eventUse}`} className="v2-tag">
                Event use: {eventUse}
              </span>
            ))}
          </div>
        </DetailSection>
        <DetailSection title="Services and menus">
          {serviceGroups.length ? (
            <div className="v2-stack">
              {serviceGroups.map((group) => (
                <div key={group.service} className="v2-line-card">
                  <div className="v2-link-list">
                    <strong>{group.service}</strong>
                    <button
                      type="button"
                      className="v2-secondary-button"
                      onClick={() => createMenuForRestaurant(record.id, group.service)}
                    >
                      Add menu
                    </button>
                  </div>
                  {group.menus.length ? (
                    <div className="v2-link-list">
                      {group.menus.map((menu) => (
                        <button
                          key={menu.id}
                          type="button"
                          className="v2-link-chip"
                          onClick={() => openRecord("menu", menu.id)}
                        >
                          {menu.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="v2-micro-note">No menus created for this service yet.</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="v2-micro-note">No services defined for this restaurant yet.</div>
          )}
          <div className="v2-link-list">
            <button type="button" className="v2-primary-button" onClick={() => createMenuForRestaurant(record.id)}>
              Add menu
            </button>
          </div>
        </DetailSection>
      </>
    );
  }

  return <EmptyDetail />;
}

function DetailHeader({ title, subtitle, status, statusLabel }) {
  return (
    <div className="v2-detail-header">
      <div>
        <div className="v2-eyebrow">Record detail</div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <StatusBadge status={status} label={statusLabel} />
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="v2-detail-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function DetailStat({ label, value }) {
  return (
    <div className="v2-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ label, value, tone, active = false, onClick }) {
  const className = `v2-summary-card v2-summary-${workspaceTone(tone)} ${active ? "active" : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span>{label}</span>
        <strong>{value}</strong>
      </button>
    );
  }

  return (
    <div className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status, label }) {
  return <span className={`v2-status v2-status-${statusTone(status)}`}>{label || status}</span>;
}

function SharedDataAuthScreen({
  title,
  message,
  email = "",
  password = "",
  setEmail,
  setPassword,
  error = "",
  onSubmit,
  drinksLink = "",
}) {
  return (
    <div className="v2-auth-shell">
      <main className="v2-auth-main">
        <section className="v2-panel v2-auth-panel">
          <div className="v2-empty-state v2-auth-card">
            <div className="v2-eyebrow">Peligoni internal tool</div>
            <h3>{title}</h3>
            <p>{message}</p>
            {typeof onSubmit === "function" ? (
              <div className="v2-stack v2-auth-form">
                <label className="v2-field">
                  <span>Email</span>
                  <input value={email} onChange={(event) => setEmail?.(event.target.value)} />
                </label>
                <label className="v2-field">
                  <span>Password</span>
                  <input type="password" value={password} onChange={(event) => setPassword?.(event.target.value)} />
                </label>
                {error ? <div className="v2-inline-callout warn"><span>{error}</span></div> : null}
                <div className="v2-link-list">
                  <button
                    type="button"
                    className="v2-primary-button"
                    onClick={onSubmit}
                    disabled={!String(email || "").trim() || !String(password || "").trim()}
                  >
                    Sign in
                  </button>
                  {drinksLink ? (
                    <a href={drinksLink} className="v2-secondary-button">
                      Drinks app
                    </a>
                  ) : null}
                </div>
              </div>
            ) : drinksLink ? (
              <div className="v2-link-list">
                <a href={drinksLink} className="v2-secondary-button">
                  Drinks app
                </a>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="v2-empty-state">
      <div className="v2-eyebrow">No selection</div>
      <h3>Open a record to work on it</h3>
      <p>Jump between ingredients, components, recipes, menus, and exports from one consistent workspace.</p>
    </div>
  );
}

function sectionTitle(section) {
  if (section === "queue") return "Queue";
  if (section === "ingredients") return "Ingredients";
  if (section === "substitutions") return "Substitutions";
  if (section === "recipes") return "Recipes";
  if (section === "batches") return "Components";
  if (section === "menus") return "Menus";
  if (section === "exports") return "Exports";
  return "Settings";
}

function sectionSummary(section) {
  if (section === "queue") return "See what needs action first and jump straight into it.";
  if (section === "ingredients") return "Review imports, keep the ingredient master clean, and publish trusted records.";
  if (section === "substitutions") return "Compare likely replacements and see their operational reach before you switch.";
  if (section === "recipes") return "Build dishes in a step-by-step editor with cleaner costing and publishing.";
  if (section === "batches") return "Build reusable components, publish them into ingredients, and reuse them everywhere.";
  if (section === "menus") return "Build menus from restaurant and service structure, then preview and publish them.";
  if (section === "exports") return "Open previews, download CSVs, and print the outputs you need.";
  return "Manage shared structure, users, naming rules, and integrations.";
}

export default App;

import JSZip from "jszip";
import { getRecipeImportFormat } from "./formats";

export function parseCsv(text) {
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

export function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, (row[index] || "").trim()])
    )
  );
}

export function inferPayloadKey(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes("recipe_components")) return "recipe_components";
  if (lower.includes("recipes_flat")) return "recipes_flat";
  if (lower.includes("soft1") && lower.endsWith(".xlsx")) return "soft1_workbook";
  if (lower.includes("soft1")) return "soft1_recipe";
  if (lower.endsWith(".xlsx") || lower.includes("batch")) return "batch_workbook";
  if (lower.endsWith(".json")) return "recipes_json";
  return "recipes";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function mapImportedVenue(value, fallback = "") {
  const normalized = String(value || fallback || "").trim();
  const key = normalizeMatchKeyForVenue(normalized);

  if (key === "cy" || key === "courtyard") return "Courtyard";
  if (key === "tasi") return "Tasi";
  if (key === "terraces") return "Terraces";
  if (key === "popup" || key === "pop up") return "Pop up";
  if (key === "dessert") return "Dessert";
  return normalized;
}

function normalizeMatchKeyForVenue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSoft1Quantity(rawQty, rawUnit) {
  const qtyText = String(rawQty || "").trim().toUpperCase();
  const unitText = String(rawUnit || "").trim().toUpperCase();
  const qtyMatch = qtyText.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)?/);

  if (qtyMatch) {
    const amount = Number(qtyMatch[1]);
    const unit = qtyMatch[2] || "";
    if (Number.isFinite(amount)) {
      if (unit === "KG") return String(amount * 1000);
      if (unit === "G") return String(amount);
      if (unit === "L") return String(amount * 1000);
      if (unit === "ML") return String(amount);
      return String(amount);
    }
  }

  const numericUnit = Number(unitText);
  if (Number.isFinite(numericUnit) && numericUnit > 0) {
    return String(numericUnit);
  }

  const combined = `${qtyText}${unitText}`;
  const match = combined.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)?/);

  if (!match) return "";

  const amount = Number(match[1]);
  const unit = match[2] || "";
  if (!Number.isFinite(amount)) return "";

  if (unit === "KG") return String(amount * 1000);
  if (unit === "G") return String(amount);
  if (unit === "L") return String(amount * 1000);
  if (unit === "ML") return String(amount);
  return String(amount);
}

function parseVenueDishWorkbookSheet(sheet) {
  const headerIndex = sheet.rows.findIndex((row) => {
    const headerKeys = row.map((cell) => normalizeHeaderKey(cell));
    return headerKeys.includes("dish") && (headerKeys.includes("venue") || headerKeys.includes("smd") || headerKeys.includes("smdk"));
  });

  if (headerIndex === -1) {
    return [];
  }

  const headers = sheet.rows[headerIndex].map((cell) => normalizeHeaderKey(cell));
  const venueIndex = headers.findIndex((header) => header === "venue");
  const courseIndex = headers.findIndex((header) => header === "smd" || header === "smdk");
  const dishIndex = headers.findIndex((header) => header === "dish");
  const oldIndex = headers.findIndex((header) => header === "old");

  if (dishIndex === -1) {
    return [];
  }

  return sheet.rows
    .slice(headerIndex + 1)
    .map((row, rowIndex) => {
      const rawDishName = row[dishIndex] || "";
      const dishName = String(rawDishName || "").trim();
      if (!dishName) return null;

      const sourceTab = sheet.name || "Sheet";
      const rawVenue = venueIndex >= 0 ? row[venueIndex] || "" : "";
      const rawCourse = courseIndex >= 0 ? row[courseIndex] || "" : "";
      const rawOld = oldIndex >= 0 ? row[oldIndex] || "" : "";

      return {
        entry_id: `${slugify(sourceTab) || "sheet"}-${String(rowIndex + 1).padStart(4, "0")}`,
        source_tab: sourceTab,
        venue: mapImportedVenue(rawVenue, sourceTab),
        course: String(rawCourse || "").trim(),
        dish_name: dishName,
        old_flag: String(rawOld || "").trim(),
      };
    })
    .filter(Boolean);
}

function parseSoft1PortionCount(serviceNote) {
  const match = String(serviceNote || "").match(/(\d+(?:\.\d+)?)\s*PAX/i);
  const parsed = Number(match?.[1] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildSoft1BatchCode(recipeIdBase, sectionName, sectionIndex) {
  const sectionSlug = slugify(sectionName).replace(/-/g, "").toUpperCase();
  const recipeSlug = slugify(recipeIdBase).replace(/-/g, "").toUpperCase();
  const suffix = `${sectionSlug}${recipeSlug}`.slice(0, 12) || String(sectionIndex + 1).padStart(3, "0");
  return `BCH-${suffix}`;
}

function parseSoft1RecipeRows(rows, fallbackRecipeName = "Imported recipe") {
  const headerIndex = rows.findIndex((row) =>
    row.map((value) => value.trim().toUpperCase()).join("|") ===
    ["SOFT1 CODE", "INGREDIENT", "QTY", "UNIT", "METHOD"].join("|")
  );

  if (headerIndex === -1) {
    return [];
  }

  const preHeaderRows = rows.filter((row, index) => index < headerIndex && row.some((value) => value.trim()));
  const titleRow = preHeaderRows[0];
  const serviceRow = preHeaderRows[1];
  const recipeName = titleRow?.[0]?.trim() || fallbackRecipeName;
  const serviceNote = serviceRow?.find((value) => String(value || "").trim())?.trim() || "";
  const portionCount = parseSoft1PortionCount(serviceNote);
  const dataRows = rows.slice(headerIndex + 1);
  const recipeIdBase = slugify(recipeName) || "imported-recipe";

  const normalizedRows = [];
  const sections = [];
  const sectionsByName = new Map();
  let currentSection = "";
  const presentationSections = [];
  let presentationMode = false;

  const getOrCreateSection = (sectionName) => {
    const key = sectionName || "Main prep";
    if (sectionsByName.has(key)) {
      return sectionsByName.get(key);
    }

    const nextSection = {
      name: key,
      index: sections.length + 1,
      recipe_id: `${recipeIdBase}--${slugify(key) || `section-${sections.length + 1}`}`,
      soft1_code: buildSoft1BatchCode(recipeIdBase, key, sections.length),
      methodLines: [],
      components: [],
    };
    sections.push(nextSection);
    sectionsByName.set(key, nextSection);
    return nextSection;
  };

  dataRows.forEach((row) => {
    const soft1Code = (row[0] || "").trim();
    const ingredientName = (row[1] || "").trim();
    const qty = (row[2] || "").trim();
    const unit = (row[3] || "").trim();
    const method = (row[4] || "").trim();
    const marker = [ingredientName, qty, unit, method]
      .map((value) => String(value || "").trim().toUpperCase())
      .find((value) => value === "PLATE" || value === "PRESENTATION");

    if (marker === "PLATE" || marker === "PRESENTATION") {
      presentationMode = true;
      if (!presentationSections.includes(marker)) {
        presentationSections.push(marker);
      }
      return;
    }

    if (!ingredientName) return;
    const isSectionRow = ingredientName && !qty && !unit && !method;
    if (isSectionRow) {
      currentSection = ingredientName;
      getOrCreateSection(currentSection);
      if (presentationMode) {
        presentationSections.push(ingredientName);
      }
      return;
    }

    if (method) {
      const sectionLabel = currentSection ? `${currentSection}: ${method}` : method;
      if (presentationMode) {
        presentationSections.push(sectionLabel);
      } else {
        getOrCreateSection(currentSection).methodLines.push(method);
      }
    }

    const activeSection = getOrCreateSection(currentSection);
    normalizedRows.push({
      recipe_id: soft1Code || recipeIdBase,
      recipe_name: recipeName,
      soft1_code: soft1Code,
      restaurant: "",
      category: "",
      service_note: serviceNote,
      portion_count: portionCount,
      section_name: activeSection.name,
      section_recipe_id: activeSection.recipe_id,
      section_soft1_code: activeSection.soft1_code,
      section_sort: activeSection.index,
      section_method: activeSection.methodLines.join("\n"),
      method: sections
        .filter((section) => section.methodLines.length)
        .map((section) => `${section.name}: ${section.methodLines.join(" ")}`)
        .join("\n"),
      presentation_notes: presentationSections.join("\n"),
      current_sale_price: "",
      roundup: "",
      component_sort: activeSection.components.length + 1,
      ingredient_name: ingredientName,
      ingredient_item_code: "",
      quantity_by_weight_grams: parseSoft1Quantity(qty, unit),
      component_cost: "",
      source_qty: qty,
      source_unit: unit,
      method,
    });
    activeSection.components.push(ingredientName);
  });

  const fullMethod = sections
    .filter((section) => section.methodLines.length)
    .map((section) => `${section.name}: ${section.methodLines.join(" ")}`)
    .join("\n");

  return normalizedRows.map((row) => {
    const section = sectionsByName.get(row.section_name || "");
    return {
      ...row,
      method: fullMethod,
      section_method: section?.methodLines?.join("\n") || row.section_method || "",
      presentation_notes: presentationSections.join("\n"),
    };
  });
}

function parseSoft1RecipeSheet(text) {
  const rows = parseCsv(text);
  const parsedRows = parseSoft1RecipeRows(rows);
  if (!parsedRows.length) {
    throw new Error("Could not find SOFT1 header row in the uploaded sheet.");
  }
  return parsedRows;
}

function getCellText(cell, sharedStrings) {
  const cellType = cell.getAttribute("t");
  const valueNode = cell.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "v"
  )[0];
  if (!valueNode) return "";
  const rawValue = valueNode.textContent || "";
  if (cellType === "s") {
    return sharedStrings[Number(rawValue)] || "";
  }
  return rawValue;
}

function readSheetRows(xmlText, sharedStrings) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  const rowNodes = Array.from(
    document.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "row")
  );

  return rowNodes.map((rowNode) => {
    const cells = Array.from(
      rowNode.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "c")
    );
    const row = [];
    cells.forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const colRef = ref.replace(/[0-9]/g, "");
      let colIndex = 0;
      for (let i = 0; i < colRef.length; i += 1) {
        colIndex = colIndex * 26 + (colRef.charCodeAt(i) - 64);
      }
      row[colIndex - 1] = getCellText(cell, sharedStrings);
    });
    return row.map((value) => String(value || "").trim());
  });
}

async function parseBatchWorkbookXlsx(file) {
  const workbookSheets = await readXlsxWorkbookSheets(file);
  const rows = workbookSheets[0]?.rows || [];
  const headerRowIndex = rows.findIndex((row) => (row[0] || "").trim() === "Name");
  if (headerRowIndex === -1) {
    throw new Error("Could not find the batch workbook header row.");
  }

  const headers = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1).filter((row) => row.some((value) => String(value || "").trim()));
  const batchRows = dataRows.map((row, rowIndex) => {
    const read = (columnName) => {
      const index = headers.findIndex((header) => header === columnName);
      return index >= 0 ? row[index] || "" : "";
    };

    const name = read("Name");
    const code = read("batch item code");
    const sourceCost = read("COST per kilo");
    const batchYield = read("Total cooked/prepped weight (gr)");
    const recipeComplete = read("Recipe complete");
    const components = [];

    for (let componentIndex = 1; componentIndex <= 16; componentIndex += 1) {
      const componentOffset = 6 + (componentIndex - 1) * 4;
      const ingredientName = row[componentOffset] || "";
      const ingredientCode = row[componentOffset + 1] || "";
      const quantity = row[componentOffset + 2] || "";
      const cost = row[componentOffset + 3] || "";
      if (!ingredientName.trim() && !ingredientCode.trim() && !quantity.trim() && !cost.trim()) continue;
      components.push({
        component_sort: componentIndex,
        ingredient_name: ingredientName,
        ingredient_item_code: ingredientCode,
        quantity_by_weight_grams: quantity,
        component_cost: cost,
      });
    }

    return {
      recipe_id: code || slugify(name) || `batch-${rowIndex + 1}`,
      restaurant: "",
      name,
      category: "Batch",
      selling_item_code: code,
      current_sale_price: "",
      roundup: "",
      recipe_type: "batch",
      batch_yield: batchYield,
      batch_yield_type: "g",
      recipe_complete: recipeComplete,
      pricing_complete: "1",
      source_cost: sourceCost,
      components,
    };
  });

  return batchRows.filter((row) => row.name || row.selling_item_code);
}

async function readXlsxWorkbookSheets(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");

  if (!workbookXml || !workbookRelsXml) {
    throw new Error("Could not read workbook structure from the uploaded .xlsx file.");
  }

  const sharedStrings = [];
  if (sharedStringsXml) {
    const sharedDoc = new DOMParser().parseFromString(sharedStringsXml, "application/xml");
    const stringItems = Array.from(
      sharedDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "si")
    );
    stringItems.forEach((item) => {
      const textParts = Array.from(
        item.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "t")
      ).map((node) => node.textContent || "");
      sharedStrings.push(textParts.join(""));
    });
  }

  const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
  const relsDoc = new DOMParser().parseFromString(workbookRelsXml, "application/xml");
  const relationshipById = new Map(
    Array.from(relsDoc.getElementsByTagName("Relationship")).map((node) => [
      node.getAttribute("Id"),
      node.getAttribute("Target"),
    ])
  );
  const sheetNodes = Array.from(
    workbookDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "sheet")
  );

  if (!sheetNodes.length) {
    throw new Error("The uploaded workbook does not contain any sheets.");
  }

  const sheets = [];
  for (const sheetNode of sheetNodes) {
    const relationshipId =
      sheetNode.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      sheetNode.getAttribute("r:id");
    const target = relationshipById.get(relationshipId);
    if (!target) continue;
    const normalizedTarget = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\/?/, "")}`;
    const worksheetXml = await zip.file(normalizedTarget)?.async("string");
    if (!worksheetXml) continue;
    sheets.push({
      name: sheetNode.getAttribute("name") || "Sheet",
      rows: readSheetRows(worksheetXml, sharedStrings),
    });
  }

  if (!sheets.length) {
    throw new Error("Could not read any worksheet data from the uploaded workbook.");
  }

  return sheets;
}

async function parseSoft1WorkbookXlsx(file) {
  const workbookSheets = await readXlsxWorkbookSheets(file);
  const parsedRows = workbookSheets.flatMap((sheet) => parseSoft1RecipeRows(sheet.rows, sheet.name));
  if (!parsedRows.length) {
    throw new Error("Could not find any SOFT1 recipe sheets in the uploaded workbook.");
  }
  return parsedRows;
}

async function parseVenueDishWorkbookXlsx(file) {
  const workbookSheets = await readXlsxWorkbookSheets(file);
  const parsedRows = workbookSheets.flatMap((sheet) => parseVenueDishWorkbookSheet(sheet));
  if (!parsedRows.length) {
    throw new Error("Could not find any venue dish index sheets in the uploaded workbook.");
  }
  return parsedRows;
}

export function validatePayload(format, payload) {
  const errors = [];

  Object.entries(format.requiredColumns).forEach(([payloadKey, requiredColumns]) => {
    const rows = payload[payloadKey] || [];
    if (!rows.length) {
      errors.push(`Missing required file payload: ${payloadKey}`);
      return;
    }

    const headers = Object.keys(rows[0] || {});
    const missing = requiredColumns.filter((column) => !headers.includes(column));
    if (missing.length) {
      errors.push(`${payloadKey} is missing columns: ${missing.join(", ")}`);
    }
  });

  return errors;
}

export async function parseRecipeImportFiles({ formatId, files }) {
  const format = getRecipeImportFormat(formatId);
  if (!format) {
    throw new Error(`Unsupported recipe import format: ${formatId}`);
  }

  const payload = {};
  for (const file of files) {
    if (formatId === "venue-dish-workbook-xlsx") {
      payload.dish_index = await parseVenueDishWorkbookXlsx(file);
      continue;
    }
    if (formatId === "batch-workbook-wide") {
      payload.batch_workbook = await parseBatchWorkbookXlsx(file);
      continue;
    }
    if (formatId === "soft1-workbook-xlsx") {
      payload.soft1_recipe = await parseSoft1WorkbookXlsx(file);
      continue;
    }
    if (formatId === "soft1-recipe-sheet") {
      payload.soft1_recipe = parseSoft1RecipeSheet(await file.text());
      continue;
    }
    const payloadKey = inferPayloadKey(file.name);
    if (file.name.toLowerCase().endsWith(".json")) {
      payload[payloadKey] = JSON.parse(await file.text());
      continue;
    }

    const text = await file.text();
    payload[payloadKey] = csvRowsToObjects(parseCsv(text));
  }

  const errors = validatePayload(format, payload);
  if (errors.length) {
    throw new Error(errors.join(" | "));
  }

  return payload;
}

export function parseRecipeImportContents({ formatId, contents }) {
  const format = getRecipeImportFormat(formatId);
  if (!format) {
    throw new Error(`Unsupported recipe import format: ${formatId}`);
  }

  if (formatId === "batch-workbook-wide") {
    throw new Error("Batch workbook import currently supports local .xlsx uploads only.");
  }
  if (formatId === "venue-dish-workbook-xlsx") {
    throw new Error("Venue dish workbook import currently supports local .xlsx uploads only.");
  }
  if (formatId === "soft1-workbook-xlsx") {
    throw new Error("SOFT1 workbook import currently supports local .xlsx uploads only.");
  }

  const payload = {};
  contents.forEach(({ name, text, type }) => {
    if (formatId === "soft1-recipe-sheet") {
      payload.soft1_recipe = parseSoft1RecipeSheet(text);
      return;
    }
    const payloadKey = inferPayloadKey(name);
    if (type === "json" || name.toLowerCase().endsWith(".json")) {
      payload[payloadKey] = JSON.parse(text);
      return;
    }

    payload[payloadKey] = csvRowsToObjects(parseCsv(text));
  });

  const errors = validatePayload(format, payload);
  if (errors.length) {
    throw new Error(errors.join(" | "));
  }

  return payload;
}

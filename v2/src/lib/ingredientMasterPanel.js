export function buildIngredientsPanelState({
  rows = [],
  allIngredients = [],
  catalogueBaseRows = [],
  importRows = [],
  pendingManualIngredientCount = 0,
  workspaceView = "catalogue",
  searchQuery = "",
  ingredientRecordFilter = "all",
  ingredientRuleCatchupMap = new Map(),
  getIngredientReviewAttentionReasons,
  isLikelySoft1IngredientCode,
  getSoft1CodeCategorySuggestion,
  normalizeIngredientKey,
  isWeakIngredientCategory,
}) {
  const query = String(searchQuery || "").trim().toLowerCase();
  const isCatalogueView = workspaceView === "catalogue";
  const activeCatalogueCount = catalogueBaseRows.filter((row) => !row.archived).length;
  const getRowReviewAttentionReasons = (row) => getIngredientReviewAttentionReasons(row, ingredientRuleCatchupMap);
  const rowNeedsCatalogueReviewAttention = (row) => getRowReviewAttentionReasons(row).length > 0;
  const rowNeedsManualReview = (row) => getRowReviewAttentionReasons(row).includes("manual_review");
  const rowNeedsPriceReview = (row) => getRowReviewAttentionReasons(row).includes("price_review");
  const rowNeedsRuleCatchup = (row) => getRowReviewAttentionReasons(row).includes("rule_catchup");
  const isComponentDerivedRow = (row) => Boolean(row?.batchId);
  const isManualRow = (row) =>
    !isComponentDerivedRow(row) &&
    (String(row?.sourceType || "").trim().toLowerCase() === "manual" ||
      String(row?.soft1Status || "").trim().toLowerCase() === "pending");
  const isSimpleRow = (row) => !isComponentDerivedRow(row) && !isManualRow(row);

  const simpleCatalogueCount = catalogueBaseRows.filter((row) => !row.archived && isSimpleRow(row)).length;
  const componentDerivedCatalogueCount = catalogueBaseRows.filter((row) => !row.archived && Boolean(row.batchId)).length;
  const manualCatalogueCount = catalogueBaseRows.filter((row) => !row.archived && isManualRow(row)).length;
  const allCatalogueCount = catalogueBaseRows.filter((row) => !row.archived).length;
  const groupedCatalogueRows = catalogueBaseRows.filter((row) =>
    ingredientRecordFilter === "component_derived"
      ? isComponentDerivedRow(row)
      : ingredientRecordFilter === "manual"
        ? isManualRow(row)
      : ingredientRecordFilter === "simple"
        ? isSimpleRow(row)
        : true
  );
  const archivedCatalogueCount = groupedCatalogueRows.filter((row) => row.archived).length;
  const forReviewCatalogueCount = groupedCatalogueRows.filter((row) => !row.archived && rowNeedsCatalogueReviewAttention(row)).length;
  const manualReviewCatalogueCount = groupedCatalogueRows.filter((row) => !row.archived && rowNeedsManualReview(row)).length;
  const priceReviewCatalogueCount = groupedCatalogueRows.filter((row) => !row.archived && rowNeedsPriceReview(row)).length;
  const ruleCatchupCatalogueCount = groupedCatalogueRows.filter((row) => !row.archived && rowNeedsRuleCatchup(row)).length;
  const visibleRuleCatchupRowIds = rows.filter((row) => !row.archived && rowNeedsRuleCatchup(row)).map((row) => row.id);
  const visibleArchivedRowIds = rows.filter((row) => row.archived).map((row) => row.id);
  const catalogueActionLabel =
    pendingManualIngredientCount > 0
      ? `Export manual (${pendingManualIngredientCount})`
      : "Export manual";

  const unpublishedImportRows = importRows.filter((row) => {
    if (row.published) return false;
    if (!query) return true;
    return [
      row.chosenName,
      row.rawName,
      row.sourceCode,
      row.internalCode,
      row.category,
      row.targetName,
      row.suggestedName,
      ...(row.appliedLearningRules || []).map((rule) => rule.label),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const ingredientById = new Map((allIngredients || rows).map((row) => [row.id, row]));

  const soft1CategorySuggestionCount = (allIngredients || rows).filter((ingredient) => {
    if (ingredient.archived || !String(ingredient.sourceCode || "").trim()) return false;
    const suggestedCategory = getSoft1CodeCategorySuggestion(ingredient.sourceCode);
    if (!suggestedCategory) return false;
    if (normalizeIngredientKey(ingredient.category || "") === normalizeIngredientKey(suggestedCategory)) return false;
    return isWeakIngredientCategory(ingredient.category || "");
  }).length;

  return {
    query,
    isCatalogueView,
    activeCatalogueCount,
    rowNeedsCatalogueReviewAttention,
    rowNeedsManualReview,
    rowNeedsPriceReview,
    rowNeedsRuleCatchup,
    simpleCatalogueCount,
    componentDerivedCatalogueCount,
    manualCatalogueCount,
    allCatalogueCount,
    groupedCatalogueRows,
    archivedCatalogueCount,
    forReviewCatalogueCount,
    manualReviewCatalogueCount,
    priceReviewCatalogueCount,
    ruleCatchupCatalogueCount,
    visibleRuleCatchupRowIds,
    visibleArchivedRowIds,
    catalogueActionLabel,
    unpublishedImportRows,
    ingredientById,
    soft1CategorySuggestionCount,
    buildReviewListRows(importStatusFilter = "all") {
      return unpublishedImportRows.filter((row) => {
        const isReadyRow = row.reviewStatus === "ready";
        if (importStatusFilter === "review") return row.reviewStatus === "review";
        if (importStatusFilter === "ready") return isReadyRow;
        if (importStatusFilter === "conflicts") return row.needsCodeReview && !isReadyRow;
        return !isReadyRow;
      });
    },
    buildBulkReviewableRowIds(reviewListRows = []) {
      return reviewListRows
        .filter((row) => row.reconcileMode && row.strategy === "update" && row.existingIngredientId)
        .map((row) => row.id);
    },
    buildBulkSimpleSoft1RowIds(reviewListRows = []) {
      return reviewListRows
        .filter((row) => {
          if (!row.reconcileMode || row.strategy !== "update" || !row.existingIngredientId || row.published) return false;
          if (!isLikelySoft1IngredientCode(row.sourceCode)) return false;
          const linkedIngredient = ingredientById.get(row.existingIngredientId);
          if (!linkedIngredient || linkedIngredient.archived) return false;
          if (linkedIngredient.batchId) return false;
          return true;
        })
        .map((row) => row.id);
    },
  };
}

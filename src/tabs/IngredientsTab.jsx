export default function IngredientsTab({
  Card,
  StatCard,
  Badge,
  Icon,
  ingredientCatalogueSummary,
  setActiveTab,
  setIngredientTypeFilter,
  setIngredientBatchLinkFilter,
  setIngredientColumnFilter,
  setSearch,
  addIngredientRow,
  combinedIngredientCatalog,
  unlockedIngredientCount,
  ingredientEditLookupQuery,
  setIngredientEditLookupQuery,
  setIngredientEditLookup,
  setIngredientEditLookupOpen,
  ingredientEditLookupOpen,
  filteredIngredientEditOptions,
  focusIngredientDraft,
  ingredientCatalog,
  openIngredientQuickPanel,
  activeIngredientDraft,
  money,
  parsePackSizeParts,
  purchaseVatOptions,
  percentFromRate,
  getValidationIssueText,
  ingredientUploadMessage,
  ingredientUploadError,
  ingredientImportSession,
  ingredientImportSummary,
  ingredientImportTargetOptions,
  duplicateIngredientGroups,
  mergeDuplicateIngredientGroup,
  dismissDuplicateIngredientGroup,
  ingredientReturnTarget,
  returnToIngredientSourceRecipe,
  handleIngredientUpload,
  clearIngredientImportSession,
  setIngredientImportStrategy,
  setIngredientImportTarget,
  updateIngredientImportDraftField,
  updateIngredientImportDraftPackSize,
  getIngredientImportCodeConflict,
  suggestIngredientImportCodeVariant,
  applySingleIngredientImportRow,
  applyIngredientImportSession,
  saveIngredientMasterChanges,
  ingredientMaster,
  normalizeExistingNames,
  recipes,
  createMissingIngredientRowsFromRecipes,
  refreshRecipeComponentSources,
  syncBatchIngredientsWithRecipes,
  exportIngredientMaster,
  downloadIngredientTemplate,
  ingredientTypeFilter,
  ingredientBatchLinkFilter,
  ingredientColumnFilter,
  renderIngredientSortHeader,
  filteredIngredientCatalog,
  renderIngredientCatalogRow,
  deleteIngredientRow,
}) {
  return (
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
              <div className="eyebrow">Ingredient tools</div>
              <h2>Lookup, add, and review</h2>
            </div>
            <div className="badge-row compact">
              <button
                type="button"
                className="secondary-button"
                onClick={() => addIngredientRow({ openQuickEdit: true })}
              >
                <Icon name="plus" />
                Add ingredient
              </button>
              <Badge tone="default">{unlockedIngredientCount} unlocked</Badge>
            </div>
          </div>
          <div className="ingredient-builder-card">
            <div className="ingredient-builder-top">
              <label className="form-field recipe-search-field">
                <span>Find ingredient</span>
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
                        className="lookup-option"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          focusIngredientDraft(option.id, option.label);
                          const selectedIngredient = ingredientCatalog.find(
                            (ingredient) => ingredient.id === option.id
                          );
                          if (selectedIngredient) {
                            openIngredientQuickPanel(selectedIngredient);
                          }
                        }}
                      >
                        <div className="lookup-main">
                          <strong>{option.label}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : ingredientEditLookupOpen && ingredientEditLookupQuery.trim() ? (
                  <div className="lookup-panel recipe-search-panel">
                    <div className="support-stack">
                      <div className="presentation-placeholder">No matching ingredients found.</div>
                      <button
                        type="button"
                        className="primary-button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          addIngredientRow({
                            openQuickEdit: true,
                            ingredientName: ingredientEditLookupQuery.trim(),
                          });
                          setIngredientEditLookupOpen(false);
                        }}
                      >
                        <Icon name="plus" />
                        Add `{ingredientEditLookupQuery.trim()}`
                      </button>
                    </div>
                  </div>
                ) : null}
              </label>
            </div>
            {activeIngredientDraft ? (
              <>
                <div className="builder-summary-banner">
                  <div>
                    <div className="mini-heading">Selected ingredient</div>
                    <strong>{activeIngredientDraft.source.ingredient_name?.trim() || "New ingredient"}</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Type</div>
                    <strong>{activeIngredientDraft.source.entry_type === "batch" ? "Batch" : "Ingredient"}</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Item code</div>
                    <strong>{activeIngredientDraft.source.ingredient_item_code || "Not set"}</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Unit price (net)</div>
                    <strong>{money(activeIngredientDraft.source.unit_cost || 0)}</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Purchase VAT</div>
                    <strong>{Math.round(Number(activeIngredientDraft.source.purchase_vat_rate || 0.13) * 100)}%</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Category</div>
                    <strong>{activeIngredientDraft.source.category || "Not set"}</strong>
                  </div>
                  <div>
                    <div className="mini-heading">Supplier</div>
                    <strong>{activeIngredientDraft.source.supplier || "Not set"}</strong>
                  </div>
                </div>
                <div className="badge-row compact">
                  <Badge tone="default">
                    {activeIngredientDraft.source.ingredient_name?.trim() ? "Editing ingredient" : "New ingredient"}
                  </Badge>
                  <Badge
                    tone={activeIngredientDraft.validation.reviewStatus === "needs-review" ? "bad" : "good"}
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
                <div className="panel-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => openIngredientQuickPanel(activeIngredientDraft.source)}
                  >
                    <Icon name="edit" />
                    Edit selected ingredient
                  </button>
                </div>
                <p className="support-text">
                  Use the lookup above to jump into the popout editor. Use `Link batch recipes` after batch imports to
                  refresh BCH-linked ingredient rows.
                </p>
                {ingredientUploadMessage ? (
                  <p className="support-text success-text">{ingredientUploadMessage}</p>
                ) : null}
                {ingredientUploadError ? (
                  <p className="support-text error-text">{ingredientUploadError}</p>
                ) : null}
              </>
            ) : (
              <div className="support-stack">
                <p className="support-text">
                  Start typing to find an ingredient. If it does not exist, you will get an `Add` prompt and the new
                  ingredient will open straight in the popout.
                </p>
              </div>
            )}
            {duplicateIngredientGroups.length ? (
              <div className="review-panel">
                <div className="review-panel-header">
                  <div>
                    <div className="eyebrow">Cleanup</div>
                    <h3>Likely duplicate ingredients</h3>
                  </div>
                  <Badge tone="warn">{duplicateIngredientGroups.length} groups</Badge>
                </div>
                <div className="support-stack">
                  {duplicateIngredientGroups.slice(0, 8).map((group) => (
                    <div key={group.id} className="usage-card">
                      <div className="usage-top">
                        <div>
                          <strong>
                            {group.mode === "code" ? "Duplicate item code" : "Duplicate ingredient name"}:{" "}
                            {group.value || "Untitled"}
                          </strong>
                          <p>
                            Keeping{" "}
                            <strong>
                              {group.primaryIngredient?.ingredient_name ||
                                group.primaryIngredient?.ingredient_item_code ||
                                "best row"}
                            </strong>{" "}
                            and merging {group.ingredients.length - 1} other row
                            {group.ingredients.length - 1 === 1 ? "" : "s"}.
                          </p>
                        </div>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => mergeDuplicateIngredientGroup(group)}
                          >
                            Merge group
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => dismissDuplicateIngredientGroup(group.id)}
                          >
                            Keep separate
                          </button>
                        </div>
                      </div>
                      <div className="field-summary">
                        {group.ingredients.map((ingredient) => (
                          <div key={ingredient.id} className="duplicate-ingredient-row">
                            <div>
                              <strong>
                                {ingredient.ingredient_name || "Untitled ingredient"}
                                {ingredient.id === group.primaryIngredient?.id ? " (keep)" : ""}
                              </strong>
                              <div>
                                {ingredient.ingredient_item_code || "No code"} ·{" "}
                                {Number(ingredient.unit_cost || 0) > 0 ? money(ingredient.unit_cost) : "No price"} ·{" "}
                                {ingredient.pack_size || "No pack size"}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="secondary-button table-action-button"
                              disabled={ingredient.is_locked}
                              onClick={() => deleteIngredientRow(ingredient)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {duplicateIngredientGroups.length > 8 ? (
                    <p className="support-text">
                      Showing the first 8 duplicate groups. Merge these and the rest will surface next.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
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
                <input
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleIngredientUpload}
                />
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
                onClick={normalizeExistingNames}
                disabled={!ingredientMaster.length && !recipes.length}
              >
                Normalize existing names
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={createMissingIngredientRowsFromRecipes}
                disabled={!recipes.length}
              >
                Create missing from recipes
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={refreshRecipeComponentSources}
                disabled={!recipes.length}
              >
                Refresh recipe units and costs
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
            {ingredientImportSession ? (
              <div className="review-panel ingredient-import-review">
                <div className="review-panel-header">
                  <div>
                    <div className="eyebrow">Import review</div>
                    <h3>{ingredientImportSession.fileName || "Uploaded ingredient file"}</h3>
                  </div>
                  <div className="badge-row compact">
                    <Badge tone="default">{ingredientImportSummary?.total || 0} rows</Badge>
                    <Badge tone="good">{ingredientImportSummary?.mergeCount || 0} merge</Badge>
                    <Badge tone="default">{ingredientImportSummary?.createCount || 0} new</Badge>
                    {ingredientImportSummary?.attentionCount ? (
                      <Badge tone="warn">{ingredientImportSummary.attentionCount} need attention</Badge>
                    ) : null}
                    {ingredientImportSummary?.duplicateTargetCount ? (
                      <Badge tone="bad">
                        {ingredientImportSummary.duplicateTargetCount} duplicate target
                        {ingredientImportSummary.duplicateTargetCount === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="support-text">
                  Review each uploaded row, decide whether it should merge into an existing ingredient or create a new
                  one, then apply the reviewed import.
                </p>
                <div className="upload-actions">
                  <button type="button" className="primary-button" onClick={applyIngredientImportSession}>
                    <Icon name="upload" />
                    Apply reviewed import
                  </button>
                  <button type="button" className="secondary-button" onClick={clearIngredientImportSession}>
                    Clear review
                  </button>
                </div>
                <div className="ingredient-import-list">
                  {ingredientImportSession.rows.map((row) => {
                    const packParts = parsePackSizeParts(row.draft.pack_size);
                    const matchedOption = ingredientImportTargetOptions.find(
                      (option) => option.id === row.targetIngredientId
                    );
                    const hasCodeConflict = getIngredientImportCodeConflict(row);
                    const confidenceTone =
                      row.matchConfidence === "high"
                        ? "good"
                        : row.matchConfidence === "medium"
                          ? "default"
                          : row.matchConfidence === "manual"
                            ? "default"
                            : row.matchConfidence === "low"
                              ? "warn"
                              : "bad";

                    return (
                      <div key={row.id} className="usage-card ingredient-import-card">
                        <div className="usage-top">
                          <div className="support-stack">
                            <strong>
                              {row.source.ingredient_name || row.importedIngredient.ingredient_name || "Unnamed row"}
                            </strong>
                            <div className="support-text">
                              {row.source.ingredient_item_code || "No code"} ·{" "}
                              {row.source.unit_cost ? `${row.source.unit_cost} raw price` : "No raw price"} ·{" "}
                              {row.source.pack_size || row.importedIngredient.pack_size || "No pack size found"}
                            </div>
                            {row.source.description ? (
                              <div className="support-text">Description: {row.source.description}</div>
                            ) : null}
                          </div>
                          <div className="badge-row compact">
                            <Badge tone={confidenceTone}>
                              {row.matchConfidence === "manual"
                                ? "Manual match"
                                : row.matchConfidence === "none"
                                  ? "No match"
                                  : `${row.matchConfidence} confidence`}
                            </Badge>
                            <Badge tone="default">{row.sourceFormat === "raw-pricing" ? "Raw pricing" : "Normalized CSV"}</Badge>
                          </div>
                        </div>
                        <div className="support-stack">
                          <div className="support-text">{row.matchReason}</div>
                          <div className="ingredient-import-controls">
                            <label className="form-field">
                              <span>Import action</span>
                              <select
                                value={row.strategy}
                                onChange={(event) => setIngredientImportStrategy(row.id, event.target.value)}
                              >
                                <option value="merge">Merge into existing ingredient</option>
                                <option value="create">Create new ingredient</option>
                              </select>
                            </label>
                            <label className="form-field">
                              <span>Existing ingredient target</span>
                              <select
                                value={row.targetIngredientId}
                                disabled={row.strategy !== "merge"}
                                onChange={(event) => setIngredientImportTarget(row.id, event.target.value)}
                              >
                                <option value="">
                                  {row.strategy === "merge" ? "Choose an ingredient" : "Not needed for new rows"}
                                </option>
                                {ingredientImportTargetOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {row.strategy === "merge" && row.targetIngredientId ? (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  const targetIngredient = ingredientCatalog.find(
                                    (ingredient) => ingredient.id === row.targetIngredientId
                                  );
                                  if (targetIngredient) {
                                    openIngredientQuickPanel(targetIngredient);
                                  }
                                }}
                              >
                                Edit target
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => applySingleIngredientImportRow(row.id)}
                            >
                              <Icon name="save" />
                              Apply this row
                            </button>
                          </div>
                          <div className="ingredient-import-grid">
                            <label className="form-field">
                              <span>Ingredient name</span>
                              <input
                                value={row.draft.ingredient_name}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(row.id, "ingredient_name", event.target.value)
                                }
                              />
                            </label>
                            <label className="form-field">
                              <span>Item code</span>
                              <input
                                value={row.draft.ingredient_item_code}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(row.id, "ingredient_item_code", event.target.value)
                                }
                              />
                              {hasCodeConflict ? (
                                <div className="inline-actions">
                                  <span className="support-text error-text">
                                    This code already exists in the ingredient master.
                                  </span>
                                  <button
                                    type="button"
                                    className="secondary-button table-action-button"
                                    onClick={() => suggestIngredientImportCodeVariant(row.id)}
                                  >
                                    Suggest variant
                                  </button>
                                </div>
                              ) : null}
                            </label>
                            <label className="form-field">
                              <span>Unit price (net)</span>
                              <input
                                inputMode="decimal"
                                value={row.draft.unit_cost}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(row.id, "unit_cost", event.target.value)
                                }
                              />
                            </label>
                            <label className="form-field">
                              <span>Purchase VAT</span>
                              <select
                                value={String(row.draft.purchase_vat_rate ?? purchaseVatOptions[0])}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(
                                    row.id,
                                    "purchase_vat_rate",
                                    Number(event.target.value)
                                  )
                                }
                              >
                                {purchaseVatOptions.map((rate) => (
                                  <option key={`${row.id}-vat-${rate}`} value={String(rate)}>
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
                                  value={packParts.value}
                                  onChange={(event) =>
                                    updateIngredientImportDraftPackSize(row.id, "value", event.target.value)
                                  }
                                  placeholder="500"
                                />
                                <select
                                  className="table-input pack-size-unit"
                                  value={packParts.unit}
                                  onChange={(event) =>
                                    updateIngredientImportDraftPackSize(row.id, "unit", event.target.value)
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
                                value={row.draft.category}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(row.id, "category", event.target.value)
                                }
                              />
                            </label>
                            <label className="form-field">
                              <span>Supplier</span>
                              <input
                                value={row.draft.supplier}
                                onChange={(event) =>
                                  updateIngredientImportDraftField(row.id, "supplier", event.target.value)
                                }
                              />
                            </label>
                          </div>
                          {matchedOption ? (
                            <div className="support-text">Current target: {matchedOption.label}</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!activeIngredientDraft && ingredientUploadMessage ? (
              <p className="support-text success-text">{ingredientUploadMessage}</p>
            ) : null}
            {!activeIngredientDraft && ingredientUploadError ? (
              <p className="support-text error-text">{ingredientUploadError}</p>
            ) : null}
          </div>
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
                <select value={ingredientTypeFilter} onChange={(event) => setIngredientTypeFilter(event.target.value)}>
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
                  <option value="purchase-vat">Purchase VAT</option>
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
                  <col className="ingredient-col-delete" />
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
                    <th>Edit</th>
                    <th>{renderIngredientSortHeader("Type", "type")}</th>
                    <th>{renderIngredientSortHeader("Ingredient", "ingredient")}</th>
                    <th>{renderIngredientSortHeader("Code", "code")}</th>
                    <th>{renderIngredientSortHeader("Price (net)", "price")}</th>
                    <th>{renderIngredientSortHeader("Pack size", "pack-size")}</th>
                    <th>{renderIngredientSortHeader("Purchase VAT", "purchase-vat")}</th>
                    <th>{renderIngredientSortHeader("Category", "category")}</th>
                    <th>{renderIngredientSortHeader("Supplier", "supplier")}</th>
                    <th>{renderIngredientSortHeader("Updated", "updated")}</th>
                    <th>{renderIngredientSortHeader("Used", "used")}</th>
                    <th>{renderIngredientSortHeader("Recipe link", "recipe-entity")}</th>
                    <th>{renderIngredientSortHeader("Status", "status")}</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>{filteredIngredientCatalog.map(renderIngredientCatalogRow)}</tbody>
              </table>
            </div>
          ) : (
            <p className="support-text">Upload an ingredient master to review prices and codes in one place.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

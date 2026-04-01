import RecipeIngredientLookupField from "./RecipeIngredientLookupField";
import RecipeComponentCard from "./RecipeComponentCard";

export default function ExistingRecipeEditor({
  Card,
  Badge,
  Icon,
  DecimalInput,
  selectedRecipe,
  editWarning,
  importMessage,
  importError,
  setBuilderMode,
  setRecipeEditLookup,
  resetNewRecipeDraft,
  builderRecipeFilter,
  setBuilderRecipeFilter,
  builderBringBatchesForward,
  setBuilderBringBatchesForward,
  recipeLookupQuery,
  setRecipeLookupQuery,
  clearRecipeLookup,
  filteredRecipeEditOptions,
  recipeEditLookup,
  setSelectedRecipeId,
  money,
  numberValue,
  getBatchYieldLabel,
  getBatchUnitCost,
  selectedRecipeComponentCount,
  getRecipeVenueLabel,
  saveCurrentRecipeChanges,
  openRecipeCostSheetForRecipe,
  openChefSheetPreviewForRecipe,
  deleteRecipe,
  selectedRecipeLocked,
  updateRecipeField,
  selectedRecipeResolved,
  restaurantLiveRecipeIds,
  batchImpact,
  getFieldIssues,
  getMetaIssues,
  venues,
  selectedRecipeSecondaryVenues,
  setRecipeSecondaryVenues,
  getMethodSteps,
  updateMethodStep,
  removeMethodStep,
  addMethodStep,
  getChefPortionNote,
  handlePresentationImageUpload,
  addComponent,
  getComponentIssues,
  isParentLinkedComponent,
  findBatchRecipeMatch,
  normalizeCodeKey,
  jumpToLinkedBatchRecipe,
  jumpToIngredientRecord,
  removeComponent,
  activeLookup,
  setActiveLookup,
  getComponentFieldIssues,
  updateComponentField,
  ingredientSuggestions,
  applyIngredientMatch,
  ingredientExistsByNameOrCode,
  createIngredientFromRecipeBuilder,
  toTitleCaseWords,
  shouldAutoCostComponent,
  getComponentSourceRouteLabel,
  batchUsage,
}) {
  const buildRecipePillHandlers = (action, disabled = false) => {
    if (disabled) {
      return {
        onPointerDown: undefined,
        onClick: undefined,
      };
    }

    const runAction = (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };

    return {
      onPointerDown: runAction,
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
    };
  };

  return (
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
        {editWarning ? <p className="support-text error-text">{editWarning}</p> : null}

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
              <label className="filter-control recipe-picker-filter">
                <span className="filter-label">Recipe type</span>
                <select
                  value={builderRecipeFilter}
                  onChange={(event) => setBuilderRecipeFilter(event.target.value)}
                >
                  <option value="all">All recipe types</option>
                  <option value="dish">Dish recipes</option>
                  <option value="batch">Batch recipes</option>
                </select>
              </label>
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
            {recipeLookupQuery.trim() ? (
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
                        setRecipeLookupQuery("");
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
            ) : null}
          </details>

          <div className="builder-summary-banner">
            <div>
              <div className="mini-heading">Recipe cost</div>
              <strong>{money(selectedRecipe.recipeCost)}</strong>
            </div>
            <div>
              <div className="mini-heading">
                {selectedRecipe.recipeType === "batch" ? "Batch yield" : "Sale price (gross)"}
              </div>
              <strong>
                {selectedRecipe.recipeType === "batch"
                  ? `${numberValue(selectedRecipe.batchYield)} ${getBatchYieldLabel(selectedRecipe)}`
                  : money(selectedRecipe.currentSalePrice)}
              </strong>
            </div>
            <div>
              <div className="mini-heading">
                {selectedRecipe.recipeType === "batch" ? "Cost per yield unit" : "Roundup target (gross)"}
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
            <div className="recipe-pill-row">
              <button
                type="button"
                className={`recipe-pill ${selectedRecipe.isLive ? "active" : ""}`}
                disabled={selectedRecipe.recipeType === "batch" || selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "isLive", !selectedRecipe.isLive),
                  selectedRecipe.recipeType === "batch" || selectedRecipeLocked
                )}
              >
                {selectedRecipe.recipeType === "batch" ? "Batch recipes are not live dishes" : "Recipe live"}
              </button>
              <button
                type="button"
                className={`recipe-pill ${selectedRecipeLocked ? "active" : ""}`}
                {...buildRecipePillHandlers(() => updateRecipeField(selectedRecipe.id, "isLocked", !selectedRecipeLocked))}
              >
                {selectedRecipeLocked ? "Recipe locked" : "Lock recipe"}
              </button>
            </div>
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
          <div className={`editor-label ${getFieldIssues(selectedRecipe.validation, "restaurant").length ? "field-error" : ""}`}>
            <span>Venue</span>
            <div className="recipe-pill-row">
              <button
                type="button"
                className={`recipe-pill ${selectedRecipe.restaurant ? "" : "active"}`}
                disabled={selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "restaurant", ""),
                  selectedRecipeLocked
                )}
              >
                Blank
              </button>
              {venues.map((venue) => (
                <button
                  key={venue}
                  type="button"
                  className={`recipe-pill ${selectedRecipe.restaurant === venue ? "active" : ""}`}
                  disabled={selectedRecipeLocked}
                  {...buildRecipePillHandlers(
                    () => updateRecipeField(selectedRecipe.id, "restaurant", venue),
                    selectedRecipeLocked
                  )}
                >
                  {venue}
                </button>
              ))}
            </div>
            {getFieldIssues(selectedRecipe.validation, "restaurant").map((issue) => (
              <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
            ))}
          </div>
          {selectedRecipe.recipeType !== "batch" ? (
            <div className="editor-label span-2">
              <span>Also available in</span>
              <div className="recipe-pill-row">
                {venues
                  .filter((venue) => venue !== selectedRecipe.restaurant)
                  .map((venue) => (
                    <button
                      key={`${selectedRecipe.id}-secondary-${venue}`}
                      type="button"
                      className={`recipe-pill ${selectedRecipeSecondaryVenues.includes(venue) ? "active" : ""}`}
                      disabled={selectedRecipeLocked}
                      {...buildRecipePillHandlers(() => {
                        const existing = selectedRecipeSecondaryVenues || [];
                        const nextSecondary = existing.includes(venue)
                          ? existing.filter((item) => item !== venue)
                          : [...new Set([...existing, venue])];
                        setRecipeSecondaryVenues(selectedRecipe.id, selectedRecipe.restaurant, nextSecondary);
                      }, selectedRecipeLocked)}
                    >
                      {venue}
                    </button>
                  ))}
              </div>
            </div>
          ) : null}
          <div>
            <span>Recipe type</span>
            <div className="recipe-pill-row">
              <button
                type="button"
                className={`recipe-pill ${selectedRecipe.recipeType === "dish" ? "active" : ""}`}
                disabled={selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "recipeType", "dish"),
                  selectedRecipeLocked
                )}
              >
                Dish recipe
              </button>
              <button
                type="button"
                className={`recipe-pill ${selectedRecipe.recipeType === "batch" ? "active" : ""}`}
                disabled={selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "recipeType", "batch"),
                  selectedRecipeLocked
                )}
              >
                Batch recipe
              </button>
            </div>
          </div>
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
            <span>Sale price (gross)</span>
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
            <div className={`editor-label ${getFieldIssues(selectedRecipe.validation, "batchYieldType").length ? "field-error" : ""}`}>
              <span>Yield type</span>
              <div className="recipe-pill-row">
                {["portion", "g", "kg", "ml", "l", "tray", "bottle", "jar"].map((yieldType) => (
                  <button
                    key={yieldType}
                    type="button"
                    className={`recipe-pill ${selectedRecipe.batchYieldType === yieldType ? "active" : ""}`}
                    disabled={selectedRecipeLocked}
                    {...buildRecipePillHandlers(
                      () => updateRecipeField(selectedRecipe.id, "batchYieldType", yieldType),
                      selectedRecipeLocked
                    )}
                  >
                    {yieldType}
                  </button>
                ))}
              </div>
              {getFieldIssues(selectedRecipe.validation, "batchYieldType").map((issue) => (
                <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
              ))}
            </div>
          ) : null}
          <label>
            <span>Roundup target (gross)</span>
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
          <div className={`editor-label ${getMetaIssues(selectedRecipe.validation, "recipeComplete").length ? "field-error" : ""}`}>
            <span>Recipe complete</span>
            <div className="recipe-pill-row">
              <button
                type="button"
                className={`recipe-pill ${String(selectedRecipe.recipeComplete ?? "0") === "0" ? "active" : ""}`}
                disabled={selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "recipeComplete", "0"),
                  selectedRecipeLocked
                )}
              >
                Incomplete
              </button>
              <button
                type="button"
                className={`recipe-pill ${String(selectedRecipe.recipeComplete ?? "0") === "1" ? "active" : ""}`}
                disabled={selectedRecipeLocked}
                {...buildRecipePillHandlers(
                  () => updateRecipeField(selectedRecipe.id, "recipeComplete", "1"),
                  selectedRecipeLocked
                )}
              >
                Complete
              </button>
            </div>
            {getMetaIssues(selectedRecipe.validation, "recipeComplete").map((issue) => (
              <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
            ))}
          </div>
          {selectedRecipe.recipeType !== "batch" ? (
            <div className={`editor-label ${getMetaIssues(selectedRecipe.validation, "pricingComplete").length ? "field-error" : ""}`}>
              <span>Pricing complete</span>
              <div className="recipe-pill-row">
                <button
                  type="button"
                  className={`recipe-pill ${String(selectedRecipe.pricingComplete ?? "0") === "0" ? "active" : ""}`}
                  disabled={selectedRecipeLocked}
                  {...buildRecipePillHandlers(
                    () => updateRecipeField(selectedRecipe.id, "pricingComplete", "0"),
                    selectedRecipeLocked
                  )}
                >
                  Incomplete
                </button>
                <button
                  type="button"
                  className={`recipe-pill ${String(selectedRecipe.pricingComplete ?? "0") === "1" ? "active" : ""}`}
                  disabled={selectedRecipeLocked}
                  {...buildRecipePillHandlers(
                    () => updateRecipeField(selectedRecipe.id, "pricingComplete", "1"),
                    selectedRecipeLocked
                  )}
                >
                  Complete
                </button>
              </div>
              {getMetaIssues(selectedRecipe.validation, "pricingComplete").map((issue) => (
                <small key={issue.text} className="field-help field-help-warn">{issue.text}</small>
              ))}
            </div>
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
            const componentSourceManaged = isParentLinkedComponent(component);
            const componentReadOnly = selectedRecipeLocked || componentSourceManaged;
            const componentDeleteReadOnly = selectedRecipeLocked;
            const componentIngredientReadOnly = selectedRecipeLocked;
            const componentQtyReadOnly = selectedRecipeLocked;
            const matchedBatchSource = findBatchRecipeMatch(component);
            const hasOpenableBatchSource = Boolean(matchedBatchSource);
            return (
              <RecipeComponentCard
                key={component.id}
                componentId={component.id}
                className={componentIssues.length ? "component-card-error" : ""}
                badges={
                  <>
                    <Badge tone="default">#{component.sort}</Badge>
                    {component.sourceType === "batch" ? <Badge tone="good">Linked batch</Badge> : null}
                    {component.sourceType === "ingredient-master" ? <Badge tone="default">Linked ingredient</Badge> : null}
                    {isParentLinkedComponent(component) ? <Badge tone="default">Managed by parent batch</Badge> : null}
                    {normalizeCodeKey(component.code).startsWith("BCH") && !hasOpenableBatchSource ? (
                      <Badge tone="warn">Batch recipe not linked yet</Badge>
                    ) : null}
                  </>
                }
                actions={
                  <>
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
                      disabled={componentDeleteReadOnly}
                      onClick={() => removeComponent(selectedRecipe.id, component.id)}
                      aria-label="Remove component"
                    >
                      <Icon name="trash" />
                    </button>
                  </>
                }
              >
                <RecipeIngredientLookupField
                  value={component.ingredient}
                  disabled={componentIngredientReadOnly}
                  className={
                    getComponentFieldIssues(selectedRecipe.validation, component.id, "ingredient").length
                      ? "input-error"
                      : ""
                  }
                  onChange={(event) =>
                    updateComponentField(selectedRecipe.id, component.id, "ingredient", event.target.value)
                  }
                  onFocusField={() =>
                    !componentIngredientReadOnly &&
                    setActiveLookup({
                      recipeId: selectedRecipe.id,
                      componentId: component.id,
                    })
                  }
                  onBlurField={() => {
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
                  isActive={
                    activeLookup?.recipeId === selectedRecipe.id &&
                    activeLookup?.componentId === component.id
                  }
                  suggestions={ingredientSuggestions}
                  money={money}
                  onSelectSuggestion={(ingredient) =>
                    applyIngredientMatch(selectedRecipe.id, component.id, ingredient)
                  }
                  canCreateIngredient={
                    Boolean(component.ingredient?.trim()) &&
                    !ingredientExistsByNameOrCode(component.ingredient, component.code)
                  }
                  createLabel={toTitleCaseWords(component.ingredient)}
                  onCreateIngredient={() =>
                    createIngredientFromRecipeBuilder({
                      ingredientName: component.ingredient,
                      ingredientCode: component.code,
                      supplier: selectedRecipe.restaurant,
                      category: selectedRecipe.category,
                      recipeId: selectedRecipe.id,
                      recipeName: selectedRecipe.name,
                      componentId: component.id,
                    })
                  }
                />
                {getComponentFieldIssues(selectedRecipe.validation, component.id, "ingredient").map((issue) => (
                  <small key={issue.text} className="field-help field-help-error">{issue.text}</small>
                ))}
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
                  <DecimalInput
                    disabled={componentQtyReadOnly}
                    value={component.qty}
                    className={
                      getComponentFieldIssues(selectedRecipe.validation, component.id, "qty").length
                        ? "input-warn"
                        : ""
                    }
                    onCommit={(value) =>
                      updateComponentField(selectedRecipe.id, component.id, "qty", value)
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
                  {componentSourceManaged ? (
                    <>
                      <small className="field-help field-help-info">
                        The batch source is linked, but you can still change the ingredient and quantity used in this recipe here.
                      </small>
                      <small className="field-help field-help-info">
                        Use `Open batch recipe` to change the batch itself.
                      </small>
                    </>
                  ) : null}
                  {normalizeCodeKey(component.code).startsWith("BCH") && !hasOpenableBatchSource ? (
                    <small className="field-help field-help-warn">
                      This BCH code does not currently resolve to a batch recipe. Link or import the batch recipe first.
                    </small>
                  ) : null}
                </label>
              </RecipeComponentCard>
            );
          })}
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
    </div>
  );
}

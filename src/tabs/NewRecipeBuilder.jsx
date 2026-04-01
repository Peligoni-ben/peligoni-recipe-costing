import RecipeIngredientLookupField from "./RecipeIngredientLookupField";
import RecipeComponentCard from "./RecipeComponentCard";

export default function NewRecipeBuilder({
  Card,
  Badge,
  Icon,
  DecimalInput,
  newRecipeDraft,
  getNextBatchCode,
  setBuilderMode,
  money,
  newRecipeDraftCost,
  newRecipeDraftRoundupTarget,
  updateNewRecipeField,
  venues,
  toggleNewRecipeSecondaryVenue,
  numberValue,
  addNewDraftComponent,
  isParentLinkedComponent,
  removeNewDraftComponent,
  setActiveDraftLookupId,
  activeDraftLookupId,
  draftIngredientSuggestions,
  applyIngredientMatchToDraft,
  ingredientExistsByNameOrCode,
  createIngredientFromRecipeBuilder,
  toTitleCaseWords,
  shouldAutoCostComponent,
  updateNewComponentField,
  addNewMethodStep,
  updateNewMethodStep,
  removeNewMethodStep,
  resetNewRecipeDraft,
  saveNewRecipeDraft,
}) {
  return (
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
              <div className="mini-heading">Auto roundup target (gross)</div>
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
                <span>Sale price (gross)</span>
                <DecimalInput
                  value={newRecipeDraft.currentSalePrice}
                  onCommit={(value) => updateNewRecipeField("currentSalePrice", value)}
                />
              </label>
              <label className="form-field span-2">
                <span>Also available in</span>
                <div className="availability-checkboxes compact">
                  {venues
                    .filter((venue) => venue !== newRecipeDraft.restaurant)
                    .map((venue) => (
                      <label key={`draft-secondary-${venue}`} className="checkbox-field availability-checkbox">
                        <input
                          type="checkbox"
                          checked={(newRecipeDraft.secondaryVenues || []).includes(venue)}
                          onChange={(event) => toggleNewRecipeSecondaryVenue(venue, event.target.checked)}
                        />
                        <span>{venue}</span>
                      </label>
                    ))}
                </div>
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
            const componentSourceManaged = isParentLinkedComponent(component);
            const componentReadOnly = componentSourceManaged;
            const componentIngredientReadOnly = false;
            const componentQtyReadOnly = false;
            return (
              <RecipeComponentCard
                key={component.id}
                componentId={component.id}
                badges={
                  <>
                    <Badge tone="default">#{component.sort}</Badge>
                    {component.sourceType === "batch" ? <Badge tone="good">Linked batch</Badge> : null}
                    {component.sourceType === "ingredient-master" ? <Badge tone="default">Linked ingredient</Badge> : null}
                    {componentReadOnly ? <Badge tone="default">Managed by parent batch</Badge> : null}
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="icon-button"
                    disabled={componentReadOnly}
                    onClick={() => removeNewDraftComponent(component.id)}
                    aria-label="Remove component"
                  >
                    <Icon name="trash" />
                  </button>
                }
              >
                <RecipeIngredientLookupField
                  value={component.ingredient}
                  disabled={componentIngredientReadOnly}
                  onChange={(event) => updateNewComponentField(component.id, "ingredient", event.target.value)}
                  onFocusField={() => !componentIngredientReadOnly && setActiveDraftLookupId(component.id)}
                  onBlurField={() => {
                    window.setTimeout(() => {
                      setActiveDraftLookupId((current) => (current === component.id ? null : current));
                    }, 120);
                  }}
                  isActive={activeDraftLookupId === component.id}
                  suggestions={draftIngredientSuggestions}
                  money={money}
                  onSelectSuggestion={(ingredient) => applyIngredientMatchToDraft(component.id, ingredient)}
                  canCreateIngredient={
                    Boolean(component.ingredient?.trim()) &&
                    !ingredientExistsByNameOrCode(component.ingredient, component.code)
                  }
                  createLabel={toTitleCaseWords(component.ingredient)}
                  onCreateIngredient={() =>
                    createIngredientFromRecipeBuilder({
                      ingredientName: component.ingredient,
                      ingredientCode: component.code,
                      supplier: newRecipeDraft.restaurant,
                      category: newRecipeDraft.category,
                      draftComponentId: component.id,
                    })
                  }
                />
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
                  <DecimalInput
                    disabled={componentQtyReadOnly}
                    value={component.qty}
                    onCommit={(value) => updateNewComponentField(component.id, "qty", value)}
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
                  {componentSourceManaged ? (
                    <>
                      <small className="field-help">
                        The batch source is linked, but you can change the ingredient and quantity used in this recipe here.
                      </small>
                      <small className="field-help">
                        Edit the linked batch recipe only when you want to change the batch itself.
                      </small>
                    </>
                  ) : shouldAutoCostComponent(component) ? (
                    <small className="field-help field-help-info">
                      Editing cost manually will disconnect this row from auto-costing.
                    </small>
                  ) : null}
                </label>
              </RecipeComponentCard>
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
  );
}

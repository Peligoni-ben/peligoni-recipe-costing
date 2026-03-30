export default function RecipesTab({
  Card,
  Badge,
  Icon,
  recipeListTypeFilter,
  setRecipeListTypeFilter,
  importBundledBatchWorkbook,
  syncBchRecipeLinks,
  addRecipe,
  liveRecipeVenueSummary,
  reviewFilter,
  restaurant,
  setReviewFilter,
  setRestaurant,
  setSearch,
  reviewCounts,
  importMessage,
  importError,
  renderRecipeSortHeader,
  recipeListRows,
  renderRecipeListRow,
}) {
  return (
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
      {liveRecipeVenueSummary.length ? (
        <Card className="live-recipes-toggle-card">
          <div className="card-header">
            <div>
              <div className="eyebrow">Live recipes</div>
              <h2>Toggle by venue</h2>
            </div>
          </div>
          <div className="live-venue-toggle-row">
            <button
              type="button"
              className={`secondary-button ${reviewFilter === "live" && restaurant === "all" ? "toggle-button-active" : ""}`.trim()}
              onClick={() => {
                setReviewFilter("live");
                setRestaurant("all");
                setSearch("");
              }}
            >
              All live
              <Badge tone="good">{reviewCounts.live}</Badge>
            </button>
            {liveRecipeVenueSummary.map((item) => (
              <button
                key={item.venue}
                type="button"
                className={`secondary-button ${reviewFilter === "live" && restaurant === item.venue ? "toggle-button-active" : ""}`.trim()}
                onClick={() => {
                  setReviewFilter("live");
                  setRestaurant(item.venue);
                  setSearch("");
                }}
              >
                {item.venue}
                <Badge tone="good">{item.count}</Badge>
              </button>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setReviewFilter("all");
                setRestaurant("all");
              }}
            >
              Clear live filter
            </button>
          </div>
        </Card>
      ) : null}
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
              <tbody>{recipeListRows.map(renderRecipeListRow)}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

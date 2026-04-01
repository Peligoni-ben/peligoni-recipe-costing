export default function DishInventoryTab({
  Card,
  StatCard,
  Badge,
  dishInventoryRows,
  dishInventorySummary,
  dishInventorySearch,
  setDishInventorySearch,
  dishInventoryStatusFilter,
  setDishInventoryStatusFilter,
  openRecipeInBuilder,
  createRecipeFromDishIndex,
  openMenusForDishInventoryRow,
  unlinkDishIndexRecipe,
}) {
  return (
    <div className="tab-panel">
      <div className="stats-grid">
        <StatCard label="Inventory dishes" value={dishInventorySummary.total} onClick={() => setDishInventoryStatusFilter("all")} />
        <StatCard label="Recipe ready" value={dishInventorySummary.ready} tone={dishInventorySummary.ready ? "positive" : ""} onClick={() => setDishInventoryStatusFilter("ready")} />
        <StatCard label="No recipe yet" value={dishInventorySummary.missing} tone={dishInventorySummary.missing ? "negative" : ""} onClick={() => setDishInventoryStatusFilter("missing")} />
      </div>

      <Card>
        <div className="card-header">
          <div>
            <div className="eyebrow">Dish inventory</div>
            <h2>All candidate dishes for menus</h2>
          </div>
        </div>
        <div className="toolbar-row">
          <label className="form-field compact">
            <span>Status</span>
            <select value={dishInventoryStatusFilter} onChange={(event) => setDishInventoryStatusFilter(event.target.value)}>
              <option value="all">All dishes</option>
              <option value="ready">Recipe ready</option>
              <option value="missing">No recipe yet</option>
            </select>
          </label>
          <label className="form-field grow">
            <span>Search</span>
            <input
              value={dishInventorySearch}
              onChange={(event) => setDishInventorySearch(event.target.value)}
              placeholder="Search venue, service, course, dish or linked recipe"
            />
          </label>
        </div>
        <div className="table-wrap">
          <table className="dish-index-table">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Course</th>
                <th>Dish</th>
                <th>Status</th>
                <th>Recipe</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {dishInventoryRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.venue || "Blank"}</td>
                  <td>{row.course || "Uncategorised"}</td>
                  <td className="strong-cell">{row.dishName}</td>
                  <td>
                    <Badge tone={row.match.recipe ? "positive" : "warning"}>
                      {row.match.recipe ? "Recipe ready" : "No recipe yet"}
                    </Badge>
                  </td>
                  <td>{row.match.recipe ? row.match.recipe.name : "Not linked"}</td>
                  <td>
                    <div className="inline-actions">
                      {row.match.recipe ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button small"
                            onClick={() => openRecipeInBuilder(row.match.recipe.id)}
                          >
                            Open recipe
                          </button>
                          <button
                            type="button"
                            className="secondary-button small"
                            onClick={() => openMenusForDishInventoryRow(row)}
                          >
                            Open in menus
                          </button>
                          {row.match.recipe ? (
                            <button
                              type="button"
                              className="secondary-button small"
                              onClick={() => unlinkDishIndexRecipe(row.id)}
                            >
                              Unlink recipe
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <>
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
                            onClick={() => openMenusForDishInventoryRow(row)}
                          >
                            Open in menus
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!dishInventoryRows.length ? (
                <tr>
                  <td colSpan="6" className="empty-cell">No dish inventory rows match the current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

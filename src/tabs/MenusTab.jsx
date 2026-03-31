import { useMemo, useState } from "react";

export default function MenusTab({
  Card,
  StatCard,
  Badge,
  availabilitySearch,
  setAvailabilitySearch,
  recipes,
  availabilityVenueFilter,
  setAvailabilityVenueFilter,
  availabilityVenueSummary,
  availabilityRows,
  venues,
  venueOptions,
  toggleRecipeAvailableVenue,
  publishRecipeToVenueMenu,
  publishRecipeToVenueMenus,
  removeRecipeFromVenueMenus,
  isRecipeOnVenueMenu,
  menuCoursePresets,
  servicePeriodOptions,
  inferMenuCourseFromRecipe,
  activeVenueMenus,
  activeVenueMenuDishCount,
  menuLiveVenueFilter,
  setMenuLiveVenueFilter,
  activeVenueMenuSummary,
  filteredActiveVenueMenus,
  openMenuSheetPreview,
  money,
  percent,
  getMenuCourseGroups,
  menuDashboardSummary,
  menuDashboardVenue,
  menuDashboardService,
  setMenuDashboardService,
  dashboardServiceSummary,
  focusMenuDashboardVenue,
  dashboardInventoryRecipes,
  dashboardMenu,
  updateMenuField,
  publishRecipeToServiceMenu,
  publishRecipesToServiceMenus,
  removeRecipeFromServiceMenu,
  removeRecipesFromServiceMenus,
  createDraftRecipeFromDishInventory,
  openRecipeInBuilder,
  getMenuServicePeriod,
  focusMenuBuilder,
  updateMenuLine,
  saveMenuChanges,
  importMessage,
  importError,
}) {
  const [publishCourses, setPublishCourses] = useState({});
  const [availabilityQuickFilter, setAvailabilityQuickFilter] = useState("all");

  const rowCourseDefaults = useMemo(() => {
    const entries = availabilityRows.map((recipe) => [recipe.id, publishCourses[recipe.id] || inferMenuCourseFromRecipe(recipe)]);
    return Object.fromEntries(entries);
  }, [availabilityRows, inferMenuCourseFromRecipe, publishCourses]);

  const dashboardMenuRecipeIds = useMemo(
    () => new Set((dashboardMenu?.lines || []).map((line) => line.recipeId).filter(Boolean)),
    [dashboardMenu]
  );

  const availabilityQuickSummary = useMemo(() => {
    const counts = {
      all: availabilityRows.length,
      onMenu: 0,
      notOnMenu: 0,
      inventoryOnly: 0,
    };

    availabilityRows.forEach((row) => {
      const onMenu = row.rowSource !== "inventory" && dashboardMenuRecipeIds.has(row.id);
      if (row.rowSource === "inventory") {
        counts.inventoryOnly += 1;
      }
      if (onMenu) {
        counts.onMenu += 1;
      } else {
        counts.notOnMenu += 1;
      }
    });

    return counts;
  }, [availabilityRows, dashboardMenuRecipeIds]);

  const displayedAvailabilityRows = useMemo(() => {
    if (availabilityQuickFilter === "all") return availabilityRows;
    if (availabilityQuickFilter === "on-menu") {
      return availabilityRows.filter((row) => row.rowSource !== "inventory" && dashboardMenuRecipeIds.has(row.id));
    }
    if (availabilityQuickFilter === "not-on-menu") {
      return availabilityRows.filter((row) => row.rowSource === "inventory" || !dashboardMenuRecipeIds.has(row.id));
    }
    if (availabilityQuickFilter === "inventory-only") {
      return availabilityRows.filter((row) => row.rowSource === "inventory");
    }
    return availabilityRows;
  }, [availabilityQuickFilter, availabilityRows, dashboardMenuRecipeIds]);

  const isVenueWorkspace = availabilityVenueFilter !== "all";

  const focusVenueWorkspace = (venue) => {
    setAvailabilityVenueFilter(venue);
    focusMenuDashboardVenue(venue);
  };

  const renderAvailableVenueSummary = (recipe) => {
    const venues = recipe.availableVenues || [];
    if (!venues.length) {
      return <span className="support-text">No venues set</span>;
    }

    const visibleVenues = venues.slice(0, 2);
    const remainingCount = venues.length - visibleVenues.length;

    return (
      <div className="menus-venue-summary">
        <div className="badge-row compact">
          {visibleVenues.map((venue) => (
            <span key={`${recipe.id}-${venue}-summary`} className="badge">
              {venue}
            </span>
          ))}
          {remainingCount > 0 ? <span className="badge">+{remainingCount} more</span> : null}
        </div>
        {recipe.rowSource !== "inventory" ? (
          <details className="menus-venue-manage">
            <summary className="menus-venue-manage-summary">Manage</summary>
            <div className="availability-checkboxes compact">
              {venues
                .filter((venue) => venue !== "Batch" && venue !== "Blank")
                .map((venue) => {
                  const checked = recipe.availableVenues.includes(venue);
                  return (
                    <label key={`${recipe.id}-${venue}`} className="checkbox-field availability-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleRecipeAvailableVenue(recipe.id, venue, event.target.checked)}
                      />
                      <span>{venue}</span>
                    </label>
                  );
                })}
            </div>
          </details>
        ) : null}
      </div>
    );
  };

  const selectedMenuRestaurant =
    menuDashboardVenue !== "all" && menuDashboardService !== "all"
      ? dashboardMenu?.restaurant || `${menuDashboardVenue} ${menuDashboardService}`
      : "";
  const selectedServiceLabel =
    menuDashboardService !== "all" ? menuDashboardService : "Choose a service";

  return (
    <div className="tab-panel">
      <Card>
        <div className="card-header">
          <div>
            <div className="eyebrow">Menus workflow</div>
            <h2>Choose a venue, then choose a service menu</h2>
          </div>
        </div>
        <div className="stats-grid">
          {menuDashboardSummary.map((entry) => (
            <StatCard
              key={entry.venue}
              label={entry.venue}
              value={`${entry.inventoryCount} dishes · ${entry.liveCount} live`}
              tone={menuDashboardVenue === entry.venue ? "positive" : ""}
              onClick={() => focusVenueWorkspace(entry.venue)}
            />
          ))}
        </div>
        <p className="support-text">
          Menus now works one service at a time. Pick a venue first, then pick `Breakfast`, `Brunch`, `Lunch`,
          `Aperitivo`, `Dinner`, or `All day` for that venue.
        </p>
        {importMessage ? <p className="support-text success-text">{importMessage}</p> : null}
        {importError ? <p className="support-text error-text">{importError}</p> : null}
      </Card>

      {menuDashboardVenue !== "all" ? (
        <Card>
          <div className="card-header">
            <div>
              <div className="eyebrow">Menu dashboard</div>
              <h2>{menuDashboardVenue}</h2>
            </div>
            {dashboardMenu ? (
              <div className="badge-row compact">
                {dashboardMenu.isLiveMenu ? <Badge tone="good">Live menu</Badge> : <Badge tone="default">Draft menu</Badge>}
                <button type="button" className="secondary-button" onClick={() => focusMenuBuilder(dashboardMenu.id)}>
                  Edit this menu
                </button>
              </div>
            ) : null}
          </div>
          <div className="split-layout">
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Choose a menu</div>
                  <h2>{menuDashboardVenue} service menus</h2>
                  <p>Pick a service period, then publish dishes into that specific menu.</p>
                </div>
              </div>
              <div className="menu-service-picker">
                {dashboardServiceSummary.map((entry) => (
                  <button
                    key={`${menuDashboardVenue}-${entry.service}`}
                    type="button"
                    className={`menu-service-tab ${menuDashboardService === entry.service ? "active" : ""}`}
                    onClick={() => setMenuDashboardService(entry.service)}
                  >
                    <span className="menu-service-tab-label">{entry.service}</span>
                    <span className="menu-service-tab-meta">
                      {entry.menuCount} menu{entry.menuCount === 1 ? "" : "s"} · {entry.liveCount} live
                    </span>
                  </button>
                ))}
              </div>
              <div className="menu-service-summary">
                <Badge tone={dashboardMenu?.isLiveMenu ? "good" : "default"}>
                  {dashboardMenu ? `${getMenuServicePeriod(dashboardMenu.restaurant) || "Service"} selected` : "No menu selected"}
                </Badge>
                {selectedMenuRestaurant ? (
                  <Badge tone="default">Current target: {selectedMenuRestaurant}</Badge>
                ) : null}
                <span>
                  {dashboardInventoryRecipes.length} available dish{dashboardInventoryRecipes.length === 1 ? "" : "es"}
                </span>
              </div>
              <div className="badge-row compact">
                <button
                  type="button"
                  className={`secondary-button ${availabilityQuickFilter === "all" ? "toggle-button-active" : ""}`.trim()}
                  onClick={() => setAvailabilityQuickFilter("all")}
                >
                  All dishes
                  <Badge tone="default">{availabilityQuickSummary.all}</Badge>
                </button>
                <button
                  type="button"
                  className={`secondary-button ${availabilityQuickFilter === "on-menu" ? "toggle-button-active" : ""}`.trim()}
                  onClick={() => setAvailabilityQuickFilter("on-menu")}
                >
                  On this menu
                  <Badge tone="good">{availabilityQuickSummary.onMenu}</Badge>
                </button>
                <button
                  type="button"
                  className={`secondary-button ${availabilityQuickFilter === "not-on-menu" ? "toggle-button-active" : ""}`.trim()}
                  onClick={() => setAvailabilityQuickFilter("not-on-menu")}
                >
                  Still to add
                  <Badge tone="default">{availabilityQuickSummary.notOnMenu}</Badge>
                </button>
                <button
                  type="button"
                  className={`secondary-button ${availabilityQuickFilter === "inventory-only" ? "toggle-button-active" : ""}`.trim()}
                  onClick={() => setAvailabilityQuickFilter("inventory-only")}
                >
                  No recipe yet
                  <Badge tone="warn">{availabilityQuickSummary.inventoryOnly}</Badge>
                </button>
              </div>
              <p className="support-text">
                Use these to switch between the full service list, what is already on this menu, and what still needs publishing.
              </p>
              {dashboardMenu ? (
                <div className="support-stack">
                  <div className="usage-card">
                    <div className="usage-top">
                      <strong>Selected dishes</strong>
                      <Badge tone="default">
                        {dashboardMenu.lines.length} dish{dashboardMenu.lines.length === 1 ? "" : "es"}
                      </Badge>
                    </div>
                    {dashboardMenu.lines.length ? (
                      <div className="support-stack">
                        {dashboardMenu.lines.map((line) => (
                          <div key={`${dashboardMenu.id}-${line.id}-selected`} className="review-item">
                            <div>
                              <strong>{line.dishName}</strong>
                              <div className="support-text">
                                {line.courseLabel || "Unassigned"} · {money(line.lineSalePrice)} current ·{" "}
                                {line.recipe?.roundup ? money(line.recipe.roundup) : "N/A"} suggested
                              </div>
                            </div>
                            <div className="badge-row compact">
                              {line.recipeId ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => openRecipeInBuilder(line.recipeId)}
                                >
                                  Edit dish
                                </button>
                              ) : null}
                              {line.recipeId ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => removeRecipeFromServiceMenu({ id: line.recipeId, name: line.dishName }, dashboardMenu.restaurant)}
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="support-text">No dishes have been added to this menu yet.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </Card>

            <Card>
              {dashboardMenu ? (
                <>
                  <div className="card-header">
                    <div>
                      <div className="eyebrow">Current menu</div>
                      <h2>{dashboardMenu.name}</h2>
                      <p>{dashboardMenu.restaurant}</p>
                    </div>
                    <div className="badge-row compact">
                      <button
                        type="button"
                        className={`secondary-button ${dashboardMenu.isLiveMenu ? "" : "toggle-button-active"}`.trim()}
                        onClick={() => updateMenuField(dashboardMenu.id, "isLiveMenu", false)}
                      >
                        Draft menu
                      </button>
                      <button
                        type="button"
                        className={`secondary-button ${dashboardMenu.isLiveMenu ? "toggle-button-active" : ""}`.trim()}
                        onClick={() => updateMenuField(dashboardMenu.id, "isLiveMenu", true)}
                      >
                        Live menu
                      </button>
                      <button type="button" className="primary-button" onClick={() => saveMenuChanges(dashboardMenu)}>
                        Save menu
                      </button>
                      <button type="button" className="secondary-button" onClick={() => openMenuSheetPreview(dashboardMenu)}>
                        Open menu sheet
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openMenuSheetPreview(dashboardMenu, { print: true })}
                      >
                        Print menu sheet
                      </button>
                    </div>
                  </div>
                  <div className="stats-grid two-up">
                    <StatCard label="Available dishes" value={dashboardInventoryRecipes.length} />
                    <StatCard label="Menu dishes" value={dashboardMenu.lines.length} />
                    <StatCard label="Per guest cost" value={money(dashboardMenu.perGuestCost)} />
                    <StatCard label="Menu GP" value={percent(dashboardMenu.menuGp)} />
                  </div>
                  <div className="table-wrap compact-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Dish</th>
                          <th>Course</th>
                          <th>Current</th>
                          <th>Suggested</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardMenu.lines.map((line) => (
                          <tr key={`${dashboardMenu.id}-${line.id}-review`}>
                            <td>{line.dishName}</td>
                            <td>
                              <select
                                value={line.courseLabel || ""}
                                onChange={(event) =>
                                  updateMenuLine(dashboardMenu.id, line.id, "courseLabel", event.target.value)
                                }
                              >
                                <option value="">Unassigned</option>
                                {menuCoursePresets.map((course) => (
                                  <option key={`${line.id}-${course}`} value={course}>
                                    {course}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>{money(line.lineSalePrice)}</td>
                            <td>{line.recipe?.roundup ? money(line.recipe.roundup) : "N/A"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="support-stack">
                    {getMenuCourseGroups(dashboardMenu).map((group) => (
                      <div key={`${dashboardMenu.id}-${group.courseLabel}`} className="usage-card">
                        <div className="usage-top">
                          <strong>{group.courseLabel}</strong>
                          <Badge tone="default">{group.lines.length} dish{group.lines.length === 1 ? "" : "es"}</Badge>
                        </div>
                        <div className="table-wrap compact-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Dish</th>
                                <th>Cost</th>
                                <th>Current</th>
                                <th>Suggested</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.lines.map((line) => (
                                <tr key={line.id}>
                                  <td>{line.dishName}</td>
                                  <td>{money(line.lineCost)}</td>
                                  <td>{money(line.lineSalePrice)}</td>
                                  <td>{line.recipe?.roundup ? money(line.recipe.roundup) : "N/A"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="support-text">
                  No menu exists for this service yet. Add dishes from the list below and the app will create this
                  service menu automatically.
                </p>
              )}
            </Card>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="support-text">Choose one of the 7 venues above to start building or importing a service menu.</p>
        </Card>
      )}

      <Card>
        <div className="card-header">
          <div>
            <div className="eyebrow">Dish availability</div>
            <h2>{isVenueWorkspace ? `Build the ${menuDashboardService === "all" ? "selected" : menuDashboardService} menu for ${availabilityVenueFilter}` : "Select a venue first"}</h2>
          </div>
        </div>
        <div className="toolbar-row">
          <label className="form-field grow">
            <span>Search dishes</span>
            <input
              value={availabilitySearch}
              onChange={(event) => setAvailabilitySearch(event.target.value)}
              placeholder="Search dish, category, code or venue"
            />
          </label>
        </div>
        {isVenueWorkspace ? (
          <div className="menus-target-banner">
            <strong>Current target:</strong>{" "}
            {selectedMenuRestaurant || `${availabilityVenueFilter} · ${selectedServiceLabel}`}
            <span>
              Add dishes here first, then review course placement in the menu card above.
            </span>
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="dish-index-table menus-availability-table">
            <thead>
              <tr>
                <th>Dish</th>
                <th>Primary venue</th>
                <th>Category</th>
                <th>Code</th>
                <th>Available venues</th>
                <th>{isVenueWorkspace ? "Menu picker" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {displayedAvailabilityRows.map((recipe) => (
                <tr key={recipe.id}>
                  <td>{recipe.name}</td>
                  <td>{recipe.restaurant}</td>
                  <td>{recipe.category}</td>
                  <td>{recipe.sellingItemCode || (recipe.rowSource === "inventory" ? "Inventory only" : "—")}</td>
                  <td>{renderAvailableVenueSummary(recipe)}</td>
                  <td>
                    {isVenueWorkspace ? (
                      <div className="menus-publish-actions menus-publish-actions-compact">
                        {recipe.rowSource === "inventory" ? (
                          <>
                            <span className="menus-publish-status off-menu">No recipe yet</span>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={!selectedMenuRestaurant}
                              onClick={() =>
                                createDraftRecipeFromDishInventory(recipe.inventoryRow, {
                                  menuRestaurant: selectedMenuRestaurant,
                                  courseLabel: recipe.category || "",
                                })
                              }
                            >
                              Create draft and add
                            </button>
                          </>
                        ) : (
                          <>
                            {dashboardMenu?.restaurant && isRecipeOnVenueMenu(
                              recipe.id,
                              getMenuServicePeriod(dashboardMenu.restaurant) ? dashboardMenu.restaurant : availabilityVenueFilter
                            ) ? (
                              <>
                                <span className="menus-publish-status on-menu">On this menu</span>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={!selectedMenuRestaurant}
                                  onClick={() => removeRecipeFromServiceMenu(recipe, selectedMenuRestaurant)}
                                >
                                  Remove from menu
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="menus-publish-status off-menu">Not on this menu</span>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={!selectedMenuRestaurant}
                                  onClick={() =>
                                    publishRecipeToServiceMenu(
                                      recipe,
                                      selectedMenuRestaurant,
                                      rowCourseDefaults[recipe.id] || recipe.category || ""
                                    )
                                  }
                                >
                                  Add to menu
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => openRecipeInBuilder(recipe.id)}
                            >
                              Edit dish
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="support-text">Choose a venue above to work on a menu.</span>
                    )}
                  </td>
                </tr>
              ))}
              {!displayedAvailabilityRows.length ? (
                <tr>
                  <td colSpan={6} className="empty-state-cell">
                    No dishes match the current menu filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {activeVenueMenus.length ? (
        <Card>
          <div className="card-header">
            <div>
              <div className="eyebrow">Active menus</div>
              <h2>Current live menus in full</h2>
            </div>
          </div>
          <div className="stats-grid">
            <StatCard
              label="All live menus"
              value={`${activeVenueMenus.length} menus · ${activeVenueMenuDishCount} dishes`}
              tone={menuLiveVenueFilter === "all" ? "positive" : ""}
              onClick={() => setMenuLiveVenueFilter("all")}
            />
            {activeVenueMenuSummary.map((entry) => (
              <StatCard
                key={entry.venue}
                label={entry.venue}
                value={`${entry.menuCount} menus · ${entry.dishCount} dishes`}
                tone={menuLiveVenueFilter === entry.venue ? "positive" : ""}
                onClick={() => setMenuLiveVenueFilter(entry.venue)}
              />
            ))}
          </div>
          <div className="card-grid">
            {filteredActiveVenueMenus.map((menu) => (
              <Card key={`active-${menu.id}`}>
                <div className="card-header">
                  <div>
                    <div className="eyebrow">Live menu</div>
                    <h2>{menu.name}</h2>
                    <p>{menu.restaurant}</p>
                  </div>
                  <div className="badge-row compact">
                    <button type="button" className="secondary-button" onClick={() => openMenuSheetPreview(menu)}>
                      Open menu sheet
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openMenuSheetPreview(menu, { print: true })}
                    >
                      Print menu sheet
                    </button>
                  </div>
                </div>
                <div className="menu-stats">
                  <div>
                    <span>Per guest cost</span>
                    <strong>{money(menu.perGuestCost)}</strong>
                  </div>
                  <div>
                    <span>Per guest sell (gross)</span>
                    <strong>{money(menu.perGuestSell)}</strong>
                  </div>
                  <div>
                    <span>Target GP</span>
                    <strong>{percent(menu.targetGp)}</strong>
                  </div>
                  <div>
                    <span>Menu GP (net)</span>
                    <strong>{percent(menu.menuGp)}</strong>
                  </div>
                </div>
                <div className="support-stack">
                  {getMenuCourseGroups(menu).map((group) => (
                    <div key={`${menu.id}-${group.courseLabel}`} className="usage-card">
                      <div className="usage-top">
                        <strong>{group.courseLabel}</strong>
                        <Badge tone="default">{group.lines.length} dish{group.lines.length === 1 ? "" : "es"}</Badge>
                      </div>
                      <div className="table-wrap compact-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Dish</th>
                              <th>Cost</th>
                              <th>Current</th>
                              <th>Suggested</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.map((line) => (
                              <tr key={line.id}>
                                <td>{line.dishName}</td>
                                <td>{money(line.lineCost)}</td>
                                <td>{money(line.lineSalePrice)}</td>
                                <td>{line.recipe?.roundup ? money(line.recipe.roundup) : "N/A"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          {!filteredActiveVenueMenus.length ? (
            <p className="support-text">No live menus are currently shown for that venue filter.</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

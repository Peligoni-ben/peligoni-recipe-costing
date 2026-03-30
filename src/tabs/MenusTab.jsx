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
  venueOptions,
  toggleRecipeAvailableVenue,
  publishRecipeToVenueMenu,
  publishRecipeToVenueMenus,
  removeRecipeFromVenueMenus,
  isRecipeOnVenueMenu,
  menuCoursePresets,
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
  publishRecipeToServiceMenu,
  publishRecipesToServiceMenus,
  removeRecipeFromServiceMenu,
  removeRecipesFromServiceMenus,
  getMenuServicePeriod,
  focusMenuBuilder,
  updateMenuLine,
  importMessage,
  importError,
}) {
  const [publishCourses, setPublishCourses] = useState({});
  const [publishTargets, setPublishTargets] = useState({});
  const [selectedRecipeIds, setSelectedRecipeIds] = useState([]);
  const [bulkVenueTargets, setBulkVenueTargets] = useState([]);
  const [bulkServicePeriod, setBulkServicePeriod] = useState("lunch");

  const rowCourseDefaults = useMemo(() => {
    const entries = availabilityRows.map((recipe) => [recipe.id, publishCourses[recipe.id] || inferMenuCourseFromRecipe(recipe)]);
    return Object.fromEntries(entries);
  }, [availabilityRows, inferMenuCourseFromRecipe, publishCourses]);

  const isVenueWorkspace = availabilityVenueFilter !== "all";

  const focusVenueWorkspace = (venue) => {
    setAvailabilityVenueFilter(venue);
    focusMenuDashboardVenue(venue);
  };

  const clearVenueWorkspace = () => {
    setAvailabilityVenueFilter("all");
    focusMenuDashboardVenue("all");
  };

  const getSelectedTargets = (recipe) =>
    publishTargets[recipe.id]?.length
      ? publishTargets[recipe.id]
      : isVenueWorkspace && recipe.availableVenues.includes(availabilityVenueFilter)
        ? [availabilityVenueFilter]
        : [];

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
        <details className="menus-venue-manage">
          <summary className="menus-venue-manage-summary">Manage</summary>
          <div className="availability-checkboxes compact">
            {venueOptions
              .filter((venue) => venue !== "Batch" && venue !== "Blank")
              .map((venue) => {
                const checked = venues.includes(venue);
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
      </div>
    );
  };

  const selectedRecipes = useMemo(
    () => availabilityRows.filter((recipe) => selectedRecipeIds.includes(recipe.id)),
    [availabilityRows, selectedRecipeIds]
  );

  const allVisibleRecipeIds = useMemo(() => availabilityRows.map((recipe) => recipe.id), [availabilityRows]);
  const availableBulkVenues = useMemo(
    () => venueOptions.filter((venue) => venue !== "Batch" && venue !== "Blank"),
    [venueOptions]
  );
  const allVisibleSelected =
    Boolean(allVisibleRecipeIds.length) && allVisibleRecipeIds.every((recipeId) => selectedRecipeIds.includes(recipeId));
  const someVisibleSelected = allVisibleRecipeIds.some((recipeId) => selectedRecipeIds.includes(recipeId));

  const toggleSelectedRecipe = (recipeId, checked) => {
    setSelectedRecipeIds((current) =>
      checked ? [...new Set([...current, recipeId])] : current.filter((id) => id !== recipeId)
    );
  };

  const toggleSelectAllVisible = (checked) => {
    setSelectedRecipeIds((current) =>
      checked
        ? [...new Set([...current, ...allVisibleRecipeIds])]
        : current.filter((id) => !allVisibleRecipeIds.includes(id))
    );
  };

  const toggleBulkVenueTarget = (venue, checked) => {
    setBulkVenueTargets((current) =>
      checked ? [...new Set([...current, venue])] : current.filter((item) => item !== venue)
    );
  };

  return (
    <div className="tab-panel">
      <Card>
        <div className="card-header">
          <div>
            <div className="eyebrow">Venue workspace</div>
            <h2>Pick a venue, publish dishes, and review the live menu</h2>
          </div>
        </div>
        <div className="stats-grid">
          <StatCard
            label="All venues"
            value={menuDashboardSummary.length}
            tone={menuDashboardVenue === "all" ? "positive" : ""}
            onClick={clearVenueWorkspace}
          />
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
          Pick a venue first for the cleanest flow. In venue view, you can quickly add or remove dishes from that
          venue's live menu. Switch back to `All venues` only when you want bulk planning.
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
                <button
                  type="button"
                  className={`menu-service-tab ${menuDashboardService === "all" ? "active" : ""}`}
                  onClick={() => setMenuDashboardService("all")}
                >
                  <span className="menu-service-tab-label">All menus</span>
                  <span className="menu-service-tab-meta">
                    {dashboardServiceSummary.reduce((sum, entry) => sum + entry.menuCount, 0)} menus
                  </span>
                </button>
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
                  {dashboardMenu ? `${getMenuServicePeriod(dashboardMenu.restaurant) || "General"} selected` : "No menu selected"}
                </Badge>
                <span>
                  {dashboardInventoryRecipes.length} available dish{dashboardInventoryRecipes.length === 1 ? "" : "es"}
                </span>
              </div>
              <div className="badge-row">
                {dashboardInventoryRecipes.slice(0, 24).map((recipe) => (
                  <span key={recipe.id} className="badge">
                    {recipe.name}
                  </span>
                ))}
              </div>
              {dashboardInventoryRecipes.length > 24 ? (
                <p className="support-text">
                  Plus {dashboardInventoryRecipes.length - 24} more available dish
                  {dashboardInventoryRecipes.length - 24 === 1 ? "" : "es"}.
                </p>
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
                <p className="support-text">No menu exists for this venue yet. Use `Add menu` below to start building one.</p>
              )}
            </Card>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="card-header">
          <div>
            <div className="eyebrow">Dish availability</div>
            <h2>{isVenueWorkspace ? `Publish dishes for ${availabilityVenueFilter}` : "Master dish list and bulk publishing"}</h2>
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
        {!isVenueWorkspace ? (
          <p className="support-text">
            Select dishes from the master list, choose venue targets and a service once, then publish or remove them in bulk.
          </p>
        ) : (
          <p className="support-text">
            This is now focused on one venue. Choose a course, then add or remove dishes from that venue's menu.
          </p>
        )}
        {!isVenueWorkspace ? (
          <div className="menus-master-bulk">
            <div className="menus-master-bulk-summary">
              <Badge tone={selectedRecipes.length ? "good" : "default"}>{selectedRecipes.length} selected</Badge>
              <span>
                {bulkVenueTargets.length} venue target{bulkVenueTargets.length === 1 ? "" : "s"} · {bulkServicePeriod}
              </span>
            </div>
            <div className="menus-master-bulk-grid">
              <div className="menus-publish-targets">
                {availableBulkVenues.map((venue) => (
                  <label key={`bulk-${venue}`} className="checkbox-field availability-checkbox">
                    <input
                      type="checkbox"
                      checked={bulkVenueTargets.includes(venue)}
                      onChange={(event) => toggleBulkVenueTarget(venue, event.target.checked)}
                    />
                    <span>{venue}</span>
                  </label>
                ))}
              </div>
              <label className="form-field compact">
                <span>Service</span>
                <select value={bulkServicePeriod} onChange={(event) => setBulkServicePeriod(event.target.value)}>
                  {["breakfast", "lunch", "aperitivo", "dinner", "all day"].map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedRecipes.length || !bulkVenueTargets.length}
                  onClick={() => publishRecipesToServiceMenus(selectedRecipes, bulkVenueTargets, bulkServicePeriod)}
                >
                  Add selected dishes
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedRecipes.length || !bulkVenueTargets.length}
                  onClick={() => removeRecipesFromServiceMenus(selectedRecipes, bulkVenueTargets, bulkServicePeriod)}
                >
                  Remove selected dishes
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="dish-index-table menus-availability-table">
            <thead>
              <tr>
                {!isVenueWorkspace ? (
                  <th>
                    <label className="checkbox-field availability-checkbox compact-checkbox">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = !allVisibleSelected && someVisibleSelected;
                        }}
                        onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                      />
                    </label>
                  </th>
                ) : null}
                <th>Dish</th>
                <th>Primary venue</th>
                <th>Category</th>
                <th>Code</th>
                <th>Available venues</th>
                <th>{isVenueWorkspace ? "Menu action" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {availabilityRows.map((recipe) => (
                <tr key={recipe.id}>
                  {!isVenueWorkspace ? (
                    <td>
                      <label className="checkbox-field availability-checkbox compact-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedRecipeIds.includes(recipe.id)}
                          onChange={(event) => toggleSelectedRecipe(recipe.id, event.target.checked)}
                        />
                      </label>
                    </td>
                  ) : null}
                  <td>{recipe.name}</td>
                  <td>{recipe.restaurant}</td>
                  <td>{recipe.category}</td>
                  <td>{recipe.sellingItemCode || "—"}</td>
                  <td>{renderAvailableVenueSummary(recipe)}</td>
                  <td>
                    {isVenueWorkspace ? (
                      <div className="menus-publish-actions menus-publish-actions-compact">
                        <span
                          className={`menus-publish-status ${
                            dashboardMenu?.restaurant && isRecipeOnVenueMenu(recipe.id, getMenuServicePeriod(dashboardMenu.restaurant) ? dashboardMenu.restaurant : availabilityVenueFilter)
                              ? "on-menu"
                              : "off-menu"
                          }`}
                        >
                          {dashboardMenu?.restaurant && isRecipeOnVenueMenu(recipe.id, getMenuServicePeriod(dashboardMenu.restaurant) ? dashboardMenu.restaurant : availabilityVenueFilter)
                            ? "On menu"
                            : "Not on menu"}
                        </span>
                        <select
                          value={rowCourseDefaults[recipe.id] || ""}
                          onChange={(event) =>
                            setPublishCourses((current) => ({ ...current, [recipe.id]: event.target.value }))
                          }
                        >
                          {menuCoursePresets.map((course) => (
                            <option key={course} value={course}>
                              {course}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!dashboardMenu?.restaurant}
                          onClick={() =>
                            publishRecipeToServiceMenu(
                              recipe,
                              dashboardMenu?.restaurant,
                              rowCourseDefaults[recipe.id] || ""
                            )
                          }
                        >
                          Add to menu
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!dashboardMenu?.restaurant}
                          onClick={() => removeRecipeFromServiceMenu(recipe, dashboardMenu?.restaurant)}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <details className="menus-bulk-card">
                        <summary className="menus-bulk-summary">Bulk publish</summary>
                        <div className="menus-publish-actions">
                          <div className="menus-publish-targets">
                            {recipe.availableVenues.map((venue) => {
                              const selectedTargets = getSelectedTargets(recipe);
                              const checked = selectedTargets.includes(venue);
                              const onMenu = isRecipeOnVenueMenu(recipe.id, venue);
                              return (
                                <label key={`${recipe.id}-publish-${venue}`} className="checkbox-field availability-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) =>
                                      setPublishTargets((current) => {
                                        const baseTargets = getSelectedTargets(recipe);
                                        const nextTargets = event.target.checked
                                          ? [...new Set([...baseTargets, venue])]
                                          : baseTargets.filter((item) => item !== venue);
                                        return { ...current, [recipe.id]: nextTargets };
                                      })
                                    }
                                  />
                                  <span>{venue}</span>
                                  <span className={`menus-publish-status ${onMenu ? "on-menu" : "off-menu"}`}>
                                    {onMenu ? "On menu" : "Not on menu"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <select
                            value={rowCourseDefaults[recipe.id] || ""}
                            onChange={(event) =>
                              setPublishCourses((current) => ({ ...current, [recipe.id]: event.target.value }))
                            }
                          >
                            {menuCoursePresets.map((course) => (
                              <option key={course} value={course}>
                                {course}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!getSelectedTargets(recipe).length}
                            onClick={() =>
                              publishRecipeToVenueMenus(
                                recipe,
                                getSelectedTargets(recipe),
                                rowCourseDefaults[recipe.id] || ""
                              )
                            }
                          >
                            Add to selected menus
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!getSelectedTargets(recipe).length}
                            onClick={() => removeRecipeFromVenueMenus(recipe, getSelectedTargets(recipe))}
                          >
                            Remove from selected menus
                          </button>
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
              {!availabilityRows.length ? (
                <tr>
                  <td colSpan={isVenueWorkspace ? 6 : 7} className="empty-state-cell">
                    No dishes match the current venue filter.
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
                    <span>Per guest sell</span>
                    <strong>{money(menu.perGuestSell)}</strong>
                  </div>
                  <div>
                    <span>Target GP</span>
                    <strong>{percent(menu.targetGp)}</strong>
                  </div>
                  <div>
                    <span>Menu GP</span>
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

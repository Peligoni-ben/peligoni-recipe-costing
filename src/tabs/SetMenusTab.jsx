export default function SetMenusTab({
  Card,
  StatCard,
  Badge,
  Icon,
  menuBuilderRef,
  addMenu,
  selectedMenu,
  saveMenuChanges,
  openMenuSheetPreview,
  setSelectedMenuId,
  menuDashboardVenue,
  menuCards,
  dashboardVenueMenus,
  updateMenuField,
  venueOptions,
  numberValue,
  MENU_COURSE_PRESETS,
  addMenuLine,
  removeMenuLine,
  updateMenuLine,
  recipes,
  getAvailableVenueListForRecipe,
  recipeAvailableVenues,
  getBaseVenueName,
  money,
  percent,
  getMenuCourseGroups,
}) {
  return (
    <div className="tab-panel">
      <div className="split-layout" ref={menuBuilderRef}>
        <Card>
          <div className="card-header">
            <div>
              <div className="eyebrow">Set menu builder</div>
              <h2>Build sample menus and spend-per-head checks</h2>
            </div>
            <button type="button" className="primary-button" onClick={addMenu}>
              <Icon name="plus" />
              Add menu
            </button>
          </div>

          {selectedMenu ? (
            <div className="support-stack">
              <div className="upload-actions">
                <button type="button" className="primary-button" onClick={saveMenuChanges}>
                  Save menu changes
                </button>
                <button type="button" className="secondary-button" onClick={() => openMenuSheetPreview(selectedMenu)}>
                  Open menu sheet
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openMenuSheetPreview(selectedMenu, { print: true })}
                >
                  Print menu sheet
                </button>
              </div>
              <label className="form-field">
                <span>Selected menu</span>
                <select value={selectedMenu.id} onChange={(event) => setSelectedMenuId(event.target.value)}>
                  {(menuDashboardVenue === "all" ? menuCards : dashboardVenueMenus).map((menu) => (
                    <option key={menu.id} value={menu.id}>
                      {menu.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-grid">
                <label>
                  <span>Menu name</span>
                  <input value={selectedMenu.name} onChange={(event) => updateMenuField(selectedMenu.id, "name", event.target.value)} />
                </label>
                <label>
                  <span>Venue</span>
                  <select
                    value={selectedMenu.restaurant}
                    onChange={(event) => updateMenuField(selectedMenu.id, "restaurant", event.target.value)}
                  >
                    {venueOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Guest count</span>
                  <input
                    value={selectedMenu.guestCount}
                    onChange={(event) => updateMenuField(selectedMenu.id, "guestCount", numberValue(event.target.value))}
                  />
                </label>
                <label>
                  <span>Target GP</span>
                  <input
                    value={selectedMenu.targetGp}
                    onChange={(event) => updateMenuField(selectedMenu.id, "targetGp", numberValue(event.target.value))}
                  />
                </label>
              </div>

              <div className="section-row">
                <div>
                  <div className="eyebrow">Menu lines</div>
                  <h3>{selectedMenu.lines.length} selected dishes for one sample guest journey</h3>
                </div>
                <div className="badge-row compact">
                  {MENU_COURSE_PRESETS.map((course) => (
                    <button key={course} type="button" className="secondary-button" onClick={() => addMenuLine(course)}>
                      <Icon name="plus" />
                      {course}
                    </button>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => addMenuLine("")}>
                    <Icon name="plus" />
                    Custom
                  </button>
                </div>
              </div>

              <div className="component-stack">
                {selectedMenu.lines.map((line, index) => (
                  <div key={line.id} className="component-card menu-line-card">
                    <div className="component-meta">
                      <Badge tone="default">#{index + 1}</Badge>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => removeMenuLine(selectedMenu.id, line.id)}
                        aria-label="Remove menu line"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                    <label>
                      <span>Course</span>
                      <input
                        value={line.courseLabel}
                        onChange={(event) => updateMenuLine(selectedMenu.id, line.id, "courseLabel", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Recipe</span>
                      <select
                        value={line.recipeId}
                        onChange={(event) => updateMenuLine(selectedMenu.id, line.id, "recipeId", event.target.value)}
                      >
                        {recipes
                          .filter(
                            (recipe) =>
                              recipe.recipeType !== "batch" &&
                              getAvailableVenueListForRecipe(recipe, recipeAvailableVenues).some(
                                (venue) => getBaseVenueName(venue) === getBaseVenueName(selectedMenu.restaurant)
                              )
                          )
                          .map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      <span>Dish</span>
                      <input value={line.dishName} readOnly />
                    </label>
                    <label>
                      <span>Cost</span>
                      <input value={money(line.lineCost)} readOnly />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="support-text">Create a sample menu to start modelling a guest journey and per-head cost.</p>
          )}
        </Card>

        <div className="builder-side">
          {selectedMenu ? (
            <Card>
              <div className="card-header">
                <div>
                  <div className="eyebrow">Sample menu summary</div>
                  <h2>{selectedMenu.name}</h2>
                  <p>{selectedMenu.restaurant} · {selectedMenu.guestCount} guests</p>
                </div>
                <div className="badge-row compact">
                  <Badge tone={selectedMenu.menuGp >= selectedMenu.targetGp ? "good" : "warn"}>
                    Target {percent(selectedMenu.targetGp)}
                  </Badge>
                </div>
              </div>
              <div className="stats-grid two-up">
                <StatCard label="Per guest cost" value={money(selectedMenu.perGuestCost)} />
                <StatCard label="Per guest sell (gross)" value={money(selectedMenu.perGuestSell)} />
                <StatCard label="Total food cost" value={money(selectedMenu.totalFoodCost)} />
                <StatCard label="Menu GP (net)" value={percent(selectedMenu.menuGp)} />
              </div>
              <div className="support-stack">
                {getMenuCourseGroups(selectedMenu).map((group) => (
                  <div key={`${selectedMenu.id}-${group.courseLabel}`} className="usage-card">
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
                            <th>Sale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.lines.map((line) => (
                            <tr key={line.id}>
                              <td>{line.dishName}</td>
                              <td>{money(line.lineCost)}</td>
                              <td>{money(line.lineSalePrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="card-header">
              <div>
                <div className="eyebrow">Scenario library</div>
                <h2>Saved sample menus</h2>
              </div>
            </div>
            <div className="support-stack">
              {menuCards.map((menu) => (
                <button
                  key={menu.id}
                  type="button"
                  className={`review-item ${selectedMenu?.id === menu.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedMenuId(menu.id)}
                >
                  <div>
                    <strong>{menu.name}</strong>
                    <div className="support-text">{menu.restaurant} · {menu.guestCount} guests</div>
                  </div>
                  <div className="badge-row compact">
                    <Badge tone={menu.menuGp >= menu.targetGp ? "good" : "warn"}>{money(menu.perGuestCost)} / guest</Badge>
                    <Badge tone="default">{percent(menu.menuGp)}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

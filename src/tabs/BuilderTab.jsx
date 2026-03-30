export default function BuilderTab({
  builderMode,
  setBuilderMode,
  resetNewRecipeDraft,
  newRecipeDraft,
  children,
}) {
  return (
    <div className="tab-panel">
      <div className="builder-mode-bar">
        <button
          type="button"
          className={`tab-button ${builderMode === "edit" ? "active" : ""}`}
          onClick={() => setBuilderMode("edit")}
        >
          Edit existing
        </button>
        <button
          type="button"
          className={`tab-button ${builderMode === "create" ? "active" : ""}`}
          onClick={() => {
            setBuilderMode("create");
            resetNewRecipeDraft(newRecipeDraft.recipeType || "dish");
          }}
        >
          Create new
        </button>
      </div>
      {children}
    </div>
  );
}

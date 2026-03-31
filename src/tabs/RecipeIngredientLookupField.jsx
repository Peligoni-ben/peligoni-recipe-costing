export default function RecipeIngredientLookupField({
  value,
  disabled,
  className = "",
  onChange,
  onFocusField,
  onBlurField,
  placeholder = "Ingredient",
  isActive,
  suggestions,
  money,
  onSelectSuggestion,
  canCreateIngredient,
  createLabel,
  onCreateIngredient,
}) {
  return (
    <label className="recipe-ingredient-lookup-field">
      <span>Ingredient</span>
      <input
        disabled={disabled}
        value={value}
        className={className}
        onChange={onChange}
        onFocus={onFocusField}
        onBlur={onBlurField}
        placeholder={placeholder}
      />
      {isActive && !disabled ? (
        <div className="lookup-panel">
          {suggestions.length ? (
            suggestions.map((ingredient) => (
              <button
                key={ingredient.id}
                type="button"
                className="lookup-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectSuggestion(ingredient);
                }}
              >
                <div className="lookup-main">
                  <strong>{ingredient.ingredient_name}</strong>
                  <span>{ingredient.ingredient_item_code}</span>
                </div>
                <div className="lookup-meta">
                  <span>{money(ingredient.unit_cost)}</span>
                  <span>
                    {ingredient.sourceType === "batch"
                      ? `${ingredient.category} · ${ingredient.pack_size || "Batch"}`
                      : ingredient.supplier || ingredient.category || "Ingredient master"}
                  </span>
                </div>
              </button>
            ))
          ) : value?.trim() ? (
            <div className="support-stack">
              <div className="presentation-placeholder">No matching ingredients found.</div>
            </div>
          ) : null}
          {canCreateIngredient ? (
            <button
              type="button"
              className="lookup-option lookup-option-create"
              onMouseDown={(event) => {
                event.preventDefault();
                onCreateIngredient();
              }}
            >
              <div className="lookup-main">
                <strong>Add ingredient</strong>
                <span>{createLabel}</span>
              </div>
            </button>
          ) : null}
        </div>
      ) : null}
    </label>
  );
}

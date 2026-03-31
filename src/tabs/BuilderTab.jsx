import { useState } from "react";

export default function BuilderTab({
  Card,
  builderMode,
  setBuilderMode,
  resetNewRecipeDraft,
  newRecipeDraft,
  recipePasteText,
  setRecipePasteText,
  structuredRecipeName,
  setStructuredRecipeName,
  structuredRecipePortions,
  setStructuredRecipePortions,
  structuredRecipeIngredients,
  setStructuredRecipeIngredients,
  structuredRecipeMethod,
  setStructuredRecipeMethod,
  recipePasteMessage,
  recipePasteError,
  importPastedRecipeText,
  importStructuredRecipeText,
  children,
}) {
  const [showRecipePasteTool, setShowRecipePasteTool] = useState(false);
  const [recipeIntakeMode, setRecipeIntakeMode] = useState("smart");

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
        <button
          type="button"
          className={`tab-button ${showRecipePasteTool ? "active" : ""}`}
          onClick={() => {
            setShowRecipePasteTool((current) => !current);
            setBuilderMode("create");
          }}
        >
          Insert dish
        </button>
      </div>
      {showRecipePasteTool ? (
        <Card>
          <div className="card-header">
            <div>
              <div className="eyebrow">Recipe intake</div>
              <h2>Paste a recipe to format it</h2>
            </div>
          </div>
          <div className="recipe-paste-card">
            <div className="builder-mode-bar compact">
              <button
                type="button"
                className={`tab-button ${recipeIntakeMode === "smart" ? "active" : ""}`}
                onClick={() => setRecipeIntakeMode("smart")}
              >
                Smart paste
              </button>
              <button
                type="button"
                className={`tab-button ${recipeIntakeMode === "structured" ? "active" : ""}`}
                onClick={() => setRecipeIntakeMode("structured")}
              >
                Structured paste
              </button>
            </div>
            {recipeIntakeMode === "smart" ? (
              <>
                <p className="support-text">
                  Paste recipe text from an email, notes app, or website. I’ll try to turn it into a draft with the
                  name, ingredient lines, and method steps prefilled.
                </p>
                <label className="editor-label">
                  <span>Recipe text</span>
                  <textarea
                    className="recipe-paste-input"
                    value={recipePasteText}
                    onChange={(event) => setRecipePasteText(event.target.value)}
                    placeholder={`Greek Salad\n\nIngredients\n2 tomatoes\n1 cucumber\n100g feta\n2 tbsp olive oil\n\nMethod\n1. Chop the vegetables.\n2. Dress and serve.`}
                  />
                </label>
                <div className="toolbar">
                  <button type="button" className="primary-button" onClick={importPastedRecipeText}>
                    Create draft from pasted recipe
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="support-text">
                  Use this when the copied recipe is messy. Paste each part into the right box and I’ll build the draft
                  cleanly.
                </p>
                <div className="form-grid">
                  <label>
                    <span>Dish name</span>
                    <input
                      value={structuredRecipeName}
                      onChange={(event) => setStructuredRecipeName(event.target.value)}
                      placeholder="Greek Brioche French Toast"
                    />
                  </label>
                  <label>
                    <span>Portions</span>
                    <input
                      value={structuredRecipePortions}
                      onChange={(event) => setStructuredRecipePortions(event.target.value)}
                      placeholder="2"
                    />
                  </label>
                  <label className="editor-label span-2">
                    <span>Ingredients</span>
                    <textarea
                      className="recipe-paste-input"
                      value={structuredRecipeIngredients}
                      onChange={(event) => setStructuredRecipeIngredients(event.target.value)}
                      placeholder={`4 slices of greek brioche\n2 eggs\n125ml milk\n1 tsp vanilla extract`}
                    />
                  </label>
                  <label className="editor-label span-2">
                    <span>Method</span>
                    <textarea
                      className="recipe-paste-input"
                      value={structuredRecipeMethod}
                      onChange={(event) => setStructuredRecipeMethod(event.target.value)}
                      placeholder={`Whisk together the eggs, milk, vanilla, cinnamon and salt.\nHeat the pan.\nCook the brioche until golden.`}
                    />
                  </label>
                </div>
                <div className="toolbar">
                  <button type="button" className="primary-button" onClick={importStructuredRecipeText}>
                    Create draft from structured paste
                  </button>
                </div>
              </>
            )}
            {recipePasteMessage ? <p className="support-text success-text">{recipePasteMessage}</p> : null}
            {recipePasteError ? <p className="support-text error-text">{recipePasteError}</p> : null}
          </div>
        </Card>
      ) : null}
      {children}
    </div>
  );
}

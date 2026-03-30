export default function RecipeComponentCard({
  componentId,
  className = "",
  badges,
  actions,
  children,
}) {
  return (
    <div key={componentId} className={`component-card ${className}`.trim()}>
      <div className="component-meta">
        <div className="badge-row compact">{badges}</div>
        <div className="component-actions">{actions}</div>
      </div>
      {children}
    </div>
  );
}

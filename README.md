# Peligoni Recipe Costing App

Browser-based recipe costing and operations tool for:

- ingredients as the pricing source of truth
- batch recipes as prep/component recipes
- dish recipes as final menu outputs
- venue dish indexing and review workflows

## Current app areas

- `Queue`
  - recipes needing review
  - ingredients needing attention
  - dish matches to resolve
  - BCH audit access
- `Recipes`
  - recipe library
  - recipe/batch filtering
  - lock and delete controls
- `Builder`
  - create and edit dish recipes
  - create and edit batch recipes
  - linked ingredient and BCH component costing
  - chef sheet and cost sheet export
- `Set menus`
  - menu builder and summary calculations
- `Ingredients`
  - ingredient builder
  - ingredient catalogue
  - lock/delete/edit flow
  - batch-to-recipe linkage review
- `Imports`
  - normalized recipe imports
  - SOFT1 sheet imports
  - batch workbook import
  - venue dish workbook import

## Project structure

- `src/App.jsx`
  - main app logic and UI
- `src/styles.css`
  - layout and component styling
- `src/imports/`
  - modular import formats and parsers
- `src/data/workbook-data.json`
  - workbook-backed seed data
- `scripts/extract_workbook.py`
  - extracts workbook tabs into app data
- `public/batchs.xlsx`
  - bundled batch workbook used by the in-app re-import button

## Local run

1. Regenerate workbook data if needed:

```bash
python3 scripts/extract_workbook.py
```

2. Install dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm run dev
```

4. Build production output:

```bash
npm run build
```

## Testing notes

This is currently a frontend-only test build.

- app data is stored in the browser
- testers do not share one central live dataset
- this is suitable for workflow and UX testing
- this is not yet suitable for shared operational editing without a backend

## Recommended tester flows

1. Open `Queue`
   - work through recipes needing review
   - work through ingredients needing attention
   - check unresolved dish matches
2. Open `Ingredients`
   - verify price edits
   - verify pack size edits
   - verify lock/delete behavior
3. Open `Builder`
   - test ingredient lookup
   - test BCH drill-down
   - test batch editing
   - test recipe exports
4. Open `Recipes`
   - test sorting and filtering
   - open a recipe into the builder
5. Open `Imports`
   - test recipe import preview
   - test batch workbook re-import
   - test venue dish workbook import

## Deployment for testers

This app is a standard Vite static app, so the easiest deployment options are:

- Vercel
- Netlify

Use these settings:

- build command: `npm run build`
- publish directory: `dist`

### Suggested deployment steps

1. Push this project to GitHub.
2. Create a new Vercel or Netlify project from that repo.
3. Set:
   - framework: `Vite`
   - build command: `npm run build`
   - output directory: `dist`
4. Deploy.
5. Share the generated URL with testers.

## Pre-launch checklist

- run `npm run build`
- confirm `Queue` loads cleanly
- confirm `Ingredients` search and edit flow works
- confirm at least one batch recipe pulls ingredient costs through
- confirm at least one dish recipe pulls BCH batch costs through
- confirm recipe export preview opens
- confirm `Re-import batch workbook` works from `Recipes`
- confirm venue dish workbook import lands in the dish matcher

## Known limitations

- browser-local persistence only
- no shared database
- no authentication
- no permissions model
- no audit trail beyond current local state

## Next likely phase

To move from testing to real team use, the next architectural step is:

- shared backend/database
- user login
- central file/image storage
- shared recipe, ingredient, batch, and menu records

# Recipe Import Layer

## Goal

Support importing updated recipes from alternate files stored in Google Drive and map them into the normalized workbook shape:

- `Recipes`
- `Recipe_Components`

## Where configuration lives

- Example config: `/Users/benshearer/Desktop/Recipe app/config/google-drive-import.config.example.json`
- Local runtime config: `/Users/benshearer/Desktop/Recipe app/config/google-drive-import.config.json`

The folder config should store:

- Google Drive folder id
- label
- enabled flag
- default restaurant
- `source_format`
- file match patterns
- notes

OAuth credentials should not live in this file.

## Supported starting formats

### `normalized-workbook-pair`

- Files: `recipes.csv`, `recipe_components.csv`
- Best when upstream can already export separate recipe and component tables

### `flat-component-export`

- File: `recipes_flat.csv`
- Each row includes recipe metadata plus one ingredient/component row

### `json-recipe-bundle`

- File: `recipes.json`
- Each recipe contains a nested `components` array

### `soft1-recipe-sheet`

- File: `soft1_recipe.csv`
- A single recipe sheet with preamble rows, then a header:
  `SOFT1 CODE, INGREDIENT, QTY, UNIT, METHOD`
- The recipe title is taken from the first non-empty row above the header
- Ingredient rows normalize into `Recipe_Components`

### `batch-workbook-wide`

- File: `batchs.xlsx`
- A wide Excel workbook with one batch recipe per row
- Batch header fields include:
  `Name`, `batch item code`, `COST per kilo`, `Total cooked/prepped weight (gr)`, `Recipe complete`
- Repeated component groups are read across the row and normalized into `Recipe_Components`
- Imported recipes are marked as `batch` recipes in the app, with batch yield defaulting to grams

## Modular design

- `src/imports/contracts.js`
  - normalized output contracts for `Recipes` and `Recipe_Components`
- `src/imports/formats.js`
  - format registry, expected columns, and per-format normalize functions
- `src/imports/index.js`
  - importer entry points for the rest of the app
- `src/imports/googleDriveConfig.js`
  - canonical config location metadata

## Next implementation step

Connect a Google Drive file listing layer to folder config entries, detect the configured source format, and feed parsed file payloads into `normalizeImportedRecipeSource`.

## Current Google Sheets support

- Public Google Sheets tab URLs can be pasted directly into the app for CSV-based formats.
- The app converts a sheet URL into a CSV export URL and imports it through the same parser/normalizer used by local files.
- This currently works for:
  - `flat-component-export`
  - `normalized-workbook-pair`
- The `.xlsx` batch workbook format is currently local-upload only.
- Private Google Drive folders still need authenticated Drive access, which should come next as a transport layer on top of the same normalization pipeline.

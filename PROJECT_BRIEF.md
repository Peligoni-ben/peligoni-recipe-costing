# Recipe Costing App Project Brief

## Goal
Build a lightweight internal recipe costing app for restaurant and event menu costing.

## Source of truth
The source workbook is:
- recipes_for_pos_normalized_verified.xlsx

This workbook uses the normalized structure:
- Recipes
- Recipe_Components
- Menus
- Menu_Lines
- Venue_Summary
- Validation

## Current data model

### Recipes
Columns:
- recipe_id
- restaurant
- name
- category
- selling_item_code
- current_sale_price
- roundup
- net_price
- gross_price
- pos_ytd
- recipe_complete
- pricing_complete

### Recipe_Components
Columns:
- recipe_id
- component_sort
- ingredient_name
- ingredient_item_code
- quantity_grams
- component_cost

### Menus
Columns:
- menu_id
- menu_name
- restaurant
- guest_count
- target_gp

### Menu_Lines
Columns:
- menu_id
- recipe_id

## Build order
1. Read and validate workbook tabs
2. Create app data-loading layer
3. Build recipe list view
4. Build recipe detail / costing view
5. Build menu summary view
6. Add ingredient lookup from uploaded ingredient price file
7. Add recipe import from alternate recipe files
8. Add Google Drive folder import for updated recipes

## Key feature requirements
- Show all recipes from workbook
- Show components linked to each recipe
- Calculate recipe cost from component rows
- Calculate GP from current sale price and recipe cost
- Show menu-level per-guest cost and event-level total food cost
- Allow ingredient lookup so typing “chicken breast” can suggest and fill ingredient code and current cost
- Support ingredient price uploads from accounting / stock software
- Support updated recipe imports from alternate formats stored in Google Drive

## Product rules
- The original wide “Recipes for POS” workbook is the raw source archive
- The normalized verified workbook is the clean app-ready source
- The app should be built around the normalized workbook, not the original wide format

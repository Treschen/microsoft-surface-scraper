# Microsoft Surface Live Scraper

This scraper logs into the Surface Reseller Program, crawls the live shop/product pages, extracts one row per variant SKU, calculates a selling price, and optionally posts batches to n8n.

## What it does
- Reuses Shopify auth state from `.auth/state.json`
- Starts at `/pages/shop`
- Collects product URLs and optionally follows collection pages
- Opens each product page
- Enumerates all variants on the page
- Visits each variant URL (`?variant=<id>`) to read the live price / stock signal
- Emits one item per SKU
- Optionally POSTs to the same Surface webhook in n8n

## Outputs
- `/app/out/surface-live.csv`
- `/app/out/surface-live.json`

## One-time auth capture
```bash
npm install
npx playwright install
node auth-capture.mjs
```

## Run locally
```bash
node surface-crawl-products.mjs
```

## Notes
- Matching in Shopify should stay SKU only
- This scraper does not create products
- It only sends live price / stock rows

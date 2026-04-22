import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import pLimit from "p-limit";

import { loginIfNeeded } from "./lib/login.mjs";
import { getProductUrls } from "./lib/pagination.mjs";
import { extractSurfaceVariants } from "./lib/extract-surface-variants.mjs";
import { buildLivePayloadItem, buildCsv, chunk } from "./lib/build-payload.mjs";
import { postJsonWithRetry } from "./lib/fetch-retry.mjs";

const {
  SUPPLIER_BASE = "https://surfaceresellerprogram.co.za",
  SHOP_URL = "https://surfaceresellerprogram.co.za/pages/shop",
  SCRAPE_MODE = "auto",
  TARGET_PRODUCT_URLS = "",
  AUTH_STATE_PATH = "/app/.auth/state.json",
  OUTPUT_DIR = "/app/out",
  OUTPUT_CSV = "surface-live.csv",
  OUTPUT_JSON = "surface-live.json",
  SEND_TO_N8N = "false",
  N8N_WEBHOOK_URL = "",
  BATCH_SIZE = "50",
  CONCURRENCY = "4",
  MAX_PRODUCTS = "200",
  FOLLOW_COLLECTIONS = "true",
  COLLECTION_PAGES_LIMIT = "10",
  TARGET_NET_PROFIT = "1500",
  VAT_RATE = "0.15",
  PAYFAST_PERCENT = "0.0368",
  PAYFAST_FIXED = "2.30",
  ROUND_TO_NEAREST = "100"
} = process.env;

function parseTargetUrls(raw) {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
}

const batchSize = Math.max(1, parseInt(BATCH_SIZE, 10) || 50);
const concurrency = Math.max(1, parseInt(CONCURRENCY, 10) || 4);
const maxProducts = Math.max(1, parseInt(MAX_PRODUCTS, 10) || 200);
const collectionPagesLimit = Math.max(1, parseInt(COLLECTION_PAGES_LIMIT, 10) || 10);

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"]
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined,
    locale: "en-ZA",
    timezoneId: "Africa/Johannesburg"
  });

  const page = await context.newPage();

  await loginIfNeeded(page, {
    base: SUPPLIER_BASE,
    authStatePath: AUTH_STATE_PATH
  });

  let productUrls = [];

  if (SCRAPE_MODE === "target_urls") {
    productUrls = parseTargetUrls(TARGET_PRODUCT_URLS);
    console.log(`[mode] Using explicit target URLs: ${productUrls.length}`);
  } else {
    productUrls = await getProductUrls(page, {
      shopUrl: SHOP_URL,
      followCollections: FOLLOW_COLLECTIONS === "true",
      collectionPagesLimit,
      maxProducts
    });
    console.log(`[mode] Using auto discovery`);
  }

  console.log(`[crawl] product urls: ${productUrls.length}`);

  const limit = pLimit(concurrency);
  const allVariants = [];
  const seenSkus = new Set();

  await Promise.all(
    productUrls.map((productUrl, idx) =>
      limit(async () => {
        const p = await context.newPage();
        try {
          console.log(`[crawl] ${idx + 1}/${productUrls.length} ${productUrl}`);
          const variants = await extractSurfaceVariants(p, productUrl);

          for (const variant of variants) {
            if (!variant?.sku) continue;
            if (seenSkus.has(variant.sku)) continue;
            seenSkus.add(variant.sku);

            const payloadItem = buildLivePayloadItem(variant, {
              targetNetProfit: Number(TARGET_NET_PROFIT),
              vatRate: Number(VAT_RATE),
              payfastPercent: Number(PAYFAST_PERCENT),
              payfastFixed: Number(PAYFAST_FIXED),
              roundToNearest: Number(ROUND_TO_NEAREST)
            });

            allVariants.push(payloadItem);
          }
        } catch (e) {
          console.error(`[crawl] failed ${productUrl}:`, e?.message || e);
        } finally {
          await p.close().catch(() => {});
        }
      })
    )
  );

  const csvPath = path.join(OUTPUT_DIR, OUTPUT_CSV);
  fs.writeFileSync(csvPath, buildCsv(allVariants), "utf8");

  const jsonPath = path.join(OUTPUT_DIR, OUTPUT_JSON);
  fs.writeFileSync(jsonPath, JSON.stringify({ items: allVariants }, null, 2));

  console.log(`[out] variants extracted: ${allVariants.length}`);

  await browser.close();
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(2);
});
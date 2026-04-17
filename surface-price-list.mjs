import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import XLSX from "xlsx";

import { loginIfNeeded } from "./lib/login.mjs";
import { fetchWithRetry } from "./lib/fetch-retry.mjs";
import { cleanText, parsePrice, parseStock, toMoneyString, csvEscape } from "./lib/normalize.mjs";

const {
  SUPPLIER_BASE = "https://surfaceresellerprogram.co.za",
  DEALER_EMAIL = "",
  DEALER_PASSWORD = "",
  AUTH_STATE_PATH = "/app/.auth/state.json",
  RESELLER_TOOLS_URL = "https://surfaceresellerprogram.co.za/pages/ms-reseller-tools",
  PRICE_LIST_URL = "",
  LOCAL_XLSX_PATH = "",
  OUTPUT_DIR = "/app/out",
  OUTPUT_XLSX = "surface-pricelist-latest.xlsx",
  OUTPUT_CSV = "surface-pricelist.csv",
  SHEET_NAME = "Price List and Stock on Hand"
} = process.env;

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let workbookPath = LOCAL_XLSX_PATH;

  if (!workbookPath) {
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"]
    });

    const context = await browser.newContext({
      storageState: fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined,
      locale: "en-ZA",
      timezoneId: "Africa/Johannesburg",
      acceptDownloads: true
    });

    const page = await context.newPage();
    await loginIfNeeded(page, {
      base: SUPPLIER_BASE,
      email: DEALER_EMAIL,
      password: DEALER_PASSWORD,
      authStatePath: AUTH_STATE_PATH
    });

    const downloadUrl = PRICE_LIST_URL || await discoverPriceListUrl(page);
    if (!downloadUrl) throw new Error("Could not find reseller price list download link.");

    console.log("[price-list] download URL:", downloadUrl);
    workbookPath = path.join(OUTPUT_DIR, OUTPUT_XLSX);
    await downloadFile(downloadUrl, workbookPath, page);

    await browser.close();
  }

  console.log("[price-list] workbook path:", workbookPath);
  const result = parseWorkbook(workbookPath, SHEET_NAME);

  const csvPath = path.join(OUTPUT_DIR, OUTPUT_CSV);
  fs.writeFileSync(csvPath, buildCsv(result.rows), "utf8");

  const metaPath = path.join(OUTPUT_DIR, "surface-pricelist-meta.json");
  fs.writeFileSync(metaPath, JSON.stringify({
    extractedAt: new Date().toISOString(),
    sourceWorkbook: workbookPath,
    sourceSheet: result.sheetName,
    effectiveDate: result.effectiveDate,
    rowCount: result.rows.length,
    categoriesSeen: [...new Set(result.rows.map((r) => r.category).filter(Boolean))]
  }, null, 2));

  console.log(`[price-list] rows extracted: ${result.rows.length}`);
  console.log(`[price-list] effective date: ${result.effectiveDate || "unknown"}`);
  console.log(`[price-list] csv written: ${csvPath}`);
  console.log(`[price-list] meta written: ${metaPath}`);
}

async function discoverPriceListUrl(page) {
  await page.goto(RESELLER_TOOLS_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const href = await page.locator('a:has-text("Click To Download")').first().getAttribute("href").catch(() => null);
  if (!href) return null;
  return new URL(href, page.url()).href;
}

async function downloadFile(url, outPath, page) {
  const cookieHeader = await buildCookieHeader(page.context(), url);
  const res = await fetchWithRetry(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : {}
  }, { retries: 5, baseDelayMs: 700 });

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function buildCookieHeader(context, url) {
  const cookies = await context.cookies(url).catch(() => []);
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function parseWorkbook(workbookPath, preferredSheetName) {
  const wb = XLSX.readFile(workbookPath);
  const sheetName = wb.SheetNames.includes(preferredSheetName) ? preferredSheetName : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  let headerRowIndex = -1;
  let effectiveDate = "";
  let currentSection = "";
  let currentCategory = "";
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map((v) => cleanText(v));
    if (!effectiveDate && /effective\s+from/i.test(row[0] || "")) {
      effectiveDate = row[0].replace(/^.*effective\s+from\s*/i, "").trim();
    }

    if (headerRowIndex === -1) {
      const signature = row.join("|").toUpperCase();
      if (signature.includes("SKU") && signature.includes("DESCRIPTION") && signature.includes("PRICE EX VAT") && signature.includes("STOCK ON HAND")) {
        headerRowIndex = i;
      }
      continue;
    }

    if (!row.some(Boolean)) continue;

    const [sku, description, price, stock] = row;

    if (sku && !description && !price && !stock) {
      if (/^\d+\s*-\s*/.test(sku)) {
        currentSection = sku;
      } else {
        currentCategory = sku;
      }
      continue;
    }

    if (!sku || !description) continue;
    if (!/^[A-Z0-9][A-Z0-9-]+$/i.test(sku)) continue;

    out.push({
      sku,
      title: description,
      cost_ex_vat: toMoneyString(parsePrice(price)),
      stock_on_hand: parseStock(stock),
      currency: "ZAR",
      section: currentSection,
      category: currentCategory,
      source_sheet: sheetName,
      effective_date: effectiveDate
    });
  }

  return { sheetName, effectiveDate, rows: out };
}

function buildCsv(rows) {
  const headers = [
    "sku",
    "title",
    "cost_ex_vat",
    "stock_on_hand",
    "currency",
    "section",
    "category",
    "source_sheet",
    "effective_date"
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(2);
});

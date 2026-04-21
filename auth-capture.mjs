import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.SUPPLIER_BASE || "https://surfaceresellerprogram.co.za";
const OUT_DIR = process.env.AUTH_OUT_DIR || ".auth";
const OUT_FILE = process.env.AUTH_FILE || "state.json";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-ZA",
    timezoneId: "Africa/Johannesburg",
  });

  const page = await context.newPage();
  const loginUrl = `${BASE.replace(/\/+$/, "")}/account/login`;
  const accountUrl = `${BASE.replace(/\/+$/, "")}/account`;

  console.log("[auth] open:", loginUrl);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

  console.log("[auth] Login manually in the opened browser.");
  console.log("[auth] When you are fully logged in, press ENTER here.");

  await waitForEnter();

  await page.goto(accountUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const url = page.url();
  console.log("[auth] now at:", url);

  if (url.includes("/account/login")) {
    throw new Error("Not logged in yet; still on /account/login");
  }

  const outPath = path.join(OUT_DIR, OUT_FILE);
  await context.storageState({ path: outPath });
  console.log("[auth] saved:", outPath);

  await browser.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
  });
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(2);
});

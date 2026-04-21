import fs from "node:fs";

export async function loginIfNeeded(page, {
  base,
  authStatePath = "/app/.auth/state.json"
} = {}) {
  const baseUrl = String(base || "").replace(/\/+$/, "");
  const accountUrl = `${baseUrl}/account`;

  const hasLogoutMarker = async () =>
    page.locator('a[href*="/account/logout"]').first().isVisible().catch(() => false);

  const probeAccount = async () => {
    await page.goto(accountUrl, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const url = page.url();
    const ok = (url.includes("/account") && !url.includes("/account/login")) || (await hasLogoutMarker());
    return { ok, url };
  };

  if (fs.existsSync(authStatePath)) {
    const probe = await probeAccount();
    if (probe.ok) {
      console.log("[login] storageState session valid:", probe.url);
      return;
    }
    throw new Error(`[login] storageState exists but session invalid/expired: ${probe.url}`);
  }

  throw new Error("[login] No auth state found. Run auth-capture.mjs first.");
}

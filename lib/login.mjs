import fs from "node:fs";

export async function loginIfNeeded(page, {
  base,
  email,
  password,
  authStatePath = "/app/.auth/state.json"
} = {}) {
  const baseUrl = String(base || "").replace(/\/+$/, "");
  const loginUrl = `${baseUrl}/account/login`;
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
    console.log("[login] storageState exists but session invalid/expired:", probe.url);
  }

  if (!email || !password) {
    console.log("[login] no credentials supplied. Expecting storageState/manual auth.");
    return;
  }

  console.log("[login] attempting form login...");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const form = page.locator('form[action*="/account/login"], form[action="/account/login"]').first();
  const emailInput = form.locator('input[name="customer[email]"], #CustomerEmail, #customer_email, input[type="email"]').first();
  const passInput = form.locator('input[name="customer[password]"], #CustomerPassword, #customer_password, input[type="password"]').first();

  if (!(await emailInput.isVisible().catch(() => false)) || !(await passInput.isVisible().catch(() => false))) {
    throw new Error("Could not find login form fields.");
  }

  await emailInput.fill(email, { timeout: 15000 });
  await passInput.fill(password, { timeout: 15000 });

  const submitBtn = form.locator('button[type="submit"], input[type="submit"], button[name="commit"]').first();
  await submitBtn.click({ timeout: 15000 }).catch(async () => {
    await passInput.press("Enter").catch(() => {});
  });

  await page.waitForLoadState("networkidle").catch(() => {});
  const probe = await probeAccount();
  if (!probe.ok) {
    throw new Error(`Login failed. URL after submit: ${probe.url}`);
  }

  await page.context().storageState({ path: authStatePath }).catch(() => {});
  console.log(`[login] saved storageState to ${authStatePath}`);
}

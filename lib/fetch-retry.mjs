import fetch from "node-fetch";

export async function fetchWithRetry(url, options = {}, { retries = 4, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

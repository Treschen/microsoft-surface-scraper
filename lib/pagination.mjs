function isProductUrl(url) {
  try {
    const u = new URL(url);
    return /^\/products\/[^/?#]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

function isCollectionUrl(url) {
  try {
    const u = new URL(url);
    return /^\/collections\/[^/?#]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function collectLinks(page) {
  const origin = new URL(page.url()).origin;
  return await page.evaluate((pageOrigin) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map((a) => {
        try {
          return new URL(a.getAttribute('href'), pageOrigin).href;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }, origin).catch(() => []);
}

async function getCollectionProductUrls(page, collectionUrl, pagesLimit = 10) {
  const out = new Set();
  let current = collectionUrl;
  let seenPages = 0;

  while (current && seenPages < pagesLimit) {
    seenPages++;
    await page.goto(current, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    const links = await collectLinks(page);

    for (const link of links) {
      if (isProductUrl(link)) out.add(link.split('?')[0]);
    }

    const next = await page.evaluate(() => {
      const absHref = (el) => {
        try { return new URL((el.getAttribute('href') || '').trim(), location.origin).href; }
        catch { return null; }
      };

      const relNext = document.querySelector('a[rel="next"]');
      if (relNext) return absHref(relNext);

      const nextText = Array.from(document.querySelectorAll('a,button'))
        .find(el => /next/i.test(el.textContent || ''));
      if (nextText && nextText.tagName === 'A') return absHref(nextText);

      return null;
    }).catch(() => null);

    current = next;
  }

  return Array.from(out);
}

export async function getProductUrls(page, {
  shopUrl,
  followCollections = true,
  collectionPagesLimit = 10,
  maxProducts = 200
} = {}) {
  await page.goto(shopUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});

  const shopLinks = await collectLinks(page);
  const products = new Set();
  const collections = new Set();

  for (const link of shopLinks) {
    if (isProductUrl(link)) products.add(link.split('?')[0]);
    else if (followCollections && isCollectionUrl(link)) collections.add(link.split('?')[0]);
  }

  if (followCollections) {
    for (const collectionUrl of collections) {
      const urls = await getCollectionProductUrls(page, collectionUrl, collectionPagesLimit);
      for (const url of urls) products.add(url);
      if (products.size >= maxProducts) break;
    }
  }

  return Array.from(products).slice(0, maxProducts);
}

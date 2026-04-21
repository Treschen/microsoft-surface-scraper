import { cleanText, parsePrice, canonicalHandle } from './normalize.mjs';

async function fetchProductJson(page, productUrl) {
  const handle = canonicalHandle(productUrl);
  if (!handle) return null;
  const u = new URL(productUrl);
  const endpoint = `${u.origin}/products/${handle}.js`;

  return await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }, endpoint).catch(() => null);
}

async function getVariantDomState(page) {
  const bodyText = cleanText(await page.locator('body').textContent().catch(() => ''));
  const skuText = cleanText(await page.locator('text=/SKU\s*:/i').first().textContent().catch(() => ''));
  const skuMatch = skuText.match(/SKU\s*:\s*([A-Z0-9-]+)/i) || bodyText.match(/SKU\s*:\s*([A-Z0-9-]+)/i);

  const stockText = cleanText(
    await page.locator('text=/in stock|sold out|unavailable/i').first().textContent().catch(() => '')
  );
  const stockMatch = stockText.match(/(\d+)\s+in stock/i);
  const bodyStockMatch = bodyText.match(/(\d+)\s+in stock/i);

  const priceText =
    cleanText(await page.locator('[itemprop="price"]').first().getAttribute('content').catch(() => '')) ||
    cleanText(await page.locator('meta[itemprop="price"]').first().getAttribute('content').catch(() => '')) ||
    cleanText(await page.locator('.price, [data-product-price], .price__regular, .price-item').first().textContent().catch(() => ''));

  const soldOut = /sold out|unavailable/i.test(`${stockText} ${bodyText}`);
  const exactStock = stockMatch ? Number(stockMatch[1]) : bodyStockMatch ? Number(bodyStockMatch[1]) : null;

  const inventoryQuantityFromScripts = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!txt.includes('inventory_quantity')) continue;
      const m = txt.match(/"inventory_quantity"\s*:\s*(\d+)/);
      if (m) return Number(m[1]);
    }
    return null;
  }).catch(() => null);

  return {
    domSku: skuMatch ? skuMatch[1] : '',
    domPrice: parsePrice(priceText),
    domStock: exactStock ?? inventoryQuantityFromScripts,
    soldOut
  };
}

function formatVariantTitle(productTitle, variant) {
  const optionParts = [variant.option1, variant.option2, variant.option3].filter(Boolean);
  if (!optionParts.length || optionParts.join(' / ').toLowerCase() === 'default title') return productTitle;
  return `${productTitle} / ${optionParts.join(' / ')}`;
}

export async function extractSurfaceVariants(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});

  const productJson = await fetchProductJson(page, productUrl);
  if (!productJson?.variants?.length) {
    throw new Error(`No variants found via product.js for ${productUrl}`);
  }

  const out = [];
  const baseUrl = productUrl.split('?')[0];
  const productTitle = cleanText(productJson.title || '');

  for (const variant of productJson.variants) {
    const variantUrl = `${baseUrl}?variant=${variant.id}`;
    await page.goto(variantUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(200).catch(() => {});

    const dom = await getVariantDomState(page);

    const sku = cleanText(dom.domSku || variant.sku || '');
    if (!sku) continue;

    const livePrice = dom.domPrice || (typeof variant.price === 'number' ? variant.price / 100 : 0);

    let stockOnHand = null;
    let stockSource = 'unknown';

    if (typeof dom.domStock === 'number' && Number.isFinite(dom.domStock)) {
      stockOnHand = Math.max(0, dom.domStock);
      stockSource = 'dom_exact';
    } else if (dom.soldOut || variant.available === false) {
      stockOnHand = 0;
      stockSource = 'sold_out';
    } else if (variant.available === true) {
      stockOnHand = 1;
      stockSource = 'availability_fallback';
    }

    out.push({
      product_title: productTitle,
      title: formatVariantTitle(productTitle, variant),
      sku,
      variant_id: variant.id,
      variant_title: cleanText(variant.title || ''),
      option1: cleanText(variant.option1 || ''),
      option2: cleanText(variant.option2 || ''),
      option3: cleanText(variant.option3 || ''),
      raw_price_ex_vat: livePrice,
      stock_on_hand: stockOnHand,
      availability: stockOnHand === 0 ? 'OutOfStock' : 'InStock',
      stock_source: stockSource,
      product_url: baseUrl,
      variant_url: variantUrl
    });
  }

  return out;
}

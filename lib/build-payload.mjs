import { toMoneyString, csvEscape, parsePrice } from './normalize.mjs';

function roundUp(value, nearest) {
  const n = Number(nearest || 1);
  return Math.ceil(Number(value || 0) / n) * n;
}

export function buildLivePayloadItem(variant, {
  targetNetProfit = 1500,
  vatRate = 0.15,
  payfastPercent = 0.0368,
  payfastFixed = 2.30,
  roundToNearest = 100
} = {}) {
  const costExVat = parsePrice(variant.raw_price_ex_vat);
  const costInclVat = costExVat * (1 + vatRate);

  const rawSellInclVat = (costInclVat + targetNetProfit + payfastFixed) / (1 - payfastPercent);
  const sellPriceInclVat = roundUp(rawSellInclVat, roundToNearest);
  const estimatedPayfastFee = sellPriceInclVat * payfastPercent + payfastFixed;
  const estimatedNetProfit = sellPriceInclVat - estimatedPayfastFee - costInclVat;

  return {
    op: 'price_stock_update',
    source: 'surface-live',
    match_by: 'sku',
    sku: variant.sku,
    title: variant.title,
    price: toMoneyString(sellPriceInclVat),
    currency: 'ZAR',
    stock_on_hand: Number(variant.stock_on_hand ?? 0),
    availability: variant.availability,
    stock_source: variant.stock_source,
    cost_ex_vat: toMoneyString(costExVat),
    cost_incl_vat: toMoneyString(costInclVat),
    estimated_payfast_fee: toMoneyString(estimatedPayfastFee),
    estimated_net_profit: toMoneyString(estimatedNetProfit),
    pricing_model: 'target_profit_after_payfast',
    variant_id: String(variant.variant_id || ''),
    product_url: variant.product_url || '',
    variant_url: variant.variant_url || '',
    option1: variant.option1 || '',
    option2: variant.option2 || '',
    option3: variant.option3 || ''
  };
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

export function buildCsv(rows) {
  const headers = [
    'sku',
    'title',
    'price',
    'stock_on_hand',
    'availability',
    'stock_source',
    'cost_ex_vat',
    'cost_incl_vat',
    'estimated_payfast_fee',
    'estimated_net_profit',
    'variant_id',
    'product_url',
    'variant_url',
    'option1',
    'option2',
    'option3'
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

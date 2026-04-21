export function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parsePrice(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  let s = String(value).trim();
  s = s.replace(/[R$\s\u00A0]/g, "");

  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");

  s = s.replace(/[^0-9.\-]/g, "");
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0;
}

export function toMoneyString(value) {
  return Number(parsePrice(value) || 0).toFixed(2);
}

export function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function canonicalHandle(url = "") {
  const m = String(url).match(/\/products\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

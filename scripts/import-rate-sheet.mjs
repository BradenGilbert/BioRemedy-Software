// Imports BioRemedy's rate-sheet workbook (e.g. "docs/uploaded files/2026 RATES.xlsx") into the rate
// card: products, units of measure, rate sheets (priceLevels) and per-sheet tier prices
// (productPriceLevels). Phase 08 rate-card rework — see docs/roadmap/phase-08-quotes-estimates.md,
// "Rate-card rework: design (2026-09-23)".
//
// Re-runnable by design ("a second import is cheap, a second migration is not"): IDs are derived
// from item names, so a second run updates prices in place instead of duplicating rows. Admin edits
// to a product's flags (fuel surcharge, emergency minimum) survive a re-run; prices, units and notes
// are owned by the sheet and are overwritten.
//
// Writes go through the running server's API (one record per POST), never straight to
// data/backend.json, so a live session saving at the same time cannot be clobbered.
//
//   node scripts/import-rate-sheet.mjs "docs/uploaded files/2026 RATES.xlsx" [--base http://localhost:4173] [--dry-run]

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const baseUrl = (baseIndex >= 0 ? args[baseIndex + 1] : "http://localhost:4173").replace(/\/$/, "");
const dryRun = args.includes("--dry-run");
const workbookPath = args.find((arg, index) => !arg.startsWith("--") && (baseIndex < 0 || index !== baseIndex + 1));
if (!workbookPath) {
  console.error('Usage: node scripts/import-rate-sheet.mjs "<workbook.xlsx>" [--base http://localhost:4173] [--dry-run]');
  process.exit(1);
}

// Which workbook tab becomes which rate sheet. The first tab keeps the pre-existing
// `price-standard-2026` id so every existing reference (quotes, Phase 04 vendor profiles and service
// agreements) lands on the real default sheet without a data migration.
const SHEETS = {
  "Rate Sheet": { priceLevelId: "price-standard-2026", name: "2026 Rate Sheet", isDefault: true, key: "rs" },
  Sheet5: { priceLevelId: "price-sheet5-2026", name: "2026 Rate Sheet (Sheet5)", isDefault: false, key: "s5" },
};

// Generic cost-basis products Phase 09's close report prices usage with. They live on the default
// sheet already; copying them to every imported sheet keeps that report working for quotes priced
// on a non-default sheet.
const COST_BASIS_PRODUCT_IDS = ["prod-field-labor-standard", "prod-equipment-standard-daily", "prod-material-standard-unit"];

// --- minimal .xlsx reader (a zip of XML; no dependency needed) --------------------------------

function unzip(buffer) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record).");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < entryCount; i += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeader = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localHeader + 26);
    const localExtraLength = buffer.readUInt16LE(localHeader + 28);
    const start = localHeader + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function textOf(xmlFragment) {
  return decodeXml([...xmlFragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

function readWorkbook(buffer) {
  const files = unzip(buffer);
  const read = (name) => files.get(name)?.toString("utf8") || "";
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
  const rels = new Map(
    [...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((match) => {
      const tag = match[0];
      return [tag.match(/Id="([^"]+)"/)[1], tag.match(/Target="([^"]+)"/)[1]];
    }),
  );
  const sheets = new Map();
  for (const match of read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = decodeXml(tag.match(/name="([^"]+)"/)[1]);
    const target = rels.get(tag.match(/r:id="([^"]+)"/)[1]).replace(/^\/?xl\//, "");
    const rows = new Map();
    for (const cell of read(`xl/${target}`).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] || "";
      const ref = attrs.match(/r="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = null;
      if (type === "s") value = shared[Number(rawValue)];
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str") value = decodeXml(rawValue ?? "");
      else if (rawValue != null) value = Number(rawValue);
      if (value === null || value === "") continue;
      const rowNumber = Number(ref[2]);
      if (!rows.has(rowNumber)) rows.set(rowNumber, {});
      rows.get(rowNumber)[ref[1]] = value;
    }
    sheets.set(name, rows);
  }
  return sheets;
}

// --- sheet interpretation ---------------------------------------------------------------------

const clean = (value) => String(value ?? "").replace(/[‐‑‒–]/g, "-").replace(/\s+/g, " ").trim();
const slug = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const nameKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const CATEGORY_HEADERS = [
  [/^section i\b/i, "Labor"],
  [/^section ii\b/i, "Vehicles & Response Units"],
  [/^heavy equipment/i, "Heavy Equipment"],
  [/^trailers/i, "Trailers"],
  [/^flood water removal/i, "Flood Water Removal"],
  [/^marine equipment/i, "Marine Equipment"],
  [/^pumps and accessories/i, "Pumps & Accessories"],
  [/^hoses\/fittings/i, "Hoses & Fittings"],
  [/^generators/i, "Generators & Air Compressors"],
  [/^pressure washers/i, "Pressure Washers & Hydro Blasting"],
  [/^miscellaneous equipment/i, "Miscellaneous Equipment"],
  [/^waste containers/i, "Waste Containers"],
  [/^decontamination equipment/i, "Decontamination Equipment"],
  [/^personal protective equipment/i, "Personal Protective Equipment"],
  [/^safety support equipment/i, "Safety Support Equipment"],
  [/^atmospheric testing/i, "Atmospheric Testing & Communication"],
  [/^waste management/i, "Waste Management & Disposal"],
  [/^absorbent materials/i, "Absorbent Materials"],
  [/^chemicals and miscellaneous/i, "Chemicals & Consumables"],
  [/^remediation laboratory services/i, "Remediation Laboratory Services"],
];
const PPE_SUBHEADERS = [
  [/^suits$/i, "Suits"],
  [/^boots$/i, "Boots"],
  [/^gloves$/i, "Gloves"],
  [/^face, respiratory/i, "Face, Respiratory & Hearing"],
];

const UNITS = [
  [/^hourly$/, "uom-hour", "hour"],
  [/^daily$/, "uom-day", "day"],
  [/^each\b/, "uom-each", "each"],
  [/^per man per day$/, "uom-per-man-per-day", "per man per day"],
  [/^per foot per day$/, "uom-per-foot-per-day", "per foot per day"],
  [/^per foot$/, "uom-per-foot", "per foot"],
  [/^daily - per 100 ?ft$/, "uom-per-100-ft-per-day", "per 100 ft per day"],
  [/^per test$/, "uom-per-test", "per test"],
  [/^per suit$/, "uom-per-suit", "per suit"],
  [/^per pair$/, "uom-per-pair", "per pair"],
  [/^per bale$/, "uom-per-bale", "per bale"],
  [/^per bag$/, "uom-per-bag", "per bag"],
  [/^per section$/, "uom-per-section", "per section"],
  [/^per gallon$/, "uom-per-gallon", "per gallon"],
  [/^per pail$/, "uom-per-pail", "per pail"],
  [/^per roll$/, "uom-per-roll", "per roll"],
  [/^per load$/, "uom-per-load", "per load"],
  [/^per sample$/, "uom-per-sample", "per sample"],
  [/^per sq\.? ?ft\.?$/, "uom-per-sq-ft", "per sq ft"],
];

function resolveUnit(rawUnit) {
  const text = clean(rawUnit).toLowerCase();
  if (!text) return { uomId: "uom-each", note: "" };
  if (text.startsWith("daily + rebuild")) return { uomId: "uom-day", note: "Plus pump rebuild at cost + 25% if damaged in operation." };
  if (text === "based on market value") return { uomId: "uom-each", note: "Based on market value." };
  const hit = UNITS.find(([pattern]) => pattern.test(text));
  if (!hit) throw new Error(`Unrecognized unit of measure: "${rawUnit}"`);
  const note = /based on time to complete/.test(text) ? "Priced on time to complete." : "";
  return { uomId: hit[1], note };
}

// A price cell is a number, "N/A" (not offered at that tier — bills at Standard), "Cost + N% Margin",
// or occasionally a range ("600-1200").
function parsePrice(raw) {
  if (raw == null || raw === "") return { kind: "none" };
  if (typeof raw === "number") return { kind: "amount", amount: raw };
  const text = clean(raw);
  if (/^n\/?a$/i.test(text)) return { kind: "na" };
  const costPlus = text.match(/cost\s*\+\s*(\d+(?:\.\d+)?)\s*%/i);
  if (costPlus) return { kind: "cost_plus", markupPercent: Number(costPlus[1]) };
  const range = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (range) return { kind: "amount", amount: Number(range[1]), note: `Range ${range[1]}–${range[2]}.` };
  if (Number.isFinite(Number(text))) return { kind: "amount", amount: Number(text) };
  throw new Error(`Unrecognized price cell: "${raw}"`);
}

const FUEL_CATEGORIES = new Set([
  "Vehicles & Response Units",
  "Heavy Equipment",
  "Trailers",
  "Marine Equipment",
  "Pumps & Accessories",
  "Generators & Air Compressors",
  "Pressure Washers & Hydro Blasting",
  "Miscellaneous Equipment",
]);
const FUEL_BURNING = /truck|tractor|vactron|super vac|guzzler|super sucker|skid steer|excavator|forklift|boom lift|response boat|engine driven|generator|air compressor|pressure washer|hydro blaster|mobile boiler|chainsaw|string trimmer|leaf blower|welding machine/i;
const NOT_FUEL_BURNING = /washout|hose|wand|lance|tips?\b|cleaning head|assembly|fittings|attachments/i;

function interpretSheet(rows, sheetName) {
  const items = [];
  let category = "";
  let subcategory = "";
  let started = false;
  for (const rowNumber of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(rowNumber);
    const label = clean(row.A);
    if (!label) continue;
    if (/^section iii\b/i.test(label)) break;
    const header = CATEGORY_HEADERS.find(([pattern]) => pattern.test(label));
    const hasPrice = row.H != null;
    if (header && !hasPrice) {
      started = true;
      category = header[1];
      subcategory = category === "Personal Protective Equipment" ? "Suits" : "";
      continue;
    }
    if (header && hasPrice && header[1] === "Labor") {
      // "Section I: Labor Rates | Standard Rate | Emergency/ OT Rate | ..." — the column header row.
      started = true;
      category = "Labor";
      subcategory = "";
      continue;
    }
    if (!started) continue;
    const ppeSub = category === "Personal Protective Equipment" ? PPE_SUBHEADERS.find(([pattern]) => pattern.test(label)) : null;
    if (ppeSub && !hasPrice) {
      subcategory = ppeSub[1];
      continue;
    }
    if (!hasPrice) {
      console.warn(`  ! ${sheetName} row ${rowNumber}: "${label}" has no price and isn't a known section header — skipped`);
      continue;
    }

    // From "Pumps and Accessories" down the tab uses two columns (price, unit in I) instead of four.
    const fourColumn = row.K != null;
    const standard = parsePrice(row.H);
    const otEmergency = fourColumn ? parsePrice(row.I) : { kind: "none" };
    const doubleTime = fourColumn ? parsePrice(row.J) : { kind: "none" };
    const unit = resolveUnit(fourColumn ? row.K : row.I);
    const notes = [standard.note, unit.note].filter(Boolean);
    if (/^per diem$/i.test(label)) notes.push("Rate sheet notes set a GSA-based floor of $125/day/person; listed rate imported as-is.");
    if (/price listed or cost plus/i.test(label)) notes.push("Price listed, or cost + 20%.");

    items.push({
      sheetName,
      rowNumber,
      name: label,
      category,
      subcategory,
      uomId: unit.uomId,
      standard,
      otEmergency,
      doubleTime,
      rateNote: notes.join(" "),
    });
  }
  return items;
}

// --- API ----------------------------------------------------------------------------------------

const headers = { "Content-Type": "application/json", "X-CRM-Role": "Admin" };

async function getCollection(name) {
  const response = await fetch(`${baseUrl}/api/backend/${name}`, { headers });
  if (!response.ok) throw new Error(`GET ${name} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

let writes = 0;
async function upsert(collection, record) {
  writes += 1;
  if (dryRun) return record;
  const response = await fetch(`${baseUrl}/api/backend/${collection}`, { method: "POST", headers, body: JSON.stringify(record) });
  if (!response.ok) throw new Error(`POST ${collection}/${record.id} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const sameRecord = (a, b) => JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
function stripVolatile(record) {
  if (!record) return record;
  const { createdAt, updatedAt, ...rest } = record;
  return Object.fromEntries(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y)));
}

// --- main -----------------------------------------------------------------------------------------

const sheets = readWorkbook(await readFile(workbookPath));
const sourceFile = path.basename(workbookPath);
const parsed = [];
for (const [sheetName, config] of Object.entries(SHEETS)) {
  if (!sheets.has(sheetName)) throw new Error(`Workbook has no "${sheetName}" tab (found: ${[...sheets.keys()].join(", ")}).`);
  const items = interpretSheet(sheets.get(sheetName), sheetName);
  console.log(`${sheetName}: ${items.length} priced items`);
  parsed.push({ sheetName, config, items });
}

const [existingProducts, existingPrices, existingLevels, existingUoms, existingGroups] = await Promise.all(
  ["products", "productPriceLevels", "priceLevels", "unitsOfMeasure", "unitGroups"].map(getCollection),
);
const productsById = new Map(existingProducts.map((item) => [item.id, item]));
const pricesById = new Map(existingPrices.map((item) => [item.id, item]));
const stats = { sheetsCreated: 0, sheetsUpdated: 0, productsCreated: 0, productsUpdated: 0, pricesCreated: 0, pricesUpdated: 0, unchanged: 0 };

async function upsertIfChanged(collection, record, existing, created, updated) {
  if (existing && sameRecord({ ...existing, ...record }, existing)) {
    stats.unchanged += 1;
    return;
  }
  await upsert(collection, { ...(existing || {}), ...record });
  stats[existing ? updated : created] += 1;
}

// Unit group + units.
const unitGroupId = "unit-group-rate-sheet";
if (!existingGroups.some((group) => group.id === unitGroupId)) {
  await upsert("unitGroups", { id: unitGroupId, name: "Rate sheet units", baseUomName: "each", stateCode: "Active", statusCode: "Active" });
}
for (const [, id, name] of UNITS) {
  if (existingUoms.some((uom) => uom.id === id)) continue;
  await upsert("unitsOfMeasure", { id, unitGroupId, baseUomId: "", name, quantity: 1 });
}

// Rate sheets.
for (const { sheetName, config } of parsed) {
  const existing = existingLevels.find((level) => level.id === config.priceLevelId);
  await upsertIfChanged(
    "priceLevels",
    {
      id: config.priceLevelId,
      name: existing?.name && existing.name !== "2026 standard environmental services" ? existing.name : config.name,
      transactionCurrencyId: existing?.transactionCurrencyId || "currency-usd",
      beginDate: existing?.beginDate || "2026-01-01",
      endDate: existing?.endDate || "2026-12-31",
      stateCode: "Active",
      statusCode: "Active",
      isDefault: config.isDefault,
      sourceFile,
      sourceSheet: sheetName,
    },
    existing,
    "sheetsCreated",
    "sheetsUpdated",
  );
}

// Products + prices. The default tab is processed first so shared products take its wording.
let sequence = existingProducts.filter((product) => /^RS-\d+$/.test(product.productNumber || "")).length;
const productIdByKey = new Map();
for (const { config, items } of parsed) {
  for (const item of items) {
    const key = nameKey(item.name);
    let productId = productIdByKey.get(key);
    if (!productId) {
      productId = `prod-rs-${slug(item.name)}`;
      productIdByKey.set(key, productId);
      const existing = productsById.get(productId);
      const isHourly = item.uomId === "uom-hour";
      // Exclusions test the name without its parenthetical, so "Pressure Washer (Includes 100 ft of hose)"
      // is still a fuel-burning pressure washer, not a hose.
      const bareName = item.name.replace(/\([^)]*\)/g, " ");
      const fuel = FUEL_CATEGORIES.has(item.category) && FUEL_BURNING.test(bareName) && !NOT_FUEL_BURNING.test(bareName);
      await upsertIfChanged(
        "products",
        {
          id: productId,
          name: item.name,
          productNumber: existing?.productNumber || `RS-${String((sequence += 1)).padStart(3, "0")}`,
          description: existing?.description || "",
          category: item.category,
          subcategory: item.subcategory,
          defaultUomId: item.uomId,
          defaultUnitGroupId: item.uomId === "uom-hour" || item.uomId === "uom-day" ? "unit-group-services" : unitGroupId,
          priceLevelId: config.priceLevelId,
          transactionCurrencyId: "currency-usd",
          productStructure: item.category === "Labor" ? "Service" : "Product",
          stateCode: "Active",
          statusCode: "Active",
          // Admin-editable flags: set on first import, never overwritten by a re-run.
          fuelSurchargeApplies: existing ? Boolean(existing.fuelSurchargeApplies) : fuel,
          minimumQuantity: existing ? Number(existing.minimumQuantity || 0) : isHourly ? 4 : 0,
          minimumAppliesWhen: existing ? existing.minimumAppliesWhen || "" : isHourly ? "emergency" : "",
          importSource: `${sourceFile} / ${item.sheetName}!A${item.rowNumber}`,
        },
        existing,
        "productsCreated",
        "productsUpdated",
      );
    }

    const costPlus = item.standard.kind === "cost_plus" ? item.standard : null;
    const tierAmount = (price) => (price.kind === "amount" ? price.amount : null);
    const priceId = `ppl-${config.key}-${slug(item.name)}`;
    await upsertIfChanged(
      "productPriceLevels",
      {
        id: priceId,
        productId,
        priceLevelId: config.priceLevelId,
        uomId: item.uomId,
        unitGroupId: item.uomId === "uom-hour" || item.uomId === "uom-day" ? "unit-group-services" : unitGroupId,
        transactionCurrencyId: "currency-usd",
        pricingMethodCode: costPlus ? "PercentMarkupCurrentCost" : "CurrencyAmount",
        markupPercent: costPlus ? costPlus.markupPercent : null,
        amount: costPlus ? null : tierAmount(item.standard),
        amountOtEmergency: costPlus ? null : tierAmount(item.otEmergency),
        amountDoubleTime: costPlus ? null : tierAmount(item.doubleTime),
        rateNote: item.rateNote,
        sheetItemName: item.name,
        importSource: `${sourceFile} / ${item.sheetName}!A${item.rowNumber}`,
      },
      pricesById.get(priceId),
      "pricesCreated",
      "pricesUpdated",
    );
  }
}

// Cost-basis products onto every non-default imported sheet (see COST_BASIS_PRODUCT_IDS).
for (const { config } of parsed.filter(({ config }) => !config.isDefault)) {
  for (const productId of COST_BASIS_PRODUCT_IDS) {
    const source = existingPrices.find((price) => price.productId === productId && price.priceLevelId === "price-standard-2026" && !price.deletedAt);
    if (!source) continue;
    const id = `${source.id}-${config.key}`;
    await upsertIfChanged("productPriceLevels", { ...source, id, priceLevelId: config.priceLevelId }, pricesById.get(id), "pricesCreated", "pricesUpdated");
  }
}

console.log(`${dryRun ? "[dry run] " : ""}${writes} writes`, stats);

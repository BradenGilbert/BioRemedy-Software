// Front Line forms — the pure half (Phase 25 Wave F, 2026-09-30).
//
// No imports and no DOM: field/forms.js (the phone), the office Forms builder's preview, and
// scripts/form-calc-check.mjs (a Node unit check wired into scripts/smoke.mjs) all use these.
//
//   evaluateCalculation(expression, valuesByFieldRef) -> number | null
//     A calculation field's formula: numbers, other fields' fieldRefs, + - * / (also − × ÷) and
//     parentheses. It is parsed here and never handed to eval/Function. A blank or non-numeric input,
//     division by zero, or a malformed formula gives null (the phone shows it blank).
//   normalizeFormTemplate(template)
//     Reads a formTemplates row in either shape: the Wave F one ({displayName, fields[{fieldRef,
//     displayName, type, config}]}) or the Phase 21 seed ({name, fields[{key, label, type, options}]}).
//     Legacy types are read, never rewritten: yesno -> selectList [Yes, No], checklist -> multiSelect,
//     photo -> picture.

export const FORM_FIELD_TYPES = [
  "calculation",
  "cascadingList",
  "checkbox",
  "date",
  "label",
  "money",
  "multiSelect",
  "number",
  "odometer",
  "picture",
  "selectList",
  "signature",
  "text",
  "time",
  "url",
];

export const TIMESHEET_ACTIONS = {
  shift_start: "Shift start",
  shift_end: "Shift end",
  break_start: "Break start",
  break_end: "Break end",
};

// 2026-10-01 (owner): "used on site" fields. Each is a list of rows ({rowId, ...}) the server records
// into the job when the submission is saved (server.mjs applyFormSubmissionUsage): consumables and PPE
// (stock comes out), equipment hours/days, waste generated, subcontractor / vendor services. Rows keep
// the label the worker saw (itemLabel, assetLabel, vendorName) so they read without lookups.
export const USAGE_FIELD_TYPES = ["materialsUsed", "equipmentUsed", "wasteGenerated", "vendorServices"];
FORM_FIELD_TYPES.push(...USAGE_FIELD_TYPES);

export function isUsageFieldType(type) {
  return USAGE_FIELD_TYPES.includes(type);
}

export function templateHasUsageFields(template) {
  return asArray(template?.fields).some((field) => isUsageFieldType(field?.type));
}

export const USAGE_EQUIPMENT_CONDITIONS = [
  { value: "Good", label: "OK" },
  { value: "Needs service", label: "Needs service" },
  { value: "Damaged", label: "Damaged" },
];

function usageQuantity(quantity, unit) {
  const number = numericValue(quantity);
  if (number === null) return "";
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
}

// One row as plain text ("2 pairs · Nitrile Gloves (Chemical)").
export function usageRowText(type, row) {
  if (!row || typeof row !== "object") return "";
  const note = row.note ? ` (${row.note})` : "";
  if (type === "materialsUsed") return [usageQuantity(row.quantity, row.unit), row.itemLabel || row.writeInName || "Item"].filter(Boolean).join(" · ") + note;
  if (type === "equipmentUsed") {
    const amount = numericValue(row.days) ? `${numericValue(row.days)} day${numericValue(row.days) === 1 ? "" : "s"}` : numericValue(row.hours) ? `${numericValue(row.hours)} hr${numericValue(row.hours) === 1 ? "" : "s"}` : "";
    const condition = row.condition && row.condition !== "Good" ? row.condition : "";
    return [row.assetLabel || row.assetTag || "Equipment", amount, condition].filter(Boolean).join(" · ") + note;
  }
  if (type === "wasteGenerated") {
    const count = numericValue(row.containerCount) ? `${numericValue(row.containerCount)} × ${row.containerType || "container"}` : row.containerType || "";
    return [row.description || row.classification || "Waste", count, usageQuantity(row.quantity, row.unit)].filter(Boolean).join(" · ") + note;
  }
  if (type === "vendorServices") {
    const cost = numericValue(row.cost) !== null ? formatMoney(row.cost) : "";
    return [row.vendorName || "Vendor", row.service, usageQuantity(row.quantity, row.unit), cost].filter(Boolean).join(" · ") + note;
  }
  return "";
}

// Lower snake case, unique within `taken` (a Set of refs already used in the form).
export function slugFieldRef(text, taken = new Set()) {
  const base =
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "f_$1") || "field";
  let ref = base;
  let n = 2;
  while (taken.has(ref)) ref = `${base}_${n++}`;
  return ref;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeFormField(field, index = 0, taken = new Set()) {
  const raw = field || {};
  const config = { ...(raw.config && typeof raw.config === "object" ? raw.config : {}) };
  let type = String(raw.type || "text");
  let legacyType = "";
  if (type === "yesno") {
    legacyType = "yesno";
    type = "selectList";
    config.options = asArray(config.options).length ? config.options : ["Yes", "No"];
  } else if (type === "checklist") {
    legacyType = "checklist";
    type = "multiSelect";
    config.options = asArray(config.options).length ? config.options : asArray(raw.options);
  } else if (type === "photo") {
    legacyType = "photo";
    type = "picture";
    if (config.allowGallery === undefined) config.allowGallery = true;
    if (config.max === undefined) config.max = 10;
  } else if (!FORM_FIELD_TYPES.includes(type)) {
    legacyType = type;
    type = "text";
  }
  if ((type === "selectList" || type === "multiSelect") && !asArray(config.options).length && asArray(raw.options).length) config.options = raw.options;
  if (type === "text" && legacyType === "" && raw.key && !raw.fieldRef && config.multiline === undefined) config.multiline = true;
  const displayName = String(raw.displayName || raw.label || raw.name || `Field ${index + 1}`);
  let fieldRef = String(raw.fieldRef || raw.key || "").trim();
  if (!fieldRef || taken.has(fieldRef)) fieldRef = slugFieldRef(fieldRef || displayName, taken);
  taken.add(fieldRef);
  return {
    id: raw.id || `field-${fieldRef}`,
    displayName,
    fieldRef,
    type,
    legacyType,
    required: type === "label" || type === "calculation" ? false : Boolean(raw.required),
    helpText: String(raw.helpText || ""),
    defaultValue: raw.defaultValue ?? "",
    config,
  };
}

export function normalizeFormTemplate(template) {
  if (!template) return null;
  const taken = new Set();
  const fields = asArray(template.fields).map((field, index) => normalizeFormField(field, index, taken));
  return {
    ...template,
    displayName: String(template.displayName || template.name || "Form"),
    description: String(template.description || ""),
    isActive: template.isActive !== false && !template.deletedAt,
    // Phase 21 seeds predate the flag and were all on the Forms screen; only an explicit false hides one.
    availableOnFormsMenu: template.availableOnFormsMenu !== false,
    timesheetAction: TIMESHEET_ACTIONS[template.timesheetAction] ? template.timesheetAction : "",
    groups: {
      crewIds: asArray(template.groups?.crewIds).filter(Boolean),
      roles: asArray(template.groups?.roles).filter(Boolean),
    },
    fields,
  };
}

// Empty groups = everyone; otherwise the worker needs one matching crew or one matching role.
export function templateMatchesWorker(template, { crewIds = [], roles = [] } = {}) {
  const groups = template?.groups || {};
  const wantCrews = asArray(groups.crewIds).filter(Boolean);
  const wantRoles = asArray(groups.roles).filter(Boolean);
  if (!wantCrews.length && !wantRoles.length) return true;
  return wantCrews.some((id) => crewIds.includes(id)) || wantRoles.some((role) => roles.includes(role));
}

// ---- calculation -------------------------------------------------------------------------------

function tokenize(expression) {
  const source = String(expression || "");
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)/.exec(source.slice(i));
      if (!match) throw new Error(`Unexpected "${ch}"`);
      tokens.push({ kind: "num", value: Number(match[1]) });
      i += match[1].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      tokens.push({ kind: "ref", value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "/": "/", "÷": "/", "(": "(", ")": ")" }[ch];
    if (!op) throw new Error(`Unexpected "${ch}"`);
    tokens.push({ kind: op === "(" || op === ")" ? op : "op", value: op });
    i += 1;
  }
  return tokens;
}

// Recursive descent over the tokens; returns an AST so a formula can be checked without values.
function parse(expression) {
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const expr = () => {
    let node = term();
    while (peek()?.kind === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = tokens[pos++].value;
      node = { op, left: node, right: term() };
    }
    return node;
  };
  const term = () => {
    let node = factor();
    while (peek()?.kind === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = tokens[pos++].value;
      node = { op, left: node, right: factor() };
    }
    return node;
  };
  const factor = () => {
    const token = tokens[pos++];
    if (!token) throw new Error("The formula ends too soon.");
    if (token.kind === "op" && (token.value === "-" || token.value === "+")) return { op: token.value === "-" ? "neg" : "pos", left: factor() };
    if (token.kind === "num") return { num: token.value };
    if (token.kind === "ref") return { ref: token.value };
    if (token.kind === "(") {
      const node = expr();
      if (tokens[pos++]?.kind !== ")") throw new Error("A bracket is not closed.");
      return node;
    }
    throw new Error(`Unexpected "${token.value}"`);
  };
  if (!tokens.length) throw new Error("The formula is empty.");
  const tree = expr();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].value}"`);
  return tree;
}

function refsOf(node, out = new Set()) {
  if (!node) return out;
  if (node.ref) out.add(node.ref);
  refsOf(node.left, out);
  refsOf(node.right, out);
  return out;
}

// A field value as a number: plain numbers, numeric strings ("1,200.50", "$45"), an odometer's
// {reading}. Anything else is null.
export function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object" && !Array.isArray(value)) return numericValue(value.reading ?? value.value ?? null);
  const cleaned = String(value).replace(/[$,\s]/g, "");
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}

function evaluateNode(node, values) {
  if (node.num !== undefined) return node.num;
  if (node.ref !== undefined) {
    return Object.prototype.hasOwnProperty.call(values || {}, node.ref) ? numericValue(values[node.ref]) : null;
  }
  const left = evaluateNode(node.left, values);
  if (left === null) return null;
  if (node.op === "neg") return -left;
  if (node.op === "pos") return left;
  const right = evaluateNode(node.right, values);
  if (right === null) return null;
  if (node.op === "+") return left + right;
  if (node.op === "-") return left - right;
  if (node.op === "*") return left * right;
  if (node.op === "/") return right === 0 ? null : left / right;
  return null;
}

export function evaluateCalculation(expression, valuesByFieldRef = {}) {
  let tree;
  try {
    tree = parse(expression);
  } catch {
    return null;
  }
  const result = evaluateNode(tree, valuesByFieldRef);
  return result === null || !Number.isFinite(result) ? null : result;
}

// For the builder: "" when the formula parses and only names known fieldRefs, else a message.
export function validateCalculation(expression, fieldRefs = []) {
  let tree;
  try {
    tree = parse(expression);
  } catch (error) {
    return error.message || "The formula cannot be read.";
  }
  const known = new Set(fieldRefs);
  const unknown = [...refsOf(tree)].filter((ref) => !known.has(ref));
  return unknown.length ? `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}` : "";
}

export function calculationRefs(expression) {
  try {
    return [...refsOf(parse(expression))];
  } catch {
    return [];
  }
}

export function roundTo(value, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const places = Number.isFinite(Number(decimals)) && decimals !== "" && decimals !== null ? Math.max(0, Math.min(10, Number(decimals))) : null;
  if (places === null) return Math.round(value * 1e9) / 1e9;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Every calculation field's value, in form order, re-run until stable so one calculation can use another.
export function computeCalculations(fields, values) {
  const next = { ...(values || {}) };
  const calcs = (fields || []).filter((field) => field.type === "calculation");
  for (let pass = 0; pass <= calcs.length; pass += 1) {
    let changed = false;
    for (const field of calcs) {
      const value = roundTo(evaluateCalculation(field.config?.expression || "", next), field.config?.decimals);
      if (next[field.fieldRef] !== value) {
        next[field.fieldRef] = value;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

// ---- cascading lists ---------------------------------------------------------------------------

// The options for `level` given the choices already made at the levels above it.
export function cascadeOptions(rows, level, selections = []) {
  const seen = new Set();
  const out = [];
  for (const row of asArray(rows)) {
    if (!Array.isArray(row)) continue;
    let matches = true;
    for (let i = 0; i < level; i += 1) {
      if (String(row[i] ?? "") !== String(selections[i] ?? "")) {
        matches = false;
        break;
      }
    }
    const value = row[level];
    if (!matches || value === undefined || value === null || value === "") continue;
    const text = String(value);
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

// ---- display -----------------------------------------------------------------------------------

export function formatMoney(value) {
  const number = numericValue(value);
  if (number === null) return "";
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// A plain-text rendering of one answer, for summaries and lists. Old Phase 21 payload shapes
// (checklist {options, checked}, photo/signature {documentId, signed}) are read too.
export function formatFieldValueText(field, value) {
  if (value === null || value === undefined || value === "") return "";
  const type = field?.type || "text";
  if (Array.isArray(value)) {
    if (isUsageFieldType(type)) return value.map((row) => usageRowText(type, row)).filter(Boolean).join("; ");
    if (type === "picture") return `${value.length} photo${value.length === 1 ? "" : "s"}`;
    return value.filter((item) => item !== "" && item !== null && item !== undefined).join(type === "cascadingList" ? " › " : ", ");
  }
  if (typeof value === "object") {
    if (Array.isArray(value.checked)) return value.checked.join(", ") || "None checked";
    if (value.reading !== undefined) return `${value.reading === "" || value.reading === null ? "" : Number(value.reading).toLocaleString("en-US")}${value.vehicleLabel ? ` (${value.vehicleLabel})` : ""}`;
    if (type === "signature" || value.signed !== undefined || value.signerName !== undefined) return value.documentId || value.signed ? `Signed${value.signerName ? ` by ${value.signerName}` : ""}` : "Not signed";
    if (value.documentId) return "Photo attached";
    return "";
  }
  if (type === "checkbox") return value === true || value === "true" ? "Yes" : "No";
  if (type === "money") return formatMoney(value);
  if (type === "number" || type === "calculation") {
    const number = numericValue(value);
    if (number === null) return String(value);
    const unit = field?.config?.unit ? ` ${field.config.unit}` : "";
    return `${number.toLocaleString("en-US", { maximumFractionDigits: 10 })}${unit}`;
  }
  return String(value);
}

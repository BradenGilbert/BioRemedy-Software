// Phase 25 Wave F (2026-09-30): unit check for field/form-calc.js -- the calculation parser a form's
// `calculation` fields use, the legacy field-type mapping, and cascading-list options. No server, no
// browser; scripts/smoke.mjs runs it next to the AAMVA parser check.
//
//   node scripts/form-calc-check.mjs
import {
  evaluateCalculation,
  validateCalculation,
  computeCalculations,
  normalizeFormTemplate,
  cascadeOptions,
  templateMatchesWorker,
  slugFieldRef,
  formatFieldValueText,
} from "../field/form-calc.js";

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` -- got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

// ---- calculations
check("subtraction of two refs", evaluateCalculation("miles_end - miles_start", { miles_end: "41250", miles_start: 41200 }), 50);
check("precedence", evaluateCalculation("2 + 3 * 4", {}), 14);
check("parentheses", evaluateCalculation("(2 + 3) * 4", {}), 20);
check("unary minus", evaluateCalculation("-a + 10", { a: 3 }), 7);
check("unicode operators", evaluateCalculation("a × b ÷ c − 1", { a: 6, b: 4, c: 3 }), 7);
check("decimals", evaluateCalculation("hours * rate", { hours: "2.5", rate: "$40.00" }), 100);
check("division by zero is blank", evaluateCalculation("a / b", { a: 5, b: 0 }), null);
check("blank input is blank", evaluateCalculation("a + b", { a: 5, b: "" }), null);
check("unknown ref is blank", evaluateCalculation("a + zzz", { a: 5 }), null);
check("odometer value reads its reading", evaluateCalculation("end - start", { end: { vehicleId: "v", reading: 120 }, start: 100 }), 20);
check("malformed formula is blank", evaluateCalculation("a + * b", { a: 1, b: 2 }), null);
check("unclosed bracket is blank", evaluateCalculation("(a + b", { a: 1, b: 2 }), null);
check("no code execution", evaluateCalculation("constructor.constructor('return 1')()", {}), null);
check("prototype keys are not values", evaluateCalculation("toString + 1", {}), null);
check("validate: ok", validateCalculation("miles_end - miles_start", ["miles_end", "miles_start"]), "");
check("validate: unknown field", validateCalculation("miles_end - odo", ["miles_end"]), "Unknown field: odo");
check("validate: syntax", validateCalculation("a +", ["a"]) !== "", true);
const chained = computeCalculations(
  [
    { fieldRef: "total", type: "calculation", config: { expression: "sub * 2", decimals: 1 } },
    { fieldRef: "sub", type: "calculation", config: { expression: "a / 3", decimals: 2 } },
  ],
  { a: 10 },
);
check("chained calculations with rounding", [chained.sub, chained.total], [3.33, 6.7]);

const cycle = computeCalculations(
  [
    { fieldRef: "x", type: "calculation", config: { expression: "y + 1" } },
    { fieldRef: "y", type: "calculation", config: { expression: "x + 1" } },
  ],
  {},
);
check("a calculation loop settles blank instead of hanging", [cycle.x, cycle.y], [null, null]);

// ---- the builder's saved shape (fieldRef/displayName with key/label mirrors, 2026-09-30)
const built = normalizeFormTemplate({
  id: "form-y",
  name: "internal",
  displayName: "Shown name",
  fields: [{ key: "hours", label: "Hours", fieldRef: "hours", displayName: "Hours worked", type: "number", config: { decimals: 1 } }],
});
check("builder shape prefers fieldRef/displayName", [built.displayName, built.fields[0].fieldRef, built.fields[0].displayName, built.fields[0].config.multiline], ["Shown name", "hours", "Hours worked", undefined]);

// ---- legacy mapping
const legacy = normalizeFormTemplate({
  id: "form-x",
  name: "Old form",
  fields: [
    { key: "ppe", label: "PPE worn", type: "yesno", required: true },
    { key: "lights", label: "Lights", type: "checklist", options: ["Head", "Brake"] },
    { key: "photo", label: "Damage photo", type: "photo" },
    { key: "notes", label: "Notes", type: "text" },
  ],
});
check("legacy displayName from name", legacy.displayName, "Old form");
check("legacy availableOnFormsMenu defaults on", legacy.availableOnFormsMenu, true);
check(
  "legacy types map",
  legacy.fields.map((field) => [field.fieldRef, field.displayName, field.type]),
  [
    ["ppe", "PPE worn", "selectList"],
    ["lights", "Lights", "multiSelect"],
    ["photo", "Damage photo", "picture"],
    ["notes", "Notes", "text"],
  ],
);
check("yesno options", legacy.fields[0].config.options, ["Yes", "No"]);
check("checklist options", legacy.fields[1].config.options, ["Head", "Brake"]);
check("fieldRef slug", slugFieldRef("Miles at start (odometer)"), "miles_at_start_odometer");
check("fieldRef slug unique", slugFieldRef("Miles", new Set(["miles"])), "miles_2");
check("old checklist payload text", formatFieldValueText({ type: "multiSelect" }, { options: ["A", "B"], checked: ["B"] }), "B");

// ---- cascading lists
const rows = [
  ["Hydrocarbon", "Diesel"],
  ["Hydrocarbon", "Gasoline"],
  ["Chemical", "Acid"],
  ["Hydrocarbon", "Diesel"],
];
check("cascade level 0", cascadeOptions(rows, 0, []), ["Hydrocarbon", "Chemical"]);
check("cascade level 1 filtered", cascadeOptions(rows, 1, ["Hydrocarbon"]), ["Diesel", "Gasoline"]);
check("cascade level 1 other branch", cascadeOptions(rows, 1, ["Chemical"]), ["Acid"]);

// ---- groups
check("empty groups = everyone", templateMatchesWorker({ groups: { crewIds: [], roles: [] } }, { crewIds: [], roles: ["Crew"] }), true);
check("crew match", templateMatchesWorker({ groups: { crewIds: ["crew-a"], roles: [] } }, { crewIds: ["crew-a"], roles: [] }), true);
check("crew mismatch", templateMatchesWorker({ groups: { crewIds: ["crew-a"], roles: [] } }, { crewIds: ["crew-b"], roles: ["Crew"] }), false);
check("role match", templateMatchesWorker({ groups: { crewIds: ["crew-a"], roles: ["Field Lead"] } }, { crewIds: [], roles: ["Field Lead"] }), true);

if (failed) {
  console.log(`\n${failed} form-calc check(s) failed.`);
  process.exit(1);
}
console.log("\nAll form-calc checks passed.");

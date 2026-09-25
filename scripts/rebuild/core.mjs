// Rebuilds the sample data set (2026-09-25, owner request).
//
//   node scripts/rebuild-sample-data.mjs [--data ./data] [--photos "C:\Users\Braden\OneDrive - BioRemedy\Photos"] [--dry-run]
//
// Reads <data>/backend.json, keeps the reference collections (rate sheet catalog, document types,
// industries, units, templates, permits...), replaces every transactional collection with a fresh,
// internally consistent sample set built around the real roster (the people with bioremedy.com /
// micro-bac.com Microsoft logins), converts the chosen field photos from the OneDrive Photos folder
// into <data>/uploads, rewrites backend.json and data/demo-seed.json, and trims auth.json to the
// kept users. Every generated id is deterministic so the script can be re-run.
//
// The server must not be writing while this runs (it reads backend.json per request; a request that
// lands between our read and our write would be lost). Stop it, or run when nobody is saving.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dataDir = resolve(option("--data", process.env.CRM_DATA_DIR || join(projectRoot, "data")));
const photosDir = resolve(option("--photos", "C:\\Users\\Braden\\OneDrive - BioRemedy\\Photos"));
const dryRun = args.includes("--dry-run");
const pythonExe = option("--python", "C:\\Users\\Braden\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe");
const uploadsDir = join(dataDir, "uploads");

const backend = JSON.parse(readFileSync(join(dataDir, "backend.json"), "utf8"));

// ---- helpers ------------------------------------------------------------------------------------
const NOW = "2026-09-25T15:00:00.000Z";
const TODAY = "2026-09-25";
const CDT = "-05:00";
const CST = "-06:00";
const at = (date, time = "09:00", offset = CDT) => new Date(`${date}T${time}:00${offset}`).toISOString();
const dayOffset = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const money = (n) => Math.round(n * 100) / 100;
const stamp = (record, createdAt = NOW, updatedAt = createdAt) => ({ ...record, createdAt, updatedAt, version: 1 });
const out = {};
const push = (collection, record, createdAt, updatedAt) => {
  if (!out[collection]) out[collection] = [];
  const row = stamp(record, createdAt, updatedAt);
  out[collection].push(row);
  return row;
};

const productById = new Map(backend.products.map((p) => [p.id, p]));
const uomName = (id) => backend.unitsOfMeasure.find((u) => u.id === id)?.name || "";
function rate(productId, tier = "standard") {
  const row = backend.productPriceLevels.find((x) => x.productId === productId && x.priceLevelId === "price-standard-2026");
  if (!row) throw new Error(`No 2026 rate for ${productId}`);
  const tiered = tier === "ot_emergency" ? row.amountOtEmergency : tier === "double_time" ? row.amountDoubleTime : row.amount;
  const amount = tiered ?? row.amount; // equipment and materials carry one rate
  if (amount == null) throw new Error(`No ${tier} rate for ${productId}`);
  return { amount: Number(amount), uomId: row.uomId || productById.get(productId)?.defaultUomId || "" };
}
const P = (slug) => {
  const id = `prod-rs-${slug}`;
  if (!productById.has(id)) throw new Error(`Unknown product ${id}`);
  return id;
};

// ---- 1. reference collections kept as they are -----------------------------------------------
const referenceCollections = [
  "accountTypes", "industries", "subcontractorTypes", "certificationTypes", "connectionRoles", "unitGroups",
  "unitsOfMeasure", "transactionCurrencies", "priceLevels", "pricingSettings", "documentTypes", "businessUnits",
  "teams", "permits", "standbyRotationSettings", "qboSettings",
];
for (const key of Object.keys(backend)) out[key] = Array.isArray(backend[key]) ? [] : backend[key];
for (const key of referenceCollections) out[key] = structuredClone(backend[key]);

// The three generic cost-basis products are read by app.js; the other pre-import placeholders go.
const keepGeneric = new Set(["prod-field-labor-standard", "prod-equipment-standard-daily", "prod-material-standard-unit"]);
out.products = backend.products.filter((p) => p.category || keepGeneric.has(p.id));
const productIds = new Set(out.products.map((p) => p.id));
out.productPriceLevels = backend.productPriceLevels.filter((x) => productIds.has(x.productId));

// Job type templates: drop the test tasks added to the ER Mobilize stage and the "VIP" test template.
out.jobTypeTemplates = backend.jobTypeTemplates
  .filter((t) => t.id !== "jobtype-ms473opp-yaj6ss")
  .map((t) => ({
    ...t,
    updatedBy: "Braden Gilbert",
    stages: t.stages.map((s) => ({ ...s, tasks: s.tasks.filter((task) => !/^task-\d+-\d+$/.test(task.key)) })),
  }));
const templateById = new Map(out.jobTypeTemplates.map((t) => [t.id, t]));

// ---- 2. the real roster -----------------------------------------------------------------------
const EMP = {
  braden: "emp-braden",
  logan: "emp-logan",
  trey: "emp-trey",
  tristan: "emp-tristan",
  joe: "emp-joe",
  charlotte: "emp-charlotte",
};
const NAME = { braden: "Braden Gilbert", logan: "Logan Gallman", trey: "Trey Franklin", tristan: "Tristan Tarrant", joe: "Joe", charlotte: "Charlotte Stautzenberger" };
const USER = { braden: "user-braden", logan: "user-mufxiu60-brxind", tristan: "user-mufwltzb-370whz", charlotte: "user-mufzbbt9-3ihefu", trey: "user-trey", portal: "user-mufxcb6y-hs1tta" };

const employeeBase = { employmentStatus: "Active", employmentType: "Full time", businessUnit: "BioRemedy — Georgetown", homeBase: "Georgetown", availabilitySummary: "Available", hoursWorked: 0, capacity: 45 };
const employees = [
  { id: EMP.braden, employeeNumber: "BR-001", systemUserId: USER.braden, firstName: "Braden", lastName: "Gilbert", displayName: NAME.braden, jobTitle: "Owner", primaryEmail: "braden@bioremedy.com", mobilePhone: "", managerEmployeeId: "", teamId: "wf-team-office", crewId: "", dispatchEligible: true, frontlineEnabled: true, readinessStatus: "Ready", hireDate: "2023-01-02", skills: ["Sales", "Emergency response", "Drone operation"], laborProductId: P("senior-project-manager-er-manager-ic") },
  { id: EMP.logan, employeeNumber: "BR-002", systemUserId: USER.logan, firstName: "Logan", lastName: "Gallman", displayName: NAME.logan, jobTitle: "Operations Supervisor", primaryEmail: "logan@bioremedy.com", mobilePhone: "", managerEmployeeId: EMP.braden, teamId: "wf-team-ops", crewId: "crew-response-a", dispatchEligible: true, frontlineEnabled: true, readinessStatus: "Ready", hireDate: "2024-03-04", skills: ["Emergency response", "Vactron operation", "CDL Class B", "Confined space"], laborProductId: P("supervisor") },
  { id: EMP.trey, employeeNumber: "BR-003", systemUserId: USER.trey, firstName: "Trey", lastName: "Franklin", displayName: NAME.trey, jobTitle: "Director of Sales", primaryEmail: "trey@bioremedy.com", mobilePhone: "", managerEmployeeId: EMP.braden, teamId: "wf-team-office", crewId: "", dispatchEligible: true, frontlineEnabled: true, readinessStatus: "Ready", hireDate: "2024-06-10", skills: ["Sales", "Site walks", "Emergency response"], laborProductId: P("technician-hazmat-trained-confined-space-certified") },
  { id: EMP.tristan, employeeNumber: "BR-004", systemUserId: USER.tristan, firstName: "Tristan", lastName: "Tarrant", displayName: NAME.tristan, jobTitle: "Environmental Technician", primaryEmail: "tristan@bioremedy.com", mobilePhone: "", managerEmployeeId: EMP.logan, teamId: "wf-team-ops", crewId: "crew-response-a", dispatchEligible: true, frontlineEnabled: true, readinessStatus: "Ready", hireDate: "2025-02-17", skills: ["Emergency response", "Absorbent deployment", "Inventory"], laborProductId: P("technician-hazmat-trained-confined-space-certified") },
  { id: EMP.joe, employeeNumber: "BR-005", systemUserId: "", firstName: "Joe", lastName: "", displayName: NAME.joe, jobTitle: "Environmental Technician", primaryEmail: "", mobilePhone: "", managerEmployeeId: EMP.logan, teamId: "wf-team-ops", crewId: "crew-response-a", dispatchEligible: true, frontlineEnabled: true, readinessStatus: "Ready", hireDate: "2025-08-04", skills: ["Emergency response", "Pressure washing", "Skid steer"], laborProductId: P("technician-hazmat-trained-confined-space-certified") },
  { id: EMP.charlotte, employeeNumber: "BR-006", systemUserId: USER.charlotte, firstName: "Charlotte", lastName: "Stautzenberger", displayName: NAME.charlotte, jobTitle: "Office Manager", primaryEmail: "charlotte@bioremedy.com", mobilePhone: "", managerEmployeeId: EMP.braden, teamId: "wf-team-office", crewId: "", dispatchEligible: false, frontlineEnabled: false, readinessStatus: "Office", hireDate: "2025-05-12", skills: ["Accounts payable", "Dispatch intake", "Customer paperwork"], laborProductId: P("administration") },
];
for (const e of employees) push("employees", { ...employeeBase, ...e }, "2026-09-25T14:00:00.000Z");

// System users: keep the real Microsoft logins, link them to their employee records, add Trey.
const oldUsers = new Map(backend.systemUsers.map((u) => [u.id, u]));
const userRows = [
  { ...oldUsers.get(USER.braden), title: "Owner", employeeId: EMP.braden, roles: ["Admin", "Account Manager", "Finance Manager"] },
  { ...oldUsers.get(USER.logan), title: "Operations Supervisor", employeeId: EMP.logan, role: "Operations Manager", roles: ["Operations Manager"] },
  { ...oldUsers.get(USER.tristan), title: "Environmental Technician", employeeId: EMP.tristan, role: "Field Lead", roles: ["Field Lead", "Inventory Manager"] },
  { ...oldUsers.get(USER.charlotte), title: "Office Manager", employeeId: EMP.charlotte, role: "Office Manager", roles: ["Office Manager"] },
  // Braden's micro-bac.com login, provisioned as a Client Portal user on first sign-in. Scoped to a
  // sample customer so the portal can be tested with it.
  { ...oldUsers.get(USER.portal), title: "Client portal test login", clientAccountId: "acct-city-georgetown" },
  { id: USER.trey, businessUnitId: "bu-bioremedy", fullName: NAME.trey, username: "trey", internalEmailAddress: "trey@bioremedy.com", title: "Director of Sales", role: "Sales Manager", roles: ["Sales Manager"], employeeId: EMP.trey, clientAccountId: "", isDisabled: false, createdBy: "rebuild-sample-data" },
];
for (const u of userRows) {
  if (!u || !u.id) throw new Error("A real system user record is missing from backend.json");
  const { createdAt, updatedAt, version, ...rest } = u;
  push("systemUsers", { ...rest, deletedAt: undefined }, createdAt || NOW, NOW);
}

// Teams, crews, memberships.
push("workforceTeams", { id: "wf-team-ops", code: "OPS", name: "Field Operations", managerEmployeeId: EMP.logan, businessUnit: "BioRemedy — Georgetown", status: "Active" });
push("workforceTeams", { id: "wf-team-office", code: "OFFICE", name: "Sales & Office", managerEmployeeId: EMP.braden, businessUnit: "BioRemedy — Georgetown", status: "Active" });
push("crewProfiles", { id: "crew-response-a", code: "RESP-A", name: "Response Crew A", type: "Emergency response", supervisorEmployeeId: EMP.logan, status: "Active", timezone: "America/Chicago", requiredCertTypeIds: ["certtype-hazwoper-40"] });
for (const [i, [emp, team, role]] of [[EMP.logan, "wf-team-ops", "Supervisor"], [EMP.tristan, "wf-team-ops", "Technician"], [EMP.joe, "wf-team-ops", "Technician"], [EMP.braden, "wf-team-office", "Owner"], [EMP.trey, "wf-team-office", "Director of Sales"], [EMP.charlotte, "wf-team-office", "Office Manager"]].entries()) {
  push("workforceTeamMemberships", { id: `tm-${emp.replace("emp-", "")}-${team.replace("wf-team-", "")}`, teamId: team, employeeId: emp, role, primary: true, status: "Active" });
}
// Trey and Braden fill in on the crew when needed.
push("workforceTeamMemberships", { id: "tm-trey-crew", crewId: "crew-response-a", employeeId: EMP.trey, role: "Fill-in technician", primary: false, status: "Active" });
push("workforceTeamMemberships", { id: "tm-braden-crew", crewId: "crew-response-a", employeeId: EMP.braden, role: "Fill-in / incident commander", primary: false, status: "Active" });

// Certifications.
const cert = (emp, key, certTypeId, recordType, code, name, issuedOn, years, extra = {}) => {
  const expiresOn = `${Number(issuedOn.slice(0, 4)) + years}${issuedOn.slice(4)}`;
  const status = expiresOn < TODAY ? "Expired" : expiresOn < dayOffset(TODAY, 60) ? "Expiring" : "Valid";
  push("employeeCertifications", { id: `cert-${emp.replace("emp-", "")}-${key}`, employeeId: emp, certTypeId, recordType, code, name, number: "", issuedOn, expiresOn, status, assignmentStatus: "Completed", trainingStartedOn: "", trainingCompletedOn: issuedOn, verified: true, ...extra });
};
cert(EMP.logan, "hazwoper", "certtype-hazwoper-40", "Certification", "HAZWOPER-40", "HAZWOPER 40-Hour", "2024-03-18", 5);
cert(EMP.logan, "refresher", "certtype-hazwoper-refresher", "Training", "HAZWOPER-8", "HAZWOPER 8-Hour Refresher", "2026-03-02", 1);
cert(EMP.logan, "supervisor", "certtype-hazwoper-supervisor", "Certification", "HAZWOPER-SUP", "HAZWOPER Supervisor", "2025-04-14", 3);
cert(EMP.logan, "cdl", "certtype-cdl-b", "Credential", "CDL-B", "Commercial Driver's License (Class B)", "2024-09-09", 4);
cert(EMP.logan, "vactron", "certtype-vactron", "Qualification", "VACTRON", "Vactron Operator Qualification", "2025-01-20", 2);
cert(EMP.logan, "confined", "certtype-confined-space", "Certification", "CSE", "Confined Space Entry", "2026-06-01", 1);
cert(EMP.logan, "fit", "certtype-respirator-fit", "Clearance", "RESP-FIT", "Respirator Fit Test", "2026-02-10", 1);
cert(EMP.tristan, "hazwoper", "certtype-hazwoper-40", "Certification", "HAZWOPER-40", "HAZWOPER 40-Hour", "2025-03-03", 5);
cert(EMP.tristan, "refresher", "certtype-hazwoper-refresher", "Training", "HAZWOPER-8", "HAZWOPER 8-Hour Refresher", "2026-03-02", 1);
cert(EMP.tristan, "fit", "certtype-respirator-fit", "Clearance", "RESP-FIT", "Respirator Fit Test", "2026-02-10", 1);
cert(EMP.tristan, "confined", "certtype-confined-space", "Certification", "CSE", "Confined Space Entry", "2025-10-06", 1);
cert(EMP.tristan, "dot", "certtype-dot-awareness", "Training", "DOT-AWARE", "DOT Hazmat Awareness", "2026-03-16", 1);
cert(EMP.joe, "hazwoper", "certtype-hazwoper-40", "Certification", "HAZWOPER-40", "HAZWOPER 40-Hour", "2025-08-25", 5);
cert(EMP.joe, "refresher", "certtype-hazwoper-refresher", "Training", "HAZWOPER-8", "HAZWOPER 8-Hour Refresher", "2025-10-20", 1); // expiring soon
cert(EMP.joe, "fit", "certtype-respirator-fit", "Clearance", "RESP-FIT", "Respirator Fit Test", "2026-02-10", 1);
cert(EMP.joe, "dl", "certtype-drivers-license", "Credential", "DL-TX", "Driver's License", "2023-05-30", 8);
cert(EMP.trey, "hazwoper", "certtype-hazwoper-40", "Certification", "HAZWOPER-40", "HAZWOPER 40-Hour", "2024-07-15", 5);
cert(EMP.trey, "refresher", "certtype-hazwoper-refresher", "Training", "HAZWOPER-8", "HAZWOPER 8-Hour Refresher", "2025-07-07", 1); // expired: needs the refresher
cert(EMP.braden, "hazwoper", "certtype-hazwoper-40", "Certification", "HAZWOPER-40", "HAZWOPER 40-Hour", "2023-02-06", 5);
cert(EMP.braden, "refresher", "certtype-hazwoper-refresher", "Training", "HAZWOPER-8", "HAZWOPER 8-Hour Refresher", "2026-03-02", 1);
cert(EMP.braden, "supervisor", "certtype-hazwoper-supervisor", "Certification", "HAZWOPER-SUP", "HAZWOPER Supervisor", "2024-05-13", 3);

push("frontlineDevices", { id: "device-logan-ipad", deviceIdentifier: "BR-IPAD-002", displayName: "Logan field iPad", employeeId: EMP.logan, ownership: "Company", platform: "iPadOS", hardwareModel: "iPad (10th gen)", imei: "", osVersion: "18.4", appVersion: "0.9.6", onboardedAt: "2026-06-01", registrationStatus: "Active", syncStatus: "Healthy", lastSeenAt: "2026-09-25T13:10:00.000Z", pendingCommands: 0 });
push("frontlineDevices", { id: "device-tristan-phone", deviceIdentifier: "BR-PHONE-004", displayName: "Tristan field phone", employeeId: EMP.tristan, ownership: "Company", platform: "iOS", hardwareModel: "iPhone 15", imei: "", osVersion: "18.4", appVersion: "0.9.6", onboardedAt: "2026-06-01", registrationStatus: "Active", syncStatus: "Healthy", lastSeenAt: "2026-09-25T12:48:00.000Z", pendingCommands: 0 });
push("frontlineDevices", { id: "device-joe-phone", deviceIdentifier: "BR-PHONE-005", displayName: "Joe field phone", employeeId: EMP.joe, ownership: "Company", platform: "Android", hardwareModel: "Samsung Galaxy S24", imei: "", osVersion: "15", appVersion: "0.9.5", onboardedAt: "2026-08-11", registrationStatus: "Active", syncStatus: "Update required", lastSeenAt: "2026-09-24T22:05:00.000Z", pendingCommands: 1 });

push("availabilityBlocks", { id: "avail-tristan-pto", employeeId: EMP.tristan, type: "Unavailable", startsAt: at("2026-10-05", "00:00"), endsAt: at("2026-10-09", "23:59"), reason: "Vacation", status: "Approved" });
push("availabilityBlocks", { id: "avail-joe-refresher", employeeId: EMP.joe, type: "Unavailable", startsAt: at("2026-10-14", "08:00"), endsAt: at("2026-10-14", "17:00"), reason: "HAZWOPER 8-hour refresher class", status: "Approved" });
push("standbyAssignments", { id: "standby-logan-weekend", employeeId: EMP.logan, startsAt: at("2026-09-25", "17:00"), endsAt: at("2026-09-28", "07:00"), notes: "Primary weekend on-call", createdBy: NAME.braden });
push("standbyAssignments", { id: "standby-tristan-weekend", employeeId: EMP.tristan, startsAt: at("2026-10-02", "17:00"), endsAt: at("2026-10-05", "07:00"), notes: "Primary weekend on-call", createdBy: NAME.logan });

export { out, backend, employees, EMP, NAME, USER, push, at, dayOffset, money, rate, P, uomName, productById, templateById, NOW, TODAY, CDT, CST, dataDir, photosDir, uploadsDir, dryRun, pythonExe, referenceCollections, stamp };

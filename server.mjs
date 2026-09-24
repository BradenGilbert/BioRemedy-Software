import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename, appendFile } from "node:fs/promises";
import { createHash, randomBytes, scryptSync, timingSafeEqual, createPublicKey, verify } from "node:crypto";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackupCycle } from "./scripts/backup-lib.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

// A `.env` file in the project root (gitignored) holds machine settings such as CRM_BACKUP_DIR so
// they survive restarts without system environment variables. Real environment variables win.
function loadDotEnv() {
  const envFile = path.join(root, ".env");
  if (!existsSync(envFile)) return;
  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const basePort = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
// CRM_DATA_DIR points a test instance at a scratch copy so click-tests never write to the real data.
const dataDir = process.env.CRM_DATA_DIR ? path.resolve(process.env.CRM_DATA_DIR) : path.join(root, "data");
const dataFile = path.join(dataDir, "backend.json");
const uploadsDir = path.join(dataDir, "uploads");
const maxJobRequestDocumentBytes = 25 * 1024 * 1024;
// Phase 20 item 3 (2026-09-23): the server takes its own verified snapshots -- on startup and every
// CRM_BACKUP_INTERVAL_MINUTES (default 4 hours) -- into <data>/backups (rolling 10), and mirrors the
// newest one plus uploads/ to CRM_BACKUP_DIR when set (rolling 30; a OneDrive-synced folder is the
// intended off-machine copy). CRM_BACKUP_INTERVAL_MINUTES=0 turns the schedule off (scratch servers).
const backupDir = path.join(dataDir, "backups");
const offMachineBackupDir = process.env.CRM_BACKUP_DIR ? path.resolve(process.env.CRM_BACKUP_DIR) : "";
const backupIntervalMinutes = process.env.CRM_BACKUP_INTERVAL_MINUTES === undefined ? 240 : Number(process.env.CRM_BACKUP_INTERVAL_MINUTES);
// Phase 20 item 4 (2026-09-23): demo data is seeded only when asked for. With the flag off an empty
// collection stays empty; scripts/reset-demo-data.mjs puts the demo set back on purpose.
const seedDemoData = process.env.CRM_SEED_DEMO === "1";
const demoSeedFile = path.join(root, "data", "demo-seed.json");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".glb", "model/gltf-binary"],
]);

// Phase 20 item 0 (2026-09-23): the only files the static branch serves outside public/. Everything
// else under the project root -- data/backend.json, server.mjs, .git/, docs/, the log files -- is
// not a web asset and must never be reachable by URL.
const staticAllowlist = new Set(["index.html", "app.js", "styles.css", "service-worker.js", "manifest.webmanifest"]);

const roleAccess = {
  sales: ["Admin", "Office Manager", "Sales Manager", "Account Manager"],
  // Accounts and contacts are referenced by almost every workspace — a dispatch job needs the
  // customer name, a project belongs to an account, an invoice bills one. Before roadmap Phase 01
  // these lived in browser IndexedDB with no gating at all, so this group deliberately spans every
  // internal role to avoid a regression. The Client Portal role is excluded: it must never receive
  // the whole customer directory. Real authorization lands in Phase 06.
  customerDirectory: [
    "Admin",
    "Office Manager",
    "Sales Manager",
    "Account Manager",
    "Operations Manager",
    "Scheduler",
    "Field Lead",
    "Inventory Manager",
    "Finance Manager",
  ],
  salesDocuments: ["Admin", "Office Manager", "Sales Manager", "Account Manager", "Finance Manager"],
  operations: ["Admin", "Office Manager", "Operations Manager", "Scheduler", "Field Lead"],
  workforce: ["Admin", "Office Manager", "Operations Manager", "Scheduler"],
  dispatch: ["Admin", "Office Manager", "Operations Manager", "Scheduler", "Field Lead"],
  inventory: ["Admin", "Office Manager", "Operations Manager", "Inventory Manager"],
  finance: ["Admin", "Office Manager", "Finance Manager"],
  identity: [
    "Admin",
    "Office Manager",
    "Sales Manager",
    "Account Manager",
    "Operations Manager",
    "Scheduler",
    "Field Lead",
    "Inventory Manager",
    "Finance Manager",
    // Phase 13 (2026-09-24): a customer login reads the backend too -- filterBackendForRole scopes it
    // to their own account before it leaves the server.
    "Client Portal",
  ],
};

const collectionAccess = {
  scheduleEvents: "operations",
  locations: "operations",
  scheduledWork: "operations",
  projectAssignments: "customerDirectory",
  projectAlerts: "operations",
  materialUsage: "operations",
  equipmentLogs: "operations",
  spatialData: "operations",
  inventoryItems: "inventory",
  purchaseOrders: "inventory",
  // Phase 11 (2026-09-23): stock-movement ledger. Append-only — see the POST guard in handleApi.
  inventoryMovements: "inventory",
  equipmentAssets: "inventory",
  equipmentMaintenanceRecords: "inventory",
  equipmentRestockItems: "inventory",
  laborAssignments: "operations",
  sampleRecords: "operations",
  sampleLabReports: "operations",
  // Phase 11 (2026-09-23) — structured analytical result rows per sample, one row per analyte.
  // Same domain and access shape as sampleRecords/sampleLabReports since it's the same workflow.
  sampleResults: "operations",
  employees: "workforce",
  employeeCertifications: "workforce",
  certificationTypes: "workforce",
  workforceTeams: "workforce",
  workforceTeamMemberships: "workforce",
  crewProfiles: "workforce",
  availabilityBlocks: "workforce",
  standbyAssignments: "workforce",
  standbyRotationSettings: "workforce",
  frontlineDevices: "workforce",
  timeEntries: "operations",
  jobMileageEntries: "operations",
  messages: "dispatch",
  inventoryAlerts: "dispatch",
  // Phase 18 item 4 (2026-09-23): append-only GPS consent records; written only by /api/auth/consent.
  gpsConsents: "dispatch",
  // Messages to IT (owner, 2026-09-24): one thread per signed-in person; scoped in the routes below.
  itMessages: "identity",
  // Phase 13 (2026-09-24): the document store, its type catalog and tracked requirements.
  documents: "customerDirectory",
  documentTypes: "customerDirectory",
  documentRequirements: "customerDirectory",
  jobRequests: "dispatch",
  jobRequestDocuments: "dispatch",
  dispatchJobs: "dispatch",
  jobAssignments: "dispatch",
  jobScheduleSegments: "dispatch",
  jobResources: "dispatch",
  jobConflicts: "dispatch",
  jobSteps: "dispatch",
  jobActions: "dispatch",
  jobFormSubmissions: "dispatch",
  jobTypeTemplates: "dispatch",
  jobStatusEvents: "dispatch",
  jobTaskAttachments: "dispatch",
  // Phase 10 (2026-09-22 pass): field receipts/expenses per dispatch job; the photo itself lives in
  // jobTaskAttachments (kind "receipt") until Phase 13's generic store exists.
  jobExpenses: "dispatch",
  // Phase 11 (2026-09-23). Weather snapshots are read here but only ever written by the capture
  // route below (immutable by design, Q41). Permits and waste records are the company's own
  // regulatory record. Notifications go to every internal role, so they sit in the widest domain.
  weatherSnapshots: "operations",
  permits: "operations",
  wasteRecords: "operations",
  notifications: "customerDirectory",
  invoices: "finance",
  qboExports: "finance",
  businessUnits: "salesDocuments",
  systemUsers: "salesDocuments",
  teams: "salesDocuments",
  transactionCurrencies: "salesDocuments",
  unitGroups: "salesDocuments",
  unitsOfMeasure: "salesDocuments",
  priceLevels: "salesDocuments",
  products: "salesDocuments",
  productPriceLevels: "salesDocuments",
  // Phase 08 rate-card rework — admin-maintained fuel surcharge % and the 18% energy/security fee.
  pricingSettings: "salesDocuments",
  opportunities: "sales",
  leads: "sales",
  opportunityContacts: "sales",
  // Phase 06 items 30/31 — opportunity <-> facility/location junction. Same shape/domain as
  // opportunityContacts, the pattern that worked for the same "single scalar can't represent a
  // multi-site opportunity" problem.
  opportunityLocations: "sales",
  opportunityAssignments: "sales",
  opportunityProducts: "salesDocuments",
  quotes: "salesDocuments",
  quoteLines: "salesDocuments",
  estimates: "salesDocuments",
  estimateLines: "salesDocuments",
  salesOrders: "salesDocuments",
  salesOrderLines: "salesDocuments",
  invoiceLines: "finance",
  competitors: "sales",
  opportunityCompetitors: "sales",
  annotations: "salesDocuments",
  connectionRoles: "salesDocuments",
  connections: "salesDocuments",
  activityParties: "salesDocuments",
  accounts: "customerDirectory",
  contacts: "customerDirectory",
  projects: "customerDirectory",
  tasks: "customerDirectory",
  activities: "customerDirectory",
  accountTypes: "sales",
  industries: "sales",
  accountIndustries: "sales",
  addresses: "sales",
  facilities: "sales",
  facilityContacts: "sales",
  facilityComments: "sales",
  salesTasks: "sales",
  accountRelationshipExtensions: "sales",
  accountComments: "sales",
  accountDivisions: "sales",
  contactEmploymentHistory: "sales",
  subcontractorTypes: "salesDocuments",
  vendorProfiles: "salesDocuments",
  serviceAgreements: "salesDocuments",
  subcontractorAssignments: "salesDocuments",
  accountApprovedSubcontractors: "salesDocuments",
};

const defaultBackend = {
  // Seeded by the client on first load from the `seed*` arrays in app.js, so the demo data keeps one
  // definition and one shape-builder (`buildCore*Record`) rather than drifting in two places.
  accounts: [],
  contacts: [],
  projects: [],
  tasks: [],
  activities: [],
  projectAssignments: [],
  projectAlerts: [],
  materialUsage: [],
  equipmentLogs: [],
  scheduledWork: [],
  spatialData: [],
  scheduleEvents: [
    {
      id: "sched-riverbend-mobilize",
      projectId: "job-riverbend-ust",
      title: "Riverbend mobilization and utility markout",
      date: "2026-07-09",
      crew: "Crew A",
      equipmentAssetTags: ["PMP-077"],
      laborResourceIds: ["labor-priya", "labor-noah"],
      requiredCertifications: ["HAZWOPER"],
      status: "Scheduled",
      blockedReason: "",
    },
    {
      id: "sched-clearwater-containment",
      projectId: "job-clearwater-abatement",
      title: "Clearwater containment setup",
      date: "2026-07-15",
      crew: "Abatement Crew",
      equipmentAssetTags: ["AIR-112"],
      laborResourceIds: ["labor-samira"],
      requiredCertifications: ["Asbestos Worker"],
      status: "Scheduled",
      blockedReason: "",
    },
  ],
  locations: [
    {
      id: "map-riverbend-yard",
      projectId: "job-riverbend-ust",
      label: "Riverbend south yard",
      latitude: 38.627,
      longitude: -90.1994,
      assetTags: ["PMP-077"],
      status: "Pre-mobilization",
      lastPingAt: "2026-07-06T14:10:00.000Z",
    },
    {
      id: "map-i130-response",
      projectId: "job-north-river-i130",
      label: "I-130 response area",
      latitude: 39.0997,
      longitude: -94.5786,
      assetTags: ["VAC-204", "TRK-18"],
      status: "Active dispatch",
      lastPingAt: "2026-07-06T14:22:00.000Z",
    },
  ],
  inventoryItems: [
    { id: "inv-absorbents", materialType: "Absorbents", unit: "bags", onHand: 34, reorderAt: 30, targetStock: 80, buyer: "Operations buyer", barcode: "8412007723019" },
    { id: "inv-sampling-jars", materialType: "Sampling containers", unit: "jars", onHand: 52, reorderAt: 36, targetStock: 120, buyer: "Operations buyer", barcode: "8412007723026" },
    { id: "inv-ppe-kits", materialType: "PPE kits", unit: "kits", onHand: 14, reorderAt: 18, targetStock: 50, buyer: "Safety buyer", barcode: "8412007723033" },
    { id: "inv-disposal-drums", materialType: "Disposal drums", unit: "drums", onHand: 9, reorderAt: 12, targetStock: 35, buyer: "Operations buyer", barcode: "" },
  ],
  purchaseOrders: [
    {
      id: "po-ppe-20260706",
      itemId: "inv-ppe-kits",
      materialType: "PPE kits",
      quantity: 36,
      vendor: "Midwest Safety Supply",
      status: "Draft",
      requestedBy: "Renee Carter",
      createdAt: "2026-07-06T15:05:00.000Z",
    },
  ],
  // Phase 11 (2026-09-23): stock-movement ledger — one row per onHand change, written server-side
  // only (see handleReceivePurchaseOrder, handleJobTaskConsume, and the inventoryItems POST branch).
  inventoryMovements: [],
  equipmentAssets: [
    {
      id: "asset-vac-204",
      assetTag: "VAC-204",
      equipment: "Vacuum trailer",
      category: "Vacuum / Vactron",
      status: "In service",
      maintenanceDue: "2026-07-18",
      lastUsed: "2026-07-03",
      assignedProjectId: "job-north-river-i130",
      issue: "",
      specs: { tankCapacity: "3,600 gal", pumpPressure: "27 in-Hg", engineHours: "812", deconStatus: "Clean" },
    },
    {
      id: "asset-pmp-077",
      assetTag: "PMP-077",
      equipment: "Transfer pump",
      category: "Pump",
      status: "Ready",
      maintenanceDue: "2026-08-04",
      lastUsed: "2026-07-02",
      assignedProjectId: "job-riverbend-ust",
      issue: "",
      specs: { flowRate: "110 GPM", hoseSize: "3 in", engineHours: "240" },
    },
    {
      id: "asset-trk-18",
      assetTag: "TRK-18",
      equipment: "Response truck",
      category: "Vehicle",
      status: "Maintenance hold",
      maintenanceDue: "2026-07-06",
      lastUsed: "2026-07-03",
      assignedProjectId: "job-north-river-i130",
      issue: "Hydraulic lift inspection failed. Scheduler should avoid assignment.",
      specs: { vin: "1FT7X2B69JEA14207", licensePlate: "TX-BR1802", mileage: "58,410", fuelType: "Diesel" },
    },
    {
      id: "asset-air-112",
      assetTag: "AIR-112",
      equipment: "Negative air machine",
      category: "Air Filtration",
      status: "Ready",
      maintenanceDue: "2026-07-30",
      lastUsed: "2026-06-27",
      assignedProjectId: "job-clearwater-abatement",
      issue: "",
      specs: { cfmRating: "1,200 CFM", filterType: "HEPA", filterChangeInterval: "90 days" },
    },
  ],
  equipmentMaintenanceRecords: [
    {
      id: "maint-trk-18-hydraulic",
      assetTag: "TRK-18",
      type: "Repair",
      date: "2026-07-06",
      description: "Hydraulic lift failed inspection. Sent to vendor for cylinder replacement.",
      performedBy: "Midwest Fleet Service",
      cost: 1450,
      nextDueDate: "2026-07-06",
    },
    {
      id: "maint-vac-204-service",
      assetTag: "VAC-204",
      type: "Scheduled service",
      date: "2026-06-18",
      description: "Routine vacuum trailer service: hoses inspected, decon complete.",
      performedBy: "Priya Patel",
      cost: 0,
      nextDueDate: "2026-07-18",
    },
  ],
  equipmentRestockItems: [
    { id: "restock-air-112-filter", assetTag: "AIR-112", itemName: "HEPA filter", quantityNeeded: 2, unit: "filters", status: "Needed", notes: "Change interval coming up in August." },
  ],
  employees: [
    {
      id: "emp-logan",
      employeeNumber: "BR-014",
      systemUserId: "user-logan",
      firstName: "Logan",
      lastName: "Gallman",
      displayName: "Logan Gallman",
      jobTitle: "Field Supervisor",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "logan.gallman@bioremedy.example.com",
      mobilePhone: "(254) 555-0114",
      managerEmployeeId: "emp-priya",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-response",
      crewId: "crew-er-alpha",
      homeBase: "Temple",
      availabilitySummary: "On call through Jul 27",
      hoursWorked: 22,
      capacity: 45,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2022-03-14",
      skills: ["Emergency response", "Vactron operator", "Storm drain protection"],
    },
    {
      id: "emp-trey",
      employeeNumber: "BR-021",
      systemUserId: "user-trey",
      firstName: "Trey",
      lastName: "Foster",
      displayName: "Trey Foster",
      jobTitle: "Response Technician",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "trey.foster@bioremedy.example.com",
      mobilePhone: "(254) 555-0121",
      managerEmployeeId: "emp-logan",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-response",
      crewId: "crew-er-alpha",
      homeBase: "Temple",
      availabilitySummary: "Available now",
      hoursWorked: 31,
      capacity: 45,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Expiring",
      hireDate: "2023-08-07",
      skills: ["Emergency response", "Truck operation", "Absorbent deployment"],
    },
    {
      id: "emp-tristan",
      employeeNumber: "BR-027",
      systemUserId: "user-tristan",
      firstName: "Tristan",
      lastName: "Cole",
      displayName: "Tristan Cole",
      jobTitle: "Environmental Technician",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "tristan.cole@bioremedy.example.com",
      mobilePhone: "(254) 555-0127",
      managerEmployeeId: "emp-logan",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-response",
      crewId: "crew-er-alpha",
      homeBase: "Temple",
      availabilitySummary: "Available after 2:00 PM",
      hoursWorked: 27,
      capacity: 40,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2024-01-22",
      skills: ["Emergency response", "Soil handling", "Photo documentation"],
    },
    {
      id: "emp-priya",
      employeeNumber: "BR-006",
      systemUserId: "user-priya",
      firstName: "Priya",
      lastName: "Patel",
      displayName: "Priya Patel",
      jobTitle: "Operations Manager",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "priya.patel@example.com",
      mobilePhone: "(254) 555-0106",
      managerEmployeeId: "",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-response",
      crewId: "",
      homeBase: "Temple",
      availabilitySummary: "Mon-Fri 7:00 AM-5:00 PM",
      hoursWorked: 36,
      capacity: 45,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2019-05-13",
      skills: ["Incident command", "Emergency response", "Project supervision"],
    },
    {
      id: "emp-noah",
      employeeNumber: "BR-011",
      systemUserId: "user-noah",
      firstName: "Noah",
      lastName: "Brooks",
      displayName: "Noah Brooks",
      jobTitle: "Environmental Sampler",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "noah.brooks@example.com",
      mobilePhone: "(254) 555-0111",
      managerEmployeeId: "emp-priya",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-sampling",
      crewId: "crew-sampling-one",
      homeBase: "Temple",
      availabilitySummary: "Unavailable Jul 26, 1:00-4:00 PM",
      hoursWorked: 31,
      capacity: 40,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2021-09-20",
      skills: ["Soil sampling", "Chain of custody", "GPS capture"],
    },
    {
      id: "emp-renee",
      employeeNumber: "BR-004",
      systemUserId: "user-renee",
      firstName: "Renee",
      lastName: "Carter",
      displayName: "Renee Carter",
      jobTitle: "Dispatcher",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "renee.carter@example.com",
      mobilePhone: "(254) 555-0104",
      managerEmployeeId: "",
      businessUnit: "Office and Dispatch",
      teamId: "wf-team-dispatch",
      crewId: "",
      homeBase: "Temple",
      availabilitySummary: "Mon-Fri 8:00 AM-5:00 PM",
      hoursWorked: 42,
      capacity: 45,
      dispatchEligible: false,
      frontlineEnabled: false,
      readinessStatus: "Office",
      hireDate: "2018-11-05",
      skills: ["Dispatch", "Resource coordination", "DOT awareness"],
    },
    {
      id: "emp-samira",
      employeeNumber: "BR-019",
      systemUserId: "user-samira",
      firstName: "Samira",
      lastName: "Holt",
      displayName: "Samira Holt",
      jobTitle: "Abatement Technician",
      employmentStatus: "Active",
      employmentType: "Full time",
      primaryEmail: "samira.holt@example.com",
      mobilePhone: "(254) 555-0119",
      managerEmployeeId: "emp-priya",
      businessUnit: "Central Texas Operations",
      teamId: "wf-team-response",
      crewId: "",
      homeBase: "Temple",
      availabilitySummary: "Tue-Sat 7:00 AM-3:00 PM",
      hoursWorked: 28,
      capacity: 40,
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Blocked",
      hireDate: "2022-10-17",
      skills: ["Asbestos abatement", "Containment setup", "Negative air"],
    },
  ],
  certificationTypes: [
    { id: "certtype-hazwoper-40", name: "HAZWOPER 40-Hour", category: "Safety", issuingBody: "OSHA", renewalIntervalMonths: null, status: "Active" },
    { id: "certtype-hazwoper-refresher", name: "HAZWOPER 8-Hour Refresher", category: "Safety", issuingBody: "OSHA", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-hazwoper-supervisor", name: "HAZWOPER Supervisor", category: "Safety", issuingBody: "OSHA", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-cdl-b", name: "Commercial Driver's License (Class B)", category: "Driving", issuingBody: "State DMV", renewalIntervalMonths: 48, status: "Active" },
    { id: "certtype-vactron", name: "Vactron Operator Qualification", category: "Equipment", issuingBody: "BioRemedy internal", renewalIntervalMonths: 24, status: "Active" },
    { id: "certtype-drivers-license", name: "Driver's License", category: "Driving", issuingBody: "State DMV", renewalIntervalMonths: 48, status: "Active" },
    { id: "certtype-respirator-fit", name: "Respirator Fit Test", category: "Safety", issuingBody: "BioRemedy internal", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-soil-sampling", name: "Soil Sampling & Chain-of-Custody", category: "Technical", issuingBody: "BioRemedy internal", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-asbestos-worker", name: "Asbestos Worker Certification", category: "Compliance", issuingBody: "State Asbestos Program", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-dot-awareness", name: "DOT Hazmat Awareness", category: "Compliance", issuingBody: "DOT", renewalIntervalMonths: 12, status: "Active" },
    { id: "certtype-confined-space", name: "Confined Space Entry", category: "Safety", issuingBody: "OSHA", renewalIntervalMonths: 12, status: "Active" },
  ],
  employeeCertifications: [
    { id: "cert-logan-hazwoper", employeeId: "emp-logan", recordType: "Certification", code: "HAZWOPER-40", name: "40-hour HAZWOPER", issuedOn: "2025-10-02", expiresOn: "2026-10-02", status: "Valid", verified: true },
    { id: "cert-logan-cdl", employeeId: "emp-logan", recordType: "Credential", code: "CDL-B", name: "Texas CDL Class B", number: "TX-B-884021", issuedOn: "2024-04-12", expiresOn: "2028-04-12", status: "Valid", verified: true },
    { id: "cert-logan-vactron", employeeId: "emp-logan", recordType: "Qualification", code: "VACTRON", name: "Vactron operator", issuedOn: "2025-02-11", expiresOn: "2027-02-11", status: "Valid", verified: true },
    { id: "cert-trey-hazwoper", employeeId: "emp-trey", recordType: "Certification", code: "HAZWOPER-8", name: "HAZWOPER annual refresher", issuedOn: "2025-08-15", expiresOn: "2026-08-15", status: "Expiring", verified: true },
    { id: "cert-trey-driver", employeeId: "emp-trey", recordType: "Credential", code: "DL-TX", name: "Texas driver license", number: "TX-4450291", issuedOn: "2024-01-18", expiresOn: "2029-01-18", status: "Valid", verified: true },
    { id: "cert-tristan-hazwoper", employeeId: "emp-tristan", recordType: "Certification", code: "HAZWOPER-40", name: "40-hour HAZWOPER", issuedOn: "2026-02-03", expiresOn: "2027-02-03", status: "Valid", verified: true },
    { id: "cert-tristan-respirator", employeeId: "emp-tristan", recordType: "Clearance", code: "RESP-FIT", name: "Respirator fit test", issuedOn: "2026-03-10", expiresOn: "2027-03-10", status: "Valid", verified: true },
    { id: "cert-priya-hazwoper", employeeId: "emp-priya", recordType: "Certification", code: "HAZWOPER-SUP", name: "HAZWOPER supervisor", issuedOn: "2026-01-09", expiresOn: "2027-01-09", status: "Valid", verified: true },
    { id: "cert-noah-sampling", employeeId: "emp-noah", recordType: "Certification", code: "SOIL-SAMPLE", name: "Soil sampling and COC", issuedOn: "2026-04-21", expiresOn: "2027-04-21", status: "Valid", verified: true },
    { id: "cert-samira-asbestos", employeeId: "emp-samira", recordType: "Certification", code: "ASBESTOS-W", name: "Asbestos worker", issuedOn: "2025-06-30", expiresOn: "2026-06-30", status: "Expired", verified: true },
    { id: "cert-samira-respirator", employeeId: "emp-samira", recordType: "Clearance", code: "RESP-FIT", name: "Respirator fit test", issuedOn: "2026-02-14", expiresOn: "2027-02-14", status: "Valid", verified: true },
    { id: "cert-renee-dot", employeeId: "emp-renee", recordType: "Training", code: "DOT-AWARE", name: "DOT awareness", issuedOn: "2026-01-11", expiresOn: "2027-01-11", status: "Valid", verified: true },
  ],
  workforceTeams: [
    { id: "wf-team-response", code: "OPS-ER", name: "Emergency Response", managerEmployeeId: "emp-priya", businessUnit: "Central Texas Operations", status: "Active" },
    { id: "wf-team-sampling", code: "OPS-SAMPLE", name: "Sampling and Compliance", managerEmployeeId: "emp-priya", businessUnit: "Central Texas Operations", status: "Active" },
    { id: "wf-team-dispatch", code: "OFF-DISP", name: "Office and Dispatch", managerEmployeeId: "emp-renee", businessUnit: "Office and Dispatch", status: "Active" },
  ],
  workforceTeamMemberships: [
    { id: "tm-logan-response", teamId: "wf-team-response", employeeId: "emp-logan", role: "Field Supervisor", primary: true, status: "Active" },
    { id: "tm-trey-response", teamId: "wf-team-response", employeeId: "emp-trey", role: "Technician", primary: true, status: "Active" },
    { id: "tm-tristan-response", teamId: "wf-team-response", employeeId: "emp-tristan", role: "Technician", primary: true, status: "Active" },
    { id: "tm-priya-response", teamId: "wf-team-response", employeeId: "emp-priya", role: "Manager", primary: true, status: "Active" },
    { id: "tm-noah-sampling", teamId: "wf-team-sampling", employeeId: "emp-noah", role: "Sampler", primary: true, status: "Active" },
    { id: "tm-renee-dispatch", teamId: "wf-team-dispatch", employeeId: "emp-renee", role: "Dispatcher", primary: true, status: "Active" },
    { id: "tm-samira-response", teamId: "wf-team-response", employeeId: "emp-samira", role: "Abatement Technician", primary: true, status: "Active" },
  ],
  crewProfiles: [
    { id: "crew-er-alpha", code: "ER-A", name: "Emergency Response Alpha", supervisorEmployeeId: "emp-logan", type: "Emergency response", status: "Active", timezone: "America/Chicago", requiredCertTypeIds: ["certtype-hazwoper-40", "certtype-confined-space"] },
    { id: "crew-sampling-one", code: "SMP-1", name: "Sampling Crew 1", supervisorEmployeeId: "emp-noah", type: "Sampling", status: "Active", timezone: "America/Chicago", requiredCertTypeIds: ["certtype-soil-sampling"] },
  ],
  availabilityBlocks: [
    { id: "avail-logan-oncall", employeeId: "emp-logan", type: "On call", startsAt: "2026-07-25T17:00:00-05:00", endsAt: "2026-07-27T07:00:00-05:00", reason: "Weekend emergency rotation", status: "Confirmed" },
    { id: "avail-noah-training", employeeId: "emp-noah", type: "Unavailable", startsAt: "2026-07-26T13:00:00-05:00", endsAt: "2026-07-26T16:00:00-05:00", reason: "Laboratory QA training", status: "Approved" },
    { id: "avail-tristan-late", employeeId: "emp-tristan", type: "Restricted", startsAt: "2026-07-26T07:00:00-05:00", endsAt: "2026-07-26T14:00:00-05:00", reason: "Morning appointment", status: "Approved" },
    { id: "avail-samira-shift", employeeId: "emp-samira", type: "Preferred", startsAt: "2026-07-26T07:00:00-05:00", endsAt: "2026-07-26T15:00:00-05:00", reason: "Regular Tue-Sat shift", status: "Confirmed" },
  ],
  // Phase 18 item 2 — standby/on-call, modeled separately from availabilityBlocks (a standby
  // assignment is a commitment, not an unavailability exception).
  standbyAssignments: [
    { id: "standby-logan-weekend", employeeId: "emp-logan", startsAt: "2026-07-25T17:00:00-05:00", endsAt: "2026-07-27T07:00:00-05:00", notes: "Primary weekend on-call", createdBy: "Priya Patel", createdAt: "2026-07-20T14:00:00-05:00" },
  ],
  standbyRotationSettings: [
    { id: "default", rotationPattern: "Weekly", notes: "Rotates every Friday 5pm", updatedBy: "Priya Patel", updatedAt: "2026-07-20T14:00:00-05:00" },
  ],
  frontlineDevices: [
    { id: "device-logan-ipad", employeeId: "emp-logan", deviceIdentifier: "BR-IPAD-014", displayName: "Logan field iPad", platform: "iPadOS", appVersion: "0.9.4", registrationStatus: "Active", lastSeenAt: "2026-07-26T15:42:00-05:00", syncStatus: "Healthy", pendingCommands: 0 },
    { id: "device-trey-phone", employeeId: "emp-trey", deviceIdentifier: "BR-PHONE-021", displayName: "Trey field phone", platform: "Android", appVersion: "0.9.4", registrationStatus: "Active", lastSeenAt: "2026-07-26T15:38:00-05:00", syncStatus: "2 pending", pendingCommands: 2 },
    { id: "device-tristan-phone", employeeId: "emp-tristan", deviceIdentifier: "BR-PHONE-027", displayName: "Tristan field phone", platform: "Android", appVersion: "0.9.3", registrationStatus: "Active", lastSeenAt: "2026-07-26T14:11:00-05:00", syncStatus: "Update required", pendingCommands: 0 },
  ],
  // Front Line Time Sheet tile (Phase 10, Part 1). Distinct from Timer-task hours captured on a
  // job action (`jobFormSubmissions`, payload.hours) — those feed Phase 09's per-project labor cost
  // roll-up. `timeEntries` is a clock-in/out style payroll/attendance record: travel, work, break,
  // standby, other. It can optionally link to a dispatchJobId for reporting, but it is not currently
  // read by the Phase 09 cost report. See phase-10-frontline.md "Corrections found during
  // implementation" for the full reasoning. (This collection previously existed with zero readers/
  // writers and was retired 2026-09-16 -- it is reintroduced here with a real tile behind it.)
  timeEntries: [
    {
      id: "time-entry-logan-georgetown",
      employeeId: "emp-logan",
      dispatchJobId: "dispatch-job-georgetown",
      entryType: "work",
      startedAt: "2026-07-24T13:20:00-05:00",
      endedAt: "2026-07-24T16:05:00-05:00",
      durationMinutes: 165,
      notes: "Georgetown emergency response.",
      source: "frontline-timesheet",
      createdAt: "2026-07-24T16:05:00-05:00",
      updatedAt: "2026-07-24T16:05:00-05:00",
    },
  ],
  // Front Line Trips tile (Phase 10, Part 1). Maps to the designed `job_mileage_entries` table
  // (crm-schema/023_job_execution_events.sql) -- beginning/ending odometer and calculated distance,
  // general-purpose trip logging (not sampling-specific; the sampling odometer-per-relocation gap
  // stays a Job Book task-type concern for a future pass).
  jobMileageEntries: [
    {
      id: "mileage-logan-georgetown",
      employeeId: "emp-logan",
      dispatchJobId: "dispatch-job-georgetown",
      mileageType: "travel_to",
      beginningOdometer: 58210,
      endingOdometer: 58234,
      calculatedDistance: 24,
      capturedAt: "2026-07-24T13:05:00-05:00",
      notes: "Shop to Georgetown site.",
      createdAt: "2026-07-24T13:05:00-05:00",
      updatedAt: "2026-07-24T13:05:00-05:00",
    },
  ],
  // Front Line Messaging tile (Phase 10, Part 2). Threaded by dispatch job when one is picked, or a
  // shared "general" thread when it isn't -- no group channels, no per-person directory of office
  // staff to pick from (the simulator has no office-side session), just a field-worker-to-dispatch
  // conversation. senderRole distinguishes a Front Line write ("field") from a message seeded/sent
  // from the office side ("office") for read/unread purposes.
  messages: [
    {
      id: "message-georgetown-seed",
      threadKey: "dispatch-job-georgetown",
      dispatchJobId: "dispatch-job-georgetown",
      senderId: "office",
      senderName: "Dispatch",
      senderRole: "office",
      recipientId: "emp-logan",
      recipientName: "Logan",
      body: "Customer confirmed site access for 1pm -- gate code is unchanged.",
      sentAt: "2026-07-24T12:40:00-05:00",
      readAt: null,
    },
  ],
  // Material-usage-going-negative flag (Phase 10, Part 2, gap item "PPE quantity handling"). Written
  // by handleJobTaskConsume when a Front Line Material task submission is force-confirmed past zero
  // on-hand. Not surfaced anywhere fancy yet -- this is the record an ops manager review would query;
  // building a full alerts inbox UI was out of scope for this pass.
  inventoryAlerts: [],
  gpsConsents: [],
  itMessages: [],
  documents: [],
  documentTypes: [],
  documentRequirements: [],
  jobRequests: [
    {
      id: "req-georgetown-072426",
      requestNumber: "REQ-2026-0724-01",
      receivedAt: "2026-07-24T13:12:00-05:00",
      requestedServiceAt: "2026-07-24T13:12:00-05:00",
      requestedTimeText: "ASAP",
      status: "Converted",
      priority: "Emergency",
      serviceCategory: "ER",
      accountId: "acct-city-georgetown",
      customerName: "City of Georgetown",
      customerPoNumber: "NA",
      bioremedyPoNumber: "01-072426TF1",
      generatorResponsibleParty: "Unknown",
      calledInByName: "Chief Something",
      calledInByPhone: "",
      onsiteContactName: "Chief Something",
      onsiteContactPhone: "254-495-8028",
      addressText: "1460 & Quail Valley Dr, Georgetown, Texas 78626",
      mapPinText: "1460 & Quail Valley Dr",
      estimatedDurationMinutes: 240,
      requestedAssignee: "Logan Gallman",
      equipmentNotes: "Vactron, hand unit, M1000 for possible drain or soil",
      laborNotes: "Trey, Logan, Tristan",
      vendorNotes: "MBI",
      pricingNotes: "2026 BR rates",
      description: "Oil spill on pavement, PD on site. Bring hand unit and bacteria for possible drain or soil impact. Trey is in route; capture his time and truck.",
      customerPacketStatus: "Attached",
      quoteStatus: "Attached",
      convertedJobId: "dispatch-job-georgetown",
      receivedBy: "Maya Chen",
    },
    {
      id: "req-riverbend-return",
      requestNumber: "REQ-2026-0726-02",
      receivedAt: "2026-07-26T09:18:00-05:00",
      requestedServiceAt: "2026-07-28T08:00:00-05:00",
      requestedTimeText: "Morning",
      status: "Dispatch review",
      priority: "High",
      serviceCategory: "Sampling",
      accountId: "acct-riverbend",
      customerName: "Riverbend Manufacturing",
      customerPoNumber: "RB-UST-441",
      bioremedyPoNumber: "",
      generatorResponsibleParty: "Riverbend Manufacturing",
      calledInByName: "Alicia Moreno",
      onsiteContactName: "Mark Delgado",
      onsiteContactPhone: "(314) 555-0180",
      addressText: "South yard tank farm, St. Louis, Missouri",
      estimatedDurationMinutes: 360,
      requestedAssignee: "Noah Brooks",
      equipmentNotes: "Sampling truck, PID, sample coolers",
      laborNotes: "Lead sampler plus one technician",
      vendorNotes: "Midwest Analytical Laboratory",
      pricingNotes: "Riverbend master service rates",
      description: "Return confirmation sampling at the former UST basin after excavation limits are approved.",
      customerPacketStatus: "On file",
      quoteStatus: "Approved",
      convertedJobId: "",
      receivedBy: "Luis Romero",
    },
    {
      id: "req-killeen-print",
      requestNumber: "REQ-2026-0726-03",
      receivedAt: "2026-07-26T11:42:00-05:00",
      requestedServiceAt: "",
      requestedTimeText: "Date not confirmed",
      status: "Needs information",
      priority: "Normal",
      serviceCategory: "Scheduled",
      accountId: "acct-city-killeen-print",
      customerName: "City of Killeen Print Shop",
      customerPoNumber: "",
      bioremedyPoNumber: "",
      generatorResponsibleParty: "City of Killeen",
      calledInByName: "Facilities Department",
      onsiteContactName: "",
      onsiteContactPhone: "",
      addressText: "Killeen, Texas",
      estimatedDurationMinutes: 480,
      requestedAssignee: "",
      equipmentNotes: "Scope dependent",
      laborNotes: "Crew size pending final SOW",
      vendorNotes: "",
      pricingNotes: "Estimate workbook attached",
      description: "Scheduled environmental service request. Dispatch needs confirmed site contact, date, and access window.",
      customerPacketStatus: "On file",
      quoteStatus: "Draft",
      convertedJobId: "",
      receivedBy: "Maya Chen",
    },
  ],
  jobRequestDocuments: [],
  dispatchJobs: [
    {
      id: "dispatch-job-georgetown",
      jobNumber: "JOB-2026-0724-01",
      jobRequestId: "req-georgetown-072426",
      accountId: "acct-city-georgetown",
      projectId: "project-georgetown-er",
      projectName: "Georgetown Oil Spill Response",
      customerName: "City of Georgetown",
      jobName: "Quail Valley vehicle oil spill",
      jobType: "Emergency Response",
      jobTypeCode: "ER",
      jobTypeVersion: 3,
      status: "scheduled",
      dispatchStatus: "Ready to send",
      officeReviewStatus: "Not ready",
      priority: "Emergency",
      requestedServiceAt: "2026-07-24T13:12:00-05:00",
      scheduledStart: "2026-07-26T16:30:00-05:00",
      scheduledEnd: "2026-07-26T20:30:00-05:00",
      timezone: "America/Chicago",
      fieldLeadEmployeeId: "emp-logan",
      locationName: "Quail Valley Drive response area",
      addressText: "1460 & Quail Valley Dr, Georgetown, Texas 78626",
      latitude: 30.6511,
      longitude: -97.6778,
      onsiteContactName: "Chief Something",
      onsiteContactPhone: "254-495-8028",
      generatorResponsibleParty: "Unknown",
      customerPoNumber: "NA",
      bioremedyPoNumber: "01-072426TF1",
      pricingSource: "2026 BR rates",
      description: "Oil spill on pavement after a vehicle crash. Protect drains and soil, recover free product, apply bacteria where appropriate, and document time and truck usage.",
      readinessStatus: "Ready",
      completionPercent: 8,
      updatedAt: "2026-07-26T15:55:00-05:00",
    },
    {
      id: "dispatch-job-riverbend",
      jobNumber: "JOB-2026-0728-02",
      jobRequestId: "req-riverbend-return",
      accountId: "acct-riverbend",
      projectId: "job-riverbend-ust",
      projectName: "Riverbend UST Closure",
      customerName: "Riverbend Manufacturing",
      jobName: "UST basin confirmation sampling",
      jobType: "Environmental Sampling",
      jobTypeCode: "SAMPLE",
      jobTypeVersion: 2,
      status: "ready",
      dispatchStatus: "Unassigned",
      officeReviewStatus: "Not ready",
      priority: "High",
      requestedServiceAt: "2026-07-28T08:00:00-05:00",
      scheduledStart: "2026-07-28T08:00:00-05:00",
      scheduledEnd: "2026-07-28T14:00:00-05:00",
      timezone: "America/Chicago",
      fieldLeadEmployeeId: "emp-noah",
      locationName: "Riverbend south yard",
      addressText: "South yard tank farm, St. Louis, Missouri",
      onsiteContactName: "Mark Delgado",
      onsiteContactPhone: "(314) 555-0180",
      generatorResponsibleParty: "Riverbend Manufacturing",
      customerPoNumber: "RB-UST-441",
      bioremedyPoNumber: "",
      pricingSource: "Riverbend master service rates",
      description: "Collect confirmation soil samples after excavation limits are approved.",
      readinessStatus: "Warning",
      completionPercent: 0,
      updatedAt: "2026-07-26T13:20:00-05:00",
    },
    {
      id: "dispatch-job-i130",
      jobNumber: "JOB-2026-0703-08",
      jobRequestId: "",
      accountId: "acct-north-river",
      projectId: "job-north-river-i130",
      projectName: "I-130 Incident Response",
      customerName: "North River Logistics",
      jobName: "Response area stabilization",
      jobType: "Emergency Response",
      jobTypeCode: "ER",
      jobTypeVersion: 2,
      status: "in_progress",
      dispatchStatus: "On site",
      officeReviewStatus: "Not ready",
      priority: "Emergency",
      requestedServiceAt: "2026-07-03T14:30:00-05:00",
      scheduledStart: "2026-07-26T07:00:00-05:00",
      scheduledEnd: "2026-07-26T17:00:00-05:00",
      timezone: "America/Chicago",
      fieldLeadEmployeeId: "emp-priya",
      locationName: "I-130 response area",
      addressText: "I-130 response area, Kansas City, Missouri",
      onsiteContactName: "Jordan Lee",
      onsiteContactPhone: "(816) 555-0144",
      generatorResponsibleParty: "North River Logistics",
      customerPoNumber: "",
      bioremedyPoNumber: "",
      pricingSource: "Time and materials, $50,000 NTE",
      description: "Continue stabilization, absorbent recovery, samples, and field documentation.",
      readinessStatus: "In field",
      completionPercent: 64,
      updatedAt: "2026-07-26T15:47:00-05:00",
    },
    {
      id: "dispatch-job-clearwater",
      jobNumber: "JOB-2026-0715-05",
      jobRequestId: "",
      accountId: "acct-clearwater",
      projectId: "job-clearwater-abatement",
      projectName: "Clearwater Boiler Room Abatement",
      customerName: "Clearwater Schools",
      jobName: "Containment setup and abatement shift",
      jobType: "Asbestos Abatement",
      jobTypeCode: "ABATE",
      jobTypeVersion: 4,
      status: "field_complete",
      dispatchStatus: "Returned",
      officeReviewStatus: "Awaiting review",
      priority: "Normal",
      requestedServiceAt: "2026-07-15T18:00:00-05:00",
      scheduledStart: "2026-07-25T18:00:00-05:00",
      scheduledEnd: "2026-07-26T02:00:00-05:00",
      timezone: "America/Chicago",
      fieldLeadEmployeeId: "emp-priya",
      locationName: "Clearwater boiler room",
      addressText: "Clearwater Schools boiler room",
      onsiteContactName: "Sam Ortega",
      onsiteContactPhone: "(217) 555-0140",
      generatorResponsibleParty: "Clearwater Schools",
      customerPoNumber: "CLR-ABATE-26",
      bioremedyPoNumber: "",
      pricingSource: "Approved proposal",
      description: "Night shift containment setup, abatement, and worker closeout documentation.",
      readinessStatus: "Review",
      completionPercent: 100,
      updatedAt: "2026-07-26T02:18:00-05:00",
    },
  ],
  jobAssignments: [
    { id: "ja-geo-logan", jobId: "dispatch-job-georgetown", employeeId: "emp-logan", crewId: "crew-er-alpha", role: "Field Lead", isFieldLead: true, status: "Assigned", eligibilityStatus: "Eligible", plannedStart: "2026-07-26T16:30:00-05:00", plannedEnd: "2026-07-26T20:30:00-05:00" },
    { id: "ja-geo-trey", jobId: "dispatch-job-georgetown", employeeId: "emp-trey", crewId: "crew-er-alpha", role: "Response Technician", isFieldLead: false, status: "Assigned", eligibilityStatus: "Warning", eligibilityNote: "HAZWOPER refresher expires Aug 15", plannedStart: "2026-07-26T16:30:00-05:00", plannedEnd: "2026-07-26T20:30:00-05:00" },
    { id: "ja-geo-tristan", jobId: "dispatch-job-georgetown", employeeId: "emp-tristan", crewId: "crew-er-alpha", role: "Technician", isFieldLead: false, status: "Assigned", eligibilityStatus: "Eligible", plannedStart: "2026-07-26T16:30:00-05:00", plannedEnd: "2026-07-26T20:30:00-05:00" },
    { id: "ja-riverbend-noah", jobId: "dispatch-job-riverbend", employeeId: "emp-noah", crewId: "crew-sampling-one", role: "Lead Sampler", isFieldLead: true, status: "Proposed", eligibilityStatus: "Warning", eligibilityNote: "Availability block Jul 26 does not overlap planned work", plannedStart: "2026-07-28T08:00:00-05:00", plannedEnd: "2026-07-28T14:00:00-05:00" },
    { id: "ja-i130-priya", jobId: "dispatch-job-i130", employeeId: "emp-priya", crewId: "", role: "Field Lead", isFieldLead: true, status: "Working", eligibilityStatus: "Eligible", plannedStart: "2026-07-26T07:00:00-05:00", plannedEnd: "2026-07-26T17:00:00-05:00" },
    { id: "ja-i130-logan", jobId: "dispatch-job-i130", employeeId: "emp-logan", crewId: "", role: "Equipment Operator", isFieldLead: false, status: "Working", eligibilityStatus: "Eligible", plannedStart: "2026-07-26T07:00:00-05:00", plannedEnd: "2026-07-26T17:00:00-05:00" },
    { id: "ja-clearwater-samira", jobId: "dispatch-job-clearwater", employeeId: "emp-samira", crewId: "", role: "Abatement Technician", isFieldLead: false, status: "Complete", eligibilityStatus: "Overridden", eligibilityNote: "Certification was valid at assignment; renewal hold now active", plannedStart: "2026-07-25T18:00:00-05:00", plannedEnd: "2026-07-26T02:00:00-05:00" },
  ],
  jobScheduleSegments: [
    { id: "seg-geo-work", jobId: "dispatch-job-georgetown", type: "Work", name: "Emergency response", sequence: 1, plannedStart: "2026-07-26T16:30:00-05:00", plannedEnd: "2026-07-26T20:30:00-05:00", status: "Confirmed", lockedForDispatch: true },
    { id: "seg-riverbend-work", jobId: "dispatch-job-riverbend", type: "Work", name: "Confirmation sampling", sequence: 1, plannedStart: "2026-07-28T08:00:00-05:00", plannedEnd: "2026-07-28T14:00:00-05:00", status: "Planned", lockedForDispatch: false },
    { id: "seg-i130-work", jobId: "dispatch-job-i130", type: "Work", name: "Stabilization shift", sequence: 1, plannedStart: "2026-07-26T07:00:00-05:00", plannedEnd: "2026-07-26T17:00:00-05:00", actualStart: "2026-07-26T07:12:00-05:00", status: "In progress", lockedForDispatch: true },
    { id: "seg-clearwater-work", jobId: "dispatch-job-clearwater", type: "Work", name: "Night abatement shift", sequence: 1, plannedStart: "2026-07-25T18:00:00-05:00", plannedEnd: "2026-07-26T02:00:00-05:00", actualStart: "2026-07-25T18:14:00-05:00", actualEnd: "2026-07-26T01:52:00-05:00", status: "Completed", lockedForDispatch: true },
  ],
  jobResources: [
    { id: "jr-geo-vactron", jobId: "dispatch-job-georgetown", type: "Equipment", name: "Vactron", assetTag: "VAC-204", quantity: 1, status: "Reserved" },
    { id: "jr-geo-hand-unit", jobId: "dispatch-job-georgetown", type: "Equipment", name: "Hand recovery unit", assetTag: "HAND-03", quantity: 1, status: "Reserved" },
    { id: "jr-geo-m1000", jobId: "dispatch-job-georgetown", type: "Material", name: "M1000 bacteria", assetTag: "", quantity: 2, unit: "pails", status: "Issued" },
    { id: "jr-geo-vendor", jobId: "dispatch-job-georgetown", type: "Vendor", name: "MBI", assetTag: "", quantity: 1, status: "Requested" },
    { id: "jr-riverbend-pid", jobId: "dispatch-job-riverbend", type: "Equipment", name: "PID meter", assetTag: "PID-09", quantity: 1, status: "Requested" },
    { id: "jr-riverbend-coolers", jobId: "dispatch-job-riverbend", type: "Material", name: "Sample coolers and containers", assetTag: "", quantity: 2, unit: "coolers", status: "Requested" },
    { id: "jr-i130-vac", jobId: "dispatch-job-i130", type: "Equipment", name: "Vacuum trailer", assetTag: "VAC-204", quantity: 1, status: "In use" },
  ],
  jobConflicts: [
    { id: "jc-riverbend-crew", jobId: "dispatch-job-riverbend", assignmentId: "ja-riverbend-noah", type: "Crew coverage", severity: "Warning", status: "Open", title: "Second sampling technician not assigned", detail: "Job type requires a lead sampler plus one technician." },
    { id: "jc-clearwater-cert", jobId: "dispatch-job-clearwater", assignmentId: "ja-clearwater-samira", type: "Expired certification", severity: "Blocking", status: "Open", title: "Asbestos worker renewal expired", detail: "Blocks future assignment. Historical shift eligibility remains snapshotted." },
    { id: "jc-i130-truck", jobId: "dispatch-job-i130", resourceId: "asset-trk-18", type: "Equipment hold", severity: "Warning", status: "Acknowledged", title: "TRK-18 hydraulic lift hold", detail: "Field lead reassigned lift work and documented the override." },
  ],
  jobSteps: [
    { id: "step-geo-mobilize", jobId: "dispatch-job-georgetown", key: "mobilize", name: "Mobilize", sequence: 1, status: "Available", required: true },
    { id: "step-geo-stabilize", jobId: "dispatch-job-georgetown", key: "stabilize", name: "Stabilize Site", sequence: 2, status: "Not started", required: true },
    { id: "step-geo-document", jobId: "dispatch-job-georgetown", key: "document", name: "Document Work", sequence: 3, status: "Not started", required: true },
    { id: "step-geo-closeout", jobId: "dispatch-job-georgetown", key: "closeout", name: "Field Closeout", sequence: 4, status: "Not started", required: true },
    { id: "step-i130-response", jobId: "dispatch-job-i130", key: "response", name: "Response Operations", sequence: 1, status: "In progress", required: true },
    { id: "step-clearwater-closeout", jobId: "dispatch-job-clearwater", key: "closeout", name: "Field Closeout", sequence: 1, status: "Complete", required: true },
  ],
  jobActions: [
    { id: "action-geo-accept", jobId: "dispatch-job-georgetown", stepId: "step-geo-mobilize", key: "accept_dispatch", name: "Acknowledge dispatch", sequence: 1, type: "Status transition", status: "Available", required: true, assigneeScope: "All assigned workers", formName: "" },
    { id: "action-geo-travel", jobId: "dispatch-job-georgetown", stepId: "step-geo-mobilize", key: "travel", name: "Capture travel and truck time", sequence: 2, type: "Timer", status: "Blocked", required: true, assigneeScope: "Each worker", formName: "Travel and Mileage" },
    { id: "action-geo-arrival", jobId: "dispatch-job-georgetown", stepId: "step-geo-mobilize", key: "arrival", name: "Arrive and verify site contact", sequence: 3, type: "Form", status: "Blocked", required: true, assigneeScope: "Field Lead", formName: "Site Arrival" },
    { id: "action-geo-safety", jobId: "dispatch-job-georgetown", stepId: "step-geo-stabilize", key: "site_safety", name: "Complete site safety assessment", sequence: 1, type: "Form", status: "Not started", required: true, assigneeScope: "Field Lead", formName: "Job Safety Analysis" },
    { id: "action-geo-contain", jobId: "dispatch-job-georgetown", stepId: "step-geo-stabilize", key: "containment", name: "Deploy containment and protect drains", sequence: 2, type: "Checklist", status: "Not started", required: true, assigneeScope: "Any assigned worker", formName: "Containment Checklist" },
    { id: "action-geo-material", jobId: "dispatch-job-georgetown", stepId: "step-geo-stabilize", key: "material_use", name: "Log bacteria and absorbent use", sequence: 3, type: "Material", status: "Not started", required: true, assigneeScope: "Any assigned worker", formName: "Material Usage" },
    { id: "action-geo-photos", jobId: "dispatch-job-georgetown", stepId: "step-geo-document", key: "photos", name: "Capture before, progress, and after photos", sequence: 1, type: "Photo", status: "Not started", required: true, assigneeScope: "Any assigned worker", formName: "Field Photo Log" },
    { id: "action-geo-drain", jobId: "dispatch-job-georgetown", stepId: "step-geo-document", key: "drain_check", name: "Document drain or soil impact", sequence: 2, type: "Form", status: "Not started", required: true, assigneeScope: "Field Lead", formName: "Impact Assessment" },
    { id: "action-geo-recap", jobId: "dispatch-job-georgetown", stepId: "step-geo-closeout", key: "recap", name: "Complete job recap", sequence: 1, type: "Form", status: "Not started", required: true, assigneeScope: "Field Lead", formName: "Emergency Response Recap" },
    { id: "action-geo-signature", jobId: "dispatch-job-georgetown", stepId: "step-geo-closeout", key: "signature", name: "Capture customer completion signature", sequence: 2, type: "Signature", status: "Not started", required: true, assigneeScope: "Field Lead", formName: "Customer Completion" },
    { id: "action-i130-samples", jobId: "dispatch-job-i130", stepId: "step-i130-response", key: "samples", name: "Collect response area samples", sequence: 1, type: "Sample", status: "Complete", required: true, assigneeScope: "Field Lead", formName: "Field Sample Collection" },
    { id: "action-i130-recovery", jobId: "dispatch-job-i130", stepId: "step-i130-response", key: "recovery", name: "Track recovered material", sequence: 2, type: "Material", status: "In progress", required: true, assigneeScope: "Any assigned worker", formName: "Recovered Material Log" },
    { id: "action-clearwater-recap", jobId: "dispatch-job-clearwater", stepId: "step-clearwater-closeout", key: "recap", name: "Complete shift recap", sequence: 1, type: "Form", status: "Complete", required: true, assigneeScope: "Field Lead", formName: "Abatement Shift Recap" },
  ],
  jobFormSubmissions: [
    { id: "sub-i130-sample", jobId: "dispatch-job-i130", actionId: "action-i130-samples", formName: "Field Sample Collection", status: "Approved", submittedBy: "Priya Patel", submittedAt: "2026-07-26T11:34:00-05:00", summary: "Four sample locations captured with GPS, photos, and COC." },
    { id: "sub-clearwater-recap", jobId: "dispatch-job-clearwater", actionId: "action-clearwater-recap", formName: "Abatement Shift Recap", status: "Submitted", submittedBy: "Priya Patel", submittedAt: "2026-07-26T02:05:00-05:00", summary: "Containment and worker closeout complete. Office review pending." },
  ],
  jobTypeTemplates: [
    {
      id: "jobtype-emergency-response",
      name: "Emergency Spill Response",
      serviceCategory: "ER",
      description: "Fast mobile intake through field closeout for urgent spills, releases, and incidents.",
      isActive: true,
      createdBy: "System",
      updatedAt: "2026-07-01T00:00:00.000Z",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            { key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true },
            { key: "travel", name: "Capture travel and truck time", type: "Timer", assigneeScope: "Each worker", required: true },
            { key: "arrival", name: "Arrive and verify site contact", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "stabilize",
          name: "Stabilize Site",
          sequence: 2,
          tasks: [
            { key: "site_safety", name: "Complete site safety assessment", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "containment", name: "Deploy containment and protect drains", type: "Checklist", assigneeScope: "Any assigned worker", required: true },
            { key: "material_use", name: "Log bacteria and absorbent use", type: "Material", assigneeScope: "Any assigned worker", required: true },
          ],
        },
        {
          key: "document",
          name: "Document Work",
          sequence: 3,
          tasks: [
            { key: "photos", name: "Capture before, progress, and after photos", type: "Photo", assigneeScope: "Any assigned worker", required: true },
            { key: "drain_check", name: "Document drain or soil impact", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 4,
          tasks: [
            { key: "recap", name: "Complete job recap", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "signature", name: "Capture customer completion signature", type: "Signature", assigneeScope: "Field Lead", required: true },
          ],
        },
      ],
    },
    {
      id: "jobtype-sampling",
      name: "Environmental Sampling",
      serviceCategory: "Sampling",
      description: "Sample collection, chain of custody, and lab delivery for compliance and monitoring visits.",
      isActive: true,
      createdBy: "System",
      updatedAt: "2026-07-01T00:00:00.000Z",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            { key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true },
            { key: "travel", name: "Capture travel and truck time", type: "Timer", assigneeScope: "Each worker", required: true },
          ],
        },
        {
          key: "collect_samples",
          name: "Collect Samples",
          sequence: 2,
          tasks: [
            { key: "samples", name: "Collect samples at planned locations", type: "Sample", assigneeScope: "Field Lead", required: true },
            { key: "custody", name: "Complete chain of custody", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 3,
          tasks: [
            { key: "recap", name: "Complete shift recap", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "lab_delivery", name: "Log lab courier or delivery", type: "Checklist", assigneeScope: "Any assigned worker", required: true },
          ],
        },
      ],
    },
    {
      id: "jobtype-scheduled-service",
      name: "Scheduled Environmental Service",
      serviceCategory: "Scheduled",
      description: "Routine planned service visits with a standard checklist and customer sign-off.",
      isActive: true,
      createdBy: "System",
      updatedAt: "2026-07-01T00:00:00.000Z",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            { key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true },
            { key: "arrival", name: "Arrive and verify site contact", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "perform_work",
          name: "Perform Work",
          sequence: 2,
          tasks: [
            { key: "service_checklist", name: "Complete scheduled service checklist", type: "Checklist", assigneeScope: "Any assigned worker", required: true },
            { key: "material_use", name: "Log material and consumable use", type: "Material", assigneeScope: "Any assigned worker", required: true },
          ],
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 3,
          tasks: [
            { key: "recap", name: "Complete job recap", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "signature", name: "Capture customer completion signature", type: "Signature", assigneeScope: "Field Lead", required: true },
          ],
        },
      ],
    },
    {
      id: "jobtype-remediation",
      name: "Remediation Field Work",
      serviceCategory: "Remediation",
      description: "Multi-day soil, groundwater, or bioremediation field work from setup through documentation.",
      isActive: true,
      createdBy: "System",
      updatedAt: "2026-07-01T00:00:00.000Z",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            { key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true },
            { key: "travel", name: "Capture travel and truck time", type: "Timer", assigneeScope: "Each worker", required: true },
            { key: "arrival", name: "Arrive and verify site contact", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "site_setup",
          name: "Site Setup",
          sequence: 2,
          tasks: [
            { key: "site_safety", name: "Complete site safety assessment", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "exclusion_zone", name: "Deploy containment and exclusion zones", type: "Checklist", assigneeScope: "Any assigned worker", required: true },
          ],
        },
        {
          key: "perform_work",
          name: "Perform Work",
          sequence: 3,
          tasks: [
            { key: "material_use", name: "Log material and equipment use", type: "Material", assigneeScope: "Any assigned worker", required: true },
            { key: "photos", name: "Capture before, progress, and after photos", type: "Photo", assigneeScope: "Any assigned worker", required: true },
            { key: "waste_tracking", name: "Track recovered material and waste generated", type: "Material", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "document",
          name: "Document Work",
          sequence: 4,
          tasks: [{ key: "impact_findings", name: "Document soil or groundwater impact findings", type: "Form", assigneeScope: "Field Lead", required: true }],
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 5,
          tasks: [
            { key: "recap", name: "Complete job recap", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "signature", name: "Capture customer completion signature", type: "Signature", assigneeScope: "Field Lead", required: true },
          ],
        },
      ],
    },
    {
      id: "jobtype-abatement",
      name: "Asbestos Abatement",
      serviceCategory: "Abatement",
      description: "Containment, abatement work, and waste manifesting for asbestos and similar remediation jobs.",
      isActive: true,
      createdBy: "System",
      updatedAt: "2026-07-01T00:00:00.000Z",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            { key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true },
            { key: "arrival", name: "Arrive and verify site contact", type: "Form", assigneeScope: "Field Lead", required: true },
          ],
        },
        {
          key: "containment_setup",
          name: "Containment Setup",
          sequence: 2,
          tasks: [
            { key: "site_safety", name: "Complete site safety assessment", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "negative_air", name: "Set up negative air and containment barriers", type: "Checklist", assigneeScope: "Any assigned worker", required: true },
          ],
        },
        {
          key: "perform_work",
          name: "Perform Abatement Work",
          sequence: 3,
          tasks: [
            { key: "ppe_material", name: "Log PPE and material usage", type: "Material", assigneeScope: "Any assigned worker", required: true },
            { key: "photos", name: "Capture before, progress, and after photos", type: "Photo", assigneeScope: "Any assigned worker", required: true },
          ],
        },
        {
          key: "waste_closeout",
          name: "Waste and Closeout",
          sequence: 4,
          tasks: [
            { key: "waste_manifest", name: "Package and manifest waste containers", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "recap", name: "Complete shift recap", type: "Form", assigneeScope: "Field Lead", required: true },
            { key: "signature", name: "Capture customer completion signature", type: "Signature", assigneeScope: "Field Lead", required: true },
          ],
        },
      ],
    },
  ],
  jobStatusEvents: [],
  jobTaskAttachments: [],
  jobExpenses: [],
  weatherSnapshots: [],
  permits: [
    {
      id: "permit-10-day-storage",
      name: "10-day waste storage permit",
      permitType: "Waste storage",
      permitNumber: "",
      issuingAgency: "",
      issuedOn: "",
      expiresOn: "",
      renewalLeadDays: 60,
      storageLimitDays: 10,
      wasteTypesCovered: "",
      status: "Active",
      notes: "Named by the owner 2026-09-16. Permit number, agency and dates still to be entered.",
    },
    {
      id: "permit-oily-waste-handler",
      name: "Oily waste handler permit",
      permitType: "Waste handler",
      permitNumber: "",
      issuingAgency: "",
      issuedOn: "",
      expiresOn: "",
      renewalLeadDays: 60,
      storageLimitDays: null,
      wasteTypesCovered: "Oily waste",
      status: "Active",
      notes: "Named by the owner 2026-09-16. Permit number, agency and dates still to be entered.",
    },
  ],
  wasteRecords: [],
  notifications: [],
  laborAssignments: [],
  sampleLabReports: [],
  // Phase 11 (2026-09-23) — structured analytical results, empty by default (no seed rows; the
  // existing seed samples keep their free-text results until re-entered).
  sampleResults: [],
  sampleRecords: [
    {
      id: "sample-riverbend-b1",
      sampleId: "RB-UST-B1-0-2",
      samplingSessionId: "session-riverbend-ust-20260702",
      samplingSessionName: "UST basin confirmation sampling",
      projectId: "job-riverbend-ust",
      accountId: "acct-riverbend",
      facilityId: "loc-riverbend-yard",
      sampleLocation: "B-1 near former UST basin",
      sampleType: "Soil",
      sampleMatrix: "Soil",
      collectionMethod: "Direct-push grab",
      depthInterval: "0-2 ft below ground surface",
      collectionTime: "2026-07-02T14:35:00.000Z",
      collector: "Noah Brooks",
      gpsAccuracyMeters: 1.8,
      containerSummary: "2 amber jars and 3 VOA vials",
      preservation: "Cooled to 4 C",
      requestedAnalyses: ["TPH-GRO/DRO", "BTEX"],
      fieldNotes: "Confirmation sample collected along the north wall of the former UST basin.",
      chainOfCustody: "COC-2026-071",
      labName: "Midwest Analytical Laboratory",
      labStatus: "In transit",
      labResults: "Pending TPH-GRO/DRO and BTEX.",
      latitude: 38.62731,
      longitude: -90.19918,
      photos: ["B-1 north wall", "Sample sleeve", "COC label"],
    },
    {
      id: "sample-riverbend-b2",
      sampleId: "RB-UST-B2-2-4",
      samplingSessionId: "session-riverbend-ust-20260702",
      samplingSessionName: "UST basin confirmation sampling",
      projectId: "job-riverbend-ust",
      accountId: "acct-riverbend",
      facilityId: "loc-riverbend-yard",
      sampleLocation: "B-2 south excavation wall",
      sampleType: "Soil",
      sampleMatrix: "Soil",
      collectionMethod: "Direct-push grab",
      depthInterval: "2-4 ft below ground surface",
      collectionTime: "2026-07-02T15:05:00.000Z",
      collector: "Noah Brooks",
      gpsAccuracyMeters: 2.1,
      containerSummary: "2 amber jars and 3 VOA vials",
      preservation: "Cooled to 4 C",
      requestedAnalyses: ["TPH-GRO/DRO", "BTEX"],
      fieldNotes: "South-wall confirmation sample collected after excavation limits were marked.",
      chainOfCustody: "COC-2026-071",
      labName: "Midwest Analytical Laboratory",
      labStatus: "Received by lab",
      labResults: "TPH-DRO preliminary hit above screening level; confirmation pending.",
      latitude: 38.62718,
      longitude: -90.19943,
      photos: ["B-2 south wall", "PID reading", "Cooler seal"],
    },
    {
      id: "sample-i130-w1",
      sampleId: "073-2025-SP-01",
      samplingSessionId: "session-i130-response-20260703",
      samplingSessionName: "7/3 site sample locations",
      projectId: "job-north-river-i130",
      accountId: "acct-north-river",
      facilityId: "loc-north-river-depot",
      sampleLocation: "Sample point 1",
      sampleType: "Field sample",
      sampleMatrix: "Surface soil",
      collectionMethod: "Discrete grab",
      depthInterval: "Surface to 0.5 ft",
      collectionTime: "2026-07-03T16:35:00.000Z",
      collector: "Priya Patel",
      gpsAccuracyMeters: 1.4,
      containerSummary: "1 labeled sample jar",
      preservation: "Cooled",
      requestedAnalyses: ["Field documentation"],
      fieldNotes: "Sample point established for the site model and response-area baseline.",
      chainOfCustody: "COC-2026-082",
      labName: "RapidChem Environmental",
      labStatus: "Expedited analysis",
      labResults: "Sample point captured for 3D render context.",
      latitude: 18.298271147428302,
      longitude: -64.82822401559532,
      photos: ["Point 1 overview", "Point 1 closeup", "Point 1 label"],
    },
    {
      id: "sample-i130-w2",
      sampleId: "073-2025-SP-02",
      samplingSessionId: "session-i130-response-20260703",
      samplingSessionName: "7/3 site sample locations",
      projectId: "job-north-river-i130",
      accountId: "acct-north-river",
      facilityId: "loc-north-river-depot",
      sampleLocation: "Sample point 2",
      sampleType: "Field sample",
      sampleMatrix: "Surface soil",
      collectionMethod: "Discrete grab",
      depthInterval: "Surface to 0.5 ft",
      collectionTime: "2026-07-03T16:45:00.000Z",
      collector: "Priya Patel",
      gpsAccuracyMeters: 1.7,
      containerSummary: "1 labeled sample jar",
      preservation: "Cooled",
      requestedAnalyses: ["Field documentation"],
      fieldNotes: "Second mapped response-area sample point.",
      chainOfCustody: "COC-2026-082",
      labName: "RapidChem Environmental",
      labStatus: "Logged",
      labResults: "Sample point captured for site map reference.",
      latitude: 18.298457304333777,
      longitude: -64.82828902194916,
      photos: ["Point 2 overview", "Point 2 closeup", "Point 2 label"],
    },
    {
      id: "sample-i130-w3",
      sampleId: "073-2025-SP-03",
      samplingSessionId: "session-i130-response-20260703",
      samplingSessionName: "7/3 site sample locations",
      projectId: "job-north-river-i130",
      accountId: "acct-north-river",
      facilityId: "loc-north-river-depot",
      sampleLocation: "Sample point 3",
      sampleType: "Field sample",
      sampleMatrix: "Surface soil",
      collectionMethod: "Discrete grab",
      depthInterval: "Surface to 0.5 ft",
      collectionTime: "2026-07-03T16:55:00.000Z",
      collector: "Priya Patel",
      gpsAccuracyMeters: 1.6,
      containerSummary: "1 labeled sample jar",
      preservation: "Cooled",
      requestedAnalyses: ["Field documentation"],
      fieldNotes: "Third mapped response-area sample point.",
      chainOfCustody: "COC-2026-082",
      labName: "RapidChem Environmental",
      labStatus: "Logged",
      labResults: "Sample point captured for site map reference.",
      latitude: 18.298139925053146,
      longitude: -64.82799206295509,
      photos: ["Point 3 overview", "Point 3 closeup", "Point 3 label"],
    },
    {
      id: "sample-i130-w4",
      sampleId: "073-2025-SP-04",
      samplingSessionId: "session-i130-response-20260703",
      samplingSessionName: "7/3 site sample locations",
      projectId: "job-north-river-i130",
      accountId: "acct-north-river",
      facilityId: "loc-north-river-depot",
      sampleLocation: "Sample point 4",
      sampleType: "Field sample",
      sampleMatrix: "Surface soil",
      collectionMethod: "Discrete grab",
      depthInterval: "Surface to 0.5 ft",
      collectionTime: "2026-07-03T17:05:00.000Z",
      collector: "Priya Patel",
      gpsAccuracyMeters: 1.9,
      containerSummary: "1 labeled sample jar",
      preservation: "Cooled",
      requestedAnalyses: ["Field documentation"],
      fieldNotes: "Fourth mapped response-area sample point.",
      chainOfCustody: "COC-2026-082",
      labName: "RapidChem Environmental",
      labStatus: "Logged",
      labResults: "Sample point captured for site map reference.",
      latitude: 18.29848349551855,
      longitude: -64.82859084975242,
      photos: ["Point 4 overview", "Point 4 closeup", "Point 4 label"],
    },
  ],
  invoices: [
    {
      id: "inv-riverbend-draft",
      projectId: "job-riverbend-ust",
      customer: "Riverbend Manufacturing",
      quotedAmount: 185000,
      fieldExpenses: 0,
      invoiceAmount: 185000,
      status: "Draft",
      dueDate: "2026-08-15",
      notes: "Hold for disposal alternate before sending.",
      qboStatus: "Not exported",
    },
    {
      id: "inv-clearwater-pastdue",
      projectId: "job-clearwater-abatement",
      customer: "Clearwater Schools",
      quotedAmount: 132000,
      fieldExpenses: 18000,
      invoiceAmount: 132000,
      status: "Past due",
      dueDate: "2026-07-01",
      notes: "Needs payment follow-up with district AP.",
      qboStatus: "Not exported",
    },
  ],
  businessUnits: [
    {
      id: "bu-bioremedy",
      name: "BioRemedy Sales and Operations",
      parentBusinessUnitId: "",
    },
  ],
  systemUsers: [
    {
      id: "user-maya",
      businessUnitId: "bu-bioremedy",
      fullName: "Maya Chen",
      domainName: "BIOREMEDY\\maya.chen",
      internalEmailAddress: "maya.chen@example.com",
      title: "Sales Manager",
      isDisabled: false,
    },
    {
      id: "user-luis",
      businessUnitId: "bu-bioremedy",
      fullName: "Luis Romero",
      domainName: "BIOREMEDY\\luis.romero",
      internalEmailAddress: "luis.romero@example.com",
      title: "Account Manager",
      isDisabled: false,
    },
    {
      id: "user-priya",
      businessUnitId: "bu-bioremedy",
      fullName: "Priya Patel",
      domainName: "BIOREMEDY\\priya.patel",
      internalEmailAddress: "priya.patel@example.com",
      title: "Operations Manager",
      isDisabled: false,
    },
  ],
  teams: [
    {
      id: "team-env-sales",
      businessUnitId: "bu-bioremedy",
      name: "Environmental Sales Team",
      teamType: "Owner",
    },
  ],
  transactionCurrencies: [
    {
      id: "currency-usd",
      currencyName: "US Dollar",
      isoCurrencyCode: "USD",
      currencySymbol: "$",
      exchangeRate: 1,
      precisionValue: 2,
    },
  ],
  unitGroups: [
    {
      id: "unit-group-services",
      name: "Environmental services",
      baseUomName: "hour",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "unit-group-disposal",
      name: "Disposal materials",
      baseUomName: "ton",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "unit-group-consumables",
      name: "Field consumables",
      baseUomName: "unit",
      stateCode: "Active",
      statusCode: "Active",
    },
  ],
  unitsOfMeasure: [
    {
      id: "uom-hour",
      unitGroupId: "unit-group-services",
      baseUomId: "",
      name: "hour",
      quantity: 1,
    },
    {
      id: "uom-day",
      unitGroupId: "unit-group-services",
      baseUomId: "uom-hour",
      name: "day",
      quantity: 8,
    },
    {
      id: "uom-ton",
      unitGroupId: "unit-group-disposal",
      baseUomId: "",
      name: "ton",
      quantity: 1,
    },
    {
      id: "uom-unit",
      unitGroupId: "unit-group-consumables",
      baseUomId: "",
      name: "unit",
      quantity: 1,
    },
  ],
  priceLevels: [
    {
      id: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "2026 standard environmental services",
      beginDate: "2026-01-01",
      endDate: "2026-12-31",
      stateCode: "Active",
      statusCode: "Active",
    },
  ],
  products: [
    {
      id: "prod-ust-remediation",
      defaultUomId: "uom-day",
      defaultUnitGroupId: "unit-group-services",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "UST removal and soil remediation",
      productNumber: "ENV-UST-REM",
      productStructure: "Service",
      description: "Tank removal, excavation, characterization, hauling coordination, and restoration planning.",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "prod-asbestos-containment",
      defaultUomId: "uom-day",
      defaultUnitGroupId: "unit-group-services",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "Asbestos containment and abatement",
      productNumber: "ENV-ASB-CON",
      productStructure: "Service",
      description: "Containment setup, negative air controls, abatement labor, clearance coordination, and closeout package.",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "prod-disposal-impacted-soil",
      defaultUomId: "uom-ton",
      defaultUnitGroupId: "unit-group-disposal",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "Impacted soil disposal",
      productNumber: "ENV-DISP-SOIL",
      productStructure: "Service",
      description: "Profiled disposal, manifest coordination, transportation handling, and disposal documentation.",
      stateCode: "Active",
      statusCode: "Active",
    },
    // Phase 09 (Billing & Invoicing) added these three generic cost-basis products so the project
    // close-report/cost-report generator has *something* real in the rate card to resolve a per-unit
    // cost from for equipment/labor/material usage — the pre-existing catalog above is priced entirely
    // as day-rate services (whole engagements), not as the granular per-hour/per-log/per-unit inputs a
    // cost report needs. This is a deliberate, documented gap-fill, not a claim that per-equipment-type
    // or per-employee-role rates exist yet — see phase-09-billing-invoicing.md.
    {
      id: "prod-field-labor-standard",
      defaultUomId: "uom-hour",
      defaultUnitGroupId: "unit-group-services",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "Field labor (standard hourly cost basis)",
      productNumber: "COST-LABOR-STD",
      productStructure: "Service",
      description: "Generic per-hour labor cost basis used by the project close-report generator when no role-specific rate exists yet.",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "prod-equipment-standard-daily",
      defaultUomId: "uom-day",
      defaultUnitGroupId: "unit-group-services",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "Equipment usage (standard daily cost basis)",
      productNumber: "COST-EQUIP-STD",
      productStructure: "Service",
      description: "Generic per-checkout-day equipment cost basis used by the project close-report generator when no asset-specific rate exists yet.",
      stateCode: "Active",
      statusCode: "Active",
    },
    {
      id: "prod-material-standard-unit",
      defaultUomId: "uom-unit",
      defaultUnitGroupId: "unit-group-consumables",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "Field consumables (standard per-unit cost basis)",
      productNumber: "COST-MAT-STD",
      productStructure: "Service",
      description: "Generic per-unit material/consumable cost basis used by the project close-report generator when no material-specific rate exists yet.",
      stateCode: "Active",
      statusCode: "Active",
    },
  ],
  pricingSettings: [
    {
      id: "pricing-settings-default",
      fuelSurchargePercent: null,
      fuelSurchargeUpdatedAt: "",
      fuelSurchargeNote: "",
      energySecurityFeePercent: 18,
    },
  ],
  productPriceLevels: [
    {
      id: "ppl-ust-standard",
      productId: "prod-ust-remediation",
      priceLevelId: "price-standard-2026",
      uomId: "uom-day",
      unitGroupId: "unit-group-services",
      transactionCurrencyId: "currency-usd",
      amount: 14500,
      pricingMethodCode: "CurrencyAmount",
    },
    {
      id: "ppl-asbestos-standard",
      productId: "prod-asbestos-containment",
      priceLevelId: "price-standard-2026",
      uomId: "uom-day",
      unitGroupId: "unit-group-services",
      transactionCurrencyId: "currency-usd",
      amount: 11800,
      pricingMethodCode: "CurrencyAmount",
    },
    {
      id: "ppl-soil-disposal-standard",
      productId: "prod-disposal-impacted-soil",
      priceLevelId: "price-standard-2026",
      uomId: "uom-ton",
      unitGroupId: "unit-group-disposal",
      transactionCurrencyId: "currency-usd",
      amount: 185,
      pricingMethodCode: "CurrencyAmount",
    },
    {
      id: "ppl-labor-standard",
      productId: "prod-field-labor-standard",
      priceLevelId: "price-standard-2026",
      uomId: "uom-hour",
      unitGroupId: "unit-group-services",
      transactionCurrencyId: "currency-usd",
      amount: 95,
      pricingMethodCode: "CurrencyAmount",
    },
    {
      id: "ppl-equipment-standard",
      productId: "prod-equipment-standard-daily",
      priceLevelId: "price-standard-2026",
      uomId: "uom-day",
      unitGroupId: "unit-group-services",
      transactionCurrencyId: "currency-usd",
      amount: 650,
      pricingMethodCode: "CurrencyAmount",
    },
    {
      id: "ppl-material-standard",
      productId: "prod-material-standard-unit",
      priceLevelId: "price-standard-2026",
      uomId: "uom-unit",
      unitGroupId: "unit-group-consumables",
      transactionCurrencyId: "currency-usd",
      amount: 42,
      pricingMethodCode: "CurrencyAmount",
    },
  ],
  opportunities: [
    {
      id: "opp-riverbend-ust",
      accountId: "acct-riverbend",
      name: "UST removal and soil remediation",
      value: 185000,
      stage: "Proposal",
      serviceType: "UST removal",
      closeBand: "0-30",
      closeBandSetAt: "2026-09-23T00:00:00.000Z",
      nextStep: "Price alternate disposal option after lab report",
      updatedAt: "2026-07-01T15:12:00.000Z",
      quoteId: "quote-riverbend-revision",
    },
    {
      id: "opp-north-river-stormwater",
      accountId: "acct-north-river",
      name: "Stormwater and diesel cleanup program",
      value: 96000,
      stage: "Qualify",
      serviceType: "Soil remediation",
      closeBand: "0-30",
      closeBandSetAt: "2026-09-23T00:00:00.000Z",
      nextStep: "Walk fleet yard and loading bay with operations",
      updatedAt: "2026-06-29T13:30:00.000Z",
    },
    {
      id: "opp-clearwater-abatement",
      accountId: "acct-clearwater",
      name: "Asbestos abatement for boiler upgrade",
      value: 132000,
      stage: "Negotiation",
      serviceType: "Asbestos abatement",
      closeBand: "0-30",
      closeBandSetAt: "2026-09-23T00:00:00.000Z",
      nextStep: "Confirm night shift pricing and containment plan",
      updatedAt: "2026-07-02T10:20:00.000Z",
      quoteId: "quote-clearwater-night-shift",
    },
    {
      id: "opp-prairie-phase2",
      accountId: "acct-prairie-foods",
      name: "Phase II subsurface investigation",
      value: 42000,
      stage: "Lead",
      serviceType: "Groundwater treatment",
      closeBand: "0-30",
      closeBandSetAt: "2026-09-23T00:00:00.000Z",
      nextStep: "Send sample plan template and project references",
      updatedAt: "2026-06-26T16:45:00.000Z",
      estimateId: "estimate-prairie-phase2",
    },
  ],
  opportunityAssignments: [],
  leads: [
    {
      id: "lead-prairie-phase2",
      ownerId: "user-luis",
      ownerLogicalName: "systemuser",
      customerId: "acct-prairie-foods",
      customerLogicalName: "account",
      parentAccountId: "acct-prairie-foods",
      parentContactId: "cont-erin-walsh",
      qualifyingOpportunityId: "opp-prairie-phase2",
      transactionCurrencyId: "currency-usd",
      subject: "Prairie Foods Phase II subsurface investigation",
      fullName: "Erin Walsh",
      firstName: "Erin",
      lastName: "Walsh",
      companyName: "Prairie Foods Co-op",
      email: "ewalsh@prairiefoods.example",
      telephone: "(515) 555-0131",
      leadSource: "Referral",
      budgetAmount: 42000,
      estimatedValue: 42000,
      description: "Expansion team comparing consultants before committing to Phase II scope.",
      stateCode: "Open",
      statusCode: "In qualification",
      createdBy: "Luis Romero",
      createdOn: "2026-06-25T15:10:00.000Z",
      updatedAt: "2026-06-26T16:45:00.000Z",
    },
  ],
  opportunityContacts: [
    {
      id: "opp-contact-riverbend-alicia",
      opportunityId: "opp-riverbend-ust",
      contactId: "cont-alicia-moreno",
      accountId: "acct-riverbend",
      relationshipRole: "Economic buyer",
      influenceLevel: "Decision maker",
      isPrimary: true,
    },
    {
      id: "opp-contact-riverbend-marcus",
      opportunityId: "opp-riverbend-ust",
      contactId: "cont-marcus-hill",
      accountId: "acct-riverbend",
      relationshipRole: "Technical evaluator",
      influenceLevel: "Evaluator",
      isPrimary: false,
    },
  ],
  // Phase 06 items 30/31 — empty by default; every real row is created by the app's own inline
  // "attach a site" flow, not seeded.
  opportunityLocations: [],
  opportunityProducts: [
    {
      id: "opp-prod-riverbend-remediation",
      opportunityId: "opp-riverbend-ust",
      productId: "prod-ust-remediation",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      productName: "UST removal and soil remediation",
      productDescription: "Base remediation scope for the south yard tank farm.",
      isProductOverridden: false,
      quantity: 8,
      pricePerUnit: 14500,
      extendedAmount: 116000,
      manualDiscountAmount: 0,
      tax: 0,
    },
    {
      id: "opp-prod-riverbend-disposal",
      opportunityId: "opp-riverbend-ust",
      productId: "prod-disposal-impacted-soil",
      uomId: "uom-ton",
      transactionCurrencyId: "currency-usd",
      productName: "Impacted soil disposal",
      productDescription: "Allowance pending final lab profile.",
      isProductOverridden: false,
      quantity: 300,
      pricePerUnit: 185,
      extendedAmount: 55500,
      manualDiscountAmount: 0,
      tax: 0,
    },
  ],
  quotes: [
    {
      id: "quote-riverbend-revision",
      ownerId: "user-maya",
      ownerLogicalName: "systemuser",
      customerId: "acct-riverbend",
      customerLogicalName: "account",
      opportunityId: "opp-riverbend-ust",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      quoteNumber: "Q-2026-1042",
      name: "Riverbend UST removal revised disposal alternate",
      description: "Revision separates excavation, transport, and disposal alternates for buyer approval.",
      totalAmount: 185000,
      totalAmountBase: 185000,
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-07-31",
      stateCode: "Active",
      statusCode: "In revision",
      billToName: "Riverbend Manufacturing",
      billToCity: "St. Louis",
      billToStateOrProvince: "MO",
      billToCountry: "US",
      shipToName: "South yard tank farm",
      shipToCity: "St. Louis",
      shipToStateOrProvince: "MO",
      shipToCountry: "US",
    },
    {
      id: "quote-clearwater-night-shift",
      ownerId: "user-maya",
      ownerLogicalName: "systemuser",
      customerId: "acct-clearwater",
      customerLogicalName: "account",
      opportunityId: "opp-clearwater-abatement",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      quoteNumber: "Q-2026-1037",
      name: "Clearwater boiler room night-shift abatement",
      description: "Night-shift containment and abatement plan for summer school access.",
      totalAmount: 132000,
      totalAmountBase: 132000,
      effectiveFrom: "2026-06-20",
      effectiveTo: "2026-07-20",
      stateCode: "Active",
      statusCode: "Presented",
      billToName: "Clearwater Schools",
      billToCity: "Springfield",
      billToStateOrProvince: "IL",
      billToCountry: "US",
      shipToName: "Boiler room modernization",
      shipToCity: "Springfield",
      shipToStateOrProvince: "IL",
      shipToCountry: "US",
    },
  ],
  quoteLines: [
    {
      id: "quote-line-riverbend-remediation",
      quoteId: "quote-riverbend-revision",
      productId: "prod-ust-remediation",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "UST removal and soil remediation",
      productDescription: "Mobilization, tank pull, excavation support, backfill coordination, and closeout.",
      isProductOverridden: false,
      quantity: 8,
      pricePerUnit: 14500,
      extendedAmount: 116000,
      manualDiscountAmount: 0,
      tax: 0,
    },
    {
      id: "quote-line-riverbend-disposal",
      quoteId: "quote-riverbend-revision",
      productId: "prod-disposal-impacted-soil",
      uomId: "uom-ton",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "Impacted soil disposal",
      productDescription: "Profiled soil disposal allowance pending lab report.",
      isProductOverridden: false,
      quantity: 300,
      pricePerUnit: 185,
      extendedAmount: 55500,
      manualDiscountAmount: 0,
      tax: 0,
    },
    {
      id: "quote-line-clearwater-containment",
      quoteId: "quote-clearwater-night-shift",
      productId: "prod-asbestos-containment",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "Asbestos containment and abatement",
      productDescription: "Night-shift containment, abatement, clearance support, and project documentation.",
      isProductOverridden: false,
      quantity: 10,
      pricePerUnit: 11800,
      extendedAmount: 118000,
      manualDiscountAmount: 0,
      tax: 0,
    },
  ],
  estimates: [
    {
      id: "estimate-prairie-phase2",
      ownerId: "user-maya",
      ownerLogicalName: "systemuser",
      customerId: "acct-prairie-foods",
      customerLogicalName: "account",
      opportunityId: "opp-prairie-phase2",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      estimateNumber: "E-2026-2001",
      name: "Phase II subsurface investigation estimate",
      description: "Rough-order-of-magnitude estimate pending sample plan finalization.",
      totalAmount: 14500,
      totalAmountBase: 14500,
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-10-01",
      stateCode: "Active",
      statusCode: "Draft",
    },
  ],
  estimateLines: [
    {
      id: "estimate-line-prairie-phase2-1",
      estimateId: "estimate-prairie-phase2",
      productId: "prod-ust-remediation",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "UST removal and soil remediation",
      productDescription: "Mobilization and one day of investigation labor.",
      isProductOverridden: false,
      quantity: 1,
      pricePerUnit: 14500,
      extendedAmount: 14500,
      manualDiscountAmount: 0,
      tax: 0,
    },
  ],
  salesOrders: [
    {
      id: "sales-order-clearwater-abatement",
      ownerId: "user-priya",
      ownerLogicalName: "systemuser",
      customerId: "acct-clearwater",
      customerLogicalName: "account",
      quoteId: "quote-clearwater-night-shift",
      opportunityId: "opp-clearwater-abatement",
      priceLevelId: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      orderNumber: "SO-2026-0087",
      name: "Clearwater abatement night-shift delivery",
      description: "Operational delivery order created from the accepted school access plan.",
      totalAmount: 132000,
      totalAmountBase: 132000,
      dateFulfilled: "",
      stateCode: "Active",
      statusCode: "In progress",
      billToName: "Clearwater Schools",
      shipToName: "Boiler room modernization",
    },
  ],
  salesOrderLines: [
    {
      id: "sales-order-line-clearwater-containment",
      salesOrderId: "sales-order-clearwater-abatement",
      quoteLineId: "quote-line-clearwater-containment",
      productId: "prod-asbestos-containment",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "Asbestos containment and abatement",
      productDescription: "Accepted night-shift containment and abatement scope.",
      isProductOverridden: false,
      quantity: 10,
      pricePerUnit: 11800,
      extendedAmount: 118000,
      manualDiscountAmount: 0,
      tax: 0,
    },
  ],
  invoiceLines: [
    {
      id: "invoice-line-clearwater-containment",
      invoiceId: "inv-clearwater-pastdue",
      salesOrderLineId: "sales-order-line-clearwater-containment",
      productId: "prod-asbestos-containment",
      uomId: "uom-day",
      transactionCurrencyId: "currency-usd",
      salesRepId: "user-maya",
      productName: "Asbestos containment and abatement",
      productDescription: "Invoice line tied to accepted Clearwater delivery order.",
      isProductOverridden: false,
      quantity: 10,
      pricePerUnit: 11800,
      extendedAmount: 118000,
      manualDiscountAmount: 0,
      tax: 0,
    },
  ],
  competitors: [
    {
      id: "competitor-cleanearth",
      transactionCurrencyId: "currency-usd",
      name: "CleanEarth Response Group",
      websiteUrl: "https://example.com/cleanearth",
      referenceInfoUrl: "",
      tickerSymbol: "",
      stockExchange: "",
      strengths: "Fast mobilization and strong transportation network.",
      weaknesses: "Higher disposal alternates and less flexible reporting package.",
      threats: "Buyer mentioned CleanEarth as incumbent for emergency response.",
      winPercentage: 42,
      reportedRevenue: 0,
      reportingQuarter: 2,
      reportingYear: 2026,
      stateCode: "Active",
      statusCode: "Active",
    },
  ],
  opportunityCompetitors: [
    {
      id: "opp-comp-riverbend-cleanearth",
      opportunityId: "opp-riverbend-ust",
      competitorId: "competitor-cleanearth",
      name: "Riverbend alternate disposal comparison",
    },
  ],
  annotations: [
    {
      id: "note-riverbend-quote-revision",
      objectId: "quote-riverbend-revision",
      objectLogicalName: "quote",
      ownerId: "user-maya",
      ownerLogicalName: "systemuser",
      subject: "Quote revision driver",
      noteText: "Separate excavation, transportation, and disposal lines before sending the revised scope.",
      filename: "",
      mimetype: "",
      filesize: 0,
      documentBody: "",
    },
  ],
  connectionRoles: [
    {
      id: "connection-role-budget-owner",
      name: "Budget owner",
      category: "Sales relationship",
      description: "Person who owns or heavily influences approval of project spend.",
    },
    {
      id: "connection-role-technical-evaluator",
      name: "Technical evaluator",
      category: "Sales relationship",
      description: "Person who validates site assumptions, drawings, access, and scope detail.",
    },
  ],
  connections: [
    {
      id: "connection-riverbend-budget-owner",
      ownerId: "user-maya",
      ownerLogicalName: "systemuser",
      recordOneId: "opp-riverbend-ust",
      recordOneLogicalName: "opportunity",
      recordOneRoleId: "",
      recordTwoId: "cont-alicia-moreno",
      recordTwoLogicalName: "contact",
      recordTwoRoleId: "connection-role-budget-owner",
      name: "Alicia Moreno budget owner for Riverbend UST opportunity",
      description: "Owns finance approval and wants disposal alternates visible in the quote.",
      effectiveStart: "2026-07-01T00:00:00.000Z",
      effectiveEnd: "",
      stateCode: "Active",
      statusCode: "Active",
    },
  ],
  activityParties: [
    {
      id: "activity-party-riverbend-brief-owner",
      activityId: "act-riverbend-brief",
      partyId: "cont-alicia-moreno",
      partyLogicalName: "contact",
      participationType: "Customer",
      addressUsed: "amoreno@riverbend.example",
      displayName: "Alicia Moreno",
    },
    {
      id: "activity-party-riverbend-brief-sales",
      activityId: "act-riverbend-brief",
      partyId: "user-maya",
      partyLogicalName: "systemuser",
      participationType: "Owner",
      addressUsed: "maya.chen@example.com",
      displayName: "Maya Chen",
    },
  ],
  accountTypes: [
    { id: "account-type-commercial", name: "Commercial", description: "", displayOrder: 1 },
    { id: "account-type-municipal-government", name: "Municipal / Government", description: "", displayOrder: 2 },
    { id: "account-type-industrial", name: "Industrial", description: "", displayOrder: 3 },
    { id: "account-type-residential", name: "Residential", description: "", displayOrder: 4 },
    { id: "account-type-strategic-partner", name: "Strategic Partner", description: "", displayOrder: 5 },
  ],
  // Curated for picking; naicsCode (2022 NAICS sector/subsector) is for reporting and export (Phase 03 Q53).
  industries: [
    { id: "industry-oil-gas", industryName: "Oil & Gas", industryCode: "OILGAS", naicsCode: "211", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 1 },
    { id: "industry-agriculture", industryName: "Agriculture", industryCode: "AG", naicsCode: "11", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 2 },
    { id: "industry-wastewater", industryName: "Wastewater", industryCode: "WASTEWATER", naicsCode: "221320", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 3 },
    { id: "industry-manufacturing", industryName: "Manufacturing", industryCode: "MFG", naicsCode: "31-33", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 4 },
    { id: "industry-municipal-government", industryName: "Municipal / Government / DOT", industryCode: "GOVT", naicsCode: "92", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 5 },
    { id: "industry-healthcare", industryName: "Healthcare", industryCode: "HEALTH", naicsCode: "62", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 6 },
    { id: "industry-construction", industryName: "Construction", industryCode: "CONSTRUCTION", naicsCode: "23", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 7 },
    { id: "industry-transportation-logistics", industryName: "Transportation / Logistics", industryCode: "TRANSPORT", naicsCode: "48-49", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 8 },
    { id: "industry-environmental", industryName: "Environmental", industryCode: "ENV", naicsCode: "562", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 9 },
    { id: "industry-utilities-infrastructure", industryName: "Utilities / Infrastructure", industryCode: "UTIL", naicsCode: "22", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 10 },
    { id: "industry-education", industryName: "Education", industryCode: "EDU", naicsCode: "61", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 11 },
  ],
  accountIndustries: [],
  addresses: [],
  facilityContacts: [],
  facilities: [
    {
      id: "loc-riverbend-yard",
      accountId: "acct-riverbend",
      name: "South yard tank farm",
      address: "2200 Foundry Road",
      city: "St. Louis, MO",
      category: "Other",
      categoryOther: "Former UST basin",
      concern: "Petroleum impacted soil",
      badge: "Sampling",
      access: "Badge access and escort required",
    },
    {
      id: "loc-riverbend-billing",
      accountId: "acct-riverbend",
      name: "Riverbend Manufacturing corporate billing",
      address: "500 Corporate Parkway, Suite 300",
      street1: "500 Corporate Parkway, Suite 300",
      city: "St. Louis",
      stateOrProvince: "MO",
      countryOrRegion: "USA",
      category: "Corporate Office",
      categoryOther: "",
      concern: "",
      badge: "Active",
      access: "",
    },
    {
      id: "loc-north-river-depot",
      accountId: "acct-north-river",
      name: "Fleet maintenance depot",
      address: "910 River Terminal Drive",
      city: "Kansas City, MO",
      category: "Other",
      categoryOther: "Fleet yard",
      concern: "Diesel staining and stormwater runoff",
      badge: "Assessment",
      access: "Operations escort during dispatch windows",
    },
    {
      id: "loc-clearwater-boiler",
      accountId: "acct-clearwater",
      name: "Boiler room modernization",
      address: "44 East Main Street",
      city: "Springfield, IL",
      category: "Other",
      categoryOther: "School mechanical room",
      concern: "Asbestos-containing insulation",
      badge: "Proposal",
      access: "Evening and weekend access preferred",
    },
    {
      id: "loc-prairie-cold-storage",
      accountId: "acct-prairie-foods",
      name: "Cold storage expansion",
      address: "1300 Cooperative Way",
      city: "Des Moines, IA",
      category: "Other",
      categoryOther: "Expansion site",
      concern: "Groundwater monitoring",
      badge: "Lead",
      access: "Coordinate with construction superintendent",
    },
  ],
  salesTasks: [],
  accountRelationshipExtensions: [],
  accountComments: [],
  facilityComments: [],
  accountDivisions: [],
  contactEmploymentHistory: [],
  subcontractorTypes: [
    { id: "subcontractor-type-subcontractor", name: "Subcontractor", description: "", displayOrder: 1 },
    { id: "subcontractor-type-supplier", name: "Supplier", description: "", displayOrder: 2 },
    { id: "subcontractor-type-carrier", name: "Carrier", description: "", displayOrder: 3 },
    { id: "subcontractor-type-consultant", name: "Consultant", description: "", displayOrder: 4 },
  ],
  vendorProfiles: [],
  serviceAgreements: [],
  subcontractorAssignments: [],
  accountApprovedSubcontractors: [],
  qboSettings: {
    connectionStatus: "Not connected",
    realmId: "",
    lastExportAt: "",
  },
  qboExports: [],
};

// Phase 20 item 5 (2026-09-23): what a soft delete takes with it. Data, in one place, so Phase 14 can
// turn it into foreign-key rules. Contacts are never cascaded from an account (they are people, not
// account children); activities and tasks stay as history and resolve the deleted id on the timeline.
const cascadeRules = {
  accounts: [
    ["facilities", "accountId"],
    ["addresses", "accountId"],
    ["accountIndustries", "accountId"],
    ["accountRelationshipExtensions", "accountId"],
    ["accountComments", "accountId"],
    ["accountDivisions", "accountId"],
    ["accountApprovedSubcontractors", "accountId"],
    ["vendorProfiles", "accountId"],
    ["serviceAgreements", "accountId"],
    ["salesTasks", "accountId"],
    ["opportunities", "accountId"],
    ["projects", "accountId"],
    ["jobRequests", "accountId"],
    ["dispatchJobs", "accountId"],
  ],
  facilities: [
    ["facilityContacts", "facilityId"],
    ["facilityComments", "facilityId"],
    ["opportunityLocations", "facilityId"],
  ],
  contacts: [
    ["facilityContacts", "contactId"],
    ["opportunityContacts", "contactId"],
    ["contactEmploymentHistory", "contactId"],
  ],
  opportunities: [
    ["opportunityAssignments", "opportunityId"],
    ["opportunityContacts", "opportunityId"],
    ["opportunityLocations", "opportunityId"],
    ["opportunityProducts", "opportunityId"],
    ["opportunityCompetitors", "opportunityId"],
    ["quotes", "opportunityId"],
    ["estimates", "opportunityId"],
    ["scheduledWork", "opportunityId"],
    ["scheduleEvents", "opportunityId"],
  ],
  quotes: [["quoteLines", "quoteId"]],
  estimates: [["estimateLines", "estimateId"]],
  projects: [
    ["jobRequests", "projectId"],
    ["dispatchJobs", "projectId"],
    ["projectAssignments", "projectId"],
    ["projectAlerts", "projectId"],
    ["scheduleEvents", "projectId"],
    ["materialUsage", "projectId"],
    ["equipmentLogs", "projectId"],
    ["spatialData", "projectId"],
    ["invoices", "projectId"],
  ],
  invoices: [["invoiceLines", "invoiceId"]],
  jobRequests: [["jobRequestDocuments", "jobRequestId"]],
  dispatchJobs: [
    ["jobAssignments", "jobId"],
    ["jobScheduleSegments", "jobId"],
    ["jobResources", "jobId"],
    ["jobConflicts", "jobId"],
    ["jobSteps", "jobId"],
    ["jobActions", "jobId"],
    ["jobFormSubmissions", "jobId"],
    ["jobStatusEvents", "jobId"],
    ["jobTaskAttachments", "jobId"],
    ["inventoryAlerts", "jobId"],
    ["sampleRecords", "dispatchJobId"],
    ["weatherSnapshots", "dispatchJobId"],
    ["messages", "dispatchJobId"],
    ["timeEntries", "dispatchJobId"],
    ["jobMileageEntries", "dispatchJobId"],
  ],
};

// Every live record the delete would touch, root included, keyed by collection. Recursive through
// cascadeRules; a record reached twice is counted once.
function collectCascade(data, collection, id) {
  const affected = new Map();
  const visit = (targetCollection, record) => {
    if (!affected.has(targetCollection)) affected.set(targetCollection, new Map());
    const bucket = affected.get(targetCollection);
    if (bucket.has(record.id)) return;
    bucket.set(record.id, record);
    for (const [childCollection, key] of cascadeRules[targetCollection] || []) {
      for (const child of data[childCollection] || []) {
        if (!child.deletedAt && child[key] === record.id) visit(childCollection, child);
      }
    }
  };
  const root = (data[collection] || []).find((record) => record.id === id);
  if (root) visit(collection, root);
  return { root, affected };
}

function cascadeSummary(affected) {
  const counts = {};
  let total = 0;
  for (const [targetCollection, bucket] of affected) {
    counts[targetCollection] = bucket.size;
    total += bucket.size;
  }
  return { counts, total };
}

// A role or a list of roles: access is granted when any of them has the domain.
function canAccess(role, domain) {
  const roles = Array.isArray(role) ? role : [role];
  return roles.some((item) => roleAccess[domain]?.includes(item) || item === "Admin");
}

// Phase 12a (2026-09-23): the role comes from the session the cookie resolves to. The old
// X-CRM-Role header is ignored entirely. Since 2026-09-24 (owner) a session carries every role the
// person holds -- their access is the combination -- unless they narrowed it to one active role in
// Settings. getRoles() is what authorization checks; getRole() is the primary one, for display.
function getRoles(request) {
  const roles = effectiveRoles(request.session);
  return roles.length ? roles : ["Anonymous"];
}

function getRole(request) {
  return getRoles(request)[0];
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request, maxBytes = Number.POSITIVE_INFINITY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw requestError(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit.`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

async function loadBackend() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dataFile)) {
    const fresh = structuredClone(defaultBackend);
    if (seedDemoData) await seedDemoCollections(fresh);
    await saveBackend(fresh);
    return fresh;
  }
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  const data = {
    ...structuredClone(defaultBackend),
    ...parsed,
  };
  const accountIdsByCustomer = new Map([
    ["city of georgetown", "acct-city-georgetown"],
    ["riverbend manufacturing", "acct-riverbend"],
    ["city of killeen print shop", "acct-city-killeen-print"],
    ["north river logistics", "acct-north-river"],
    ["clearwater schools", "acct-clearwater"],
  ]);
  data.jobRequestDocuments = Array.isArray(data.jobRequestDocuments) ? data.jobRequestDocuments : [];
  data.sampleLabReports = Array.isArray(data.sampleLabReports) ? data.sampleLabReports : [];
  data.sampleResults = Array.isArray(data.sampleResults) ? data.sampleResults : [];
  data.jobRequests = data.jobRequests.map((request) => ({
    ...request,
    accountId: request.accountId || accountIdsByCustomer.get(request.customerName?.trim().toLowerCase()) || "",
  }));
  const requestAccounts = new Map(data.jobRequests.map((request) => [request.id, request.accountId]));
  data.dispatchJobs = data.dispatchJobs.map((job) => ({
    ...job,
    accountId: job.accountId || requestAccounts.get(job.jobRequestId) || accountIdsByCustomer.get(job.customerName?.trim().toLowerCase()) || "",
  }));
  // Pre-Phase-01 `assignedJobId` → `assignedProjectId`, so a restored older backup reads correctly.
  data.equipmentAssets = data.equipmentAssets.map(({ assignedJobId, ...asset }) => ({
    ...asset,
    assignedProjectId: asset.assignedProjectId || assignedJobId || "",
  }));
  // Phase 12a (2026-09-23): system users carry a global security role and a sign-in name. Seed users
  // had only a title; the owner's admin record exists so break-glass is needed once, to set its password.
  data.systemUsers = (data.systemUsers || []).map((user) => ({
    ...user,
    role: KNOWN_ROLES.includes(user.role) ? user.role : KNOWN_ROLES.includes(user.title) ? user.title : user.role || "",
    username: user.username || (user.internalEmailAddress || "").split("@")[0] || "",
    employeeId: user.employeeId || "",
    clientAccountId: user.clientAccountId || "",
    isDisabled: Boolean(user.isDisabled),
  }));
  if (!data.systemUsers.some((user) => user.id === "user-braden")) {
    data.systemUsers.push({ id: "user-braden", businessUnitId: "bu-bioremedy", fullName: "Braden Gilbert", username: "braden", internalEmailAddress: "braden@bioremedy.com", title: "Owner", role: "Admin", employeeId: "", isDisabled: false, createdAt: new Date().toISOString() });
  }
  // 2026-09-24: the owner's record was first seeded with a guessed address; the real one is
  // braden@bioremedy.com. Corrected in place unless it has already been edited to something else.
  const owner = data.systemUsers.find((user) => user.id === "user-braden");
  if (owner && owner.internalEmailAddress === "bgilbert@bioremedy.com") {
    owner.internalEmailAddress = "braden@bioremedy.com";
    if (owner.username === "bgilbert") owner.username = "braden";
  }
  let dirty = seedDemoData && (await seedDemoCollections(data));
  if (ensureDocumentTypes(data)) dirty = true;
  if (dirty) await saveBackend(data);
  return data;
}

// Fills only the collections that are completely empty, from data/demo-seed.json, and only under
// CRM_SEED_DEMO=1. Returns true when anything was added. A collection with even one real row is
// never touched, so the demo set appears exactly once and cannot come back after being cleared.
async function seedDemoCollections(data) {
  if (!existsSync(demoSeedFile)) return false;
  const seed = JSON.parse(await readFile(demoSeedFile, "utf8"));
  let added = false;
  for (const [collection, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows) || !Array.isArray(data[collection]) || data[collection].length) continue;
    data[collection] = rows.map((row) => touchRecord(structuredClone(row)));
    added = true;
  }
  return added;
}

// Atomic write: a reader sees the old file or the new one, never a half-written one. Windows can
// briefly refuse the rename while another process (a backup, an editor) has the file open, so retry.
async function saveBackend(data) {
  await mkdir(dataDir, { recursive: true });
  const tempFile = `${dataFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await renameWithRetry(tempFile, dataFile);
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

// Every API request reads the whole JSON file, may change it, and writes it back. Two overlapping
// requests could read a half-written file (seen live 2026-09-23: "Expected double-quoted property
// name" while a rate-sheet import ran during a save) or silently lose one request's change. One
// API request at a time closes both; it costs little at prototype scale.
let apiQueue = Promise.resolve();
function serializeApi(task) {
  const run = apiQueue.then(task, task);
  apiQueue = run.catch(() => {});
  return run;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Phase 20 item 1 (2026-09-23): every stored record carries a server-owned `version` (monotonic) and
// `updatedAt`. touchRecord() runs on every write, including the server's own (purchase-order receipt,
// material consumption, uploads, the QuickBooks export), so a client holding an older version is told
// so on its next save instead of silently overwriting. `previous` is the stored row being replaced;
// with none, the record's own version is bumped in place.
function touchRecord(record, previous = null) {
  const base = previous || record;
  const now = new Date().toISOString();
  record.version = Number(base.version || 0) + 1;
  record.updatedAt = now;
  record.createdAt = base.createdAt || record.createdAt || now;
  return record;
}

// A save carries the version the client read. A newer stored version means someone else saved in
// between: refuse with the current record so the client can show it. No claim at all (a brand-new
// record, or an older client) is accepted -- records written before this shipped have no version.
function versionConflict(stored, payload) {
  if (!stored) return null;
  const raw = payload.version;
  if (raw === undefined || raw === null || raw === "") return null;
  const claimed = Number(raw);
  if (!Number.isFinite(claimed) || Number(stored.version || 0) <= claimed) return null;
  return {
    error: "This record was changed by someone else since you opened it. Your edit was not saved.",
    conflict: true,
    current: stored,
  };
}

// Phase 11 (2026-09-23): every write to inventoryItems.onHand goes through here so the ledger can
// never drift from the stock number it explains. Called from inside the same loadBackend/saveBackend
// pair as the mutation itself (purchase-order receipt, material consumption, manual onHand edit).
function appendInventoryMovement(data, movement) {
  if (!Array.isArray(data.inventoryMovements)) data.inventoryMovements = [];
  data.inventoryMovements.push({
    id: makeId("inventory-movement"),
    inventoryItemId: "",
    quantityDelta: 0,
    balanceAfter: 0,
    reason: "adjustment",
    refType: "inventoryItem",
    refId: "",
    dispatchJobId: "",
    projectId: "",
    occurredAt: new Date().toISOString(),
    by: "",
    note: "",
    ...movement,
  });
}

function filterBackendForRole(data, role, session = null) {
  if (isPortalRole(role)) return portalView(data, session);
  return {
    documents: canAccess(role, "customerDirectory") ? data.documents || [] : [],
    documentTypes: data.documentTypes || [],
    documentRequirements: canAccess(role, "customerDirectory") ? data.documentRequirements || [] : [],
    accounts: canAccess(role, "customerDirectory") ? data.accounts : [],
    contacts: canAccess(role, "customerDirectory") ? data.contacts : [],
    projects: canAccess(role, "customerDirectory") ? data.projects : [],
    tasks: canAccess(role, "customerDirectory") ? data.tasks : [],
    activities: canAccess(role, "customerDirectory") ? data.activities : [],
    projectAssignments: canAccess(role, "customerDirectory") ? data.projectAssignments : [],
    projectAlerts: canAccess(role, "operations") || canAccess(role, "sales") ? data.projectAlerts : [],
    materialUsage: canAccess(role, "operations") || canAccess(role, "finance") ? data.materialUsage : [],
    equipmentLogs: canAccess(role, "operations") ? data.equipmentLogs : [],
    scheduledWork: canAccess(role, "operations") ? data.scheduledWork : [],
    spatialData: canAccess(role, "operations") ? data.spatialData : [],
    scheduleEvents: canAccess(role, "operations") ? data.scheduleEvents : [],
    locations: canAccess(role, "operations") ? data.locations : [],
    gpsConsents: canAccess(role, "dispatch") || canAccess(role, "workforce") ? data.gpsConsents || [] : [],
    itMessages: visibleItMessages(data, session, role),
    inventoryItems: canAccess(role, "inventory") || canAccess(role, "dispatch") ? data.inventoryItems : [],
    purchaseOrders: canAccess(role, "inventory") ? data.purchaseOrders : [],
    inventoryMovements: canAccess(role, "inventory") ? data.inventoryMovements : [],
    equipmentAssets: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentAssets : [],
    equipmentMaintenanceRecords: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentMaintenanceRecords : [],
    equipmentRestockItems: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentRestockItems : [],
    laborAssignments: canAccess(role, "operations") ? data.laborAssignments : [],
    sampleRecords: canAccess(role, "operations") || canAccess(role, "sales") ? data.sampleRecords : [],
    sampleLabReports: canAccess(role, "operations") || canAccess(role, "sales") ? data.sampleLabReports : [],
    sampleResults: canAccess(role, "operations") || canAccess(role, "sales") ? data.sampleResults : [],
    employees: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.employees : [],
    employeeCertifications: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.employeeCertifications : [],
    certificationTypes: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.certificationTypes : [],
    workforceTeams: canAccess(role, "workforce") ? data.workforceTeams : [],
    workforceTeamMemberships: canAccess(role, "workforce") ? data.workforceTeamMemberships : [],
    crewProfiles: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.crewProfiles : [],
    availabilityBlocks: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.availabilityBlocks : [],
    standbyAssignments: canAccess(role, "workforce") || canAccess(role, "dispatch") || canAccess(role, "operations") ? data.standbyAssignments : [],
    standbyRotationSettings: canAccess(role, "workforce") || canAccess(role, "dispatch") || canAccess(role, "operations") ? data.standbyRotationSettings : [],
    frontlineDevices: canAccess(role, "workforce") ? data.frontlineDevices : [],
    timeEntries: canAccess(role, "operations") ? data.timeEntries : [],
    jobMileageEntries: canAccess(role, "operations") ? data.jobMileageEntries : [],
    messages: canAccess(role, "dispatch") ? data.messages : [],
    inventoryAlerts: canAccess(role, "dispatch") || canAccess(role, "inventory") ? data.inventoryAlerts : [],
    jobRequests: canAccess(role, "dispatch") ? data.jobRequests : [],
    jobRequestDocuments: canAccess(role, "dispatch") ? data.jobRequestDocuments : [],
    dispatchJobs: canAccess(role, "dispatch") ? data.dispatchJobs : [],
    jobAssignments: canAccess(role, "dispatch") ? data.jobAssignments : [],
    jobScheduleSegments: canAccess(role, "dispatch") ? data.jobScheduleSegments : [],
    jobResources: canAccess(role, "dispatch") ? data.jobResources : [],
    jobConflicts: canAccess(role, "dispatch") ? data.jobConflicts : [],
    jobSteps: canAccess(role, "dispatch") ? data.jobSteps : [],
    jobActions: canAccess(role, "dispatch") ? data.jobActions : [],
    jobFormSubmissions: canAccess(role, "dispatch") ? data.jobFormSubmissions : [],
    jobTypeTemplates: canAccess(role, "dispatch") ? data.jobTypeTemplates : [],
    jobStatusEvents: canAccess(role, "dispatch") ? data.jobStatusEvents : [],
    jobTaskAttachments: canAccess(role, "dispatch") ? data.jobTaskAttachments : [],
    // Finance needs expenses for cost reports and reimbursement; operations for project review.
    jobExpenses: canAccess(role, "dispatch") || canAccess(role, "operations") || canAccess(role, "finance") ? data.jobExpenses : [],
    weatherSnapshots: canAccess(role, "operations") || canAccess(role, "sales") || canAccess(role, "finance") ? data.weatherSnapshots : [],
    permits: canAccess(role, "operations") || canAccess(role, "inventory") || canAccess(role, "finance") ? data.permits : [],
    // Finance reads waste records because disposal cost feeds the project P&L.
    wasteRecords: canAccess(role, "operations") || canAccess(role, "finance") ? data.wasteRecords : [],
    notifications: canAccess(role, "customerDirectory") ? data.notifications : [],
    invoices: canAccess(role, "finance") ? data.invoices : [],
    qboSettings: canAccess(role, "finance") ? data.qboSettings : { connectionStatus: "Restricted", realmId: "", lastExportAt: "" },
    qboExports: canAccess(role, "finance") ? data.qboExports : [],
    businessUnits: canAccess(role, "salesDocuments") ? data.businessUnits : [],
    systemUsers: canAccess(role, "salesDocuments") ? data.systemUsers : [],
    teams: canAccess(role, "salesDocuments") ? data.teams : [],
    transactionCurrencies: canAccess(role, "salesDocuments") ? data.transactionCurrencies : [],
    unitGroups: canAccess(role, "salesDocuments") ? data.unitGroups : [],
    unitsOfMeasure: canAccess(role, "salesDocuments") ? data.unitsOfMeasure : [],
    priceLevels: canAccess(role, "salesDocuments") ? data.priceLevels : [],
    products: canAccess(role, "salesDocuments") ? data.products : [],
    productPriceLevels: canAccess(role, "salesDocuments") ? data.productPriceLevels : [],
    pricingSettings: canAccess(role, "salesDocuments") ? data.pricingSettings : [],
    opportunities: canAccess(role, "sales") ? data.opportunities : [],
    leads: canAccess(role, "sales") ? data.leads : [],
    opportunityContacts: canAccess(role, "sales") ? data.opportunityContacts : [],
    opportunityLocations: canAccess(role, "sales") ? data.opportunityLocations : [],
    opportunityAssignments: canAccess(role, "sales") ? data.opportunityAssignments : [],
    opportunityProducts: canAccess(role, "salesDocuments") ? data.opportunityProducts : [],
    quotes: canAccess(role, "salesDocuments") ? data.quotes : [],
    quoteLines: canAccess(role, "salesDocuments") ? data.quoteLines : [],
    estimates: canAccess(role, "salesDocuments") ? data.estimates : [],
    estimateLines: canAccess(role, "salesDocuments") ? data.estimateLines : [],
    salesOrders: canAccess(role, "salesDocuments") ? data.salesOrders : [],
    salesOrderLines: canAccess(role, "salesDocuments") ? data.salesOrderLines : [],
    invoiceLines: canAccess(role, "finance") ? data.invoiceLines : [],
    competitors: canAccess(role, "sales") ? data.competitors : [],
    opportunityCompetitors: canAccess(role, "sales") ? data.opportunityCompetitors : [],
    annotations: canAccess(role, "salesDocuments") ? data.annotations : [],
    connectionRoles: canAccess(role, "salesDocuments") ? data.connectionRoles : [],
    connections: canAccess(role, "salesDocuments") ? data.connections : [],
    activityParties: canAccess(role, "salesDocuments") ? data.activityParties : [],
    accountTypes: canAccess(role, "sales") ? data.accountTypes : [],
    industries: canAccess(role, "sales") ? data.industries : [],
    accountIndustries: canAccess(role, "sales") ? data.accountIndustries : [],
    addresses: canAccess(role, "sales") ? data.addresses : [],
    facilities: canAccess(role, "sales") ? data.facilities : [],
    facilityContacts: canAccess(role, "sales") ? data.facilityContacts : [],
    salesTasks: canAccess(role, "sales") ? data.salesTasks : [],
    accountRelationshipExtensions: canAccess(role, "sales") ? data.accountRelationshipExtensions : [],
    accountComments: canAccess(role, "sales") ? data.accountComments : [],
    facilityComments: canAccess(role, "sales") ? data.facilityComments : [],
    accountDivisions: canAccess(role, "sales") ? data.accountDivisions : [],
    contactEmploymentHistory: canAccess(role, "sales") ? data.contactEmploymentHistory : [],
    subcontractorTypes: canAccess(role, "salesDocuments") ? data.subcontractorTypes : [],
    vendorProfiles: canAccess(role, "salesDocuments") ? data.vendorProfiles : [],
    serviceAgreements: canAccess(role, "salesDocuments") ? data.serviceAgreements : [],
    subcontractorAssignments: canAccess(role, "salesDocuments") ? data.subcontractorAssignments : [],
    accountApprovedSubcontractors: canAccess(role, "salesDocuments") ? data.accountApprovedSubcontractors : [],
  };
}

function validateScheduleEvent(data, record) {
  const blockedAssets = (record.equipmentAssetTags || [])
    .map((assetTag) => data.equipmentAssets.find((asset) => asset.assetTag === assetTag))
    .filter((asset) => asset && (asset.status === "Maintenance hold" || asset.issue));

  if (blockedAssets.length) {
    return `Scheduler block: ${blockedAssets.map((asset) => asset.assetTag).join(", ")} is unavailable or has an unresolved issue.`;
  }

  const required = record.requiredCertifications || [];
  const missingCerts = [];
  for (const laborResourceId of record.laborResourceIds || []) {
    const employee = data.employees.find((person) => person.id === laborResourceId);
    if (!employee) continue;
    const skills = employee.skills || [];
    const missing = required.filter((certification) => !skills.includes(certification));
    if (missing.length) missingCerts.push(`${employee.displayName} missing ${missing.join(", ")}`);
  }

  if (missingCerts.length) {
    return `Certification block: ${missingCerts.join("; ")}.`;
  }

  return "";
}

function normalizeRecord(collection, payload, data) {
  const id = payload.id || makeId(collection.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  const now = new Date().toISOString();

  if (collection === "purchaseOrders") {
    const item = data.inventoryItems.find((inventoryItem) => inventoryItem.id === payload.itemId);
    return {
      id,
      itemId: payload.itemId || "",
      materialType: item?.materialType || payload.materialType || "",
      quantity: Number(payload.quantity || 0),
      vendor: payload.vendor || "",
      status: payload.status || "Ordered",
      requestedBy: payload.requestedBy || "Local user",
      createdAt: payload.createdAt || now,
      receivedAt: payload.receivedAt || "",
      receivedBy: payload.receivedBy || "",
      receivedQuantity: Number(payload.receivedQuantity || 0),
    };
  }

  if (collection === "scheduleEvents") {
    return {
      id,
      projectId: payload.projectId || "",
      title: payload.title || "Scheduled work",
      date: payload.date || now.slice(0, 10),
      crew: payload.crew || "Unassigned crew",
      equipmentAssetTags: payload.equipmentAssetTags || [],
      laborResourceIds: payload.laborResourceIds || [],
      requiredCertifications: payload.requiredCertifications || [],
      status: payload.status || "Scheduled",
      blockedReason: payload.blockedReason || "",
      // Site walks (owner 2026-09-23): a sales activity on the calendar, the dispatch board and
      // Front Line before any job exists.
      kind: payload.kind || "work",
      opportunityId: payload.opportunityId || "",
      accountId: payload.accountId || "",
      facilityId: payload.facilityId || "",
      startTime: payload.startTime || "",
      endTime: payload.endTime || "",
      participantEmployeeIds: Array.isArray(payload.participantEmployeeIds) ? payload.participantEmployeeIds : [],
      activityId: payload.activityId || "",
      notes: payload.notes || "",
    };
  }

  if (collection === "equipmentAssets") {
    const toNumberOrNull = (value) => (value === undefined || value === null || value === "" ? null : Number(value));
    return {
      id,
      assetTag: payload.assetTag || "",
      equipment: payload.equipment || "",
      category: payload.category || "General equipment",
      status: payload.status || "Ready",
      maintenanceDue: payload.maintenanceDue || now.slice(0, 10),
      lastUsed: payload.lastUsed || "",
      assignedProjectId: payload.assignedProjectId || payload.assignedJobId || "",
      // Phase 08 — the rate-card line this asset bills as (many assets -> one product).
      productId: payload.productId || "",
      issue: payload.issue || "",
      specs: payload.specs && typeof payload.specs === "object" ? payload.specs : {},
      // Phase 11 (2026-09-23): preventive-maintenance interval and meter tracking. These were
      // dropped silently before being added here — this whitelist is the only place a new
      // equipmentAssets field takes effect (see the assignedProjectId lesson in CLAUDE.md).
      // Owner 2026-09-23: owned, rented or subcontracted.
      ownership: payload.ownership || "Owned",
      pmIntervalDays: toNumberOrNull(payload.pmIntervalDays),
      pmIntervalMeter: toNumberOrNull(payload.pmIntervalMeter),
      meterUnit: payload.meterUnit || "",
      currentMeter: toNumberOrNull(payload.currentMeter),
      maintenanceDueMeter: toNumberOrNull(payload.maintenanceDueMeter),
    };
  }

  if (collection === "locations") {
    return {
      id,
      projectId: payload.projectId || "",
      scheduleEventId: payload.scheduleEventId || "",
      label: payload.label || "GPS point",
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
      assetTags: Array.isArray(payload.assetTags) ? payload.assetTags : [],
      status: payload.status || "Live GPS",
      lastPingAt: payload.lastPingAt || now,
      source: payload.source || "Manual",
      locationType: payload.locationType || "",
      linearReference: payload.linearReference || "",
      isTemporary: Boolean(payload.isTemporary),
      retainUntil: payload.retainUntil || "",
      retentionReason: payload.retentionReason || "",
      // Phase 10, Part 2: Front Line Location tile writes a "here now" ping attributable to the
      // field worker even when it isn't tied to a project (admin time, travel between jobs).
      reportedByEmployeeId: payload.reportedByEmployeeId || "",
      // Phase 18 item 4: a ping from a personal phone names the consent that authorised it.
      consentId: payload.consentId || "",
    };
  }

  if (collection === "facilityContacts") {
    return {
      id,
      facilityId: payload.facilityId || "",
      contactId: payload.contactId || "",
      relationshipRole: payload.relationshipRole || "Works At",
      isPrimary: Boolean(payload.isPrimary),
      deletedAt: payload.deletedAt || "",
    };
  }

  if (collection === "invoices") {
    const numberOrNull = (value) => (value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value));
    return {
      id,
      projectId: payload.projectId || "",
      customer: payload.customer || "",
      quotedAmount: Number(payload.quotedAmount || 0),
      fieldExpenses: Number(payload.fieldExpenses || 0),
      invoiceAmount: Number(payload.invoiceAmount ?? payload.quotedAmount ?? 0),
      status: payload.status || "Draft",
      dueDate: payload.dueDate || "",
      notes: payload.notes || "",
      qboStatus: payload.qboStatus || "Not exported",
      // Phase 09 Lone Star pass (2026-09-23): the itemized invoice's document fields, the same
      // pricing fields quotes carry plus tax, terms and the reported location.
      invoiceNumber: payload.invoiceNumber || "",
      invoiceDate: payload.invoiceDate || "",
      priceLevelId: payload.priceLevelId || "",
      rateTier: payload.rateTier || "standard",
      isEmergencyCallout: Boolean(payload.isEmergencyCallout),
      fuelSurchargePercent: numberOrNull(payload.fuelSurchargePercent),
      energySecurityFeePercent: Number(payload.energySecurityFeePercent || 0),
      taxRatePercent: Number(payload.taxRatePercent || 0),
      subtotalAmount: numberOrNull(payload.subtotalAmount),
      fuelSurchargeAmount: numberOrNull(payload.fuelSurchargeAmount),
      energySecurityFeeAmount: numberOrNull(payload.energySecurityFeeAmount),
      taxableAmount: numberOrNull(payload.taxableAmount),
      taxAmount: Number(payload.taxAmount || 0),
      totalAmount: numberOrNull(payload.totalAmount),
      reportedLocation: payload.reportedLocation || "",
      termsText: payload.termsText || "",
      createdAt: payload.createdAt || now,
      updatedAt: now,
    };
  }

  // Phase 11 (2026-09-23) — structured analytical result rows. resultNumeric and
  // exceedsActionLevel are derived here, server-side, rather than trusted from the client, so a
  // stale or hand-edited payload can never misreport an exceedance. resultValue stays the raw
  // reported text (e.g. "ND", "<0.5", "12.4") even when it doesn't parse to a number.
  if (collection === "sampleResults") {
    const resultValue = (payload.resultValue ?? "").toString().trim();
    const parsedResult = Number(resultValue);
    const resultNumeric = resultValue !== "" && Number.isFinite(parsedResult) ? parsedResult : null;
    const toNullableNumber = (value) => {
      if (value === "" || value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const actionLevel = toNullableNumber(payload.actionLevel);
    return {
      id,
      sampleId: payload.sampleId || "",
      projectId: payload.projectId || "",
      analyte: payload.analyte || "",
      method: payload.method || "",
      resultValue,
      resultNumeric,
      units: payload.units || "",
      detectionLimit: toNullableNumber(payload.detectionLimit),
      reportingLimit: toNullableNumber(payload.reportingLimit),
      qualifier: payload.qualifier || "",
      actionLevel,
      actionLevelSource: payload.actionLevelSource || "",
      exceedsActionLevel: resultNumeric != null && actionLevel != null && resultNumeric > actionLevel,
      labReportId: payload.labReportId || "",
      reportedOn: payload.reportedOn || "",
      enteredBy: payload.enteredBy || "",
      createdAt: payload.createdAt || now,
      deletedAt: payload.deletedAt || "",
    };
  }

  if (collection === "inventoryItems") {
    return {
      id,
      materialType: payload.materialType || "",
      unit: payload.unit || "",
      onHand: Number(payload.onHand || 0),
      reorderAt: Number(payload.reorderAt || 0),
      targetStock: Number(payload.targetStock || 0),
      buyer: payload.buyer || "",
      barcode: payload.barcode || "",
      // Phase 08 — the rate-card line this consumable bills as.
      productId: payload.productId || "",
    };
  }

  return {
    ...payload,
    id,
    createdAt: payload.createdAt || now,
    updatedAt: now,
  };
}

function normalizeOwnTracksDeviceId(payload, requestUrl) {
  const candidate =
    payload.device ||
    payload.tid ||
    payload.topic?.toString().split("/").filter(Boolean).at(-1) ||
    requestUrl.searchParams.get("device") ||
    "owntracks";
  return candidate.toString().trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "owntracks";
}

function normalizeOwnTracksPing(payload, requestUrl) {
  const latitude = Number(payload.lat);
  const longitude = Number(payload.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: "OwnTracks location must include numeric lat and lon values." };
  }

  const deviceId = normalizeOwnTracksDeviceId(payload, requestUrl);
  const lastPingAt = Number.isFinite(Number(payload.tst))
    ? new Date(Number(payload.tst) * 1000).toISOString()
    : new Date().toISOString();

  return {
    id: `owntracks-${deviceId}`,
    projectId: requestUrl.searchParams.get("projectId") || "",
    label: requestUrl.searchParams.get("label") || `OwnTracks ${payload.tid || deviceId}`,
    latitude,
    longitude,
    assetTags: [requestUrl.searchParams.get("assetTag") || payload.tid || deviceId],
    status: "Live GPS",
    lastPingAt,
    source: "OwnTracks",
    accuracy: payload.acc ?? "",
    battery: payload.batt ?? "",
    trackerId: payload.tid || deviceId,
  };
}

async function handleOwnTracks(request, response, requestUrl) {
  if (request.method === "GET") {
    return json(response, 200, {
      ok: true,
      endpoint: "/api/owntracks",
      method: "POST",
      message: "OwnTracks HTTP endpoint is ready.",
    });
  }

  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const payload = await readJsonBody(request);
  if (!Object.keys(payload).length) return json(response, 202, { ok: true, ignored: "Empty OwnTracks payload." });
  if (payload._type && payload._type !== "location") return json(response, 202, { ok: true, ignored: payload._type });

  const ping = normalizeOwnTracksPing(payload, requestUrl);
  if (ping.error) return json(response, 400, { error: ping.error });

  const data = await loadBackend();
  const index = data.locations.findIndex((location) => location.id === ping.id);
  if (index >= 0) data.locations[index] = touchRecord({ ...data.locations[index], ...ping });
  else data.locations.push(touchRecord(ping));
  await saveBackend(data);

  return json(response, 200, { ok: true, location: ping });
}

async function handleReceivePurchaseOrder(request, response, orderId) {
  const role = getRoles(request);
  if (!canAccess(role, "inventory")) return json(response, 403, { error: "Inventory role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const payload = await readJsonBody(request);
  const data = await loadBackend();
  const order = data.purchaseOrders.find((item) => item.id === orderId);
  if (!order) return json(response, 404, { error: "Purchase order not found." });
  if (order.status === "Received") return json(response, 409, { error: "Purchase order has already been received." });

  const inventoryItem = data.inventoryItems.find((item) => item.id === order.itemId);
  if (!inventoryItem) return json(response, 404, { error: "Linked inventory item was not found." });

  const receivedQuantity = Number(payload.receivedQuantity || order.quantity || 0);
  if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
    return json(response, 400, { error: "Received quantity must be greater than zero." });
  }

  inventoryItem.onHand = Number(inventoryItem.onHand || 0) + receivedQuantity;
  order.status = "Received";
  order.receivedAt = new Date().toISOString();
  order.receivedBy = payload.receivedBy || "Local user";
  order.receivedQuantity = receivedQuantity;
  touchRecord(order);
  touchRecord(inventoryItem);
  appendInventoryMovement(data, {
    inventoryItemId: inventoryItem.id,
    quantityDelta: receivedQuantity,
    balanceAfter: inventoryItem.onHand,
    reason: "receipt",
    refType: "purchaseOrder",
    refId: order.id,
    occurredAt: order.receivedAt,
    by: order.receivedBy,
    note: order.vendor ? `Received from ${order.vendor}` : "",
  });
  await saveBackend(data);
  await audit(request, { action: "receive", collection: "purchaseOrders", recordId: order.id, summary: `${receivedQuantity} ${inventoryItem.unit || ""} ${inventoryItem.materialType}`.trim() });

  return json(response, 200, { order, inventoryItem });
}

const jobRequestDocumentMimeTypes = new Map([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

function normalizeUploadFileName(value) {
  let decoded = value || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = value || "";
  }
  return path.basename(decoded).replace(/[^a-zA-Z0-9._() -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function handleJobRequestDocumentUpload(request, response, requestId) {
  const role = getRoles(request);
  if (!canAccess(role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const jobRequest = data.jobRequests.find((item) => item.id === requestId);
  if (!jobRequest) return json(response, 404, { error: "Job request not found." });

  const documentRole = request.headers["x-document-role"]?.toString() || "";
  if (!["customer_packet", "quote"].includes(documentRole)) {
    return json(response, 400, { error: "Document role must be customer_packet or quote." });
  }

  const fileName = normalizeUploadFileName(request.headers["x-file-name"]?.toString());
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = jobRequestDocumentMimeTypes.get(extension);
  if (!fileName || !mimeType) {
    return json(response, 415, { error: "Upload a PDF, Word document, spreadsheet, CSV, PNG, or JPEG file." });
  }

  const body = await readRequestBody(request, maxJobRequestDocumentBytes);
  if (!body.length) return json(response, 400, { error: "The selected file is empty." });

  const document = {
    id: makeId("job-request-document"),
    jobRequestId: requestId,
    accountId: jobRequest.accountId || "",
    documentRole,
    fileName,
    storageName: "",
    mimeType,
    sizeBytes: body.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: attribution(request),
  };
  document.storageName = `${document.id}${extension}`;

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, document.storageName), body);
  data.jobRequestDocuments.push(document);

  const roleDocuments = data.jobRequestDocuments.filter(
    (item) => item.jobRequestId === requestId && item.documentRole === documentRole,
  );
  if (documentRole === "customer_packet") jobRequest.customerPacketStatus = `${roleDocuments.length} uploaded`;
  if (documentRole === "quote") jobRequest.quoteStatus = `${roleDocuments.length} uploaded`;
  touchRecord(jobRequest);

  await saveBackend(data);
  await audit(request, { action: "upload", collection: "jobRequestDocuments", recordId: document.id, summary: document.fileName, parent: requestId });
  return json(response, 201, document);
}

async function handleJobRequestDocumentDownload(request, response, documentId) {
  const role = getRoles(request);
  if (!canAccess(role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const document = data.jobRequestDocuments.find((item) => item.id === documentId);
  if (!document) return json(response, 404, { error: "Document not found." });

  const filePath = path.resolve(uploadsDir, document.storageName);
  if (path.dirname(filePath) !== path.resolve(uploadsDir) || !existsSync(filePath)) {
    return json(response, 404, { error: "Stored file is unavailable." });
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": document.mimeType || "application/octet-stream",
    "Content-Length": body.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    "Cache-Control": "private, no-store",
  });
  response.end(body);
}

// Lab results come back from third-party labs as PDFs or spreadsheets, never images, so this reuses
// the job-request-document upload/download pattern (role-gated download, since -- unlike a photo --
// a lab result is not meant to be loadable from a bare <img src>) rather than the photo-only
// jobTaskAttachment pipeline below.
async function handleSampleLabReportUpload(request, response, sampleId) {
  const role = getRoles(request);
  if (!canAccess(role, "operations")) return json(response, 403, { error: "Operations role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const sample = data.sampleRecords.find((item) => item.id === sampleId);
  if (!sample) return json(response, 404, { error: "Sample record not found." });

  const fileName = normalizeUploadFileName(request.headers["x-file-name"]?.toString());
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = jobRequestDocumentMimeTypes.get(extension);
  if (!fileName || !mimeType) {
    return json(response, 415, { error: "Upload a PDF, Word document, spreadsheet, CSV, PNG, or JPEG file." });
  }

  const body = await readRequestBody(request, maxJobRequestDocumentBytes);
  if (!body.length) return json(response, 400, { error: "The selected file is empty." });

  const report = {
    id: makeId("sample-lab-report"),
    sampleId,
    fileName,
    storageName: "",
    mimeType,
    sizeBytes: body.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: attribution(request),
  };
  report.storageName = `${report.id}${extension}`;

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, report.storageName), body);
  data.sampleLabReports.push(report);
  await saveBackend(data);

  return json(response, 201, report);
}

async function handleSampleLabReportDownload(request, response, reportId) {
  const role = getRoles(request);
  if (!canAccess(role, "operations")) return json(response, 403, { error: "Operations role required." });
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const report = data.sampleLabReports.find((item) => item.id === reportId);
  if (!report) return json(response, 404, { error: "Lab report not found." });

  const filePath = path.resolve(uploadsDir, report.storageName);
  if (path.dirname(filePath) !== path.resolve(uploadsDir) || !existsSync(filePath)) {
    return json(response, 404, { error: "Stored file is unavailable." });
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": report.mimeType || "application/octet-stream",
    "Content-Length": body.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(report.fileName)}`,
    "Cache-Control": "private, no-store",
  });
  response.end(body);
}

function decodeHeaderText(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value).slice(0, 300);
  } catch {
    return value.slice(0, 300);
  }
}

const jobTaskAttachmentMimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

// Receipts are often PDFs from email as well as phone photos. HEIC isn't accepted: browsers can't
// display it, and phones convert to JPEG when a web form asks for an image.
const receiptMimeTypes = new Map([...jobTaskAttachmentMimeTypes, [".webp", "image/webp"], [".pdf", "application/pdf"]]);

// Receipt photo for a field expense. Same store as task photos (jobTaskAttachments + data/uploads),
// so receipts come along when Phase 13 migrates attachments. Links both ways in one write.
async function handleJobExpenseReceiptUpload(request, response, expenseId) {
  const role = getRoles(request);
  if (!canAccess(role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const expense = data.jobExpenses.find((item) => item.id === expenseId);
  if (!expense) return json(response, 404, { error: "Expense not found." });

  const fileName = normalizeUploadFileName(request.headers["x-file-name"]?.toString());
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = receiptMimeTypes.get(extension);
  if (!fileName || !mimeType) return json(response, 415, { error: "Attach a photo (PNG, JPEG, WebP) or a PDF." });

  const body = await readRequestBody(request, maxJobRequestDocumentBytes);
  if (!body.length) return json(response, 400, { error: "The selected file is empty." });

  const attachment = {
    id: makeId("job-task-attachment"),
    jobId: expense.dispatchJobId || "",
    actionId: "",
    expenseId,
    kind: "receipt",
    fileName,
    storageName: "",
    mimeType,
    sizeBytes: body.length,
    caption: decodeHeaderText(request.headers["x-caption"]?.toString()),
    uploadedAt: new Date().toISOString(),
    uploadedBy: attribution(request),
  };
  attachment.storageName = `${attachment.id}${extension}`;

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, attachment.storageName), body);
  data.jobTaskAttachments.push(attachment);
  expense.receiptAttachmentId = attachment.id;
  touchRecord(expense);
  await saveBackend(data);

  return json(response, 201, attachment);
}

async function handleJobTaskAttachmentUpload(request, response, actionId) {
  const role = getRoles(request);
  if (!canAccess(role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const data = await loadBackend();
  const action = data.jobActions.find((item) => item.id === actionId);
  if (!action) return json(response, 404, { error: "Job task not found." });

  const kind = request.headers["x-attachment-kind"]?.toString() || "photo";
  if (!["photo", "signature"].includes(kind)) {
    return json(response, 400, { error: "Attachment kind must be photo or signature." });
  }

  const fileName = normalizeUploadFileName(request.headers["x-file-name"]?.toString());
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = jobTaskAttachmentMimeTypes.get(extension);
  if (!fileName || !mimeType) {
    return json(response, 415, { error: "Attach a PNG or JPEG image." });
  }

  const body = await readRequestBody(request, maxJobRequestDocumentBytes);
  if (!body.length) return json(response, 400, { error: "The selected file is empty." });

  const attachment = {
    id: makeId("job-task-attachment"),
    jobId: action.jobId,
    actionId,
    kind,
    fileName,
    storageName: "",
    mimeType,
    sizeBytes: body.length,
    caption: decodeHeaderText(request.headers["x-caption"]?.toString()),
    uploadedAt: new Date().toISOString(),
    uploadedBy: attribution(request),
  };
  attachment.storageName = `${attachment.id}${extension}`;

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, attachment.storageName), body);
  data.jobTaskAttachments.push(attachment);
  await saveBackend(data);

  return json(response, 201, attachment);
}

// Deliberately not role-gated: this is loaded by <img src>, and browsers cannot attach the
// X-CRM-Role header to an image request. Access rests on the attachment id being an opaque
// random string. Upload and consumption stay gated. Revisit when real auth replaces the
// header-based role shim.
async function handleJobTaskAttachmentView(request, response, attachmentId) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
  // Phase 12a: an <img src> cannot carry a header, but it carries the session cookie.
  if (!request.session) return json(response, 401, { error: "Sign in required.", unauthenticated: true });

  const data = await loadBackend();
  const attachment = data.jobTaskAttachments.find((item) => item.id === attachmentId);
  if (!attachment) return json(response, 404, { error: "Attachment not found." });

  const filePath = path.resolve(uploadsDir, attachment.storageName);
  if (path.dirname(filePath) !== path.resolve(uploadsDir) || !existsSync(filePath)) {
    return json(response, 404, { error: "Stored file is unavailable." });
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": attachment.mimeType || "application/octet-stream",
    "Content-Length": body.length,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    "Cache-Control": "private, max-age=300",
  });
  response.end(body);
}

// Material consumption is the only path in the app that draws inventory down, so it validates
// everything before mutating anything and persists in a single write, like purchase-order receipt.
async function handleJobTaskConsume(request, response, actionId) {
  const role = getRoles(request);
  if (!canAccess(role, "dispatch") && !canAccess(role, "inventory")) {
    return json(response, 403, { error: "Dispatch or inventory role required." });
  }
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });

  const payload = await readJsonBody(request);
  const data = await loadBackend();
  const action = data.jobActions.find((item) => item.id === actionId);
  if (!action) return json(response, 404, { error: "Job task not found." });

  if (data.jobResources.some((resource) => resource.actionId === actionId)) {
    return json(response, 409, { error: "Materials were already consumed for this task." });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return json(response, 400, { error: "Select at least one material to consume." });

  // Gap item "PPE quantity handling" (Phase 10, Part 2): logging usage must never silently block on
  // negative resulting inventory. A catalog line with `force: true` is allowed to go negative once
  // the field UI has already confirmed that with the worker; it produces an `inventoryAlerts` row so
  // an ops manager can see it happened. A `writeInName` line has no catalog entry at all -- it never
  // touches inventory, it is tracked as used regardless.
  const planned = [];
  const writeIns = [];
  const alerts = [];
  for (const entry of items) {
    if (entry.writeInName) {
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return json(response, 400, { error: `Quantity for ${entry.writeInName} must be greater than zero.` });
      }
      writeIns.push({ name: String(entry.writeInName).trim(), quantity, unit: String(entry.unit || "").trim() });
      continue;
    }
    const inventoryItem = data.inventoryItems.find((item) => item.id === entry.inventoryItemId);
    if (!inventoryItem) return json(response, 404, { error: "A selected inventory item no longer exists." });
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return json(response, 400, { error: `Quantity for ${inventoryItem.materialType} must be greater than zero.` });
    }
    const resultingBalance = Number(inventoryItem.onHand || 0) - quantity;
    if (resultingBalance < 0 && !entry.force) {
      return json(response, 409, {
        error: `Only ${Number(inventoryItem.onHand || 0)} ${inventoryItem.unit} of ${inventoryItem.materialType} on hand.`,
        wouldGoNegative: true,
        onHand: Number(inventoryItem.onHand || 0),
        unit: inventoryItem.unit,
        materialType: inventoryItem.materialType,
      });
    }
    if (resultingBalance < 0 && entry.force) {
      alerts.push({ inventoryItem, quantity, resultingBalance });
    }
    planned.push({ inventoryItem, quantity });
  }

  const consumedAt = new Date().toISOString();
  const consumedBy = attribution(request);
  // A job action's jobId points at dispatchJobs, which carries the engagement/project it belongs to
  // -- resolved once here so every movement row from this consume gets both references.
  const dispatchJob = data.dispatchJobs.find((job) => job.id === action.jobId);
  const created = planned.map(({ inventoryItem, quantity }) => {
    inventoryItem.onHand = Number(inventoryItem.onHand || 0) - quantity;
    touchRecord(inventoryItem);
    const resource = {
      id: makeId("job-resource"),
      jobId: action.jobId,
      actionId,
      inventoryItemId: inventoryItem.id,
      type: "Material",
      name: inventoryItem.materialType,
      assetTag: "",
      quantity,
      unit: inventoryItem.unit || "",
      status: "Consumed",
      consumedAt,
      consumedBy,
    };
    data.jobResources.push(resource);
    // Phase 11 (2026-09-23): write-in lines have no inventory item and never touch stock, so only
    // real catalog lines get a ledger row.
    appendInventoryMovement(data, {
      inventoryItemId: inventoryItem.id,
      quantityDelta: -quantity,
      balanceAfter: inventoryItem.onHand,
      reason: "field-usage",
      refType: "jobAction",
      refId: actionId,
      dispatchJobId: action.jobId,
      projectId: dispatchJob?.projectId || "",
      occurredAt: consumedAt,
      by: consumedBy,
    });
    return resource;
  });
  const createdWriteIns = writeIns.map((entry) => {
    const resource = {
      id: makeId("job-resource"),
      jobId: action.jobId,
      actionId,
      inventoryItemId: "",
      type: "Material",
      name: entry.name,
      assetTag: "",
      quantity: entry.quantity,
      unit: entry.unit,
      status: "Consumed",
      writeIn: true,
      consumedAt,
      consumedBy,
    };
    data.jobResources.push(resource);
    return resource;
  });
  if (!data.inventoryAlerts) data.inventoryAlerts = [];
  alerts.forEach(({ inventoryItem, quantity, resultingBalance }) => {
    data.inventoryAlerts.push({
      id: makeId("inventory-alert"),
      inventoryItemId: inventoryItem.id,
      materialType: inventoryItem.materialType,
      jobId: action.jobId,
      actionId,
      requestedQuantity: quantity,
      onHandAtRequest: Number(inventoryItem.onHand || 0) + quantity,
      resultingBalance,
      requestedBy: consumedBy,
      status: "Open",
      createdAt: consumedAt,
    });
  });

  await saveBackend(data);
  await audit(request, { action: "consume", collection: "jobResources", recordId: actionId, summary: `${created.length + createdWriteIns.length} material line(s)`, alertsRaised: alerts.length });
  return json(response, 201, { resources: [...created, ...createdWriteIns], alertsRaised: alerts.length });
}

// Phase 11 (2026-09-23): builds the exact payload a real Intuit QuickBooks Online "Invoice" create
// call would send (v3 API Invoice entity — CustomerRef/Line[]/SalesItemLineDetail shape), so wiring
// up real OAuth later is a transport change, not a data-mapping project. `qboItemName` on a product
// and `qboCustomerName` on an account are optional overrides for what a real QBO item/customer is
// actually named there; everything else falls back to the name already on the record.
function roundCentsQbo(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildQboInvoicePayload(invoice, data) {
  const issues = [];
  const project = data.projects.find((item) => item.id === invoice.projectId) || null;
  const account = project ? data.accounts.find((item) => item.id === project.accountId) : null;
  const customerName = (account?.qboCustomerName || account?.name || invoice.customer || "").trim();
  if (!customerName) issues.push("No customer name — set an account name, or a qboCustomerName override, before exporting.");

  const rawLines = (data.invoiceLines || []).filter((line) => line.invoiceId === invoice.id && !line.deletedAt);
  const sourceLines = rawLines.length
    ? rawLines
    : [
        {
          productId: "",
          productName: "Services",
          productDescription: invoice.notes || "Services rendered",
          quantity: 1,
          billableQuantity: 1,
          pricePerUnit: Number(invoice.invoiceAmount || 0),
          extendedAmount: Number(invoice.invoiceAmount || 0),
        },
      ];
  if (!rawLines.length) {
    issues.push("No priced invoice line items were recorded — exported as a single summary line from the invoice total.");
  }

  const qboLines = sourceLines.map((line, index) => {
    const product = line.productId ? data.products.find((item) => item.id === line.productId) : null;
    const itemName = (product?.qboItemName || product?.name || line.productName || "").trim();
    if (!itemName) issues.push(`Line ${index + 1} ("${line.productDescription || "no description"}") has no item name to map to QuickBooks.`);
    const qty = Number(line.billableQuantity ?? line.quantity ?? 1);
    const unitPrice = Number(line.pricePerUnit || 0);
    const amount = roundCentsQbo(Number(line.extendedAmount ?? qty * unitPrice));
    if (Math.abs(roundCentsQbo(qty * unitPrice) - amount) > 0.01) {
      issues.push(`Line ${index + 1} ("${itemName || "no item"}"): ${qty} x ${unitPrice} does not equal its amount of ${amount.toFixed(2)}.`);
    }
    return {
      DetailType: "SalesItemLineDetail",
      Amount: amount,
      Description: line.productDescription || line.productName || "",
      SalesItemLineDetail: {
        ItemRef: { name: itemName || "Unmapped item" },
        Qty: qty,
        UnitPrice: unitPrice,
      },
    };
  });

  // Tax sits outside the lines (QBO's TxnTaxDetail), so the lines plus tax must equal the total.
  const lineTotal = roundCentsQbo(qboLines.reduce((sum, line) => sum + Number(line.Amount || 0), 0));
  const taxAmount = roundCentsQbo(Number(invoice.taxAmount || 0));
  const invoiceTotal = roundCentsQbo(Number(invoice.invoiceAmount || 0));
  if (Math.abs(lineTotal + taxAmount - invoiceTotal) > 0.01) {
    issues.push(`Line total (${lineTotal.toFixed(2)})${taxAmount ? ` plus tax (${taxAmount.toFixed(2)})` : ""} does not match the invoice total (${invoiceTotal.toFixed(2)}).`);
  }

  const payload = {
    DocNumber: invoice.invoiceNumber || invoice.id,
    TxnDate: invoice.invoiceDate || new Date().toISOString().slice(0, 10),
    DueDate: invoice.dueDate || "",
    CustomerRef: { name: customerName || "Unmapped customer" },
    Line: qboLines,
    PrivateNote: invoice.notes || "",
  };
  if (taxAmount) payload.TxnTaxDetail = { TotalTax: taxAmount };
  if (account?.email) payload.BillEmail = { Address: account.email };
  if (account?.addressOneStreetOne || account?.addressOneCity) {
    payload.BillAddr = {
      Line1: account.addressOneStreetOne || "",
      City: account.addressOneCity || "",
      CountrySubDivisionCode: account.addressOneState || "",
      PostalCode: account.addressOneZipCode || "",
      Country: account.addressOneCountry || "",
    };
  }

  return { payload, validationIssues: issues };
}

// ---- Phase 12a (2026-09-23): sessions, local sign-in, break-glass, audit, sign-on links ----
//
// Identity lives in <data>/auth.json (gitignored: password hashes, sessions, sign-on links, the
// break-glass account) and the audit trail in <data>/audit.log (append-only NDJSON). Neither is part
// of backend.json, so secrets never enter git or a business-data snapshot. Every /api/* request
// except /api/auth/* and the OwnTracks device endpoint needs a session cookie; the role on the
// session -- never a request header -- decides what the request may do. Providers are pluggable:
// `local` (password) and `breakGlass` ship now; `entra` (Phase 12b) validates a token and calls the
// same createSession().
const SESSION_COOKIE = "crm_session";
const SESSION_HOURS = 12;
const SESSION_TOUCH_MINUTES = 5;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 10;
const KNOWN_ROLES = ["Admin", "Office Manager", "Sales Manager", "Account Manager", "Operations Manager", "Scheduler", "Field Lead", "Inventory Manager", "Finance Manager", "Client Portal"];

// 2026-09-24 (owner, after a two-role user saw only one role's apps): a person can hold several
// roles and their access is the combination. KNOWN_ROLES is also the precedence order, used only
// to pick the primary role shown in the UI. A session may narrow itself to one "active role"
// (Settings > Roles and Permissions) until sign-out; an Admin may pick any role that way.
function sortRoles(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [list])
    .map((item) => String(item || "").trim())
    .filter((item) => KNOWN_ROLES.includes(item) && !seen.has(item) && seen.add(item))
    .sort((a, b) => KNOWN_ROLES.indexOf(a) - KNOWN_ROLES.indexOf(b));
}

// Client Portal is exclusive: an internal role on the same login wins over it.
function normalizeHeldRoles(list) {
  const roles = sortRoles(list);
  return roles.length > 1 ? roles.filter((role) => role !== "Client Portal") : roles;
}

function heldRoles(session) {
  return normalizeHeldRoles(Array.isArray(session?.roles) && session.roles.length ? session.roles : [session?.role]);
}

function effectiveRoles(session) {
  if (!session) return [];
  const held = heldRoles(session);
  const active = String(session.activeRole || "");
  if (active && KNOWN_ROLES.includes(active) && (held.includes(active) || held.includes("Admin"))) return [active];
  return held;
}

function rolesForUser(user) {
  return normalizeHeldRoles(Array.isArray(user?.roles) && user.roles.length ? user.roles : [roleForUser(user)]);
}
// Phase 18 item 4, Q36: the consent text is generic to start but versioned -- the version in force
// when someone agreed is what makes the record meaningful. Bump the version when the text changes.
const CONSENT_TERMS = {
  version: "2026-09-23.1",
  title: "Location sharing on a personal phone",
  text: [
    "You are signing in to BioRemedy Front Line on a phone that is not company-issued, for one dispatch job.",
    "While this sign-on is active, Front Line may record your phone's GPS position when you tap a location action (check-in, sample point, field ping). It does not track you in the background.",
    "Each position is stored with this job, the time, this device, and this agreement, and is kept for 90 days unless a project record requires it longer.",
    "This sign-on expires when the job window closes. You can decline now, and you can stop at any time by signing out.",
  ].join("\n\n"),
};

const authFile = path.join(dataDir, "auth.json");
const auditFile = path.join(dataDir, "audit.log");
const breakGlassPasswordFile = path.join(dataDir, "break-glass-password.txt");
const defaultAuth = { credentials: [], sessions: [], dispatchLinks: [], breakGlass: null };
let authCache = null;

async function loadAuth() {
  if (authCache) return authCache;
  if (!existsSync(authFile)) {
    authCache = structuredClone(defaultAuth);
    return authCache;
  }
  authCache = { ...structuredClone(defaultAuth), ...JSON.parse(await readFile(authFile, "utf8")) };
  return authCache;
}

async function saveAuth(auth) {
  authCache = auth;
  await mkdir(dataDir, { recursive: true });
  const tempFile = `${authFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  await renameWithRetry(tempFile, authFile);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash || typeof password !== "string") return false;
  const candidate = scryptSync(password, record.salt, 64);
  const stored = Buffer.from(record.hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function parseCookies(request) {
  const header = (request.headers.cookie || "").toString();
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function requestIsHttps(request) {
  return (request.headers["x-forwarded-proto"] || "").toString().includes("https");
}

function sessionCookie(token, request, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(60, Math.round(maxAgeSeconds))}${requestIsHttps(request) ? "; Secure" : ""}`;
}

function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function requestIp(request) {
  return (request.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || request.socket?.remoteAddress || "";
}

function requestOrigin(request) {
  const host = (request.headers["x-forwarded-host"] || request.headers.host || `localhost:${basePort}`).toString();
  return `${requestIsHttps(request) ? "https" : "http"}://${host}`;
}

function sessionExpired(session, now = Date.now()) {
  return new Date(session.expiresAt).getTime() <= now;
}

async function resolveSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const auth = await loadAuth();
  const tokenHash = hashToken(token);
  const session = auth.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session || session.revokedAt || sessionExpired(session)) return null;
  // Sliding expiry for people; a sign-on link keeps the job window it was issued for.
  const now = Date.now();
  if (session.kind !== "dispatch-link" && now - new Date(session.lastSeenAt || 0).getTime() > SESSION_TOUCH_MINUTES * 60000) {
    session.lastSeenAt = new Date(now).toISOString();
    session.expiresAt = new Date(now + SESSION_HOURS * 3600000).toISOString();
    await saveAuth(auth);
  }
  return session;
}

function publicSession(session) {
  return {
    id: session.id,
    kind: session.kind,
    systemUserId: session.systemUserId || "",
    employeeId: session.employeeId || "",
    name: session.name,
    email: session.email || "",
    role: effectiveRoles(session)[0] || session.role,
    roles: heldRoles(session),
    activeRole: session.activeRole || "",
    effectiveRoles: effectiveRoles(session),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    dispatchJobId: session.dispatchJobId || "",
    clientAccountId: session.clientAccountId || "",
    consentId: session.consentId || "",
    consentRequired: session.kind === "dispatch-link" && !session.consentId,
    termsVersion: CONSENT_TERMS.version,
  };
}

function pruneSessions(auth) {
  const cutoff = Date.now() - 30 * 86400000;
  auth.sessions = auth.sessions.filter((session) => new Date(session.expiresAt).getTime() > cutoff);
}

async function createSession(auth, request, { kind, systemUserId = "", employeeId = "", name, email = "", role, roles = [], dispatchJobId = "", expiresAt = "", clientAccountId = "" }) {
  const token = newToken();
  const now = new Date();
  const held = normalizeHeldRoles(roles.length ? roles : [role]);
  const session = {
    id: makeId("session"),
    tokenHash: hashToken(token),
    kind,
    systemUserId,
    employeeId,
    name,
    email,
    role: held[0] || role,
    roles: held,
    activeRole: "",
    dispatchJobId,
    clientAccountId,
    consentId: "",
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: expiresAt || new Date(now.getTime() + SESSION_HOURS * 3600000).toISOString(),
    revokedAt: "",
    revokedBy: "",
    ip: requestIp(request),
    userAgent: (request.headers["user-agent"] || "").toString().slice(0, 200),
  };
  auth.sessions.push(session);
  pruneSessions(auth);
  await saveAuth(auth);
  return { session, token };
}

async function revokeSessions(auth, predicate, revokedBy) {
  let count = 0;
  const now = new Date().toISOString();
  for (const session of auth.sessions) {
    if (!session.revokedAt && !sessionExpired(session) && predicate(session)) {
      session.revokedAt = now;
      session.revokedBy = revokedBy;
      count += 1;
    }
  }
  if (count) await saveAuth(auth);
  return count;
}

// The audit trail: one JSON line per event, appended, never rewritten. The actor is the session,
// which the client cannot forge; `performedAs` is the attribution the client sent (a field lead
// name from the Front Line simulator), kept separately.
async function audit(request, entry) {
  const session = request.session;
  const line = {
    at: new Date().toISOString(),
    actor: session ? { sessionId: session.id, userId: session.systemUserId || "", name: session.name, role: session.role, roles: heldRoles(session), ...(session.activeRole ? { activeRole: session.activeRole } : {}), kind: session.kind } : { name: "anonymous", role: "Anonymous", kind: "none" },
    ip: requestIp(request),
    ...entry,
  };
  const performedAs = request.headers["x-crm-user"]?.toString();
  if (performedAs && performedAs !== line.actor.name) line.performedAs = performedAs;
  await appendFile(auditFile, `${JSON.stringify(line)}\n`, "utf8");
}

async function readAudit(limit = 100) {
  if (!existsSync(auditFile)) return [];
  const raw = await readFile(auditFile, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

function changedKeys(before, after) {
  const ignore = new Set(["version", "updatedAt"]);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !ignore.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function recordSummary(record) {
  return String(record.name || record.jobNumber || record.fullName || record.displayName || record.subject || record.title || record.requestNumber || record.invoiceNumber || record.label || "").slice(0, 120);
}

// The attribution the client sent, falling back to the session. Used for the uploadedBy /
// consumedBy / receivedBy fields the way they were before; the audit line carries the real actor.
function attribution(request) {
  return request.headers["x-crm-user"]?.toString() || request.session?.name || getRole(request);
}

// The break-glass account: a local emergency admin that works when nothing else does. Its password
// is generated on first start and written to <data>/break-glass-password.txt (move it somewhere
// safe), or set from CRM_BREAK_GLASS_PASSWORD. Every use is a high-visibility audit event.
async function ensureBreakGlass() {
  const auth = await loadAuth();
  const fromEnv = process.env.CRM_BREAK_GLASS_PASSWORD || "";
  if (fromEnv) {
    auth.breakGlass = { ...hashPassword(fromEnv), createdAt: auth.breakGlass?.createdAt || new Date().toISOString(), source: "env" };
    await saveAuth(auth);
    return;
  }
  if (auth.breakGlass?.hash) return;
  const password = randomBytes(15).toString("base64url");
  auth.breakGlass = { ...hashPassword(password), createdAt: new Date().toISOString(), source: "generated" };
  await saveAuth(auth);
  await writeFile(
    breakGlassPasswordFile,
    `Break-glass (emergency admin) password, created ${auth.breakGlass.createdAt}.\nUse it on the sign-in screen under "Emergency access". Move this file somewhere safe and delete it from here.\n\n${password}\n`,
    "utf8",
  );
  console.log(`Break-glass account created; its password is in ${breakGlassPasswordFile} -- move it somewhere safe.`);
}

const loginFailures = new Map();
function loginKey(request, username) {
  return `${requestIp(request)}|${String(username || "").toLowerCase()}`;
}
function loginLocked(key) {
  const entry = loginFailures.get(key);
  return Boolean(entry && entry.count >= LOGIN_MAX_FAILURES && entry.until > Date.now());
}
function noteLoginFailure(key) {
  const entry = loginFailures.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + LOGIN_LOCK_MINUTES * 60000;
  loginFailures.set(key, entry);
}

function findSystemUser(data, identifier) {
  const needle = String(identifier || "").trim().toLowerCase();
  if (!needle) return null;
  return (data.systemUsers || []).find(
    (user) => !user.deletedAt && ((user.username || "").toLowerCase() === needle || (user.internalEmailAddress || "").toLowerCase() === needle),
  );
}

function roleForUser(user) {
  if (KNOWN_ROLES.includes(user.role)) return user.role;
  if (KNOWN_ROLES.includes(user.title)) return user.title;
  return "";
}

async function respondWithSession(request, response, auth, session, token) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": sessionCookie(token, request, (new Date(session.expiresAt).getTime() - Date.now()) / 1000),
  });
  response.end(JSON.stringify(publicSession(session)));
}

// ---- Phase 12b (2026-09-24): Microsoft Entra ID sign-in ----
//
// The browser runs the Authorization Code + PKCE flow against the bioremedy.com tenant and hands
// the resulting ID token to POST /api/auth/login { provider: "entra" }. Nothing in that token is
// trusted until this code has checked its RS256 signature against the keys Microsoft publishes for
// the tenant, its issuer, audience, lifetime, tenant and nonce. The CRM role comes from the app
// roles assigned in Entra (the `roles` claim; values below, highest first). A person who reaches
// here has already passed Entra's "assignment required", so an unknown one gets a user record on
// first sign-in. Local passwords stay as the fallback (CRM_LOCAL_LOGIN=off retires them once
// everyone is on Entra); break-glass always works.
const entraTenantId = process.env.CRM_ENTRA_TENANT_ID || "";
const entraClientId = process.env.CRM_ENTRA_CLIENT_ID || "";
const entraEnabled = Boolean(entraTenantId && entraClientId);
const entraScopes = "openid profile email offline_access User.Read";
const localLoginEnabled = (process.env.CRM_LOCAL_LOGIN || "on").toLowerCase() !== "off";
// Test hooks for a scratch server only: a JWKS file and issuer stand in for Microsoft's discovery
// endpoint so the validator can be exercised without a tenant. Never set these in production.
const entraTestJwksFile = process.env.CRM_ENTRA_TEST_JWKS_FILE || "";
const entraTestIssuer = process.env.CRM_ENTRA_TEST_ISSUER || "";
// App-role VALUES as created in the Entra app registration (2026-09-24), highest privilege first.
const ENTRA_ROLE_VALUES = [
  ["Admin", "Admin"],
  ["OfficeManager", "Office Manager"],
  ["SalesManager", "Sales Manager"],
  ["AccountManager", "Account Manager"],
  ["OperationsManager", "Operations Manager"],
  ["Scheduler", "Scheduler"],
  ["FieldLead", "Field Lead"],
  ["InventoryManager", "Inventory Manager"],
  ["FinanceManager", "Finance Manager"],
  ["ClientPortal", "Client Portal"],
];
let entraKeysCache = { keys: [], fetchedAt: 0, issuer: "" };

function base64UrlDecode(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function entraDiscovery() {
  if (entraTestJwksFile) {
    return { issuer: entraTestIssuer, jwks: JSON.parse(await readFile(entraTestJwksFile, "utf8")) };
  }
  const configResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/v2.0/.well-known/openid-configuration`);
  if (!configResponse.ok) throw new Error(`Microsoft's discovery document could not be fetched (${configResponse.status}).`);
  const config = await configResponse.json();
  const jwksResponse = await fetch(config.jwks_uri);
  if (!jwksResponse.ok) throw new Error(`Microsoft's signing keys could not be fetched (${jwksResponse.status}).`);
  return { issuer: config.issuer, jwks: await jwksResponse.json() };
}

// Keys are cached for a day; an unknown `kid` refreshes them, at most once a minute (key rollover).
async function entraSigningKey(kid) {
  const age = Date.now() - entraKeysCache.fetchedAt;
  let key = entraKeysCache.keys.find((item) => item.kid === kid);
  if ((!key || age > 24 * 3600000) && age > 60000) {
    const { issuer, jwks } = await entraDiscovery();
    entraKeysCache = { keys: Array.isArray(jwks.keys) ? jwks.keys : [], fetchedAt: Date.now(), issuer: issuer || "" };
    key = entraKeysCache.keys.find((item) => item.kid === kid);
  }
  return key ? { key, issuer: entraKeysCache.issuer } : null;
}

async function verifyEntraIdToken(idToken, expectedNonce) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token.");
  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  } catch {
    throw new Error("Malformed ID token.");
  }
  if (header.alg !== "RS256") throw new Error(`Unexpected token algorithm (${header.alg}).`);
  const found = await entraSigningKey(header.kid);
  if (!found) throw new Error("The token was signed with a key Microsoft does not publish for this tenant.");
  const publicKey = createPublicKey({ key: found.key, format: "jwk" });
  const signatureValid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, base64UrlDecode(parts[2]));
  if (!signatureValid) throw new Error("The token signature is not valid.");
  const expectedIssuer = String(found.issuer || "").replace("{tenantid}", entraTenantId);
  if (!claims.iss || (expectedIssuer && claims.iss !== expectedIssuer)) throw new Error("The token was not issued by the bioremedy.com tenant.");
  if (claims.aud !== entraClientId) throw new Error("The token is not for this application.");
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now - 60) throw new Error("The sign-in token has expired. Sign in again.");
  if (claims.nbf && claims.nbf > now + 300) throw new Error("The token is not valid yet.");
  if (claims.tid && claims.tid !== entraTenantId) throw new Error("The token is from a different tenant.");
  if (expectedNonce && claims.nonce !== expectedNonce) throw new Error("Sign-in nonce did not match. Please try again.");
  return claims;
}

// Every app role in the token, mapped and ordered by precedence; the record's own roles only when
// the token carries none.
function entraRolesFromClaims(claims, fallbackRoles) {
  const values = Array.isArray(claims.roles) ? claims.roles : [];
  const mapped = ENTRA_ROLE_VALUES.filter(([value]) => values.includes(value)).map(([, role]) => role);
  return normalizeHeldRoles(mapped.length ? mapped : fallbackRoles);
}

async function handleEntraLogin(request, response, body) {
  if (!entraEnabled) return json(response, 400, { error: "Microsoft sign-in is not configured on this server." });
  const key = loginKey(request, "entra");
  if (loginLocked(key)) return json(response, 429, { error: `Too many failed sign-ins. Try again in ${LOGIN_LOCK_MINUTES} minutes.` });
  let claims;
  try {
    claims = await verifyEntraIdToken(body.idToken, String(body.nonce || ""));
  } catch (error) {
    noteLoginFailure(key);
    await audit(request, { action: "login-failed", provider: "entra", severity: "medium", reason: error.message });
    return json(response, 401, { error: error.message });
  }
  const data = await loadBackend();
  const oid = String(claims.oid || claims.sub || "");
  const email = String(claims.preferred_username || claims.email || "").trim().toLowerCase();
  const name = String(claims.name || email || "Microsoft user").trim();
  let user = (data.systemUsers || []).find((item) => !item.deletedAt && oid && item.entraObjectId === oid) || (email ? findSystemUser(data, email) : null);
  const roles = entraRolesFromClaims(claims, user ? rolesForUser(user) : []);
  const role = roles[0] || "";
  const now = new Date().toISOString();
  if (!role) {
    await audit(request, { action: "login-failed", provider: "entra", severity: "medium", summary: email || name, reason: "no app role" });
    return json(response, 403, { error: "Your Microsoft account has no BioRemedy role yet. Ask an administrator to assign one in Entra (Enterprise applications › Users and groups)." });
  }
  if (!user) {
    user = touchRecord({
      id: makeId("user"),
      businessUnitId: "bu-bioremedy",
      fullName: name,
      username: email.split("@")[0] || "",
      internalEmailAddress: email,
      title: "",
      role,
      roles,
      employeeId: "",
      clientAccountId: "",
      isDisabled: false,
      entraObjectId: oid,
      createdAt: now,
      createdBy: "entra",
    });
    data.systemUsers.push(user);
    await audit(request, { action: "user-provisioned", provider: "entra", collection: "systemUsers", recordId: user.id, summary: `${user.fullName} as ${role}` });
  } else {
    if (user.isDisabled) {
      await audit(request, { action: "login-failed", provider: "entra", severity: "medium", summary: user.fullName, reason: "disabled" });
      return json(response, 403, { error: "This account is disabled in the CRM. Ask an administrator." });
    }
    // Entra is the source of truth for the role once a person signs in with it.
    let changed = false;
    if (oid && user.entraObjectId !== oid) (user.entraObjectId = oid), (changed = true);
    if (user.role !== role) (user.role = role), (changed = true);
    if (JSON.stringify(rolesForUser(user)) !== JSON.stringify(roles)) (user.roles = roles), (changed = true);
    if (!user.fullName && name) (user.fullName = name), (changed = true);
    if (!user.internalEmailAddress && email) (user.internalEmailAddress = email), (changed = true);
    if (changed) touchRecord(user);
  }
  await saveBackend(data);
  if (role === "Client Portal" && !user.clientAccountId) {
    await audit(request, { action: "login-failed", provider: "entra", severity: "low", summary: user.fullName, reason: "portal user not linked to an account" });
    return json(response, 403, { error: "Your login is not linked to a customer account yet. BioRemedy links it under Users & access; try again afterwards." });
  }
  loginFailures.delete(key);
  const auth = await loadAuth();
  const { session, token } = await createSession(auth, request, {
    kind: "entra",
    systemUserId: user.id,
    employeeId: user.employeeId || "",
    name: user.fullName,
    email: user.internalEmailAddress || email,
    role,
    roles,
    clientAccountId: role === "Client Portal" ? user.clientAccountId || "" : "",
  });
  request.session = session;
  await audit(request, { action: "login", provider: "entra", summary: user.fullName, roles: Array.isArray(claims.roles) ? claims.roles : [] });
  return respondWithSession(request, response, auth, session, token);
}

async function handleAuth(request, response, pathname) {
  const session = request.session;
  const method = request.method;

  // Which ways in this server offers; public, so the sign-in screen can show the right buttons.
  if (pathname === "/api/auth/providers" && method === "GET") {
    return json(response, 200, {
      entra: entraEnabled ? { tenantId: entraTenantId, clientId: entraClientId, scopes: entraScopes } : null,
      local: localLoginEnabled,
      breakGlass: true,
    });
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    if (!session) return json(response, 401, { error: "Sign in required.", unauthenticated: true });
    return json(response, 200, publicSession(session));
  }

  if (pathname === "/api/auth/terms" && method === "GET") {
    return json(response, 200, CONSENT_TERMS);
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readJsonBody(request);
    if (body.provider === "entra") return handleEntraLogin(request, response, body);
    if (!localLoginEnabled) return json(response, 400, { error: "Password sign-in is turned off here. Use Sign in with Microsoft." });
    const username = String(body.username || "").trim();
    const key = loginKey(request, username);
    if (loginLocked(key)) return json(response, 429, { error: `Too many failed sign-ins. Try again in ${LOGIN_LOCK_MINUTES} minutes.` });
    const data = await loadBackend();
    const user = findSystemUser(data, username);
    const auth = await loadAuth();
    const credential = user ? auth.credentials.find((item) => item.systemUserId === user.id) : null;
    const roles = user ? rolesForUser(user) : [];
    const role = roles[0] || "";
    if (!user || user.isDisabled || !credential || !verifyPassword(body.password, credential) || !role) {
      noteLoginFailure(key);
      await audit(request, { action: "login-failed", severity: "medium", summary: username, reason: !user ? "unknown user" : user.isDisabled ? "disabled" : !credential ? "no password set" : !role ? "no role" : "bad password" });
      return json(response, 401, { error: !user || !credential || user.isDisabled ? "That sign-in is not available. Check the username, or ask an administrator." : !role ? "This user has no role assigned yet. Ask an administrator." : "Wrong password." });
    }
    loginFailures.delete(key);
    const { session: created, token } = await createSession(auth, request, {
      kind: "user",
      systemUserId: user.id,
      employeeId: user.employeeId || "",
      name: user.fullName,
      email: user.internalEmailAddress || "",
      role,
      roles,
      clientAccountId: role === "Client Portal" ? user.clientAccountId || "" : "",
    });
    request.session = created;
    await audit(request, { action: "login", provider: "local", summary: user.fullName });
    return respondWithSession(request, response, auth, created, token);
  }

  if (pathname === "/api/auth/break-glass" && method === "POST") {
    const body = await readJsonBody(request);
    const key = loginKey(request, "break-glass");
    if (loginLocked(key)) return json(response, 429, { error: `Too many failed attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.` });
    const auth = await loadAuth();
    if (!verifyPassword(body.password, auth.breakGlass)) {
      noteLoginFailure(key);
      await audit(request, { action: "break-glass-failed", severity: "high" });
      return json(response, 401, { error: "Wrong emergency password." });
    }
    loginFailures.delete(key);
    const { session: created, token } = await createSession(auth, request, { kind: "breakglass", name: "Break-glass admin", role: "Admin" });
    request.session = created;
    await audit(request, { action: "break-glass", severity: "high", summary: "Emergency admin access used" });
    return respondWithSession(request, response, auth, created, token);
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    if (session) {
      const auth = await loadAuth();
      await revokeSessions(auth, (item) => item.id === session.id, session.name);
      await audit(request, { action: "logout" });
    }
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookie() });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!session) return json(response, 401, { error: "Sign in required.", unauthenticated: true });
  const isAdmin = effectiveRoles(session).includes("Admin");

  if (pathname === "/api/auth/password" && method === "POST") {
    const body = await readJsonBody(request);
    const targetUserId = String(body.userId || session.systemUserId || "");
    if (!targetUserId) return json(response, 400, { error: "No user to set a password for." });
    if (targetUserId !== session.systemUserId && !isAdmin) return json(response, 403, { error: "Only an administrator can set someone else's password." });
    const password = String(body.password || "");
    if (password.length < MIN_PASSWORD_LENGTH) return json(response, 400, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
    const data = await loadBackend();
    const user = (data.systemUsers || []).find((item) => item.id === targetUserId && !item.deletedAt);
    if (!user) return json(response, 404, { error: "User not found." });
    const auth = await loadAuth();
    const existing = auth.credentials.find((item) => item.systemUserId === user.id);
    const record = { id: existing?.id || makeId("credential"), systemUserId: user.id, algorithm: "scrypt", ...hashPassword(password), updatedAt: new Date().toISOString(), updatedBy: session.name };
    if (existing) Object.assign(existing, record);
    else auth.credentials.push(record);
    // Persist first (2026-09-24 fix: this used to rely on revokeSessions() saving, which it only
    // does when there was a session to revoke -- a first password was lost on the next restart).
    await saveAuth(auth);
    // A new password ends every other session that user has.
    await revokeSessions(auth, (item) => item.systemUserId === user.id && item.id !== session.id, session.name);
    await audit(request, { action: "password-set", collection: "systemUsers", recordId: user.id, summary: user.fullName, self: user.id === session.systemUserId });
    return json(response, 200, { ok: true, userId: user.id });
  }

  // 2026-09-24 (owner): pick which of your roles is active for this session; it lasts until
  // sign-out (a new session always starts with every role). An administrator can view the app as
  // any role. Always a narrowing, never a widening: the held roles are what is checked.
  if (pathname === "/api/auth/active-role" && method === "POST") {
    const body = await readJsonBody(request);
    const wanted = String(body.role || "").trim();
    const held = heldRoles(session);
    if (session.kind === "dispatch-link") return json(response, 400, { error: "A sign-on link session has a single role." });
    if (wanted && !KNOWN_ROLES.includes(wanted)) return json(response, 400, { error: `Unknown role "${wanted}".` });
    if (wanted && !held.includes(wanted) && !held.includes("Admin")) return json(response, 403, { error: "You do not hold that role." });
    if (wanted === "Client Portal" && !session.clientAccountId) return json(response, 400, { error: "Client Portal needs a customer account on the login. Use the portal preview instead." });
    const auth = await loadAuth();
    const stored = auth.sessions.find((item) => item.id === session.id);
    if (!stored) return json(response, 401, { error: "Sign in required.", unauthenticated: true });
    stored.activeRole = wanted && !(held.length === 1 && held[0] === wanted) ? wanted : "";
    await saveAuth(auth);
    session.activeRole = stored.activeRole;
    await audit(request, { action: "active-role", summary: stored.activeRole || "all roles" });
    return json(response, 200, publicSession(session));
  }

  // An administrator changes the emergency password from the app (2026-09-24). The generated file
  // is not rewritten: the new password lives only where the administrator keeps it.
  if (pathname === "/api/auth/break-glass/password" && method === "POST") {
    if (!isAdmin) return json(response, 403, { error: "Only an administrator can change the emergency password." });
    const body = await readJsonBody(request);
    const password = String(body.password || "");
    if (password.length < MIN_PASSWORD_LENGTH) return json(response, 400, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
    const auth = await loadAuth();
    auth.breakGlass = { ...hashPassword(password), createdAt: auth.breakGlass?.createdAt || new Date().toISOString(), changedAt: new Date().toISOString(), changedBy: session.name, source: "admin" };
    await saveAuth(auth);
    await audit(request, { action: "break-glass-password-changed", severity: "high", summary: `by ${session.name}` });
    return json(response, 200, { ok: true });
  }

  if (pathname === "/api/auth/users" && method === "GET") {
    if (!isAdmin) return json(response, 403, { error: "Admin role required." });
    const auth = await loadAuth();
    const status = {};
    for (const credential of auth.credentials) status[credential.systemUserId] = { hasPassword: true, passwordSetAt: credential.updatedAt };
    for (const item of auth.sessions) {
      if (!item.systemUserId) continue;
      const entry = (status[item.systemUserId] ||= { hasPassword: false });
      if (!entry.lastSignInAt || entry.lastSignInAt < item.createdAt) entry.lastSignInAt = item.createdAt;
    }
    return json(response, 200, { status, roles: KNOWN_ROLES });
  }

  if (pathname === "/api/auth/sessions" && method === "GET") {
    if (!isAdmin) return json(response, 403, { error: "Admin role required." });
    const auth = await loadAuth();
    const active = auth.sessions.filter((item) => !item.revokedAt && !sessionExpired(item)).map((item) => ({ ...publicSession(item), lastSeenAt: item.lastSeenAt, ip: item.ip, userAgent: item.userAgent, current: item.id === session.id }));
    return json(response, 200, active);
  }

  const revokeMatch = pathname.match(/^\/api\/auth\/sessions\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    if (!isAdmin) return json(response, 403, { error: "Admin role required." });
    const auth = await loadAuth();
    const count = await revokeSessions(auth, (item) => item.id === revokeMatch[1], session.name);
    await audit(request, { action: "session-revoked", recordId: revokeMatch[1], count });
    return json(response, 200, { revoked: count });
  }

  if (pathname === "/api/auth/audit" && method === "GET") {
    if (!isAdmin) return json(response, 403, { error: "Admin role required." });
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const limit = Math.min(500, Math.max(1, Number(requestUrl.searchParams.get("limit") || 100)));
    return json(response, 200, await readAudit(limit));
  }

  // ---- Phase 18 item 4: per-dispatch sign-on links + consent ----
  if (pathname === "/api/auth/dispatch-links" && method === "POST") {
    if (!canAccess(session.role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
    const body = await readJsonBody(request);
    const data = await loadBackend();
    const employee = (data.employees || []).find((item) => item.id === body.employeeId && !item.deletedAt);
    const job = (data.dispatchJobs || []).find((item) => item.id === body.dispatchJobId && !item.deletedAt);
    if (!employee || !job) return json(response, 404, { error: "Employee or dispatch job not found." });
    const windowEnd = new Date(job.scheduledEnd || job.scheduledStart || Date.now()).getTime();
    const expiresAt = new Date(Math.max(windowEnd, Date.now()) + 24 * 3600000).toISOString();
    const auth = await loadAuth();
    const token = newToken();
    const link = { id: makeId("signon"), tokenHash: hashToken(token), employeeId: employee.id, dispatchJobId: job.id, createdBy: session.name, createdAt: new Date().toISOString(), expiresAt, usedAt: "", sessionId: "" };
    auth.dispatchLinks.push(link);
    await saveAuth(auth);
    await audit(request, { action: "sign-on-link-created", collection: "dispatchJobs", recordId: job.id, summary: `${employee.displayName} · ${job.jobNumber}`, linkId: link.id, expiresAt });
    return json(response, 201, { id: link.id, url: `${requestOrigin(request)}/go/${token}`, expiresAt, employeeId: employee.id, dispatchJobId: job.id });
  }

  if (pathname === "/api/auth/dispatch-links" && method === "GET") {
    if (!canAccess(session.role, "dispatch")) return json(response, 403, { error: "Dispatch role required." });
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const jobId = requestUrl.searchParams.get("jobId") || "";
    const auth = await loadAuth();
    const links = auth.dispatchLinks
      .filter((link) => !jobId || link.dispatchJobId === jobId)
      .map((link) => ({ id: link.id, employeeId: link.employeeId, dispatchJobId: link.dispatchJobId, createdBy: link.createdBy, createdAt: link.createdAt, expiresAt: link.expiresAt, usedAt: link.usedAt, status: link.usedAt ? "used" : new Date(link.expiresAt).getTime() < Date.now() ? "expired" : "pending" }));
    return json(response, 200, links);
  }

  if (pathname === "/api/auth/consent" && method === "POST") {
    if (session.kind !== "dispatch-link") return json(response, 400, { error: "Consent is recorded for sign-on link sessions only." });
    const body = await readJsonBody(request);
    if (body.accepted !== true) return json(response, 400, { error: "Consent must be explicit." });
    if (session.consentId) return json(response, 200, { consentId: session.consentId, alreadyRecorded: true });
    const data = await loadBackend();
    const consent = touchRecord({
      id: makeId("consent"),
      employeeId: session.employeeId,
      dispatchJobId: session.dispatchJobId,
      sessionId: session.id,
      termsVersion: CONSENT_TERMS.version,
      termsTitle: CONSENT_TERMS.title,
      termsText: CONSENT_TERMS.text,
      acceptedAt: new Date().toISOString(),
      ip: requestIp(request),
      userAgent: (request.headers["user-agent"] || "").toString().slice(0, 200),
    });
    if (!Array.isArray(data.gpsConsents)) data.gpsConsents = [];
    data.gpsConsents.push(consent);
    await saveBackend(data);
    const auth = await loadAuth();
    const stored = auth.sessions.find((item) => item.id === session.id);
    if (stored) stored.consentId = consent.id;
    session.consentId = consent.id;
    await saveAuth(auth);
    await audit(request, { action: "gps-consent", collection: "gpsConsents", recordId: consent.id, summary: `${CONSENT_TERMS.version} · job ${session.dispatchJobId}` });
    return json(response, 201, { consentId: consent.id });
  }

  return json(response, 404, { error: "Auth route not found." });
}

// GET /go/<token>: a personal phone opens the sign-on link. The link becomes a job-scoped session
// (kind "dispatch-link", the job's window) and the phone lands on the consent page.
async function handleSignOnLink(request, response, token) {
  const auth = await loadAuth();
  const link = auth.dispatchLinks.find((item) => item.tokenHash === hashToken(token));
  const html = (status, title, body) => {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;background:#eef7ef;color:#13241b}main{max-width:420px;margin:auto;background:#fff;border:1px solid #d7e4d8;border-radius:16px;padding:24px}h1{font-size:1.2rem}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`);
  };
  if (!link) return html(404, "Sign-on link not found", "This link is not valid. Ask dispatch to send a new one.");
  if (link.usedAt) return html(410, "Sign-on link already used", "This link was already opened. Ask dispatch for a new one if you need to sign in again.");
  if (new Date(link.expiresAt).getTime() < Date.now()) return html(410, "Sign-on link expired", "This link has expired. Ask dispatch for a new one.");
  const data = await loadBackend();
  const employee = (data.employees || []).find((item) => item.id === link.employeeId);
  const job = (data.dispatchJobs || []).find((item) => item.id === link.dispatchJobId);
  if (!employee || !job) return html(410, "Sign-on link no longer valid", "The job or the person on this link no longer exists.");
  const { session, token: sessionToken } = await createSession(auth, request, {
    kind: "dispatch-link",
    employeeId: employee.id,
    name: employee.displayName,
    email: employee.primaryEmail || "",
    role: "Field Lead",
    dispatchJobId: job.id,
    expiresAt: link.expiresAt,
  });
  link.usedAt = new Date().toISOString();
  link.sessionId = session.id;
  await saveAuth(auth);
  request.session = session;
  await audit(request, { action: "sign-on-link-used", collection: "dispatchJobs", recordId: job.id, summary: `${employee.displayName} · ${job.jobNumber}`, linkId: link.id });
  response.writeHead(302, { Location: "/#view=frontline-consent", "Set-Cookie": sessionCookie(sessionToken, request, (new Date(link.expiresAt).getTime() - Date.now()) / 1000), "Cache-Control": "no-store" });
  response.end();
}

// ---- Phase 13 (2026-09-24): documents, document types, requirements, review, Client Portal scope ----
//
// One store any record can hang a file on (`documents`: polymorphic entityType/entityId, sha-256,
// versions by groupId, internal/customer visibility), a catalog of document types (`documentTypes`:
// the customer packet and Republic's waste authorization are fixed external PDFs that are filled,
// routed and stored -- never regenerated), and tracked requirements (`documentRequirements`) with the
// lifecycle Not started -> Sent -> Returned -> In review -> Approved | Rejected. Review is a human
// step: an upload can only ever put a requirement "In review". Q20: the CRM holds state-carrying
// documents; bulk material stays in SharePoint. Q22: 25 MB, PDF / images / Office formats.
const DOCUMENT_UPLOAD_MIME_TYPES = new Map([
  ...jobRequestDocumentMimeTypes,
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".txt", "text/plain; charset=utf-8"],
]);
const DOCUMENT_ENTITY_TYPES = new Map([
  ["account", "accounts"],
  ["contact", "contacts"],
  ["opportunity", "opportunities"],
  ["project", "projects"],
  ["facility", "facilities"],
  ["dispatchJob", "dispatchJobs"],
  ["jobRequest", "jobRequests"],
  ["accountApprovedSubcontractors", "accountApprovedSubcontractors"],
  ["vendorProfile", "vendorProfiles"],
  ["documentType", "documentTypes"],
  ["sample", "sampleRecords"],
  ["itMessage", "itMessages"],
]);
const REQUIREMENT_STATUSES = ["Not started", "Sent", "Returned", "In review", "Approved", "Rejected"];
const REVIEW_ROLES = ["Admin", "Office Manager", "Sales Manager", "Operations Manager"];
const templatesDir = path.join(root, "docs", "uploaded files");

const documentTypeSeed = [
  { id: "doctype-customer-packet", code: "customer-packet", name: "New customer packet", kind: "external-form", counterparty: "customer", appliesTo: ["account", "opportunity", "project"], stageGate: "Negotiation", requiresReview: true, expiryDays: null, templateFile: "New Customer Packet trey.pdf", description: "BioRemedy's new-account paperwork: sent to the customer, returned signed, reviewed by the office before the deal moves to Negotiation." },
  { id: "doctype-waste-authorization", code: "waste-authorization", name: "Third-party waste authorization (Republic)", kind: "external-form", counterparty: "customer", appliesTo: ["account", "opportunity", "project"], stageGate: "Negotiation", requiresReview: true, expiryDays: null, templateFile: "New Customer Packet trey.pdf", templateNote: "Republic's own form, the last page of the customer packet. It authorises BioRemedy as the generator's agent at the disposal facility. Fill it, route it for signature and store the signed copy; never regenerate or restyle it.", formFields: [["generatorName", "Name of generator"], ["generatorMailingAddress", "Generator mailing address"], ["generatorContactName", "Generator contact (print name)"], ["generatorContactTitle", "Generator contact title"], ["generatorContactPhone", "Generator contact phone"], ["profileNumber", "Republic profile number (internal)"], ["agentCompany", "Agent company"], ["agentAddress", "Agent company address"], ["agentIndividual", "Agent individual"], ["agentIndividualTitle", "Agent individual title"]], description: "Republic's waste profile authorization. One packet, two tracked requirements." },
  { id: "doctype-service-agreement-msa", code: "service-agreement-msa", name: "Service agreement — MSA", kind: "upload", counterparty: "customer", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: 365, description: "Master service agreement. Upload the office template on Identity & Sync › Document types; custom versions come back for review." },
  { id: "doctype-service-agreement-standing", code: "service-agreement-standing", name: "Service agreement — standing work order", kind: "upload", counterparty: "customer", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: 365, description: "Standing work order agreement." },
  { id: "doctype-service-agreement-rate", code: "service-agreement-rate", name: "Service agreement — rate agreement", kind: "upload", counterparty: "customer", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: 365, description: "Rate agreement." },
  { id: "doctype-signed-quote", code: "signed-quote", name: "Signed quote", kind: "upload", counterparty: "customer", appliesTo: ["opportunity"], stageGate: "", requiresReview: false, expiryDays: null, description: "The customer's signed copy of a quote." },
  { id: "doctype-vendor-form", code: "vendor-form", name: "New vendor form", kind: "external-form", counterparty: "vendor", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: null, templateFile: "New Vendor Form.pdf", description: "BioRemedy's vendor onboarding form." },
  { id: "doctype-vendor-w9", code: "vendor-w9", name: "W-9", kind: "upload", counterparty: "vendor", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: null, description: "The vendor's W-9. Approval marks the vendor profile's W-9 as approved." },
  { id: "doctype-vendor-coi", code: "vendor-coi", name: "Certificate of insurance (COI)", kind: "upload", counterparty: "vendor", appliesTo: ["account"], stageGate: "", requiresReview: true, expiryDays: 365, description: "Approval sets the vendor profile's insurance expiry from the certificate." },
  { id: "doctype-approval-letter", code: "approval-letter", name: "Customer approval letter (subcontractor)", kind: "upload", counterparty: "customer", appliesTo: ["accountApprovedSubcontractors"], stageGate: "", requiresReview: false, expiryDays: null, description: "The customer's written approval of a subcontractor." },
  { id: "doctype-site-photo", code: "site-photo", name: "Site photo", kind: "upload", counterparty: "internal", appliesTo: ["opportunity", "project", "facility", "account", "dispatchJob"], stageGate: "", requiresReview: false, expiryDays: null, isImage: true, description: "Photos from a site walk or from the field." },
  { id: "doctype-account-logo", code: "account-logo", name: "Account logo", kind: "upload", counterparty: "internal", appliesTo: ["account"], stageGate: "", requiresReview: false, expiryDays: null, isImage: true, description: "Shown on the account header." },
  { id: "doctype-lab-report", code: "lab-report", name: "Lab report", kind: "upload", counterparty: "internal", appliesTo: ["project", "sample", "dispatchJob"], stageGate: "", requiresReview: false, expiryDays: null, description: "A laboratory's report." },
  { id: "doctype-other", code: "other", name: "Other document", kind: "upload", counterparty: "internal", appliesTo: ["account", "contact", "opportunity", "project", "facility", "dispatchJob", "jobRequest"], stageGate: "", requiresReview: false, expiryDays: null, description: "Anything else worth keeping with the record." },
];

// Adds any seeded type that is missing; never overwrites an existing row (the office may have
// renamed one or uploaded a template).
function ensureDocumentTypes(data) {
  if (!Array.isArray(data.documentTypes)) data.documentTypes = [];
  let added = false;
  for (const type of documentTypeSeed) {
    if (data.documentTypes.some((item) => item.id === type.id)) continue;
    data.documentTypes.push(touchRecord(structuredClone(type)));
    added = true;
  }
  return added;
}

function documentEntityCollection(entityType) {
  return DOCUMENT_ENTITY_TYPES.get(entityType) || "";
}

function findEntityRecord(data, entityType, entityId) {
  const collection = documentEntityCollection(entityType);
  if (!collection) return null;
  return (data[collection] || []).find((item) => item.id === entityId && !item.deletedAt) || null;
}

// The account a document belongs to, for the Client Portal scope.
function accountIdForEntity(data, entityType, record) {
  if (!record) return "";
  if (entityType === "account") return record.id;
  if (entityType === "documentType") return "";
  if (record.accountId) return record.accountId;
  if (entityType === "dispatchJob" && record.projectId) return (data.projects || []).find((item) => item.id === record.projectId)?.accountId || "";
  if (entityType === "sample" && record.projectId) return (data.projects || []).find((item) => item.id === record.projectId)?.accountId || "";
  return "";
}

// ---- Messages to IT (owner, 2026-09-24) ----
// One conversation per signed-in person, keyed by their user id (the break-glass admin is
// "breakglass"). A person sees only their own conversation; an Admin (IT) sees every one and answers
// inside it. A screenshot is a document attached to the message (entityType "itMessage").
function itThreadKeyForSession(session) {
  return session?.systemUserId || (session?.kind === "breakglass" ? "breakglass" : session?.id || "");
}

function visibleItMessages(data, session, roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (!session || isPortalRole(list)) return [];
  const rows = (data.itMessages || []).filter((row) => !row.deletedAt);
  if (list.includes("Admin")) return rows;
  const key = itThreadKeyForSession(session);
  return rows.filter((row) => row.threadKey === key);
}

function normalizeItMessageWrite(data, request, body, stored) {
  const session = request.session;
  const roles = getRoles(request);
  if (!session || isPortalRole(roles)) return { error: "Customers cannot message IT here.", status: 403 };
  const isAdmin = roles.includes("Admin");
  const ownKey = itThreadKeyForSession(session);
  if (stored) {
    // After the fact only the read markers and the screenshot link change; text and author stay.
    if (!isAdmin && stored.threadKey !== ownKey) return { error: "Not your conversation.", status: 403 };
    const record = { ...stored, userReadAt: stored.userReadAt || String(body.userReadAt || ""), itReadAt: stored.itReadAt || String(body.itReadAt || "") };
    if (!stored.screenshotDocumentId && body.screenshotDocumentId) {
      const document = (data.documents || []).find((item) => item.id === body.screenshotDocumentId && !item.deletedAt && item.entityType === "itMessage" && item.entityId === stored.id);
      if (!document) return { error: "That screenshot is not attached to this message.", status: 400 };
      record.screenshotDocumentId = document.id;
    }
    return { record };
  }
  const text = String(body.body || "").trim().slice(0, 4000);
  if (!text) return { error: "Type a message.", status: 400 };
  let threadKey = ownKey;
  let threadName = session.name;
  let fromIT = false;
  if (isAdmin && body.threadKey && body.threadKey !== ownKey) {
    const existing = (data.itMessages || []).find((row) => row.threadKey === body.threadKey && !row.deletedAt);
    if (!existing) return { error: "That conversation does not exist.", status: 404 };
    threadKey = existing.threadKey;
    threadName = existing.threadName;
    fromIT = true;
  }
  const now = new Date().toISOString();
  return {
    record: {
      id: String(body.id || "") || makeId("it-message"),
      threadKey,
      threadName,
      authorUserId: session.systemUserId || "",
      authorName: session.name,
      authorRole: session.role,
      fromIT,
      body: text,
      screenshotDocumentId: "",
      pageUrl: String(body.pageUrl || "").slice(0, 300),
      userAgent: String(request.headers["user-agent"] || "").slice(0, 200),
      createdAt: now,
      userReadAt: fromIT ? "" : now,
      itReadAt: fromIT ? now : "",
    },
  };
}

// A customer login holds Client Portal and nothing else (an internal role on the same login wins).
function isPortalRole(role) {
  const roles = Array.isArray(role) ? role : [role];
  return roles.length > 0 && roles.every((item) => item === "Client Portal");
}

function portalCanSeeDocument(session, document) {
  return Boolean(session?.clientAccountId && document.accountId === session.clientAccountId && document.visibility === "customer" && !document.deletedAt);
}

// What a customer sees when they sign in: their own account and what hangs off it, and nothing
// about anyone else, any employee, or any internal document. Enforced here, not in the UI.
function portalView(data, session) {
  const accountId = session?.clientAccountId || "";
  const own = (rows, key = "accountId") => (rows || []).filter((row) => !row.deletedAt && row[key] === accountId);
  const projects = own(data.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const byProject = (rows) => (rows || []).filter((row) => !row.deletedAt && projectIds.has(row.projectId));
  const view = {};
  for (const key of Object.keys(data)) view[key] = Array.isArray(data[key]) ? [] : data[key] && typeof data[key] === "object" ? {} : data[key];
  view.accounts = own(data.accounts, "id");
  view.contacts = own(data.contacts);
  view.facilities = own(data.facilities);
  view.addresses = own(data.addresses);
  view.projects = projects;
  view.projectAlerts = byProject(data.projectAlerts);
  view.sampleRecords = byProject(data.sampleRecords);
  view.spatialData = byProject(data.spatialData);
  view.scheduleEvents = byProject(data.scheduleEvents);
  view.scheduledWork = own(data.scheduledWork);
  view.dispatchJobs = own(data.dispatchJobs).map((job) => ({ id: job.id, jobNumber: job.jobNumber, jobName: job.jobName, projectId: job.projectId, status: job.status, scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd, locationName: job.locationName }));
  view.documentTypes = (data.documentTypes || []).filter((type) => !type.deletedAt && type.counterparty === "customer");
  view.documents = (data.documents || []).filter((document) => portalCanSeeDocument(session, document));
  view.documentRequirements = (data.documentRequirements || []).filter((requirement) => !requirement.deletedAt && requirement.accountId === accountId && requirement.counterparty === "customer");
  view.systemUsers = [];
  return view;
}

function documentSummary(document) {
  return { ...document };
}

async function handleDocumentUpload(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
  const session = request.session;
  const role = getRoles(request);
  const header = (name) => decodeHeaderText(request.headers[name]?.toString() || "");
  const entityType = header("x-entity-type");
  const entityId = header("x-entity-id");
  const documentTypeId = header("x-document-type");
  const requirementId = header("x-requirement-id");
  const groupId = header("x-group-id");
  const caption = header("x-caption").slice(0, 200);
  let visibility = header("x-visibility") === "customer" ? "customer" : "internal";
  if (!documentEntityCollection(entityType)) return json(response, 400, { error: "Unknown record type for this document." });

  const fileName = normalizeUploadFileName(request.headers["x-file-name"]?.toString());
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = DOCUMENT_UPLOAD_MIME_TYPES.get(extension);
  if (!fileName || !mimeType) return json(response, 415, { error: "Upload a PDF, image, or Office document (25 MB max)." });

  const data = await loadBackend();
  const entity = findEntityRecord(data, entityType, entityId);
  if (!entity) return json(response, 404, { error: "The record this document belongs to was not found." });
  const accountId = accountIdForEntity(data, entityType, entity);
  const requirement = requirementId ? (data.documentRequirements || []).find((item) => item.id === requirementId && !item.deletedAt) : null;
  if (requirementId && !requirement) return json(response, 404, { error: "Requirement not found." });
  const type = documentTypeId ? (data.documentTypes || []).find((item) => item.id === documentTypeId) : requirement ? (data.documentTypes || []).find((item) => item.id === requirement.documentTypeId) : null;

  if (isPortalRole(role)) {
    // A customer may only return paperwork on their own requirements; what they send is theirs to see.
    if (!requirement || requirement.accountId !== session.clientAccountId || requirement.counterparty !== "customer") {
      return json(response, 403, { error: "Customers can only upload paperwork that was requested from them." });
    }
    visibility = "customer";
  } else if (!canAccess(role, "customerDirectory")) {
    return json(response, 403, { error: "Your role cannot upload documents." });
  }
  if (entityType === "documentType" && !role.includes("Admin")) return json(response, 403, { error: "Only an administrator can upload a document type's template." });

  const body = await readRequestBody(request, maxJobRequestDocumentBytes);
  if (!body.length) return json(response, 400, { error: "The selected file is empty." });
  const sha256 = createHash("sha256").update(body).digest("hex");
  const duplicate = (data.documents || []).find((item) => !item.deletedAt && item.sha256 === sha256 && item.entityType === entityType && item.entityId === entityId);
  if (duplicate) return json(response, 409, { error: `That exact file is already attached (${duplicate.fileName}, uploaded ${duplicate.uploadedAt.slice(0, 10)}).`, duplicate: true, documentId: duplicate.id });

  const previous = groupId ? (data.documents || []).filter((item) => item.groupId === groupId).sort((a, b) => b.versionNumber - a.versionNumber)[0] : null;
  const document = touchRecord({
    id: makeId("document"),
    entityType,
    entityId,
    accountId,
    documentTypeId: type?.id || previous?.documentTypeId || "",
    requirementId: requirement?.id || previous?.requirementId || "",
    fileName,
    mimeType,
    sizeBytes: body.length,
    sha256,
    storageName: "",
    groupId: previous?.groupId || "",
    versionNumber: previous ? Number(previous.versionNumber || 1) + 1 : 1,
    visibility: previous ? previous.visibility : visibility,
    caption: caption || previous?.caption || "",
    tags: previous?.tags || [],
    uploadedAt: new Date().toISOString(),
    uploadedBy: attribution(request),
    uploadedBySessionKind: session?.kind || "",
    retainUntil: "",
    deletedAt: "",
  });
  document.groupId = document.groupId || document.id;
  document.storageName = `${document.id}${extension}`;
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, document.storageName), body);
  if (!Array.isArray(data.documents)) data.documents = [];
  data.documents.push(document);

  if (requirement) {
    // Ingest never satisfies a requirement by itself: it goes to a person for review.
    requirement.currentDocumentId = document.id;
    requirement.documentIds = [...(requirement.documentIds || []), document.id];
    requirement.returnedAt = new Date().toISOString();
    requirement.status = type?.requiresReview === false ? "Approved" : "In review";
    if (requirement.status === "Approved") {
      requirement.reviewedAt = requirement.returnedAt;
      requirement.reviewedBy = "auto (no review required)";
    }
    touchRecord(requirement);
  }
  if (entityType === "accountApprovedSubcontractors") {
    entity.evidenceDocumentId = document.id;
    touchRecord(entity);
  }
  if (entityType === "documentType") {
    entity.templateDocumentId = document.id;
    touchRecord(entity);
  }
  await saveBackend(data);
  await audit(request, { action: "upload", collection: "documents", recordId: document.id, summary: `${document.fileName} → ${entityType}/${entityId}`, requirementId: requirement?.id || "", version: document.versionNumber });
  return json(response, 201, documentSummary(document));
}

async function handleDocumentFile(request, response, documentId, inline) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
  const role = getRoles(request);
  const data = await loadBackend();
  const document = (data.documents || []).find((item) => item.id === documentId);
  if (!document || document.deletedAt) return json(response, 404, { error: "Document not found." });
  if (isPortalRole(role)) {
    if (!portalCanSeeDocument(request.session, document)) return json(response, 403, { error: "This document is not shared with your account." });
  } else if (!canAccess(role, "customerDirectory")) {
    return json(response, 403, { error: "Your role cannot open documents." });
  }
  const filePath = path.resolve(uploadsDir, document.storageName);
  if (path.dirname(filePath) !== path.resolve(uploadsDir) || !existsSync(filePath)) return json(response, 404, { error: "Stored file is unavailable." });
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": document.mimeType || "application/octet-stream",
    "Content-Length": body.length,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    "Cache-Control": "private, no-store",
  });
  response.end(body);
}

// A type's blank form: the supplied PDF in docs/uploaded files (never served by the static branch),
// or the template the office uploaded for the type.
async function handleDocumentTemplate(request, response, typeId) {
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed." });
  const role = getRoles(request);
  const data = await loadBackend();
  const type = (data.documentTypes || []).find((item) => item.id === typeId && !item.deletedAt);
  if (!type) return json(response, 404, { error: "Document type not found." });
  if (isPortalRole(role) && type.counterparty !== "customer") return json(response, 403, { error: "Not available to customers." });
  if (type.templateDocumentId) {
    const template = (data.documents || []).find((item) => item.id === type.templateDocumentId && !item.deletedAt);
    if (template) {
      const filePath = path.resolve(uploadsDir, template.storageName);
      if (existsSync(filePath)) {
        const body = await readFile(filePath);
        response.writeHead(200, { "Content-Type": template.mimeType, "Content-Length": body.length, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.fileName)}`, "Cache-Control": "private, no-store" });
        response.end(body);
        return;
      }
    }
  }
  if (!type.templateFile) return json(response, 404, { error: "This document type has no blank form on file yet." });
  const filePath = path.resolve(templatesDir, type.templateFile);
  if (path.dirname(filePath) !== path.resolve(templatesDir) || !existsSync(filePath)) return json(response, 404, { error: "The blank form is missing from the templates folder." });
  const body = await readFile(filePath);
  response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": body.length, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(type.templateFile)}`, "Cache-Control": "private, no-store" });
  response.end(body);
}

// Side effects of an approved requirement, so the rest of the app reads one state instead of asking
// again: a COI stamps the vendor profile's insurance expiry, a W-9 its W-9 status, the customer
// packet marks the account's opportunities' paperwork signed (the Won gate reads that field).
function applyRequirementApproval(data, requirement, type) {
  if (!type) return;
  if (type.counterparty === "vendor" && requirement.accountId) {
    const profile = (data.vendorProfiles || []).find((item) => item.accountId === requirement.accountId && !item.deletedAt);
    if (profile) {
      if (type.code === "vendor-coi") {
        profile.insuranceStatus = "Valid";
        if (requirement.expiresAt) profile.insuranceExpiration = requirement.expiresAt.slice(0, 10);
        touchRecord(profile);
      }
      if (type.code === "vendor-w9") {
        profile.w9Status = "Approved";
        touchRecord(profile);
      }
    }
  }
  if (type.code === "customer-packet" && requirement.accountId) {
    for (const opportunity of data.opportunities || []) {
      if (opportunity.deletedAt || opportunity.accountId !== requirement.accountId) continue;
      if (requirement.entityType === "opportunity" && requirement.entityId !== opportunity.id) continue;
      if (opportunity.accountPaperworkStatus !== "Signed") {
        opportunity.accountPaperworkStatus = "Signed";
        touchRecord(opportunity);
      }
    }
  }
}

// Generic-route guard for documentRequirements: the lifecycle is enforced here. "In review" comes
// only from an upload; Approved / Rejected only from a review role, stamped with who and when.
function normalizeRequirementWrite(data, request, body, stored) {
  const role = getRoles(request);
  if (isPortalRole(role)) return { error: "Customers cannot change requirements.", status: 403 };
  const type = (data.documentTypes || []).find((item) => item.id === body.documentTypeId);
  if (!type) return { error: "Choose a document type.", status: 400 };
  const status = REQUIREMENT_STATUSES.includes(body.status) ? body.status : stored?.status || "Not started";
  const record = {
    ...(stored || {}),
    ...body,
    id: body.id || stored?.id,
    documentTypeId: type.id,
    counterparty: type.counterparty,
    status,
    documentIds: stored?.documentIds || body.documentIds || [],
    currentDocumentId: stored?.currentDocumentId || "",
    createdAt: stored?.createdAt || new Date().toISOString(),
    createdBy: stored?.createdBy || attribution(request),
  };
  const now = new Date().toISOString();
  if (status !== stored?.status) {
    if (status === "In review") return { error: "A requirement goes into review when a document is uploaded against it.", status: 400 };
    if (["Approved", "Rejected"].includes(status)) {
      if (!role.some((item) => REVIEW_ROLES.includes(item))) return { error: "Only an administrator, office manager, sales manager or operations manager can approve or reject paperwork.", status: 403 };
      if (status === "Approved" && type.requiresReview && !record.currentDocumentId) return { error: "Nothing has been returned yet — upload the signed document before approving.", status: 400 };
      record.reviewedAt = now;
      record.reviewedBy = request.session?.name || attribution(request);
      record.reviewNote = String(body.reviewNote || "").slice(0, 500);
      if (status === "Approved") {
        if (!record.expiresAt && type.expiryDays) record.expiresAt = new Date(Date.now() + type.expiryDays * 86400000).toISOString();
        applyRequirementApproval(data, record, type);
      }
    }
    if (status === "Sent") record.sentAt = record.sentAt || now;
    if (status === "Not started") {
      record.sentAt = "";
      record.reviewedAt = "";
      record.reviewedBy = "";
    }
  }
  return { record };
}

async function handleApi(request, response, pathname) {
  const role = getRoles(request);

  if (pathname === "/api/owntracks") {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    return handleOwnTracks(request, response, requestUrl);
  }

  const receivePurchaseOrderMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\/receive$/);
  if (receivePurchaseOrderMatch) {
    return handleReceivePurchaseOrder(request, response, receivePurchaseOrderMatch[1]);
  }

  const jobRequestDocumentUploadMatch = pathname.match(/^\/api\/job-requests\/([^/]+)\/documents$/);
  if (jobRequestDocumentUploadMatch) {
    return handleJobRequestDocumentUpload(request, response, jobRequestDocumentUploadMatch[1]);
  }

  const jobRequestDocumentDownloadMatch = pathname.match(/^\/api\/job-request-documents\/([^/]+)\/download$/);
  if (jobRequestDocumentDownloadMatch) {
    return handleJobRequestDocumentDownload(request, response, jobRequestDocumentDownloadMatch[1]);
  }

  const sampleLabReportUploadMatch = pathname.match(/^\/api\/samples\/([^/]+)\/lab-reports$/);
  if (sampleLabReportUploadMatch) {
    return handleSampleLabReportUpload(request, response, sampleLabReportUploadMatch[1]);
  }

  const sampleLabReportDownloadMatch = pathname.match(/^\/api\/sample-lab-reports\/([^/]+)\/download$/);
  if (sampleLabReportDownloadMatch) {
    return handleSampleLabReportDownload(request, response, sampleLabReportDownloadMatch[1]);
  }

  const jobTaskAttachmentUploadMatch = pathname.match(/^\/api\/job-actions\/([^/]+)\/attachments$/);
  if (jobTaskAttachmentUploadMatch) {
    return handleJobTaskAttachmentUpload(request, response, jobTaskAttachmentUploadMatch[1]);
  }

  const jobExpenseReceiptMatch = pathname.match(/^\/api\/job-expenses\/([^/]+)\/receipt$/);
  if (jobExpenseReceiptMatch) {
    return handleJobExpenseReceiptUpload(request, response, jobExpenseReceiptMatch[1]);
  }

  // Phase 13 (2026-09-24): the generic document store.
  if (pathname === "/api/documents") return handleDocumentUpload(request, response);
  const documentFileMatch = pathname.match(/^\/api\/documents\/([^/]+)\/(download|view)$/);
  if (documentFileMatch) return handleDocumentFile(request, response, documentFileMatch[1], documentFileMatch[2] === "view");
  const documentTemplateMatch = pathname.match(/^\/api\/document-types\/([^/]+)\/template$/);
  if (documentTemplateMatch) return handleDocumentTemplate(request, response, documentTemplateMatch[1]);

  const jobTaskAttachmentViewMatch = pathname.match(/^\/api\/job-task-attachments\/([^/]+)\/view$/);
  if (jobTaskAttachmentViewMatch) {
    return handleJobTaskAttachmentView(request, response, jobTaskAttachmentViewMatch[1]);
  }

  const jobTaskConsumeMatch = pathname.match(/^\/api\/job-actions\/([^/]+)\/consume$/);
  if (jobTaskConsumeMatch) {
    return handleJobTaskConsume(request, response, jobTaskConsumeMatch[1]);
  }

  if (pathname === "/api/backend" && request.method === "GET") {
    if (!canAccess(role, "identity")) return json(response, 403, { error: "Role is not allowed to read backend data." });
    const data = await loadBackend();
    return json(response, 200, filterBackendForRole(data, role, request.session));
  }

  if (pathname === "/api/qbo/export" && request.method === "POST") {
    if (!canAccess(role, "finance")) return json(response, 403, { error: "Finance role required." });
    const data = await loadBackend();
    const body = await readJsonBody(request);
    const invoice = data.invoices.find((item) => item.id === body.invoiceId);
    if (!invoice) return json(response, 404, { error: "Invoice not found." });

    const { payload, validationIssues } = buildQboInvoicePayload(invoice, data);
    const status = validationIssues.length ? "Blocked - fix mapping issues" : "Queued - QuickBooks credentials not connected";
    invoice.qboStatus = status;
    touchRecord(invoice);
    data.qboSettings.lastExportAt = new Date().toISOString();
    data.qboExports.push({
      id: makeId("qbo-export"),
      invoiceId: invoice.id,
      status,
      payload,
      validationIssues,
      createdAt: data.qboSettings.lastExportAt,
    });
    await saveBackend(data);
    await audit(request, { action: "qbo-export", collection: "invoices", recordId: invoice.id, summary: invoice.invoiceNumber || invoice.id, status });
    return json(response, 200, { invoice, qboSettings: data.qboSettings });
  }

  // Phase 20 item 5 (2026-09-23): DELETE /api/backend/{collection}/{id} soft-deletes the record and
  // its cascade (never removes a row); ?dryRun=1 only reports what would go. POST .../restore undoes
  // one delete, root and cascade together.
  const recordMatch = pathname.match(/^\/api\/backend\/([a-zA-Z]+)\/([^/]+?)(\/restore)?$/);
  if (recordMatch && (request.method === "DELETE" || (request.method === "POST" && recordMatch[3]))) {
    return handleSoftDelete(request, response, recordMatch[1], recordMatch[2], Boolean(recordMatch[3]));
  }

  const collectionMatch = pathname.match(/^\/api\/backend\/([a-zA-Z]+)$/);
  if (!collectionMatch) return json(response, 404, { error: "API route not found." });

  const collection = collectionMatch[1];
  const domain = collectionAccess[collection];
  if (!domain || !Array.isArray(defaultBackend[collection])) return json(response, 404, { error: "Unknown collection." });
  if (!canAccess(role, domain)) return json(response, 403, { error: `${domain} role required.` });

  const data = await loadBackend();

  if (request.method === "GET") {
    if (collection === "itMessages") return json(response, 200, visibleItMessages(data, request.session, role));
    return json(response, 200, data[collection]);
  }

  if (request.method === "POST") {
    if (collection === "weatherSnapshots") {
      return json(response, 405, { error: "Weather snapshots are captured by the server, never written directly." });
    }
    // Phase 11 (2026-09-23): the stock-movement ledger is derived, not authored -- every row comes
    // from handleReceivePurchaseOrder, handleJobTaskConsume, or the inventoryItems adjustment branch
    // below, each running inside the same load/save as the onHand change it explains. A generic
    // full-record replace here could write a movement with no matching stock change, or vice versa.
    if (collection === "inventoryMovements") {
      return json(response, 405, { error: "The stock ledger is written by the server only." });
    }
    if (collection === "gpsConsents") {
      return json(response, 405, { error: "Consent records are written only when someone accepts the terms." });
    }
    if (collection === "systemUsers" && !role.includes("Admin")) {
      return json(response, 403, { error: "Only an administrator can change users." });
    }
    if (collection === "documentTypes" && !role.includes("Admin")) {
      return json(response, 403, { error: "Only an administrator can change document types." });
    }
    if (isPortalRole(role)) {
      return json(response, 403, { error: "Customers cannot write records directly." });
    }
    const body = await readJsonBody(request);
    if (collection === "systemUsers") {
      // 2026-09-24: several roles per person; `role` stays the primary one (first by precedence).
      const requestedRoles = (Array.isArray(body.roles) && body.roles.length ? body.roles : [body.role]).map((item) => String(item || "").trim()).filter(Boolean);
      const unknownRole = requestedRoles.find((item) => !KNOWN_ROLES.includes(item));
      if (unknownRole) return json(response, 400, { error: `Unknown role "${unknownRole}".` });
      const roles = sortRoles(requestedRoles);
      if (roles.includes("Client Portal") && roles.length > 1) return json(response, 400, { error: "Client Portal cannot be combined with an internal role." });
      body.roles = roles;
      body.role = roles[0] || "";
      body.username = String(body.username || "").trim().toLowerCase();
      body.internalEmailAddress = String(body.internalEmailAddress || "").trim().toLowerCase();
      body.clientAccountId = body.role === "Client Portal" ? String(body.clientAccountId || "") : "";
      if (body.role === "Client Portal" && !body.clientAccountId) return json(response, 400, { error: "A Client Portal user needs the customer account they belong to." });
      const clash = (data.systemUsers || []).find((user) => user.id !== body.id && !user.deletedAt && ((body.username && (user.username || "").toLowerCase() === body.username) || (body.internalEmailAddress && (user.internalEmailAddress || "").toLowerCase() === body.internalEmailAddress)));
      if (clash) return json(response, 409, { error: `${clash.fullName} already uses that username or email.` });
    }
    let record = normalizeRecord(collection, body, data);
    if (collection === "documents") {
      // Files enter only through /api/documents; this route edits a document's metadata.
      const storedDocument = (data.documents || []).find((item) => item.id === body.id);
      if (!storedDocument) return json(response, 405, { error: "Upload files through the document store, not this route." });
      record = { ...storedDocument, visibility: body.visibility === "customer" ? "customer" : "internal", caption: String(body.caption || "").slice(0, 200), tags: Array.isArray(body.tags) ? body.tags : storedDocument.tags || [], documentTypeId: body.documentTypeId || storedDocument.documentTypeId, retainUntil: body.retainUntil || "" };
    }
    if (collection === "documentRequirements") {
      const storedRequirement = (data.documentRequirements || []).find((item) => item.id === body.id);
      const result = normalizeRequirementWrite(data, request, body, storedRequirement);
      if (result.error) return json(response, result.status, { error: result.error });
      record = result.record;
    }
    if (collection === "itMessages") {
      const storedMessage = (data.itMessages || []).find((item) => item.id === body.id);
      const result = normalizeItMessageWrite(data, request, body, storedMessage);
      if (result.error) return json(response, result.status, { error: result.error });
      record = result.record;
    }
    if (collection === "scheduleEvents") {
      const block = validateScheduleEvent(data, record);
      if (block) return json(response, 409, { error: block, blocked: true });
    }
    if (collection === "locations" && (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude))) {
      return json(response, 400, { error: "Map location requires valid latitude and longitude." });
    }
    if (collection === "vendorProfiles") {
      const conflict = data.vendorProfiles.find(
        (item) => item.accountId === record.accountId && item.id !== record.id,
      );
      if (conflict) return json(response, 409, { error: "This account already has a vendor profile." });
    }
    if (collection === "accountRelationshipExtensions") {
      const conflict = data.accountRelationshipExtensions.find(
        (item) => item.accountId === record.accountId && item.id !== record.id,
      );
      if (conflict) return json(response, 409, { error: "This account already has relationship details on file." });
    }

    const index = data[collection].findIndex((item) => item.id === record.id);
    const stored = index >= 0 ? data[collection][index] : null;
    const conflict = versionConflict(stored, body);
    if (conflict) return json(response, 409, conflict);
    // Phase 11 (2026-09-23): manual onHand edits (the only other path that changes stock) get a
    // ledger row too, so the ledger stays the complete explanation for every onHand change. `body`
    // is the raw payload (pre-whitelist) so the transient adjustmentNote survives to here even though
    // normalizeRecord drops it from the stored record.
    if (collection === "inventoryItems") {
      const previous = index >= 0 ? data[collection][index] : null;
      const previousOnHand = previous ? Number(previous.onHand || 0) : 0;
      const nextOnHand = Number(record.onHand || 0);
      if (previous ? previousOnHand !== nextOnHand : nextOnHand !== 0) {
        appendInventoryMovement(data, {
          inventoryItemId: record.id,
          quantityDelta: nextOnHand - previousOnHand,
          balanceAfter: nextOnHand,
          reason: "adjustment",
          refType: "inventoryItem",
          refId: record.id,
          by: attribution(request),
          note: body.adjustmentNote ? String(body.adjustmentNote).trim() : previous ? "" : "Opening balance",
        });
      }
    }
    touchRecord(record, stored);
    if (index >= 0) data[collection][index] = record;
    else data[collection].push(record);
    await saveBackend(data);
    if (collection === "systemUsers" && record.isDisabled) {
      // Disabling a user ends their sessions now, not at their next sign-in.
      const auth = await loadAuth();
      await revokeSessions(auth, (session) => session.systemUserId === record.id, request.session?.name || "system");
    }
    await audit(request, { action: stored ? "update" : "create", collection, recordId: record.id, summary: recordSummary(record), changed: stored ? changedKeys(stored, record) : undefined });
    return json(response, 200, record);
  }

  return json(response, 405, { error: "Method not allowed." });
}

async function handleSoftDelete(request, response, collection, id, restore) {
  const role = getRoles(request);
  const domain = collectionAccess[collection];
  if (!domain || !Array.isArray(defaultBackend[collection])) return json(response, 404, { error: "Unknown collection." });
  if (!canAccess(role, domain)) return json(response, 403, { error: `${domain} role required.` });
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const dryRun = !restore && requestUrl.searchParams.get("dryRun") === "1";
  const actor = attribution(request);
  const data = await loadBackend();
  if (collection === "itMessages" && !role.includes("Admin")) {
    const row = (data.itMessages || []).find((item) => item.id === id);
    if (!row || row.threadKey !== itThreadKeyForSession(request.session)) return json(response, 403, { error: "Not your conversation." });
  }
  const rootKey = `${collection}:${id}`;
  const now = new Date().toISOString();

  if (restore) {
    const root = (data[collection] || []).find((record) => record.id === id);
    if (!root) return json(response, 404, { error: "Record not found." });
    if (!root.deletedAt) return json(response, 409, { error: "That record is not deleted." });
    const counts = {};
    let total = 0;
    for (const [targetCollection, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) continue;
      for (const record of rows) {
        if (!record.deletedAt) continue;
        if (!(record === root || record.deletedVia === rootKey)) continue;
        record.deletedAt = "";
        record.deletedBy = "";
        record.deletedVia = "";
        record.restoredAt = now;
        record.restoredBy = actor;
        touchRecord(record);
        counts[targetCollection] = (counts[targetCollection] || 0) + 1;
        total += 1;
      }
    }
    await saveBackend(data);
    await audit(request, { action: "restore", collection, recordId: id, summary: recordSummary(root), total });
    return json(response, 200, { root: { collection, id }, restored: counts, total });
  }

  const { root, affected } = collectCascade(data, collection, id);
  if (!root) return json(response, 404, { error: "Record not found." });
  if (root.deletedAt) return json(response, 409, { error: "That record is already deleted." });
  const summary = cascadeSummary(affected);
  if (dryRun) return json(response, 200, { root: { collection, id }, dryRun: true, wouldDelete: summary.counts, total: summary.total });

  for (const [, bucket] of affected) {
    for (const record of bucket.values()) {
      record.deletedAt = now;
      record.deletedBy = actor;
      record.deletedVia = rootKey;
      touchRecord(record);
    }
  }
  await saveBackend(data);
  await audit(request, { action: "delete", collection, recordId: id, summary: recordSummary(root), cascade: summary.counts, total: summary.total });
  return json(response, 200, { root: { collection, id }, deleted: summary.counts, total: summary.total });
}

// ---- Phase 11 (2026-09-23): weather snapshots -----------------------------------------------
//
// Q39: weather is pulled, never typed. Q40: the second snapshot is taken when a dispatch job enters
// in_progress ("Start work"). Q41: snapshots are frozen; a report re-run later shows what was fetched
// then. The provider sits behind fetchWeatherObservation() so it can be swapped; every failure is
// stored as a visible "not_captured" row with its reason, never as a blank that reads as fair weather.
// CRM_WEATHER_PROVIDER=off makes every capture fail (used to test that path).
const weatherProvider = (process.env.CRM_WEATHER_PROVIDER || "open-meteo").toLowerCase();

const wmoWeatherCodes = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light rain showers", 81: "Rain showers", 82: "Violent rain showers", 85: "Light snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with light hail", 99: "Thunderstorm with heavy hail",
};

function compassPoint(degrees) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round((((Number(degrees) % 360) + 360) % 360) / 22.5) % 16];
}

async function fetchWeatherObservation({ latitude, longitude, at }) {
  if (weatherProvider === "off") throw new Error("Weather provider is switched off on this server.");
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error("No valid time to look weather up for.");
  const ageDays = (Date.now() - when.getTime()) / 86400000;
  if (ageDays < -0.1) throw new Error("That time is in the future.");
  // The forecast endpoint serves the recent past at hourly resolution; older dates come from the
  // reanalysis archive, which lags about five days behind.
  const base = ageDays > 80 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const day = when.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: day,
    end_date: day,
    hourly: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "GMT",
  });
  const providerResponse = await fetch(`${base}?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!providerResponse.ok) throw new Error(`Weather provider answered ${providerResponse.status}.`);
  const body = await providerResponse.json();
  const hourly = body.hourly || {};
  const times = hourly.time || [];
  let best = -1;
  let bestGap = Infinity;
  times.forEach((time, index) => {
    const gap = Math.abs(Date.parse(`${time}:00Z`) - when.getTime());
    if (gap < bestGap && hourly.temperature_2m?.[index] != null) {
      best = index;
      bestGap = gap;
    }
  });
  if (best < 0) throw new Error("The provider has no observation for that hour yet.");
  const code = hourly.weather_code?.[best];
  return {
    provider: "Open-Meteo",
    providerEndpoint: base,
    observationTime: `${times[best]}:00Z`,
    conditions: wmoWeatherCodes[code] || `WMO weather code ${code}`,
    weatherCode: code ?? null,
    temperatureF: hourly.temperature_2m?.[best] ?? null,
    relativeHumidity: hourly.relative_humidity_2m?.[best] ?? null,
    precipitationIn: hourly.precipitation?.[best] ?? null,
    windSpeedMph: hourly.wind_speed_10m?.[best] ?? null,
    windGustMph: hourly.wind_gusts_10m?.[best] ?? null,
    windDirectionDeg: hourly.wind_direction_10m?.[best] ?? null,
    windDirection: hourly.wind_direction_10m?.[best] != null ? compassPoint(hourly.wind_direction_10m[best]) : "",
  };
}

// The GPS locations row is the accurate anchor (a facility's mailing address can be miles from the
// crew). Order: the project's spill-origin point, any other project GPS point, the dispatch job's
// own coordinates, then the pin dropped on the emergency intake.
function resolveWeatherAnchor(data, project, dispatchJob) {
  const finite = (value) => value !== "" && value != null && Number.isFinite(Number(value));
  const points = (data.locations || []).filter((point) => point.projectId === project.id && finite(point.latitude) && finite(point.longitude));
  const point = points.find((item) => /spill origin/i.test(item.locationType || "")) || points[0];
  if (point) return { latitude: Number(point.latitude), longitude: Number(point.longitude), anchorSource: "GPS location", anchorLocationId: point.id, anchorLabel: point.label || "" };
  if (dispatchJob && finite(dispatchJob.latitude) && finite(dispatchJob.longitude)) {
    return { latitude: Number(dispatchJob.latitude), longitude: Number(dispatchJob.longitude), anchorSource: "Dispatch job coordinates", anchorLocationId: "", anchorLabel: dispatchJob.addressText || "" };
  }
  if (finite(project.incidentLatitude) && finite(project.incidentLongitude)) {
    return { latitude: Number(project.incidentLatitude), longitude: Number(project.incidentLongitude), anchorSource: "Emergency intake pin", anchorLocationId: "", anchorLabel: "" };
  }
  return null;
}

function findCapturedSnapshot(data, projectId, kind, dispatchJobId) {
  return (data.weatherSnapshots || []).find(
    (snapshot) => snapshot.projectId === projectId && snapshot.kind === kind && snapshot.status === "captured" && (kind === "incident" || snapshot.dispatchJobId === dispatchJobId),
  );
}

async function handleWeatherCapture(request, response) {
  const role = getRoles(request);
  if (!canAccess(role, "operations") && !canAccess(role, "dispatch")) return json(response, 403, { error: "Operations or dispatch role required." });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed." });
  const body = await readJsonBody(request);
  const kind = body.kind;
  if (!["incident", "response"].includes(kind)) return json(response, 400, { error: "kind must be incident or response." });

  const prepared = await serializeApi(async () => {
    const data = await loadBackend();
    const project = data.projects.find((item) => item.id === body.projectId);
    if (!project) return { error: [404, "Project not found."] };
    const dispatchJob = body.dispatchJobId ? data.dispatchJobs.find((item) => item.id === body.dispatchJobId) : null;
    if (kind === "response" && !dispatchJob) return { error: [400, "A response snapshot belongs to a dispatch job."] };
    const existing = findCapturedSnapshot(data, project.id, kind, dispatchJob?.id);
    if (existing) return { existing };
    const startedWork = kind === "response"
      ? (data.jobStatusEvents || []).filter((event) => event.jobId === dispatchJob.id && event.toStatus === "in_progress").sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))[0]
      : null;
    const observedFor = kind === "incident" ? project.incidentReportedAt || "" : startedWork?.occurredAt || body.observedFor || "";
    return { project, dispatchJob, observedFor, anchor: resolveWeatherAnchor(data, project, dispatchJob) };
  });
  if (prepared.error) return json(response, prepared.error[0], { error: prepared.error[1] });
  if (prepared.existing) return json(response, 200, { snapshot: prepared.existing, existing: true });
  // No time means nothing to look up; that's not a failed capture, so nothing is stored.
  if (!prepared.observedFor) {
    return json(response, 409, { error: kind === "incident" ? "This project has no incident time to look weather up for." : "This dispatch job has not started work yet." });
  }

  const { project, dispatchJob, observedFor, anchor } = prepared;
  const snapshot = {
    id: makeId("weather"),
    projectId: project.id,
    dispatchJobId: dispatchJob?.id || "",
    kind,
    observedFor,
    latitude: anchor?.latitude ?? null,
    longitude: anchor?.longitude ?? null,
    anchorSource: anchor?.anchorSource || "",
    anchorLocationId: anchor?.anchorLocationId || "",
    anchorLabel: anchor?.anchorLabel || "",
    requestedBy: attribution(request),
    fetchedAt: new Date().toISOString(),
    status: "not_captured",
    error: "",
  };
  if (!observedFor) {
    snapshot.error = kind === "incident" ? "This project has no incident time to look weather up for." : "This dispatch job has not started work yet.";
  } else if (!anchor) {
    snapshot.error = "No GPS location on this project to anchor the weather to.";
  } else {
    try {
      Object.assign(snapshot, await fetchWeatherObservation({ latitude: anchor.latitude, longitude: anchor.longitude, at: observedFor }), { status: "captured" });
    } catch (error) {
      snapshot.error = error.name === "TimeoutError" ? "The weather provider did not answer in time." : error.message || "Weather lookup failed.";
    }
  }

  const saved = await serializeApi(async () => {
    const data = await loadBackend();
    // Another request may have captured it while the provider call was in flight.
    const raced = findCapturedSnapshot(data, project.id, kind, dispatchJob?.id);
    if (raced) return { snapshot: raced, existing: true };
    data.weatherSnapshots.push(snapshot);
    await saveBackend(data);
    return { snapshot, existing: false };
  });
  return json(response, saved.existing ? 200 : 201, saved);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.startsWith("/api/")) {
      // Phase 12a (2026-09-23): every API request resolves its session first. Auth routes handle
      // their own requirements; the OwnTracks device endpoint keeps its own (token-less) contract for
      // now; everything else without a session is 401 -- the role header is never consulted.
      request.session = await resolveSession(request);
      if (pathname.startsWith("/api/auth/")) {
        await serializeApi(() => handleAuth(request, response, pathname));
        return;
      }
      if (pathname !== "/api/owntracks" && !request.session) {
        json(response, 401, { error: "Sign in required.", unauthenticated: true });
        return;
      }
      if (pathname === "/api/weather-snapshots/capture") {
        await handleWeatherCapture(request, response);
        return;
      }
      await serializeApi(() => handleApi(request, response, pathname));
      return;
    }
    if (pathname.startsWith("/go/")) {
      await serializeApi(() => handleSignOnLink(request, response, pathname.slice(4)));
      return;
    }

    if (pathname === "/") pathname = "/index.html";

    // Phase 20 item 0 (2026-09-23): serve the allowlist and public/ only. Before this, any file under
    // the project root came back 200 to anyone who could reach the URL (confirmed: the live database,
    // the server source, .git/config, the uploaded rate sheet). A request for something that exists
    // but is not allowed, or that has a file extension and does not exist, is a plain 404 -- never the
    // SPA fallback, which would hide the leak behind a 200. Only extensionless, non-existent paths
    // (view routes) fall back to index.html.
    const filePath = path.resolve(root, `.${pathname}`);
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const insideRoot = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    const allowed = insideRoot && (staticAllowlist.has(relativePath) || relativePath.startsWith("public/"));
    const isFile = allowed && existsSync(filePath) && statSync(filePath).isFile();
    let resolvedPath = filePath;
    if (!isFile) {
      if (!insideRoot || existsSync(filePath) || path.extname(pathname)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("Not found");
        return;
      }
      resolvedPath = path.join(root, "index.html");
    }
    const body = await readFile(resolvedPath);
    const mimeType = mimeTypes.get(path.extname(resolvedPath)) || "application/octet-stream";

    response.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": pathname.includes("service-worker") ? "no-cache" : "public, max-age=60",
    });
    response.end(body);
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    json(response, status, { error: error.message || "Server error" });
  }
});

function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < basePort + 20) {
      // With Microsoft sign-in on, the registered redirect URI names this exact port (owner,
      // 2026-09-24): moving quietly to the next one would break every sign-in. Stop instead.
      if (entraEnabled) {
        console.error(`Port ${port} is already in use. Microsoft sign-in is registered for this exact address, so the server will not move to another port. Stop the other server on ${port} and start again.`);
        process.exit(1);
      }
      listen(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, host, () => {
    console.log(`Environmental Services CRM running at http://127.0.0.1:${port}`);
    if (host === "0.0.0.0") {
      console.log(`Network access enabled on port ${port}`);
    }
    if (entraEnabled) {
      console.log(`Microsoft sign-in is on (tenant ${entraTenantId}). Redirect URIs to keep registered: http://localhost:${port}/ and the public HTTPS hostname.`);
    }
    startBackupSchedule();
    ensureBreakGlass().catch((error) => console.error(`Break-glass setup failed: ${error.message}`));
  });
}

function runScheduledBackup(reason) {
  if (!existsSync(dataFile)) return;
  try {
    const { snapshot, offMachine } = runBackupCycle({ source: dataFile, backupDir, uploadsDir, offMachineDir: offMachineBackupDir });
    const offNote = offMachine ? `; off-machine copy in ${offMachineBackupDir} (uploads: ${offMachine.uploads.copied} copied)` : "";
    console.log(`Backup (${reason}): ${snapshot.fileName}, ${snapshot.kept} kept locally${offNote}`);
  } catch (error) {
    // A failed backup must be loud but must never take the server down with it.
    console.error(`Backup (${reason}) failed: ${error.message}`);
  }
}

function startBackupSchedule() {
  if (!Number.isFinite(backupIntervalMinutes) || backupIntervalMinutes <= 0) {
    console.log("Scheduled backups are off (CRM_BACKUP_INTERVAL_MINUTES=0).");
    return;
  }
  if (!offMachineBackupDir) console.log("Off-machine backups are off: set CRM_BACKUP_DIR to a OneDrive-synced folder to turn them on.");
  runScheduledBackup("startup");
  const timer = setInterval(() => runScheduledBackup("scheduled"), backupIntervalMinutes * 60 * 1000);
  timer.unref();
}

listen(basePort);

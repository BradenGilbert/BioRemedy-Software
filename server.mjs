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
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".pdf", "application/pdf"],
  [".geojson", "application/geo+json"],
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
  // Phase 21 (Front Line 2, 2026-09-25). Field sessions read these through fieldProjections (W1);
  // the domains below are for office roles.
  jobSafetyBriefings: "dispatch",
  jobEquipmentUsage: "dispatch",
  formTemplates: "dispatch",
  siteWalkReports: "sales",
  siteWalkObservations: "sales",
  siteReferenceLayers: "customerDirectory",
  jurisdictions: "customerDirectory",
  libraryItems: "customerDirectory",
  libraryAcknowledgements: "customerDirectory",
  ergMaterials: "customerDirectory",
  ergGuides: "customerDirectory",
  ergDistances: "customerDirectory",
};

// What a brand-new data folder starts with (rewritten 2026-09-25 when the sample data was rebuilt):
// the reference catalog (industries, units, certification types, job type templates, the permit
// register, the 2026 rate sheet's price levels) and the real roster -- employees, teams, the crew and
// the users who sign in with Microsoft. No sample customers, projects or jobs: those come from
// data/demo-seed.json under CRM_SEED_DEMO=1 (scripts/rebuild-sample-data.mjs regenerates both), and
// the product catalog from scripts/import-rate-sheet.mjs. Every key must stay present, even when
// empty: the API treats a missing key as an unknown collection.
const defaultBackend = {
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
  scheduleEvents: [],
  locations: [],
  inventoryItems: [],
  purchaseOrders: [],
  inventoryMovements: [],
  equipmentAssets: [],
  equipmentMaintenanceRecords: [],
  equipmentRestockItems: [],
  employees: [
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-braden",
      employeeNumber: "BR-001",
      systemUserId: "user-braden",
      firstName: "Braden",
      lastName: "Gilbert",
      displayName: "Braden Gilbert",
      jobTitle: "Owner",
      primaryEmail: "braden@bioremedy.com",
      mobilePhone: "",
      managerEmployeeId: "",
      teamId: "wf-team-office",
      crewId: "",
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2023-01-02",
      skills: [
        "Sales",
        "Emergency response",
        "Drone operation"
      ],
      laborProductId: "prod-rs-senior-project-manager-er-manager-ic"
    },
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-logan",
      employeeNumber: "BR-002",
      systemUserId: "user-mufxiu60-brxind",
      firstName: "Logan",
      lastName: "Gallman",
      displayName: "Logan Gallman",
      jobTitle: "Operations Supervisor",
      primaryEmail: "logan@bioremedy.com",
      mobilePhone: "",
      managerEmployeeId: "emp-braden",
      teamId: "wf-team-ops",
      crewId: "crew-response-a",
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2024-03-04",
      skills: [
        "Emergency response",
        "Vactron operation",
        "CDL Class B",
        "Confined space"
      ],
      laborProductId: "prod-rs-supervisor"
    },
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-trey",
      employeeNumber: "BR-003",
      systemUserId: "user-trey",
      firstName: "Trey",
      lastName: "Franklin",
      displayName: "Trey Franklin",
      jobTitle: "Director of Sales",
      primaryEmail: "trey@bioremedy.com",
      mobilePhone: "",
      managerEmployeeId: "emp-braden",
      teamId: "wf-team-office",
      crewId: "",
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2024-06-10",
      skills: [
        "Sales",
        "Site walks",
        "Emergency response"
      ],
      laborProductId: "prod-rs-technician-hazmat-trained-confined-space-certified"
    },
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-tristan",
      employeeNumber: "BR-004",
      systemUserId: "user-mufwltzb-370whz",
      firstName: "Tristan",
      lastName: "Tarrant",
      displayName: "Tristan Tarrant",
      jobTitle: "Environmental Technician",
      primaryEmail: "tristan@bioremedy.com",
      mobilePhone: "",
      managerEmployeeId: "emp-logan",
      teamId: "wf-team-ops",
      crewId: "crew-response-a",
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2025-02-17",
      skills: [
        "Emergency response",
        "Absorbent deployment",
        "Inventory"
      ],
      laborProductId: "prod-rs-technician-hazmat-trained-confined-space-certified"
    },
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-joe",
      employeeNumber: "BR-005",
      systemUserId: "",
      firstName: "Joe",
      lastName: "",
      displayName: "Joe",
      jobTitle: "Environmental Technician",
      primaryEmail: "",
      mobilePhone: "",
      managerEmployeeId: "emp-logan",
      teamId: "wf-team-ops",
      crewId: "crew-response-a",
      dispatchEligible: true,
      frontlineEnabled: true,
      readinessStatus: "Ready",
      hireDate: "2025-08-04",
      skills: [
        "Emergency response",
        "Pressure washing",
        "Skid steer"
      ],
      laborProductId: "prod-rs-technician-hazmat-trained-confined-space-certified"
    },
    {
      employmentStatus: "Active",
      employmentType: "Full time",
      businessUnit: "BioRemedy — Georgetown",
      homeBase: "Georgetown",
      availabilitySummary: "Available",
      hoursWorked: 0,
      capacity: 45,
      id: "emp-charlotte",
      employeeNumber: "BR-006",
      systemUserId: "user-mufzbbt9-3ihefu",
      firstName: "Charlotte",
      lastName: "Stautzenberger",
      displayName: "Charlotte Stautzenberger",
      jobTitle: "Office Manager",
      primaryEmail: "charlotte@bioremedy.com",
      mobilePhone: "",
      managerEmployeeId: "emp-braden",
      teamId: "wf-team-office",
      crewId: "",
      dispatchEligible: false,
      frontlineEnabled: false,
      readinessStatus: "Office",
      hireDate: "2025-05-12",
      skills: [
        "Accounts payable",
        "Dispatch intake",
        "Customer paperwork"
      ],
      laborProductId: "prod-rs-administration"
    }
  ],
  certificationTypes: [
    {
      id: "certtype-hazwoper-40",
      name: "HAZWOPER 40-Hour",
      category: "Safety",
      issuingBody: "OSHA",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-hazwoper-refresher",
      name: "HAZWOPER 8-Hour Refresher",
      category: "Safety",
      issuingBody: "OSHA",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-hazwoper-supervisor",
      name: "HAZWOPER Supervisor",
      category: "Safety",
      issuingBody: "OSHA",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-cdl-b",
      name: "Commercial Driver's License (Class B)",
      category: "Driving",
      issuingBody: "State DMV",
      renewalIntervalMonths: 48,
      status: "Active"
    },
    {
      id: "certtype-vactron",
      name: "Vactron Operator Qualification",
      category: "Equipment",
      issuingBody: "BioRemedy internal",
      renewalIntervalMonths: 24,
      status: "Active"
    },
    {
      id: "certtype-drivers-license",
      name: "Driver's License",
      category: "Driving",
      issuingBody: "State DMV",
      renewalIntervalMonths: 48,
      status: "Active"
    },
    {
      id: "certtype-respirator-fit",
      name: "Respirator Fit Test",
      category: "Safety",
      issuingBody: "BioRemedy internal",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-soil-sampling",
      name: "Soil Sampling & Chain-of-Custody",
      category: "Technical",
      issuingBody: "BioRemedy internal",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-asbestos-worker",
      name: "Asbestos Worker Certification",
      category: "Compliance",
      issuingBody: "State Asbestos Program",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-dot-awareness",
      name: "DOT Hazmat Awareness",
      category: "Compliance",
      issuingBody: "DOT",
      renewalIntervalMonths: 12,
      status: "Active"
    },
    {
      id: "certtype-confined-space",
      name: "Confined Space Entry",
      category: "Safety",
      issuingBody: "OSHA",
      renewalIntervalMonths: 12,
      status: "Active"
    }
  ],
  employeeCertifications: [
    {
      id: "cert-logan-hazwoper",
      employeeId: "emp-logan",
      certTypeId: "certtype-hazwoper-40",
      recordType: "Certification",
      code: "HAZWOPER-40",
      name: "HAZWOPER 40-Hour",
      number: "",
      issuedOn: "2024-03-18",
      expiresOn: "2029-03-18",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2024-03-18",
      verified: true
    },
    {
      id: "cert-logan-refresher",
      employeeId: "emp-logan",
      certTypeId: "certtype-hazwoper-refresher",
      recordType: "Training",
      code: "HAZWOPER-8",
      name: "HAZWOPER 8-Hour Refresher",
      number: "",
      issuedOn: "2026-03-02",
      expiresOn: "2027-03-02",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-03-02",
      verified: true
    },
    {
      id: "cert-logan-supervisor",
      employeeId: "emp-logan",
      certTypeId: "certtype-hazwoper-supervisor",
      recordType: "Certification",
      code: "HAZWOPER-SUP",
      name: "HAZWOPER Supervisor",
      number: "",
      issuedOn: "2025-04-14",
      expiresOn: "2028-04-14",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-04-14",
      verified: true
    },
    {
      id: "cert-logan-cdl",
      employeeId: "emp-logan",
      certTypeId: "certtype-cdl-b",
      recordType: "Credential",
      code: "CDL-B",
      name: "Commercial Driver's License (Class B)",
      number: "",
      issuedOn: "2024-09-09",
      expiresOn: "2028-09-09",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2024-09-09",
      verified: true
    },
    {
      id: "cert-logan-vactron",
      employeeId: "emp-logan",
      certTypeId: "certtype-vactron",
      recordType: "Qualification",
      code: "VACTRON",
      name: "Vactron Operator Qualification",
      number: "",
      issuedOn: "2025-01-20",
      expiresOn: "2027-01-20",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-01-20",
      verified: true
    },
    {
      id: "cert-logan-confined",
      employeeId: "emp-logan",
      certTypeId: "certtype-confined-space",
      recordType: "Certification",
      code: "CSE",
      name: "Confined Space Entry",
      number: "",
      issuedOn: "2025-06-02",
      expiresOn: "2026-06-02",
      status: "Expired",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-06-02",
      verified: true
    },
    {
      id: "cert-logan-fit",
      employeeId: "emp-logan",
      certTypeId: "certtype-respirator-fit",
      recordType: "Clearance",
      code: "RESP-FIT",
      name: "Respirator Fit Test",
      number: "",
      issuedOn: "2026-02-10",
      expiresOn: "2027-02-10",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-02-10",
      verified: true
    },
    {
      id: "cert-tristan-hazwoper",
      employeeId: "emp-tristan",
      certTypeId: "certtype-hazwoper-40",
      recordType: "Certification",
      code: "HAZWOPER-40",
      name: "HAZWOPER 40-Hour",
      number: "",
      issuedOn: "2025-03-03",
      expiresOn: "2030-03-03",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-03-03",
      verified: true
    },
    {
      id: "cert-tristan-refresher",
      employeeId: "emp-tristan",
      certTypeId: "certtype-hazwoper-refresher",
      recordType: "Training",
      code: "HAZWOPER-8",
      name: "HAZWOPER 8-Hour Refresher",
      number: "",
      issuedOn: "2026-03-02",
      expiresOn: "2027-03-02",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-03-02",
      verified: true
    },
    {
      id: "cert-tristan-fit",
      employeeId: "emp-tristan",
      certTypeId: "certtype-respirator-fit",
      recordType: "Clearance",
      code: "RESP-FIT",
      name: "Respirator Fit Test",
      number: "",
      issuedOn: "2026-02-10",
      expiresOn: "2027-02-10",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-02-10",
      verified: true
    },
    {
      id: "cert-tristan-confined",
      employeeId: "emp-tristan",
      certTypeId: "certtype-confined-space",
      recordType: "Certification",
      code: "CSE",
      name: "Confined Space Entry",
      number: "",
      issuedOn: "2025-10-06",
      expiresOn: "2026-10-06",
      status: "Expiring",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-10-06",
      verified: true
    },
    {
      id: "cert-tristan-dot",
      employeeId: "emp-tristan",
      certTypeId: "certtype-dot-awareness",
      recordType: "Training",
      code: "DOT-AWARE",
      name: "DOT Hazmat Awareness",
      number: "",
      issuedOn: "2025-09-15",
      expiresOn: "2026-09-15",
      status: "Expired",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-09-15",
      verified: true
    },
    {
      id: "cert-joe-hazwoper",
      employeeId: "emp-joe",
      certTypeId: "certtype-hazwoper-40",
      recordType: "Certification",
      code: "HAZWOPER-40",
      name: "HAZWOPER 40-Hour",
      number: "",
      issuedOn: "2025-08-25",
      expiresOn: "2030-08-25",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-08-25",
      verified: true
    },
    {
      id: "cert-joe-refresher",
      employeeId: "emp-joe",
      certTypeId: "certtype-hazwoper-refresher",
      recordType: "Training",
      code: "HAZWOPER-8",
      name: "HAZWOPER 8-Hour Refresher",
      number: "",
      issuedOn: "2025-10-20",
      expiresOn: "2026-10-20",
      status: "Expiring",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-10-20",
      verified: true
    },
    {
      id: "cert-joe-fit",
      employeeId: "emp-joe",
      certTypeId: "certtype-respirator-fit",
      recordType: "Clearance",
      code: "RESP-FIT",
      name: "Respirator Fit Test",
      number: "",
      issuedOn: "2026-02-10",
      expiresOn: "2027-02-10",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-02-10",
      verified: true
    },
    {
      id: "cert-joe-dl",
      employeeId: "emp-joe",
      certTypeId: "certtype-drivers-license",
      recordType: "Credential",
      code: "DL-TX",
      name: "Driver's License",
      number: "",
      issuedOn: "2023-05-30",
      expiresOn: "2031-05-30",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2023-05-30",
      verified: true
    },
    {
      id: "cert-trey-hazwoper",
      employeeId: "emp-trey",
      certTypeId: "certtype-hazwoper-40",
      recordType: "Certification",
      code: "HAZWOPER-40",
      name: "HAZWOPER 40-Hour",
      number: "",
      issuedOn: "2024-07-15",
      expiresOn: "2029-07-15",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2024-07-15",
      verified: true
    },
    {
      id: "cert-trey-refresher",
      employeeId: "emp-trey",
      certTypeId: "certtype-hazwoper-refresher",
      recordType: "Training",
      code: "HAZWOPER-8",
      name: "HAZWOPER 8-Hour Refresher",
      number: "",
      issuedOn: "2025-07-07",
      expiresOn: "2026-07-07",
      status: "Expired",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2025-07-07",
      verified: true
    },
    {
      id: "cert-braden-hazwoper",
      employeeId: "emp-braden",
      certTypeId: "certtype-hazwoper-40",
      recordType: "Certification",
      code: "HAZWOPER-40",
      name: "HAZWOPER 40-Hour",
      number: "",
      issuedOn: "2023-02-06",
      expiresOn: "2028-02-06",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2023-02-06",
      verified: true
    },
    {
      id: "cert-braden-refresher",
      employeeId: "emp-braden",
      certTypeId: "certtype-hazwoper-refresher",
      recordType: "Training",
      code: "HAZWOPER-8",
      name: "HAZWOPER 8-Hour Refresher",
      number: "",
      issuedOn: "2026-03-02",
      expiresOn: "2027-03-02",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2026-03-02",
      verified: true
    },
    {
      id: "cert-braden-supervisor",
      employeeId: "emp-braden",
      certTypeId: "certtype-hazwoper-supervisor",
      recordType: "Certification",
      code: "HAZWOPER-SUP",
      name: "HAZWOPER Supervisor",
      number: "",
      issuedOn: "2024-05-13",
      expiresOn: "2027-05-13",
      status: "Valid",
      assignmentStatus: "Completed",
      trainingStartedOn: "",
      trainingCompletedOn: "2024-05-13",
      verified: true
    }
  ],
  workforceTeams: [
    {
      id: "wf-team-ops",
      code: "OPS",
      name: "Field Operations",
      managerEmployeeId: "emp-logan",
      businessUnit: "BioRemedy — Georgetown",
      status: "Active"
    },
    {
      id: "wf-team-office",
      code: "OFFICE",
      name: "Sales & Office",
      managerEmployeeId: "emp-braden",
      businessUnit: "BioRemedy — Georgetown",
      status: "Active"
    }
  ],
  workforceTeamMemberships: [
    {
      id: "tm-logan-ops",
      teamId: "wf-team-ops",
      employeeId: "emp-logan",
      role: "Supervisor",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-tristan-ops",
      teamId: "wf-team-ops",
      employeeId: "emp-tristan",
      role: "Technician",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-joe-ops",
      teamId: "wf-team-ops",
      employeeId: "emp-joe",
      role: "Technician",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-braden-office",
      teamId: "wf-team-office",
      employeeId: "emp-braden",
      role: "Owner",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-trey-office",
      teamId: "wf-team-office",
      employeeId: "emp-trey",
      role: "Director of Sales",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-charlotte-office",
      teamId: "wf-team-office",
      employeeId: "emp-charlotte",
      role: "Office Manager",
      primary: true,
      status: "Active"
    },
    {
      id: "tm-trey-crew",
      crewId: "crew-response-a",
      employeeId: "emp-trey",
      role: "Fill-in technician",
      primary: false,
      status: "Active"
    },
    {
      id: "tm-braden-crew",
      crewId: "crew-response-a",
      employeeId: "emp-braden",
      role: "Fill-in / incident commander",
      primary: false,
      status: "Active"
    }
  ],
  crewProfiles: [
    {
      id: "crew-response-a",
      code: "RESP-A",
      name: "Response Crew A",
      type: "Emergency response",
      supervisorEmployeeId: "emp-logan",
      status: "Active",
      timezone: "America/Chicago",
      requiredCertTypeIds: [
        "certtype-hazwoper-40"
      ]
    }
  ],
  availabilityBlocks: [],
  standbyAssignments: [],
  standbyRotationSettings: [
    {
      id: "default",
      rotationPattern: "Weekly",
      notes: "Rotates every Friday 5pm",
      updatedBy: "Olivia Grant"
    }
  ],
  frontlineDevices: [],
  timeEntries: [],
  jobMileageEntries: [],
  messages: [],
  inventoryAlerts: [],
  gpsConsents: [],
  itMessages: [],
  documents: [],
  documentTypes: [],
  documentRequirements: [],
  jobRequests: [],
  jobRequestDocuments: [],
  dispatchJobs: [],
  jobAssignments: [],
  jobScheduleSegments: [],
  jobResources: [],
  jobConflicts: [],
  jobSteps: [],
  jobActions: [],
  jobFormSubmissions: [],
  jobTypeTemplates: [
    {
      id: "jobtype-emergency-response",
      name: "Emergency Spill Response",
      serviceCategory: "ER",
      description: "Fast mobile intake through field closeout for urgent spills, releases, and incidents.",
      isActive: true,
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            {
              key: "accept_dispatch",
              name: "Acknowledge dispatch",
              type: "Status transition",
              assigneeScope: "All assigned workers",
              required: true,
              config: {}
            },
            {
              key: "travel",
              name: "Capture travel and truck time",
              type: "Timer",
              assigneeScope: "Each worker",
              required: true,
              config: {
                anchor: "on_site"
              }
            },
            {
              key: "arrival",
              name: "Arrive and verify site contact",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true,
              config: {}
            }
          ]
        },
        {
          key: "stabilize",
          name: "Stabilize Site",
          sequence: 2,
          tasks: [
            {
              key: "site_safety",
              name: "Complete site safety assessment",
              type: "Checklist",
              assigneeScope: "Field Lead",
              required: true,
              config: {
                options: [
                  "Drains protected",
                  "Booms deployed",
                  "Spill contained"
                ]
              }
            },
            {
              key: "containment",
              name: "Deploy containment and protect drains",
              type: "Checklist",
              assigneeScope: "Any assigned worker",
              required: true,
              config: {
                options: []
              }
            },
            {
              key: "material_use",
              name: "Log bacteria and absorbent use",
              type: "Material",
              assigneeScope: "Any assigned worker",
              required: true,
              config: {
                suggestedItemIds: []
              }
            }
          ]
        },
        {
          key: "document",
          name: "Document Work",
          sequence: 3,
          tasks: [
            {
              key: "photos",
              name: "Capture before, progress, and after photos",
              type: "Photo",
              assigneeScope: "Any assigned worker",
              required: true,
              config: {
                minPhotos: 1
              }
            },
            {
              key: "drain_check",
              name: "Document drain or soil impact",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true,
              config: {}
            }
          ]
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 4,
          tasks: [
            {
              key: "recap",
              name: "Complete job recap",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true,
              config: {}
            },
            {
              key: "signature",
              name: "Capture customer completion signature",
              type: "Signature",
              assigneeScope: "Field Lead",
              required: true,
              config: {
                signerRole: "Customer"
              }
            }
          ]
        }
      ],
      updatedBy: "Braden Gilbert"
    },
    {
      id: "jobtype-sampling",
      name: "Environmental Sampling",
      serviceCategory: "Sampling",
      description: "Sample collection, chain of custody, and lab delivery for compliance and monitoring visits.",
      isActive: true,
      createdBy: "System",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            {
              key: "accept_dispatch",
              name: "Acknowledge dispatch",
              type: "Status transition",
              assigneeScope: "All assigned workers",
              required: true
            },
            {
              key: "travel",
              name: "Capture travel and truck time",
              type: "Timer",
              assigneeScope: "Each worker",
              required: true
            }
          ]
        },
        {
          key: "collect_samples",
          name: "Collect Samples",
          sequence: 2,
          tasks: [
            {
              key: "samples",
              name: "Collect samples at planned locations",
              type: "Sample",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "custody",
              name: "Complete chain of custody",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 3,
          tasks: [
            {
              key: "recap",
              name: "Complete shift recap",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "lab_delivery",
              name: "Log lab courier or delivery",
              type: "Checklist",
              assigneeScope: "Any assigned worker",
              required: true
            }
          ]
        }
      ],
      updatedBy: "Braden Gilbert"
    },
    {
      id: "jobtype-scheduled-service",
      name: "Scheduled Environmental Service",
      serviceCategory: "Scheduled",
      description: "Routine planned service visits with a standard checklist and customer sign-off.",
      isActive: true,
      createdBy: "System",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            {
              key: "accept_dispatch",
              name: "Acknowledge dispatch",
              type: "Status transition",
              assigneeScope: "All assigned workers",
              required: true
            },
            {
              key: "arrival",
              name: "Arrive and verify site contact",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "perform_work",
          name: "Perform Work",
          sequence: 2,
          tasks: [
            {
              key: "service_checklist",
              name: "Complete scheduled service checklist",
              type: "Checklist",
              assigneeScope: "Any assigned worker",
              required: true
            },
            {
              key: "material_use",
              name: "Log material and consumable use",
              type: "Material",
              assigneeScope: "Any assigned worker",
              required: true
            }
          ]
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 3,
          tasks: [
            {
              key: "recap",
              name: "Complete job recap",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "signature",
              name: "Capture customer completion signature",
              type: "Signature",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        }
      ],
      updatedBy: "Braden Gilbert"
    },
    {
      id: "jobtype-remediation",
      name: "Remediation Field Work",
      serviceCategory: "Remediation",
      description: "Multi-day soil, groundwater, or bioremediation field work from setup through documentation.",
      isActive: true,
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            {
              key: "accept_dispatch",
              name: "Acknowledge dispatch",
              type: "Status transition",
              assigneeScope: "All assigned workers",
              required: true
            },
            {
              key: "travel",
              name: "Capture travel and truck time",
              type: "Timer",
              assigneeScope: "Each worker",
              required: true
            },
            {
              key: "arrival",
              name: "Arrive and verify site contact",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "site_setup",
          name: "Site Setup",
          sequence: 2,
          tasks: [
            {
              key: "site_safety",
              name: "Complete site safety assessment",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "exclusion_zone",
              name: "Deploy containment and exclusion zones",
              type: "Checklist",
              assigneeScope: "Any assigned worker",
              required: true
            }
          ]
        },
        {
          key: "perform_work",
          name: "Perform Work",
          sequence: 3,
          tasks: [
            {
              key: "material_use",
              name: "Log material and equipment use",
              type: "Material",
              assigneeScope: "Any assigned worker",
              required: true
            },
            {
              key: "photos",
              name: "Capture before, progress, and after photos",
              type: "Photo",
              assigneeScope: "Any assigned worker",
              required: true
            },
            {
              key: "waste_tracking",
              name: "Track recovered material and waste generated",
              type: "Material",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "document",
          name: "Document Work",
          sequence: 4,
          tasks: [
            {
              key: "impact_findings",
              name: "Document soil or groundwater impact findings",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "closeout",
          name: "Field Closeout",
          sequence: 5,
          tasks: [
            {
              key: "recap",
              name: "Complete job recap",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "signature",
              name: "Capture customer completion signature",
              type: "Signature",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        }
      ],
      updatedBy: "Braden Gilbert"
    },
    {
      id: "jobtype-abatement",
      name: "Asbestos Abatement",
      serviceCategory: "Abatement",
      description: "Containment, abatement work, and waste manifesting for asbestos and similar remediation jobs.",
      isActive: true,
      createdBy: "System",
      stages: [
        {
          key: "mobilize",
          name: "Mobilize",
          sequence: 1,
          tasks: [
            {
              key: "accept_dispatch",
              name: "Acknowledge dispatch",
              type: "Status transition",
              assigneeScope: "All assigned workers",
              required: true
            },
            {
              key: "arrival",
              name: "Arrive and verify site contact",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        },
        {
          key: "containment_setup",
          name: "Containment Setup",
          sequence: 2,
          tasks: [
            {
              key: "site_safety",
              name: "Complete site safety assessment",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "negative_air",
              name: "Set up negative air and containment barriers",
              type: "Checklist",
              assigneeScope: "Any assigned worker",
              required: true
            }
          ]
        },
        {
          key: "perform_work",
          name: "Perform Abatement Work",
          sequence: 3,
          tasks: [
            {
              key: "ppe_material",
              name: "Log PPE and material usage",
              type: "Material",
              assigneeScope: "Any assigned worker",
              required: true
            },
            {
              key: "photos",
              name: "Capture before, progress, and after photos",
              type: "Photo",
              assigneeScope: "Any assigned worker",
              required: true
            }
          ]
        },
        {
          key: "waste_closeout",
          name: "Waste and Closeout",
          sequence: 4,
          tasks: [
            {
              key: "waste_manifest",
              name: "Package and manifest waste containers",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "recap",
              name: "Complete shift recap",
              type: "Form",
              assigneeScope: "Field Lead",
              required: true
            },
            {
              key: "signature",
              name: "Capture customer completion signature",
              type: "Signature",
              assigneeScope: "Field Lead",
              required: true
            }
          ]
        }
      ],
      updatedBy: "Braden Gilbert"
    }
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
      notes: "Named by the owner 2026-09-16. Permit number, agency and dates still to be entered."
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
      notes: "Named by the owner 2026-09-16. Permit number, agency and dates still to be entered."
    }
  ],
  wasteRecords: [],
  notifications: [],
  laborAssignments: [],
  sampleLabReports: [],
  sampleResults: [],
  sampleRecords: [],
  invoices: [],
  businessUnits: [
    {
      id: "bu-bioremedy",
      name: "BioRemedy Sales and Operations",
      parentBusinessUnitId: ""
    }
  ],
  systemUsers: [
    {
      id: "user-braden",
      businessUnitId: "bu-bioremedy",
      fullName: "Braden Gilbert",
      username: "braden",
      internalEmailAddress: "braden@bioremedy.com",
      title: "Owner",
      role: "Admin",
      employeeId: "emp-braden",
      isDisabled: false,
      clientAccountId: "",
      roles: [
        "Admin",
        "Account Manager",
        "Finance Manager"
      ]
    },
    {
      id: "user-mufxiu60-brxind",
      businessUnitId: "bu-bioremedy",
      fullName: "Logan Gallman",
      username: "logan",
      internalEmailAddress: "logan@bioremedy.com",
      title: "Operations Supervisor",
      role: "Operations Manager",
      employeeId: "emp-logan",
      clientAccountId: "",
      isDisabled: false,
      roles: [
        "Operations Manager"
      ]
    },
    {
      id: "user-mufwltzb-370whz",
      businessUnitId: "bu-bioremedy",
      fullName: "Tristan Tarrant",
      username: "tristan",
      internalEmailAddress: "tristan@bioremedy.com",
      title: "Environmental Technician",
      role: "Field Lead",
      employeeId: "emp-tristan",
      clientAccountId: "",
      isDisabled: false,
      roles: [
        "Field Lead",
        "Inventory Manager"
      ]
    },
    {
      id: "user-mufzbbt9-3ihefu",
      businessUnitId: "bu-bioremedy",
      fullName: "Charlotte Stautzenberger",
      username: "charlotte",
      internalEmailAddress: "charlotte@bioremedy.com",
      title: "Office Manager",
      role: "Office Manager",
      roles: [
        "Office Manager"
      ],
      employeeId: "emp-charlotte",
      clientAccountId: "",
      isDisabled: false
    },
    {
      id: "user-mufxcb6y-hs1tta",
      businessUnitId: "bu-bioremedy",
      fullName: "bgilbert",
      username: "bgilbert",
      internalEmailAddress: "bgilbert@micro-bac.com",
      title: "Client portal test login",
      role: "Client Portal",
      employeeId: "",
      clientAccountId: "acct-city-georgetown",
      isDisabled: false
    },
    {
      id: "user-trey",
      businessUnitId: "bu-bioremedy",
      fullName: "Trey Franklin",
      username: "trey",
      internalEmailAddress: "trey@bioremedy.com",
      title: "Director of Sales",
      role: "Sales Manager",
      roles: [
        "Sales Manager"
      ],
      employeeId: "emp-trey",
      clientAccountId: "",
      isDisabled: false
    }
  ],
  teams: [
    {
      id: "team-env-sales",
      businessUnitId: "bu-bioremedy",
      name: "Environmental Sales Team",
      teamType: "Owner"
    }
  ],
  transactionCurrencies: [
    {
      id: "currency-usd",
      currencyName: "US Dollar",
      isoCurrencyCode: "USD",
      currencySymbol: "$",
      exchangeRate: 1,
      precisionValue: 2
    }
  ],
  unitGroups: [
    {
      id: "unit-group-services",
      name: "Environmental services",
      baseUomName: "hour",
      stateCode: "Active",
      statusCode: "Active"
    },
    {
      id: "unit-group-disposal",
      name: "Disposal materials",
      baseUomName: "ton",
      stateCode: "Active",
      statusCode: "Active"
    },
    {
      id: "unit-group-consumables",
      name: "Field consumables",
      baseUomName: "unit",
      stateCode: "Active",
      statusCode: "Active"
    },
    {
      id: "unit-group-rate-sheet",
      name: "Rate sheet units",
      baseUomName: "each",
      stateCode: "Active",
      statusCode: "Active"
    }
  ],
  unitsOfMeasure: [
    {
      id: "uom-hour",
      unitGroupId: "unit-group-services",
      baseUomId: "",
      name: "hour",
      quantity: 1
    },
    {
      id: "uom-day",
      unitGroupId: "unit-group-services",
      baseUomId: "uom-hour",
      name: "day",
      quantity: 8
    },
    {
      id: "uom-ton",
      unitGroupId: "unit-group-disposal",
      baseUomId: "",
      name: "ton",
      quantity: 1
    },
    {
      id: "uom-unit",
      unitGroupId: "unit-group-consumables",
      baseUomId: "",
      name: "unit",
      quantity: 1
    },
    {
      id: "uom-each",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "each",
      quantity: 1
    },
    {
      id: "uom-per-man-per-day",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per man per day",
      quantity: 1
    },
    {
      id: "uom-per-foot-per-day",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per foot per day",
      quantity: 1
    },
    {
      id: "uom-per-foot",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per foot",
      quantity: 1
    },
    {
      id: "uom-per-100-ft-per-day",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per 100 ft per day",
      quantity: 1
    },
    {
      id: "uom-per-test",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per test",
      quantity: 1
    },
    {
      id: "uom-per-suit",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per suit",
      quantity: 1
    },
    {
      id: "uom-per-pair",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per pair",
      quantity: 1
    },
    {
      id: "uom-per-bale",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per bale",
      quantity: 1
    },
    {
      id: "uom-per-bag",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per bag",
      quantity: 1
    },
    {
      id: "uom-per-section",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per section",
      quantity: 1
    },
    {
      id: "uom-per-gallon",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per gallon",
      quantity: 1
    },
    {
      id: "uom-per-pail",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per pail",
      quantity: 1
    },
    {
      id: "uom-per-roll",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per roll",
      quantity: 1
    },
    {
      id: "uom-per-load",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per load",
      quantity: 1
    },
    {
      id: "uom-per-sample",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per sample",
      quantity: 1
    },
    {
      id: "uom-per-sq-ft",
      unitGroupId: "unit-group-rate-sheet",
      baseUomId: "",
      name: "per sq ft",
      quantity: 1
    }
  ],
  priceLevels: [
    {
      id: "price-standard-2026",
      transactionCurrencyId: "currency-usd",
      name: "2026 Rate Sheet",
      beginDate: "2026-01-01",
      endDate: "2026-12-31",
      stateCode: "Active",
      statusCode: "Active",
      isDefault: true,
      sourceFile: "2026 RATES.xlsx",
      sourceSheet: "Rate Sheet"
    },
    {
      id: "price-sheet5-2026",
      name: "2026 Rate Sheet (Sheet5)",
      transactionCurrencyId: "currency-usd",
      beginDate: "2026-01-01",
      endDate: "2026-12-31",
      stateCode: "Active",
      statusCode: "Active",
      isDefault: false,
      sourceFile: "2026 RATES.xlsx",
      sourceSheet: "Sheet5"
    }
  ],
  products: [],
  pricingSettings: [
    {
      id: "pricing-settings-default",
      fuelSurchargePercent: 10,
      fuelSurchargeNote: "",
      fuelSurchargeUpdatedAt: "2026-09-23T18:36:44.246Z",
      energySecurityFeePercent: 18
    }
  ],
  productPriceLevels: [],
  opportunities: [],
  opportunityAssignments: [],
  leads: [],
  opportunityContacts: [],
  opportunityLocations: [],
  opportunityProducts: [],
  quotes: [],
  quoteLines: [],
  estimates: [],
  estimateLines: [],
  salesOrders: [],
  salesOrderLines: [],
  invoiceLines: [],
  competitors: [],
  opportunityCompetitors: [],
  annotations: [],
  connectionRoles: [
    {
      id: "connection-role-budget-owner",
      name: "Budget owner",
      category: "Sales relationship",
      description: "Person who owns or heavily influences approval of project spend."
    },
    {
      id: "connection-role-technical-evaluator",
      name: "Technical evaluator",
      category: "Sales relationship",
      description: "Person who validates site assumptions, drawings, access, and scope detail."
    }
  ],
  connections: [],
  activityParties: [],
  accountTypes: [
    {
      id: "account-type-commercial",
      name: "Commercial",
      description: "",
      displayOrder: 1
    },
    {
      id: "account-type-municipal-government",
      name: "Municipal / Government",
      description: "",
      displayOrder: 2
    },
    {
      id: "account-type-industrial",
      name: "Industrial",
      description: "",
      displayOrder: 3
    },
    {
      id: "account-type-residential",
      name: "Residential",
      description: "",
      displayOrder: 4
    },
    {
      id: "account-type-strategic-partner",
      name: "Strategic Partner",
      description: "",
      displayOrder: 5
    }
  ],
  industries: [
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-oil-gas",
      industryName: "Oil & Gas",
      industryCode: "OILGAS",
      displayOrder: 1,
      naicsCode: "211"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-agriculture",
      industryName: "Agriculture",
      industryCode: "AG",
      displayOrder: 2,
      naicsCode: "11"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-wastewater",
      industryName: "Wastewater",
      industryCode: "WASTEWATER",
      displayOrder: 3,
      naicsCode: "221320"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-manufacturing",
      industryName: "Manufacturing",
      industryCode: "MFG",
      displayOrder: 4,
      naicsCode: "31-33"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-municipal-government",
      industryName: "Municipal / Government / DOT",
      industryCode: "GOVT",
      displayOrder: 5,
      naicsCode: "92"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-healthcare",
      industryName: "Healthcare",
      industryCode: "HEALTH",
      displayOrder: 6,
      naicsCode: "62"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-construction",
      industryName: "Construction",
      industryCode: "CONSTRUCTION",
      displayOrder: 7,
      naicsCode: "23"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-transportation-logistics",
      industryName: "Transportation / Logistics",
      industryCode: "TRANSPORT",
      displayOrder: 8,
      naicsCode: "48-49"
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-environmental",
      industryName: "Environmental",
      industryCode: "ENV",
      naicsCode: "562",
      displayOrder: 9
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-utilities-infrastructure",
      industryName: "Utilities / Infrastructure",
      industryCode: "UTIL",
      naicsCode: "22",
      displayOrder: 10
    },
    {
      parentIndustryId: "",
      industryCategory: "",
      description: "",
      id: "industry-education",
      industryName: "Education",
      industryCode: "EDU",
      naicsCode: "61",
      displayOrder: 11
    }
  ],
  accountIndustries: [],
  addresses: [],
  facilityContacts: [],
  facilities: [],
  salesTasks: [],
  accountRelationshipExtensions: [],
  accountComments: [],
  facilityComments: [],
  accountDivisions: [],
  contactEmploymentHistory: [],
  subcontractorTypes: [
    {
      id: "subcontractor-type-subcontractor",
      name: "Subcontractor",
      description: "",
      displayOrder: 1
    },
    {
      id: "subcontractor-type-supplier",
      name: "Supplier",
      description: "",
      displayOrder: 2
    },
    {
      id: "subcontractor-type-carrier",
      name: "Carrier",
      description: "",
      displayOrder: 3
    },
    {
      id: "subcontractor-type-consultant",
      name: "Consultant",
      description: "",
      displayOrder: 4
    }
  ],
  vendorProfiles: [],
  serviceAgreements: [],
  subcontractorAssignments: [],
  accountApprovedSubcontractors: [],
  qboSettings: {
    connectionStatus: "Not connected",
    realmId: "",
    lastExportAt: ""
  },
  qboExports: [],
  // Phase 21 (Front Line 2)
  jobSafetyBriefings: [],
  jobEquipmentUsage: [],
  formTemplates: [],
  siteWalkReports: [],
  siteWalkObservations: [],
  siteReferenceLayers: [],
  jurisdictions: [],
  libraryItems: [],
  libraryAcknowledgements: [],
  ergMaterials: [],
  ergGuides: [],
  ergDistances: [],
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
  // A deleted message to IT takes its screenshot with it (documents.entityId = the message id).
  itMessages: [["documents", "entityId"]],
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
    ["jobSafetyBriefings", "jobId"],
    ["jobEquipmentUsage", "jobId"],
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
  if (ensureItMessageAssignments(data)) dirty = true;
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
    // Phase 21 (Front Line 2). Field sessions are narrowed by fieldProjections (W1).
    jobSafetyBriefings: canAccess(role, "dispatch") ? data.jobSafetyBriefings : [],
    jobEquipmentUsage: canAccess(role, "dispatch") || canAccess(role, "finance") ? data.jobEquipmentUsage : [],
    formTemplates: canAccess(role, "dispatch") ? data.formTemplates : [],
    siteWalkReports: canAccess(role, "sales") || canAccess(role, "operations") ? data.siteWalkReports : [],
    siteWalkObservations: canAccess(role, "sales") || canAccess(role, "operations") ? data.siteWalkObservations : [],
    siteReferenceLayers: canAccess(role, "customerDirectory") ? data.siteReferenceLayers : [],
    jurisdictions: canAccess(role, "customerDirectory") ? data.jurisdictions : [],
    libraryItems: canAccess(role, "customerDirectory") ? data.libraryItems : [],
    libraryAcknowledgements: canAccess(role, "customerDirectory") ? data.libraryAcknowledgements : [],
    ergMaterials: canAccess(role, "customerDirectory") ? data.ergMaterials : [],
    ergGuides: canAccess(role, "customerDirectory") ? data.ergGuides : [],
    ergDistances: canAccess(role, "customerDirectory") ? data.ergDistances : [],
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
  // Phase 21 (Front Line 2)
  ["libraryItem", "libraryItems"],
  ["siteWalk", "siteWalkReports"],
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
  // Phase 21 (Front Line 2, 2026-09-25): media captured in the field and the reference shelves.
  { id: "doctype-job-photo", code: "job-photo", name: "Job photo", kind: "upload", counterparty: "internal", appliesTo: ["dispatchJob", "project"], stageGate: "", requiresReview: false, expiryDays: null, isImage: true, description: "A photo taken on a job from the field app (caption, GPS, heading, report toggle)." },
  { id: "doctype-site-video", code: "site-video", name: "Site video", kind: "upload", counterparty: "internal", appliesTo: ["opportunity", "project", "dispatchJob", "siteWalk"], stageGate: "", requiresReview: false, expiryDays: null, description: "A walk-through or scene video from the field; uploaded in chunks, printed as a poster frame plus link." },
  { id: "doctype-site-scan", code: "site-scan", name: "3D site scan", kind: "upload", counterparty: "internal", appliesTo: ["opportunity", "project", "dispatchJob", "siteWalk"], stageGate: "", requiresReview: false, expiryDays: null, description: "A LiDAR or photogrammetry scan shared from a scanning app (GLB, USDZ, PLY, OBJ, E57) with its measurements." },
  { id: "doctype-site-sketch", code: "site-sketch", name: "Site sketch", kind: "upload", counterparty: "internal", appliesTo: ["opportunity", "project", "dispatchJob", "siteWalk"], stageGate: "", requiresReview: false, expiryDays: null, isImage: true, description: "Markup over a satellite snapshot or a blank grid: spill extent, drains, staging, sample points." },
  { id: "doctype-site-map", code: "site-map", name: "Site map export", kind: "upload", counterparty: "internal", appliesTo: ["opportunity", "project", "dispatchJob", "siteWalk"], stageGate: "", requiresReview: false, expiryDays: null, description: "The annotated site map exported from a walk or job as a PDF." },
  { id: "doctype-site-plan", code: "site-plan", name: "Site plan / floor plan", kind: "upload", counterparty: "internal", appliesTo: ["facility", "opportunity", "project", "siteWalk"], stageGate: "", requiresReview: false, expiryDays: null, isImage: true, description: "An uploaded floor plan, site drawing or photographed layout used as an indoor map background." },
  { id: "doctype-sds", code: "sds", name: "Safety data sheet (SDS)", kind: "upload", counterparty: "internal", appliesTo: ["libraryItem", "dispatchJob", "project"], stageGate: "", requiresReview: false, expiryDays: null, description: "A material's SDS, on the Safety shelf or attached to a job." },
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

// Every message to IT is assigned to one person (owner, 2026-09-25: "all messages to IT assigned to
// Braden Gilbert"), carries a work status, and stays until that person deletes it. CRM_IT_ASSIGNEE_USER_ID
// overrides the assignee without a code change.
const IT_ASSIGNEE_USER_ID = process.env.CRM_IT_ASSIGNEE_USER_ID || "user-braden";
const IT_MESSAGE_STATUSES = ["Open", "In progress", "Done"];

function itAssignee(data) {
  const user = (data.systemUsers || []).find((item) => item.id === IT_ASSIGNEE_USER_ID && !item.deletedAt);
  return { id: user?.id || IT_ASSIGNEE_USER_ID, name: user?.fullName || "Braden Gilbert" };
}

// Older rows (and anything restored from a backup) get the assignee and an Open status on load.
function ensureItMessageAssignments(data) {
  const assignee = itAssignee(data);
  let changed = false;
  for (const row of data.itMessages || []) {
    if (row.fromIT) continue;
    if (!row.assignedToUserId) {
      row.assignedToUserId = assignee.id;
      row.assignedToName = assignee.name;
      changed = true;
    }
    if (!IT_MESSAGE_STATUSES.includes(row.status)) {
      row.status = "Open";
      changed = true;
    }
  }
  return changed;
}

function visibleItMessages(data, session, roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (!session || isPortalRole(list)) return [];
  // IT also receives deleted rows, so Identity & Sync › Recently deleted can put one back.
  if (list.includes("Admin")) return data.itMessages || [];
  const key = itThreadKeyForSession(session);
  return (data.itMessages || []).filter((row) => !row.deletedAt && row.threadKey === key);
}

function normalizeItMessageWrite(data, request, body, stored) {
  const session = request.session;
  const roles = getRoles(request);
  if (!session || isPortalRole(roles)) return { error: "Customers cannot message IT here.", status: 403 };
  const isAdmin = roles.includes("Admin");
  const ownKey = itThreadKeyForSession(session);
  if (stored) {
    // After the fact only the read markers, the screenshot link and (for IT) the work status and
    // assignee change; text and author stay.
    if (!isAdmin && stored.threadKey !== ownKey) return { error: "Not your conversation.", status: 403 };
    const record = { ...stored, userReadAt: stored.userReadAt || String(body.userReadAt || ""), itReadAt: stored.itReadAt || String(body.itReadAt || "") };
    if (isAdmin && !stored.fromIT) {
      if (body.status && body.status !== stored.status) {
        if (!IT_MESSAGE_STATUSES.includes(body.status)) return { error: `Status must be one of: ${IT_MESSAGE_STATUSES.join(", ")}.`, status: 400 };
        record.status = body.status;
        record.statusChangedAt = new Date().toISOString();
        record.statusChangedBy = session.name;
      }
      if (body.assignedToUserId && body.assignedToUserId !== stored.assignedToUserId) {
        const user = (data.systemUsers || []).find((item) => item.id === body.assignedToUserId && !item.deletedAt);
        if (!user) return { error: "That user does not exist.", status: 400 };
        record.assignedToUserId = user.id;
        record.assignedToName = user.fullName;
      }
    }
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
  const assignee = itAssignee(data);
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
      // A report to IT is work for the assignee; IT's own replies are not.
      ...(fromIT ? {} : { assignedToUserId: assignee.id, assignedToName: assignee.name, status: "Open", statusChangedAt: now, statusChangedBy: "" }),
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
    // Phase 21: field/ holds the field app's ES modules and stylesheet (plain web assets, no data).
    const allowed = insideRoot && (staticAllowlist.has(relativePath) || relativePath.startsWith("public/") || relativePath.startsWith("field/"));
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

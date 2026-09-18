import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const basePort = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "backend.json");
const uploadsDir = path.join(dataDir, "uploads");
const maxJobRequestDocumentBytes = 25 * 1024 * 1024;

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
  equipmentAssets: "inventory",
  equipmentMaintenanceRecords: "inventory",
  equipmentRestockItems: "inventory",
  laborAssignments: "operations",
  sampleRecords: "operations",
  sampleLabReports: "operations",
  employees: "workforce",
  employeeCertifications: "workforce",
  certificationTypes: "workforce",
  workforceTeams: "workforce",
  workforceTeamMemberships: "workforce",
  crewProfiles: "workforce",
  availabilityBlocks: "workforce",
  frontlineDevices: "workforce",
  timeEntries: "operations",
  jobMileageEntries: "operations",
  messages: "dispatch",
  inventoryAlerts: "dispatch",
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
  opportunities: "sales",
  leads: "sales",
  opportunityContacts: "sales",
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
  equipmentAssets: [
    {
      id: "asset-vac-204",
      assetTag: "VAC-204",
      equipment: "Vacuum trailer",
      category: "Vacuum / Vactron",
      status: "In service",
      maintenanceDue: "2026-07-18",
      lastUsed: "2026-07-03",
      assignedJobId: "job-north-river-i130",
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
      assignedJobId: "job-riverbend-ust",
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
      assignedJobId: "job-north-river-i130",
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
      assignedJobId: "job-clearwater-abatement",
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
  laborAssignments: [],
  sampleLabReports: [],
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
      closeQuarter: "2026-Q3",
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
      closeQuarter: "2026-Q3",
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
      closeQuarter: "2026-Q3",
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
      closeQuarter: "2026-Q3",
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
  industries: [
    { id: "industry-oil-gas", industryName: "Oil & Gas", industryCode: "OILGAS", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 1 },
    { id: "industry-agriculture", industryName: "Agriculture", industryCode: "AG", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 2 },
    { id: "industry-wastewater", industryName: "Wastewater", industryCode: "WASTEWATER", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 3 },
    { id: "industry-manufacturing", industryName: "Manufacturing", industryCode: "MFG", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 4 },
    { id: "industry-municipal-government", industryName: "Municipal / Government", industryCode: "GOVT", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 5 },
    { id: "industry-healthcare", industryName: "Healthcare", industryCode: "HEALTH", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 6 },
    { id: "industry-construction", industryName: "Construction", industryCode: "CONSTRUCTION", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 7 },
    { id: "industry-transportation-logistics", industryName: "Transportation / Logistics", industryCode: "TRANSPORT", parentIndustryId: "", industryCategory: "", description: "", displayOrder: 8 },
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

function canAccess(role, domain) {
  return roleAccess[domain]?.includes(role) || role === "Admin";
}

function getRole(request) {
  return request.headers["x-crm-role"]?.toString() || "Local";
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
    await saveBackend(defaultBackend);
    return structuredClone(defaultBackend);
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
  data.jobRequests = data.jobRequests.map((request) => ({
    ...request,
    accountId: request.accountId || accountIdsByCustomer.get(request.customerName?.trim().toLowerCase()) || "",
  }));
  const requestAccounts = new Map(data.jobRequests.map((request) => [request.id, request.accountId]));
  data.dispatchJobs = data.dispatchJobs.map((job) => ({
    ...job,
    accountId: job.accountId || requestAccounts.get(job.jobRequestId) || accountIdsByCustomer.get(job.customerName?.trim().toLowerCase()) || "",
  }));
  return data;
}

async function saveBackend(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function filterBackendForRole(data, role) {
  return {
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
    inventoryItems: canAccess(role, "inventory") || canAccess(role, "dispatch") ? data.inventoryItems : [],
    purchaseOrders: canAccess(role, "inventory") ? data.purchaseOrders : [],
    equipmentAssets: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentAssets : [],
    equipmentMaintenanceRecords: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentMaintenanceRecords : [],
    equipmentRestockItems: canAccess(role, "inventory") || canAccess(role, "operations") ? data.equipmentRestockItems : [],
    laborAssignments: canAccess(role, "operations") ? data.laborAssignments : [],
    sampleRecords: canAccess(role, "operations") || canAccess(role, "sales") ? data.sampleRecords : [],
    sampleLabReports: canAccess(role, "operations") || canAccess(role, "sales") ? data.sampleLabReports : [],
    employees: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.employees : [],
    employeeCertifications: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.employeeCertifications : [],
    certificationTypes: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.certificationTypes : [],
    workforceTeams: canAccess(role, "workforce") ? data.workforceTeams : [],
    workforceTeamMemberships: canAccess(role, "workforce") ? data.workforceTeamMemberships : [],
    crewProfiles: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.crewProfiles : [],
    availabilityBlocks: canAccess(role, "workforce") || canAccess(role, "dispatch") ? data.availabilityBlocks : [],
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
    opportunities: canAccess(role, "sales") ? data.opportunities : [],
    leads: canAccess(role, "sales") ? data.leads : [],
    opportunityContacts: canAccess(role, "sales") ? data.opportunityContacts : [],
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
    };
  }

  if (collection === "equipmentAssets") {
    return {
      id,
      assetTag: payload.assetTag || "",
      equipment: payload.equipment || "",
      category: payload.category || "General equipment",
      status: payload.status || "Ready",
      maintenanceDue: payload.maintenanceDue || now.slice(0, 10),
      lastUsed: payload.lastUsed || "",
      assignedJobId: payload.assignedJobId || "",
      issue: payload.issue || "",
      specs: payload.specs && typeof payload.specs === "object" ? payload.specs : {},
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
    return {
      id,
      projectId: payload.projectId || "",
      customer: payload.customer || "",
      quotedAmount: Number(payload.quotedAmount || 0),
      fieldExpenses: Number(payload.fieldExpenses || 0),
      invoiceAmount: Number(payload.invoiceAmount || payload.quotedAmount || 0),
      status: payload.status || "Draft",
      dueDate: payload.dueDate || "",
      notes: payload.notes || "",
      qboStatus: payload.qboStatus || "Not exported",
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
  if (index >= 0) data.locations[index] = { ...data.locations[index], ...ping };
  else data.locations.push(ping);
  await saveBackend(data);

  return json(response, 200, { ok: true, location: ping });
}

async function handleReceivePurchaseOrder(request, response, orderId) {
  const role = getRole(request);
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
  await saveBackend(data);

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
  const role = getRole(request);
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
    uploadedBy: request.headers["x-crm-user"]?.toString() || role,
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
  jobRequest.updatedAt = document.uploadedAt;

  await saveBackend(data);
  return json(response, 201, document);
}

async function handleJobRequestDocumentDownload(request, response, documentId) {
  const role = getRole(request);
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
  const role = getRole(request);
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
    uploadedBy: request.headers["x-crm-user"]?.toString() || role,
  };
  report.storageName = `${report.id}${extension}`;

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, report.storageName), body);
  data.sampleLabReports.push(report);
  await saveBackend(data);

  return json(response, 201, report);
}

async function handleSampleLabReportDownload(request, response, reportId) {
  const role = getRole(request);
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

async function handleJobTaskAttachmentUpload(request, response, actionId) {
  const role = getRole(request);
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
    uploadedBy: request.headers["x-crm-user"]?.toString() || role,
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
  const role = getRole(request);
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
  const consumedBy = request.headers["x-crm-user"]?.toString() || role;
  const created = planned.map(({ inventoryItem, quantity }) => {
    inventoryItem.onHand = Number(inventoryItem.onHand || 0) - quantity;
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
  return json(response, 201, { resources: [...created, ...createdWriteIns], alertsRaised: alerts.length });
}

async function handleApi(request, response, pathname) {
  const role = getRole(request);

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
    return json(response, 200, filterBackendForRole(data, role));
  }

  if (pathname === "/api/qbo/export" && request.method === "POST") {
    if (!canAccess(role, "finance")) return json(response, 403, { error: "Finance role required." });
    const data = await loadBackend();
    const body = await readJsonBody(request);
    const invoice = data.invoices.find((item) => item.id === body.invoiceId);
    if (!invoice) return json(response, 404, { error: "Invoice not found." });

    invoice.qboStatus = "Export queued";
    data.qboSettings.lastExportAt = new Date().toISOString();
    data.qboExports.push({
      id: makeId("qbo-export"),
      invoiceId: invoice.id,
      status: "Queued - QuickBooks credentials not connected",
      createdAt: data.qboSettings.lastExportAt,
    });
    await saveBackend(data);
    return json(response, 200, { invoice, qboSettings: data.qboSettings });
  }

  const collectionMatch = pathname.match(/^\/api\/backend\/([a-zA-Z]+)$/);
  if (!collectionMatch) return json(response, 404, { error: "API route not found." });

  const collection = collectionMatch[1];
  const domain = collectionAccess[collection];
  if (!domain || !Array.isArray(defaultBackend[collection])) return json(response, 404, { error: "Unknown collection." });
  if (!canAccess(role, domain)) return json(response, 403, { error: `${domain} role required.` });

  const data = await loadBackend();

  if (request.method === "GET") {
    return json(response, 200, data[collection]);
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    const record = normalizeRecord(collection, body, data);
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
    if (index >= 0) data[collection][index] = record;
    else data[collection].push(record);
    await saveBackend(data);
    return json(response, 200, record);
  }

  return json(response, 405, { error: "Method not allowed." });
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(request, response, pathname);
      return;
    }

    if (pathname === "/") pathname = "/index.html";

    const filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const resolvedPath = existsSync(filePath) ? filePath : path.join(root, "index.html");
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
  });
}

listen(basePort);

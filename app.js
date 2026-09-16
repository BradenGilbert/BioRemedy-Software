const DB_NAME = "environmental-crm-foundation";
const DB_VERSION = 3;
const AUTH_SESSION_KEY = "enviroCrm.pkce";
const ACCESS_TOKEN_KEY = "enviroCrm.accessToken";
const STAGES = ["Lead", "Qualify", "Develop", "Proposal", "Negotiation", "Won"];
const STAGE_PROBABILITY = {
  Lead: 15,
  Qualify: 30,
  Develop: 45,
  Proposal: 60,
  Negotiation: 80,
  Won: 100,
};
const STAGE_DESCRIPTIONS = {
  Lead: "Qualify fit, urgency, site risk, and decision path.",
  Qualify: "Confirm timeframe, budget, purchase process, and decision maker.",
  Develop: "Scope the solution, site walk, stakeholders, competitors, and needed resources.",
  Proposal: "Build pricing, alternates, schedule, and compliance language.",
  Negotiation: "Resolve buyer questions, approvals, and final terms.",
  Won: "Handoff to project setup, scheduling, and document control.",
};

// Fields required to be filled in before an opportunity can enter a given stage.
// Keyed by the stage being entered; only scalar status/dropdown/text fields are gated
// here (list-type items like stakeholders/competitors/assignments are not required to
// be non-empty to advance, per product decision). Populated incrementally as each
// stage's edit dialogs land.
const STAGE_REQUIRED_FIELDS = {
  Lead: [],
  Qualify: [
    { key: "opportunityName", label: "Opportunity name" },
    { key: "accountId", label: "Account" },
    { key: "locationId", label: "Facility" },
    { key: "contaminationNotes", label: "Contamination" },
    { key: "serviceType", label: "Cleanup type" },
    { key: "industry", label: "Industry" },
    { key: "description", label: "Description" },
    { key: "currentSituation", label: "Current situation" },
  ],
  Develop: [
    { key: "contactLinked", label: "Account contact", validate: (opportunity) => contactsForOpportunity(opportunity.id).length > 0 },
    { key: "purchaseTimeframe", label: "Purchase time frame" },
    { key: "budgetAmount", label: "Estimated budget", validate: (opportunity) => Number(opportunity.budgetAmount || 0) > 0 },
    { key: "purchaseProcess", label: "Purchase process" },
    { key: "decisionMakerFound", label: "Decision maker found", validate: (opportunity) => opportunity.decisionMakerFound === "Complete" },
    { key: "captureSummary", label: "Capture summary" },
  ],
  Proposal: [
    { key: "customerNeed", label: "Customer need" },
    { key: "proposedSolution", label: "Proposed solution" },
    { key: "siteWalkStatus", label: "Site walk status" },
  ],
  Negotiation: [
    { key: "proposalDevelopedStatus", label: "Develop proposal", validate: (opportunity) => opportunity.proposalDevelopedStatus === "Complete" },
    { key: "internalReviewStatus", label: "Complete internal review", validate: (opportunity) => opportunity.internalReviewStatus === "Complete" },
    { key: "proposalPresentedStatus", label: "Present proposal", validate: (opportunity) => opportunity.proposalPresentedStatus === "Complete" },
    { key: "quoteId", label: "Quote", validate: (opportunity) => Boolean(opportunity.quoteId) },
  ],
  Won: [
    { key: "accountPaperworkStatus", label: "New account paperwork signed", validate: (opportunity) => opportunity.accountPaperworkStatus === "Signed" },
    { key: "quoteSignedStatus", label: "Quote signed", validate: (opportunity) => opportunity.quoteSignedStatus === "Signed" },
    { key: "workAuthorizationStatus", label: "Work authorization signed", validate: (opportunity) => opportunity.workAuthorizationStatus === "Signed" },
  ],
};

function getMissingStageFields(opportunity, stage) {
  const core = getCoreOpportunity(opportunity);
  return (STAGE_REQUIRED_FIELDS[stage] || []).filter((requirement) =>
    requirement.validate ? !requirement.validate(opportunity) : !String(core[requirement.key] ?? "").trim(),
  );
}

function getMissingFieldsThroughStage(opportunity, targetStage) {
  const targetIndex = STAGES.indexOf(targetStage);
  if (targetIndex < 0) return [];
  return STAGES.slice(0, targetIndex + 1).flatMap((stage) => getMissingStageFields(opportunity, stage));
}

// A Project's operational lifecycle, distinct from the sales-side opportunity STAGES above.
// Plan/Mobilize/Field Work/Closeout have no dedicated UI yet — only Intake is built out this pass.
const PROJECT_STAGES = ["Intake", "Plan", "Mobilize", "Field Work", "Closeout"];

// Fields required before a project can be considered to have left Intake. Keyed by the
// stage being entered, same convention as STAGE_REQUIRED_FIELDS. `sitePhotoRefs` is
// deliberately not required (list-type, matches the opportunity-side gate-scope decision).
const PROJECT_STAGE_REQUIRED_FIELDS = {
  Plan: [
    { key: "generatorName", label: "Generator" },
    { key: "locationId", label: "Site" },
    { key: "insuranceCarrier", label: "Insurance" },
    { key: "epaId", label: "EPA ID" },
    { key: "tceqId", label: "TCEQ ID" },
    { key: "serviceProfile", label: "Services" },
    { key: "siteWalkStatus", label: "Site walk" },
    { key: "jobClass", label: "Project type" },
  ],
};

function getMissingProjectStageFields(job, stage) {
  return (PROJECT_STAGE_REQUIRED_FIELDS[stage] || []).filter((requirement) =>
    requirement.validate ? !requirement.validate(job) : !String(job[requirement.key] ?? "").trim(),
  );
}

const defaultIdentityConfig = {
  tenantId: "",
  clientId: "",
  scopes: "openid profile email User.Read",
};

const defaultPlatformSettings = {
  theme: "light",
  density: "comfortable",
  gpsMode: "supervisor-review",
  gpsRefresh: "60",
  gpsAccuracy: "standard",
  geofenceAlerts: true,
  roleProfile: "office",
  schedulerBlockMode: "hard-block",
  qboMode: "export-queue",
  inventoryAlertMode: "operations-buyers",
};

const demoUser = {
  name: "Olivia Grant",
  email: "olivia.grant@example.com",
  role: "Office Manager",
  source: "Demo session",
  signedInAt: new Date().toISOString(),
};

const demoUsers = {
  office: demoUser,
  sales: {
    name: "Maya Chen",
    email: "maya.chen@example.com",
    role: "Sales Manager",
    source: "Demo session",
    signedInAt: new Date().toISOString(),
  },
  operations: {
    name: "Priya Patel",
    email: "priya.patel@example.com",
    role: "Operations Manager",
    source: "Demo session",
    signedInAt: new Date().toISOString(),
  },
  inventory: {
    name: "Renee Carter",
    email: "renee.carter@example.com",
    role: "Inventory Manager",
    source: "Demo session",
    signedInAt: new Date().toISOString(),
  },
  finance: {
    name: "Gina Walsh",
    email: "gina.walsh@example.com",
    role: "Finance Manager",
    source: "Demo session",
    signedInAt: new Date().toISOString(),
  },
  admin: {
    name: "Admin User",
    email: "admin@example.com",
    role: "Admin",
    source: "Demo session",
    signedInAt: new Date().toISOString(),
  },
  client: {
    name: "Jordan Lee",
    email: "jordan.lee@northriver.example.com",
    role: "Client",
    source: "Client portal demo",
    clientAccountId: "acct-north-river",
    signedInAt: new Date().toISOString(),
  },
};

const workspaces = [
  {
    id: "sales",
    label: "Sales View",
    defaultView: "pipeline",
    roles: ["Admin", "Office Manager", "Sales Manager", "Account Manager"],
  },
  {
    id: "operations",
    label: "Operations View",
    defaultView: "ops-projects",
    roles: ["Admin", "Office Manager", "Operations Manager", "Scheduler", "Field Lead"],
  },
  {
    id: "dispatch",
    label: "Jobs & Dispatch",
    defaultView: "dispatch-intake",
    roles: ["Admin", "Office Manager", "Operations Manager", "Scheduler", "Field Lead"],
  },
  {
    id: "workforce",
    label: "Workforce",
    defaultView: "workforce-directory",
    roles: ["Admin", "Office Manager", "Operations Manager", "Scheduler"],
  },
  {
    id: "inventory",
    label: "Inventory View",
    defaultView: "inventory",
    roles: ["Admin", "Office Manager", "Operations Manager", "Inventory Manager"],
  },
  {
    id: "office",
    label: "Office Manager",
    defaultView: "office",
    roles: ["Admin", "Office Manager"],
  },
  {
    id: "finance",
    label: "Finance",
    defaultView: "finance",
    roles: ["Admin", "Office Manager", "Finance Manager"],
  },
  {
    id: "client",
    label: "Client Portal",
    defaultView: "client-dashboard",
    roles: ["Admin", "Client"],
  },
  {
    id: "sync",
    label: "Identity & Sync",
    defaultView: "sync",
    roles: ["Admin", "Office Manager", "Sales Manager", "Account Manager", "Operations Manager", "Scheduler", "Field Lead", "Inventory Manager", "Finance Manager", "Client"],
  },
  {
    id: "frontline",
    label: "Front Line",
    defaultView: "frontline-login",
    roles: ["Admin", "Office Manager", "Sales Manager", "Account Manager", "Operations Manager", "Scheduler", "Field Lead", "Inventory Manager", "Finance Manager"],
  },
];

const workspaceModules = {
  sales: [
    { view: "pipeline", label: "Opportunities" },
    { view: "accounts", label: "Accounts" },
    { view: "contacts", label: "Contacts" },
    { view: "sales-race", label: "Delivery Tracker" },
  ],
  operations: [
    { view: "ops-projects", label: "All Projects" },
    { view: "ops-scheduled", label: "Scheduled Work" },
    { view: "ops-emergency", label: "Emergency Response" },
    { view: "ops-remediation", label: "Multi-Stage" },
    { view: "ops-calendar", label: "Calendar" },
    { view: "ops-map", label: "Map" },
    { view: "ops-race", label: "Race Track" },
  ],
  dispatch: [
    { view: "dispatch-intake", label: "Intake" },
    { view: "dispatch-jobs", label: "Jobs" },
    { view: "dispatch-board", label: "Dispatch Board" },
    { view: "dispatch-calendar", label: "Schedule" },
    { view: "dispatch-conflicts", label: "Conflicts" },
    { view: "dispatch-templates", label: "Job Templates" },
  ],
  workforce: [
    { view: "workforce-directory", label: "Directory" },
    { view: "workforce-credentials", label: "Credentials" },
    { view: "workforce-teams", label: "Teams & Crews" },
    { view: "workforce-availability", label: "Availability" },
    { view: "workforce-schedule", label: "Schedule" },
    { view: "workforce-devices", label: "Front Line Devices" },
  ],
  inventory: [
    { view: "inventory", label: "Overview" },
    { view: "inventory-consumables", label: "Consumables" },
    { view: "inventory-purchase", label: "Purchase Orders" },
    { view: "inventory-equipment", label: "Equipment" },
    { view: "inventory-labor", label: "Labor" },
  ],
  office: [
    { view: "office", label: "Overview" },
    { view: "office-alerts", label: "Alerts" },
    { view: "office-schedule", label: "Schedule" },
  ],
  finance: [
    { view: "finance", label: "Overview" },
    { view: "finance-invoices", label: "Invoices" },
    { view: "finance-qbo", label: "QuickBooks" },
  ],
  client: [
    { view: "client-dashboard", label: "Dashboard" },
    { view: "client-spills", label: "Spills" },
    { view: "client-documents", label: "Samples & Docs" },
    { view: "client-contacts", label: "Contacts" },
  ],
  sync: [{ view: "sync", label: "Identity & Sync" }],
  frontline: [{ view: "frontline-login", label: "Front Line" }],
};

const viewWorkspace = {
  home: "home",
  pipeline: "sales",
  accounts: "sales",
  contacts: "sales",
  "sales-race": "sales",
  "opportunity-detail": "sales",
  "account-detail": "sales",
  "contact-detail": "sales",
  operations: "operations",
  fieldwork: "operations",
  "ops-projects": "operations",
  "ops-scheduled": "operations",
  "ops-emergency": "operations",
  "ops-remediation": "operations",
  "ops-calendar": "operations",
  "ops-map": "operations",
  "ops-race": "operations",
  "project-detail": "operations",
  "sample-detail": "operations",
  "dispatch-intake": "dispatch",
  "dispatch-jobs": "dispatch",
  "dispatch-board": "dispatch",
  "dispatch-calendar": "dispatch",
  "dispatch-conflicts": "dispatch",
  "dispatch-job-detail": "dispatch",
  "dispatch-templates": "dispatch",
  "dispatch-template-editor": "dispatch",
  "workforce-directory": "workforce",
  "workforce-credentials": "workforce",
  "workforce-teams": "workforce",
  "workforce-availability": "workforce",
  "workforce-schedule": "workforce",
  "workforce-devices": "workforce",
  "employee-detail": "workforce",
  inventory: "inventory",
  "inventory-consumables": "inventory",
  "inventory-consumable-detail": "inventory",
  "inventory-purchase": "inventory",
  "inventory-equipment": "inventory",
  "inventory-equipment-detail": "inventory",
  "inventory-labor": "inventory",
  office: "office",
  "office-alerts": "office",
  "office-schedule": "office",
  finance: "finance",
  "finance-invoices": "finance",
  "finance-qbo": "finance",
  "client-dashboard": "client",
  "client-spills": "client",
  "client-documents": "client",
  "client-contacts": "client",
  "client-spill-detail": "client",
  sync: "sync",
  "frontline-login": "frontline",
  "frontline-home": "frontline",
  "frontline-jobbook": "frontline",
  "frontline-job-detail": "frontline",
  "frontline-timesheet": "frontline",
  "frontline-messaging": "frontline",
  "frontline-forms": "frontline",
  "frontline-trips": "frontline",
  "frontline-location": "frontline",
  "frontline-invoices": "frontline",
  "frontline-settings": "frontline",
};

const accountCoreFieldSections = [
  {
    id: "identity",
    label: "Account Identity",
    defaultOpen: true,
    fields: [
      { key: "accountName", label: "Account Name" },
      { key: "accountId", label: "Account ID" },
      { key: "accountUniqueIdentifier", label: "Unique Identifier for Account" },
      { key: "accountNumber", label: "Account Number" },
      { key: "accountRating", label: "Account Rating" },
      { key: "accountType", label: "Type" },
      { key: "businessType", label: "Business Type" },
      { key: "category", label: "Category" },
      { key: "classification", label: "Classification" },
      { key: "customerSize", label: "Customer Size" },
      { key: "industry", label: "Industry" },
      { key: "numberOfEmployees", label: "Number of Employees" },
      { key: "description", label: "Description" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    defaultOpen: true,
    fields: [
      { key: "website", label: "Website" },
      { key: "email", label: "Email" },
      { key: "emailAddressTwo", label: "Email Address Two" },
      { key: "emailAddressThree", label: "Email Address Three" },
      { key: "mainPhoneNumber", label: "Main Phone Number" },
      { key: "faxNumber", label: "Fax Number" },
      { key: "timeZone", label: "Time Zone" },
    ],
  },
  {
    id: "addressOne",
    label: "Address One",
    fields: [
      { key: "addressOneType", label: "Address One Type" },
      { key: "addressOneStreetOne", label: "Address One Street One" },
      { key: "addressOneStreetTwo", label: "Address One Street Two" },
      { key: "addressOneStreetThree", label: "Address One Street Three" },
      { key: "addressOneCity", label: "Address One City" },
      { key: "addressOneState", label: "Address One State" },
      { key: "addressOneCounty", label: "Address One County" },
      { key: "addressOneCountry", label: "Address One Country" },
      { key: "addressOneZipCode", label: "Address One Zip Code" },
      { key: "addressOnePostOfficeBox", label: "Address One Post Office Box" },
      { key: "addressOneLatitude", label: "Address One Latitude" },
      { key: "addressOneLongitude", label: "Address One Longitude" },
      { key: "addressOnePrimaryContact", label: "Address One Primary Contact" },
      { key: "addressOneTelephoneOne", label: "Address One Telephone Number One" },
      { key: "addressOneTelephoneTwo", label: "Address One Telephone Number Two" },
      { key: "addressOnePhoneNumber", label: "Address One Phone Number" },
      { key: "addressOneFax", label: "Address One Fax" },
      { key: "addressOneFreightTerms", label: "Address One Freight Terms" },
      { key: "addressOneShippingMethod", label: "Address One Shipping Method" },
      { key: "addressOneUpsZone", label: "Address One UPS Zone" },
      { key: "addressOneUtcOffset", label: "Address One UTC Offset" },
      { key: "addressOneUniqueIdentifier", label: "Address One Unique Identifier" },
    ],
  },
  {
    id: "addressTwo",
    label: "Address Two",
    fields: [
      { key: "addressTwoType", label: "Address Two Type" },
      { key: "addressTwoName", label: "Address Two Name" },
      { key: "addressTwoStreetOne", label: "Address Two Street One" },
      { key: "addressTwoStreetTwo", label: "Address Two Street Two" },
      { key: "addressTwoStreetThree", label: "Address Two Street Three" },
      { key: "addressTwoCity", label: "Address Two City" },
      { key: "addressTwoRegion", label: "Address Two Region" },
      { key: "addressTwoState", label: "Address Two State" },
      { key: "addressTwoCountry", label: "Address Two Country" },
      { key: "addressTwoZipCode", label: "Address Two Zip Code" },
      { key: "addressTwoPrimaryContact", label: "Address Two Primary Contact" },
      { key: "addressTwoTelephoneOne", label: "Address Two Telephone One" },
      { key: "addressTwoTelephoneTwo", label: "Address Two Telephone Two" },
      { key: "addressTwoTelephoneThree", label: "Address Two Telephone Three" },
      { key: "addressTwoFax", label: "Address Two Fax" },
    ],
  },
  {
    id: "billing",
    label: "Billing and Credit",
    fields: [
      { key: "billingAddress", label: "Billing Address" },
      { key: "billingAddressName", label: "Billing Address Name" },
      { key: "billingAddressStreet", label: "Billing Address Street" },
      { key: "billingAddressStreetTwo", label: "Billing Address Street Two" },
      { key: "billingAddressStreetThree", label: "Billing Address Street Three" },
      { key: "billingAddressSuiteNumber", label: "Billing Address Suite Number" },
      { key: "billingAddressState", label: "Billing Address State" },
      { key: "billingAddressCountry", label: "Billing Address Country" },
      { key: "billingAddressZipCode", label: "Billing Address Zip Code" },
      { key: "billingInterval", label: "Billing Interval" },
      { key: "billingType", label: "Billing Type" },
      { key: "annualRevenue", label: "Annual Revenue" },
      { key: "annualRevenueBase", label: "Annual Revenue Base" },
      { key: "availableCredit", label: "Available Credit" },
      { key: "creditHold", label: "Credit Hold" },
      { key: "currency", label: "Currency" },
      { key: "averageTimeToCloseOpportunity", label: "Average Time to Close Opportunity" },
    ],
  },
  {
    id: "compliance",
    label: "Communication Preferences and Audit",
    fields: [
      { key: "doNotAllowBulkEmail", label: "Do Not Allow Bulk Email" },
      { key: "doNotAllowBulkMail", label: "Do Not Allow Bulk Mail" },
      { key: "doNotAllowEmails", label: "Do Not Allow Emails" },
      { key: "doNotAllowFaxes", label: "Do Not Allow Faxes" },
      { key: "doNotAllowMail", label: "Do Not Allow Mail" },
      { key: "doNotAllowPhoneCalls", label: "Do Not Allow Phone Calls" },
      { key: "createdBy", label: "Created By" },
      { key: "createdOn", label: "Created On" },
    ],
  },
];

const accountCoreFields = accountCoreFieldSections.flatMap((section) =>
  section.fields.map((field) => ({
    ...field,
    section: section.id,
    sectionLabel: section.label,
  })),
);

const accountFieldLookup = new Map(accountCoreFields.map((field) => [field.key, field]));

const accountTableViews = {
  sales: {
    label: "Sales Account View",
    description: "Sales-facing account columns only: relationship, pipeline, owner, and next action.",
    columns: ["accountName", "primaryContact", "mainPhoneNumber", "city", "salesStatus", "pipeline", "lastTouch", "nextAction"],
  },
  relationship: {
    label: "Relationship Coverage",
    description: "Buying group and communication coverage without operational or billing clutter.",
    columns: ["accountName", "industry", "primaryContact", "email", "website", "contactCoverage", "communicationPreference", "owner"],
  },
  credit: {
    label: "Credit and Billing Signals",
    description: "Limited finance signals that help account managers understand quoting and approval risk.",
    columns: ["accountName", "accountNumber", "annualRevenue", "availableCredit", "creditHold", "billingType", "currency"],
  },
};

const tableViewRegistry = {
  accounts: accountTableViews,
  contacts: {
    sales: {
      label: "Sales Contact View",
      description: "Contacts by influence, preferred communication, and linked opportunities.",
      columns: ["name", "account", "title", "email", "phone", "influence", "preferredContact"],
    },
  },
  opportunities: {
    sales: {
      label: "Pipeline View",
      description: "Opportunity stage, value, close date, probability, service type, and next step.",
      columns: ["name", "account", "stage", "value", "probability", "closeDate", "nextStep"],
    },
  },
};

const contactCoreFieldSections = [
  {
    id: "identity",
    label: "Contact Identity",
    defaultOpen: true,
    fields: [
      { key: "fullName", label: "Full Name" },
      { key: "contactId", label: "Contact ID" },
      { key: "contactUniqueIdentifier", label: "Unique Identifier" },
      { key: "firstName", label: "First Name" },
      { key: "lastName", label: "Last Name" },
      { key: "jobTitle", label: "Job Title" },
      { key: "birthday", label: "Birthday" },
      { key: "accountName", label: "Account" },
      { key: "accountRole", label: "Role" },
      { key: "relationshipRole", label: "Relationship Role" },
      { key: "lifecycleStage", label: "Lifecycle Stage" },
      { key: "leadStatus", label: "Lead Status" },
      { key: "owner", label: "Owner" },
      { key: "hubspotOwnerId", label: "HubSpot Owner ID" },
      { key: "originatingLeadId", label: "Originating Lead" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    defaultOpen: true,
    fields: [
      { key: "email", label: "Email" },
      { key: "emailAddressTwo", label: "Email Address Two" },
      { key: "emailAddressThree", label: "Email Address Three" },
      { key: "businessPhone", label: "Business Phone" },
      { key: "mobilePhone", label: "Mobile Phone" },
      { key: "phone", label: "Phone" },
      { key: "fax", label: "Fax" },
      { key: "preferredContactMethod", label: "Preferred Contact Method" },
      { key: "doNotAllowEmails", label: "Do Not Allow Emails" },
      { key: "doNotAllowPhoneCalls", label: "Do Not Allow Phone Calls" },
      { key: "doNotAllowMail", label: "Do Not Allow Mail" },
      { key: "doNotAllowFaxes", label: "Do Not Allow Faxes" },
    ],
  },
  {
    id: "addressOne",
    label: "Address One",
    fields: [
      { key: "addressOneType", label: "Address One Type" },
      { key: "addressOneStreetOne", label: "Address One Street One" },
      { key: "addressOneStreetTwo", label: "Address One Street Two" },
      { key: "addressOneStreetThree", label: "Address One Street Three" },
      { key: "addressOneCity", label: "Address One City" },
      { key: "addressOneState", label: "Address One State" },
      { key: "addressOneCountry", label: "Address One Country" },
      { key: "addressOneZipCode", label: "Address One Zip Code" },
      { key: "addressOneTelephoneOne", label: "Address One Phone" },
      { key: "addressOneTelephoneTwo", label: "Address One Telephone Two" },
      { key: "addressOneTelephoneThree", label: "Address One Telephone Three" },
      { key: "addressOneUpsZone", label: "Address One UPS Zone" },
      { key: "addressOneUtcOffset", label: "Address One UTC Offset" },
    ],
  },
  {
    id: "addressTwo",
    label: "Address Two",
    fields: [
      { key: "addressTwoType", label: "Address Two Type" },
      { key: "addressTwoStreetOne", label: "Address Two Street One" },
      { key: "addressTwoStreetTwo", label: "Address Two Street Two" },
      { key: "addressTwoStreetThree", label: "Address Two Street Three" },
      { key: "addressTwoCity", label: "Address Two City" },
      { key: "addressTwoState", label: "Address Two State" },
      { key: "addressTwoCountry", label: "Address Two Country" },
      { key: "addressTwoZipCode", label: "Address Two Zip Code" },
      { key: "addressTwoTelephoneOne", label: "Address Two Telephone One" },
      { key: "addressTwoTelephoneTwo", label: "Address Two Telephone Two" },
      { key: "addressTwoTelephoneThree", label: "Address Two Telephone Three" },
      { key: "addressTwoFax", label: "Address Two Fax" },
    ],
  },
  {
    id: "activity",
    label: "Sales Activity and Audit",
    fields: [
      { key: "lastContacted", label: "Last Contacted" },
      { key: "lastActivityDate", label: "Last Activity Date" },
      { key: "nextActivityDate", label: "Next Activity Date" },
      { key: "numberOfSalesActivities", label: "Number of Sales Activities" },
      { key: "numberOfTimesContacted", label: "Number of Times Contacted" },
      { key: "createdOn", label: "Created On" },
      { key: "createdBy", label: "Created By" },
      { key: "lastModifiedDate", label: "Last Modified Date" },
      { key: "recordSource", label: "Record Source" },
      { key: "notes", label: "Notes" },
    ],
  },
];

const contactCoreFields = contactCoreFieldSections.flatMap((section) =>
  section.fields.map((field) => ({ ...field, section: section.id, sectionLabel: section.label })),
);
const contactFieldLookup = new Map(contactCoreFields.map((field) => [field.key, field]));

const contactTableViews = {
  sales: {
    label: "Sales Contact View",
    description: "Buying role, preferred communication, and linked opportunities.",
    columns: ["fullName", "accountName", "jobTitle", "email", "phone", "relationshipRole", "linkedOpportunities"],
  },
  outreach: {
    label: "Outreach and Activity",
    description: "Communication readiness, last touch, next activity, and contact restrictions.",
    columns: ["fullName", "email", "mobilePhone", "preferredContactMethod", "lastContacted", "nextActivityDate", "communicationPreference"],
  },
  coverage: {
    label: "Buying Group Coverage",
    description: "Role coverage by account and opportunity association.",
    columns: ["accountName", "fullName", "accountRole", "relationshipRole", "linkedOpportunities", "leadStatus"],
  },
};

const opportunityCoreFieldSections = [
  {
    id: "identity",
    label: "Opportunity Identity",
    defaultOpen: true,
    fields: [
      { key: "opportunityName", label: "Opportunity Name" },
      { key: "opportunityId", label: "Opportunity ID" },
      { key: "opportunityUniqueIdentifier", label: "Unique Identifier" },
      { key: "accountName", label: "Account" },
      { key: "primaryContact", label: "Primary Contact" },
      { key: "owner", label: "Owner" },
      { key: "hubspotOwnerId", label: "HubSpot Owner ID" },
      { key: "dealType", label: "Deal Type" },
      { key: "serviceType", label: "Service Type" },
      { key: "sourceCampaign", label: "Source Campaign" },
      { key: "originatingLeadId", label: "Originating Lead" },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline and Qualification",
    defaultOpen: true,
    fields: [
      { key: "pipeline", label: "Pipeline" },
      { key: "dealStage", label: "Deal Stage" },
      { key: "status", label: "Status" },
      { key: "forecastCategory", label: "Forecast Category" },
      { key: "closeProbability", label: "Close Probability" },
      { key: "priority", label: "Priority" },
      { key: "rating", label: "Rating" },
      { key: "initialCommunication", label: "Initial Communication" },
      { key: "currentSituation", label: "Current Situation" },
      { key: "customerNeed", label: "Customer Need" },
      { key: "proposedSolution", label: "Proposed Solution" },
      { key: "nextStep", label: "Next Step" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue and Forecast",
    fields: [
      { key: "amount", label: "Amount" },
      { key: "amountInCompanyCurrency", label: "Amount in Company Currency" },
      { key: "estimatedValue", label: "Estimated Value" },
      { key: "weightedAmount", label: "Weighted Amount" },
      { key: "forecastAmount", label: "Forecast Amount" },
      { key: "annualRecurringRevenue", label: "Annual Recurring Revenue" },
      { key: "totalContractValue", label: "Total Contract Value" },
      { key: "budgetAmount", label: "Budget Amount" },
      { key: "notToExceed", label: "Not to Exceed" },
      { key: "currency", label: "Currency" },
      { key: "exchangeRate", label: "Exchange Rate" },
      { key: "isRevenueSystemCalculated", label: "Revenue Calculation" },
    ],
  },
  {
    id: "datesActivity",
    label: "Dates and Activity",
    fields: [
      { key: "estimatedCloseDate", label: "Estimated Close Date" },
      { key: "actualCloseDate", label: "Actual Close Date" },
      { key: "createdOn", label: "Created On" },
      { key: "createdBy", label: "Created By" },
      { key: "lastModifiedDate", label: "Last Modified Date" },
      { key: "lastContacted", label: "Last Contacted" },
      { key: "nextActivityDate", label: "Next Activity Date" },
      { key: "numberOfSalesActivities", label: "Number of Sales Activities" },
      { key: "numberOfAssociatedContacts", label: "Number of Associated Contacts" },
      { key: "stageAgeDays", label: "Stage Age Days" },
    ],
  },
  {
    id: "closeout",
    label: "Closeout and Associations",
    fields: [
      { key: "competitor", label: "Competitor" },
      { key: "decisionMaker", label: "Decision Maker" },
      { key: "purchaseProcess", label: "Purchase Process" },
      { key: "purchaseTimeframe", label: "Purchase Timeframe" },
      { key: "quoteId", label: "Quote" },
      { key: "priceList", label: "Price List" },
      { key: "recordSource", label: "Record Source" },
      { key: "description", label: "Description" },
    ],
  },
];

const opportunityCoreFields = opportunityCoreFieldSections.flatMap((section) =>
  section.fields.map((field) => ({ ...field, section: section.id, sectionLabel: section.label })),
);
const opportunityFieldLookup = new Map(opportunityCoreFields.map((field) => [field.key, field]));

const opportunityTableViews = {
  board: {
    label: "Pipeline Board",
    description: "Kanban board grouped by sales stage.",
    columns: [],
  },
  forecast: {
    label: "Forecast View",
    description: "Revenue, probability, close date, and forecast category.",
    columns: ["opportunityName", "accountName", "dealStage", "amount", "weightedAmount", "estimatedCloseDate", "forecastCategory"],
  },
  qualification: {
    label: "Qualification View",
    description: "Customer need, current situation, next step, and initial communication.",
    columns: ["opportunityName", "accountName", "primaryContact", "currentSituation", "customerNeed", "nextStep", "initialCommunication"],
  },
  activity: {
    label: "Activity View",
    description: "Last touch, next activity, associated contacts, and stage age.",
    columns: ["opportunityName", "dealStage", "lastContacted", "nextActivityDate", "numberOfSalesActivities", "numberOfAssociatedContacts", "stageAgeDays"],
  },
};

tableViewRegistry.contacts = contactTableViews;
tableViewRegistry.opportunities = opportunityTableViews;

const seedAccounts = [
  {
    id: "acct-riverbend",
    name: "Riverbend Manufacturing",
    contact: "Alicia Moreno",
    email: "amoreno@riverbend.example",
    phone: "(314) 555-0182",
    city: "St. Louis, MO",
    siteName: "South yard tank farm",
    concern: "Petroleum impacted soil near former UST basin",
    risk: "High",
    phase: "Sampling",
    owner: "Maya Chen",
    lastContact: "2026-07-01",
    nextAction: "Send revised scope after lab report",
  },
  {
    id: "acct-north-river",
    name: "North River Logistics",
    contact: "Jordan Lee",
    email: "jlee@northriver.example",
    phone: "(816) 555-0147",
    city: "Kansas City, MO",
    siteName: "Fleet maintenance depot",
    concern: "Diesel staining and stormwater compliance review",
    risk: "Medium",
    phase: "Assessment",
    owner: "Priya Patel",
    lastContact: "2026-06-28",
    nextAction: "Book site walk with operations director",
  },
  {
    id: "acct-clearwater",
    name: "Clearwater Schools",
    contact: "Sam Ortega",
    email: "sortega@clearwaterschools.example",
    phone: "(217) 555-0199",
    city: "Springfield, IL",
    siteName: "Boiler room modernization",
    concern: "Asbestos abatement before mechanical upgrade",
    risk: "Medium",
    phase: "Proposal",
    owner: "Maya Chen",
    lastContact: "2026-06-30",
    nextAction: "Confirm summer access windows",
  },
  {
    id: "acct-prairie-foods",
    name: "Prairie Foods Co-op",
    contact: "Erin Walsh",
    email: "ewalsh@prairiefoods.example",
    phone: "(515) 555-0131",
    city: "Des Moines, IA",
    siteName: "Cold storage expansion",
    concern: "Phase I findings and groundwater monitoring",
    risk: "Low",
    phase: "Lead",
    owner: "Luis Romero",
    lastContact: "2026-06-25",
    nextAction: "Share comparable project summary",
  },
  {
    id: "acct-city-georgetown",
    name: "City of Georgetown",
    contact: "Chief Something",
    email: "",
    phone: "254-495-8028",
    city: "Georgetown, TX",
    siteName: "Quail Valley Drive response area",
    concern: "Municipal emergency response and environmental services",
    risk: "Medium",
    phase: "Active customer",
    owner: "Maya Chen",
    lastContact: "2026-07-24",
    nextAction: "Complete oil spill response closeout",
  },
  {
    id: "acct-city-killeen-print",
    name: "City of Killeen Print Shop",
    contact: "Facilities Department",
    email: "",
    phone: "",
    city: "Killeen, TX",
    siteName: "City print shop",
    concern: "Scheduled environmental services",
    risk: "Low",
    phase: "Intake",
    owner: "Maya Chen",
    lastContact: "2026-07-26",
    nextAction: "Confirm site contact and service window",
  },
];

const seedTasks = [
  {
    id: "task-riverbend-lab",
    accountId: "acct-riverbend",
    title: "Review lab report and update disposal assumptions",
    dueDate: "2026-07-06",
    owner: "Maya Chen",
    type: "Proposal",
    priority: "High",
    status: "Open",
  },
  {
    id: "task-north-river-walk",
    accountId: "acct-north-river",
    title: "Complete site walk notes and photo log",
    dueDate: "2026-07-08",
    owner: "Priya Patel",
    type: "Field visit",
    priority: "Medium",
    status: "Open",
  },
  {
    id: "task-clearwater-access",
    accountId: "acct-clearwater",
    title: "Confirm school access calendar and containment windows",
    dueDate: "2026-07-05",
    owner: "Maya Chen",
    type: "Account follow-up",
    priority: "High",
    status: "Open",
  },
  {
    id: "task-prairie-reference",
    accountId: "acct-prairie-foods",
    title: "Send groundwater monitoring reference project",
    dueDate: "2026-07-10",
    owner: "Luis Romero",
    type: "Sales enablement",
    priority: "Low",
    status: "Open",
  },
];

const seedActivities = [
  {
    id: "act-riverbend-brief",
    accountId: "acct-riverbend",
    kind: "Call note",
    body: "Buyer wants the proposal to separate excavation, transport, and disposal so finance can approve alternates.",
    author: "Maya Chen",
    createdAt: "2026-07-01T15:20:00.000Z",
  },
  {
    id: "act-clearwater-window",
    accountId: "acct-clearwater",
    kind: "Site note",
    body: "Facilities team prefers a night shift plan to keep summer school access open.",
    author: "Maya Chen",
    createdAt: "2026-06-30T21:05:00.000Z",
  },
  {
    id: "act-north-river-risk",
    accountId: "acct-north-river",
    kind: "Field note",
    body: "Initial concern is runoff near the wash bay. Need operations map and outfall locations.",
    author: "Priya Patel",
    createdAt: "2026-06-28T18:40:00.000Z",
  },
];

const seedContacts = [
  {
    id: "cont-alicia-moreno",
    accountId: "acct-riverbend",
    name: "Alicia Moreno",
    title: "Director of Facilities",
    email: "amoreno@riverbend.example",
    phone: "(314) 555-0182",
    influence: "Decision maker",
    preferredContact: "Email",
    opportunityIds: ["opp-riverbend-ust"],
    notes: "Owns budget approval and wants disposal costs separated from excavation.",
  },
  {
    id: "cont-marcus-hill",
    accountId: "acct-riverbend",
    name: "Marcus Hill",
    title: "Plant Engineer",
    email: "mhill@riverbend.example",
    phone: "(314) 555-0174",
    influence: "Technical evaluator",
    preferredContact: "Phone",
    opportunityIds: ["opp-riverbend-ust"],
    notes: "Primary source for tank farm drawings and access constraints.",
  },
  {
    id: "cont-jordan-lee",
    accountId: "acct-north-river",
    name: "Jordan Lee",
    title: "Operations Director",
    email: "jlee@northriver.example",
    phone: "(816) 555-0147",
    influence: "Champion",
    preferredContact: "Teams",
    opportunityIds: ["opp-north-river-stormwater"],
    notes: "Wants practical recommendations that will not slow fleet dispatch.",
  },
  {
    id: "cont-sam-ortega",
    accountId: "acct-clearwater",
    name: "Sam Ortega",
    title: "Facilities Manager",
    email: "sortega@clearwaterschools.example",
    phone: "(217) 555-0199",
    influence: "Decision maker",
    preferredContact: "Email",
    opportunityIds: ["opp-clearwater-abatement"],
    notes: "Needs work scheduled around summer programs and board reporting.",
  },
  {
    id: "cont-erin-walsh",
    accountId: "acct-prairie-foods",
    name: "Erin Walsh",
    title: "Expansion Project Lead",
    email: "ewalsh@prairiefoods.example",
    phone: "(515) 555-0131",
    influence: "Evaluator",
    preferredContact: "Email",
    opportunityIds: ["opp-prairie-phase2"],
    notes: "Comparing consultants before committing to Phase II scope.",
  },
];

const seedScheduledWork = [
  {
    id: "work-riverbend-borings",
    accountId: "acct-riverbend",
    opportunityId: "opp-riverbend-ust",
    title: "Confirm boring plan with lab turnaround",
    date: "2026-07-09",
    crew: "Field team A",
    status: "Scheduled",
  },
  {
    id: "work-north-river-walk",
    accountId: "acct-north-river",
    opportunityId: "opp-north-river-stormwater",
    title: "Site walk and outfall photo log",
    date: "2026-07-08",
    crew: "Priya Patel",
    status: "Scheduled",
  },
  {
    id: "work-clearwater-containment",
    accountId: "acct-clearwater",
    opportunityId: "opp-clearwater-abatement",
    title: "Containment plan review",
    date: "2026-07-11",
    crew: "Abatement estimator",
    status: "Tentative",
  },
];

const seedProjects = [
  {
    id: "job-riverbend-ust",
    accountId: "acct-riverbend",
    locationId: "loc-riverbend-yard",
    opportunityId: "opp-riverbend-ust",
    contactIds: ["cont-alicia-moreno", "cont-marcus-hill"],
    name: "UST removal and soil remediation",
    jobClass: "Multi-Stage Remediation",
    status: "Pre-mobilization",
    activePhase: "Investigation and disposal planning",
    projectManager: "Priya Patel",
    salesLead: "Maya Chen",
    startDate: "2026-07-09",
    targetDate: "2026-08-28",
    budget: 185000,
    notToExceed: "",
    marginWatch: "Estimate pending disposal alternate",
    generatorName: "Riverbend Manufacturing",
    generatorSiteName: "South yard tank farm",
    epaId: "MOD984713290",
    tceqId: "Not applicable - Missouri site",
    insuranceContact: "Dana Wilkes, Risk Manager, (314) 555-0128",
    insuranceCarrier: "Midwest Industrial Mutual",
    claimNumber: "MIM-26-0712-RB",
    serviceProfile: "UST closure, contaminated soil excavation, disposal profiling, confirmation sampling, and closeout report.",
  },
  {
    id: "job-north-river-stormwater",
    accountId: "acct-north-river",
    locationId: "loc-north-river-depot",
    opportunityId: "opp-north-river-stormwater",
    contactIds: ["cont-jordan-lee"],
    name: "Stormwater and diesel cleanup program",
    jobClass: "Scheduled Work",
    status: "Scheduled",
    activePhase: "Site walk",
    projectManager: "Priya Patel",
    salesLead: "Luis Romero",
    startDate: "2026-07-08",
    targetDate: "2026-08-07",
    budget: 96000,
    notToExceed: "",
    marginWatch: "Routine field cost tracking",
    generatorName: "North River Logistics",
    generatorSiteName: "Fleet maintenance depot",
    epaId: "MOR000552904",
    tceqId: "Not applicable - Missouri site",
    insuranceContact: "Kelly Braun, Claims Coordinator, (816) 555-0165",
    insuranceCarrier: "Transport Risk Underwriters",
    claimNumber: "TRU-STW-44019",
    serviceProfile: "Stormwater compliance, diesel cleanup, outfall photo log, and maintenance yard housekeeping plan.",
  },
  {
    id: "job-clearwater-abatement",
    accountId: "acct-clearwater",
    locationId: "loc-clearwater-boiler",
    opportunityId: "opp-clearwater-abatement",
    contactIds: ["cont-sam-ortega"],
    name: "Boiler room asbestos abatement",
    jobClass: "Scheduled Work",
    status: "Awarded",
    activePhase: "Containment plan review",
    projectManager: "Maya Chen",
    salesLead: "Maya Chen",
    startDate: "2026-07-15",
    targetDate: "2026-07-31",
    budget: 132000,
    notToExceed: "",
    marginWatch: "Night shift premium under review",
    generatorName: "Clearwater Schools",
    generatorSiteName: "Boiler room modernization",
    epaId: "ILD982734112",
    tceqId: "Not applicable - Illinois site",
    insuranceContact: "Marisol Dunn, District Insurance Liaison, (217) 555-0157",
    insuranceCarrier: "Public Entity Risk Pool",
    claimNumber: "PERP-CLR-2026-18",
    serviceProfile: "Asbestos containment, negative air setup, abatement sequencing, and clearance documentation.",
  },
  {
    id: "job-north-river-i130",
    accountId: "acct-north-river",
    locationId: "loc-north-river-depot",
    opportunityId: "",
    contactIds: ["cont-jordan-lee"],
    name: "I-130 incident response",
    jobClass: "Emergency Response",
    status: "Active dispatch",
    activePhase: "Field intake and stabilization",
    projectManager: "Maya Chen",
    salesLead: "Luis Romero",
    startDate: "2026-07-03",
    targetDate: "2026-07-05",
    budget: 0,
    notToExceed: 50000,
    marginWatch: "Time & Materials with NTE alert at $50,000",
    generatorName: "North River Logistics",
    generatorSiteName: "I-130 response area",
    epaId: "MOR000552904",
    tceqId: "Not applicable - Missouri emergency response",
    insuranceContact: "Kelly Braun, Claims Coordinator, (816) 555-0165",
    insuranceCarrier: "Transport Risk Underwriters",
    claimNumber: "TRU-ER-130-2026",
    serviceProfile: "Emergency stabilization, absorbent deployment, recovered material tracking, and T&M cost control.",
  },
  {
    id: "proj-riverbend-phase1",
    accountId: "acct-riverbend",
    name: "Phase I environmental site assessment",
    jobClass: "Scheduled Work",
    status: "Complete",
    serviceType: "Due diligence",
    completedDate: "2025-11-14",
    value: 18000,
    budget: 18000,
    outcome: "Identified historical UST area and recommended soil borings.",
  },
  {
    id: "proj-north-river-spill",
    accountId: "acct-north-river",
    name: "Emergency hydraulic fluid response",
    jobClass: "Emergency Response",
    status: "Complete",
    serviceType: "Emergency response",
    completedDate: "2026-02-22",
    value: 28000,
    budget: 28000,
    outcome: "Contained release and closed incident report within 10 days.",
  },
  {
    id: "proj-clearwater-survey",
    accountId: "acct-clearwater",
    name: "Hazardous materials survey",
    jobClass: "Scheduled Work",
    status: "Complete",
    serviceType: "Asbestos abatement",
    completedDate: "2026-04-18",
    value: 36000,
    budget: 36000,
    outcome: "Mapped abatement quantities for boiler upgrade planning.",
  },
];

const seedProjectAssignments = [
  {
    id: "assign-riverbend-sales",
    projectId: "job-riverbend-ust",
    userName: "Maya Chen",
    userEmail: "maya.chen@example.com",
    globalRole: "Sales Manager",
    assignedRole: "Sales Lead",
    status: "Active",
  },
  {
    id: "assign-riverbend-pm",
    projectId: "job-riverbend-ust",
    userName: "Priya Patel",
    userEmail: "priya.patel@example.com",
    globalRole: "Field Lead",
    assignedRole: "Project Manager",
    status: "Active",
  },
  {
    id: "assign-riverbend-sampler",
    projectId: "job-riverbend-ust",
    userName: "Noah Brooks",
    userEmail: "noah.brooks@example.com",
    globalRole: "Staff/Employee",
    assignedRole: "Sampler",
    status: "Active",
  },
  {
    id: "assign-i130-dispatch",
    projectId: "job-north-river-i130",
    userName: "Renee Carter",
    userEmail: "renee.carter@example.com",
    globalRole: "Staff/Employee",
    assignedRole: "Dispatcher",
    status: "Active",
  },
  {
    id: "assign-i130-field",
    projectId: "job-north-river-i130",
    userName: "Priya Patel",
    userEmail: "priya.patel@example.com",
    globalRole: "Field Lead",
    assignedRole: "Field Lead",
    status: "Active",
  },
];

const seedMaterialUsage = [
  {
    id: "mat-i130-absorbents",
    projectId: "job-north-river-i130",
    accountId: "acct-north-river",
    materialType: "Absorbents",
    quantity: 18,
    unit: "bags",
    loggedBy: "Priya Patel",
    timestamp: "2026-07-03T16:15:00.000Z",
  },
  {
    id: "mat-riverbend-sample-jars",
    projectId: "job-riverbend-ust",
    accountId: "acct-riverbend",
    materialType: "Sampling containers",
    quantity: 24,
    unit: "jars",
    loggedBy: "Noah Brooks",
    timestamp: "2026-07-02T18:20:00.000Z",
  },
];

const seedEquipmentLogs = [
  {
    id: "equip-i130-vac",
    projectId: "job-north-river-i130",
    accountId: "acct-north-river",
    assetTag: "VAC-204",
    equipment: "Vacuum trailer",
    truckId: "TRK-18",
    checkedOut: "2026-07-03T15:40:00.000Z",
    returned: "",
    condition: "In service",
    user: "Priya Patel",
  },
  {
    id: "equip-riverbend-pump",
    projectId: "job-riverbend-ust",
    accountId: "acct-riverbend",
    assetTag: "PMP-077",
    equipment: "Transfer pump",
    truckId: "TRK-07",
    checkedOut: "2026-07-02T13:00:00.000Z",
    returned: "2026-07-02T19:15:00.000Z",
    condition: "Returned clean",
    user: "Noah Brooks",
  },
];

const seedProjectAlerts = [
  {
    id: "alert-riverbend-scope",
    projectId: "job-riverbend-ust",
    accountId: "acct-riverbend",
    locationId: "loc-riverbend-yard",
    alertType: "Scope Exception",
    severity: "High",
    description: "Possible unlisted contaminant noted near the former tank basin. Work paused pending review.",
    reportedBy: "Noah Brooks",
    reportedAt: "2026-07-02T20:05:00.000Z",
    status: "Open",
    notified: ["Project Manager", "Sales Lead"],
  },
  {
    id: "alert-i130-nte",
    projectId: "job-north-river-i130",
    accountId: "acct-north-river",
    locationId: "loc-north-river-depot",
    alertType: "Customer Approval Needed",
    severity: "Medium",
    description: "Emergency response labor and absorbents are approaching the not-to-exceed threshold.",
    reportedBy: "Renee Carter",
    reportedAt: "2026-07-03T17:05:00.000Z",
    status: "Open",
    notified: ["Project Manager", "Sales Lead", "Dispatch"],
  },
];

const seedSpatialData = [
  {
    id: "spatial-riverbend-yard",
    accountId: "acct-riverbend",
    locationId: "loc-riverbend-yard",
    projectId: "job-riverbend-ust",
    fileType: "Point cloud placeholder",
    storagePath: "object-storage://sites/riverbend/south-yard/pre-scan.laz",
    scanDate: "2026-07-02",
    uploadedBy: "Priya Patel",
    annotations: "Use for future excavation boundary and staging route review.",
    scanQuality: "Control pending",
    pointCount: "12.4M points",
    coverage: "South yard tank farm",
  },
  {
    id: "spatial-i130-response",
    accountId: "acct-north-river",
    locationId: "loc-north-river-depot",
    projectId: "job-north-river-i130",
    fileType: "7/3/2025 3D site render",
    storagePath: "./public/models/7_3_2025.glb",
    modelPath: "./public/models/7_3_2025.glb",
    scanDate: "2025-07-03",
    uploadedBy: "Renee Carter",
    annotations: "GLB render linked as the sample project viewer file, with sample points plotted on the project site map.",
    scanQuality: "Sample render",
    pointCount: "GLB mesh",
    coverage: "7/3/2025 project area",
  },
];

const consumableInventory = [
  { materialType: "Absorbents", unit: "bags", onHand: 34, reorderAt: 30, targetStock: 80, buyer: "Operations buyer" },
  { materialType: "Sampling containers", unit: "jars", onHand: 52, reorderAt: 36, targetStock: 120, buyer: "Operations buyer" },
  { materialType: "PPE kits", unit: "kits", onHand: 14, reorderAt: 18, targetStock: 50, buyer: "Safety buyer" },
  { materialType: "Disposal drums", unit: "drums", onHand: 9, reorderAt: 12, targetStock: 35, buyer: "Operations buyer" },
];

const equipmentAssets = [
  {
    assetTag: "VAC-204",
    equipment: "Vacuum trailer",
    status: "In service",
    maintenanceDue: "2026-07-18",
    lastUsed: "2026-07-03",
    assignedProjectId: "job-north-river-i130",
    issue: "",
  },
  {
    assetTag: "PMP-077",
    equipment: "Transfer pump",
    status: "Ready",
    maintenanceDue: "2026-08-04",
    lastUsed: "2026-07-02",
    assignedProjectId: "job-riverbend-ust",
    issue: "",
  },
  {
    assetTag: "TRK-18",
    equipment: "Response truck",
    status: "Maintenance hold",
    maintenanceDue: "2026-07-06",
    lastUsed: "2026-07-03",
    assignedProjectId: "job-north-river-i130",
    issue: "Hydraulic lift inspection failed. Scheduler should avoid assignment.",
  },
  {
    assetTag: "AIR-112",
    equipment: "Negative air machine",
    status: "Ready",
    maintenanceDue: "2026-07-30",
    lastUsed: "2026-06-27",
    assignedProjectId: "job-clearwater-abatement",
    issue: "",
  },
];

const equipmentCategoryConfig = {
  Vehicle: {
    specFields: [
      { key: "vin", label: "VIN", placeholder: "1FT7X2B69JEA14207" },
      { key: "licensePlate", label: "License plate", placeholder: "TX-BR1802" },
      { key: "mileage", label: "Mileage", placeholder: "58,410" },
      { key: "fuelType", label: "Fuel type", placeholder: "Diesel" },
      { key: "insurancePolicy", label: "Insurance policy", placeholder: "Policy number" },
      { key: "registrationExpires", label: "Registration expires", type: "date" },
    ],
    checklist: [
      "Check oil and fluid levels",
      "Inspect tires, brakes, and lights",
      "Confirm registration and insurance are current",
      "Test hydraulic lift or lift gate if equipped",
      "Log mileage",
    ],
    maintenanceGuide: [
      "Follow manufacturer service interval for oil, filters, and fluids.",
      "Inspect brakes and tires every service visit.",
      "Renew registration and insurance before expiration and update this record.",
      "Do not dispatch while status is Maintenance hold.",
    ],
  },
  "Vacuum / Vactron": {
    specFields: [
      { key: "tankCapacity", label: "Tank capacity", placeholder: "3,600 gal" },
      { key: "pumpPressure", label: "Pump pressure", placeholder: "27 in-Hg" },
      { key: "engineHours", label: "Engine hours", placeholder: "812" },
      { key: "deconStatus", label: "Decon status", placeholder: "Clean" },
    ],
    checklist: [
      "Inspect hoses and fittings for wear",
      "Check vacuum pressure and pump seals",
      "Decontaminate tank and log decon status",
      "Confirm PPE and spill kit are stocked on unit",
    ],
    maintenanceGuide: [
      "Decontaminate tank after every hazardous material job before returning to service.",
      "Inspect hoses, fittings, and pump seals on the scheduled service interval.",
      "Track engine hours and schedule service at the manufacturer interval.",
    ],
  },
  Pump: {
    specFields: [
      { key: "flowRate", label: "Flow rate", placeholder: "110 GPM" },
      { key: "hoseSize", label: "Hose size", placeholder: "3 in" },
      { key: "engineHours", label: "Engine hours", placeholder: "240" },
    ],
    checklist: ["Check fuel and oil levels", "Inspect hoses and couplings", "Test prime and flow rate", "Log engine hours"],
    maintenanceGuide: [
      "Run and prime the pump before returning it to ready status.",
      "Inspect hoses and couplings for leaks each use.",
      "Service per engine-hour interval, not just calendar time.",
    ],
  },
  "Air Filtration": {
    specFields: [
      { key: "cfmRating", label: "CFM rating", placeholder: "1,200 CFM" },
      { key: "filterType", label: "Filter type", placeholder: "HEPA" },
      { key: "filterChangeInterval", label: "Filter change interval", placeholder: "90 days" },
    ],
    checklist: ["Inspect and test filter seal", "Confirm CFM output", "Replace filter if past change interval", "Wipe down housing"],
    maintenanceGuide: [
      "Replace filters on the configured change interval or sooner if airflow drops.",
      "Test negative pressure before each containment job.",
    ],
  },
  "General equipment": {
    specFields: [
      { key: "serialNumber", label: "Serial number", placeholder: "SN-0000" },
      { key: "manufacturer", label: "Manufacturer", placeholder: "Manufacturer" },
      { key: "modelNumber", label: "Model number", placeholder: "Model number" },
    ],
    checklist: ["Visual inspection for damage", "Confirm accessories and attachments are present", "Log condition and usage"],
    maintenanceGuide: ["Follow manufacturer guidance for this equipment class.", "Log any damage or irregular wear immediately."],
  },
};

function getEquipmentCategoryNames() {
  return Object.keys(equipmentCategoryConfig);
}

function getEquipmentCategoryConfig(category) {
  return equipmentCategoryConfig[category] || equipmentCategoryConfig["General equipment"];
}

const state = {
  view: "home",
  accountSearch: "",
  accountIndustryFilter: "",
  accountTableView: "sales",
  accountDetailTab: "",
  contactDetailTab: "",
  accountTimelineSearch: "",
  contactSearch: "",
  contactTableView: "sales",
  opportunitySearch: "",
  opportunityTableView: "board",
  operationsFilter: "All",
  taskFilter: "Open",
  selectedAccountId: "",
  selectedContactId: "",
  selectedOpportunityId: "",
  selectedProjectId: "",
  selectedSampleId: "",
  selectedEmployeeId: "",
  selectedDispatchJobId: "",
  selectedConsumableId: "",
  selectedEquipmentAssetTag: "",
  selectedTemplateId: "",
  templateDraft: null,
  workforceSearch: "",
  dispatchJobFilter: "Open",
  pipelineAccountFilter: "",
  projectsAccountFilter: "",
  dispatchAccountFilter: "",
  accounts: [],
  contacts: [],
  locations: [],
  projects: [],
  projectAssignments: [],
  materialUsage: [],
  equipmentLogs: [],
  projectAlerts: [],
  sampleRecords: [],
  spatialData: [],
  scheduledWork: [],
  opportunities: [],
  opportunityDetailTab: "summary",
  dispatchJobDetailTab: "summary",
  tasks: [],
  activities: [],
  syncQueue: [],
  backend: {
    scheduleEvents: [],
    mapLocations: [],
    inventoryItems: [],
    purchaseOrders: [],
    equipmentAssets: [],
    equipmentMaintenanceRecords: [],
    equipmentRestockItems: [],
    laborAssignments: [],
    sampleRecords: [],
    employees: [],
    employeeCertifications: [],
    workforceTeams: [],
    workforceTeamMemberships: [],
    crewProfiles: [],
    availabilityBlocks: [],
    frontlineDevices: [],
    jobRequests: [],
    jobRequestDocuments: [],
    dispatchJobs: [],
    jobAssignments: [],
    jobScheduleSegments: [],
    jobResources: [],
    jobConflicts: [],
    jobSteps: [],
    jobActions: [],
    jobTypeTemplates: [],
    jobFormSubmissions: [],
    invoices: [],
    qboSettings: {
      connectionStatus: "Not connected",
      realmId: "",
      lastExportAt: "",
    },
    qboExports: [],
    accountTypes: [],
    industries: [],
    accountIndustries: [],
    addresses: [],
    locations: [],
    salesTasks: [],
    accountRelationshipExtensions: [],
    accountComments: [],
    accountDivisions: [],
    contactEmploymentHistory: [],
    subcontractorTypes: [],
    vendorProfiles: [],
    serviceAgreements: [],
    subcontractorAssignments: [],
  },
  identityConfig: defaultIdentityConfig,
  platformSettings: defaultPlatformSettings,
  currentUser: demoUser,
  authError: "",
  online: navigator.onLine,
  frontlineSession: null,
  frontlineJobFilter: { scope: "mine", region: "all" },
  frontlineSelectedJobId: "",
  frontlineOpenActionId: "",
  frontlineSignatureStrokes: [],
  frontlineGps: null,
};

let dbPromise;
let toastTimer;
let draggedOpportunityId = "";
let operationsLeafletMap = null;
let projectSampleLeafletMap = null;
let clientSpillLeafletMap = null;
let projectModelViewers = [];
let threeViewerModulesPromise = null;
let signaturePadCleanup = null;

const app = document.querySelector("#app");
const appShell = document.querySelector(".app-shell");
const connectionStatus = document.querySelector("#connectionStatus");
const todaySummary = document.querySelector("#todaySummary");
const roleSummary = document.querySelector("#roleSummary");
const sideNav = document.querySelector("#sideNav");
const quickActions = document.querySelector("#quickActions");
const settingsDialog = document.querySelector("#settingsDialog");

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [
        // Phase 01 (roadmap: docs/roadmap/phase-01-shared-data-layer.md) has moved every core CRM
        // collection to the shared JSON backend: accounts/contacts (2026-09-15), projects (formerly
        // "jobs", 2026-09-16), and tasks/activities/projectAssignments/projectAlerts/materialUsage/
        // equipmentLogs/scheduledWork/spatialData (2026-09-16). Only the device-scoped stores below
        // remain local by design.
        "syncQueue",
      ]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function transaction(storeName, mode, callback) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let callbackResult;

        tx.oncomplete = () => resolve(callbackResult);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);

        callbackResult = callback(store);
      }),
  );
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).getAll());
}

async function putRecord(storeName, record) {
  await transaction(storeName, "readwrite", (store) => {
    store.put(record);
  });
  return record;
}

async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  const tx = db.transaction("settings", "readonly");
  const record = await requestToPromise(tx.objectStore("settings").get(key));
  return record ? record.value : fallback;
}

async function putSetting(key, value) {
  await putRecord("settings", { key, value });
  return value;
}

async function ensureSeedData() {
  const seeded = await getSetting("seeded", false);
  const seedSchemaVersion = await getSetting("seedSchemaVersion", 0);
  if (!seeded) {
    // Accounts, tasks, and activities are seeded into the shared backend instead — see ensureBackendSeedData().
    await putSetting("identityConfig", defaultIdentityConfig);
    await putSetting("platformSettings", defaultPlatformSettings);
    await putSetting("currentUser", demoUser);
    await putSetting("authError", "");
    await putSetting("seeded", true);
  }

  if (seedSchemaVersion < 4) {
    await putSetting("currentUser", demoUsers.office);
  }

  if (seedSchemaVersion < 5) {
    const platformSettings = await getSetting("platformSettings", null);
    await putSetting("platformSettings", {
      ...defaultPlatformSettings,
      ...(platformSettings || {}),
    });
  }

  // seedSchemaVersion < 6 previously ran migrateAccountsToCoreSchema() against the local accounts
  // store. Accounts now live in the shared backend and are seeded there already in core-schema
  // shape, so the local pass has nothing to operate on. Retired in roadmap Phase 01.

  // seedSchemaVersion < 7 previously ran migrateContactsToCoreSchema() against the local contacts
  // store. Contacts now live in the shared backend, seeded there already in core-schema shape.
  // Retired in roadmap Phase 01.

  // seedSchemaVersion < 8 previously ran migrateActivitiesToCoreSchema() against the local activities
  // store. Activities now live in the shared backend, seeded there already in core-schema shape.
  // Retired in roadmap Phase 01, 2026-09-16.

  // seedSchemaVersion < 10 previously ran migrateSpatialDataSeed() against the local spatialData
  // store (itself already trimmed down from migrateOperationsProjectArchitecture(), which handled
  // the old local jobs store too — see above). spatialData now lives in the shared backend. Retired
  // in roadmap Phase 01, 2026-09-16.

  // seedSchemaVersion < 11 previously ran migrateProjectRenderSampleData(), another local spatialData
  // merge pass. Same retirement as above, 2026-09-16.

  // seedSchemaVersion < 13 previously ran migrateJobRequestAccountFoundation(), which back-filled
  // missing seed accounts into the local store. ensureBackendSeedData() covers this server-side now.
  // Retired in roadmap Phase 01.

  // accounts, contacts, projects, tasks, activities, projectAssignments, projectAlerts, materialUsage,
  // equipmentLogs, scheduledWork, and spatialData are all seeded into the shared backend — see
  // ensureBackendSeedData(). Nothing left to seed locally.

  await putSetting("seedSchemaVersion", 14);
}

// Seeds demo accounts into the shared backend the first time it comes up empty. Kept on the client
// so `seedAccounts` and `buildCoreAccountRecord` stay the single definition of the demo data and its
// shape, rather than being duplicated into server.mjs where the two copies would drift.
// Idempotent: the POST route upserts by id, so two clients racing write identical records.
async function ensureBackendSeedData() {
  try {
    const [accounts, contacts, projects, tasks, activities, projectAssignments, projectAlerts, materialUsage, equipmentLogs, scheduledWork, spatialData] = await Promise.all([
      apiRequest("/api/backend/accounts"),
      apiRequest("/api/backend/contacts"),
      apiRequest("/api/backend/projects"),
      apiRequest("/api/backend/tasks"),
      apiRequest("/api/backend/activities"),
      apiRequest("/api/backend/projectAssignments"),
      apiRequest("/api/backend/projectAlerts"),
      apiRequest("/api/backend/materialUsage"),
      apiRequest("/api/backend/equipmentLogs"),
      apiRequest("/api/backend/scheduledWork"),
      apiRequest("/api/backend/spatialData"),
    ]);
    if (!accounts.length) {
      for (const account of seedAccounts) {
        await saveBackendRecord("accounts", buildCoreAccountRecord(account), { refresh: false });
      }
    }
    if (!contacts.length) {
      for (const contact of seedContacts) {
        await saveBackendRecord("contacts", buildCoreContactRecord(contact), { refresh: false });
      }
    }
    if (!projects.length) {
      for (const project of seedProjects) {
        await saveBackendRecord("projects", buildCoreProjectRecord(project), { refresh: false });
      }
    }
    if (!tasks.length) {
      for (const task of seedTasks) {
        await saveBackendRecord("tasks", buildCoreTaskRecord(task), { refresh: false });
      }
    }
    if (!activities.length) {
      for (const activity of seedActivities) {
        await saveBackendRecord("activities", buildCoreActivityRecord(activity), { refresh: false });
      }
    }
    if (!projectAssignments.length) {
      for (const assignment of seedProjectAssignments) {
        await saveBackendRecord("projectAssignments", assignment, { refresh: false });
      }
    }
    if (!projectAlerts.length) {
      for (const alert of seedProjectAlerts) {
        await saveBackendRecord("projectAlerts", alert, { refresh: false });
      }
    }
    if (!materialUsage.length) {
      for (const material of seedMaterialUsage) {
        await saveBackendRecord("materialUsage", material, { refresh: false });
      }
    }
    if (!equipmentLogs.length) {
      for (const equipment of seedEquipmentLogs) {
        await saveBackendRecord("equipmentLogs", equipment, { refresh: false });
      }
    }
    if (!scheduledWork.length) {
      for (const work of seedScheduledWork) {
        await saveBackendRecord("scheduledWork", work, { refresh: false });
      }
    }
    if (!spatialData.length) {
      for (const item of seedSpatialData) {
        await saveBackendRecord("spatialData", item, { refresh: false });
      }
    }
  } catch (error) {
    // Backend unreachable (offline, or the role can't read the customer directory). refreshBackendState()
    // already surfaces that to the user; seeding simply waits for the next load.
  }
}

async function refreshState() {
  const syncQueue = await getAll("syncQueue");

  // state.accounts, state.contacts, state.projects, state.tasks, state.activities,
  // state.projectAssignments, state.projectAlerts, state.materialUsage, state.equipmentLogs,
  // state.scheduledWork, and state.spatialData are all projected from the shared backend in
  // refreshBackendState(), not loaded here.
  state.syncQueue = syncQueue.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state.identityConfig = await getSetting("identityConfig", defaultIdentityConfig);
  state.platformSettings = {
    ...defaultPlatformSettings,
    ...(await getSetting("platformSettings", defaultPlatformSettings)),
  };
  state.currentUser = await getSetting("currentUser", demoUser);
  state.authError = await getSetting("authError", "");
  applyPlatformSettings();
  await refreshBackendState();
}

async function refreshBackendState() {
  try {
    const backend = await apiRequest("/api/backend");
    state.backend = {
      ...state.backend,
      ...backend,
    };
    state.opportunities = (state.backend.opportunities || [])
      .filter((opportunity) => !opportunity.deletedAt)
      .sort((a, b) => parseDate(a.closeDate) - parseDate(b.closeDate));
    state.sampleRecords = (state.backend.sampleRecords || [])
      .slice()
      .sort((a, b) => new Date(b.collectionTime) - new Date(a.collectionTime));
    state.locations = (state.backend.locations || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    state.accounts = (state.backend.accounts || [])
      .filter((account) => !account.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    state.contacts = (state.backend.contacts || [])
      .filter((contact) => !contact.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    state.projects = (state.backend.projects || [])
      .filter((project) => !project.deletedAt)
      .sort((a, b) => parseDate(a.startDate) - parseDate(b.startDate));
    state.tasks = (state.backend.tasks || [])
      .filter((task) => !task.deletedAt)
      .map(buildCoreTaskRecord)
      .sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate));
    state.activities = (state.backend.activities || [])
      .filter((activity) => !activity.deletedAt)
      .map(buildCoreActivityRecord)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    state.projectAssignments = (state.backend.projectAssignments || [])
      .filter((assignment) => !assignment.deletedAt)
      .sort((a, b) => a.assignedRole.localeCompare(b.assignedRole));
    state.projectAlerts = (state.backend.projectAlerts || [])
      .filter((alert) => !alert.deletedAt)
      .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
    state.materialUsage = (state.backend.materialUsage || [])
      .filter((item) => !item.deletedAt)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    state.equipmentLogs = (state.backend.equipmentLogs || [])
      .filter((item) => !item.deletedAt)
      .sort((a, b) => new Date(b.checkedOut) - new Date(a.checkedOut));
    state.scheduledWork = (state.backend.scheduledWork || [])
      .filter((work) => !work.deletedAt)
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
    state.spatialData = (state.backend.spatialData || [])
      .filter((item) => !item.deletedAt)
      .sort((a, b) => parseDate(b.scanDate) - parseDate(a.scanDate));
    state.authError = state.authError === "Backend API unavailable." ? "" : state.authError;
  } catch (error) {
    state.authError = "Backend API unavailable.";
  }
}

function applyPlatformSettings() {
  const settings = state.platformSettings || defaultPlatformSettings;
  const resolvedTheme =
    settings.theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : settings.theme;
  document.body.dataset.theme = resolvedTheme === "dark" ? "dark" : "light";
  document.body.dataset.density = settings.density === "compact" ? "compact" : "comfortable";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#111713" : "#f7f4ec");
}

async function apiRequest(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-CRM-Role": state.currentUser?.role || "Local",
    ...(options.headers || {}),
  };
  const response = await fetch(pathname, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Backend request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

// Pass { refresh: false } when chaining several writes, then call refreshBackendState() once at
// the end. Each refresh re-downloads the whole backend, so a multi-write flow that refreshes every
// time is needlessly slow on a field device.
async function saveBackendRecord(collection, record, { refresh = true } = {}) {
  const saved = await apiRequest(`/api/backend/${collection}`, {
    method: "POST",
    body: JSON.stringify(record),
  });
  if (refresh) await refreshBackendState();
  return saved;
}

async function init() {
  await ensureSeedData();
  await ensureBackendSeedData();
  await handleAuthRedirect();
  await refreshState();
  applyRouteFromHash();
  bindEvents();
  registerServiceWorker();
  render();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleInput);
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("dragleave", handleDragLeave);
  document.addEventListener("drop", handleDrop);
  document.addEventListener("dragend", handleDragEnd);
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("online", () => updateOnlineStatus(true));
  window.addEventListener("offline", () => updateOnlineStatus(false));
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener("change", () => {
    if (state.platformSettings?.theme === "system") applyPlatformSettings();
  });
}

async function updateOnlineStatus(isOnline) {
  state.online = isOnline;
  renderConnection();
  showToast(isOnline ? "Back online. Pending edits can sync." : "Offline mode is active. Edits will be queued.");
}

async function handleClick(event) {
  document.querySelectorAll("details.activity-picker[open], details.create-menu[open]").forEach((details) => {
    if (!details.contains(event.target)) details.open = false;
  });

  const workspaceButton = event.target.closest("[data-workspace]");
  if (workspaceButton) {
    const workspace = findWorkspace(workspaceButton.dataset.workspace);
    if (!workspace || !canAccessWorkspace(workspace.id)) {
      showToast("Your current role cannot open that workspace.");
      return;
    }

    state.view = workspace.defaultView;
    state.selectedAccountId = "";
    state.selectedContactId = "";
    state.selectedOpportunityId = "";
    state.selectedProjectId = "";
    state.selectedSampleId = "";
    state.selectedEmployeeId = "";
    state.selectedDispatchJobId = "";
    state.pipelineAccountFilter = "";
    state.projectsAccountFilter = "";
    state.dispatchAccountFilter = "";
    render();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    const targetView = viewButton.dataset.view;
    if (!canAccessView(targetView)) {
      showToast("Your current role cannot open that panel.");
      return;
    }

    state.view = targetView;
    state.pipelineAccountFilter = "";
    state.projectsAccountFilter = "";
    state.dispatchAccountFilter = "";
    if (state.view !== "account-detail") state.selectedAccountId = "";
    if (state.view !== "contact-detail") state.selectedContactId = "";
    if (state.view !== "opportunity-detail") state.selectedOpportunityId = "";
    if (!["project-detail", "sample-detail", "client-spill-detail"].includes(state.view)) state.selectedProjectId = "";
    if (state.view !== "sample-detail") state.selectedSampleId = "";
    if (state.view !== "employee-detail") state.selectedEmployeeId = "";
    if (state.view !== "dispatch-job-detail") state.selectedDispatchJobId = "";
    if (state.view !== "inventory-consumable-detail") state.selectedConsumableId = "";
    if (state.view !== "inventory-equipment-detail") state.selectedEquipmentAssetTag = "";
    if (state.view !== "dispatch-template-editor") {
      state.selectedTemplateId = "";
      state.templateDraft = null;
    }
    render();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const { action, id } = actionButton.dataset;

  if (action === "go-home") {
    state.view = "home";
    state.selectedAccountId = "";
    state.selectedContactId = "";
    state.selectedOpportunityId = "";
    state.selectedProjectId = "";
    state.selectedSampleId = "";
    state.selectedEmployeeId = "";
    state.selectedDispatchJobId = "";
    state.selectedConsumableId = "";
    state.selectedEquipmentAssetTag = "";
    state.selectedTemplateId = "";
    state.pipelineAccountFilter = "";
    state.projectsAccountFilter = "";
    state.dispatchAccountFilter = "";
    state.templateDraft = null;
    render();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
    return;
  }
  if (action === "nav-back") history.back();
  if (action === "open-settings") openSettingsDialog();
  if (action === "open-opportunity") openOpportunityDialog(actionButton.dataset.accountId, id);
  if (action === "open-opportunity-lead") openOpportunityLeadDialog(id);
  if (action === "open-opportunity-qualify") openOpportunityQualifyDialog(id);
  if (action === "open-opportunity-develop") openOpportunityDevelopDialog(id);
  if (action === "open-opportunity-stakeholder") openOpportunityStakeholderDialog(actionButton.dataset.opportunityId, id);
  if (action === "remove-opportunity-stakeholder") await removeOpportunityStakeholder(id);
  if (action === "open-opportunity-competitor") openOpportunityCompetitorDialog(actionButton.dataset.opportunityId, id);
  if (action === "remove-opportunity-competitor") await removeOpportunityCompetitor(id);
  if (action === "open-opportunity-assignment") openOpportunityAssignmentDialog(actionButton.dataset.opportunityId, actionButton.dataset.purpose, id);
  if (action === "remove-opportunity-assignment") await removeOpportunityAssignment(id);
  if (action === "open-opportunity-needs-list") openOpportunityNeedsListDialog(actionButton.dataset.opportunityId, actionButton.dataset.kind);
  if (action === "open-opportunity-proposal") openOpportunityProposalDialog(id);
  if (action === "open-opportunity-negotiation") openOpportunityNegotiationDialog(id);
  if (action === "open-opportunity-quote") openOpportunityQuoteDialog(actionButton.dataset.opportunityId, id);
  if (action === "open-account") openAccountDialog(id);
  if (action === "open-account-owner") openAccountOwnerDialog(id);
  if (action === "open-account-billing") openAccountBillingDialog(id);
  if (action === "open-account-ap") openAccountApDialog(id);
  if (action === "open-contact") openContactDialog(actionButton.dataset.accountId, id);
  if (action === "open-contact-info") openContactInfoDialog(actionButton.dataset.contactId);
  if (action === "open-contact-comm-prefs") openContactCommPrefsDialog(actionButton.dataset.contactId);
  if (action === "open-contact-personal") openContactPersonalDialog(actionButton.dataset.contactId);
  if (action === "open-contact-role") openContactRoleDialog(actionButton.dataset.contactId);
  if (action === "open-contact-address-one") openContactAddressOneDialog(actionButton.dataset.contactId);
  if (action === "open-contact-address-two") openContactAddressTwoDialog(actionButton.dataset.contactId);
  if (action === "open-address") openAddressDialog(actionButton.dataset.accountId, id);
  if (action === "open-industries") openIndustriesDialog(actionButton.dataset.accountId);
  if (action === "open-vendor-profile") openVendorProfileDialog(actionButton.dataset.accountId);
  if (action === "open-sales-task") openSalesTaskDialog(actionButton.dataset.accountId, id);
  if (action === "open-company-profile") openCompanyProfileDialog(actionButton.dataset.accountId);
  if (action === "open-relationship-snapshot") openRelationshipSnapshotDialog(actionButton.dataset.accountId);
  if (action === "open-document-status") openDocumentStatusDialog(actionButton.dataset.accountId);
  if (action === "open-relationship-notes") openRelationshipNotesDialog(actionButton.dataset.accountId);
  if (action === "open-account-comment") openAccountCommentDialog(actionButton.dataset.accountId);
  if (action === "remove-account-comment") await removeAccountComment(id);
  if (action === "open-account-division") openAccountDivisionDialog(actionButton.dataset.accountId);
  if (action === "remove-account-division") await removeAccountDivision(id);
  if (action === "open-contact-employment") openContactEmploymentDialog(actionButton.dataset.contactId, id);
  if (action === "remove-contact-employment") await removeContactEmployment(id);
  if (action === "open-account-pause") openAccountPauseDialog(actionButton.dataset.accountId);
  if (action === "open-account-location") openAccountLocationDialog(actionButton.dataset.accountId, id);
  if (action === "switch-account-tab") {
    state.accountDetailTab = actionButton.dataset.tab;
    render();
  }
  if (action === "switch-contact-tab") {
    state.contactDetailTab = actionButton.dataset.tab;
    render();
  }
  if (action === "switch-opportunity-tab") {
    state.opportunityDetailTab = actionButton.dataset.tab;
    render();
  }
  if (action === "switch-dispatch-job-tab") {
    state.dispatchJobDetailTab = actionButton.dataset.tab;
    render();
  }
  if (action === "see-all-opportunities") {
    state.pipelineAccountFilter = actionButton.dataset.accountId;
    state.view = "pipeline";
    render();
    window.scrollTo(0, 0);
  }
  if (action === "clear-pipeline-filter") {
    state.pipelineAccountFilter = "";
    render();
  }
  if (action === "see-all-projects") {
    state.projectsAccountFilter = actionButton.dataset.accountId;
    state.view = "ops-projects";
    render();
    window.scrollTo(0, 0);
  }
  if (action === "clear-projects-filter") {
    state.projectsAccountFilter = "";
    render();
  }
  if (action === "see-all-dispatch") {
    state.dispatchAccountFilter = actionButton.dataset.accountId;
    state.view = "dispatch-jobs";
    render();
    window.scrollTo(0, 0);
  }
  if (action === "clear-dispatch-filter") {
    state.dispatchAccountFilter = "";
    render();
  }
  if (action === "open-service-agreement") openServiceAgreementDialog(actionButton.dataset.accountId, id);
  if (action === "open-subcontractor-assignment") openSubcontractorAssignmentDialog(actionButton.dataset.vendorProfileId, id);
  if (action === "open-contact-preferences") openContactPreferencesDialog(actionButton.dataset.accountId);
  if (action === "open-note") openActivityDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-quick-note") openQuickNoteDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-activity-meeting") openActivityMeetingDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-activity-call") openActivityCallDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-activity-email") openActivityEmailDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-activity-task") openActivityTaskDialog(actionButton.dataset.accountId, actionButton.dataset.contactId, actionButton.dataset.opportunityId);
  if (action === "open-alert") openAlertDialog(actionButton.dataset.jobId);
  if (action === "open-material") openMaterialDialog(actionButton.dataset.jobId);
  if (action === "open-equipment") openEquipmentDialog(actionButton.dataset.jobId);
  if (action === "open-schedule") openScheduleDialog(actionButton.dataset.jobId);
  if (action === "open-remediation") openRemediationDialog();
  if (action === "open-inventory-item") openInventoryItemDialog(id);
  if (action === "open-purchase-order") openPurchaseOrderDialog(actionButton.dataset.itemId, id);
  if (action === "receive-purchase-order") await receivePurchaseOrder(id);
  if (action === "submit-purchase-order") await submitPurchaseOrder(id);
  if (action === "open-equipment-asset") openEquipmentAssetDialog(actionButton.dataset.assetTag);
  if (action === "open-equipment-status") openEquipmentStatusDialog(actionButton.dataset.assetTag);
  if (action === "clear-equipment-alert") await clearEquipmentAlert(actionButton.dataset.assetTag);
  if (action === "open-equipment-maintenance") openEquipmentMaintenanceDialog(actionButton.dataset.assetTag);
  if (action === "open-equipment-restock") openEquipmentRestockDialog(actionButton.dataset.assetTag, id);
  if (action === "view-consumable") viewConsumable(id);
  if (action === "view-equipment-asset") viewEquipmentAsset(actionButton.dataset.assetTag);
  if (action === "open-map-location") openMapLocationDialog(actionButton.dataset.id);
  if (action === "open-invoice") openInvoiceDialog(actionButton.dataset.jobId);
  if (action === "open-employee") openEmployeeDialog(id);
  if (action === "open-credential") openCredentialDialog(actionButton.dataset.employeeId);
  if (action === "open-job-request") openJobRequestDialog(actionButton.dataset.accountId, "", actionButton.dataset.projectId);
  if (action === "open-job-schedule") openDispatchScheduleDialog(actionButton.dataset.jobId);
  if (action === "export-qbo") await exportInvoiceToQbo(id);
  if (action === "view-account") viewAccount(id);
  if (action === "view-contact") viewContact(id);
  if (action === "view-opportunity") viewOpportunity(id);
  if (action === "view-project") viewProject(id);
  if (action === "view-sample") viewSample(id);
  if (action === "view-client-spill") viewClientSpill(id);
  if (action === "view-employee") viewEmployee(id);
  if (action === "view-dispatch-job") viewDispatchJob(id);
  if (action === "download-job-request-document") await downloadJobRequestDocument(id);
  if (action === "convert-job-request") openJobTemplateSelectDialog(id);
  if (action === "select-job-template") await convertJobRequest(actionButton.dataset.requestId, actionButton.dataset.templateId);
  if (action === "advance-dispatch-job") await advanceDispatchJob(id);
  if (action === "open-dispatch-assign-employee") openDispatchAssignEmployeeDialog(actionButton.dataset.jobId);
  if (action === "unassign-job-employee") await unassignJobEmployee(id);
  if (action === "open-dispatch-assign-equipment") openDispatchAssignEquipmentDialog(actionButton.dataset.jobId);
  if (action === "open-dispatch-assign-material") openDispatchAssignMaterialDialog(actionButton.dataset.jobId);
  if (action === "remove-job-resource") await removeJobResource(id);
  if (action === "open-template-editor") openTemplateEditor(id);
  if (action === "add-template-stage") addTemplateStage();
  if (action === "remove-template-stage") removeTemplateStage(Number(actionButton.dataset.stageIndex));
  if (action === "move-template-stage") moveTemplateStage(Number(actionButton.dataset.stageIndex), actionButton.dataset.direction);
  if (action === "add-template-task") addTemplateTask(Number(actionButton.dataset.stageIndex));
  if (action === "remove-template-task") removeTemplateTask(Number(actionButton.dataset.stageIndex), Number(actionButton.dataset.taskIndex));
  if (action === "save-template") await saveTemplateDraft();
  if (action === "toggle-template-active") await toggleTemplateActive(id);
  if (action === "go-to-templates") {
    closeDialogs();
    state.view = "dispatch-templates";
    render();
  }
  if (action === "back-to-project") {
    const sample = findSample(state.selectedSampleId);
    state.selectedProjectId = sample?.projectId || state.selectedProjectId;
    state.selectedSampleId = "";
    state.view = state.selectedProjectId ? "project-detail" : "ops-projects";
    render();
  }
  if (action === "back-to-client-spills") {
    state.view = "client-spills";
    state.selectedProjectId = "";
    render();
  }
  if (action === "back-to-projects") {
    state.view = "ops-projects";
    state.selectedProjectId = "";
    state.selectedSampleId = "";
    render();
  }
  if (action === "back-to-workforce") {
    state.view = "workforce-directory";
    state.selectedEmployeeId = "";
    render();
  }
  if (action === "back-to-dispatch-jobs") {
    state.view = "dispatch-jobs";
    state.selectedDispatchJobId = "";
    render();
  }
  if (action === "back-to-opportunities") {
    state.view = "pipeline";
    state.selectedOpportunityId = "";
    render();
  }
  if (action === "back-to-accounts") {
    state.view = "accounts";
    state.selectedAccountId = "";
    render();
  }
  if (action === "back-to-contacts") {
    state.view = "contacts";
    state.selectedContactId = "";
    render();
  }
  if (action === "close-dialog") closeDialogs();
  if (action === "advance-opportunity") await advanceOpportunity(id);
  if (action === "move-opportunity") await moveOpportunityToStage(id, actionButton.dataset.stage);
  if (action === "create-project-from-opportunity") {
    if (canCreateProjectFromOpportunity()) openProjectFromOpportunityDialog(id);
    else showToast("Your current role cannot create Operations projects.");
  }
  if (action === "open-project-intake") openProjectIntakeDialog(id);
  if (action === "complete-task") await completeTask(id);
  if (action === "complete-sales-task") await completeSalesTask(id);
  if (action === "remove-address") await removeAddress(id);
  if (action === "remove-sales-task") await removeSalesTask(id);
  if (action === "remove-vendor-profile") await removeVendorProfile(id, actionButton.dataset.accountId);
  if (action === "remove-account-relationship") await removeAccountRelationship(id);
  if (action === "remove-service-agreement") await removeServiceAgreement(id);
  if (action === "remove-subcontractor-assignment") await removeSubcontractorAssignment(id);
  if (action === "sync-now") await simulateSync();
  if (action === "use-demo-user") await useDemoUser();
  if (action === "set-demo-role") await setDemoRole(actionButton.dataset.profile);
  if (action === "sign-out") await signOut();
  if (action === "start-microsoft-signin") await startMicrosoftSignIn();
  if (action === "frontline-login") await frontlineLogin();
  if (action === "frontline-go-home") {
    state.view = "frontline-home";
    render();
  }
  if (action === "frontline-refresh") {
    await refreshState();
    render();
  }
  if (action === "frontline-exit") frontlineExit();
  if (action === "frontline-open-job") {
    state.frontlineSelectedJobId = id;
    state.view = "frontline-job-detail";
    render();
  }
  if (action === "frontline-jobbook-scope") {
    state.frontlineJobFilter.scope = actionButton.dataset.scope;
    render();
  }
  if (action === "frontline-toggle-action") {
    state.frontlineOpenActionId = state.frontlineOpenActionId === id ? "" : id;
    render();
  }
  if (action === "frontline-complete-status-action") await frontlineCompleteStatusAction(id);
  if (action === "frontline-clear-signature") {
    state.frontlineSignatureStrokes = [];
    initializeSignaturePad();
  }
  if (action === "frontline-capture-gps") await frontlineCaptureGps();
  if (action === "frontline-add-material-row") frontlineAddMaterialRow(actionButton);
}

// Cloning the row in place rather than re-rendering keeps everything else the crew has already
// typed into the open form.
function frontlineAddMaterialRow(button) {
  const picker = button.closest(".frontline-material-picker");
  const lastRow = picker?.querySelector(".frontline-material-row:last-of-type");
  if (!lastRow) return;
  const clone = lastRow.cloneNode(true);
  clone.querySelector("select").value = "";
  clone.querySelector('input[name="materialQuantity"]').value = "";
  lastRow.after(clone);
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;

  event.preventDefault();

  if (form.dataset.form === "opportunity") await saveOpportunity(form);
  if (form.dataset.form === "opportunity-lead") await saveOpportunityLead(form);
  if (form.dataset.form === "opportunity-qualify") await saveOpportunityQualify(form);
  if (form.dataset.form === "opportunity-develop") await saveOpportunityDevelop(form);
  if (form.dataset.form === "opportunity-stakeholder") await saveOpportunityStakeholder(form);
  if (form.dataset.form === "opportunity-competitor") await saveOpportunityCompetitor(form);
  if (form.dataset.form === "opportunity-assignment") await saveOpportunityAssignment(form);
  if (form.dataset.form === "opportunity-needs-list") await saveOpportunityNeedsList(form);
  if (form.dataset.form === "opportunity-proposal") await saveOpportunityProposal(form);
  if (form.dataset.form === "opportunity-negotiation") await saveOpportunityNegotiation(form);
  if (form.dataset.form === "opportunity-quote") await saveOpportunityQuote(form);
  if (form.dataset.form === "project-from-opportunity") await saveProjectFromOpportunity(form);
  if (form.dataset.form === "project-intake") await saveProjectIntake(form);
  if (form.dataset.form === "account") await saveAccount(form);
  if (form.dataset.form === "account-owner") await saveAccountOwner(form);
  if (form.dataset.form === "account-billing") await saveAccountBilling(form);
  if (form.dataset.form === "account-ap") await saveAccountAp(form);
  if (form.dataset.form === "contact") await saveContact(form);
  if (form.dataset.form === "contact-info") await saveContactInfo(form);
  if (form.dataset.form === "contact-comm-prefs") await saveContactCommPrefs(form);
  if (form.dataset.form === "contact-personal") await saveContactPersonal(form);
  if (form.dataset.form === "contact-role") await saveContactRole(form);
  if (form.dataset.form === "contact-address-one") await saveContactAddressOne(form);
  if (form.dataset.form === "contact-address-two") await saveContactAddressTwo(form);
  if (form.dataset.form === "address") await saveAddress(form);
  if (form.dataset.form === "account-industries") await saveAccountIndustries(form);
  if (form.dataset.form === "vendor-profile") await saveVendorProfile(form);
  if (form.dataset.form === "sales-task") await saveSalesTask(form);
  if (form.dataset.form === "company-profile") await saveCompanyProfile(form);
  if (form.dataset.form === "relationship-snapshot") await saveRelationshipSnapshot(form);
  if (form.dataset.form === "document-status") await saveDocumentStatus(form);
  if (form.dataset.form === "relationship-notes") await saveRelationshipNotes(form);
  if (form.dataset.form === "account-comment") await saveAccountComment(form);
  if (form.dataset.form === "account-division") await saveAccountDivision(form);
  if (form.dataset.form === "contact-employment") await saveContactEmployment(form);
  if (form.dataset.form === "account-pause") await saveAccountPause(form);
  if (form.dataset.form === "account-location") await saveLocation(form);
  if (form.dataset.form === "service-agreement") await saveServiceAgreement(form);
  if (form.dataset.form === "subcontractor-assignment") await saveSubcontractorAssignment(form);
  if (form.dataset.form === "contact-preferences") await saveContactPreferences(form);
  if (form.dataset.form === "alert") await saveProjectAlert(form);
  if (form.dataset.form === "material") await saveMaterialUsage(form);
  if (form.dataset.form === "equipment") await saveEquipmentLog(form);
  if (form.dataset.form === "schedule") await saveScheduleEvent(form);
  if (form.dataset.form === "dispatch-assign-employee") await saveDispatchAssignEmployee(form);
  if (form.dataset.form === "dispatch-assign-equipment") await saveDispatchAssignEquipment(form);
  if (form.dataset.form === "dispatch-assign-material") await saveDispatchAssignMaterial(form);
  if (form.dataset.form === "remediation") await saveRemediation(form);
  if (form.dataset.form === "inventory-item") await saveInventoryItem(form);
  if (form.dataset.form === "purchase-order") await savePurchaseOrder(form);
  if (form.dataset.form === "equipment-asset") await saveEquipmentAsset(form);
  if (form.dataset.form === "equipment-maintenance") await saveEquipmentMaintenanceRecord(form);
  if (form.dataset.form === "equipment-restock") await saveEquipmentRestockItem(form);
  if (form.dataset.form === "map-location") await saveMapLocation(form);
  if (form.dataset.form === "invoice") await saveInvoice(form);
  if (form.dataset.form === "employee") await saveEmployee(form);
  if (form.dataset.form === "credential") await saveEmployeeCredential(form);
  if (form.dataset.form === "job-request") await saveJobRequest(form);
  if (form.dataset.form === "dispatch-schedule") await saveDispatchSchedule(form);
  if (form.dataset.form === "activity") await saveActivity(form);
  if (form.dataset.form === "note") await saveActivity(form);
  if (form.dataset.form === "quick-note") await saveQuickNote(form);
  if (form.dataset.form === "activity-meeting") await saveActivityMeeting(form);
  if (form.dataset.form === "activity-call") await saveActivityCall(form);
  if (form.dataset.form === "activity-email") await saveActivityEmail(form);
  if (form.dataset.form === "activity-task") await saveActivityTask(form);
  if (form.dataset.form === "identity") await saveIdentityConfig(form);
  if (form.dataset.form === "settings") await savePlatformSettings(form);
  if (form.dataset.form === "frontline-complete-action") await frontlineCompleteAction(form);
}

function handleInput(event) {
  // Changing a task's type swaps which config controls belong on the card, so the editor has to
  // re-render. Scoped to the editor root so it cannot fire on any other select in the app.
  if (event.target.matches('#templateEditorRoot [data-task-type]')) {
    syncTemplateDraftFromDom();
    render();
    return;
  }

  if (event.target.id === "frontlineRegionSelect") {
    state.frontlineJobFilter.region = event.target.value;
    renderFrontlineJobBook();
  }

  if (event.target.id === "accountTimelineSearch") {
    state.accountTimelineSearch = event.target.value;
    renderAccountDetail();
  }

  if (event.target.id === "accountSearch") {
    state.accountSearch = event.target.value;
    renderAccounts();
  }

  if (event.target.id === "accountIndustryFilter") {
    state.accountIndustryFilter = event.target.value;
    renderAccounts();
  }

  if (event.target.id === "accountTableView") {
    state.accountTableView = event.target.value;
    renderAccounts();
  }

  if (event.target.id === "contactTableView") {
    state.contactTableView = event.target.value;
    renderContacts();
  }

  if (event.target.id === "opportunityTableView") {
    state.opportunityTableView = event.target.value;
    renderPipeline();
  }

  if (event.target.id === "contactSearch") {
    state.contactSearch = event.target.value;
    renderContacts();
  }

  if (event.target.id === "opportunitySearch") {
    state.opportunitySearch = event.target.value;
    renderPipeline();
  }

  if (event.target.matches("#noteDialog select[name='accountId']")) {
    syncActivityContactOptions();
  }

  if (event.target.matches("#accountLocationDialog select[name='category']")) {
    toggleLocationOtherField(event.target.value);
    const hasConcern = document.querySelector("#accountLocationDialog input[name='hasConcern']")?.checked;
    toggleLocationConcernField(event.target.value, hasConcern);
  }

  if (event.target.matches("#accountLocationDialog input[name='hasConcern']")) {
    const category = document.querySelector("#accountLocationDialog select[name='category']")?.value;
    toggleLocationConcernField(category, event.target.checked);
  }

  if (event.target.matches("#opportunityAssignmentDialog select[name='type']")) {
    toggleOpportunityAssignmentTypeFields(event.target.value);
  }

  if (event.target.matches("#opportunityAssignmentDialog select[name='vendorAccountId']")) {
    populateVendorContactSelect(document.querySelector("#opportunityAssignmentDialog"), event.target.value);
  }

  if (event.target.matches("#activityMeetingDialog select[name='meetingFormat']")) {
    toggleMeetingFormatFields(event.target.value);
  }

  if (event.target.matches("#contactDialog select[name='accountId']")) {
    populateDivisionSelect(document.querySelector("#contactDialog"), event.target.value);
  }

  if (event.target.matches('[data-action="quick-set-division"]')) {
    quickSetContactDivision(event.target.dataset.contactId, event.target.value);
  }

  if (event.target.id === "taskFilter") {
    state.taskFilter = event.target.value;
    renderFieldwork();
  }

  if (event.target.id === "operationsFilter") {
    state.operationsFilter = event.target.value;
    renderOperations();
  }

  if (event.target.id === "workforceSearch") {
    state.workforceSearch = event.target.value;
    renderWorkforceDirectory();
  }

  if (event.target.id === "dispatchJobFilter") {
    state.dispatchJobFilter = event.target.value;
    renderDispatchJobs();
  }

  if (event.target.name === "category" && event.target.closest("#equipmentAssetDialog")) {
    renderEquipmentSpecFieldGrid(event.target.value, {});
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-opportunity-id]");
  if (!card) return;

  draggedOpportunityId = card.dataset.opportunityId;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedOpportunityId);
}

function handleDragOver(event) {
  const dropTarget = event.target.closest("[data-drop-stage]");
  if (!dropTarget || !draggedOpportunityId) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  dropTarget.classList.add("drop-target");
}

function handleDragLeave(event) {
  const dropTarget = event.target.closest("[data-drop-stage]");
  if (!dropTarget || dropTarget.contains(event.relatedTarget)) return;
  dropTarget.classList.remove("drop-target");
}

async function handleDrop(event) {
  const dropTarget = event.target.closest("[data-drop-stage]");
  if (!dropTarget) return;

  event.preventDefault();
  const opportunityId = event.dataTransfer.getData("text/plain") || draggedOpportunityId;
  const stage = dropTarget.dataset.dropStage;
  clearDropState();
  await moveOpportunityToStage(opportunityId, stage);
}

function handleDragEnd() {
  clearDropState();
}

function clearDropState() {
  draggedOpportunityId = "";
  document.querySelectorAll(".dragging, .drop-target").forEach((element) => {
    element.classList.remove("dragging", "drop-target");
  });
}

function render() {
  ensureAllowedView();
  if (state.view.startsWith("frontline-") && state.view !== "frontline-login" && !state.frontlineSession) {
    state.view = "frontline-login";
  }
  if (state.view !== "ops-map") cleanupOperationsMap();
  if (!["client-dashboard", "client-spills"].includes(state.view)) cleanupClientSpillMap();
  if (!["project-detail", "sample-detail"].includes(state.view)) cleanupProjectDetailVisuals();
  if (state.view !== "frontline-job-detail") cleanupSignaturePad();
  appShell.classList.toggle("home-mode", state.view === "home");
  appShell.classList.toggle("frontline-mode", state.view.startsWith("frontline-"));
  renderConnection();
  renderNav();
  renderQuickActions();
  renderHeaderTitle();
  renderTodaySummary();

  if (state.view === "home") renderHome();
  if (state.view === "pipeline") renderPipeline();
  if (state.view === "opportunity-detail") renderOpportunityDetail();
  if (state.view === "accounts") renderAccounts();
  if (state.view === "account-detail") renderAccountDetail();
  if (state.view === "contacts") renderContacts();
  if (state.view === "contact-detail") renderContactDetail();
  if (state.view === "sales-race") renderSalesRaceTrack();
  if (state.view === "operations") renderOperations();
  if (state.view === "ops-projects") renderOperationsAllProjects();
  if (state.view === "project-detail") renderProjectDetail();
  if (state.view === "sample-detail") renderSampleDetail();
  if (state.view === "ops-scheduled") renderOperationsScheduled();
  if (state.view === "ops-emergency") renderOperationsEmergency();
  if (state.view === "ops-remediation") renderOperationsRemediation();
  if (state.view === "ops-calendar") renderOperationsCalendar();
  if (state.view === "ops-map") renderOperationsMap();
  if (state.view === "ops-race") renderOperationsRaceTrack();
  if (state.view === "dispatch-intake") renderDispatchIntake();
  if (state.view === "dispatch-jobs") renderDispatchJobs();
  if (state.view === "dispatch-board") renderDispatchBoard();
  if (state.view === "dispatch-calendar") renderDispatchCalendar();
  if (state.view === "dispatch-conflicts") renderDispatchConflicts();
  if (state.view === "dispatch-job-detail") renderDispatchJobDetail();
  if (state.view === "dispatch-templates") renderDispatchTemplates();
  if (state.view === "dispatch-template-editor") renderTemplateEditor();
  if (state.view === "workforce-directory") renderWorkforceDirectory();
  if (state.view === "workforce-credentials") renderWorkforceCredentials();
  if (state.view === "workforce-teams") renderWorkforceTeams();
  if (state.view === "workforce-availability") renderWorkforceAvailability();
  if (state.view === "workforce-schedule") renderWorkforceSchedule();
  if (state.view === "workforce-devices") renderWorkforceDevices();
  if (state.view === "employee-detail") renderEmployeeDetail();
  if (state.view === "inventory") renderInventory();
  if (state.view === "inventory-consumables") renderInventoryConsumables();
  if (state.view === "inventory-consumable-detail") renderConsumableDetail();
  if (state.view === "inventory-purchase") renderInventoryPurchaseOrders();
  if (state.view === "inventory-equipment") renderInventoryEquipment();
  if (state.view === "inventory-equipment-detail") renderEquipmentAssetDetail();
  if (state.view === "inventory-labor") renderInventoryLabor();
  if (state.view === "office") renderOfficeManager();
  if (state.view === "office-alerts") renderOfficeAlertsPage();
  if (state.view === "office-schedule") renderOfficeSchedulePage();
  if (state.view === "finance") renderFinance();
  if (state.view === "finance-invoices") renderFinanceInvoices();
  if (state.view === "finance-qbo") renderFinanceQbo();
  if (state.view === "client-dashboard") renderClientDashboard();
  if (state.view === "client-spills") renderClientSpills();
  if (state.view === "client-documents") renderClientDocuments();
  if (state.view === "client-contacts") renderClientContacts();
  if (state.view === "client-spill-detail") renderClientSpillDetail();
  if (state.view === "fieldwork") renderFieldwork();
  if (state.view === "sync") renderSync();
  if (state.view === "frontline-login") renderFrontlineLogin();
  if (state.view === "frontline-home") renderFrontlineHome();
  if (state.view === "frontline-jobbook") renderFrontlineJobBook();
  if (state.view === "frontline-job-detail") renderFrontlineJobDetail();
  if (state.view === "frontline-timesheet") renderFrontlineStub("Time Sheet");
  if (state.view === "frontline-messaging") renderFrontlineStub("Messaging");
  if (state.view === "frontline-forms") renderFrontlineStub("Forms");
  if (state.view === "frontline-trips") renderFrontlineStub("Trips");
  if (state.view === "frontline-location") renderFrontlineStub("Location");
  if (state.view === "frontline-invoices") renderFrontlineStub("Invoices");
  if (state.view === "frontline-settings") renderFrontlineStub("Settings");
  syncRouteToHistory();
  updateBackButtonState();
}

const ROUTE_ID_FIELDS = [
  "selectedAccountId",
  "selectedContactId",
  "selectedOpportunityId",
  "selectedProjectId",
  "selectedSampleId",
  "selectedEmployeeId",
  "selectedDispatchJobId",
  "selectedConsumableId",
  "selectedEquipmentAssetTag",
  "selectedTemplateId",
  "accountDetailTab",
  "contactDetailTab",
  "frontlineSelectedJobId",
];

function computeRouteHash() {
  const params = new URLSearchParams();
  params.set("view", state.view);
  for (const field of ROUTE_ID_FIELDS) {
    if (state[field]) params.set(field, state[field]);
  }
  return `#${params.toString()}`;
}

function applyRouteFromHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const view = params.get("view");
  if (!view) return false;
  state.view = view;
  for (const field of ROUTE_ID_FIELDS) {
    state[field] = params.get(field) || "";
  }
  return true;
}

function syncRouteToHistory() {
  const hash = computeRouteHash();
  if (location.hash !== hash) {
    history.pushState(null, "", hash);
  }
}

function updateBackButtonState() {
  const backButton = document.querySelector('[data-action="nav-back"]');
  if (backButton) backButton.disabled = state.view === "home";
}

function handlePopState() {
  if (applyRouteFromHash()) {
    render();
  } else {
    state.view = "home";
    render();
  }
}

function renderConnection() {
  connectionStatus.textContent = state.online ? "Online" : "Offline";
  connectionStatus.classList.toggle("offline", !state.online);
}

function renderNav() {
  if (state.view === "home") {
    sideNav.innerHTML = "";
    return;
  }
  const activeWorkspace = getCurrentWorkspaceId();
  const modules = workspaceModules[activeWorkspace] || [];
  sideNav.innerHTML = modules
    .map(
      (module) => `
        <button type="button" class="nav-item ${isActiveModule(module.view) ? "active" : ""}" data-view="${module.view}">
          <span>${escapeHtml(module.label)}</span>
          <small>${escapeHtml(findWorkspace(activeWorkspace)?.label || "App")}</small>
        </button>
      `,
    )
    .join("");
}

function renderQuickActions() {
  if (state.view === "home") {
    quickActions.innerHTML = "";
    return;
  }
  const actions = [];
  const activeWorkspace = getCurrentWorkspaceId();
  if (activeWorkspace === "dispatch") {
    actions.push(`<button class="primary-button" type="button" data-action="open-job-request">New job request</button>`);
  } else if (activeWorkspace === "workforce") {
    actions.push(`<button class="primary-button" type="button" data-action="open-employee">Add employee</button>`);
  } else if (activeWorkspace === "sales" && canAccessView("pipeline")) {
    actions.push(`
      <details class="create-menu">
        <summary class="primary-button">+ Create</summary>
        <div class="create-menu-list">
          <button type="button" data-action="open-account">Account</button>
          <button type="button" data-action="open-contact">Contact</button>
          <button type="button" data-action="open-opportunity">Opportunity</button>
          <button type="button" data-action="open-note">Activity</button>
        </div>
      </details>
    `);
  }
  if (activeWorkspace === "operations" && canAccessWorkspace("operations")) {
    actions.push(`<button class="danger-button" type="button" data-action="open-alert">Field alert</button>`);
  }
  if (activeWorkspace === "inventory" && canAccessWorkspace("inventory")) {
    actions.push(`<button class="secondary-button" type="button" data-action="open-material">Log material</button>`);
  }
  quickActions.innerHTML = actions.join("");
}

function renderHeaderTitle() {
  const titleEl = document.querySelector("#appHeaderTitle");
  if (!titleEl) return;
  if (state.view === "home") {
    titleEl.textContent = "Operations Platform";
    return;
  }
  const workspaceLabel = findWorkspace(getCurrentWorkspaceId())?.label || "Operations Platform";
  titleEl.textContent = workspaceLabel.replace(/ View$/, "");
}

function renderTodaySummary() {
  const openTasks = state.tasks.filter((task) => task.status !== "Complete").length;
  const activeAlerts = state.projectAlerts.filter((alert) => alert.status !== "Resolved").length;
  const pending = pendingQueue().length;
  roleSummary.textContent = state.currentUser?.role || "No role";
  todaySummary.textContent = `${openTasks} open tasks, ${activeAlerts} active alerts, ${pending} edits waiting to sync`;
}

function findWorkspace(workspaceId) {
  return workspaces.find((workspace) => workspace.id === workspaceId);
}

function getCurrentWorkspaceId() {
  if (state.view === "home") return "home";
  return viewWorkspace[state.view] || "sales";
}

function canAccessWorkspace(workspaceId) {
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return false;
  const role = state.currentUser?.role || "";
  return role === "Admin" || workspace.roles.includes(role);
}

function canAccessView(view) {
  if (view === "home") return true;
  const workspaceId = viewWorkspace[view];
  return workspaceId ? canAccessWorkspace(workspaceId) : false;
}

// Sales/Account Manager can trigger project creation from a Won opportunity without
// gaining the broader Operations workspace (which owns project-detail generally).
function canCreateProjectFromOpportunity() {
  const role = state.currentUser?.role || "";
  return canAccessView("project-detail") || ["Sales Manager", "Account Manager"].includes(role);
}

function ensureAllowedView() {
  if (canAccessView(state.view)) return;
  state.selectedAccountId = "";
  state.selectedContactId = "";
  state.selectedProjectId = "";
  state.selectedSampleId = "";
  state.selectedEmployeeId = "";
  state.selectedDispatchJobId = "";
  state.view = getDefaultAllowedView();
}

function getDefaultAllowedView() {
  return "home";
}

function isActiveModule(moduleView) {
  if (moduleView === state.view) return true;
  if (moduleView === "pipeline" && state.view === "opportunity-detail") return true;
  if (moduleView === "accounts" && state.view === "account-detail") return true;
  if (moduleView === "contacts" && state.view === "contact-detail") return true;
  if (moduleView === "ops-projects" && ["project-detail", "sample-detail"].includes(state.view)) return true;
  if (moduleView === "dispatch-jobs" && state.view === "dispatch-job-detail") return true;
  if (moduleView === "workforce-directory" && state.view === "employee-detail") return true;
  if (moduleView === "client-spills" && state.view === "client-spill-detail") return true;
  if (moduleView === "inventory-consumables" && state.view === "inventory-consumable-detail") return true;
  if (moduleView === "inventory-equipment" && state.view === "inventory-equipment-detail") return true;
  return false;
}

function getWorkspaceAccessLabel(workspaceId) {
  const modules = workspaceModules[workspaceId];
  if (modules?.length) return `${modules.length} panels`;
  if (workspaceId === "inventory") return "Assets";
  if (workspaceId === "office") return "All alerts";
  if (workspaceId === "finance") return "Revenue";
  return "Settings";
}

function renderHome() {
  const launchers = workspaces.filter((workspace) => !["sync", "frontline"].includes(workspace.id) && canAccessWorkspace(workspace.id));
  const syncWorkspace = workspaces.find((workspace) => workspace.id === "sync");
  const frontlineWorkspace = workspaces.find((workspace) => workspace.id === "frontline");

  app.innerHTML = `
    <section class="home-view">
      <div class="home-copy">
        <p class="eyebrow">BioRemedy Home</p>
        <h2>Where biology becomes the remedy</h2>
        <p>Choose the app for the work in front of you: sales, dispatch, workforce, field operations, inventory, office management, or finance.</p>
      </div>
      <section class="app-orbit" aria-label="Application launcher">
        <div class="orbit-center">
          <img class="orbit-logo logo-primary" src="./public/brand/bioremedy-logo-primary.png" alt="BioRemedy" />
          <img class="orbit-logo logo-reversed" src="./public/brand/bioremedy-logo-primary-reversed.png" alt="BioRemedy" />
          <strong>Operations Platform</strong>
          <small class="orbit-tagline">Industrial response and remediation</small>
          <small class="orbit-role">${escapeHtml(state.currentUser?.role || "No role")}</small>
        </div>
        ${launchers.map((workspace, index) => renderHomeLauncher(workspace, index, launchers.length)).join("")}
      </section>
      <section class="home-utility">
        <div class="home-status-card">
          <p class="eyebrow">Today</p>
          <strong>${state.tasks.filter((task) => task.status !== "Complete").length} open tasks</strong>
          <span>${state.projectAlerts.filter((alert) => alert.status !== "Resolved").length} active alerts</span>
        </div>
        ${
          syncWorkspace && canAccessWorkspace("sync")
            ? `<button class="home-utility-button" type="button" data-workspace="sync">Identity & Sync</button>`
            : ""
        }
        ${
          frontlineWorkspace && canAccessWorkspace("frontline")
            ? `<button class="home-utility-button" type="button" data-workspace="frontline">Front Line</button>`
            : ""
        }
      </section>
    </section>
  `;
}

function renderHomeLauncher(workspace, index, total) {
  const angle = -90 + (360 / Math.max(total, 1)) * index;
  const metrics = getHomeLauncherMetrics(workspace.id);
  return `
    <button
      class="app-launch-card ${workspace.id}"
      type="button"
      data-workspace="${workspace.id}"
      style="--angle: ${angle}deg;"
    >
      <span class="app-launch-icon">${escapeHtml(getWorkspaceInitials(workspace.label))}</span>
      <strong>${escapeHtml(workspace.label)}</strong>
      <small>${escapeHtml(metrics)}</small>
    </button>
  `;
}

function getWorkspaceInitials(label) {
  return label
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getHomeLauncherMetrics(workspaceId) {
  if (workspaceId === "sales") return `${state.opportunities.length} opportunities`;
  if (workspaceId === "operations") return `${state.projects.filter((job) => job.status !== "Complete").length} active jobs`;
  if (workspaceId === "dispatch") return `${getDispatchJobs().filter((job) => !isTerminalDispatchStatus(job.status)).length} open jobs`;
  if (workspaceId === "workforce") return `${getEmployees().filter((employee) => employee.employmentStatus === "Active").length} active employees`;
  if (workspaceId === "inventory") return `${getConsumableStatus().filter((item) => item.status !== "Healthy").length} stock alerts`;
  if (workspaceId === "office") return `${getOfficeAlerts().length} cross-team alerts`;
  if (workspaceId === "finance") return `${money(getFinanceSummary().pastDue)} past due`;
  if (workspaceId === "client") return `${getClientVisibleJobs().length} active spills`;
  return getWorkspaceAccessLabel(workspaceId);
}

function renderWorkspaceHeader(workspaceId, title, description, actions = "") {
  const workspace = findWorkspace(workspaceId);
  return `
    <section class="workspace-header">
      <div>
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <button type="button" class="breadcrumb-link" data-action="go-home">Home</button>
          <span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-current">${escapeHtml(workspace?.label || "Workspace")}</span>
        </nav>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      ${actions ? `<div class="toolbar">${actions}</div>` : ""}
    </section>
  `;
}

function renderModuleTabs(workspaceId) {
  const modules = workspaceModules[workspaceId] || [];
  if (!modules.length) return "";
  return `
    <div class="segment-tabs" role="tablist" aria-label="${escapeAttribute(findWorkspace(workspaceId)?.label || "Workspace")} panels">
      ${modules
        .map(
          (module) => `
            <button type="button" class="${module.view === state.view ? "active" : ""}" data-view="${module.view}">
              ${escapeHtml(module.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderMetrics() {
  const activePipeline = state.opportunities
    .filter((opportunity) => opportunity.stage !== "Won")
    .reduce((total, opportunity) => total + Number(opportunity.value), 0);
  const highRiskSites = state.accounts.filter((account) => account.risk === "High").length;
  const proposalCount = state.opportunities.filter((opportunity) => opportunity.stage === "Proposal").length;
  const pending = pendingQueue().length;

  return `
    <section class="metric-strip" aria-label="CRM metrics">
      <div class="metric">
        <p class="eyebrow">Active pipeline</p>
        <strong>${money(activePipeline)}</strong>
        <span>Open remediation opportunities</span>
      </div>
      <div class="metric">
        <p class="eyebrow">High-risk sites</p>
        <strong>${highRiskSites}</strong>
        <span>Need closer follow-up</span>
      </div>
      <div class="metric">
        <p class="eyebrow">In proposal</p>
        <strong>${proposalCount}</strong>
        <span>Scopes waiting on buyer action</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Offline queue</p>
        <strong>${pending}</strong>
        <span>Local edits not pushed to server</span>
      </div>
    </section>
  `;
}

function renderPipelineInsights() {
  const openOpportunities = getScopedOpportunities().filter((opportunity) => opportunity.stage !== "Won");
  const weightedPipeline = openOpportunities.reduce(
    (total, opportunity) => total + Number(opportunity.value) * ((opportunity.probability ?? STAGE_PROBABILITY[opportunity.stage] ?? 0) / 100),
    0,
  );
  const attentionItems = openOpportunities
    .map((opportunity) => ({
      opportunity,
      account: findAccount(opportunity.accountId),
      closeStatus: getCloseStatus(opportunity.closeDate),
      nextTask: nextOpenTaskForAccount(opportunity.accountId),
    }))
    .sort((a, b) => opportunityPriorityScore(b) - opportunityPriorityScore(a))
    .slice(0, 3);
  const wonValue = getScopedOpportunities()
    .filter((opportunity) => opportunity.stage === "Won")
    .reduce((total, opportunity) => total + Number(opportunity.value), 0);

  return `
    <section class="board-insights" aria-label="Pipeline focus">
      <article class="panel">
        <div class="panel-header"><h3>Forecast</h3></div>
        <div class="panel-body forecast-grid">
          <div>
            <p class="eyebrow">Weighted open value</p>
            <strong>${money(weightedPipeline)}</strong>
          </div>
          <div>
            <p class="eyebrow">Awarded value</p>
            <strong>${money(wonValue)}</strong>
          </div>
          <div>
            <p class="eyebrow">Open deals</p>
            <strong>${openOpportunities.length}</strong>
          </div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Needs attention</h3></div>
        <div class="panel-body attention-list">
          ${attentionItems.map(renderPipelineAttentionItem).join("") || `<div class="empty-state">No active opportunities yet.</div>`}
        </div>
      </article>
    </section>
  `;
}

function renderPipelineAttentionItem(item) {
  const { opportunity, account, closeStatus, nextTask } = item;
  return `
    <article class="attention-item">
      <div>
        <button class="link-button" type="button" data-action="view-account" data-id="${opportunity.accountId}">
          ${escapeHtml(opportunity.name)}
        </button>
        <div class="row-meta">
          <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
          <span>${money(opportunity.value)}</span>
          <span>${escapeHtml(opportunity.stage)}</span>
        </div>
      </div>
      <div class="inline-actions">
        <span class="risk-badge ${closeStatus.tone}">${escapeHtml(closeStatus.label)}</span>
        ${nextTask ? `<span class="tag">${escapeHtml(nextTask.title)}</span>` : `<span class="tag">No open task</span>`}
      </div>
    </article>
  `;
}

function getScopedOpportunities() {
  const scoped = state.pipelineAccountFilter
    ? state.opportunities.filter((opportunity) => opportunity.accountId === state.pipelineAccountFilter)
    : state.opportunities;
  const search = state.opportunitySearch.trim().toLowerCase();
  if (!search) return scoped;
  return scoped.filter((opportunity) => {
    const account = findAccount(opportunity.accountId);
    return [opportunity.name, opportunity.serviceType, opportunity.nextStep, account?.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
}

function renderPipeline() {
  const activeView = opportunityTableViews[state.opportunityTableView] || opportunityTableViews.board;
  const filterAccount = state.pipelineAccountFilter ? findAccount(state.pipelineAccountFilter) : null;
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "sales",
        "Opportunities",
        "Opportunity views built from one shared Opportunity table. The board stays focused on active pipeline movement.",
      )}
      ${
        filterAccount
          ? `
            <section class="core-table-notice" aria-label="Account filter">
              <div>
                <strong>Filtered to ${escapeHtml(filterAccount.name)}</strong>
                <span>Showing only opportunities linked to this account.</span>
              </div>
              <div class="inline-actions">
                <button class="mini-button" type="button" data-action="clear-pipeline-filter">Clear filter</button>
              </div>
            </section>
          `
          : ""
      }
      ${renderMetrics()}
      ${renderPipelineInsights()}
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(activeView.label)}</h3>
          <span>${escapeHtml(activeView.description)}</span>
        </div>
        <div class="list-toolbar">
          ${renderCompactSearch("opportunitySearch", "Search opportunities or accounts", state.opportunitySearch)}
          <button class="secondary-button" type="button" data-action="open-note">Add activity</button>
          <button class="primary-button" type="button" data-action="open-opportunity">New opportunity</button>
          ${renderCompactSelect(
            "opportunityTableView",
            VIEW_ICON_SVG,
            "Opportunity view",
            Object.entries(opportunityTableViews)
              .map(
                ([viewId, view]) =>
                  `<option value="${escapeAttribute(viewId)}" ${viewId === state.opportunityTableView ? "selected" : ""}>${escapeHtml(view.label)}</option>`,
              )
              .join(""),
          )}
        </div>
      </div>
      ${state.opportunityTableView !== "board" ? renderOpportunityTable(activeView) : ""}
      <section class="pipeline-board" aria-label="Pipeline stages">
        ${STAGES.map(renderStageColumn).join("")}
      </section>
    </section>
  `;
}

function renderOpportunityTable(view) {
  return `
    <section class="panel">
      <div class="panel-body">
        <table class="data-table">
          <thead>
            <tr>
              ${view.columns.map((columnKey) => `<th>${escapeHtml(getOpportunityColumnLabel(columnKey))}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              getScopedOpportunities().map((opportunity) => renderOpportunityTableRow(opportunity, view)).join("") ||
              `<tr><td colspan="${view.columns.length + 1}"><div class="empty-state">No opportunities yet.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOpportunityTableRow(opportunity, view) {
  return `
    <tr>
      ${view.columns.map((columnKey) => renderOpportunityTableCell(opportunity, columnKey)).join("")}
      <td data-label="Actions">
        <button class="mini-button" type="button" data-action="view-opportunity" data-id="${opportunity.id}">Open</button>
      </td>
    </tr>
  `;
}

function renderOpportunityTableCell(opportunity, columnKey) {
  return `<td data-label="${escapeAttribute(getOpportunityColumnLabel(columnKey))}">${renderOpportunityColumnValue(opportunity, columnKey)}</td>`;
}

function getOpportunityColumnLabel(columnKey) {
  return opportunityFieldLookup.get(columnKey)?.label || sentenceCase(columnKey);
}

function renderOpportunityColumnValue(opportunity, columnKey) {
  if (columnKey === "opportunityName") {
    return `
      <button class="link-button account-name" type="button" data-action="view-opportunity" data-id="${opportunity.id}">
        ${escapeHtml(getOpportunityFieldValue(opportunity, "opportunityName"))}
      </button>
      <div class="row-meta">
        <span>${escapeHtml(getOpportunityFieldValue(opportunity, "serviceType"))}</span>
        <span>${escapeHtml(getOpportunityFieldValue(opportunity, "dealType"))}</span>
      </div>
    `;
  }

  if (columnKey === "accountName") {
    const account = findAccount(opportunity.accountId);
    return account
      ? `<button class="link-button" type="button" data-action="view-account" data-id="${account.id}">${escapeHtml(account.name)}</button>`
      : escapeHtml(getOpportunityFieldValue(opportunity, "accountName") || "Unknown account");
  }

  if (columnKey === "dealStage" || columnKey === "forecastCategory" || columnKey === "initialCommunication") {
    return escapeHtml(formatOpportunityFieldValue(opportunity, columnKey));
  }

  return escapeHtml(formatOpportunityFieldValue(opportunity, columnKey));
}

function renderStageColumn(stage) {
  const opportunities = getScopedOpportunities().filter((opportunity) => opportunity.stage === stage);
  const total = opportunities.reduce((sum, opportunity) => sum + Number(opportunity.value), 0);
  const weighted = opportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.value) * ((opportunity.probability ?? STAGE_PROBABILITY[stage] ?? 0) / 100),
    0,
  );

  return `
    <article class="stage-column" data-drop-stage="${escapeAttribute(stage)}">
      <div class="stage-title">
        <div>
          <strong>${escapeHtml(stage)}</strong>
          <p>${escapeHtml(STAGE_DESCRIPTIONS[stage])}</p>
        </div>
        <span class="stage-total">${money(total)}</span>
      </div>
      <div class="stage-summary">
        <span>${opportunities.length} deals</span>
        <span>${money(weighted)} weighted</span>
      </div>
      <div class="opportunity-list">
        ${
          opportunities.length
            ? opportunities.map(renderOpportunityCard).join("")
            : `<div class="empty-state">No opportunities here yet.</div>`
        }
      </div>
    </article>
  `;
}

function renderOpportunityCard(opportunity) {
  const account = findAccount(opportunity.accountId);
  const probability = opportunity.probability ?? STAGE_PROBABILITY[opportunity.stage] ?? 15;
  const closeStatus = getCloseStatus(opportunity.closeDate);
  const contacts = contactsForOpportunity(opportunity.id);
  const nextTask = nextOpenTaskForAccount(opportunity.accountId);
  const currentStageIndex = STAGES.indexOf(opportunity.stage);
  const previousStage = STAGES[currentStageIndex - 1];
  const nextStage = STAGES[currentStageIndex + 1];

  return `
    <article class="opportunity-card" draggable="true" data-opportunity-id="${escapeAttribute(opportunity.id)}">
      <div>
        <strong>${escapeHtml(opportunity.name)}</strong>
        <div class="card-meta">
          ${
            account
              ? `<button class="link-button compact-link" type="button" data-action="view-account" data-id="${account.id}">${escapeHtml(account.name)}</button>`
              : `<span>Unknown account</span>`
          }
          <span>${money(opportunity.value)}</span>
        </div>
      </div>
      <div class="progress-track" aria-label="${probability}% probability">
        <span style="width: ${probability}%"></span>
      </div>
      <div class="card-meta">
        <span>${escapeHtml(opportunity.serviceType)}</span>
        <span class="risk-badge ${closeStatus.tone}">${escapeHtml(closeStatus.label)}</span>
        <span>${probability}% probability</span>
      </div>
      <p class="help-text">${escapeHtml(opportunity.nextStep)}</p>
      <div class="crm-card-context">
        <span>${contacts.length} linked contacts</span>
        <span>${nextTask ? `Next task ${formatDate(nextTask.dueDate)}` : "No open task"}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-opportunity" data-id="${opportunity.id}">Open</button>
        <button class="mini-button" type="button" data-action="open-note" data-account-id="${opportunity.accountId}" data-opportunity-id="${opportunity.id}">Activity</button>
        ${
          previousStage
            ? `<button class="mini-button" type="button" data-action="move-opportunity" data-id="${opportunity.id}" data-stage="${escapeAttribute(previousStage)}">Back</button>`
            : ""
        }
        ${
          nextStage
            ? `<button class="mini-button" type="button" data-action="advance-opportunity" data-id="${opportunity.id}">Advance</button>`
            : `<span class="tag">Awarded</span>`
        }
      </div>
    </article>
  `;
}

const opportunityDetailTabs = [
  { id: "summary", label: "Summary" },
  { id: "lead-qualification", label: "Lead & Qualification" },
  { id: "develop-planning", label: "Develop & Planning" },
  { id: "proposal-documents", label: "Proposal & Documents" },
  { id: "files-activity", label: "Files & Activity" },
];

function renderOpportunityDetail() {
  const opportunity = findOpportunity(state.selectedOpportunityId);
  if (!opportunity) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Opportunity not found</h2>
        <button class="secondary-button" type="button" data-action="back-to-opportunities">Back to opportunities</button>
      </section>
    `;
    return;
  }

  const activeTab = state.opportunityDetailTab || "summary";
  const progress = getOpportunityProgress(opportunity);

  app.innerHTML = `
    <section class="view">
      <div class="account-detail-shell">
        ${renderOpportunityDetailHeader(opportunity)}
        <section class="project-progress-panel">
          <div class="race-progress ${progress.tone}" aria-label="${progress.percent}% probability">
            <span style="width: ${progress.percent}%"></span>
          </div>
          <div class="stage-ladder">
            ${STAGES.map((stage, index) => `<span class="${progress.stageIndex >= index ? "done" : ""}">${stage}</span>`).join("")}
          </div>
        </section>
        <div class="account-detail-tabs-row">
          ${renderOpportunityDetailTabs(activeTab)}
        </div>
        <div class="account-detail-tabbody">
          ${renderOpportunityTabBody(activeTab, opportunity)}
        </div>
      </div>
    </section>
  `;
}

function renderOpportunityDetailHeader(opportunity) {
  const coreOpportunity = getCoreOpportunity(opportunity);
  const account = findAccount(opportunity.accountId);
  const closeStatus = getCloseStatus(coreOpportunity.estimatedCloseDate);
  const currentStageIndex = STAGES.indexOf(opportunity.stage);
  const nextStage = STAGES[currentStageIndex + 1];
  return `
    <div class="account-hero">
      <div>
        <button class="text-button" type="button" data-action="back-to-opportunities">Back to opportunities</button>
        <p class="eyebrow">Opportunity profile</p>
        <h2>${escapeHtml(coreOpportunity.opportunityName)}</h2>
        <p>${escapeHtml(coreOpportunity.customerNeed || coreOpportunity.serviceType || "Sales opportunity")} for ${escapeHtml(coreOpportunity.accountName || "unknown account")}.</p>
        <div class="inline-actions">
          <span class="stage-badge">${escapeHtml(coreOpportunity.dealStage)}</span>
          <span class="risk-badge ${closeStatus.tone}">${escapeHtml(closeStatus.label)}</span>
          <span class="tag">${escapeHtml(coreOpportunity.forecastCategory)}</span>
        </div>
      </div>
      <div class="toolbar">
        ${account ? `<button class="secondary-button" type="button" data-action="view-account" data-id="${account.id}">Open account</button>` : ""}
        <button class="secondary-button" type="button" data-action="open-note" data-account-id="${opportunity.accountId}" data-opportunity-id="${opportunity.id}">Add activity</button>
        <button class="secondary-button" type="button" data-action="open-opportunity" data-id="${opportunity.id}" data-account-id="${opportunity.accountId}">Edit opportunity</button>
        ${
          nextStage
            ? `<button class="primary-button" type="button" data-action="advance-opportunity" data-id="${opportunity.id}">Advance</button>`
            : `<span class="tag">Awarded</span>`
        }
      </div>
    </div>
  `;
}

function renderOpportunityDetailTabs(activeTab) {
  return `
    <div class="segment-tabs" role="tablist" aria-label="Opportunity detail sections">
      ${opportunityDetailTabs
        .map(
          (tab) => `
            <button type="button" role="tab" aria-selected="${tab.id === activeTab}" class="${tab.id === activeTab ? "active" : ""}" data-action="switch-opportunity-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOpportunityTabBody(tab, opportunity) {
  switch (tab) {
    case "lead-qualification":
      return renderOpportunityLeadQualificationTab(opportunity);
    case "develop-planning":
      return renderOpportunityDevelopPlanningTab(opportunity);
    case "proposal-documents":
      return renderOpportunityProposalDocumentsTab(opportunity);
    case "files-activity":
      return renderOpportunityFilesActivityTab(opportunity);
    case "summary":
    default:
      return renderOpportunitySummaryTab(opportunity);
  }
}

function renderOpportunityStageBlockBanner(opportunity) {
  const missingFields = getMissingFieldsThroughStage(opportunity, opportunity.stage);
  if (!missingFields.length) return "";
  return `
    <div class="empty-state warning" data-stage-block-banner>
      This opportunity is missing information expected by the ${escapeHtml(opportunity.stage)} stage: ${escapeHtml(describeMissingFields(missingFields))}.
    </div>
  `;
}

function renderOpportunityWonProjectPrompt(opportunity) {
  if (opportunity.stage !== "Won") return "";
  const hasProject = state.projects.some((job) => job.opportunityId === opportunity.id);
  if (hasProject) return "";
  return `
    <div class="empty-state warning">
      This opportunity is Won but has no project yet.
      <button class="mini-button" type="button" data-action="create-project-from-opportunity" data-id="${opportunity.id}">Create project</button>
    </div>
  `;
}

function renderOpportunitySummaryTab(opportunity) {
  const coreOpportunity = getCoreOpportunity(opportunity);
  const contacts = contactsForOpportunity(opportunity.id);
  const tasks = openTasksForAccount(opportunity.accountId);
  const activities = activitiesForOpportunity(opportunity.id);
  const team = assignmentsForOpportunity(opportunity.id);

  return `
    <section class="detail-stack">
      ${renderOpportunityStageBlockBanner(opportunity)}
      ${renderOpportunityWonProjectPrompt(opportunity)}

      <section class="metric-strip" aria-label="Opportunity metrics">
        <div class="metric">
          <p class="eyebrow">Amount</p>
          <strong>${money(coreOpportunity.amount)}</strong>
          <span>${escapeHtml(coreOpportunity.currency)}</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Weighted</p>
          <strong>${money(coreOpportunity.weightedAmount)}</strong>
          <span>${coreOpportunity.closeProbability}% probability</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Close date</p>
          <strong>${formatDate(coreOpportunity.estimatedCloseDate)}</strong>
          <span>${escapeHtml(coreOpportunity.forecastCategory)}</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Contacts</p>
          <strong>${contacts.length}</strong>
          <span>${tasks.length} open account tasks</span>
        </div>
      </section>

      <section class="crm-profile-grid">
        ${renderOpportunityMainInformation(opportunity)}

        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header">
              <h3>Timeline</h3>
              ${renderActivityPicker(opportunity.accountId, "", opportunity.id)}
            </div>
            <div class="panel-body record-list">
              ${activities.map(renderTimelineItem).join("") || `<div class="empty-state">No activities for this opportunity yet.</div>`}
            </div>
          </article>
        </div>

        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header"><h3>Associated contacts</h3></div>
            <div class="panel-body people-list">
              ${contacts.map(renderMiniContact).join("") || `<div class="empty-state">No contacts linked to this opportunity.</div>`}
            </div>
          </article>
          <article class="panel">
            <div class="panel-header"><h3>Open tasks</h3></div>
            <div class="panel-body task-list">
              ${tasks.slice(0, 4).map(renderTaskRow).join("") || `<div class="empty-state">No open tasks for this opportunity account.</div>`}
            </div>
          </article>
          <article class="panel">
            <div class="panel-header">
              <h3>Team</h3>
              <button class="mini-button" type="button" data-action="open-opportunity-assignment" data-opportunity-id="${opportunity.id}" data-purpose="Sales">Add</button>
            </div>
            <div class="panel-body">
              ${team.map(renderOpportunityAssignmentRow).join("") || `<div class="empty-state">No team members assigned yet.</div>`}
            </div>
          </article>
        </div>
      </section>
    </section>
  `;
}

function renderOpportunityLeadQualificationTab(opportunity) {
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header">
          <h3>Lead details</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-lead" data-id="${opportunity.id}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            <div><dt>Contact</dt><dd>${escapeHtml(contactsForOpportunity(opportunity.id)[0]?.name || "Not linked")}</dd></div>
            <div><dt>Facility</dt><dd>${escapeHtml(findLocation(opportunity.locationId)?.name || "Not captured")}</dd></div>
            <div><dt>Industry</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "industry") || "Not captured")}</dd></div>
            <div><dt>Contamination</dt><dd>${escapeHtml(opportunity.contaminationNotes || "Not captured")}</dd></div>
            <div><dt>Originating lead</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "originatingLeadId") || "Not captured")}</dd></div>
            <div><dt>Source campaign</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "sourceCampaign") || "Not captured")}</dd></div>
            <div><dt>Description</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "description") || "Not captured")}</dd></div>
            <div><dt>Current situation</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "currentSituation") || "Not captured")}</dd></div>
          </dl>
        </div>
      </article>
      <article class="panel">
        <div class="panel-header">
          <h3>Qualification</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-qualify" data-id="${opportunity.id}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            <div><dt>Purchase time frame</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "purchaseTimeframe") || "Not captured")}</dd></div>
            <div><dt>Estimated budget</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "budgetAmount") || "Not captured")}</dd></div>
            <div><dt>Purchase process</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "purchaseProcess") || "Not captured")}</dd></div>
            <div><dt>Decision maker found</dt><dd>${escapeHtml(opportunity.decisionMakerFound || "Not complete")}</dd></div>
            <div><dt>Capture summary</dt><dd>${escapeHtml(opportunity.captureSummary || "Not captured")}</dd></div>
          </dl>
        </div>
      </article>
    </section>
  `;
}

function renderOpportunityNeedsChips(items) {
  return (items || [])
    .map((item) => `<span class="tag">${escapeHtml(item.name)}${item.note ? ` &mdash; ${escapeHtml(item.note)}` : ""}</span>`)
    .join("");
}

function renderOpportunityAssignmentRow(entry) {
  return `
    <article class="detail-card">
      <div class="row-meta">
        <div>
          <strong>${escapeHtml(entry.name)}</strong>
          <span>${escapeHtml(entry.type)}${entry.assignedRole ? ` &middot; ${escapeHtml(entry.assignedRole)}` : ""}</span>
        </div>
        <div class="inline-actions">
          <span class="tag">${escapeHtml(entry.purpose)}</span>
          <span class="tag">${escapeHtml(entry.status || "Invited")}</span>
          <button class="mini-button" type="button" data-action="open-opportunity-assignment" data-opportunity-id="${entry.opportunityId}" data-purpose="${entry.purpose}" data-id="${entry.id}">Edit</button>
          <button class="mini-button" type="button" data-action="remove-opportunity-assignment" data-id="${entry.id}">Remove</button>
        </div>
      </div>
    </article>
  `;
}

function renderOpportunityDevelopPlanningTab(opportunity) {
  const stakeholders = stakeholdersForOpportunity(opportunity.id);
  const competitors = competitorsForOpportunity(opportunity.id);

  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header">
          <h3>Develop details</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-develop" data-id="${opportunity.id}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            <div><dt>Customer need</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "customerNeed") || "Not captured")}</dd></div>
            <div><dt>Proposed solution</dt><dd>${escapeHtml(formatOpportunityFieldValue(opportunity, "proposedSolution") || "Not captured")}</dd></div>
            <div><dt>Site walk</dt><dd>${escapeHtml(opportunity.siteWalkStatus || "Incomplete")}</dd></div>
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <h3>Stakeholders</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-stakeholder" data-opportunity-id="${opportunity.id}">Add</button>
        </div>
        <div class="panel-body people-list">
          ${
            stakeholders
              .map((entry) => {
                const contact = findContact(entry.contactId);
                return `
                  <article class="detail-card">
                    <div class="row-meta">
                      <div>
                        <strong>${escapeHtml(contact?.name || "Unknown contact")}</strong>
                        <span>${escapeHtml(entry.relationshipRole || "")}${entry.influenceLevel ? ` &middot; ${escapeHtml(entry.influenceLevel)}` : ""}</span>
                      </div>
                      <div class="inline-actions">
                        ${entry.isPrimary ? `<span class="tag">Primary</span>` : ""}
                        <button class="mini-button" type="button" data-action="open-opportunity-stakeholder" data-opportunity-id="${opportunity.id}" data-id="${entry.id}">Edit</button>
                        <button class="mini-button" type="button" data-action="remove-opportunity-stakeholder" data-id="${entry.id}">Remove</button>
                      </div>
                    </div>
                  </article>
                `;
              })
              .join("") || `<div class="empty-state">No stakeholders identified yet.</div>`
          }
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <h3>Competitors</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-competitor" data-opportunity-id="${opportunity.id}">Add</button>
        </div>
        <div class="panel-body">
          ${
            competitors
              .map(
                (entry) => `
                  <article class="detail-card">
                    <div class="row-meta">
                      <div>
                        <strong>${escapeHtml(findCompetitor(entry.competitorId)?.name || "Unknown competitor")}</strong>
                        <span>${escapeHtml(entry.name || "")}</span>
                      </div>
                      <div class="inline-actions">
                        <button class="mini-button" type="button" data-action="open-opportunity-competitor" data-opportunity-id="${opportunity.id}" data-id="${entry.id}">Edit</button>
                        <button class="mini-button" type="button" data-action="remove-opportunity-competitor" data-id="${entry.id}">Remove</button>
                      </div>
                    </div>
                  </article>
                `,
              )
              .join("") || `<div class="empty-state">No competitors identified yet.</div>`
          }
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Resource needs</h3></div>
        <div class="panel-body">
          <div class="detail-stack">
            <div>
              <div class="row-meta">
                <strong>Equipment needed</strong>
                <button class="mini-button" type="button" data-action="open-opportunity-needs-list" data-opportunity-id="${opportunity.id}" data-kind="equipment">Edit</button>
              </div>
              <div class="chip-list">${renderOpportunityNeedsChips(opportunity.equipmentNeeds) || `<span class="tag">Nothing listed</span>`}</div>
            </div>
            <div>
              <div class="row-meta">
                <strong>Vendor / subcontractor needed</strong>
                <button class="mini-button" type="button" data-action="open-opportunity-needs-list" data-opportunity-id="${opportunity.id}" data-kind="vendor">Edit</button>
              </div>
              <div class="chip-list">${renderOpportunityNeedsChips(opportunity.vendorNeeds) || `<span class="tag">Nothing listed</span>`}</div>
            </div>
            <div>
              <div class="row-meta">
                <strong>Resources needed</strong>
                <button class="mini-button" type="button" data-action="open-opportunity-needs-list" data-opportunity-id="${opportunity.id}" data-kind="resource">Edit</button>
              </div>
              <div class="chip-list">${renderOpportunityNeedsChips(opportunity.resourceNeeds) || `<span class="tag">Nothing listed</span>`}</div>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderOpportunityProposalDocumentsTab(opportunity) {
  const quotes = quotesForOpportunity(opportunity.id);

  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header">
          <h3>Proposal status</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-proposal" data-id="${opportunity.id}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            <div><dt>Develop proposal</dt><dd>${escapeHtml(opportunity.proposalDevelopedStatus || "Incomplete")}</dd></div>
            <div><dt>Complete internal review</dt><dd>${escapeHtml(opportunity.internalReviewStatus || "Incomplete")}</dd></div>
            <div><dt>Present proposal</dt><dd>${escapeHtml(opportunity.proposalPresentedStatus || "Incomplete")}</dd></div>
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <h3>Quote</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-quote" data-opportunity-id="${opportunity.id}">Add quote</button>
        </div>
        <div class="panel-body">
          ${
            quotes
              .map(
                (quote) => `
                  <article class="detail-card">
                    <div class="row-meta">
                      <div>
                        <strong>${escapeHtml(quote.name || quote.quoteNumber || "Quote")}</strong>
                        <span>${money(Number(quote.totalAmount || 0))} &middot; ${escapeHtml(quote.statusCode || "Draft")}</span>
                      </div>
                      <div class="inline-actions">
                        ${quote.id === opportunity.quoteId ? `<span class="tag">Current</span>` : ""}
                        <button class="mini-button" type="button" data-action="open-opportunity-quote" data-opportunity-id="${opportunity.id}" data-id="${quote.id}">Edit</button>
                      </div>
                    </div>
                  </article>
                `,
              )
              .join("") || `<div class="empty-state">No quote attached yet.</div>`
          }
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <h3>Negotiation sign-off</h3>
          <button class="mini-button" type="button" data-action="open-opportunity-negotiation" data-id="${opportunity.id}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            <div><dt>New account paperwork</dt><dd>${escapeHtml(opportunity.accountPaperworkStatus || "Not started")}</dd></div>
            <div><dt>Quote</dt><dd>${escapeHtml(opportunity.quoteSignedStatus || "Not started")}</dd></div>
            <div><dt>Work authorization</dt><dd>${escapeHtml(opportunity.workAuthorizationStatus || "Not started")}</dd></div>
          </dl>
        </div>
      </article>
    </section>
  `;
}

function renderOpportunityFilesActivityTab(opportunity) {
  const activities = activitiesForOpportunity(opportunity.id);
  const tasks = openTasksForAccount(opportunity.accountId);
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header"><h3>Log activity</h3></div>
        <div class="panel-body">
          ${renderActivityPicker(opportunity.accountId, "", opportunity.id)}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Activity timeline</h3></div>
        <div class="panel-body record-list">
          ${activities.map(renderTimelineItem).join("") || `<div class="empty-state">No activities for this opportunity yet.</div>`}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Tasks</h3></div>
        <div class="panel-body task-list">
          ${tasks.map(renderTaskRow).join("") || `<div class="empty-state">No open tasks for this opportunity account.</div>`}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Files</h3></div>
        <div class="panel-body"><div class="empty-state">File upload isn't wired up in this prototype yet.</div></div>
      </article>
    </section>
  `;
}

function renderOpportunityMainInformation(opportunity) {
  const core = getCoreOpportunity(opportunity);
  const account = findAccount(opportunity.accountId);
  const primaryContact = contactsForOpportunity(opportunity.id)[0];
  const site = findLocation(opportunity.locationId);
  const field = (key) => escapeHtml(formatOpportunityFieldValue(opportunity, key));
  const row = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;

  const accountValue = account
    ? `<button class="link-button" type="button" data-action="view-account" data-id="${escapeAttribute(account.id)}">${escapeHtml(account.name)}</button>`
    : field("accountName");
  const contactValue = primaryContact
    ? `<button class="link-button" type="button" data-action="view-contact" data-id="${escapeAttribute(primaryContact.id)}">${escapeHtml(primaryContact.name)}</button>`
    : field("primaryContact");

  return `
    <div class="detail-stack opportunity-info-column">
      <article class="panel">
        <div class="panel-header">
          <h3>Opportunity</h3>
          <button class="mini-button" type="button" data-action="open-opportunity" data-id="${escapeAttribute(opportunity.id)}" data-account-id="${escapeAttribute(opportunity.accountId)}">Edit</button>
        </div>
        <div class="panel-body">
          <dl class="detail-list">
            ${row("Account", accountValue)}
            ${row("Site / facility", site ? escapeHtml(site.name) : "Not captured")}
            ${row("Primary contact", contactValue)}
            ${row("Owner", field("owner"))}
            ${row("Deal type", field("dealType"))}
            ${row("Service type", field("serviceType"))}
            ${row("Industry", field("industry"))}
            ${row("Source campaign", field("sourceCampaign"))}
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Situation &amp; solution</h3></div>
        <div class="panel-body">
          <dl class="detail-list">
            ${row("Current situation", field("currentSituation"))}
            ${row("Customer need", field("customerNeed"))}
            ${row("Proposed solution", field("proposedSolution"))}
            ${row("Next step", field("nextStep"))}
            ${row("Decision maker", field("decisionMaker"))}
            ${row("Competitor", field("competitor"))}
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Description</h3></div>
        <div class="panel-body">
          <p class="help-text">${core.description ? escapeHtml(core.description) : "Not captured"}</p>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Pipeline</h3></div>
        <div class="panel-body">
          <dl class="detail-list">
            ${row("Stage", field("dealStage"))}
            ${row("Status", field("status"))}
            ${row("Probability", field("closeProbability"))}
            ${row("Forecast category", field("forecastCategory"))}
            ${row("Priority", field("priority"))}
            ${row("Rating", field("rating"))}
            ${row("Time in stage", `${Number(core.stageAgeDays || 0)} days`)}
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Value</h3></div>
        <div class="panel-body">
          <dl class="detail-list">
            ${row("Amount", field("amount"))}
            ${row("Estimated value", field("estimatedValue"))}
            ${row("Weighted amount", field("weightedAmount"))}
            ${row("Total contract value", field("totalContractValue"))}
            ${row("Budget", field("budgetAmount"))}
            ${row("Not to exceed", field("notToExceed"))}
            ${row("Currency", field("currency"))}
          </dl>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><h3>Dates &amp; source</h3></div>
        <div class="panel-body">
          <dl class="detail-list">
            ${row("Estimated close", field("estimatedCloseDate"))}
            ${core.actualCloseDate ? row("Actual close", field("actualCloseDate")) : ""}
            ${row("Purchase time frame", field("purchaseTimeframe"))}
            ${row("Last contacted", field("lastContacted"))}
            ${row("Next activity", field("nextActivityDate"))}
            ${row("Created", `${field("createdOn")} &middot; ${escapeHtml(core.createdBy || "Unknown")}`)}
            ${row("Record source", field("recordSource"))}
          </dl>
        </div>
      </article>
    </div>
  `;
}

function renderSalesRaceTrack() {
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "sales",
        "Delivery Tracker",
        "A quick glance at deals you've won, once they've moved past the pipeline into active field delivery. For dispatch and operations detail, use the Race Track in Operations.",
      )}
      ${renderRaceTrackBoard("sales")}
    </section>
  `;
}

function renderRaceTrackBoard(context = "operations") {
  const activeJobs = state.projects.filter((job) => job.status !== "Complete");
  const highAlertCount = state.projectAlerts.filter((alert) => alert.status !== "Resolved" && alert.severity === "High").length;
  const atRiskCount = activeJobs.filter((job) => getJobProgress(job).tone !== "low").length;
  const scheduledCount = getScheduleEvents().filter((work) => work.status !== "Complete").length;

  return `
    <section class="metric-strip" aria-label="Race track metrics">
      <div class="metric">
        <p class="eyebrow">Active projects</p>
        <strong>${activeJobs.length}</strong>
        <span>Projects currently tracked</span>
      </div>
      <div class="metric">
        <p class="eyebrow">At risk</p>
        <strong>${atRiskCount}</strong>
        <span>Alerted, delayed, or blocked</span>
      </div>
      <div class="metric">
        <p class="eyebrow">High alerts</p>
        <strong>${highAlertCount}</strong>
        <span>Need manager review</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Scheduled items</p>
        <strong>${scheduledCount}</strong>
        <span>Upcoming site work</span>
      </div>
    </section>
    <section class="race-track-board ${context === "sales" ? "sales-track" : ""}" aria-label="Active project race track">
      ${activeJobs.map(renderRaceTrackCard).join("") || `<div class="empty-state">No active field projects.</div>`}
    </section>
  `;
}

function renderRaceTrackCard(job) {
  const account = findAccount(job.accountId);
  const progress = getJobProgress(job);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const schedule = state.scheduledWork.find((work) => work.jobId === job.id);

  return `
    <article class="race-card">
      <div class="race-card-main">
        <div>
          <strong>${escapeHtml(job.name)}</strong>
          <div class="row-meta">
            <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
            <span>${escapeHtml(job.jobClass)}</span>
            <span>${escapeHtml(job.status)}</span>
          </div>
        </div>
        <span class="risk-badge ${progress.tone}">${progress.percent}%</span>
      </div>
      <div class="race-progress ${progress.tone}" aria-label="${progress.percent}% project progress">
        <span style="width: ${progress.percent}%"></span>
      </div>
      <div class="race-stage-list">
        ${PROJECT_STAGES.map((stage, index) => `<span class="${progress.stageIndex >= index ? "done" : ""}">${stage}</span>`).join("")}
      </div>
      <div class="inline-actions">
        <span class="stage-badge">${escapeHtml(job.activePhase)}</span>
        <span class="${alerts.length ? "risk-badge high" : "tag"}">${alerts.length} alerts</span>
        <span class="tag">${schedule ? formatDate(schedule.date) : `${formatDate(job.startDate)} start`}</span>
      </div>
    </article>
  `;
}

function buildCoreProjectRecord(project) {
  return {
    ...project,
    id: project.id || makeId("proj"),
    accountId: project.accountId || "",
    opportunityId: project.opportunityId || "",
    locationId: project.locationId || "",
    contactIds: project.contactIds || [],
    name: project.name || "",
    jobClass: project.jobClass || "",
    status: project.status || "Active",
    activePhase: project.activePhase || "",
    projectManager: project.projectManager || "",
    salesLead: project.salesLead || "",
    startDate: project.startDate || "",
    targetDate: project.targetDate || "",
    completedDate: project.completedDate || "",
    budget: project.budget ?? 0,
    value: project.value ?? project.budget ?? 0,
    notToExceed: project.notToExceed ?? "",
    marginWatch: project.marginWatch || "",
    outcome: project.outcome || "",
    serviceType: project.serviceType || "",
    generatorName: project.generatorName || "",
    generatorSiteName: project.generatorSiteName || "",
    epaId: project.epaId || "",
    tceqId: project.tceqId || "",
    insuranceContact: project.insuranceContact || "",
    insuranceCarrier: project.insuranceCarrier || "",
    claimNumber: project.claimNumber || "",
    serviceProfile: project.serviceProfile || "",
  };
}

function buildCoreAccountRecord(account) {
  const accountName = account.accountName || account.name || "";
  const accountId = account.accountId || account.id || makeId("acct");
  const accountNumber = account.accountNumber || accountId.replace(/^acct-/, "ACCT-").toUpperCase();
  const mainPhoneNumber = account.mainPhoneNumber || account.phone || "";
  const email = account.email || "";
  const cityState = splitCityState(account.addressOneCity || account.city || "");
  const city = cityState.city;
  const primaryContact = account.addressOnePrimaryContact || account.contact || "";
  const now = new Date().toISOString();

  return {
    ...account,
    id: account.id || accountId,
    name: account.name || accountName,
    contact: account.contact || primaryContact,
    phone: account.phone || mainPhoneNumber,
    city: account.city || city,
    accountName,
    accountId,
    accountUniqueIdentifier: account.accountUniqueIdentifier || accountId,
    accountNumber,
    accountRating: account.accountRating || account.risk || "Unrated",
    accountType: account.accountType || account.type || "Customer",
    businessType: account.businessType || "Commercial",
    category: account.category || account.phase || "Environmental services",
    classification: account.classification || account.phase || "Prospect",
    customerSize: account.customerSize || "",
    industry: account.industry || "",
    numberOfEmployees: account.numberOfEmployees || "",
    description: account.description || account.concern || "",
    website: account.website || "",
    email,
    emailAddressTwo: account.emailAddressTwo || "",
    emailAddressThree: account.emailAddressThree || "",
    mainPhoneNumber,
    faxNumber: account.faxNumber || account.fax || "",
    timeZone: account.timeZone || "",
    addressOneType: account.addressOneType || "Primary",
    addressOneStreetOne: account.addressOneStreetOne || account.address || "",
    addressOneStreetTwo: account.addressOneStreetTwo || "",
    addressOneStreetThree: account.addressOneStreetThree || "",
    addressOneCity: city,
    addressOneState: account.addressOneState || cityState.state || "",
    addressOneCounty: account.addressOneCounty || "",
    addressOneCountry: account.addressOneCountry || "United States",
    addressOneZipCode: account.addressOneZipCode || account.zipCode || "",
    addressOnePostOfficeBox: account.addressOnePostOfficeBox || "",
    addressOneLatitude: account.addressOneLatitude || "",
    addressOneLongitude: account.addressOneLongitude || "",
    addressOnePrimaryContact: primaryContact,
    addressOneTelephoneOne: account.addressOneTelephoneOne || mainPhoneNumber,
    addressOneTelephoneTwo: account.addressOneTelephoneTwo || "",
    addressOnePhoneNumber: account.addressOnePhoneNumber || mainPhoneNumber,
    addressOneFax: account.addressOneFax || account.faxNumber || "",
    addressOneFreightTerms: account.addressOneFreightTerms || "",
    addressOneShippingMethod: account.addressOneShippingMethod || "",
    addressOneUpsZone: account.addressOneUpsZone || "",
    addressOneUtcOffset: account.addressOneUtcOffset || "",
    addressOneUniqueIdentifier: account.addressOneUniqueIdentifier || `${accountId}-addr1`,
    addressTwoType: account.addressTwoType || "",
    addressTwoName: account.addressTwoName || "",
    addressTwoStreetOne: account.addressTwoStreetOne || "",
    addressTwoStreetTwo: account.addressTwoStreetTwo || "",
    addressTwoStreetThree: account.addressTwoStreetThree || "",
    addressTwoCity: account.addressTwoCity || "",
    addressTwoRegion: account.addressTwoRegion || "",
    addressTwoState: account.addressTwoState || "",
    addressTwoCountry: account.addressTwoCountry || "",
    addressTwoZipCode: account.addressTwoZipCode || "",
    addressTwoPrimaryContact: account.addressTwoPrimaryContact || "",
    addressTwoTelephoneOne: account.addressTwoTelephoneOne || "",
    addressTwoTelephoneTwo: account.addressTwoTelephoneTwo || "",
    addressTwoTelephoneThree: account.addressTwoTelephoneThree || "",
    addressTwoFax: account.addressTwoFax || "",
    billingAddress: account.billingAddress || account.billing_address || "",
    billingAddressName: account.billingAddressName || "",
    billingAddressStreet: account.billingAddressStreet || account.addressOneStreetOne || "",
    billingAddressStreetTwo: account.billingAddressStreetTwo || "",
    billingAddressStreetThree: account.billingAddressStreetThree || "",
    billingAddressSuiteNumber: account.billingAddressSuiteNumber || "",
    billingAddressState: account.billingAddressState || account.addressOneState || "",
    billingAddressCountry: account.billingAddressCountry || account.addressOneCountry || "United States",
    billingAddressZipCode: account.billingAddressZipCode || account.addressOneZipCode || "",
    billingInterval: account.billingInterval || "",
    billingType: account.billingType || "",
    annualRevenue: account.annualRevenue || "",
    annualRevenueBase: account.annualRevenueBase || "",
    availableCredit: account.availableCredit || "",
    creditHold: Boolean(account.creditHold),
    currency: account.currency || "USD",
    averageTimeToCloseOpportunity: account.averageTimeToCloseOpportunity || "",
    doNotAllowBulkEmail: Boolean(account.doNotAllowBulkEmail),
    doNotAllowBulkMail: Boolean(account.doNotAllowBulkMail),
    doNotAllowEmails: Boolean(account.doNotAllowEmails),
    doNotAllowFaxes: Boolean(account.doNotAllowFaxes),
    doNotAllowMail: Boolean(account.doNotAllowMail),
    doNotAllowPhoneCalls: Boolean(account.doNotAllowPhoneCalls),
    createdBy: account.createdBy || account.owner || state.currentUser?.name || "Local user",
    createdOn: account.createdOn || account.createdAt || account.created_at || now,
  };
}

function getCoreAccount(account) {
  return buildCoreAccountRecord(account || {});
}

function getAccountFieldValue(account, key) {
  return getCoreAccount(account)[key] ?? "";
}

function getBooleanAccountField(account, key) {
  return Boolean(getCoreAccount(account)[key]);
}

function formatAccountFieldValue(account, key) {
  const value = getAccountFieldValue(account, key);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not captured";
  if (key === "annualRevenue" || key === "annualRevenueBase" || key === "availableCredit") {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? money(amount) : "Not captured";
  }
  if (key === "createdOn") return formatDate(value);
  return String(value);
}

function sentenceCase(value) {
  return String(value)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
}

function buildCoreTaskRecord(task) {
  return {
    ...task,
    id: task.id || makeId("task"),
    accountId: task.accountId || "",
    contactId: task.contactId || "",
    opportunityId: task.opportunityId || "",
    activityId: task.activityId || "",
    title: task.title || "",
    dueDate: task.dueDate || "",
    owner: task.owner || "Unassigned",
    type: task.type || "Follow-up",
    priority: task.priority || "Medium",
    status: task.status || "Open",
    completedAt: task.completedAt || (task.status === "Complete" ? new Date().toISOString() : ""),
  };
}

function buildCoreActivityRecord(activity) {
  const activityType = normalizeActivityType(activity.activityType || activity.kind || "Task");
  const createdAt = activity.createdAt || new Date().toISOString();
  const activityDate = activity.activityDate || createdAt.slice(0, 10);
  const status = activity.status || (activityType === "Task" ? "Open" : "Completed");
  const accountId = activity.accountId || "";
  const opportunityId = activity.opportunityId || "";
  const contactId = activity.contactId || "";
  const subject = activity.subject || activity.title || activity.kind || `${activityType} activity`;
  const body = activity.body || activity.note || activity.description || "";

  return {
    ...activity,
    id: activity.id || makeId("act"),
    accountId,
    contactId,
    opportunityId,
    activityType,
    kind: activity.kind || activityType,
    subject,
    body,
    description: activity.description || body,
    direction: activity.direction || (activityType === "Meeting" ? "Internal" : "Outbound"),
    channel: activity.channel || getDefaultActivityChannel(activityType),
    activityDate,
    dueDate: activity.dueDate || (activityType === "Task" ? activityDate : ""),
    status,
    owner: activity.owner || activity.author || "Unassigned",
    author: activity.author || activity.owner || "Unassigned",
    createdBy: activity.createdBy || activity.author || activity.owner || "Unassigned",
    createdAt,
    completedAt: activity.completedAt || (status === "Completed" ? createdAt : ""),
    priority: activity.priority || (activityType === "Task" ? "Medium" : ""),
  };
}

function normalizeActivityType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("meeting")) return "Meeting";
  if (raw.includes("call")) return "Call";
  if (raw.includes("email")) return "Email";
  if (raw.includes("task")) return "Task";
  if (raw.includes("note")) return "Note";
  return "Task";
}

function getDefaultActivityChannel(activityType) {
  if (activityType === "Meeting") return "Meeting";
  if (activityType === "Call") return "Phone";
  if (activityType === "Email") return "Email";
  if (activityType === "Note") return "Note";
  return "Task";
}

function splitCityState(value = "") {
  const match = /^(.*),\s*([A-Za-z]{2})$/.exec(String(value).trim());
  if (match) return { city: match[1].trim(), state: match[2].toUpperCase() };
  return { city: String(value).trim(), state: "" };
}

function splitContactName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

function buildCoreContactRecord(contact) {
  const account = findAccount(contact.accountId);
  const nameParts = splitContactName(contact.name || contact.fullName || `${contact.firstName || ""} ${contact.lastName || ""}`);
  const fullName = contact.fullName || contact.name || `${nameParts.firstName} ${nameParts.lastName}`.trim();
  const now = new Date().toISOString();
  const contactActivities = contact.id ? activitiesForContact(contact.id) : [];
  const nextActivity = contactActivities.find((activity) => activity.status !== "Completed" && (activity.dueDate || activity.activityDate));
  const lastCompletedActivity = contactActivities.find((activity) => activity.status === "Completed") || contactActivities[0];
  return {
    ...contact,
    id: contact.id || contact.contactId || makeId("cont"),
    name: contact.name || fullName,
    fullName,
    contactId: contact.contactId || contact.id || "",
    contactUniqueIdentifier: contact.contactUniqueIdentifier || contact.id || "",
    firstName: contact.firstName || nameParts.firstName,
    lastName: contact.lastName || nameParts.lastName,
    jobTitle: contact.jobTitle || contact.title || "",
    title: contact.title || contact.jobTitle || "",
    birthday: contact.birthday || "",
    accountName: contact.accountName || account?.name || "",
    accountRole: contact.accountRole || "Employee",
    relationshipRole: contact.relationshipRole || contact.influence || "Unknown",
    lifecycleStage: contact.lifecycleStage || "Lead",
    leadStatus: contact.leadStatus || "Open",
    owner: contact.owner || account?.owner || "Unassigned",
    hubspotOwnerId: contact.hubspotOwnerId || "",
    originatingLeadId: contact.originatingLeadId || "",
    email: contact.email || "",
    emailAddressTwo: contact.emailAddressTwo || "",
    emailAddressThree: contact.emailAddressThree || "",
    phone: contact.phone || "",
    businessPhone: contact.businessPhone || contact.phone || "",
    mobilePhone: contact.mobilePhone || "",
    fax: contact.fax || "",
    preferredContactMethod: contact.preferredContactMethod || contact.preferredContact || "Email",
    preferredContact: contact.preferredContact || contact.preferredContactMethod || "Email",
    doNotAllowEmails: Boolean(contact.doNotAllowEmails),
    doNotAllowPhoneCalls: Boolean(contact.doNotAllowPhoneCalls),
    doNotAllowMail: Boolean(contact.doNotAllowMail),
    doNotAllowFaxes: Boolean(contact.doNotAllowFaxes),
    addressOneType: contact.addressOneType || "Primary",
    addressOneStreetOne: contact.addressOneStreetOne || "",
    addressOneStreetTwo: contact.addressOneStreetTwo || "",
    addressOneStreetThree: contact.addressOneStreetThree || "",
    addressOneCity: contact.addressOneCity || splitCityState(account?.addressOneCity || account?.city || "").city,
    addressOneState: contact.addressOneState || account?.addressOneState || splitCityState(account?.addressOneCity || account?.city || "").state,
    addressOneCountry: contact.addressOneCountry || account?.addressOneCountry || "United States",
    addressOneZipCode: contact.addressOneZipCode || account?.addressOneZipCode || "",
    addressOneTelephoneOne: contact.addressOneTelephoneOne || contact.phone || "",
    addressOneTelephoneTwo: contact.addressOneTelephoneTwo || "",
    addressOneTelephoneThree: contact.addressOneTelephoneThree || "",
    addressOneUpsZone: contact.addressOneUpsZone || "",
    addressOneUtcOffset: contact.addressOneUtcOffset || "",
    addressTwoType: contact.addressTwoType || "",
    addressTwoStreetOne: contact.addressTwoStreetOne || "",
    addressTwoStreetTwo: contact.addressTwoStreetTwo || "",
    addressTwoStreetThree: contact.addressTwoStreetThree || "",
    addressTwoCity: contact.addressTwoCity || "",
    addressTwoState: contact.addressTwoState || "",
    addressTwoCountry: contact.addressTwoCountry || "",
    addressTwoZipCode: contact.addressTwoZipCode || "",
    addressTwoTelephoneOne: contact.addressTwoTelephoneOne || "",
    addressTwoTelephoneTwo: contact.addressTwoTelephoneTwo || "",
    addressTwoTelephoneThree: contact.addressTwoTelephoneThree || "",
    addressTwoFax: contact.addressTwoFax || "",
    lastContacted: contact.lastContacted || lastCompletedActivity?.activityDate || account?.lastContact || "",
    lastActivityDate: contact.lastActivityDate || lastCompletedActivity?.activityDate || "",
    nextActivityDate: contact.nextActivityDate || nextActivity?.dueDate || nextActivity?.activityDate || nextOpenTaskForAccount(contact.accountId)?.dueDate || "",
    numberOfSalesActivities: Number(contact.numberOfSalesActivities || contactActivities.length || 0),
    numberOfTimesContacted: Number(contact.numberOfTimesContacted || contactActivities.filter((activity) => ["Call", "Email", "Meeting"].includes(activity.activityType)).length || 0),
    createdOn: contact.createdOn || contact.createdAt || now,
    createdBy: contact.createdBy || state.currentUser?.name || "Local user",
    lastModifiedDate: contact.lastModifiedDate || contact.updatedAt || now,
    recordSource: contact.recordSource || "Local CRM",
    notes: contact.notes || "No relationship notes yet.",
  };
}

function getCoreContact(contact) {
  return buildCoreContactRecord(contact || {});
}

function getContactFieldValue(contact, key) {
  return getCoreContact(contact)[key] ?? "";
}

function formatContactFieldValue(contact, key) {
  const value = getContactFieldValue(contact, key);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not captured";
  if (["lastContacted", "lastActivityDate", "nextActivityDate", "createdOn", "lastModifiedDate", "birthday"].includes(key)) return formatDate(value);
  return String(value);
}

function buildCoreOpportunityRecord(opportunity) {
  const account = findAccount(opportunity.accountId);
  const contacts = contactsForOpportunity(opportunity.id || opportunity.opportunityId || "");
  const opportunityActivities = opportunity.id ? activitiesForOpportunity(opportunity.id) : [];
  const nextActivity = opportunityActivities.find((activity) => activity.status !== "Completed" && (activity.dueDate || activity.activityDate));
  const lastCompletedActivity = opportunityActivities.find((activity) => activity.status === "Completed") || opportunityActivities[0];
  const probability = Number(opportunity.probability ?? opportunity.closeProbability ?? STAGE_PROBABILITY[opportunity.stage] ?? 15);
  const amount = Number(opportunity.amount ?? opportunity.value ?? 0);
  const now = new Date().toISOString();
  return {
    ...opportunity,
    id: opportunity.id || opportunity.opportunityId || makeId("opp"),
    name: opportunity.name || opportunity.opportunityName || "",
    opportunityName: opportunity.opportunityName || opportunity.name || "",
    opportunityId: opportunity.opportunityId || opportunity.id || "",
    opportunityUniqueIdentifier: opportunity.opportunityUniqueIdentifier || opportunity.id || "",
    accountName: opportunity.accountName || account?.name || "",
    primaryContact: opportunity.primaryContact || contacts[0]?.name || account?.contact || "",
    owner: opportunity.owner || account?.owner || "Unassigned",
    hubspotOwnerId: opportunity.hubspotOwnerId || "",
    dealType: opportunity.dealType || "New Business",
    serviceType: opportunity.serviceType || "",
    sourceCampaign: opportunity.sourceCampaign || "",
    originatingLeadId: opportunity.originatingLeadId || "",
    pipeline: opportunity.pipeline || "Sales Pipeline",
    dealStage: opportunity.dealStage || opportunity.stage || "Lead",
    stage: opportunity.stage || opportunity.dealStage || "Lead",
    status: opportunity.stage === "Won" ? "Won" : opportunity.status === "Lost" ? "Lost" : "Open",
    forecastCategory: opportunity.stage === "Won" ? "Won" : opportunity.status === "Lost" ? "Lost" : "Pipeline",
    closeProbability: probability,
    probability,
    priority: opportunity.priority || "Normal",
    rating: opportunity.rating || getCloseStatus(opportunity.closeDate).label,
    initialCommunication: opportunity.initialCommunication || "Contacted",
    currentSituation: opportunity.currentSituation || account?.concern || "",
    industry: opportunity.industry || account?.industry || "",
    customerNeed: opportunity.customerNeed || opportunity.serviceType || "",
    proposedSolution: opportunity.proposedSolution || opportunity.nextStep || "",
    nextStep: opportunity.nextStep || "",
    amount,
    value: Number(opportunity.value ?? amount),
    amountInCompanyCurrency: Number(opportunity.amountInCompanyCurrency || amount),
    estimatedValue: Number(opportunity.estimatedValue || amount),
    weightedAmount: Number(opportunity.weightedAmount || amount * (probability / 100)),
    forecastAmount: Number(opportunity.forecastAmount || amount * (probability / 100)),
    annualRecurringRevenue: Number(opportunity.annualRecurringRevenue || 0),
    totalContractValue: Number(opportunity.totalContractValue || amount),
    budgetAmount: Number(opportunity.budgetAmount || 0),
    notToExceed: opportunity.notToExceed || "",
    currency: opportunity.currency || "USD",
    exchangeRate: opportunity.exchangeRate || "1.00",
    isRevenueSystemCalculated: Boolean(opportunity.isRevenueSystemCalculated),
    estimatedCloseDate: opportunity.estimatedCloseDate || opportunity.closeDate || "",
    closeDate: opportunity.closeDate || opportunity.estimatedCloseDate || "",
    actualCloseDate: opportunity.actualCloseDate || "",
    createdOn: opportunity.createdOn || opportunity.createdAt || now,
    createdBy: opportunity.createdBy || state.currentUser?.name || "Local user",
    lastModifiedDate: opportunity.lastModifiedDate || opportunity.updatedAt || now,
    lastContacted: opportunity.lastContacted || lastCompletedActivity?.activityDate || account?.lastContact || "",
    nextActivityDate: opportunity.nextActivityDate || nextActivity?.dueDate || nextActivity?.activityDate || nextOpenTaskForAccount(opportunity.accountId)?.dueDate || "",
    numberOfSalesActivities: Number(opportunity.numberOfSalesActivities || opportunityActivities.length || 0),
    numberOfAssociatedContacts: Number(opportunity.numberOfAssociatedContacts || contacts.length || 0),
    stageAgeDays: Number(opportunity.stageAgeDays || daysBetween(opportunity.updatedAt || now, todayIso())),
    competitor: opportunity.competitor || "",
    decisionMaker: opportunity.decisionMaker || contacts.find((contact) => contact.influence === "Decision maker")?.name || "",
    purchaseProcess: opportunity.purchaseProcess || "",
    purchaseTimeframe: opportunity.purchaseTimeframe || "",
    quoteId: opportunity.quoteId || "",
    priceList: opportunity.priceList || "",
    recordSource: opportunity.recordSource || "Local CRM",
    description: opportunity.description || opportunity.nextStep || "",
    updatedAt: opportunity.updatedAt || now,
  };
}

function getCoreOpportunity(opportunity) {
  return buildCoreOpportunityRecord(opportunity || {});
}

function getOpportunityFieldValue(opportunity, key) {
  return getCoreOpportunity(opportunity)[key] ?? "";
}

function formatOpportunityFieldValue(opportunity, key) {
  const value = getOpportunityFieldValue(opportunity, key);
  if (typeof value === "boolean") return value ? "System calculated" : "User provided";
  if (value === null || value === undefined || value === "") return "Not captured";
  if (["amount", "amountInCompanyCurrency", "estimatedValue", "weightedAmount", "forecastAmount", "annualRecurringRevenue", "totalContractValue", "budgetAmount"].includes(key)) {
    return money(Number(value || 0));
  }
  if (key === "closeProbability") return `${Number(value || 0)}%`;
  if (["estimatedCloseDate", "actualCloseDate", "createdOn", "lastModifiedDate", "lastContacted", "nextActivityDate"].includes(key)) return formatDate(value);
  return String(value);
}

function daysBetween(fromDate, toDate) {
  const start = parseDate(fromDate);
  const end = parseDate(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function renderCompactSearch(id, placeholder, value) {
  return `
    <span class="search-compact">
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input id="${escapeAttribute(id)}" type="search" placeholder="${escapeAttribute(placeholder)}" value="${escapeAttribute(value)}" />
    </span>
  `;
}

const FILTER_ICON_SVG = `
  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
  </svg>
`;

const VIEW_ICON_SVG = `
  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2" />
    <rect x="14" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2" />
    <rect x="3" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2" />
    <rect x="14" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2" />
  </svg>
`;

function renderCompactSelect(id, icon, ariaLabel, optionsHtml, isActive = false) {
  return `
    <span class="select-compact${isActive ? " has-filter" : ""}">
      ${icon}
      <select id="${escapeAttribute(id)}" aria-label="${escapeAttribute(ariaLabel)}">
        ${optionsHtml}
      </select>
    </span>
  `;
}

function renderAccounts() {
  const activeView = accountTableViews[state.accountTableView] || accountTableViews.sales;
  const search = state.accountSearch.trim().toLowerCase();
  const sortedIndustries = getIndustries()
    .slice()
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const accounts = state.accounts
    .filter((account) => {
      if (!search) return true;
      return [
        ...accountCoreFields.map((field) => getAccountFieldValue(account, field.key)),
        account.contact,
        account.owner,
        account.nextAction,
        account.siteName,
        account.concern,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .filter((account) => {
      if (!state.accountIndustryFilter) return true;
      return industriesForAccount(account.id).some((link) => link.industryId === state.accountIndustryFilter);
    });
  const priorityAccounts = accounts
    .map(getAccountCrmSummary)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader("sales", "Accounts", "Role-specific account views built from the shared Account table.")}
      <section class="crm-focus-grid" aria-label="CRM account focus">
        ${priorityAccounts.map(renderAccountFocusCard).join("") || `<div class="empty-state">No account records yet.</div>`}
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>${escapeHtml(activeView.label)}</h3>
            <span>${escapeHtml(activeView.description)}</span>
          </div>
          <div class="list-toolbar">
            ${renderCompactSearch("accountSearch", "Search accounts or sites", state.accountSearch)}
            ${renderCompactSelect(
              "accountIndustryFilter",
              FILTER_ICON_SVG,
              "Filter by industry",
              `<option value="">All industries</option>${sortedIndustries
                .map(
                  (industry) =>
                    `<option value="${escapeAttribute(industry.id)}" ${industry.id === state.accountIndustryFilter ? "selected" : ""}>${escapeHtml(industry.industryName)}</option>`,
                )
                .join("")}`,
              Boolean(state.accountIndustryFilter),
            )}
            <button class="primary-button" type="button" data-action="open-account">New account</button>
            ${renderCompactSelect(
              "accountTableView",
              VIEW_ICON_SVG,
              "Account table view",
              Object.entries(accountTableViews)
                .map(
                  ([viewId, view]) =>
                    `<option value="${escapeAttribute(viewId)}" ${viewId === state.accountTableView ? "selected" : ""}>${escapeHtml(view.label)}</option>`,
                )
                .join(""),
            )}
          </div>
        </div>
        <div class="panel-body">
          <table class="data-table">
            <thead>
              <tr>
                ${activeView.columns.map((columnKey) => `<th>${escapeHtml(getAccountColumnLabel(columnKey))}</th>`).join("")}
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${
                accounts.map((account) => renderAccountTableRow(account, activeView)).join("") ||
                `<tr><td colspan="${activeView.columns.length + 1}"><div class="empty-state">No accounts match that search.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderAccountTableRow(account, view) {
  const summary = getAccountCrmSummary(account);
  const context = { summary };
  return `
    <tr>
      ${view.columns.map((columnKey) => renderAccountTableCell(account, columnKey, context)).join("")}
      <td data-label="Actions">
        <div class="inline-actions">
          <button class="mini-button" type="button" data-action="view-account" data-id="${account.id}">Open</button>
          <button class="mini-button" type="button" data-action="open-note" data-account-id="${account.id}">Activity</button>
        </div>
      </td>
    </tr>
  `;
}

function renderAccountTableCell(account, columnKey, context) {
  return `<td data-label="${escapeAttribute(getAccountColumnLabel(columnKey))}">${renderAccountColumnValue(account, columnKey, context)}</td>`;
}

function getAccountColumnLabel(columnKey) {
  const computedLabels = {
    primaryContact: "Primary Contact",
    salesStatus: "Sales Status",
    pipeline: "Pipeline",
    lastTouch: "Last Touch",
    nextAction: "Next Action",
    contactCoverage: "Contact Coverage",
    communicationPreference: "Communication Preference",
    owner: "Owner",
    city: "City",
  };
  return computedLabels[columnKey] || accountFieldLookup.get(columnKey)?.label || sentenceCase(columnKey);
}

function renderAccountColumnValue(account, columnKey, { summary }) {
  if (columnKey === "accountName") {
    return `
      <button class="link-button account-name" type="button" data-action="view-account" data-id="${account.id}">
        ${escapeHtml(getAccountFieldValue(account, "accountName"))}
      </button>
      <div class="row-meta">
        <span>${escapeHtml(getAccountFieldValue(account, "accountNumber"))}</span>
        <span>${escapeHtml(getAccountFieldValue(account, "accountType"))}</span>
      </div>
    `;
  }

  if (columnKey === "primaryContact") {
    return `
      ${escapeHtml(account.contact || getAccountFieldValue(account, "addressOnePrimaryContact"))}
      <div class="row-meta">
        <span>${escapeHtml(getAccountFieldValue(account, "email"))}</span>
        <span>${escapeHtml(getAccountFieldValue(account, "mainPhoneNumber"))}</span>
      </div>
    `;
  }

  if (columnKey === "salesStatus") {
    return `
      <span class="risk-badge ${summary.health.tone}">${escapeHtml(summary.health.label)}</span>
      <div class="row-meta">
        <span>${summary.contacts.length} contacts</span>
        <span>${escapeHtml(getAccountFieldValue(account, "accountRating"))} rating</span>
      </div>
    `;
  }

  if (columnKey === "pipeline") {
    return `
      <strong>${money(summary.openPipeline)}</strong>
      <div class="row-meta">
        <span>${summary.openOpportunities.length} open deals</span>
        <span>${summary.weightedPipeline ? `${money(summary.weightedPipeline)} weighted` : "No weighted value"}</span>
      </div>
    `;
  }

  if (columnKey === "lastTouch") {
    return `
      ${formatDate(account.lastContact)}
      <div class="row-meta"><span>${summary.nextTask ? `Task due ${formatDate(summary.nextTask.dueDate)}` : "No open task"}</span></div>
    `;
  }

  if (columnKey === "nextAction") {
    return `
      ${escapeHtml(summary.nextTask?.title || account.nextAction || "No next action")}
      <div class="row-meta"><span>Owner ${escapeHtml(account.owner || "Unassigned")}</span></div>
    `;
  }

  if (columnKey === "contactCoverage") {
    return `
      <strong>${summary.contacts.length}</strong>
      <div class="row-meta">
        <span>${summary.contacts.some((contact) => contact.influence === "Decision maker") ? "Decision maker named" : "Needs decision maker"}</span>
      </div>
    `;
  }

  if (columnKey === "communicationPreference") {
    const blocks = [
      getBooleanAccountField(account, "doNotAllowEmails") ? "Email blocked" : "Email ok",
      getBooleanAccountField(account, "doNotAllowPhoneCalls") ? "Phone blocked" : "Phone ok",
    ];
    return `<div class="row-meta">${blocks.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  if (columnKey === "owner") {
    return escapeHtml(account.owner || "Unassigned");
  }

  if (columnKey === "city") {
    return escapeHtml(getAccountFieldValue(account, "addressOneCity"));
  }

  if (columnKey === "industry") {
    const links = industriesForAccount(account.id);
    const primary = links.find((link) => link.isPrimary) || links[0];
    return primary ? escapeHtml(findIndustry(primary.industryId)?.industryName || "Unknown") : `<span class="muted">Not set</span>`;
  }

  return escapeHtml(formatAccountFieldValue(account, columnKey));
}

function renderAccountFocusCard(summary) {
  const { account, health, openOpportunities, openPipeline, activeAlerts, nextTask } = summary;
  return `
    <article class="crm-focus-card">
      <div class="inline-actions">
        <span class="risk-badge ${health.tone}">${escapeHtml(health.label)}</span>
        <span class="tag">Owner ${escapeHtml(account.owner)}</span>
      </div>
      <button class="link-button account-name" type="button" data-action="view-account" data-id="${account.id}">
        ${escapeHtml(account.name)}
      </button>
      <div class="mini-stat-grid">
        <div>
          <span>Pipeline</span>
          <strong>${money(openPipeline)}</strong>
        </div>
        <div>
          <span>Deals</span>
          <strong>${openOpportunities.length}</strong>
        </div>
        <div>
          <span>Alerts</span>
          <strong>${activeAlerts.length}</strong>
        </div>
      </div>
      <p class="help-text">${escapeHtml(nextTask?.title || account.nextAction)}</p>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-account" data-id="${account.id}">Open</button>
        <button class="mini-button" type="button" data-action="open-note" data-account-id="${account.id}">Activity</button>
      </div>
    </article>
  `;
}

const accountDetailTabs = [
  { id: "summary", label: "Summary" },
  { id: "details", label: "Details" },
  { id: "general", label: "General" },
  { id: "projects", label: "Projects" },
  { id: "lab-work", label: "Lab Work" },
  { id: "files", label: "Files" },
  { id: "facilities-locations", label: "Facilities and Locations" },
  { id: "account-health", label: "Account Health" },
];

function renderAccountDetail() {
  const account = findAccount(state.selectedAccountId);
  if (!account) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Account not found</h2>
        <button class="secondary-button" type="button" data-action="back-to-accounts">Back to accounts</button>
      </section>
    `;
    return;
  }

  const activeTab = state.accountDetailTab || "summary";

  app.innerHTML = `
    <section class="view">
      <div class="account-detail-shell">
        ${renderAccountDetailHeader(account)}
        <div class="account-detail-tabs-row">
          ${renderAccountDetailTabs(activeTab)}
        </div>
        <div class="account-detail-tabbody">
          ${renderAccountTabBody(activeTab, account)}
        </div>
      </div>
    </section>
  `;
}

function renderAccountDetailHeader(account) {
  const relationshipExtension = relationshipExtensionForAccount(account.id);
  const statusLabel = relationshipExtension?.relationshipStatus || "Not set";
  const statusTone = statusLabel === "Active" ? "low" : statusLabel === "Suspended" || statusLabel === "Inactive" ? "high" : "medium";
  const isPaused = Boolean(relationshipExtension?.isPaused);
  return `
    <div class="account-hero">
      <div class="account-hero-identity">
        <span class="person-avatar large">${escapeHtml(getInitials(account.name, "AC"))}</span>
        <div>
          <div class="account-hero-backrow">
            <button class="text-button" type="button" data-action="back-to-accounts">Back to accounts</button>
            <button class="secondary-button" type="button" data-action="open-account" data-id="${account.id}">Edit account</button>
            <button class="primary-button" type="button" data-action="open-opportunity" data-account-id="${account.id}">New opportunity</button>
          </div>
          <h2>${escapeHtml(account.name)}</h2>
          <p class="eyebrow">Account</p>
        </div>
      </div>
      <div class="account-hero-stats">
        ${isPaused ? `<span class="risk-badge high">Paused</span>` : ""}
        <span class="risk-badge ${statusTone}">Account ${escapeHtml(statusLabel)}</span>
        <div class="metric account-hero-metric">
          <p class="eyebrow">Annual Revenue</p>
          <strong>${money(Number(account.annualRevenue) || 0)}</strong>
        </div>
        <div class="metric account-hero-metric">
          <p class="eyebrow">Number of Employees</p>
          <strong>${account.numberOfEmployees ? Number(account.numberOfEmployees).toLocaleString() : "Not captured"}</strong>
        </div>
        <div class="account-owner-chip">
          <span class="person-avatar">${escapeHtml(getInitials(account.owner, "?"))}</span>
          <div>
            <strong>${escapeHtml(account.owner || "Unassigned")}</strong>
            <span>Owner</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAccountDetailTabs(activeTab) {
  return `
    <div class="segment-tabs" role="tablist" aria-label="Account detail sections">
      ${accountDetailTabs
        .map(
          (tab) => `
            <button type="button" role="tab" aria-selected="${tab.id === activeTab}" class="${tab.id === activeTab ? "active" : ""}" data-action="switch-account-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAccountTabBody(tab, account) {
  switch (tab) {
    case "details":
      return renderAccountDetailsTab(account);
    case "general":
      return renderAccountGeneralTab(account);
    case "projects":
      return renderAccountProjectsTab(account);
    case "lab-work":
      return renderAccountLabWorkTab(account);
    case "files":
      return renderAccountFilesTab(account);
    case "facilities-locations":
      return renderAccountFacilitiesTab(account);
    case "account-health":
      return renderAccountHealthTab(account);
    case "summary":
    default:
      return renderAccountSummaryTab(account);
  }
}

function renderAccountPlaceholderTab(label, note = "This tab is being built next.") {
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header"><h3>${escapeHtml(label)}</h3></div>
        <div class="panel-body"><div class="empty-state">${escapeHtml(note)}</div></div>
      </article>
    </section>
  `;
}

function renderAccountSummaryTab(account) {
  const addresses = addressesForAccount(account.id);
  const billingAddress = addresses.find((address) => address.addressType === "Bill To") || addresses.find((address) => address.isPrimary);
  const billingLocation = !billingAddress
    ? locationsForAccount(account.id).find((location) => location.category === "Billing Address")
    : null;
  const cases = alertsForAccount(account.id).filter((alert) => alert.status !== "Resolved");
  const openTasks = openTasksForAccount(account.id);
  const salesTasks = salesTasksForAccount(account.id);
  const contacts = contactsForAccount(account.id);
  const accountIndustryLinks = industriesForAccount(account.id);
  const parentAccount = account.parentAccountId ? findAccount(account.parentAccountId) : null;
  const searchTerm = (state.accountTimelineSearch || "").toLowerCase();
  const activities = activitiesForAccount(account.id).filter(
    (activity) =>
      !searchTerm ||
      (activity.subject || "").toLowerCase().includes(searchTerm) ||
      (activity.body || activity.description || "").toLowerCase().includes(searchTerm),
  );

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Account information</h3></div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Phone</dt><dd>${escapeHtml(account.mainPhoneNumber || account.phone || "Not captured")}</dd></div>
              <div><dt>Email</dt><dd>${escapeHtml(account.email || "Not captured")}</dd></div>
              <div><dt>Fax</dt><dd>${escapeHtml(account.faxNumber || "Not captured")}</dd></div>
              <div><dt>Website</dt><dd>${escapeHtml(account.website || "Not captured")}</dd></div>
              <div><dt>Parent account</dt><dd>${
                parentAccount
                  ? `<button class="link-button" type="button" data-action="view-account" data-id="${parentAccount.id}">${escapeHtml(parentAccount.name)}</button>`
                  : "None"
              }</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Billing address</h3>
            <button class="mini-button" type="button" data-action="open-address" data-account-id="${account.id}">${billingAddress ? "Edit" : "Add"}</button>
          </div>
          <div class="panel-body">
            ${
              billingAddress
                ? `<dl class="detail-list">
                    <div><dt>Street</dt><dd>${escapeHtml([billingAddress.suiteNumber ? `Suite ${billingAddress.suiteNumber}` : "", billingAddress.street1, billingAddress.street2].filter(Boolean).join(", "))}</dd></div>
                    <div><dt>City / State</dt><dd>${escapeHtml([billingAddress.city, billingAddress.stateOrProvince].filter(Boolean).join(", "))}</dd></div>
                    <div><dt>Postal code</dt><dd>${escapeHtml(billingAddress.postalCode || "Not captured")}</dd></div>
                    <div><dt>Country</dt><dd>${escapeHtml(billingAddress.countryOrRegion || "Not captured")}</dd></div>
                  </dl>`
                : billingLocation
                ? `<dl class="detail-list">
                    <div><dt>Source</dt><dd>Auto-filled from facility "${escapeHtml(billingLocation.name)}"</dd></div>
                    <div><dt>Street</dt><dd>${escapeHtml(billingLocation.address || "Not captured")}</dd></div>
                    <div><dt>City</dt><dd>${escapeHtml(billingLocation.city || "Not captured")}</dd></div>
                  </dl>`
                : `<div class="empty-state">No billing address on file yet.</div>`
            }
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Cases</h3></div>
          <div class="panel-body record-list">
            ${cases.slice(0, 5).map(renderAlertCard).join("") || `<div class="empty-state">No open cases or issues.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Open tasks</h3></div>
          <div class="panel-body task-list">
            ${openTasks.slice(0, 3).map(renderTaskRow).join("") || `<div class="empty-state">No open tasks for this account.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Sales tasks</h3>
            <button class="mini-button" type="button" data-action="open-sales-task" data-account-id="${account.id}">Add</button>
          </div>
          <div class="panel-body record-list">
            ${salesTasks.map(renderSalesTaskCard).join("") || `<div class="empty-state">No sales tasks for this account yet.</div>`}
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Timeline</h3>
            ${renderActivityPicker(account.id)}
          </div>
          <div class="panel-body">
            <input type="search" id="accountTimelineSearch" placeholder="Search this account's timeline" value="${escapeAttribute(state.accountTimelineSearch || "")}" />
            <div class="record-list" style="margin-top: 10px;">
              ${activities.map(renderTimelineItem).join("") || `<div class="empty-state">No activity yet.</div>`}
            </div>
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Owner &amp; primary contact</h3>
            <button class="mini-button" type="button" data-action="open-account-owner" data-id="${account.id}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Owner</dt><dd>${escapeHtml(account.owner || "Unassigned")}</dd></div>
              <div><dt>Primary contact</dt><dd>${escapeHtml(account.contact || "Not captured")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Industry</h3>
            <button class="mini-button" type="button" data-action="open-industries" data-account-id="${account.id}">Edit</button>
          </div>
          <div class="panel-body resource-chips">
            ${
              accountIndustryLinks
                .map((link) => {
                  const industry = findIndustry(link.industryId);
                  return `<span class="tag">${escapeHtml(industry?.industryName || "Unknown industry")}${link.isPrimary ? " (primary)" : ""}</span>`;
                })
                .join("") || `<div class="empty-state">No industries selected yet.</div>`
            }
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Contacts</h3>
            <button class="mini-button" type="button" data-action="open-contact" data-account-id="${account.id}">Add contact</button>
          </div>
          <div class="panel-body people-list">
            ${contacts.map(renderMiniContact).join("") || `<div class="empty-state">No contacts for this account yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderAccountDetailsTab(account) {
  const accountIndustryLinks = industriesForAccount(account.id);
  const vendorProfile = vendorProfileForAccount(account.id);
  const serviceAgreements = serviceAgreementsForAccount(account.id);
  const subcontractorAssignments = vendorProfile ? subcontractorAssignmentsForVendorProfile(vendorProfile.id) : [];
  const relationship = relationshipExtensionForAccount(account.id);

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Company profile</h3>
            <button class="mini-button" type="button" data-action="open-company-profile" data-account-id="${escapeAttribute(account.id)}">${relationship ? "Edit" : "Add"}</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Industry</dt><dd>${
                accountIndustryLinks
                  .map((link) => escapeHtml(findIndustry(link.industryId)?.industryName || "Unknown"))
                  .join(", ") || "Not set"
              }</dd></div>
              <div><dt>SIC code</dt><dd>${relationship?.sicCode ? escapeHtml(relationship.sicCode) : `<span class="muted">Not yet captured</span>`}</dd></div>
              <div><dt>Ownership</dt><dd>${relationship?.ownershipType ? escapeHtml(relationship.ownershipType) : `<span class="muted">Not yet captured</span>`}</dd></div>
              ${
                relationship?.isSubcontractor
                  ? `
                    <div><dt>Subcontractor permitted</dt><dd><span class="risk-badge ${relationship.subcontractorPermitted === "Approved" ? "low" : relationship.subcontractorPermitted === "Denied" ? "high" : "medium"}">${escapeHtml(relationship.subcontractorPermitted || "Unknown")}</span></dd></div>
                    <div><dt>Preapproval required</dt><dd>${relationship.subcontractorPreapprovalRequired ? "Yes" : "No"}</dd></div>
                  `
                  : ""
              }
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Vendor compliance</h3>
            <button class="mini-button" type="button" data-action="open-vendor-profile" data-account-id="${account.id}">${vendorProfile ? "Edit" : "Add"}</button>
          </div>
          <div class="panel-body">
            ${renderVendorProfileSummary(vendorProfile)}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Service agreements</h3>
            <button class="mini-button" type="button" data-action="open-service-agreement" data-account-id="${account.id}">Add</button>
          </div>
          <div class="panel-body record-list">
            ${serviceAgreements.map(renderServiceAgreementCard).join("") || `<div class="empty-state">No service agreements for this account yet.</div>`}
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Master Service Agreement</dt><dd><span class="stage-badge">${escapeHtml(relationship?.msaStatus || "Not Sent")}</span></dd></div>
              <div><dt>Certificate of Insurance</dt><dd><span class="stage-badge">${escapeHtml(relationship?.coiStatus || "Not Sent")}</span></dd></div>
              <div><dt>W-9</dt><dd><span class="stage-badge">${escapeHtml(relationship?.w9DocumentStatus || "Not Sent")}</span></dd></div>
            </dl>
            <button class="mini-button" type="button" data-action="open-document-status" data-account-id="${escapeAttribute(account.id)}">${relationship ? "Edit" : "Add"} document status</button>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Subcontractor assignments</h3>
            ${vendorProfile ? `<button class="mini-button" type="button" data-action="open-subcontractor-assignment" data-vendor-profile-id="${vendorProfile.id}">Add</button>` : ""}
          </div>
          <div class="panel-body record-list">
            ${
              vendorProfile
                ? subcontractorAssignments.map(renderSubcontractorAssignmentCard).join("") ||
                  `<div class="empty-state">No subcontractor assignments yet.</div>`
                : `<div class="empty-state">Add a vendor profile first to create assignments.</div>`
            }
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Contact &amp; marketing preferences</h3>
            <button class="mini-button" type="button" data-action="open-contact-preferences" data-account-id="${account.id}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Contact method</dt><dd>${escapeHtml(account.preferredContactMethod || "Any")}</dd></div>
              <div><dt>Email</dt><dd>${account.doNotAllowEmails ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Bulk email</dt><dd>${account.doNotAllowBulkEmail ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Phone</dt><dd>${account.doNotAllowPhoneCalls ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Fax</dt><dd>${account.doNotAllowFaxes ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Mail</dt><dd>${account.doNotAllowMail ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Marketing</dt><dd>${account.doNotAllowMarketing ? "Not allowed" : "Allowed"}</dd></div>
            </dl>
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Billing</h3>
            <button class="mini-button" type="button" data-action="open-account-billing" data-id="${account.id}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Currency</dt><dd>${escapeHtml(account.currency || "USD")}</dd></div>
              <div><dt>Credit hold</dt><dd>${account.creditHold ? "Yes" : "No"}</dd></div>
              <div><dt>Billing type</dt><dd>${escapeHtml(account.billingType || "Not set")}</dd></div>
              <div><dt>Billing interval</dt><dd>${escapeHtml(account.billingInterval || "Not set")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>AP / accounting</h3>
            <button class="mini-button" type="button" data-action="open-account-ap" data-id="${account.id}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>AP portal</dt><dd>${account.apPortalUrl ? escapeHtml(account.apPortalUrl) : `<span class="muted">Not yet captured</span>`}</dd></div>
              <div><dt>AP email</dt><dd>${account.apEmail ? escapeHtml(account.apEmail) : `<span class="muted">Not yet captured</span>`}</dd></div>
              <div><dt>AP contact</dt><dd>${account.apContact ? escapeHtml(account.apContact) : `<span class="muted">Not yet captured</span>`}</dd></div>
              <div><dt>PO required</dt><dd>${account.poRequired ? "Yes" : "No"}</dd></div>
              <div><dt>PO format</dt><dd>${account.poFormat ? escapeHtml(account.poFormat) : `<span class="muted">Not yet captured</span>`}</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderOrgChartContactRow(contact, divisions) {
  return `
    <div class="person-row">
      <div>
        <button class="link-button person-name" type="button" data-action="view-contact" data-id="${escapeAttribute(contact.id)}">
          ${escapeHtml(contact.name)}
        </button>
        <div class="row-meta">
          <span>${escapeHtml(contact.title)}</span>
        </div>
      </div>
      <select data-action="quick-set-division" data-contact-id="${escapeAttribute(contact.id)}" aria-label="Assign ${escapeAttribute(contact.name)} to a division">
        <option value="">Unassigned</option>
        ${divisions
          .map(
            (division) =>
              `<option value="${escapeAttribute(division.id)}" ${contact.divisionId === division.id ? "selected" : ""}>${escapeHtml(division.divisionName)}</option>`,
          )
          .join("")}
      </select>
    </div>
  `;
}

function renderAccountDivisionCard(division, contacts, allDivisions) {
  return `
    <article class="detail-card">
      <div class="row-meta">
        <strong>${escapeHtml(division.divisionName)}</strong>
        <button class="mini-button" type="button" data-action="remove-account-division" data-id="${escapeAttribute(division.id)}">Remove</button>
      </div>
      <div class="people-list">
        ${contacts.map((contact) => renderOrgChartContactRow(contact, allDivisions)).join("") || `<div class="empty-state">No contacts assigned yet.</div>`}
      </div>
    </article>
  `;
}

function renderAccountGeneralTab(account) {
  const relationship = relationshipExtensionForAccount(account.id);
  const divisions = accountDivisionsForAccount(account.id);
  const contacts = contactsForAccount(account.id);
  const unassignedContacts = contacts.filter(
    (contact) => !contact.divisionId || !divisions.some((division) => division.id === contact.divisionId),
  );
  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Business description</h3>
            <button class="mini-button" type="button" data-action="open-relationship-notes" data-account-id="${escapeAttribute(account.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <p class="help-text">${escapeHtml(relationship?.businessDescription || "Not yet captured.")}</p>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Relationship snapshot</h3>
            <button class="mini-button" type="button" data-action="open-relationship-snapshot" data-account-id="${escapeAttribute(account.id)}">${relationship ? "Edit" : "Add"}</button>
          </div>
          <div class="panel-body">
            ${renderAccountRelationshipSummary(relationship)}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>How we work with them</h3>
            <button class="mini-button" type="button" data-action="open-relationship-notes" data-account-id="${escapeAttribute(account.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <p class="help-text">${escapeHtml(relationship?.workingRelationshipNotes || "Not yet captured.")}</p>
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Company structure</h3>
            <button class="mini-button" type="button" data-action="open-account-division" data-account-id="${escapeAttribute(account.id)}">Add division</button>
          </div>
          <div class="panel-body record-list">
            ${
              divisions.length
                ? divisions
                    .map((division) =>
                      renderAccountDivisionCard(division, contacts.filter((contact) => contact.divisionId === division.id), divisions),
                    )
                    .join("")
                : `<div class="empty-state">No divisions yet. Add one to start grouping contacts.</div>`
            }
            ${
              divisions.length && unassignedContacts.length
                ? `
                  <article class="detail-card">
                    <strong>Unassigned</strong>
                    <div class="people-list">
                      ${unassignedContacts.map((contact) => renderOrgChartContactRow(contact, divisions)).join("")}
                    </div>
                  </article>
                `
                : ""
            }
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderAccountListPanel(title, items, renderItem, seeAllAction, accountId, emptyText) {
  const top = items.slice(0, 3);
  return `
    <article class="panel">
      <div class="panel-header">
        <h3>${escapeHtml(title)}</h3>
        ${
          items.length
            ? `<button class="mini-button" type="button" data-action="${escapeAttribute(seeAllAction)}" data-account-id="${escapeAttribute(accountId)}">See all (${items.length})</button>`
            : ""
        }
      </div>
      <div class="panel-body record-list">
        ${top.map(renderItem).join("") || `<div class="empty-state">${escapeHtml(emptyText)}</div>`}
      </div>
    </article>
  `;
}

function renderOpportunityMiniCard(opportunity) {
  const closeStatus = getCloseStatus(opportunity.closeDate);
  return `
    <article class="detail-card">
      <button class="link-button" type="button" data-action="view-opportunity" data-id="${escapeAttribute(opportunity.id)}">${escapeHtml(opportunity.name)}</button>
      <div class="row-meta">
        <span>${money(opportunity.value)}</span>
        <span>${escapeHtml(opportunity.stage)}</span>
      </div>
      <div class="inline-actions">
        <span class="risk-badge ${closeStatus.tone}">${escapeHtml(closeStatus.label)}</span>
      </div>
    </article>
  `;
}

function renderOpsProjectMiniCard(job) {
  const progress = getJobProgress(job);
  return `
    <article class="detail-card">
      <button class="link-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">${escapeHtml(job.name)}</button>
      <div class="row-meta">
        <span>${escapeHtml(job.jobClass)}</span>
        <span>${escapeHtml(job.status)}</span>
      </div>
      <div class="inline-actions">
        <span class="risk-badge ${progress.tone}">${progress.percent}%</span>
      </div>
    </article>
  `;
}

function renderDispatchMiniCard(dispatchJob) {
  return `
    <article class="detail-card">
      <button class="link-button" type="button" data-action="view-dispatch-job" data-id="${escapeAttribute(dispatchJob.id)}">${escapeHtml(dispatchJob.jobNumber)} · ${escapeHtml(dispatchJob.jobName)}</button>
      <div class="row-meta">
        <span>${formatDateTime(dispatchJob.scheduledStart)}</span>
      </div>
      <div class="inline-actions">
        ${renderDispatchStatusBadge(formatDispatchStatus(dispatchJob.status))}
      </div>
    </article>
  `;
}

function renderAccountProjectsTab(account) {
  const opportunities = opportunitiesForAccount(account.id);
  const activeOpportunities = opportunities.filter((opportunity) => opportunity.stage !== "Won");
  const wonOpportunities = opportunities.filter((opportunity) => opportunity.stage === "Won");

  const opsProjects = projectsForAccount(account.id);
  const activeOpsProjects = opsProjects.filter((job) => !isOpsProjectClosed(job));
  const closedOpsProjects = opsProjects.filter((job) => isOpsProjectClosed(job));
  const historicalProjects = opsProjects.filter((job) => job.status === "Complete");

  const dispatchJobs = dispatchJobsForAccount(account.id);
  const activeDispatchJobs = dispatchJobs.filter((job) => !isTerminalDispatchStatus(job.status));
  const closedDispatchJobs = dispatchJobs.filter((job) => isTerminalDispatchStatus(job.status));

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        ${renderAccountListPanel("Active opportunities", activeOpportunities, renderOpportunityMiniCard, "see-all-opportunities", account.id, "No active opportunities.")}
        ${renderAccountListPanel("Won opportunities", wonOpportunities, renderOpportunityMiniCard, "see-all-opportunities", account.id, "No won opportunities yet.")}
      </div>
      <div class="detail-stack">
        ${renderAccountListPanel("Active projects", activeOpsProjects, renderOpsProjectMiniCard, "see-all-projects", account.id, "No active projects.")}
        ${renderAccountListPanel("Closed projects", closedOpsProjects, renderOpsProjectMiniCard, "see-all-projects", account.id, "No closed projects yet.")}
        <article class="panel">
          <div class="panel-header"><h3>Previous projects</h3></div>
          <div class="panel-body record-list">
            ${historicalProjects.map(renderProjectCard).join("") || `<div class="empty-state">No previous projects logged.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        ${renderAccountListPanel("Active dispatch", activeDispatchJobs, renderDispatchMiniCard, "see-all-dispatch", account.id, "No active dispatch jobs.")}
        ${renderAccountListPanel("Closed dispatch", closedDispatchJobs, renderDispatchMiniCard, "see-all-dispatch", account.id, "No closed dispatch jobs yet.")}
      </div>
    </section>
  `;
}

function isSamplingSessionActive(session) {
  return session.samples.some((sample) => /pending|transit|logged|expedited/i.test(sample.labStatus || ""));
}

function getSampleResultTone(sample) {
  return /above|exceed|hit|action level/i.test(`${sample.labStatus || ""} ${sample.results || sample.labResults || ""}`)
    ? "high"
    : /pending|transit|logged|expedited/i.test(sample.labStatus || "")
      ? "medium"
      : "low";
}

function renderSamplingSessionCard(session) {
  const sampleCount = session.samples.length;
  const latest = session.samples[session.samples.length - 1];
  const job = latest?.projectId ? findProject(latest.projectId) : null;
  return `
    <article class="detail-card">
      <button class="link-button" type="button" data-action="view-sample" data-id="${escapeAttribute(latest?.id || "")}">${escapeHtml(session.label)}</button>
      <div class="row-meta">
        <span>${sampleCount} sample${sampleCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(session.labName)}</span>
        ${job ? `<span>${escapeHtml(job.name)}</span>` : ""}
      </div>
      <p class="help-text">${escapeHtml(latest?.labStatus || "Pending")}</p>
    </article>
  `;
}

function renderSampleTimelineItem(sample) {
  const tone = getSampleResultTone(sample);
  return `
    <article class="timeline-item">
      <div class="row-meta">
        <span class="stage-badge">${escapeHtml(sample.sampleType || "Sample")}</span>
        <span class="risk-badge ${tone}">${escapeHtml(sample.labStatus || "Pending")}</span>
        <span>${formatDate(sample.collectionTime)}</span>
      </div>
      <button class="link-button" type="button" data-action="view-sample" data-id="${escapeAttribute(sample.id)}">${escapeHtml(sample.sampleId || sample.id)}</button>
      <p>${escapeHtml(sample.sampleLocation || "Sample location not captured")}</p>
      <div class="row-meta">
        <span>${escapeHtml(sample.labName || "Lab not assigned")}</span>
        <span>${escapeHtml(sample.collector || "Collector not captured")}</span>
      </div>
    </article>
  `;
}

function renderAccountLabWorkTab(account) {
  const samples = sampleRecordsForAccount(account.id);
  const sessions = groupSamplesIntoSessions(samples).sort((a, b) => {
    const aLatest = a.samples[a.samples.length - 1]?.collectionTime || 0;
    const bLatest = b.samples[b.samples.length - 1]?.collectionTime || 0;
    return new Date(bLatest) - new Date(aLatest);
  });
  const activeSessions = sessions.filter(isSamplingSessionActive);
  const historicalSessions = sessions.filter((session) => !isSamplingSessionActive(session));
  const recentSamples = [...samples].sort((a, b) => new Date(b.collectionTime) - new Date(a.collectionTime));

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Active sampling events</h3></div>
          <div class="panel-body record-list">
            ${activeSessions.map(renderSamplingSessionCard).join("") || `<div class="empty-state">No active sampling events.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Recent sample results</h3></div>
          <div class="panel-body record-list">
            ${recentSamples.slice(0, 6).map(renderSampleTimelineItem).join("") || `<div class="empty-state">No sample records yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Historical sampling events</h3></div>
          <div class="panel-body record-list">
            ${historicalSessions.map(renderSamplingSessionCard).join("") || `<div class="empty-state">No historical sampling events yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderAccountFilesTab(account) {
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header"><h3>Documents</h3></div>
        <div class="panel-body"><div class="empty-state">Document storage isn't built yet.</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Photos</h3></div>
        <div class="panel-body"><div class="empty-state">Photo storage isn't built yet.</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Signed agreements</h3></div>
        <div class="panel-body"><div class="empty-state">Signed agreement storage isn't built yet.</div></div>
      </article>
    </section>
  `;
}

function renderAccountFacilitiesTab(account) {
  const locations = locationsForAccount(account.id);
  return `
    <section class="detail-stack">
      <article class="panel">
        <div class="panel-header">
          <h3>Facilities and Locations</h3>
          <button class="mini-button" type="button" data-action="open-account-location" data-account-id="${escapeAttribute(account.id)}">Add</button>
        </div>
        <div class="panel-body record-list">
          ${locations.map(renderLocationCard).join("") || `<div class="empty-state">No facilities or locations for this account yet.</div>`}
        </div>
      </article>
    </section>
  `;
}

function renderAccountCommentCard(comment) {
  return `
    <article class="detail-card">
      <div class="row-meta">
        <span>${escapeHtml(comment.authorName || "Local user")}</span>
        <span>${formatDate(comment.createdAt)}</span>
      </div>
      <p class="help-text">${escapeHtml(comment.body)}</p>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="remove-account-comment" data-id="${escapeAttribute(comment.id)}">Remove</button>
      </div>
    </article>
  `;
}

function renderAccountHealthTab(account) {
  const issues = alertsForAccount(account.id);
  const comments = accountCommentsForAccount(account.id);
  const relationship = relationshipExtensionForAccount(account.id);
  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Issues</h3></div>
          <div class="panel-body record-list">
            ${issues.map(renderAlertCard).join("") || `<div class="empty-state">No field alerts for this account.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Concern comments</h3>
            <button class="mini-button" type="button" data-action="open-account-comment" data-account-id="${escapeAttribute(account.id)}">Add</button>
          </div>
          <div class="panel-body record-list">
            ${comments.map(renderAccountCommentCard).join("") || `<div class="empty-state">No concern comments yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Account status</h3>
            <button class="mini-button" type="button" data-action="open-account-pause" data-account-id="${escapeAttribute(account.id)}">${relationship?.isPaused ? "Edit" : "Pause account"}</button>
          </div>
          <div class="panel-body">
            ${renderAccountPauseSummary(relationship)}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderCoreFieldSection(record, section, formatter) {
  return `
    <details class="account-field-section" ${section.defaultOpen ? "open" : ""}>
      <summary>${escapeHtml(section.label)}</summary>
      <dl class="core-field-grid">
        ${section.fields
          .map(
            (field) => `
              <div>
                <dt>${escapeHtml(field.label)}</dt>
                <dd>${escapeHtml(formatter(record, field.key))}</dd>
              </div>
            `,
          )
          .join("")}
      </dl>
    </details>
  `;
}

function renderSalesTaskCard(task) {
  const contact = findContact(task.contactId);
  return `
    <article class="detail-card">
      <button class="link-button person-name" type="button" data-action="open-sales-task" data-id="${task.id}" data-account-id="${task.accountId}">
        ${escapeHtml(task.subject)}
      </button>
      <div class="row-meta">
        <span>${task.dueDate ? `Due ${formatDate(task.dueDate)}` : "No due date"}</span>
        <span>${escapeHtml(contact?.name || "No contact")}</span>
      </div>
      <p class="help-text">${escapeHtml(task.description || "")}</p>
      <div class="inline-actions">
        <span class="stage-badge">${escapeHtml(task.priority)}</span>
        <span class="tag">${escapeHtml(task.activityStatus)}</span>
        ${task.activityStatus !== "Completed" ? `<button class="mini-button" type="button" data-action="complete-sales-task" data-id="${task.id}">Complete</button>` : ""}
        <button class="mini-button" type="button" data-action="remove-sales-task" data-id="${task.id}">Remove</button>
      </div>
    </article>
  `;
}

function renderServiceAgreementCard(agreement) {
  return `
    <article class="detail-card">
      <button class="link-button person-name" type="button" data-action="open-service-agreement" data-id="${agreement.id}" data-account-id="${agreement.accountId}">
        ${escapeHtml(agreement.agreementName)}
      </button>
      <div class="row-meta">
        <span>${escapeHtml(agreement.agreementType || "No type set")}</span>
        <span>${agreement.effectiveStart ? formatDate(agreement.effectiveStart) : "No start date"}${agreement.effectiveEnd ? ` - ${formatDate(agreement.effectiveEnd)}` : ""}</span>
      </div>
      <p class="help-text">${escapeHtml(agreement.scopeOfWork || "")}</p>
      <div class="inline-actions">
        <span class="stage-badge">${escapeHtml(agreement.agreementStatus || "Draft")}</span>
        ${agreement.totalContractValue ? `<span class="tag">$${Number(agreement.totalContractValue).toLocaleString()}</span>` : ""}
        <button class="mini-button" type="button" data-action="remove-service-agreement" data-id="${agreement.id}">Remove</button>
      </div>
    </article>
  `;
}

function renderSubcontractorAssignmentCard(assignment) {
  return `
    <article class="detail-card">
      <button class="link-button person-name" type="button" data-action="open-subcontractor-assignment" data-id="${assignment.id}" data-vendor-profile-id="${assignment.vendorProfileId}">
        ${escapeHtml(assignment.assignmentName)}
      </button>
      <div class="row-meta">
        <span>${escapeHtml(assignment.rateType || "No rate type")}${assignment.rateAmount ? ` - $${Number(assignment.rateAmount).toLocaleString()}` : ""}</span>
        <span>${assignment.startDate ? formatDate(assignment.startDate) : "No start date"}${assignment.endDate ? ` - ${formatDate(assignment.endDate)}` : ""}</span>
      </div>
      <p class="help-text">${escapeHtml(assignment.scopeOfWork || "")}</p>
      <div class="inline-actions">
        <span class="stage-badge">${escapeHtml(assignment.assignmentStatus || "Requested")}</span>
        <button class="mini-button" type="button" data-action="remove-subcontractor-assignment" data-id="${assignment.id}">Remove</button>
      </div>
    </article>
  `;
}

function renderVendorProfileSummary(profile) {
  if (!profile) {
    return `<div class="empty-state">No vendor profile yet. Add one to track onboarding, insurance, and compliance.</div>`;
  }
  const subcontractorType = findSubcontractorType(profile.subcontractorTypeId);
  const approver = (state.backend.systemUsers || []).find((user) => user.id === profile.approvedById);
  return `
    <dl class="detail-list">
      <div><dt>Vendor #</dt><dd>${escapeHtml(profile.vendorNumber || "Not set")}</dd></div>
      <div><dt>Type</dt><dd>${escapeHtml(subcontractorType?.name || "Not set")}</dd></div>
      <div><dt>Onboarding</dt><dd><span class="stage-badge">${escapeHtml(profile.onboardingStatus || "Candidate")}</span>${approver ? ` <span class="tag">Approved by ${escapeHtml(approver.fullName)}</span>` : ""}</dd></div>
      <div><dt>Insurance</dt><dd>${escapeHtml(profile.insuranceStatus || "Not set")}${profile.insuranceExpiration ? ` (exp. ${formatDate(profile.insuranceExpiration)})` : ""}</dd></div>
      <div><dt>W-9</dt><dd>${escapeHtml(profile.w9Status || "Missing")}</dd></div>
      <div><dt>Safety</dt><dd>${escapeHtml(profile.safetyStatus || "Pending")}</dd></div>
      ${profile.isSuspended ? `<div><dt>Status</dt><dd><span class="risk-badge high">Suspended</span></dd></div>` : ""}
    </dl>
  `;
}

function renderAccountRelationshipSummary(record) {
  if (!record) {
    return `<div class="empty-state">No relationship details yet. Add them to track client, vendor, and subcontractor status.</div>`;
  }
  const accountType = findAccountType(record.accountTypeId);
  const flags = [
    record.isClient ? "Client" : "",
    record.isProspect ? "Prospect" : "",
    record.isVendor ? "Vendor" : "",
    record.isSubcontractor ? "Subcontractor" : "",
  ].filter(Boolean);
  return `
    <dl class="detail-list">
      <div><dt>Type</dt><dd>${escapeHtml(accountType?.name || "Not set")}</dd></div>
      <div><dt>Relationship</dt><dd><span class="stage-badge">${escapeHtml(record.relationshipStatus || "Not set")}</span></dd></div>
      <div><dt>Primary role</dt><dd>${escapeHtml(record.primaryRelationship || "Not set")}</dd></div>
      <div><dt>Customer status</dt><dd>${escapeHtml(record.customerStatus || "Not set")}</dd></div>
      <div><dt>Flags</dt><dd>${flags.map((flag) => `<span class="tag">${escapeHtml(flag)}</span>`).join(" ") || "None"}</dd></div>
      <div><dt>Subcontracting</dt><dd><span class="risk-badge ${record.eligibleForSubcontracting ? "low" : "high"}">${record.eligibleForSubcontracting ? "Eligible" : "Not eligible"}</span></dd></div>
    </dl>
  `;
}

function renderMiniContact(contact) {
  return `
    <div class="person-row">
      <div>
        <button class="link-button person-name" type="button" data-action="view-contact" data-id="${contact.id}">
          ${escapeHtml(contact.name)}
        </button>
        <div class="row-meta">
          <span>${escapeHtml(contact.title)}</span>
          <span>${escapeHtml(contact.preferredContact)}</span>
        </div>
      </div>
      <span class="stage-badge">${escapeHtml(contact.influence)}</span>
      <button class="mini-button" type="button" data-action="open-contact" data-account-id="${escapeAttribute(contact.accountId)}" data-id="${escapeAttribute(contact.id)}">Edit</button>
    </div>
  `;
}

function formatLocationCategory(location) {
  const category = location.category || (location.type ? "Other" : "");
  if (!category) return "Uncategorized";
  if (category === "Other") return location.categoryOther || location.type || "Other";
  return category;
}

function renderLocationCard(location) {
  const cityState = [location.city, location.stateOrProvince].filter(Boolean).join(", ");
  return `
    <article class="detail-card">
      <strong>${escapeHtml(location.name)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(location.street1 || location.address || "")}</span>
        <span>${escapeHtml(cityState || location.city || "")}</span>
      </div>
      ${location.concern ? `<p class="help-text">${escapeHtml(location.concern)}</p>` : ""}
      ${location.access ? `<p class="help-text">${escapeHtml(location.access)}</p>` : ""}
      <div class="inline-actions">
        <span class="tag">${escapeHtml(formatLocationCategory(location))}</span>
        <span class="stage-badge">${escapeHtml(location.status)}</span>
        <button class="mini-button" type="button" data-action="open-account-location" data-account-id="${escapeAttribute(location.accountId)}" data-id="${escapeAttribute(location.id)}">Edit</button>
      </div>
    </article>
  `;
}

function renderProjectCard(project) {
  return `
    <article class="detail-card">
      <strong>${escapeHtml(project.name)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(project.serviceType)}</span>
        <span>${formatDate(project.completedDate)}</span>
        <span>${money(project.value)}</span>
      </div>
      <p class="help-text">${escapeHtml(project.outcome)}</p>
    </article>
  `;
}

function renderScheduledWorkCard(work) {
  const opportunity = findOpportunity(work.opportunityId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(work.title)}</strong>
      <div class="row-meta">
        <span>${formatDate(work.date)}</span>
        <span>${escapeHtml(work.crew)}</span>
        <span>${escapeHtml(work.status)}</span>
      </div>
      ${opportunity ? `<p class="help-text">${escapeHtml(opportunity.name)}</p>` : ""}
    </article>
  `;
}

function renderScheduleEventCard(work) {
  const job = findProject(work.projectId);
  const account = job ? findAccount(job.accountId) : null;
  const blocked = Boolean(work.blockedReason);
  return `
    <article class="detail-card ${blocked ? "blocked-card" : ""}">
      <strong>${escapeHtml(work.title)}</strong>
      <div class="row-meta">
        <span>${formatDate(work.date)}</span>
        <span>${escapeHtml(work.crew)}</span>
        <span>${escapeHtml(work.status)}</span>
      </div>
      <p class="help-text">${escapeHtml(job?.name || "No job linked")} ${account ? `- ${escapeHtml(account.name)}` : ""}</p>
      <div class="inline-actions">
        ${(work.equipmentAssetTags || []).map((assetTag) => `<span class="tag">${escapeHtml(assetTag)}</span>`).join("")}
        ${(work.requiredCertifications || []).map((certification) => `<span class="stage-badge">${escapeHtml(certification)}</span>`).join("")}
      </div>
      ${blocked ? `<div class="scheduler-alert">${escapeHtml(work.blockedReason)}</div>` : ""}
    </article>
  `;
}

function renderProjectSpatialRecord(spatial) {
  const scanQuality = spatial.scanQuality || "Registration pending";
  const pointCount = spatial.pointCount || "Point count not captured";
  const coverage = spatial.coverage || "Project area";
  const modelPath = spatial.modelPath || (spatial.storagePath?.toLowerCase().endsWith(".glb") ? spatial.storagePath : "");
  if (modelPath) {
    return `
      <article class="model-spatial-record">
        <div class="project-model-viewer" data-model-src="${escapeAttribute(modelPath)}" data-model-title="${escapeAttribute(spatial.fileType || "3D site render")}">
          <div class="model-viewer-status">Loading 3D render...</div>
          <div class="model-viewer-toolbar" aria-label="3D viewer camera controls">
            <button class="model-viewer-button" type="button" data-model-command="top" title="Top-down view">Top</button>
            <button class="model-viewer-button" type="button" data-model-command="bottom" title="Bottom-up view">Bottom</button>
            <button class="model-viewer-button" type="button" data-model-command="left" title="Left side view">Left</button>
            <button class="model-viewer-button" type="button" data-model-command="right" title="Right side view">Right</button>
            <button class="model-viewer-button" type="button" data-model-command="angle" title="Angled inspection view">Angle</button>
            <button class="model-viewer-button" type="button" data-model-command="auto" title="Toggle slow rotation">Auto</button>
          </div>
        </div>
        <div class="detail-card">
          <strong>${escapeHtml(spatial.fileType || "3D site render")}</strong>
          <div class="row-meta">
            <span>${formatDate(spatial.scanDate)}</span>
            <span>${escapeHtml(spatial.uploadedBy || "Unknown uploader")}</span>
            <span>${escapeHtml(scanQuality)}</span>
          </div>
          <p class="help-text">${escapeHtml(spatial.annotations || "No annotations captured.")}</p>
          <div class="inline-actions">
            <span class="tag">${escapeHtml(pointCount)}</span>
            <span class="tag">${escapeHtml(coverage)}</span>
          </div>
          <code class="file-ref">${escapeHtml(spatial.storagePath || modelPath)}</code>
        </div>
      </article>
    `;
  }

  return `
    <article class="lidar-record">
      <div class="lidar-render" aria-label="LiDAR render preview">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="detail-card">
        <strong>${escapeHtml(spatial.fileType || "LiDAR point cloud")}</strong>
        <div class="row-meta">
          <span>${formatDate(spatial.scanDate)}</span>
          <span>${escapeHtml(spatial.uploadedBy || "Unknown uploader")}</span>
          <span>${escapeHtml(scanQuality)}</span>
        </div>
        <p class="help-text">${escapeHtml(spatial.annotations || "No annotations captured.")}</p>
        <div class="inline-actions">
          <span class="tag">${escapeHtml(pointCount)}</span>
          <span class="tag">${escapeHtml(coverage)}</span>
        </div>
        <code class="file-ref">${escapeHtml(spatial.storagePath || "No storage path captured")}</code>
      </div>
    </article>
  `;
}

function renderEmptyLidarPlaceholder(job) {
  return `
    <article class="lidar-record">
      <div class="lidar-render empty-lidar" aria-label="LiDAR render placeholder">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="detail-card">
        <strong>No LiDAR file linked</strong>
        <p class="help-text">${escapeHtml(job.name)} is ready for a scan, orthomosaic, point cloud, or excavation boundary file.</p>
      </div>
    </article>
  `;
}

function renderSampleSession(session) {
  return `
    <details class="sample-session" open>
      <summary>
        <span>${escapeHtml(session.label)}</span>
        <small>${session.samples.length} samples - ${escapeHtml(session.labName)}</small>
      </summary>
      <div class="sample-session-body">
        ${session.samples.map(renderProjectSampleRecord).join("")}
      </div>
    </details>
  `;
}

function renderProjectSampleMap(job, samples) {
  const mappedSamples = samples.filter((sample) => Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude)));
  return `
    <article class="panel">
      <div class="panel-header">
        <div>
          <h3>Site sample map</h3>
          <span>${mappedSamples.length} GPS sample locations tied to ${escapeHtml(job.name)}.</span>
        </div>
      </div>
      <div class="panel-body project-map-panel">
        <div id="projectSampleMap" class="project-sample-map" aria-label="Project sample location map"></div>
        <div class="project-map-list">
          ${mappedSamples.map(renderProjectMapPoint).join("") || `<div class="empty-state">No sample GPS points captured yet.</div>`}
        </div>
      </div>
    </article>
  `;
}

function renderProjectMapPoint(sample) {
  return `
    <button class="legend-row map-list-item sample-map-link" type="button" data-action="view-sample" data-id="${escapeAttribute(sample.id)}" aria-label="Open sample ${escapeAttribute(sample.sampleId || sample.id)}">
      <span class="map-dot sample"></span>
      <div>
        <strong>${escapeHtml(sample.sampleId || sample.id)}</strong>
        <span>${escapeHtml(sample.sampleLocation || "Sample location")}</span>
        <span>${Number(sample.latitude).toFixed(6)}, ${Number(sample.longitude).toFixed(6)}</span>
      </div>
      <span class="sample-map-link-label">Open</span>
    </button>
  `;
}

function renderProjectSampleRecord(sample) {
  const coordinates = getSampleCoordinates(sample);
  const photos = sample.photos?.length ? sample.photos : ["North view", "Sample interval", "Container label"];
  const results = sample.results || sample.labResults || "Pending lab result.";
  return `
    <article class="sample-record-card">
      <div>
        <button class="link-button account-name" type="button" data-action="view-sample" data-id="${escapeAttribute(sample.id)}">
          ${escapeHtml(sample.sampleId || sample.id)}
        </button>
        <div class="row-meta">
          <span>${escapeHtml(sample.sampleLocation)}</span>
          <span>${escapeHtml(sample.sampleType)}</span>
          <span>${formatDate(sample.collectionTime)}</span>
        </div>
      </div>
      <dl class="detail-list compact-detail-list">
        <div><dt>Lab</dt><dd>${escapeHtml(sample.labName || "Lab not assigned")}</dd></div>
        <div><dt>COC</dt><dd>${escapeHtml(sample.chainOfCustody || "Not captured")}</dd></div>
        <div><dt>GPS</dt><dd>${escapeHtml(coordinates)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(sample.labStatus || "Pending")}</dd></div>
        <div><dt>Results</dt><dd>${escapeHtml(results)}</dd></div>
      </dl>
      <div class="sample-photo-grid">
        ${photos.map((photo) => `<span>${escapeHtml(typeof photo === "string" ? photo : photo.label || "Photo")}</span>`).join("")}
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-sample" data-id="${escapeAttribute(sample.id)}">Open sample record</button>
      </div>
    </article>
  `;
}

function renderProjectChronologyItem(event) {
  return `
    <details class="project-event-item" ${event.defaultOpen ? "open" : ""}>
      <summary>
        <span>${formatDate(event.timestamp)}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <em>${escapeHtml(event.kind)}</em>
      </summary>
      <div class="project-event-body">
        <p class="help-text">${escapeHtml(event.detail)}</p>
        ${event.meta?.length ? `<div class="inline-actions">${event.meta.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      </div>
    </details>
  `;
}

function renderAccountOpportunityCard(opportunity) {
  const contacts = contactsForOpportunity(opportunity.id);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(opportunity.name)}</strong>
      <div class="row-meta">
        <span>${money(opportunity.value)}</span>
        <span>${escapeHtml(opportunity.stage)}</span>
        <span>Close ${formatDate(opportunity.closeDate)}</span>
      </div>
      <p class="help-text">${escapeHtml(opportunity.nextStep)}</p>
      <div class="inline-actions">
        ${contacts.map((contact) => `<button class="mini-button" type="button" data-action="view-contact" data-id="${contact.id}">${escapeHtml(contact.name)}</button>`).join("") || `<span class="tag">No contacts linked</span>`}
      </div>
    </article>
  `;
}

function renderContacts() {
  const activeView = contactTableViews[state.contactTableView] || contactTableViews.sales;
  const search = state.contactSearch.trim().toLowerCase();
  const contacts = state.contacts.filter((contact) => {
    const account = findAccount(contact.accountId);
    const opportunities = opportunitiesForContact(contact);
    if (!search) return true;
    return [
      ...contactCoreFields.map((field) => getContactFieldValue(contact, field.key)),
      account?.name,
      ...opportunities.map((opp) => opp.name),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
  const decisionMakers = state.contacts.filter((contact) => contact.influence === "Decision maker").length;
  const champions = state.contacts.filter((contact) => contact.influence === "Champion").length;
  const contactsWithDeals = state.contacts.filter((contact) => contact.opportunityIds?.length).length;
  const accountsWithoutDecisionMaker = state.accounts.filter(
    (account) => !contactsForAccount(account.id).some((contact) => contact.influence === "Decision maker"),
  ).length;

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader("sales", "Contacts", "Role-specific contact views built from one shared Contact table.")}
      <section class="metric-strip" aria-label="Contact coverage metrics">
        <div class="metric">
          <p class="eyebrow">Decision makers</p>
          <strong>${decisionMakers}</strong>
          <span>Named budget or approval owners</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Champions</p>
          <strong>${champions}</strong>
          <span>Internal advocates and guides</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Deal-linked people</p>
          <strong>${contactsWithDeals}</strong>
          <span>Contacts attached to opportunities</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Coverage gaps</p>
          <strong>${accountsWithoutDecisionMaker}</strong>
          <span>Accounts missing a decision maker</span>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>${escapeHtml(activeView.label)}</h3>
            <span>${escapeHtml(activeView.description)}</span>
          </div>
          <div class="list-toolbar">
            ${renderCompactSearch("contactSearch", "Search contacts or opportunities", state.contactSearch)}
            <button class="primary-button" type="button" data-action="open-contact">New contact</button>
            ${renderCompactSelect(
              "contactTableView",
              VIEW_ICON_SVG,
              "Contact table view",
              Object.entries(contactTableViews)
                .map(
                  ([viewId, view]) =>
                    `<option value="${escapeAttribute(viewId)}" ${viewId === state.contactTableView ? "selected" : ""}>${escapeHtml(view.label)}</option>`,
                )
                .join(""),
            )}
          </div>
        </div>
        <div class="panel-body">
          <table class="data-table">
            <thead>
              <tr>
                ${activeView.columns.map((columnKey) => `<th>${escapeHtml(getContactColumnLabel(columnKey))}</th>`).join("")}
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${
                contacts.map((contact) => renderContactTableRow(contact, activeView)).join("") ||
                `<tr><td colspan="${activeView.columns.length + 1}"><div class="empty-state">No contacts match that search.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderContactTableRow(contact, view) {
  return `
    <tr>
      ${view.columns.map((columnKey) => renderContactTableCell(contact, columnKey)).join("")}
      <td data-label="Actions">
        <button class="mini-button" type="button" data-action="view-contact" data-id="${contact.id}">Open</button>
      </td>
    </tr>
  `;
}

function renderContactTableCell(contact, columnKey) {
  return `<td data-label="${escapeAttribute(getContactColumnLabel(columnKey))}">${renderContactColumnValue(contact, columnKey)}</td>`;
}

function getContactColumnLabel(columnKey) {
  const computedLabels = {
    linkedOpportunities: "Opportunity Links",
    communicationPreference: "Communication Preference",
  };
  return computedLabels[columnKey] || contactFieldLookup.get(columnKey)?.label || sentenceCase(columnKey);
}

function renderContactColumnValue(contact, columnKey) {
  const account = findAccount(contact.accountId);
  const opportunities = opportunitiesForContact(contact);

  if (columnKey === "fullName") {
    return `
      <button class="link-button person-name" type="button" data-action="view-contact" data-id="${contact.id}">
        ${escapeHtml(getContactFieldValue(contact, "fullName"))}
      </button>
      <div class="row-meta">
        <span>${escapeHtml(getContactFieldValue(contact, "jobTitle"))}</span>
        <span>${escapeHtml(getContactFieldValue(contact, "email"))}</span>
      </div>
    `;
  }

  if (columnKey === "accountName") {
    return account
      ? `<button class="link-button" type="button" data-action="view-account" data-id="${contact.accountId}">${escapeHtml(account.name)}</button>`
      : escapeHtml(getContactFieldValue(contact, "accountName") || "Unknown account");
  }

  if (columnKey === "relationshipRole" || columnKey === "accountRole") {
    return escapeHtml(getContactFieldValue(contact, columnKey));
  }

  if (columnKey === "linkedOpportunities") {
    return `
      <div class="chip-list">
        ${
          opportunities
            .map((opportunity) => `<button class="mini-button" type="button" data-action="view-opportunity" data-id="${opportunity.id}">${escapeHtml(opportunity.name)}</button>`)
            .join("") || `<span class="tag">No opportunity linked</span>`
        }
      </div>
    `;
  }

  if (columnKey === "communicationPreference") {
    const blocks = [
      getContactFieldValue(contact, "doNotAllowEmails") ? "Email blocked" : "Email ok",
      getContactFieldValue(contact, "doNotAllowPhoneCalls") ? "Phone blocked" : "Phone ok",
      getContactFieldValue(contact, "doNotAllowMail") ? "Mail blocked" : "Mail ok",
    ];
    return `<div class="row-meta">${blocks.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  return escapeHtml(formatContactFieldValue(contact, columnKey));
}

const contactDetailTabs = [
  { id: "summary", label: "Summary" },
  { id: "details", label: "Details" },
  { id: "communications", label: "Communications" },
  { id: "opportunities", label: "Opportunities" },
  { id: "projects", label: "Projects" },
  { id: "relationships", label: "Relationships" },
  { id: "files", label: "Files" },
];

function renderContactDetail() {
  const contact = findContact(state.selectedContactId);
  if (!contact) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Contact not found</h2>
        <button class="secondary-button" type="button" data-action="back-to-contacts">Back to contacts</button>
      </section>
    `;
    return;
  }

  const activeTab = state.contactDetailTab || "summary";

  app.innerHTML = `
    <section class="view">
      <div class="account-detail-shell">
        ${renderContactDetailHeader(contact)}
        <div class="account-detail-tabs-row">
          ${renderContactDetailTabs(activeTab)}
        </div>
        <div class="account-detail-tabbody">
          ${renderContactTabBody(activeTab, contact)}
        </div>
      </div>
    </section>
  `;
}

function renderContactDetailHeader(contact) {
  const account = findAccount(contact.accountId);
  const core = getCoreContact(contact);
  const opportunities = opportunitiesForContact(contact);
  const openOpportunities = opportunities.filter((opportunity) => getCoreOpportunity(opportunity).status === "Open");
  return `
    <div class="account-hero">
      <div class="account-hero-identity">
        <span class="person-avatar large">${escapeHtml(getInitials(contact.name, "CO"))}</span>
        <div>
          <div class="account-hero-backrow">
            <button class="text-button" type="button" data-action="back-to-contacts">Back to contacts</button>
            ${account ? `<button class="secondary-button" type="button" data-action="view-account" data-id="${escapeAttribute(account.id)}">Open account</button>` : ""}
            <button class="secondary-button" type="button" data-action="open-contact" data-account-id="${escapeAttribute(contact.accountId)}" data-id="${escapeAttribute(contact.id)}">Edit contact</button>
          </div>
          <h2>${escapeHtml(contact.name)}</h2>
          <p class="eyebrow">${escapeHtml(contact.title || "Contact")}${account ? ` at ${escapeHtml(account.name)}` : ""}</p>
        </div>
      </div>
      <div class="account-hero-stats">
        <span class="stage-badge">${escapeHtml(core.lifecycleStage || "Lead")}</span>
        <span class="risk-badge medium">${escapeHtml(core.relationshipRole || core.influence || "Unknown")}</span>
        <div class="metric account-hero-metric">
          <p class="eyebrow">Open Opportunities</p>
          <strong>${openOpportunities.length}</strong>
        </div>
        <div class="metric account-hero-metric">
          <p class="eyebrow">Last Contacted</p>
          <strong>${core.lastContacted ? formatDate(core.lastContacted) : "Not captured"}</strong>
        </div>
        <div class="account-owner-chip">
          <span class="person-avatar">${escapeHtml(getInitials(core.owner, "?"))}</span>
          <div>
            <strong>${escapeHtml(core.owner || "Unassigned")}</strong>
            <span>Owner</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderContactDetailTabs(activeTab) {
  return `
    <div class="segment-tabs" role="tablist" aria-label="Contact detail sections">
      ${contactDetailTabs
        .map(
          (tab) => `
            <button type="button" role="tab" aria-selected="${tab.id === activeTab}" class="${tab.id === activeTab ? "active" : ""}" data-action="switch-contact-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderContactTabBody(tab, contact) {
  switch (tab) {
    case "details":
      return renderContactDetailsTab(contact);
    case "communications":
      return renderContactCommunicationsTab(contact);
    case "opportunities":
      return renderContactOpportunitiesTab(contact);
    case "projects":
      return renderContactProjectsTab(contact);
    case "relationships":
      return renderContactRelationshipsTab(contact);
    case "files":
      return renderContactFilesTab(contact);
    case "summary":
    default:
      return renderContactSummaryTab(contact);
  }
}

function renderContactSummaryTab(contact) {
  const account = findAccount(contact.accountId);
  const core = getCoreContact(contact);
  const opportunities = opportunitiesForContact(contact);
  const openTasks = tasksForContact(contact.id);
  const openSalesTasks = salesTasksForContact(contact.id);
  const recentActivities = activitiesForContact(contact.id).slice(0, 3);

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Contact information</h3></div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Email</dt><dd>${escapeHtml(core.email || "Not captured")}</dd></div>
              <div><dt>Business phone</dt><dd>${escapeHtml(core.businessPhone || "Not captured")}</dd></div>
              <div><dt>Mobile phone</dt><dd>${escapeHtml(core.mobilePhone || "Not captured")}</dd></div>
              <div><dt>Account</dt><dd>${
                account
                  ? `<button class="link-button" type="button" data-action="view-account" data-id="${escapeAttribute(account.id)}">${escapeHtml(account.name)}</button>`
                  : "Unknown account"
              }</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Open tasks</h3></div>
          <div class="panel-body task-list">
            ${openTasks.slice(0, 3).map(renderTaskRow).join("") || `<div class="empty-state">No open tasks for this contact.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Sales tasks</h3>
            <button class="mini-button" type="button" data-action="open-sales-task" data-account-id="${escapeAttribute(contact.accountId)}">Add</button>
          </div>
          <div class="panel-body record-list">
            ${openSalesTasks.map(renderSalesTaskCard).join("") || `<div class="empty-state">No sales tasks for this contact yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Linked opportunities</h3></div>
          <div class="panel-body record-list">
            ${opportunities.slice(0, 5).map(renderAccountOpportunityCard).join("") || `<div class="empty-state">No opportunities linked to this contact.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Recent activity</h3>
            <button class="mini-button" type="button" data-action="switch-contact-tab" data-tab="communications">See all</button>
          </div>
          <div class="panel-body record-list">
            ${recentActivities.map(renderTimelineItem).join("") || `<div class="empty-state">No activity logged yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderEmploymentHistoryCard(entry) {
  return `
    <article class="detail-card">
      <strong>${escapeHtml(entry.employer || "Unnamed employer")}</strong>
      <div class="row-meta">
        <span>${escapeHtml(entry.jobTitle || "Title not captured")}</span>
        <span>${entry.startDate ? formatDate(entry.startDate) : "Start date unknown"} - ${entry.isCurrent ? "Present" : entry.endDate ? formatDate(entry.endDate) : "Unknown"}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="open-contact-employment" data-contact-id="${escapeAttribute(entry.contactId)}" data-id="${escapeAttribute(entry.id)}">Edit</button>
        <button class="mini-button" type="button" data-action="remove-contact-employment" data-id="${escapeAttribute(entry.id)}">Remove</button>
      </div>
    </article>
  `;
}

function renderContactDetailsTab(contact) {
  const core = getCoreContact(contact);
  const employmentHistory = employmentHistoryForContact(contact.id);
  const division = contact.divisionId ? findAccountDivision(contact.divisionId) : null;

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Contact info</h3>
            <button class="mini-button" type="button" data-action="open-contact-info" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>First name</dt><dd>${escapeHtml(core.firstName || "Not captured")}</dd></div>
              <div><dt>Last name</dt><dd>${escapeHtml(core.lastName || "Not captured")}</dd></div>
              <div><dt>Job title</dt><dd>${escapeHtml(core.jobTitle || "Not captured")}</dd></div>
              <div><dt>Email</dt><dd>${escapeHtml(core.email || "Not captured")}</dd></div>
              <div><dt>Email (alternate)</dt><dd>${escapeHtml(core.emailAddressTwo || "Not captured")}</dd></div>
              <div><dt>Business phone</dt><dd>${escapeHtml(core.businessPhone || "Not captured")}</dd></div>
              <div><dt>Mobile phone</dt><dd>${escapeHtml(core.mobilePhone || "Not captured")}</dd></div>
              <div><dt>Fax</dt><dd>${escapeHtml(core.fax || "Not captured")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Personal</h3>
            <button class="mini-button" type="button" data-action="open-contact-personal" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Birthday</dt><dd>${core.birthday ? formatDate(core.birthday) : "Not captured"}</dd></div>
              <div><dt>Notes</dt><dd>${escapeHtml(core.notes || "No relationship notes yet.")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Communication preferences</h3>
            <button class="mini-button" type="button" data-action="open-contact-comm-prefs" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Preferred method</dt><dd>${escapeHtml(core.preferredContactMethod || "Email")}</dd></div>
              <div><dt>Email</dt><dd>${core.doNotAllowEmails ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Phone</dt><dd>${core.doNotAllowPhoneCalls ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Mail</dt><dd>${core.doNotAllowMail ? "Not allowed" : "Allowed"}</dd></div>
              <div><dt>Fax</dt><dd>${core.doNotAllowFaxes ? "Not allowed" : "Allowed"}</dd></div>
            </dl>
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Employment history</h3>
            <button class="mini-button" type="button" data-action="open-contact-employment" data-contact-id="${escapeAttribute(contact.id)}">Add</button>
          </div>
          <div class="panel-body record-list">
            ${employmentHistory.map(renderEmploymentHistoryCard).join("") || `<div class="empty-state">No employment history captured yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Role and account</h3>
            <button class="mini-button" type="button" data-action="open-contact-role" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Account role</dt><dd>${escapeHtml(core.accountRole || "Employee")}</dd></div>
              <div><dt>Relationship role</dt><dd>${escapeHtml(core.relationshipRole || "Unknown")}</dd></div>
              <div><dt>Lifecycle stage</dt><dd>${escapeHtml(core.lifecycleStage || "Lead")}</dd></div>
              <div><dt>Lead status</dt><dd>${escapeHtml(core.leadStatus || "Open")}</dd></div>
              <div><dt>Owner</dt><dd>${escapeHtml(core.owner || "Unassigned")}</dd></div>
              <div><dt>Division</dt><dd>${division ? escapeHtml(division.divisionName) : "Unassigned"}</dd></div>
            </dl>
          </div>
        </article>
      </div>

      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header">
            <h3>Address one</h3>
            <button class="mini-button" type="button" data-action="open-contact-address-one" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Street</dt><dd>${escapeHtml([core.addressOneStreetOne, core.addressOneStreetTwo].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>City / State</dt><dd>${escapeHtml([core.addressOneCity, core.addressOneState].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>Zip / Country</dt><dd>${escapeHtml([core.addressOneZipCode, core.addressOneCountry].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>Phone</dt><dd>${escapeHtml(core.addressOneTelephoneOne || "Not captured")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Address two</h3>
            <button class="mini-button" type="button" data-action="open-contact-address-two" data-contact-id="${escapeAttribute(contact.id)}">Edit</button>
          </div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Street</dt><dd>${escapeHtml([core.addressTwoStreetOne, core.addressTwoStreetTwo].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>City / State</dt><dd>${escapeHtml([core.addressTwoCity, core.addressTwoState].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>Zip / Country</dt><dd>${escapeHtml([core.addressTwoZipCode, core.addressTwoCountry].filter(Boolean).join(", ") || "Not captured")}</dd></div>
              <div><dt>Fax</dt><dd>${escapeHtml(core.addressTwoFax || "Not captured")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>System info</h3></div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Contact ID</dt><dd>${escapeHtml(core.contactUniqueIdentifier || core.id)}</dd></div>
              <div><dt>Record source</dt><dd>${escapeHtml(core.recordSource || "Local CRM")}</dd></div>
              <div><dt>Created</dt><dd>${core.createdOn ? formatDate(core.createdOn) : "Not captured"} by ${escapeHtml(core.createdBy || "Unknown")}</dd></div>
              <div><dt>Last modified</dt><dd>${core.lastModifiedDate ? formatDate(core.lastModifiedDate) : "Not captured"}</dd></div>
              <div><dt>Sales activities</dt><dd>${Number(core.numberOfSalesActivities || 0)}</dd></div>
              <div><dt>Times contacted</dt><dd>${Number(core.numberOfTimesContacted || 0)}</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderContactCommunicationsTab(contact) {
  const activities = [...activitiesForContact(contact.id)].sort(
    (a, b) => new Date(b.activityDate || b.createdAt) - new Date(a.activityDate || a.createdAt),
  );

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack" style="grid-column: 1 / -1;">
        <article class="panel">
          <div class="panel-header">
            <h3>Timeline</h3>
            ${renderActivityPicker(contact.accountId, contact.id)}
          </div>
          <div class="panel-body record-list">
            ${activities.map(renderTimelineItem).join("") || `<div class="empty-state">No emails, meetings, calls, or notes logged for this contact yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderContactOpportunitiesTab(contact) {
  const opportunities = opportunitiesForContact(contact).map((opportunity) => ({
    opportunity,
    core: getCoreOpportunity(opportunity),
  }));
  const active = opportunities.filter((entry) => entry.core.status === "Open");
  const won = opportunities.filter((entry) => entry.core.status === "Won");
  const lost = opportunities.filter((entry) => entry.core.status === "Lost");

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Active opportunities</h3></div>
          <div class="panel-body record-list">
            ${active.map((entry) => renderAccountOpportunityCard(entry.opportunity)).join("") || `<div class="empty-state">No active opportunities for this contact.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Won opportunities</h3></div>
          <div class="panel-body record-list">
            ${won.map((entry) => renderAccountOpportunityCard(entry.opportunity)).join("") || `<div class="empty-state">No won opportunities yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Lost opportunities</h3></div>
          <div class="panel-body record-list">
            ${lost.map((entry) => renderAccountOpportunityCard(entry.opportunity)).join("") || `<div class="empty-state">No lost opportunities.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderContactProjectsTab(contact) {
  const jobs = projectsForContact(contact);
  const activeJobs = jobs.filter((job) => !isOpsProjectClosed(job));
  const closedJobs = jobs.filter((job) => isOpsProjectClosed(job));
  const opportunityIds = new Set((contact.opportunityIds || []));
  const scheduledWork = scheduledWorkForAccount(contact.accountId).filter((work) => opportunityIds.has(work.opportunityId));

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Active projects</h3></div>
          <div class="panel-body record-list">
            ${activeJobs.map(renderJobCard).join("") || `<div class="empty-state">No active projects for this contact.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Closed projects</h3></div>
          <div class="panel-body record-list">
            ${closedJobs.map(renderJobCard).join("") || `<div class="empty-state">No closed projects yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Scheduled work for linked deals</h3></div>
          <div class="panel-body record-list">
            ${scheduledWork.map(renderScheduledWorkCard).join("") || `<div class="empty-state">No scheduled work tied to this contact's opportunities.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderContactCoworkerCard(coworker) {
  return `
    <article class="detail-card">
      <button class="link-button person-name" type="button" data-action="view-contact" data-id="${escapeAttribute(coworker.id)}">${escapeHtml(coworker.name)}</button>
      <div class="row-meta">
        <span>${escapeHtml(coworker.title || "Title not captured")}</span>
      </div>
    </article>
  `;
}

function renderContactConnectionCard(connection) {
  const labelParts = [
    ...new Set([
      ...connection.sharedOpportunities.map((id) => findOpportunity(id)?.name).filter(Boolean),
      ...connection.sharedJobs.map((job) => job.name).filter(Boolean),
    ]),
  ];
  return `
    <article class="detail-card">
      <button class="link-button person-name" type="button" data-action="view-contact" data-id="${escapeAttribute(connection.contact.id)}">${escapeHtml(connection.contact.name)}</button>
      <div class="row-meta">
        <span>${escapeHtml(connection.contact.title || "Title not captured")}</span>
      </div>
      <p class="help-text">Connected via ${escapeHtml(labelParts.join(", ") || "shared work")}</p>
    </article>
  `;
}

function renderContactRelationshipsTab(contact) {
  const coworkers = coworkersForContact(contact);
  const connections = connectedContactsForContact(contact);

  return `
    <section class="crm-profile-grid">
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Coworkers</h3></div>
          <div class="panel-body record-list">
            ${coworkers.map(renderContactCoworkerCard).join("") || `<div class="empty-state">No other contacts at this account yet.</div>`}
          </div>
        </article>
      </div>
      <div class="detail-stack">
        <article class="panel">
          <div class="panel-header"><h3>Connected via projects and opportunities</h3></div>
          <div class="panel-body record-list">
            ${connections.map(renderContactConnectionCard).join("") || `<div class="empty-state">No shared opportunities or projects with other contacts yet.</div>`}
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderContactFilesTab(contact) {
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header"><h3>Shared with this contact</h3></div>
        <div class="panel-body"><div class="empty-state">Document storage isn't built yet.</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Received from this contact</h3></div>
        <div class="panel-body"><div class="empty-state">Document storage isn't built yet.</div></div>
      </article>
      <article class="panel">
        <div class="panel-header"><h3>Project and opportunity files</h3></div>
        <div class="panel-body"><div class="empty-state">Document storage isn't built yet.</div></div>
      </article>
    </section>
  `;
}

function renderOperations() {
  state.view = "ops-projects";
  renderOperationsAllProjects();
}

function renderOperationsAllProjects() {
  const filterAccount = state.projectsAccountFilter ? findAccount(state.projectsAccountFilter) : null;
  const activeProjects = state.projects.filter((job) => job.status !== "Complete");
  const jobs = filterAccount ? activeProjects.filter((job) => job.accountId === filterAccount.id) : activeProjects;
  const grouped = ["Emergency Response", "Multi-Stage Remediation", "Scheduled Work"].map((jobClass) => ({
    jobClass,
    jobs: jobs.filter((job) => job.jobClass === jobClass),
  }));
  const allDispatchJobs = filterAccount ? getDispatchJobs().filter((dispatchJob) => dispatchJob.accountId === filterAccount.id) : getDispatchJobs();
  const completedDispatchJobs = allDispatchJobs.filter((dispatchJob) => isTerminalDispatchStatus(dispatchJob.status));
  const nonDispatchedProjects = jobs.filter((job) => dispatchJobsForProject(job.id).length === 0);

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "All Projects",
        "Every active operations project in one place, across emergency response, multi-stage remediation, and scheduled work — connected to what dispatch is actually working on.",
        `
          <button class="primary-button" type="button" data-action="open-schedule">Schedule work</button>
          <button class="danger-button" type="button" data-action="open-alert">Field alert</button>
          <button class="secondary-button" type="button" data-action="open-remediation">New remediation</button>
        `,
      )}
      ${
        filterAccount
          ? `
            <section class="core-table-notice" aria-label="Account filter">
              <div>
                <strong>Filtered to ${escapeHtml(filterAccount.name)}</strong>
                <span>Showing only projects linked to this account.</span>
              </div>
              <div class="inline-actions">
                <button class="mini-button" type="button" data-action="clear-projects-filter">Clear filter</button>
              </div>
            </section>
          `
          : ""
      }
      ${renderOperationsMetrics()}
      <section class="metric-strip" aria-label="Dispatch connection metrics">
        <div class="metric">
          <p class="eyebrow">Completed dispatch jobs</p>
          <strong>${completedDispatchJobs.length}</strong>
          <span>Closed or cancelled</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Projects without dispatch</p>
          <strong>${nonDispatchedProjects.length}</strong>
          <span>Won, but nothing sent to dispatch yet</span>
        </div>
      </section>

      <section class="project-directory" aria-label="Dispatch job connection">
        <article class="panel">
          <div class="panel-header"><div><h3>Completed dispatch jobs</h3><span>Closed or cancelled field work</span></div></div>
          <div class="panel-body record-list">
            ${completedDispatchJobs.slice(0, 8).map(renderOperationsDispatchJobRow).join("") || `<div class="empty-state">No completed dispatch jobs yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><div><h3>Non-dispatched projects</h3><span>Won projects with no job pushed to dispatch yet</span></div></div>
          <div class="panel-body record-list">
            ${nonDispatchedProjects.map(renderNonDispatchedProjectRow).join("") || `<div class="empty-state">Every project has at least one dispatch job.</div>`}
          </div>
        </article>
      </section>

      <section class="project-directory" aria-label="All operations projects">
        ${grouped
          .map(
            (group) => `
              <article class="panel project-directory-section">
                <div class="panel-header">
                  <h3>${escapeHtml(group.jobClass)}</h3>
                  <span class="source-badge">${group.jobs.length} projects</span>
                </div>
                <div class="panel-body project-card-grid">
                  ${group.jobs.map(renderProjectOverviewCard).join("") || `<div class="empty-state">No ${escapeHtml(group.jobClass.toLowerCase())} projects.</div>`}
                </div>
              </article>
            `,
          )
          .join("")}
      </section>
    </section>
  `;
}

function renderOperationsDispatchJobRow(dispatchJob) {
  const project = dispatchJob.projectId ? findProject(dispatchJob.projectId) : null;
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <button class="link-button account-name" type="button" data-action="view-dispatch-job" data-id="${escapeAttribute(dispatchJob.id)}">${escapeHtml(dispatchJob.jobNumber)} · ${escapeHtml(dispatchJob.jobName)}</button>
          <div class="row-meta">
            <span>${escapeHtml(dispatchJob.customerName)}</span>
            ${project ? `<span>Project: ${escapeHtml(project.name)}</span>` : `<span class="tag">No linked project</span>`}
          </div>
        </div>
        ${renderDispatchStatusBadge(formatDispatchStatus(dispatchJob.status))}
      </div>
    </article>
  `;
}

function renderNonDispatchedProjectRow(job) {
  const account = findAccount(job.accountId);
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <button class="link-button account-name" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">${escapeHtml(job.name)}</button>
          <div class="row-meta">
            <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
            <span>${escapeHtml(job.jobClass)}</span>
          </div>
        </div>
        <span class="risk-badge medium">Needs dispatch</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="open-job-request" data-account-id="${escapeAttribute(job.accountId)}" data-project-id="${escapeAttribute(job.id)}">Push to dispatch</button>
        <button class="mini-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Open project</button>
      </div>
    </article>
  `;
}

function renderProjectOverviewCard(job) {
  const account = findAccount(job.accountId);
  const progress = getJobProgress(job);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const samples = samplesForJob(job.id);
  const spatial = spatialDataForJob(job.id);
  const chronology = getProjectChronology(job);
  const dispatchJobs = dispatchJobsForProject(job.id);
  const activeDispatchCount = dispatchJobs.filter((dispatchJob) => !isTerminalDispatchStatus(dispatchJob.status)).length;

  return `
    <article class="project-overview-card">
      <div class="project-overview-head">
        <div>
          <button class="link-button account-name" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">
            ${escapeHtml(job.name)}
          </button>
          <div class="row-meta">
            <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
            <span>${escapeHtml(job.jobClass)}</span>
            <span>${escapeHtml(job.status)}</span>
          </div>
        </div>
        <span class="risk-badge ${progress.tone}">${progress.percent}%</span>
      </div>
      <div class="race-progress ${progress.tone}" aria-label="Project progress">
        <span style="width: ${progress.percent}%"></span>
      </div>
      <p class="help-text">${escapeHtml(job.activePhase)}. ${escapeHtml(job.marginWatch)}</p>
      <div class="inline-actions">
        <span class="${alerts.length ? "risk-badge high" : "tag"}">${alerts.length} alerts</span>
        <span class="tag">${samples.length} samples</span>
        <span class="tag">${spatial.length} LiDAR/spatial</span>
        <span class="tag">${chronology.length} events</span>
        <span class="${dispatchJobs.length ? "tag" : "risk-badge medium"}">${dispatchJobs.length ? `${activeDispatchCount} active / ${dispatchJobs.length} dispatch jobs` : "No dispatch yet"}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Open project</button>
        <button class="mini-button" type="button" data-action="open-alert" data-job-id="${escapeAttribute(job.id)}">Alert</button>
      </div>
    </article>
  `;
}

function renderProjectIntakeBanner(job) {
  const missingFields = getMissingProjectStageFields(job, "Plan");
  if (!missingFields.length) return "";
  return `
    <div class="empty-state warning">
      Intake is incomplete — missing: ${escapeHtml(describeMissingFields(missingFields))}.
    </div>
  `;
}

function renderProjectDetail() {
  cleanupProjectDetailVisuals();
  const job = findProject(state.selectedProjectId);
  if (!job) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Project not found</h2>
        <button class="secondary-button" type="button" data-action="back-to-projects">Back to projects</button>
      </section>
    `;
    return;
  }

  const account = findAccount(job.accountId);
  const location = findLocation(job.locationId);
  const opportunity = findOpportunity(job.opportunityId);
  const progress = getJobProgress(job);
  const generator = getProjectGenerator(job);
  const samples = samplesForJob(job.id);
  const sampleSessions = groupSamplesIntoSessions(samples);
  const spatial = spatialDataForJob(job.id);
  const chronology = getProjectChronology(job);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const assignments = assignmentsForJob(job.id);
  const materials = materialUsageForJob(job.id);
  const equipment = equipmentLogsForJob(job.id);
  const projectDispatchJobs = dispatchJobsForProject(job.id);
  const activeDispatchJobs = projectDispatchJobs.filter((item) => !isTerminalDispatchStatus(item.status));
  const completedDispatchJobs = projectDispatchJobs.filter((item) => isTerminalDispatchStatus(item.status));
  const pendingRequests = jobRequestsForProject(job.id).filter((request) => request.status !== "Converted");
  const projectTypeNote = {
    "Emergency Response": "Emergency projects are urgent — push a job request as soon as the site is confirmed, no fixed schedule required.",
    "Scheduled Work": "Scheduled projects run on a planned cadence. New job requests default to a future service date.",
    "Multi-Stage Remediation": "Multi-stage projects anticipate more than one dispatch — every job pushed to dispatch from this project shows up below.",
  }[job.jobClass] || "";

  app.innerHTML = `
    <section class="view">
      <div class="account-hero project-hero">
        <div>
          <button class="text-button" type="button" data-action="back-to-projects">Back to all projects</button>
          <p class="eyebrow">Operations project</p>
          <h2>${escapeHtml(job.name)}</h2>
          <p>${escapeHtml(job.jobClass)} for ${escapeHtml(account?.name ?? "Unknown account")}${location ? ` at ${escapeHtml(location.name)}` : ""}.</p>
          <div class="inline-actions">
            <span class="risk-badge ${progress.tone}">${progress.percent}% complete</span>
            <span class="stage-badge">${escapeHtml(job.status)}</span>
            <span class="tag">PM ${escapeHtml(job.projectManager)}</span>
            ${job.notToExceed ? `<span class="risk-badge medium">NTE ${money(job.notToExceed)}</span>` : `<span class="tag">Budget ${money(job.budget)}</span>`}
          </div>
        </div>
        <div class="toolbar">
          <button class="danger-button" type="button" data-action="open-alert" data-job-id="${escapeAttribute(job.id)}">Field alert</button>
          <button class="secondary-button" type="button" data-action="open-material" data-job-id="${escapeAttribute(job.id)}">Log material</button>
          <button class="secondary-button" type="button" data-action="open-equipment" data-job-id="${escapeAttribute(job.id)}">Log equipment</button>
          <button class="secondary-button" type="button" data-action="open-schedule" data-job-id="${escapeAttribute(job.id)}">Schedule</button>
          <button class="primary-button" type="button" data-action="open-job-request" data-account-id="${escapeAttribute(job.accountId)}" data-project-id="${escapeAttribute(job.id)}">New job request</button>
        </div>
      </div>

      <section class="project-progress-panel">
        <div class="race-progress ${progress.tone}" aria-label="Project progress">
          <span style="width: ${progress.percent}%"></span>
        </div>
        <div class="stage-ladder">
          ${PROJECT_STAGES.map((stage, index) => `<span class="${progress.stageIndex >= index ? "done" : ""}">${stage}</span>`).join("")}
        </div>
      </section>

      ${renderProjectIntakeBanner(job)}

      <section class="metric-strip" aria-label="Project detail metrics">
        <div class="metric">
          <p class="eyebrow">Site events</p>
          <strong>${chronology.length}</strong>
          <span>Chronology records</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Sampling sessions</p>
          <strong>${sampleSessions.length}</strong>
          <span>${samples.length} sample records</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Open alerts</p>
          <strong>${alerts.length}</strong>
          <span>Scope, safety, or approval</span>
        </div>
        <div class="metric">
          <p class="eyebrow">LiDAR/spatial</p>
          <strong>${spatial.length}</strong>
          <span>Project files linked</span>
        </div>
      </section>

      <section class="project-detail-layout">
        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header">
              <h3>Generator and responsible party</h3>
              <button class="mini-button" type="button" data-action="open-project-intake" data-id="${escapeAttribute(job.id)}">Edit</button>
            </div>
            <div class="panel-body">
              <dl class="detail-list">
                <div><dt>Generator</dt><dd>${escapeHtml(generator.name)}</dd></div>
                <div><dt>Site</dt><dd>${escapeHtml(generator.siteName)}</dd></div>
                <div><dt>Contact</dt><dd>${escapeHtml(generator.contactName)}${generator.contactPhone ? ` - ${escapeHtml(generator.contactPhone)}` : ""}</dd></div>
                <div><dt>EPA ID</dt><dd>${escapeHtml(generator.epaId)}</dd></div>
                <div><dt>TCEQ ID</dt><dd>${escapeHtml(generator.tceqId)}</dd></div>
                <div><dt>Insurance</dt><dd>${escapeHtml(generator.insuranceContact)}</dd></div>
                <div><dt>Carrier / Claim</dt><dd>${escapeHtml(generator.insuranceCarrier)} / ${escapeHtml(generator.claimNumber)}</dd></div>
                <div><dt>Services</dt><dd>${escapeHtml(generator.serviceProfile)}</dd></div>
                <div><dt>Project type</dt><dd>${escapeHtml(job.jobClass)}</dd></div>
                <div><dt>Site walk</dt><dd>${escapeHtml(job.siteWalkStatus || "Incomplete")}</dd></div>
                <div><dt>Site photos</dt><dd>${(job.sitePhotoRefs || []).length ? `${job.sitePhotoRefs.length} captured` : "None captured yet"}</dd></div>
              </dl>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>LiDAR and spatial render</h3></div>
            <div class="panel-body lidar-stack">
              ${spatial.map(renderProjectSpatialRecord).join("") || renderEmptyLidarPlaceholder(job)}
            </div>
          </article>

          ${renderProjectSampleMap(job, samples)}

          <article class="panel">
            <div class="panel-header"><h3>Sampling sessions</h3></div>
            <div class="panel-body record-list">
              ${sampleSessions.map(renderSampleSession).join("") || `<div class="empty-state">No sampling sessions for this project yet.</div>`}
            </div>
          </article>
        </div>

        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header">
              <div><h3>Dispatch jobs</h3><span>${projectDispatchJobs.length} total · ${activeDispatchJobs.length} active · ${completedDispatchJobs.length} completed</span></div>
              <button class="mini-button" type="button" data-action="open-job-request" data-account-id="${escapeAttribute(job.accountId)}" data-project-id="${escapeAttribute(job.id)}">New job request</button>
            </div>
            <div class="panel-body">
              ${projectTypeNote ? `<p class="help-text">${escapeHtml(projectTypeNote)}</p>` : ""}
              ${pendingRequests.length ? `<p class="help-text">${pendingRequests.length} job request${pendingRequests.length === 1 ? "" : "s"} waiting in dispatch intake for review.</p>` : ""}
              <div class="record-list">
                ${activeDispatchJobs.map(renderProjectDispatchJobCard).join("")}
                ${completedDispatchJobs.map(renderProjectDispatchJobCard).join("")}
                ${projectDispatchJobs.length ? "" : `<div class="empty-state">No dispatch jobs yet. Push a job request to send this project's work to dispatch.</div>`}
              </div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Chronological site events</h3>
                <span>Scrollable project history from schedule, field logs, samples, alerts, and spatial uploads.</span>
              </div>
            </div>
            <div class="panel-body project-timeline-scroll">
              ${chronology.map(renderProjectChronologyItem).join("") || `<div class="empty-state">No project events yet.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>Project team and logistics</h3></div>
            <div class="panel-body record-list">
              ${assignments.map(renderAssignmentCard).join("") || `<div class="empty-state">No assignments yet.</div>`}
              ${materials.slice(0, 3).map(renderMaterialCard).join("")}
              ${equipment.slice(0, 3).map(renderEquipmentCard).join("")}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>Sales and account links</h3></div>
            <div class="panel-body record-list">
              <article class="detail-card">
                <strong>${escapeHtml(account?.name ?? "Unknown account")}</strong>
                <div class="row-meta">
                  <span>${escapeHtml(account?.city || "No city")}</span>
                  <span>${escapeHtml(account?.phase || "No phase")}</span>
                </div>
                <div class="inline-actions">
                  ${account ? `<button class="mini-button" type="button" data-action="view-account" data-id="${escapeAttribute(account.id)}">Open account</button>` : ""}
                  ${opportunity ? `<button class="mini-button" type="button" data-action="view-opportunity" data-id="${escapeAttribute(opportunity.id)}">Open opportunity</button>` : ""}
                </div>
              </article>
            </div>
          </article>
        </div>
      </section>
    </section>
  `;

  requestAnimationFrame(() => {
    initializeProjectSampleMap(job.id);
    initializeProjectModelViewers();
  });
}

function renderProjectDispatchJobCard(dispatchJob) {
  const isTerminal = isTerminalDispatchStatus(dispatchJob.status);
  return `
    <button class="dispatch-board-card project-dispatch-card" type="button" data-action="view-dispatch-job" data-id="${escapeAttribute(dispatchJob.id)}">
      <div class="dispatch-card-head">
        <span class="job-number">${escapeHtml(dispatchJob.jobNumber)}</span>
        ${renderDispatchStatusBadge(formatDispatchStatus(dispatchJob.status))}
      </div>
      <strong>${escapeHtml(dispatchJob.jobName)}</strong>
      <span>${escapeHtml(dispatchJob.jobType)}</span>
      <div class="dispatch-card-time">
        <strong>${formatDateTime(dispatchJob.scheduledStart)}</strong>
        <span>${escapeHtml(isTerminal ? "Completed" : dispatchJob.dispatchStatus)}</span>
      </div>
    </button>
  `;
}

function renderSampleDetail() {
  cleanupProjectDetailVisuals();
  const sample = findSample(state.selectedSampleId);
  const job = sample ? findProject(sample.projectId) : null;
  if (!sample || !job) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Sample not found</h2>
        <button class="secondary-button" type="button" data-action="back-to-projects">Back to projects</button>
      </section>
    `;
    return;
  }

  const account = findAccount(sample.accountId || job.accountId);
  const location = findLocation(sample.locationId || job.locationId);
  const session = groupSamplesIntoSessions(samplesForJob(job.id)).find((item) => item.id === (sample.samplingSessionId || sample.chainOfCustody || sample.projectId));
  const photos = sample.photos?.length ? sample.photos : [];
  const results = sample.results || sample.labResults || "No result summary has been entered.";
  const analyses = Array.isArray(sample.requestedAnalyses)
    ? sample.requestedAnalyses.join(", ")
    : sample.requestedAnalyses || "Not captured";
  const nearbySamples = samplesForJob(job.id).filter((item) => item.id !== sample.id);
  const resultTone = /above|exceed|hit|action level/i.test(`${sample.labStatus || ""} ${results}`)
    ? "high"
    : /pending|transit|logged|expedited/i.test(sample.labStatus || "")
      ? "medium"
      : "low";

  app.innerHTML = `
    <section class="view">
      <div class="account-hero project-hero">
        <div>
          <button class="text-button" type="button" data-action="back-to-project">Back to ${escapeHtml(job.name)}</button>
          <p class="eyebrow">Project sample record</p>
          <h2>${escapeHtml(sample.sampleId || sample.id)}</h2>
          <p>${escapeHtml(sample.sampleLocation || "Sample location")} for ${escapeHtml(account?.name || "Unknown account")}.</p>
          <div class="inline-actions">
            <span class="risk-badge ${resultTone}">${escapeHtml(sample.labStatus || "Pending")}</span>
            <span class="stage-badge">${escapeHtml(sample.sampleType || "Sample")}</span>
            <span class="tag">${escapeHtml(sample.sampleMatrix || sample.sampleType || "Matrix not captured")}</span>
            <span class="tag">${escapeHtml(sample.chainOfCustody || "COC not captured")}</span>
          </div>
        </div>
        <div class="toolbar">
          <button class="secondary-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Open project</button>
        </div>
      </div>

      <section class="metric-strip" aria-label="Sample detail metrics">
        <div class="metric">
          <p class="eyebrow">Collected by</p>
          <strong>${escapeHtml(sample.collector || "Not captured")}</strong>
          <span>${formatDateTime(sample.collectionTime)}</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Laboratory</p>
          <strong>${escapeHtml(sample.labName || "Not assigned")}</strong>
          <span>${escapeHtml(sample.labStatus || "Pending")}</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Location</p>
          <strong>${escapeHtml(sample.sampleLocation || "Not captured")}</strong>
          <span>${escapeHtml(getSampleCoordinates(sample))}</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Evidence</p>
          <strong>${photos.length}</strong>
          <span>Linked sample photos</span>
        </div>
      </section>

      <section class="sample-detail-layout">
        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Collection record</h3>
                <span>Field identity, method, location, and custody details.</span>
              </div>
            </div>
            <div class="panel-body">
              <dl class="detail-list sample-detail-list">
                <div><dt>Sample ID</dt><dd>${escapeHtml(sample.sampleId || sample.id)}</dd></div>
                <div><dt>Session</dt><dd>${escapeHtml(session?.label || sample.samplingSessionName || "Session not captured")}</dd></div>
                <div><dt>Collected by</dt><dd>${escapeHtml(sample.collector || "Not captured")}</dd></div>
                <div><dt>Collected at</dt><dd>${escapeHtml(formatDateTime(sample.collectionTime))}</dd></div>
                <div><dt>Type / matrix</dt><dd>${escapeHtml(sample.sampleType || "Not captured")} / ${escapeHtml(sample.sampleMatrix || sample.sampleType || "Not captured")}</dd></div>
                <div><dt>Method</dt><dd>${escapeHtml(sample.collectionMethod || "Not captured")}</dd></div>
                <div><dt>Depth / interval</dt><dd>${escapeHtml(sample.depthInterval || "Not captured")}</dd></div>
                <div><dt>Site location</dt><dd>${escapeHtml(sample.sampleLocation || location?.name || "Not captured")}</dd></div>
                <div><dt>GPS</dt><dd>${escapeHtml(getSampleCoordinates(sample))}</dd></div>
                <div><dt>GPS accuracy</dt><dd>${sample.gpsAccuracyMeters ? `${escapeHtml(sample.gpsAccuracyMeters)} meters` : "Not captured"}</dd></div>
                <div><dt>Containers</dt><dd>${escapeHtml(sample.containerSummary || "Not captured")}</dd></div>
                <div><dt>Preservation</dt><dd>${escapeHtml(sample.preservation || "Not captured")}</dd></div>
              </dl>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Laboratory and results</h3>
                <span>Requested analyses, custody, receipt, and current interpretation.</span>
              </div>
            </div>
            <div class="panel-body detail-stack">
              <dl class="detail-list sample-detail-list">
                <div><dt>Laboratory</dt><dd>${escapeHtml(sample.labName || "Lab not assigned")}</dd></div>
                <div><dt>COC number</dt><dd>${escapeHtml(sample.chainOfCustody || "Not captured")}</dd></div>
                <div><dt>Lab status</dt><dd>${escapeHtml(sample.labStatus || "Pending")}</dd></div>
                <div><dt>Lab received</dt><dd>${escapeHtml(sample.labReceivedAt ? formatDateTime(sample.labReceivedAt) : "Not captured")}</dd></div>
                <div><dt>Analyses</dt><dd>${escapeHtml(analyses)}</dd></div>
                <div><dt>Reviewed by</dt><dd>${escapeHtml(sample.reviewedBy || "Not reviewed")}</dd></div>
              </dl>
              <div class="sample-result-callout ${resultTone}">
                <span>Result summary</span>
                <strong>${escapeHtml(results)}</strong>
              </div>
              ${sample.labReportUri ? `<code class="file-ref">${escapeHtml(sample.labReportUri)}</code>` : ""}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Field notes and evidence</h3>
                <span>Observations and media captured with this sample.</span>
              </div>
            </div>
            <div class="panel-body detail-stack">
              <p class="sample-field-notes">${escapeHtml(sample.fieldNotes || sample.collectionNotes || "No field notes captured.")}</p>
              <div class="sample-photo-grid sample-detail-photos">
                ${photos.map((photo) => `<span>${escapeHtml(typeof photo === "string" ? photo : photo.label || "Sample photo")}</span>`).join("") || `<div class="empty-state">No sample photos linked.</div>`}
              </div>
            </div>
          </article>
        </div>

        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Sample location</h3>
                <span>${escapeHtml(getSampleCoordinates(sample))}</span>
              </div>
            </div>
            <div class="panel-body">
              <div id="sampleDetailMap" class="project-sample-map sample-detail-map" aria-label="Selected sample location map"></div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>Project context</h3></div>
            <div class="panel-body detail-stack">
              <dl class="detail-list">
                <div><dt>Project</dt><dd>${escapeHtml(job.name)}</dd></div>
                <div><dt>Account</dt><dd>${escapeHtml(account?.name || "Unknown account")}</dd></div>
                <div><dt>Site</dt><dd>${escapeHtml(location?.name || "Site not captured")}</dd></div>
                <div><dt>Project class</dt><dd>${escapeHtml(job.jobClass || "Not captured")}</dd></div>
                <div><dt>Project manager</dt><dd>${escapeHtml(job.projectManager || "Not assigned")}</dd></div>
              </dl>
              <button class="secondary-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Return to project</button>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <h3>Other project samples</h3>
                <span>${nearbySamples.length} additional records.</span>
              </div>
            </div>
            <div class="panel-body record-list">
              ${nearbySamples.map((item) => `
                <button class="sample-related-link" type="button" data-action="view-sample" data-id="${escapeAttribute(item.id)}">
                  <strong>${escapeHtml(item.sampleId || item.id)}</strong>
                  <span>${escapeHtml(item.sampleLocation || "Sample location")}</span>
                  <span>${escapeHtml(item.labStatus || "Pending")}</span>
                </button>
              `).join("") || `<div class="empty-state">No other samples are linked to this project.</div>`}
            </div>
          </article>
        </div>
      </section>
    </section>
  `;

  requestAnimationFrame(() => initializeSampleDetailMap(sample.id));
}

function renderOperationsScheduled() {
  const scheduledJobs = state.projects.filter((job) => job.jobClass === "Scheduled Work" && job.status !== "Complete");
  const scheduledOpen = getScheduleEvents().filter((work) => work.status !== "Complete");

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Scheduled Work",
        "Confirmed and tentative field work that needs crews, equipment, customer access, and schedule control.",
        `
          <button class="primary-button" type="button" data-action="open-schedule">Schedule work</button>
          <button class="danger-button" type="button" data-action="open-alert">Field alert</button>
          <button class="secondary-button" type="button" data-action="open-material">Log material</button>
          <button class="secondary-button" type="button" data-action="open-equipment">Log equipment</button>
        `,
      )}
      ${renderOperationsMetrics()}
      <section class="split-grid">
        <article class="panel">
          <div class="panel-header"><h3>Scheduled work queue</h3></div>
          <div class="panel-body record-list">
            ${scheduledOpen.map(renderScheduleEventCard).join("") || `<div class="empty-state">No scheduled work yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Scheduled project cards</h3></div>
          <div class="panel-body record-list">
            ${scheduledJobs.map(renderJobCard).join("") || `<div class="empty-state">No scheduled project cards.</div>`}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderOperationsEmergency() {
  const emergencyJobs = state.projects.filter((job) => job.jobClass === "Emergency Response" && job.status !== "Complete");
  const emergencyAlerts = state.projectAlerts.filter((alert) => alert.status !== "Resolved" && emergencyJobs.some((job) => job.id === alert.projectId));

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Emergency Response",
        "Rapid response work that bypasses the normal opportunity flow and needs dispatch, NTE, labor, and customer approval visibility.",
        `<button class="danger-button" type="button" data-action="open-alert">Field alert</button>`,
      )}
      ${renderOperationsMetrics()}
      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Active emergency jobs</h3></div>
          <div class="panel-body record-list">
            ${emergencyJobs.map(renderJobCard).join("") || `<div class="empty-state">No active emergency response jobs.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Emergency approvals and alerts</h3></div>
          <div class="panel-body record-list">
            ${emergencyAlerts.map(renderAlertCard).join("") || `<div class="empty-state">No emergency alerts.</div>`}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderOperationsRemediation() {
  const remediationJobs = state.projects.filter((job) => job.jobClass === "Multi-Stage Remediation" && job.status !== "Complete");

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Multi-Stage Remediations",
        "Longer projects with investigation, planning, mobilization, field execution, closeout, samples, and documentation.",
        `<button class="primary-button" type="button" data-action="open-remediation">New remediation</button>`,
      )}
      ${renderOperationsMetrics()}
      <section class="record-list">
        ${remediationJobs.map(renderRemediationCard).join("") || `<div class="empty-state">No multi-stage remediations yet.</div>`}
      </section>
    </section>
  `;
}

function renderOperationsCalendar() {
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Operations Calendar",
        "Schedule view for crews, site walks, emergency dispatch, and upcoming project milestones.",
      )}
      ${renderCalendarBoard()}
    </section>
  `;
}

function renderOperationsMap() {
  cleanupOperationsMap();
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Asset and Project Map",
        "Live project and asset locations from stored coordinates and OwnTracks GPS pings.",
        `<button class="primary-button" type="button" data-action="open-map-location">New GPS point</button>`,
      )}
      ${renderOperationsMapBoard()}
    </section>
  `;
  requestAnimationFrame(initializeOperationsMap);
}

function renderOperationsRaceTrack() {
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "operations",
        "Race Track",
        "Won projects that are now actively moving through dispatch and field operations — color-coded by progress, risk, and schedule.",
      )}
      ${renderRaceTrackBoard("operations")}
    </section>
  `;
}

function renderOperationsMetrics() {
  const activeAlerts = state.projectAlerts.filter((alert) => alert.status !== "Resolved");
  const activeEmergency = state.projects.filter((job) => job.jobClass === "Emergency Response" && job.status !== "Complete").length;
  const maintenanceHolds = equipmentAssets.filter((asset) => asset.status === "Maintenance hold").length;
  const lowConsumables = getConsumableStatus().filter((item) => item.status !== "Healthy").length;
  const activeProjectCount = state.projects.filter((job) => job.status !== "Complete").length;

  return `
    <section class="metric-strip" aria-label="Operations metrics">
      <div class="metric">
        <p class="eyebrow">Active jobs</p>
        <strong>${activeProjectCount}</strong>
        <span>Operational records in this foundation</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Emergency response</p>
        <strong>${activeEmergency}</strong>
        <span>Bypass normal sales flow</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Open alerts</p>
        <strong>${activeAlerts.length}</strong>
        <span>Scope, safety, access, or approval issues</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Resource blocks</p>
        <strong>${maintenanceHolds + lowConsumables}</strong>
        <span>Inventory or equipment constraints</span>
      </div>
    </section>
  `;
}

function renderRemediationCard(job) {
  const account = findAccount(job.accountId);
  const progress = getJobProgress(job);
  const samples = sampleRecordsForAccount(job.accountId).filter((sample) => sample.projectId === job.id);
  const spatial = spatialDataForAccount(job.accountId).filter((item) => item.projectId === job.id);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const dispatchJobs = dispatchJobsForProject(job.id);
  const activeDispatchCount = dispatchJobs.filter((dispatchJob) => !isTerminalDispatchStatus(dispatchJob.status)).length;

  return `
    <article class="remediation-card">
      <div class="race-card-main">
        <div>
          <button class="link-button account-name" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">${escapeHtml(job.name)}</button>
          <div class="row-meta">
            <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
            <span>PM ${escapeHtml(job.projectManager)}</span>
            <span>${formatDate(job.startDate)} to ${formatDate(job.targetDate)}</span>
          </div>
        </div>
        <span class="risk-badge ${progress.tone}">${progress.percent}%</span>
      </div>
      <div class="race-progress ${progress.tone}">
        <span style="width: ${progress.percent}%"></span>
      </div>
      <div class="stage-ladder">
        ${PROJECT_STAGES.map((stage, index) => `<span class="${progress.stageIndex >= index ? "done" : ""}">${stage}</span>`).join("")}
      </div>
      <div class="inline-actions">
        <span class="${alerts.length ? "risk-badge high" : "tag"}">${alerts.length} alerts</span>
        <span class="tag">${samples.length} samples</span>
        <span class="tag">${spatial.length} spatial files</span>
        <span class="${dispatchJobs.length ? "tag" : "risk-badge medium"}">${dispatchJobs.length ? `${activeDispatchCount} active / ${dispatchJobs.length} dispatch jobs` : "No dispatch yet"}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Open project</button>
        <button class="mini-button" type="button" data-action="open-job-request" data-account-id="${escapeAttribute(job.accountId)}" data-project-id="${escapeAttribute(job.id)}">New job request</button>
      </div>
    </article>
  `;
}

function renderCalendarBoard() {
  const days = buildCalendarDays();
  return `
    <section class="calendar-grid" aria-label="Operations calendar">
      ${days
        .map(
          (day) => `
            <article class="calendar-day">
              <div class="calendar-date">
                <strong>${escapeHtml(day.label)}</strong>
                <span>${formatDate(day.date)}</span>
              </div>
              <div class="record-list">
                ${day.items.map(renderCalendarItem).join("") || `<div class="empty-state">Open</div>`}
              </div>
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderCalendarItem(item) {
  const account = findAccount(item.accountId);
  return `
    <article class="calendar-item ${item.kind.toLowerCase().replace(/\s+/g, "-")}">
      ${
        item.id
          ? `<button class="link-button" type="button" data-action="view-project" data-id="${escapeAttribute(item.id)}">${escapeHtml(item.title)}</button>`
          : `<strong>${escapeHtml(item.title)}</strong>`
      }
      <div class="row-meta">
        <span>${escapeHtml(item.kind)}</span>
        <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
      </div>
    </article>
  `;
}

function renderOperationsMapBoard() {
  const markers = getMapMarkers();
  return `
    <section class="map-layout">
      <div id="operationsMap" class="ops-map" aria-label="Interactive map of active project and asset locations">
        <div class="map-loading">Loading map...</div>
      </div>
      <aside class="panel map-sidebar">
        <div class="panel-header"><h3>Map layers</h3></div>
        <div class="panel-body record-list">
          <div class="legend-row"><span class="map-dot scheduled"></span>Scheduled work</div>
          <div class="legend-row"><span class="map-dot emergency"></span>Emergency response</div>
          <div class="legend-row"><span class="map-dot remediation"></span>Multi-stage remediation</div>
          <div class="legend-row"><span class="map-dot asset"></span>Assigned asset</div>
          <hr />
          ${markers.slice(0, 10).map(renderMapSidebarItem).join("") || `<div class="empty-state">No mapped locations yet.</div>`}
        </div>
      </aside>
    </section>
  `;
}

function renderMapSidebarItem(marker) {
  return `
    <div class="legend-row map-list-item">
      <span class="map-dot ${marker.type}"></span>
      <div>
        <strong>${escapeHtml(marker.label)}</strong>
        <span>${Number(marker.latitude).toFixed(4)}, ${Number(marker.longitude).toFixed(4)}</span>
        ${marker.assetTags?.length ? `<span>Assets: ${escapeHtml(marker.assetTags.join(", "))}</span>` : ""}
        <button class="mini-button" type="button" data-action="open-map-location" data-id="${escapeAttribute(marker.locationId || marker.id || "")}">
          Edit GPS
        </button>
      </div>
    </div>
  `;
}

function cleanupOperationsMap() {
  if (!operationsLeafletMap) return;
  operationsLeafletMap.remove();
  operationsLeafletMap = null;
}

function cleanupClientSpillMap() {
  if (!clientSpillLeafletMap) return;
  clientSpillLeafletMap.remove();
  clientSpillLeafletMap = null;
}

function cleanupProjectDetailVisuals() {
  cleanupProjectSampleMap();
  cleanupProjectModelViewers();
}

function cleanupProjectSampleMap() {
  if (!projectSampleLeafletMap) return;
  projectSampleLeafletMap.remove();
  projectSampleLeafletMap = null;
}

function cleanupProjectModelViewers() {
  projectModelViewers.forEach((viewer) => {
    cancelAnimationFrame(viewer.animationId);
    viewer.resizeObserver?.disconnect();
    viewer.controls?.dispose();
    viewer.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material?.dispose?.());
      } else {
        object.material?.dispose?.();
      }
    });
    viewer.renderer?.dispose();
  });
  projectModelViewers = [];
}

function initializeProjectSampleMap(jobId) {
  const mapElement = document.querySelector("#projectSampleMap");
  if (!mapElement) return;

  const leaflet = window.L;
  const samples = samplesForJob(jobId).filter((sample) => Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude)));
  if (!leaflet) {
    mapElement.innerHTML = `<div class="map-loading">Map library did not load.</div>`;
    return;
  }

  if (!samples.length) {
    mapElement.innerHTML = `<div class="map-loading">No sample GPS points captured yet.</div>`;
    return;
  }

  cleanupProjectSampleMap();
  mapElement.innerHTML = "";
  projectSampleLeafletMap = leaflet.map(mapElement, {
    scrollWheelZoom: false,
  });

  leaflet
    .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    })
    .addTo(projectSampleLeafletMap);

  const bounds = [];
  samples.forEach((sample, index) => {
    const latLng = [Number(sample.latitude), Number(sample.longitude)];
    bounds.push(latLng);
    const icon = leaflet.divIcon({
      className: "leaflet-type-marker sample",
      html: `<span>${index + 1}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    });
    leaflet
      .marker(latLng, {
        icon,
        title: sample.sampleId || sample.sampleLocation || "Sample point",
        alt: sample.sampleId || sample.sampleLocation || "Sample point",
      })
      .addTo(projectSampleLeafletMap)
      .bindPopup(`
        <div class="map-popup">
          <strong>${escapeHtml(sample.sampleId || sample.id)}</strong>
          <span>${escapeHtml(sample.sampleLocation || "Sample location")}</span>
          <span>${Number(sample.latitude).toFixed(6)}, ${Number(sample.longitude).toFixed(6)}</span>
          <button class="mini-button" type="button" data-action="view-sample" data-id="${escapeAttribute(sample.id)}">Open sample</button>
        </div>
      `);
  });

  projectSampleLeafletMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
  setTimeout(() => projectSampleLeafletMap?.invalidateSize(), 80);
}

function initializeSampleDetailMap(sampleId) {
  const mapElement = document.querySelector("#sampleDetailMap");
  if (!mapElement) return;

  const leaflet = window.L;
  const sample = findSample(sampleId);
  const location = sample ? findLocation(sample.locationId) : null;
  const latitude = Number.isFinite(Number(sample?.latitude)) ? Number(sample.latitude) : Number(location?.latitude);
  const longitude = Number.isFinite(Number(sample?.longitude)) ? Number(sample.longitude) : Number(location?.longitude);

  if (!leaflet) {
    mapElement.innerHTML = `<div class="map-loading">Map library did not load.</div>`;
    return;
  }

  if (!sample || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    mapElement.innerHTML = `<div class="map-loading">No sample GPS point has been captured.</div>`;
    return;
  }

  cleanupProjectSampleMap();
  mapElement.innerHTML = "";
  projectSampleLeafletMap = leaflet.map(mapElement, {
    scrollWheelZoom: false,
  });

  leaflet
    .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    })
    .addTo(projectSampleLeafletMap);

  const icon = leaflet.divIcon({
    className: "leaflet-type-marker sample",
    html: "<span>1</span>",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });

  leaflet
    .marker([latitude, longitude], {
      icon,
      title: sample.sampleId || sample.sampleLocation || "Sample point",
      alt: sample.sampleId || sample.sampleLocation || "Sample point",
    })
    .addTo(projectSampleLeafletMap)
    .bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(sample.sampleId || sample.id)}</strong>
        <span>${escapeHtml(sample.sampleLocation || "Sample location")}</span>
        <span>${latitude.toFixed(6)}, ${longitude.toFixed(6)}</span>
      </div>
    `)
    .openPopup();

  projectSampleLeafletMap.setView([latitude, longitude], 17);
  setTimeout(() => projectSampleLeafletMap?.invalidateSize(), 80);
}

function initializeClientSpillMap() {
  const mapElement = document.querySelector("#clientSpillMap");
  if (!mapElement) return;

  const leaflet = window.L;
  const markers = getClientSpillMarkers().filter((marker) => Number.isFinite(Number(marker.latitude)) && Number.isFinite(Number(marker.longitude)));
  if (!leaflet) {
    mapElement.innerHTML = `<div class="map-loading">Map library did not load.</div>`;
    return;
  }

  if (!markers.length) {
    mapElement.innerHTML = `<div class="map-loading">No spill GPS coordinates are available yet.</div>`;
    return;
  }

  cleanupClientSpillMap();
  mapElement.innerHTML = "";
  clientSpillLeafletMap = leaflet.map(mapElement, {
    scrollWheelZoom: false,
  });

  leaflet
    .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    })
    .addTo(clientSpillLeafletMap);

  const bounds = [];
  markers.forEach((marker) => {
    const latLng = [Number(marker.latitude), Number(marker.longitude)];
    bounds.push(latLng);
    const icon = leaflet.divIcon({
      className: `leaflet-type-marker ${marker.type}`,
      html: `<span>${escapeHtml(marker.shortLabel)}</span>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -18],
    });

    leaflet
      .marker(latLng, {
        icon,
        title: marker.label,
        alt: marker.label,
      })
      .addTo(clientSpillLeafletMap)
      .bindPopup(renderClientSpillMapPopup(marker));
  });

  if (bounds.length === 1) clientSpillLeafletMap.setView(bounds[0], 13);
  else clientSpillLeafletMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });

  setTimeout(() => clientSpillLeafletMap?.invalidateSize(), 80);
}

function renderClientSpillMapPopup(marker) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(marker.label)}</strong>
      <span>${escapeHtml(marker.status)}</span>
      <span>${escapeHtml(marker.locationName)}</span>
      <span>${Number(marker.latitude).toFixed(5)}, ${Number(marker.longitude).toFixed(5)}</span>
      <span>${escapeHtml(marker.sourceLabel)}</span>
      <button class="mini-button" type="button" data-action="view-client-spill" data-id="${escapeAttribute(marker.projectId)}">Open spill</button>
    </div>
  `;
}

async function initializeProjectModelViewers() {
  const containers = Array.from(document.querySelectorAll("[data-model-src]"));
  if (!containers.length) return;

  let modules;
  try {
    modules = await loadThreeViewerModules();
  } catch (error) {
    console.error("Project 3D viewer failed to load", error);
    containers.forEach((container) => {
      container.innerHTML = `<div class="model-viewer-status error">3D viewer could not load: ${escapeHtml(error.message || "Unknown module error")}</div>`;
    });
    return;
  }

  containers.forEach((container) => initializeProjectModelViewer(container, modules));
}

function loadThreeViewerModules() {
  if (!threeViewerModulesPromise) {
    threeViewerModulesPromise = Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/controls/OrbitControls.js"),
    ]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => ({ THREE, GLTFLoader, OrbitControls }));
  }
  return threeViewerModulesPromise;
}

function initializeProjectModelViewer(container, { THREE, GLTFLoader, OrbitControls }) {
  const modelSrc = container.dataset.modelSrc;
  if (!modelSrc) return;

  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "project-model-canvas";
  const status = document.createElement("div");
  status.className = "model-viewer-status";
  status.textContent = "Loading 3D render...";
  const toolbar = document.createElement("div");
  toolbar.className = "model-viewer-toolbar";
  toolbar.setAttribute("aria-label", "3D viewer camera controls");
  toolbar.innerHTML = `
    <button class="model-viewer-button" type="button" data-model-command="top" title="Top-down view">Top</button>
    <button class="model-viewer-button" type="button" data-model-command="bottom" title="Bottom-up view">Bottom</button>
    <button class="model-viewer-button" type="button" data-model-command="left" title="Left side view">Left</button>
    <button class="model-viewer-button" type="button" data-model-command="right" title="Right side view">Right</button>
    <button class="model-viewer-button" type="button" data-model-command="angle" title="Angled inspection view">Angle</button>
    <button class="model-viewer-button" type="button" data-model-command="auto" title="Toggle slow rotation">Auto</button>
  `;
  container.append(canvas, status, toolbar);
  container.addEventListener("contextmenu", (event) => event.preventDefault());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--surface-alt").trim() || "#f2f6f4");

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  camera.position.set(3, 2, 5);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x334139, 2.1);
  scene.add(hemisphere);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.9;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 1.15;
  controls.zoomToCursor = true;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.35;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.001;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  controls.target.set(0, 0, 0);

  const resize = () => {
    const width = Math.max(320, container.clientWidth || 640);
    const height = Math.max(320, container.clientHeight || 420);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const viewer = {
    animationId: 0,
    camera,
    controls,
    renderer,
    resizeObserver,
    scene,
    THREE,
    toolbar,
    viewFrame: null,
  };
  projectModelViewers.push(viewer);

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-model-command]");
    if (!button) return;
    const command = button.dataset.modelCommand;
    if (command === "auto") {
      controls.autoRotate = !controls.autoRotate;
      button.classList.toggle("active", controls.autoRotate);
      return;
    }
    controls.autoRotate = false;
    toolbar.querySelector('[data-model-command="auto"]')?.classList.remove("active");
    if (["top", "bottom", "left", "right", "angle"].includes(command)) setModelCameraView(viewer, command);
  });

  const loader = new GLTFLoader();
  loader.load(
    modelSrc,
    (gltf) => {
      const model = gltf.scene;
      scene.add(model);
      viewer.viewFrame = fitCameraToModel(THREE, camera, controls, model);
      status.remove();
    },
    undefined,
    () => {
      status.classList.add("error");
      status.textContent = "3D render file could not be opened.";
    },
  );

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    viewer.animationId = requestAnimationFrame(animate);
  };
  animate();
}

function fitCameraToModel(THREE, camera, controls, model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  model.position.sub(center);
  const fitDistance = Math.abs(maxDim / Math.sin((camera.fov * Math.PI) / 360)) * 0.72;
  const viewFrame = {
    maxDim,
    fitDistance,
    anglePosition: new THREE.Vector3(maxDim * 0.65, maxDim * 0.42, fitDistance),
    topPosition: new THREE.Vector3(0, fitDistance * 0.92, maxDim * 0.01),
    bottomPosition: new THREE.Vector3(0, -fitDistance * 0.92, maxDim * 0.01),
    leftPosition: new THREE.Vector3(-fitDistance, maxDim * 0.12, 0),
    rightPosition: new THREE.Vector3(fitDistance, maxDim * 0.12, 0),
    target: new THREE.Vector3(0, 0, 0),
  };

  camera.near = Math.max(maxDim / 1000, 0.01);
  camera.far = maxDim * 120;
  camera.updateProjectionMatrix();
  setModelCameraView({ THREE, camera, controls, viewFrame }, "angle");
  return viewFrame;
}

function setModelCameraView(viewer, mode) {
  const frame = viewer.viewFrame;
  if (!frame) return;

  viewer.camera.up.set(0, 1, 0);
  if (mode === "top") {
    viewer.camera.up.set(0, 0, -1);
    viewer.camera.position.copy(frame.topPosition);
  } else if (mode === "bottom") {
    viewer.camera.up.set(0, 0, 1);
    viewer.camera.position.copy(frame.bottomPosition);
  } else if (mode === "left") {
    viewer.camera.position.copy(frame.leftPosition);
  } else if (mode === "right") {
    viewer.camera.position.copy(frame.rightPosition);
  } else {
    viewer.camera.position.copy(frame.anglePosition);
  }

  viewer.controls.target.copy(frame.target);
  viewer.camera.lookAt(frame.target);
  viewer.camera.updateProjectionMatrix();
  viewer.controls.update();
}

function initializeOperationsMap() {
  const mapElement = document.querySelector("#operationsMap");
  if (!mapElement) return;

  const leaflet = window.L;
  const markers = getMapMarkers().filter((marker) => Number.isFinite(Number(marker.latitude)) && Number.isFinite(Number(marker.longitude)));
  if (!leaflet) {
    mapElement.innerHTML = `<div class="map-loading">Map library did not load. Check the internet connection for map tiles.</div>`;
    return;
  }

  if (!markers.length) {
    mapElement.innerHTML = `<div class="map-loading">No GPS coordinates are available yet.</div>`;
    return;
  }

  cleanupOperationsMap();
  mapElement.innerHTML = "";
  operationsLeafletMap = leaflet.map(mapElement, {
    scrollWheelZoom: false,
  });

  leaflet
    .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    })
    .addTo(operationsLeafletMap);

  const bounds = [];
  markers.forEach((marker) => {
    const latLng = [Number(marker.latitude), Number(marker.longitude)];
    bounds.push(latLng);
    const icon = leaflet.divIcon({
      className: `leaflet-type-marker ${marker.type}`,
      html: `<span>${escapeHtml(marker.shortLabel || "GPS")}</span>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -18],
    });
    leaflet
      .marker(latLng, {
        icon,
        title: marker.label,
        alt: marker.label,
      })
      .addTo(operationsLeafletMap)
      .bindPopup(renderMapPopup(marker));
  });

  if (bounds.length === 1) operationsLeafletMap.setView(bounds[0], 13);
  else operationsLeafletMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });

  setTimeout(() => operationsLeafletMap?.invalidateSize(), 80);
}

function renderMapPopup(marker) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(marker.label)}</strong>
      <span>${escapeHtml(marker.status || marker.type)}</span>
      <span>${Number(marker.latitude).toFixed(5)}, ${Number(marker.longitude).toFixed(5)}</span>
      ${marker.assetTags?.length ? `<span>Assets: ${escapeHtml(marker.assetTags.join(", "))}</span>` : ""}
      ${marker.lastPingAt ? `<span>Last ping ${escapeHtml(formatDate(marker.lastPingAt))}</span>` : ""}
      <button class="mini-button" type="button" data-action="open-map-location" data-id="${escapeAttribute(marker.locationId || marker.id || "")}">Edit GPS</button>
    </div>
  `;
}

function renderOperationsLegacy() {
  const jobClasses = ["Scheduled Work", "Emergency Response", "Multi-Stage Remediation"];
  const activeProjects = state.projects.filter((job) => job.status !== "Complete");
  const jobs =
    state.operationsFilter === "All"
      ? activeProjects
      : activeProjects.filter((job) => job.jobClass === state.operationsFilter);
  const activeAlerts = state.projectAlerts.filter((alert) => alert.status !== "Resolved");
  const activeEmergency = state.projects.filter((job) => job.jobClass === "Emergency Response" && job.status !== "Complete").length;
  const loggedMaterialCount = state.materialUsage.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  app.innerHTML = `
    <section class="view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Operations command</p>
          <h2>Projects, emergency work, field logistics, and alerts</h2>
          <p>Separate scheduled work, emergency response, and multi-stage remediation while keeping assignments, materials, equipment, samples, and scope alerts attached to the active job.</p>
        </div>
        <div class="toolbar">
          <select id="operationsFilter" aria-label="Job class filter">
            <option ${state.operationsFilter === "All" ? "selected" : ""}>All</option>
            ${jobClasses.map((jobClass) => `<option ${state.operationsFilter === jobClass ? "selected" : ""}>${jobClass}</option>`).join("")}
          </select>
          <button class="danger-button" type="button" data-action="open-alert">Field alert</button>
          <button class="secondary-button" type="button" data-action="open-material">Log material</button>
          <button class="secondary-button" type="button" data-action="open-equipment">Log equipment</button>
        </div>
      </div>

      <section class="metric-strip" aria-label="Operations metrics">
        <div class="metric">
          <p class="eyebrow">Active jobs</p>
          <strong>${activeProjects.length}</strong>
          <span>Operational records in this foundation</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Emergency response</p>
          <strong>${activeEmergency}</strong>
          <span>Bypass normal sales flow</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Open alerts</p>
          <strong>${activeAlerts.length}</strong>
          <span>Scope, safety, access, or approval issues</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Material units</p>
          <strong>${loggedMaterialCount}</strong>
          <span>Prototype field usage logs</span>
        </div>
      </section>

      <section class="ops-board" aria-label="Job classes">
        ${jobClasses
          .map((jobClass) => {
            const classJobs = jobs.filter((job) => job.jobClass === jobClass);
            return `
              <article class="stage-column ops-column">
                <div class="stage-title">
                  <strong>${escapeHtml(jobClass)}</strong>
                  <span class="stage-total">${classJobs.length}</span>
                </div>
                <div class="opportunity-list">
                  ${classJobs.map(renderJobCard).join("") || `<div class="empty-state">No active records.</div>`}
                </div>
              </article>
            `;
          })
          .join("")}
      </section>

      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Project assignments</h3></div>
          <div class="panel-body record-list">
            ${state.projectAssignments.map(renderAssignmentCard).join("") || `<div class="empty-state">No project assignments yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Open field alerts</h3></div>
          <div class="panel-body record-list">
            ${activeAlerts.map(renderAlertCard).join("") || `<div class="empty-state">No active alerts.</div>`}
          </div>
        </article>
      </section>

      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Material usage</h3></div>
          <div class="panel-body record-list">
            ${state.materialUsage.slice(0, 6).map(renderMaterialCard).join("") || `<div class="empty-state">No material usage logged.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Equipment logs</h3></div>
          <div class="panel-body record-list">
            ${state.equipmentLogs.slice(0, 6).map(renderEquipmentCard).join("") || `<div class="empty-state">No equipment logs yet.</div>`}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderJobCard(job) {
  const account = findAccount(job.accountId);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const assignments = assignmentsForJob(job.id);
  return `
    <article class="job-card">
      <div>
        <button class="link-button account-name" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">
          ${escapeHtml(job.name)}
        </button>
        <div class="card-meta">
          <button class="link-button compact-link" type="button" data-action="view-account" data-id="${job.accountId}">
            ${escapeHtml(account?.name ?? "Unknown account")}
          </button>
          <span>${escapeHtml(job.status)}</span>
        </div>
      </div>
      <div class="row-meta">
        <span>${escapeHtml(job.activePhase)}</span>
        <span>${formatDate(job.startDate)} to ${formatDate(job.targetDate)}</span>
      </div>
      <p class="help-text">${escapeHtml(job.marginWatch)}</p>
      <div class="inline-actions">
        <span class="stage-badge">PM ${escapeHtml(job.projectManager)}</span>
        <span class="tag">Sales ${escapeHtml(job.salesLead)}</span>
        ${job.notToExceed ? `<span class="risk-badge medium">NTE ${money(job.notToExceed)}</span>` : `<span class="tag">Budget ${money(job.budget)}</span>`}
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-project" data-id="${escapeAttribute(job.id)}">Open project</button>
        <button class="mini-button" type="button" data-action="open-alert" data-job-id="${job.id}">Alert</button>
        <button class="mini-button" type="button" data-action="open-material" data-job-id="${job.id}">Material</button>
        <button class="mini-button" type="button" data-action="open-equipment" data-job-id="${job.id}">Equipment</button>
        <span class="${alerts.length ? "risk-badge high" : "tag"}">${alerts.length} open alerts</span>
        <span class="tag">${assignments.length} assignments</span>
      </div>
    </article>
  `;
}

function renderAssignmentCard(assignment) {
  const job = findProject(assignment.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(assignment.userName)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(assignment.assignedRole)}</span>
        <span>${escapeHtml(assignment.globalRole)}</span>
        <span>${escapeHtml(assignment.status)}</span>
      </div>
      <p class="help-text">${escapeHtml(job?.name ?? "Unknown job")}</p>
    </article>
  `;
}

function renderAlertCard(alert) {
  const job = findProject(alert.projectId);
  const account = findAccount(alert.accountId);
  return `
    <article class="alert-card ${alert.severity.toLowerCase()}">
      <div class="inline-actions">
        <span class="risk-badge ${alert.severity.toLowerCase() === "high" ? "high" : "medium"}">${escapeHtml(alert.severity)}</span>
        <span class="stage-badge">${escapeHtml(alert.alertType)}</span>
        <span class="tag">${escapeHtml(alert.status)}</span>
      </div>
      <strong>${escapeHtml(job?.name ?? "Unknown job")}</strong>
      <p class="help-text">${escapeHtml(alert.description)}</p>
      <div class="row-meta">
        <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
        <span>${escapeHtml(alert.reportedBy)}</span>
        <span>${formatDate(alert.reportedAt)}</span>
      </div>
    </article>
  `;
}

function renderMaterialCard(item) {
  const job = findProject(item.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(item.materialType)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</span>
        <span>${escapeHtml(item.loggedBy)}</span>
        <span>${formatDate(item.timestamp)}</span>
      </div>
      <p class="help-text">${escapeHtml(job?.name ?? "Unknown job")}</p>
    </article>
  `;
}

function renderEquipmentCard(item) {
  const job = findProject(item.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(item.assetTag)} - ${escapeHtml(item.equipment)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(item.truckId || "No truck")}</span>
        <span>${escapeHtml(item.condition)}</span>
        <span>${escapeHtml(item.user)}</span>
      </div>
      <p class="help-text">${escapeHtml(job?.name ?? "Unknown job")}</p>
    </article>
  `;
}

function renderWorkforceDirectory() {
  const employees = getEmployees();
  const query = state.workforceSearch.trim().toLowerCase();
  const filtered = employees.filter((employee) =>
    [employee.displayName, employee.employeeNumber, employee.jobTitle, employee.businessUnit, employee.homeBase]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
  const active = employees.filter((employee) => employee.employmentStatus === "Active");
  const fieldReady = active.filter((employee) => employee.dispatchEligible && employee.readinessStatus === "Ready");
  const credentialIssues = active.filter((employee) => ["Expiring", "Blocked"].includes(employee.readinessStatus));
  const frontlineEnabled = active.filter((employee) => employee.frontlineEnabled);

  app.innerHTML = `
    <section class="view workforce-view">
      ${renderWorkspaceHeader(
        "workforce",
        "Employee Directory",
        "Operational employee records, field readiness, reporting structure, availability, and Front Line access.",
        `<button class="primary-button" type="button" data-action="open-employee">Add employee</button>`,
      )}
      ${renderWorkforceMetrics(active.length, fieldReady.length, credentialIssues.length, frontlineEnabled.length)}
      <article class="panel">
        <div class="panel-header">
          <div>
            <h3>Workforce roster</h3>
            <span>${filtered.length} of ${employees.length} employees</span>
          </div>
          <div class="toolbar">
            <input id="workforceSearch" type="search" value="${escapeAttribute(state.workforceSearch)}" placeholder="Search employees" aria-label="Search employees" />
          </div>
        </div>
        <div class="panel-body">
          <table class="data-table workforce-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Team / Crew</th>
                <th>Availability</th>
                <th>Capacity</th>
                <th>Readiness</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(renderWorkforceTableRow).join("") || `<tr><td colspan="7"><div class="empty-state">No employees match this search.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderWorkforceMetrics(activeCount, readyCount, issueCount, frontlineCount) {
  return `
    <section class="metric-strip" aria-label="Workforce metrics">
      <div class="metric"><p class="eyebrow">Active</p><strong>${activeCount}</strong><span>Employees and contractors</span></div>
      <div class="metric"><p class="eyebrow">Dispatch ready</p><strong>${readyCount}</strong><span>Eligible without blocks</span></div>
      <div class="metric"><p class="eyebrow">Credential attention</p><strong>${issueCount}</strong><span>Expiring or blocked</span></div>
      <div class="metric"><p class="eyebrow">Front Line</p><strong>${frontlineCount}</strong><span>Mobile access enabled</span></div>
    </section>
  `;
}

function renderWorkforceTableRow(employee) {
  const team = findWorkforceTeam(employee.teamId);
  const crew = findCrewProfile(employee.crewId);
  const capacityPercent = Math.min(100, Math.round((Number(employee.hoursWorked || 0) / Math.max(1, Number(employee.capacity || 40))) * 100));
  return `
    <tr>
      <td data-label="Employee">
        <button class="record-link workforce-name-link" type="button" data-action="view-employee" data-id="${employee.id}">
          <span class="person-avatar" aria-hidden="true">${escapeHtml(getInitials(employee.displayName, "BR"))}</span>
          <span><strong>${escapeHtml(employee.displayName)}</strong><small>${escapeHtml(employee.employeeNumber)}</small></span>
        </button>
      </td>
      <td data-label="Role"><strong>${escapeHtml(employee.jobTitle)}</strong><span class="table-subtext">${escapeHtml(employee.businessUnit)}</span></td>
      <td data-label="Team / Crew"><strong>${escapeHtml(team?.name || "No team")}</strong><span class="table-subtext">${escapeHtml(crew?.name || "No standing crew")}</span></td>
      <td data-label="Availability"><span>${escapeHtml(employee.availabilitySummary || "Not set")}</span></td>
      <td data-label="Capacity">
        <strong>${Number(employee.hoursWorked || 0)} / ${Number(employee.capacity || 0)} hrs</strong>
        <span class="capacity-track"><span style="width:${capacityPercent}%"></span></span>
      </td>
      <td data-label="Readiness">${renderReadinessBadge(employee.readinessStatus)}</td>
      <td data-label="Action"><button class="mini-button" type="button" data-action="view-employee" data-id="${employee.id}">Open</button></td>
    </tr>
  `;
}

function renderEmployeeDetail() {
  const employee = findEmployee(state.selectedEmployeeId);
  if (!employee) {
    state.view = "workforce-directory";
    state.selectedEmployeeId = "";
    renderWorkforceDirectory();
    return;
  }

  const manager = findEmployee(employee.managerEmployeeId);
  const team = findWorkforceTeam(employee.teamId);
  const crew = findCrewProfile(employee.crewId);
  const certifications = certificationsForEmployee(employee.id);
  const availability = availabilityForEmployee(employee.id);
  const assignments = assignmentsForEmployee(employee.id);
  const devices = devicesForEmployee(employee.id);
  const validCerts = certifications.filter((record) => record.status === "Valid").length;
  const issueCerts = certifications.filter((record) => record.status !== "Valid").length;

  app.innerHTML = `
    <section class="view employee-detail-view">
      <div class="detail-topline">
        <button class="back-button" type="button" data-action="back-to-workforce">Back to directory</button>
        <div class="inline-actions">
          <button class="secondary-button" type="button" data-action="open-employee" data-id="${employee.id}">Edit employee</button>
          <button class="secondary-button" type="button" data-action="open-credential" data-employee-id="${employee.id}">Add credential</button>
        </div>
      </div>
      <section class="employee-detail-header">
        <span class="person-avatar large" aria-hidden="true">${escapeHtml(getInitials(employee.displayName, "BR"))}</span>
        <div>
          <p class="eyebrow">${escapeHtml(employee.employeeNumber)}</p>
          <h2>${escapeHtml(employee.displayName)}</h2>
          <p>${escapeHtml(employee.jobTitle)} · ${escapeHtml(employee.businessUnit)}</p>
        </div>
        <div class="employee-header-status">
          ${renderReadinessBadge(employee.readinessStatus)}
          <span class="source-badge">${escapeHtml(employee.employmentStatus)}</span>
        </div>
      </section>

      <section class="employee-detail-layout">
        <div class="employee-detail-main">
          <article class="panel">
            <div class="panel-header"><h3>Employment and assignment</h3></div>
            <div class="panel-body">
              <dl class="detail-list employee-facts">
                <div><dt>Position</dt><dd>${escapeHtml(employee.jobTitle)}</dd></div>
                <div><dt>Manager</dt><dd>${escapeHtml(manager?.displayName || "Not assigned")}</dd></div>
                <div><dt>Team</dt><dd>${escapeHtml(team?.name || "Not assigned")}</dd></div>
                <div><dt>Crew</dt><dd>${escapeHtml(crew?.name || "Not assigned")}</dd></div>
                <div><dt>Employment</dt><dd>${escapeHtml(employee.employmentType || "Not set")}</dd></div>
                <div><dt>Hire date</dt><dd>${formatDate(employee.hireDate)}</dd></div>
                <div><dt>Home base</dt><dd>${escapeHtml(employee.homeBase || "Not set")}</dd></div>
                <div><dt>Front Line</dt><dd>${employee.frontlineEnabled ? "Enabled" : "Not enabled"}</dd></div>
              </dl>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div><h3>Credentials and certifications</h3><span>${validCerts} valid · ${issueCerts} need attention</span></div>
              <button class="mini-button" type="button" data-action="open-credential" data-employee-id="${employee.id}">Add</button>
            </div>
            <div class="panel-body credential-list">
              ${certifications.map(renderCredentialRow).join("") || `<div class="empty-state">No credentials recorded.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><div><h3>Assigned jobs</h3><span>Current and upcoming dispatch work</span></div></div>
            <div class="panel-body record-list">
              ${assignments.map((assignment) => renderEmployeeJobAssignment(assignment)).join("") || `<div class="empty-state">No current job assignments.</div>`}
            </div>
          </article>
        </div>

        <aside class="employee-detail-sidebar">
          <article class="panel">
            <div class="panel-header"><h3>Contact</h3></div>
            <div class="panel-body">
              <dl class="detail-list">
                <div><dt>Email</dt><dd>${escapeHtml(employee.primaryEmail || "Not set")}</dd></div>
                <div><dt>Mobile</dt><dd>${escapeHtml(employee.mobilePhone || "Not set")}</dd></div>
              </dl>
            </div>
          </article>
          <article class="panel">
            <div class="panel-header"><h3>Skills</h3></div>
            <div class="panel-body resource-chips">${(employee.skills || []).map((skill) => `<span class="tag">${escapeHtml(skill)}</span>`).join("")}</div>
          </article>
          <article class="panel">
            <div class="panel-header"><h3>Availability</h3></div>
            <div class="panel-body record-list">
              ${availability.map(renderAvailabilityCard).join("") || `<div class="empty-state compact">No availability exceptions.</div>`}
            </div>
          </article>
          <article class="panel">
            <div class="panel-header"><h3>Front Line devices</h3></div>
            <div class="panel-body record-list">
              ${devices.map(renderFrontlineDeviceCard).join("") || `<div class="empty-state compact">No registered device.</div>`}
            </div>
          </article>
        </aside>
      </section>
    </section>
  `;
}

function renderCredentialRow(record) {
  const tone = getReadinessTone(record.status);
  return `
    <article class="credential-row">
      <div>
        <span class="credential-type">${escapeHtml(record.recordType)}</span>
        <strong>${escapeHtml(record.name)}</strong>
        <span>${escapeHtml(record.code)}${record.number ? ` · ${escapeHtml(record.number)}` : ""}</span>
      </div>
      <div class="credential-dates">
        <span>Issued ${formatDate(record.issuedOn)}</span>
        <strong>Expires ${formatDate(record.expiresOn)}</strong>
      </div>
      <span class="risk-badge ${tone}">${escapeHtml(record.status)}</span>
    </article>
  `;
}

function renderEmployeeJobAssignment(assignment) {
  const job = findDispatchJob(assignment.jobId);
  if (!job) return "";
  return `
    <button class="assignment-link" type="button" data-action="view-dispatch-job" data-id="${job.id}">
      <span><strong>${escapeHtml(job.jobNumber)}</strong><small>${escapeHtml(job.jobName)}</small></span>
      <span><strong>${formatDateTime(assignment.plannedStart)}</strong><small>${escapeHtml(assignment.role)}</small></span>
      ${renderDispatchStatusBadge(assignment.status)}
    </button>
  `;
}

function renderWorkforceCredentials() {
  const employees = getEmployees();
  const records = getEmployeeCertifications()
    .map((record) => ({ ...record, employee: findEmployee(record.employeeId) }))
    .sort((a, b) => credentialPriority(a.status) - credentialPriority(b.status) || parseDate(a.expiresOn) - parseDate(b.expiresOn));
  const expiring = records.filter((record) => record.status === "Expiring");
  const blocked = records.filter((record) => ["Expired", "Suspended", "Revoked"].includes(record.status));

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "workforce",
        "Credentials and Certifications",
        "Expiration, verification, and evidence status used by dispatch eligibility checks.",
        `<button class="primary-button" type="button" data-action="open-credential">Add credential</button>`,
      )}
      <section class="metric-strip">
        <div class="metric"><p class="eyebrow">Records</p><strong>${records.length}</strong><span>Across ${employees.length} employees</span></div>
        <div class="metric"><p class="eyebrow">Expiring</p><strong>${expiring.length}</strong><span>Renewal attention</span></div>
        <div class="metric"><p class="eyebrow">Blocked</p><strong>${blocked.length}</strong><span>Cannot support new work</span></div>
        <div class="metric"><p class="eyebrow">Verified</p><strong>${records.filter((record) => record.verified).length}</strong><span>Evidence reviewed</span></div>
      </section>
      <article class="panel">
        <div class="panel-header"><div><h3>Credential register</h3><span>Issues appear first</span></div></div>
        <div class="panel-body">
          <table class="data-table credential-table">
            <thead><tr><th>Employee</th><th>Record</th><th>Type</th><th>Issued</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${records
                .map(
                  (record) => `
                    <tr>
                      <td data-label="Employee"><strong>${escapeHtml(record.employee?.displayName || "Unknown")}</strong><span class="table-subtext">${escapeHtml(record.employee?.employeeNumber || "")}</span></td>
                      <td data-label="Record"><strong>${escapeHtml(record.name)}</strong><span class="table-subtext">${escapeHtml(record.code)}</span></td>
                      <td data-label="Type">${escapeHtml(record.recordType)}</td>
                      <td data-label="Issued">${formatDate(record.issuedOn)}</td>
                      <td data-label="Expires">${formatDate(record.expiresOn)}</td>
                      <td data-label="Status"><span class="risk-badge ${getReadinessTone(record.status)}">${escapeHtml(record.status)}</span></td>
                      <td data-label="Action"><button class="mini-button" type="button" data-action="view-employee" data-id="${record.employeeId}">Employee</button></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderWorkforceTeams() {
  const teams = getWorkforceTeams();
  const crews = getCrewProfiles();
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "workforce",
        "Teams and Crews",
        "Teams define reporting structure. Crews define the reusable field groups dispatch can assign.",
      )}
      <section class="workforce-groups-layout">
        <article class="panel">
          <div class="panel-header"><div><h3>Organizational teams</h3><span>${teams.length} active groups</span></div></div>
          <div class="panel-body workforce-group-list">${teams.map(renderWorkforceTeamCard).join("")}</div>
        </article>
        <article class="panel">
          <div class="panel-header"><div><h3>Dispatchable crews</h3><span>${crews.length} reusable crew profiles</span></div></div>
          <div class="panel-body workforce-group-list">${crews.map(renderCrewProfileCard).join("")}</div>
        </article>
      </section>
    </section>
  `;
}

function renderWorkforceTeamCard(team) {
  const manager = findEmployee(team.managerEmployeeId);
  const members = getEmployees().filter((employee) => employee.teamId === team.id);
  return `
    <article class="workforce-group-card">
      <div class="group-card-head"><span class="group-code">${escapeHtml(team.code)}</span><span class="source-badge">${escapeHtml(team.status)}</span></div>
      <h4>${escapeHtml(team.name)}</h4>
      <p>${escapeHtml(team.businessUnit)}</p>
      <div class="group-manager"><span>Manager</span><strong>${escapeHtml(manager?.displayName || "Not assigned")}</strong></div>
      <div class="avatar-stack">${members.map((member) => `<button type="button" data-action="view-employee" data-id="${member.id}" title="${escapeAttribute(member.displayName)}">${escapeHtml(getInitials(member.displayName, "BR"))}</button>`).join("")}</div>
      <span class="table-subtext">${members.length} members</span>
    </article>
  `;
}

function renderCrewProfileCard(crew) {
  const supervisor = findEmployee(crew.supervisorEmployeeId);
  const members = getEmployees().filter((employee) => employee.crewId === crew.id);
  return `
    <article class="workforce-group-card">
      <div class="group-card-head"><span class="group-code">${escapeHtml(crew.code)}</span><span class="source-badge">${escapeHtml(crew.status)}</span></div>
      <h4>${escapeHtml(crew.name)}</h4>
      <p>${escapeHtml(crew.type)}</p>
      <div class="group-manager"><span>Supervisor</span><strong>${escapeHtml(supervisor?.displayName || "Not assigned")}</strong></div>
      <div class="crew-roster">
        ${members.map((member) => `<button type="button" data-action="view-employee" data-id="${member.id}"><span>${escapeHtml(getInitials(member.displayName, "BR"))}</span><strong>${escapeHtml(member.displayName)}</strong><small>${escapeHtml(member.jobTitle)}</small></button>`).join("")}
      </div>
    </article>
  `;
}

function renderWorkforceAvailability() {
  const blocks = getAvailabilityBlocks()
    .map((block) => ({ ...block, employee: findEmployee(block.employeeId) }))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const employeesWithExceptions = new Set(blocks.map((block) => block.employeeId));
  const roster = getEmployees().filter((employee) => employee.employmentStatus === "Active");
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "workforce",
        "Availability and Time Off",
        "Effective worker availability used when dispatch evaluates job assignments.",
      )}
      <article class="panel">
        <div class="panel-header"><div><h3>Availability exceptions</h3><span>Current and upcoming blocks</span></div></div>
        <div class="panel-body availability-board">
          ${blocks.map((block) => renderAvailabilityLane(block)).join("") || `<div class="empty-state">No availability exceptions.</div>`}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h3>Team roster</h3><span>Standard schedule; new hires appear here immediately</span></div></div>
        <div class="panel-body workforce-group-list">
          ${roster.map((employee) => renderAvailabilityRosterCard(employee, employeesWithExceptions.has(employee.id))).join("") || `<div class="empty-state">No active employees.</div>`}
        </div>
      </article>
    </section>
  `;
}

function renderAvailabilityRosterCard(employee, hasException) {
  return `
    <article class="workforce-group-card">
      <div class="group-card-head">
        <span class="group-code">${escapeHtml(getInitials(employee.displayName, "BR"))}</span>
        <span class="source-badge">${hasException ? "Exception above" : "Standard"}</span>
      </div>
      <h4>${escapeHtml(employee.displayName)}</h4>
      <p>${escapeHtml(employee.jobTitle || "")}</p>
      <div class="group-manager"><span>Schedule</span><strong>${escapeHtml(employee.availabilitySummary || "Not set")}</strong></div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-employee" data-id="${escapeAttribute(employee.id)}">View</button>
      </div>
    </article>
  `;
}

function renderAvailabilityLane(block) {
  return `
    <article class="availability-lane">
      <button type="button" data-action="view-employee" data-id="${block.employeeId}">
        <span class="person-avatar">${escapeHtml(getInitials(block.employee?.displayName, "BR"))}</span>
        <span><strong>${escapeHtml(block.employee?.displayName || "Unknown")}</strong><small>${escapeHtml(block.employee?.jobTitle || "")}</small></span>
      </button>
      <div class="availability-time"><strong>${formatDateTime(block.startsAt)}</strong><span>to ${formatDateTime(block.endsAt)}</span></div>
      <div><span class="risk-badge ${getAvailabilityTone(block.type)}">${escapeHtml(block.type)}</span><p>${escapeHtml(block.reason)}</p></div>
      <span class="source-badge">${escapeHtml(block.status)}</span>
    </article>
  `;
}

function renderAvailabilityCard(block) {
  return `
    <article class="compact-record">
      <div class="inline-actions"><span class="risk-badge ${getAvailabilityTone(block.type)}">${escapeHtml(block.type)}</span><span>${escapeHtml(block.status)}</span></div>
      <strong>${formatDateTime(block.startsAt)}</strong>
      <span>${escapeHtml(block.reason)}</span>
    </article>
  `;
}

function renderWorkforceSchedule() {
  const dates = getWorkforceScheduleDates();
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "workforce",
        "Workforce Schedule",
        "Employee workload across scheduled, dispatched, and active jobs.",
      )}
      <section class="workforce-schedule-grid">
        ${dates.map(renderWorkforceScheduleDay).join("")}
      </section>
    </section>
  `;
}

function renderWorkforceScheduleDay(day) {
  return `
    <article class="schedule-day-column ${day.isToday ? "today" : ""}">
      <div class="schedule-day-head"><strong>${escapeHtml(day.label)}</strong><span>${formatDate(day.date)}</span></div>
      <div class="record-list">
        ${day.assignments.map(renderScheduleAssignmentCard).join("") || `<div class="empty-state compact">No assignments</div>`}
      </div>
    </article>
  `;
}

function renderScheduleAssignmentCard(assignment) {
  const job = findDispatchJob(assignment.jobId);
  const employee = findEmployee(assignment.employeeId);
  return `
    <button class="schedule-assignment-card" type="button" data-action="view-dispatch-job" data-id="${job?.id || ""}">
      <span class="person-avatar">${escapeHtml(getInitials(employee?.displayName, "BR"))}</span>
      <span><strong>${escapeHtml(employee?.displayName || "Unassigned")}</strong><small>${escapeHtml(job?.jobNumber || "")} · ${escapeHtml(assignment.role)}</small></span>
      <span class="schedule-time">${formatShortTime(assignment.plannedStart)}</span>
    </button>
  `;
}

function renderWorkforceDevices() {
  const devices = getFrontlineDevices().map((device) => ({ ...device, employee: findEmployee(device.employeeId) }));
  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "workforce",
        "Front Line Devices",
        "Registered field devices, application versions, last contact, and synchronization health.",
      )}
      <article class="panel">
        <div class="panel-header"><div><h3>Device register</h3><span>${devices.length} registered devices</span></div></div>
        <div class="panel-body">
          <table class="data-table device-table">
            <thead><tr><th>Device</th><th>Employee</th><th>Platform</th><th>App</th><th>Last seen</th><th>Sync</th><th>Status</th></tr></thead>
            <tbody>
              ${devices
                .map(
                  (device) => `
                    <tr>
                      <td data-label="Device"><strong>${escapeHtml(device.displayName)}</strong><span class="table-subtext">${escapeHtml(device.deviceIdentifier)}</span></td>
                      <td data-label="Employee"><button class="table-link" type="button" data-action="view-employee" data-id="${device.employeeId}">${escapeHtml(device.employee?.displayName || "Unassigned")}</button></td>
                      <td data-label="Platform">${escapeHtml(device.platform)}</td>
                      <td data-label="App">${escapeHtml(device.appVersion)}</td>
                      <td data-label="Last seen">${formatDateTime(device.lastSeenAt)}</td>
                      <td data-label="Sync">${renderDeviceSyncBadge(device.syncStatus)}</td>
                      <td data-label="Status"><span class="source-badge">${escapeHtml(device.registrationStatus)}</span></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderFrontlineDeviceCard(device) {
  return `
    <article class="compact-record">
      <div class="inline-actions"><strong>${escapeHtml(device.displayName)}</strong>${renderDeviceSyncBadge(device.syncStatus)}</div>
      <span>${escapeHtml(device.platform)} · app ${escapeHtml(device.appVersion)}</span>
      <span>Last seen ${formatDateTime(device.lastSeenAt)}</span>
    </article>
  `;
}

function renderDispatchIntake() {
  const requests = getJobRequests().sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  const open = requests.filter((request) => !["Converted", "Declined", "Cancelled"].includes(request.status));
  const emergency = open.filter((request) => request.priority === "Emergency");
  const needsInfo = open.filter((request) => request.status === "Needs information");

  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Job Request Intake",
        "Sales requests awaiting office review, job creation, scheduling, and field deployment.",
        `<button class="primary-button" type="button" data-action="open-job-request">New job request</button>`,
      )}
      <section class="metric-strip">
        <div class="metric"><p class="eyebrow">Open intake</p><strong>${open.length}</strong><span>Needs dispatch action</span></div>
        <div class="metric"><p class="eyebrow">Emergency</p><strong>${emergency.length}</strong><span>ASAP requests</span></div>
        <div class="metric"><p class="eyebrow">Needs information</p><strong>${needsInfo.length}</strong><span>Cannot convert yet</span></div>
        <div class="metric"><p class="eyebrow">Converted</p><strong>${requests.filter((request) => request.status === "Converted").length}</strong><span>Jobs created</span></div>
      </section>
      <section class="intake-list">
        ${requests.map(renderJobRequestCard).join("") || `<div class="empty-state">No job requests.</div>`}
      </section>
    </section>
  `;
}

function renderJobRequestCard(request) {
  const convertedJob = findDispatchJob(request.convertedJobId);
  const canConvert = !request.convertedJobId && !["Converted", "Needs information", "Declined", "Cancelled"].includes(request.status);
  const account = accountForJobRequest(request);
  const documents = documentsForJobRequest(request.id);
  const customerPacketDocuments = documents.filter((document) => document.documentRole === "customer_packet");
  const quoteDocuments = documents.filter((document) => document.documentRole === "quote");
  return `
    <article class="job-request-card ${request.priority === "Emergency" ? "emergency" : ""}">
      <div class="request-priority-rail"></div>
      <div class="request-main">
        <div class="request-head">
          <div>
            <p class="eyebrow">${escapeHtml(request.requestNumber)} · ${formatDateTime(request.receivedAt)}</p>
            <h3>
              ${
                account
                  ? `<button class="request-account-link" type="button" data-action="view-account" data-id="${escapeAttribute(account.id)}">${escapeHtml(account.name)}</button>`
                  : escapeHtml(request.customerName)
              }
            </h3>
            <span class="request-account-reference">${account ? `Linked account · ${escapeHtml(account.accountNumber || account.id)}` : "Legacy request · account not linked"}</span>
            <p>${escapeHtml(request.description)}</p>
          </div>
          <div class="request-statuses">
            <span class="risk-badge ${getPriorityTone(request.priority)}">${escapeHtml(request.priority)}</span>
            ${renderDispatchStatusBadge(request.status)}
          </div>
        </div>
        <dl class="request-facts">
          <div><dt>Service</dt><dd>${escapeHtml(request.serviceCategory)} · ${escapeHtml(request.requestedTimeText || "Not set")}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml(request.addressText || "Not set")}</dd></div>
          <div><dt>Called in by</dt><dd>${escapeHtml(request.calledInByName || "Not set")}</dd></div>
          <div><dt>Onsite POC</dt><dd>${escapeHtml(request.onsiteContactName || "Not set")} · ${escapeHtml(request.onsiteContactPhone || "No phone")}</dd></div>
          <div><dt>Requested lead</dt><dd>${escapeHtml(request.requestedAssignee || "Unassigned")}</dd></div>
          <div><dt>Estimate</dt><dd>${formatDuration(request.estimatedDurationMinutes)}</dd></div>
        </dl>
        <div class="request-notes-grid">
          <div><span>Equipment</span><strong>${escapeHtml(request.equipmentNotes || "None noted")}</strong></div>
          <div><span>Labor</span><strong>${escapeHtml(request.laborNotes || "None noted")}</strong></div>
          <div><span>Vendor</span><strong>${escapeHtml(request.vendorNotes || "None noted")}</strong></div>
          <div><span>Pricing</span><strong>${escapeHtml(request.pricingNotes || "Not set")}</strong></div>
        </div>
      </div>
      <aside class="request-side">
        <div><span>Customer packet</span><strong>${customerPacketDocuments.length ? `${customerPacketDocuments.length} uploaded` : escapeHtml(request.customerPacketStatus || "Missing")}</strong></div>
        <div><span>Quote</span><strong>${quoteDocuments.length ? `${quoteDocuments.length} uploaded` : escapeHtml(request.quoteStatus || "Missing")}</strong></div>
        <div><span>Customer PO</span><strong>${escapeHtml(request.customerPoNumber || "Not provided")}</strong></div>
        <div><span>BioRemedy PO</span><strong>${escapeHtml(request.bioremedyPoNumber || "Not assigned")}</strong></div>
        ${documents.length ? `<div class="request-document-list"><span>Request documents</span>${documents.map(renderJobRequestDocument).join("")}</div>` : ""}
        <div class="request-actions">
          ${
            convertedJob
              ? `<button class="secondary-button" type="button" data-action="view-dispatch-job" data-id="${convertedJob.id}">Open job</button>`
              : canConvert
                ? `<button class="primary-button" type="button" data-action="convert-job-request" data-id="${request.id}">Create job</button>`
                : ""
          }
        </div>
      </aside>
    </article>
  `;
}

function renderJobRequestDocument(document) {
  return `
    <button class="request-document-link" type="button" data-action="download-job-request-document" data-id="${escapeAttribute(document.id)}">
      <span class="document-type-mark" aria-hidden="true">${escapeHtml(getFileExtension(document.fileName))}</span>
      <span>
        <strong>${escapeHtml(document.fileName)}</strong>
        <small>${escapeHtml(formatDocumentRole(document.documentRole))} · ${formatFileSize(document.sizeBytes)}</small>
      </span>
      <span class="document-download-label">Download</span>
    </button>
  `;
}

function renderDispatchJobs() {
  const jobs = getFilteredDispatchJobs();
  const allJobs = getDispatchJobs();
  const blocking = allJobs.filter((job) => getJobReadiness(job).status === "Blocked");
  const inField = allJobs.filter((job) => ["acknowledged", "en_route", "on_site", "in_progress", "paused"].includes(job.status));
  const review = allJobs.filter((job) => ["field_complete", "office_review"].includes(job.status));
  const filterAccount = state.dispatchAccountFilter ? findAccount(state.dispatchAccountFilter) : null;

  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Jobs",
        "Every dispatchable work packet, separate from the overall customer project.",
        `<button class="primary-button" type="button" data-action="open-job-request">New job request</button>`,
      )}
      ${
        filterAccount
          ? `
            <section class="core-table-notice" aria-label="Account filter">
              <div>
                <strong>Filtered to ${escapeHtml(filterAccount.name)}</strong>
                <span>Showing only dispatch jobs linked to this account.</span>
              </div>
              <div class="inline-actions">
                <button class="mini-button" type="button" data-action="clear-dispatch-filter">Clear filter</button>
              </div>
            </section>
          `
          : ""
      }
      <section class="metric-strip">
        <div class="metric"><p class="eyebrow">Open jobs</p><strong>${allJobs.filter((job) => !isTerminalDispatchStatus(job.status)).length}</strong><span>Planning through review</span></div>
        <div class="metric"><p class="eyebrow">In field</p><strong>${inField.length}</strong><span>Dispatched or active</span></div>
        <div class="metric"><p class="eyebrow">Blocked</p><strong>${blocking.length}</strong><span>Dispatch cannot proceed</span></div>
        <div class="metric"><p class="eyebrow">Office review</p><strong>${review.length}</strong><span>Field work returned</span></div>
      </section>
      <article class="panel">
        <div class="panel-header">
          <div><h3>Job register</h3><span>${jobs.length} records shown</span></div>
          <div class="toolbar">
            <select id="dispatchJobFilter" aria-label="Filter jobs">
              ${["Open", "Planning", "Scheduled", "In field", "Review", "Closed", "All"].map((value) => `<option value="${value}" ${state.dispatchJobFilter === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="panel-body">
          <table class="data-table dispatch-jobs-table">
            <thead><tr><th>Job</th><th>Customer / Location</th><th>Schedule</th><th>Field lead</th><th>Readiness</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${jobs.map(renderDispatchJobTableRow).join("") || `<tr><td colspan="7"><div class="empty-state">No jobs in this filter.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderDispatchJobTableRow(job) {
  const lead = findEmployee(job.fieldLeadEmployeeId);
  const readiness = getJobReadiness(job);
  return `
    <tr>
      <td data-label="Job">
        <button class="table-record-link" type="button" data-action="view-dispatch-job" data-id="${job.id}">
          <strong>${escapeHtml(job.jobNumber)}</strong>
          <span>${escapeHtml(job.jobName)}</span>
          <small>${escapeHtml(job.jobType)} v${Number(job.jobTypeVersion || 1)}</small>
        </button>
      </td>
      <td data-label="Customer / Location"><strong>${escapeHtml(job.customerName)}</strong><span class="table-subtext">${escapeHtml(job.locationName)}</span></td>
      <td data-label="Schedule"><strong>${formatDateTime(job.scheduledStart)}</strong><span class="table-subtext">${job.scheduledEnd ? `to ${formatShortTime(job.scheduledEnd)}` : "End not set"}</span></td>
      <td data-label="Field lead"><strong>${escapeHtml(lead?.displayName || "Unassigned")}</strong><span class="table-subtext">${dispatchAssignmentsForJob(job.id).length} assigned</span></td>
      <td data-label="Readiness">${renderReadinessBadge(readiness.status)}<span class="table-subtext">${escapeHtml(readiness.summary)}</span></td>
      <td data-label="Status">${renderDispatchStatusBadge(formatDispatchStatus(job.status))}<span class="table-subtext">${escapeHtml(job.dispatchStatus || "")}</span></td>
      <td data-label="Action"><button class="mini-button" type="button" data-action="view-dispatch-job" data-id="${job.id}">Open</button></td>
    </tr>
  `;
}

function renderDispatchBoard() {
  const jobs = getDispatchJobs().filter((job) => !isTerminalDispatchStatus(job.status));
  const columns = [
    { id: "planning", label: "Planning", statuses: ["request_submitted", "dispatch_review", "draft", "ready"] },
    { id: "scheduled", label: "Scheduled", statuses: ["scheduled", "dispatched"] },
    { id: "field", label: "In Field", statuses: ["acknowledged", "en_route", "on_site", "in_progress", "paused"] },
    { id: "review", label: "Review", statuses: ["field_complete", "office_review"] },
  ];

  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Dispatch Board",
        "Status-driven coordination from job planning through field return and office review.",
        `<button class="primary-button" type="button" data-action="open-job-request">New job request</button>`,
      )}
      <section class="dispatch-board-grid">
        ${columns.map((column) => renderDispatchBoardColumn(column, jobs.filter((job) => column.statuses.includes(job.status)))).join("")}
      </section>
    </section>
  `;
}

function renderDispatchBoardColumn(column, jobs) {
  return `
    <section class="dispatch-column ${column.id}">
      <div class="dispatch-column-head"><h3>${escapeHtml(column.label)}</h3><span>${jobs.length}</span></div>
      <div class="dispatch-column-body">
        ${jobs.map(renderDispatchBoardCard).join("") || `<div class="empty-state compact">No jobs</div>`}
      </div>
    </section>
  `;
}

function renderDispatchBoardCard(job) {
  const readiness = getJobReadiness(job);
  const assignments = dispatchAssignmentsForJob(job.id);
  return `
    <button class="dispatch-board-card" type="button" data-action="view-dispatch-job" data-id="${job.id}">
      <div class="dispatch-card-head"><span class="job-number">${escapeHtml(job.jobNumber)}</span>${renderReadinessBadge(readiness.status)}</div>
      <strong>${escapeHtml(job.jobName)}</strong>
      <span>${escapeHtml(job.customerName)}</span>
      <div class="dispatch-card-time"><strong>${formatDateTime(job.scheduledStart)}</strong><span>${escapeHtml(job.locationName)}</span></div>
      <div class="dispatch-card-foot">
        <span class="avatar-stack compact">${assignments.slice(0, 4).map((assignment) => `<i title="${escapeAttribute(findEmployee(assignment.employeeId)?.displayName || "Worker")}">${escapeHtml(getInitials(findEmployee(assignment.employeeId)?.displayName, "BR"))}</i>`).join("")}</span>
        <span>${assignments.length} workers</span>
        <span>${escapeHtml(formatDispatchStatus(job.status))}</span>
      </div>
    </button>
  `;
}

function renderDispatchCalendar() {
  const days = getDispatchCalendarDays();
  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Dispatch Schedule",
        "Jobs, crews, field leads, and readiness by day.",
      )}
      <section class="dispatch-calendar-grid">
        ${days.map(renderDispatchCalendarDay).join("")}
      </section>
    </section>
  `;
}

function renderDispatchCalendarDay(day) {
  return `
    <article class="dispatch-calendar-day ${day.isToday ? "today" : ""}">
      <div class="schedule-day-head"><strong>${escapeHtml(day.label)}</strong><span>${formatDate(day.date)}</span></div>
      <div class="record-list">
        ${day.jobs.map(renderDispatchCalendarCard).join("") || `<div class="empty-state compact">No scheduled jobs</div>`}
      </div>
    </article>
  `;
}

function renderDispatchCalendarCard(job) {
  const lead = findEmployee(job.fieldLeadEmployeeId);
  return `
    <button class="dispatch-calendar-card" type="button" data-action="view-dispatch-job" data-id="${job.id}">
      <span class="calendar-time">${formatShortTime(job.scheduledStart)}</span>
      <span><strong>${escapeHtml(job.jobNumber)}</strong><small>${escapeHtml(job.customerName)}</small></span>
      <span><strong>${escapeHtml(lead?.displayName || "Unassigned")}</strong><small>${escapeHtml(job.jobType)}</small></span>
      ${renderReadinessBadge(getJobReadiness(job).status)}
    </button>
  `;
}

function renderDispatchConflicts() {
  const conflicts = getJobConflicts()
    .map((conflict) => ({ ...conflict, job: findDispatchJob(conflict.jobId) }))
    .sort((a, b) => conflictPriority(a.severity) - conflictPriority(b.severity));
  const open = conflicts.filter((conflict) => conflict.status === "Open");
  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Schedule and Eligibility Conflicts",
        "Credential, availability, crew coverage, equipment, and overlapping schedule exceptions.",
      )}
      <section class="metric-strip">
        <div class="metric"><p class="eyebrow">Open</p><strong>${open.length}</strong><span>Needs dispatcher action</span></div>
        <div class="metric"><p class="eyebrow">Blocking</p><strong>${open.filter((conflict) => conflict.severity === "Blocking").length}</strong><span>Stops dispatch</span></div>
        <div class="metric"><p class="eyebrow">Warnings</p><strong>${open.filter((conflict) => conflict.severity === "Warning").length}</strong><span>Review before sending</span></div>
        <div class="metric"><p class="eyebrow">Acknowledged</p><strong>${conflicts.filter((conflict) => conflict.status === "Acknowledged").length}</strong><span>Documented disposition</span></div>
      </section>
      <section class="conflict-list">
        ${conflicts.map(renderDispatchConflictCard).join("") || `<div class="empty-state">No dispatch conflicts.</div>`}
      </section>
    </section>
  `;
}

function renderDispatchConflictCard(conflict) {
  const assignment = getJobAssignments().find((item) => item.id === conflict.assignmentId);
  const employee = assignment ? findEmployee(assignment.employeeId) : null;
  return `
    <article class="dispatch-conflict-card ${conflict.severity.toLowerCase()}">
      <div class="conflict-icon" aria-hidden="true">!</div>
      <div>
        <div class="inline-actions"><span class="risk-badge ${getReadinessTone(conflict.severity)}">${escapeHtml(conflict.severity)}</span><span class="source-badge">${escapeHtml(conflict.status)}</span></div>
        <h3>${escapeHtml(conflict.title)}</h3>
        <p>${escapeHtml(conflict.detail)}</p>
        <span>${escapeHtml(conflict.type)}${employee ? ` · ${escapeHtml(employee.displayName)}` : ""}</span>
      </div>
      <button class="secondary-button" type="button" data-action="view-dispatch-job" data-id="${conflict.jobId}">${escapeHtml(conflict.job?.jobNumber || "Open job")}</button>
    </article>
  `;
}

const TEMPLATE_TASK_TYPES = ["Status transition", "Form", "Checklist", "Timer", "Material", "Photo", "Sample", "Signature"];
const TEMPLATE_ASSIGNEE_SCOPES = ["All assigned workers", "Each worker", "Field Lead", "Any assigned worker"];
const SIGNATURE_SIGNER_ROLES = ["Customer", "Site Contact", "Field Lead"];
const TIMER_ANCHORS = [
  { value: "en_route", label: "When the crew went en route" },
  { value: "on_site", label: "When the crew arrived on site" },
  { value: "in_progress", label: "When work started" },
];
const JOB_REQUEST_SERVICE_CATEGORIES = ["ER", "Sampling", "Scheduled", "Remediation", "Abatement"];

function renderDispatchTemplates() {
  const templates = getJobTypeTemplates();
  const active = templates.filter((template) => template.isActive !== false);
  app.innerHTML = `
    <section class="view dispatch-view">
      ${renderWorkspaceHeader(
        "dispatch",
        "Job Templates",
        "Reusable work plans that define the stages and sub-tasks a job goes through, from mobilization to closeout. Pick one when a job request converts to a job, or build your own.",
        `<button class="primary-button" type="button" data-action="open-template-editor">New template</button>`,
      )}
      <section class="metric-strip" aria-label="Template metrics">
        <div class="metric"><p class="eyebrow">Templates</p><strong>${templates.length}</strong><span>${active.length} active</span></div>
        <div class="metric"><p class="eyebrow">Service categories covered</p><strong>${new Set(active.map((template) => template.serviceCategory)).size}</strong><span>of ${JOB_REQUEST_SERVICE_CATEGORIES.length}</span></div>
      </section>
      <section class="record-list">
        ${templates.map(renderTemplateCard).join("") || `<div class="empty-state">No job templates yet. Create one to stop using the default generic work plan.</div>`}
      </section>
    </section>
  `;
}

function renderTemplateCard(template) {
  const stages = template.stages || [];
  const taskCount = stages.reduce((sum, stage) => sum + (stage.tasks || []).length, 0);
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <strong>${escapeHtml(template.name || "Untitled template")}</strong>
          <div class="row-meta">
            <span>${escapeHtml(template.serviceCategory)}</span>
            <span>${stages.length} stage${stages.length === 1 ? "" : "s"}</span>
            <span>${taskCount} sub-task${taskCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        <span class="risk-badge ${template.isActive === false ? "medium" : "low"}">${template.isActive === false ? "Inactive" : "Active"}</span>
      </div>
      ${template.description ? `<p class="help-text">${escapeHtml(template.description)}</p>` : ""}
      <div class="inline-actions">
        ${stages.map((stage) => `<span class="tag">${escapeHtml(stage.name)}</span>`).join("")}
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="open-template-editor" data-id="${escapeAttribute(template.id)}">Edit</button>
        <button class="mini-button" type="button" data-action="toggle-template-active" data-id="${escapeAttribute(template.id)}">${template.isActive === false ? "Reactivate" : "Deactivate"}</button>
      </div>
    </article>
  `;
}

function renderTemplateEditor() {
  const draft = state.templateDraft;
  if (!draft) {
    state.view = "dispatch-templates";
    renderDispatchTemplates();
    return;
  }
  const isNew = !draft.id;

  app.innerHTML = `
    <section class="view dispatch-view">
      <div class="detail-topline">
        <button class="back-button" type="button" data-view="dispatch-templates">Back to templates</button>
        <div class="inline-actions">
          <button class="primary-button" type="button" data-action="save-template">Save template</button>
        </div>
      </div>
      <section class="employee-detail-header">
        <div>
          <p class="eyebrow">${isNew ? "New job template" : "Editing job template"}</p>
          <h2>${escapeHtml(draft.name || "Untitled template")}</h2>
          <p>Define the stages a job moves through and the sub-tasks inside each stage. This becomes the frozen work plan on any job created from it.</p>
        </div>
      </section>

      <section id="templateEditorRoot" class="employee-detail-layout">
        <div class="employee-detail-main">
          <article class="panel">
            <div class="panel-header"><h3>Template details</h3></div>
            <div class="panel-body">
              <div class="form-grid">
                <label>
                  Name
                  <input data-field="template-name" maxlength="90" placeholder="Emergency Spill Response" value="${escapeAttribute(draft.name)}" />
                </label>
                <label>
                  Service category
                  <select data-field="template-service-category">
                    ${JOB_REQUEST_SERVICE_CATEGORIES.map((category) => `<option ${draft.serviceCategory === category ? "selected" : ""}>${category}</option>`).join("")}
                  </select>
                </label>
              </div>
              <label>
                Description
                <textarea data-field="template-description" rows="2" maxlength="240" placeholder="What kind of job is this template for?">${escapeHtml(draft.description)}</textarea>
              </label>
              <label class="check-row">
                <input type="checkbox" data-field="template-active" ${draft.isActive !== false ? "checked" : ""} />
                <span>Active (selectable when creating a job)</span>
              </label>
            </div>
          </article>

          ${draft.stages.map((stage, stageIndex) => renderTemplateStageEditor(stage, stageIndex, draft.stages.length)).join("")}

          <button class="secondary-button" type="button" data-action="add-template-stage">Add stage</button>
        </div>

        <aside class="employee-detail-sidebar">
          <article class="panel">
            <div class="panel-header"><h3>How this is used</h3></div>
            <div class="panel-body">
              <ul class="reference-list">
                <li>Stages run in order, top to bottom (e.g. Mobilize, then Perform Work, then Closeout).</li>
                <li>Each stage has its own sub-tasks, which become the job's checklist and forms.</li>
                <li>When a dispatcher creates a job from a request, they pick one of your active templates and this plan is copied onto that job.</li>
                <li>Editing a template only affects jobs created after the change; existing jobs keep their own copy.</li>
              </ul>
            </div>
          </article>
        </aside>
      </section>
    </section>
  `;
}

function renderTemplateStageEditor(stage, stageIndex, stageCount) {
  return `
    <article class="panel" data-stage-index="${stageIndex}">
      <div class="panel-header">
        <div><h3>Stage ${stageIndex + 1}</h3><span>${(stage.tasks || []).length} sub-task${(stage.tasks || []).length === 1 ? "" : "s"}</span></div>
        <div class="inline-actions">
          <button class="mini-button" type="button" data-action="move-template-stage" data-stage-index="${stageIndex}" data-direction="up" ${stageIndex === 0 ? "disabled" : ""}>Move up</button>
          <button class="mini-button" type="button" data-action="move-template-stage" data-stage-index="${stageIndex}" data-direction="down" ${stageIndex === stageCount - 1 ? "disabled" : ""}>Move down</button>
          <button class="mini-button" type="button" data-action="remove-template-stage" data-stage-index="${stageIndex}" ${stageCount <= 1 ? "disabled" : ""}>Remove stage</button>
        </div>
      </div>
      <div class="panel-body">
        <label>
          Stage name
          <input data-stage-index="${stageIndex}" data-stage-name="${stageIndex}" maxlength="60" placeholder="Mobilize" value="${escapeAttribute(stage.name)}" />
        </label>
        <div class="record-list">
          ${(stage.tasks || []).map((task, taskIndex) => renderTemplateTaskEditor(task, stageIndex, taskIndex, (stage.tasks || []).length)).join("") || `<div class="empty-state compact">No sub-tasks in this stage yet.</div>`}
        </div>
        <button class="mini-button" type="button" data-action="add-template-task" data-stage-index="${stageIndex}">Add sub-task</button>
      </div>
    </article>
  `;
}

function renderTemplateTaskEditor(task, stageIndex, taskIndex, taskCount) {
  return `
    <article class="inventory-card" data-stage-index="${stageIndex}" data-task-index="${taskIndex}">
      <div class="form-grid">
        <label>
          Sub-task name
          <input data-stage-index="${stageIndex}" data-task-name="${taskIndex}" maxlength="90" placeholder="Deploy containment and protect drains" value="${escapeAttribute(task.name)}" />
        </label>
        <label>
          Type
          <select data-stage-index="${stageIndex}" data-task-type="${taskIndex}">
            ${TEMPLATE_TASK_TYPES.map((type) => `<option ${task.type === type ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="form-grid">
        <label>
          Who does it
          <select data-stage-index="${stageIndex}" data-task-scope="${taskIndex}">
            ${TEMPLATE_ASSIGNEE_SCOPES.map((scope) => `<option ${task.assigneeScope === scope ? "selected" : ""}>${scope}</option>`).join("")}
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" data-stage-index="${stageIndex}" data-task-required="${taskIndex}" ${task.required !== false ? "checked" : ""} />
          <span>Required</span>
        </label>
      </div>
      ${renderTemplateTaskConfigEditor(task, stageIndex, taskIndex)}
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="remove-template-task" data-stage-index="${stageIndex}" data-task-index="${taskIndex}" ${taskCount <= 1 ? "disabled" : ""}>Remove sub-task</button>
      </div>
    </article>
  `;
}

function renderTemplateTaskConfigEditor(task, stageIndex, taskIndex) {
  const config = normalizeTaskConfig(task.type, task.config);
  const scope = `data-stage-index="${stageIndex}"`;

  if (task.type === "Checklist") {
    return `
      <label class="template-task-config">
        What can they check off
        <textarea ${scope} data-task-options="${taskIndex}" rows="4" placeholder="One option per line, for example:&#10;Drains protected&#10;Booms deployed">${escapeHtml(config.options.join("\n"))}</textarea>
        <span class="help-text">One option per line. The field crew ticks these off on the job.</span>
      </label>
    `;
  }

  if (task.type === "Photo") {
    return `
      <label class="template-task-config">
        Minimum photos required
        <input type="number" min="1" max="20" ${scope} data-task-min-photos="${taskIndex}" value="${Number(config.minPhotos)}" />
      </label>
    `;
  }

  if (task.type === "Material") {
    const items = getInventoryItems();
    if (!items.length) {
      return `<div class="template-task-config help-text">No inventory items are available to suggest yet.</div>`;
    }
    return `
      <label class="template-task-config">
        Suggested materials
        <select ${scope} data-task-suggested-items="${taskIndex}" multiple size="${Math.min(items.length, 5)}">
          ${items
            .map(
              (item) =>
                `<option value="${escapeAttribute(item.id)}" ${config.suggestedItemIds.includes(item.id) ? "selected" : ""}>${escapeHtml(item.materialType)} (${escapeHtml(item.unit || "")})</option>`,
            )
            .join("")}
        </select>
        <span class="help-text">Pre-loaded on the field form. The crew can still add or remove items.</span>
      </label>
    `;
  }

  if (task.type === "Signature") {
    return `
      <label class="template-task-config">
        Who signs
        <select ${scope} data-task-signer-role="${taskIndex}">
          ${SIGNATURE_SIGNER_ROLES.map((role) => `<option ${config.signerRole === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </label>
    `;
  }

  if (task.type === "Timer") {
    return `
      <label class="template-task-config">
        Start counting from
        <select ${scope} data-task-timer-anchor="${taskIndex}">
          ${TIMER_ANCHORS.map((anchor) => `<option value="${anchor.value}" ${config.anchor === anchor.value ? "selected" : ""}>${escapeHtml(anchor.label)}</option>`).join("")}
        </select>
        <span class="help-text">Hours are worked out automatically up to the moment the crew completes this task.</span>
      </label>
    `;
  }

  if (task.type === "Sample") {
    return `
      <div class="form-grid template-task-config">
        <label>
          Default matrix
          <input ${scope} data-task-sample-matrix="${taskIndex}" maxlength="60" placeholder="Soil" value="${escapeAttribute(config.defaultMatrix)}" />
        </label>
        <label>
          Default container
          <input ${scope} data-task-sample-container="${taskIndex}" maxlength="90" placeholder="2 amber jars" value="${escapeAttribute(config.defaultContainer)}" />
        </label>
        <label>
          Default analyses
          <textarea ${scope} data-task-sample-analyses="${taskIndex}" rows="3" placeholder="One analysis per line">${escapeHtml(config.defaultAnalyses.join("\n"))}</textarea>
        </label>
      </div>
    `;
  }

  return "";
}

function openTemplateEditor(templateId = "") {
  const template = templateId ? findJobTypeTemplate(templateId) : null;
  state.templateDraft = template ? cloneTemplateForEditing(template) : createBlankTemplateDraft();
  state.selectedTemplateId = templateId || "";
  state.view = "dispatch-template-editor";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function syncTemplateDraftFromDom() {
  const draft = state.templateDraft;
  const root = document.querySelector("#templateEditorRoot");
  if (!draft || !root) return;

  const nameField = root.querySelector('[data-field="template-name"]');
  const categoryField = root.querySelector('[data-field="template-service-category"]');
  const descriptionField = root.querySelector('[data-field="template-description"]');
  const activeField = root.querySelector('[data-field="template-active"]');
  if (nameField) draft.name = nameField.value;
  if (categoryField) draft.serviceCategory = categoryField.value;
  if (descriptionField) draft.description = descriptionField.value;
  if (activeField) draft.isActive = activeField.checked;

  draft.stages.forEach((stage, stageIndex) => {
    const stageNameField = root.querySelector(`[data-stage-name="${stageIndex}"]`);
    if (stageNameField) stage.name = stageNameField.value;
    stage.sequence = stageIndex + 1;
    stage.tasks.forEach((task, taskIndex) => {
      const nameEl = root.querySelector(`[data-stage-index="${stageIndex}"][data-task-name="${taskIndex}"]`);
      const typeEl = root.querySelector(`[data-stage-index="${stageIndex}"][data-task-type="${taskIndex}"]`);
      const scopeEl = root.querySelector(`[data-stage-index="${stageIndex}"][data-task-scope="${taskIndex}"]`);
      const requiredEl = root.querySelector(`[data-stage-index="${stageIndex}"][data-task-required="${taskIndex}"]`);
      if (nameEl) task.name = nameEl.value;
      if (typeEl) task.type = typeEl.value;
      if (scopeEl) task.assigneeScope = scopeEl.value;
      if (requiredEl) task.required = requiredEl.checked;
      task.config = readTaskConfigFromDom(root, task.type, stageIndex, taskIndex);
    });
  });
}

// Config controls are addressed by the same stage+task index pair the rest of the editor uses.
// Both attributes are required: the lookups below are unscoped, so a control missing the stage
// index would match the same task index in an earlier stage.
function readTaskConfigFromDom(root, type, stageIndex, taskIndex) {
  const field = (name) => root.querySelector(`[data-stage-index="${stageIndex}"][data-task-${name}="${taskIndex}"]`);
  if (type === "Checklist") {
    const el = field("options");
    return normalizeTaskConfig(type, { options: el ? el.value.split("\n") : [] });
  }
  if (type === "Photo") {
    const el = field("min-photos");
    return normalizeTaskConfig(type, { minPhotos: el ? el.value : 1 });
  }
  if (type === "Material") {
    const el = field("suggested-items");
    return normalizeTaskConfig(type, { suggestedItemIds: el ? [...el.selectedOptions].map((option) => option.value) : [] });
  }
  if (type === "Signature") {
    const el = field("signer-role");
    return normalizeTaskConfig(type, { signerRole: el ? el.value : "" });
  }
  if (type === "Timer") {
    const el = field("timer-anchor");
    return normalizeTaskConfig(type, { anchor: el ? el.value : "" });
  }
  if (type === "Sample") {
    return normalizeTaskConfig(type, {
      defaultMatrix: field("sample-matrix")?.value || "",
      defaultContainer: field("sample-container")?.value || "",
      defaultAnalyses: field("sample-analyses") ? field("sample-analyses").value.split("\n") : [],
    });
  }
  return {};
}

function addTemplateStage() {
  syncTemplateDraftFromDom();
  const draft = state.templateDraft;
  draft.stages.push({
    key: `stage-${draft.stages.length}`,
    name: "",
    sequence: draft.stages.length + 1,
    tasks: [{ key: "task-0", name: "", type: "Checklist", assigneeScope: "Any assigned worker", required: true, config: normalizeTaskConfig("Checklist") }],
  });
  render();
}

function removeTemplateStage(stageIndex) {
  syncTemplateDraftFromDom();
  const draft = state.templateDraft;
  if (draft.stages.length <= 1) return;
  draft.stages.splice(stageIndex, 1);
  render();
}

function moveTemplateStage(stageIndex, direction) {
  syncTemplateDraftFromDom();
  const draft = state.templateDraft;
  const targetIndex = direction === "up" ? stageIndex - 1 : stageIndex + 1;
  if (targetIndex < 0 || targetIndex >= draft.stages.length) return;
  const [stage] = draft.stages.splice(stageIndex, 1);
  draft.stages.splice(targetIndex, 0, stage);
  render();
}

function addTemplateTask(stageIndex) {
  syncTemplateDraftFromDom();
  const stage = state.templateDraft.stages[stageIndex];
  if (!stage) return;
  stage.tasks.push({ key: `task-${stageIndex}-${stage.tasks.length}`, name: "", type: "Checklist", assigneeScope: "Any assigned worker", required: true, config: normalizeTaskConfig("Checklist") });
  render();
}

function removeTemplateTask(stageIndex, taskIndex) {
  syncTemplateDraftFromDom();
  const stage = state.templateDraft.stages[stageIndex];
  if (!stage || stage.tasks.length <= 1) return;
  stage.tasks.splice(taskIndex, 1);
  render();
}

async function saveTemplateDraft() {
  syncTemplateDraftFromDom();
  const draft = state.templateDraft;
  if (!draft.name.trim()) {
    showToast("Give the template a name before saving.");
    return;
  }
  if (!draft.stages.some((stage) => stage.name.trim())) {
    showToast("Name at least one stage before saving.");
    return;
  }

  const record = {
    id: draft.id || makeId("jobtype"),
    name: draft.name.trim(),
    serviceCategory: draft.serviceCategory,
    description: draft.description.trim(),
    isActive: draft.isActive,
    stages: draft.stages.map((stage, stageIndex) => ({
      key: stage.key || `stage-${stageIndex}`,
      name: stage.name.trim() || `Stage ${stageIndex + 1}`,
      sequence: stageIndex + 1,
      tasks: stage.tasks
        .filter((task) => task.name.trim())
        .map((task, taskIndex) => ({
          key: task.key || `task-${stageIndex}-${taskIndex}`,
          name: task.name.trim(),
          type: task.type,
          assigneeScope: task.assigneeScope,
          required: Boolean(task.required),
          config: normalizeTaskConfig(task.type, task.config),
        })),
    })),
    updatedBy: state.currentUser?.name || "Local user",
  };

  try {
    await saveBackendRecord("jobTypeTemplates", record);
    state.templateDraft = null;
    state.selectedTemplateId = "";
    state.view = "dispatch-templates";
    render();
    showToast("Job template saved.");
  } catch (error) {
    showToast(error.message || "Job template could not be saved.");
  }
}

async function toggleTemplateActive(templateId) {
  const template = findJobTypeTemplate(templateId);
  if (!template) return;
  try {
    await saveBackendRecord("jobTypeTemplates", { ...template, isActive: template.isActive === false });
    render();
    showToast(template.isActive === false ? "Template reactivated." : "Template deactivated.");
  } catch (error) {
    showToast(error.message || "Template could not be updated.");
  }
}

const dispatchJobDetailTabs = [
  { id: "summary", label: "Summary" },
  { id: "details", label: "Details" },
  { id: "assignment", label: "Assignment" },
  { id: "files-activity", label: "Files & Activity" },
];

function renderDispatchJobDetail() {
  const job = findDispatchJob(state.selectedDispatchJobId);
  if (!job) {
    state.view = "dispatch-jobs";
    state.selectedDispatchJobId = "";
    renderDispatchJobs();
    return;
  }

  const readiness = getJobReadiness(job);
  const nextTransition = getNextDispatchTransition(job.status);
  const gate = getWorkPlanGate(job);
  const activeTab = state.dispatchJobDetailTab || "summary";

  app.innerHTML = `
    <section class="view dispatch-job-detail-view">
      <div class="detail-topline">
        <button class="back-button" type="button" data-action="back-to-dispatch-jobs">Back to jobs</button>
        <div class="inline-actions">
          <button class="secondary-button" type="button" data-action="open-job-schedule" data-job-id="${job.id}">Schedule</button>
          ${nextTransition ? `<button class="primary-button" type="button" data-action="advance-dispatch-job" data-id="${job.id}" ${gate.blocked ? "disabled" : ""}>${escapeHtml(nextTransition.label)}</button>` : ""}
        </div>
      </div>
      ${gate.blocked ? `<p class="help-text">${escapeHtml(gate.reason)}</p>` : ""}

      <section class="job-detail-header">
        <div>
          <div class="inline-actions">
            <span class="job-number">${escapeHtml(job.jobNumber)}</span>
            ${renderDispatchStatusBadge(formatDispatchStatus(job.status))}
            ${renderReadinessBadge(readiness.status)}
          </div>
          <h2>${escapeHtml(job.jobName)}</h2>
          <p>${escapeHtml(job.customerName)} · ${escapeHtml(job.locationName)}</p>
        </div>
        <div class="job-progress-summary">
          <strong>${Number(job.completionPercent || 0)}%</strong>
          <span>Execution complete</span>
          <div class="progress-track"><span style="width:${Math.min(100, Number(job.completionPercent || 0))}%"></span></div>
        </div>
      </section>

      <div class="account-detail-tabs-row">
        ${renderDispatchJobDetailTabs(activeTab)}
      </div>
      <div class="account-detail-tabbody">
        ${renderDispatchJobTabBody(activeTab, job, readiness)}
      </div>
    </section>
  `;
}

function renderDispatchJobDetailTabs(activeTab) {
  return `
    <div class="segment-tabs" role="tablist" aria-label="Dispatch job detail sections">
      ${dispatchJobDetailTabs
        .map(
          (tab) => `
            <button type="button" role="tab" aria-selected="${tab.id === activeTab}" class="${tab.id === activeTab ? "active" : ""}" data-action="switch-dispatch-job-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDispatchJobTabBody(tab, job, readiness) {
  switch (tab) {
    case "details":
      return renderDispatchJobDetailsTab(job);
    case "assignment":
      return renderDispatchJobAssignmentTab(job);
    case "files-activity":
      return renderDispatchJobFilesActivityTab(job);
    case "summary":
    default:
      return renderDispatchJobSummaryTab(job, readiness);
  }
}

function renderDispatchJobSummaryTab(job, readiness) {
  const lead = findEmployee(job.fieldLeadEmployeeId);
  const assignments = dispatchAssignmentsForJob(job.id);
  const conflicts = conflictsForDispatchJob(job.id);

  return `
    <section class="detail-stack">
      <section class="job-detail-metrics">
        <div><span>Scheduled</span><strong>${formatDateTime(job.scheduledStart)}</strong><small>${job.scheduledEnd ? `to ${formatShortTime(job.scheduledEnd)}` : "No end time"}</small></div>
        <div><span>Field lead</span><strong>${escapeHtml(lead?.displayName || "Unassigned")}</strong><small>${assignments.length} total workers</small></div>
        <div><span>Job type</span><strong>${escapeHtml(job.jobType)}</strong><small>${escapeHtml(job.jobTypeCode)} version ${Number(job.jobTypeVersion || 1)}</small></div>
        <div><span>Pricing</span><strong>${escapeHtml(job.pricingSource || "Not set")}</strong><small>${escapeHtml(job.customerPoNumber || "No customer PO")}</small></div>
      </section>

      <section class="job-detail-layout">
        <div class="job-detail-main">
          <article class="panel readiness-panel">
            <div class="panel-header"><div><h3>Dispatch readiness</h3><span>${escapeHtml(readiness.summary)}</span></div>${renderReadinessBadge(readiness.status)}</div>
            <div class="panel-body readiness-check-list">
              ${readiness.checks.map(renderReadinessCheck).join("")}
            </div>
          </article>
        </div>
        <aside class="job-detail-sidebar">
          <article class="panel">
            <div class="panel-header"><div><h3>Exceptions</h3><span>${conflicts.length} related</span></div></div>
            <div class="panel-body record-list">
              ${conflicts.map(renderCompactJobConflict).join("") || `<div class="empty-state compact">No schedule or eligibility conflicts.</div>`}
            </div>
          </article>
        </aside>
      </section>
    </section>
  `;
}

function renderDispatchJobDetailsTab(job) {
  const request = getJobRequests().find((item) => item.id === job.jobRequestId);
  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header"><h3>Job overview</h3><span>${escapeHtml(job.projectName || "No parent project")}</span></div>
        <div class="panel-body">
          <p class="job-description">${escapeHtml(job.description)}</p>
          <dl class="detail-list job-overview-list">
            <div><dt>Address</dt><dd>${escapeHtml(job.addressText || "Not set")}</dd></div>
            <div><dt>Onsite POC</dt><dd>${escapeHtml(job.onsiteContactName || "Not set")} · ${escapeHtml(job.onsiteContactPhone || "No phone")}</dd></div>
            <div><dt>Generator / RP</dt><dd>${escapeHtml(job.generatorResponsibleParty || "Unknown")}</dd></div>
            <div><dt>BioRemedy PO</dt><dd>${escapeHtml(job.bioremedyPoNumber || "Not assigned")}</dd></div>
            <div><dt>Customer PO</dt><dd>${escapeHtml(job.customerPoNumber || "Not provided")}</dd></div>
            <div><dt>Request</dt><dd>${escapeHtml(request?.requestNumber || "Direct job")} · ${escapeHtml(request?.receivedBy || "Internal")}</dd></div>
          </dl>
        </div>
      </article>
    </section>
  `;
}

function renderDispatchJobAssignmentTab(job) {
  const assignments = dispatchAssignmentsForJob(job.id);
  const resources = resourcesForDispatchJob(job.id);
  const equipmentResources = resources.filter((resource) => resource.type === "Equipment");
  const materialResources = resources.filter((resource) => resource.type === "Material");
  const otherResources = resources.filter((resource) => !["Equipment", "Material"].includes(resource.type));

  return `
    <section class="crm-profile-grid">
      <article class="panel">
        <div class="panel-header">
          <div><h3>Workers</h3><span>${assignments.length} assigned</span></div>
          <button class="mini-button" type="button" data-action="open-dispatch-assign-employee" data-job-id="${escapeAttribute(job.id)}">Assign employee</button>
        </div>
        <div class="panel-body assignment-roster">
          ${assignments.map(renderJobAssignment).join("") || `<div class="empty-state compact">No workers assigned.</div>`}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div><h3>Equipment</h3><span>${equipmentResources.length} assigned</span></div>
          <button class="mini-button" type="button" data-action="open-dispatch-assign-equipment" data-job-id="${escapeAttribute(job.id)}">Assign equipment</button>
        </div>
        <div class="panel-body resource-list">
          ${equipmentResources.map(renderJobResource).join("") || `<div class="empty-state compact">No equipment assigned.</div>`}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div><h3>Materials</h3><span>${materialResources.length} assigned</span></div>
          <button class="mini-button" type="button" data-action="open-dispatch-assign-material" data-job-id="${escapeAttribute(job.id)}">Assign material</button>
        </div>
        <div class="panel-body resource-list">
          ${materialResources.map(renderJobResource).join("") || `<div class="empty-state compact">No materials assigned.</div>`}
        </div>
      </article>

      ${
        otherResources.length
          ? `<article class="panel">
              <div class="panel-header"><div><h3>Other resources</h3><span>${otherResources.length} from the Schedule dialog's quick-add</span></div></div>
              <div class="panel-body resource-list">
                ${otherResources.map(renderJobResource).join("")}
              </div>
            </article>`
          : ""
      }
    </section>
  `;
}

function renderDispatchJobFilesActivityTab(job) {
  const steps = stepsForDispatchJob(job.id);
  const submissions = submissionsForDispatchJob(job.id);
  return `
    <section class="detail-stack">
      <article class="panel">
        <div class="panel-header"><div><h3>Work plan</h3><span>Frozen steps, actions, and linked forms</span></div></div>
        <div class="panel-body work-plan-list">
          ${steps.map((step) => renderJobStep(step, actionsForDispatchStep(step.id))).join("") || `<div class="empty-state">No execution plan instantiated.</div>`}
        </div>
      </article>

      <article class="panel">
        <div class="panel-header"><div><h3>Forms and submissions</h3><span>Typed field outputs from job actions</span></div></div>
        <div class="panel-body form-submission-list">
          ${submissions.map(renderJobFormSubmission).join("") || `<div class="empty-state">No forms submitted yet.</div>`}
        </div>
      </article>
    </section>
  `;
}

function renderJobStep(step, actions) {
  const completed = actions.filter((action) => action.status === "Complete").length;
  return `
    <details class="job-step" ${["Available", "In progress"].includes(step.status) ? "open" : ""}>
      <summary>
        <span class="step-sequence">${Number(step.sequence)}</span>
        <span><strong>${escapeHtml(step.name)}</strong><small>${completed} of ${actions.length} actions complete</small></span>
        ${renderDispatchStatusBadge(step.status)}
      </summary>
      <div class="job-action-list">
        ${actions.map(renderJobAction).join("") || `<div class="empty-state compact">No actions in this step.</div>`}
      </div>
    </details>
  `;
}

function renderJobAction(action) {
  return `
    <article class="job-action-row">
      <span class="action-state ${normalizeCssToken(action.status)}" aria-hidden="true"></span>
      <div><strong>${escapeHtml(action.name)}</strong><span>${escapeHtml(action.type)} · ${escapeHtml(action.assigneeScope)}</span></div>
      <div><span class="action-form-label">${escapeHtml(action.formName || "No form")}</span><small>${action.required ? "Required" : "Optional"}</small></div>
      ${renderDispatchStatusBadge(action.status)}
    </article>
  `;
}

function renderJobFormSubmission(submission) {
  return `
    <article class="form-submission-card">
      <div>
        <span class="source-badge">Form</span><strong>${escapeHtml(submission.formName)}</strong>
        <p>${escapeHtml(submission.summary)}</p>
        ${renderSubmissionPayload(submission)}
      </div>
      <div><strong>${escapeHtml(submission.submittedBy)}</strong><span>${formatDateTime(submission.submittedAt)}</span></div>
      ${renderDispatchStatusBadge(submission.status)}
    </article>
  `;
}

// Shows what the field crew actually captured, in the shape the task type called for. Used by both
// the desktop job detail and the Front Line screen, so office and field see the same thing.
function renderSubmissionPayload(submission) {
  const payload = submission.payload || {};
  const parts = [];

  if (Array.isArray(payload.options) && payload.options.length) {
    parts.push(`
      <ul class="submission-checklist">
        ${payload.options
          .map((option) => {
            const done = (payload.checked || []).includes(option);
            return `<li class="${done ? "done" : ""}">${done ? "✓" : "○"} ${escapeHtml(option)}</li>`;
          })
          .join("")}
      </ul>
    `);
  }

  if (Number.isFinite(payload.hours)) {
    const drifted = Number.isFinite(payload.computedHours) && payload.computedHours !== payload.hours;
    parts.push(
      `<p class="submission-fact"><strong>${payload.hours}</strong> hours${drifted ? ` <span class="muted">(auto-calculated ${payload.computedHours})</span>` : ""}</p>`,
    );
  }

  if (Array.isArray(payload.lines) && payload.lines.length) {
    parts.push(`
      <ul class="submission-materials">
        ${payload.lines.map((line) => `<li>${escapeHtml(String(line.quantity))} ${escapeHtml(line.unit || "")} ${escapeHtml(line.name || "")}</li>`).join("")}
      </ul>
    `);
  }

  if (payload.signedBy) {
    parts.push(`<p class="submission-fact">Signed by ${escapeHtml(payload.signedBy)}${payload.signerRole ? ` (${escapeHtml(payload.signerRole)})` : ""}</p>`);
  }

  const attachments = attachmentsForAction(submission.actionId);
  if (attachments.length) {
    parts.push(`
      <div class="submission-attachments">
        ${attachments
          .map(
            (attachment) =>
              `<a href="/api/job-task-attachments/${encodeURIComponent(attachment.id)}/view" target="_blank" rel="noopener" title="${escapeAttribute(attachment.fileName)}">
                 <img src="/api/job-task-attachments/${encodeURIComponent(attachment.id)}/view" alt="${escapeAttribute(attachment.caption || attachment.fileName)}" class="${attachment.kind === "signature" ? "signature" : ""}" />
               </a>`,
          )
          .join("")}
      </div>
    `);
  }

  return parts.join("");
}

function renderReadinessCheck(check) {
  return `
    <div class="readiness-check ${normalizeCssToken(check.status)}">
      <span aria-hidden="true">${check.status === "Pass" ? "✓" : check.status === "Warning" ? "!" : "×"}</span>
      <div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div>
    </div>
  `;
}

function renderJobAssignment(assignment) {
  const employee = findEmployee(assignment.employeeId);
  return `
    <article class="job-assignment-row">
      <button type="button" data-action="view-employee" data-id="${assignment.employeeId}">
        <span class="person-avatar">${escapeHtml(getInitials(employee?.displayName, "BR"))}</span>
        <span><strong>${escapeHtml(employee?.displayName || "Unknown")}</strong><small>${escapeHtml(assignment.role)} · ${escapeHtml(assignment.status)}</small></span>
        <span class="risk-badge ${getReadinessTone(assignment.eligibilityStatus)}">${escapeHtml(assignment.eligibilityStatus)}</span>
      </button>
      <button class="mini-button" type="button" data-action="unassign-job-employee" data-id="${escapeAttribute(assignment.id)}">Unassign</button>
    </article>
  `;
}

function renderJobResource(resource) {
  const equipmentAsset = resource.assetTag ? findEquipmentAssetByTag(resource.assetTag) : null;
  const inventoryItem = resource.inventoryItemId ? findInventoryItem(resource.inventoryItemId) : null;
  const name = equipmentAsset?.equipment || inventoryItem?.materialType || resource.name;
  const detail = equipmentAsset
    ? equipmentAsset.assetTag
    : inventoryItem
      ? `${Number(resource.quantity || 1)} ${inventoryItem.unit || ""}`
      : resource.assetTag || `${Number(resource.quantity || 1)} ${resource.unit || resource.type}`;
  return `
    <article class="job-resource-row">
      <span class="resource-type-mark">${escapeHtml(getInitials(resource.type, "R"))}</span>
      <div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></div>
      <span class="source-badge">${escapeHtml(resource.status)}</span>
      <button class="mini-button" type="button" data-action="remove-job-resource" data-id="${escapeAttribute(resource.id)}">Remove</button>
    </article>
  `;
}

function renderCompactJobConflict(conflict) {
  return `
    <article class="compact-record">
      <div class="inline-actions"><span class="risk-badge ${getReadinessTone(conflict.severity)}">${escapeHtml(conflict.severity)}</span><span>${escapeHtml(conflict.status)}</span></div>
      <strong>${escapeHtml(conflict.title)}</strong>
      <span>${escapeHtml(conflict.detail)}</span>
    </article>
  `;
}

const equipmentToneRank = { high: 0, medium: 1, low: 2 };

function sortEquipmentByAttention(equipment) {
  return [...equipment].sort(
    (a, b) => equipmentToneRank[a.statusTone] - equipmentToneRank[b.statusTone] || daysUntil(a.maintenanceDue) - daysUntil(b.maintenanceDue),
  );
}

function renderInventory() {
  const consumables = getConsumableStatus();
  const equipment = getEquipmentStatus();
  const equipmentNeedingAttention = sortEquipmentByAttention(equipment).slice(0, 4);
  const labor = getLaborResources();
  const purchaseOrders = getPurchaseOrders();
  const lowConsumables = consumables.filter((item) => item.status !== "Healthy");
  const equipmentBlocks = equipment.filter((item) => item.statusTone === "high");
  const laborWarnings = labor.filter((person) => person.hoursWorked >= person.capacity * 0.9);

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "inventory",
        "Inventory View",
        "Consumables, equipment health, maintenance schedule, and technician labor capacity for operations buyers and schedulers.",
        `
          <button class="primary-button" type="button" data-action="open-purchase-order">Create PO</button>
          <button class="secondary-button" type="button" data-action="open-inventory-item">Add consumable</button>
          <button class="secondary-button" type="button" data-action="open-equipment-asset">Add equipment</button>
          <button class="secondary-button" type="button" data-action="open-employee">Add labor</button>
        `,
      )}
      <section class="metric-strip" aria-label="Inventory metrics">
        <div class="metric">
          <p class="eyebrow">Low consumables</p>
          <strong>${lowConsumables.length}</strong>
          <span>Buyer reorder alerts</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Equipment blocks</p>
          <strong>${equipmentBlocks.length}</strong>
          <span>Should alert scheduler</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Labor pool</p>
          <strong>${labor.length}</strong>
          <span>Tracked technicians and dispatch</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Labor warnings</p>
          <strong>${laborWarnings.length}</strong>
          <span>Near weekly capacity</span>
        </div>
      </section>

      <section class="inventory-grid">
        <article class="panel">
          <div class="panel-header"><h3>Consumables</h3></div>
          <div class="panel-body record-list">
            ${consumables.map(renderConsumableCard).join("")}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Purchase orders</h3></div>
          <div class="panel-body record-list">
            ${purchaseOrders.map(renderPurchaseOrderCard).join("") || `<div class="empty-state">No purchase orders yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <div><h3>Equipment status</h3><span>Top ${equipmentNeedingAttention.length} of ${equipment.length} needing service or a status update</span></div>
            <button class="mini-button" type="button" data-view="inventory-equipment">View all equipment</button>
          </div>
          <div class="panel-body record-list">
            ${equipmentNeedingAttention.map(renderEquipmentAssetCard).join("") || `<div class="empty-state">No equipment on file.</div>`}
          </div>
        </article>
        <article class="panel inventory-labor">
          <div class="panel-header"><h3>Technician labor</h3></div>
          <div class="panel-body labor-grid">
            ${labor.map(renderLaborCard).join("")}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderInventoryConsumables() {
  const consumables = getConsumableStatus();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "inventory",
        "Consumables",
        "Stock levels, reorder points, buyers, and purchase order starting points.",
        `
          <button class="primary-button" type="button" data-action="open-purchase-order">Create PO</button>
          <button class="secondary-button" type="button" data-action="open-inventory-item">Add consumable</button>
        `,
      )}
      <section class="record-list">
        ${consumables.map(renderConsumableCard).join("")}
      </section>
    </section>
  `;
}

function renderConsumableDetail() {
  const consumable = getConsumableStatus().find((item) => item.id === state.selectedConsumableId);
  if (!consumable) {
    state.view = "inventory-consumables";
    state.selectedConsumableId = "";
    renderInventoryConsumables();
    return;
  }

  const percentage = Math.min(100, Math.round((consumable.available / consumable.targetStock) * 100));
  const purchaseHistory = getPurchaseOrdersForItem(consumable.id);
  const totalPurchased = purchaseHistory.reduce((sum, order) => sum + Number(order.receivedQuantity || 0), 0);

  app.innerHTML = `
    <section class="view">
      <div class="detail-topline">
        <button class="back-button" type="button" data-view="inventory-consumables">Back to consumables</button>
        <div class="inline-actions">
          <button class="secondary-button" type="button" data-action="open-inventory-item" data-id="${escapeAttribute(consumable.id)}">Edit consumable</button>
          <button class="primary-button" type="button" data-action="open-purchase-order" data-item-id="${escapeAttribute(consumable.id)}">Create PO</button>
        </div>
      </div>
      <section class="employee-detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(consumable.buyer)}</p>
          <h2>${escapeHtml(consumable.materialType)}</h2>
          <p>${consumable.barcode ? `Barcode ${escapeHtml(consumable.barcode)}` : "No barcode on file"}</p>
        </div>
        <div class="employee-header-status">
          <span class="risk-badge ${consumable.tone}">${escapeHtml(consumable.status)}</span>
        </div>
      </section>

      <section class="employee-detail-layout">
        <div class="employee-detail-main">
          <article class="panel">
            <div class="panel-header"><h3>Stock levels</h3></div>
            <div class="panel-body">
              <div class="race-progress ${consumable.tone}">
                <span style="width: ${percentage}%"></span>
              </div>
              <dl class="detail-list">
                <div><dt>Available</dt><dd>${consumable.available} ${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>On hand</dt><dd>${Number(consumable.onHand || 0)} ${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>Used</dt><dd>${consumable.used} ${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>Reorder at</dt><dd>${consumable.reorderAt} ${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>Target stock</dt><dd>${consumable.targetStock} ${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>Received to date</dt><dd>${totalPurchased} ${escapeHtml(consumable.unit)}</dd></div>
              </dl>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><div><h3>Purchase history</h3><span>Every time this consumable has been ordered</span></div></div>
            <div class="panel-body record-list">
              ${purchaseHistory.map(renderPurchaseOrderCard).join("") || `<div class="empty-state">No purchase orders for this consumable yet.</div>`}
            </div>
          </article>
        </div>

        <aside class="employee-detail-sidebar">
          <article class="panel">
            <div class="panel-header"><h3>Identification</h3></div>
            <div class="panel-body">
              <dl class="detail-list">
                <div><dt>Buyer</dt><dd>${escapeHtml(consumable.buyer)}</dd></div>
                <div><dt>Unit</dt><dd>${escapeHtml(consumable.unit)}</dd></div>
                <div><dt>Barcode</dt><dd>${consumable.barcode ? escapeHtml(consumable.barcode) : "Not recorded"}</dd></div>
              </dl>
            </div>
          </article>
        </aside>
      </section>
    </section>
  `;
}

function renderInventoryPurchaseOrders() {
  const purchaseOrders = getPurchaseOrders();
  const drafts = purchaseOrders.filter((order) => (order.status || "Ordered") === "Draft");
  const ordered = purchaseOrders.filter((order) => order.status === "Ordered");
  const received = purchaseOrders.filter((order) => order.status === "Received");

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "inventory",
        "Purchase Orders",
        "Draft and submitted purchasing requests for consumables and operations buyers.",
        `<button class="primary-button" type="button" data-action="open-purchase-order">Create PO</button>`,
      )}
      <section class="metric-strip" aria-label="Purchase order metrics">
        <div class="metric">
          <p class="eyebrow">Drafts</p>
          <strong>${drafts.length}</strong>
          <span>Editable, not yet submitted</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Ordered</p>
          <strong>${ordered.length}</strong>
          <span>Waiting to be received</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Received</p>
          <strong>${received.length}</strong>
          <span>Added to on-hand inventory</span>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>All purchase orders</h3></div>
        <div class="panel-body">
          <table class="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Quantity</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${
                purchaseOrders.map(renderPurchaseOrderTableRow).join("") ||
                `<tr><td colspan="7"><div class="empty-state">No purchase orders yet.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderPurchaseOrderTableRow(order) {
  const inventoryItem = getInventoryItemById(order.itemId);
  const status = order.status || "Ordered";
  const isDraft = status === "Draft";
  const received = status === "Received";
  const statusClass = received ? "risk-badge low" : isDraft ? "tag" : "stage-badge";
  return `
    <tr>
      <td data-label="Material">${escapeHtml(order.materialType)}</td>
      <td data-label="Quantity">${Number(order.quantity || 0)} ${escapeHtml(inventoryItem?.unit || "units")}</td>
      <td data-label="Vendor">${escapeHtml(order.vendor)}</td>
      <td data-label="Status"><span class="${statusClass}">${escapeHtml(status)}</span></td>
      <td data-label="Requested by">${escapeHtml(order.requestedBy)}</td>
      <td data-label="Created">${formatDate(order.createdAt)}</td>
      <td data-label="Actions">
        ${
          isDraft
            ? `<button class="mini-button" type="button" data-action="open-purchase-order" data-id="${escapeAttribute(order.id)}">Edit</button>
               <button class="mini-button" type="button" data-action="submit-purchase-order" data-id="${escapeAttribute(order.id)}">Submit</button>`
            : received
              ? `<span class="tag">Received ${formatDate(order.receivedAt)}</span>`
              : `<button class="mini-button" type="button" data-action="receive-purchase-order" data-id="${escapeAttribute(order.id)}">Receive</button>`
        }
      </td>
    </tr>
  `;
}

function renderInventoryEquipment() {
  const equipment = getEquipmentStatus();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "inventory",
        "Equipment",
        "Asset status, last use, maintenance schedule, and scheduler-blocking equipment issues.",
        `<button class="primary-button" type="button" data-action="open-equipment-asset">Add equipment</button>`,
      )}
      <section class="record-list">
        ${equipment.map(renderEquipmentAssetCard).join("")}
      </section>
    </section>
  `;
}

function renderEquipmentAssetDetail() {
  const asset = findEquipmentAssetByTag(state.selectedEquipmentAssetTag);
  if (!asset) {
    state.view = "inventory-equipment";
    state.selectedEquipmentAssetTag = "";
    renderInventoryEquipment();
    return;
  }

  const config = getEquipmentCategoryConfig(asset.category);
  const specs = asset.specs || {};
  const job = findProject(asset.assignedProjectId);
  const maintenanceRecords = getEquipmentMaintenanceRecords(asset.assetTag);
  const restockItems = getEquipmentRestockItems(asset.assetTag);
  const checkLogs = getEquipmentLogsForAsset(asset.assetTag);
  const restockStatusTone = { Needed: "high", Ordered: "medium", Stocked: "low" };

  app.innerHTML = `
    <section class="view">
      <div class="detail-topline">
        <button class="back-button" type="button" data-view="inventory-equipment">Back to equipment</button>
        <div class="inline-actions">
          <button class="secondary-button" type="button" data-action="open-equipment-asset" data-asset-tag="${escapeAttribute(asset.assetTag)}">Edit asset</button>
          <button class="primary-button" type="button" data-action="open-equipment-maintenance" data-asset-tag="${escapeAttribute(asset.assetTag)}">Log maintenance</button>
        </div>
      </div>
      <section class="employee-detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(asset.category || "General equipment")}</p>
          <h2>${escapeHtml(asset.assetTag)} - ${escapeHtml(asset.equipment)}</h2>
          <p>${escapeHtml(asset.issue || `Assigned context: ${job?.name || "No active assignment"}`)}</p>
        </div>
        <div class="employee-header-status">
          <button class="risk-badge ${asset.statusTone}" type="button" data-action="open-equipment-status" data-asset-tag="${escapeAttribute(asset.assetTag)}">${escapeHtml(asset.status)}</button>
        </div>
      </section>

      <section class="employee-detail-layout">
        <div class="employee-detail-main">
          <article class="panel">
            <div class="panel-header"><h3>Equipment facts</h3></div>
            <div class="panel-body">
              <dl class="detail-list">
                <div><dt>Last used</dt><dd>${formatDate(asset.lastUsed)}</dd></div>
                <div><dt>Maintenance due</dt><dd>${formatDate(asset.maintenanceDue)}</dd></div>
                <div><dt>Assigned job</dt><dd>${escapeHtml(job?.name || "No active assignment")}</dd></div>
                ${config.specFields
                  .map(
                    (field) =>
                      `<div><dt>${escapeHtml(field.label)}</dt><dd>${specs[field.key] ? escapeHtml(specs[field.key]) : "Not recorded"}</dd></div>`,
                  )
                  .join("")}
              </dl>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div><h3>Maintenance records</h3><span>Next due ${formatDate(asset.maintenanceDue)}</span></div>
              <button class="mini-button" type="button" data-action="open-equipment-maintenance" data-asset-tag="${escapeAttribute(asset.assetTag)}">Log maintenance</button>
            </div>
            <div class="panel-body record-list">
              ${maintenanceRecords.map(renderEquipmentMaintenanceRow).join("") || `<div class="empty-state">No maintenance recorded yet.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><div><h3>Check-in / check-out history</h3><span>Logged from job assignments</span></div></div>
            <div class="panel-body record-list">
              ${checkLogs.map(renderEquipmentCheckLogRow).join("") || `<div class="empty-state">No check-in or check-out history yet.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div><h3>Restock list</h3><span>Parts and consumables tied to this unit</span></div>
              <button class="mini-button" type="button" data-action="open-equipment-restock" data-asset-tag="${escapeAttribute(asset.assetTag)}">Add restock item</button>
            </div>
            <div class="panel-body record-list">
              ${
                restockItems
                  .map(
                    (item) => `
                      <article class="inventory-card">
                        <div class="race-card-main">
                          <div>
                            <strong>${escapeHtml(item.itemName)}</strong>
                            <div class="row-meta"><span>${Number(item.quantityNeeded || 0)} ${escapeHtml(item.unit || "units")}</span></div>
                          </div>
                          <span class="risk-badge ${restockStatusTone[item.status] || "medium"}">${escapeHtml(item.status || "Needed")}</span>
                        </div>
                        ${item.notes ? `<p class="help-text">${escapeHtml(item.notes)}</p>` : ""}
                        <div class="inline-actions">
                          <button class="mini-button" type="button" data-action="open-equipment-restock" data-asset-tag="${escapeAttribute(asset.assetTag)}" data-id="${escapeAttribute(item.id)}">Edit</button>
                        </div>
                      </article>
                    `,
                  )
                  .join("") || `<div class="empty-state">Nothing on the restock list.</div>`
              }
            </div>
          </article>
        </div>

        <aside class="employee-detail-sidebar">
          <article class="panel">
            <div class="panel-header"><h3>Maintenance guide</h3></div>
            <div class="panel-body">
              <ul class="reference-list">
                ${config.maintenanceGuide.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
              </ul>
            </div>
          </article>
          <article class="panel">
            <div class="panel-header"><h3>Service checklist</h3></div>
            <div class="panel-body">
              <ul class="reference-list">
                ${config.checklist.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
              </ul>
            </div>
          </article>
        </aside>
      </section>
    </section>
  `;
}

function renderEquipmentMaintenanceRow(record) {
  return `
    <article class="credential-row">
      <div>
        <span class="credential-type">${escapeHtml(record.type || "Maintenance")}</span>
        <strong>${escapeHtml(record.description || "No description")}</strong>
        <span>${escapeHtml(record.performedBy || "Unknown")}${record.cost ? ` · ${money(record.cost)}` : ""}</span>
      </div>
      <div class="credential-dates">
        <span>Logged ${formatDate(record.date)}</span>
        <strong>Next due ${formatDate(record.nextDueDate)}</strong>
      </div>
    </article>
  `;
}

function renderEquipmentCheckLogRow(log) {
  const job = findProject(log.projectId);
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <strong>${escapeHtml(log.truckId || log.equipment || "Check-out")}</strong>
          <div class="row-meta">
            <span>${escapeHtml(job?.name || "No linked job")}</span>
            <span>${escapeHtml(log.user || "Unknown")}</span>
          </div>
        </div>
      </div>
      <p class="help-text">${escapeHtml(log.condition || "No condition noted.")}</p>
      <div class="row-meta">
        <span>Checked out ${formatDateTime(log.checkedOut)}</span>
        <span>${log.returned ? `Returned ${formatDateTime(log.returned)}` : "Not yet returned"}</span>
      </div>
    </article>
  `;
}

function renderInventoryLabor() {
  const labor = getLaborResources();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "inventory",
        "Labor",
        "Technician availability, worked hours, capacity, and certifications.",
        `<button class="primary-button" type="button" data-action="open-employee">Add labor</button>`,
      )}
      <section class="labor-grid">
        ${labor.map(renderLaborCard).join("")}
      </section>
    </section>
  `;
}

function renderConsumableCard(item) {
  const percentage = Math.min(100, Math.round((item.available / item.targetStock) * 100));
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <button class="link-button account-name" type="button" data-action="view-consumable" data-id="${escapeAttribute(item.id)}">${escapeHtml(item.materialType)}</button>
          <div class="row-meta">
            <span>${item.available} ${escapeHtml(item.unit)} available</span>
            <span>Target ${item.targetStock}</span>
            ${item.barcode ? `<span>Barcode ${escapeHtml(item.barcode)}</span>` : ""}
          </div>
        </div>
        <span class="risk-badge ${item.tone}">${escapeHtml(item.status)}</span>
      </div>
      <div class="race-progress ${item.tone}">
        <span style="width: ${percentage}%"></span>
      </div>
      <div class="inline-actions">
        <span class="tag">Reorder at ${item.reorderAt}</span>
        <span class="tag">${escapeHtml(item.buyer)}</span>
        <button class="mini-button" type="button" data-action="open-purchase-order" data-item-id="${escapeAttribute(item.id)}">PO</button>
      </div>
    </article>
  `;
}

function renderPurchaseOrderCard(order) {
  const inventoryItem = getInventoryItemById(order.itemId);
  const status = order.status || "Ordered";
  const isDraft = status === "Draft";
  const received = status === "Received";
  const quantity = Number(order.quantity || 0);
  const receivedQuantity = Number(order.receivedQuantity || 0);
  const statusClass = received ? "risk-badge low" : isDraft ? "tag" : "stage-badge";
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <strong>${escapeHtml(order.materialType)}</strong>
          <div class="row-meta">
            <span>${quantity} ${escapeHtml(inventoryItem?.unit || "units")} ${isDraft ? "drafted" : "ordered"}</span>
            <span>${escapeHtml(order.vendor)}</span>
          </div>
        </div>
        <span class="${statusClass}">${escapeHtml(status)}</span>
      </div>
      <div class="row-meta">
        <span>Requested by ${escapeHtml(order.requestedBy)}</span>
        <span>${formatDate(order.createdAt)}</span>
      </div>
      <p class="help-text">
        ${
          received
            ? `Received ${receivedQuantity || quantity} ${escapeHtml(inventoryItem?.unit || "units")} into stock on ${formatDate(order.receivedAt)}.`
            : isDraft
              ? `Draft PO. Edit details or submit to send this order to ${escapeHtml(order.vendor) || "the vendor"}.`
              : `Receiving this PO will add ${quantity} ${escapeHtml(inventoryItem?.unit || "units")} to ${escapeHtml(order.materialType)} on-hand inventory.`
        }
      </p>
      <div class="inline-actions">
        ${
          isDraft
            ? `<button class="mini-button" type="button" data-action="open-purchase-order" data-id="${escapeAttribute(order.id)}">Edit draft</button>
               <button class="mini-button" type="button" data-action="submit-purchase-order" data-id="${escapeAttribute(order.id)}">Submit order</button>`
            : received
              ? `<span class="tag">Received by ${escapeHtml(order.receivedBy || "Inventory")}</span>`
              : `<button class="mini-button" type="button" data-action="receive-purchase-order" data-id="${escapeAttribute(order.id)}">Receive into stock</button>`
        }
        ${inventoryItem ? `<span class="tag">On hand ${Number(inventoryItem.onHand || 0)} ${escapeHtml(inventoryItem.unit)}</span>` : `<span class="risk-badge high">Missing inventory item</span>`}
      </div>
    </article>
  `;
}

function renderEquipmentAssetCard(asset) {
  const job = findProject(asset.assignedProjectId);
  return `
    <article class="inventory-card">
      <div class="race-card-main">
        <div>
          <button class="link-button account-name" type="button" data-action="view-equipment-asset" data-asset-tag="${escapeAttribute(asset.assetTag)}">${escapeHtml(asset.assetTag)} - ${escapeHtml(asset.equipment)}</button>
          <div class="row-meta">
            <span>${escapeHtml(asset.category || "General equipment")}</span>
            <span>Last used ${formatDate(asset.lastUsed)}</span>
            <span>Maintenance ${formatDate(asset.maintenanceDue)}</span>
          </div>
        </div>
        <button class="risk-badge ${asset.statusTone}" type="button" data-action="open-equipment-status" data-asset-tag="${escapeAttribute(asset.assetTag)}">${escapeHtml(asset.status)}</button>
      </div>
      <p class="help-text">${escapeHtml(asset.issue || `Assigned context: ${job?.name || "No active assignment"}`)}</p>
      ${asset.statusTone === "high" ? `<div class="scheduler-alert">Scheduler alert: do not assign until cleared.</div>` : ""}
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-equipment-asset" data-asset-tag="${escapeAttribute(asset.assetTag)}">View detail</button>
        <button class="mini-button" type="button" data-action="open-equipment-asset" data-asset-tag="${escapeAttribute(asset.assetTag)}">Edit asset</button>
      </div>
    </article>
  `;
}

function renderLaborCard(person) {
  const percentage = Math.min(100, Math.round((person.hoursWorked / person.capacity) * 100));
  const tone = percentage >= 95 ? "high" : percentage >= 80 ? "medium" : "low";
  return `
    <article class="labor-card">
      <div class="race-card-main">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <div class="row-meta">
            <span>${escapeHtml(person.role)}</span>
            <span>${escapeHtml(person.availability)}</span>
          </div>
        </div>
        <span class="risk-badge ${tone}">${person.hoursWorked}/${person.capacity} hrs</span>
      </div>
      <div class="race-progress ${tone}">
        <span style="width: ${percentage}%"></span>
      </div>
      <div class="chip-list">
        ${person.certifications.map((cert) => `<span class="tag">${escapeHtml(cert)}</span>`).join("")}
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="open-employee" data-id="${escapeAttribute(person.id)}">Edit</button>
      </div>
    </article>
  `;
}

function renderOfficeManager() {
  const officeAlerts = getOfficeAlerts();
  const scheduledItems = getScheduleEvents().slice(0, 5);
  const financeSummary = getFinanceSummary();
  const consumables = getConsumableStatus();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "office",
        "Office Manager Overview",
        "One place to see whether sales, operations, inventory, labor, scheduling, and finance have issues that need follow-up.",
      )}
      <section class="metric-strip" aria-label="Office manager metrics">
        <div class="metric">
          <p class="eyebrow">Open alerts</p>
          <strong>${officeAlerts.length}</strong>
          <span>Across departments</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Scheduled work</p>
          <strong>${state.scheduledWork.length}</strong>
          <span>Calendar records</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Low stock</p>
          <strong>${consumables.filter((item) => item.status !== "Healthy").length}</strong>
          <span>Needs buyer action</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Past due</p>
          <strong>${money(financeSummary.pastDue)}</strong>
          <span>Finance follow-up</span>
        </div>
      </section>

      <section class="office-grid">
        <article class="panel">
          <div class="panel-header"><h3>Department alerts</h3></div>
          <div class="panel-body record-list">
            ${officeAlerts.map(renderOfficeAlert).join("") || `<div class="empty-state">No cross-team alerts.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Scheduled projects</h3></div>
          <div class="panel-body record-list">
            ${scheduledItems.map(renderScheduleEventCard).join("") || `<div class="empty-state">No scheduled work.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Workspace status</h3></div>
          <div class="panel-body status-grid">
            ${renderWorkspaceStatusCard("Sales", `${state.opportunities.length} opportunities`, "Pipeline and accounts active")}
            ${renderWorkspaceStatusCard("Operations", `${state.projects.filter((job) => job.status !== "Complete").length} jobs`, "Schedule, map, and race track active")}
            ${renderWorkspaceStatusCard("Inventory", `${consumables.length} consumables`, "Stock, equipment, labor active")}
            ${renderWorkspaceStatusCard("Finance", money(financeSummary.quoted), "Quotes and invoice prep active")}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderOfficeAlert(alert) {
  return `
    <article class="alert-card ${alert.tone}">
      <div class="inline-actions">
        <span class="risk-badge ${alert.tone}">${escapeHtml(alert.group)}</span>
        <span class="tag">${escapeHtml(alert.owner)}</span>
      </div>
      <strong>${escapeHtml(alert.title)}</strong>
      <p class="help-text">${escapeHtml(alert.detail)}</p>
    </article>
  `;
}

function renderWorkspaceStatusCard(name, value, detail) {
  return `
    <article class="status-card">
      <p class="eyebrow">${escapeHtml(name)}</p>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(detail)}</span>
    </article>
  `;
}

function renderOfficeAlertsPage() {
  const officeAlerts = getOfficeAlerts();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "office",
        "Alerts",
        "Cross-team issues from operations, inventory, equipment, scheduling, and finance.",
      )}
      <section class="record-list">
        ${officeAlerts.map(renderOfficeAlert).join("") || `<div class="empty-state">No cross-team alerts.</div>`}
      </section>
    </section>
  `;
}

function renderOfficeSchedulePage() {
  const scheduledItems = getScheduleEvents();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "office",
        "Schedule",
        "Office-level view of scheduled project work and any schedule blocks.",
      )}
      <section class="record-list">
        ${scheduledItems.map(renderScheduleEventCard).join("") || `<div class="empty-state">No scheduled work.</div>`}
      </section>
    </section>
  `;
}

function renderFinance() {
  const rows = getFinanceRows();
  const summary = getFinanceSummary(rows);

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "finance",
        "Finance",
        "Quote-to-invoice view for what was quoted, customer communication, field usage, expenses, revenue, and past due items.",
        `<button class="primary-button" type="button" data-action="open-invoice">Create invoice</button>`,
      )}
      <section class="metric-strip" aria-label="Finance metrics">
        <div class="metric">
          <p class="eyebrow">Quoted</p>
          <strong>${money(summary.quoted)}</strong>
          <span>Customer-facing quoted value</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Invoice prep</p>
          <strong>${money(summary.invoicePrep)}</strong>
          <span>Quote plus field usage signals</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Expenses</p>
          <strong>${money(summary.expenses)}</strong>
          <span>Prototype field costs</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Past due</p>
          <strong>${money(summary.pastDue)}</strong>
          <span>Receivables follow-up</span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-body">
          <table class="data-table finance-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Quoted</th>
                <th>Field usage</th>
                <th>Invoice signal</th>
                <th>Customer comms</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(renderFinanceRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>Integration notes</h3></div>
        <div class="panel-body">
          <p class="help-text">QuickBooks Online integration is not wired yet. This prototype defines the data that would be sent: customer, quote, field usage, expenses, invoice draft, payment status, and account manager communications.</p>
        </div>
      </section>
    </section>
  `;
}

function renderFinanceInvoices() {
  const rows = getFinanceRows();

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "finance",
        "Invoices",
        "Invoice drafts, field usage, quote comparison, status, and QuickBooks export actions.",
        `<button class="primary-button" type="button" data-action="open-invoice">Create invoice</button>`,
      )}
      <section class="panel">
        <div class="panel-body">
          <table class="data-table finance-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Quoted</th>
                <th>Field usage</th>
                <th>Invoice signal</th>
                <th>Customer comms</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(renderFinanceRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderFinanceQbo() {
  const settings = state.backend.qboSettings || {};
  const exports = state.backend.qboExports || [];

  app.innerHTML = `
    <section class="view">
      ${renderWorkspaceHeader(
        "finance",
        "QuickBooks",
        "Connection status and export queue for QuickBooks Online integration.",
      )}
      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Connection</h3></div>
          <div class="panel-body">
            <dl class="detail-list">
              <div><dt>Status</dt><dd>${escapeHtml(settings.connectionStatus || "Not connected")}</dd></div>
              <div><dt>Realm ID</dt><dd>${escapeHtml(settings.realmId || "Not connected")}</dd></div>
              <div><dt>Last export</dt><dd>${escapeHtml(settings.lastExportAt ? formatDate(settings.lastExportAt) : "Never")}</dd></div>
            </dl>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Export queue</h3></div>
          <div class="panel-body record-list">
            ${
              exports
                .map(
                  (item) => `
                    <article class="detail-card">
                      <strong>${escapeHtml(item.invoiceId)}</strong>
                      <div class="row-meta">
                        <span>${escapeHtml(item.status)}</span>
                        <span>${formatDate(item.createdAt)}</span>
                      </div>
                    </article>
                  `,
                )
                .join("") || `<div class="empty-state">No QuickBooks exports queued.</div>`
            }
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderClientDashboard() {
  cleanupClientSpillMap();
  cleanupProjectDetailVisuals();
  const account = getClientAccount();
  const jobs = getClientVisibleJobs();
  const activeJobs = jobs.filter((job) => job.status !== "Complete");
  const alerts = getClientVisibleAlerts();
  const samples = getClientVisibleSamples();
  const schedule = getClientVisibleSchedule().slice(0, 4);
  const recentEvents = getClientRecentEvents(6);
  const nextTarget = jobs
    .filter((job) => job.targetDate)
    .sort((a, b) => daysUntil(a.targetDate) - daysUntil(b.targetDate))[0];

  app.innerHTML = `
    <section class="view client-view">
      ${renderWorkspaceHeader(
        "client",
        "Client Dashboard",
        `${account?.name || "Client"} spill response status, samples, site history, and documents.`,
      )}
      <section class="account-hero client-hero">
        <div>
          <p class="eyebrow">Account portal</p>
          <h2>${escapeHtml(account?.name || "Client account")}</h2>
          <p>${escapeHtml(account?.siteName || account?.concern || "Active spill and remediation records tied to this account.")}</p>
          <div class="inline-actions">
            <span class="stage-badge">${activeJobs.length} active spills</span>
            <span class="${alerts.length ? "risk-badge high" : "risk-badge low"}">${alerts.length} open updates</span>
            <span class="tag">${samples.length} sample records</span>
          </div>
        </div>
        <div class="client-next-card">
          <p class="eyebrow">Next milestone</p>
          <strong>${escapeHtml(nextTarget?.activePhase || "No active milestone")}</strong>
          <span>${nextTarget ? `${escapeHtml(nextTarget.name)} - target ${formatDate(nextTarget.targetDate)}` : "No target date is set."}</span>
        </div>
      </section>

      ${renderClientMetrics(jobs, alerts, samples)}

      ${renderClientSpillMapPanel(jobs)}

      <section class="split-grid">
        <article class="panel">
          <div class="panel-header">
            <h3>Active spills</h3>
            <button class="mini-button" type="button" data-view="client-spills">View all</button>
          </div>
          <div class="panel-body project-card-grid">
            ${activeJobs.slice(0, 4).map(renderClientSpillCard).join("") || `<div class="empty-state">No active spills are attached to this login.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Upcoming work</h3></div>
          <div class="panel-body record-list">
            ${schedule.map(renderClientScheduleCard).join("") || `<div class="empty-state">No scheduled site work is currently published.</div>`}
          </div>
        </article>
      </section>

      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Recent site history</h3></div>
          <div class="panel-body project-timeline-scroll client-timeline">
            ${recentEvents.map(renderClientChronologyItem).join("") || `<div class="empty-state">No site history has been published yet.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Sample and lab status</h3></div>
          <div class="panel-body record-list">
            ${samples.slice(0, 6).map(renderClientSampleSummary).join("") || `<div class="empty-state">No samples are attached to these spills yet.</div>`}
          </div>
        </article>
      </section>
    </section>
  `;

  requestAnimationFrame(initializeClientSpillMap);
}

function renderClientSpills() {
  cleanupClientSpillMap();
  cleanupProjectDetailVisuals();
  const jobs = getClientVisibleJobs();
  const alerts = getClientVisibleAlerts();

  app.innerHTML = `
    <section class="view client-view">
      ${renderWorkspaceHeader(
        "client",
        "Spills",
        "Published spill response and remediation projects tied to this client login.",
      )}
      ${renderClientMetrics(jobs, alerts, getClientVisibleSamples())}
      ${renderClientSpillMapPanel(jobs)}
      <section class="project-card-grid client-spill-grid">
        ${jobs.map(renderClientSpillCard).join("") || `<div class="empty-state">No spills are attached to this client login.</div>`}
      </section>
    </section>
  `;

  requestAnimationFrame(initializeClientSpillMap);
}

function renderClientDocuments() {
  cleanupClientSpillMap();
  cleanupProjectDetailVisuals();
  const jobs = getClientVisibleJobs();
  const samples = getClientVisibleSamples();
  const spatial = getClientVisibleSpatialData();
  const sampleSessions = jobs
    .flatMap((job) => groupSamplesIntoSessions(samplesForJob(job.id)).map((session) => ({ ...session, job })))
    .sort((a, b) => new Date(b.samples.at(-1)?.collectionTime || 0) - new Date(a.samples.at(-1)?.collectionTime || 0));

  app.innerHTML = `
    <section class="view client-view">
      ${renderWorkspaceHeader(
        "client",
        "Samples & Docs",
        "Sampling sessions, lab status, site photos, and spatial files published for client review.",
      )}
      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Sampling sessions</h3></div>
          <div class="panel-body record-list">
            ${
              sampleSessions
                .map(
                  (session) => `
                    <details class="sample-session" open>
                      <summary>
                        <span>${escapeHtml(session.label)}</span>
                        <small>${escapeHtml(session.job.name)} - ${session.samples.length} samples</small>
                      </summary>
                      <div class="sample-session-body">
                        ${session.samples.map(renderProjectSampleRecord).join("")}
                      </div>
                    </details>
                  `,
                )
                .join("") || `<div class="empty-state">No sample sessions are attached to this client account.</div>`
            }
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>Documents and spatial files</h3></div>
          <div class="panel-body record-list">
            ${spatial.map(renderClientDocumentCard).join("") || `<div class="empty-state">No documents or spatial files have been published yet.</div>`}
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderClientContacts() {
  cleanupClientSpillMap();
  cleanupProjectDetailVisuals();
  const account = getClientAccount();
  const contacts = contactsForAccount(account?.id || "");
  const serviceTeam = getClientVisibleJobs()
    .map((job) => job.projectManager)
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index);

  app.innerHTML = `
    <section class="view client-view">
      ${renderWorkspaceHeader(
        "client",
        "Contacts",
        "Client contacts and BioRemedy project leads tied to active spill records.",
      )}
      <section class="detail-grid">
        <article class="panel">
          <div class="panel-header"><h3>Your contacts</h3></div>
          <div class="panel-body people-list">
            ${contacts.map(renderClientContactCard).join("") || `<div class="empty-state">No contacts are attached to this account.</div>`}
          </div>
        </article>
        <article class="panel">
          <div class="panel-header"><h3>BioRemedy service team</h3></div>
          <div class="panel-body people-list">
            ${
              serviceTeam
                .map(
                  (name) => `
                    <article class="detail-card client-contact-card">
                      <strong>${escapeHtml(name)}</strong>
                      <div class="row-meta">
                        <span>Project manager</span>
                        <span>BioRemedy</span>
                      </div>
                    </article>
                  `,
                )
                .join("") || `<div class="empty-state">No service team assignments are published yet.</div>`
            }
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderClientSpillDetail() {
  cleanupClientSpillMap();
  cleanupProjectDetailVisuals();
  const job = findProject(state.selectedProjectId);
  if (!job || !clientCanSeeJob(job)) {
    app.innerHTML = `
      <section class="empty-state">
        <h2>Spill not available</h2>
        <button class="secondary-button" type="button" data-action="back-to-client-spills">Back to spills</button>
      </section>
    `;
    return;
  }

  const account = findAccount(job.accountId);
  const location = findLocation(job.locationId);
  const progress = getJobProgress(job);
  const generator = getProjectGenerator(job);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const samples = samplesForJob(job.id);
  const sampleSessions = groupSamplesIntoSessions(samples);
  const spatial = spatialDataForJob(job.id);
  const chronology = getClientChronology(job);
  const schedule = getScheduleEvents().filter((work) => work.projectId === job.id).sort((a, b) => new Date(a.date) - new Date(b.date));

  app.innerHTML = `
    <section class="view client-view">
      <div class="account-hero project-hero client-hero">
        <div>
          <button class="text-button" type="button" data-action="back-to-client-spills">Back to spills</button>
          <p class="eyebrow">Client spill record</p>
          <h2>${escapeHtml(job.name)}</h2>
          <p>${escapeHtml(job.jobClass)} for ${escapeHtml(account?.name ?? "Unknown account")}${location ? ` at ${escapeHtml(location.name)}` : ""}.</p>
          <div class="inline-actions">
            <span class="risk-badge ${progress.tone}">${progress.percent}% complete</span>
            <span class="stage-badge">${escapeHtml(job.status)}</span>
            <span class="tag">PM ${escapeHtml(job.projectManager)}</span>
            ${job.notToExceed ? `<span class="tag">Authorized NTE ${money(job.notToExceed)}</span>` : ""}
          </div>
        </div>
        <div class="client-next-card">
          <p class="eyebrow">Current phase</p>
          <strong>${escapeHtml(job.activePhase)}</strong>
          <span>Target ${formatDate(job.targetDate)}</span>
        </div>
      </div>

      <section class="project-progress-panel">
        <div class="race-progress ${progress.tone}" aria-label="Spill response progress">
          <span style="width: ${progress.percent}%"></span>
        </div>
        <div class="stage-ladder">
          ${PROJECT_STAGES.map((stage, index) => `<span class="${progress.stageIndex >= index ? "done" : ""}">${stage}</span>`).join("")}
        </div>
      </section>

      <section class="metric-strip" aria-label="Client spill metrics">
        <div class="metric">
          <p class="eyebrow">Site events</p>
          <strong>${chronology.length}</strong>
          <span>Published history records</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Samples</p>
          <strong>${samples.length}</strong>
          <span>${sampleSessions.length} sampling sessions</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Open updates</p>
          <strong>${alerts.length}</strong>
          <span>Client-visible status items</span>
        </div>
        <div class="metric">
          <p class="eyebrow">Documents</p>
          <strong>${spatial.length}</strong>
          <span>Spatial or site files</span>
        </div>
      </section>

      <section class="project-detail-layout">
        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header"><h3>Responsible party and claim info</h3></div>
            <div class="panel-body">
              <dl class="detail-list">
                <div><dt>Generator</dt><dd>${escapeHtml(generator.name)}</dd></div>
                <div><dt>Site</dt><dd>${escapeHtml(generator.siteName)}</dd></div>
                <div><dt>Contact</dt><dd>${escapeHtml(generator.contactName)}${generator.contactPhone ? ` - ${escapeHtml(generator.contactPhone)}` : ""}</dd></div>
                <div><dt>EPA ID</dt><dd>${escapeHtml(generator.epaId)}</dd></div>
                <div><dt>TCEQ ID</dt><dd>${escapeHtml(generator.tceqId)}</dd></div>
                <div><dt>Insurance</dt><dd>${escapeHtml(generator.insuranceContact)}</dd></div>
                <div><dt>Carrier / Claim</dt><dd>${escapeHtml(generator.insuranceCarrier)} / ${escapeHtml(generator.claimNumber)}</dd></div>
                <div><dt>Services</dt><dd>${escapeHtml(generator.serviceProfile)}</dd></div>
              </dl>
            </div>
          </article>

          ${renderProjectSampleMap(job, samples)}

          <article class="panel">
            <div class="panel-header"><h3>Sampling sessions</h3></div>
            <div class="panel-body record-list">
              ${sampleSessions.map(renderSampleSession).join("") || `<div class="empty-state">No sampling sessions are attached to this spill yet.</div>`}
            </div>
          </article>
        </div>

        <div class="detail-stack">
          <article class="panel">
            <div class="panel-header"><h3>Site history</h3></div>
            <div class="panel-body project-timeline-scroll client-timeline">
              ${chronology.map(renderClientChronologyItem).join("") || `<div class="empty-state">No site history has been published yet.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>Scheduled site work</h3></div>
            <div class="panel-body record-list">
              ${schedule.map(renderClientScheduleCard).join("") || `<div class="empty-state">No upcoming site work is currently published.</div>`}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header"><h3>LiDAR and site documents</h3></div>
            <div class="panel-body lidar-stack">
              ${spatial.map(renderProjectSpatialRecord).join("") || renderEmptyLidarPlaceholder(job)}
            </div>
          </article>
        </div>
      </section>
    </section>
  `;

  requestAnimationFrame(() => {
    initializeProjectSampleMap(job.id);
    initializeProjectModelViewers();
  });
}

function renderClientMetrics(jobs, alerts, samples) {
  const active = jobs.filter((job) => job.status !== "Complete").length;
  const emergency = jobs.filter((job) => job.jobClass === "Emergency Response" && job.status !== "Complete").length;
  const documents = getClientVisibleSpatialData().length;

  return `
    <section class="metric-strip client-metrics" aria-label="Client portal metrics">
      <div class="metric">
        <p class="eyebrow">Active spills</p>
        <strong>${active}</strong>
        <span>Open response records</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Emergency response</p>
        <strong>${emergency}</strong>
        <span>Rapid response projects</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Open updates</p>
        <strong>${alerts.length}</strong>
        <span>Action or approval items</span>
      </div>
      <div class="metric">
        <p class="eyebrow">Samples / Docs</p>
        <strong>${samples.length} / ${documents}</strong>
        <span>Published records</span>
      </div>
    </section>
  `;
}

function renderClientSpillMapPanel(jobs) {
  const markers = getClientSpillMarkers(jobs);
  return `
    <article class="panel client-spill-map-panel">
      <div class="panel-header">
        <div>
          <h3>Spill location map</h3>
          <span>${markers.length} mapped spill locations for ${escapeHtml(getClientAccount()?.name || "this client")}.</span>
        </div>
      </div>
      <div class="panel-body client-map-layout">
        <div id="clientSpillMap" class="client-spill-map" aria-label="Map of client spill locations">
          <div class="map-loading">Loading spill map...</div>
        </div>
        <aside class="client-map-list record-list" aria-label="Mapped spill list">
          ${markers.map(renderClientSpillMapListItem).join("") || `<div class="empty-state">No spill coordinates are available yet.</div>`}
        </aside>
      </div>
    </article>
  `;
}

function renderClientSpillMapListItem(marker) {
  return `
    <article class="legend-row map-list-item client-map-item">
      <span class="map-dot ${marker.type}"></span>
      <div>
        <strong>${escapeHtml(marker.label)}</strong>
        <span>${escapeHtml(marker.status)}</span>
        <span>${escapeHtml(marker.locationName)} - ${Number(marker.latitude).toFixed(5)}, ${Number(marker.longitude).toFixed(5)}</span>
        <span>${escapeHtml(marker.sourceLabel)}</span>
        <button class="mini-button" type="button" data-action="view-client-spill" data-id="${escapeAttribute(marker.projectId)}">Open spill</button>
      </div>
    </article>
  `;
}

function renderClientSpillCard(job) {
  const progress = getJobProgress(job);
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const samples = samplesForJob(job.id);
  const latestEvent = getClientChronology(job).at(-1);

  return `
    <article class="project-overview-card client-spill-card">
      <div class="project-overview-head">
        <div>
          <button class="link-button account-name" type="button" data-action="view-client-spill" data-id="${escapeAttribute(job.id)}">
            ${escapeHtml(job.name)}
          </button>
          <div class="row-meta">
            <span>${escapeHtml(job.jobClass)}</span>
            <span>${escapeHtml(job.status)}</span>
            <span>Target ${formatDate(job.targetDate)}</span>
          </div>
        </div>
        <span class="risk-badge ${progress.tone}">${progress.percent}%</span>
      </div>
      <div class="race-progress ${progress.tone}" aria-label="${progress.percent}% spill response progress">
        <span style="width: ${progress.percent}%"></span>
      </div>
      <p class="help-text">${escapeHtml(job.activePhase)}${latestEvent ? `. Latest: ${latestEvent.title}` : ""}</p>
      <div class="inline-actions">
        <span class="${alerts.length ? "risk-badge high" : "tag"}">${alerts.length} open updates</span>
        <span class="tag">${samples.length} samples</span>
        <span class="tag">PM ${escapeHtml(job.projectManager)}</span>
      </div>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="view-client-spill" data-id="${escapeAttribute(job.id)}">Open spill</button>
      </div>
    </article>
  `;
}

function renderClientScheduleCard(work) {
  const job = findProject(work.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(work.title || job?.name || "Scheduled work")}</strong>
      <div class="row-meta">
        <span>${formatDate(work.date)}</span>
        <span>${escapeHtml(work.status || "Scheduled")}</span>
        ${job ? `<span>${escapeHtml(job.name)}</span>` : ""}
      </div>
      <p class="help-text">${escapeHtml(work.crew || "Crew assignment pending")}</p>
    </article>
  `;
}

function renderClientSampleSummary(sample) {
  const job = findProject(sample.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(sample.sampleId || sample.id)}</strong>
      <div class="row-meta">
        <span>${escapeHtml(sample.sampleLocation || "Sample location")}</span>
        <span>${escapeHtml(sample.labStatus || "Pending")}</span>
        <span>${formatDate(sample.collectionTime)}</span>
      </div>
      <p class="help-text">${escapeHtml(sample.labName || "Lab not assigned")}${job ? ` - ${escapeHtml(job.name)}` : ""}</p>
    </article>
  `;
}

function renderClientDocumentCard(spatial) {
  const job = findProject(spatial.projectId);
  return `
    <article class="detail-card">
      <strong>${escapeHtml(spatial.fileType || "Site document")}</strong>
      <div class="row-meta">
        <span>${job ? escapeHtml(job.name) : "No spill linked"}</span>
        <span>${formatDate(spatial.scanDate)}</span>
        <span>${escapeHtml(spatial.scanQuality || "Review pending")}</span>
      </div>
      <p class="help-text">${escapeHtml(spatial.annotations || "No notes published.")}</p>
      <code class="file-ref">${escapeHtml(spatial.storagePath || spatial.modelPath || "Document path pending")}</code>
    </article>
  `;
}

function renderClientContactCard(contact) {
  return `
    <article class="detail-card client-contact-card">
      <strong>${escapeHtml(contact.name || contact.fullName || "Contact")}</strong>
      <div class="row-meta">
        <span>${escapeHtml(contact.jobTitle || contact.title || "No title")}</span>
        <span>${escapeHtml(contact.preferredContact || contact.preferredContactMethod || "Preferred contact not set")}</span>
      </div>
      <dl class="detail-list compact-detail-list">
        <div><dt>Email</dt><dd>${escapeHtml(contact.email || contact.emailAddressOne || "Not captured")}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(contact.phone || contact.businessPhone || contact.mobilePhone || "Not captured")}</dd></div>
      </dl>
    </article>
  `;
}

function renderClientChronologyItem(event) {
  return `
    <details class="project-event-item" ${event.defaultOpen ? "open" : ""}>
      <summary>
        <span>${formatDate(event.timestamp)}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <em>${escapeHtml(event.kind)}</em>
      </summary>
      <div class="project-event-body">
        <p class="help-text">${escapeHtml(event.detail)}</p>
        ${event.meta?.length ? `<div class="inline-actions">${event.meta.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      </div>
    </details>
  `;
}

function renderFinanceRow(row) {
  return `
    <tr>
      <td data-label="Job">
        <strong>${escapeHtml(row.job.name)}</strong>
        <div class="row-meta">
          <span>${escapeHtml(row.account?.name ?? "Unknown account")}</span>
          <span>${escapeHtml(row.job.jobClass)}</span>
        </div>
      </td>
      <td data-label="Quoted">${money(row.quoted)}</td>
      <td data-label="Field usage">
        ${money(row.expenses)}
        <div class="row-meta">
          <span>${row.materials.length} material logs</span>
          <span>${row.equipment.length} equipment logs</span>
        </div>
      </td>
      <td data-label="Invoice signal">
        <strong>${money(row.invoicePrep)}</strong>
        <div class="row-meta"><span>${escapeHtml(row.invoiceSignal)}</span></div>
      </td>
      <td data-label="Customer comms">
        ${escapeHtml(row.lastCommunication?.body || "No communication logged")}
        <div class="row-meta"><span>${escapeHtml(row.lastCommunication?.author || "No owner")}</span></div>
      </td>
      <td data-label="Status">
        <span class="risk-badge ${row.statusTone}">${escapeHtml(row.status)}</span>
        <div class="inline-actions">
          <button class="mini-button" type="button" data-action="open-invoice" data-job-id="${row.job.id}">Edit</button>
          ${row.invoice?.id ? `<button class="mini-button" type="button" data-action="export-qbo" data-id="${row.invoice.id}">QBO export</button>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function renderFieldwork() {
  const tasks = state.tasks.filter((task) => {
    if (state.taskFilter === "All") return true;
    return task.status === state.taskFilter;
  });

  app.innerHTML = `
    <section class="view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Field coordination</p>
          <h2>Tasks, activities, and follow-through</h2>
          <p>Coordinate the work that sales needs from field visits, lab reviews, proposal revisions, and buyer follow-up.</p>
        </div>
        <div class="toolbar">
          <select id="taskFilter" aria-label="Task status filter">
            <option ${state.taskFilter === "Open" ? "selected" : ""}>Open</option>
            <option ${state.taskFilter === "Complete" ? "selected" : ""}>Complete</option>
            <option ${state.taskFilter === "All" ? "selected" : ""}>All</option>
          </select>
          <button class="danger-button" type="button" data-action="open-alert">Field alert</button>
          <button class="secondary-button" type="button" data-action="open-material">Log material</button>
          <button class="secondary-button" type="button" data-action="open-equipment">Log equipment</button>
          <button class="primary-button" type="button" data-action="open-note">Add activity</button>
        </div>
      </div>
      <section class="split-grid">
        <article class="panel">
          <div class="panel-header">
            <h3>Open field and sales tasks</h3>
          </div>
          <div class="panel-body">
            <div class="task-list">
              ${tasks.map(renderTaskRow).join("") || `<div class="empty-state">No tasks in this view.</div>`}
            </div>
          </div>
        </article>
        <article class="panel">
          <div class="panel-header">
            <h3>Recent activities</h3>
          </div>
          <div class="panel-body">
            <div class="timeline-list">
              ${state.activities.slice(0, 8).map(renderTimelineItem).join("") || `<div class="empty-state">No activities yet.</div>`}
            </div>
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderTaskRow(task) {
  const account = findAccount(task.accountId);
  const complete = task.status === "Complete";
  return `
    <article class="task-row ${complete ? "complete" : ""}">
      <strong class="task-title">${escapeHtml(task.title)}</strong>
      <div class="task-meta">
        <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
        <span>Due ${formatDate(task.dueDate)}</span>
        <span>${escapeHtml(task.priority)} priority</span>
        <span>${escapeHtml(task.owner)}</span>
      </div>
      <div class="inline-actions">
        <span class="stage-badge">${escapeHtml(task.type)}</span>
        ${
          complete
            ? `<span class="tag">Complete</span>`
            : `<button class="mini-button" type="button" data-action="complete-task" data-id="${task.id}">Complete</button>`
        }
      </div>
    </article>
  `;
}

function renderActivityPicker(accountId, contactId = "", opportunityId = "") {
  const contactAttr = contactId ? ` data-contact-id="${escapeAttribute(contactId)}"` : "";
  const opportunityAttr = opportunityId ? ` data-opportunity-id="${escapeAttribute(opportunityId)}"` : "";
  return `
    <div class="inline-actions">
      <details class="activity-picker">
        <summary class="mini-button">Schedule activity</summary>
        <div class="activity-picker-menu">
          <button type="button" data-action="open-activity-meeting" data-account-id="${escapeAttribute(accountId)}"${contactAttr}${opportunityAttr}>Meeting</button>
          <button type="button" data-action="open-activity-call" data-account-id="${escapeAttribute(accountId)}"${contactAttr}${opportunityAttr}>Call</button>
          <button type="button" data-action="open-activity-email" data-account-id="${escapeAttribute(accountId)}"${contactAttr}${opportunityAttr}>Email</button>
          <button type="button" data-action="open-activity-task" data-account-id="${escapeAttribute(accountId)}"${contactAttr}${opportunityAttr}>Task</button>
        </div>
      </details>
      <button class="mini-button" type="button" data-action="open-quick-note" data-account-id="${escapeAttribute(accountId)}"${contactAttr}${opportunityAttr}>Quick note</button>
    </div>
  `;
}

function renderTimelineItemDetail(activity) {
  if (activity.activityType === "Call") {
    return activity.phoneNumber ? `<span>${escapeHtml(activity.phoneNumber)}</span>` : "";
  }
  if (activity.activityType === "Meeting") {
    if (activity.meetingFormat === "Online") {
      return `<span>${escapeHtml(activity.meetingPlatform || "Online")}</span>`;
    }
    if (activity.meetingFormat === "Offline") {
      return activity.meetingLocation ? `<span>${escapeHtml(activity.meetingLocation)}</span>` : "";
    }
    return "";
  }
  if (activity.activityType === "Email") {
    return activity.emailAddress ? `<span>${escapeHtml(activity.emailAddress)}</span>` : "";
  }
  return "";
}

function renderTimelineItem(activity) {
  const account = findAccount(activity.accountId);
  const contact = findContact(activity.contactId);
  const opportunity = findOpportunity(activity.opportunityId);
  return `
    <article class="timeline-item">
      <div class="row-meta">
        <span class="stage-badge">${escapeHtml(activity.activityType || activity.kind)}</span>
        <span class="tag">${escapeHtml(activity.status || "Completed")}</span>
        <span>${formatDate(activity.activityDate || activity.createdAt)}</span>
        ${renderTimelineItemDetail(activity)}
      </div>
      <strong>${escapeHtml(activity.subject || activity.kind || "Activity")}</strong>
      <p>${escapeHtml(activity.body)}</p>
      <div class="row-meta">
        <span>${escapeHtml(account?.name ?? "Unknown account")}</span>
        ${contact ? `<span>${escapeHtml(contact.name)}</span>` : ""}
        ${opportunity ? `<span>${escapeHtml(opportunity.name)}</span>` : ""}
        <span>${escapeHtml(activity.owner || activity.author)}</span>
      </div>
    </article>
  `;
}

function renderSync() {
  const canSignIn = Boolean(state.identityConfig.tenantId && state.identityConfig.clientId);
  const redirectUri = getRedirectUri();

  app.innerHTML = `
    <section class="view">
      <div class="view-header">
        <div>
          <p class="eyebrow">Identity and offline sync</p>
          <h2>Microsoft users, local work, and server handoff</h2>
          <p>This foundation lets the team work when connectivity is poor, then queues changes for the future CRM API.</p>
        </div>
        <div class="toolbar">
          <button class="secondary-button" type="button" data-action="sync-now">Simulate sync</button>
        </div>
      </div>
      <section class="split-grid">
        <div class="identity-stack">
          ${renderCurrentUser()}
          <form class="identity-panel" data-form="identity">
            <h3>Microsoft Entra ID configuration</h3>
            <p class="help-text">Create an app registration for a single-page application, then enter its tenant and client IDs here.</p>
            <div class="identity-grid">
              <label>
                Tenant ID
                <input name="tenantId" value="${escapeAttribute(state.identityConfig.tenantId)}" placeholder="Directory tenant ID" />
              </label>
              <label>
                Client ID
                <input name="clientId" value="${escapeAttribute(state.identityConfig.clientId)}" placeholder="Application client ID" />
              </label>
            </div>
            <label>
              Scopes
              <input name="scopes" value="${escapeAttribute(state.identityConfig.scopes || defaultIdentityConfig.scopes)}" />
            </label>
            <label>
              Redirect URI to register
              <span class="redirect-uri">${escapeHtml(redirectUri)}</span>
            </label>
            ${state.authError ? `<p class="help-text">${escapeHtml(state.authError)}</p>` : ""}
            <div class="inline-actions">
              <button class="primary-button" type="submit">Save identity config</button>
              <button class="secondary-button" type="button" data-action="start-microsoft-signin" ${canSignIn ? "" : "disabled"}>Sign in with Microsoft</button>
            </div>
          </form>
        </div>
        <article class="panel">
          <div class="panel-header">
            <h3>Pending sync queue</h3>
          </div>
          <div class="panel-body">
            <div class="sync-row">
              <span class="status-pill ${state.online ? "" : "offline"}">${state.online ? "Online" : "Offline"}</span>
              <span class="help-text">${pendingQueue().length} local edits waiting for the production API.</span>
            </div>
            <div class="queue-list">
              ${pendingQueue().map(renderQueueItem).join("") || `<div class="empty-state">No pending local edits.</div>`}
            </div>
          </div>
        </article>
      </section>
    </section>
  `;
}

const FRONTLINE_TILES = [
  { key: "timesheet", label: "Time Sheet", view: "frontline-timesheet" },
  { key: "jobbook", label: "Job Book", view: "frontline-jobbook" },
  { key: "messaging", label: "Messaging", view: "frontline-messaging" },
  { key: "forms", label: "Forms", view: "frontline-forms" },
  { key: "trips", label: "Trips", view: "frontline-trips" },
  { key: "location", label: "Location", view: "frontline-location" },
  { key: "invoices", label: "Invoices", view: "frontline-invoices" },
  { key: "settings", label: "Settings", view: "frontline-settings" },
  { key: "exit", label: "Exit", view: "" },
];

function renderFrontlineHeader() {
  return `
    <div class="frontline-header">
      <div class="frontline-header-left">
        <button class="frontline-icon-button" type="button" data-action="frontline-go-home" aria-label="Home" title="Home">
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M3 11l9-8 9 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M5 10v10h5v-6h4v6h5V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button class="frontline-icon-button" type="button" data-action="frontline-refresh" aria-label="Refresh" title="Refresh">
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <span class="frontline-satellite"><span class="frontline-satellite-dot ${state.online ? "" : "offline"}"></span>${state.online ? "Satellite: Connected" : "Satellite: Searching..."}</span>
      </div>
      <img class="frontline-logo" src="./public/brand/bioremedy-logo-primary-reversed.png" alt="BioRemedy" />
    </div>
  `;
}

function renderFrontlineLogin() {
  const employees = getEmployees().filter((employee) => employee.frontlineEnabled);
  app.innerHTML = `
    <div class="frontline-shell">
      <div class="frontline-device">
        <div class="frontline-login">
          <img src="./public/brand/bioremedy-logo-primary.png" alt="BioRemedy" style="height:36px;width:auto;margin:0 auto;" />
          <h2>Front Line</h2>
          <p class="help-text">Field device sign-in (simulator). Select a field lead to continue.</p>
          ${
            employees.length
              ? `
                <label>
                  Field lead
                  <select id="frontlineFieldLeadSelect">
                    <option value="">Choose a field lead...</option>
                    ${employees
                      .map(
                        (employee) =>
                          `<option value="${escapeAttribute(employee.id)}">${escapeHtml(employee.displayName)} - ${escapeHtml(employee.jobTitle || "")}</option>`,
                      )
                      .join("")}
                  </select>
                </label>
                <button class="primary-button" type="button" data-action="frontline-login">Enter</button>
              `
              : `<div class="empty-state">No employees are enabled for Front Line yet. Enable it from an employee's record in Workforce &gt; Directory.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

// One representative glyph per tile, in the same stroke-icon convention as the header's
// Home/Refresh buttons, so the grid reads at a glance instead of via two-letter initials.
const FRONTLINE_TILE_ICON_PATHS = {
  timesheet: '<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />',
  jobbook:
    '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" /><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M9 11h6M9 15h6" />',
  messaging:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />',
  forms: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" />',
  trips: '<path d="M3 11 22 2l-9 19-2-8-8-2Z" />',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" />',
  invoices: '<path d="M6 2h12v19l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 7h6M9 11h6M9 15h4" />',
  settings:
    '<circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M19.07 4.93l-2.12 2.12M7.05 16.95l-2.12 2.12M19.07 19.07l-2.12-2.12M7.05 7.05 4.93 4.93" />',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />',
};

function frontlineTileIcon(key) {
  const paths = FRONTLINE_TILE_ICON_PATHS[key] || "";
  return `<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function renderFrontlineTile(tile) {
  if (tile.key === "exit") {
    return `
      <button class="frontline-tile exit" type="button" data-action="frontline-exit">
        <span class="frontline-tile-icon">${frontlineTileIcon(tile.key)}</span>
        <span>${escapeHtml(tile.label)}</span>
      </button>
    `;
  }
  return `
    <button class="frontline-tile" type="button" data-view="${tile.view}">
      <span class="frontline-tile-icon">${frontlineTileIcon(tile.key)}</span>
      <span>${escapeHtml(tile.label)}</span>
    </button>
  `;
}

function renderFrontlineHome() {
  const employee = findEmployee(state.frontlineSession?.employeeId);
  app.innerHTML = `
    <div class="frontline-shell">
      <div class="frontline-device">
        ${renderFrontlineHeader()}
        <div class="frontline-body">
          <div>
            <p class="eyebrow">Welcome</p>
            <h2>${escapeHtml(employee?.displayName || "Field crew")}</h2>
          </div>
          <div class="frontline-grid">
            ${FRONTLINE_TILES.map(renderFrontlineTile).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFrontlineJobCard(job) {
  const steps = stepsForDispatchJob(job.id);
  const stepsComplete = steps.filter((step) => step.status === "Complete").length;
  return `
    <button class="frontline-job-card" type="button" data-action="frontline-open-job" data-id="${job.id}">
      <div class="inline-actions"><span class="job-number">${escapeHtml(job.jobNumber)}</span>${renderDispatchStatusBadge(formatDispatchStatus(job.status))}</div>
      <strong>${escapeHtml(job.jobName)}</strong>
      <span>${escapeHtml(job.customerName)}</span>
      <span>${escapeHtml(job.addressText || job.locationName || "No address")}</span>
      <div class="inline-actions">
        <span>${formatDateTime(job.scheduledStart)}</span>
        ${steps.length ? `<span>${stepsComplete} of ${steps.length} steps complete</span>` : ""}
      </div>
    </button>
  `;
}

function renderFrontlineJobBook() {
  const employeeId = state.frontlineSession?.employeeId;
  const filter = state.frontlineJobFilter;
  let jobs = getDispatchJobs().filter((job) => !isTerminalDispatchStatus(job.status));
  if (filter.scope === "mine") {
    jobs = jobs.filter(
      (job) => job.fieldLeadEmployeeId === employeeId || dispatchAssignmentsForJob(job.id).some((assignment) => assignment.employeeId === employeeId),
    );
  }
  if (filter.region !== "all") {
    jobs = jobs.filter((job) => frontlineJobRegion(job) === filter.region);
  }
  jobs = jobs.slice().sort((a, b) => parseDate(a.scheduledStart) - parseDate(b.scheduledStart));

  const regions = Array.from(new Set(getDispatchJobs().map(frontlineJobRegion))).sort();

  app.innerHTML = `
    <div class="frontline-shell">
      <div class="frontline-device">
        ${renderFrontlineHeader()}
        <div class="frontline-body">
          <h2>Job Book</h2>
          <div class="frontline-filter-row">
            <button class="mini-button ${filter.scope === "mine" ? "active" : ""}" type="button" data-action="frontline-jobbook-scope" data-scope="mine">Mine</button>
            <button class="mini-button ${filter.scope === "all" ? "active" : ""}" type="button" data-action="frontline-jobbook-scope" data-scope="all">All</button>
            <select id="frontlineRegionSelect">
              <option value="all" ${filter.region === "all" ? "selected" : ""}>All regions</option>
              ${regions
                .map((region) => `<option value="${escapeAttribute(region)}" ${filter.region === region ? "selected" : ""}>${escapeHtml(region)}</option>`)
                .join("")}
            </select>
          </div>
          <div class="frontline-job-list">
            ${jobs.map(renderFrontlineJobCard).join("") || `<div class="empty-state">No jobs match this filter.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFrontlineWorkPlanAction(action, job, step, stepActions) {
  const done = action.status === "Complete";
  const actionable = frontlineActionUnlocked(action, stepActions);
  const open = state.frontlineOpenActionId === action.id;
  const isStatusTransition = action.type === "Status transition";
  const previousAction = stepActions[stepActions.indexOf(action) - 1];

  let control = "";
  if (actionable && isStatusTransition) {
    control = `<button class="mini-button" type="button" data-action="frontline-complete-status-action" data-id="${action.id}">${escapeHtml(action.name)}</button>`;
  } else if (actionable) {
    control = `<button class="mini-button" type="button" data-action="frontline-toggle-action" data-id="${action.id}">${open ? "Cancel" : "Complete"}</button>`;
  } else if (!done) {
    control = `<span class="frontline-action-hint">After "${escapeHtml(previousAction?.name || "the previous action")}"</span>`;
  }

  return `
    <article class="frontline-action-row ${actionable || done ? "" : "locked"}">
      <div><strong>${escapeHtml(action.name)}</strong><span>${escapeHtml(action.type)} · ${escapeHtml(action.assigneeScope)}</span></div>
      ${renderDispatchStatusBadge(action.status)}
      ${control}
    </article>
    ${
      open && actionable && !isStatusTransition
        ? `
          <form class="frontline-action-form" data-form="frontline-complete-action">
            <input type="hidden" name="jobId" value="${escapeAttribute(job.id)}" />
            <input type="hidden" name="stepId" value="${escapeAttribute(step.id)}" />
            <input type="hidden" name="actionId" value="${escapeAttribute(action.id)}" />
            ${renderFrontlineTaskCapture(action, job)}
            <button class="primary-button" type="submit">Submit</button>
          </form>
        `
        : ""
    }
  `;
}

// Each task type collects what that type is actually for, rather than one generic notes box.
function renderFrontlineTaskCapture(action, job) {
  const config = normalizeTaskConfig(action.type, action.config);
  const notes = (label, placeholder, required = true) => `
    <label>${escapeHtml(label)}
      <textarea name="summary" placeholder="${escapeAttribute(placeholder)}" ${required ? "required" : ""}></textarea>
    </label>
  `;

  if (action.type === "Checklist") {
    if (!config.options.length) return notes(action.formName || action.name, "What did you do or observe?");
    return `
      <fieldset class="frontline-checklist">
        <legend>${escapeHtml(action.formName || action.name)}</legend>
        ${config.options
          .map(
            (option, index) => `
              <label class="check-row">
                <input type="checkbox" name="checklistOption" value="${escapeAttribute(option)}" ${index === 0 ? "" : ""} />
                <span>${escapeHtml(option)}</span>
              </label>
            `,
          )
          .join("")}
      </fieldset>
      ${notes("Notes", "Anything worth flagging?", false)}
    `;
  }

  if (action.type === "Photo") {
    return `
      <label>Photos (at least ${Number(config.minPhotos)})
        <input type="file" name="photos" accept="image/png,image/jpeg" capture="environment" multiple required />
      </label>
      ${notes("What do these show?", "Before, progress, after...")}
    `;
  }

  if (action.type === "Signature") {
    return `
      <label>${escapeHtml(config.signerRole)} signature
        <canvas id="frontlineSignaturePad" class="frontline-signature-pad" width="360" height="150"></canvas>
      </label>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="frontline-clear-signature">Clear</button>
        <span class="help-text" id="frontlineSignatureHint">Sign above with a finger or mouse.</span>
      </div>
      <label>Signed by
        <input name="signedBy" maxlength="90" placeholder="Print name" required />
      </label>
      ${notes("Notes", "Anything the signer said?", false)}
    `;
  }

  if (action.type === "Material") {
    const items = getInventoryItems();
    if (!items.length) return notes(action.formName || action.name, "Which materials were used?");
    const suggested = config.suggestedItemIds.filter((id) => findInventoryItem(id));
    const rows = suggested.length ? suggested : [""];
    return `
      <fieldset class="frontline-material-picker">
        <legend>Materials used from inventory</legend>
        ${rows
          .map(
            (itemId) => `
              <div class="frontline-material-row">
                <select name="materialItemId">
                  <option value="">Not used</option>
                  ${items
                    .map(
                      (item) =>
                        `<option value="${escapeAttribute(item.id)}" ${item.id === itemId ? "selected" : ""}>${escapeHtml(item.materialType)} - ${Number(item.onHand || 0)} ${escapeHtml(item.unit || "")} on hand</option>`,
                    )
                    .join("")}
                </select>
                <input type="number" name="materialQuantity" min="0" step="0.1" placeholder="Qty" />
              </div>
            `,
          )
          .join("")}
        <button class="mini-button" type="button" data-action="frontline-add-material-row">Add another material</button>
      </fieldset>
      ${notes("Notes", "Where were they used?", false)}
    `;
  }

  if (action.type === "Timer") {
    const computed = computeTimerHours(job, config.anchor);
    const anchorLabel = TIMER_ANCHORS.find((item) => item.value === config.anchor)?.label || "the job starting";
    return `
      <label>Hours on this task
        <input type="number" name="hours" min="0" step="0.25" value="${computed.hours}" required />
      </label>
      <input type="hidden" name="computedHours" value="${computed.hours}" />
      <input type="hidden" name="timerAnchor" value="${escapeAttribute(config.anchor)}" />
      <p class="help-text">${
        computed.anchorAt
          ? `Counted from ${escapeHtml(anchorLabel.toLowerCase())} at ${formatDateTime(computed.anchorAt)}. Correct it if that is not right.`
          : `No "${escapeHtml(anchorLabel.toLowerCase())}" timestamp on this job yet, so enter the hours yourself.`
      }</p>
      ${notes("Notes", "What was the time spent on?", false)}
    `;
  }

  if (action.type === "Sample") {
    return renderFrontlineSampleCapture(action, job, config);
  }

  return notes(action.formName || action.name, "What did you do or observe?");
}

function renderFrontlineSampleCapture(action, job, config) {
  const lead = findEmployee(state.frontlineSession?.employeeId);
  const existing = (state.backend.sampleRecords || []).filter((sample) => sample.dispatchJobId === job.id).length;
  const suggestedId = `${job.jobNumber || "S"}-${String(existing + 1).padStart(2, "0")}`;
  return `
    <div class="form-grid">
      <label>Sample ID
        <input name="sampleId" maxlength="60" value="${escapeAttribute(suggestedId)}" required />
      </label>
      <label>Collected at
        <input type="datetime-local" name="collectionTime" value="${escapeAttribute(toLocalDateTimeInput(new Date()))}" required />
      </label>
      <label>Collected by
        <input name="collector" maxlength="90" value="${escapeAttribute(lead?.displayName || "")}" required />
      </label>
      <label>Sample type
        <input name="sampleType" maxlength="60" placeholder="Field sample" />
      </label>
      <label>Matrix
        <input name="sampleMatrix" maxlength="60" value="${escapeAttribute(config.defaultMatrix)}" placeholder="Soil" />
      </label>
      <label>Method
        <input name="collectionMethod" maxlength="90" placeholder="Discrete grab" />
      </label>
      <label>Sample location
        <input name="sampleLocation" maxlength="90" placeholder="B-1 north wall" />
      </label>
      <label>Depth / interval
        <input name="depthInterval" maxlength="60" placeholder="0-2 ft" />
      </label>
      <label>Containers
        <input name="containerSummary" maxlength="90" value="${escapeAttribute(config.defaultContainer)}" placeholder="2 amber jars" />
      </label>
      <label>Preservation
        <input name="preservation" maxlength="60" placeholder="Cooled" />
      </label>
      <label>Chain of custody
        <input name="chainOfCustody" maxlength="60" placeholder="COC number" />
      </label>
    </div>
    <label>Requested analyses
      <textarea name="requestedAnalyses" rows="2" placeholder="One analysis per line">${escapeHtml(config.defaultAnalyses.join("\n"))}</textarea>
    </label>
    <div class="inline-actions">
      <button class="mini-button" type="button" data-action="frontline-capture-gps">Capture GPS</button>
      <span class="help-text" id="frontlineGpsHint">${
        state.frontlineGps
          ? `${state.frontlineGps.latitude.toFixed(5)}, ${state.frontlineGps.longitude.toFixed(5)} (±${Math.round(state.frontlineGps.accuracy)} m)`
          : "No coordinates captured yet."
      }</span>
    </div>
    <label>Sample photos
      <input type="file" name="photos" accept="image/png,image/jpeg" capture="environment" multiple />
    </label>
    <label>Field notes
      <textarea name="summary" rows="2" placeholder="Observations at the sample point" required></textarea>
    </label>
  `;
}

function computeTimerHours(job, anchor) {
  const event = (state.backend.jobStatusEvents || [])
    .filter((item) => item.jobId === job.id && item.toStatus === anchor)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0];
  if (!event) return { hours: 0, anchorAt: "" };
  const elapsedHours = (Date.now() - new Date(event.occurredAt).getTime()) / 3600000;
  return { hours: Math.max(0, Math.round(elapsedHours * 4) / 4), anchorAt: event.occurredAt };
}


function renderFrontlineWorkPlanStep(step, allSteps, job) {
  const unlocked = frontlineStepUnlocked(step, allSteps);
  const actions = actionsForDispatchStep(step.id);
  const previousStep = allSteps.find((candidate) => Number(candidate.sequence) === Number(step.sequence) - 1);
  const openAttr = unlocked && step.status !== "Complete" ? "open" : "";
  return `
    <details class="frontline-step ${unlocked ? "" : "locked"}" ${openAttr}>
      <summary>
        <span class="step-sequence">${Number(step.sequence)}</span>
        <span><strong>${escapeHtml(step.name)}</strong><small>${actions.filter((action) => action.status === "Complete").length} of ${actions.length} actions complete</small></span>
        ${renderDispatchStatusBadge(step.status)}
      </summary>
      <div class="job-action-list">
        ${
          unlocked
            ? actions.map((action) => renderFrontlineWorkPlanAction(action, job, step, actions)).join("") ||
              `<div class="empty-state compact">No actions in this step.</div>`
            : `<div class="empty-state compact">Complete "${escapeHtml(previousStep?.name || "the previous step")}" first.</div>`
        }
      </div>
    </details>
  `;
}

function renderFrontlineJobDetail() {
  const job = findDispatchJob(state.frontlineSelectedJobId);
  if (!job) {
    app.innerHTML = `
      <div class="frontline-shell">
        <div class="frontline-device">
          ${renderFrontlineHeader()}
          <div class="frontline-body">
            <button class="frontline-back-link" type="button" data-view="frontline-jobbook">&lsaquo; Job Book</button>
            <div class="empty-state">Job not found.</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const nextTransition = getNextDispatchTransition(job.status);
  const gate = getWorkPlanGate(job);
  const steps = stepsForDispatchJob(job.id);
  const submissions = submissionsForDispatchJob(job.id);
  const assignments = dispatchAssignmentsForJob(job.id);

  app.innerHTML = `
    <div class="frontline-shell">
      <div class="frontline-device">
        ${renderFrontlineHeader()}
        <div class="frontline-body">
          <button class="frontline-back-link" type="button" data-view="frontline-jobbook">&lsaquo; Job Book</button>
          <div class="inline-actions">
            <span class="job-number">${escapeHtml(job.jobNumber)}</span>
            ${renderDispatchStatusBadge(formatDispatchStatus(job.status))}
            ${renderReadinessBadge(getJobReadiness(job).status)}
          </div>
          <h2>${escapeHtml(job.jobName)}</h2>
          <p>${escapeHtml(job.customerName)}</p>
          <p class="help-text">${escapeHtml(job.addressText || job.locationName || "No address")}</p>
          <p class="help-text">${formatDateTime(job.scheduledStart)}${job.scheduledEnd ? ` to ${formatShortTime(job.scheduledEnd)}` : ""}</p>
          ${
            nextTransition
              ? `
                <button class="primary-button" type="button" data-action="advance-dispatch-job" data-id="${job.id}" ${gate.blocked ? "disabled" : ""}>${escapeHtml(nextTransition.label)}</button>
                ${gate.blocked ? `<p class="help-text">${escapeHtml(gate.reason)}</p>` : ""}
              `
              : ""
          }
          ${job.description ? `<p class="help-text">${escapeHtml(job.description)}</p>` : ""}

          <h3>Work plan</h3>
          <div class="work-plan-list">
            ${steps.map((step) => renderFrontlineWorkPlanStep(step, steps, job)).join("") || `<div class="empty-state">No execution plan instantiated.</div>`}
          </div>

          <h3>Assigned crew</h3>
          <div class="record-list">
            ${
              assignments
                .map((assignment) => {
                  const person = findEmployee(assignment.employeeId);
                  return `<div class="frontline-action-row"><span>${escapeHtml(person?.displayName || "Unknown")}${assignment.isFieldLead ? " (Field Lead)" : ""}</span></div>`;
                })
                .join("") || `<div class="empty-state compact">No workers assigned.</div>`
            }
          </div>

          <h3>Forms and submissions</h3>
          <div class="form-submission-list">
            ${submissions.map(renderJobFormSubmission).join("") || `<div class="empty-state">No forms submitted yet.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
  requestAnimationFrame(initializeSignaturePad);
}

function renderFrontlineStub(title) {
  app.innerHTML = `
    <div class="frontline-shell">
      <div class="frontline-device">
        ${renderFrontlineHeader()}
        <div class="frontline-body">
          <h2>${escapeHtml(title)}</h2>
          <div class="empty-state">${escapeHtml(title)} isn't wired up in this simulator yet.</div>
        </div>
      </div>
    </div>
  `;
}

async function frontlineLogin() {
  const select = document.getElementById("frontlineFieldLeadSelect");
  const employeeId = select?.value || "";
  if (!employeeId) {
    showToast("Choose a field lead first.");
    return;
  }
  state.frontlineSession = { employeeId };
  state.view = "frontline-home";
  render();
}

function frontlineExit() {
  state.frontlineSession = null;
  state.frontlineJobFilter = { scope: "mine", region: "all" };
  state.frontlineSelectedJobId = "";
  state.frontlineOpenActionId = "";
  state.view = "home";
  render();
}

function findJobAction(actionId) {
  return (state.backend.jobActions || []).find((action) => action.id === actionId);
}

function attachmentsForAction(actionId) {
  return (state.backend.jobTaskAttachments || []).filter((attachment) => attachment.actionId === actionId);
}

// The signature is kept as stroke geometry in state, never as canvas pixels: render() rewrites the
// whole view via innerHTML, so a bitmap would be lost on any re-render. Strokes are replayed onto
// whatever canvas exists after the next paint.
function cleanupSignaturePad() {
  if (signaturePadCleanup) {
    signaturePadCleanup();
    signaturePadCleanup = null;
  }
}

function initializeSignaturePad() {
  cleanupSignaturePad();
  const canvas = document.getElementById("frontlineSignaturePad");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const paint = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#13241b";
    for (const stroke of state.frontlineSignatureStrokes) {
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };
  paint();

  let active = null;
  const positionOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const onDown = (event) => {
    event.preventDefault();
    active = [positionOf(event)];
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event) => {
    if (!active) return;
    event.preventDefault();
    active.push(positionOf(event));
    state.frontlineSignatureStrokes = [...state.frontlineSignatureStrokes.filter((stroke) => stroke !== active), active];
    paint();
  };
  const onUp = () => {
    if (active && active.length > 1) {
      state.frontlineSignatureStrokes = [...state.frontlineSignatureStrokes.filter((stroke) => stroke !== active), active];
    }
    active = null;
    paint();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onUp);
  signaturePadCleanup = () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointerleave", onUp);
  };
}

function signatureToBlob() {
  const canvas = document.getElementById("frontlineSignaturePad");
  if (!canvas || !state.frontlineSignatureStrokes.length) return null;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function frontlineCaptureGps() {
  const hint = document.getElementById("frontlineGpsHint");
  if (!navigator.geolocation) {
    if (hint) hint.textContent = "This device cannot provide GPS. You can still submit without it.";
    return;
  }
  if (hint) hint.textContent = "Getting a fix...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.frontlineGps = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy || 0,
      };
      if (hint) {
        hint.textContent = `${state.frontlineGps.latitude.toFixed(5)}, ${state.frontlineGps.longitude.toFixed(5)} (±${Math.round(state.frontlineGps.accuracy)} m)`;
      }
    },
    (error) => {
      const reason =
        error.code === error.PERMISSION_DENIED
          ? "Location permission denied"
          : error.code === error.TIMEOUT
            ? "Location timed out"
            : "Location unavailable";
      if (hint) hint.textContent = `${reason}. You can still submit without coordinates.`;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

// Uploads send the file as the raw request body with the metadata in headers, which is the
// contract every upload route on the server expects.
async function uploadRawFile(url, file, headers = {}) {
  return apiRequest(url, {
    method: "POST",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-CRM-User": state.currentUser?.name || "Local user",
      "X-File-Name": encodeURIComponent(file.name || "upload.png"),
      ...headers,
    },
  });
}

async function frontlineCompleteAction(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;

  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const stepId = data.get("stepId").toString();
  const actionId = data.get("actionId").toString();
  const summary = (data.get("summary") || "").toString().trim();
  const action = findJobAction(actionId);
  const job = findDispatchJob(jobId);
  if (!action || !job) return;
  const config = normalizeTaskConfig(action.type, action.config);
  const fieldLead = findEmployee(state.frontlineSession?.employeeId);
  const submittedBy = fieldLead?.displayName || "Front Line";
  const files = [...(form.elements.photos?.files || [])];

  if (action.type === "Photo" && files.length < Number(config.minPhotos)) {
    showToast(`This task needs at least ${Number(config.minPhotos)} photo${Number(config.minPhotos) === 1 ? "" : "s"}.`);
    if (submitButton) submitButton.disabled = false;
    return;
  }
  if (action.type === "Signature" && !state.frontlineSignatureStrokes.length) {
    showToast("Capture a signature before submitting.");
    if (submitButton) submitButton.disabled = false;
    return;
  }

  const payload = buildTaskPayload(action, config, data, form);

  try {
    // Attachments upload first so they are self-describing by actionId: if a later write fails the
    // files are still recoverable, rather than a submission pointing at ids that never landed.
    for (const file of files) {
      await uploadRawFile(`/api/job-actions/${encodeURIComponent(actionId)}/attachments`, file, {
        "X-Attachment-Kind": "photo",
        "X-Caption": encodeURIComponent(summary.slice(0, 120)),
      });
    }
    if (action.type === "Signature") {
      const blob = await signatureToBlob();
      if (blob) {
        const file = new File([blob], `signature-${actionId}.png`, { type: "image/png" });
        await uploadRawFile(`/api/job-actions/${encodeURIComponent(actionId)}/attachments`, file, {
          "X-Attachment-Kind": "signature",
          "X-Caption": encodeURIComponent(payload.signedBy || ""),
        });
      }
    }
    if (action.type === "Material" && payload.materials?.length) {
      await apiRequest(`/api/job-actions/${encodeURIComponent(actionId)}/consume`, {
        method: "POST",
        body: JSON.stringify({ items: payload.materials }),
        headers: { "X-CRM-User": submittedBy },
      });
    }
    if (action.type === "Sample") {
      await saveSampleFromTask(action, job, data, summary, submittedBy);
    }

    await saveBackendRecord(
      "jobFormSubmissions",
      {
        id: makeId("form-sub"),
        jobId,
        actionId,
        formName: action.formName || action.name,
        status: "Submitted",
        submittedBy,
        submittedAt: new Date().toISOString(),
        summary: summary || describeTaskPayload(action.type, payload),
        payload,
      },
      { refresh: false },
    );
    await frontlineMarkActionComplete(actionId);
    await frontlineAdvanceStepIfComplete(stepId, [actionId]);
    await refreshBackendState();

    state.frontlineOpenActionId = "";
    state.frontlineSignatureStrokes = [];
    state.frontlineGps = null;
    render();
    showToast("Submitted -- visible on the job's dispatch dashboard now.");
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    showToast(error.message || "Could not submit.");
  }
}

function buildTaskPayload(action, config, data, form) {
  if (action.type === "Checklist") {
    const checked = data.getAll("checklistOption").map((value) => value.toString());
    return { options: config.options, checked, unchecked: config.options.filter((option) => !checked.includes(option)) };
  }
  if (action.type === "Signature") {
    return { signerRole: config.signerRole, signedBy: (data.get("signedBy") || "").toString().trim() };
  }
  if (action.type === "Timer") {
    return {
      hours: Number(data.get("hours") || 0),
      computedHours: Number(data.get("computedHours") || 0),
      anchor: (data.get("timerAnchor") || "").toString(),
    };
  }
  if (action.type === "Material") {
    const ids = data.getAll("materialItemId").map((value) => value.toString());
    const quantities = data.getAll("materialQuantity").map((value) => Number(value));
    const materials = ids
      .map((inventoryItemId, index) => ({ inventoryItemId, quantity: quantities[index] }))
      .filter((entry) => entry.inventoryItemId && Number.isFinite(entry.quantity) && entry.quantity > 0);
    return {
      materials,
      lines: materials.map((entry) => ({
        ...entry,
        name: findInventoryItem(entry.inventoryItemId)?.materialType || "Material",
        unit: findInventoryItem(entry.inventoryItemId)?.unit || "",
      })),
    };
  }
  if (action.type === "Photo") {
    return { photoCount: [...(form.elements.photos?.files || [])].length, minPhotos: Number(config.minPhotos) };
  }
  if (action.type === "Sample") {
    return { sampleId: (data.get("sampleId") || "").toString().trim() };
  }
  return {};
}

function describeTaskPayload(type, payload) {
  if (type === "Checklist") return `${payload.checked.length} of ${payload.options.length} checked.`;
  if (type === "Timer") return `${payload.hours} hours logged.`;
  if (type === "Material") return `${payload.lines.map((line) => `${line.quantity} ${line.unit} ${line.name}`).join(", ")}.`;
  if (type === "Photo") return `${payload.photoCount} photo${payload.photoCount === 1 ? "" : "s"} attached.`;
  if (type === "Signature") return `Signed by ${payload.signedBy}.`;
  return "Completed in Front Line.";
}

// A sample is a real record, not just a submission: it lands on the dispatch job AND on the
// operations project the job belongs to, so it shows up in the project and account sample lists.
async function saveSampleFromTask(action, job, data, summary, submittedBy) {
  const collectionTime = (data.get("collectionTime") || "").toString();
  const analyses = (data.get("requestedAnalyses") || "")
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  await saveBackendRecord(
    "sampleRecords",
    {
      id: makeId("sample"),
      sampleId: (data.get("sampleId") || "").toString().trim(),
      samplingSessionId: "",
      samplingSessionName: job.jobName || "",
      projectId: job.projectId || "",
      dispatchJobId: job.id,
      actionId: action.id,
      accountId: job.accountId || "",
      locationId: "",
      sampleLocation: (data.get("sampleLocation") || "").toString().trim(),
      sampleType: (data.get("sampleType") || "").toString().trim() || "Field sample",
      sampleMatrix: (data.get("sampleMatrix") || "").toString().trim(),
      collectionMethod: (data.get("collectionMethod") || "").toString().trim(),
      depthInterval: (data.get("depthInterval") || "").toString().trim(),
      collectionTime: collectionTime ? new Date(collectionTime).toISOString() : new Date().toISOString(),
      collector: (data.get("collector") || "").toString().trim() || submittedBy,
      gpsAccuracyMeters: state.frontlineGps?.accuracy || 0,
      latitude: state.frontlineGps?.latitude || 0,
      longitude: state.frontlineGps?.longitude || 0,
      containerSummary: (data.get("containerSummary") || "").toString().trim(),
      preservation: (data.get("preservation") || "").toString().trim(),
      requestedAnalyses: analyses,
      fieldNotes: summary,
      chainOfCustody: (data.get("chainOfCustody") || "").toString().trim(),
      labName: "",
      labStatus: "Logged in field",
      labResults: "",
      photos: [],
    },
    { refresh: false },
  );
}

async function frontlineCompleteStatusAction(actionId) {
  const action = findJobAction(actionId);
  if (!action) return;
  const { jobId, stepId } = action;
  try {
    await frontlineMarkActionComplete(actionId);
    await frontlineAdvanceStepIfComplete(stepId, [actionId]);
    await refreshBackendState();
    const job = findDispatchJob(jobId);
    const advances = getNextDispatchTransition(job?.status)?.status === "acknowledged";
    if (advances) await advanceDispatchJob(jobId, { silent: true });
    render();
    showToast(advances ? `${action.name} -- job is now acknowledged.` : `${action.name} recorded.`);
  } catch (error) {
    showToast(error.message || "Could not record that step.");
  }
}

// These chain several writes without refetching between them, so they must not re-read a record
// they have already written. Instead the caller passes the ids it just completed and they are
// treated as complete locally; the caller refreshes once when the whole chain is done.
async function frontlineMarkActionComplete(actionId) {
  const action = findJobAction(actionId);
  if (!action || action.status === "Complete") return;
  await saveBackendRecord("jobActions", { ...action, status: "Complete" }, { refresh: false });
  const nextAction = actionsForDispatchStep(action.stepId).find(
    (candidate) => candidate.id !== actionId && candidate.status !== "Complete",
  );
  if (nextAction) {
    await saveBackendRecord("jobActions", { ...nextAction, status: "Available" }, { refresh: false });
  }
}

async function frontlineAdvanceStepIfComplete(stepId, completedActionIds = []) {
  const step = (state.backend.jobSteps || []).find((item) => item.id === stepId);
  if (!step || step.status === "Complete") return;
  const outstanding = actionsForDispatchStep(stepId).filter(
    (action) => action.required !== false && action.status !== "Complete" && !completedActionIds.includes(action.id),
  );
  if (outstanding.length) return;
  await saveBackendRecord("jobSteps", { ...step, status: "Complete" }, { refresh: false });
  const nextStep = stepsForDispatchJob(step.jobId).find((candidate) => Number(candidate.sequence) === Number(step.sequence) + 1);
  if (!nextStep || nextStep.status === "Complete") return;
  await saveBackendRecord("jobSteps", { ...nextStep, status: "Available" }, { refresh: false });
  const firstAction = actionsForDispatchStep(nextStep.id).find((action) => action.status !== "Complete");
  if (firstAction) {
    await saveBackendRecord("jobActions", { ...firstAction, status: "Available" }, { refresh: false });
  }
}

function renderCurrentUser() {
  const user = state.currentUser || demoUser;
  const initials = (user.name || user.email || "CRM")
    .split(/[ .@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return `
    <section class="identity-panel">
      <h3>Current user</h3>
      <div class="user-chip">
        <span class="avatar">${escapeHtml(initials || "U")}</span>
        <div>
          <strong>${escapeHtml(user.name || "Unknown user")}</strong>
          <div class="row-meta">
            <span>${escapeHtml(user.email || "No email claim stored")}</span>
            <span class="source-badge">${escapeHtml(user.source || "Local")}</span>
          </div>
        </div>
      </div>
      <div class="inline-actions">
        <button class="secondary-button" type="button" data-action="use-demo-user">Use demo user</button>
        <button class="mini-button" type="button" data-action="set-demo-role" data-profile="sales">Sales role</button>
        <button class="mini-button" type="button" data-action="set-demo-role" data-profile="operations">Operations role</button>
        <button class="mini-button" type="button" data-action="set-demo-role" data-profile="inventory">Inventory role</button>
        <button class="mini-button" type="button" data-action="set-demo-role" data-profile="finance">Finance role</button>
        <button class="mini-button" type="button" data-action="set-demo-role" data-profile="client">Client login</button>
        <button class="danger-button" type="button" data-action="sign-out">Clear user</button>
      </div>
    </section>
  `;
}

function renderQueueItem(item) {
  return `
    <article class="queue-item">
      <strong>${escapeHtml(item.entity)} ${escapeHtml(item.action)}</strong>
      <div class="sync-meta">
        <span>${formatDate(item.createdAt)}</span>
        <span>${escapeHtml(item.status)}</span>
      </div>
    </article>
  `;
}

async function saveOpportunity(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = existingId ? findOpportunity(existingId) : null;
  const previousStage = existing?.stage || "";
  const stage = existing ? existing.stage : data.get("startingStage")?.toString() || "Lead";
  const opportunity = buildCoreOpportunityRecord({
    ...(existing || {}),
    id: existingId || makeId("opp"),
    accountId: data.get("accountId").toString(),
    name: data.get("name").toString().trim(),
    opportunityName: data.get("name").toString().trim(),
    value: Number(data.get("value")),
    amount: Number(data.get("value")),
    closeDate: data.get("closeDate").toString(),
    estimatedCloseDate: data.get("closeDate").toString(),
    stage,
    dealStage: stage,
    probability: STAGE_PROBABILITY[stage],
    closeProbability: STAGE_PROBABILITY[stage],
    serviceType: data.get("serviceType").toString(),
    status: stage === "Won" ? "Won" : data.get("status").toString(),
    nextStep: data.get("nextStep").toString().trim(),
    weightedAmount: undefined,
    forecastAmount: undefined,
    rating: undefined,
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", opportunity);
  } catch (error) {
    showToast(error.message || "Opportunity could not be saved.");
    return;
  }
  await queueChange("Opportunity", existing ? "updated" : "created", opportunity);
  closeDialogs();
  await refreshState();
  render();
  showToast(existing ? "Opportunity updated." : "Opportunity saved.");
  await maybeOfferProjectForWonOpportunity(previousStage, opportunity);
}

async function saveAccount(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = existingId ? findAccount(existingId) : null;
  const now = new Date().toISOString();
  const businessDescription = data.get("businessDescription").toString().trim();
  const ownerEmployeeId = data.get("ownerEmployeeId").toString();
  const ownerName = ownerEmployeeId === "system" ? "System" : ownerEmployeeId ? findEmployee(ownerEmployeeId)?.displayName || "" : "";
  const account = buildCoreAccountRecord({
    ...(existing || {}),
    id: existingId || makeId("acct"),
    name: data.get("name").toString().trim(),
    accountName: data.get("name").toString().trim(),
    website: data.get("website").toString().trim(),
    accountType: data.get("accountType").toString(),
    contact: existing?.contact || "",
    email: data.get("email").toString().trim(),
    phone: data.get("phone").toString().trim(),
    mainPhoneNumber: data.get("phone").toString().trim(),
    faxNumber: data.get("fax").toString().trim(),
    parentAccountId: data.get("parentAccountId").toString(),
    city: data.get("city").toString().trim(),
    addressOneCity: data.get("city").toString().trim(),
    addressOneState: data.get("state").toString().trim() || existing?.addressOneState || "",
    siteName: data.get("siteName").toString().trim(),
    concern: data.get("concern").toString().trim(),
    risk: data.get("risk").toString(),
    accountRating: data.get("risk").toString(),
    phase: data.get("phase").toString(),
    classification: data.get("phase").toString(),
    owner: ownerName || existing?.owner || "Unassigned",
    lastContact: existing?.lastContact || todayIso(),
    nextAction: existing?.nextAction || "Qualify cleanup scope and decision process",
    createdBy: existing?.createdBy || state.currentUser?.name || "Local user",
    createdOn: existing?.createdOn || now,
  });

  await saveBackendRecord("accounts", account, { refresh: false });
  if (!existing) {
    await saveBackendRecord("locations", {
      id: makeId("loc"),
      accountId: account.id,
      name: account.siteName,
      address: "",
      city: account.city,
      category: "Corporate Office",
      categoryOther: "",
      concern: account.concern,
      status: account.phase,
      access: "Access details not captured yet",
    });
  }
  if (businessDescription) {
    await saveRelationshipExtensionPatch(account.id, { businessDescription });
  }
  await queueChange("Account", existing ? "updated" : "created", account);
  closeDialogs();
  await refreshState();
  state.selectedAccountId = account.id;
  state.view = "account-detail";
  render();
  showToast(existing ? "Account updated." : "Account saved. Add a contact from the Summary tab when you're ready.");
}

async function saveContact(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = existingId ? findContact(existingId) : null;
  const opportunityId = data.get("opportunityId").toString();
  const contact = buildCoreContactRecord({
    ...(existing || {}),
    id: existingId || makeId("cont"),
    accountId: data.get("accountId").toString(),
    name: data.get("name").toString().trim(),
    fullName: data.get("name").toString().trim(),
    title: data.get("title").toString().trim(),
    jobTitle: data.get("title").toString().trim(),
    email: data.get("email").toString().trim(),
    phone: data.get("phone").toString().trim(),
    businessPhone: data.get("phone").toString().trim(),
    influence: data.get("influence").toString(),
    relationshipRole: data.get("influence").toString(),
    accountRole: data.get("influence").toString(),
    preferredContact: data.get("preferredContact").toString(),
    preferredContactMethod: data.get("preferredContact").toString(),
    opportunityIds: opportunityId ? [opportunityId] : [],
    notes: data.get("notes").toString().trim() || "No relationship notes yet.",
    divisionId: data.get("divisionId").toString(),
    owner: existing?.owner || state.currentUser?.name || "Unassigned",
  });

  await saveBackendRecord("contacts", contact, { refresh: false });
  await queueChange("Contact", existing ? "updated" : "created", contact);
  closeDialogs();
  await refreshState();
  state.selectedContactId = contact.id;
  state.view = "contact-detail";
  render();
  showToast(existing ? "Contact updated." : "Contact saved locally.");
}

async function saveContactPatch(contactId, patch, toastMessage) {
  const existing = findContact(contactId);
  if (!existing) return;
  const contact = buildCoreContactRecord({ ...existing, ...patch });
  await saveBackendRecord("contacts", contact, { refresh: false });
  await queueChange("Contact", "updated", contact);
  closeDialogs();
  await refreshState();
  render();
  showToast(toastMessage || "Contact updated.");
}

async function saveContactInfo(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  const firstName = data.get("firstName").toString().trim();
  const lastName = data.get("lastName").toString().trim();
  const name = `${firstName} ${lastName}`.trim();
  await saveContactPatch(
    contactId,
    {
      firstName,
      lastName,
      name,
      fullName: name,
      jobTitle: data.get("jobTitle").toString().trim(),
      title: data.get("jobTitle").toString().trim(),
      email: data.get("email").toString().trim(),
      emailAddressTwo: data.get("emailAddressTwo").toString().trim(),
      emailAddressThree: data.get("emailAddressThree").toString().trim(),
      businessPhone: data.get("businessPhone").toString().trim(),
      phone: data.get("businessPhone").toString().trim(),
      mobilePhone: data.get("mobilePhone").toString().trim(),
      fax: data.get("fax").toString().trim(),
    },
    "Contact info saved.",
  );
}

async function saveContactCommPrefs(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  await saveContactPatch(
    contactId,
    {
      preferredContactMethod: data.get("preferredContactMethod").toString(),
      preferredContact: data.get("preferredContactMethod").toString(),
      doNotAllowEmails: form.elements.doNotAllowEmails.checked,
      doNotAllowPhoneCalls: form.elements.doNotAllowPhoneCalls.checked,
      doNotAllowMail: form.elements.doNotAllowMail.checked,
      doNotAllowFaxes: form.elements.doNotAllowFaxes.checked,
    },
    "Communication preferences saved.",
  );
}

async function saveContactPersonal(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  await saveContactPatch(
    contactId,
    {
      birthday: data.get("birthday").toString(),
      notes: data.get("notes").toString().trim() || "No relationship notes yet.",
    },
    "Personal info saved.",
  );
}

async function saveContactRole(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  const ownerEmployeeId = data.get("ownerEmployeeId").toString();
  const ownerName = ownerEmployeeId === "system" ? "System" : ownerEmployeeId ? findEmployee(ownerEmployeeId)?.displayName || "" : "";
  await saveContactPatch(
    contactId,
    {
      accountRole: data.get("accountRole").toString(),
      relationshipRole: data.get("relationshipRole").toString(),
      influence: data.get("relationshipRole").toString(),
      lifecycleStage: data.get("lifecycleStage").toString(),
      leadStatus: data.get("leadStatus").toString(),
      owner: ownerName || "Unassigned",
      divisionId: data.get("divisionId").toString(),
    },
    "Role saved.",
  );
}

async function saveContactAddressOne(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  await saveContactPatch(
    contactId,
    {
      addressOneType: data.get("addressOneType").toString(),
      addressOneStreetOne: data.get("addressOneStreetOne").toString().trim(),
      addressOneStreetTwo: data.get("addressOneStreetTwo").toString().trim(),
      addressOneStreetThree: data.get("addressOneStreetThree").toString().trim(),
      addressOneCity: data.get("addressOneCity").toString().trim(),
      addressOneState: data.get("addressOneState").toString().trim(),
      addressOneCountry: data.get("addressOneCountry").toString().trim(),
      addressOneZipCode: data.get("addressOneZipCode").toString().trim(),
      addressOneTelephoneOne: data.get("addressOneTelephoneOne").toString().trim(),
      addressOneTelephoneTwo: data.get("addressOneTelephoneTwo").toString().trim(),
      addressOneTelephoneThree: data.get("addressOneTelephoneThree").toString().trim(),
      addressOneUpsZone: data.get("addressOneUpsZone").toString().trim(),
      addressOneUtcOffset: data.get("addressOneUtcOffset").toString().trim(),
    },
    "Address saved.",
  );
}

async function saveContactAddressTwo(form) {
  const data = new FormData(form);
  const contactId = data.get("id").toString();
  await saveContactPatch(
    contactId,
    {
      addressTwoType: data.get("addressTwoType").toString(),
      addressTwoStreetOne: data.get("addressTwoStreetOne").toString().trim(),
      addressTwoStreetTwo: data.get("addressTwoStreetTwo").toString().trim(),
      addressTwoStreetThree: data.get("addressTwoStreetThree").toString().trim(),
      addressTwoCity: data.get("addressTwoCity").toString().trim(),
      addressTwoState: data.get("addressTwoState").toString().trim(),
      addressTwoCountry: data.get("addressTwoCountry").toString().trim(),
      addressTwoZipCode: data.get("addressTwoZipCode").toString().trim(),
      addressTwoTelephoneOne: data.get("addressTwoTelephoneOne").toString().trim(),
      addressTwoTelephoneTwo: data.get("addressTwoTelephoneTwo").toString().trim(),
      addressTwoTelephoneThree: data.get("addressTwoTelephoneThree").toString().trim(),
      addressTwoFax: data.get("addressTwoFax").toString().trim(),
    },
    "Address saved.",
  );
}

async function saveProjectAlert(form) {
  const data = new FormData(form);
  const job = findProject(data.get("projectId").toString());
  if (!job) return;

  const alert = {
    id: makeId("alert"),
    projectId: job.id,
    accountId: job.accountId,
    locationId: job.locationId,
    alertType: data.get("alertType").toString(),
    severity: data.get("severity").toString(),
    description: data.get("description").toString().trim(),
    reportedBy: state.currentUser?.name || "Local user",
    reportedAt: new Date().toISOString(),
    status: "Open",
    notified: ["Project Manager", "Sales Lead"],
  };

  await saveBackendRecord("projectAlerts", alert, { refresh: false });
  await queueChange("Project Alert", "created", alert);
  closeDialogs();
  await refreshState();
  render();
  showToast("Field alert created.");
}

async function saveMaterialUsage(form) {
  const data = new FormData(form);
  const job = findProject(data.get("projectId").toString());
  if (!job) return;

  const material = {
    id: makeId("mat"),
    projectId: job.id,
    accountId: job.accountId,
    materialType: data.get("materialType").toString().trim(),
    quantity: Number(data.get("quantity")),
    unit: data.get("unit").toString().trim(),
    loggedBy: state.currentUser?.name || "Local user",
    timestamp: new Date().toISOString(),
  };

  await saveBackendRecord("materialUsage", material, { refresh: false });
  await queueChange("Material Usage", "created", material);
  closeDialogs();
  await refreshState();
  render();
  showToast("Material usage saved.");
}

async function saveEquipmentLog(form) {
  const data = new FormData(form);
  const job = findProject(data.get("projectId").toString());
  if (!job) return;

  const equipment = {
    id: makeId("equip"),
    projectId: job.id,
    accountId: job.accountId,
    assetTag: data.get("assetTag").toString().trim(),
    equipment: data.get("equipment").toString().trim(),
    truckId: data.get("truckId").toString().trim(),
    checkedOut: new Date().toISOString(),
    returned: "",
    condition: data.get("condition").toString().trim(),
    user: state.currentUser?.name || "Local user",
  };

  await saveBackendRecord("equipmentLogs", equipment, { refresh: false });
  await queueChange("Equipment Log", "created", equipment);
  closeDialogs();
  await refreshState();
  render();
  showToast("Equipment log saved.");
}

async function saveScheduleEvent(form) {
  const data = new FormData(form);
  const equipmentAssetTag = data.get("equipmentAssetTag").toString();
  const laborResourceId = data.get("laborResourceId").toString();
  const requiredCertification = data.get("requiredCertification").toString().trim();
  const record = {
    projectId: data.get("projectId").toString(),
    title: data.get("title").toString().trim(),
    date: data.get("date").toString(),
    crew: data.get("crew").toString().trim(),
    equipmentAssetTags: equipmentAssetTag ? [equipmentAssetTag] : [],
    laborResourceIds: laborResourceId ? [laborResourceId] : [],
    requiredCertifications: requiredCertification ? [requiredCertification] : [],
    status: "Scheduled",
  };

  try {
    await saveBackendRecord("scheduleEvents", record);
    closeDialogs();
    render();
    showToast("Scheduled work saved on the backend.");
  } catch (error) {
    showToast(error.message || "Schedule could not be saved.");
  }
}

async function saveRemediation(form) {
  const data = new FormData(form);
  const account = findAccount(data.get("accountId").toString());
  if (!account) return;

  const job = buildCoreProjectRecord({
    id: makeId("proj"),
    accountId: account.id,
    locationId: locationsForAccount(account.id)[0]?.id || "",
    opportunityId: "",
    contactIds: contactsForAccount(account.id).map((contact) => contact.id),
    name: data.get("name").toString().trim(),
    jobClass: "Multi-Stage Remediation",
    status: "Pre-mobilization",
    activePhase: data.get("activePhase").toString().trim(),
    projectManager: data.get("projectManager").toString().trim(),
    salesLead: account.owner,
    startDate: data.get("startDate").toString(),
    targetDate: data.get("targetDate").toString(),
    budget: Number(data.get("budget")),
    notToExceed: "",
    marginWatch: "Backend-created remediation awaiting detailed scope.",
  });

  await saveBackendRecord("projects", job, { refresh: false });
  await queueChange("Project", "created", job);
  closeDialogs();
  await refreshState();
  state.view = "ops-remediation";
  render();
  showToast("Remediation project created.");
}

async function saveInventoryItem(form) {
  const data = new FormData(form);
  try {
    await saveBackendRecord("inventoryItems", {
      id: data.get("id").toString() || "",
      materialType: data.get("materialType").toString().trim(),
      unit: data.get("unit").toString().trim(),
      onHand: Number(data.get("onHand")),
      reorderAt: Number(data.get("reorderAt")),
      targetStock: Number(data.get("targetStock")),
      buyer: data.get("buyer").toString().trim(),
      barcode: data.get("barcode").toString().trim(),
    });
    closeDialogs();
    render();
    showToast("Consumable saved on the backend.");
  } catch (error) {
    showToast(error.message || "Consumable could not be saved.");
  }
}

async function savePurchaseOrder(form) {
  const data = new FormData(form);
  const existingOrderId = data.get("id").toString();
  const existing = existingOrderId ? getPurchaseOrders().find((item) => item.id === existingOrderId) : null;
  try {
    await saveBackendRecord("purchaseOrders", {
      id: existingOrderId || "",
      itemId: data.get("itemId").toString(),
      quantity: Number(data.get("quantity")),
      vendor: data.get("vendor").toString().trim(),
      status: data.get("status").toString() || "Draft",
      requestedBy: existing?.requestedBy || state.currentUser?.name || "Local user",
      createdAt: existing?.createdAt || "",
      receivedAt: existing?.receivedAt || "",
      receivedBy: existing?.receivedBy || "",
      receivedQuantity: existing?.receivedQuantity || 0,
    });
    closeDialogs();
    render();
    showToast(existing ? "Purchase order updated." : "Purchase order saved as a draft.");
  } catch (error) {
    showToast(error.message || "Purchase order could not be saved.");
  }
}

async function receivePurchaseOrder(orderId) {
  const order = getPurchaseOrders().find((item) => item.id === orderId);
  if (!order) {
    showToast("Purchase order was not found.");
    return;
  }

  try {
    const result = await apiRequest(`/api/purchase-orders/${encodeURIComponent(orderId)}/receive`, {
      method: "POST",
      body: JSON.stringify({
        receivedBy: state.currentUser?.name || "Local user",
      }),
    });
    await refreshBackendState();
    render();
    const item = result.inventoryItem;
    showToast(`${order.materialType} received. On hand is now ${item?.onHand ?? "updated"}.`);
  } catch (error) {
    showToast(error.message || "Purchase order could not be received.");
  }
}

async function saveEquipmentAsset(form) {
  const data = new FormData(form);
  const id = data.get("id").toString();
  const existing = id ? getEquipmentStatus().find((item) => item.id === id) : null;
  const specs = {};
  form.querySelectorAll("[data-spec-key]").forEach((input) => {
    const value = input.value.trim();
    if (value) specs[input.dataset.specKey] = value;
  });
  try {
    await saveBackendRecord("equipmentAssets", {
      id,
      assetTag: data.get("assetTag").toString().trim(),
      equipment: data.get("equipment").toString().trim(),
      category: data.get("category").toString() || "General equipment",
      status: data.get("status").toString(),
      lastUsed: data.get("lastUsed").toString(),
      maintenanceDue: data.get("maintenanceDue").toString(),
      issue: data.get("issue").toString().trim(),
      assignedProjectId: existing?.assignedProjectId || "",
      specs,
    });
    closeDialogs();
    render();
    showToast("Equipment asset saved on the backend.");
  } catch (error) {
    showToast(error.message || "Equipment asset could not be saved.");
  }
}

async function saveEquipmentMaintenanceRecord(form) {
  const data = new FormData(form);
  const assetTag = data.get("assetTag").toString().trim();
  const nextDueDate = data.get("nextDueDate").toString();
  try {
    await saveBackendRecord("equipmentMaintenanceRecords", {
      assetTag,
      type: data.get("type").toString(),
      date: data.get("date").toString() || todayIso(),
      description: data.get("description").toString().trim(),
      performedBy: data.get("performedBy").toString().trim() || state.currentUser?.name || "Local user",
      cost: Number(data.get("cost") || 0),
      nextDueDate,
    });
    const asset = findEquipmentAssetByTag(assetTag);
    if (asset && nextDueDate) {
      await saveBackendRecord("equipmentAssets", { ...asset, maintenanceDue: nextDueDate });
    }
    closeDialogs();
    render();
    showToast("Maintenance record saved.");
  } catch (error) {
    showToast(error.message || "Maintenance record could not be saved.");
  }
}

async function saveEquipmentRestockItem(form) {
  const data = new FormData(form);
  try {
    await saveBackendRecord("equipmentRestockItems", {
      id: data.get("id").toString() || "",
      assetTag: data.get("assetTag").toString().trim(),
      itemName: data.get("itemName").toString().trim(),
      quantityNeeded: Number(data.get("quantityNeeded") || 1),
      unit: data.get("unit").toString().trim(),
      status: data.get("status").toString() || "Needed",
      notes: data.get("notes").toString().trim(),
    });
    closeDialogs();
    render();
    showToast("Restock item saved.");
  } catch (error) {
    showToast(error.message || "Restock item could not be saved.");
  }
}

async function saveMapLocation(form) {
  const data = new FormData(form);
  const latitude = Number(data.get("latitude"));
  const longitude = Number(data.get("longitude"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    showToast("Latitude and longitude must be valid numbers.");
    return;
  }

  const scheduleEventId = data.get("scheduleEventId").toString();
  const scheduleEvent = getScheduleEvents().find((event) => event.id === scheduleEventId);
  const jobId = data.get("projectId").toString() || scheduleEvent?.projectId || "";
  const assetTags = data
    .get("assetTags")
    .toString()
    .split(",")
    .map((assetTag) => assetTag.trim())
    .filter(Boolean);

  try {
    await saveBackendRecord("mapLocations", {
      id: data.get("id").toString() || "",
      jobId,
      scheduleEventId,
      label: data.get("label").toString().trim(),
      latitude,
      longitude,
      assetTags,
      status: data.get("status").toString(),
      source: data.get("source").toString() || "Manual",
      lastPingAt: new Date().toISOString(),
    });
    closeDialogs();
    render();
    showToast("GPS point saved on the map.");
  } catch (error) {
    showToast(error.message || "GPS point could not be saved.");
  }
}

async function saveEmployee(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = existingId ? findEmployee(existingId) : null;
  const firstName = data.get("firstName").toString().trim();
  const lastName = data.get("lastName").toString().trim();
  const employee = {
    ...(existing || {}),
    id: existingId || makeId("emp"),
    employeeNumber: data.get("employeeNumber").toString().trim(),
    systemUserId: existing?.systemUserId || "",
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`.trim(),
    jobTitle: data.get("jobTitle").toString().trim(),
    employmentStatus: data.get("employmentStatus").toString(),
    employmentType: data.get("employmentType").toString(),
    primaryEmail: data.get("primaryEmail").toString().trim(),
    mobilePhone: data.get("mobilePhone").toString().trim(),
    managerEmployeeId: data.get("managerEmployeeId").toString(),
    businessUnit: data.get("businessUnit").toString(),
    teamId: data.get("teamId").toString(),
    crewId: data.get("crewId").toString(),
    homeBase: data.get("homeBase").toString().trim(),
    availabilitySummary: existing?.availabilitySummary || "Standard calendar not assigned",
    hoursWorked: existing?.hoursWorked || 0,
    capacity: existing?.capacity || 40,
    dispatchEligible: form.elements.dispatchEligible.checked,
    frontlineEnabled: form.elements.frontlineEnabled.checked,
    readinessStatus: form.elements.dispatchEligible.checked ? "Ready" : "Office",
    hireDate: data.get("hireDate").toString(),
    skills: data
      .get("skills")
      .toString()
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
  };

  try {
    const saved = await saveBackendRecord("employees", employee);
    closeDialogs();
    state.selectedEmployeeId = saved.id;
    state.view = "employee-detail";
    render();
    showToast(existing ? "Employee updated." : "Employee added to the workforce directory.");
  } catch (error) {
    showToast(error.message || "Employee could not be saved.");
  }
}

async function saveEmployeeCredential(form) {
  const data = new FormData(form);
  const employeeId = data.get("employeeId").toString();
  const employee = findEmployee(employeeId);
  if (!employee) {
    showToast("Select a valid employee.");
    return;
  }
  const record = {
    id: makeId("cert"),
    employeeId,
    recordType: data.get("recordType").toString(),
    code: data.get("code").toString().trim(),
    name: data.get("name").toString().trim(),
    number: data.get("number").toString().trim(),
    issuedOn: data.get("issuedOn").toString(),
    expiresOn: data.get("expiresOn").toString(),
    status: data.get("status").toString(),
    verified: form.elements.verified.checked,
  };

  try {
    await saveBackendRecord("employeeCertifications", record);
    const issueStatuses = [...certificationsForEmployee(employeeId).map((item) => item.status), record.status];
    const readinessStatus = issueStatuses.some((status) => ["Expired", "Suspended", "Revoked"].includes(status))
      ? "Blocked"
      : issueStatuses.includes("Expiring")
        ? "Expiring"
        : employee.dispatchEligible
          ? "Ready"
          : "Office";
    await saveBackendRecord("employees", { ...employee, readinessStatus });
    closeDialogs();
    state.selectedEmployeeId = employeeId;
    state.view = "employee-detail";
    render();
    showToast("Credential saved and dispatch readiness recalculated.");
  } catch (error) {
    showToast(error.message || "Credential could not be saved.");
  }
}

async function saveJobRequest(form) {
  const data = new FormData(form);
  const account = findAccount(data.get("accountId").toString());
  if (!account) {
    showToast("Select a customer account before sending the request.");
    return;
  }
  const requestedEmployee = findEmployee(data.get("requestedEmployeeId").toString());
  const customerPacketFiles = [...form.elements.customerPacketFiles.files];
  const quoteFiles = [...form.elements.quoteFiles.files];
  const now = new Date();
  const requestedValue = data.get("requestedServiceAt").toString();
  const request = {
    id: makeId("req"),
    requestNumber: `REQ-${now.getFullYear()}-${localIsoDate(now).replaceAll("-", "").slice(4)}-${String(getJobRequests().length + 1).padStart(2, "0")}`,
    projectId: data.get("projectId").toString(),
    receivedAt: now.toISOString(),
    requestedServiceAt: requestedValue ? new Date(requestedValue).toISOString() : "",
    requestedTimeText: data.get("priority").toString() === "Emergency" ? "ASAP" : requestedValue ? formatDateTime(requestedValue) : "Date not confirmed",
    status: "Submitted",
    priority: data.get("priority").toString(),
    serviceCategory: data.get("serviceCategory").toString(),
    accountId: account.id,
    customerName: account.name,
    customerPoNumber: data.get("customerPoNumber").toString().trim(),
    bioremedyPoNumber: data.get("bioremedyPoNumber").toString().trim(),
    generatorResponsibleParty: data.get("generatorResponsibleParty").toString().trim(),
    calledInByName: data.get("calledInByName").toString().trim(),
    onsiteContactName: data.get("onsiteContactName").toString().trim(),
    onsiteContactPhone: data.get("onsiteContactPhone").toString().trim(),
    addressText: data.get("addressText").toString().trim(),
    estimatedDurationMinutes: Math.round(Number(data.get("estimatedDurationHours") || 0) * 60),
    requestedEmployeeId: requestedEmployee?.id || "",
    requestedAssignee: requestedEmployee?.displayName || "",
    equipmentNotes: data.get("equipmentNotes").toString().trim(),
    laborNotes: data.get("laborNotes").toString().trim(),
    vendorNotes: data.get("vendorNotes").toString().trim(),
    pricingNotes: data.get("pricingNotes").toString().trim(),
    description: data.get("description").toString().trim(),
    customerPacketStatus: data.get("customerPacketStatus").toString(),
    quoteStatus: data.get("quoteStatus").toString(),
    convertedJobId: "",
    receivedBy: state.currentUser?.name || "Local user",
  };

  try {
    await saveBackendRecord("jobRequests", request);
    const uploads = [
      ...customerPacketFiles.map((file) => uploadJobRequestDocument(request.id, "customer_packet", file)),
      ...quoteFiles.map((file) => uploadJobRequestDocument(request.id, "quote", file)),
    ];
    const uploadResults = await Promise.allSettled(uploads);
    await refreshBackendState();
    closeDialogs();
    state.view = "dispatch-intake";
    render();
    const failedUploads = uploadResults.filter((result) => result.status === "rejected");
    if (failedUploads.length) {
      showToast(`Job request saved. ${failedUploads.length} document${failedUploads.length === 1 ? "" : "s"} could not be uploaded.`);
    } else {
      showToast(uploads.length ? `Job request sent with ${uploads.length} document${uploads.length === 1 ? "" : "s"}.` : "Job request sent to dispatch.");
    }
  } catch (error) {
    showToast(error.message || "Job request could not be saved.");
  }
}

async function uploadJobRequestDocument(jobRequestId, documentRole, file) {
  return uploadRawFile(`/api/job-requests/${encodeURIComponent(jobRequestId)}/documents`, file, {
    "X-Document-Role": documentRole,
  });
}

async function downloadJobRequestDocument(documentId) {
  const requestDocument = getJobRequestDocuments().find((item) => item.id === documentId);
  if (!requestDocument) {
    showToast("That request document is not available.");
    return;
  }
  try {
    const response = await fetch(`/api/job-request-documents/${encodeURIComponent(documentId)}/download`, {
      headers: {
        "X-CRM-Role": state.currentUser?.role || "Local",
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Document download failed.");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = requestDocument.fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    showToast(error.message || "Document download failed.");
  }
}

function openJobTemplateSelectDialog(requestId) {
  const request = getJobRequests().find((item) => item.id === requestId);
  if (!request) {
    showToast("That job request is not available.");
    return;
  }
  if (!request.requestedServiceAt || !request.onsiteContactName || !request.addressText) {
    showToast("Request needs a service time, onsite contact, and address before job creation.");
    return;
  }

  const dialog = document.querySelector("#jobTemplateSelectDialog");
  const templates = getJobTypeTemplates().filter((template) => template.isActive !== false);
  const sorted = [...templates].sort((a, b) => {
    const aMatch = a.serviceCategory === request.serviceCategory ? 0 : 1;
    const bMatch = b.serviceCategory === request.serviceCategory ? 0 : 1;
    return aMatch - bMatch;
  });
  const blankOption = `
    <button class="template-option" type="button" data-action="select-job-template" data-request-id="${escapeAttribute(requestId)}" data-template-id="">
      <div>
        <strong>No template</strong>
        <span class="row-meta"><span>Start with a blank generic work plan</span></span>
      </div>
    </button>
  `;
  dialog.querySelector("[data-template-options]").innerHTML = sorted.map((template) => renderJobTemplateOption(template, requestId, request.serviceCategory)).join("") + blankOption;
  dialog.showModal();
}

function renderJobTemplateOption(template, requestId, requestServiceCategory) {
  const stages = template.stages || [];
  const taskCount = stages.reduce((sum, stage) => sum + (stage.tasks || []).length, 0);
  const suggested = template.serviceCategory === requestServiceCategory;
  return `
    <button class="template-option ${suggested ? "suggested" : ""}" type="button" data-action="select-job-template" data-request-id="${escapeAttribute(requestId)}" data-template-id="${escapeAttribute(template.id)}">
      <div>
        <strong>${escapeHtml(template.name)}</strong>
        <span class="row-meta">
          <span>${escapeHtml(template.serviceCategory)}</span>
          <span>${stages.length} stage${stages.length === 1 ? "" : "s"}</span>
          <span>${taskCount} sub-task${taskCount === 1 ? "" : "s"}</span>
        </span>
      </div>
      ${suggested ? `<span class="tag">Suggested</span>` : ""}
    </button>
  `;
}

async function convertJobRequest(requestId, templateId = "") {
  const request = getJobRequests().find((item) => item.id === requestId);
  if (!request) return;
  if (!request.requestedServiceAt || !request.onsiteContactName || !request.addressText) {
    showToast("Request needs a service time, onsite contact, and address before job creation.");
    return;
  }

  const template = templateId ? findJobTypeTemplate(templateId) : null;
  const serviceMap = {
    ER: { name: "Emergency Response", code: "ER" },
    Sampling: { name: "Environmental Sampling", code: "SAMPLE" },
    Scheduled: { name: "Scheduled Environmental Service", code: "SVC" },
    Remediation: { name: "Remediation Field Work", code: "REMED" },
    Abatement: { name: "Asbestos Abatement", code: "ABATE" },
  };
  const fallbackType = serviceMap[request.serviceCategory] || serviceMap.Scheduled;
  const jobType = template
    ? { name: template.name, code: serviceMap[template.serviceCategory]?.code || fallbackType.code }
    : fallbackType;
  const sequence = getDispatchJobs().length + 1;
  const start = new Date(request.requestedServiceAt);
  const end = new Date(start.getTime() + Number(request.estimatedDurationMinutes || 240) * 60000);
  const requestedEmployee = findEmployee(request.requestedEmployeeId) || getEmployees().find((employee) => employee.displayName === request.requestedAssignee);
  const project = request.projectId ? findProject(request.projectId) : null;
  const job = {
    id: makeId("dispatch-job"),
    jobNumber: `JOB-${start.getFullYear()}-${localIsoDate(start).replaceAll("-", "").slice(4)}-${String(sequence).padStart(2, "0")}`,
    jobRequestId: request.id,
    jobTypeTemplateId: template?.id || "",
    accountId: request.accountId || accountForJobRequest(request)?.id || "",
    projectId: project?.id || "",
    projectName: project?.name || `${request.customerName} ${jobType.name}`,
    customerName: request.customerName,
    jobName: request.description.split(/[.!?]/)[0].slice(0, 90) || `${request.customerName} service`,
    jobType: jobType.name,
    jobTypeCode: jobType.code,
    jobTypeVersion: 1,
    status: "draft",
    dispatchStatus: "Unassigned",
    officeReviewStatus: "Not ready",
    priority: request.priority,
    requestedServiceAt: request.requestedServiceAt,
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    timezone: "America/Chicago",
    fieldLeadEmployeeId: requestedEmployee?.id || "",
    locationName: request.addressText,
    addressText: request.addressText,
    onsiteContactName: request.onsiteContactName,
    onsiteContactPhone: request.onsiteContactPhone,
    generatorResponsibleParty: request.generatorResponsibleParty,
    customerPoNumber: request.customerPoNumber,
    bioremedyPoNumber: request.bioremedyPoNumber,
    pricingSource: request.pricingNotes,
    description: request.description,
    readinessStatus: "Blocked",
    completionPercent: 0,
    updatedAt: new Date().toISOString(),
  };

  try {
    const savedJob = await saveBackendRecord("dispatchJobs", job);
    await saveBackendRecord("jobRequests", { ...request, status: "Converted", convertedJobId: savedJob.id });
    if (template) {
      await applyJobTypeTemplateToJob(savedJob, template);
    } else {
      await applyFallbackJobPlan(savedJob);
    }
    closeDialogs();
    state.selectedDispatchJobId = savedJob.id;
    state.view = "dispatch-job-detail";
    render();
    showToast(template ? `Dispatch job created using the "${template.name}" template.` : "Dispatch job created from the sales request.");
  } catch (error) {
    showToast(error.message || "Job could not be created.");
  }
}

async function applyJobTypeTemplateToJob(job, template) {
  const stages = [...(template.stages || [])].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  for (const [stageIndex, stage] of stages.entries()) {
    const savedStep = await saveBackendRecord("jobSteps", {
      id: makeId("step"),
      jobId: job.id,
      key: stage.key,
      name: stage.name,
      sequence: stageIndex + 1,
      status: stageIndex === 0 ? "Available" : "Not started",
      required: true,
    });
    const tasks = stage.tasks || [];
    for (const [taskIndex, task] of tasks.entries()) {
      const status = stageIndex === 0 ? (taskIndex === 0 ? "Available" : "Blocked") : "Not started";
      await saveBackendRecord("jobActions", {
        id: makeId("action"),
        jobId: job.id,
        stepId: savedStep.id,
        key: task.key,
        name: task.name,
        sequence: taskIndex + 1,
        type: task.type,
        status,
        required: Boolean(task.required),
        assigneeScope: task.assigneeScope,
        formName: task.type === "Status transition" ? "" : task.name,
        config: normalizeTaskConfig(task.type, task.config),
      });
    }
  }
}

async function applyFallbackJobPlan(job) {
  const steps = [
    { key: "mobilize", name: "Mobilize", sequence: 1 },
    { key: "perform_work", name: "Perform Work", sequence: 2 },
    { key: "document", name: "Document Work", sequence: 3 },
    { key: "closeout", name: "Field Closeout", sequence: 4 },
  ];
  for (const step of steps) {
    const savedStep = await saveBackendRecord("jobSteps", {
      id: makeId("step"),
      jobId: job.id,
      key: step.key,
      name: step.name,
      sequence: step.sequence,
      status: step.sequence === 1 ? "Available" : "Not started",
      required: true,
    });
    await saveBackendRecord("jobActions", {
      id: makeId("action"),
      jobId: job.id,
      stepId: savedStep.id,
      key: `${step.key}_form`,
      name: step.sequence === 1 ? "Acknowledge dispatch and begin travel" : step.sequence === 4 ? "Complete job recap and signature" : `${step.name} checklist`,
      sequence: 1,
      type: step.sequence === 1 ? "Status transition" : "Form",
      status: step.sequence === 1 ? "Available" : "Not started",
      required: true,
      assigneeScope: step.sequence === 1 ? "All assigned workers" : "Field Lead",
      formName: step.sequence === 1 ? "Travel and Mileage" : `${job.jobType} ${step.name}`,
    });
  }
}

async function saveDispatchSchedule(form) {
  const data = new FormData(form);
  const job = findDispatchJob(data.get("jobId").toString());
  const fieldLead = findEmployee(data.get("fieldLeadEmployeeId").toString());
  if (!job || !fieldLead) {
    showToast("Select a valid job and field lead.");
    return;
  }
  const date = data.get("date").toString();
  const start = new Date(`${date}T${data.get("startTime").toString()}:00`);
  const end = new Date(`${date}T${data.get("endTime").toString()}:00`);
  if (end <= start) {
    showToast("Schedule end time must be after start time.");
    return;
  }
  const crewId = data.get("crewId").toString();
  const resourceName = data.get("resourceName").toString().trim();
  const eligibilityStatus = fieldLead.readinessStatus === "Blocked" ? "Blocked" : fieldLead.readinessStatus === "Expiring" ? "Warning" : "Eligible";

  try {
    const updatedJob = {
      ...job,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      fieldLeadEmployeeId: fieldLead.id,
      status: ["draft", "ready"].includes(job.status) ? "scheduled" : job.status,
      dispatchStatus: "Scheduled",
      updatedAt: new Date().toISOString(),
    };
    await saveBackendRecord("dispatchJobs", updatedJob);

    const existingSegment = getJobScheduleSegments().find((segment) => segment.jobId === job.id);
    await saveBackendRecord("jobScheduleSegments", {
      ...(existingSegment || {}),
      id: existingSegment?.id || makeId("segment"),
      jobId: job.id,
      type: "Work",
      name: `${job.jobType} work`,
      sequence: 1,
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
      status: "Confirmed",
      lockedForDispatch: false,
      notes: data.get("notes").toString().trim(),
    });

    const crewEmployeeIds = crewId ? getEmployees().filter((employee) => employee.crewId === crewId).map((employee) => employee.id) : [];
    const employeeIds = [...new Set([fieldLead.id, ...crewEmployeeIds])];
    for (const employeeId of employeeIds) {
      const employee = findEmployee(employeeId);
      const existing = getJobAssignments().find((assignment) => assignment.jobId === job.id && assignment.employeeId === employeeId);
      await saveBackendRecord("jobAssignments", {
        ...(existing || {}),
        id: existing?.id || makeId("assignment"),
        jobId: job.id,
        employeeId,
        crewId,
        role: employeeId === fieldLead.id ? "Field Lead" : employee?.jobTitle || "Technician",
        isFieldLead: employeeId === fieldLead.id,
        status: "Assigned",
        eligibilityStatus: employee?.readinessStatus === "Blocked" ? "Blocked" : employee?.readinessStatus === "Expiring" ? "Warning" : "Eligible",
        eligibilityNote: employee?.readinessStatus === "Blocked" ? "Employee has a blocking credential record" : "",
        plannedStart: start.toISOString(),
        plannedEnd: end.toISOString(),
      });
    }

    if (resourceName) {
      await saveBackendRecord("jobResources", {
        id: makeId("resource"),
        jobId: job.id,
        type: data.get("resourceType").toString(),
        name: resourceName,
        assetTag: "",
        quantity: 1,
        status: "Reserved",
      });
    }

    if (eligibilityStatus === "Blocked") {
      await saveBackendRecord("jobConflicts", {
        id: makeId("conflict"),
        jobId: job.id,
        type: "Expired certification",
        severity: "Blocking",
        status: "Open",
        title: `${fieldLead.displayName} is not dispatch eligible`,
        detail: "Resolve the worker credential block or assign a different field lead.",
      });
    }

    closeDialogs();
    state.selectedDispatchJobId = job.id;
    state.view = "dispatch-job-detail";
    render();
    showToast("Job schedule, crew assignments, and readiness checks updated.");
  } catch (error) {
    showToast(error.message || "Job schedule could not be saved.");
  }
}

function openDispatchAssignEmployeeDialog(jobId) {
  const dialog = document.querySelector("#dispatchAssignEmployeeDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.jobId.value = jobId;
  populateEmployeeSelect(dialog, "employeeId", "Select an employee");
  dialog.showModal();
}

async function saveDispatchAssignEmployee(form) {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const employeeId = data.get("employeeId").toString();
  const employee = findEmployee(employeeId);
  if (!employee) {
    showToast("Select an employee to assign.");
    return;
  }
  const existing = getJobAssignments().find((assignment) => assignment.jobId === jobId && assignment.employeeId === employeeId);
  try {
    await saveBackendRecord("jobAssignments", {
      ...(existing || {}),
      id: existing?.id || makeId("assignment"),
      jobId,
      employeeId,
      crewId: existing?.crewId || "",
      role: data.get("role").toString().trim() || employee.jobTitle || "Technician",
      isFieldLead: existing?.isFieldLead || false,
      status: "Assigned",
      eligibilityStatus: employee.readinessStatus === "Blocked" ? "Blocked" : employee.readinessStatus === "Expiring" ? "Warning" : "Eligible",
      eligibilityNote: employee.readinessStatus === "Blocked" ? "Employee has a blocking credential record" : "",
      plannedStart: existing?.plannedStart || new Date().toISOString(),
      plannedEnd: existing?.plannedEnd || "",
    });
    closeDialogs();
    render();
    showToast("Employee assigned to job.");
  } catch (error) {
    showToast(error.message || "Employee could not be assigned.");
  }
}

async function unassignJobEmployee(assignmentId) {
  const assignment = getJobAssignments().find((item) => item.id === assignmentId);
  if (!assignment) return;
  try {
    await saveBackendRecord("jobAssignments", { ...assignment, status: "Cancelled", isFieldLead: false });
    render();
    showToast("Employee unassigned.");
  } catch (error) {
    showToast(error.message || "Employee could not be unassigned.");
  }
}

function openDispatchAssignEquipmentDialog(jobId) {
  const dialog = document.querySelector("#dispatchAssignEquipmentDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.jobId.value = jobId;
  const select = form.elements.assetTag;
  select.innerHTML = [
    `<option value="">Select equipment</option>`,
    ...getEquipmentStatus().map((asset) => `<option value="${escapeAttribute(asset.assetTag)}">${escapeHtml(asset.assetTag)} - ${escapeHtml(asset.equipment)} (${escapeHtml(asset.status)})</option>`),
  ].join("");
  dialog.showModal();
}

async function saveDispatchAssignEquipment(form) {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const assetTag = data.get("assetTag").toString();
  const asset = findEquipmentAssetByTag(assetTag);
  if (!asset) {
    showToast("Select an equipment asset to assign.");
    return;
  }
  try {
    await saveBackendRecord("jobResources", {
      id: makeId("resource"),
      jobId,
      type: "Equipment",
      name: asset.equipment,
      assetTag: asset.assetTag,
      inventoryItemId: "",
      quantity: 1,
      unit: "",
      status: "Reserved",
    });
    closeDialogs();
    render();
    showToast("Equipment assigned to job.");
  } catch (error) {
    showToast(error.message || "Equipment could not be assigned.");
  }
}

function openDispatchAssignMaterialDialog(jobId) {
  const dialog = document.querySelector("#dispatchAssignMaterialDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.jobId.value = jobId;
  const select = form.elements.inventoryItemId;
  select.innerHTML = [
    `<option value="">Select material</option>`,
    ...getInventoryItems().map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.materialType)} (${item.onHand} ${escapeHtml(item.unit)} on hand)</option>`),
  ].join("");
  dialog.showModal();
}

async function saveDispatchAssignMaterial(form) {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const inventoryItemId = data.get("inventoryItemId").toString();
  const item = findInventoryItem(inventoryItemId);
  if (!item) {
    showToast("Select a material to assign.");
    return;
  }
  const quantity = Number(data.get("quantity") || 0);
  if (!(quantity > 0)) {
    showToast("Enter a quantity greater than zero.");
    return;
  }
  try {
    await saveBackendRecord("jobResources", {
      id: makeId("resource"),
      jobId,
      type: "Material",
      name: item.materialType,
      assetTag: "",
      inventoryItemId: item.id,
      quantity,
      unit: item.unit,
      status: "Reserved",
    });
    closeDialogs();
    render();
    showToast("Material assigned to job.");
  } catch (error) {
    showToast(error.message || "Material could not be assigned.");
  }
}

async function removeJobResource(resourceId) {
  const resource = (state.backend.jobResources || []).find((item) => item.id === resourceId);
  if (!resource) return;
  try {
    await saveBackendRecord("jobResources", { ...resource, status: "Removed" });
    render();
    showToast("Resource removed.");
  } catch (error) {
    showToast(error.message || "Resource could not be removed.");
  }
}

async function advanceDispatchJob(jobId, { silent = false } = {}) {
  const job = findDispatchJob(jobId);
  const transition = job ? getNextDispatchTransition(job.status) : null;
  if (!job || !transition) return;
  const readiness = getJobReadiness(job);
  if (transition.status === "dispatched" && readiness.status === "Blocked") {
    showToast("Resolve blocking readiness checks before dispatching this job.");
    return;
  }
  const gate = getWorkPlanGate(job);
  if (gate.blocked) {
    showToast(gate.reason);
    return;
  }

  try {
    const occurredAt = new Date().toISOString();
    await saveBackendRecord(
      "dispatchJobs",
      {
        ...job,
        status: transition.status,
        dispatchStatus: transition.dispatchStatus,
        officeReviewStatus: transition.status === "office_review" ? "In review" : transition.status === "closed" ? "Closed" : job.officeReviewStatus,
        completionPercent: Math.max(Number(job.completionPercent || 0), transition.completionPercent),
        updatedAt: occurredAt,
      },
      { refresh: false },
    );
    // Logged here rather than in the click handler: this function is the only place a transition
    // actually commits, it bails out earlier when the gate blocks, and the Front Line status-action
    // path calls it silently. Timer tasks measure elapsed time from these stamps.
    await saveBackendRecord("jobStatusEvents", {
      id: makeId("job-status-event"),
      jobId: job.id,
      fromStatus: job.status,
      toStatus: transition.status,
      occurredAt,
      by: state.frontlineSession ? findEmployee(state.frontlineSession.employeeId)?.displayName || "Front Line" : state.currentUser?.name || "Local user",
    });
    if (!silent) {
      render();
      showToast(`Job moved to ${formatDispatchStatus(transition.status)}.`);
    }
  } catch (error) {
    showToast(error.message || "Job status could not be updated.");
  }
}

async function saveInvoice(form) {
  const data = new FormData(form);
  const job = findProject(data.get("projectId").toString());
  const account = job ? findAccount(job.accountId) : null;
  try {
    await saveBackendRecord("invoices", {
      id: data.get("id").toString(),
      projectId: data.get("projectId").toString(),
      customer: account?.name || "",
      quotedAmount: Number(data.get("quotedAmount")),
      invoiceAmount: Number(data.get("invoiceAmount")),
      status: data.get("status").toString(),
      dueDate: data.get("dueDate").toString(),
      notes: data.get("notes").toString().trim(),
      qboStatus: "Not exported",
    });
    closeDialogs();
    render();
    showToast("Invoice saved on the backend.");
  } catch (error) {
    showToast(error.message || "Invoice could not be saved.");
  }
}

async function exportInvoiceToQbo(invoiceId) {
  try {
    await apiRequest("/api/qbo/export", {
      method: "POST",
      body: JSON.stringify({ invoiceId }),
    });
    await refreshBackendState();
    render();
    showToast("QuickBooks export queued. Connect QBO credentials to send it live.");
  } catch (error) {
    showToast(error.message || "QuickBooks export failed.");
  }
}

async function persistActivity(fields, toastMessage) {
  const activity = buildCoreActivityRecord({
    id: makeId("act"),
    createdAt: new Date().toISOString(),
    owner: state.currentUser?.name || "Local user",
    ...fields,
  });

  await saveBackendRecord("activities", activity, { refresh: false });
  if (activity.contactId && activity.opportunityId) {
    await linkContactToOpportunity(activity.contactId, activity.opportunityId);
  }
  if (activity.accountId && activity.status === "Completed" && activity.activityType !== "Task") {
    const account = findAccount(activity.accountId);
    if (account) {
      await saveBackendRecord("accounts", { ...account, lastContact: activity.activityDate }, { refresh: false });
    }
  }
  if (activity.activityType === "Task") {
    await saveBackendRecord(
      "tasks",
      buildCoreTaskRecord({
        id: makeId("task"),
        accountId: activity.accountId,
        contactId: activity.contactId,
        opportunityId: activity.opportunityId,
        activityId: activity.id,
        title: activity.subject,
        dueDate: activity.dueDate || activity.activityDate,
        owner: activity.owner,
        type: "Activity task",
        priority: activity.priority || "Medium",
        status: activity.status === "Completed" ? "Complete" : "Open",
      }),
      { refresh: false },
    );
  }
  await queueChange("Activity", "created", activity);
  closeDialogs();
  await refreshState();
  render();
  showToast(toastMessage || `${activity.activityType} activity saved.`);
  return activity;
}

async function saveActivity(form) {
  const data = new FormData(form);
  const selectedContact = findContact(data.get("contactId")?.toString());
  const selectedOpportunity = findOpportunity(data.get("opportunityId")?.toString());
  const activityType = data.get("activityType")?.toString() || "Task";
  const activityDate = data.get("activityDate")?.toString() || todayIso();
  const status = data.get("status")?.toString() || (activityType === "Task" ? "Open" : "Completed");
  const accountId = data.get("accountId")?.toString() || selectedContact?.accountId || selectedOpportunity?.accountId || "";

  await persistActivity({
    accountId,
    contactId: selectedContact?.id || "",
    opportunityId: selectedOpportunity?.id || "",
    activityType,
    subject: data.get("subject")?.toString().trim() || `${activityType} activity`,
    body: data.get("body")?.toString().trim() || data.get("note")?.toString().trim() || "",
    direction: data.get("direction")?.toString() || "Outbound",
    channel: data.get("channel")?.toString().trim() || getDefaultActivityChannel(activityType),
    activityDate,
    dueDate: data.get("dueDate")?.toString() || (activityType === "Task" ? activityDate : ""),
    status,
  });
}

async function saveNote(form) {
  await saveActivity(form);
}

async function saveQuickNote(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const contactId = data.get("contactId").toString();
  await persistActivity(
    {
      accountId,
      contactId,
      opportunityId: data.get("opportunityId").toString(),
      activityType: "Note",
      subject: data.get("subject").toString().trim(),
      body: data.get("body").toString().trim(),
      direction: "Internal",
      channel: "Note",
      activityDate: todayIso(),
      status: "Completed",
    },
    "Quick note saved.",
  );
}

async function saveActivityMeeting(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const meetingFormat = data.get("meetingFormat").toString();
  await persistActivity(
    {
      accountId,
      contactId: data.get("contactId").toString(),
      opportunityId: data.get("opportunityId").toString(),
      activityType: "Meeting",
      subject: data.get("subject").toString().trim(),
      body: data.get("body").toString().trim(),
      direction: "Internal",
      channel: meetingFormat === "Online" ? data.get("meetingPlatform").toString() : "In person",
      activityDate: data.get("activityDate").toString(),
      meetingTime: data.get("meetingTime").toString(),
      meetingFormat,
      meetingPlatform: meetingFormat === "Online" ? data.get("meetingPlatform").toString() : "",
      meetingLink: meetingFormat === "Online" ? data.get("meetingLink").toString().trim() : "",
      meetingLocation: meetingFormat === "Offline" ? data.get("meetingLocation").toString().trim() : "",
      status: data.get("status").toString(),
    },
    "Meeting saved.",
  );
}

async function saveActivityCall(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  await persistActivity(
    {
      accountId,
      contactId: data.get("contactId").toString(),
      opportunityId: data.get("opportunityId").toString(),
      activityType: "Call",
      subject: data.get("subject").toString().trim(),
      body: data.get("body").toString().trim(),
      direction: data.get("direction").toString(),
      channel: "Phone",
      phoneNumber: data.get("phoneNumber").toString().trim(),
      activityDate: data.get("activityDate").toString(),
      status: data.get("status").toString(),
    },
    "Call saved.",
  );
}

async function saveActivityEmail(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  await persistActivity(
    {
      accountId,
      contactId: data.get("contactId").toString(),
      opportunityId: data.get("opportunityId").toString(),
      activityType: "Email",
      subject: data.get("subject").toString().trim(),
      body: data.get("body").toString().trim(),
      direction: data.get("direction").toString(),
      channel: "Email",
      emailAddress: data.get("emailAddress").toString().trim(),
      activityDate: data.get("activityDate").toString(),
      status: "Completed",
    },
    "Email saved.",
  );
}

async function saveActivityTask(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const dueDate = data.get("dueDate").toString();
  await persistActivity(
    {
      accountId,
      contactId: data.get("contactId").toString(),
      opportunityId: data.get("opportunityId").toString(),
      activityType: "Task",
      subject: data.get("subject").toString().trim(),
      body: data.get("body").toString().trim(),
      direction: "Internal",
      channel: "Task",
      activityDate: dueDate,
      dueDate,
      priority: data.get("priority").toString(),
      status: data.get("status").toString(),
    },
    "Task saved.",
  );
}

async function linkContactToOpportunity(contactId, opportunityId) {
  const contact = findContact(contactId);
  if (!contact || contact.opportunityIds?.includes(opportunityId)) return;
  // Every caller refreshes afterwards, so skip the per-write backend refetch.
  await saveBackendRecord(
    "contacts",
    { ...contact, opportunityIds: [...(contact.opportunityIds || []), opportunityId] },
    { refresh: false },
  );
}

async function saveIdentityConfig(form) {
  const data = new FormData(form);
  const config = {
    tenantId: data.get("tenantId").toString().trim(),
    clientId: data.get("clientId").toString().trim(),
    scopes: data.get("scopes").toString().trim() || defaultIdentityConfig.scopes,
  };

  await putSetting("identityConfig", config);
  await putSetting("authError", "");
  await refreshState();
  render();
  showToast("Microsoft identity configuration saved.");
}

async function advanceOpportunity(id) {
  const opportunity = state.opportunities.find((item) => item.id === id);
  if (!opportunity) return;

  const currentIndex = STAGES.indexOf(opportunity.stage);
  const nextStage = STAGES[Math.min(currentIndex + 1, STAGES.length - 1)];
  await moveOpportunityToStage(id, nextStage);
}

function describeMissingFields(missingFields) {
  return missingFields.map((field) => field.label).join(", ");
}

function flashStageBlockBanner() {
  const banner = document.querySelector("[data-stage-block-banner]");
  if (!banner) return;
  banner.scrollIntoView({ behavior: "smooth", block: "center" });
  banner.classList.remove("stage-block-flash");
  // Force reflow so the animation restarts if it's already mid-flash.
  void banner.offsetWidth;
  banner.classList.add("stage-block-flash");
  setTimeout(() => banner.classList.remove("stage-block-flash"), 1400);
}

async function moveOpportunityToStage(id, nextStage) {
  const opportunity = state.opportunities.find((item) => item.id === id);
  if (!opportunity || !STAGES.includes(nextStage) || opportunity.stage === nextStage) return;
  const previousStage = opportunity.stage;

  const missingFields = getMissingStageFields(opportunity, nextStage);
  if (missingFields.length) {
    showToast(`Can't advance to ${nextStage} — missing: ${describeMissingFields(missingFields)}.`);
    flashStageBlockBanner();
    return;
  }

  const updated = {
    ...opportunity,
    stage: nextStage,
    dealStage: nextStage,
    probability: STAGE_PROBABILITY[nextStage],
    closeProbability: STAGE_PROBABILITY[nextStage],
    updatedAt: new Date().toISOString(),
  };

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Opportunity could not be moved.");
    return;
  }
  await queueChange("Opportunity", `moved to ${nextStage}`, updated);
  await refreshState();
  render();
  showToast(`Moved to ${nextStage}.`);
  await maybeOfferProjectForWonOpportunity(previousStage, updated);
}

function mapServiceTypeToServiceCategory(serviceType) {
  const map = {
    "Emergency Spill Response": "ER",
    "Environmental Sampling": "Sampling",
    "Scheduled Environmental Service": "Scheduled",
    "Remediation Field Work": "Remediation",
    "Asbestos Abatement": "Abatement",
  };
  return map[serviceType] || "Scheduled";
}

function mapServiceTypeToJobClass(serviceType) {
  if (serviceType === "Emergency Spill Response") return "Emergency Response";
  if (serviceType === "Remediation Field Work") return "Multi-Stage Remediation";
  return "Scheduled Work";
}

function mapJobClassToServiceCategory(jobClass) {
  if (jobClass === "Emergency Response") return "ER";
  if (jobClass === "Multi-Stage Remediation") return "Remediation";
  return "Scheduled";
}

async function maybeOfferProjectForWonOpportunity(previousStage, opportunity) {
  if (previousStage === "Won" || opportunity.stage !== "Won") return;
  const core = getCoreOpportunity(opportunity);
  const shouldCreate = window.confirm(
    `"${core.opportunityName}" is now Won. Create a project for it? You'll be able to push job requests to dispatch from the project once it exists.`,
  );
  if (!shouldCreate) return;
  if (!canAccessView("project-detail")) {
    showToast("Your current role cannot open Operations projects. Ask operations to create the project.");
    return;
  }
  openProjectFromOpportunityDialog(opportunity.id);
}

function openProjectFromOpportunityDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const core = getCoreOpportunity(opportunity);
  const dialog = document.querySelector("#projectCreateDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.opportunityId.value = opportunity.id;
  form.elements.accountId.value = core.accountId;
  form.elements.name.value = core.opportunityName;
  form.elements.jobClass.value = mapServiceTypeToJobClass(core.serviceType);
  populateEmployeeSelect(dialog, "projectManagerEmployeeId", "Select project manager");
  form.elements.startDate.value = todayIso();
  const closeDate = core.estimatedCloseDate && parseDate(core.estimatedCloseDate) > parseDate(todayIso()) ? core.estimatedCloseDate : addDays(30);
  form.elements.targetDate.value = closeDate;
  form.elements.budget.value = core.amount || 0;
  form.elements.projectStage.value = "Intake";
  dialog.showModal();
}

async function saveProjectFromOpportunity(form) {
  const data = new FormData(form);
  const account = findAccount(data.get("accountId").toString());
  if (!account) {
    showToast("That account is no longer available.");
    return;
  }
  const projectManagerEmployeeId = data.get("projectManagerEmployeeId").toString();
  const projectManager = getEmployees().find((employee) => employee.id === projectManagerEmployeeId)?.displayName || "";
  const projectStage = data.get("projectStage").toString() || "Intake";
  const job = buildCoreProjectRecord({
    id: makeId("proj"),
    accountId: account.id,
    locationId: locationsForAccount(account.id)[0]?.id || "",
    opportunityId: data.get("opportunityId").toString(),
    contactIds: contactsForAccount(account.id).map((contact) => contact.id),
    name: data.get("name").toString().trim(),
    jobClass: data.get("jobClass").toString(),
    status: "Pre-mobilization",
    activePhase: projectStage,
    projectManagerEmployeeId,
    projectManager,
    salesLead: account.owner,
    startDate: data.get("startDate").toString(),
    targetDate: data.get("targetDate").toString(),
    budget: Number(data.get("budget") || 0),
    notToExceed: "",
    marginWatch: "New project created from a won opportunity.",
    projectStage,
    siteWalkStatus: "Incomplete",
    sitePhotoRefs: [],
  });

  await saveBackendRecord("projects", job, { refresh: false });
  await queueChange("Project", "created", job);
  closeDialogs();
  await refreshState();
  if (canAccessView("project-detail")) {
    state.selectedProjectId = job.id;
    state.view = "project-detail";
    showToast(`Project "${job.name}" created. Push a job request to dispatch when ready.`);
  } else {
    showToast(`Project "${job.name}" created. Ask operations to continue setup.`);
  }
  render();
}

function openProjectIntakeDialog(jobId) {
  const job = findProject(jobId);
  if (!job) return;
  const dialog = document.querySelector("#projectIntakeDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.id.value = job.id;
  form.elements.generatorName.value = job.generatorName || "";
  form.elements.generatorSiteName.value = job.generatorSiteName || "";
  form.elements.generatorContactName.value = job.generatorContactName || "";
  form.elements.generatorContactPhone.value = job.generatorContactPhone || "";
  form.elements.epaId.value = job.epaId || "";
  form.elements.tceqId.value = job.tceqId || "";
  form.elements.insuranceContact.value = job.insuranceContact || "";
  form.elements.insuranceCarrier.value = job.insuranceCarrier || "";
  form.elements.claimNumber.value = job.claimNumber || "";
  form.elements.serviceProfile.value = job.serviceProfile || "";
  form.elements.jobClass.value = job.jobClass || "Scheduled Work";
  form.elements.siteWalkStatus.value = job.siteWalkStatus || "Incomplete";
  form.elements.sitePhotos.value = (job.sitePhotoRefs || [])
    .map((photo) => (photo.note ? `${photo.caption} | ${photo.note}` : photo.caption))
    .join("\n");
  dialog.showModal();
}

async function saveProjectIntake(form) {
  const data = new FormData(form);
  const job = findProject(data.get("id").toString());
  if (!job) return;
  const sitePhotoRefs = data
    .get("sitePhotos")
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [caption, ...noteParts] = line.split("|");
      return { caption: caption.trim(), note: noteParts.join("|").trim() };
    })
    .filter((photo) => photo.caption);

  const updated = {
    ...job,
    generatorName: data.get("generatorName").toString().trim(),
    generatorSiteName: data.get("generatorSiteName").toString().trim(),
    generatorContactName: data.get("generatorContactName").toString().trim(),
    generatorContactPhone: data.get("generatorContactPhone").toString().trim(),
    epaId: data.get("epaId").toString().trim(),
    tceqId: data.get("tceqId").toString().trim(),
    insuranceContact: data.get("insuranceContact").toString().trim(),
    insuranceCarrier: data.get("insuranceCarrier").toString().trim(),
    claimNumber: data.get("claimNumber").toString().trim(),
    serviceProfile: data.get("serviceProfile").toString().trim(),
    jobClass: data.get("jobClass").toString(),
    siteWalkStatus: data.get("siteWalkStatus").toString(),
    sitePhotoRefs,
  };

  try {
    await saveBackendRecord("projects", updated, { refresh: false });
    await queueChange("Project", "intake updated", updated);
    closeDialogs();
    await refreshState();
    render();
    showToast("Intake details saved.");
  } catch (error) {
    showToast(error.message || "Intake details could not be saved.");
  }
}

async function completeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  const updated = {
    ...task,
    status: "Complete",
    completedAt: new Date().toISOString(),
  };

  await saveBackendRecord("tasks", updated, { refresh: false });
  await queueChange("Task", "completed", updated);
  await refreshState();
  render();
  showToast("Task completed.");
}

async function queueChange(entity, action, payload) {
  await putRecord("syncQueue", {
    id: makeId("sync"),
    entity,
    action,
    payload,
    status: "Pending",
    createdAt: new Date().toISOString(),
  });
}

async function simulateSync() {
  const queue = pendingQueue();
  if (!state.online) {
    showToast("Still offline. Changes remain queued.");
    return;
  }

  await Promise.all(
    queue.map((item) =>
      putRecord("syncQueue", {
        ...item,
        status: "Synced",
        syncedAt: new Date().toISOString(),
      }),
    ),
  );
  await refreshState();
  render();
  showToast(queue.length ? "Queued edits marked synced for the prototype." : "Nothing is waiting to sync.");
}

async function useDemoUser() {
  await putSetting("currentUser", demoUser);
  await refreshState();
  render();
  showToast("Demo user restored.");
}

async function setDemoRole(profile) {
  const user = demoUsers[profile];
  if (!user) return;
  await putSetting("currentUser", {
    ...user,
    signedInAt: new Date().toISOString(),
  });
  await refreshState();
  render();
  showToast(`${user.role} role loaded.`);
}

async function signOut() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  await putSetting("currentUser", {
    name: "Offline user",
    email: "",
    role: "Local",
    source: "Offline profile",
    signedInAt: new Date().toISOString(),
  });
  await refreshState();
  render();
  showToast("Local user profile cleared.");
}

function openSettingsDialog() {
  if (!settingsDialog) return;
  const settings = {
    ...defaultPlatformSettings,
    ...state.platformSettings,
  };
  const form = settingsDialog.querySelector("form");
  form.reset();
  form.elements.theme.value = settings.theme;
  form.elements.density.value = settings.density;
  form.elements.gpsMode.value = settings.gpsMode;
  form.elements.gpsRefresh.value = settings.gpsRefresh;
  form.elements.gpsAccuracy.value = settings.gpsAccuracy;
  form.elements.geofenceAlerts.checked = Boolean(settings.geofenceAlerts);
  form.elements.roleProfile.value = getCurrentRoleProfile();
  form.elements.schedulerBlockMode.value = settings.schedulerBlockMode;
  form.elements.qboMode.value = settings.qboMode;
  form.elements.inventoryAlertMode.value = settings.inventoryAlertMode;
  settingsDialog.showModal();
}

async function savePlatformSettings(form) {
  const data = new FormData(form);
  const roleProfile = data.get("roleProfile").toString();
  const settings = {
    ...defaultPlatformSettings,
    ...state.platformSettings,
    theme: data.get("theme").toString(),
    density: data.get("density").toString(),
    gpsMode: data.get("gpsMode").toString(),
    gpsRefresh: data.get("gpsRefresh").toString(),
    gpsAccuracy: data.get("gpsAccuracy").toString(),
    geofenceAlerts: form.elements.geofenceAlerts.checked,
    roleProfile,
    schedulerBlockMode: data.get("schedulerBlockMode").toString(),
    qboMode: data.get("qboMode").toString(),
    inventoryAlertMode: data.get("inventoryAlertMode").toString(),
  };

  await putSetting("platformSettings", settings);
  if (demoUsers[roleProfile]) {
    await putSetting("currentUser", {
      ...demoUsers[roleProfile],
      signedInAt: new Date().toISOString(),
    });
  }

  closeDialogs();
  await refreshState();
  render();
  showToast("Settings saved.");
}

function getCurrentRoleProfile() {
  const currentRole = state.currentUser?.role || "";
  const matchingProfile = Object.entries(demoUsers).find(([, user]) => user.role === currentRole);
  return matchingProfile?.[0] || state.platformSettings?.roleProfile || "office";
}

function openOpportunityDialog(accountId = "", opportunityId = "") {
  const dialog = document.querySelector("#opportunityDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateAccountSelect(dialog);
  const opportunity = opportunityId ? findOpportunity(opportunityId) : null;
  const startingStageField = dialog.querySelector(".opportunity-starting-stage");
  if (opportunity) {
    const core = getCoreOpportunity(opportunity);
    form.elements.id.value = core.id;
    form.elements.accountId.value = core.accountId;
    form.elements.name.value = core.opportunityName;
    form.elements.value.value = core.amount;
    form.elements.closeDate.value = core.estimatedCloseDate || addDays(30);
    form.elements.serviceType.value = core.serviceType || "Scheduled Environmental Service";
    form.elements.status.value = core.status === "Lost" ? "Lost" : "Open";
    form.elements.nextStep.value = core.nextStep;
    if (startingStageField) startingStageField.hidden = true;
  } else {
    form.elements.id.value = "";
    if (accountId) form.elements.accountId.value = accountId;
    form.elements.closeDate.value = addDays(30);
    if (startingStageField) startingStageField.hidden = false;
  }
  dialog.showModal();
}

function populateLocationSelect(root, accountId = "") {
  root.querySelectorAll("select[name='locationId']").forEach((select) => {
    const locations = accountId ? locationsForAccount(accountId) : [];
    select.innerHTML = [
      `<option value="">No facility selected</option>`,
      ...locations.map((location) => `<option value="${escapeAttribute(location.id)}">${escapeHtml(location.name)}</option>`),
    ].join("");
  });
}

function openOpportunityLeadDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityLeadDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const core = getCoreOpportunity(opportunity);
  populateLocationSelect(dialog, core.accountId);
  populateContactSelect(dialog, core.accountId);
  form.elements.id.value = core.id;
  form.elements.contactId.value = contactsForOpportunity(opportunity.id)[0]?.id || "";
  form.elements.locationId.value = opportunity.locationId || "";
  form.elements.industry.value = core.industry || "";
  form.elements.contaminationNotes.value = opportunity.contaminationNotes || "";
  form.elements.originatingLeadId.value = core.originatingLeadId || "";
  form.elements.sourceCampaign.value = core.sourceCampaign || "";
  form.elements.description.value = core.description || "";
  form.elements.currentSituation.value = core.currentSituation || "";
  dialog.showModal();
}

async function saveOpportunityLead(form) {
  const data = new FormData(form);
  const opportunity = findOpportunity(data.get("id").toString());
  if (!opportunity) return;
  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    locationId: data.get("locationId").toString(),
    industry: data.get("industry").toString().trim(),
    contaminationNotes: data.get("contaminationNotes").toString().trim(),
    originatingLeadId: data.get("originatingLeadId").toString().trim(),
    sourceCampaign: data.get("sourceCampaign").toString().trim(),
    description: data.get("description").toString().trim(),
    currentSituation: data.get("currentSituation").toString().trim(),
    updatedAt: new Date().toISOString(),
  });

  const contactId = data.get("contactId").toString();

  try {
    await saveBackendRecord("opportunities", updated);
    if (contactId) await linkContactToOpportunity(contactId, updated.id);
  } catch (error) {
    showToast(error.message || "Lead details could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Lead details saved.");
}

function openOpportunityQualifyDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityQualifyDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const core = getCoreOpportunity(opportunity);
  form.elements.id.value = core.id;
  form.elements.purchaseTimeframe.value = core.purchaseTimeframe || "";
  form.elements.budgetAmount.value = core.budgetAmount || "";
  form.elements.purchaseProcess.value = core.purchaseProcess || "";
  form.elements.decisionMakerFound.value = opportunity.decisionMakerFound || "Not complete";
  form.elements.captureSummary.value = opportunity.captureSummary || "";
  dialog.showModal();
}

async function saveOpportunityQualify(form) {
  const data = new FormData(form);
  const opportunity = findOpportunity(data.get("id").toString());
  if (!opportunity) return;
  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    purchaseTimeframe: data.get("purchaseTimeframe").toString(),
    budgetAmount: Number(data.get("budgetAmount") || 0),
    purchaseProcess: data.get("purchaseProcess").toString(),
    decisionMakerFound: data.get("decisionMakerFound").toString(),
    captureSummary: data.get("captureSummary").toString().trim(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Qualification could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Qualification saved.");
}

function openOpportunityDevelopDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityDevelopDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const core = getCoreOpportunity(opportunity);
  form.elements.id.value = core.id;
  form.elements.customerNeed.value = core.customerNeed || "";
  form.elements.proposedSolution.value = core.proposedSolution || "";
  form.elements.siteWalkStatus.value = opportunity.siteWalkStatus || "Incomplete";
  dialog.showModal();
}

async function saveOpportunityDevelop(form) {
  const data = new FormData(form);
  const opportunity = findOpportunity(data.get("id").toString());
  if (!opportunity) return;
  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    customerNeed: data.get("customerNeed").toString().trim(),
    proposedSolution: data.get("proposedSolution").toString().trim(),
    siteWalkStatus: data.get("siteWalkStatus").toString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Develop details could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Develop details saved.");
}

function openOpportunityStakeholderDialog(opportunityId, entryId = "") {
  const dialog = document.querySelector("#opportunityStakeholderDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.opportunityId.value = opportunityId;
  const opportunity = findOpportunity(opportunityId);
  populateContactSelect(dialog, opportunity?.accountId || "");
  const entry = entryId ? stakeholdersForOpportunity(opportunityId).find((item) => item.id === entryId) : null;
  if (entry) {
    form.elements.id.value = entry.id;
    form.elements.contactId.value = entry.contactId;
    form.elements.relationshipRole.value = entry.relationshipRole || "";
    form.elements.influenceLevel.value = entry.influenceLevel || "";
    form.elements.isPrimary.checked = Boolean(entry.isPrimary);
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveOpportunityStakeholder(form) {
  const data = new FormData(form);
  const contactId = data.get("contactId").toString();
  if (!contactId) {
    showToast("Select a contact to add as a stakeholder.");
    return;
  }
  const opportunityId = data.get("opportunityId").toString();
  const record = {
    id: data.get("id").toString() || makeId("opp-contact"),
    opportunityId,
    contactId,
    accountId: findOpportunity(opportunityId)?.accountId || "",
    relationshipRole: data.get("relationshipRole").toString().trim(),
    influenceLevel: data.get("influenceLevel").toString(),
    isPrimary: form.elements.isPrimary.checked,
  };
  try {
    await saveBackendRecord("opportunityContacts", record);
    await linkContactToOpportunity(contactId, opportunityId);
    await refreshState();
    closeDialogs();
    render();
    showToast("Stakeholder saved.");
  } catch (error) {
    showToast(error.message || "Stakeholder could not be saved.");
  }
}

async function removeOpportunityStakeholder(id) {
  if (!confirm("Remove this stakeholder?")) return;
  const record = (state.backend.opportunityContacts || []).find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("opportunityContacts", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Stakeholder removed.");
  } catch (error) {
    showToast(error.message || "Stakeholder could not be removed.");
  }
}

function openOpportunityCompetitorDialog(opportunityId, entryId = "") {
  const dialog = document.querySelector("#opportunityCompetitorDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.opportunityId.value = opportunityId;
  form.elements.competitorId.innerHTML = [
    `<option value="">Select a competitor</option>`,
    ...(state.backend.competitors || []).map((competitor) => `<option value="${escapeAttribute(competitor.id)}">${escapeHtml(competitor.name)}</option>`),
  ].join("");
  const entry = entryId ? competitorsForOpportunity(opportunityId).find((item) => item.id === entryId) : null;
  if (entry) {
    form.elements.id.value = entry.id;
    form.elements.competitorId.value = entry.competitorId;
    form.elements.name.value = entry.name || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveOpportunityCompetitor(form) {
  const data = new FormData(form);
  const opportunityId = data.get("opportunityId").toString();
  let competitorId = data.get("competitorId").toString();
  const newCompetitorName = data.get("newCompetitorName").toString().trim();

  try {
    if (newCompetitorName) {
      const competitor = {
        id: makeId("competitor"),
        name: newCompetitorName,
        stateCode: "Active",
        statusCode: "Active",
      };
      await saveBackendRecord("competitors", competitor);
      competitorId = competitor.id;
    }
    if (!competitorId) {
      showToast("Choose an existing competitor or add a new one.");
      return;
    }
    const record = {
      id: data.get("id").toString() || makeId("opp-competitor"),
      opportunityId,
      competitorId,
      name: data.get("name").toString().trim(),
    };
    await saveBackendRecord("opportunityCompetitors", record);
    closeDialogs();
    render();
    showToast("Competitor saved.");
  } catch (error) {
    showToast(error.message || "Competitor could not be saved.");
  }
}

async function removeOpportunityCompetitor(id) {
  if (!confirm("Remove this competitor?")) return;
  const record = (state.backend.opportunityCompetitors || []).find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("opportunityCompetitors", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Competitor removed.");
  } catch (error) {
    showToast(error.message || "Competitor could not be removed.");
  }
}

function populateVendorAccountSelect(root) {
  root.querySelectorAll("select[name='vendorAccountId']").forEach((select) => {
    const vendorAccountIds = new Set(getVendorProfiles().map((profile) => profile.accountId));
    const vendorAccounts = state.accounts.filter((account) => vendorAccountIds.has(account.id));
    select.innerHTML = [
      `<option value="">Select a vendor</option>`,
      ...vendorAccounts.map((account) => `<option value="${escapeAttribute(account.id)}">${escapeHtml(account.name)}</option>`),
    ].join("");
  });
}

function populateVendorContactSelect(root, vendorAccountId) {
  root.querySelectorAll("select[name='vendorContactId']").forEach((select) => {
    const contacts = vendorAccountId ? contactsForAccount(vendorAccountId) : [];
    select.innerHTML = [
      `<option value="">Select a contact</option>`,
      ...contacts.map((contact) => `<option value="${escapeAttribute(contact.id)}">${escapeHtml(contact.name)}</option>`),
    ].join("");
  });
}

function toggleOpportunityAssignmentTypeFields(type) {
  const dialog = document.querySelector("#opportunityAssignmentDialog");
  const internalField = dialog.querySelector("#opportunityAssignmentInternalField");
  const externalField = dialog.querySelector("#opportunityAssignmentExternalField");
  const vendorFields = dialog.querySelector("#opportunityAssignmentVendorFields");
  if (internalField) internalField.hidden = type !== "Internal";
  if (externalField) externalField.hidden = type !== "External";
  if (vendorFields) vendorFields.hidden = type !== "Vendor";
}

function openOpportunityAssignmentDialog(opportunityId, purpose = "Sales", entryId = "") {
  const dialog = document.querySelector("#opportunityAssignmentDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.opportunityId.value = opportunityId;
  const opportunity = findOpportunity(opportunityId);
  populateEmployeeSelect(dialog, "employeeId");
  populateContactSelect(dialog, opportunity?.accountId || "");
  populateVendorAccountSelect(dialog);
  populateVendorContactSelect(dialog, "");
  const entry = entryId ? assignmentsForOpportunity(opportunityId).find((item) => item.id === entryId) : null;
  if (entry) {
    form.elements.id.value = entry.id;
    form.elements.purpose.value = entry.purpose || purpose;
    form.elements.type.value = entry.type || "Internal";
    if (entry.type === "External") {
      form.elements.contactId.value = entry.contactId || "";
    } else if (entry.type === "Vendor") {
      populateVendorContactSelect(dialog, entry.vendorAccountId || "");
      form.elements.vendorAccountId.value = entry.vendorAccountId || "";
      form.elements.vendorContactId.value = entry.vendorContactId || "";
    } else {
      form.elements.employeeId.value = entry.employeeId || "";
    }
    form.elements.assignedRole.value = entry.assignedRole || "";
    form.elements.status.value = entry.status || "Invited";
    form.elements.notes.value = entry.notes || "";
  } else {
    form.elements.id.value = "";
    form.elements.purpose.value = purpose;
    form.elements.type.value = "Internal";
  }
  toggleOpportunityAssignmentTypeFields(form.elements.type.value);
  dialog.showModal();
}

async function saveOpportunityAssignment(form) {
  const data = new FormData(form);
  const type = data.get("type").toString();
  let name = "";
  let employeeId = "";
  let contactId = "";
  let vendorAccountId = "";
  let vendorContactId = "";
  if (type === "External") {
    contactId = data.get("contactId").toString();
    name = findContact(contactId)?.name || "";
  } else if (type === "Vendor") {
    vendorAccountId = data.get("vendorAccountId").toString();
    vendorContactId = data.get("vendorContactId").toString();
    name = [findContact(vendorContactId)?.name, findAccount(vendorAccountId)?.name].filter(Boolean).join(" - ");
  } else {
    employeeId = data.get("employeeId").toString();
    name = getEmployees().find((employee) => employee.id === employeeId)?.displayName || "";
  }
  if (!name) {
    showToast("Select a name for this team member.");
    return;
  }
  const record = {
    id: data.get("id").toString() || makeId("opp-assignment"),
    opportunityId: data.get("opportunityId").toString(),
    purpose: data.get("purpose").toString(),
    name,
    type,
    employeeId,
    contactId,
    vendorAccountId,
    vendorContactId,
    assignedRole: data.get("assignedRole").toString().trim(),
    status: data.get("status").toString(),
    notes: data.get("notes").toString().trim(),
  };
  try {
    await saveBackendRecord("opportunityAssignments", record);
    closeDialogs();
    render();
    showToast("Team member saved.");
  } catch (error) {
    showToast(error.message || "Team member could not be saved.");
  }
}

async function removeOpportunityAssignment(id) {
  if (!confirm("Remove this team member?")) return;
  const record = (state.backend.opportunityAssignments || []).find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("opportunityAssignments", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Team member removed.");
  } catch (error) {
    showToast(error.message || "Team member could not be removed.");
  }
}

const OPPORTUNITY_NEEDS_LIST_CONFIG = {
  equipment: { field: "equipmentNeeds", title: "Equipment needed" },
  vendor: { field: "vendorNeeds", title: "Vendor / subcontractor needed" },
  resource: { field: "resourceNeeds", title: "Resources needed" },
};

function openOpportunityNeedsListDialog(opportunityId, kind) {
  const config = OPPORTUNITY_NEEDS_LIST_CONFIG[kind];
  const opportunity = findOpportunity(opportunityId);
  if (!config || !opportunity) return;
  const dialog = document.querySelector("#opportunityNeedsListDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.id.value = opportunityId;
  form.elements.kind.value = kind;
  const titleField = dialog.querySelector('[data-role="needs-list-title"]');
  if (titleField) titleField.textContent = config.title;
  const items = opportunity[config.field] || [];
  form.elements.items.value = items.map((item) => (item.note ? `${item.name} | ${item.note}` : item.name)).join("\n");
  dialog.showModal();
}

async function saveOpportunityNeedsList(form) {
  const data = new FormData(form);
  const kind = data.get("kind").toString();
  const config = OPPORTUNITY_NEEDS_LIST_CONFIG[kind];
  const opportunity = findOpportunity(data.get("id").toString());
  if (!config || !opportunity) return;
  const items = data
    .get("items")
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...noteParts] = line.split("|");
      return { name: name.trim(), note: noteParts.join("|").trim() };
    })
    .filter((item) => item.name);

  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    [config.field]: items,
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "List could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast(`${config.title} saved.`);
}

function openOpportunityProposalDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityProposalDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.id.value = opportunity.id;
  form.elements.proposalDevelopedStatus.value = opportunity.proposalDevelopedStatus || "Incomplete";
  form.elements.internalReviewStatus.value = opportunity.internalReviewStatus || "Incomplete";
  form.elements.proposalPresentedStatus.value = opportunity.proposalPresentedStatus || "Incomplete";
  dialog.showModal();
}

async function saveOpportunityProposal(form) {
  const data = new FormData(form);
  const opportunity = findOpportunity(data.get("id").toString());
  if (!opportunity) return;
  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    proposalDevelopedStatus: data.get("proposalDevelopedStatus").toString(),
    internalReviewStatus: data.get("internalReviewStatus").toString(),
    proposalPresentedStatus: data.get("proposalPresentedStatus").toString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Proposal status could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Proposal status saved.");
}

function openOpportunityNegotiationDialog(opportunityId) {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityNegotiationDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.id.value = opportunity.id;
  form.elements.accountPaperworkStatus.value = opportunity.accountPaperworkStatus || "Not started";
  form.elements.quoteSignedStatus.value = opportunity.quoteSignedStatus || "Not started";
  form.elements.workAuthorizationStatus.value = opportunity.workAuthorizationStatus || "Not started";
  dialog.showModal();
}

async function saveOpportunityNegotiation(form) {
  const data = new FormData(form);
  const opportunity = findOpportunity(data.get("id").toString());
  if (!opportunity) return;
  const updated = buildCoreOpportunityRecord({
    ...opportunity,
    accountPaperworkStatus: data.get("accountPaperworkStatus").toString(),
    quoteSignedStatus: data.get("quoteSignedStatus").toString(),
    workAuthorizationStatus: data.get("workAuthorizationStatus").toString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Sign-off status could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Sign-off status saved.");
}

function openOpportunityQuoteDialog(opportunityId, quoteId = "") {
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const dialog = document.querySelector("#opportunityQuoteDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.opportunityId.value = opportunityId;
  const quote = quoteId ? quotesForOpportunity(opportunityId).find((item) => item.id === quoteId) : null;
  if (quote) {
    form.elements.id.value = quote.id;
    form.elements.name.value = quote.name || "";
    form.elements.totalAmount.value = quote.totalAmount || 0;
    form.elements.statusCode.value = quote.statusCode || "Draft";
    form.elements.effectiveFrom.value = quote.effectiveFrom || "";
    form.elements.effectiveTo.value = quote.effectiveTo || "";
  } else {
    form.elements.id.value = "";
    form.elements.name.value = `${getCoreOpportunity(opportunity).opportunityName} quote`;
    form.elements.effectiveFrom.value = todayIso();
  }
  dialog.showModal();
}

async function saveOpportunityQuote(form) {
  const data = new FormData(form);
  const opportunityId = data.get("opportunityId").toString();
  const opportunity = findOpportunity(opportunityId);
  if (!opportunity) return;
  const quoteId = data.get("id").toString() || makeId("quote");
  const quote = {
    id: quoteId,
    opportunityId,
    customerId: opportunity.accountId,
    customerLogicalName: "account",
    name: data.get("name").toString().trim(),
    totalAmount: Number(data.get("totalAmount") || 0),
    totalAmountBase: Number(data.get("totalAmount") || 0),
    statusCode: data.get("statusCode").toString(),
    stateCode: data.get("statusCode").toString() === "Won" || data.get("statusCode").toString() === "Lost" ? "Closed" : "Active",
    effectiveFrom: data.get("effectiveFrom").toString(),
    effectiveTo: data.get("effectiveTo").toString(),
  };

  try {
    await saveBackendRecord("quotes", quote);
    const updated = buildCoreOpportunityRecord({ ...opportunity, quoteId, updatedAt: new Date().toISOString() });
    await saveBackendRecord("opportunities", updated);
  } catch (error) {
    showToast(error.message || "Quote could not be saved.");
    return;
  }
  closeDialogs();
  await refreshState();
  render();
  showToast("Quote saved.");
}

function populateParentAccountSelect(root, excludeAccountId = "") {
  root.querySelectorAll("select[name='parentAccountId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No parent account</option>`,
      ...state.accounts
        .filter((candidate) => candidate.id !== excludeAccountId)
        .map((candidate) => `<option value="${escapeAttribute(candidate.id)}">${escapeHtml(candidate.name)}</option>`),
    ].join("");
  });
}

function openContactPreferencesDialog(accountId = "") {
  const dialog = document.querySelector("#contactPreferencesDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const account = findAccount(accountId);
  if (!account) return;
  form.elements.id.value = account.id;
  form.elements.preferredContactMethod.value = account.preferredContactMethod || "Any";
  form.elements.allowEmails.checked = !account.doNotAllowEmails;
  form.elements.allowBulkEmail.checked = !account.doNotAllowBulkEmail;
  form.elements.allowPhoneCalls.checked = !account.doNotAllowPhoneCalls;
  form.elements.allowFaxes.checked = !account.doNotAllowFaxes;
  form.elements.allowMail.checked = !account.doNotAllowMail;
  form.elements.allowMarketing.checked = !account.doNotAllowMarketing;
  dialog.showModal();
}

async function saveContactPreferences(form) {
  const data = new FormData(form);
  const accountId = data.get("id").toString();
  const account = findAccount(accountId);
  if (!account) return;
  try {
    await saveBackendRecord("accounts", {
      ...account,
      preferredContactMethod: data.get("preferredContactMethod").toString(),
      doNotAllowEmails: !form.elements.allowEmails.checked,
      doNotAllowBulkEmail: !form.elements.allowBulkEmail.checked,
      doNotAllowPhoneCalls: !form.elements.allowPhoneCalls.checked,
      doNotAllowFaxes: !form.elements.allowFaxes.checked,
      doNotAllowMail: !form.elements.allowMail.checked,
      doNotAllowMarketing: !form.elements.allowMarketing.checked,
    });
    await refreshState();
    closeDialogs();
    render();
    showToast("Contact preferences saved.");
  } catch (error) {
    showToast(error.message || "Contact preferences could not be saved.");
  }
}

function openAccountDialog(accountId = "") {
  const dialog = document.querySelector("#accountDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateParentAccountSelect(dialog, accountId);
  populateEmployeeSelect(dialog, "ownerEmployeeId", "Unassigned", [{ value: "system", label: "System" }]);
  const account = accountId ? findAccount(accountId) : null;
  if (account) {
    const core = getCoreAccount(account);
    form.elements.id.value = core.id;
    form.elements.name.value = core.name;
    form.elements.website.value = core.website || "";
    form.elements.accountType.value = core.accountType;
    form.elements.email.value = core.email || "";
    form.elements.phone.value = core.phone || "";
    form.elements.fax.value = account.faxNumber || "";
    form.elements.parentAccountId.value = account.parentAccountId || "";
    form.elements.siteName.value = account.siteName || "";
    form.elements.city.value = core.city || "";
    form.elements.state.value = core.addressOneState || "";
    form.elements.phase.value = account.phase || "Lead";
    form.elements.risk.value = account.risk || core.accountRating || "Low";
    const matchingOwnerEmployee = getEmployees().find((employee) => employee.displayName === core.owner);
    form.elements.ownerEmployeeId.value = core.owner === "System" ? "system" : matchingOwnerEmployee?.id || "";
    form.elements.concern.value = account.concern || "";
    form.elements.businessDescription.value = relationshipExtensionForAccount(account.id)?.businessDescription || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

function openAccountBillingDialog(accountId = "") {
  const dialog = document.querySelector("#accountBillingDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const account = findAccount(accountId);
  if (!account) return;
  form.elements.id.value = account.id;
  form.elements.currency.value = account.currency || "USD";
  form.elements.billingType.value = account.billingType || "";
  form.elements.billingInterval.value = account.billingInterval || "";
  form.elements.creditHold.checked = Boolean(account.creditHold);
  dialog.showModal();
}

function openAccountOwnerDialog(accountId) {
  const dialog = document.querySelector("#accountOwnerDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const account = findAccount(accountId);
  if (!account) return;
  form.elements.id.value = account.id;
  populateEmployeeSelect(dialog, "ownerEmployeeId", "Unassigned", [{ value: "system", label: "System" }]);
  populateContactSelect(dialog, accountId);
  const matchingEmployee = getEmployees().find((employee) => employee.displayName === account.owner);
  form.elements.ownerEmployeeId.value = account.owner === "System" ? "system" : matchingEmployee?.id || "";
  const matchingContact = account.primaryContactId
    ? findContact(account.primaryContactId)
    : contactsForAccount(account.id).find((contact) => contact.name === account.contact);
  form.elements.contactId.value = matchingContact?.id || "";
  dialog.showModal();
}

async function saveAccountOwner(form) {
  const data = new FormData(form);
  const accountId = data.get("id").toString();
  const existing = findAccount(accountId);
  if (!existing) return;
  const ownerEmployeeId = data.get("ownerEmployeeId").toString();
  const ownerName = ownerEmployeeId === "system" ? "System" : ownerEmployeeId ? findEmployee(ownerEmployeeId)?.displayName || "" : "";
  const contactId = data.get("contactId").toString();
  const contact = contactId ? findContact(contactId) : null;
  const account = buildCoreAccountRecord({
    ...existing,
    owner: ownerName || "Unassigned",
    contact: contact?.name || "",
    primaryContactId: contactId || "",
  });
  await saveBackendRecord("accounts", account, { refresh: false });
  await queueChange("Account", "updated", account);
  closeDialogs();
  await refreshState();
  render();
  showToast("Owner and primary contact updated.");
}

async function saveAccountBilling(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = findAccount(existingId);
  if (!existing) return;
  const account = buildCoreAccountRecord({
    ...existing,
    currency: data.get("currency").toString(),
    billingType: data.get("billingType").toString(),
    billingInterval: data.get("billingInterval").toString(),
    creditHold: form.elements.creditHold.checked,
  });
  await saveBackendRecord("accounts", account, { refresh: false });
  await queueChange("Account", "updated", account);
  closeDialogs();
  await refreshState();
  state.selectedAccountId = account.id;
  state.view = "account-detail";
  render();
  showToast("Billing details updated.");
}

function openAccountApDialog(accountId = "") {
  const dialog = document.querySelector("#accountApDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const account = findAccount(accountId);
  if (!account) return;
  form.elements.id.value = account.id;
  form.elements.apPortalUrl.value = account.apPortalUrl || "";
  form.elements.apEmail.value = account.apEmail || "";
  populateContactSelect(dialog, accountId);
  const matchingContact = account.apContactId
    ? findContact(account.apContactId)
    : contactsForAccount(account.id).find((contact) => contact.name === account.apContact);
  form.elements.contactId.value = matchingContact?.id || "";
  form.elements.poFormat.value = account.poFormat || "";
  form.elements.poRequired.checked = Boolean(account.poRequired);
  dialog.showModal();
}

async function saveAccountAp(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = findAccount(existingId);
  if (!existing) return;
  const contactId = data.get("contactId").toString();
  const contact = contactId ? findContact(contactId) : null;
  const account = buildCoreAccountRecord({
    ...existing,
    apPortalUrl: data.get("apPortalUrl").toString().trim(),
    apEmail: data.get("apEmail").toString().trim(),
    apContactId: contactId || "",
    apContact: contact?.name || "",
    poFormat: data.get("poFormat").toString().trim(),
    poRequired: form.elements.poRequired.checked,
  });
  await saveBackendRecord("accounts", account, { refresh: false });
  await queueChange("Account", "updated", account);
  closeDialogs();
  await refreshState();
  state.selectedAccountId = account.id;
  state.view = "account-detail";
  render();
  showToast("AP details updated.");
}

function openContactDialog(accountId = "", contactId = "") {
  const dialog = document.querySelector("#contactDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateAccountSelect(dialog);
  populateOpportunitySelect(dialog);
  const contact = contactId ? findContact(contactId) : null;
  if (contact) {
    const core = getCoreContact(contact);
    form.elements.id.value = core.id;
    form.elements.accountId.value = core.accountId;
    form.elements.name.value = core.name;
    form.elements.title.value = core.title || "";
    form.elements.email.value = core.email || "";
    form.elements.phone.value = core.phone || "";
    form.elements.influence.value = core.relationshipRole || core.influence || "Unknown";
    form.elements.preferredContact.value = core.preferredContact || "Email";
    form.elements.opportunityId.value = (contact.opportunityIds || [])[0] || "";
    form.elements.notes.value = core.notes || "";
    populateDivisionSelect(dialog, core.accountId);
    form.elements.divisionId.value = contact.divisionId || "";
  } else {
    form.elements.id.value = "";
    if (accountId) form.elements.accountId.value = accountId;
    populateDivisionSelect(dialog, accountId);
  }
  dialog.showModal();
}

function openContactInfoDialog(contactId = "") {
  const dialog = document.querySelector("#contactInfoDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.firstName.value = core.firstName || "";
  form.elements.lastName.value = core.lastName || "";
  form.elements.jobTitle.value = core.jobTitle || "";
  form.elements.email.value = core.email || "";
  form.elements.emailAddressTwo.value = core.emailAddressTwo || "";
  form.elements.emailAddressThree.value = core.emailAddressThree || "";
  form.elements.businessPhone.value = core.businessPhone || "";
  form.elements.mobilePhone.value = core.mobilePhone || "";
  form.elements.fax.value = core.fax || "";
  dialog.showModal();
}

function openContactCommPrefsDialog(contactId = "") {
  const dialog = document.querySelector("#contactCommPrefsDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.preferredContactMethod.value = core.preferredContactMethod || "Email";
  form.elements.doNotAllowEmails.checked = Boolean(core.doNotAllowEmails);
  form.elements.doNotAllowPhoneCalls.checked = Boolean(core.doNotAllowPhoneCalls);
  form.elements.doNotAllowMail.checked = Boolean(core.doNotAllowMail);
  form.elements.doNotAllowFaxes.checked = Boolean(core.doNotAllowFaxes);
  dialog.showModal();
}

function openContactPersonalDialog(contactId = "") {
  const dialog = document.querySelector("#contactPersonalDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.birthday.value = core.birthday || "";
  form.elements.notes.value = core.notes || "";
  dialog.showModal();
}

function openContactRoleDialog(contactId = "") {
  const dialog = document.querySelector("#contactRoleDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.accountRole.value = core.accountRole || "Employee";
  form.elements.relationshipRole.value = core.relationshipRole || "Unknown";
  form.elements.lifecycleStage.value = core.lifecycleStage || "Lead";
  form.elements.leadStatus.value = core.leadStatus || "Open";
  populateEmployeeSelect(dialog, "ownerEmployeeId", "Unassigned", [{ value: "system", label: "System" }]);
  const matchingOwnerEmployee = getEmployees().find((employee) => employee.displayName === core.owner);
  form.elements.ownerEmployeeId.value = core.owner === "System" ? "system" : matchingOwnerEmployee?.id || "";
  populateDivisionSelect(dialog, core.accountId);
  form.elements.divisionId.value = contact.divisionId || "";
  dialog.showModal();
}

function openContactAddressOneDialog(contactId = "") {
  const dialog = document.querySelector("#contactAddressOneDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.addressOneType.value = core.addressOneType || "Primary";
  form.elements.addressOneStreetOne.value = core.addressOneStreetOne || "";
  form.elements.addressOneStreetTwo.value = core.addressOneStreetTwo || "";
  form.elements.addressOneStreetThree.value = core.addressOneStreetThree || "";
  form.elements.addressOneCity.value = core.addressOneCity || "";
  form.elements.addressOneState.value = core.addressOneState || "";
  form.elements.addressOneCountry.value = core.addressOneCountry || "";
  form.elements.addressOneZipCode.value = core.addressOneZipCode || "";
  form.elements.addressOneTelephoneOne.value = core.addressOneTelephoneOne || "";
  form.elements.addressOneTelephoneTwo.value = core.addressOneTelephoneTwo || "";
  form.elements.addressOneTelephoneThree.value = core.addressOneTelephoneThree || "";
  form.elements.addressOneUpsZone.value = core.addressOneUpsZone || "";
  form.elements.addressOneUtcOffset.value = core.addressOneUtcOffset || "";
  dialog.showModal();
}

function openContactAddressTwoDialog(contactId = "") {
  const dialog = document.querySelector("#contactAddressTwoDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const contact = findContact(contactId);
  if (!contact) return;
  const core = getCoreContact(contact);
  form.elements.id.value = core.id;
  form.elements.addressTwoType.value = core.addressTwoType || "";
  form.elements.addressTwoStreetOne.value = core.addressTwoStreetOne || "";
  form.elements.addressTwoStreetTwo.value = core.addressTwoStreetTwo || "";
  form.elements.addressTwoStreetThree.value = core.addressTwoStreetThree || "";
  form.elements.addressTwoCity.value = core.addressTwoCity || "";
  form.elements.addressTwoState.value = core.addressTwoState || "";
  form.elements.addressTwoCountry.value = core.addressTwoCountry || "";
  form.elements.addressTwoZipCode.value = core.addressTwoZipCode || "";
  form.elements.addressTwoTelephoneOne.value = core.addressTwoTelephoneOne || "";
  form.elements.addressTwoTelephoneTwo.value = core.addressTwoTelephoneTwo || "";
  form.elements.addressTwoTelephoneThree.value = core.addressTwoTelephoneThree || "";
  form.elements.addressTwoFax.value = core.addressTwoFax || "";
  dialog.showModal();
}

function openAddressDialog(accountId = "", addressId = "") {
  const dialog = document.querySelector("#addressDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateContactSelect(dialog, accountId);
  form.elements.accountId.value = accountId;
  const address = addressId ? getAddresses().find((item) => item.id === addressId) : null;
  if (address) {
    form.elements.id.value = address.id;
    form.elements.addressName.value = address.addressName || "";
    form.elements.addressType.value = address.addressType || "Primary";
    form.elements.isPrimary.checked = Boolean(address.isPrimary);
    form.elements.suiteNumber.value = address.suiteNumber || "";
    form.elements.street1.value = address.street1 || "";
    form.elements.street2.value = address.street2 || "";
    form.elements.street3.value = address.street3 || "";
    form.elements.city.value = address.city || "";
    form.elements.county.value = address.county || "";
    form.elements.stateOrProvince.value = address.stateOrProvince || "";
    form.elements.postalCode.value = address.postalCode || "";
    form.elements.countryOrRegion.value = address.countryOrRegion || "";
    form.elements.phone.value = address.phone || "";
    form.elements.latitude.value = address.latitude ?? "";
    form.elements.longitude.value = address.longitude ?? "";
    form.elements.freightTerms.value = address.freightTerms || "";
    form.elements.shippingMethod.value = address.shippingMethod || "";
    form.elements.contactId.value = address.contactId || "";
    form.elements.deliveryInstructions.value = address.deliveryInstructions || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveAddress(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const isPrimary = form.elements.isPrimary.checked;
  const record = {
    id: data.get("id").toString() || makeId("address"),
    accountId,
    addressName: data.get("addressName").toString().trim(),
    addressType: data.get("addressType").toString(),
    isPrimary,
    suiteNumber: data.get("suiteNumber").toString().trim(),
    street1: data.get("street1").toString().trim(),
    street2: data.get("street2").toString().trim(),
    street3: data.get("street3").toString().trim(),
    city: data.get("city").toString().trim(),
    county: data.get("county").toString().trim(),
    stateOrProvince: data.get("stateOrProvince").toString().trim(),
    postalCode: data.get("postalCode").toString().trim(),
    countryOrRegion: data.get("countryOrRegion").toString().trim(),
    phone: data.get("phone").toString().trim(),
    latitude: data.get("latitude") ? Number(data.get("latitude")) : null,
    longitude: data.get("longitude") ? Number(data.get("longitude")) : null,
    freightTerms: data.get("freightTerms").toString().trim(),
    shippingMethod: data.get("shippingMethod").toString().trim(),
    contactId: data.get("contactId").toString(),
    deliveryInstructions: data.get("deliveryInstructions").toString().trim(),
  };

  try {
    await saveBackendRecord("addresses", record);
    if (isPrimary) {
      const others = addressesForAccount(accountId).filter((item) => item.id !== record.id && item.isPrimary);
      for (const other of others) {
        await saveBackendRecord("addresses", { ...other, isPrimary: false });
      }
    }
    closeDialogs();
    render();
    showToast("Address saved.");
  } catch (error) {
    showToast(error.message || "Address could not be saved.");
  }
}

async function removeAddress(id) {
  if (!confirm("Remove this address?")) return;
  const address = getAddresses().find((item) => item.id === id);
  if (!address) return;
  try {
    await saveBackendRecord("addresses", { ...address, deletedAt: new Date().toISOString() });
    render();
    showToast("Address removed.");
  } catch (error) {
    showToast(error.message || "Address could not be removed.");
  }
}

function openIndustriesDialog(accountId = "") {
  const dialog = document.querySelector("#industriesDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const currentLinks = industriesForAccount(accountId);
  const checkedIds = new Set(currentLinks.map((link) => link.industryId));
  const primaryLink = currentLinks.find((link) => link.isPrimary);
  const sortedIndustries = getIndustries()
    .slice()
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  dialog.querySelector("#industriesCheckboxList").innerHTML = sortedIndustries
    .map(
      (industry) => `
        <label class="check-row">
          <input type="checkbox" name="industryId" value="${escapeAttribute(industry.id)}" ${checkedIds.has(industry.id) ? "checked" : ""} />
          <span>${escapeHtml(industry.industryName)}</span>
        </label>
      `,
    )
    .join("");
  const primarySelect = form.elements.primaryIndustryId;
  primarySelect.innerHTML = [
    `<option value="">No primary industry</option>`,
    ...sortedIndustries.map((industry) => `<option value="${escapeAttribute(industry.id)}">${escapeHtml(industry.industryName)}</option>`),
  ].join("");
  primarySelect.value = primaryLink?.industryId || "";
  dialog.showModal();
}

async function saveAccountIndustries(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const primaryIndustryId = data.get("primaryIndustryId").toString();
  const checkedIds = new Set(data.getAll("industryId").map((value) => value.toString()));
  const currentLinks = industriesForAccount(accountId);

  try {
    for (const industryId of checkedIds) {
      const existing = currentLinks.find((link) => link.industryId === industryId);
      await saveBackendRecord("accountIndustries", {
        id: existing?.id || makeId("acct-industry"),
        accountId,
        industryId,
        isPrimary: industryId === primaryIndustryId,
        deletedAt: "",
      });
    }
    for (const link of currentLinks) {
      if (!checkedIds.has(link.industryId)) {
        await saveBackendRecord("accountIndustries", { ...link, deletedAt: new Date().toISOString() });
      }
    }
    closeDialogs();
    render();
    showToast("Industries updated.");
  } catch (error) {
    showToast(error.message || "Industries could not be saved.");
  }
}

function computeSubcontractingEligibility(vendorProfile, isSubcontractor) {
  if (!isSubcontractor || !vendorProfile) return false;
  return (
    vendorProfile.onboardingStatus === "Approved" &&
    vendorProfile.insuranceStatus === "Valid" &&
    vendorProfile.w9Status === "Received" &&
    vendorProfile.safetyStatus === "Approved" &&
    !vendorProfile.isSuspended
  );
}

async function syncSubcontractingEligibility(accountId, vendorProfile) {
  const extension = relationshipExtensionForAccount(accountId);
  if (!extension) return;
  const eligible = computeSubcontractingEligibility(vendorProfile, extension.isSubcontractor);
  if (eligible !== Boolean(extension.eligibleForSubcontracting)) {
    await saveBackendRecord("accountRelationshipExtensions", { ...extension, eligibleForSubcontracting: eligible });
  }
}

function openVendorProfileDialog(accountId = "") {
  const dialog = document.querySelector("#vendorProfileDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  populateSubcontractorTypeSelect(dialog);
  populatePriceLevelSelect(dialog, "defaultPriceLevelId");
  populateAddressSelect(dialog, "remitToAddressId", accountId);
  populateAddressSelect(dialog, "dispatchAddressId", accountId);
  populateAddressSelect(dialog, "billingAddressId", accountId);
  populateContactSelect(dialog, accountId);
  populateSystemUserSelect(dialog, "approvedById");
  const profile = vendorProfileForAccount(accountId);
  if (profile) {
    form.elements.id.value = profile.id;
    form.elements.vendorNumber.value = profile.vendorNumber || "";
    form.elements.subcontractorTypeId.value = profile.subcontractorTypeId || "";
    form.elements.onboardingStatus.value = profile.onboardingStatus || "Candidate";
    form.elements.isSuspended.checked = Boolean(profile.isSuspended);
    form.elements.approvalDate.value = profile.approvalDate || "";
    form.elements.approvedById.value = profile.approvedById || "";
    form.elements.w9Status.value = profile.w9Status || "Missing";
    form.elements.insuranceStatus.value = profile.insuranceStatus || "Valid";
    form.elements.insuranceExpiration.value = profile.insuranceExpiration || "";
    form.elements.safetyStatus.value = profile.safetyStatus || "Pending";
    form.elements.paymentTerms.value = profile.paymentTerms || "";
    form.elements.defaultPriceLevelId.value = profile.defaultPriceLevelId || "";
    form.elements.serviceTerritory.value = profile.serviceTerritory || "";
    form.elements.performanceRating.value = profile.performanceRating ?? "";
    form.elements.accountingVendorId.value = profile.accountingVendorId || "";
    form.elements.remitToAddressId.value = profile.remitToAddressId || "";
    form.elements.dispatchAddressId.value = profile.dispatchAddressId || "";
    form.elements.billingAddressId.value = profile.billingAddressId || "";
    form.elements.contactId.value = profile.operationsContactId || "";
    form.elements.notes.value = profile.notes || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveVendorProfile(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const existing = vendorProfileForAccount(accountId);
  const record = {
    id: data.get("id").toString() || existing?.id || makeId("vendor-profile"),
    accountId,
    vendorNumber: data.get("vendorNumber").toString().trim(),
    subcontractorTypeId: data.get("subcontractorTypeId").toString(),
    onboardingStatus: data.get("onboardingStatus").toString(),
    isSuspended: form.elements.isSuspended.checked,
    approvalDate: data.get("approvalDate").toString(),
    approvedById: data.get("approvedById").toString(),
    w9Status: data.get("w9Status").toString(),
    insuranceStatus: data.get("insuranceStatus").toString(),
    insuranceExpiration: data.get("insuranceExpiration").toString(),
    safetyStatus: data.get("safetyStatus").toString(),
    paymentTerms: data.get("paymentTerms").toString().trim(),
    defaultPriceLevelId: data.get("defaultPriceLevelId").toString(),
    serviceTerritory: data.get("serviceTerritory").toString().trim(),
    performanceRating: data.get("performanceRating") ? Number(data.get("performanceRating")) : null,
    accountingVendorId: data.get("accountingVendorId").toString().trim(),
    remitToAddressId: data.get("remitToAddressId").toString(),
    dispatchAddressId: data.get("dispatchAddressId").toString(),
    billingAddressId: data.get("billingAddressId").toString(),
    operationsContactId: data.get("contactId").toString(),
    notes: data.get("notes").toString().trim(),
  };

  try {
    await saveBackendRecord("vendorProfiles", record);
    await syncSubcontractingEligibility(accountId, record);
    closeDialogs();
    render();
    showToast("Vendor profile saved.");
  } catch (error) {
    showToast(error.message || "Vendor profile could not be saved.");
  }
}

async function removeVendorProfile(id, accountId) {
  if (!confirm("Remove this vendor profile?")) return;
  const profile = getVendorProfiles().find((item) => item.id === id);
  if (!profile) return;
  try {
    await saveBackendRecord("vendorProfiles", { ...profile, deletedAt: new Date().toISOString() });
    await syncSubcontractingEligibility(accountId, null);
    render();
    showToast("Vendor profile removed.");
  } catch (error) {
    showToast(error.message || "Vendor profile could not be removed.");
  }
}

function openSalesTaskDialog(accountId = "", taskId = "") {
  const dialog = document.querySelector("#salesTaskDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  populateContactSelect(dialog, accountId);
  const task = taskId ? getSalesTasks().find((item) => item.id === taskId) : null;
  if (task) {
    form.elements.id.value = task.id;
    form.elements.subject.value = task.subject || "";
    form.elements.contactId.value = task.contactId || "";
    form.elements.dueDate.value = task.dueDate || "";
    form.elements.priority.value = task.priority || "Normal";
    form.elements.activityStatus.value = task.activityStatus || "Open";
    form.elements.statusReason.value = task.statusReason || "";
    form.elements.actualStart.value = task.actualStart || "";
    form.elements.actualEnd.value = task.actualEnd || "";
    form.elements.description.value = task.description || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveSalesTask(form) {
  const data = new FormData(form);
  const record = {
    id: data.get("id").toString() || makeId("sales-task"),
    accountId: data.get("accountId").toString(),
    subject: data.get("subject").toString().trim(),
    contactId: data.get("contactId").toString(),
    dueDate: data.get("dueDate").toString(),
    priority: data.get("priority").toString(),
    activityStatus: data.get("activityStatus").toString(),
    statusReason: data.get("statusReason").toString().trim(),
    actualStart: data.get("actualStart").toString(),
    actualEnd: data.get("actualEnd").toString(),
    description: data.get("description").toString().trim(),
  };

  try {
    await saveBackendRecord("salesTasks", record);
    closeDialogs();
    render();
    showToast("Sales task saved.");
  } catch (error) {
    showToast(error.message || "Sales task could not be saved.");
  }
}

async function completeSalesTask(id) {
  const task = getSalesTasks().find((item) => item.id === id);
  if (!task) return;
  try {
    await saveBackendRecord("salesTasks", {
      ...task,
      activityStatus: "Completed",
      statusReason: "Completed",
      actualEnd: new Date().toISOString(),
    });
    render();
    showToast("Sales task marked complete.");
  } catch (error) {
    showToast(error.message || "Sales task could not be updated.");
  }
}

async function removeSalesTask(id) {
  if (!confirm("Remove this sales task?")) return;
  const task = getSalesTasks().find((item) => item.id === id);
  if (!task) return;
  try {
    await saveBackendRecord("salesTasks", { ...task, deletedAt: new Date().toISOString() });
    render();
    showToast("Sales task removed.");
  } catch (error) {
    showToast(error.message || "Sales task could not be removed.");
  }
}

function blankRelationshipExtension(accountId) {
  return {
    id: "",
    accountId,
    accountTypeId: "",
    sicCode: "",
    ownershipType: "",
    taxAddressId: "",
    relationshipStatus: "Target",
    primaryRelationship: "Customer",
    customerStatus: "Never purchased",
    isClient: false,
    isProspect: false,
    isVendor: false,
    isSubcontractor: false,
    subcontractorPermitted: "Unknown",
    subcontractorPreapprovalRequired: false,
    msaStatus: "Not Sent",
    coiStatus: "Not Sent",
    w9DocumentStatus: "Not Sent",
    eligibleForSubcontracting: false,
    businessDescription: "",
    workingRelationshipNotes: "",
  };
}

async function saveRelationshipExtensionPatch(accountId, patch) {
  const existing = relationshipExtensionForAccount(accountId) || blankRelationshipExtension(accountId);
  const record = {
    ...existing,
    id: existing.id || makeId("account-relationship"),
    accountId,
    ...patch,
  };
  await saveBackendRecord("accountRelationshipExtensions", record);
  return record;
}

function openCompanyProfileDialog(accountId = "") {
  const dialog = document.querySelector("#companyProfileDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const record = relationshipExtensionForAccount(accountId);
  form.elements.id.value = record?.id || "";
  form.elements.sicCode.value = record?.sicCode || "";
  form.elements.ownershipType.value = record?.ownershipType || "";
  form.elements.isSubcontractor.checked = Boolean(record?.isSubcontractor);
  form.elements.subcontractorPermitted.value = record?.subcontractorPermitted || "Unknown";
  form.elements.subcontractorPreapprovalRequired.checked = Boolean(record?.subcontractorPreapprovalRequired);
  dialog.showModal();
}

async function saveCompanyProfile(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const isSubcontractor = form.elements.isSubcontractor.checked;
  const vendorProfile = vendorProfileForAccount(accountId);
  try {
    await saveRelationshipExtensionPatch(accountId, {
      sicCode: data.get("sicCode").toString().trim(),
      ownershipType: data.get("ownershipType").toString(),
      isSubcontractor,
      subcontractorPermitted: data.get("subcontractorPermitted").toString(),
      subcontractorPreapprovalRequired: form.elements.subcontractorPreapprovalRequired.checked,
      eligibleForSubcontracting: computeSubcontractingEligibility(vendorProfile, isSubcontractor),
    });
    closeDialogs();
    render();
    showToast("Company profile saved.");
  } catch (error) {
    showToast(error.message || "Company profile could not be saved.");
  }
}

function openRelationshipSnapshotDialog(accountId = "") {
  const dialog = document.querySelector("#relationshipSnapshotDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  populateAccountTypeSelect(dialog);
  populateAddressSelect(dialog, "taxAddressId", accountId);
  const record = relationshipExtensionForAccount(accountId);
  form.elements.id.value = record?.id || "";
  form.elements.accountTypeId.value = record?.accountTypeId || "";
  form.elements.relationshipStatus.value = record?.relationshipStatus || "Target";
  form.elements.primaryRelationship.value = record?.primaryRelationship || "Customer";
  form.elements.customerStatus.value = record?.customerStatus || "Never purchased";
  form.elements.taxAddressId.value = record?.taxAddressId || "";
  form.elements.isProspect.checked = Boolean(record?.isProspect);
  form.elements.isVendor.checked = Boolean(record?.isVendor);
  dialog.showModal();
}

async function saveRelationshipSnapshot(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const customerStatus = data.get("customerStatus").toString();
  const isClient = ["Active customer", "Inactive customer", "Former customer"].includes(customerStatus);
  try {
    await saveRelationshipExtensionPatch(accountId, {
      accountTypeId: data.get("accountTypeId").toString(),
      relationshipStatus: data.get("relationshipStatus").toString(),
      primaryRelationship: data.get("primaryRelationship").toString(),
      customerStatus,
      isClient,
      taxAddressId: data.get("taxAddressId").toString(),
      isProspect: form.elements.isProspect.checked,
      isVendor: form.elements.isVendor.checked,
    });
    closeDialogs();
    render();
    showToast("Relationship snapshot saved.");
  } catch (error) {
    showToast(error.message || "Relationship snapshot could not be saved.");
  }
}

function openDocumentStatusDialog(accountId = "") {
  const dialog = document.querySelector("#documentStatusDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const record = relationshipExtensionForAccount(accountId);
  form.elements.id.value = record?.id || "";
  form.elements.msaStatus.value = record?.msaStatus || "Not Sent";
  form.elements.coiStatus.value = record?.coiStatus || "Not Sent";
  form.elements.w9DocumentStatus.value = record?.w9DocumentStatus || "Not Sent";
  dialog.showModal();
}

async function saveDocumentStatus(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  try {
    await saveRelationshipExtensionPatch(accountId, {
      msaStatus: data.get("msaStatus").toString(),
      coiStatus: data.get("coiStatus").toString(),
      w9DocumentStatus: data.get("w9DocumentStatus").toString(),
    });
    closeDialogs();
    render();
    showToast("Document status saved.");
  } catch (error) {
    showToast(error.message || "Document status could not be saved.");
  }
}

function openRelationshipNotesDialog(accountId = "") {
  const dialog = document.querySelector("#relationshipNotesDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const record = relationshipExtensionForAccount(accountId);
  form.elements.id.value = record?.id || "";
  form.elements.businessDescription.value = record?.businessDescription || "";
  form.elements.workingRelationshipNotes.value = record?.workingRelationshipNotes || "";
  dialog.showModal();
}

async function saveRelationshipNotes(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  try {
    await saveRelationshipExtensionPatch(accountId, {
      businessDescription: data.get("businessDescription").toString().trim(),
      workingRelationshipNotes: data.get("workingRelationshipNotes").toString().trim(),
    });
    closeDialogs();
    render();
    showToast("Relationship notes saved.");
  } catch (error) {
    showToast(error.message || "Relationship notes could not be saved.");
  }
}

async function removeAccountRelationship(id) {
  if (!confirm("Remove these relationship details?")) return;
  const record = getAccountRelationshipExtensions().find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("accountRelationshipExtensions", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Account relationship removed.");
  } catch (error) {
    showToast(error.message || "Account relationship could not be removed.");
  }
}

function openAccountCommentDialog(accountId = "") {
  const dialog = document.querySelector("#accountCommentDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  dialog.showModal();
}

async function saveAccountComment(form) {
  const data = new FormData(form);
  const record = {
    id: makeId("account-comment"),
    accountId: data.get("accountId").toString(),
    authorName: state.currentUser?.name || "Local user",
    body: data.get("body").toString().trim(),
    createdAt: new Date().toISOString(),
  };
  try {
    await saveBackendRecord("accountComments", record);
    closeDialogs();
    render();
    showToast("Comment added.");
  } catch (error) {
    showToast(error.message || "Comment could not be saved.");
  }
}

async function removeAccountComment(id) {
  if (!confirm("Remove this comment?")) return;
  const record = getAccountComments().find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("accountComments", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Comment removed.");
  } catch (error) {
    showToast(error.message || "Comment could not be removed.");
  }
}

function toggleLocationOtherField(category) {
  const otherField = document.querySelector("#accountLocationOtherField");
  if (otherField) otherField.hidden = category !== "Other";
}

// Concern only makes sense unconditionally for an active job site. Every other facility category
// (office, warehouse, billing-only address) keeps it hidden behind an explicit checkbox, since most
// of those locations will never have an environmental concern to log.
function toggleLocationConcernField(category, hasConcern) {
  const toggle = document.querySelector("#accountLocationConcernToggle");
  const field = document.querySelector("#accountLocationConcernField");
  const isJobSite = category === "Job Site / Field Location";
  if (toggle) toggle.hidden = isJobSite;
  if (field) field.hidden = !isJobSite && !hasConcern;
}

function toggleMeetingFormatFields(format) {
  const onlineFields = document.querySelector("#meetingOnlineFields");
  const offlineFields = document.querySelector("#meetingOfflineFields");
  if (onlineFields) onlineFields.hidden = format !== "Online";
  if (offlineFields) offlineFields.hidden = format !== "Offline";
}

function openAccountLocationDialog(accountId = "", locationId = "") {
  const dialog = document.querySelector("#accountLocationDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const location = locationId ? findLocation(locationId) : null;
  if (location) {
    const category = location.category || (location.type ? "Other" : "");
    const hasConcern = Boolean(location.concern);
    form.elements.id.value = location.id;
    form.elements.name.value = location.name || "";
    form.elements.street1.value = location.street1 || location.address || "";
    form.elements.street2.value = location.street2 || "";
    form.elements.city.value = location.city || "";
    form.elements.stateOrProvince.value = location.stateOrProvince || "";
    form.elements.postalCode.value = location.postalCode || "";
    form.elements.countryOrRegion.value = location.countryOrRegion || "";
    form.elements.phone.value = location.phone || "";
    form.elements.latitude.value = location.latitude || "";
    form.elements.longitude.value = location.longitude || "";
    form.elements.category.value = category;
    form.elements.categoryOther.value = category === "Other" ? location.categoryOther || location.type || "" : "";
    form.elements.status.value = location.status || "";
    form.elements.concern.value = location.concern || "";
    form.elements.hasConcern.checked = hasConcern;
    form.elements.access.value = location.access || "";
    toggleLocationOtherField(category);
    toggleLocationConcernField(category, hasConcern);
  } else {
    form.elements.id.value = "";
    toggleLocationOtherField("");
    toggleLocationConcernField("", false);
  }
  dialog.showModal();
}

async function saveLocation(form) {
  const data = new FormData(form);
  const existingId = data.get("id").toString();
  const existing = existingId ? findLocation(existingId) : null;
  const category = data.get("category").toString();
  const street1 = data.get("street1").toString().trim();
  const city = data.get("city").toString().trim();
  const hasConcern = category === "Job Site / Field Location" || form.elements.hasConcern.checked;
  const location = {
    ...(existing || {}),
    id: existingId || makeId("loc"),
    accountId: data.get("accountId").toString(),
    name: data.get("name").toString().trim(),
    street1,
    street2: data.get("street2").toString().trim(),
    address: street1,
    city,
    stateOrProvince: data.get("stateOrProvince").toString().trim(),
    postalCode: data.get("postalCode").toString().trim(),
    countryOrRegion: data.get("countryOrRegion").toString().trim(),
    phone: data.get("phone").toString().trim(),
    latitude: data.get("latitude").toString().trim(),
    longitude: data.get("longitude").toString().trim(),
    category,
    categoryOther: category === "Other" ? data.get("categoryOther").toString().trim() : "",
    status: data.get("status").toString().trim(),
    concern: hasConcern ? data.get("concern").toString().trim() : "",
    access: data.get("access").toString().trim(),
  };
  delete location.type;
  await saveBackendRecord("locations", location);
  closeDialogs();
  await refreshState();
  render();
  showToast(existing ? "Facility updated." : "Facility added.");
}

function openAccountDivisionDialog(accountId = "") {
  const dialog = document.querySelector("#accountDivisionDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.id.value = "";
  dialog.showModal();
}

async function saveAccountDivision(form) {
  const data = new FormData(form);
  const record = {
    id: data.get("id").toString() || makeId("account-division"),
    accountId: data.get("accountId").toString(),
    divisionName: data.get("divisionName").toString().trim(),
  };
  try {
    await saveBackendRecord("accountDivisions", record);
    closeDialogs();
    render();
    showToast("Division saved.");
  } catch (error) {
    showToast(error.message || "Division could not be saved.");
  }
}

async function removeAccountDivision(id) {
  if (!confirm("Remove this division? Contacts assigned to it will become unassigned.")) return;
  const record = getAccountDivisions().find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("accountDivisions", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Division removed.");
  } catch (error) {
    showToast(error.message || "Division could not be removed.");
  }
}

function openContactEmploymentDialog(contactId = "", entryId = "") {
  const dialog = document.querySelector("#contactEmploymentDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.contactId.value = contactId;
  const entry = entryId ? getContactEmploymentHistory().find((item) => item.id === entryId) : null;
  if (entry) {
    form.elements.id.value = entry.id;
    form.elements.employer.value = entry.employer || "";
    form.elements.jobTitle.value = entry.jobTitle || "";
    form.elements.startDate.value = entry.startDate || "";
    form.elements.endDate.value = entry.endDate || "";
    form.elements.isCurrent.checked = Boolean(entry.isCurrent);
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveContactEmployment(form) {
  const data = new FormData(form);
  const record = {
    id: data.get("id").toString() || makeId("contact-employment"),
    contactId: data.get("contactId").toString(),
    employer: data.get("employer").toString().trim(),
    jobTitle: data.get("jobTitle").toString().trim(),
    startDate: data.get("startDate").toString(),
    endDate: form.elements.isCurrent.checked ? "" : data.get("endDate").toString(),
    isCurrent: form.elements.isCurrent.checked,
  };
  try {
    await saveBackendRecord("contactEmploymentHistory", record);
    closeDialogs();
    render();
    showToast("Employment history saved.");
  } catch (error) {
    showToast(error.message || "Employment history could not be saved.");
  }
}

async function removeContactEmployment(id) {
  if (!confirm("Remove this employment history entry?")) return;
  const record = getContactEmploymentHistory().find((item) => item.id === id);
  if (!record) return;
  try {
    await saveBackendRecord("contactEmploymentHistory", { ...record, deletedAt: new Date().toISOString() });
    render();
    showToast("Employment history entry removed.");
  } catch (error) {
    showToast(error.message || "Employment history entry could not be removed.");
  }
}

async function quickSetContactDivision(contactId, divisionId) {
  const contact = findContact(contactId);
  if (!contact) return;
  try {
    await saveBackendRecord("contacts", { ...contact, divisionId }, { refresh: false });
    await refreshState();
    render();
    showToast(divisionId ? "Contact assigned to division." : "Contact unassigned.");
  } catch (error) {
    showToast(error.message || "Contact could not be reassigned.");
  }
}

const pauseScopeFieldLabels = {
  pauseOpportunities: "New opportunities",
  pauseProjects: "New projects",
  pauseScheduling: "Scheduling / dispatch",
  pauseFieldWork: "Active field work",
  pauseInvoicing: "Invoicing",
  pauseServiceAgreements: "Service agreements",
  pauseSubcontractorWork: "Subcontractor assignments",
  pauseSampleProcessing: "Sample processing",
  pauseMarketing: "Marketing outreach",
};

const pauseNotifyFieldLabels = {
  notifyOwner: "Account owner",
  notifySalesManager: "Sales manager",
  notifyOperationsManager: "Operations manager",
  notifyDispatch: "Dispatch / scheduler",
  notifyFinance: "Finance",
  notifyFieldLeads: "Field leads",
  notifyPrimaryContact: "Primary contact",
};

const pauseScopeFields = Object.keys(pauseScopeFieldLabels);
const pauseNotifyFields = Object.keys(pauseNotifyFieldLabels);

function openAccountPauseDialog(accountId = "") {
  const dialog = document.querySelector("#accountPauseDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  const record = relationshipExtensionForAccount(accountId);
  form.elements.isPaused.checked = Boolean(record?.isPaused);
  form.elements.pausedByName.value = record?.pausedByName || "";
  form.elements.pausedReason.value = record?.pausedReason || "";
  [...pauseScopeFields, ...pauseNotifyFields].forEach((field) => {
    form.elements[field].checked = Boolean(record?.[field]);
  });
  dialog.showModal();
}

async function saveAccountPause(form) {
  const data = new FormData(form);
  const accountId = data.get("accountId").toString();
  const existing = relationshipExtensionForAccount(accountId);
  const isPaused = form.elements.isPaused.checked;
  const record = {
    ...(existing || {}),
    id: existing?.id || makeId("account-relationship"),
    accountId,
    isPaused,
    pausedByName: isPaused ? data.get("pausedByName").toString().trim() || state.currentUser?.name || "Local user" : "",
    pausedReason: isPaused ? data.get("pausedReason").toString().trim() : "",
    pausedAt: isPaused ? existing?.pausedAt || new Date().toISOString() : "",
  };
  [...pauseScopeFields, ...pauseNotifyFields].forEach((field) => {
    record[field] = form.elements[field].checked;
  });

  try {
    await saveBackendRecord("accountRelationshipExtensions", record);
    closeDialogs();
    render();
    showToast(isPaused ? "Account paused." : "Account pause settings saved.");
  } catch (error) {
    showToast(error.message || "Pause settings could not be saved.");
  }
}

function renderAccountPauseSummary(relationship) {
  if (!relationship?.isPaused) {
    return `<p class="help-text">Account is active — not paused.</p>`;
  }
  const activeScopes = pauseScopeFields.filter((field) => relationship[field]).map((field) => pauseScopeFieldLabels[field]);
  const activeNotify = pauseNotifyFields.filter((field) => relationship[field]).map((field) => pauseNotifyFieldLabels[field]);
  return `
    <dl class="detail-list">
      <div><dt>Status</dt><dd><span class="risk-badge high">Paused</span></dd></div>
      <div><dt>Paused by</dt><dd>${escapeHtml(relationship.pausedByName || "Not captured")}</dd></div>
      <div><dt>Reason</dt><dd>${escapeHtml(relationship.pausedReason || "Not captured")}</dd></div>
      <div><dt>Paused since</dt><dd>${relationship.pausedAt ? formatDate(relationship.pausedAt) : "Not captured"}</dd></div>
      <div><dt>Scope</dt><dd>${activeScopes.length ? activeScopes.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join(" ") : "None selected"}</dd></div>
      <div><dt>Notify</dt><dd>${activeNotify.length ? activeNotify.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join(" ") : "None selected"}</dd></div>
    </dl>
  `;
}

function openServiceAgreementDialog(accountId = "", agreementId = "") {
  const dialog = document.querySelector("#serviceAgreementDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  populatePriceLevelSelect(dialog, "priceLevelId");
  populateTransactionCurrencySelect(dialog, "transactionCurrencyId");
  const agreement = agreementId ? getServiceAgreements().find((item) => item.id === agreementId) : null;
  if (agreement) {
    form.elements.id.value = agreement.id;
    form.elements.agreementName.value = agreement.agreementName || "";
    form.elements.agreementNumber.value = agreement.agreementNumber || "";
    form.elements.agreementType.value = agreement.agreementType || "";
    form.elements.agreementStatus.value = agreement.agreementStatus || "Draft";
    form.elements.effectiveStart.value = agreement.effectiveStart || "";
    form.elements.effectiveEnd.value = agreement.effectiveEnd || "";
    form.elements.autoRenew.checked = Boolean(agreement.autoRenew);
    form.elements.renewalTermMonths.value = agreement.renewalTermMonths ?? "";
    form.elements.paymentTerms.value = agreement.paymentTerms || "";
    form.elements.billingFrequency.value = agreement.billingFrequency || "";
    form.elements.priceLevelId.value = agreement.priceLevelId || "";
    form.elements.transactionCurrencyId.value = agreement.transactionCurrencyId || "";
    form.elements.totalContractValue.value = agreement.totalContractValue ?? "";
    form.elements.scopeOfWork.value = agreement.scopeOfWork || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveServiceAgreement(form) {
  const data = new FormData(form);
  const record = {
    id: data.get("id").toString() || makeId("service-agreement"),
    accountId: data.get("accountId").toString(),
    agreementName: data.get("agreementName").toString().trim(),
    agreementNumber: data.get("agreementNumber").toString().trim(),
    agreementType: data.get("agreementType").toString(),
    agreementStatus: data.get("agreementStatus").toString(),
    effectiveStart: data.get("effectiveStart").toString(),
    effectiveEnd: data.get("effectiveEnd").toString(),
    autoRenew: form.elements.autoRenew.checked,
    renewalTermMonths: data.get("renewalTermMonths") ? Number(data.get("renewalTermMonths")) : null,
    paymentTerms: data.get("paymentTerms").toString().trim(),
    billingFrequency: data.get("billingFrequency").toString().trim(),
    priceLevelId: data.get("priceLevelId").toString(),
    transactionCurrencyId: data.get("transactionCurrencyId").toString(),
    totalContractValue: data.get("totalContractValue") ? Number(data.get("totalContractValue")) : null,
    scopeOfWork: data.get("scopeOfWork").toString().trim(),
  };

  try {
    await saveBackendRecord("serviceAgreements", record);
    closeDialogs();
    render();
    showToast("Service agreement saved.");
  } catch (error) {
    showToast(error.message || "Service agreement could not be saved.");
  }
}

async function removeServiceAgreement(id) {
  if (!confirm("Remove this service agreement?")) return;
  const agreement = getServiceAgreements().find((item) => item.id === id);
  if (!agreement) return;
  try {
    await saveBackendRecord("serviceAgreements", { ...agreement, deletedAt: new Date().toISOString() });
    render();
    showToast("Service agreement removed.");
  } catch (error) {
    showToast(error.message || "Service agreement could not be removed.");
  }
}

function openSubcontractorAssignmentDialog(vendorProfileId = "", assignmentId = "") {
  const dialog = document.querySelector("#subcontractorAssignmentDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.vendorProfileId.value = vendorProfileId;
  populatePriceLevelSelect(dialog, "priceLevelId");
  const assignment = assignmentId ? getSubcontractorAssignments().find((item) => item.id === assignmentId) : null;
  if (assignment) {
    form.elements.id.value = assignment.id;
    form.elements.assignmentName.value = assignment.assignmentName || "";
    form.elements.assignmentStatus.value = assignment.assignmentStatus || "Requested";
    form.elements.rateType.value = assignment.rateType || "";
    form.elements.rateAmount.value = assignment.rateAmount ?? "";
    form.elements.priceLevelId.value = assignment.priceLevelId || "";
    form.elements.startDate.value = assignment.startDate || "";
    form.elements.endDate.value = assignment.endDate || "";
    form.elements.relatedJobReference.value = assignment.relatedJobReference || "";
    form.elements.scopeOfWork.value = assignment.scopeOfWork || "";
    form.elements.notes.value = assignment.notes || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

async function saveSubcontractorAssignment(form) {
  const data = new FormData(form);
  const record = {
    id: data.get("id").toString() || makeId("subcontractor-assignment"),
    vendorProfileId: data.get("vendorProfileId").toString(),
    assignmentName: data.get("assignmentName").toString().trim(),
    assignmentStatus: data.get("assignmentStatus").toString(),
    rateType: data.get("rateType").toString(),
    rateAmount: data.get("rateAmount") ? Number(data.get("rateAmount")) : null,
    priceLevelId: data.get("priceLevelId").toString(),
    startDate: data.get("startDate").toString(),
    endDate: data.get("endDate").toString(),
    relatedJobReference: data.get("relatedJobReference").toString().trim(),
    scopeOfWork: data.get("scopeOfWork").toString().trim(),
    notes: data.get("notes").toString().trim(),
  };

  try {
    await saveBackendRecord("subcontractorAssignments", record);
    closeDialogs();
    render();
    showToast("Subcontractor assignment saved.");
  } catch (error) {
    showToast(error.message || "Subcontractor assignment could not be saved.");
  }
}

async function removeSubcontractorAssignment(id) {
  if (!confirm("Remove this subcontractor assignment?")) return;
  const assignment = getSubcontractorAssignments().find((item) => item.id === id);
  if (!assignment) return;
  try {
    await saveBackendRecord("subcontractorAssignments", { ...assignment, deletedAt: new Date().toISOString() });
    render();
    showToast("Subcontractor assignment removed.");
  } catch (error) {
    showToast(error.message || "Subcontractor assignment could not be removed.");
  }
}

function openAlertDialog(jobId = "") {
  const dialog = document.querySelector("#alertDialog");
  populateProjectSelect(dialog);
  if (jobId) dialog.querySelector("select[name='jobId']").value = jobId;
  dialog.showModal();
}

function openMaterialDialog(jobId = "") {
  const dialog = document.querySelector("#materialDialog");
  populateProjectSelect(dialog);
  if (jobId) dialog.querySelector("select[name='jobId']").value = jobId;
  dialog.showModal();
}

function openEquipmentDialog(jobId = "") {
  const dialog = document.querySelector("#equipmentDialog");
  populateProjectSelect(dialog);
  if (jobId) dialog.querySelector("select[name='jobId']").value = jobId;
  dialog.showModal();
}

function openScheduleDialog(jobId = "") {
  const dialog = document.querySelector("#scheduleDialog");
  populateProjectSelect(dialog);
  populateEquipmentAssetSelect(dialog);
  populateLaborResourceSelect(dialog);
  dialog.querySelector("input[name='date']").value = todayIso();
  if (jobId) dialog.querySelector("select[name='jobId']").value = jobId;
  dialog.showModal();
}

function openRemediationDialog() {
  const dialog = document.querySelector("#remediationDialog");
  populateAccountSelect(dialog);
  dialog.querySelector("input[name='startDate']").value = todayIso();
  dialog.querySelector("input[name='targetDate']").value = addDays(30);
  dialog.showModal();
}

function openInventoryItemDialog(itemId = "") {
  const dialog = document.querySelector("#inventoryItemDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const item = itemId ? getInventoryItemById(itemId) : null;
  if (item) {
    form.elements.id.value = item.id;
    form.elements.materialType.value = item.materialType || "";
    form.elements.unit.value = item.unit || "";
    form.elements.buyer.value = item.buyer || "";
    form.elements.onHand.value = item.onHand ?? 0;
    form.elements.reorderAt.value = item.reorderAt ?? 10;
    form.elements.targetStock.value = item.targetStock ?? 50;
    form.elements.barcode.value = item.barcode || "";
  } else {
    form.elements.id.value = "";
  }
  dialog.showModal();
}

function openPurchaseOrderDialog(itemId = "", orderId = "") {
  const dialog = document.querySelector("#purchaseOrderDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateInventoryItemSelect(dialog);
  const order = orderId ? getPurchaseOrders().find((item) => item.id === orderId) : null;
  if (order) {
    form.elements.id.value = order.id;
    form.elements.itemId.value = order.itemId || "";
    form.elements.quantity.value = order.quantity || 1;
    form.elements.vendor.value = order.vendor || "";
    form.elements.status.value = order.status === "Ordered" ? "Ordered" : "Draft";
  } else {
    form.elements.id.value = "";
    form.elements.status.value = "Draft";
    if (itemId) dialog.querySelector("select[name='itemId']").value = itemId;
  }
  dialog.showModal();
}

async function submitPurchaseOrder(orderId) {
  const order = getPurchaseOrders().find((item) => item.id === orderId);
  if (!order) {
    showToast("Purchase order was not found.");
    return;
  }

  try {
    await saveBackendRecord("purchaseOrders", { ...order, status: "Ordered" });
    render();
    showToast(`${order.materialType} order submitted to ${order.vendor || "vendor"}.`);
  } catch (error) {
    showToast(error.message || "Purchase order could not be submitted.");
  }
}

function openEquipmentAssetDialog(assetTag = "") {
  const dialog = document.querySelector("#equipmentAssetDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const asset = getEquipmentStatus().find((item) => item.assetTag === assetTag);
  if (asset) {
    form.elements.id.value = asset.id || "";
    form.elements.assetTag.value = asset.assetTag || "";
    form.elements.equipment.value = asset.equipment || "";
    form.elements.category.value = asset.category || "General equipment";
    form.elements.status.value = asset.status || "Ready";
    form.elements.lastUsed.value = asset.lastUsed || "";
    form.elements.maintenanceDue.value = asset.maintenanceDue || todayIso();
    form.elements.issue.value = asset.issue || "";
    renderEquipmentSpecFieldGrid(asset.category || "General equipment", asset.specs || {});
  } else {
    form.elements.id.value = "";
    form.elements.category.value = "General equipment";
    form.elements.maintenanceDue.value = addDays(30);
    renderEquipmentSpecFieldGrid("General equipment", {});
  }
  dialog.showModal();
}

function renderEquipmentSpecFieldGrid(category, values = {}) {
  const container = document.querySelector("#equipmentSpecFieldGrid");
  if (!container) return;
  const config = getEquipmentCategoryConfig(category);
  container.innerHTML = config.specFields
    .map(
      (field) => `
        <label>
          ${escapeHtml(field.label)}
          <input data-spec-key="${escapeAttribute(field.key)}" type="${field.type || "text"}" placeholder="${escapeAttribute(field.placeholder || "")}" value="${escapeAttribute(values[field.key] || "")}" />
        </label>
      `,
    )
    .join("");
}

function openEquipmentStatusDialog(assetTag) {
  const asset = findEquipmentAssetByTag(assetTag);
  const dialog = document.querySelector("#equipmentStatusDialog");
  if (!asset || !dialog) return;

  const toneCopy = {
    "Maintenance hold": "This asset is blocked from scheduling until the issue is cleared.",
    "In service": "This asset is checked out and assigned to active work.",
    Ready: "This asset is available and ready to be scheduled.",
  };

  dialog.querySelector("[data-status-title]").textContent = `${asset.assetTag} - ${asset.equipment}`;
  const badge = dialog.querySelector("[data-status-badge]");
  badge.textContent = asset.status;
  badge.className = `risk-badge ${asset.statusTone}`;
  dialog.querySelector("[data-status-copy]").textContent = asset.issue || toneCopy[asset.status] || "No additional detail recorded.";
  dialog.querySelector("[data-status-meta]").innerHTML = `
    <span>Last used ${formatDate(asset.lastUsed)}</span>
    <span>Maintenance due ${formatDate(asset.maintenanceDue)}</span>
  `;
  dialog.querySelector("[data-go-to-equipment]").dataset.assetTag = assetTag;
  const hasAlert = asset.status === "Maintenance hold" || Boolean(asset.issue);
  const clearButton = dialog.querySelector("[data-clear-alert]");
  clearButton.hidden = !hasAlert;
  clearButton.dataset.assetTag = assetTag;
  dialog.showModal();
}

async function clearEquipmentAlert(assetTag) {
  const asset = findEquipmentAssetByTag(assetTag);
  if (!asset) return;
  try {
    await saveBackendRecord("equipmentAssets", {
      id: asset.id,
      assetTag: asset.assetTag,
      equipment: asset.equipment,
      category: asset.category,
      status: "Ready",
      lastUsed: asset.lastUsed,
      maintenanceDue: asset.maintenanceDue,
      issue: "",
      assignedProjectId: asset.assignedProjectId || "",
      specs: asset.specs || {},
    });
    closeDialogs();
    render();
    showToast("Equipment alert cleared.");
  } catch (error) {
    showToast(error.message || "Alert could not be cleared.");
  }
}

function openEquipmentMaintenanceDialog(assetTag = "") {
  const dialog = document.querySelector("#equipmentMaintenanceDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.assetTag.value = assetTag || state.selectedEquipmentAssetTag || "";
  form.elements.date.value = todayIso();
  form.elements.nextDueDate.value = addDays(90);
  dialog.showModal();
}

function openEquipmentRestockDialog(assetTag = "", restockId = "") {
  const dialog = document.querySelector("#equipmentRestockDialog");
  const form = dialog.querySelector("form");
  form.reset();
  const restock = restockId ? (state.backend.equipmentRestockItems || []).find((item) => item.id === restockId) : null;
  form.elements.assetTag.value = assetTag || state.selectedEquipmentAssetTag || "";
  if (restock) {
    form.elements.id.value = restock.id;
    form.elements.itemName.value = restock.itemName || "";
    form.elements.quantityNeeded.value = restock.quantityNeeded ?? 1;
    form.elements.unit.value = restock.unit || "";
    form.elements.status.value = restock.status || "Needed";
    form.elements.notes.value = restock.notes || "";
  } else {
    form.elements.id.value = "";
    form.elements.quantityNeeded.value = 1;
    form.elements.status.value = "Needed";
  }
  dialog.showModal();
}

function openMapLocationDialog(locationId = "") {
  const dialog = document.querySelector("#mapLocationDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateProjectSelect(dialog, true);
  populateScheduleEventSelect(dialog);

  const location = (state.backend.mapLocations || []).find((item) => item.id === locationId);
  if (location) {
    form.elements.id.value = location.id || "";
    form.elements.source.value = location.source || "Manual";
    form.elements.label.value = location.label || "";
    form.elements.projectId.value = location.projectId || "";
    form.elements.scheduleEventId.value = location.scheduleEventId || "";
    form.elements.latitude.value = location.latitude ?? "";
    form.elements.longitude.value = location.longitude ?? "";
    form.elements.assetTags.value = (location.assetTags || []).join(", ");
    form.elements.status.value = location.status || "Live GPS";
  } else {
    form.elements.id.value = "";
    form.elements.source.value = "Manual";
    form.elements.status.value = "Scheduled work";
  }

  dialog.showModal();
}

function openEmployeeDialog(employeeId = "") {
  const dialog = document.querySelector("#employeeDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateEmployeeSelect(dialog, "managerEmployeeId", "No manager");
  populateWorkforceTeamSelect(dialog);
  populateCrewProfileSelect(dialog);
  const employee = employeeId ? findEmployee(employeeId) : null;
  if (employee) {
    form.elements.id.value = employee.id;
    form.elements.employeeNumber.value = employee.employeeNumber || "";
    form.elements.employmentStatus.value = employee.employmentStatus || "Active";
    form.elements.firstName.value = employee.firstName || "";
    form.elements.lastName.value = employee.lastName || "";
    form.elements.jobTitle.value = employee.jobTitle || "";
    form.elements.employmentType.value = employee.employmentType || "Full time";
    form.elements.businessUnit.value = employee.businessUnit || "";
    form.elements.homeBase.value = employee.homeBase || "";
    form.elements.teamId.value = employee.teamId || "";
    form.elements.crewId.value = employee.crewId || "";
    form.elements.managerEmployeeId.value = employee.managerEmployeeId || "";
    form.elements.hireDate.value = employee.hireDate || todayIso();
    form.elements.primaryEmail.value = employee.primaryEmail || "";
    form.elements.mobilePhone.value = employee.mobilePhone || "";
    form.elements.skills.value = (employee.skills || []).join(", ");
    form.elements.dispatchEligible.checked = Boolean(employee.dispatchEligible);
    form.elements.frontlineEnabled.checked = Boolean(employee.frontlineEnabled);
  } else {
    form.elements.id.value = "";
    form.elements.hireDate.value = todayIso();
  }
  dialog.showModal();
}

function openCredentialDialog(employeeId = "") {
  const dialog = document.querySelector("#credentialDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateEmployeeSelect(dialog, "employeeId");
  form.elements.employeeId.value = employeeId || state.selectedEmployeeId || getEmployees()[0]?.id || "";
  form.elements.issuedOn.value = todayIso();
  form.elements.expiresOn.value = addDays(365);
  dialog.showModal();
}

function openJobRequestDialog(accountId = "", opportunityId = "", projectId = "") {
  if (projectId) {
    const existingDispatchJobs = getDispatchJobs().filter((dispatchJob) => dispatchJob.projectId === projectId);
    if (existingDispatchJobs.length) {
      const count = existingDispatchJobs.length;
      const proceed = confirm(`This project already has ${count} dispatch job${count === 1 ? "" : "s"}. Push another?`);
      if (!proceed) return;
    }
  }
  const dialog = document.querySelector("#jobRequestDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateAccountSelect(dialog, "Select a customer account");
  populateEmployeeSelect(dialog, "requestedEmployeeId", "No requested lead");
  form.elements.requestedServiceAt.value = toLocalDateTimeInput(new Date());
  form.elements.projectId.value = projectId || "";

  const project = projectId ? findProject(projectId) : null;
  const opportunity = opportunityId ? findOpportunity(opportunityId) : project?.opportunityId ? findOpportunity(project.opportunityId) : null;

  if (project) {
    const account = findAccount(project.accountId);
    const location = findLocation(project.locationId);
    form.elements.accountId.value = project.accountId;
    form.elements.serviceCategory.value = mapJobClassToServiceCategory(project.jobClass);
    form.elements.priority.value = project.jobClass === "Emergency Response" ? "Emergency" : "Normal";
    form.elements.generatorResponsibleParty.value = project.generatorName || account?.name || "";
    form.elements.calledInByName.value = state.currentUser?.name || "";
    form.elements.addressText.value = formatLocationAddressLine(location) || project.generatorSiteName || [account?.siteName, account?.city].filter(Boolean).join(", ");
    form.elements.pricingNotes.value = (project.opportunityId && pricingSourceForOpportunity(project.opportunityId)) || (project.budget ? `${money(project.budget)} project budget.` : "");
    form.elements.description.value = [project.name, project.activePhase].filter(Boolean).join(" — ");
    if (project.jobClass === "Scheduled Work") {
      form.elements.requestedServiceAt.value = toLocalDateTimeInput(new Date(Date.now() + 3 * 86400000));
    }
  } else if (opportunity) {
    const core = getCoreOpportunity(opportunity);
    const account = findAccount(core.accountId);
    const location = findLocation(opportunity.locationId);
    form.elements.accountId.value = core.accountId;
    form.elements.serviceCategory.value = mapServiceTypeToServiceCategory(core.serviceType);
    form.elements.priority.value = core.serviceType === "Emergency Spill Response" ? "Emergency" : "Normal";
    form.elements.generatorResponsibleParty.value = core.accountName || "";
    form.elements.calledInByName.value = state.currentUser?.name || "";
    form.elements.addressText.value = formatLocationAddressLine(location) || [account?.siteName, account?.city].filter(Boolean).join(", ");
    form.elements.pricingNotes.value = pricingSourceForOpportunity(opportunity.id) || `${money(core.amount)} contract value from won opportunity.`;
    form.elements.description.value = [core.opportunityName, core.nextStep, account?.concern].filter(Boolean).join(" — ");
  } else if (accountId) {
    form.elements.accountId.value = accountId;
  }
  dialog.showModal();
}

function openDispatchScheduleDialog(jobId = "") {
  const dialog = document.querySelector("#dispatchScheduleDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateDispatchJobSelect(dialog);
  populateEmployeeSelect(dialog, "fieldLeadEmployeeId");
  populateCrewProfileSelect(dialog);
  const job = findDispatchJob(jobId || state.selectedDispatchJobId) || getDispatchJobs()[0];
  if (job) {
    form.elements.jobId.value = job.id;
    form.elements.fieldLeadEmployeeId.value = job.fieldLeadEmployeeId || "";
    form.elements.date.value = job.scheduledStart?.slice(0, 10) || todayIso();
    form.elements.startTime.value = job.scheduledStart ? timeInputValue(job.scheduledStart) : "08:00";
    form.elements.endTime.value = job.scheduledEnd ? timeInputValue(job.scheduledEnd) : "17:00";
    const assignment = dispatchAssignmentsForJob(job.id)[0];
    if (assignment?.crewId) form.elements.crewId.value = assignment.crewId;
  } else {
    form.elements.date.value = todayIso();
  }
  dialog.showModal();
}

function openInvoiceDialog(jobId = "") {
  const dialog = document.querySelector("#invoiceDialog");
  const form = dialog.querySelector("form");
  populateProjectSelect(dialog);
  form.reset();
  const row = jobId ? getFinanceRows().find((item) => item.job.id === jobId) : null;
  if (jobId) form.elements.projectId.value = jobId;
  if (row) {
    form.elements.id.value = row.invoice?.id || "";
    form.elements.quotedAmount.value = row.quoted;
    form.elements.invoiceAmount.value = row.invoicePrep;
    form.elements.status.value = ["Draft", "Ready", "Sent", "Past due", "Paid"].includes(row.status) ? row.status : "Draft";
    form.elements.dueDate.value = row.invoice?.dueDate || addDays(30);
    form.elements.notes.value = row.invoice?.notes || row.invoiceSignal;
  } else {
    form.elements.dueDate.value = addDays(30);
  }
  dialog.showModal();
}

function openActivityDialog(accountId = "", contactId = "", opportunityId = "") {
  const dialog = document.querySelector("#noteDialog");
  const form = dialog.querySelector("form");
  form.reset();
  populateAccountSelect(dialog);
  populateContactSelect(dialog, accountId);
  populateOpportunitySelect(dialog);
  const selectedContact = findContact(contactId);
  const selectedOpportunity = findOpportunity(opportunityId);
  const resolvedAccountId = accountId || selectedContact?.accountId || selectedOpportunity?.accountId || state.accounts[0]?.id || "";
  if (resolvedAccountId) form.elements.accountId.value = resolvedAccountId;
  populateContactSelect(dialog, resolvedAccountId);
  if (contactId) form.elements.contactId.value = contactId;
  if (opportunityId) form.elements.opportunityId.value = opportunityId;
  form.elements.activityDate.value = todayIso();
  form.elements.dueDate.value = "";
  form.elements.channel.value = "";
  form.elements.subject.value = "";
  dialog.showModal();
}

function openNoteDialog(accountId = "") {
  openActivityDialog(accountId);
}

function closeActivityPickers() {
  document.querySelectorAll("details.activity-picker[open]").forEach((details) => {
    details.open = false;
  });
}

function openQuickNoteDialog(accountId = "", contactId = "", opportunityId = "") {
  closeActivityPickers();
  const dialog = document.querySelector("#quickNoteDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.contactId.value = contactId;
  form.elements.opportunityId.value = opportunityId;
  dialog.showModal();
}

function openActivityMeetingDialog(accountId = "", contactId = "", opportunityId = "") {
  closeActivityPickers();
  const dialog = document.querySelector("#activityMeetingDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.opportunityId.value = opportunityId;
  populateContactSelect(dialog, accountId);
  if (contactId) form.elements.contactId.value = contactId;
  form.elements.activityDate.value = todayIso();
  toggleMeetingFormatFields(form.elements.meetingFormat.value);
  dialog.showModal();
}

function openActivityCallDialog(accountId = "", contactId = "", opportunityId = "") {
  closeActivityPickers();
  const dialog = document.querySelector("#activityCallDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.opportunityId.value = opportunityId;
  populateContactSelect(dialog, accountId);
  if (contactId) form.elements.contactId.value = contactId;
  form.elements.activityDate.value = todayIso();
  dialog.showModal();
}

function openActivityEmailDialog(accountId = "", contactId = "", opportunityId = "") {
  closeActivityPickers();
  const dialog = document.querySelector("#activityEmailDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.opportunityId.value = opportunityId;
  populateContactSelect(dialog, accountId);
  if (contactId) form.elements.contactId.value = contactId;
  form.elements.activityDate.value = todayIso();
  dialog.showModal();
}

function openActivityTaskDialog(accountId = "", contactId = "", opportunityId = "") {
  closeActivityPickers();
  const dialog = document.querySelector("#activityTaskDialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.elements.accountId.value = accountId;
  form.elements.opportunityId.value = opportunityId;
  populateContactSelect(dialog, accountId);
  if (contactId) form.elements.contactId.value = contactId;
  form.elements.dueDate.value = todayIso();
  dialog.showModal();
}

function closeDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

function populateAccountSelect(root, blankLabel = "") {
  root.querySelectorAll("select[name='accountId']").forEach((select) => {
    select.innerHTML = [
      ...(blankLabel ? [`<option value="">${escapeHtml(blankLabel)}</option>`] : []),
      ...state.accounts.map((account) => `<option value="${escapeAttribute(account.id)}">${escapeHtml(account.name)}</option>`),
    ].join("");
  });
}

function populateEmployeeSelect(root, fieldName, blankLabel = "", extraOptions = []) {
  root.querySelectorAll(`select[name='${fieldName}']`).forEach((select) => {
    select.innerHTML = [
      ...(blankLabel ? [`<option value="">${escapeHtml(blankLabel)}</option>`] : []),
      ...extraOptions.map((option) => `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`),
      ...getEmployees().map((employee) => `<option value="${escapeAttribute(employee.id)}">${escapeHtml(employee.displayName)} - ${escapeHtml(employee.jobTitle)}</option>`),
    ].join("");
  });
}

function populateWorkforceTeamSelect(root) {
  root.querySelectorAll("select[name='teamId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No team</option>`,
      ...getWorkforceTeams().map((team) => `<option value="${escapeAttribute(team.id)}">${escapeHtml(team.name)}</option>`),
    ].join("");
  });
}

function populateCrewProfileSelect(root) {
  root.querySelectorAll("select[name='crewId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No standing crew</option>`,
      ...getCrewProfiles().map((crew) => `<option value="${escapeAttribute(crew.id)}">${escapeHtml(crew.name)}</option>`),
    ].join("");
  });
}

function populateDispatchJobSelect(root) {
  root.querySelectorAll("select[name='jobId']").forEach((select) => {
    select.innerHTML = getDispatchJobs()
      .filter((job) => !isTerminalDispatchStatus(job.status))
      .map((job) => `<option value="${escapeAttribute(job.id)}">${escapeHtml(job.jobNumber)} - ${escapeHtml(job.jobName)}</option>`)
      .join("");
  });
}

function populateOpportunitySelect(root) {
  root.querySelectorAll("select[name='opportunityId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No opportunity yet</option>`,
      ...state.opportunities.map((opportunity) => {
        const account = findAccount(opportunity.accountId);
        return `<option value="${opportunity.id}">${escapeHtml(opportunity.name)} - ${escapeHtml(account?.name ?? "Unknown account")}</option>`;
      }),
    ].join("");
  });
}

function populateContactSelect(root, accountId = "") {
  root.querySelectorAll("select[name='contactId']").forEach((select) => {
    const contacts = accountId ? contactsForAccount(accountId) : state.contacts;
    select.innerHTML = [
      `<option value="">No contact selected</option>`,
      ...contacts.map((contact) => {
        const account = findAccount(contact.accountId);
        return `<option value="${escapeAttribute(contact.id)}">${escapeHtml(contact.name)} - ${escapeHtml(account?.name ?? "Unknown account")}</option>`;
      }),
    ].join("");
  });
}

function populateSubcontractorTypeSelect(root) {
  root.querySelectorAll("select[name='subcontractorTypeId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...getSubcontractorTypes().map((type) => `<option value="${escapeAttribute(type.id)}">${escapeHtml(type.name)}</option>`),
    ].join("");
  });
}

function populatePriceLevelSelect(root, fieldName) {
  root.querySelectorAll(`select[name='${fieldName}']`).forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...(state.backend.priceLevels || []).map((priceLevel) => `<option value="${escapeAttribute(priceLevel.id)}">${escapeHtml(priceLevel.name)}</option>`),
    ].join("");
  });
}

function populateAddressSelect(root, fieldName, accountId) {
  root.querySelectorAll(`select[name='${fieldName}']`).forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...addressesForAccount(accountId).map((address) => `<option value="${escapeAttribute(address.id)}">${escapeHtml(address.addressName)}</option>`),
    ].join("");
  });
}

function populateSystemUserSelect(root, fieldName) {
  root.querySelectorAll(`select[name='${fieldName}']`).forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...(state.backend.systemUsers || []).map((user) => `<option value="${escapeAttribute(user.id)}">${escapeHtml(user.fullName)}</option>`),
    ].join("");
  });
}

function populateTransactionCurrencySelect(root, fieldName) {
  root.querySelectorAll(`select[name='${fieldName}']`).forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...(state.backend.transactionCurrencies || []).map((currency) => `<option value="${escapeAttribute(currency.id)}">${escapeHtml(currency.currencyName)}</option>`),
    ].join("");
  });
}

function populateAccountTypeSelect(root) {
  root.querySelectorAll("select[name='accountTypeId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">Not set</option>`,
      ...getAccountTypes().map((accountType) => `<option value="${escapeAttribute(accountType.id)}">${escapeHtml(accountType.name)}</option>`),
    ].join("");
  });
}

function populateDivisionSelect(root, accountId) {
  root.querySelectorAll("select[name='divisionId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No division</option>`,
      ...accountDivisionsForAccount(accountId).map((division) => `<option value="${escapeAttribute(division.id)}">${escapeHtml(division.divisionName)}</option>`),
    ].join("");
  });
}

function syncActivityContactOptions() {
  const dialog = document.querySelector("#noteDialog");
  if (!dialog?.open) return;
  const accountId = dialog.querySelector("select[name='accountId']")?.value || "";
  populateContactSelect(dialog, accountId);
}

function populateProjectSelect(root, includeBlank = false) {
  root.querySelectorAll("select[name='projectId']").forEach((select) => {
    select.innerHTML = [
      includeBlank ? `<option value="">No linked project</option>` : "",
      ...state.projects.map((project) => {
        const account = findAccount(project.accountId);
        return `<option value="${escapeAttribute(project.id)}">${escapeHtml(project.name)} - ${escapeHtml(project.jobClass)} - ${escapeHtml(account?.name ?? "Unknown account")}</option>`;
      }),
    ]
      .filter(Boolean)
      .join("");
  });
}

function populateScheduleEventSelect(root) {
  root.querySelectorAll("select[name='scheduleEventId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No scheduled-work link</option>`,
      ...getScheduleEvents().map((event) => {
        const job = findProject(event.projectId);
        return `<option value="${escapeAttribute(event.id)}">${escapeHtml(event.title)} - ${escapeHtml(job?.name || "Unlinked job")} - ${formatDate(event.date)}</option>`;
      }),
    ].join("");
  });
}

function populateEquipmentAssetSelect(root) {
  root.querySelectorAll("select[name='equipmentAssetTag']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No equipment selected</option>`,
      ...getEquipmentStatus().map(
        (asset) =>
          `<option value="${escapeAttribute(asset.assetTag)}">${escapeHtml(asset.assetTag)} - ${escapeHtml(asset.equipment)} (${escapeHtml(asset.status)})</option>`,
      ),
    ].join("");
  });
}

function populateLaborResourceSelect(root) {
  root.querySelectorAll("select[name='laborResourceId']").forEach((select) => {
    select.innerHTML = [
      `<option value="">No labor selected</option>`,
      ...getLaborResources().map(
        (person) => `<option value="${escapeAttribute(person.id)}">${escapeHtml(person.name)} - ${escapeHtml(person.role)}</option>`,
      ),
    ].join("");
  });
}

function populateInventoryItemSelect(root) {
  root.querySelectorAll("select[name='itemId']").forEach((select) => {
    select.innerHTML = getConsumableStatus()
      .map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.materialType)} - ${item.available} ${escapeHtml(item.unit)}</option>`)
      .join("");
  });
}

async function startMicrosoftSignIn() {
  const config = state.identityConfig;
  if (!config.tenantId || !config.clientId) {
    showToast("Add tenant and client IDs first.");
    return;
  }

  const verifier = randomString(64);
  const challenge = await createPkceChallenge(verifier);
  const loginState = randomString(32);
  const nonce = randomString(32);
  const redirectUri = getRedirectUri();

  sessionStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({
      verifier,
      state: loginState,
      nonce,
      redirectUri,
    }),
  );

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: config.scopes || defaultIdentityConfig.scopes,
    state: loginState,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.assign(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize?${params.toString()}`,
  );
}

async function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const authError = params.get("error");

  if (authError) {
    const description = params.get("error_description") || "Microsoft sign-in did not complete.";
    await putSetting("authError", description);
    cleanAuthQuery();
    return;
  }

  if (!code) return;

  try {
    const stored = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || "{}");
    if (!stored.verifier || stored.state !== params.get("state")) {
      throw new Error("Sign-in state did not match. Please try again.");
    }

    const config = await getSetting("identityConfig", defaultIdentityConfig);
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: stored.redirectUri,
      scope: config.scopes || defaultIdentityConfig.scopes,
      code_verifier: stored.verifier,
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      let message = "Microsoft token exchange failed.";
      try {
        const payload = await response.json();
        message = payload.error_description || payload.error || message;
      } catch {
        message = await response.text();
      }
      throw new Error(message);
    }

    const tokenPayload = await response.json();
    const claims = parseJwt(tokenPayload.id_token);
    if (claims.nonce && stored.nonce && claims.nonce !== stored.nonce) {
      throw new Error("Sign-in nonce did not match. Please try again.");
    }

    const profile = {
      name: claims.name || claims.preferred_username || claims.email || "Microsoft user",
      email: claims.preferred_username || claims.email || "",
      role: "Microsoft 365 user",
      source: "Microsoft Entra ID",
      tenantId: claims.tid || config.tenantId,
      objectId: claims.oid || claims.sub || "",
      signedInAt: new Date().toISOString(),
    };

    if (tokenPayload.access_token) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, tokenPayload.access_token);
    }

    await putSetting("currentUser", profile);
    await putSetting("authError", "");
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    cleanAuthQuery();
    showToast("Signed in with Microsoft.");
  } catch (error) {
    await putSetting("authError", error.message || "Microsoft sign-in failed.");
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    cleanAuthQuery();
  }
}

function cleanAuthQuery() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function createPkceChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseJwt(token) {
  if (!token) return {};
  const [, payload] = token.split(".");
  if (!payload) return {};
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = decodeURIComponent(
    atob(padded)
      .split("")
      .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join(""),
  );
  return JSON.parse(json);
}

function pendingQueue() {
  return state.syncQueue.filter((item) => item.status !== "Synced");
}

function viewAccount(accountId) {
  if (!canAccessView("account-detail")) {
    showToast("Your current role cannot open Sales account records.");
    return;
  }
  state.selectedAccountId = accountId;
  state.selectedSampleId = "";
  state.view = "account-detail";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function viewContact(contactId) {
  if (!canAccessView("contact-detail")) {
    showToast("Your current role cannot open Sales contact records.");
    return;
  }
  state.selectedContactId = contactId;
  state.selectedSampleId = "";
  state.view = "contact-detail";
  render();
  app.focus({ preventScroll: true });
}

function viewOpportunity(opportunityId) {
  if (!canAccessView("opportunity-detail")) {
    showToast("Your current role cannot open Sales opportunity records.");
    return;
  }
  state.selectedOpportunityId = opportunityId;
  state.selectedSampleId = "";
  state.opportunityDetailTab = "summary";
  state.view = "opportunity-detail";
  render();
  app.focus({ preventScroll: true });
}

function viewProject(jobId) {
  if (!canAccessView("project-detail")) {
    showToast("Your current role cannot open Operations project records.");
    return;
  }
  state.selectedProjectId = jobId;
  state.selectedSampleId = "";
  state.view = "project-detail";
  render();
  app.focus({ preventScroll: true });
}

function viewSample(sampleId) {
  if (!canAccessView("sample-detail")) {
    showToast("Your current role cannot open Operations sample records.");
    return;
  }
  const sample = findSample(sampleId);
  const job = sample ? findProject(sample.projectId) : null;
  if (!sample || !job) {
    showToast("That sample record is not available.");
    return;
  }
  state.selectedSampleId = sample.id;
  state.selectedProjectId = job.id;
  state.view = "sample-detail";
  render();
  app.focus({ preventScroll: true });
}

function viewEmployee(employeeId) {
  if (!canAccessView("employee-detail")) {
    showToast("Your current role cannot open workforce records.");
    return;
  }
  if (!findEmployee(employeeId)) {
    showToast("That employee record is not available.");
    return;
  }
  state.selectedEmployeeId = employeeId;
  state.selectedDispatchJobId = "";
  state.view = "employee-detail";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function viewConsumable(itemId) {
  if (!canAccessView("inventory-consumable-detail")) {
    showToast("Your current role cannot open inventory records.");
    return;
  }
  if (!getInventoryItemById(itemId)) {
    showToast("That consumable record is not available.");
    return;
  }
  closeDialogs();
  state.selectedConsumableId = itemId;
  state.selectedEquipmentAssetTag = "";
  state.view = "inventory-consumable-detail";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function viewEquipmentAsset(assetTag) {
  if (!canAccessView("inventory-equipment-detail")) {
    showToast("Your current role cannot open equipment records.");
    return;
  }
  if (!findEquipmentAssetByTag(assetTag)) {
    showToast("That equipment record is not available.");
    return;
  }
  closeDialogs();
  state.selectedEquipmentAssetTag = assetTag;
  state.selectedConsumableId = "";
  state.view = "inventory-equipment-detail";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function viewDispatchJob(jobId) {
  if (!canAccessView("dispatch-job-detail")) {
    showToast("Your current role cannot open dispatch jobs.");
    return;
  }
  if (!findDispatchJob(jobId)) {
    showToast("That job record is not available.");
    return;
  }
  state.selectedDispatchJobId = jobId;
  state.selectedEmployeeId = "";
  state.dispatchJobDetailTab = "summary";
  state.view = "dispatch-job-detail";
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

function viewClientSpill(jobId) {
  if (!canAccessView("client-spill-detail")) {
    showToast("Your current role cannot open client spill records.");
    return;
  }
  const job = findProject(jobId);
  if (!job || !clientCanSeeJob(job)) {
    showToast("That spill is not available for this client login.");
    return;
  }
  state.selectedProjectId = jobId;
  state.selectedSampleId = "";
  state.view = "client-spill-detail";
  render();
  app.focus({ preventScroll: true });
}

function getClientAccountId() {
  return state.currentUser?.clientAccountId || "acct-north-river";
}

function getClientAccount() {
  return findAccount(getClientAccountId());
}

function clientCanSeeJob(job) {
  return Boolean(job && job.accountId === getClientAccountId());
}

function getClientVisibleJobs() {
  const accountId = getClientAccountId();
  return state.projects.filter((job) => job.accountId === accountId);
}

function getClientVisibleAlerts() {
  return getClientVisibleJobs().flatMap((job) => alertsForJob(job.id).filter((alert) => alert.status !== "Resolved"));
}

function getClientVisibleSamples() {
  return getClientVisibleJobs()
    .flatMap((job) => samplesForJob(job.id))
    .sort((a, b) => new Date(b.collectionTime || 0) - new Date(a.collectionTime || 0));
}

function getClientVisibleSpatialData() {
  return getClientVisibleJobs()
    .flatMap((job) => spatialDataForJob(job.id))
    .sort((a, b) => new Date(b.scanDate || 0) - new Date(a.scanDate || 0));
}

function getClientVisibleSchedule() {
  const jobIds = new Set(getClientVisibleJobs().map((job) => job.id));
  return getScheduleEvents()
    .filter((work) => jobIds.has(work.projectId))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function getClientChronology(job) {
  return getProjectChronology(job)
    .filter((event) => !["Material", "Equipment"].includes(event.kind))
    .map((event) => {
      if (event.kind !== "Alert") return event;
      return {
        ...event,
        kind: "Project update",
        meta: (event.meta || []).slice(0, 2),
      };
    });
}

function getClientRecentEvents(limit = 6) {
  return getClientVisibleJobs()
    .flatMap((job) => getClientChronology(job).map((event) => ({ ...event, title: `${job.name}: ${event.title}` })))
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, limit);
}

function getClientSpillMarkers(jobs = getClientVisibleJobs()) {
  const coordinateUse = new Map();
  return jobs.flatMap((job) => {
    const coordinates = getJobMapCoordinates(job);
    if (!coordinates) return [];

    const key = `${Number(coordinates.latitude).toFixed(5)},${Number(coordinates.longitude).toFixed(5)}`;
    const offsetIndex = coordinateUse.get(key) || 0;
    coordinateUse.set(key, offsetIndex + 1);
    const offset = offsetIndex * 0.00018;
    const location = findLocation(job.locationId);

    return [
      {
        projectId: job.id,
        type: getJobMapMarkerType(job),
        label: job.name,
        shortLabel: getInitials(job.name, "SP"),
        latitude: Number(coordinates.latitude) + offset,
        longitude: Number(coordinates.longitude) + offset,
        status: job.status || "Active",
        locationName: location?.name || coordinates.locationName || "Site location",
        sourceLabel: coordinates.sourceLabel,
        targetDate: job.targetDate,
      },
    ];
  });
}

function getJobMapCoordinates(job) {
  const mappedLocation = (state.backend.mapLocations || []).find((location) => {
    if (location.projectId !== job.id) return false;
    return Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  });
  if (mappedLocation) {
    return {
      latitude: Number(mappedLocation.latitude),
      longitude: Number(mappedLocation.longitude),
      locationName: mappedLocation.label || "Mapped site",
      sourceLabel: mappedLocation.source === "OwnTracks" ? "Live GPS point" : "Saved project GPS point",
    };
  }

  const location = findLocation(job.locationId);
  const siteLatitude = Number(location?.latitude);
  const siteLongitude = Number(location?.longitude);
  if (Number.isFinite(siteLatitude) && Number.isFinite(siteLongitude)) {
    return {
      latitude: siteLatitude,
      longitude: siteLongitude,
      locationName: location.name,
      sourceLabel: "Saved site coordinate",
    };
  }

  const jobSampleCoordinates = getAverageCoordinates(samplesForJob(job.id));
  if (jobSampleCoordinates) {
    return {
      ...jobSampleCoordinates,
      locationName: location?.name || "Sampled area",
      sourceLabel: "Centered from this spill's sample GPS points",
    };
  }

  const siteSampleCoordinates = getAverageCoordinates(state.sampleRecords.filter((sample) => sample.locationId === job.locationId));
  if (siteSampleCoordinates) {
    return {
      ...siteSampleCoordinates,
      locationName: location?.name || "Shared site",
      sourceLabel: "Centered from site sample GPS points",
    };
  }

  return null;
}

function getAverageCoordinates(records) {
  const points = records
    .map((record) => ({ latitude: Number(record.latitude), longitude: Number(record.longitude) }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!points.length) return null;
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

function getJobMapMarkerType(job) {
  if (job.jobClass === "Emergency Response") return "emergency";
  if (job.jobClass === "Multi-Stage Remediation") return "remediation";
  return "scheduled";
}

function findAccount(accountId) {
  return state.accounts.find((account) => account.id === accountId);
}

function findContact(contactId) {
  return state.contacts.find((contact) => contact.id === contactId);
}

function findOpportunity(opportunityId) {
  return state.opportunities.find((opportunity) => opportunity.id === opportunityId);
}

function findProject(jobId) {
  return state.projects.find((job) => job.id === jobId);
}

function findSample(sampleId) {
  return state.sampleRecords.find((sample) => sample.id === sampleId);
}

function findLocation(locationId) {
  return state.locations.find((location) => location.id === locationId);
}

function contactsForAccount(accountId) {
  return state.contacts.filter((contact) => contact.accountId === accountId);
}

function locationsForAccount(accountId) {
  return state.locations.filter((location) => location.accountId === accountId);
}

function projectsForAccount(accountId) {
  return state.projects.filter((project) => project.accountId === accountId);
}

function scheduledWorkForAccount(accountId) {
  return state.scheduledWork.filter((work) => work.accountId === accountId);
}

function dispatchJobsForAccount(accountId) {
  return getDispatchJobs()
    .filter((job) => job.accountId === accountId)
    .sort((a, b) => parseDate(b.scheduledStart) - parseDate(a.scheduledStart));
}

function alertsForAccount(accountId) {
  return state.projectAlerts.filter((alert) => alert.accountId === accountId);
}

function materialUsageForAccount(accountId) {
  return state.materialUsage.filter((item) => item.accountId === accountId);
}

function equipmentLogsForAccount(accountId) {
  return state.equipmentLogs.filter((item) => item.accountId === accountId);
}

function sampleRecordsForAccount(accountId) {
  return state.sampleRecords.filter((sample) => sample.accountId === accountId);
}

function spatialDataForAccount(accountId) {
  return state.spatialData.filter((spatial) => spatial.accountId === accountId);
}

function materialUsageForJob(jobId) {
  return state.materialUsage.filter((item) => item.projectId === jobId);
}

function equipmentLogsForJob(jobId) {
  return state.equipmentLogs.filter((item) => item.projectId === jobId);
}

function samplesForJob(jobId) {
  return state.sampleRecords.filter((sample) => sample.projectId === jobId);
}

function spatialDataForJob(jobId) {
  return state.spatialData.filter((spatial) => spatial.projectId === jobId);
}

function assignmentsForJob(jobId) {
  return state.projectAssignments.filter((assignment) => assignment.projectId === jobId);
}

function alertsForJob(jobId) {
  return state.projectAlerts.filter((alert) => alert.projectId === jobId);
}

function opportunitiesForAccount(accountId) {
  return state.opportunities.filter((opportunity) => opportunity.accountId === accountId);
}

function activitiesForAccount(accountId) {
  return state.activities.filter((activity) => activity.accountId === accountId);
}

function activitiesForContact(contactId) {
  return state.activities.filter((activity) => activity.contactId === contactId);
}

function activitiesForOpportunity(opportunityId) {
  return state.activities.filter((activity) => activity.opportunityId === opportunityId);
}

function activitiesForRecord({ accountId = "", contactId = "", opportunityId = "" }) {
  return state.activities.filter(
    (activity) =>
      (accountId && activity.accountId === accountId) ||
      (contactId && activity.contactId === contactId) ||
      (opportunityId && activity.opportunityId === opportunityId),
  );
}

function contactsForOpportunity(opportunityId) {
  return state.contacts.filter((contact) => contact.opportunityIds?.includes(opportunityId));
}

function opportunitiesForContact(contact) {
  return (contact.opportunityIds || []).map(findOpportunity).filter(Boolean);
}

function stakeholdersForOpportunity(opportunityId) {
  return (state.backend.opportunityContacts || []).filter((entry) => entry.opportunityId === opportunityId && !entry.deletedAt);
}

function findCompetitor(competitorId) {
  return (state.backend.competitors || []).find((competitor) => competitor.id === competitorId);
}

function competitorsForOpportunity(opportunityId) {
  return (state.backend.opportunityCompetitors || []).filter((entry) => entry.opportunityId === opportunityId && !entry.deletedAt);
}

function assignmentsForOpportunity(opportunityId, purpose = "") {
  return (state.backend.opportunityAssignments || []).filter(
    (entry) => entry.opportunityId === opportunityId && (!purpose || entry.purpose === purpose) && !entry.deletedAt,
  );
}

function quotesForOpportunity(opportunityId) {
  return (state.backend.quotes || []).filter((quote) => quote.opportunityId === opportunityId && !quote.deletedAt);
}

function formatLocationAddressLine(location) {
  if (!location) return "";
  const cityState = [location.city, location.stateOrProvince].filter(Boolean).join(", ");
  return [location.street1 || location.address, cityState, location.postalCode].filter(Boolean).join(", ");
}

function pricingSourceForOpportunity(opportunityId) {
  const quotes = quotesForOpportunity(opportunityId);
  if (!quotes.length) return "";
  const quote = quotes.find((item) => item.statusCode === "Won") || quotes[quotes.length - 1];
  return `${money(quote.totalAmount)} quoted (${quote.name || "quote"}).`;
}

function tasksForContact(contactId) {
  return state.tasks.filter((task) => task.contactId === contactId && task.status !== "Complete");
}

function salesTasksForContact(contactId) {
  return getSalesTasks()
    .filter((task) => task.contactId === contactId && !task.deletedAt)
    .sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate));
}

function coworkersForContact(contact) {
  return contactsForAccount(contact.accountId).filter((other) => other.id !== contact.id);
}

function connectedContactsForContact(contact) {
  const opportunityIds = new Set(contact.opportunityIds || []);
  const jobIds = new Set(projectsForContact(contact).map((job) => job.id));
  const seen = new Map();
  state.contacts.forEach((other) => {
    if (other.id === contact.id) return;
    const sharedOpportunities = (other.opportunityIds || []).filter((id) => opportunityIds.has(id));
    const sharedJobs = projectsForContact(other).filter((job) => jobIds.has(job.id));
    if (sharedOpportunities.length || sharedJobs.length) {
      seen.set(other.id, { contact: other, sharedOpportunities, sharedJobs });
    }
  });
  return [...seen.values()];
}

function openTasksForAccount(accountId) {
  return state.tasks.filter((task) => task.accountId === accountId && task.status !== "Complete");
}

function nextOpenTaskForAccount(accountId) {
  return openTasksForAccount(accountId)[0];
}

function getAccountCrmSummary(account) {
  const contacts = contactsForAccount(account.id);
  const openOpportunities = opportunitiesForAccount(account.id).filter((opportunity) => opportunity.stage !== "Won");
  const openPipeline = openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value), 0);
  const weightedPipeline = openOpportunities.reduce(
    (sum, opportunity) =>
      sum + Number(opportunity.value) * ((opportunity.probability ?? STAGE_PROBABILITY[opportunity.stage] ?? 0) / 100),
    0,
  );
  const openTasks = openTasksForAccount(account.id);
  const nextTask = openTasks[0];
  const activeAlerts = alertsForAccount(account.id).filter((alert) => alert.status !== "Resolved");
  const health = getAccountHealth(account, openTasks, openOpportunities, activeAlerts);
  const priority =
    openPipeline / 1000 +
    activeAlerts.length * 80 +
    openTasks.filter((task) => daysUntil(task.dueDate) < 0).length * 70 +
    (account.risk === "High" ? 60 : account.risk === "Medium" ? 25 : 0) +
    (daysSince(account.lastContact) > 10 ? 30 : 0);

  return {
    account,
    contacts,
    openOpportunities,
    openPipeline,
    weightedPipeline,
    openTasks,
    nextTask,
    activeAlerts,
    health,
    priority,
  };
}

function getAccountHealth(account, openTasks, openOpportunities, activeAlerts) {
  const hasOverdueTask = openTasks.some((task) => daysUntil(task.dueDate) < 0);
  const staleTouch = daysSince(account.lastContact) > 10;

  if (activeAlerts.some((alert) => alert.severity === "High") || hasOverdueTask) {
    return { label: "Needs action", tone: "high" };
  }
  if (account.risk === "High" || staleTouch || openOpportunities.length > 1) {
    return { label: "Watch closely", tone: "medium" };
  }
  return { label: "On track", tone: "low" };
}

function getProjectGenerator(job) {
  const account = findAccount(job.accountId);
  const location = findLocation(job.locationId);
  const contact = (job.contactIds || []).map(findContact).find(Boolean) || contactsForAccount(job.accountId)[0];
  return {
    name: job.generatorName || account?.name || "Generator not captured",
    siteName: job.generatorSiteName || location?.name || account?.siteName || "Site not captured",
    contactName: job.generatorContactName || contact?.name || account?.contact || "Contact not captured",
    contactPhone: job.generatorContactPhone || contact?.phone || account?.phone || "",
    epaId: job.epaId || account?.epaId || "EPA ID not captured",
    tceqId: job.tceqId || account?.tceqId || "TCEQ ID not captured",
    insuranceContact: job.insuranceContact || account?.insuranceContact || "Insurance contact not captured",
    insuranceCarrier: job.insuranceCarrier || account?.insuranceCarrier || "Carrier not captured",
    claimNumber: job.claimNumber || account?.claimNumber || "Claim not captured",
    serviceProfile:
      job.serviceProfile ||
      [job.serviceType, job.activePhase, account?.concern].filter(Boolean).join(" - ") ||
      "Field service profile not captured",
  };
}

function groupSamplesIntoSessions(samples) {
  const sessionMap = new Map();
  samples.forEach((sample) => {
    const key = sample.samplingSessionId || sample.chainOfCustody || sample.projectId || "session";
    if (!sessionMap.has(key)) {
      sessionMap.set(key, {
        id: key,
        label: sample.samplingSessionName || `Sampling session ${sample.chainOfCustody || sample.collectionTime?.slice(0, 10) || ""}`.trim(),
        labName: sample.labName || "Lab not assigned",
        samples: [],
      });
    }
    sessionMap.get(key).samples.push(sample);
  });
  return Array.from(sessionMap.values()).map((session) => ({
    ...session,
    samples: session.samples.sort((a, b) => new Date(a.collectionTime) - new Date(b.collectionTime)),
  }));
}

function getProjectChronology(job) {
  const events = [];
  getScheduleEvents()
    .filter((work) => work.projectId === job.id)
    .forEach((work) => {
      events.push({
        kind: "Scheduled work",
        title: work.title,
        timestamp: work.date,
        detail: `${work.crew || "Unassigned crew"} - ${work.status || "Scheduled"}`,
        meta: [...(work.equipmentAssetTags || []), ...(work.requiredCertifications || [])],
      });
    });

  alertsForJob(job.id).forEach((alert) => {
    events.push({
      kind: "Alert",
      title: alert.alertType,
      timestamp: alert.reportedAt,
      detail: alert.description,
      meta: [alert.severity, alert.status, alert.reportedBy].filter(Boolean),
      defaultOpen: alert.status !== "Resolved",
    });
  });

  materialUsageForJob(job.id).forEach((item) => {
    events.push({
      kind: "Material",
      title: item.materialType,
      timestamp: item.timestamp,
      detail: `${item.quantity} ${item.unit} logged by ${item.loggedBy}`,
      meta: [item.materialType, item.unit],
    });
  });

  equipmentLogsForJob(job.id).forEach((item) => {
    events.push({
      kind: "Equipment",
      title: `${item.assetTag} - ${item.equipment}`,
      timestamp: item.checkedOut || item.returned,
      detail: `${item.condition || "No condition"} by ${item.user || "Unknown user"}${item.returned ? `, returned ${formatDate(item.returned)}` : ""}`,
      meta: [item.truckId || "No truck", item.condition || "No condition"],
    });
  });

  samplesForJob(job.id).forEach((sample) => {
    events.push({
      kind: "Sample",
      title: sample.sampleId || sample.sampleLocation,
      timestamp: sample.collectionTime,
      detail: `${sample.sampleType} collected by ${sample.collector}. ${sample.labStatus || "No lab status"}`,
      meta: [sample.chainOfCustody, sample.labName, sample.labResults || sample.results].filter(Boolean),
      defaultOpen: true,
    });
  });

  spatialDataForJob(job.id).forEach((spatial) => {
    events.push({
      kind: "LiDAR/spatial",
      title: spatial.fileType,
      timestamp: spatial.scanDate,
      detail: spatial.annotations || spatial.storagePath || "Spatial file uploaded.",
      meta: [spatial.scanQuality, spatial.pointCount, spatial.uploadedBy].filter(Boolean),
    });
  });

  (job.opportunityId ? activitiesForOpportunity(job.opportunityId) : [])
    .slice(0, 6)
    .forEach((activity) => {
      events.push({
        kind: activity.activityType || "Activity",
        title: activity.subject || "Activity",
        timestamp: activity.activityDate || activity.createdAt,
        detail: activity.body || activity.description || "",
        meta: [activity.status, activity.owner || activity.author].filter(Boolean),
      });
    });

  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function getSampleCoordinates(sample) {
  const latitude = Number(sample.latitude);
  const longitude = Number(sample.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  const location = findLocation(sample.locationId);
  const fallbackLatitude = Number(location?.latitude);
  const fallbackLongitude = Number(location?.longitude);
  if (Number.isFinite(fallbackLatitude) && Number.isFinite(fallbackLongitude)) {
    return `${fallbackLatitude.toFixed(5)}, ${fallbackLongitude.toFixed(5)}`;
  }

  return "GPS not captured";
}

function opportunityPriorityScore(item) {
  const closeDays = daysUntil(item.opportunity.closeDate);
  const taskDays = item.nextTask ? daysUntil(item.nextTask.dueDate) : 30;
  return (
    Number(item.opportunity.value) / 1000 +
    (item.account?.risk === "High" ? 80 : item.account?.risk === "Medium" ? 35 : 0) +
    (item.closeStatus.tone === "high" ? 90 : item.closeStatus.tone === "medium" ? 45 : 0) +
    (taskDays < 0 ? 70 : taskDays <= 3 ? 35 : 0) +
    Math.max(0, 30 - closeDays)
  );
}

function getOpportunityProgress(opportunity) {
  const stageIndex = Math.max(0, STAGES.indexOf(opportunity.stage));
  const percent = STAGE_PROBABILITY[opportunity.stage] ?? 15;
  const core = getCoreOpportunity(opportunity);
  const tone = opportunity.stage === "Won" ? "low" : getCloseStatus(core.estimatedCloseDate).tone;
  return { percent, stageIndex, tone };
}

function getCloseStatus(value) {
  return { label: value ? `Close ${formatDate(value)}` : "No close date set", tone: "low" };
}

function daysUntil(value) {
  if (!value) return 999;
  const start = parseDate(todayIso());
  const end = parseDate(value);
  return Math.ceil((end - start) / 86400000);
}

function daysSince(value) {
  if (!value) return 999;
  return Math.max(0, -daysUntil(value));
}

function projectsForContact(contact) {
  const opportunityIds = contact.opportunityIds || [];
  return state.projects.filter(
    (job) =>
      job.contactIds?.includes(contact.id) ||
      (job.opportunityId && opportunityIds.includes(job.opportunityId)) ||
      (job.accountId === contact.accountId && opportunityIds.some((id) => job.opportunityId === id)),
  );
}

function getJobProgress(job) {
  const phaseText = `${job.status} ${job.activePhase}`.toLowerCase();
  let stageIndex = 0;
  if (phaseText.includes("site walk") || phaseText.includes("investigation") || phaseText.includes("planning")) stageIndex = 0;
  else if (phaseText.includes("review") || phaseText.includes("pre-mobilization") || phaseText.includes("scheduled")) stageIndex = 1;
  else if (phaseText.includes("dispatch") || phaseText.includes("stabilization") || phaseText.includes("mobil")) stageIndex = 2;
  else if (phaseText.includes("field") || phaseText.includes("active")) stageIndex = 3;
  else if (phaseText.includes("closeout") || phaseText.includes("complete")) stageIndex = 4;

  const dateProgress = getDateProgress(job.startDate, job.targetDate);
  const phaseProgress = [18, 35, 55, 74, 94][stageIndex] || 20;
  const percent = Math.max(8, Math.min(98, Math.round((dateProgress + phaseProgress) / 2)));
  const alerts = alertsForJob(job.id).filter((alert) => alert.status !== "Resolved");
  const hasHighAlert = alerts.some((alert) => alert.severity === "High");
  const dueSoon = daysUntil(job.targetDate) <= 5;
  const tone = hasHighAlert || daysUntil(job.targetDate) < 0 ? "high" : alerts.length || dueSoon ? "medium" : "low";

  return { percent, stageIndex: Math.min(stageIndex, 4), tone };
}

function isOpsProjectClosed(job) {
  return getJobProgress(job).stageIndex === 4;
}

function getDateProgress(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  const today = parseDate(todayIso());
  const total = Math.max(1, end - start);
  return Math.round(Math.min(100, Math.max(0, ((today - start) / total) * 100)));
}

function buildCalendarDays() {
  const dates = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date();
    date.setDate(date.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    dates.push({
      date: iso,
      label: index === 0 ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date),
      items: [],
    });
  }

  getScheduleEvents().forEach((work) => {
    const day = dates.find((item) => item.date === work.date);
    if (day) {
      day.items.push({
        id: work.projectId,
        kind: "Scheduled",
        title: work.title,
        accountId: findProject(work.projectId)?.accountId || work.accountId,
      });
    }
  });

  state.projects.forEach((job) => {
    const day = dates.find((item) => item.date === job.startDate);
    if (day) {
      day.items.push({
        id: job.id,
        kind: job.jobClass,
        title: job.name,
        accountId: job.accountId,
      });
    }
  });

  return dates;
}

function getMapMarkers() {
  const backendLocations = state.backend.mapLocations || [];
  if (backendLocations.length) {
    return backendLocations.flatMap((location) => {
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

      const job = findProject(location.projectId);
      const ownTracksPing = location.source === "OwnTracks";
      const type =
        ownTracksPing || !job
          ? "asset"
          : job.jobClass === "Emergency Response"
            ? "emergency"
            : job.jobClass === "Multi-Stage Remediation"
              ? "remediation"
              : "scheduled";

      const assetTags = getDisplayAssetTags(location);

      return [
        {
          type,
          id: location.id,
          locationId: location.id,
          label: location.label,
          shortLabel: getMapMarkerShortLabel(location, job),
          latitude,
          longitude,
          status: location.status || job?.status || "Mapped project",
          lastPingAt: location.lastPingAt,
          assetTags,
        },
      ];
    });
  }

  return [];
}

function getMapMarkerShortLabel(location, job) {
  if (location.source === "OwnTracks") return location.trackerId || location.assetTags?.[0] || "GPS";
  if (job) return getInitials(job.name, "PJ");
  return getInitials(location.label, "GPS");
}

function getDisplayAssetTags(location) {
  const label = (location.label || "").trim().toLowerCase();
  return (location.assetTags || [])
    .map((assetTag) => assetTag.trim())
    .filter(Boolean)
    .filter((assetTag) => assetTag.toLowerCase() !== label);
}

function getInitials(value, fallback) {
  const initials = (value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return initials || fallback;
}

function getConsumableStatus() {
  const items = state.backend.inventoryItems?.length ? state.backend.inventoryItems : consumableInventory;
  return items.map((item) => {
    const used = state.materialUsage
      .filter((usage) => usage.materialType.toLowerCase() === item.materialType.toLowerCase())
      .reduce((sum, usage) => sum + Number(usage.quantity || 0), 0);
    const available = Math.max(0, item.onHand - used);
    const status = available <= item.reorderAt ? "Reorder" : available <= item.reorderAt * 1.25 ? "Watch" : "Healthy";
    const tone = status === "Reorder" ? "high" : status === "Watch" ? "medium" : "low";
    return { ...item, used, available, status, tone };
  });
}

function getEquipmentStatus() {
  const assets = state.backend.equipmentAssets?.length ? state.backend.equipmentAssets : equipmentAssets;
  return assets.map((asset) => {
    const relatedLog = state.equipmentLogs.find((log) => log.assetTag === asset.assetTag);
    const statusTone =
      asset.status === "Maintenance hold" || asset.issue ? "high" : daysUntil(asset.maintenanceDue) <= 7 ? "medium" : "low";
    return {
      ...asset,
      lastUsed: relatedLog?.checkedOut?.slice(0, 10) || asset.lastUsed,
      statusTone,
    };
  });
}

function getLaborResources() {
  return getEmployees()
    .filter((employee) => employee.employmentStatus === "Active")
    .map((employee) => ({
      id: employee.id,
      name: employee.displayName || [employee.firstName, employee.lastName].filter(Boolean).join(" "),
      role: employee.jobTitle || "",
      availability: employee.availabilitySummary || "",
      hoursWorked: Number(employee.hoursWorked || 0),
      capacity: Number(employee.capacity || 0),
      certifications: employee.skills || [],
    }));
}

function getPurchaseOrders() {
  return state.backend.purchaseOrders || [];
}

function getInventoryItemById(itemId) {
  const items = state.backend.inventoryItems?.length ? state.backend.inventoryItems : consumableInventory;
  return items.find((item) => item.id === itemId);
}

function getPurchaseOrdersForItem(itemId) {
  return getPurchaseOrders()
    .filter((order) => order.itemId === itemId)
    .sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
}

function findEquipmentAssetByTag(assetTag) {
  return getEquipmentStatus().find((asset) => asset.assetTag === assetTag);
}

function getEquipmentMaintenanceRecords(assetTag) {
  return (state.backend.equipmentMaintenanceRecords || [])
    .filter((record) => record.assetTag === assetTag)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date));
}

function getEquipmentRestockItems(assetTag) {
  return (state.backend.equipmentRestockItems || []).filter((item) => item.assetTag === assetTag);
}

function getEquipmentLogsForAsset(assetTag) {
  return state.equipmentLogs
    .filter((log) => log.assetTag === assetTag)
    .sort((a, b) => parseDate(b.checkedOut) - parseDate(a.checkedOut));
}

function getScheduleEvents() {
  const backendEvents = state.backend.scheduleEvents || [];
  const legacyEvents = state.scheduledWork.map((work) => ({
    id: work.id,
    projectId: work.projectId || state.projects.find((project) => project.opportunityId === work.opportunityId)?.id || "",
    title: work.title,
    date: work.date,
    crew: work.crew,
    equipmentAssetTags: [],
    laborResourceIds: [],
    requiredCertifications: [],
    status: work.status,
    accountId: work.accountId,
  }));
  const backendIds = new Set(backendEvents.map((event) => event.id));
  return [...backendEvents, ...legacyEvents.filter((event) => !backendIds.has(event.id))].sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

function getAddresses() {
  return state.backend.addresses || [];
}

function addressesForAccount(accountId) {
  return getAddresses()
    .filter((address) => address.accountId === accountId && !address.deletedAt)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
}

function getAccountTypes() {
  return state.backend.accountTypes || [];
}

function findAccountType(accountTypeId) {
  return getAccountTypes().find((accountType) => accountType.id === accountTypeId);
}

function getIndustries() {
  return state.backend.industries || [];
}

function findIndustry(industryId) {
  return getIndustries().find((industry) => industry.id === industryId);
}

function getAccountIndustries() {
  return state.backend.accountIndustries || [];
}

function industriesForAccount(accountId) {
  return getAccountIndustries().filter((link) => link.accountId === accountId && !link.deletedAt);
}

function getSubcontractorTypes() {
  return state.backend.subcontractorTypes || [];
}

function findSubcontractorType(subcontractorTypeId) {
  return getSubcontractorTypes().find((type) => type.id === subcontractorTypeId);
}

function getVendorProfiles() {
  return state.backend.vendorProfiles || [];
}

function vendorProfileForAccount(accountId) {
  return getVendorProfiles().find((profile) => profile.accountId === accountId && !profile.deletedAt);
}

function getSalesTasks() {
  return state.backend.salesTasks || [];
}

function salesTasksForAccount(accountId) {
  return getSalesTasks()
    .filter((task) => task.accountId === accountId && !task.deletedAt)
    .sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate));
}

function getAccountRelationshipExtensions() {
  return state.backend.accountRelationshipExtensions || [];
}

function relationshipExtensionForAccount(accountId) {
  return getAccountRelationshipExtensions().find((record) => record.accountId === accountId && !record.deletedAt);
}

function getAccountComments() {
  return state.backend.accountComments || [];
}

function accountCommentsForAccount(accountId) {
  return getAccountComments()
    .filter((comment) => comment.accountId === accountId && !comment.deletedAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getAccountDivisions() {
  return state.backend.accountDivisions || [];
}

function accountDivisionsForAccount(accountId) {
  return getAccountDivisions()
    .filter((division) => division.accountId === accountId && !division.deletedAt)
    .sort((a, b) => a.divisionName.localeCompare(b.divisionName));
}

function findAccountDivision(divisionId) {
  return getAccountDivisions().find((division) => division.id === divisionId);
}

function getContactEmploymentHistory() {
  return state.backend.contactEmploymentHistory || [];
}

function employmentHistoryForContact(contactId) {
  return getContactEmploymentHistory()
    .filter((entry) => entry.contactId === contactId && !entry.deletedAt)
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
}

function getServiceAgreements() {
  return state.backend.serviceAgreements || [];
}

function serviceAgreementsForAccount(accountId) {
  return getServiceAgreements().filter((agreement) => agreement.accountId === accountId && !agreement.deletedAt);
}

function getSubcontractorAssignments() {
  return state.backend.subcontractorAssignments || [];
}

function subcontractorAssignmentsForVendorProfile(vendorProfileId) {
  return getSubcontractorAssignments().filter((assignment) => assignment.vendorProfileId === vendorProfileId && !assignment.deletedAt);
}

function getEmployees() {
  return state.backend.employees || [];
}

function findEmployee(employeeId) {
  return getEmployees().find((employee) => employee.id === employeeId);
}

function getEmployeeCertifications() {
  return state.backend.employeeCertifications || [];
}

function certificationsForEmployee(employeeId) {
  return getEmployeeCertifications()
    .filter((record) => record.employeeId === employeeId)
    .sort((a, b) => credentialPriority(a.status) - credentialPriority(b.status) || parseDate(a.expiresOn) - parseDate(b.expiresOn));
}

function getWorkforceTeams() {
  return state.backend.workforceTeams || [];
}

function findWorkforceTeam(teamId) {
  return getWorkforceTeams().find((team) => team.id === teamId);
}

function getCrewProfiles() {
  return state.backend.crewProfiles || [];
}

function findCrewProfile(crewId) {
  return getCrewProfiles().find((crew) => crew.id === crewId);
}

function getAvailabilityBlocks() {
  return state.backend.availabilityBlocks || [];
}

function availabilityForEmployee(employeeId) {
  return getAvailabilityBlocks().filter((block) => block.employeeId === employeeId);
}

function getFrontlineDevices() {
  return state.backend.frontlineDevices || [];
}

function devicesForEmployee(employeeId) {
  return getFrontlineDevices().filter((device) => device.employeeId === employeeId);
}

function getJobRequests() {
  return state.backend.jobRequests || [];
}

function getJobRequestDocuments() {
  return state.backend.jobRequestDocuments || [];
}

function documentsForJobRequest(jobRequestId) {
  return getJobRequestDocuments()
    .filter((document) => document.jobRequestId === jobRequestId)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

function accountForJobRequest(request) {
  if (!request) return null;
  return (
    findAccount(request.accountId) ||
    state.accounts.find((account) => account.name.trim().toLowerCase() === request.customerName?.trim().toLowerCase()) ||
    null
  );
}

function getDispatchJobs() {
  return state.backend.dispatchJobs || [];
}

function findDispatchJob(jobId) {
  return getDispatchJobs().find((job) => job.id === jobId);
}

function dispatchJobsForProject(projectId) {
  return getDispatchJobs()
    .filter((job) => job.projectId === projectId)
    .sort((a, b) => parseDate(b.scheduledStart) - parseDate(a.scheduledStart));
}

function jobRequestsForProject(projectId) {
  return getJobRequests().filter((request) => request.projectId === projectId);
}

function getJobTypeTemplates() {
  return state.backend.jobTypeTemplates || [];
}

function findJobTypeTemplate(templateId) {
  return getJobTypeTemplates().find((template) => template.id === templateId);
}

function createBlankTemplateDraft() {
  return {
    id: "",
    name: "",
    serviceCategory: "Scheduled",
    description: "",
    isActive: true,
    stages: [
      {
        key: "mobilize",
        name: "Mobilize",
        sequence: 1,
        tasks: [{ key: "accept_dispatch", name: "Acknowledge dispatch", type: "Status transition", assigneeScope: "All assigned workers", required: true, config: {} }],
      },
    ],
  };
}

// Each task type carries its own settings. Normalizing on every read and write means a task
// switched from one type to another never keeps the previous type's stale settings.
function normalizeTaskConfig(type, config = {}) {
  const source = config || {};
  if (type === "Checklist") {
    const options = Array.isArray(source.options) ? source.options : [];
    return { options: options.map((option) => String(option).trim()).filter(Boolean) };
  }
  if (type === "Photo") {
    const minPhotos = Number(source.minPhotos);
    return { minPhotos: Number.isFinite(minPhotos) && minPhotos > 0 ? Math.floor(minPhotos) : 1 };
  }
  if (type === "Material") {
    const ids = Array.isArray(source.suggestedItemIds) ? source.suggestedItemIds : [];
    return { suggestedItemIds: ids.map((id) => String(id).trim()).filter(Boolean) };
  }
  if (type === "Signature") {
    return { signerRole: SIGNATURE_SIGNER_ROLES.includes(source.signerRole) ? source.signerRole : "Customer" };
  }
  if (type === "Timer") {
    return { anchor: TIMER_ANCHORS.some((item) => item.value === source.anchor) ? source.anchor : "en_route" };
  }
  if (type === "Sample") {
    const analyses = Array.isArray(source.defaultAnalyses) ? source.defaultAnalyses : [];
    return {
      defaultMatrix: String(source.defaultMatrix || "").trim(),
      defaultContainer: String(source.defaultContainer || "").trim(),
      defaultAnalyses: analyses.map((item) => String(item).trim()).filter(Boolean),
    };
  }
  return {};
}

function cloneTemplateForEditing(template) {
  return {
    id: template.id,
    name: template.name || "",
    serviceCategory: template.serviceCategory || "Scheduled",
    description: template.description || "",
    isActive: template.isActive !== false,
    stages: (template.stages || []).map((stage, stageIndex) => ({
      key: stage.key || `stage-${stageIndex}`,
      name: stage.name || "",
      sequence: stageIndex + 1,
      tasks: (stage.tasks || []).map((task, taskIndex) => ({
        key: task.key || `task-${stageIndex}-${taskIndex}`,
        name: task.name || "",
        type: task.type || "Checklist",
        assigneeScope: task.assigneeScope || "Any assigned worker",
        required: task.required !== false,
        config: normalizeTaskConfig(task.type || "Checklist", task.config),
      })),
    })),
  };
}

function getJobAssignments() {
  return state.backend.jobAssignments || [];
}

function dispatchAssignmentsForJob(jobId) {
  return getJobAssignments()
    .filter((assignment) => assignment.jobId === jobId && assignment.status !== "Cancelled")
    .sort((a, b) => Number(b.isFieldLead) - Number(a.isFieldLead) || (findEmployee(a.employeeId)?.displayName || "").localeCompare(findEmployee(b.employeeId)?.displayName || ""));
}

function assignmentsForEmployee(employeeId) {
  return getJobAssignments()
    .filter((assignment) => assignment.employeeId === employeeId && !["Complete", "Released", "Cancelled"].includes(assignment.status))
    .sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
}

function getJobScheduleSegments() {
  return state.backend.jobScheduleSegments || [];
}

function resourcesForDispatchJob(jobId) {
  return (state.backend.jobResources || []).filter((resource) => resource.jobId === jobId && resource.status !== "Removed");
}

function getInventoryItems() {
  return state.backend.inventoryItems || [];
}

function findInventoryItem(itemId) {
  return getInventoryItems().find((item) => item.id === itemId);
}

function getJobConflicts() {
  return state.backend.jobConflicts || [];
}

function conflictsForDispatchJob(jobId) {
  return getJobConflicts().filter((conflict) => conflict.jobId === jobId);
}

function stepsForDispatchJob(jobId) {
  return (state.backend.jobSteps || [])
    .filter((step) => step.jobId === jobId)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

function actionsForDispatchStep(stepId) {
  return (state.backend.jobActions || [])
    .filter((action) => action.stepId === stepId)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

function submissionsForDispatchJob(jobId) {
  return (state.backend.jobFormSubmissions || [])
    .filter((submission) => submission.jobId === jobId)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getFilteredDispatchJobs() {
  const jobs = state.dispatchAccountFilter
    ? getDispatchJobs().filter((job) => job.accountId === state.dispatchAccountFilter)
    : getDispatchJobs();
  const filter = state.dispatchJobFilter;
  if (filter === "All") return jobs;
  if (filter === "Open") return jobs.filter((job) => !isTerminalDispatchStatus(job.status));
  if (filter === "Planning") return jobs.filter((job) => ["request_submitted", "dispatch_review", "draft", "ready"].includes(job.status));
  if (filter === "Scheduled") return jobs.filter((job) => ["scheduled", "dispatched"].includes(job.status));
  if (filter === "In field") return jobs.filter((job) => ["acknowledged", "en_route", "on_site", "in_progress", "paused"].includes(job.status));
  if (filter === "Review") return jobs.filter((job) => ["field_complete", "office_review"].includes(job.status));
  if (filter === "Closed") return jobs.filter((job) => isTerminalDispatchStatus(job.status));
  return jobs;
}

function isTerminalDispatchStatus(status) {
  return ["closed", "cancelled"].includes(status);
}

function frontlineJobRegion(job) {
  const parts = String(job.addressText || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "Unspecified";
  const last = parts[parts.length - 1].replace(/\s*\d{5}(-\d{4})?$/, "").trim();
  const city = parts[parts.length - 2];
  return last ? `${city}, ${last}` : city;
}

function frontlineStepUnlocked(step, allSteps) {
  if (step.status === "Complete") return true;
  if (Number(step.sequence) === 1) return true;
  const prior = allSteps.find((candidate) => Number(candidate.sequence) === Number(step.sequence) - 1);
  return !prior || prior.status === "Complete";
}

// Availability is positional rather than driven by the stored status, so a record whose status
// drifted out of sync (an unlocked step whose actions were all left "Not started") stays workable.
function frontlineActionUnlocked(action, stepActions) {
  if (action.status === "Complete") return false;
  const nextUp = stepActions.find((candidate) => candidate.status !== "Complete");
  return nextUp?.id === action.id;
}

function isStepSatisfied(step) {
  const actions = actionsForDispatchStep(step.id).filter((action) => action.required !== false);
  return actions.every((action) => action.status === "Complete");
}

function getWorkPlanGate(job) {
  const transition = job ? getNextDispatchTransition(job.status) : null;
  if (!transition) return { blocked: false };
  const steps = stepsForDispatchJob(job.id);
  if (!steps.length) return { blocked: false };

  if (transition.status === "acknowledged") {
    const pending = actionsForDispatchStep(steps[0].id).find(
      (action) => action.type === "Status transition" && action.status !== "Complete",
    );
    if (pending) {
      return {
        blocked: true,
        viaAction: pending,
        reason: `Complete "${pending.name}" in the work plan to acknowledge this job.`,
      };
    }
  }

  if (transition.status === "in_progress" && steps[0].status !== "Complete") {
    return { blocked: true, reason: `Finish the "${steps[0].name}" step before starting work.` };
  }

  if (transition.status === "field_complete") {
    const outstanding = steps.filter((step) => step.required !== false && step.status !== "Complete");
    if (outstanding.length) {
      return {
        blocked: true,
        reason: `${outstanding.length} work plan step${outstanding.length === 1 ? "" : "s"} still open: ${outstanding.map((step) => step.name).join(", ")}.`,
      };
    }
  }

  return { blocked: false };
}

function getJobReadiness(job) {
  const assignments = dispatchAssignmentsForJob(job.id);
  const resources = resourcesForDispatchJob(job.id);
  const conflicts = conflictsForDispatchJob(job.id).filter((conflict) => conflict.status === "Open");
  const blocking = conflicts.filter((conflict) => conflict.severity === "Blocking");
  const workersBlocked = assignments.filter((assignment) => ["Blocked"].includes(assignment.eligibilityStatus));
  const checks = [
    {
      label: "Job type version",
      status: job.jobType && job.jobTypeVersion ? "Pass" : "Block",
      detail: job.jobType ? `${job.jobType} version ${Number(job.jobTypeVersion || 1)}` : "No published job type selected",
    },
    {
      label: "Schedule window",
      status: job.scheduledStart && job.scheduledEnd ? "Pass" : "Block",
      detail: job.scheduledStart ? `${formatDateTime(job.scheduledStart)} to ${formatShortTime(job.scheduledEnd)}` : "Start and end time required",
    },
    {
      label: "Worker assignments",
      status: assignments.length ? (workersBlocked.length ? "Block" : assignments.some((assignment) => assignment.eligibilityStatus === "Warning") ? "Warning" : "Pass") : "Block",
      detail: assignments.length ? `${assignments.length} workers assigned` : "No employees assigned",
    },
    {
      label: "Resources",
      status: resources.length ? "Pass" : "Warning",
      detail: resources.length ? `${resources.length} resources allocated` : "No equipment or material reserved",
    },
    {
      label: "Open conflicts",
      status: blocking.length ? "Block" : conflicts.length ? "Warning" : "Pass",
      detail: conflicts.length ? `${conflicts.length} open conflict${conflicts.length === 1 ? "" : "s"}` : "No open conflicts",
    },
  ];
  const hasBlock = checks.some((check) => check.status === "Block");
  const hasWarning = checks.some((check) => check.status === "Warning");
  const status = hasBlock ? "Blocked" : hasWarning ? "Warning" : ["in_progress", "on_site", "en_route", "acknowledged"].includes(job.status) ? "In field" : ["field_complete", "office_review"].includes(job.status) ? "Review" : "Ready";
  const summary = hasBlock ? "Resolve blocking checks before dispatch" : hasWarning ? "Dispatcher review recommended" : status === "In field" ? "Job package active in Front Line" : status === "Review" ? "Field package returned for review" : "All required dispatch checks pass";
  return { status, summary, checks };
}

function renderReadinessBadge(status) {
  return `<span class="readiness-badge ${normalizeCssToken(status)}"><span aria-hidden="true"></span>${escapeHtml(status || "Not checked")}</span>`;
}

function renderDispatchStatusBadge(status) {
  return `<span class="dispatch-status-badge ${normalizeCssToken(status)}">${escapeHtml(status || "Not set")}</span>`;
}

function renderDeviceSyncBadge(status) {
  const tone = status === "Healthy" ? "low" : status?.includes("pending") ? "medium" : "high";
  return `<span class="risk-badge ${tone}">${escapeHtml(status || "Unknown")}</span>`;
}

function getReadinessTone(status) {
  if (["Ready", "Valid", "Eligible", "Pass", "Information"].includes(status)) return "low";
  if (["Expiring", "Warning", "Overridden", "Review", "Office"].includes(status)) return "medium";
  return "high";
}

function getPriorityTone(priority) {
  if (priority === "Emergency") return "high";
  if (priority === "High") return "medium";
  return "low";
}

function getAvailabilityTone(type) {
  if (type === "Unavailable") return "high";
  if (["Restricted", "On call"].includes(type)) return "medium";
  return "low";
}

function credentialPriority(status) {
  if (["Expired", "Suspended", "Revoked"].includes(status)) return 0;
  if (status === "Expiring") return 1;
  return 2;
}

function conflictPriority(severity) {
  if (severity === "Blocking") return 0;
  if (severity === "Warning") return 1;
  return 2;
}

function normalizeCssToken(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDispatchStatus(status) {
  return String(status || "not_set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "Not estimated";
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!remainder) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${remainder}m`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function getFileExtension(fileName) {
  const extension = String(fileName || "").split(".").pop();
  return extension && extension !== fileName ? extension.slice(0, 4).toUpperCase() : "FILE";
}

function formatDocumentRole(role) {
  if (role === "customer_packet") return "Customer packet";
  if (role === "quote") return "Quote";
  return formatDispatchStatus(role);
}

function formatShortTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(parseDate(value));
}

function getWorkforceScheduleDates() {
  const days = getDispatchCalendarDays();
  return days.map((day) => ({
    ...day,
    assignments: getJobAssignments()
      .filter((assignment) => assignment.plannedStart?.slice(0, 10) === day.date)
      .sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart)),
  }));
}

function getDispatchCalendarDays() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const scheduledDates = getDispatchJobs()
    .map((job) => job.scheduledStart?.slice(0, 10))
    .filter(Boolean)
    .sort();
  const earliestUpcoming = scheduledDates.find((date) => date >= todayIso());
  if (earliestUpcoming) {
    const candidate = parseDate(earliestUpcoming);
    if (candidate > start) start.setTime(candidate.getTime());
  }

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = localIsoDate(date);
    return {
      date: iso,
      label: index === 0 && iso === todayIso() ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date),
      isToday: iso === todayIso(),
      jobs: getDispatchJobs()
        .filter((job) => job.scheduledStart?.slice(0, 10) === iso)
        .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)),
    };
  });
}

function getNextDispatchTransition(status) {
  const transitions = {
    draft: { status: "ready", label: "Mark ready", dispatchStatus: "Ready to schedule", completionPercent: 0 },
    ready: { status: "scheduled", label: "Confirm schedule", dispatchStatus: "Scheduled", completionPercent: 0 },
    scheduled: { status: "dispatched", label: "Dispatch to Front Line", dispatchStatus: "Sent", completionPercent: 8 },
    dispatched: { status: "acknowledged", label: "Mark acknowledged", dispatchStatus: "Acknowledged", completionPercent: 10 },
    acknowledged: { status: "en_route", label: "Mark en route", dispatchStatus: "En route", completionPercent: 15 },
    en_route: { status: "on_site", label: "Mark on site", dispatchStatus: "On site", completionPercent: 20 },
    on_site: { status: "in_progress", label: "Start work", dispatchStatus: "In field", completionPercent: 25 },
    in_progress: { status: "field_complete", label: "Field complete", dispatchStatus: "Returned", completionPercent: 100 },
    field_complete: { status: "office_review", label: "Start office review", dispatchStatus: "Returned", completionPercent: 100 },
    office_review: { status: "closed", label: "Close job", dispatchStatus: "Closed", completionPercent: 100 },
  };
  return transitions[status] || null;
}

function getOfficeAlerts() {
  const projectAlerts = state.projectAlerts
    .filter((alert) => alert.status !== "Resolved")
    .map((alert) => ({
      group: "Operations",
      owner: alert.notified?.join(", ") || "Project team",
      title: alert.alertType,
      detail: alert.description,
      tone: alert.severity.toLowerCase() === "high" ? "high" : "medium",
    }));
  const consumableAlerts = getConsumableStatus()
    .filter((item) => item.status !== "Healthy")
    .map((item) => ({
      group: "Inventory",
      owner: item.buyer,
      title: `${item.materialType} ${item.status.toLowerCase()}`,
      detail: `${item.available} ${item.unit} available. Reorder point is ${item.reorderAt}.`,
      tone: item.tone,
    }));
  const equipmentAlerts = getEquipmentStatus()
    .filter((asset) => asset.statusTone === "high")
    .map((asset) => ({
      group: "Equipment",
      owner: "Scheduler",
      title: `${asset.assetTag} unavailable`,
      detail: asset.issue || `${asset.equipment} needs review before scheduling.`,
      tone: "high",
    }));
  const financeAlerts = getFinanceRows()
    .filter((row) => row.status === "Past due")
    .map((row) => ({
      group: "Finance",
      owner: row.job.salesLead,
      title: `${row.job.name} past due`,
      detail: `${money(row.pastDue)} needs collections follow-up.`,
      tone: "high",
    }));

  return [...projectAlerts, ...consumableAlerts, ...equipmentAlerts, ...financeAlerts];
}

function getFinanceRows() {
  const invoices = state.backend.invoices || [];
  return state.projects.map((job) => {
    const account = findAccount(job.accountId);
    const opportunity = findOpportunity(job.opportunityId);
    const invoice = invoices.find((item) => item.projectId === job.id);
    const materials = state.materialUsage.filter((item) => item.projectId === job.id);
    const equipment = state.equipmentLogs.filter((item) => item.projectId === job.id);
    const materialCost = materials.reduce((sum, item) => sum + Number(item.quantity || 0) * 42, 0);
    const equipmentCost = equipment.length * 650;
    const laborCost = assignmentsForJob(job.id).length * 1200;
    const expenses = materialCost + equipmentCost + laborCost;
    const quoted = Number(invoice?.quotedAmount || opportunity?.value || job.notToExceed || job.budget || 0);
    const invoicePrep = Number(invoice?.invoiceAmount || Math.max(quoted, expenses * 1.35));
    const lastCommunication = activitiesForAccount(job.accountId)[0];
    const highAlert = alertsForJob(job.id).some((alert) => alert.severity === "High" && alert.status !== "Resolved");
    const pastDue = invoice?.status === "Past due" ? invoice.invoiceAmount : 0;
    const status = invoice?.status || (pastDue ? "Past due" : highAlert ? "Hold" : "Ready");
    const statusTone = pastDue || highAlert ? "high" : "low";

    return {
      job,
      account,
      invoice,
      materials,
      equipment,
      quoted,
      expenses,
      invoicePrep,
      lastCommunication,
      invoiceSignal: highAlert ? "Needs scope review before invoice" : "Ready for invoice prep",
      pastDue,
      status,
      statusTone,
    };
  });
}

function getFinanceSummary(rows = getFinanceRows()) {
  return rows.reduce(
    (summary, row) => ({
      quoted: summary.quoted + row.quoted,
      expenses: summary.expenses + row.expenses,
      invoicePrep: summary.invoicePrep + row.invoicePrep,
      pastDue: summary.pastDue + row.pastDue,
    }),
    { quoted: 0, expenses: 0, invoicePrep: 0, pastDue: 0 },
  );
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso() {
  return localIsoDate(new Date());
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeInput(date) {
  const value = date instanceof Date ? date : parseDate(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function timeInputValue(value) {
  const date = parseDate(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseDate(value));
}

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parseDate(value));
}

function parseDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    showToast("Offline shell could not be registered in this browser.");
  });
}

init().catch((error) => {
  app.innerHTML = `
    <section class="empty-state">
      <h2>CRM could not start</h2>
      <p>${escapeHtml(error.message || error)}</p>
    </section>
  `;
});

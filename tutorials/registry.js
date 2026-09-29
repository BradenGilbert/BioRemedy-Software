// Tour content (Phase 24, 2026-09-28). The engine (tutorials/engine.js) knows nothing about the app;
// every word a tour says is here.
//
// Writing rules (docs/roadmap/phase-24-tutorials.md, "How we explain things"):
//   - one action per step: `do` names the control exactly as the screen labels it
//   - `why` is one business reason, one sentence
//   - glossary terms, never synonyms: Facility (a customer site), Location (a GPS point), Project
//   - targets are data-tour names added to the markup, never structural CSS selectors
// scripts/smoke-browser.py walks every tour here and fails if a target is missing.

// The whole business, lead to invoice. A tour's opening card highlights the part it covers.
export const BUSINESS_CHAIN = ["Lead", "Opportunity", "Site walk", "Quote", "Won", "Project", "Dispatch job", "Field work", "Closeout", "Invoice"];

const chain = (...highlight) => ({ links: BUSINESS_CHAIN, highlight });

export const TUTORIALS = [
  {
    id: "section-sales",
    kind: "section",
    workspace: "sales",
    title: "Sales tour",
    summary: "Where work starts: opportunities, accounts, contacts and the rate card.",
    steps: [
      {
        view: "pipeline",
        title: "Sales is where every job starts",
        chain: chain("Lead", "Opportunity", "Site walk", "Quote", "Won"),
        do: "Every job we run starts here as an opportunity, and moves stage by stage until it is won.",
        why: "A won opportunity becomes a Project, and Operations takes it from there.",
      },
      {
        view: "pipeline",
        target: "section-nav",
        title: "The Sales pages",
        do: "Use these to move between Opportunities, Accounts, Contacts, the Delivery Tracker and the Rate Card.",
        why: "Each page is a different view of the same customer records, so nothing is typed twice.",
      },
      {
        view: "pipeline",
        target: "pipeline-metrics",
        title: "The pipeline at a glance",
        do: "These totals cover every open opportunity: value, proposals out, and anything waiting on you.",
      },
      {
        view: "pipeline",
        target: "pipeline-board",
        title: "One column per stage",
        do: "Opportunities move Lead → Qualify → Develop → Proposal → Negotiation → Won. Open a card to work the deal.",
        why: "A red dot on a card's tab means something is blocking the next stage. Fix it there before you advance.",
      },
      {
        view: "pipeline",
        target: "new-opportunity",
        title: "Starting a deal",
        do: "New opportunity starts one. Pick the account first, then the facility where the work is.",
        why: "Tying the deal to a Facility is what lets the site walk, quote and project find the right address later.",
      },
      {
        view: "accounts",
        target: "accounts-list",
        title: "Accounts",
        do: "Accounts are the companies we work for, and the vendors we buy from. Open one to see its contacts, facilities, projects and files.",
        why: "A Facility is one of the customer's sites. One account can have many.",
      },
      {
        view: "accounts",
        target: "new-account",
        title: "Adding a customer",
        do: "New account adds a company. Search first: most callers are already in here.",
      },
      {
        view: "contacts",
        target: "contacts-list",
        title: "Contacts",
        do: "The people at each account: who decides, who signs, who calls us at 2 a.m.",
        why: "Marking a decision maker on each account is how the pipeline knows who can say yes.",
      },
      {
        view: "sales-race",
        target: "page-header",
        title: "Delivery Tracker",
        do: "Deals you have won, as they move through field work, so you can answer the customer without calling Operations.",
      },
      {
        view: "rate-card",
        target: "page-header",
        title: "Rate Card",
        do: "The 2026 rate sheet. Quotes are priced from here.",
        why: "One price list means every quote and invoice agrees.",
      },
      {
        view: "pipeline",
        target: "tour-button",
        title: "That's Sales",
        do: "Press ? at the top of any page to take its tour again.",
      },
    ],
  },
];

// ---- The other section tours (show-only; the "?" on each workspace header) ------------------------
// Office has none yet: Phase 23 rebuilds that applet, so its tour is written after it ships.
const closing = (view) => ({ view, target: "tour-button", title: "That's the tour", do: "Press ? at the top of any page to take its tour again." });

TUTORIALS.push(
  {
    id: "section-operations",
    kind: "section",
    workspace: "operations",
    title: "Operations tour",
    summary: "Every active project, the spill-call intake, the calendar, the map and the race track.",
    steps: [
      {
        view: "ops-projects",
        title: "Operations runs the projects",
        chain: chain("Project", "Dispatch job", "Field work", "Closeout"),
        do: "Once a deal is won or a spill call comes in, it's a Project, and it's run from here until it's closed.",
        why: "A project holds everything about the engagement; the crews' visits hang off it as dispatch jobs.",
      },
      { view: "ops-projects", target: "section-nav", title: "The Operations pages", do: "All Projects, filtered by Scheduled Work, Emergency Response or Multi-Stage, then the Calendar, the Map and the Race Track." },
      { view: "ops-projects", target: "action:view-project", title: "A project", do: "Open a project to see its tabs: Intake, Plan, Live, Sampling, Files and Report." },
      { view: "ops-emergency", target: "action:open-emergency-intake", title: "Spill calls", do: "New spill call is the one-screen intake: it creates the project and the dispatch job in one go." },
      { view: "ops-calendar", target: "page-header", title: "Calendar", do: "Crews, site walks, emergencies and milestones by day." },
      { view: "ops-map", target: "page-header", title: "Map", do: "Projects and equipment on a map, from stored coordinates and live GPS." },
      { view: "ops-race", target: "page-header", title: "Race Track", do: "Won projects by progress, risk and schedule, so the one falling behind stands out." },
      closing("ops-projects"),
    ],
  },
  {
    id: "section-dispatch",
    kind: "section",
    workspace: "dispatch",
    title: "Jobs & Dispatch tour",
    summary: "Requests in, jobs out: intake, the job register, the board, the week, conflicts and work plans.",
    steps: [
      {
        view: "dispatch-intake",
        title: "Dispatch turns requests into crews",
        chain: chain("Dispatch job", "Field work"),
        do: "Requests arrive in Intake. Dispatch creates the job, picks its work plan, assigns the crew and schedules it.",
      },
      { view: "dispatch-intake", target: "page-header", title: "Intake", do: "Job requests from sales and the office. Create job turns one into a dispatch job; Needs info sends it back with a question." },
      { view: "dispatch-jobs", target: "dispatch-job-register", title: "Jobs", do: "Every dispatch job with its schedule, field lead, readiness and status. Open one to plan resources, message the crew and close it out." },
      { view: "dispatch-board", target: "page-header", title: "Board", do: "Jobs by status, from planning through field return to office review." },
      { view: "dispatch-calendar", target: "page-header", title: "Next 7 Days", do: "Jobs, crews, field leads and readiness, day by day." },
      { view: "dispatch-conflicts", target: "page-header", title: "Conflicts", do: "Expired credentials, time off, double-booking and equipment clashes, before the crew finds out on site." },
      { view: "dispatch-templates", target: ["action:open-template-editor", "page-header"], title: "Job Templates", do: "The work plans: stages and tasks the crew follows on the phone, with the photos and forms each step needs." },
      closing("dispatch-intake"),
    ],
  },
  {
    id: "section-workforce",
    kind: "section",
    workspace: "workforce",
    title: "Workforce tour",
    summary: "People, credentials, teams and crews, availability and standby, workload and field devices.",
    steps: [
      { view: "workforce-directory", title: "The people who do the work", do: "Everyone's record, readiness, credentials and availability, which dispatch checks every time it assigns someone." },
      { view: "workforce-directory", target: ["action:open-employee", "page-header"], title: "Employees", do: "Each employee's record: role, manager, crew, readiness and Front Line access." },
      { view: "workforce-credentials", target: "page-header", title: "Credentials", do: "Certification types are managed once here; each person's certifications expire on a date and warn dispatch before they lapse." },
      { view: "workforce-teams", target: "page-header", title: "Teams and crews", do: "Teams are the org chart. Crews are who goes to the field together, gated by the certifications they share." },
      { view: "workforce-availability", target: "page-header", title: "Availability", do: "Time off and the standby/on-call rotation, which dispatch reads when it assigns." },
      { view: "workforce-schedule", target: "page-header", title: "Schedule", do: "Each person's workload across scheduled, dispatched and active jobs." },
      { view: "workforce-devices", target: "page-header", title: "Devices", do: "The phones and tablets registered to Front Line. Suspend a lost one here." },
      closing("workforce-directory"),
    ],
  },
  {
    id: "section-inventory",
    kind: "section",
    workspace: "inventory",
    title: "Inventory tour",
    summary: "Consumables and reorder points, purchase orders, equipment and its maintenance, and labor capacity.",
    steps: [
      { view: "inventory", title: "What we carry to the job", do: "Stock, equipment health, maintenance and labor capacity, in one place for the buyer and the scheduler." },
      { view: "inventory-consumables", target: ["action:open-purchase-order", "page-header"], title: "Consumables", do: "Stock on hand against reorder points. Start a purchase order from here when something runs low." },
      { view: "inventory-purchase", target: "page-header", title: "Purchase orders", do: "Draft, submitted and received. Receiving an order adds the stock and writes the ledger." },
      { view: "inventory-equipment", target: ["action:open-equipment-asset", "page-header"], title: "Equipment", do: "Every asset's status, last use and maintenance plan, linked to its rate-sheet line so its hours bill correctly." },
      { view: "inventory-labor", target: "page-header", title: "Labor", do: "Technician availability, hours worked and capacity." },
      closing("inventory"),
    ],
  },
  {
    id: "section-finance",
    kind: "section",
    workspace: "finance",
    title: "Finance tour",
    summary: "Quoted against invoiced, itemized invoices from field records, and the QuickBooks export.",
    steps: [
      { view: "finance", title: "From field records to invoice", chain: chain("Closeout", "Invoice"), do: "What was quoted, what the field used, what's been invoiced and what's past due." },
      { view: "finance", target: "page-header", title: "Overview", do: "Quoted, invoiced and past due at a glance." },
      { view: "finance-invoices", target: "action:open-invoice", title: "Invoices", do: "Create invoice drafts an itemized, day-grouped invoice from the field records, priced on the quote's rate sheet." },
      { view: "finance-qbo", target: "page-header", title: "QuickBooks", do: "The export queue: each invoice goes to QuickBooks with its lines." },
      closing("finance"),
    ],
  },
  {
    id: "section-client",
    kind: "section",
    workspace: "client",
    title: "Client Portal tour",
    summary: "What a customer sees when they sign in: their spills, samples, documents and contacts.",
    steps: [
      { view: "client-dashboard", title: "The customer's view", do: "A customer login sees only their own account, and only what's been marked customer-visible." },
      { view: "client-spills", target: "page-header", title: "Spills", do: "Their spill responses and remediation projects, with status." },
      { view: "client-documents", target: "page-header", title: "Samples & documents", do: "Sampling, lab status, site photos and files published for them." },
      { view: "client-contacts", target: "page-header", title: "Contacts", do: "Their contacts, and the BioRemedy lead on each project." },
      closing("client-dashboard"),
    ],
  },
  {
    id: "section-sync",
    kind: "section",
    workspace: "sync",
    topbarViews: ["sync"],
    title: "Identity & Sync tour",
    summary: "Who you're signed in as, users and roles, sessions, the audit log, the training copy and recently deleted.",
    steps: [
      { view: "sync", target: "sync-current-user", title: "Signed in", do: "Who you're signed in as and every role you hold. Settings › Active role narrows you to one role until you sign out." },
      { view: "sync", roles: ["Admin"], target: "sync-users", title: "Users & access", do: "Add people, tick their roles, set a password or link them to their employee record." },
      { view: "sync", roles: ["Admin"], target: "sync-sessions", title: "Sessions", do: "Every signed-in device. Revoke a lost phone here; it's signed out on its next request." },
      { view: "sync", roles: ["Admin"], target: "sync-audit", title: "Audit log", do: "Who changed what, when and from where. It can't be edited." },
      { view: "sync", target: "sync-deleted", title: "Recently deleted", do: "Deleted records and everything that went with them. Restore puts the whole set back." },
    ],
  },
  {
    id: "section-frontline",
    kind: "section",
    workspace: "frontline",
    title: "Front Line tour",
    summary: "The phone app: My Day, the clock, the library and the outbox.",
    steps: [
      { title: "The phone app", do: "Front Line is what the crew and sales use in the field: today's work, the clock, capture, and the manuals." },
      {
        target: ["sel:[data-workspace=frontline]", "sel:#frontlineFieldLeadSelect"],
        title: "Open it",
        do: "On a phone you're signed in already. On a computer, open Front Line, pick a field lead and press Enter.",
        waitFor: "until",
        until: (ctx) => ctx.view === "field-home",
        auto: [{ click: "sel:[data-workspace=frontline]" }, { select: ["sel:#frontlineFieldLeadSelect", "label:Logan"] }, { click: "action:frontline-login" }],
      },
      { target: ["field:field-open-job", "field:field-clock-in"], title: "My Day", do: "Today's jobs, site walks and standby, with Coming up underneath. Tap a job to open it." },
      { target: ["field:field-clock-in", "field:field-clock-out"], title: "Your clock", do: "Clock in and out, and log travel. Hours land on the job and the timesheet." },
      { target: ["view:field-library", "view:field-outbox"], title: "More", do: "Messages, Time, Forms, Manuals & Training and Sync. Anything saved offline waits in Sync until you have signal." },
    ],
  },
);

// ---- Detail-page tours (the "?" in the top bar on a record's page) --------------------------------
// `startFrom` tells scripts/build-user-guide.mjs which record to open first (the first one).
const tabStep = (action, tab, title, text) => ({ tab: { action, tab }, target: `tab:${action}:${tab}`, title, do: text });

TUTORIALS.push(
  {
    id: "detail-opportunity",
    kind: "section",
    topbarViews: ["opportunity-detail"],
    startFrom: { view: "opportunity-detail", key: "selectedOpportunityId", collection: "opportunities" },
    title: "Opportunity page tour",
    summary: "The stage ladder and the five tabs of an opportunity.",
    steps: [
      { target: "opportunity-stage-ladder", title: "Where the deal is", do: "The stage ladder. Advance moves it on when the next stage's gate is met; a red dot on a tab shows what's missing." },
      tabStep("switch-opportunity-tab", "summary", "Summary", "Amount, forecast, the core facts and the timeline of calls, meetings and emails."),
      tabStep("switch-opportunity-tab", "lead-qualification", "Lead & Qualification", "Where, what, why now, the budget, the time frame and who decides."),
      tabStep("switch-opportunity-tab", "develop-planning", "Develop & Planning", "The site walk, stakeholders, competitors, needs lists and the scope summary."),
      tabStep("switch-opportunity-tab", "proposal-documents", "Proposal & Documents", "Quotes, estimates, the paperwork the office reviews, and the sign-off that makes it Won."),
      tabStep("switch-opportunity-tab", "files-activity", "Files & Activity", "Every file and every activity on the deal."),
    ],
  },
  {
    id: "detail-account",
    kind: "section",
    topbarViews: ["account-detail"],
    startFrom: { view: "account-detail", key: "selectedAccountId", collection: "accounts" },
    title: "Account page tour",
    summary: "What each tab of a customer's page holds.",
    steps: [
      tabStep("switch-account-tab", "summary", "Summary", "The account at a glance: pipeline, projects, alerts and what's next."),
      tabStep("switch-account-tab", "contacts", "Contacts", "The people at this company and their roles."),
      tabStep("switch-account-tab", "projects", "Projects", "Every project for this customer, past and present."),
      tabStep("switch-account-tab", "files", "Files", "The customer packet, MSA, COIs and anything else on file, with what's still awaiting review."),
      tabStep("switch-account-tab", "facilities-locations", "Locations & Addresses", "Facilities (their sites), addresses (billing and mailing) and GPS locations: three different things."),
      tabStep("switch-account-tab", "vendor-subcontractor", "Vendor & Subcontractor", "When the account is a vendor or subcontractor: its profile, insurance and approvals."),
    ],
  },
  {
    id: "detail-contact",
    kind: "section",
    topbarViews: ["contact-detail"],
    startFrom: { view: "contact-detail", key: "selectedContactId", collection: "contacts" },
    title: "Contact page tour",
    summary: "What each tab of a person's page holds.",
    steps: [
      tabStep("switch-contact-tab", "summary", "Summary", "Who they are, how to reach them, and the latest activity."),
      tabStep("switch-contact-tab", "communications", "Communications", "Calls, meetings and emails with them."),
      tabStep("switch-contact-tab", "opportunities", "Opportunities", "Deals they're part of, and their role on each (decision maker, champion...)."),
      tabStep("switch-contact-tab", "relationships", "Relationships", "Who they know, and where they worked before."),
    ],
  },
  {
    id: "detail-project",
    kind: "section",
    topbarViews: ["project-detail"],
    startFrom: { view: "project-detail", key: "selectedProjectId", collection: "projects" },
    title: "Project page tour",
    summary: "Intake, Plan, Live, Sampling, Files and Report.",
    steps: [
      tabStep("switch-project-tab", "intake", "Intake", "What sales scoped and the customer paperwork; for a spill call, the intake and whether we can mobilize."),
      tabStep("switch-project-tab", "plan", "Plan", "Resources, the job requests to dispatch, and the site walk."),
      tabStep("switch-project-tab", "live", "Live", "What's happening in the field, in order: jobs, photos, alerts, usage."),
      tabStep("switch-project-tab", "sampling", "Sampling", "Samples, the lab and the results."),
      tabStep("switch-project-tab", "files", "Files", "Every document on the project and on the opportunity it came from."),
      tabStep("switch-project-tab", "report", "Report", "The post-work report and, once it's closed, the cost report."),
    ],
  },
  {
    id: "detail-dispatch-job",
    kind: "section",
    topbarViews: ["dispatch-job-detail"],
    startFrom: { view: "dispatch-job-detail", key: "selectedDispatchJobId", collection: "dispatchJobs" },
    title: "Dispatch job page tour",
    summary: "Summary, details, plan & resources, messages and close-out.",
    steps: [
      tabStep("switch-dispatch-job-tab", "summary", "Summary", "Status, schedule, field lead and readiness."),
      tabStep("switch-dispatch-job-tab", "assignment", "Plan & resources", "Crew, equipment, materials and subcontractors, with a credential and equipment check."),
      tabStep("switch-dispatch-job-tab", "messages", "Messages", "The thread with the crew on the phone."),
      tabStep("switch-dispatch-job-tab", "closeout", "Close-out", "The day's narrative, the post-job review and what goes to billing."),
    ],
  },
);

// ---- Hands-on process tutorials (run on the training copy) ----------------------------------------
// Each is a Tutorials-shelf library item on live (`libraryItemId`); finishing it there is the
// acknowledgement. `auto` on a hands-on step is what scripts/build-user-guide.mjs does in the
// person's place, so the smoke test proves every tutorial still completes.
const PRACTICE = "Guide practice";

TUTORIALS.push({
  id: "process-win-job",
  kind: "process",
  title: "Win a job",
  summary: "Customer, facility, opportunity, the stage gates, the site walk and the quote: lead to project.",
  roles: ["Sales Manager", "Account Manager"],
  libraryItemId: "library-tutorials-win-job",
  steps: [
    {
      view: "accounts",
      title: "From lead to project",
      chain: chain("Lead", "Opportunity", "Site walk", "Quote", "Won", "Project"),
      do: "You'll add a practice customer and its facility, open an opportunity, move it one stage, schedule the site walk and price a quote. This is the training copy: nothing you make here is real.",
      why: "Every scheduled job takes this path before Operations sees it.",
    },
    {
      view: "accounts",
      target: "new-account",
      title: "Add the customer",
      do: "Press New account.",
      why: "On live, search first: most callers are already in here.",
      waitFor: "dialog:accountDialog",
      auto: [{ click: "new-account" }],
    },
    {
      target: "dialog:accountDialog",
      title: "Name the company",
      do: "Type a company name that starts with your name (\"Sam's practice customer\"), then press Save account. Everything else can wait.",
      waitFor: "created:accounts",
      auto: [{ fill: ["sel:#accountDialog [name=name]", `${PRACTICE} customer`] }, { click: "sel:#accountDialog button[type=submit]" }],
    },
    {
      target: "tab:switch-account-tab:facilities-locations",
      title: "The account page",
      do: "This is the customer's page. Open Locations & Addresses to add the site where the work is.",
      waitFor: "click",
      auto: [{ click: "tab:switch-account-tab:facilities-locations" }],
    },
    {
      target: "action:open-facility",
      title: "Add a facility",
      do: "Press Add next to Facilities.",
      why: "A Facility is one of the customer's physical sites. The site walk, the quote and the crew all find the address through it.",
      waitFor: "dialog:accountFacilityDialog",
      auto: [{ click: "action:open-facility" }],
    },
    {
      target: "dialog:accountFacilityDialog",
      title: "Describe the site",
      do: "Give the facility a name (\"South yard\"), choose a category, add the street address if you have one, and press Save facility.",
      waitFor: "created:facilities",
      auto: [
        { fill: ["sel:#accountFacilityDialog [name=name]", `${PRACTICE} yard`] },
        { select: ["sel:#accountFacilityDialog [name=category]", "Job Site / Field Location"] },
        { click: "sel:#accountFacilityDialog button[type=submit]" },
      ],
    },
    {
      target: "sel:#quickActions .create-menu summary",
      title: "Open an opportunity",
      do: "Open + Create at the top and choose Opportunity.",
      why: "Starting from the account fills the account in for you.",
      waitFor: "dialog:opportunityDialog",
      auto: [{ click: "sel:#quickActions .create-menu summary" }, { click: "sel:#quickActions [data-action=open-opportunity]" }],
    },
    {
      target: "dialog:opportunityDialog",
      title: "The deal",
      do: "Name the work (\"Tank farm cleanup\"), set an estimated value, pick the opportunity type, write the next step, and press Save opportunity.",
      waitFor: "created:opportunities",
      auto: [
        { fill: ["sel:#opportunityDialog [name=name]", `${PRACTICE} cleanup`] },
        { fill: ["sel:#opportunityDialog [name=value]", "42000"] },
        { select: ["sel:#opportunityDialog [name=serviceType]", "@first"] },
        { fill: ["sel:#opportunityDialog [name=nextStep]", "Call to book the site walk"] },
        { click: "sel:#opportunityDialog button[type=submit]" },
      ],
    },
    {
      target: "opportunity-stage-ladder",
      title: "The stage ladder",
      do: "The deal starts at Lead. Each stage has a short list of things that must be known before it can move on.",
      why: "The gates are what keep a deal from reaching Operations half-scoped.",
    },
    {
      target: "action:advance-opportunity",
      title: "Try to advance",
      do: "Press Advance. It will stop you and say what's missing.",
      waitFor: "click",
      auto: [{ click: "action:advance-opportunity" }],
    },
    {
      target: "tab:switch-opportunity-tab:lead-qualification",
      title: "Follow the red dot",
      do: "A red dot marks the tab that holds what's missing. Open Lead & Qualification.",
      waitFor: "click",
      auto: [{ click: "tab:switch-opportunity-tab:lead-qualification" }],
    },
    {
      target: "action:open-opportunity-lead",
      title: "Fill in the lead details",
      do: "Press Edit on Lead details. Choose the facility, the industry, and write a line each for contamination, description and current situation. Save, then press Advance again. This moves on when the deal reaches Qualify.",
      why: "Qualify means we know where, what and why now. That's what the next person needs.",
      waitFor: "until",
      until: (ctx) => ctx.record("opportunities")?.stage === "Qualify",
      auto: [
        { click: "action:open-opportunity-lead" },
        { select: ["sel:#opportunityLeadDialog [name=facilityId]", "@first"] },
        { select: ["sel:#opportunityLeadDialog [name=industry]", "@first"] },
        { fill: ["sel:#opportunityLeadDialog [name=contaminationNotes]", "Diesel staining around the fuel island"] },
        { fill: ["sel:#opportunityLeadDialog [name=description]", "Soil cleanup around the fuel island"] },
        { fill: ["sel:#opportunityLeadDialog [name=currentSituation]", "State inspection next month"] },
        { click: "sel:#opportunityLeadDialog button[type=submit]" },
        { wait: 800 },
        { click: "action:advance-opportunity" },
      ],
    },
    {
      target: "tab:switch-opportunity-tab:develop-planning",
      title: "Plan the site walk",
      do: "Open Develop & Planning.",
      waitFor: "click",
      auto: [{ click: "tab:switch-opportunity-tab:develop-planning" }],
    },
    {
      target: "action:quick-schedule-site-walk",
      title: "Schedule it",
      do: "Press Schedule next to Site walk.",
      why: "The walk lands on the calendar and on the phone of whoever does it, with the facility's address.",
      waitFor: "dialog:siteWalkDialog",
      auto: [{ click: "action:quick-schedule-site-walk" }],
    },
    {
      target: "dialog:siteWalkDialog",
      title: "When and who",
      do: "Pick a day and times, tick who from BioRemedy is going, add a note on access or PPE, and press Schedule site walk.",
      why: "Everyone ticked gets the walk on their calendar and on Front Line.",
      waitFor: "created:scheduleEvents",
      auto: [
        { fill: ["sel:#siteWalkDialog [name=date]", "@today"] },
        { fill: ["sel:#siteWalkDialog [name=startTime]", "09:00"] },
        { fill: ["sel:#siteWalkDialog [name=endTime]", "10:00"] },
        { click: "sel:#siteWalkDialog [name=participantEmployeeIds]" },
        { click: "sel:#siteWalkDialog button[type=submit]" },
      ],
    },
    {
      target: "tab:switch-opportunity-tab:proposal-documents",
      title: "Price it",
      do: "Open Proposal & Documents.",
      waitFor: "click",
      auto: [{ click: "tab:switch-opportunity-tab:proposal-documents" }],
    },
    {
      target: "action:open-opportunity-quote",
      title: "The quote",
      do: "Press Add quote. Lines come from the 2026 rate sheet, and the tier (Standard, OT & Emergency, Double Time), minimums, fuel surcharge and fees are worked out for you. Close it when you've had a look.",
      why: "One price list means the quote, the invoice and the job cost all agree.",
    },
    {
      target: "tab:switch-opportunity-tab:proposal-documents",
      title: "Negotiation and Won",
      do: "Negotiation needs the approved customer packet and waste authorization (Files, reviewed by the office), the proposal steps and the quote. Won needs the signed paperwork.",
      why: "Marking it Won offers to create the Project, carrying everything sales scoped over to Operations.",
    },
    {
      target: "home-learn",
      view: "home",
      title: "Done",
      finish: true,
      do: "That's the path from a phone call to a project. Open the live app to record that you've done this tutorial.",
    },
  ],
});

TUTORIALS.push({
  id: "process-spill-call",
  kind: "process",
  title: "Take a spill call",
  summary: "One form on the phone with the caller creates the project and the dispatch job, and decides whether we can roll.",
  roles: ["Operations Manager", "Office Manager", "Scheduler"],
  libraryItemId: "library-tutorials-spill-call",
  steps: [
    {
      view: "ops-emergency",
      title: "Spill calls skip the pipeline",
      chain: chain("Project", "Dispatch job", "Field work"),
      do: "An emergency doesn't wait for a quote. One intake form, filled in while you're on the phone, creates the project and the dispatch job together.",
      why: "The crew can be rolling minutes after the call, with everything the caller said on the job.",
    },
    {
      view: "ops-emergency",
      target: "action:open-emergency-intake",
      title: "Start the intake",
      do: "Press New spill call.",
      waitFor: "dialog:emergencyIntakeDialog",
      auto: [{ click: "action:open-emergency-intake" }],
    },
    {
      target: "dialog:emergencyIntakeDialog",
      title: "Fill it in with the caller",
      do: "Work top to bottom: who's calling and their number, the customer (or a new name), where the spill is, what spilled and how much, who pays, and who to send. Press Create project and dispatch job.",
      why: "Mobilization is gated on who pays: an existing account, an insurance claim with a policy on file, a $15,000+ down payment, or a Director of Sales override.",
      waitFor: "created:projects",
      auto: [
        { fill: ["sel:#emergencyIntakeDialog [name=callerName]", `${PRACTICE} caller`] },
        { fill: ["sel:#emergencyIntakeDialog [name=callerPhone]", "512-555-0100"] },
        { select: ["sel:#emergencyIntakeDialog [name=accountId]", "@first"] },
        { fill: ["sel:#emergencyIntakeDialog [name=addressText]", "1200 Industrial Blvd, Georgetown TX"] },
        { fill: ["sel:#emergencyIntakeDialog [name=spillMaterial]", "Hydraulic oil"] },
        { fill: ["sel:#emergencyIntakeDialog [name=spillQuantity]", "about 20 gallons"] },
        { click: "sel:#emergencyIntakeDialog button[type=submit]" },
      ],
    },
    {
      target: "project-mobilization",
      title: "Can we roll?",
      do: "The intake decides: Cleared to mobilize, or blocked with the reason. It changes when the payment side changes.",
    },
    {
      target: "project-paperwork",
      title: "The paperwork follows",
      do: "The customer packet, waste authorization and MSA are requested automatically. The office chases and reviews them.",
      why: "Work can start on an emergency, but we still need the signatures to get paid.",
    },
    {
      view: "dispatch-jobs",
      target: "dispatch-job-register",
      title: "The job is on the board",
      do: "The dispatch job is already in the register, with its field lead and crew, and on their phones.",
    },
    {
      view: "home",
      target: "home-learn",
      title: "Done",
      finish: true,
      do: "That's a spill call from phone to crew. Open the live app to record that you've done this tutorial.",
    },
  ],
});

TUTORIALS.push({
  id: "process-plan-dispatch",
  kind: "process",
  title: "Plan and dispatch a job",
  summary: "From a project to a scheduled dispatch job with a crew: request, create the job, assign, schedule.",
  roles: ["Operations Manager", "Scheduler"],
  libraryItemId: "library-tutorials-plan-dispatch",
  steps: [
    {
      view: "ops-projects",
      title: "From project to crew",
      chain: chain("Project", "Dispatch job", "Field work"),
      do: "A project is the whole engagement. Each visit a crew makes is a dispatch job. You'll request one, create it, give it a crew and schedule it.",
      why: "Splitting the two lets one project have many days, crews and templates without losing its history.",
    },
    {
      view: "ops-projects",
      target: "action:view-project",
      title: "Open a project",
      do: "Open any project (Open on its row).",
      waitFor: "route:project-detail",
      auto: [{ click: "action:view-project" }],
    },
    {
      target: "action:open-job-request",
      title: "Request dispatch",
      do: "Press New job request (or Push to dispatch).",
      why: "A request is how anyone, sales included, asks Dispatch for a crew without booking one themselves.",
      waitFor: "dialog:jobRequestDialog",
      auto: [{ click: "action:open-job-request" }],
    },
    {
      target: "dialog:jobRequestDialog",
      title: "What's needed",
      do: "Set when the service is wanted, the onsite contact and their phone, check the address, describe the work, and press Send to dispatch.",
      why: "Dispatch can't create a job without a time, a person to meet on site, and an address.",
      waitFor: "created:jobRequests",
      auto: [
        { fill: ["sel:#jobRequestDialog [name=requestedServiceAt]", "@todayT08:00"] },
        { fill: ["sel:#jobRequestDialog [name=onsiteContactName]", `${PRACTICE} contact`] },
        { fill: ["sel:#jobRequestDialog [name=onsiteContactPhone]", "512-555-0101"] },
        { fill: ["sel:#jobRequestDialog [name=addressText]", "1200 Industrial Blvd, Georgetown TX"] },
        { fill: ["sel:#jobRequestDialog [name=description]", `${PRACTICE}: confirmation sampling after excavation`] },
        { click: "sel:#jobRequestDialog button[type=submit]" },
      ],
    },
    {
      view: "dispatch-intake",
      target: "action:convert-job-request",
      title: "Dispatch picks it up",
      do: "Requests land in Jobs & Dispatch › Intake. Press Create job on yours (newest first).",
      waitFor: "dialog:jobTemplateSelectDialog",
      auto: [{ click: "action:convert-job-request" }],
    },
    {
      target: "dialog:jobTemplateSelectDialog",
      title: "Choose a work plan",
      do: "Pick the job template. Its stages and tasks become the crew's checklist on the phone.",
      why: "The template is what gates the crew's work: the right steps, forms and photos, in order.",
      waitFor: "created:dispatchJobs",
      auto: [{ click: 'sel:#jobTemplateSelectDialog [data-action="select-job-template"]:not([data-template-id=""])' }],
    },
    {
      target: "tab:switch-dispatch-job-tab:assignment",
      title: "The dispatch job",
      do: "This is the job. Open its assignment tab.",
      waitFor: "click",
      auto: [{ click: "tab:switch-dispatch-job-tab:assignment" }],
    },
    {
      target: "action:open-dispatch-assign-employee",
      title: "Add the crew",
      do: "Press the add-employee button, pick someone and assign them.",
      why: "Credentials are checked as you assign: an expired HAZWOPER shows a warning before they're on site.",
      waitFor: "created:jobAssignments",
      auto: [
        { click: "action:open-dispatch-assign-employee" },
        { select: ["sel:#dispatchAssignEmployeeDialog [name=employeeId]", "@first"] },
        { click: "sel:#dispatchAssignEmployeeDialog button[type=submit]" },
      ],
    },
    {
      target: "action:open-job-schedule",
      title: "Schedule it",
      do: "Press Schedule, pick the day, times and field lead, and save.",
      waitFor: "created:jobScheduleSegments",
      auto: [
        { click: "action:open-job-schedule" },
        { fill: ["sel:#dispatchScheduleDialog [name=date]", "@today"] },
        { select: ["sel:#dispatchScheduleDialog [name=fieldLeadEmployeeId]", "@first"] },
        { click: "sel:#dispatchScheduleDialog button[type=submit]" },
      ],
    },
    {
      view: "dispatch-conflicts",
      target: "page-header",
      title: "Conflicts",
      do: "Anyone double-booked, on leave, or missing a credential for a job shows up here.",
    },
    {
      view: "dispatch-board",
      target: "page-header",
      title: "The board",
      do: "The board is every job by day and status, so you can see the week at once.",
    },
    {
      view: "home",
      target: "home-learn",
      title: "Done",
      finish: true,
      do: "That's a job planned and dispatched. Open the live app to record that you've done this tutorial.",
    },
  ],
});

TUTORIALS.push({
  id: "process-field-job",
  kind: "process",
  surface: "phone",
  title: "Run a job on your phone",
  summary: "My Day, the job page, moving the job along, safety, the work steps and closing out.",
  roles: ["Field Lead", "Crew"],
  libraryItemId: "library-tutorials-app-basics",
  steps: [
    {
      title: "Your day on the phone",
      chain: chain("Dispatch job", "Field work", "Closeout"),
      do: "Front Line is the phone app. It shows your jobs for the day, and everything you record goes straight onto the job.",
      why: "No paper to re-type: the office sees photos, hours and materials as you save them.",
    },
    {
      target: ["sel:[data-workspace=frontline]", "sel:#frontlineFieldLeadSelect"],
      title: "Open Front Line",
      do: "On your phone you're already signed in; this step moves on by itself. On a computer, open Front Line, pick a field lead and press Enter.",
      waitFor: "until",
      until: (ctx) => ctx.view === "field-home" || ctx.view === "field-job",
      auto: [
        { click: "sel:[data-workspace=frontline]" },
        { select: ["sel:#frontlineFieldLeadSelect", "label:Logan"] },
        { click: "action:frontline-login" },
      ],
    },
    {
      target: "field:field-open-job",
      title: "My Day",
      do: "Your jobs, walks and clock are here. Tap a job.",
      waitFor: "until",
      until: (ctx) => ctx.view === "field-job",
      auto: [{ click: "field:field-open-job" }],
    },
    {
      target: "tab:field-job-tab:brief",
      title: "Brief",
      do: "Where, who and what: the address, the customer contact, the scope and the crew.",
    },
    {
      target: "field:field-advance-job",
      title: "Move the job along",
      do: "This bar moves the job: Acknowledge, En route, On site, Start work, Field complete. The office sees each step as you press it.",
      why: "It's how dispatch knows where every crew is without calling.",
    },
    {
      target: "tab:field-job-tab:safety",
      title: "Safety first",
      do: "Open Safety: the day's briefing and JSA, and roll call. Everyone on site signs before work starts.",
      waitFor: "click",
      auto: [{ click: "tab:field-job-tab:safety" }],
    },
    {
      target: "tab:field-job-tab:work",
      title: "The work",
      do: "Open Work: the job's steps from its work plan. Photos, samples, materials, equipment and waste are recorded on the step they belong to.",
      waitFor: "click",
      auto: [{ click: "tab:field-job-tab:work" }],
    },
    {
      target: "field:field-quick-photo",
      title: "Always one tap away",
      do: "Photo, Video and Note are always here.",
      why: "No signal? It waits in the outbox and sends itself when you're back in range.",
    },
    {
      target: "tab:field-job-tab:close",
      title: "Close out (field lead)",
      do: "Close is where the lead gets the customer's signature and checks the billables before Field complete.",
    },
    {
      title: "Done",
      finish: true,
      do: "That's a job from My Day to Field complete. Open the live app to record that you've done this tutorial.",
    },
  ],
});

TUTORIALS.push({
  id: "process-site-walk",
  kind: "process",
  title: "Do a site walk",
  summary: "Schedule a walk, then do it on Front Line: check in, walk the sections, pin the map, finish.",
  roles: ["Sales Manager", "Account Manager", "Field Lead"],
  libraryItemId: "library-tutorials-site-walk",
  steps: [
    {
      view: "pipeline",
      title: "The site walk",
      chain: chain("Opportunity", "Site walk", "Quote"),
      do: "A walk is scheduled on the opportunity, done on the phone at the site, and filed back on the opportunity: photos, map pins, measurements and notes.",
      why: "What sales sees on the walk is what the quote, the plan and the crew work from.",
    },
    {
      view: "pipeline",
      target: "pipeline-board",
      title: "Pick a deal",
      do: "Open an opportunity in Develop (your practice deal from Win a job is fine).",
      waitFor: "route:opportunity-detail",
      auto: [{ click: "sel:.pipeline-board [data-action=view-opportunity]" }],
    },
    {
      target: "tab:switch-opportunity-tab:develop-planning",
      title: "Develop & Planning",
      do: "Open Develop & Planning.",
      waitFor: "click",
      auto: [{ click: "tab:switch-opportunity-tab:develop-planning" }],
    },
    {
      target: "action:quick-schedule-site-walk",
      title: "Schedule it for today",
      do: "Press Schedule next to Site walk, set today's date, tick yourself (on the simulator, tick Logan), and press Schedule site walk.",
      waitFor: "created:scheduleEvents",
      auto: [
        { click: "action:quick-schedule-site-walk" },
        { fill: ["sel:#siteWalkDialog [name=date]", "@today"] },
        { fill: ["sel:#siteWalkDialog [name=startTime]", "07:00"] },
        { fill: ["sel:#siteWalkDialog [name=endTime]", "08:00"] },
        { click: "sel:#siteWalkDialog [name=participantEmployeeIds][value=emp-logan]" },
        { click: "sel:#siteWalkDialog button[type=submit]" },
      ],
    },
    {
      view: "home",
      target: ["sel:[data-workspace=frontline]"],
      title: "Now on the phone",
      do: "Open Front Line (on a computer, pick the person you ticked and press Enter). The walk is on My Day.",
      waitFor: "until",
      until: (ctx) => ctx.view === "field-home",
      auto: [
        { click: "sel:[data-workspace=frontline]" },
        { select: ["sel:#frontlineFieldLeadSelect", "label:Logan"] },
        { click: "action:frontline-login" },
      ],
    },
    {
      target: ["field:walk-open", "field:field-open-walk"],
      title: "Open the walk",
      do: "Tap today's walk under Site walks.",
      waitFor: "until",
      until: (ctx) => ctx.view === "field-walk",
      auto: [{ click: ["field:walk-open", "field:field-open-walk"] }],
    },
    {
      target: "field:walk-check-in",
      title: "Check in",
      do: "Press Check in when you're on site. It records the time and your GPS and starts the walk clock.",
      why: "The check-in is the proof we were there, and when.",
    },
    {
      target: "tab:walk-tab:walk",
      title: "Walk the sections",
      do: "Open Walk: each section asks for its photos and notes. Tap a photo to mark it up.",
      waitFor: "click",
      auto: [{ click: "tab:walk-tab:walk" }],
    },
    {
      target: "tab:walk-tab:map",
      title: "Pin the map",
      do: "Open Map: drop numbered pins on what matters (the stain, the drain, the tank) and draw the area.",
      why: "Pins carry their photos into the report and onto the project, so the crew knows exactly where.",
      waitFor: "click",
      auto: [{ click: "tab:walk-tab:map" }],
    },
    {
      target: "tab:walk-tab:finish",
      title: "Finish",
      do: "Finish checks the sections, then Complete walk files the report, PDF and share link on the opportunity.",
      waitFor: "click",
      auto: [{ click: "tab:walk-tab:finish" }],
    },
    {
      title: "Done",
      finish: true,
      do: "That's a site walk from calendar to report. Open the live app to record that you've done this tutorial.",
    },
  ],
});

TUTORIALS.push({
  id: "process-close-bill",
  kind: "process",
  title: "Close out and bill a project",
  summary: "The post-work report, closing the project with its cost report, the itemized invoice and the QuickBooks export.",
  roles: ["Office Manager", "Finance Manager"],
  libraryItemId: "library-tutorials-close-bill",
  steps: [
    {
      view: "ops-projects",
      title: "From field complete to paid",
      chain: chain("Field work", "Closeout", "Invoice"),
      do: "When the crew marks the work field complete, the office writes the report, closes the project and bills it, all from what the field recorded.",
      why: "The invoice is drafted from the field records, so nothing is typed twice and nothing is missed.",
    },
    {
      view: "ops-projects",
      target: "action:view-project",
      title: "Open a project",
      do: "Open a project whose field work is done.",
      waitFor: "route:project-detail",
      auto: [{ click: "action:view-project" }],
    },
    {
      target: "tab:switch-project-tab:report",
      title: "The post-work report",
      do: "Open Report. It's built from the crew's day notes, photos, weather, samples and waste. Generate report prints the customer copy.",
      waitFor: "click",
      auto: [{ click: "tab:switch-project-tab:report" }],
    },
    {
      target: ["action:close-project", "tab:switch-project-tab:report"],
      title: "Close the project",
      do: "Once the project reaches Closeout, Close project appears. Closing freezes the cost report: labor, equipment, materials and waste, priced from the rate sheet.",
      why: "The cost report is the job's P&L against what we quoted.",
    },
    {
      view: "finance-invoices",
      target: "action:open-invoice",
      title: "Bill it",
      do: "Finance › Invoices. Press Create invoice.",
      waitFor: "dialog:invoiceDialog",
      auto: [{ click: "action:open-invoice" }],
    },
    {
      target: "dialog:invoiceDialog",
      title: "The itemized invoice",
      do: "Pick the project; the lines come from the field records, grouped by day, on the quote's rate sheet and tier. Set the dates and press Save invoice.",
      waitFor: "created:invoices",
      auto: [
        { select: ["sel:#invoiceDialog [name=projectId]", "@first"] },
        { fill: ["sel:#invoiceDialog [name=invoiceDate]", "@today"] },
        { fill: ["sel:#invoiceDialog [name=dueDate]", "@today"] },
        { click: "sel:#invoiceDialog button[type=submit]" },
      ],
    },
    {
      view: "finance-qbo",
      target: "page-header",
      title: "QuickBooks",
      do: "Each invoice exports to QuickBooks with its lines. On the training copy the connection is a mock, so export freely.",
    },
    {
      view: "home",
      target: "home-learn",
      title: "Done",
      finish: true,
      do: "That's a project closed and billed. Open the live app to record that you've done this tutorial.",
    },
  ],
});

export function findTutorial(id) {
  return TUTORIALS.find((tutorial) => tutorial.id === id) || null;
}

export function sectionTourFor(workspaceId) {
  return TUTORIALS.find((tutorial) => tutorial.kind === "section" && tutorial.workspace === workspaceId && !tutorial.topbarViews) || null;
}

// Pages without a workspace header of their own (a record's page, Identity & Sync) put their "?" in
// the top bar instead.
export function topbarTourFor(view) {
  return TUTORIALS.find((tutorial) => tutorial.topbarViews?.includes(view)) || null;
}

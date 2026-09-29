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

export function findTutorial(id) {
  return TUTORIALS.find((tutorial) => tutorial.id === id) || null;
}

export function sectionTourFor(workspaceId) {
  return TUTORIALS.find((tutorial) => tutorial.kind === "section" && tutorial.workspace === workspaceId) || null;
}

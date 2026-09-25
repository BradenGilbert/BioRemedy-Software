// Accounts, contacts, places, vendors, agreements, opportunities and the sales timeline.
import { push, at, dayOffset, money, rate, P, uomName, productById, EMP, NAME, USER, NOW, TODAY } from "./core.mjs";

// ---- accounts ---------------------------------------------------------------------------------
export const ACCT = {};
export const CONTACT = {};
export const FAC = {};
export const OPP = {};

const flagsOff = { doNotAllowBulkEmail: false, doNotAllowBulkMail: false, doNotAllowEmails: false, doNotAllowFaxes: false, doNotAllowMail: false, doNotAllowPhoneCalls: false };
function account(key, spec) {
  const id = spec.id || `acct-${key}`;
  ACCT[key] = id;
  const row = {
    id,
    name: spec.name,
    accountName: spec.name,
    accountId: id,
    accountUniqueIdentifier: id,
    accountNumber: id.replace(/^acct-/, "ACCT-").toUpperCase(),
    accountType: spec.accountType || "Customer",
    contact: "",
    email: spec.email || "",
    phone: spec.phone || "",
    mainPhoneNumber: spec.phone || "",
    faxNumber: "",
    website: spec.website || "",
    parentAccountId: "",
    city: `${spec.city}, TX`,
    addressOneType: "Primary",
    addressOneStreetOne: spec.street || "",
    addressOneStreetTwo: "",
    addressOneStreetThree: "",
    addressOneCity: spec.city,
    addressOneState: "TX",
    addressOneCounty: spec.county || "",
    addressOneCountry: "United States",
    addressOneZipCode: spec.zip || "",
    addressOnePostOfficeBox: "",
    addressOneLatitude: "",
    addressOneLongitude: "",
    addressOnePrimaryContact: "",
    addressOneTelephoneOne: spec.phone || "",
    addressOnePhoneNumber: spec.phone || "",
    addressOneUniqueIdentifier: `${id}-addr1`,
    billingAddressState: "TX",
    billingAddressCountry: "United States",
    billingInterval: spec.terms || "Net 30",
    billingType: "Invoice",
    annualRevenue: "",
    availableCredit: "",
    creditHold: false,
    currency: "USD",
    owner: spec.owner || NAME.trey,
    ownerEmployeeId: spec.ownerEmployeeId || EMP.trey,
    classification: spec.classification || "Active customer",
    category: spec.classification || "Active customer",
    phase: spec.classification || "Active customer",
    accountRating: spec.rating || "Medium",
    risk: spec.rating || "Medium",
    businessType: spec.businessType || "Commercial",
    customerSize: spec.customerSize || "",
    industry: "",
    numberOfEmployees: "",
    description: spec.description || "",
    concern: spec.description || "",
    siteName: spec.siteName || "",
    lastContact: spec.lastContact || TODAY,
    nextAction: spec.nextAction || "",
    createdBy: spec.createdBy || NAME.trey,
    createdOn: spec.createdAt || NOW,
    apEmail: spec.apEmail || "",
    apPortalUrl: "",
    poRequired: Boolean(spec.poRequired),
    poFormat: spec.poFormat || "",
    ...flagsOff,
  };
  const saved = push("accounts", row, spec.createdAt || NOW, spec.updatedAt || NOW);
  if (spec.industryId) push("accountIndustries", { id: `acct-industry-${key}`, accountId: id, industryId: spec.industryId, isPrimary: true, deletedAt: "" }, spec.createdAt || NOW);
  push("accountRelationshipExtensions", {
    id: `account-relationship-${key}`,
    accountId: id,
    accountTypeId: spec.accountTypeId || "account-type-commercial",
    sicCode: "",
    ownershipType: spec.ownershipType || "Private",
    taxAddressId: "",
    relationshipStatus: spec.relationshipStatus || "Active",
    primaryRelationship: spec.accountType === "Vendor" ? (spec.isSubcontractor ? "Subcontractor" : "Vendor") : "Customer",
    customerStatus: spec.classification || "Active customer",
    isClient: spec.accountType !== "Vendor",
    isProspect: spec.classification === "Prospect",
    isVendor: spec.accountType === "Vendor",
    isSubcontractor: Boolean(spec.isSubcontractor),
    subcontractorPermitted: spec.isSubcontractor ? "Approved" : "",
    subcontractorPreapprovalRequired: false,
    msaStatus: spec.msaStatus || "Not started",
    coiStatus: spec.coiStatus || "Not started",
    w9DocumentStatus: spec.w9Status || "Not started",
    eligibleForSubcontracting: Boolean(spec.isSubcontractor),
    businessDescription: spec.description || "",
    workingRelationshipNotes: spec.notes || "",
  }, spec.createdAt || NOW);
  return saved;
}

function contact(key, accountKey, spec) {
  const id = `cont-${key}`;
  CONTACT[key] = id;
  const [firstName, ...rest] = spec.name.split(" ");
  const acct = backendAccount(accountKey);
  const row = {
    id, contactId: id, contactUniqueIdentifier: id,
    accountId: ACCT[accountKey], accountName: acct.name,
    name: spec.name, fullName: spec.name, firstName, lastName: rest.join(" "),
    title: spec.title, jobTitle: spec.title,
    email: spec.email || "", phone: spec.phone || "", businessPhone: spec.phone || "", mobilePhone: spec.mobile || "", fax: "",
    emailAddressTwo: "", emailAddressThree: "",
    influence: spec.role || "Influencer", relationshipRole: spec.role || "Influencer", accountRole: spec.role || "Influencer",
    preferredContact: spec.preferred || "Email", preferredContactMethod: spec.preferred || "Email",
    opportunityIds: [], notes: spec.notes || "", divisionId: "", owner: spec.owner || acct.owner, birthday: "",
    lifecycleStage: spec.lifecycleStage || "Customer", leadStatus: "", hubspotOwnerId: "", originatingLeadId: "",
    doNotAllowEmails: false, doNotAllowPhoneCalls: false, doNotAllowMail: false, doNotAllowFaxes: false,
    addressOneType: "Primary", addressOneStreetOne: acct.addressOneStreetOne, addressOneStreetTwo: "", addressOneStreetThree: "", addressOneCity: acct.addressOneCity, addressOneState: "TX", addressOneCountry: "United States", addressOneZipCode: acct.addressOneZipCode, addressOneTelephoneOne: spec.phone || "", addressOneTelephoneTwo: "", addressOneTelephoneThree: "", addressOneUpsZone: "", addressOneUtcOffset: "",
    addressTwoType: "", addressTwoStreetOne: "", addressTwoStreetTwo: "", addressTwoStreetThree: "", addressTwoCity: "", addressTwoState: "", addressTwoCountry: "", addressTwoZipCode: "", addressTwoTelephoneOne: "", addressTwoTelephoneTwo: "", addressTwoTelephoneThree: "", addressTwoFax: "",
    lastContacted: spec.lastContacted || acct.lastContact, lastActivityDate: spec.lastContacted || acct.lastContact, nextActivityDate: "", numberOfSalesActivities: 0, numberOfTimesContacted: 0,
    createdOn: acct.createdAt, createdBy: acct.createdBy, lastModifiedDate: acct.createdAt, recordSource: "Local CRM",
  };
  const saved = push("contacts", row, acct.createdAt, acct.updatedAt);
  if (spec.primary) {
    acct.primaryContactId = id;
    acct.contact = spec.name;
    acct.addressOnePrimaryContact = spec.name;
    if (spec.email && !acct.email) acct.email = spec.email;
  }
  if (spec.ap) {
    acct.apContactId = id;
    acct.apContact = spec.name;
  }
  return saved;
}
const backendAccount = (key) => {
  const { out } = accountsState;
  return out.accounts.find((a) => a.id === ACCT[key]);
};
import { out } from "./core.mjs";
const accountsState = { out };

function facility(key, accountKey, spec) {
  const id = `fac-${key}`;
  FAC[key] = id;
  const acct = backendAccount(accountKey);
  return push("facilities", {
    id, accountId: ACCT[accountKey], name: spec.name, street1: spec.street || "", street2: "", address: spec.street || "", city: spec.city || acct.addressOneCity,
    stateOrProvince: "TX", postalCode: spec.zip || acct.addressOneZipCode || "", countryOrRegion: "United States", phone: spec.phone || acct.phone,
    category: spec.category || "Job Site / Field Location", categoryOther: "", badge: spec.badge || "Active", concern: spec.concern || "", access: spec.access || "",
    latitude: spec.lat ?? "", longitude: spec.lng ?? "", environmentalRisk: spec.risk || "",
  }, acct.createdAt, acct.updatedAt);
}

function address(key, accountKey, spec) {
  const acct = backendAccount(accountKey);
  return push("addresses", {
    id: `address-${key}`, accountId: ACCT[accountKey], addressName: spec.name, addressType: spec.type, isPrimary: Boolean(spec.primary), suiteNumber: spec.suite || "",
    street1: spec.street, street2: "", street3: "", city: spec.city, county: spec.county || "", stateOrProvince: "TX", postalCode: spec.zip, countryOrRegion: "United States",
    phone: spec.phone || acct.phone, latitude: "", longitude: "", freightTerms: "", shippingMethod: "", contactId: spec.contactId || "", deliveryInstructions: spec.instructions || "",
  }, acct.createdAt, acct.updatedAt);
}

// -- City of Georgetown (real customer, carried over and cleaned up) --
account("city-georgetown", { id: "acct-city-georgetown", name: "City of Georgetown", street: "510 W 9th St", city: "Georgetown", county: "Williamson", zip: "78626", phone: "(512) 930-3652", website: "https://georgetown.org", industryId: "industry-municipal-government", accountTypeId: "account-type-municipal-government", ownershipType: "Government", businessType: "Government", customerSize: "Large", rating: "High", description: "Hazardous materials management and spill response under RFP 202519. Standing contract; emergency call-outs come through Public Works and the Fire Department.", nextAction: "Quarterly contract review with Purchasing", terms: "Net 30", poRequired: true, poFormat: "PO-######", apEmail: "ap@georgetown.org", msaStatus: "On File", coiStatus: "On File", w9Status: "On File", notes: "Contract awarded June 2025. Rate sheet pricing per the RFP response; emergency minimums apply.", createdAt: "2026-09-15T20:29:17.604Z", updatedAt: NOW, lastContact: "2026-09-24", owner: NAME.braden, ownerEmployeeId: EMP.braden, createdBy: NAME.braden });
contact("gt-purchasing", "city-georgetown", { name: "Dana Whitfield", title: "Purchasing Coordinator", email: "dana.whitfield@georgetown.example", phone: "(512) 930-3600", role: "Decision maker", primary: true, ap: true, notes: "Contract administrator for RFP 202519. Wants every invoice to reference the PO." });
contact("gt-publicworks", "city-georgetown", { name: "Marcus Reyes", title: "Public Works Operations Manager", email: "marcus.reyes@georgetown.example", phone: "(512) 930-3610", mobile: "(512) 555-0142", role: "Champion", preferred: "Phone", notes: "Calls in most spills directly. Prefers a text when the crew is en route." });
contact("gt-fire", "city-georgetown", { name: "Captain Elena Torres", title: "Hazmat Captain, Georgetown Fire", email: "elena.torres@georgetown.example", phone: "(512) 930-3473", role: "Influencer", preferred: "Phone" });
facility("gt-service-center", "city-georgetown", { name: "Public Works Service Center", street: "3500 Rockmoor Dr", city: "Georgetown", zip: "78628", category: "Maintenance Yard", badge: "Active", access: "Gate code from Marcus Reyes; check in at the fleet office.", lat: 30.6412, lng: -97.6929, risk: "Fuel island and fleet wash bay on site." });
facility("gt-austin-ave", "city-georgetown", { name: "Austin Ave storm drain — Rock St intersection", street: "Austin Ave & W 8th St", city: "Georgetown", zip: "78626", category: "Job Site / Field Location", badge: "Closed", lat: 30.6336, lng: -97.6773 });
address("gt-billing", "city-georgetown", { name: "Accounts Payable", type: "Bill To", street: "PO Box 409", city: "Georgetown", county: "Williamson", zip: "78627", contactId: CONTACT["gt-purchasing"], instructions: "Invoices by email to AP; PO number required on every invoice." });
address("gt-primary", "city-georgetown", { name: "Purchasing Department", type: "Primary", primary: true, street: "510 W 9th St", city: "Georgetown", county: "Williamson", zip: "78626", contactId: CONTACT["gt-purchasing"] });
push("serviceAgreements", { id: "service-agreement-georgetown-202519", accountId: ACCT["city-georgetown"], agreementName: "Hazardous Materials Management and Spill Response — RFP 202519", agreementNumber: "202519", agreementType: "MSA", agreementStatus: "Active", effectiveStart: "2025-07-01", effectiveEnd: "2027-06-30", autoRenew: true, renewalTermMonths: 12, paymentTerms: "Net 30", billingFrequency: "Per call-out", priceLevelId: "price-standard-2026", transactionCurrencyId: "currency-usd", totalContractValue: 250000, scopeOfWork: "24/7 hazardous materials response, spill cleanup, waste characterization and disposal coordination for city facilities, rights-of-way and storm drains, at rate-sheet pricing." }, "2026-09-16T18:00:00.000Z");
push("facilityContacts", { id: "facility-contact-gt-service-center", facilityId: FAC["gt-service-center"], contactId: CONTACT["gt-publicworks"], relationshipRole: "Manages", isPrimary: true });
push("accountComments", { id: "account-comment-gt-po", accountId: ACCT["city-georgetown"], authorName: NAME.charlotte, body: "Purchasing issues a blanket PO each fiscal year; the FY26 PO number is on the service agreement record. Emergency call-outs still need a PO release before invoicing." }, at("2026-09-24", "10:12"));

// -- Lone Star Freight Lines (diesel semi, July 2025) --
account("lonestar-freight", { name: "Lone Star Freight Lines", street: "2100 Chisholm Trail Rd", city: "Round Rock", county: "Williamson", zip: "78681", phone: "(512) 555-0188", industryId: "industry-transportation-logistics", description: "Regional trucking company; saddle-tank rupture at their Round Rock yard, July 2025. Paid through a Progressive Commercial claim.", terms: "Net 30", msaStatus: "On File", coiStatus: "N/A", w9Status: "On File", createdAt: "2025-07-02T13:45:00.000Z", updatedAt: "2025-08-20T15:00:00.000Z", lastContact: "2025-08-18", nextAction: "Offer a standing spill-response agreement for the fleet", createdBy: NAME.trey });
contact("lsf-safety", "lonestar-freight", { name: "Ray Castillo", title: "Safety & Compliance Manager", email: "ray.castillo@lonestarfreight.example", phone: "(512) 555-0190", mobile: "(512) 555-0191", role: "Decision maker", primary: true, preferred: "Phone", notes: "Called in the spill. Signed the work authorization on site." });
contact("lsf-ap", "lonestar-freight", { name: "Priscilla Nguyen", title: "Accounts Payable", email: "ap@lonestarfreight.example", phone: "(512) 555-0192", role: "Influencer", ap: true });
facility("lsf-yard", "lonestar-freight", { name: "Round Rock truck yard", street: "2100 Chisholm Trail Rd", city: "Round Rock", zip: "78681", category: "Maintenance Yard", badge: "Closed", access: "24-hour guard shack; dispatch office on the north side.", lat: 30.5083, lng: -97.6789, risk: "Fuel storage; drainage swale to Brushy Creek tributary." });
address("lsf-billing", "lonestar-freight", { name: "Accounts Payable", type: "Bill To", street: "2100 Chisholm Trail Rd", city: "Round Rock", zip: "78681", contactId: CONTACT["lsf-ap"] });

// -- Progressive Commercial (insurer paying the Lone Star claim) --
account("progressive-claims", { name: "Progressive Commercial — Claims", street: "6300 Wilson Mills Rd", city: "Mayfield Village", county: "", zip: "44143", phone: "(800) 555-0177", description: "Insurance carrier on the Lone Star Freight diesel release. Adjuster approved the scope; invoice copied to the claim.", classification: "Active customer", rating: "Low", createdAt: "2025-07-02T18:20:00.000Z", updatedAt: "2025-08-20T15:00:00.000Z", lastContact: "2025-08-18", createdBy: NAME.charlotte, terms: "Net 45" });
// Ohio address: overwrite the state the helper assumed.
Object.assign(backendAccount("progressive-claims"), { city: "Mayfield Village, OH", addressOneState: "OH", billingAddressState: "OH" });
contact("prog-adjuster", "progressive-claims", { name: "Kevin Marsh", title: "Commercial Auto Claims Adjuster", email: "kevin.marsh@progressive.example", phone: "(800) 555-0178", role: "Decision maker", primary: true, notes: "Claim 26-4471-TX. Wants photos, the TCEQ report and the itemized invoice." });

// -- Brazos Commercial Properties (parking lot debris cleanup, Aug 2025) --
account("brazos-commercial", { name: "Brazos Commercial Properties", street: "1500 S Interstate 35, Suite 210", city: "Round Rock", county: "Williamson", zip: "78681", phone: "(512) 555-0120", industryId: "industry-construction", description: "Property manager for retail centers between Round Rock and Temple. Fire debris and hydraulic fluid cleanup at a vacant strip center, August 2025.", createdAt: "2025-07-30T16:10:00.000Z", updatedAt: "2025-09-05T14:00:00.000Z", lastContact: "2025-09-05", nextAction: "Check in about the parking lot re-striping project", msaStatus: "On File", w9Status: "On File", createdBy: NAME.trey });
contact("brazos-pm", "brazos-commercial", { name: "Alicia Moreno", title: "Property Manager", email: "alicia.moreno@brazoscp.example", phone: "(512) 555-0121", role: "Decision maker", primary: true, ap: true });
facility("brazos-hutto", "brazos-commercial", { name: "Hutto Crossing shopping center", street: "200 Ed Schmidt Blvd", city: "Hutto", zip: "78634", category: "Job Site / Field Location", badge: "Closed", lat: 30.5427, lng: -97.5467 });

// -- Permian Midstream Partners (pipeline release, in progress) --
account("permian-midstream", { name: "Permian Midstream Partners", street: "4400 N Big Spring St", city: "Midland", county: "Midland", zip: "79705", phone: "(432) 555-0150", industryId: "industry-oil-gas", accountTypeId: "account-type-industrial", businessType: "Industrial", customerSize: "Large", rating: "High", description: "Gathering-line operator. Crude release at a valve site near Taylor; multi-stage excavation, treatment and backfill under way.", createdAt: "2026-09-05T15:30:00.000Z", updatedAt: NOW, lastContact: "2026-09-24", nextAction: "Daily progress email to the EHS lead", msaStatus: "On File", coiStatus: "On File", w9Status: "On File", poRequired: true, poFormat: "PMP-######", createdBy: NAME.trey, apEmail: "ap@permianmidstream.example" });
contact("pmp-ehs", "permian-midstream", { name: "Derek Hollis", title: "EHS Lead, Central Texas", email: "derek.hollis@permianmidstream.example", phone: "(432) 555-0151", mobile: "(432) 555-0152", role: "Decision maker", primary: true, preferred: "Phone" });
contact("pmp-pm", "permian-midstream", { name: "Sonia Alvarez", title: "Project Engineer", email: "sonia.alvarez@permianmidstream.example", phone: "(432) 555-0153", role: "Technical evaluator" });
contact("pmp-ap", "permian-midstream", { name: "Accounts Payable", title: "AP Department", email: "ap@permianmidstream.example", phone: "(432) 555-0154", role: "Influencer", ap: true });
facility("pmp-valve-site", "permian-midstream", { name: "Taylor valve site — CR 401", street: "CR 401 at FM 973", city: "Taylor", zip: "76574", category: "Job Site / Field Location", badge: "Active", access: "Lease road off FM 973; staging area on the caliche pad per the load/depart plan.", lat: 30.5731, lng: -97.4092, risk: "Crude oil release to soil; stock tank downgradient." });
address("pmp-billing", "permian-midstream", { name: "Accounts Payable", type: "Bill To", street: "PO Box 2210", city: "Midland", zip: "79702", contactId: CONTACT["pmp-ap"], instructions: "PO number and daily field tickets attached." });

// -- Hill Country Hospitality Group (soil borings, closeout) --
account("hill-country-hospitality", { name: "Hill Country Hospitality Group", street: "9000 N IH-35, Suite 400", city: "Austin", county: "Travis", zip: "78753", phone: "(512) 555-0135", industryId: "industry-construction", description: "Hotel owner-operator. Subsurface investigation at a hotel after a grease-line failure and historical fuel tank; borings complete, lab results pending.", createdAt: "2026-08-20T14:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-22", nextAction: "Send lab results and closure recommendation", msaStatus: "On File", w9Status: "On File", createdBy: NAME.trey });
contact("hch-director", "hill-country-hospitality", { name: "Grant Whitaker", title: "Director of Facilities", email: "grant.whitaker@hchg.example", phone: "(512) 555-0136", role: "Decision maker", primary: true, ap: true });
contact("hch-gm", "hill-country-hospitality", { name: "Monica Salas", title: "General Manager, Pflugerville Inn", email: "monica.salas@hchg.example", phone: "(512) 555-0137", role: "Influencer", preferred: "Phone" });
facility("hch-pflugerville", "hill-country-hospitality", { name: "Pflugerville Inn & Suites", street: "1200 FM 685", city: "Pflugerville", zip: "78660", category: "Job Site / Field Location", badge: "Active", access: "Park behind the kitchen; GM has the key to the utility yard.", lat: 30.4423, lng: -97.6118, risk: "Former UST location north of the kitchen; wooded drainage to the east." });

// -- Domain Parking Partners (garage wash, complete) --
account("domain-parking", { name: "Domain Parking Partners", street: "11410 Century Oaks Terrace", city: "Austin", county: "Travis", zip: "78758", phone: "(512) 555-0160", industryId: "industry-construction", description: "Garage operator. Night pressure-wash and degrease of a three-level garage after a transformer oil leak.", createdAt: "2026-04-10T16:00:00.000Z", updatedAt: "2026-06-01T14:00:00.000Z", lastContact: "2026-05-28", nextAction: "Propose a quarterly wash schedule", createdBy: NAME.trey, w9Status: "On File" });
contact("domain-ops", "domain-parking", { name: "Terrence Boyd", title: "Operations Manager", email: "terrence.boyd@domainparking.example", phone: "(512) 555-0161", role: "Decision maker", primary: true, ap: true });
facility("domain-garage-b", "domain-parking", { name: "Garage B — Rock Rose Ave", street: "3100 Rock Rose Ave", city: "Austin", zip: "78758", category: "Job Site / Field Location", badge: "Closed", access: "Night work only, 10pm–5am. Security desk on level 1.", lat: 30.4016, lng: -97.7237 });

// -- Lakeway Medical Office Park (crawlspace bioremediation, complete) --
account("lakeway-medical", { name: "Lakeway Medical Office Park", street: "1600 Ranch Rd 620 S", city: "Lakeway", county: "Travis", zip: "78734", phone: "(512) 555-0170", industryId: "industry-healthcare", description: "Medical office condominium association. Sewage backup into the building crawlspace; pump-out, cleanout and bacteria treatment, March 2026.", createdAt: "2026-03-02T17:00:00.000Z", updatedAt: "2026-04-15T14:00:00.000Z", lastContact: "2026-04-14", createdBy: NAME.braden, owner: NAME.braden, ownerEmployeeId: EMP.braden, w9Status: "On File" });
contact("lakeway-board", "lakeway-medical", { name: "Dr. Susan Park", title: "Association President", email: "susan.park@lakewaymop.example", phone: "(512) 555-0171", role: "Decision maker", primary: true, ap: true });
contact("lakeway-maint", "lakeway-medical", { name: "Hector Ruiz", title: "Building Maintenance", email: "", phone: "(512) 555-0172", role: "Influencer", preferred: "Phone" });
facility("lakeway-bldg-2", "lakeway-medical", { name: "Building 2 crawlspace", street: "1600 Ranch Rd 620 S, Bldg 2", city: "Lakeway", zip: "78734", category: "Job Site / Field Location", badge: "Closed", access: "Crawlspace hatch inside the janitor closet, first floor.", lat: 30.3532, lng: -97.9876, risk: "Confined space; sewage." });

// -- Wolf Ranch HOA (pond treatment, complete) --
account("wolf-ranch-hoa", { name: "Wolf Ranch Community Association", street: "100 Wolf Ranch Pkwy", city: "Georgetown", county: "Williamson", zip: "78628", phone: "(512) 555-0180", industryId: "industry-municipal-government", description: "Homeowners association. Night application of Mega-Bac X to the amenity pond after a fish kill; scheduled follow-up treatments.", createdAt: "2026-09-08T15:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-21", nextAction: "Schedule the 30-day follow-up treatment", createdBy: NAME.trey });
contact("wolf-manager", "wolf-ranch-hoa", { name: "Janet Osei", title: "Community Manager", email: "janet.osei@wolfranchca.example", phone: "(512) 555-0181", role: "Decision maker", primary: true, ap: true });
facility("wolf-pond", "wolf-ranch-hoa", { name: "Amenity pond — Wolf Ranch Pkwy", street: "Wolf Ranch Pkwy at Jay Wolf Dr", city: "Georgetown", zip: "78628", category: "Job Site / Field Location", badge: "Active", lat: 30.6294, lng: -97.7117 });

// -- Capital Area Grocers (spill call taken today, Intake) --
account("capital-grocers", { name: "Capital Area Grocers", street: "8200 Cameron Rd", city: "Austin", county: "Travis", zip: "78754", phone: "(512) 555-0110", industryId: "industry-transportation-logistics", description: "Grocery distribution center. Forklift battery acid spill on the loading dock, called in 2026-09-25.", classification: "Prospect", createdAt: at(TODAY, "07:42"), updatedAt: at(TODAY, "07:50"), lastContact: TODAY, nextAction: "Send customer packet and work authorization", createdBy: NAME.charlotte, owner: NAME.trey });
contact("cag-warehouse", "capital-grocers", { name: "Luis Ortega", title: "Warehouse Manager", email: "luis.ortega@capitalgrocers.example", phone: "(512) 555-0111", role: "Decision maker", primary: true, preferred: "Phone", lifecycleStage: "Lead" });
facility("cag-dock", "capital-grocers", { name: "Cameron Rd distribution center — Dock 4", street: "8200 Cameron Rd", city: "Austin", zip: "78754", category: "Job Site / Field Location", badge: "Emergency", lat: 30.3407, lng: -97.6702, risk: "Battery acid on concrete dock; floor drain to sanitary sewer." });

// -- Blue Bonnet Dairy Co-op (won, planning) --
account("bluebonnet-dairy", { name: "Blue Bonnet Dairy Co-op", street: "4500 FM 1331", city: "Taylor", county: "Williamson", zip: "76574", phone: "(512) 555-0125", industryId: "industry-agriculture", description: "Dairy co-op. Wastewater lagoon liner tear; sludge removal and liner repair planned for October.", createdAt: "2026-08-12T15:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-23", nextAction: "Confirm the liner subcontractor's October dates", msaStatus: "On File", w9Status: "On File", createdBy: NAME.trey });
contact("bbd-ops", "bluebonnet-dairy", { name: "Wade Kessler", title: "Operations Manager", email: "wade.kessler@bluebonnetdairy.example", phone: "(512) 555-0126", role: "Decision maker", primary: true, ap: true, preferred: "Phone" });
facility("bbd-lagoon", "bluebonnet-dairy", { name: "South wastewater lagoon", street: "4500 FM 1331", city: "Taylor", zip: "76574", category: "Job Site / Field Location", badge: "Active", lat: 30.5602, lng: -97.3901, risk: "Lagoon; farm traffic." });

// -- prospects with open opportunities --
account("alamo-precast", { name: "Alamo Precast Concrete", street: "7800 Hwy 79 E", city: "Hutto", county: "Williamson", zip: "78634", phone: "(512) 555-0140", industryId: "industry-manufacturing", accountTypeId: "account-type-industrial", businessType: "Industrial", classification: "Prospect", description: "Precast plant. Asked about cleaning out the wash-water settling pit.", createdAt: "2026-09-22T17:30:00.000Z", updatedAt: NOW, lastContact: "2026-09-22", nextAction: "Qualify: volume, disposal and access", createdBy: NAME.trey });
contact("alamo-plant", "alamo-precast", { name: "Bill Hardy", title: "Plant Manager", email: "bill.hardy@alamoprecast.example", phone: "(512) 555-0141", role: "Decision maker", primary: true, lifecycleStage: "Lead" });
account("cedar-valley-fire", { name: "Cedar Valley Fire Rescue", street: "300 Fire Station Rd", city: "Cedar Park", county: "Williamson", zip: "78613", phone: "(512) 555-0130", industryId: "industry-municipal-government", accountTypeId: "account-type-municipal-government", ownershipType: "Government", businessType: "Government", classification: "Prospect", description: "Fire district. Drone demo and spill-response training day held at Station 2; interested in a standing response agreement.", createdAt: "2026-07-01T15:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-18", nextAction: "Send the government services agreement", createdBy: NAME.braden, owner: NAME.braden, ownerEmployeeId: EMP.braden });
contact("cvf-chief", "cedar-valley-fire", { name: "Chief Robert Dunn", title: "Fire Chief", email: "rdunn@cedarvalleyfire.example", phone: "(512) 555-0131", role: "Decision maker", primary: true, lifecycleStage: "Lead" });
contact("cvf-captain", "cedar-valley-fire", { name: "Captain Amy Fischer", title: "Training Captain", email: "afischer@cedarvalleyfire.example", phone: "(512) 555-0132", role: "Champion", lifecycleStage: "Lead" });
facility("cvf-station-2", "cedar-valley-fire", { name: "Station 2", street: "300 Fire Station Rd", city: "Cedar Park", zip: "78613", category: "Corporate Office", badge: "Active", lat: 30.5052, lng: -97.8203 });
account("wilco-fleet", { name: "Williamson County Fleet Services", street: "3151 SE Inner Loop", city: "Georgetown", county: "Williamson", zip: "78626", phone: "(512) 555-0145", industryId: "industry-municipal-government", accountTypeId: "account-type-municipal-government", ownershipType: "Government", businessType: "Government", classification: "Prospect", description: "County fleet yard. Fuel island staining; wants a soil investigation before the island is rebuilt.", createdAt: "2026-09-10T16:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-24", nextAction: "Site walk 2026-09-30", createdBy: NAME.trey });
contact("wilco-fleet-mgr", "wilco-fleet", { name: "Tom Brennan", title: "Fleet Manager", email: "tbrennan@wilco.example", phone: "(512) 555-0146", role: "Decision maker", primary: true, lifecycleStage: "Lead" });
facility("wilco-fuel-island", "wilco-fleet", { name: "Fleet yard fuel island", street: "3151 SE Inner Loop", city: "Georgetown", zip: "78626", category: "Maintenance Yard", badge: "Active", lat: 30.6194, lng: -97.6521, risk: "Diesel and gasoline dispensers; stained concrete and soil." });
account("georgetown-isd", { name: "Georgetown ISD", street: "603 Lakeway Dr", city: "Georgetown", county: "Williamson", zip: "78628", phone: "(512) 555-0155", industryId: "industry-education", accountTypeId: "account-type-municipal-government", ownershipType: "Government", businessType: "Government", classification: "Prospect", description: "School district. Bus barn oil-water separator and wash bay sump cleaning.", createdAt: "2026-09-02T15:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-23", nextAction: "Follow up on the quote by 2026-10-01", createdBy: NAME.trey, poRequired: true });
contact("gisd-transport", "georgetown-isd", { name: "Karen Blake", title: "Director of Transportation", email: "kblake@gisd.example", phone: "(512) 555-0156", role: "Decision maker", primary: true, lifecycleStage: "Lead" });
facility("gisd-bus-barn", "georgetown-isd", { name: "Transportation center bus barn", street: "1301 Old Airport Rd", city: "Georgetown", zip: "78626", category: "Maintenance Yard", badge: "Active", lat: 30.6733, lng: -97.6828 });
account("riverside-chemical", { name: "Riverside Chemical Distribution", street: "6100 E Ben White Blvd", city: "Austin", county: "Travis", zip: "78741", phone: "(512) 555-0165", industryId: "industry-manufacturing", accountTypeId: "account-type-industrial", businessType: "Industrial", customerSize: "Medium", classification: "Prospect", description: "Chemical distributor. Negotiating a standing emergency response agreement with a 4-hour minimum call-out.", createdAt: "2026-08-05T15:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-24", nextAction: "Get the waste authorization back signed", createdBy: NAME.trey, msaStatus: "In review" });
contact("rcd-ehs", "riverside-chemical", { name: "Nadia Petrov", title: "EHS Manager", email: "npetrov@riversidechem.example", phone: "(512) 555-0166", role: "Decision maker", primary: true, lifecycleStage: "Lead" });
contact("rcd-purchasing", "riverside-chemical", { name: "Owen Gallagher", title: "Purchasing Manager", email: "ogallagher@riversidechem.example", phone: "(512) 555-0167", role: "Influencer", lifecycleStage: "Lead" });
facility("rcd-warehouse", "riverside-chemical", { name: "Ben White distribution warehouse", street: "6100 E Ben White Blvd", city: "Austin", zip: "78741", category: "Warehouse / Storage", badge: "Active", lat: 30.2182, lng: -97.7027, risk: "Bulk acids and solvents; rail spur." });
account("sunbelt-poultry", { name: "Sunbelt Poultry", street: "2900 CR 200", city: "Giddings", county: "Lee", zip: "78942", phone: "(979) 555-0195", industryId: "industry-agriculture", classification: "Prospect", description: "Poultry processor. Lost the litter pond remediation bid to Lone Star HazMat on price.", createdAt: "2026-07-15T15:00:00.000Z", updatedAt: "2026-09-02T15:00:00.000Z", lastContact: "2026-09-02", nextAction: "Re-engage in Q1 when the second pond comes up", createdBy: NAME.trey, relationshipStatus: "Inactive" });
contact("sunbelt-plant", "sunbelt-poultry", { name: "Ed Vance", title: "Plant Manager", email: "evance@sunbeltpoultry.example", phone: "(979) 555-0196", role: "Decision maker", primary: true, lifecycleStage: "Lead" });

// -- vendors --
account("balfour", { id: "acct-mu4ge94c-2tvpaj", name: "Balfour Services", accountType: "Vendor", isSubcontractor: true, street: "1900 N Austin Ave, Suite 100", city: "Georgetown", county: "Williamson", zip: "78626", phone: "(512) 555-0200", website: "https://balfour.example", industryId: "industry-construction", description: "Asbestos abatement and demolition subcontractor. Used on abatement scopes and for excavation support.", classification: "Active vendor", rating: "Low", msaStatus: "On File", coiStatus: "On File", w9Status: "On File", createdAt: "2026-09-16T18:48:04.015Z", updatedAt: NOW, lastContact: "2026-09-19", nextAction: "Confirm October availability for the Blue Bonnet liner work", createdBy: NAME.braden, owner: NAME.logan, ownerEmployeeId: EMP.logan, apEmail: "ap@balfour.example" });
contact("balfour-ops", "balfour", { name: "Mike Balfour", title: "Owner / Operations", email: "mike@balfour.example", phone: "(512) 555-0201", mobile: "(512) 555-0202", role: "Decision maker", primary: true, ap: true, preferred: "Phone" });
address("balfour-remit", "balfour", { name: "Remit-To", type: "Remit-To", street: "PO Box 1180", city: "Georgetown", county: "Williamson", zip: "78627", contactId: CONTACT["balfour-ops"] });
address("balfour-dispatch", "balfour", { name: "Yard / dispatch", type: "Vendor Dispatch", street: "1900 N Austin Ave", city: "Georgetown", county: "Williamson", zip: "78626", contactId: CONTACT["balfour-ops"], instructions: "Call Mike before sending trucks; gate closes at 6pm." });
push("vendorProfiles", { id: "vendor-profile-balfour", accountId: ACCT.balfour, vendorNumber: "V-0001", subcontractorTypeId: "subcontractor-type-subcontractor", onboardingStatus: "Approved", isSuspended: false, approvalDate: "2026-09-19", approvedById: EMP.braden, w9Status: "Approved", insuranceStatus: "Valid", insuranceExpiration: "2027-06-30", safetyStatus: "Approved", paymentTerms: "Net 30", defaultPriceLevelId: "price-standard-2026", serviceTerritory: "Central Texas", performanceRating: "A", accountingVendorId: "BALFOUR", remitToAddressId: "address-balfour-remit", dispatchAddressId: "address-balfour-dispatch", billingAddressId: "", operationsContactId: CONTACT["balfour-ops"], notes: "COI names BioRemedy as additional insured. Abatement license on file." }, "2026-09-16T19:53:35.255Z", NOW);
push("serviceAgreements", { id: "service-agreement-balfour-msa", accountId: ACCT.balfour, agreementName: "Subcontractor master services agreement", agreementNumber: "SUB-2026-01", agreementType: "MSA", agreementStatus: "Active", effectiveStart: "2026-01-01", effectiveEnd: "2026-12-31", autoRenew: true, renewalTermMonths: 12, paymentTerms: "Net 30", billingFrequency: "Per job", priceLevelId: "price-standard-2026", transactionCurrencyId: "currency-usd", totalContractValue: 0, scopeOfWork: "Abatement, demolition and excavation support on BioRemedy projects, billed at agreed hourly and per-unit rates." }, "2026-09-16T19:25:59.270Z");
push("accountApprovedSubcontractors", { id: "approved-sub-georgetown-balfour", accountId: ACCT["city-georgetown"], subcontractorAccountId: ACCT.balfour, status: "Approved", approvedScope: "Abatement and demolition support on city facilities", approvedFrom: "2026-09-19", approvedUntil: "2027-06-30", notes: "Approved by Purchasing under the RFP 202519 subcontractor clause." }, "2026-09-19T15:00:00.000Z");
push("subcontractorAssignments", { id: "subcontractor-assignment-bluebonnet-liner", vendorProfileId: "vendor-profile-balfour", assignmentName: "Blue Bonnet lagoon liner repair — excavation support", assignmentStatus: "Tentative", pricingBasis: "rate", rateType: "Hourly", rateAmount: 145, priceLevelId: "", startDate: "2026-10-12", endDate: "2026-10-16", relatedJobReference: "Blue Bonnet Dairy — lagoon liner", scopeOfWork: "Excavator with operator for liner subgrade repair; haul-off of sludge in lined roll-offs.", notes: "Dates to be confirmed once the liner material ships." }, "2026-09-19T15:30:00.000Z");

account("republic-services", { name: "Republic Services", accountType: "Vendor", street: "9508 Hwy 79", city: "Hutto", county: "Williamson", zip: "78634", phone: "(512) 555-0210", website: "https://republicservices.com", industryId: "industry-environmental", description: "Non-hazardous waste hauling and disposal; third-party waste authorization form goes to them.", classification: "Active vendor", rating: "Low", w9Status: "On File", coiStatus: "On File", createdAt: "2026-09-16T18:00:00.000Z", updatedAt: NOW, lastContact: "2026-09-22", createdBy: NAME.charlotte, owner: NAME.charlotte, ownerEmployeeId: EMP.charlotte });
contact("republic-rep", "republic-services", { name: "Carla Jenkins", title: "Industrial Account Representative", email: "cjenkins@republicservices.example", phone: "(512) 555-0211", role: "Decision maker", primary: true, ap: true });
push("vendorProfiles", { id: "vendor-profile-republic", accountId: ACCT["republic-services"], vendorNumber: "V-0002", subcontractorTypeId: "subcontractor-type-carrier", onboardingStatus: "Approved", isSuspended: false, approvalDate: "2026-09-16", approvedById: EMP.braden, w9Status: "Approved", insuranceStatus: "Valid", insuranceExpiration: "2027-03-31", safetyStatus: "Approved", paymentTerms: "Net 30", defaultPriceLevelId: "", serviceTerritory: "Central Texas", performanceRating: "A", accountingVendorId: "REPUBLIC", remitToAddressId: "", dispatchAddressId: "", billingAddressId: "", operationsContactId: CONTACT["republic-rep"], notes: "Roll-off and drum pickup; profile approvals take 3–5 days." }, "2026-09-16T18:00:00.000Z", NOW);

account("eurofins", { name: "Eurofins Environment Testing — Austin", accountType: "Vendor", street: "1101 N Industrial Blvd", city: "Round Rock", county: "Williamson", zip: "78681", phone: "(512) 555-0220", industryId: "industry-environmental", description: "Analytical laboratory for soil and water samples (TPH, BTEX, metals).", classification: "Active vendor", rating: "Low", w9Status: "On File", createdAt: "2026-09-16T18:05:00.000Z", updatedAt: NOW, lastContact: "2026-09-24", createdBy: NAME.logan, owner: NAME.logan, ownerEmployeeId: EMP.logan });
contact("eurofins-pm", "eurofins", { name: "Anita Raman", title: "Project Manager", email: "praman@eurofins.example", phone: "(512) 555-0221", role: "Decision maker", primary: true });
push("vendorProfiles", { id: "vendor-profile-eurofins", accountId: ACCT.eurofins, vendorNumber: "V-0003", subcontractorTypeId: "subcontractor-type-consultant", onboardingStatus: "Approved", isSuspended: false, approvalDate: "2026-09-16", approvedById: EMP.braden, w9Status: "Approved", insuranceStatus: "Valid", insuranceExpiration: "2027-01-31", safetyStatus: "Not required", paymentTerms: "Net 30", defaultPriceLevelId: "", serviceTerritory: "Statewide", performanceRating: "A-", accountingVendorId: "EUROFINS", remitToAddressId: "", dispatchAddressId: "", billingAddressId: "", operationsContactId: CONTACT["eurofins-pm"], notes: "Standard 10-day turnaround; rush at 3 days." }, "2026-09-16T18:05:00.000Z", NOW);

account("venditti", { name: "Venditti Trucking", accountType: "Vendor", street: "2000 CR 138", city: "Hutto", county: "Williamson", zip: "78634", phone: "(512) 555-0230", industryId: "industry-transportation-logistics", description: "Roll-off boxes and dump trucks for debris and soil haul-off.", classification: "Active vendor", rating: "Low", w9Status: "On File", coiStatus: "On File", createdAt: "2026-09-16T18:10:00.000Z", updatedAt: NOW, lastContact: "2026-09-19", createdBy: NAME.logan, owner: NAME.logan, ownerEmployeeId: EMP.logan });
contact("venditti-dispatch", "venditti", { name: "Tony Venditti", title: "Dispatch", email: "dispatch@vendittitrucking.example", phone: "(512) 555-0231", role: "Decision maker", primary: true, preferred: "Phone" });
push("vendorProfiles", { id: "vendor-profile-venditti", accountId: ACCT.venditti, vendorNumber: "V-0004", subcontractorTypeId: "subcontractor-type-carrier", onboardingStatus: "Approved", isSuspended: false, approvalDate: "2026-09-16", approvedById: EMP.logan, w9Status: "Approved", insuranceStatus: "Valid", insuranceExpiration: "2026-11-30", safetyStatus: "Approved", paymentTerms: "Net 15", defaultPriceLevelId: "", serviceTerritory: "Williamson & Travis counties", performanceRating: "B+", accountingVendorId: "VENDITTI", remitToAddressId: "", dispatchAddressId: "", billingAddressId: "", operationsContactId: CONTACT["venditti-dispatch"], notes: "COI expires 2026-11-30 — request the renewal in November." }, "2026-09-16T18:10:00.000Z", NOW);

// ---- competitors ------------------------------------------------------------------------------
push("competitors", { id: "competitor-lonestar-hazmat", transactionCurrencyId: "currency-usd", name: "Lone Star HazMat Response", websiteUrl: "", referenceInfoUrl: "", tickerSymbol: "", stockExchange: "", strengths: "Low hourly rates, large crew pool.", weaknesses: "Thin reporting; no biological treatment option.", threats: "Undercuts on price for straightforward spills.", winPercentage: 40, reportedRevenue: 0, reportingQuarter: 3, reportingYear: 2026, stateCode: "Active", statusCode: "Active" });
push("competitors", { id: "competitor-clean-harbors", transactionCurrencyId: "currency-usd", name: "Clean Harbors", websiteUrl: "https://www.cleanharbors.com", referenceInfoUrl: "", tickerSymbol: "CLH", stockExchange: "NYSE", strengths: "National footprint, own disposal facilities.", weaknesses: "Slow mobilization in Central Texas; high minimums.", threats: "Incumbent on many industrial MSAs.", winPercentage: 55, reportedRevenue: 0, reportingQuarter: 3, reportingYear: 2026, stateCode: "Active", statusCode: "Active" });
push("competitors", { id: "competitor-hepaco", transactionCurrencyId: "currency-usd", name: "HEPACO", websiteUrl: "https://www.hepaco.com", referenceInfoUrl: "", tickerSymbol: "", stockExchange: "", strengths: "Strong pipeline and rail relationships.", weaknesses: "Limited local crews.", threats: "Bids on midstream work.", winPercentage: 45, reportedRevenue: 0, reportingQuarter: 3, reportingYear: 2026, stateCode: "Active", statusCode: "Active" });

// ---- opportunities ----------------------------------------------------------------------------
const STAGE_PROB = { Lead: 10, Qualify: 20, Develop: 40, Proposal: 60, Negotiation: 80, Won: 100 };
// What sales writes on the deal from Develop onward: generic resource needs, the way the owner types
// them ("Truck", "PPE"), not catalog names. Operations turns these into real assets and stock later.
const GENERIC_NEEDS = {
  "Emergency Response": { equipment: ["Truck", "Trailer", "Vac truck", "Pressure washer"], resources: ["PPE", "Absorbents", "Drums", "Bacteria", "2 technicians + lead"], vendors: ["Waste hauler / disposal"] },
  "Scheduled Work": { equipment: ["Truck", "Trailer", "Pressure washer"], resources: ["PPE", "Degreaser", "Drums", "2 technicians"], vendors: ["Waste hauler / disposal"] },
  "Multi-Stage Remediation": { equipment: ["Truck", "Skid steer", "Excavator", "Vac truck", "Spray trailer"], resources: ["PPE", "Bacteria", "Sampling supplies", "Poly sheeting", "3-person crew"], vendors: ["Roll-off vendor", "Lab", "Excavation subcontractor"] },
  "Environmental Sampling": { equipment: ["Truck", "Direct-push rig (rental)", "PID"], resources: ["PPE", "Sampling supplies", "Drums for cuttings", "2 technicians"], vendors: ["Lab"] },
};
const needs = (names, notes = {}) => names.map((name) => ({ name, note: notes[name] || "" }));
function opportunity(key, accountKey, spec) {
  const id = `opp-${key}`;
  OPP[key] = id;
  const acct = backendAccount(accountKey);
  const stage = spec.stage;
  const status = spec.status || (stage === "Won" ? "Won" : "Open");
  const probability = status === "Lost" ? 0 : STAGE_PROB[stage];
  const createdAt = spec.createdAt || acct.createdAt;
  const closeBandSetAt = spec.closeBandSetAt || createdAt;
  const row = {
    id, opportunityId: id, opportunityUniqueIdentifier: id,
    accountId: ACCT[accountKey], accountName: acct.name,
    name: spec.name, opportunityName: spec.name,
    value: spec.value, amount: spec.value, amountInCompanyCurrency: spec.value, estimatedValue: spec.value, totalContractValue: spec.value,
    weightedAmount: money((spec.value * probability) / 100), forecastAmount: money((spec.value * probability) / 100),
    closeBand: spec.closeBand || "0-30", closeBandSetAt, rating: "",
    stage, dealStage: stage, status, probability, closeProbability: probability,
    forecastCategory: status === "Won" ? "Won" : status === "Lost" ? "Lost" : stage === "Negotiation" || stage === "Proposal" ? "Commit" : "Pipeline",
    serviceType: spec.serviceType, nextStep: spec.nextStep || "", customerNeed: spec.customerNeed || "", proposedSolution: spec.proposedSolution || "",
    primaryContact: spec.primaryContactName || acct.contact, decisionMaker: spec.primaryContactName || acct.contact,
    owner: spec.owner || acct.owner, hubspotOwnerId: "", dealType: spec.dealType || "New Business", sourceCampaign: spec.source || "", originatingLeadId: "", pipeline: "Sales Pipeline", priority: spec.priority || "Normal",
    initialCommunication: "Contacted", currentSituation: spec.currentSituation || "", industry: "", annualRecurringRevenue: 0, budgetAmount: spec.value, notToExceed: "", currency: "USD", exchangeRate: "1.00", isRevenueSystemCalculated: false,
    actualCloseDate: spec.actualCloseDate || "", createdOn: createdAt, createdBy: spec.createdBy || acct.createdBy, lastModifiedDate: spec.updatedAt || NOW, lastContacted: spec.lastContacted || acct.lastContact, nextActivityDate: spec.nextActivityDate || "",
    numberOfSalesActivities: 0, numberOfAssociatedContacts: 0, stageAgeDays: 0, competitor: spec.competitor || "", purchaseProcess: spec.purchaseProcess || "", purchaseTimeframe: "",
    quoteId: "", estimateId: "", priceList: "", recordSource: "Local CRM", description: spec.description || "",
    facilityId: spec.facilityKey ? FAC[spec.facilityKey] : "",
    equipmentNeeds: spec.equipmentNeeds || (STAGE_PROB[stage] >= 40 ? needs(GENERIC_NEEDS[spec.serviceType]?.equipment || ["Truck"], spec.needNotes) : []),
    vendorNeeds: spec.vendorNeeds || (STAGE_PROB[stage] >= 40 ? needs(GENERIC_NEEDS[spec.serviceType]?.vendors || [], spec.needNotes) : []),
    resourceNeeds: spec.resourceNeeds || (STAGE_PROB[stage] >= 40 ? needs(GENERIC_NEEDS[spec.serviceType]?.resources || ["PPE"], spec.needNotes) : []),
    siteWalkStatus: spec.siteWalkStatus || "Incomplete",
    accountPaperworkStatus: spec.paperwork || "", quoteSignedStatus: spec.quoteSigned || "", workAuthorizationStatus: spec.workAuth || "",
  };
  const saved = push("opportunities", row, createdAt, spec.updatedAt || NOW);
  const contactKeys = spec.contacts || [];
  contactKeys.forEach((contactKey, index) => {
    push("opportunityContacts", { id: `opp-contact-${key}-${contactKey}`, opportunityId: id, contactId: CONTACT[contactKey], accountId: ACCT[accountKey], relationshipRole: index === 0 ? "Decision maker" : "Influencer", influenceLevel: index === 0 ? "Decision maker" : "Influencer", isPrimary: index === 0, deletedAt: "" }, createdAt);
    const contactRow = out.contacts.find((c) => c.id === CONTACT[contactKey]);
    contactRow.opportunityIds.push(id);
  });
  saved.numberOfAssociatedContacts = contactKeys.length;
  if (spec.facilityKey) push("opportunityLocations", { id: `opp-location-${key}`, opportunityId: id, type: "Facility", facilityId: FAC[spec.facilityKey], locationId: "", role: "Primary site", note: "" }, createdAt);
  (spec.team || [[EMP.trey, "Sales lead"]]).forEach(([employeeId, role]) => {
    push("opportunityAssignments", { id: `opp-assignment-${key}-${employeeId.replace("emp-", "")}`, opportunityId: id, purpose: "Sales", name: NAME[employeeId.replace("emp-", "")], type: "Internal", employeeId, contactId: "", vendorAccountId: "", vendorContactId: "", assignedRole: role, status: "Assigned", notes: "" }, createdAt);
  });
  return saved;
}

// Quotes/estimates. Lines are rate-sheet items priced from the 2026 sheet.
function docLines(lines, tier) {
  return lines.map((line, index) => {
    const product = productById.get(line.productId);
    const r = rate(line.productId, line.tier || tier);
    const billable = Math.max(line.quantity, line.minimum || 0);
    return {
      lineKind: "item", productId: product.id, productName: product.name, productDescription: line.description || product.name, isProductOverridden: false,
      uomId: r.uomId, quantity: line.quantity, billableQuantity: billable, minimumQuantity: line.minimum || 0, minimumApplied: billable > line.quantity,
      rateTier: line.tier || tier, pricingMethod: "rate", unitCost: null, markupPercent: null, pricePerUnit: r.amount, extendedAmount: money(r.amount * billable),
      fuelSurchargeApplies: Boolean(product.fuelSurchargeApplies), manualDiscountAmount: 0, tax: 0, isOptional: false, sequenceNumber: index + 1, operationalDate: line.operationalDate || "",
    };
  });
}
export function totals(itemLines) {
  const subtotal = money(itemLines.reduce((s, l) => s + l.extendedAmount, 0));
  const fuelBase = money(itemLines.filter((l) => l.fuelSurchargeApplies).reduce((s, l) => s + l.extendedAmount, 0));
  const fuelSurcharge = money(fuelBase * 0.1);
  const fee = money(subtotal * 0.18);
  return { subtotal, fuelBase, fuelSurcharge, fee, total: money(subtotal + fuelSurcharge + fee) };
}
export function generatedLines(t) {
  const gen = (lineKind, productName, productDescription, amount) => ({ lineKind, productId: "", productName, productDescription, isProductOverridden: true, uomId: "", quantity: 1, billableQuantity: 1, pricePerUnit: amount, extendedAmount: amount, manualDiscountAmount: 0, tax: 0, isOptional: false });
  const lines = [];
  if (t.fuelSurcharge > 0) lines.push(gen("fuel_surcharge", "Fuel surcharge (10%)", `10% of $${t.fuelBase.toFixed(2)} in fuel-burning equipment`, t.fuelSurcharge));
  if (t.fee > 0) lines.push(gen("energy_security_fee", "Energy, Security & Insurance (18%)", `18% of the $${t.subtotal.toFixed(2)} subtotal; fuel surcharge excluded`, t.fee));
  return lines;
}
export function pricedDoc(collection, id, oppKey, accountKey, name, lines, spec = {}) {
  const tier = spec.tier || "standard";
  const items = docLines(lines, tier);
  const t = totals(items);
  const lineCollection = collection === "quotes" ? "quoteLines" : "estimateLines";
  const fk = collection === "quotes" ? "quoteId" : "estimateId";
  const createdAt = spec.createdAt || NOW;
  push(collection, {
    id, opportunityId: OPP[oppKey], customerId: ACCT[accountKey], customerLogicalName: "account", priceLevelId: "price-standard-2026", name,
    rateTier: tier, isEmergencyCallout: tier !== "standard", fuelSurchargePercent: 10, energySecurityFeePercent: 18,
    subtotalAmount: t.subtotal, fuelSurchargeAmount: t.fuelSurcharge, energySecurityFeeAmount: t.fee, totalAmount: t.total, totalAmountBase: t.total,
    statusCode: spec.status || "Draft", stateCode: "Active", effectiveFrom: spec.effectiveFrom || createdAt.slice(0, 10), effectiveTo: spec.effectiveTo || dayOffset(createdAt.slice(0, 10), 30),
    billingAddressId: "", shippingAddressId: "", notes: spec.notes || "", sourceEstimateId: spec.sourceEstimateId || "",
  }, createdAt);
  [...items, ...generatedLines(t)].forEach((line, index) => push(lineCollection, { id: `${id}-line-${index + 1}`, [fk]: id, ...line, sequenceNumber: index + 1 }, createdAt));
  const opp = out.opportunities.find((o) => o.id === OPP[oppKey]);
  if (collection === "quotes") opp.quoteId = id;
  else opp.estimateId = id;
  return t;
}

// Won opportunities behind the projects.
opportunity("lonestar-diesel", "lonestar-freight", { name: "Diesel release — saddle tank rupture, Round Rock yard", value: 14800, stage: "Won", serviceType: "Emergency Response", contacts: ["lsf-safety", "lsf-ap"], facilityKey: "lsf-yard", createdAt: "2025-07-02T13:50:00.000Z", actualCloseDate: "2025-07-02", closeBand: "0-30", nextStep: "", customerNeed: "Roughly 120 gallons of diesel from a ruptured saddle tank across the yard pavement and into the drainage swale.", proposedSolution: "Contain and recover free product, pressure-wash and vacuum the pavement, treat the swale with Micro-Bac-S, sample the swale soil, and document for the insurance claim.", paperwork: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", updatedAt: "2025-07-03T22:00:00.000Z", team: [[EMP.trey, "Sales lead"], [EMP.logan, "Field lead"]] });
opportunity("brazos-debris", "brazos-commercial", { name: "Hutto Crossing — fire debris and hydraulic fluid cleanup", value: 9600, stage: "Won", serviceType: "Scheduled Work", contacts: ["brazos-pm"], facilityKey: "brazos-hutto", createdAt: "2025-07-30T16:15:00.000Z", actualCloseDate: "2025-08-01", closeBand: "0-30", customerNeed: "Burned debris pile and a hydraulic fluid stain across the rear parking lot after a dumpster fire and a leaking compactor.", proposedSolution: "Skid steer and roll-off for debris, degrease and pressure-wash the stain, apply bacteria to the stained asphalt.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", needNotes: { "Waste hauler / disposal": "Venditti 30-yd roll-off" }, updatedAt: "2025-08-01T15:00:00.000Z" });
opportunity("permian-release", "permian-midstream", { name: "Taylor valve site crude release — excavation and treatment", value: 186000, stage: "Won", serviceType: "Multi-Stage Remediation", contacts: ["pmp-ehs", "pmp-pm", "pmp-ap"], facilityKey: "pmp-valve-site", createdAt: "2026-09-05T15:35:00.000Z", actualCloseDate: "2026-09-12", closeBand: "0-30", priority: "High", customerNeed: "Estimated 40 bbl crude release at a valve site; impacted soil to be excavated, treated on-site with bacteria and backfilled; stock tank protected.", proposedSolution: "Three-stage program: containment and free-product recovery, excavation with on-site biological treatment windrows, confirmation sampling and backfill. Daily field tickets.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", purchaseProcess: "PO issued", needNotes: { "Roll-off vendor": "Venditti", Lab: "Eurofins — confirmation samples", "Excavation subcontractor": "Balfour if EXC-402 is down" }, updatedAt: "2026-09-12T16:00:00.000Z", team: [[EMP.trey, "Sales lead"], [EMP.logan, "Field lead"], [EMP.braden, "Project executive"]] });
opportunity("hch-borings", "hill-country-hospitality", { name: "Pflugerville Inn — subsurface investigation (soil borings)", value: 12400, stage: "Won", serviceType: "Environmental Sampling", contacts: ["hch-director", "hch-gm"], facilityKey: "hch-pflugerville", createdAt: "2026-08-20T14:10:00.000Z", actualCloseDate: "2026-08-28", closeBand: "0-30", customerNeed: "Buyer due diligence flagged a former fuel tank and a failed grease line; needs soil data before closing.", proposedSolution: "Six direct-push borings to 12 ft, TPH/BTEX on two intervals each, summary letter with a closure recommendation.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", needNotes: { Lab: "Eurofins — TPH/BTEX, 10-day" }, updatedAt: "2026-08-28T15:00:00.000Z" });
opportunity("domain-garage", "domain-parking", { name: "Garage B — transformer oil wash-down (night)", value: 7200, stage: "Won", serviceType: "Scheduled Work", contacts: ["domain-ops"], facilityKey: "domain-garage-b", createdAt: "2026-04-10T16:05:00.000Z", actualCloseDate: "2026-04-20", closeBand: "0-30", customerNeed: "Transformer oil tracked across three levels by vehicle tires.", proposedSolution: "Two-night hot-water pressure-wash and degrease with wash-water recovery and disposal.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", updatedAt: "2026-04-20T15:00:00.000Z" });
opportunity("lakeway-crawlspace", "lakeway-medical", { name: "Building 2 crawlspace sewage cleanout and bioremediation", value: 11900, stage: "Won", serviceType: "Emergency Response", contacts: ["lakeway-board", "lakeway-maint"], facilityKey: "lakeway-bldg-2", createdAt: "2026-03-02T17:05:00.000Z", actualCloseDate: "2026-03-03", closeBand: "0-30", owner: NAME.braden, customerNeed: "Sewage backup pooled under Building 2; odor complaints from tenants.", proposedSolution: "Vacuum pump-out, remove saturated vapor barrier, disinfect, apply Micro-Bac-S, and photo-document before/after for the association.", paperwork: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", updatedAt: "2026-03-03T15:00:00.000Z", team: [[EMP.braden, "Sales lead"], [EMP.logan, "Field lead"]] });
opportunity("wolf-pond", "wolf-ranch-hoa", { name: "Amenity pond bioremediation — three treatments", value: 5400, stage: "Won", serviceType: "Scheduled Work", contacts: ["wolf-manager"], facilityKey: "wolf-pond", createdAt: "2026-09-08T15:05:00.000Z", actualCloseDate: "2026-09-15", closeBand: "0-30", customerNeed: "Fish kill and odor after a summer algae bloom.", proposedSolution: "Night application of Mega-Bac X from the spray trailer, three treatments 30 days apart, with dissolved-oxygen readings.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", updatedAt: "2026-09-15T15:00:00.000Z" });
opportunity("georgetown-contract", "city-georgetown", { name: "Hazardous materials management & spill response — RFP 202519", value: 250000, stage: "Won", serviceType: "Emergency Response", contacts: ["gt-purchasing", "gt-publicworks", "gt-fire"], facilityKey: "gt-service-center", createdAt: "2026-09-15T20:30:00.000Z", actualCloseDate: "2025-06-24", closeBand: "0-30", owner: NAME.braden, dealType: "Contract", customerNeed: "City-wide on-call hazardous materials and spill response.", proposedSolution: "Standing services agreement at 2026 rate-sheet pricing with a 4-hour emergency minimum, quarterly reviews.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", purchaseProcess: "RFP award", updatedAt: "2026-09-16T18:00:00.000Z", team: [[EMP.braden, "Sales lead"], [EMP.trey, "Account manager"]] });
opportunity("georgetown-hydraulic", "city-georgetown", { name: "Hydraulic oil release — Public Works Service Center wash bay", value: 6800, stage: "Won", serviceType: "Emergency Response", contacts: ["gt-publicworks"], facilityKey: "gt-service-center", createdAt: at("2026-09-24", "15:20"), actualCloseDate: "2026-09-24", closeBand: "0-30", dealType: "Existing Business", customerNeed: "Refuse truck blew a hydraulic line in the wash bay; oil in the bay and the oil-water separator.", proposedSolution: "Absorb and recover, pump and clean the separator, dispose under the city's waste profile. Under the RFP 202519 agreement.", paperwork: "Signed", workAuth: "Signed", siteWalkStatus: "Not needed", updatedAt: at("2026-09-24", "16:00"), team: [[EMP.trey, "Account manager"], [EMP.logan, "Field lead"]] });
opportunity("georgetown-storm-drain", "city-georgetown", { name: "Diesel sheen — Austin Ave storm drain", value: 4200, stage: "Won", serviceType: "Emergency Response", contacts: ["gt-fire", "gt-publicworks"], facilityKey: "gt-austin-ave", createdAt: at("2026-08-18", "09:40"), actualCloseDate: "2026-08-18", closeBand: "0-30", dealType: "Existing Business", customerNeed: "Diesel sheen in the storm drain after a delivery truck overfill; Fire Department boomed the outfall.", proposedSolution: "Recover product from the inlet and outfall, replace the FD boom, treat the residual with Micro-Bac-S.", paperwork: "Signed", workAuth: "Signed", siteWalkStatus: "Not needed", updatedAt: at("2026-08-19", "16:00"), team: [[EMP.trey, "Account manager"], [EMP.logan, "Field lead"]] });
opportunity("bluebonnet-lagoon", "bluebonnet-dairy", { name: "South lagoon liner tear — sludge removal and repair", value: 68500, stage: "Won", serviceType: "Multi-Stage Remediation", contacts: ["bbd-ops"], facilityKey: "bbd-lagoon", createdAt: "2026-08-12T15:05:00.000Z", actualCloseDate: "2026-09-18", closeBand: "0-30", customerNeed: "Liner tear along the south bank; sludge has to come out before the liner crew can patch.", proposedSolution: "Vac-out and dewater sludge, Balfour excavator support for subgrade repair, liner patch by the liner contractor, Republic haul-off of dewatered sludge.", paperwork: "Signed", quoteSigned: "Signed", workAuth: "Signed", siteWalkStatus: "Complete", needNotes: { "Excavation subcontractor": "Balfour — excavator + operator", "Roll-off vendor": "Republic — sludge haul-off" }, updatedAt: "2026-09-18T15:00:00.000Z", team: [[EMP.trey, "Sales lead"], [EMP.logan, "Field lead"]] });

// Open pipeline, one per stage, plus a loss.
opportunity("alamo-pit", "alamo-precast", { name: "Wash-water settling pit cleanout", value: 8500, stage: "Lead", serviceType: "Scheduled Work", contacts: ["alamo-plant"], createdAt: "2026-09-22T17:35:00.000Z", closeBand: "61-90", closeBandSetAt: "2026-09-22T17:35:00.000Z", nextStep: "Call Bill to size the pit and ask about disposal history", nextActivityDate: "2026-09-29", customerNeed: "Settling pit is full; plant wants it vacuumed and the solids hauled.", source: "Website form" });
opportunity("cedar-valley-agreement", "cedar-valley-fire", { name: "Standing spill response agreement + drone support", value: 45000, stage: "Qualify", serviceType: "Emergency Response", contacts: ["cvf-chief", "cvf-captain"], facilityKey: "cvf-station-2", createdAt: "2026-07-10T20:00:00.000Z", closeBand: "91-360", closeBandSetAt: "2026-09-18T15:00:00.000Z", owner: NAME.braden, nextStep: "Send the government services agreement for the board meeting", nextActivityDate: "2026-10-06", customerNeed: "District wants a response partner for roadway spills and drone overwatch on hazmat calls.", siteWalkStatus: "Complete", team: [[EMP.braden, "Sales lead"], [EMP.trey, "Support"]], source: "Training day" });
opportunity("wilco-fuel-island", "wilco-fleet", { name: "Fuel island soil investigation", value: 18500, stage: "Develop", serviceType: "Environmental Sampling", contacts: ["wilco-fleet-mgr"], facilityKey: "wilco-fuel-island", createdAt: "2026-09-10T16:05:00.000Z", closeBand: "31-60", closeBandSetAt: "2026-09-24T15:00:00.000Z", nextStep: "Site walk with Tom on 2026-09-30, then scope the boring plan", nextActivityDate: "2026-09-30", customerNeed: "Stained soil around the fuel island; county needs data before the island rebuild goes to bid.", currentSituation: "Island rebuild budgeted for FY27.", siteWalkStatus: "Scheduled", needNotes: { Lab: "Eurofins" } });
opportunity("gisd-bus-barn", "georgetown-isd", { name: "Bus barn oil-water separator and wash bay sump cleaning", value: 5900, stage: "Proposal", serviceType: "Scheduled Work", contacts: ["gisd-transport"], facilityKey: "gisd-bus-barn", createdAt: "2026-09-02T15:05:00.000Z", closeBand: "0-30", closeBandSetAt: "2026-09-23T15:00:00.000Z", nextStep: "Quote sent 2026-09-23; follow up by 2026-10-01", nextActivityDate: "2026-10-01", customerNeed: "Separator has not been cleaned in three years; wash bay sump backing up.", proposedSolution: "Vactron pump-out of the separator and sump, pressure-wash, liquid disposal, manifest.", siteWalkStatus: "Complete" });
opportunity("riverside-standing", "riverside-chemical", { name: "Standing emergency response agreement — Ben White warehouse", value: 60000, stage: "Negotiation", serviceType: "Emergency Response", contacts: ["rcd-ehs", "rcd-purchasing"], facilityKey: "rcd-warehouse", createdAt: "2026-08-05T15:05:00.000Z", closeBand: "0-30", closeBandSetAt: "2026-09-15T15:00:00.000Z", priority: "High", nextStep: "Waste authorization back from Nadia, then legal signs the MSA", nextActivityDate: "2026-09-29", customerNeed: "Insurer requires a named spill-response contractor with a 2-hour response window.", proposedSolution: "Standing agreement at rate-sheet pricing, 4-hour emergency minimum, annual drill.", currentSituation: "Purchasing is comparing against Clean Harbors' national MSA.", siteWalkStatus: "Complete", competitor: "Clean Harbors", paperwork: "Sent", purchaseProcess: "Legal review", team: [[EMP.trey, "Sales lead"], [EMP.braden, "Executive sponsor"]] });
opportunity("sunbelt-litter-pond", "sunbelt-poultry", { name: "Litter pond remediation", value: 42000, stage: "Proposal", status: "Lost", serviceType: "Multi-Stage Remediation", contacts: ["sunbelt-plant"], createdAt: "2026-07-15T15:05:00.000Z", actualCloseDate: "2026-09-02", closeBand: "0-30", closeBandSetAt: "2026-08-20T15:00:00.000Z", competitor: "Lone Star HazMat Response", lostReason: "Price — Lone Star HazMat came in 22% lower with no biological treatment.", updatedAt: "2026-09-02T15:00:00.000Z", nextStep: "" });
push("opportunityCompetitors", { id: "opp-competitor-sunbelt-lonestar", opportunityId: OPP["sunbelt-litter-pond"], competitorId: "competitor-lonestar-hazmat", name: "Lone Star HazMat Response" }, "2026-08-20T15:00:00.000Z");
push("opportunityCompetitors", { id: "opp-competitor-riverside-clh", opportunityId: OPP["riverside-standing"], competitorId: "competitor-clean-harbors", name: "Clean Harbors" }, "2026-09-15T15:00:00.000Z");

// Quotes and estimates.
pricedDoc("estimates", "estimate-gisd-bus-barn", "gisd-bus-barn", "georgetown-isd", "Bus barn separator & sump cleaning — estimate", [
  { productId: P("vactron"), quantity: 6 }, { productId: P("recovery-truck-operator"), quantity: 6 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 6 },
  { productId: P("3500-psi-trailer-mounted-hot-water-pressure-washer-includes-"), quantity: 1 }, { productId: P("liquid-disposal-hydrocarbons-and-water"), quantity: 900 }, { productId: P("non-hazardous-waste-management-profiling-fee"), quantity: 1 }, { productId: P("epa-waste-manifest-fee"), quantity: 1 },
], { createdAt: "2026-09-19T16:00:00.000Z", status: "Draft" });
pricedDoc("quotes", "quote-gisd-bus-barn", "gisd-bus-barn", "georgetown-isd", "Bus barn separator & sump cleaning", [
  { productId: P("vactron"), quantity: 6 }, { productId: P("recovery-truck-operator"), quantity: 6 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 6 },
  { productId: P("3500-psi-trailer-mounted-hot-water-pressure-washer-includes-"), quantity: 1 }, { productId: P("liquid-disposal-hydrocarbons-and-water"), quantity: 900 }, { productId: P("non-hazardous-waste-management-profiling-fee"), quantity: 1 }, { productId: P("epa-waste-manifest-fee"), quantity: 1 },
], { createdAt: "2026-09-23T15:30:00.000Z", status: "Sent", sourceEstimateId: "estimate-gisd-bus-barn", notes: "Valid 30 days. Pricing per the 2026 rate sheet; district PO required before scheduling." });
pricedDoc("quotes", "quote-riverside-standing", "riverside-standing", "riverside-chemical", "Standing emergency response — sample 4-hour call-out", [
  { productId: P("supervisor"), quantity: 4, tier: "ot_emergency", minimum: 4 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 4, tier: "ot_emergency", minimum: 4 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 4, tier: "ot_emergency", minimum: 4 },
  { productId: P("hazmat-recovery-truck"), quantity: 4, tier: "ot_emergency", minimum: 4 }, { productId: P("hazmat-response-trailer-tools-package"), quantity: 1 }, { productId: P("modified-level-d-ppe-package-hard-hat-safety-glasses-tyvek-s"), quantity: 3 }, { productId: P("grey-universal-absorbent-pads-100-bale"), quantity: 2 },
], { tier: "ot_emergency", createdAt: "2026-09-15T15:00:00.000Z", status: "Sent", notes: "Illustrative call-out under the proposed agreement; actuals billed from field records." });
pricedDoc("quotes", "quote-permian-release", "permian-release", "permian-midstream", "Taylor valve site — remediation program (estimate of record)", [
  { productId: P("senior-project-manager-er-manager-ic"), quantity: 40 }, { productId: P("supervisor"), quantity: 120 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 240 }, { productId: P("heavy-equipment-operator"), quantity: 80 },
  { productId: P("skid-steer-front-loader-does-not-include-operator-or-trailer"), quantity: 12 }, { productId: P("mini-excavator-does-not-include-operator-or-trailer"), quantity: 12 }, { productId: P("vactron"), quantity: 24 }, { productId: P("microbial-spray-trailer"), quantity: 6 },
  { productId: P("hazmat-response-trailer-tools-package"), quantity: 12 }, { productId: P("3-4-ton-or-1-ton-pick-up-truck"), quantity: 24 }, { productId: P("mega-bac-x"), quantity: 120 }, { productId: P("level-d-ppe-package-hard-hat-safety-glasses-and-safety-vest"), quantity: 36 },
  { productId: P("sampling-supplies"), quantity: 12 }, { productId: P("non-hazardous-waste-transportation-fee"), quantity: 6 }, { productId: P("non-hazardous-waste-management-profiling-fee"), quantity: 1 }, { productId: P("tceq-report"), quantity: 1 }, { productId: P("per-diem"), quantity: 36 },
], { createdAt: "2026-09-10T15:00:00.000Z", status: "Accepted", notes: "Accepted 2026-09-12 with PO PMP-004471. Time-and-materials against this baseline; daily field tickets." });
pricedDoc("quotes", "quote-bluebonnet-lagoon", "bluebonnet-lagoon", "bluebonnet-dairy", "South lagoon sludge removal and liner repair support", [
  { productId: P("supervisor"), quantity: 40 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 80 }, { productId: P("vactron"), quantity: 40 }, { productId: P("recovery-truck-operator"), quantity: 40 },
  { productId: P("dump-trailer"), quantity: 5 }, { productId: P("3-4-ton-or-1-ton-pick-up-truck"), quantity: 10 }, { productId: P("roll-off-box-vacuum-box-20-25-cubic-yd"), quantity: 10 }, { productId: P("non-hazardous-waste-transportation-fee"), quantity: 4 }, { productId: P("level-d-ppe-package-hard-hat-safety-glasses-and-safety-vest"), quantity: 15 },
], { createdAt: "2026-09-16T15:00:00.000Z", status: "Accepted", notes: "Accepted 2026-09-18. Balfour excavator support and Republic haul-off billed at cost plus 20% as separate lines." });
pricedDoc("quotes", "quote-wolf-pond", "wolf-pond", "wolf-ranch-hoa", "Amenity pond bioremediation — three night treatments", [
  { productId: P("microbial-spray-trailer"), quantity: 3 }, { productId: P("technician-hazmat-trained-confined-space-certified"), quantity: 12 }, { productId: P("supervisor"), quantity: 6 }, { productId: P("mega-bac-x"), quantity: 30 }, { productId: P("3-4-ton-or-1-ton-pick-up-truck"), quantity: 3 },
], { createdAt: "2026-09-12T15:00:00.000Z", status: "Accepted" });

// Paperwork gating Negotiation on Riverside, and Georgetown's packet on file.
push("documentRequirements", { id: "requirement-riverside-packet", documentTypeId: "doctype-customer-packet", entityType: "opportunity", entityId: OPP["riverside-standing"], accountId: ACCT["riverside-chemical"], status: "Approved", source: "opportunity", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.trey, sentAt: "2026-09-08T15:00:00.000Z", reviewedAt: "2026-09-16T15:00:00.000Z", reviewedBy: NAME.charlotte }, "2026-09-08T15:00:00.000Z", "2026-09-16T15:00:00.000Z");
push("documentRequirements", { id: "requirement-riverside-waste", documentTypeId: "doctype-waste-authorization", entityType: "opportunity", entityId: OPP["riverside-standing"], accountId: ACCT["riverside-chemical"], status: "Sent", source: "opportunity", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.trey, sentAt: "2026-09-22T15:00:00.000Z", reviewedAt: "", reviewedBy: "" }, "2026-09-08T15:00:00.000Z", "2026-09-22T15:00:00.000Z");
push("documentRequirements", { id: "requirement-riverside-msa", documentTypeId: "doctype-service-agreement-msa", entityType: "account", entityId: ACCT["riverside-chemical"], accountId: ACCT["riverside-chemical"], status: "In review", source: "opportunity", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.trey, sentAt: "2026-09-15T15:00:00.000Z", reviewedAt: "", reviewedBy: "" }, "2026-09-15T15:00:00.000Z", "2026-09-24T15:00:00.000Z");
push("documentRequirements", { id: "requirement-georgetown-packet", documentTypeId: "doctype-customer-packet", entityType: "account", entityId: ACCT["city-georgetown"], accountId: ACCT["city-georgetown"], status: "Approved", source: "account", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.braden, sentAt: "2025-06-24T15:00:00.000Z", reviewedAt: "2025-06-30T15:00:00.000Z", reviewedBy: NAME.charlotte }, "2026-09-16T15:00:00.000Z");
push("documentRequirements", { id: "requirement-georgetown-msa", documentTypeId: "doctype-service-agreement-msa", entityType: "account", entityId: ACCT["city-georgetown"], accountId: ACCT["city-georgetown"], status: "Approved", source: "account", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.braden, sentAt: "2025-06-24T15:00:00.000Z", reviewedAt: "2025-06-30T15:00:00.000Z", reviewedBy: NAME.charlotte }, "2026-09-16T15:00:00.000Z");
push("documentRequirements", { id: "requirement-capital-grocers-packet", documentTypeId: "doctype-customer-packet", entityType: "project", entityId: "proj-capital-grocers-acid", accountId: ACCT["capital-grocers"], status: "Sent", source: "emergency-intake", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: at(TODAY, "07:55"), reviewedAt: "", reviewedBy: "" }, at(TODAY, "07:50"));
push("documentRequirements", { id: "requirement-capital-grocers-waste", documentTypeId: "doctype-waste-authorization", entityType: "project", entityId: "proj-capital-grocers-acid", accountId: ACCT["capital-grocers"], status: "Not started", source: "emergency-intake", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: "", reviewedAt: "", reviewedBy: "" }, at(TODAY, "07:50"));
push("documentRequirements", { id: "requirement-balfour-coi", documentTypeId: "doctype-vendor-coi", entityType: "account", entityId: ACCT.balfour, accountId: ACCT.balfour, status: "Approved", source: "vendor", counterparty: "vendor", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: "2026-09-16T15:00:00.000Z", reviewedAt: "2026-09-19T15:00:00.000Z", reviewedBy: NAME.braden }, "2026-09-16T15:00:00.000Z");
push("documentRequirements", { id: "requirement-venditti-coi", documentTypeId: "doctype-vendor-coi", entityType: "account", entityId: ACCT.venditti, accountId: ACCT.venditti, status: "Approved", source: "vendor", counterparty: "vendor", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: "2026-09-16T15:00:00.000Z", reviewedAt: "2026-09-17T15:00:00.000Z", reviewedBy: NAME.logan }, "2026-09-16T15:00:00.000Z");

// ---- timeline: activities, tasks, site walks -------------------------------------------------
let activitySeq = 0;
export function activity(spec) {
  activitySeq += 1;
  const id = `act-${String(activitySeq).padStart(3, "0")}-${spec.key}`;
  const when = spec.at;
  const date = when.slice(0, 10);
  const contactIds = (spec.contacts || []).map((k) => CONTACT[k]);
  return push("activities", {
    id, owner: spec.owner || NAME.trey, author: spec.owner || NAME.trey, createdBy: spec.owner || NAME.trey,
    accountId: spec.account ? ACCT[spec.account] : "", contactIds, contactId: contactIds[0] || "", opportunityId: spec.opp ? OPP[spec.opp] : "", projectId: spec.projectId || "",
    activityType: spec.type, kind: spec.type, subject: spec.subject, body: spec.body || "", description: "",
    direction: spec.direction || (spec.type === "Note" ? "Internal" : "Outbound"), channel: spec.channel || (spec.type === "Call" ? "Phone" : spec.type === "Email" ? "Email" : spec.type === "Meeting" ? "In person" : ""),
    activityDate: date, meetingTime: spec.type === "Meeting" ? when.slice(11, 16) : "", meetingFormat: spec.type === "Meeting" ? "Offline" : "", meetingPlatform: "", meetingLink: "", meetingLocation: spec.location || "",
    status: spec.status || (date > TODAY ? "Scheduled" : "Completed"), tags: spec.tags || [], dueDate: spec.type === "Task" ? date : "", completedAt: date <= TODAY && spec.type !== "Note" ? when : "", priority: spec.priority || "",
    relatedRecords: spec.related || [],
  }, spec.createdAt || when, spec.createdAt || when);
}

activity({ key: "georgetown-award", type: "Note", account: "city-georgetown", opp: "georgetown-contract", owner: NAME.braden, at: "2026-09-16T18:05:00.000Z", subject: "Contract history loaded", body: "RFP 202519 awarded June 2025; services agreement effective 2025-07-01 with two one-year renewals. Blanket PO issued each October." });
activity({ key: "georgetown-quarterly", type: "Meeting", account: "city-georgetown", contacts: ["gt-purchasing", "gt-publicworks"], owner: NAME.braden, at: "2026-09-17T15:00:00.000Z", subject: "Quarterly contract review", location: "Georgetown Municipal Complex", body: "Reviewed Q3 call-outs (storm drain, wash bay). Marcus asked for a text when crews are en route. Dana confirmed the FY27 blanket PO is in process.", tags: ["Customer meeting"] });
activity({ key: "georgetown-hydraulic-call", type: "Call", account: "city-georgetown", contacts: ["gt-publicworks"], opp: "georgetown-hydraulic", owner: NAME.charlotte, direction: "Inbound", at: at("2026-09-24", "15:05"), subject: "Marcus Reyes — hydraulic line failure in the wash bay", body: "Refuse truck 118 blew a hydraulic line in the wash bay. Oil in the bay and into the oil-water separator; bay is closed. Wants the crew tomorrow morning. PO release to follow from Dana." });
activity({ key: "georgetown-hydraulic-text", type: "Email", account: "city-georgetown", contacts: ["gt-publicworks"], opp: "georgetown-hydraulic", owner: NAME.logan, at: at("2026-09-24", "16:10"), subject: "Crew confirmed for 8am Friday", body: "Logan, Tristan and Joe on site 8:00. Vactron and the spill trailer. Please leave the wash bay closed overnight." });
activity({ key: "georgetown-storm-close", type: "Email", account: "city-georgetown", contacts: ["gt-fire", "gt-publicworks"], opp: "georgetown-storm-drain", owner: NAME.trey, at: at("2026-08-20", "10:30"), subject: "Austin Ave storm drain — report and invoice sent", body: "Post-work report and invoice 2026-0818-01 sent to AP with the PO release." });
activity({ key: "lonestar-call", type: "Call", account: "lonestar-freight", contacts: ["lsf-safety"], opp: "lonestar-diesel", owner: NAME.charlotte, direction: "Inbound", at: "2025-07-02T13:40:00.000Z", subject: "Ray Castillo — saddle tank rupture, diesel across the yard", body: "Tractor backed into a bollard; saddle tank split. Estimated 100–120 gallons on the pavement, running toward the swale. Insurance claim with Progressive. Work authorization signed on arrival." });
activity({ key: "lonestar-adjuster", type: "Call", account: "progressive-claims", contacts: ["prog-adjuster"], opp: "lonestar-diesel", owner: NAME.trey, at: "2025-07-02T18:30:00.000Z", subject: "Kevin Marsh — scope approval on claim 26-4471-TX", body: "Adjuster approved emergency scope: recovery, wash-down, swale treatment, confirmation samples. Wants the itemized invoice and photos." });
activity({ key: "lonestar-invoice", type: "Email", account: "lonestar-freight", contacts: ["lsf-ap", "lsf-safety"], opp: "lonestar-diesel", owner: NAME.charlotte, at: "2025-07-21T15:00:00.000Z", subject: "Invoice 2025-0702-01 with report and photos", body: "Sent to Lone Star AP and copied to the Progressive adjuster." });
activity({ key: "lonestar-followup", type: "Task", account: "lonestar-freight", contacts: ["lsf-safety"], owner: NAME.trey, at: "2026-10-06T14:00:00.000Z", subject: "Pitch a standing fleet spill-response agreement", body: "Ray mentioned two more yards. Bring the Riverside agreement as the template.", status: "Scheduled", priority: "Normal" });
activity({ key: "brazos-walk", type: "Meeting", account: "brazos-commercial", contacts: ["brazos-pm"], opp: "brazos-debris", owner: NAME.trey, at: "2025-07-31T15:00:00.000Z", subject: "Site walk — Hutto Crossing rear lot", location: "Hutto Crossing shopping center", body: "Debris pile about 6 yd; hydraulic stain 40 ft along the compactor pad. Quote sent same day.", tags: ["Site Visit"] });
activity({ key: "permian-kickoff", type: "Meeting", account: "permian-midstream", contacts: ["pmp-ehs", "pmp-pm"], opp: "permian-release", owner: NAME.trey, at: "2026-09-08T15:00:00.000Z", subject: "Kickoff and site walk — Taylor valve site", location: "Taylor valve site — CR 401", body: "Walked the release area with Derek and Sonia. Staging on the caliche pad; load/depart plan drawn up. Confirmation sampling grid agreed.", tags: ["Site Visit", "Customer meeting"] });
activity({ key: "permian-daily-1", type: "Email", account: "permian-midstream", contacts: ["pmp-ehs"], opp: "permian-release", owner: NAME.logan, at: at("2026-09-19", "18:30"), subject: "Daily field ticket — day 1", body: "Mobilized, containment set, 1,900 gal free product and water recovered. Skid steer and excavator on site." });
activity({ key: "permian-daily-2", type: "Email", account: "permian-midstream", contacts: ["pmp-ehs"], opp: "permian-release", owner: NAME.logan, at: at("2026-09-22", "18:15"), subject: "Daily field ticket — day 2", body: "Excavation to 3 ft across the release footprint; first treatment windrow built and sprayed. Excavator hydraulic leak found at end of day; swapped to Balfour's unit for day 3." });
activity({ key: "permian-daily-3", type: "Email", account: "permian-midstream", contacts: ["pmp-ehs"], opp: "permian-release", owner: NAME.logan, at: at("2026-09-24", "18:40"), subject: "Daily field ticket — day 3", body: "Excavation complete on the east half; windrows 1–3 turned and re-sprayed. PID readings on sidewalls 12–40 ppm." });
activity({ key: "hch-results-call", type: "Call", account: "hill-country-hospitality", contacts: ["hch-director"], opp: "hch-borings", owner: NAME.trey, at: at("2026-09-22", "14:20"), subject: "Grant Whitaker — where are the lab results?", body: "Buyer's deadline is 2026-10-03. Eurofins promised results by 2026-09-29. Told him the summary letter follows within two days of results." });
activity({ key: "hch-lab", type: "Email", account: "eurofins", contacts: ["eurofins-pm"], owner: NAME.logan, at: at("2026-09-24", "09:10"), subject: "Pflugerville Inn borings — turnaround check", body: "Priya confirmed results Monday 9/29 for the 12 soil samples on COC-2026-0911." });
activity({ key: "domain-close", type: "Email", account: "domain-parking", contacts: ["domain-ops"], opp: "domain-garage", owner: NAME.charlotte, at: "2026-05-06T15:00:00.000Z", subject: "Invoice 2026-0501-01 and after photos", body: "Two nights complete. Invoice paid 2026-05-28." });
activity({ key: "domain-quarterly", type: "Task", account: "domain-parking", contacts: ["domain-ops"], owner: NAME.trey, at: "2026-10-15T14:00:00.000Z", subject: "Propose a quarterly garage wash schedule", status: "Scheduled" });
activity({ key: "lakeway-call", type: "Call", account: "lakeway-medical", contacts: ["lakeway-maint"], opp: "lakeway-crawlspace", owner: NAME.braden, direction: "Inbound", at: "2026-03-02T16:50:00.000Z", subject: "Hector Ruiz — sewage under Building 2", body: "Main line backed up over the weekend; standing sewage under the crawlspace. Tenants complaining about odor. Board president approved emergency work by phone." });
activity({ key: "lakeway-report", type: "Email", account: "lakeway-medical", contacts: ["lakeway-board"], opp: "lakeway-crawlspace", owner: NAME.braden, at: "2026-03-13T15:00:00.000Z", subject: "Before/after report for the board", body: "Photo report with the numbered picture set sent for the March board meeting." });
activity({ key: "wolf-treatment-1", type: "Email", account: "wolf-ranch-hoa", contacts: ["wolf-manager"], opp: "wolf-pond", owner: NAME.logan, at: at("2026-09-21", "08:30"), subject: "Treatment 1 complete", body: "Applied 10 gallons Mega-Bac X from the spray trailer overnight 9/20. DO 3.1 mg/L at the outfall. Next treatment ~10/20." });
activity({ key: "capital-call", type: "Call", account: "capital-grocers", contacts: ["cag-warehouse"], owner: NAME.charlotte, direction: "Inbound", at: at(TODAY, "07:40"), subject: "Luis Ortega — forklift battery acid on Dock 4", body: "Forklift battery cracked during a swap; roughly 5 gallons of acid on the dock, some into the floor drain. Dock closed. New customer — packet sent, waiting on the work authorization before we roll." });
activity({ key: "capital-packet", type: "Email", account: "capital-grocers", contacts: ["cag-warehouse"], owner: NAME.charlotte, at: at(TODAY, "07:55"), subject: "New customer packet and work authorization", body: "Packet, W-9 and work authorization sent for signature. Crew can be there within the hour of the signed authorization." });
activity({ key: "bluebonnet-plan", type: "Meeting", account: "bluebonnet-dairy", contacts: ["bbd-ops"], opp: "bluebonnet-lagoon", owner: NAME.logan, at: at("2026-09-23", "10:00"), subject: "Planning meeting — lagoon liner", location: "Blue Bonnet Dairy Co-op", body: "Wade wants the lagoon down by 10/12. Balfour excavator penciled for 10/12–10/16; liner material ships 10/9. Republic profile submitted.", tags: ["Customer meeting"] });
activity({ key: "bluebonnet-vendor", type: "Call", account: "balfour", contacts: ["balfour-ops"], owner: NAME.logan, at: at("2026-09-19", "11:00"), subject: "Mike Balfour — October excavator availability", body: "Tentative 10/12–10/16 with operator at $145/hr. COI renewed through June 2027." });
activity({ key: "alamo-inbound", type: "Email", account: "alamo-precast", contacts: ["alamo-plant"], opp: "alamo-pit", owner: NAME.trey, direction: "Inbound", at: "2026-09-22T17:30:00.000Z", subject: "Website inquiry — wash-water pit cleanout", body: "Bill Hardy asked for pricing to vacuum and haul the settling pit solids. Replied asking for pit dimensions and last cleanout date." });
activity({ key: "alamo-call", type: "Task", account: "alamo-precast", contacts: ["alamo-plant"], opp: "alamo-pit", owner: NAME.trey, at: "2026-09-29T14:00:00.000Z", subject: "Call Bill Hardy to qualify the pit cleanout", status: "Scheduled", priority: "High" });
activity({ key: "cedar-demo", type: "Meeting", account: "cedar-valley-fire", contacts: ["cvf-chief", "cvf-captain"], opp: "cedar-valley-agreement", owner: NAME.braden, at: "2026-07-10T15:00:00.000Z", subject: "Drone demo and spill-response training day — Station 2", location: "Station 2, Cedar Park", body: "Flew the drone for the shift, walked through boom deployment and the CyberResponse unit. Chief Dunn wants a standing agreement on the next board agenda.", tags: ["Site Visit", "Customer meeting"] });
activity({ key: "cedar-followup", type: "Call", account: "cedar-valley-fire", contacts: ["cvf-captain"], opp: "cedar-valley-agreement", owner: NAME.braden, at: "2026-09-18T15:30:00.000Z", subject: "Amy Fischer — board timing", body: "Board meets 10/6. Send the government services agreement and a one-page drone capability sheet by 9/30." });
activity({ key: "cedar-send", type: "Task", account: "cedar-valley-fire", contacts: ["cvf-chief"], opp: "cedar-valley-agreement", owner: NAME.braden, at: "2026-09-30T14:00:00.000Z", subject: "Send government services agreement + drone sheet", status: "Scheduled", priority: "High" });
activity({ key: "wilco-intro", type: "Call", account: "wilco-fleet", contacts: ["wilco-fleet-mgr"], opp: "wilco-fuel-island", owner: NAME.trey, at: "2026-09-10T16:00:00.000Z", subject: "Tom Brennan — fuel island investigation", body: "Stained soil at the dispensers; county wants data before the rebuild bid. Site walk set for 9/30." });
activity({ key: "gisd-walk", type: "Meeting", account: "georgetown-isd", contacts: ["gisd-transport"], opp: "gisd-bus-barn", owner: NAME.trey, at: "2026-09-16T14:00:00.000Z", subject: "Site walk — bus barn separator and wash bay", location: "Transportation center bus barn", body: "Separator roughly 900 gallons, sump 200. Access from the wash bay apron. Quote to follow.", tags: ["Site Visit"] });
activity({ key: "gisd-quote", type: "Email", account: "georgetown-isd", contacts: ["gisd-transport"], opp: "gisd-bus-barn", owner: NAME.trey, at: "2026-09-23T15:35:00.000Z", subject: "Quote — separator and sump cleaning", body: "Quote sent; Karen will take it to the business office for a PO." });
activity({ key: "riverside-neg", type: "Meeting", account: "riverside-chemical", contacts: ["rcd-ehs", "rcd-purchasing"], opp: "riverside-standing", owner: NAME.trey, at: "2026-09-15T16:00:00.000Z", subject: "Agreement review with EHS and Purchasing", location: "Riverside Chemical — Ben White", body: "Owen is benchmarking against Clean Harbors' MSA. Nadia wants the 2-hour response window in writing. Sample call-out quote sent after the meeting.", tags: ["Customer meeting"] });
activity({ key: "riverside-waste", type: "Email", account: "riverside-chemical", contacts: ["rcd-ehs"], opp: "riverside-standing", owner: NAME.trey, at: "2026-09-22T15:00:00.000Z", subject: "Waste authorization for signature", body: "Republic third-party waste authorization sent for Nadia's signature." });
activity({ key: "riverside-legal", type: "Task", account: "riverside-chemical", contacts: ["rcd-purchasing"], opp: "riverside-standing", owner: NAME.trey, at: "2026-09-29T14:00:00.000Z", subject: "Check on legal review of the MSA", status: "Scheduled", priority: "High" });
activity({ key: "sunbelt-lost", type: "Note", account: "sunbelt-poultry", opp: "sunbelt-litter-pond", owner: NAME.trey, at: "2026-09-02T15:00:00.000Z", subject: "Lost to Lone Star HazMat", body: "Ed Vance: Lone Star was 22% lower. No biological treatment in their scope; revisit when the second pond comes up in Q1." });
activity({ key: "republic-profile", type: "Email", account: "republic-services", contacts: ["republic-rep"], owner: NAME.charlotte, at: at("2026-09-22", "11:00"), subject: "Blue Bonnet sludge profile submitted", body: "Non-haz profile for dewatered dairy lagoon sludge sent to Carla; 3–5 day approval." });

// Tasks (the task board), including a couple already done.
const task = (id, spec) => push("tasks", { id, accountId: spec.account ? ACCT[spec.account] : "", contactId: spec.contact ? CONTACT[spec.contact] : "", opportunityId: spec.opp ? OPP[spec.opp] : "", activityId: "", title: spec.title, dueDate: spec.due, owner: spec.owner || NAME.trey, type: spec.type || "Follow-up", priority: spec.priority || "Normal", status: spec.status || "Open", completedAt: spec.completedAt || "" }, spec.createdAt || NOW);
task("task-riverside-msa", { account: "riverside-chemical", contact: "rcd-purchasing", opp: "riverside-standing", title: "Get the signed MSA back from Riverside legal", due: "2026-09-30", priority: "High", type: "Proposal" });
task("task-gisd-po", { account: "georgetown-isd", contact: "gisd-transport", opp: "gisd-bus-barn", title: "Follow up on the bus barn quote / PO", due: "2026-10-01", type: "Proposal" });
task("task-wilco-walk", { account: "wilco-fleet", contact: "wilco-fleet-mgr", opp: "wilco-fuel-island", title: "Site walk — fleet yard fuel island (bring the PID)", due: "2026-09-30", type: "Site walk" });
task("task-hch-letter", { account: "hill-country-hospitality", contact: "hch-director", opp: "hch-borings", title: "Draft the closure recommendation letter once results land", due: "2026-10-01", owner: NAME.logan, type: "Reporting" });
task("task-georgetown-po", { account: "city-georgetown", contact: "gt-purchasing", opp: "georgetown-hydraulic", title: "PO release for the wash bay hydraulic job", due: "2026-09-26", owner: NAME.charlotte, type: "Billing" });
task("task-venditti-coi", { account: "venditti", contact: "venditti-dispatch", title: "Request COI renewal (expires 2026-11-30)", due: "2026-11-01", owner: NAME.charlotte, type: "Compliance" });
task("task-joe-refresher", { title: "Book Joe's HAZWOPER 8-hour refresher (expires 2026-10-20)", due: "2026-10-10", owner: NAME.logan, type: "Compliance", priority: "High" });
task("task-brazos-restripe", { account: "brazos-commercial", contact: "brazos-pm", title: "Ask Alicia about the re-striping project", due: "2025-09-05", status: "Complete", completedAt: "2025-09-05T16:00:00.000Z", createdAt: "2025-08-25T15:00:00.000Z" });

// Site walk on the Williamson County opportunity (a scheduleEvents row of kind site_walk + its meeting).
const wilcoWalk = activity({ key: "wilco-site-walk", type: "Meeting", account: "wilco-fleet", contacts: ["wilco-fleet-mgr"], opp: "wilco-fuel-island", owner: NAME.trey, at: at("2026-09-30", "09:00"), subject: "Site walk — Fleet yard fuel island", location: "Fleet yard fuel island, 3151 SE Inner Loop, Georgetown", body: "Walk the fuel island with Tom; PID screening and photos for the boring plan.", tags: ["Site Visit"], status: "Scheduled", related: [{ type: "opportunity", id: OPP["wilco-fuel-island"] }, { type: "facility", id: FAC["wilco-fuel-island"] }] });
push("scheduleEvents", { id: "site-walk-wilco-fuel-island", kind: "site_walk", projectId: "", opportunityId: OPP["wilco-fuel-island"], accountId: ACCT["wilco-fleet"], facilityId: FAC["wilco-fuel-island"], title: "Site walk — Fleet yard fuel island", date: "2026-09-30", startTime: "09:00", endTime: "10:30", participantEmployeeIds: [EMP.trey, EMP.logan], activityId: wilcoWalk.id, notes: "Bring the PID and the boring plan template.", status: "Scheduled", crew: "Sales", equipmentAssetTags: ["PID-802"], laborResourceIds: [], requiredCertifications: [] }, at("2026-09-24", "15:00"));
push("opportunityAssignments", { id: "opp-assignment-wilco-fuel-island-logan", opportunityId: OPP["wilco-fuel-island"], purpose: "Sales", name: NAME.logan, type: "Internal", employeeId: EMP.logan, contactId: "", vendorAccountId: "", vendorContactId: "", assignedRole: "Site walk", status: "Assigned", notes: "" }, at("2026-09-24", "15:00"));

// Sales activity counts on contacts.
for (const c of out.contacts) {
  const n = out.activities.filter((a) => a.contactIds.includes(c.id)).length;
  c.numberOfSalesActivities = n;
  c.numberOfTimesContacted = n;
}

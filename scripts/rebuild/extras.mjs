// The sections the first build left thin (docs/sample-data-plan.md, 2026-09-25): addresses of every
// type, facility contacts, divisions, comments, employment history, connections, activity parties,
// leads, quote products and notes, sales orders, sales tasks, conflicts, expenses, the stock ledger,
// paperwork documents, request documents, an IT thread, and more GPS points.
import { join } from "node:path";
import { out, push, at, dayOffset, money, EMP, NAME, USER, NOW, TODAY, dataDir } from "./core.mjs";
import { ACCT, CONTACT, FAC, OPP } from "./accounts.mjs";
import { PROJ, fileManifest } from "./jobs.mjs";

const acct = (key) => out.accounts.find((a) => a.id === ACCT[key]);
const contact = (key) => out.contacts.find((c) => c.id === CONTACT[key]);
const UPLOADED = join(dataDir, "..", "docs", "uploaded files");

// ---- addresses: every type, on every account ---------------------------------------------------
const existingTypes = (accountId) => new Set(out.addresses.filter((a) => a.accountId === accountId).map((a) => a.addressType));
function address(accountKey, type, spec) {
  const a = acct(accountKey);
  if (existingTypes(a.id).has(type) && !spec.force) return null;
  const key = `${accountKey}-${type.toLowerCase().replace(/[^a-z]+/g, "-")}${spec.suffix || ""}`;
  return push("addresses", {
    id: `address-${key}`, accountId: a.id, addressName: spec.name || type, addressType: type, isPrimary: type === "Primary", suiteNumber: spec.suite || "",
    street1: spec.street || a.addressOneStreetOne, street2: spec.street2 || "", street3: "", city: spec.city || a.addressOneCity, county: spec.county || a.addressOneCounty || "", stateOrProvince: spec.state || a.addressOneState || "TX", postalCode: spec.zip || a.addressOneZipCode || "", countryOrRegion: "United States",
    phone: spec.phone || a.phone, latitude: spec.lat ?? "", longitude: spec.lng ?? "", freightTerms: spec.freightTerms || "", shippingMethod: spec.shippingMethod || "", contactId: spec.contactKey ? CONTACT[spec.contactKey] : a.primaryContactId || "", deliveryInstructions: spec.instructions || "",
  }, a.createdAt, a.updatedAt);
}
const customers = ["city-georgetown", "lonestar-freight", "progressive-claims", "brazos-commercial", "permian-midstream", "hill-country-hospitality", "domain-parking", "lakeway-medical", "wolf-ranch-hoa", "capital-grocers", "bluebonnet-dairy", "alamo-precast", "cedar-valley-fire", "wilco-fleet", "georgetown-isd", "riverside-chemical", "sunbelt-poultry"];
const vendors = ["balfour", "republic-services", "eurofins", "venditti"];
for (const key of customers) {
  address(key, "Primary", { name: "Main office" });
  address(key, "Bill To", { name: "Accounts payable", instructions: acct(key).poRequired ? "PO number required on every invoice." : "Email invoices to the AP contact." });
}
address("permian-midstream", "Ship To", { name: "Taylor valve site — deliveries", street: "CR 401 at FM 973 (lease road)", city: "Taylor", county: "Williamson", zip: "76574", contactKey: "pmp-ehs", instructions: "Deliveries to the caliche pad; call Derek Hollis 30 minutes out.", freightTerms: "Prepaid", shippingMethod: "Flatbed" });
address("permian-midstream", "Tax", { name: "Tax address — Midland HQ", street: "4400 N Big Spring St", city: "Midland", county: "Midland", zip: "79705" });
address("bluebonnet-dairy", "Ship To", { name: "Farm gate — FM 1331", street: "4500 FM 1331 (south gate)", city: "Taylor", county: "Williamson", zip: "76574", contactKey: "bbd-ops", instructions: "South gate; no deliveries during morning milking (4–7am)." });
address("riverside-chemical", "Ship To", { name: "Warehouse dock", street: "6100 E Ben White Blvd, Dock 3", city: "Austin", county: "Travis", zip: "78741", contactKey: "rcd-ehs" });
address("riverside-chemical", "Tax", { name: "Tax address", street: "6100 E Ben White Blvd", city: "Austin", county: "Travis", zip: "78741" });
address("city-georgetown", "Ship To", { name: "Public Works Service Center", street: "3500 Rockmoor Dr", city: "Georgetown", county: "Williamson", zip: "78628", contactKey: "gt-publicworks", instructions: "Fleet office receives; gate code from Marcus Reyes." });
address("georgetown-isd", "Ship To", { name: "Transportation center", street: "1301 Old Airport Rd", city: "Georgetown", county: "Williamson", zip: "78626", contactKey: "gisd-transport" });
address("lonestar-freight", "Ship To", { name: "Round Rock yard — dispatch office", street: "2100 Chisholm Trail Rd", city: "Round Rock", county: "Williamson", zip: "78681", contactKey: "lsf-safety" });
for (const key of vendors) {
  address(key, "Remit-To", { name: "Remit-To" });
  address(key, "Vendor Dispatch", { name: "Yard / dispatch" });
  address(key, "Vendor Billing", { name: "Vendor billing office" });
}
// Tax address references on the relationship extension, where the app looks for them.
for (const [key, type] of [["permian-midstream", "Tax"], ["riverside-chemical", "Tax"], ["city-georgetown", "Primary"]]) {
  const ext = out.accountRelationshipExtensions.find((e) => e.accountId === ACCT[key]);
  const row = out.addresses.find((a) => a.accountId === ACCT[key] && a.addressType === type);
  if (ext && row) ext.taxAddressId = row.id;
}
// Vendor profiles point at their addresses.
for (const key of vendors) {
  const profile = out.vendorProfiles.find((p) => p.accountId === ACCT[key]);
  const find = (type) => out.addresses.find((a) => a.accountId === ACCT[key] && a.addressType === type)?.id || "";
  if (profile) Object.assign(profile, { remitToAddressId: profile.remitToAddressId || find("Remit-To"), dispatchAddressId: profile.dispatchAddressId || find("Vendor Dispatch"), billingAddressId: profile.billingAddressId || find("Vendor Billing") });
}

// ---- facilities the first pass skipped, and coordinates on every one ---------------------------
function facility(key, accountKey, spec) {
  const a = acct(accountKey);
  const id = `fac-${key}`;
  FAC[key] = id;
  return push("facilities", { id, accountId: a.id, name: spec.name, street1: spec.street, street2: "", address: spec.street, city: spec.city, stateOrProvince: "TX", postalCode: spec.zip, countryOrRegion: "United States", phone: spec.phone || a.phone, category: spec.category || "Job Site / Field Location", categoryOther: "", badge: spec.badge || "Active", concern: spec.concern || "", access: spec.access || "", latitude: spec.lat, longitude: spec.lng, environmentalRisk: spec.risk || "" }, a.createdAt, a.updatedAt);
}
facility("alamo-plant", "alamo-precast", { name: "Hutto precast plant", street: "7800 Hwy 79 E", city: "Hutto", zip: "78634", category: "Manufacturing Plant", lat: 30.5468, lng: -97.5233, risk: "Wash-water settling pit; concrete slurry.", access: "Check in at the scale house." });
facility("sunbelt-plant", "sunbelt-poultry", { name: "Giddings processing plant", street: "2900 CR 200", city: "Giddings", zip: "78942", category: "Manufacturing Plant", badge: "Inactive", lat: 30.1828, lng: -96.9361, risk: "Litter pond; wastewater lagoons." });
facility("gt-fire-station-1", "city-georgetown", { name: "Fire Station 1 — hazmat apparatus", street: "1600 Williams Dr", city: "Georgetown", zip: "78628", category: "Corporate Office", lat: 30.6522, lng: -97.6929, access: "Ask for the on-duty captain." });
facility("pmp-field-office", "permian-midstream", { name: "Taylor field office", street: "1201 W 2nd St", city: "Taylor", zip: "76574", category: "Corporate Office", lat: 30.5706, lng: -97.4133, access: "Sonia Alvarez's office; badge required." });
const facilityCoordinates = { "gt-service-center": [30.6412, -97.6929], "gt-austin-ave": [30.6336, -97.6773], "lsf-yard": [30.5083, -97.6789], "brazos-hutto": [30.5427, -97.5467], "pmp-valve-site": [30.5731, -97.4092], "hch-pflugerville": [30.4423, -97.6118], "domain-garage-b": [30.4016, -97.7237], "lakeway-bldg-2": [30.3532, -97.9876], "wolf-pond": [30.6294, -97.7117], "cag-dock": [30.3407, -97.6702], "bbd-lagoon": [30.5602, -97.3901], "cvf-station-2": [30.5052, -97.8203], "wilco-fuel-island": [30.6194, -97.6521], "gisd-bus-barn": [30.6733, -97.6828], "rcd-warehouse": [30.2182, -97.7027] };
for (const [key, [lat, lng]] of Object.entries(facilityCoordinates)) {
  const row = out.facilities.find((f) => f.id === FAC[key]);
  if (row && (row.latitude === "" || row.latitude == null)) Object.assign(row, { latitude: lat, longitude: lng });
}

// ---- facility contacts: who works at / manages each site ----------------------------------------
const facilityContact = (facilityKey, contactKey, role, isPrimary = true) => push("facilityContacts", { id: `facility-contact-${facilityKey}-${contactKey}`, facilityId: FAC[facilityKey], contactId: CONTACT[contactKey], relationshipRole: role, isPrimary });
if (!out.facilityContacts.some((f) => f.facilityId === FAC["gt-service-center"])) facilityContact("gt-service-center", "gt-publicworks", "Manages");
facilityContact("gt-fire-station-1", "gt-fire", "Manages");
facilityContact("gt-austin-ave", "gt-publicworks", "Manages");
facilityContact("lsf-yard", "lsf-safety", "Manages");
facilityContact("brazos-hutto", "brazos-pm", "Manages");
facilityContact("pmp-valve-site", "pmp-ehs", "Manages");
facilityContact("pmp-valve-site", "pmp-pm", "Works at", false);
facilityContact("pmp-field-office", "pmp-pm", "Works at");
facilityContact("hch-pflugerville", "hch-gm", "Manages");
facilityContact("domain-garage-b", "domain-ops", "Manages");
facilityContact("lakeway-bldg-2", "lakeway-maint", "Manages");
facilityContact("wolf-pond", "wolf-manager", "Manages");
facilityContact("cag-dock", "cag-warehouse", "Manages");
facilityContact("bbd-lagoon", "bbd-ops", "Manages");
facilityContact("alamo-plant", "alamo-plant", "Manages");
facilityContact("sunbelt-plant", "sunbelt-plant", "Manages");
facilityContact("cvf-station-2", "cvf-captain", "Works at");
facilityContact("wilco-fuel-island", "wilco-fleet-mgr", "Manages");
facilityContact("gisd-bus-barn", "gisd-transport", "Manages");
facilityContact("rcd-warehouse", "rcd-ehs", "Manages");

// ---- divisions, employment history, comments -------------------------------------------------
const division = (accountKey, name, contactKeys = []) => {
  const row = push("accountDivisions", { id: `account-division-${accountKey}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, accountId: ACCT[accountKey], divisionName: name }, acct(accountKey).createdAt);
  contactKeys.forEach((k) => (contact(k).divisionId = row.id));
  return row;
};
division("city-georgetown", "Purchasing", ["gt-purchasing"]);
division("city-georgetown", "Public Works", ["gt-publicworks"]);
division("city-georgetown", "Fire Department", ["gt-fire"]);
division("permian-midstream", "EHS", ["pmp-ehs"]);
division("permian-midstream", "Engineering", ["pmp-pm"]);
division("permian-midstream", "Accounts Payable", ["pmp-ap"]);
division("hill-country-hospitality", "Facilities", ["hch-director"]);
division("hill-country-hospitality", "Pflugerville Inn", ["hch-gm"]);
division("riverside-chemical", "EHS", ["rcd-ehs"]);
division("riverside-chemical", "Purchasing", ["rcd-purchasing"]);
division("lonestar-freight", "Safety & Compliance", ["lsf-safety"]);
division("lonestar-freight", "Accounts Payable", ["lsf-ap"]);

const employment = (contactKey, employer, jobTitle, startDate, endDate, isCurrent) => push("contactEmploymentHistory", { id: `contact-employment-${contactKey}-${startDate.slice(0, 4)}`, contactId: CONTACT[contactKey], employer, jobTitle, startDate, endDate, isCurrent }, contact(contactKey).createdAt);
employment("gt-publicworks", "City of Georgetown", "Public Works Operations Manager", "2021-03-01", "", true);
employment("gt-publicworks", "City of Round Rock", "Streets Supervisor", "2014-06-01", "2021-02-28", false);
employment("pmp-ehs", "Permian Midstream Partners", "EHS Lead, Central Texas", "2023-01-09", "", true);
employment("pmp-ehs", "Enterprise Products", "Field Environmental Specialist", "2017-05-01", "2022-12-31", false);
employment("rcd-ehs", "Riverside Chemical Distribution", "EHS Manager", "2022-08-15", "", true);
employment("rcd-ehs", "Univar Solutions", "Safety Coordinator", "2018-02-01", "2022-08-01", false);
employment("lsf-safety", "Lone Star Freight Lines", "Safety & Compliance Manager", "2019-10-01", "", true);
employment("hch-director", "Hill Country Hospitality Group", "Director of Facilities", "2020-04-01", "", true);
employment("balfour-ops", "Balfour Services", "Owner", "2011-01-01", "", true);

const comment = (accountKey, author, body, when) => push("accountComments", { id: `account-comment-${accountKey}-${when.slice(0, 10)}`, accountId: ACCT[accountKey], authorName: author, body }, when);
comment("lonestar-freight", NAME.trey, "Ray mentioned two more yards (Waco and San Marcos). Good candidate for a standing agreement once the Riverside one is signed.", "2025-08-18T16:00:00.000Z");
comment("permian-midstream", NAME.logan, "Daily field ticket goes to Derek by 6pm; he forwards to AP with the PO. Keep the ticket numbers sequential.", at("2026-09-19", "18:45"));
comment("permian-midstream", NAME.charlotte, "PO PMP-004471 is a T&M PO capped at the quote total plus 15%. Progress invoice every Friday.", at("2026-09-15", "10:00"));
comment("riverside-chemical", NAME.trey, "Owen is benchmarking against Clean Harbors. Our edge is the 2-hour response window and biological treatment; lead with that in the MSA cover letter.", at("2026-09-15", "17:30"));
comment("hill-country-hospitality", NAME.trey, "Buyer's due-diligence deadline is 10/3. If Eurofins slips, ask for the rush turnaround on the two hot borings.", at("2026-09-22", "14:40"));
comment("balfour", NAME.logan, "Mike prefers a text the day before. His excavator has a thumb; ask for it on the Blue Bonnet job.", at("2026-09-19", "11:20"));
comment("venditti", NAME.charlotte, "COI expires 11/30 — request the renewal the first week of November.", at("2026-09-22", "09:00"));
comment("eurofins", NAME.logan, "Standard 10-day TAT; rush (3-day) is +50%. Priya Raman is out Fridays.", at("2026-09-24", "09:20"));
comment("capital-grocers", NAME.charlotte, "New customer, no work authorization yet. Luis says corporate has to sign; forwarded the packet to their risk manager.", at(TODAY, "08:10"));
comment("wolf-ranch-hoa", NAME.logan, "Treatments 2 and 3 should go on the board now; Janet wants them on the HOA calendar.", at("2026-09-21", "08:40"));

const facilityComment = (facilityKey, author, body, when) => push("facilityComments", { id: `facility-comment-${facilityKey}-${when.slice(0, 10)}`, facilityId: FAC[facilityKey], authorName: author, body }, when);
facilityComment("gt-service-center", NAME.logan, "Wash bay drains to an oil-water separator (about 1,500 gal) behind the fleet building. Separator access is a 24-inch manway.", at("2026-09-24", "16:30"));
facilityComment("pmp-valve-site", NAME.logan, "Lease road is caliche; fine for the truck and gooseneck, not for a 130 bbl tanker after rain. Stage on the pad.", at("2026-09-08", "17:00"));
facilityComment("lsf-yard", NAME.logan, "Swale runs to a culvert at the property line; the culvert is the last point of control before the creek.", "2025-07-02T20:00:00.000Z");
facilityComment("hch-pflugerville", NAME.logan, "Former UST pad is under the north parking spaces; GM has the old tank-removal closure letter (1998).", at("2026-09-10", "09:00"));
facilityComment("domain-garage-b", NAME.tristan, "Night work only. Security desk on level 1 has the roll-up door remote.", "2026-04-30T23:30:00.000Z");
facilityComment("lakeway-bldg-2", NAME.logan, "Crawlspace hatch is 24x24 in the janitor closet; confined space — permit, tripod and air monitoring every time.", "2026-03-03T14:00:00.000Z");

// ---- connections and activity parties --------------------------------------------------------
const connection = (key, oppKey, contactKey, roleId, name, description, start) => push("connections", { id: `connection-${key}`, ownerId: USER.trey, ownerLogicalName: "systemuser", recordOneId: OPP[oppKey], recordOneLogicalName: "opportunity", recordOneRoleId: "", recordTwoId: CONTACT[contactKey], recordTwoLogicalName: "contact", recordTwoRoleId: roleId, name, description, effectiveStart: start, effectiveEnd: "", stateCode: "Active", statusCode: "Active" }, start);
connection("permian-budget", "permian-release", "pmp-ehs", "connection-role-budget-owner", "Derek Hollis — budget owner, Taylor valve site", "Approves the PO and every change order.", "2026-09-05T15:40:00.000Z");
connection("permian-technical", "permian-release", "pmp-pm", "connection-role-technical-evaluator", "Sonia Alvarez — technical evaluator, Taylor valve site", "Reviews the excavation limits and the confirmation sampling grid.", "2026-09-05T15:40:00.000Z");
connection("riverside-budget", "riverside-standing", "rcd-purchasing", "connection-role-budget-owner", "Owen Gallagher — budget owner, standing agreement", "Owns the MSA and the comparison with Clean Harbors.", "2026-08-05T15:10:00.000Z");
connection("riverside-technical", "riverside-standing", "rcd-ehs", "connection-role-technical-evaluator", "Nadia Petrov — technical evaluator, standing agreement", "Insurer's named contact; validates the response-time clause.", "2026-08-05T15:10:00.000Z");
connection("bluebonnet-budget", "bluebonnet-lagoon", "bbd-ops", "connection-role-budget-owner", "Wade Kessler — budget owner, lagoon liner", "Co-op board delegated the spend to him.", "2026-08-12T15:10:00.000Z");
for (const meeting of out.activities.filter((a) => a.activityType === "Meeting")) {
  meeting.contactIds.forEach((contactId, index) => {
    const person = out.contacts.find((c) => c.id === contactId);
    push("activityParties", { id: `activity-party-${meeting.id}-${index + 1}`, activityId: meeting.id, partyId: contactId, partyLogicalName: "contact", participationType: index === 0 ? "Required attendee" : "Optional attendee", addressUsed: person?.email || "", displayName: person?.name || "" }, meeting.createdAt);
  });
  const owner = out.employees.find((e) => e.displayName === meeting.owner);
  if (owner) push("activityParties", { id: `activity-party-${meeting.id}-organizer`, activityId: meeting.id, partyId: owner.systemUserId || owner.id, partyLogicalName: owner.systemUserId ? "systemuser" : "employee", participationType: "Organizer", addressUsed: owner.primaryEmail, displayName: owner.displayName }, meeting.createdAt);
}

// ---- leads --------------------------------------------------------------------------------------
push("leads", { id: "lead-alamo-pit", ownerId: USER.trey, ownerLogicalName: "systemuser", customerId: ACCT["alamo-precast"], customerLogicalName: "account", parentAccountId: ACCT["alamo-precast"], parentContactId: CONTACT["alamo-plant"], qualifyingOpportunityId: OPP["alamo-pit"], transactionCurrencyId: "currency-usd", subject: "Website inquiry — settling pit cleanout", fullName: "Bill Hardy", firstName: "Bill", lastName: "Hardy", companyName: "Alamo Precast Concrete", email: "bill.hardy@alamoprecast.example", telephone: "(512) 555-0141", leadSource: "Website form", budgetAmount: 8500, estimatedValue: 8500, description: "Wash-water settling pit is full; wants it vacuumed and the solids hauled.", stateCode: "Qualified", statusCode: "Qualified", createdBy: NAME.trey, createdOn: "2026-09-22T17:30:00.000Z" }, "2026-09-22T17:30:00.000Z");
push("leads", { id: "lead-pedernales-coop", ownerId: USER.trey, ownerLogicalName: "systemuser", customerId: "", customerLogicalName: "", parentAccountId: "", parentContactId: "", qualifyingOpportunityId: "", transactionCurrencyId: "currency-usd", subject: "Transformer oil spill kits and response agreement", fullName: "Renata Ochoa", firstName: "Renata", lastName: "Ochoa", companyName: "Pedernales Electric Cooperative (referral)", email: "rochoa@pec.example", telephone: "(830) 555-0199", leadSource: "Referral — Chief Dunn", budgetAmount: 0, estimatedValue: 25000, description: "Chief Dunn passed along the contact. Substation transformer oil releases; wants a response partner in the Hill Country.", stateCode: "Open", statusCode: "New", createdBy: NAME.braden, createdOn: at("2026-09-23", "16:00") }, at("2026-09-23", "16:00"));

// ---- quote products, notes on quotes, sales orders ----------------------------------------------
for (const quote of out.quotes) {
  const lines = out.quoteLines.filter((l) => l.quoteId === quote.id && l.lineKind === "item").slice(0, 4);
  lines.forEach((line, index) => push("opportunityProducts", { id: `opp-prod-${quote.id.replace("quote-", "")}-${index + 1}`, opportunityId: quote.opportunityId, productId: line.productId, uomId: line.uomId, transactionCurrencyId: "currency-usd", productName: line.productName, productDescription: line.productDescription, isProductOverridden: false, quantity: line.quantity, pricePerUnit: line.pricePerUnit, extendedAmount: line.extendedAmount, manualDiscountAmount: 0, tax: 0 }, quote.createdAt));
  push("annotations", { id: `note-${quote.id}`, objectId: quote.id, objectLogicalName: "quote", ownerId: USER.trey, ownerLogicalName: "systemuser", subject: "Pricing basis", noteText: quote.rateTier === "ot_emergency" ? "Priced at the OT/Emergency tier with the 4-hour minimum on labor and the truck; standard tier on equipment and materials." : "Priced from the 2026 rate sheet at the standard tier. Fuel surcharge on fuel-burning equipment; 18% Energy, Security & Insurance fee on the subtotal.", filename: "", mimetype: "", filesize: 0, documentBody: "" }, quote.createdAt);
}
let orderSeq = 86;
for (const quote of out.quotes.filter((q) => q.statusCode === "Accepted")) {
  orderSeq += 1;
  const opp = out.opportunities.find((o) => o.id === quote.opportunityId);
  const customer = out.accounts.find((a) => a.id === quote.customerId);
  const project = out.projects.find((p) => p.opportunityId === opp.id);
  const facility = project ? out.facilities.find((f) => f.id === project.facilityId) : null;
  const orderId = `sales-order-${quote.id.replace("quote-", "")}`;
  push("salesOrders", { id: orderId, ownerId: USER.logan, ownerLogicalName: "systemuser", customerId: customer.id, customerLogicalName: "account", quoteId: quote.id, opportunityId: opp.id, priceLevelId: "price-standard-2026", transactionCurrencyId: "currency-usd", orderNumber: `SO-2026-${String(orderSeq).padStart(4, "0")}`, name: `${opp.name} — delivery order`, description: "Operational delivery order created when the quote was accepted.", totalAmount: quote.totalAmount, totalAmountBase: quote.totalAmount, dateFulfilled: "", stateCode: "Active", statusCode: project?.status === "Complete" ? "Fulfilled" : "In progress", billToName: customer.name, shipToName: facility?.name || customer.name }, opp.actualCloseDate ? at(opp.actualCloseDate, "16:00") : quote.createdAt);
  out.quoteLines.filter((l) => l.quoteId === quote.id && l.lineKind === "item").forEach((line, index) => push("salesOrderLines", { id: `${orderId}-line-${index + 1}`, salesOrderId: orderId, quoteLineId: line.id, productId: line.productId, uomId: line.uomId, transactionCurrencyId: "currency-usd", salesRepId: USER.trey, productName: line.productName, productDescription: line.productDescription, isProductOverridden: false, quantity: line.quantity, pricePerUnit: line.pricePerUnit, extendedAmount: line.extendedAmount, manualDiscountAmount: 0, tax: 0 }, quote.createdAt));
}

// ---- sales tasks --------------------------------------------------------------------------------
const salesTask = (id, accountKey, contactKey, subject, dueDate, priority, status, description, createdAt) => push("salesTasks", { id, accountId: ACCT[accountKey], subject, contactId: CONTACT[contactKey], dueDate, priority, activityStatus: status, statusReason: status === "Completed" ? "Done" : "Open", actualStart: "", actualEnd: status === "Completed" ? at(dueDate, "15:00") : "", description }, createdAt);
salesTask("sales-task-riverside-cover-letter", "riverside-chemical", "rcd-purchasing", "Write the MSA cover letter (response window + biological treatment)", "2026-09-29", "High", "Open", "Owen wants it before legal finishes.", at("2026-09-15", "17:35"));
salesTask("sales-task-cedar-agreement", "cedar-valley-fire", "cvf-chief", "Send the government services agreement and drone sheet", "2026-09-30", "High", "Open", "Board meets 10/6.", at("2026-09-18", "15:35"));
salesTask("sales-task-lonestar-fleet", "lonestar-freight", "lsf-safety", "Pitch a fleet spill-response agreement (Waco, San Marcos yards)", "2026-10-06", "Normal", "Open", "", at("2026-09-20", "10:00"));
salesTask("sales-task-gisd-quote-sent", "georgetown-isd", "gisd-transport", "Send the bus barn quote", "2026-09-23", "Normal", "Completed", "Sent 9/23 after the site walk.", at("2026-09-16", "16:00"));

// ---- dispatch conflicts -------------------------------------------------------------------------
push("jobConflicts", { id: "jc-georgetown-hydraulic-joe", jobId: "dispatch-job-georgetown-hydraulic", assignmentId: "ja-georgetown-hydraulic-joe", type: "Credential", severity: "Warning", status: "Open", title: "Joe's HAZWOPER 8-Hour Refresher expires 2026-10-20", detail: "Still valid for Friday's job; refresher class booked 10/14. Keep him off jobs after 10/20 until it is renewed.", resolvedAt: "", resolvedBy: "" }, at("2026-09-24", "16:16"));
push("jobConflicts", { id: "jc-permian-day1-excavator", jobId: "dispatch-job-permian-day1", assignmentId: "", type: "Equipment", severity: "Warning", status: "Resolved", title: "EXC-402 placed on maintenance hold after day 1", detail: "Hydraulic line weeping; Balfour's excavator covers Stage 2.", resolvedAt: at("2026-09-22", "18:30"), resolvedBy: NAME.logan }, at("2026-09-22", "18:10"));

// ---- expenses (receipts) -------------------------------------------------------------------------
const expense = (id, jobId, empKey, incurredOn, category, paymentMethod, vendor, amount, note, status = "Submitted") => {
  const job = out.dispatchJobs.find((j) => j.id === jobId);
  const billable = !["Fuel", "Other"].includes(category);
  push("jobExpenses", { id, dispatchJobId: jobId, projectId: job.projectId, employeeId: EMP[empKey], incurredOn, category, paymentMethod, vendor, amount, reimbursable: paymentMethod !== "Company card", billable, note, status, receiptAttachmentId: "", submittedAt: at(incurredOn, "18:30"), submittedBy: NAME[empKey], ...(status === "Approved" ? { approvedAt: at(dayOffset(incurredOn, 2), "10:00"), approvedBy: NAME.charlotte } : {}) }, at(incurredOn, "18:30"));
};
expense("expense-permian-fuel-0919", "dispatch-job-permian-day1", "logan", "2026-09-19", "Fuel", "Company card", "Buc-ee's Taylor", 186.4, "TRK-101 and the skid steer", "Approved");
expense("expense-permian-perdiem-0919", "dispatch-job-permian-day1", "tristan", "2026-09-19", "Per diem / meals", "Personal (reimburse me)", "Taylor Cafe", 42.15, "Crew lunch, day 1", "Approved");
expense("expense-permian-materials-0922", "dispatch-job-permian-stage2", "logan", "2026-09-22", "Materials purchased", "Company card", "Tractor Supply — Taylor", 214.88, "Poly sheeting and T-posts for the windrows");
expense("expense-permian-fuel-0924", "dispatch-job-permian-stage2", "joe", "2026-09-24", "Fuel", "Company card", "Shell — FM 973", 142.7, "TRK-101");
expense("expense-lonestar-disposal", "dispatch-job-lonestar-diesel", "logan", "2025-07-03", "Subcontracted service", "Company card", "Republic Services", 910, "Vac truck pickup of 520 gal recovered diesel/water", "Approved");
expense("expense-domain-parking", "dispatch-job-domain-garage", "tristan", "2026-05-01", "Travel (airfare, tolls, parking)", "Personal (reimburse me)", "Domain Garage B", 12, "Overnight parking for TRK-102", "Approved");
expense("expense-hch-rig", "dispatch-job-hch-borings", "logan", "2026-09-10", "Equipment rental", "Company card", "Geoprobe rental — Round Rock", 1850, "Direct-push rig, 2 days", "Approved");

// ---- stock ledger that explains onHand ------------------------------------------------------------
{
  const byItem = new Map(out.inventoryItems.map((i) => [i.id, []]));
  for (const r of out.jobResources.filter((r) => r.type === "Material" && r.inventoryItemId)) byItem.get(r.inventoryItemId)?.push({ delta: -r.quantity, at: r.consumedAt, reason: "field-usage", refType: "jobResource", refId: r.id, dispatchJobId: r.jobId, by: r.consumedBy, note: "" });
  for (const po of out.purchaseOrders.filter((p) => p.status === "Received")) byItem.get(po.itemId)?.push({ delta: po.receivedQuantity, at: po.receivedAt, reason: "receipt", refType: "purchaseOrder", refId: po.id, dispatchJobId: "", by: po.receivedBy, note: `PO from ${po.vendor}` });
  let seq = 0;
  for (const item of out.inventoryItems) {
    const events = (byItem.get(item.id) || []).sort((a, b) => a.at.localeCompare(b.at));
    const net = events.reduce((s, e) => s + e.delta, 0);
    const opening = item.onHand - net;
    let balance = opening;
    const openingAt = events.length ? new Date(new Date(events[0].at).getTime() - 86400000).toISOString() : "2025-06-30T15:00:00.000Z";
    seq += 1;
    push("inventoryMovements", { id: `inventory-movement-${String(seq).padStart(3, "0")}`, inventoryItemId: item.id, quantityDelta: opening, balanceAfter: balance, reason: "adjustment", refType: "count", refId: "", dispatchJobId: "", projectId: "", occurredAt: openingAt, by: NAME.tristan, note: "Opening count" }, openingAt);
    for (const e of events) {
      balance += e.delta;
      seq += 1;
      const job = e.dispatchJobId ? out.dispatchJobs.find((j) => j.id === e.dispatchJobId) : null;
      push("inventoryMovements", { id: `inventory-movement-${String(seq).padStart(3, "0")}`, inventoryItemId: item.id, quantityDelta: e.delta, balanceAfter: balance, reason: e.reason, refType: e.refType, refId: e.refId, dispatchJobId: e.dispatchJobId, projectId: job?.projectId || "", occurredAt: e.at, by: e.by, note: e.note }, e.at);
    }
  }
}

// ---- paperwork documents from the two PDFs we have ------------------------------------------------
let docSeq = 0;
function paperwork(entityType, entityId, accountId, typeCode, file, { visibility = "customer", uploadedBy = NAME.charlotte, uploadedAt = NOW, caption = "", requirementId = "" } = {}) {
  docSeq += 1;
  const id = `document-paper-${String(docSeq).padStart(3, "0")}`;
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  const storageName = `${id}${extension}`;
  fileManifest.push({ src: join(UPLOADED, file), dest: storageName });
  const type = out.documentTypes.find((t) => t.code === typeCode);
  return push("documents", { id, entityType, entityId, accountId, documentTypeId: type?.id || "", requirementId, fileName: file, mimeType: extension === ".pdf" ? "application/pdf" : "application/octet-stream", sizeBytes: 0, sha256: "", storageName, groupId: id, versionNumber: 1, visibility, caption, tags: [], uploadedAt, uploadedBy, uploadedBySessionKind: "user", retainUntil: "" }, uploadedAt);
}
// Customer packet on file for every active customer; the requirement rows point at the document.
const packetAccounts = [["city-georgetown", "2025-06-30T15:00:00.000Z"], ["lonestar-freight", "2025-07-02T21:00:00.000Z"], ["brazos-commercial", "2025-08-01T15:30:00.000Z"], ["permian-midstream", "2026-09-10T15:00:00.000Z"], ["hill-country-hospitality", "2026-08-28T15:30:00.000Z"], ["domain-parking", "2026-04-20T15:30:00.000Z"], ["lakeway-medical", "2026-03-03T15:00:00.000Z"], ["wolf-ranch-hoa", "2026-09-15T15:30:00.000Z"], ["bluebonnet-dairy", "2026-09-18T15:30:00.000Z"], ["riverside-chemical", "2026-09-16T15:00:00.000Z"]];
for (const [key, when] of packetAccounts) {
  const existing = out.documentRequirements.find((r) => r.accountId === ACCT[key] && r.documentTypeId === "doctype-customer-packet");
  const requirement = existing || push("documentRequirements", { id: `requirement-${key}-packet`, documentTypeId: "doctype-customer-packet", entityType: "account", entityId: ACCT[key], accountId: ACCT[key], status: "Approved", source: "account", counterparty: "customer", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: dayOffset(when.slice(0, 10), -5) + "T15:00:00.000Z", reviewedAt: when, reviewedBy: NAME.charlotte }, when);
  const doc = paperwork("account", ACCT[key], ACCT[key], "customer-packet", "New Customer Packet trey.pdf", { uploadedAt: when, caption: "Signed new customer packet", requirementId: requirement.id });
  requirement.documentIds = [doc.id];
  requirement.currentDocumentId = doc.id;
  if (requirement.status === "Sent") requirement.status = "Approved";
}
// Vendor form on file for the four vendors.
for (const [key, when] of [["balfour", "2026-09-16T19:00:00.000Z"], ["republic-services", "2026-09-16T18:10:00.000Z"], ["eurofins", "2026-09-16T18:15:00.000Z"], ["venditti", "2026-09-16T18:20:00.000Z"]]) {
  const requirement = push("documentRequirements", { id: `requirement-${key}-vendor-form`, documentTypeId: "doctype-vendor-form", entityType: "account", entityId: ACCT[key], accountId: ACCT[key], status: "Approved", source: "vendor", counterparty: "vendor", documentIds: [], currentDocumentId: "", createdBy: NAME.charlotte, sentAt: when, reviewedAt: dayOffset(when.slice(0, 10), 2) + "T15:00:00.000Z", reviewedBy: NAME.braden }, when);
  const doc = paperwork("account", ACCT[key], ACCT[key], "vendor-form", "New Vendor Form.pdf", { visibility: "internal", uploadedAt: when, caption: "Completed new vendor form", requirementId: requirement.id });
  requirement.documentIds = [doc.id];
  requirement.currentDocumentId = doc.id;
}
// Job request documents: the packet as the customer's onboarding paperwork on the two biggest requests.
for (const [requestId, accountKey, when] of [["req-permian-release", "permian-midstream", "2026-09-12T16:30:00.000Z"], ["req-bluebonnet-lagoon", "bluebonnet-dairy", at("2026-09-23", "11:25")]]) {
  const id = `job-request-document-${requestId.replace("req-", "")}`;
  fileManifest.push({ src: join(UPLOADED, "New Customer Packet trey.pdf"), dest: `${id}.pdf` });
  push("jobRequestDocuments", { id, jobRequestId: requestId, accountId: ACCT[accountKey], documentRole: "customer_packet", fileName: "New Customer Packet trey.pdf", storageName: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 0, uploadedAt: when, uploadedBy: NAME.charlotte }, when);
}

// ---- IT messages: one thread ------------------------------------------------------------------------
push("itMessages", { id: "it-message-tristan-1", threadKey: USER.tristan, threadName: NAME.tristan, authorUserId: USER.tristan, authorName: NAME.tristan, authorRole: "Field Lead", fromIT: false, body: "The consumables table won't sort by on-hand on my phone — tapping the header does nothing.", screenshotDocumentId: "", pageUrl: "/#view=inventory-consumables", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1", userReadAt: at("2026-09-24", "12:50"), itReadAt: at("2026-09-24", "13:05") }, at("2026-09-24", "12:50"));
push("itMessages", { id: "it-message-tristan-2", threadKey: USER.tristan, threadName: NAME.tristan, authorUserId: USER.braden, authorName: NAME.braden, authorRole: "Admin", fromIT: true, body: "Thanks — reproduced on a 390px screen. On the list for the Front Line 2 pass; use the desktop sort for now.", screenshotDocumentId: "", pageUrl: "", userAgent: "", userReadAt: "", itReadAt: at("2026-09-24", "13:20") }, at("2026-09-24", "13:20"));

// ---- more GPS points ---------------------------------------------------------------------------------
const point = (id, projectKey, label, lat, lng, type, when, extra = {}) => push("locations", { id, projectId: PROJ[projectKey], scheduleEventId: "", label, latitude: lat, longitude: lng, assetTags: [], status: "Active", lastPingAt: when, source: "Front Line check-in", locationType: type, linearReference: "", isTemporary: true, retainUntil: dayOffset(when.slice(0, 10), 730), retentionReason: "Project record retention", reportedByEmployeeId: EMP.logan, consentId: "", ...extra }, when);
point("loc-gps-georgetown-washbay", "georgetown-hydraulic", "Wash bay — refuse truck 118", 30.6414, -97.6931, "Spill origin", at("2026-09-24", "15:30"), { source: "Emergency intake", reportedByEmployeeId: "" });
point("loc-gps-georgetown-separator", "georgetown-hydraulic", "Oil-water separator manway", 30.6415, -97.6934, "Access point", at("2026-09-24", "15:31"), { source: "Emergency intake", reportedByEmployeeId: "" });
point("loc-gps-georgetown-storm-inlet", "georgetown-storm-drain", "Storm inlet — Austin Ave & W 8th", 30.6336, -97.6773, "Spill origin", at("2026-08-18", "10:45"), { status: "Archived" });
point("loc-gps-georgetown-storm-outfall", "georgetown-storm-drain", "Outfall — San Gabriel bank (FD boom)", 30.6352, -97.6768, "Containment point", at("2026-08-18", "11:10"), { status: "Archived" });
point("loc-gps-wolf-outfall", "wolf-pond", "Outfall weir — DO reading point", 30.6291, -97.7112, "Sample point", at("2026-09-21", "00:30"));
point("loc-gps-wolf-staging", "wolf-pond", "Spray trailer staging — pond trail", 30.6297, -97.7121, "Staging", at("2026-09-20", "21:10"), { assetTags: ["MST-202"] });
point("loc-gps-permian-truck", "permian-release", "TRK-101 — last ping", 30.5742, -97.4099, "Vehicle", at(TODAY, "08:55"), { assetTags: ["TRK-101"], source: "Front Line location", isTemporary: true });
point("loc-gps-permian-windrows", "permian-release", "Treatment windrows 1–3", 30.5736, -97.4085, "Treatment area", at("2026-09-22", "10:00"));
point("loc-gps-hch-b2", "hch-borings", "B-2 — UST pad, center (PID 48 ppm)", 30.4425, -97.6117, "Sample point", at("2026-09-10", "11:20"), { reportedByEmployeeId: EMP.tristan });
point("loc-gps-hch-b4", "hch-borings", "B-4 — grease line, 20 ft east of cleanout", 30.4422, -97.611, "Sample point", at("2026-09-11", "09:30"), { reportedByEmployeeId: EMP.tristan });
point("loc-gps-domain-entrance", "domain-garage", "Garage B entrance — night access", 30.4018, -97.7235, "Access point", "2026-04-30T22:05:00-05:00", { status: "Archived", reportedByEmployeeId: EMP.tristan });
point("loc-gps-lakeway-hatch", "lakeway-crawlspace", "Crawlspace hatch — janitor closet", 30.3532, -97.9876, "Access point", "2026-03-03T07:40:00-06:00", { status: "Archived" });
point("loc-gps-capital-drain", "capital-grocers-acid", "Floor drain — Dock 4 (to sanitary)", 30.3408, -97.6701, "Containment point", at(TODAY, "07:49"), { source: "Emergency intake", reportedByEmployeeId: "" });

// Phase 25 A.3b (2026-09-29): parse the AAMVA text a driver's licence's PDF417 barcode holds.
//
// Pure (no imports, no DOM) so scripts/aamva-parse-check.mjs can test it under Node. The roll call's
// "Scan ID" (field/safety.js) keeps only what it needs from the result -- the licence number goes to
// the server once, for matching, and is never stored on the phone; DOB and address are never read.
//
// The barcode: a header ("@", LF, RS, CR, "ANSI " + 6-digit issuer IIN + AAMVA version + [jurisdiction
// version] + entry count + one 10-char designator per subfile), then subfile "DL" (or "ID"), whose
// elements are a 3-letter code + value, one per line. Dates are MMDDCCYY on US cards and CCYYMMDD on
// Canadian ones (and on some early US v1 cards) -- the country decides, the value is checked either way.

// Issuer IIN -> jurisdiction, for the rare card with no DAJ element. Canadian ones marked by the
// province list below.
const IIN_JURISDICTIONS = {
  "636000": "VA", "636001": "NY", "636002": "MA", "636003": "MD", "636004": "NC", "636005": "SC", "636006": "CT",
  "636007": "LA", "636008": "MT", "636009": "NM", "636010": "FL", "636011": "DE", "636012": "ON", "636013": "NS",
  "636014": "CA", "636015": "TX", "636016": "NL", "636017": "NB", "636018": "IA", "636019": "GU", "636020": "CO",
  "636021": "AR", "636022": "KS", "636023": "OH", "636024": "VT", "636025": "PA", "636026": "AZ", "636028": "BC",
  "636029": "OR", "636030": "MO", "636031": "WI", "636032": "MI", "636033": "AL", "636034": "ND", "636035": "IL",
  "636036": "NJ", "636037": "IN", "636038": "MN", "636039": "NH", "636040": "UT", "636041": "ME", "636042": "SD",
  "636043": "DC", "636044": "SK", "636045": "WA", "636046": "KY", "636047": "HI", "636048": "MB", "636049": "NV",
  "636050": "ID", "636051": "MS", "636052": "RI", "636053": "TN", "636054": "NE", "636055": "GA", "636058": "OK",
  "636059": "AK", "636060": "WY", "636061": "WV", "636062": "VI",
  "604426": "PE", "604427": "AS", "604428": "QC", "604429": "YT", "604430": "MP", "604431": "PR", "604432": "AB",
  "604433": "NU", "604434": "NT",
};
const CANADIAN_JURISDICTIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NF", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

const pad2 = (value) => String(value).padStart(2, "0");

function validDate(year, month, day) {
  if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// "MMDDCCYY" or "CCYYMMDD" -> "YYYY-MM-DD" ("" if neither reading is a real date). `canadian` picks
// which reading to try first.
export function parseAamvaDate(value, canadian = false) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const us = () => validDate(Number(digits.slice(4, 8)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
  const iso = () => validDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  return canadian ? iso() || us() : us() || iso();
}

// "SMITH" -> "Smith", "O'BRIEN" -> "O'Brien", "MARY-JANE" -> "Mary-Jane".
export function titleCaseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z])/g, (_, lead, letter) => `${lead}${letter.toUpperCase()}`)
    .replace(/\s+/g, " ");
}

// Keeps what matching needs: letters and digits, upper case ("A 123-456" and "a123456" are one licence).
export function normalizeLicenceNumber(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function readHeader(text) {
  const at = text.search(/ANSI ?\d{6}|AAMVA\d{6}/);
  if (at < 0) return { iin: "", version: 0, bodyStart: 0 };
  const marker = text.startsWith("ANSI ", at) ? 5 : text.startsWith("ANSI", at) ? 4 : 5;
  const iin = text.slice(at + marker, at + marker + 6);
  const version = Number(text.slice(at + marker + 6, at + marker + 8)) || 0;
  // v1 has no jurisdiction version field.
  const countAt = at + marker + 8 + (version >= 2 ? 2 : 0);
  const entries = Number(text.slice(countAt, countAt + 2)) || 1;
  return { iin, version, bodyStart: countAt + 2 + entries * 10 };
}

// Returns { licenceNumber, familyName, givenName, displayName, expiry (YYYY-MM-DD or ""), state,
// country ("USA"|"CAN"|""), iin, version, isLicence } -- or null if the text isn't an AAMVA card.
export function parseAamva(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!/ANSI ?\d{6}|AAMVA\d{6}/.test(text) && !/(^|[\n\r])(DL|ID)?DAQ/.test(text)) return null;
  const header = readHeader(text);
  const elements = {};
  const take = (code, value) => {
    if (!(code in elements)) elements[code] = String(value || "").trim();
  };
  // Everything after the header's subfile designators, split into element lines.
  const body = text.slice(header.bodyStart);
  const lines = body.split(/[\n\r\x1e\x1d]+/);
  lines.forEach((line, index) => {
    let clean = line.replace(/^[\x00-\x1f@]+/, "");
    // The first line of a subfile carries its type ("DL"/"ID"; "Z?" for jurisdiction-specific ones).
    if (index === 0 || /^(DL|ID)D[A-Z]{2}/.test(clean)) clean = clean.replace(/^(DL|ID)(?=D[A-Z]{2})/, "");
    const match = clean.match(/^(D[A-Z]{2})(.*)$/);
    if (match) take(match[1], match[2]);
  });
  // A header whose designators don't line up with the data (seen on real cards): find the subfile
  // start directly.
  if (!elements.DAQ) {
    const fallback = text.match(/(?:DL|ID)(DAQ[^\n\r]*)/);
    if (fallback) take("DAQ", fallback[1].slice(3));
    for (const line of text.split(/[\n\r\x1e\x1d]+/)) {
      const match = line.replace(/^(DL|ID)(?=D[A-Z]{2})/, "").match(/^(D[A-Z]{2})(.*)$/);
      if (match) take(match[1], match[2]);
    }
  }
  const licenceNumber = (elements.DAQ || "").trim();
  if (!licenceNumber) return null;

  // Names: DCS/DAC (v2+), DCT "GIVEN,MIDDLE" (v2 some states), DAB/DAC (v1), or DAA "LAST,FIRST,MIDDLE".
  let familyName = elements.DCS || elements.DAB || "";
  let givenName = elements.DAC || "";
  if (!givenName && elements.DCT) givenName = elements.DCT.split(/[, ]/).filter(Boolean)[0] || "";
  if ((!familyName || !givenName) && elements.DAA) {
    const parts = elements.DAA.includes(",") ? elements.DAA.split(",") : elements.DAA.split(/\s+/).reverse();
    if (!familyName) familyName = (parts[0] || "").trim();
    if (!givenName) givenName = (parts[1] || "").trim();
  }
  familyName = titleCaseName(familyName);
  givenName = titleCaseName(givenName.split(/[, ]/).filter(Boolean)[0] || givenName);

  let state = String(elements.DAJ || "").trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{2,3}$/.test(state)) state = IIN_JURISDICTIONS[header.iin] || "";
  const countryCode = String(elements.DCG || "").trim().toUpperCase();
  const country = countryCode === "CAN" || CANADIAN_JURISDICTIONS.has(state) ? "CAN" : countryCode === "USA" || state ? "USA" : "";
  const expiry = parseAamvaDate(elements.DBA, country === "CAN");

  return {
    licenceNumber,
    familyName,
    givenName,
    displayName: [givenName, familyName].filter(Boolean).join(" "),
    expiry,
    state,
    country,
    iin: header.iin,
    version: header.version,
    isLicence: !/^ID/.test(body.replace(/^[\x00-\x1f]+/, "")),
  };
}

// Is the licence past its expiry on `today` (YYYY-MM-DD)? No expiry read -> not flagged.
export function licenceExpired(expiry, today) {
  return Boolean(expiry) && Boolean(today) && expiry < today;
}

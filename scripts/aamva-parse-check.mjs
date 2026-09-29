// Phase 25 A.3b (2026-09-29): unit check for field/aamva.js, the driver's-licence barcode parser the
// roll call's "Scan ID" uses. No server, no browser -- scripts/smoke.mjs runs it first.
//
//   node scripts/aamva-parse-check.mjs
//
// The samples are made-up cards in the shapes real ones use: a current US card (MMDDCCYY dates, DAJ),
// a Canadian card (CCYYMMDD dates, no DCG), and an old v1 card (DAA "LAST,FIRST,MIDDLE", no DAC/DCS).
import { parseAamva, parseAamvaDate, normalizeLicenceNumber, licenceExpired, titleCaseName } from "../field/aamva.js";

const LF = "\n";
const RS = "\x1e";
const CR = "\r";

const SAMPLES = {
  texas: `@${LF}${RS}${CR}ANSI 636015090002DL00410271ZT03120008DLDAQ12345678${LF}DCSSAMPLE${LF}DDEN${LF}DACJOHN${LF}DDFN${LF}DADQUINCY${LF}DDGN${LF}DCAC${LF}DCBNONE${LF}DCDNONE${LF}DBD01012020${LF}DBB07041985${LF}DBA07042027${LF}DBC1${LF}DAU070 IN${LF}DAYBRO${LF}DAG123 MAIN ST${LF}DAIAUSTIN${LF}DAJTX${LF}DAK787010000  ${LF}DCF1234567890123456789${LF}DCGUSA${LF}DCK12345678901234567890${LF}DDAF${LF}DDB12012019${CR}ZTZTAN${CR}`,
  ontario: `@${LF}${RS}${CR}ANSI 636012080002DL00410186ZO02270024DLDAQS1234-56789-01234${LF}DCSO'BRIEN${LF}DACMARY-JANE${LF}DADELIZABETH${LF}DBD20230315${LF}DBB19900315${LF}DBA20280315${LF}DBC2${LF}DAG1 KING ST W${LF}DAITORONTO${LF}DAJON${LF}DAKM5H 1A1${CR}ZOZOAN${CR}`,
  californiaV1: `@${LF}${RS}${CR}ANSI 6360140101DL00290180DLDAQD1234567${LF}DAASMITH,ROBERT,LEE${LF}DBA12312020${LF}DBB01151970${LF}DAG9 ELM ST${LF}DAJCA${CR}`,
};

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` -- got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const texas = parseAamva(SAMPLES.texas);
check("US card: licence number", texas?.licenceNumber, "12345678");
check("US card: name", [texas?.givenName, texas?.familyName, texas?.displayName], ["John", "Sample", "John Sample"]);
check("US card: MMDDCCYY expiry", texas?.expiry, "2027-07-04");
check("US card: state/country/IIN", [texas?.state, texas?.country, texas?.iin, texas?.version], ["TX", "USA", "636015", 9]);
check("US card: no DOB or address in the result", Object.keys(texas || {}).some((key) => /dob|birth|address|street|city|postal/i.test(key)), false);

const ontario = parseAamva(SAMPLES.ontario);
check("Canadian card: licence number", ontario?.licenceNumber, "S1234-56789-01234");
check("Canadian card: name (apostrophe, hyphen)", ontario?.displayName, "Mary-Jane O'Brien");
check("Canadian card: CCYYMMDD expiry", ontario?.expiry, "2028-03-15");
check("Canadian card: province and country", [ontario?.state, ontario?.country], ["ON", "CAN"]);

const california = parseAamva(SAMPLES.californiaV1);
check("v1 card: licence number", california?.licenceNumber, "D1234567");
check("v1 card: DAA name", california?.displayName, "Robert Smith");
check("v1 card: expiry", california?.expiry, "2020-12-31");
check("v1 card: expired on 2026-09-29", licenceExpired(california?.expiry, "2026-09-29"), true);
check("US card: not expired on 2026-09-29", licenceExpired(texas?.expiry, "2026-09-29"), false);

// No DAJ: the jurisdiction comes from the header's issuer number.
const noDaj = parseAamva(SAMPLES.texas.replace(`${LF}DAJTX`, ""));
check("jurisdiction from the IIN when DAJ is missing", noDaj?.state, "TX");
// Header offsets that don't line up with the data (seen on real cards) still find the elements.
const badOffsets = parseAamva(SAMPLES.texas.replace("ANSI 636015090002", "ANSI 636015090003"));
check("misaligned header still parses", [badOffsets?.licenceNumber, badOffsets?.familyName], ["12345678", "Sample"]);

check("date: US reading", parseAamvaDate("02292028"), "2028-02-29");
check("date: Canadian reading", parseAamvaDate("20280229", true), "2028-02-29");
check("date: CCYYMMDD on a US card falls back", parseAamvaDate("20270704"), "2027-07-04");
check("date: nonsense", parseAamvaDate("99999999"), "");
check("licence number normalised for matching", normalizeLicenceNumber(" s1234-56789 01234 "), "S12345678901234");
check("title case", titleCaseName("MCDONALD-SMITH"), "Mcdonald-Smith");
check("not a licence", parseAamva("https://example.com/qr"), null);

console.log(failed ? `FAILED: ${failed} check(s).` : "PASSED: AAMVA parser.");
process.exit(failed ? 1 : 0);

# Phase 21 addendum — Site walk mapping: the salesperson's walk, and an annotated site map

**Status:** 🟢 Built 2026-09-25 as part of the one-pass Front Line 2 build (`field/walk.js`, `field/map.js`, `field/map-core.js`, `field/layers.js`, `field/walk-share.html`). Observations are their own collection (`siteWalkObservations`); offline area packs, city GIS layers (live ArcGIS or GeoJSON snapshot) and the four desktop-readiness rules from the 2026-09-25 discussion are in; Phase 22 (`phase-22-site-workspace.md`) holds the desktop editor.
**Source:** owner request 2026-09-25 — "write out the whole roadmap … how a sales person would use the site-walk app … an annotated site map connected to photos and observations … investigate before implementing."
**Companion sections in the main plan:** Media capture (photos, annotation, video, LiDAR), Sales field mode, Data model additions.

---

## 1. Short answers first

**LiDAR.** Correct: a web app cannot drive the iPhone/iPad LiDAR sensor. Safari has no depth or AR API; Apple exposes LiDAR only to native apps through ARKit, RoomPlan and Object Capture. Android Chrome has a WebXR depth API on ARCore phones, but it is coarse (camera-based depth, not LiDAR-class) and useless for measuring an excavation. The three tiers in the main plan stand: (1) scan in Polycam / Scaniverse / 3D Scanner App and share the file into a walk or job as a `site-scan` document, which the existing three.js viewer renders; (2) measure without LiDAR (GPS-walked perimeter, photo with a scale reference, the measurements form); (3) a thin native shell (Capacitor + RoomPlan plugin) only if in-app scanning is ever wanted. Nothing in this addendum depends on LiDAR.

**Mapping.** A lightweight map component is enough and most of it already exists. Leaflet 1.9.4 is vendored, the shell service worker caches it, Esri World Imagery is already the basemap on facility maps, and GPS capture already works on the phone. The recommendation is a **map tab on the site walk** with numbered observation pins, seven icon kinds, line/arrow/area drawing, photos and notes attached to each pin, an uploaded floor plan as an alternative background for indoor walks, and a read-only share link. No GIS platform, no paid imagery, no new vendor library beyond an optional drawing helper.

**What the map cannot honestly show.** Satellite imagery is months to years old and shows roofs, not interiors. GPS on a phone is 3–10 m outdoors and unusable indoors. Parcel lines from the county appraisal district are close but not survey-grade. Underground utilities are not public data anywhere in Texas; the only sources are the customer's own drawings and a Texas 811 locate on the day. The app must label every reference layer with its source and date, and draw field observations in a different style so nobody mistakes a sketch for a survey.

---

## 2. The salesperson's day with the app (the whole flow, end to end)

This is the sales side of the Phase 21 app as designed, with the mapping work added in the places it belongs. Steps marked **[new]** are what this addendum adds; everything else is in the main plan.

### Before the walk (office or truck)
1. A walk is booked from the opportunity (Develop & Planning → Schedule site walk). That already writes a `scheduleEvents{kind:"site_walk"}` row, a Site Visit meeting and the `opportunityAssignments` row, and sets `siteWalkStatus` on the opportunity.
2. The phone pulls the **walk package** when the salesperson signs in: opportunity, account, facility address and contacts, needs lists so far, prior documents and site photos, prior projects at the same facility, the ERG tables. **[new]** The package also caches the satellite tiles for the property at zoom 16–19 (roughly 150–400 tiles, 3–8 MB), any reference layers attached to the facility (parcel outline, customer drawings) and the last walk's map, so the map opens with no signal.
3. On My Day the walk shows as a card: customer, address, time, contact. Tap → Navigate opens the phone's maps app; Call dials the contact.

### Arriving — Brief tab
4. **Brief** shows what the office already knows: the customer's stated need, the current situation from the intake, the needs lists, documents, prior photos, prior jobs here. Nothing is re-typed.
5. **Check in**: one tap stamps GPS + time as a `locations` row linked through `opportunityLocations`, and starts the walk clock.

### Walking — Walk tab (guided checklist) and Map tab **[new]**
6. The **Walk** tab is the guided checklist from the main plan: Access & staging, Hazards & PPE, Area of concern, Waste streams expected, Needs, Contacts met, Notes. Every section has a photo tray and the required-shot slots (entrance, staging, area of concern wide and close, drains/waterways, hazards, before).
7. The **Map** tab opens the satellite view centred on the facility, with the parcel outline (if loaded) and the check-in point. The salesperson walks the property and, as they go:
   - Taps **+ Observation**: a crosshair sits at the map centre; they pan until it is over the spot and tap **Place here** (or tap **Use my GPS**). The pin gets the next number (1, 2, 3 …), a kind (Observation, Drain / discharge, Access point, Hazard, Tank / equipment, Staging, Sample point, Custom), an optional label, a note, and a photo tray. The note field is a plain text box; the phone keyboard's microphone does dictation on iOS and Android without any speech code in the app.
   - Taps **Draw** to add a line (fence, pipe run, flow path), an arrow (drainage direction, "crew enters here") or a shaded area (spill extent, staging zone, exclusion zone). Vertices are placed by tapping; Undo removes the last one; Done closes the shape. The area shows its size in square feet as it is drawn.
   - Drags a pin's handle to move it; long-press to delete, with undo.
   - Every pin and shape also appears as an entry in the checklist's photo trays, so the two tabs are one data set seen two ways: the checklist groups by topic, the map groups by place.
8. Indoors (a warehouse, a plant floor) they tap **Switch background → Upload plan** and photograph the fire-evacuation plan on the wall, the customer's drawing or a whiteboard sketch. The plan becomes the map; pins are placed by tap only (no GPS) and stay anchored to the image. A walk can hold several backgrounds (Site, Building A, Building B) and the pin numbering runs across all of them.
9. **Share** at any point: tap Share → the app makes (or reuses) a read-only link for this walk and hands it to the phone's share sheet (Teams, text, email). A colleague in the office opens it on any phone or laptop, sees the map, the numbered pins and the photos, and can tap a pin to see its photos and note. Signed-in colleagues also see the walk live under the opportunity. The page shows "Live — last update 2:14 pm" so the recipient knows it keeps changing while the walk continues.
10. The outbox pill in the header shows "Synced", "4 queued" or "Offline". Pins and photos taken with no signal are stored locally and upload when the phone reconnects; the share link fills in as they land.

### Wrapping up — Finish tab
11. **Finish** shows the summary: sections completed, pin count, photos, measurements, needs written. **Complete** posts the walk (`siteWalkReports` row, `siteWalkStatus: "Complete"`, Site Visit activity logged, photos filed as `documents{type:"site-photo"}` on the opportunity).
12. Back at the desk the map, pins and photos are on the opportunity's Develop & Planning tab ("Site walk report" panel), feed the Proposed Solution generator, and carry forward to the project when the deal closes, where the job's Brief tab shows the same map to the crew. **Export as PDF** prints the map with numbered pins, then one block per pin with its photos and note — the "annotated site map" as a document, for a customer or a regulator.

That is the whole loop: booked in the CRM → walked with the phone → shared during the walk → filed on the opportunity → printed when needed → shown to the crew on the job.

---

## 3. What exists today (verified 2026-09-25)

| Piece | State | Where |
|---|---|---|
| Leaflet 1.9.4 | Vendored, cached by the service worker | `public/vendor/leaflet/`, `service-worker.js:12-13` |
| Satellite basemap | Esri World Imagery tiles on facility maps and the Front Line map; OpenStreetMap on ops/sample maps | `app.js:6816`, `:16425`, `:9476` |
| GPS capture | `getCurrentPosition`, high accuracy, 10 s timeout; "here now" ping on Front Line | `app.js:16455`, `:16666` |
| GPS points | `locations` collection (server validates lat/lng), joined to opportunities by `opportunityLocations` | `server.mjs:5006`, `app.js:30772` |
| Site walk | `scheduleEvents{kind:"site_walk"}` + Site Visit meeting; Front Line card is a static `div`; nothing in the field completes a walk | `app.js:21672-21800` |
| Photos | `documents` store (Phase 13): versions, visibility internal/customer, captions, 25 MB cap; files in `data/uploads` | `server.mjs:4602`, `:3134` |
| Photo annotation | Canvas pen/box/arrow in the IT-messages dialog; to be lifted into `openImageMarkup` (main plan) | `app.js:20833-21100` |
| 3D scans | `spatialData` + three.js GLB viewer on projects | `app.js:8423`, `:9645` |
| Share links | `/go/<token>` single-use sign-on link → job-scoped `dispatch-link` session; nothing read-only, nothing for walks | `server.mjs:4374-4402` |
| Print / PDF | Print-page pattern with `window.print()` (invoice) | `app.js:24412-24452` |
| Drawing tools on a map | None. No Leaflet.draw / Geoman. | — |
| Floor-plan background | None. | — |
| Reference layers (parcels, utilities) | None. | — |

---

## 4. Recommended first version (essential)

### 4.1 Field experience
- **Map tab on the walk page** (alongside Brief / Walk / Finish). Full-screen Leaflet, satellite basemap, a small "Aerial / Plan: <name>" switcher at the top, the sync pill, and a bottom bar with three big buttons: **+ Observation**, **Draw**, **Share**.
- **Placement by crosshair, not drag.** Pan the map under a fixed centre crosshair and tap Place. This separates map navigation from placement (the single biggest touch-map usability problem), works one-handed, and is precise on a dirty screen. "Use my GPS" is the alternative outdoors; it records the fix's accuracy radius and draws it as a faint circle.
- **Eight pin kinds** with a colour and an icon: Observation (numbered, default), Drain / discharge, Access point, Hazard, Tank / equipment, Staging, Sample point, Custom (free label). Every pin is numbered in walk order regardless of kind, because "see pin 7" is how people talk on the phone.
- **Three shape tools**: line, arrow, area. Tap vertices, Undo, Done. Area shows square feet live (Leaflet's `L.GeometryUtil`-style spherical area is 20 lines of code; no plugin needed). Shapes get a label and a colour (red/orange/yellow/blue), and can have a note and photos like a pin.
- **Pin sheet**: tapping a pin slides up a sheet with kind, label, note, photo tray (camera + gallery, uses the existing "Take photo" input), Move, Delete. Photos taken from the sheet are tagged with the pin, GPS, heading and time and go to the `documents` store through the outbox.
- **Indoor: uploaded plan background.** "Upload plan" takes a photo or image file and shows it as a Leaflet `ImageOverlay` on `L.CRS.Simple`; pins on a plan store image-pixel coordinates, not lat/lng. Optional: two-point georeference later (tap two known corners on the plan, then on the aerial) — **not** in v1.
- **Undo everywhere**: a single in-memory undo stack for place/move/delete/draw, cleared on Complete.
- **Offline**: tiles for the property (zoom 16–19, bounding box = parcel or 300 m around the facility point) cached into `fieldPackages` when the walk package is fetched; pins, shapes and photos go through `fieldOutbox` like every other field write.

### 4.2 Recipient experience
- **Signed-in colleagues**: the walk appears live on the opportunity (Develop & Planning → Site walk report) and, for people with the field role, on their own phone under the walk. Same map component, read-only.
- **Share link** (`/walk/<token>`): a new server route that mints a **read-only, walk-scoped, expiring** token (default 14 days, revocable from the walk). Opening it renders a small standalone page (like the `/go/` pages: no app shell, no sign-in) with the map, pins, shapes and photo lightbox. The page polls every 30 s while open, so recipients see updates as the walk continues; the header says "Live · updated 2:14 pm" or "Walk completed 3:02 pm". Photos on the link are served through a token-checked variant of the document view route; the link never exposes anything else on the opportunity.
- **Access control**: only the walk's owner, sales managers and admins can mint or revoke a link; the audit log records who minted it and each open. Internal-only photos can be excluded from the link with the existing `visibility` flag. Links to walks on an opportunity marked confidential are refused.
- **PDF export**: a print page in the invoice pattern: the map at the walk's extent with numbered pins, a legend, then one block per pin/shape with photos, note, GPS and time, and the reference-layer sources. Because Leaflet draws tiles as `<img>`, the print page just renders the map and waits for tiles before calling `window.print()`; no html2canvas. Saved as a `documents{type:"site-map"}` record when generated so it is filed with the opportunity.

### 4.3 Data
Fold into `siteWalkReports` (already planned) rather than new top-level collections:

```
siteWalkReports.backgrounds[]  { id, kind: "aerial" | "plan", label, documentId, widthPx, heightPx, bounds? }
siteWalkReports.observations[] { id, seq, kind, label, note, backgroundId,
                                 lat, lng, accuracyM        // aerial
                                 x, y                       // plan (image pixels)
                                 geometry                   // GeoJSON for line/arrow/area; null for pins
                                 areaSqFt, lengthFt,
                                 photoDocumentIds[], createdAt, createdBy, updatedAt }
siteWalkReports.shares[]       { id, tokenHash, createdBy, createdAt, expiresAt, revokedAt, opens }
siteReferenceLayers            { id, facilityId, kind: "parcel" | "utility" | "drainage" | "customer-plan" | "other",
                                 label, source, sourceDate, geojson | documentId, notes, visibility }
documents.type += "site-map", "site-plan"
```
`siteReferenceLayers` is the one new collection: it hangs off the facility so every walk and every job at that site reuses it. Needs the three-place server wiring plus `fieldProjections` read access, and rows in `database-handoff-map.md` and `GLOSSARY.md`.

### 4.4 Effort
| Piece | Sessions |
|---|---|
| Map tab, crosshair placement, pins, pin sheet, photos through the outbox | 1.5 |
| Draw tools (line/arrow/area), undo stack, area/length | 1 |
| Plan backgrounds (`CRS.Simple`), background switcher | 0.5 |
| Tile pre-cache into `fieldPackages` | 0.5 |
| Read-only share route + page + audit + revocation | 1 |
| Opportunity/project panels, PDF export page | 1 |
| Reference layers: `siteReferenceLayers`, parcel import, customer-drawing overlay | 1 |
| **Total** | **~6.5 sessions**, on top of pass 21d |

It sits on pass 21d's walk page and the pass 21a outbox, so it cannot ship before those.

---

## 5. Mapping options, imagery and permissions

### Basemaps (what the pins sit on)
| Source | Resolution / age | Cost | Terms | Verdict |
|---|---|---|---|---|
| **Esri World Imagery** (in use) | 0.3–1 m in Texas metro areas, typically 1–3 years old | Free tier via ArcGIS Location Platform (2 M basemap tiles/month) | Attribution required; the legacy `server.arcgisonline.com` endpoint the app uses today works without a key but Esri's current terms want an API key. Offline caching for a device's own use is permitted within the tier. | **Keep.** Get a free Location Platform key before the pilot; tile use for a handful of walks a week is far inside the free tier. |
| **Esri World Imagery Wayback** | Same imagery, every published version back to 2014 | Free | Same as above | **Use for "history".** A WMTS endpoint per release date; the app can offer a date slider of the versions that changed at that location. This is the practical historical-imagery source. |
| **USDA NAIP** (via TxGIO / USGS) | 0.6–1 m aerial, Texas flown every 2 years (2004 →) | Free, public domain | None | **Use for history** older than Wayback or when leaf-off matters. Served as WMS/WMTS from TxGIO (Texas Geographic Information Office, formerly TNRIS). TxGIO also has historical black-and-white aerials back to the 1930s–70s for many counties — genuinely useful for "what used to be here" on an old industrial site. |
| **Google Earth / Google Maps** | Best resolution and the richest history | Paid (Map Tiles API), history not available through any API | Terms forbid displaying Google tiles under non-Google overlays in a third-party map framework, forbid caching, forbid combining with other providers' data in the same view | **No.** Historical imagery in Google Earth is view-only in their product. Staff can still open Google Earth on the phone for a look; the app can offer a "Open in Google Earth" link at the facility coordinates. |
| **Bing / Azure Maps** | Good | Bing Maps for Enterprise is being retired (free/basic keys ended June 2025; enterprise by 2028); Azure Maps imagery is paid per tile | Azure terms allow Leaflet | **No** for v1. Nothing it adds over Esri is worth a second paid account. |
| **Sentinel-2 / Landsat** | 10 m / 30 m, every 5 days | Free | Open | **Not for a site map.** A warehouse is one pixel. Useful only for a large land spill's before/after at regional scale. |
| **OpenStreetMap** (in use for ops maps) | Vector streets, no imagery | Free | Attribution; tile usage policy discourages heavy or app-wide use | Keep as the street layer; not a walk basemap. |

Recommendation: Esri World Imagery as the default, with a **"History" button** that lists Wayback releases and TxGIO NAIP years at that spot and swaps the tile layer. Each layer shows its capture date on the map corner so a recipient knows what they are looking at.

### Topography and drainage direction
- **USGS 3DEP** elevation is free and public domain (1 m in most of Texas). The National Map serves hillshade and contour tiles that Leaflet can overlay at partial opacity, which is enough for "which way does this flow". Slope arrows from 3DEP are a later addition. Esri's World Hillshade tiles are the zero-setup option and are in the same free tier.
- Drainage direction on a paved industrial site is decided by curb cuts and drains, not the county terrain, so the contour overlay is a hint and the salesperson's arrows are the record.

### Property boundaries
- Every Texas county appraisal district publishes parcel polygons; TxGIO stitches them into a free statewide parcel layer (`Stratmap Land Parcels`) updated yearly, with owner name and account number. Load once per facility into `siteReferenceLayers{kind:"parcel"}` with `source: "<County> CAD via TxGIO", sourceDate`. Accuracy is tax-map, not survey: expect 3–15 m error and label it "approximate parcel line".
- v1: the office loads parcel outlines by tapping "Fetch parcel" on the facility (one HTTP call to the TxGIO feature service by point). Bulk or automatic loading is a later addition.

### Underground utilities and infrastructure
Be plain about this in the UI:
- **There is no public map of underground utilities.** Texas 811 coordinates locates; it does not publish lines. Private lines inside a plant are not in anyone's system but the owner's. The only sources are the customer's drawings (as-builts, drainage plans, SPCC plans, fire plans) and a locate marked on the ground the day of the job.
- **Partly public, worth showing as reference:** RRC (Railroad Commission of Texas) public pipeline map and the federal National Pipeline Mapping System for transmission pipelines near the site; TWDB (Texas Water Development Board) water-well locations; some city GIS portals (Houston, Austin, San Antonio, Dallas, Fort Worth) publish storm-sewer and sanitary-sewer mains and outfalls as open data; TCEQ's central registry for permitted outfalls and regulated tanks at the site.
- **Product rule:** reference layers draw in **dashed grey with a source/date tag**; field observations draw in **solid colour with a number**. Uploaded customer drawings are a background, not a layer, and are labelled "Customer-provided, <date>, not verified".

### Drawing library
- **Hand-rolled** (recommended for v1): crosshair placement plus tap-vertex drawing is ~300 lines on plain Leaflet and gives exactly the touch behaviour wanted. Leaflet.draw is unmaintained and desktop-first; Leaflet-Geoman's free MIT build is good but brings its own toolbar and desktop drag semantics that then need overriding. Start hand-rolled; adopt Geoman only if editing shapes (moving a vertex) proves necessary.

---

## 6. Later additions (not v1)
- Georeferenced floor plans (two-point alignment of a plan to the aerial) so indoor pins have real coordinates.
- Elevation/slope arrows from 3DEP; flow-path suggestion from the drain pins.
- Bulk parcel import; city storm/sewer layers pulled by facility; RRC pipeline buffer warning.
- Reuse of the map on the **job**: crew see the walk map on Brief, add job-day pins (zones, decon, staging), and the close-out map prints in the post-work report and the TCEQ chronology (the "scaled map" TCEQ asks for).
- Imagery date slider with a side-by-side "then / now".
- Photo-to-pin auto placement from EXIF GPS for photos taken outside the app.
- Live recipient cursor / comments on a pin (a second person marking "look here too").
- Annotated-image export of a single background (PNG) in addition to the PDF.

---

## 7. Limitations that affect how to read the map (put these on the map, not just here)
- **Imagery age**: show the capture date in the corner; a tank that was removed last year is still on the picture.
- **GPS**: 3–10 m outdoors, worse near metal buildings and tank farms, none indoors. Pins show their accuracy circle; a pin placed by hand shows "placed manually".
- **Parcel lines**: tax-map accuracy, not a survey; never used for a boundary dispute.
- **Underground lines**: only what the customer supplied, labelled with its date; absence of a line means no data, not no pipe. A locate is still required before digging.
- **Shape areas**: computed from the drawn polygon; on a plan background the area is unknown unless the plan is georeferenced or a scale is entered.
- **Share link**: live while the walk is open; anyone with the link can view until it expires or is revoked; the audit log records opens.

---

## 8. Open decisions for the owner
1. Share-link default expiry (proposed 14 days) and whether customers may ever receive one, or only staff.
2. Whether the share page is live (proposed) or a frozen snapshot per share. Live is simpler and matches "share during the walk"; a snapshot can be had by exporting the PDF.
3. Which reference layers to load first: parcels only (proposed), or also city storm/sewer where available.
4. The eight pin kinds and four colours: edit before they are seeded.
5. Get an ArcGIS Location Platform (free) key for the imagery, or keep using the keyless legacy endpoint through the pilot.

---

## Corrections found during implementation

**Found live, 2026-09-25 evening (owner: "when I share the site walk map link the images don't load"):** two causes. (1) Every walk photo is uploaded as `visibility: "internal"` (the only other value, `customer`, means the client portal), and the share routes excluded internal photos, so a shared walk never had any. Share links now carry an **audience**: a *staff* link (the default, and what links minted before the field existed count as) shows every photo and plan on the walk; a *customer* link shows only photos marked "Shared with customer". The office Share links dialog offers both; the phone's Share button mints a staff link. (2) The share page only ever listed **pin** photos; the Walk tab's section trays and required shots, where most walk photos live, were not shared at all. The share routes now include them and the page has a "Walk photos" gallery grouped by section with the shot name as the caption. Uploaded floor plans were also refused by the photo route; they are allowed now. `scripts/field-api-check.mjs` check 7 asserts a staff link serves every referenced photo and a customer link only customer-visible ones.


**W3 build, 2026-09-25 (field/walk.js, map.js, map-core.js, layers.js, walk-share.*).**

1. **Observations are their own collection.** §4.3 folds `observations[]` into `siteWalkReports`; the
   approved build plan pinned `siteWalkObservations` (one record per pin/shape) and that is what was
   built: the map's `onChange` upserts one row per pin and soft-deletes on removal. `siteWalkReports`
   keeps `backgrounds[]`, `referenceSnapshot`, `measurements[]`, `shares[]` as §4.3 says.
2. **TxGIO parcels refuse `/query`.** The statewide layer
   (`feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer`)
   lists `Query` in its capabilities but answers "Requested operation is not supported"; only `/identify`
   by point works (Esri JSON, converted to GeoJSON in `layers.js`). "Fetch parcel" therefore identifies
   the parcel under the facility point rather than querying by envelope. The older
   `services.arcgis.com/…/Stratmap_Land_Parcels` guess does not exist.
3. **The map core imports nothing from app.js** (`field/map-core.js`) so the share page can use it with
   no app shell; `field/map.js` is the app-wired wrapper. `field/map.js` and `field/walk.js` expose
   `window.fieldMap` / `window.fieldWalk` so app.js's office panels reach them without importing them
   (keeps the import graph one-way and avoids the const-TDZ trap when a sibling module registers routes
   before `field/index.js` has evaluated). app.js imports `./field/walk.js` right after `./field/index.js`.
4. **Long press on a pin is hand-rolled.** Leaflet 1.9 no longer synthesises `contextmenu` from a touch
   long-press on most browsers, so the pin's icon gets its own pointer timer (650 ms, cancelled by 12 px
   of movement). Delete asks first and the toast offers Undo.
5. **PDF export is the print page, not a file.** No client-side PDF can be produced without a library, so
   Export PDF opens the print page (map at the walk's extent, legend, one block per observation, sections,
   measurements, reference sources) and calls `window.print()` once the tiles have loaded; the person saves
   it as PDF from the print dialog. A `site-map` document is **not** filed automatically (§4.2 said it
   would be) — a server-side render or a PDF library would be needed for that.
6. **Zip export works without a library.** `CompressionStream("deflate-raw")` plus a hand-rolled ZIP
   container (local headers, central directory, CRC-32) produces `observations.geojson`, `report.json`,
   `README.txt`, `photos/` and `plans/`; browsers without `CompressionStream` get a toast instead.
7. **Wayback release list** comes from `config.maptiles.arcgis.com/waybackconfig.json` (S3) and the tile
   template `wayback.maptiles.arcgis.com/…/tile/{releaseId}/{z}/{y}/{x}`; fetched lazily, cached in
   memory, and the History panel degrades to "needs a connection" offline. NAIP dates from TxGIO are
   **not** listed yet (§5 recommended them; the WMTS endpoint was not verified this session).
8. **`locations` drops `opportunityId` on the server** (its whitelist), so the check-in row is linked to
   the opportunity through `opportunityLocations` (`type:"Location"`, `role:"Site walk check-in"`) and
   carries `scheduleEventId` = the walk event, as the existing `frontlineRecordLocationPing` shape allows.
9. **`saveSiteWalk` regex fixed.** `/incomplete|not/i` overwrote "Not needed" with "Scheduled"; now only
   an empty or `Incomplete` status becomes `Scheduled`, and both `siteWalkStatus` selects list `Scheduled`.
10. **Offline tile store key** is `"<source>/<z>/<x>/<y>"` (task contract), not `"z/x/y@source"` as the
    build plan's IndexedDB note had it. The store is opened by map-core with the same database name and
    version W2 uses (`environmental-crm-field` v1, stores `fieldPackages fieldOutbox fieldTiles fieldAreas`).
11. **Move is both a drag handle and the crosshair.** "Move" on the pin sheet makes the pin draggable until
    Done and also offers "Use crosshair" (pan under the crosshair, tap Move here), because dragging a 40 px
    pin on a 390 px screen fights with panning.
12. **Not built this pass:** Video / Add scan buttons hand off to `window.fieldMedia` (W4) and toast when it
    is absent; the sketch tool falls back to a plain canvas pad when `openImageMarkup` is not loaded; the
    walk package tile pre-cache at package fetch time is W2's (the `downloadArea()` it should call exists);
    NAIP/TxGIO historical imagery, elevation/hillshade overlays and city storm/sewer live layers are wired
    (any ArcGIS REST layer draws) but no jurisdiction row is seeded (W1).

## Sources consulted (2026-09-25)
- **Verified during the W3 build (2026-09-25):** `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (basemap, keyless, in use); `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json` (Wayback release list; each entry's `itemURL` is `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{releaseId}/{level}/{row}/{col}`); `https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer` (TxGIO StratMap 2025 Land Parcels, statewide; `/identify` works, `/0/query` does not); ArcGIS REST `…/{layerId}/query?…&f=geojson` for FeatureServer/MapServer layers (city GIS); Leaflet 1.9.4 `L.CRS.Simple` + `L.imageOverlay` for plan backgrounds, `L.TileLayer.extend({ createTile })` for the stored-tile layer; the spherical-excess area formula from Leaflet.draw's `L.GeometryUtil.geodesicArea`.
- Esri: ArcGIS Location Platform pricing and free tier; World Imagery Wayback (WMTS, versions since 2014); basemap attribution and offline-use terms.
- TxGIO (Texas Geographic Information Office): statewide orthoimagery (NAIP and higher-resolution programs), historical aerial photo archive, Stratmap Land Parcels, DataHub feature services.
- USGS: 3DEP elevation, The National Map tile services (hillshade, contours).
- Google Maps Platform terms (no third-party map frameworks over Google tiles, no caching, no mixing providers); Google Earth historical imagery is not API-accessible.
- Microsoft: Bing Maps for Enterprise retirement schedule; Azure Maps pricing.
- Texas 811 (no public line maps); RRC public GIS pipeline viewer; National Pipeline Mapping System public viewer; TWDB groundwater well database; City of Houston / Austin / San Antonio open-data GIS (storm and sanitary sewer).
- Leaflet 1.9 `ImageOverlay` + `CRS.Simple`; Leaflet-Geoman licence (MIT for the free build); Leaflet.draw maintenance status.
- Apple: ARKit / RoomPlan LiDAR access is native-only; WebKit has no WebXR depth module; Chrome Android WebXR Depth Sensing API scope.
- In-repo: `phase-21-frontline-2.md`, `phase-13-documents.md` (visibility, caps), `server.mjs` `/go/` link route, `app.js` facility and Front Line maps.

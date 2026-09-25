# Phase 22 — Site workspace (desktop editor for walks, maps, scans and packages)

**Status:** ⚪ Placeholder, recorded 2026-09-25. **Not planned, not started. Do not build.**
**Depends on:** Phase 21 (Front Line 2) shipped.
**Source:** owner, 2026-09-25 — "might be worth doing, having some sort of application or ability to edit or package notes, maps, scans from site walks, improve notations and such. Don't want to build now, but might impact what or how we build Front Line."

## What it would be

An office/desktop workspace, per facility, where someone at a laptop can open everything the field collected at a site — walk observations and the annotated map, photos and their markup, videos, 3D scans, reference layers, measurements — and edit, annotate, reorganise and package it: fix pin positions and labels, redraw an area, re-annotate a photo, add office-only notes, attach customer drawings, then export a site package (PDF map + photo blocks, GeoJSON, a zip for QGIS or a customer) or push the map to a job's Brief.

## Rules Phase 21 follows so this stays cheap

These were decided while planning Phase 21 and are enforced there; a desktop editor is then a second renderer of the same records, not a rewrite.

1. **One observation, one record.** Pins and shapes are rows in `siteWalkObservations`, never an array on the walk report, so office and phone edits do not collide on one document (the server's per-record version check handles conflicts).
2. **Vectors, never flattened.** Map geometry is GeoJSON in EPSG:4326 (or image pixels on a plan background); photo markup is a stroke list stored on a new document version with the original kept. Nothing is stored only as a burned-in image.
3. **The facility is the container.** Walks, jobs, scans, plans and reference layers all hang off the facility, so a "site workspace" is just that facility's records, and the next walk or the job starts from the last map.
4. **Same components, no phone assumptions.** The map (`field/map.js`) and the markup tool (`field/media.js`) live in the `field/` module family and mount in the office app too (Develop & Planning, the project plan tab, the facility page). A zip export/import of a site package (GeoJSON + photos + PDF) exists from Phase 21 so QGIS or anything else can open a site in the meantime.

## When to plan it

After the pilot has produced real walks. The open questions then: bulk editing (multi-select, move many pins), version history and "who changed what" on a map, customer-facing packages, and whether the desktop editor should also be the place jurisdiction layers are curated.

## Corrections found during implementation

*(none — not started)*

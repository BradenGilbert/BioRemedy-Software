"""Browser half of scripts/smoke.mjs (Phase 20 item 6). Invoked by smoke.mjs with the scratch
server's URL; prints progress lines and a final `SUMMARY {json}` line.

Sweeps every view in app.js's viewWorkspace map (read from the file, so new views join automatically),
opens every detail tab for the first record of each kind, presses every dialog opener on each page and
re-saves every edit dialog unchanged. Collects console errors, uncaught rejections, and any NaN /
undefined / null / [object Object] in rendered text.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199").rstrip("/") + "/"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BAD_TEXT = re.compile(r"\bNaN\b|\bundefined\b|\[object Object\]|(?<![\w/.-])null(?![\w/.-])")
SKIP_ACTIONS = {"sign-out", "frontline-exit", "frontline-login", "delete-record", "restore-record", "sync-now", "start-microsoft-signin", "set-demo-role", "retire-frontline-device", "suspend-frontline-device"}

with open(os.path.join(ROOT, "app.js"), encoding="utf8") as handle:
    source = handle.read()
block = source[source.index("const viewWorkspace = {") : source.index("};", source.index("const viewWorkspace = {"))]
views = re.findall(r'^\s*"?([a-z0-9-]+)"?:\s*"', block, re.M)
detail_views = [v for v in views if v.endswith("-detail")]
list_views = [v for v in views if v not in detail_views and not v.startswith("frontline-")]

summary = {"views": 0, "tabs": 0, "dialogs": 0, "resaved": 0, "consoleErrors": [], "badText": []}
where = {"at": "start"}


def note_bad_text(page, label):
    text = page.evaluate("() => document.body.innerText")
    hits = sorted({m.group(0) for m in BAD_TEXT.finditer(text)})
    if hits:
        summary["badText"].append(f"{label}: {', '.join(hits)}")


def api(page, collection):
    return page.evaluate("async (c) => (await (await fetch('/api/backend/' + c, { headers: { 'X-CRM-Role': 'Admin' } })).json())", collection)


def first_id(page, collection):
    rows = [r for r in api(page, collection) if not r.get("deletedAt")]
    return rows[0]["id"] if rows else None


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    page.on("console", lambda m: summary["consoleErrors"].append(f"[{where['at']}] {m.text[:160]}") if m.type == "error" and "409" not in m.text else None)
    page.on("pageerror", lambda e: summary["consoleErrors"].append(f"[{where['at']}] pageerror: {str(e)[:160]}"))
    page.on("dialog", lambda d: d.accept())
    page.goto(BASE)
    page.wait_for_timeout(1500)

    # detail routes: which state key selects the record, and which collection feeds it
    detail_targets = {
        "account-detail": ("selectedAccountId", "accounts"),
        "contact-detail": ("selectedContactId", "contacts"),
        "opportunity-detail": ("selectedOpportunityId", "opportunities"),
        "project-detail": ("selectedProjectId", "projects"),
        "facility-detail": ("selectedFacilityId", "facilities"),
        "dispatch-job-detail": ("selectedDispatchJobId", "dispatchJobs"),
        "employee-detail": ("selectedEmployeeId", "employees"),
        "sample-detail": ("selectedSampleId", "sampleRecords"),
        "consumable-detail": ("selectedInventoryItemId", "inventoryItems"),
        "equipment-detail": ("selectedAssetTag", "equipmentAssets"),
    }

    def open_view(view):
        target = detail_targets.get(view)
        route = f"#view={view}"
        if target:
            key, collection = target
            record_id = first_id(page, collection)
            if not record_id:
                return False
            if key == "selectedAssetTag":
                record_id = next(r for r in api(page, collection) if r["id"] == record_id).get("assetTag", record_id)
            route += f"&{key}={record_id}"
        page.goto(BASE + route)
        page.reload()
        page.wait_for_timeout(900)
        return True

    def press_openers(label):
        openers = page.evaluate("() => [...new Set([...document.querySelectorAll('#app button[data-action^=\"open-\"]')].map(b => b.dataset.action))]")
        for action in openers:
            if action in SKIP_ACTIONS:
                continue
            button = page.locator(f'#app button[data-action="{action}"]').first
            if not button.count() or not button.is_visible():
                continue
            try:
                button.click(timeout=2000)
            except Exception:
                continue
            page.wait_for_timeout(250)
            open_dialog = page.locator("dialog[open]")
            if not open_dialog.count():
                continue
            summary["dialogs"] += 1
            note_bad_text(page, f"{label} > {action}")
            # re-save an edit dialog unchanged; leave create dialogs alone
            form = open_dialog.locator("form").first
            is_edit = form.count() and form.evaluate("f => { const id = f.querySelector('input[name=\"id\"]'); return Boolean(id && id.value); }")
            if is_edit:
                try:
                    form.locator('button[type="submit"]').first.click(timeout=2000)
                    page.wait_for_timeout(700)
                    summary["resaved"] += 1
                except Exception:
                    pass
            page.evaluate("() => document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            page.wait_for_timeout(150)

    for view in list_views + detail_views:
        where["at"] = view
        try:
            if not open_view(view):
                print(f"  skip {view} (no record)")
                continue
        except Exception as exc:
            summary["consoleErrors"].append(f"[{view}] could not open: {str(exc)[:120]}")
            continue
        summary["views"] += 1
        note_bad_text(page, view)
        # every tab on the page
        tabs = page.evaluate("() => [...document.querySelectorAll('#app [role=\"tab\"], #app button[data-action^=\"switch-\"][data-tab]')].map(b => b.dataset.tab || b.innerText).filter(Boolean)")
        seen = set()
        for tab in tabs:
            if tab in seen:
                continue
            seen.add(tab)
            button = page.locator(f'#app button[data-tab="{tab}"]').first
            if not button.count():
                continue
            try:
                button.click(timeout=2000)
            except Exception:
                continue
            page.wait_for_timeout(350)
            summary["tabs"] += 1
            note_bad_text(page, f"{view} > {tab}")
            press_openers(f"{view} > {tab}")
        if not tabs:
            press_openers(view)
        print(f"  {view}: {len(seen)} tabs")

    # Front Line: log in, then walk its screens
    where["at"] = "frontline"
    page.goto(BASE + "#view=frontline-login")
    page.wait_for_timeout(700)
    if page.locator("#frontlineFieldLeadSelect option").count() > 1:
        page.select_option("#frontlineFieldLeadSelect", index=1)
        page.click('button[data-action="frontline-login"]')
        page.wait_for_timeout(600)
        for view in [v for v in views if v.startswith("frontline-") and v not in ("frontline-login", "frontline-job-detail")]:
            where["at"] = view
            page.goto(BASE + f"#view={view}")
            page.wait_for_timeout(700)
            summary["views"] += 1
            note_bad_text(page, view)
        job_id = first_id(page, "dispatchJobs")
        if job_id:
            where["at"] = "frontline-job-detail"
            page.goto(BASE + f"#view=frontline-job-detail&frontlineSelectedJobId={job_id}")
            page.wait_for_timeout(900)
            summary["views"] += 1
            note_bad_text(page, "frontline-job-detail")
        print(f"  frontline: {len([v for v in views if v.startswith('frontline-')])} screens")
    browser.close()

print("SUMMARY " + json.dumps(summary))

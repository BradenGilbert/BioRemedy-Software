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
SKIP_ACTIONS = {"sign-out", "frontline-exit", "frontline-login", "delete-record", "restore-record", "sync-now", "start-microsoft-signin", "retire-frontline-device", "suspend-frontline-device", "revoke-session", "toggle-system-user", "accept-consent", "create-dispatch-link"}
SMOKE_PASSWORD = os.environ.get("CRM_SMOKE_PASSWORD", "")

with open(os.path.join(ROOT, "app.js"), encoding="utf8") as handle:
    source = handle.read()
block = source[source.index("const viewWorkspace = {") : source.index("};", source.index("const viewWorkspace = {"))]
views = re.findall(r'^\s*"?([a-z0-9-]+)"?:\s*"', block, re.M)
detail_views = [v for v in views if v.endswith("-detail")]
list_views = [v for v in views if v not in detail_views and not v.startswith("frontline-")]
# Phase 21: the field app's routes are declared in field/index.js (FIELD_ROUTES) and in any sibling
# module that calls registerFieldRoute("field-xxx", ...). Both forms are picked up here.
field_views = []
for name in os.listdir(os.path.join(ROOT, "field")):
    if not name.endswith(".js"):
        continue
    with open(os.path.join(ROOT, "field", name), encoding="utf8") as handle:
        field_source = handle.read()
    field_views += re.findall(r'^\s*"(field-[a-z0-9-]+)":\s*\{', field_source, re.M)
    field_views += re.findall(r'registerFieldRoute\(\s*"(field-[a-z0-9-]+)"', field_source)
field_views = sorted(set(field_views))

summary = {"views": 0, "tabs": 0, "dialogs": 0, "resaved": 0, "consoleErrors": [], "badText": []}
where = {"at": "start"}


def is_expected_field_api_404(text):
    """Phase 21 W2's field/package.js probes W1's /api/field/* routes first and falls back
    gracefully on a 404 — but Chrome logs "Failed to load resource: 404" for any fetch() that gets a
    4xx response, regardless of how the app handles it, and that log is a console "error" event
    Playwright can't tell apart from a genuine bug. Until W1's server.mjs routes are merged into
    whichever worktree runs this script, every field-app screen trips that log at least once on load
    (refreshFieldPackage), so this narrowly excludes 404s under /api/field/ rather than every console
    error. Remove this once W1's routes are merged for good."""
    return "404" in text and "/api/field/" in text


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
    page.on("console", lambda m: summary["consoleErrors"].append(f"[{where['at']}] {m.text[:160]}") if m.type == "error" and "409" not in m.text and not is_expected_field_api_404(m.text) else None)
    page.on("pageerror", lambda e: summary["consoleErrors"].append(f"[{where['at']}] pageerror: {str(e)[:160]}"))
    page.on("dialog", lambda d: d.accept())
    # Phase 12a: sign in with the scratch server's break-glass account before the first page load, so
    # the cookie is already in the context and no request ever 401s.
    login = page.context.request.post(BASE + "api/auth/break-glass", data={"password": SMOKE_PASSWORD})
    if login.status != 200:
        print(f"  break-glass sign-in failed: {login.status}")
        summary["consoleErrors"].append(f"[login] break-glass sign-in failed with {login.status}")
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
        # Phase 21 field app, desktop surface (inside the simulator frame)
        for view in field_views:
            where["at"] = view
            page.goto(BASE + f"#view={view}")
            page.wait_for_timeout(700)
            summary["views"] += 1
            note_bad_text(page, view)
        print(f"  field (desktop): {len(field_views)} screens")

    # Phase 21 field app, phone surface: a second context at a real phone size. The picker login is
    # repeated because a new context has no in-memory session.
    phone = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone_page = phone.new_page()
    phone_page.on("console", lambda m: summary["consoleErrors"].append(f"[phone {where['at']}] {m.text[:160]}") if m.type == "error" and "409" not in m.text and not is_expected_field_api_404(m.text) else None)
    phone_page.on("pageerror", lambda e: summary["consoleErrors"].append(f"[phone {where['at']}] pageerror: {str(e)[:160]}"))
    phone_page.on("dialog", lambda d: d.accept())
    phone_login = phone.request.post(BASE + "api/auth/break-glass", data={"password": SMOKE_PASSWORD})
    if phone_login.status != 200:
        summary["consoleErrors"].append(f"[phone login] break-glass sign-in failed with {phone_login.status}")
    where["at"] = "frontline-login"
    phone_page.goto(BASE + "?surface=phone#view=frontline-login")
    phone_page.wait_for_timeout(900)
    if phone_page.locator("#frontlineFieldLeadSelect option").count() > 1:
        phone_page.select_option("#frontlineFieldLeadSelect", index=1)
        phone_page.click('button[data-action="frontline-login"]')
        phone_page.wait_for_timeout(600)
        for view in field_views:
            where["at"] = view
            phone_page.goto(BASE + f"?surface=phone#view={view}")
            phone_page.wait_for_timeout(700)
            summary["views"] += 1
            note_bad_text(phone_page, f"phone {view}")
            # a phone screen must never scroll sideways
            overflow = phone_page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if overflow > 2:
                summary["badText"].append(f"phone {view}: horizontal overflow {overflow}px")
        print(f"  field (phone): {len(field_views)} screens")

        # Phase 21 W2: offline capture. Open the job the logged-in field lead actually leads, go
        # offline, add a note through the "+ Activity" ad hoc form (queues through field/package.js's
        # outbox instead of failing outright), come back online, wait for the drain, and check the
        # outbox emptied with exactly one new jobFormSubmissions row (no duplicate replay).
        where["at"] = "field-job offline capture"
        employee_id = phone_page.eval_on_selector("#frontlineFieldLeadSelect", "el => el.value") if phone_page.locator("#frontlineFieldLeadSelect").count() else None
        jobs = api(phone_page, "dispatchJobs")
        assignments = api(phone_page, "jobAssignments")
        led_job = None
        if employee_id:
            led_ids = {a["jobId"] for a in assignments if a.get("employeeId") == employee_id and a.get("isFieldLead") and not a.get("deletedAt")}
            non_terminal = {"closed", "cancelled"}
            candidates = [j for j in jobs if j["id"] in led_ids and not j.get("deletedAt") and j.get("status") not in non_terminal] or [
                j for j in jobs if j["id"] in led_ids and not j.get("deletedAt")
            ]
            led_job = candidates[0] if candidates else None

        if led_job:
            submissions_before = len([s for s in api(phone_page, "jobFormSubmissions") if not s.get("deletedAt")])
            # A `page.goto` mid-session is a real navigation (new document load), which drops the
            # in-memory frontlineSession — there is no persisted field-app session to resume from, so
            # a full reload bounces back to the login picker. Everything after login must be driven
            # through in-app clicks/taps instead, starting from field-home's own "open job" action.
            phone_page.goto(BASE + "?surface=phone#view=field-home")
            phone_page.wait_for_timeout(500)
            dismiss_banner = phone_page.locator('[data-action="dismiss-update-banner"]')
            if dismiss_banner.count():
                dismiss_banner.first.click(force=True)
                phone_page.wait_for_timeout(200)
            job_card = phone_page.locator(f'button[data-field-action="field-open-job"][data-id="{led_job["id"]}"]')
            if job_card.count():
                job_card.first.click()
                phone_page.wait_for_timeout(600)
                phone_page.click('button[data-field-action="field-job-tab"][data-tab="work"]')
                phone_page.wait_for_timeout(400)

                phone_page.context.set_offline(True)
                phone_page.click('button[data-action="frontline-adhoc-pick-type"][data-type="Note"]')
                phone_page.wait_for_timeout(300)
                phone_page.fill('form[data-field-form="field-adhoc-activity"] textarea[name="summary"]', "Smoke test offline note")
                phone_page.click('form[data-field-form="field-adhoc-activity"] button[type="submit"]')
                phone_page.wait_for_timeout(500)
                phone_page.context.set_offline(False)
                phone_page.wait_for_timeout(500)
                phone_page.evaluate("async () => { if (window.fieldPackage) await window.fieldPackage.drainOutbox(); }")
                phone_page.wait_for_timeout(1500)

                outbox_summary = phone_page.evaluate("() => window.fieldPackage ? window.fieldPackage.outboxSummary() : null")
                if outbox_summary is None:
                    summary["consoleErrors"].append("[offline capture] window.fieldPackage was not exposed for testing")
                elif outbox_summary.get("queued", 0) or outbox_summary.get("failed", 0):
                    summary["badText"].append(f"offline capture: outbox did not drain — {json.dumps(outbox_summary)}")

                submissions_after = len([s for s in api(phone_page, "jobFormSubmissions") if not s.get("deletedAt")])
                if submissions_after != submissions_before + 1:
                    summary["badText"].append(
                        f"offline capture: expected jobFormSubmissions to grow by 1 ({submissions_before} -> {submissions_before + 1}), got {submissions_after}"
                    )
            else:
                summary["consoleErrors"].append(f"[offline capture] job card for {led_job['id']} not found on My Day")
        else:
            summary["consoleErrors"].append("[offline capture] no dispatch job led by the logged-in field lead — skipped")

    phone.close()
    browser.close()

print("SUMMARY " + json.dumps(summary))

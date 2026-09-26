# AI assistant — idea note (not on the roadmap)

**Status:** Idea only. Captured 2026-09-25 from an owner conversation. **Not scheduled, not a phase.** Do not add it to `docs/roadmap/README.md` or `OUTSTANDING.md` until the owner says so. When it is picked up, this note becomes the seed of a `phase-NN-ai-assistant.md`.

---

## The idea

Put a chat assistant (Claude or similar) inside the platform that can act on the data **within the signed-in user's permissions**. The owner described three uses:

1. **Sales intake.** Tell it, in plain words, what just happened — *"City of Georgetown has a spill on 130 and University, diesel, call came in at 2am, mobilizing now, on city property, generator unknown"* — and it creates the opportunity or project, links the account and facility, and adds the notes.
2. **Field guide.** A field lead on site photographs the ground and asks *"diesel on asphalt, which of our degreasers gives the best result?"* The assistant answers from our own product list, SDS and SOPs, and keeps the crew on the mandated process.
3. **Data review.** *"Find every project where we never closed out the waste report"* or *"what's our profitability on the last three jobs?"* It scans, calculates, and writes the answer or a document.

Three personas, one backbone.

---

## Proposed shape

### One server route, tools over existing handlers

- Add a server route (working name `/api/assistant/chat`) that holds the conversation and runs an agent loop with the Anthropic SDK (`@anthropic-ai/sdk`, tool runner). The browser never calls the model directly; the API key lives on the server like the Entra secrets do.
- The model's **tools are thin wrappers over the existing backend handlers**, never raw file or collection access. Each tool call runs as the caller's session, so `getRoles` + `canAccess`, the `version` conflict check (409), and the soft-delete cascade all apply automatically. The assistant can never do more than the person could by clicking.
- Every tool call goes through the existing `audit()` helper with an extra `via: "assistant"` field so bot actions are distinguishable from human ones in `audit.log`.

### Two rules that make it safe

- **Propose, then commit.** Write tools return a *draft*. The UI shows the filled-in record ("Create opportunity: City of Georgetown, diesel spill, SH 130 at University, generator unknown") and the person confirms. Only then does the real save run. Same feel as the intake Needs-info / Mark-ready flows.
- **Query tools return projections, not dumps.** Never hand the model all ~107 collections. Server-side tools do the joins and return small tables: e.g. `findProjects({ missing: "wasteRecords", status: "complete" })`, `projectFinancials(projectIds)` summing `invoiceLines`, `jobExpenses`, `timeEntries`, `materialUsage`. The model reasons over the table; the arithmetic is ours.

### Persona matrix

| Persona | Tools | Writes? | Where it lives |
|---|---|---|---|
| Data review | read/query tools + a document generator (via the existing `/api/documents` route) | No | Reports view, desktop |
| Sales intake | read + search (account/facility/contact matching) + draft-create/update for `accounts`, `contacts`, `opportunities`, `projects`, `activities` | Yes, with confirm | Sales views, desktop and phone |
| Field guide | read `products`, `materials`, `jobSteps`, plus a **new response-guide reference collection**; photo input (image block) | Only notes/photos on the dispatch job | Front Line app |

Tool names must use the real collection names from `docs/roadmap/GLOSSARY.md` (`projects` not `jobs`; `facilities` = customer sites; `locations` = GPS points).

---

## Suggested build order and why

1. **Data review first.** Read-only, so the permission/audit layer gets proven at zero risk. All the data it needs already exists (`invoices`, `invoiceLines`, `jobExpenses`, `timeEntries`, `materialUsage`, `wasteRecords`). Roughly one phase.
2. **Sales intake second.** Adds draft-and-confirm write tools. The hard part is entity matching — "City of Georgetown" must resolve to the existing account and facility before anything is created, so a search tool comes before any create tool.
3. **Field guide last.** The model can read a photo, but nothing in the data today says which degreaser goes on diesel-on-asphalt or what the mandated steps are. Needs a new reference collection (contaminant × surface × product, with SDS/SOP text) that the assistant answers *only* from, with citations. Also needs a Front Line UI, an offline story, and a clear "guidance, the lead decides" framing. Generic advice on a spill site is worse than none.

---

## Open questions to settle before starting

- **Live data or a replica for wide scans?** The API serializes requests; a long data-review scan on the live server would block other users.
- **Token budget per user / per month** so a chatty session can't run up the bill.
- **Provider.** The design is provider-neutral in principle; the notes above assume the Anthropic SDK and `claude-opus-5`. A GPT build would need its own tool-calling wiring but the same server-side tool layer.
- **Where does the response-guide reference data come from?** Product SDS sheets and internal SOPs would need to be collected and structured — that is content work, not code.
- **Which roles get which persona?** Presumably Sales → intake, Field/Crew Lead → field guide, Admin/Ops/Finance → data review. Map to `roleAccess` domains when the phase is written.

---

## Related

- `docs/roadmap/phase-12-identity-and-audit.md` — the session/role/audit layer the assistant rides on
- `docs/roadmap/phase-10-frontline.md`, `phase-21-frontline-2.md` — where the field guide would surface
- `docs/roadmap/phase-13-documents.md` — the documents route the data-review persona would write through

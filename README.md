# Environmental Services CRM Foundation

This is a zero-install browser CRM foundation for an environmental cleanup sales team. It is built to help discuss workflows before committing to the production backend, database, and Microsoft 365 tenant setup.

## What is included

- Offline-first browser app with local records stored in IndexedDB.
- Service worker cache so the app shell loads after the first visit.
- Environmental services CRM sample data: accounts, contacts, locations, previous projects, scheduled work, active jobs, assignments, alerts, material usage, equipment logs, sample records, spatial metadata, opportunities, field tasks, site notes, and cleanup stages.
- Sync queue placeholder so offline edits are tracked until the real API exists.
- Microsoft Entra ID sign-in foundation using browser Authorization Code + PKCE once a tenant ID and client ID are configured.
- Product notes in `docs/crm-foundation.md`.
- Dataverse-style relationship architecture in `docs/dataverse-relationship-architecture.md`.
- Workforce, jobs, dispatch, execution, and Front Line architecture in `docs/erp-operational-architecture.md`.

## Run locally

If Node is on your path:

```powershell
npm run start
```

If Node is not on your path, run the app with the bundled Codex Node executable:

```powershell
& "C:\Users\Braden\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\server.mjs
```

Then open the local URL printed by the server.

## Microsoft identity setup

The app can be wired to Microsoft Entra ID from the Identity & Sync screen. You will need:

- Directory tenant ID.
- Application client ID.
- A SPA redirect URI that exactly matches the app URL shown in the Identity & Sync screen.

The current app stores only the signed-in user's profile locally. Access tokens are kept in browser session storage and are not persisted to the offline database.

## Next decisions

See `docs/crm-foundation.md` for the CRM areas we should decide together: pipeline stages, account/site model, roles, offline sync behavior, Microsoft 365 integration depth, and production hosting.

See `docs/dataverse-relationship-architecture.md` for the Dynamics 365 Sales relationship model and local SQL foundation.

See `docs/erp-operational-architecture.md` for the operational ERP data
dictionary, state machines, application boundaries, and migration order.

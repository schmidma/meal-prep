# Meal prep

A self-hosted meal-prep planner for connecting ingredients, cooking, prepared food, and later meals. Browse a continuous hourly calendar or a chronological agenda, with manual scheduling and explicit food assignments.

## Run locally

Use Node 24 or 26, then:

```sh
npm install
npm run dev
```

Open the local address printed by Vite (normally http://localhost:5173).

## Try the planner

- In **Calendar**, click an empty time or draw a range to add cooking, a meal, blocked time, or another activity. Click a card for details; drag it to move or resize it.
- Use **Agenda** for a chronological list and date-specific activity creation. Phones start in Agenda; your view preference stays in that browser.
- **At home** stays alongside the planner, with ingredients to use and food already cooked. Add entries such as `2 paprika`, then drag food onto an activity or open it to assign a quantity. Fractional assignments are supported.
- Use **Plan a new meal from this** for prepared food, then choose its place on the calendar. **Choose on calendar** assigns food to an existing activity.
- Open **Recipes** to save reusable names, yields, durations, ingredient notes, and instructions. Explicitly select a recipe suggestion while naming a new activity to create an independent copy. Recipe ingredient notes do not create stock or assignments, and later recipe edits do not change existing activities.
- Open **Checks** to review quantities, readiness, and scheduling across the whole plan, not just the visible dates. Follow a check to its editor, then use **Back to checks** to continue. Conflicts remain editable; checks do not schedule or correct anything automatically.
- Details share one panel, with direct switching between Checks and Recipes. On phones, **Expand details** provides more room. Long names have a bounded disclosure when they overflow.
- Extend the visible days or jump to any supported date. Select an activity or food to see its direct relationships; follow dated links to sources and destinations outside the visible range.

Quantities are numeric planning commitments, not a live pantry inventory. Editing uses a single duration; legacy units and other older metadata are retained without adding extra controls. There are no implicit unit conversions. Use the theme control to switch between System, Light, and Dark.

## Saving and storage

Edits save automatically to SQLite. **Saved** means the current edits have reached the server; they survive refreshes and restarts. The example plan is created only for a new database. Dates and allocations are not contained in week records.

All devices share one household plan. Refresh to see changes made elsewhere. Conflicting saves are blocked rather than silently overwriting another tab or device. Local edits remain available to download before explicitly loading the saved version; there is no automatic merging.

If saving fails, keep the tab open and use **Retry**. Pending changes have a per-tab browser recovery copy when session storage is available, including across refreshes. That copy is not a backup and may disappear when the tab closes. Wait for **Saved**, or download the local changes, before closing the tab.

The default database is `data/meal-prep.sqlite`, relative to the working directory. Set `MEAL_PREP_DB_PATH` to use another location:

```sh
MEAL_PREP_DB_PATH=/path/to/private-data/meal-prep.sqlite npm run dev
```

Keep this directory private and outside web-served files. When deploying in a container, mount it on persistent storage. Database files are ignored by Git.

For a backup, wait for saves to finish, stop the app, and copy the **whole database directory**, including any `-wal` and `-shm` files. Then restart the app. Restore with the app stopped and browser tabs closed, so old tab state cannot be written over restored data.

## Prototype boundaries

There is no authentication, shopping list, full pantry inventory, or automatic scheduling. Plans are stored as a single snapshot with a 500 kB size limit. Scheduling checks are household-level estimates; they do not model exact preparation stages, individual people's calendars, food safety, or daylight-saving clock changes within an activity.

Do not expose this prototype directly to the public internet. Fonts and icons are served locally; no external service is needed at runtime.

## Development

```sh
npm run check       # Svelte and TypeScript
npm test            # Domain logic, SQLite storage, and autosave recovery
npm run test:ui     # Chromium interactions at desktop and phone sizes
npm run build       # Production Node build
```

Browser tests use `/usr/bin/chromium` when present. Otherwise install a browser with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your Chromium executable. They start their own server with a temporary database; an existing server on the test port must be stopped first.

The domain model is in `src/lib/domain.ts`, civil-date helpers in `src/lib/calendar.ts`, and example data in `src/lib/example-plan.ts`. The main workspace is `src/routes/+page.svelte`; timeline and editing components live in `src/lib/components/`.

To inspect a production build locally:

```sh
npm run build
HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 node build
```

Open http://127.0.0.1:3000. For deployment at another address, set `ORIGIN` to the exact browser-facing origin, including its scheme and port; otherwise same-origin saves may be rejected. See [adapter-node configuration](https://svelte.dev/docs/kit/adapter-node#Environment-variables-ORIGIN-PROTOCOL_HEADER-HOST_HEADER-and-PORT_HEADER) when using a trusted reverse proxy.

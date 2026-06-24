---
title: EVE Copilot
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# EVE Copilot

A helper copilot for [EVE Online](https://www.eveonline.com/), built with **React + TypeScript + MUI**
on the front end and a small **Node + Express** API on the back end.
It talks to the public [EVE ESI API](https://esi.evetech.net/) (no login required for the
current features) and loads the EVE Static Data Export (SDE) station/system codelists
at startup so they stay fresh without redeploying the app.

The repo is split into two standalone projects, each with its own `package.json` and
dependencies (install/run them independently):

```text
eve-multitool/
  web/      React + Vite frontend  (dev: http://localhost:5177)
  server/   Node + Express API     (dev: http://localhost:4000)
```

## Features

### Courier Contracts
Finds profitable courier hauls across all of New Eden.

- **Filters**
  - Max collateral (in millions of ISK)
  - Max cargo volume (m³)
  - Current station (autocomplete — options appear after typing 3+ characters)
  - Route type: **Safest** (prefers high-sec) or **Shortest** (fewest jumps)
- **Results table** (updates on the _Search_ button) with columns for pickup,
  dropoff, cargo, income, jumps from your station to pickup, jumps pickup→dropoff,
  income per jump, time active, time remaining and an **attractivity index** (0–100).
- Click any column header to sort: **descending → ascending → cleared**.

#### Attractivity index

Two interchangeable scoring methods (pick from the dropdown; each is described in the UI).
Both normalise their inputs across the current result set, so the index is a relative
"best in this list" ranking:

| Method | What it rewards |
| --- | --- |
| **Profit per jump** | Pure ISK earned per jump (approach + delivery summed). |
| **Risk-adjusted value** | 50% ISK/jump + 30% low collateral-vs-reward + 20% ISK/m³. |

## Tech notes

- **State**: [jotai](https://jotai.org/) for filters, selected method and the last result.
- **Routing**: [react-router](https://reactrouter.com/) — the app is structured for
  additional tools beyond couriers.
- **Data fetching**: there is no "all contracts" ESI endpoint, so the **`server/`** API
  fans out over every region's paginated public-contracts feed (concurrency-limited),
  keeps only courier contracts, enriches them with routes + a danger index, and caches the
  result in memory (refreshed on a timer so all clients share one crawl). The frontend
  calls `GET /api/contracts`; attractivity scoring stays on the client. Jumps and routes
  are computed server-side from the SDE jump graph (BFS for shortest, Dijkstra with a
  non-high-sec penalty for safest) — no ESI `/route` calls.
- **Static data (codelists)**: NPC stations and solar systems come from the
  [Fuzzwork SDE CSV mirror](https://www.fuzzwork.co.uk/dump/latest/csv/) (itself derived
  from CCP's official SDE). They are fetched and parsed in the browser at startup, then
  cached in **IndexedDB** for 12 hours — so the lists stay fresh automatically (no app
  rebuild) while repeat loads are instant and work offline once cached. See
  [web/src/data/sde.ts](web/src/data/sde.ts). The server loads the same SDE independently
  (see [server/sde.ts](server/sde.ts)).
- **Player structures (citadels)** can't be resolved without an authenticated login, so
  contracts to/from them show as _Unknown structure_ and have no jump count.

## EVE SSO login (optional)

Logging in with a character (OAuth2 PKCE) is **optional** — the courier finder
works on public data without it. When logged in you get an avatar menu with live
character status (system, security, ship, online) and the "Current system"
filter auto-fills from your character's live location.

To enable it, register an app at <https://developers.eveonline.com>:

- **Authentication**: Authorization Code (PKCE — no client secret)
- **Callback URL**: `http://localhost:5177/auth/callback` (dev) / `https://<domain>/auth/callback` (prod)
- **Scopes**: `esi-location.read_location.v1`, `esi-location.read_ship_type.v1`,
  `esi-location.read_online.v1`, `esi-ui.open_window.v1`, `esi-ui.write_waypoint.v1`,
  `esi-universe.read_structures.v1`

Then copy `web/.env.example` → `web/.env.local` and set `VITE_EVE_CLIENT_ID`.

> Tokens (incl. the refresh token) are stored in the browser — fine for local
> use; a small token-exchange backend would be more secure for a hosted deploy.

## Getting started

The two projects are installed and run separately — use two terminals.

**Backend** (`server/`):

```bash
cd server
npm install
npm run dev        # tsx watch — API on http://localhost:4000
npm run typecheck
npm run lint
```

**Frontend** (`web/`):

```bash
cd web
npm install
npm run dev        # Vite dev server on http://localhost:5177
npm run build      # typecheck + production build
npm run typecheck
npm run lint
```

In dev, the frontend proxies `/api/*` to the backend (see `web/vite.config.ts`), so start
the server first. The SDE codelists are loaded at runtime (see above), so there is no data
generation/build step — the lists refresh themselves from the Fuzzwork mirror.

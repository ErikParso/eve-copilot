# EVE Multitool

A helper toolkit for [EVE Online](https://www.eveonline.com/), built with **React + TypeScript + MUI**.
It talks to the public [EVE ESI API](https://esi.evetech.net/) (no login required for the
current features) and loads the EVE Static Data Export (SDE) station/system codelists
at startup so they stay fresh without redeploying the app.

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
- **Data fetching**: there is no "all contracts" ESI endpoint, so the app fans out over
  every region's paginated public-contracts feed (concurrency-limited, with progress) and
  keeps only courier contracts. Jump counts come from the ESI `/route` endpoint and are
  cached per session.
- **Static data (codelists)**: NPC stations and solar systems come from the
  [Fuzzwork SDE CSV mirror](https://www.fuzzwork.co.uk/dump/latest/csv/) (itself derived
  from CCP's official SDE). They are fetched and parsed in the browser at startup, then
  cached in **IndexedDB** for 12 hours — so the lists stay fresh automatically (no app
  rebuild) while repeat loads are instant and work offline once cached. See
  [src/data/sde.ts](src/data/sde.ts).
- **Player structures (citadels)** can't be resolved without an authenticated login, so
  contracts to/from them show as _Unknown structure_ and have no jump count.

## Getting started

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
npm run build      # typecheck + production build
npm run typecheck  # type-only check
npm run lint
```

The SDE codelists are loaded at runtime (see above), so there is no data
generation/build step — the lists refresh themselves from the Fuzzwork mirror.

# Packages (sell contracts) — test plan for the verification bot

How to verify the sell-contract ("package") feature end to end. Packages are the
3rd hauling kind alongside courier + arbitrage; the card is the visual/functional
twin of the arbitrage card, adapted for a fixed-price multi-item bundle.

> **Read this first — the OFFLINE harness can't see packages yet.**
> `web/test_e2e_runner.js` starts the backend with `OFFLINE=true`, which loads
> only the market-snapshot fixture and does **not** run the contracts/packages
> crawl. So packages never appear under OFFLINE. Two ways forward:
> - **Path A — live smoke test** (default below): run the real crawl against ESI.
>   Nondeterministic + slow warm-up, but exercises the real pipeline.
> - **Path B — deterministic seam**: add the small `/api/test/mutate-packages`
>   injection endpoint (Appendix B) so packages can be tested like arbitrage,
>   fully offline and repeatable. Recommended for CI.

---

## 0. Selectors & API reference (both paths)

**Card DOM ids** (the grid sets `id="card-<key>"`):
- Available package card: `#card-pkg:<contractId>`
- Pinned package card: `#card-pp:<contractId>`

**Within a package card:**
- Pin / unpin button: `button:has([data-testid="PushPinOutlinedIcon"])` (unpinned)
  / `button:has([data-testid="PushPinIcon"])` (pinned). Tooltip "Pin package" / "Unpin package".
- Attractivity bubble: present only when **not** pinned.
- Title line: text `Package · N item types`.
- Quantity/volume line: text matches `/units? ·/`.
- Contents tooltip trigger: the `[data-testid="SegmentIcon"]` next to the qty line
  (hover → "Package Contents (N types)" with per-line `n× Name` and sell value;
  unsellable/BPC lines are greyed and read "can't sell").
- Endpoints: `Buy` row (the contract station) and `Sell` row (best dest). In transit
  the Buy row reads **"In ship"**.
- Stats: `Price (you pay)`, `Sale value (you get)`, `Items sellable` (`sold / total`).
- Status arrows (pinned): `[data-testid="ArrowUpwardIcon"]` (income up, green border),
  `[data-testid="ArrowDownwardIcon"]` (down = warning border, or zero = error border),
  `[data-testid="RemoveIcon"]` (unchanged).
- Lifecycle buttons (pinned): `button:has-text("Confirm Buy")` (planning, **one click —
  no dialog**) → `button:has-text("Confirm Sell")` + `button:has-text("Sell Elsewhere")`
  (transit) → disabled `Executed` button.
- Sell-Elsewhere modal: dialog titled "Sell this package — where?", cards have a
  `button:has-text("Redirect Here")`; close with `[data-testid="CloseIcon"]`.

**API:**
- `POST /api/hauling?routeType=safest&origin=<sys>&capacity=<m3>&balance=<isk>&taxPct=4.5&wIncome=5&wJumps=5&wDanger=5`
  body `{ "hauls": [], "packages": [] }` → response `items[]` (each `kind` of
  `courier|arbitrage|package`), plus `pinnedStatuses` and `pinnedPackageStatuses`.
- `POST /api/packages/sell-destinations` body
  `{ lines:[{typeId,quantity,isBlueprintCopy}], price, origin, routeType, taxPct, weights }`
  → `{ items: PackageItem[] }`.

**localStorage:** pinned packages persist under key `eve-multitool.pinnedPackages.v1`.

---

## Path A — live smoke test

### A1. Start the stack (LIVE, not OFFLINE)
```bash
# terminal 1 — backend, REAL crawl (no OFFLINE env)
cd server && npm run dev        # tsx watch index.ts, listens on :4000

# terminal 2 — frontend
cd web && npm run dev           # vite on :5173
```
Wait for `GET http://localhost:4000/api/health` → `{ok:true}` and the Vite URL.

### A2. Wait for the package pipeline to warm up
Packages need (a) the market snapshot warm and (b) the contents worker to have
fetched some sell contracts. Watch the backend log for:
- `[Contracts Crawl] Finished! Cached N courier + M sell contracts.`
- `[Packages] Reconciled: <live> live sell contracts, <cached> cached, <queued> queued (+new, −evicted).`
- The `cached` count climbing over time (hub regions first).

This can take **several minutes** to tens of minutes. Poll the API until at least
one package shows up rather than guessing a fixed sleep:
```bash
# returns the number of package items currently shipped
curl -s -X POST 'http://localhost:4000/api/hauling?routeType=safest&capacity=1000000000&balance=100000000000&taxPct=4.5&wIncome=5&wJumps=5&wDanger=5' \
  -H 'Content-Type: application/json' -d '{"hauls":[],"packages":[]}' \
  | python -c "import sys,json;d=json.load(sys.stdin);print(sum(1 for i in d['items'] if i['kind']=='package'),'packages of',len(d['items']),'items')"
```
**Gate:** wait until this prints a non-zero package count (suggested timeout 30 min,
poll every 30 s). If it stays 0 after warm-up, the contents worker may be starved or
all bundles unprofitable — capture the `[Packages]` logs and stop.

### A3. API-shape checks (before touching the UI)
From the same `/api/hauling` response, pick one `kind:"package"` item and assert:
- `id` is the contract id string; `contents` is a non-empty array of
  `{typeId,itemName,quantity,isBlueprintCopy,soldQuantity,sellValue,unitVolume}`.
- `source` and `dest` are resolved endpoints with non-null `systemId`.
- `deliveryRoute` is a non-empty `RouteSystem[]`; `price > 0`; `totalVolume > 0`.
- `profit ≈ sellValue*(1-0.045) - price` (within rounding).
- `danger` is a number and `attractivity` is in 0..100.

Sell-destinations endpoint (use the contents from that item):
```bash
curl -s -X POST 'http://localhost:4000/api/packages/sell-destinations' \
 -H 'Content-Type: application/json' \
 -d '{"lines":[{"typeId":34,"quantity":100,"isBlueprintCopy":false}],"price":1000000,"origin":30000142,"routeType":"safest","taxPct":4.5,"weights":{"income":5,"totalJumps":5,"danger":5}}' \
 | python -c "import sys,json;d=json.load(sys.stdin);print(len(d['items']),'sell destinations; first dest:',d['items'][0]['dest']['name'] if d['items'] else '—')"
```
**Gate:** returns `items` with `source.name == "Your ship"` and resolved `dest`.

### A4. Browser flow (Playwright or manual)
Open `http://localhost:5173/couriers`. Set a known location + fat wallet so routes
resolve and nothing is filtered:
```js
await page.evaluate(() => {
  window.setTestLocation(30000142, 'Jita');     // 30000142 = Jita system
  window.setTestWalletBalance(100000000000);
  window.triggerHaulingRefresh();
});
```
Run these test cases:

1. **Discovery renders.** At least one `#card-pkg:<id>` exists. It shows the
   "Package · N item types" title, an attractivity bubble, Buy/Sell endpoints, a
   route strip with a jumps label, and the three stats. Hovering the SegmentIcon
   shows the contents breakdown. *(visual parity: it should look like an arbitrage
   card with the package background.)*

2. **Pin → planning.** Click the pin button on an available package; capture its
   `<id>`. A `#card-pp:<id>` appears (pinned, no attractivity bubble, primary
   border), the available `#card-pkg:<id>` disappears, and it has a
   `Confirm Buy` button. `localStorage["eve-multitool.pinnedPackages.v1"]` now
   contains it with `status:"planning"`.

3. **Confirm Buy → transit (one click, NO dialog).** Click `Confirm Buy`. **No
   modal should open.** The card flips: Buy row now reads "In ship", and the
   buttons become `Confirm Sell` + `Sell Elsewhere`. Stored status `"transit"`.

4. **Sell Elsewhere.** Click `Sell Elsewhere` → the "Sell this package — where?"
   dialog opens with one or more cards each having `Redirect Here`. Click one →
   dialog closes and the pinned card's `Sell` endpoint changes to the chosen dest
   (and profit/baseline reset). Close instead via the CloseIcon also works.

5. **Confirm Sell → executed.** Click `Confirm Sell` → the card shows a disabled
   `Executed` button. Stored status `"executed"`.

6. **Persistence across reload.** Reload the page; pinned packages (any status)
   re-render from localStorage with the same status.

7. **(Optional) Live status reaction.** Mutate a destination buy order for one of
   a transit package's content types and refresh, expecting an up/down/zero arrow
   + border change (see Appendix A for how to drive it).

**Pass criteria:** cases 1–6 all hold; no console errors; the package card is
visually consistent with the arbitrage card.

---

## Appendix A — driving status changes (live)

The pinned-status comparison is exercised by changing the destination demand for a
content type, then refreshing. Use the existing market test seam:
```js
// drop the buy price for typeId at the dest station → income down/zero
await fetch('http://localhost:4000/api/test/mutate-market', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ typeId: <contentTypeId>, action:'change_buy_price', stationId:<destStationId>, price: 1 })
});
await page.evaluate(() => window.triggerHaulingRefresh());
// expect ArrowDownwardIcon / error border on the pinned-package card
// 'remove_buys' for that station → buyerGone (zero income, error border)
```
Get `<contentTypeId>` from the package's `contents[].typeId` and `<destStationId>`
from `dest.locationId` in the `/api/hauling` response.

---

## Appendix B — deterministic offline seam (recommended for CI)

To make packages testable like arbitrage (OFFLINE, repeatable, no ESI), add a test
injection endpoint that seeds the package cache directly. This avoids the live
crawl entirely. Two server changes:

1. In `server/packages.ts`, export a test-only seeder, e.g.:
   ```ts
   export function __seedTestPackages(contracts: { contract: PublicContract; lines: PackageLine[] }[]): void {
     meta.clear(); contents.clear();
     for (const { contract, lines } of contracts) {
       meta.set(contract.contract_id, contract);
       contents.set(contract.contract_id, lines);
     }
     contentsVersion++;
   }
   ```
2. In `server/index.ts`, add `POST /api/test/mutate-packages` (guarded the same way
   the other `/api/test/*` routes are) that parses a body of contracts+lines and
   calls `__seedTestPackages`, then returns `{ok:true}`.

Then the e2e runner (which already loads a deterministic market snapshot in OFFLINE)
can seed a package whose content types exist in that snapshot, mutate the snapshot
to force profit up/down, and assert the card behaviour deterministically — mirroring
the arbitrage tests in `web/test_e2e_runner.js`.

*(Ask the maintainer before adding this — it's a test-only surface. The author can
wire it on request.)*

---

# Part 2 — Cargo knapsack ("buy whole, load what fits, leave the rest")

This covers the newer behaviour: cargo capacity no longer **hides** a bundle — you
buy the whole thing (paying the full price), then carry only the subset that fits
your hold (highest ISK-per-m³ first) and abandon the rest in station, valued at
nominal market price. Use the **deterministic seam** (Appendix B / `/api/test/mutate-packages`).

### Setup notes specific to these tests

- **Setting cargo capacity:** there is **no `window` hook** for it. Set it through
  the UI — fill the **"Cargo capacity"** number field (it commits on blur and
  triggers a `/api/hauling` refetch):
  ```js
  const cargoField = page.getByLabel('Cargo capacity');
  await cargoField.fill('800');
  await cargoField.blur();
  await page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  ```
  Clear it (empty) to mean "unlimited".
- **Don't assert exact ISK for market value.** Left-behind value uses each type's
  CCP reference price (`marketPrice`), fetched live even in OFFLINE — not
  controllable. Read the actual numbers from the `/api/hauling` response (each
  package item's `contents[]` carries `unitVolume`, `marketPrice`, `soldQuantity`,
  `leftQuantity`, `leftMarketValue`, plus item-level `hauledVolume`/`leftMarketValue`/
  `limited`) and assert **relationships**, not constants.
- **Pick real typeIds + read their `unitVolume`** from a prior `/api/hauling`
  response so you can size cargo precisely (cargo = `unitsYouWantToFit × unitVolume`).

### New selectors (on top of Part 0)

- Carried line on the card: text matches `/of \d+ units/` when limited, else
  `/\d+ units · .* carried/`.
- "Worth left at station" stat: text `Worth left at station` (only rendered when
  something is left behind).
- Open the contents breakdown: the **SegmentIcon icon-button** (Tooltip "View
  package contents breakdown") → opens the `BreakdownModal`.
- Breakdown separator row: text `Items below won't fit in the ship — left at the station`.

### Test cases

**21A — Cargo no longer hides a bundle.**
Seed a bundle whose total volume is far larger than a tiny cargo but whose price is
affordable (e.g. one cheap, low-volume, high-demand item is enough to clear the 100k
realized floor). Set **Cargo capacity = a small number**. **Assert the
`#card-pkg:<id>` still renders** (pre-rework it would have been hidden).

**21B — Knapsack loads high ISK/m³ first; filler is left.**
Seed one contract with **two lines**:
- Item A: small `unitVolume`, high destination value (boost its dest buy price via
  `/api/test/mutate-market change_buy_price`).
- Item B: large `unitVolume`, little/no destination demand (`remove_buys` or a tiny
  price), but a non-zero `marketPrice`.
Set cargo small enough to fit A but not B. Assert from the API item: `soldQuantity>0`
for A, `soldQuantity===0` & `leftQuantity>0` for B, `leftMarketValue>0`, `limited===true`.
On the card: **"Worth left at station"** is visible. Open the breakdown → A appears
**above** the separator, B **below** it.

**21C — A type straddles the cargo line.**
Seed one line, `quantity = 1000`, of a type with known `unitVolume` (read it from a
prior response). Set **cargo = 800 × unitVolume**. Refetch. Assert the card shows
`/800 of 1000 units/` (or your computed split), and in the breakdown the **same item
name appears both above** (hauled 800) **and below** (left 200) the separator.

**21D — Realized-profit floor drops a bundle nothing valuable fits.**
Using the 21B contract, set **cargo below A's `unitVolume`** (so only filler "fits",
realized ≈ 0). Refetch. Assert `#card-pkg:<id>` **disappears** (realized profit < 100k
floor). Restore cargo → it returns.

**21E — Transit freezes the loaded subset.**
With a limited bundle (21C-style, partially fitting): pin → **Confirm Buy** (transit).
Note the carried "X of Y units" on the pinned `#card-pp:<id>`. Now
`change_buy_price` **down** at the dest and refetch a couple of times. **Assert the
carried unit count does NOT change** (the load is frozen) while the profit headline /
border react (down/zero). Then **Sell Elsewhere** → the modal lists destinations for
the **carried subset**; Redirect updates the dest without changing the carried units.

**21F — Bulky item is kept; the cheapest small item is dropped (income-maximizing,
not greedy).**
*Regression for the "bundle disappears when I shrink cargo" bug.* The fit maximizes
destination income, so a big-volume / high-TOTAL-value unit (a ship) must be kept by
dropping cheaper small items — NOT crowded out by small high-ISK/m³ modules.
Seed one contract with:
- **Bulky item** — 1 unit, large `unitVolume` (e.g. a ship ~10 000 m³), with a high
  destination value (boost its dest buy price via `change_buy_price`). Alone it's
  most of the bundle's worth.
- **Several small items** — tiny `unitVolume` (e.g. 10 m³), with **distinct** dest
  values so their ISK/m³ ordering is known (some far higher ISK/m³ than the ship).
Set `price` so the bundle is only profitable if the ship is hauled.
Steps & asserts (read `/api/hauling` `contents[]`):
1. Cargo = full bundle volume → all fit, `limited===false`, note profit.
2. Cargo = full − (one small item's volume): the **card still renders** (it must NOT
   vanish), `limited===true`, the ship line has `soldQuantity===1` (kept), and the
   **single left line is the lowest-dest-value small item** (`leftQuantity>0`), while
   the higher-value smalls are still hauled. Realized profit stays above the 100k floor.
3. Shrink cargo by one more small item's volume → it sheds the **next-cheapest** small
   item, ship still kept, card still present.
Before the fix this dropped the *ship* and the card disappeared — so the key assertion
is **card present + ship hauled + cheapest small left**.

> Scope note: the optimizer is exact for normal bundles (a handful of types, at most a
> few bulky items). For a pathological bundle with **5+ distinct bulky types** it may
> fall back to greedy (a bounded safety valve), so don't assert strict optimality there.

**Pass criteria:** 21A–21F hold; the API `contents[]` math is self-consistent
(`soldQuantity + leftQuantity === quantity` per line; `Σ soldQuantity·unitVolume ===
hauledVolume`); no console errors.

> Tip for 21B/21C seeding: give the seeded `contract.volume` a value consistent with
> `Σ line.quantity × unitVolume` so the card's totals read sensibly, though the
> knapsack itself uses per-line `unitVolume` from the SDE, not `contract.volume`.

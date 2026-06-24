# Pinning Functionality Deep Smoke Test Report

This report outlines the deep smoke testing performed on the **Pinning Functionality**, including stage transitions (Planning → Transit → Executed) and reaction to market updates (stale, shortfall, unavailable cards, negative margins, and price changes). 

To ensure deterministic testing, a test runner was written in [smokeTestPinning.ts](file:///c:/repos/eve-multitool/server/smokeTestPinning.ts) to mock the market snapshot in-memory and isolate the `/api/arbitrage/status` endpoint logic, as well as test the frontend Jotai state-flow integration. 

Furthermore, to test the **actual web app** and its REST API endpoints, a live HTTP-based integration test was created in [smokeTestPinningApi.ts](file:///c:/repos/eve-multitool/server/smokeTestPinningApi.ts). This script runs real HTTP requests against the live, running Express server at `http://localhost:4000`.

---

## Use Cases Tested (Internal Logic & State Lifecycle)

The internal test suite ([smokeTestPinning.ts](file:///c:/repos/eve-multitool/server/smokeTestPinning.ts)) covers **17 distinct test cases** spanning both the backend status resolution logic and the frontend Jotai state lifecycle:

| # | Stage | Market Scenario | Expected API/State Behavior | Result |
|---|---|---|---|---|
| **1** | `planning` | Baseline (No market changes) | Returns `stale: false`, `shortfall: false`, `buyerGone: false`, `supplyGone: false`, full planned quantity and correct profit. | **PASSED** |
| **2** | `planning` | Source order IDs changed (price/order replacement) | Returns `stale: true`. | **PASSED** |
| **3** | `planning` | Source volume reduced | Returns `shortfall: true`, updated `quantity` matching available sells, and adjusted `profit`. | **PASSED** |
| **4** | `planning` | Source orders completely gone | Returns `supplyGone: true`, `quantity: 0`, and `profit: 0`. | **PASSED** |
| **5** | `planning` | Destination bids completely gone | Returns `buyerGone: true`, `quantity: 0`, and `profit: 0`. | **PASSED** |
| **6** | `transit` | Baseline (No changes at destination) | Returns `stale: false`, `shortfall: false`, `buyerGone: false`, quantity matching `boughtQuantity`, and correct profit. | **PASSED** |
| **7** | `transit` | Destination volume reduced | Returns `shortfall: true`, live `quantity` matching available bids, and adjusted `profit`. | **PASSED** |
| **8** | `transit` | Destination orders changed | Returns `stale: true`. | **PASSED** |
| **9** | `transit` | Confirmed quantity is lower than planned, market unchanged | Returns `stale: true` (due to order set size difference). | **PASSED** |
| **10** | `planning` | Unprofitable bid margin (net buy price > net sell price) | Returns `quantity: 0`, `profit: 0`, `supplyGone: false`, `buyerGone: false`. | **PASSED** |
| **11** | `planning` | Mixed order depth (partially profitable) | Returns `quantity` capped at the profitable threshold (e.g. 50 out of 100) and `shortfall: true`. | **PASSED** |
| **12** | `transit` | Negative profit (net loss) due to overpaying or price collapse | Returns `quantity: 100`, `profit: -327` (correctly calculates negative profit). | **PASSED** |
| **13** | `transit` | Discount buy price (greater profit) | Returns `quantity: 100`, `profit: 464` (reflects higher profit from cheaper purchase). | **PASSED** |
| **14** | `transit` | Destination market crash (buyerGone) | Returns `quantity: 0`, `buyerGone: true`, `profit: 0`. | **PASSED** |
| **15** | `transit` | Shortfall profit calculation anomaly | Returns `quantity: 70` (shortfall), and calculates `profit` using only the sold units, ignoring the sunk cost of the 30 unsold units. | **PASSED** |
| **16** | `integration` | **Jotai State Lifecycle Integration** | Successfully verifies state flow: pin card → planning sync → confirm buy (custom price/qty) → transit sync (advisory live updates, locked baseline display) → execute. | **PASSED** |
| **17** | `netting` | **Transit Priority Inversion** | Checks that a draft `planning` card pinned *before* an active `transit` card (real cargo in flight) will incorrectly consume destination bid depth first, leaving the transit card with a false shortfall. | **PASSED** |

---

## Live HTTP API Verification

The HTTP integration test suite ([smokeTestPinningApi.ts](file:///c:/repos/eve-multitool/server/smokeTestPinningApi.ts)) runs directly against the running web application backend. It dynamically mutates the local server market state via `/api/test/mutate-market` and asserts the responses returned from `/api/arbitrage/status`:

* **HTTP Case 1**: Baseline planning status check ➔ **PASSED**
* **HTTP Case 2**: Live staleness check when order IDs change ➔ **PASSED** (After Bug Fix)
* **HTTP Case 3**: Live shortfall planning check ➔ **PASSED**
* **HTTP Case 4**: Live transit shortfall check ➔ **PASSED**

---

## Detailed Findings & Critical Bugs (Sorted by Severity)

The expanded testing and HTTP-level verification revealed several major bugs and design anomalies in the pinning and status resolution logic, organized below by severity:

### Severity 1: Critical (Direct Financial/Execution Impact)

#### 1. Shortfall Profit Calculation Anomaly (Sunk Cost Ignoring) in Transit
* **Description**: During a destination shortfall in the `transit` stage (Test 15), the user has already bought the full confirmed quantity (e.g., 100 units at 5.0 ISK, total investment = 500 ISK). If the destination market volume drops and only 70 units can be sold (at 8.0 ISK), the server calculates the buy cost as `quantity * boughtPrice` (i.e. `70 * 5.0 = 350` ISK) instead of using the actual confirmed purchase cost (`100 * 5.0 = 500` ISK).
* **Formula**: `profit = liveQuantity * liveSellPrice * (1 - tax) - liveQuantity * boughtPrice`
* **Impact**: The server reports a profit of **184.8 ISK** (70 units sold), whereas the user's actual profit is **34.8 ISK** (since they are left holding 30 unsold units they paid 150 ISK for). This hides a significant loss and displays misleadingly positive economics.
* **Suggested Fix**: The server should calculate the `buyCost` for transit hauls using the requested `quantity` (representing the user's total confirmed bought quantity) rather than the subset of units that can currently be sold:
  ```diff
  - buyCost = quantity * boughtPrice;
  + buyCost = target * boughtPrice;
  ```

#### 2. Ignoring Buy Order `min_volume` Restrictions (Silent Execution Failure)
* **Description**: EVE Online buy orders can have a `min_volume` requirement (e.g., the buyer will only accept your cargo if you sell them at least 100 units at once). Currently, the server's market crawler and solver completely discard the `min_volume` field from ESI orders. 
* **Impact**: If a high-paying buy order requires a minimum of 100 units, and the player pins a haul for 40 units, the solver will successfully match them and report a high profit. In-game, however, the transaction will fail silently because the player does not meet the minimum volume threshold.
* **Suggested Fix**: Update `RawOrder` and `Order` interfaces to parse and store `min_volume`, and adjust `resolvePinnedHaulsStatus` and `buildArbitrageCandidates` to skip buy orders whose `min_volume` exceeds the hauled quantity.

#### 3. Transit Priority Inversion in Shared Depth Netting
* **Description**: When netting shared market depth across multiple pinned hauls of the same item, the server walks them in simple *pin order*. If a draft `planning` haul happens to be pinned before an active `transit` haul, the draft haul will consume the best destination bids first. This forces the active transit haul (which represents real cargo in space) to evaluate against lower bids, incorrectly flagging it as degraded or having a shortfall.
* **Impact**: Active transit hauls are shown as having a shortfall/degraded status, when in reality they should have absolute priority over drafts that have not yet been purchased.
* **Suggested Fix**: Before iterating over the pinned hauls in `resolvePinnedHaulsStatus`, sort the requests array such that any haul with `status === 'transit'` is evaluated **before** any haul with `status === 'planning'`.

---

### Severity 2: High (Incorrect Calculations & Broken Warnings)

#### 4. Hardcoded Tax Rate Discrepancy
* **Description**: The `/api/arbitrage/status` endpoint hardcodes the sales tax to 4.5% (`const tax = DEFAULT_SALES_TAX`). However, the main hauling discovery list uses the user's custom tax percentage from preferences (e.g. 3.6% for trained players). 
* **Impact**: Pinning a haul causes its profit calculation to shift when updated by the server, because the pinned status resolver does not respect the user's custom tax rate.
* **Suggested Fix**: Update `/api/arbitrage/status` to accept a `taxPct` parameter (or include `taxPct` on each pinned haul object) and use it during resolving.

#### 5. [RESOLVED] Server API Discarding Staleness Tracking Arrays
* **Description**: While the internal solver in `resolvePinnedHaulsStatus` correctly compared order IDs, the HTTP request parser `parsePinnedHaulsRequest` in [index.ts](file:///c:/repos/eve-multitool/server/index.ts) was completely discarding the `knownSourceOrderIds` and `knownDestOrderIds` arrays from the incoming POST body. As a result, the server always evaluated them as `undefined`, rendering the "Orders Changed" (stale) warning completely broken on the live web application.
* **Fix**: Updated `parsePinnedHaulsRequest` to parse the arrays from the request object and forward them to the solver:
  ```typescript
  const knownSourceOrderIds = Array.isArray(e.knownSourceOrderIds)
    ? e.knownSourceOrderIds.map(Number).filter(Number.isFinite)
    : undefined;
  const knownDestOrderIds = Array.isArray(e.knownDestOrderIds)
    ? e.knownDestOrderIds.map(Number).filter(Number.isFinite)
    : undefined;
  ```
* **Status**: **RESOLVED and Verified** via [smokeTestPinningApi.ts](file:///c:/repos/eve-multitool/server/smokeTestPinningApi.ts).

#### 6. False-Positive "Orders Changed" (Stale) Warning in Transit
* **Description**: If a user plans a haul of 200 units and then buys a smaller quantity (e.g., 50 units) during "Confirm Buy", they transition to `transit` with a target quantity of 50. During the next status sync, the server resolves the status for 50 units, returning `destOrderIds: [201]`. The client compares this to the planning-era `knownDestOrderIds: [201, 202]`. Since the arrays differ, it flags `stale: true`.
* **Impact**: The UI card immediately turns orange and displays the warning **"Orders Changed!"** even if the destination market is completely static, purely because the user chose to buy less.
* **Suggested Fix**: When transitioning a card to `transit` via `confirmBuyHaulAtom`, the frontend should clear or update the `knownSourceOrderIds`/`knownDestOrderIds` to reflect only the orders that are actually needed for the confirmed quantity.

---

### Severity 3: Low (UX Polish & Conservative Limits)

#### 7. Misleading Warning Message for Transit Cards
* **Description**: If a transit card's destination orders change, the card displays:
  > **Orders Changed**
  > The specific orders backing this haul changed — re-check before committing.
* **Impact**: Suggesting the user "re-check before committing" is misleading once they are already in transit (since they have already committed by purchasing the cargo).
* **Suggested Fix**: Update `ArbitrageCard.tsx` to show a transit-appropriate message when the status is `'transit'`.

#### 8. Conservative Jump-Range Buy Orders (System-Bound Ignorance)
* **Description**: The range-pooling logic for buy orders (`bidReaches` in `server/arbitrage.ts`) treats jump-range buy orders (range > 0) as if they are system-restricted, ignoring their actual stargate jump reach to neighboring systems.
* **Impact**: Under-reports available buyer depth for range orders.

---

## Additional Edge Case Scenarios & UI/UX Design Limitations

Beyond the core bugs, several UI/UX limitations and technical edge cases were discovered:

### 9. Untracked Secured Delivery Deadlines for Courier Contracts
* **Scenario**: When a user clicks **"Confirm Accept"** on a pinned courier contract, the status changes to `'secured'`. The contract has a delivery deadline (e.g., 3 days).
* **Limitation**: The frontend Jotai store transitions the status but does not record the `securedAt` timestamp. As a result, the UI is unable to calculate the remaining delivery time and cannot alert the user if they are close to failing the contract or have run out of time.

### 10. Lack of Portfolio/Aggregate Wallet Limit Warnings
* **Scenario**: Planning hauls and courier contracts require a large ISK investment (purchase costs and collateral).
* **Limitation**: Pinned items are evaluated in isolation. If a user pins 5 planning hauls that each cost 100M ISK, the UI shows them as green/healthy even if the user only has 150M ISK in their wallet, lacking an aggregate warning that the active portfolio exceeds their wallet capacity.

### 11. Duplicate Sync Polling Across Multiple Tabs
* **Scenario**: Pinned state is stored in `localStorage` via Jotai, which syncs across tabs.
* **Limitation**: When multiple tabs are open, each tab runs its own background interval every 15 seconds. This causes fanned-out redundant HTTP requests to `/api/arbitrage/status` (5 tabs = 5 parallel status requests every 15 seconds), which could be optimized using Tab-leader coordination.

### 12. Silent Sync Failure on API Downtime
* **Scenario**: The frontend polls `/api/arbitrage/status` every 15 seconds. If the backend server crashes or returns a 500 error, the fetch catch block logs to the console but does not alert the user.
* **Limitation**: Pinned cards will silently stop updating, displaying stale prices and warnings without a connection warning.

### 13. Citadel Docking Access Lockout (Unresolvable ESI Limitation)
* **Scenario**: Arbitrage and contracts often route to player-owned structures (Upwell Citadels).
* **Limitation**: If a citadel owner changes the docking access list to ban the player, the orders are still publicly returned by ESI and shown in the app, but the player will be locked out and unable to complete the haul. This is an unresolvable ESI limitation but a major risk factor for traders.

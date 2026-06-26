# Pinning Functionality & Architecture

The pinning functionality allows players to save and track profitable arbitrage hauls across three stages of their delivery lifecycle. It re-evaluates routes, pricing depth, and expected profit in real-time as market conditions change.

## 1. Lifecycle Stages

1. **Planning Stage**: 
   - Player needs to purchase items at the source.
   - Pinned cards are dynamically re-optimized to the max-income quantity that fits the player's current cargo capacity (`capacity` m³) and wallet balance (`balance` ISK).
   - Expected profit is recalculated continuously.
   - The route display shows the complete journey: `Current System → Pickup Station → Dropoff Station`.
   - Re-optimization prevents quantity selection from dropping below profitability (income <= 0). If the deal becomes unprofitable, quantity drops to 0, which flags the card as zero-income.

2. **Transferring (Transit) Stage**:
   - Player has purchased a specific quantity at a specific price, and the items are now loaded into their ship.
   - The purchased quantity and purchase price are locked (fixed).
   - Expected profit is recalculated dynamically against live destination buy orders using the fixed purchase price and quantity. Profit can become negative if destination demand drops.
   - The route display updates to show: `Current System → Dropoff Station` (omitting the pickup leg since the items are already in the ship).
   - In this stage, players can also view alternative liquidation markets and redirect the haul, establishing a new baseline.

3. **Done Stage**:
   - Items were successfully delivered and sold in the game. Card is marked as executed.

---

## 2. Architecture & Data Flow

Our architecture follows a thin-client, thick-server design to prevent client-side synchronization and calculation bugs:

```mermaid
sequenceDiagram
    participant FE as Web Client (Jotai Store)
    participant BE as Server (Express Endpoint)
    participant ESI as EVE Swagger Interface (Live Book)

    FE->>BE: POST /api/hauling { hauls: PinnedHaulStatusRequest[] }
    BE->>ESI: Fetch Live Market snapshot & system kills
    BE->>BE: resolvePinnedHaulsStatus()
    Note over BE: 1. Optimize or fixed walk on live orders<br/>2. Resolve dynamic route (safe/short)<br/>3. Compute metrics (jumps, danger)<br/>4. Compare vs baseline (up/down/zero)
    BE->>FE: Return { pinnedStatuses: PinnedHaulStatusResponse[] }
    FE->>FE: Merge statuses directly into Jotai atoms
    Note over FE: Render Card (ArbitrageCard) using pre-calculated values
```

### Front-End (Jotai Store & UI)
- **Local Storage State**: The front-end holds the collection of pinned items in `pinnedHaulsAtom` via local storage. It only maintains the structural metadata (`id`, `typeId`, endpoints, stage status) and baseline values (`originalProfit`, confirmed `boughtQuantity`, confirmed `boughtPrice`).
- **Reactive Refresh Trigger**: User mutations (pinning, unpinning, confirming buy, redirecting) increment a `haulingRefreshTriggerAtom`. The controller hook (`useHaulingSearchController`) listens to this trigger and immediately runs a silent background refresh to update card data instantly.
- **Dumb Rendering**: The `ArbitrageCard` component performs no custom route mapping, visual comparison arithmetic, or coloring logic. It reads pre-calculated properties (`borderColor`, `statusKind`, `statusMessage`, and routes/jumps) from the synced Jotai store and renders them directly.

### Back-End (Server Services)
- **Status Resolver (`resolvePinnedHaulsStatus`)**: Re-prices pinned items against the live order book snapshot, taking care to **net shared order depth** (running them sequentially so multiple pinned hauls don't claim the same orders).
- **Dynamic Routing**: Resolves the exact system-to-system jump paths and danger camps using the player's active position (`origin`) and chosen routing settings (`safest` vs `shortest`).
- **Baseline Comparison**: Compares the live expected profit against the baseline (`originalProfit`). It outputs visual metadata (`borderColor` and `statusMessage`) indicating if profit is up (green), down (orange), or collapsed to zero/negative (red).

---

## 3. Comparison with Original Solution

We refactored the pinning system to solve reliability issues, client-server desyncs, and complex UI logic:

| Feature / Aspect | Original Solution | Refactored Solution (Current) |
| :--- | :--- | :--- |
| **Calculation Location** | FE calculated indicators, routes, jumps, and compared live profit vs baseline. | Server performs all route resolutions, metrics, baseline comparisons, and formatting. |
| **Route Sync** | FE fetched routes asynchronously via separate `/api/route` queries for transit cards, while planning card routes stayed stale. | Server calculates exact routes dynamically for all cards during the combined `/api/hauling` call. |
| **UI Jitter & Desyncs** | Newly pinned or updated cards displayed stale/default states for up to 10s until the periodic poll completed. | Jotai refresh trigger forces an immediate silent background check, updating cards instantly. |
| **Transit Card Profit** | Transit cards failed to sync live profits, showing only stale original estimations. | Transit cards correctly display live expected profits based on destination bids and fixed buy costs. |
| **Card Border Colors** | FE computed border colors from raw values, leading to mismatches (e.g. blue borders when profit collapsed). | Server returns the authoritative color class (`success.main`, `error.main`, etc.) which the FE renders directly. |
| **State Complexity** | FE tracked advisory properties (`liveProfit`, `liveQuantity`, etc.) separately from display values. | FE merges all server-computed display values directly onto the card model, eliminating duplicate properties. |

---

## 4. Key Implementation Notes

- **Jitter Prevention**: The back-end compares live income against the baseline with a ±3% threshold band (`PROFIT_BAND = 0.03`). Jitter within this band does not trigger arrow direction changes, preventing UI flicker.
- **Unprofitable Planning**: The re-optimization walk in the planning stage stops as soon as the marginal unit profit becomes negative, preventing cards from displaying negative profits during planning.
- **Negative Transit Profit**: Transit cards do not abort at negative profit boundaries because the items are already in the ship. They show the actual realized loss if market prices drop below the purchase price.
# Pinning & Transit E2E Playwright Test Report

This report documents the E2E verification of the EVE Multitool's updated Pinning and Transit functionality. The tests were run in a real browser (Headless Chromium via Playwright) against a local offline backend and mock frontend, using the `fixtures/market-snapshot.json` snapshot data.

All tests executed successfully, confirming the robustness and reliability of the back-end driven architecture.

---

## 1. Test Environment Setup
- **Backend**: Spun up on port `4000` with the `OFFLINE=true` environment flag. This mocks the ESI network responses using the local market snapshot and skips network-based kills checks.
- **Frontend**: Served via Vite on port `5173`.
- **Location Override**: Client-side state was programmatically set to Jita (`30000142`) and the wallet balance to `1,000,000,000 ISK` using test hooks exposed in the browser console.
- **Target Item**: The first opportunity loaded was **Heavy Water** (typeId: `16272`) from `60003760` (Jita station) to `60004588` (destination), with an original expected profit of **128.41 M ISK**.

---

## 2. Test Cases & Verification Results

The E2E runner automated the browser through the complete pinning lifecycle and verified the correct application of visual styles and state transitions:

| Scenario | Steps / Action Taken | Expected UI Behavior | Actual Outcome | Status |
| :--- | :--- | :--- | :--- | :---: |
| **1. Initial Pinning** | Pin the target Heavy Water card | Card clones instantly to the Pinned section; default blue border (`rgb(77, 208, 225)`) | Card pinned; border color verified | **PASSED** |
| **2. Planning: Price Up** | Mutate destination buy price by `+50%` (from `135 ISK` to `202.5 ISK`) | Card border turns green (`rgb(102, 187, 106)`); shows up arrow icon | Green border & `ArrowUpwardIcon` verified | **PASSED** |
| **3. Planning: Price Down** | Mutate destination buy price by `-8%` (from `135 ISK` to `124.2 ISK`) | Card border turns orange (`rgb(255, 167, 38)`); shows down arrow icon | Orange border & `ArrowDownwardIcon` verified | **PASSED** |
| **4. Planning: Collapse** | Remove all buy orders at destination | Card border turns red (`rgb(244, 67, 54)`); profit displays `0.00 ISK` | Red border & 0.00 ISK verified | **PASSED** |
| **5. Transition: Confirm Buy** | Click **Confirm Buy**, enter custom quantity (50%) & custom price (90%) | Card switches to Transit view; buttons change to "Confirm Sell" / "Sell Elsewhere"; route is shortened (starts "In ship") | Transit view layout, buttons, and "In ship" route verified | **PASSED** |
| **6. Transit: Profit Down** | Mutate destination buy price by `-10%` | Transit card border turns orange (`rgb(255, 167, 38)`) | Orange border verified | **PASSED** |
| **7. Transit: Net Loss** | Mutate destination buy price by `-90%` (down to `10.1 ISK`) | Transit card border turns red (`rgb(244, 67, 54)`); expected profit shows negative/zero | Red border & negative profit verified | **PASSED** |
| **8. Redirect** | Click **Sell Elsewhere**, select first of 24 alternative systems, click **Redirect Here** | Card's destination system is updated; route and profit recalculate using new destination as new baseline | Destination updated; route recalculated dynamically | **PASSED** |
| **9. Local Storage Persistence** | Reload the browser page while the card is in the Transit stage | Pinned transit card persists with its custom quantities, prices, and redirected destination | Transit card status and custom redirect destination successfully persist | **PASSED** |
| **10. Executed Stage** | Click **Confirm Sell** on the transit card | Card transitions to Executed state and shows a disabled green "Executed" button | "Executed" button verified | **PASSED** |
| **11. Settings: Cargo Hold** | Reset market, pin fresh planning card, change cargo capacity to `5 m³` | Planning quantity dynamically scales down to fit capacity | Quantity re-optimized from `7.9M` to `12` units | **PASSED** |
| **12. Route Settings Swap** | Toggle setting from "Safest" to "Shortest" | Frontend fires network request with `routeType=shortest`; route jump counts recalculate | Network request with `routeType=shortest` captured; UI updated | **PASSED** |
| **13. Location Updates** | Change location from Jita (`30000142`) to New Caldari (`30000144`) | Frontend fires network request with `origin=30000144`; approach jumps recalculate to non-zero | Network request with `origin=30000144` captured; approach jumps updated to `1 + 24 jumps` | **PASSED** |
| **14. Wallet Constraints** | Reduce mock wallet balance from `1B` to `10M ISK` | Suggested purchase quantity scales down to stay within buying power | Suggested quantity scaled down from `7,930,365` to `89,285` units | **PASSED** |
| **15. Sales Tax Adaptation** | Update sales tax percentage preference to `8.5%` | Frontend fires network request with `taxPct=8.5`; expected profit adjusts to new tax rate | Network request with `taxPct=8.5` captured | **PASSED** |
| **16. Attractivity Weights** | Select the "Max ISK / hour" weights preset | Frontend fires network request with `wIncome=8`, `wJumps=8`, `wDanger=2` | Network request with new weights captured; opportunities list reorders | **PASSED** |

---

## 3. Visual Styling Code Mapping

To ensure correct rendering, the test runner checked the computed styles (border colors) of the card element:
- **Default Blue**: `rgb(77, 208, 225)` (maps to theme's `primary.main` in dark mode)
- **Success (Green)**: `rgb(102, 187, 106)` (maps to theme's `success.main` in dark mode)
- **Warning (Orange)**: `rgb(255, 167, 38)` (maps to theme's `warning.main` in dark mode)
- **Error (Red)**: `rgb(244, 67, 54)` (maps to theme's `error.main` in dark mode)

---

## 4. Test Files and Code Artifacts (For Future Clean-up)

As requested, the E2E tests and mocks can be deleted later. Below are the files and modifications you can safely remove to clean up the codebase:

1. **Test Runner File**:
   - `web/test_e2e_runner.js` (Standalone Node/Playwright test runner)
2. **Backend Mock Mutation Handler**:
   - In `server/index.ts`: The `/api/test/mutate-market` POST route handler.
3. **Frontend Window Exports**:
   - In `web/src/features/courierContracts/useHaulingSearchController.ts`: `window.triggerHaulingRefresh` and `window.setTestSalesTax` exports.
   - In `web/src/main.tsx` (or bootstrap file): `window.setTestLocation` and `window.setTestWalletBalance` exports.

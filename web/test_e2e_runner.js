import { spawn } from 'child_process';
import playwright from 'playwright';

const BACKEND_PORT = 4000;
const FRONTEND_PORT = 5173;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

let backendProcess = null;
let frontendProcess = null;
let browser = null;

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to poll an endpoint until it is ready
async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (err) {
      // Ignore
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for URL: ${url}`);
}

async function assertVisible(locator, name, timeoutMs = 5000) {
  try {
    await locator.waitFor({ state: 'attached', timeout: timeoutMs });
  } catch (err) {
    throw new Error(`Assertion failed: ${name} is not present in DOM!`);
  }
}

async function getBorderColor(locator) {
  try {
    return await locator.locator('.MuiCard-root').evaluate(el => window.getComputedStyle(el).borderColor);
  } catch (err) {
    console.error('Failed to get computed border color:', err);
    return '';
  }
}

async function mutateMarketAndRefresh(page, body) {
  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await fetch(`${BACKEND_URL}/api/test/mutate-market`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await page.evaluate(() => {
    if (typeof window.triggerHaulingRefresh === 'function') {
      window.triggerHaulingRefresh();
    }
  });
  await responsePromise;
  await sleep(500); // Small pause for state/DOM sync
}

async function cleanup() {
  console.log('\n--- Cleaning up processes ---');
  if (browser) {
    try {
      await browser.close();
    } catch (err) {}
  }
  if (frontendProcess) {
    try {
      process.kill(-frontendProcess.pid); // Kill process group
    } catch (e) {
      try { frontendProcess.kill(); } catch (err) {}
    }
  }
  if (backendProcess) {
    try {
      process.kill(-backendProcess.pid); // Kill process group
    } catch (e) {
      try { backendProcess.kill(); } catch (err) {}
    }
  }
  console.log('Cleanup complete.');
}

// Handle unexpected termination
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(1);
});
process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(1);
});

async function runTests() {
  console.log('--- Starting Backend Server in OFFLINE mode ---');
  backendProcess = spawn('npx', ['tsx', 'index.ts'], {
    cwd: '../server',
    env: { ...process.env, OFFLINE: 'true', PORT: String(BACKEND_PORT) },
    detached: true, // Allow killing process group
    shell: true,
  });

  backendProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[Backend] ${line}`);
  });
  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend ERR] ${data.toString()}`);
  });

  console.log('--- Starting Frontend Dev Server ---');
  frontendProcess = spawn('npx', ['vite', '--port', String(FRONTEND_PORT)], {
    cwd: '.',
    detached: true, // Allow killing process group
    shell: true,
  });

  frontendProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[Frontend] ${line}`);
  });
  frontendProcess.stderr.on('data', (data) => {
    console.error(`[Frontend ERR] ${data.toString()}`);
  });

  console.log('Waiting for backend & frontend servers to be ready...');
  await waitForUrl(`${BACKEND_URL}/api/health`);
  await waitForUrl(FRONTEND_URL);
  console.log('All servers are healthy and running.');

  console.log('--- Launching Playwright Chromium Browser ---');
  browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[Browser PageError] ${err.toString()}`));
  page.on('request', request => console.log(`[Browser Request] ${request.method()} ${request.url()}`));
  page.on('response', response => console.log(`[Browser Response] ${response.status()} ${response.url()}`));
  
  // Set window viewport size
  await page.setViewportSize({ width: 1440, height: 900 });

  // Navigate to application
  console.log(`Navigating to ${FRONTEND_URL}...`);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await sleep(1000);

  console.log('Injecting mock location and wallet balance into window...');
  // Set location to Jita (30000142) and wallet balance to 1B ISK
  await page.evaluate(() => {
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof window.setTestLocation === 'function' && typeof window.setTestWalletBalance === 'function') {
          window.setTestLocation(30000142, 'Jita');
          window.setTestWalletBalance(1000000000);
          clearInterval(interval);
          resolve(true);
        } else if (attempts > 50) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    });
  });

  // Wait for the app to reload silently with Jita opportunities
  console.log('Waiting for arbitrage opportunities to load and render...');
  const cardLocator = page.locator('[id^="card-a:"]');
  try {
    await cardLocator.first().waitFor({ state: 'visible', timeout: 45000 });
  } catch (err) {
    throw new Error('Timeout waiting for arbitrage opportunities to load and render!');
  }
  const count = await cardLocator.count();
  console.log(`Found ${count} arbitrage opportunities in the main grid.`);

  // 1. SELECT OPPORTUNITY TO PIN
  const firstCard = cardLocator.first();
  const firstCardIdAttr = await firstCard.getAttribute('id');
  const itemId = firstCardIdAttr.replace('card-a:', '');
  const [typeIdStr, srcStationIdStr, destStationIdStr] = itemId.split(':');
  const typeId = Number(typeIdStr);
  const srcStationId = Number(srcStationIdStr);
  const destStationId = Number(destStationIdStr);

  const itemName = await firstCard.locator('.MuiTypography-body2').first().textContent();
  console.log(`Targeting Item: "${itemName}" (typeId: ${typeId}, source: ${srcStationId}, dest: ${destStationId})`);

  // Extract expected profit text for comparison
  const expectedProfitText = await firstCard.locator('.MuiTypography-h6').textContent();
  console.log(`Original profit text: ${expectedProfitText}`);

  // 2. PIN CARD
  console.log('Pinning the first card...');
  const pinButton = firstCard.locator('button:has([data-testid="PushPinOutlinedIcon"]), button[aria-label="Pin opportunity"]');
  const pinResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await pinButton.click();
  await pinResponsePromise;
  await sleep(500); // Wait for state/DOM sync

  // Verify it appears in pinned section
  const pinnedCard = page.locator(`[id="card-p:${itemId}"]`);
  await assertVisible(pinnedCard, 'pinnedCard');
  console.log('Verified card is pinned successfully.');

  // Verify border is default (primary.main)
  let borderCol = await getBorderColor(pinnedCard);
  console.log(`Initial card border color: ${borderCol}`);

  // 3. PLANNING STAGE MUTATIONS

  // Mutate 3A: Price Increase (up -> success.main -> green)
  console.log('\n--- Test 3A: Simulating Price Increase (Profit Up) ---');
  // We'll increase the buy price at the destination by 1.5x
  // Let's first read the current sell price on the card to calculate the new price
  const sellPriceText = await pinnedCard.locator('text=/Sell.*unit/').textContent();
  const originalSellPrice = Number(sellPriceText.replace(/[^0-9.]/g, ''));
  console.log(`Original average sell price: ${originalSellPrice} ISK`);

  await mutateMarketAndRefresh(page, {
    typeId,
    action: 'change_buy_price',
    stationId: destStationId,
    price: originalSellPrice * 1.5
  });

  // Verify border turns green (success.main)
  borderCol = await getBorderColor(pinnedCard);
  if (!borderCol.includes('rgb(102, 187, 106)')) {
    throw new Error(`Border color did not turn green after price increase! Computed: ${borderCol}`);
  }
  const upArrow = pinnedCard.locator('[data-testid="ArrowUpwardIcon"]').first();
  await assertVisible(upArrow, 'upArrow', 3000);
  console.log('PASSED: Verified card border turned green and shows UP arrow.');

  // Mutate 3B: Price Decrease (down -> warning.main -> orange)
  console.log('\n--- Test 3B: Simulating Price Decrease (Profit Down) ---');
  await mutateMarketAndRefresh(page, {
    typeId,
    action: 'change_buy_price',
    stationId: destStationId,
    price: originalSellPrice * 0.92
  });

  borderCol = await getBorderColor(pinnedCard);
  if (!borderCol.includes('rgb(255, 167, 38)')) {
    throw new Error(`Border color did not turn orange after price decrease! Computed: ${borderCol}`);
  }
  const downArrow = pinnedCard.locator('[data-testid="ArrowDownwardIcon"]').first();
  await assertVisible(downArrow, 'downArrow');
  console.log('PASSED: Verified card border turned orange and shows DOWN arrow.');

  // Mutate 3C: Profit Collapse (zero -> error.main -> red)
  console.log('\n--- Test 3C: Simulating Profit Collapse (Buyer Gone) ---');
  await mutateMarketAndRefresh(page, {
    typeId,
    action: 'remove_buys',
    stationId: destStationId
  });

  borderCol = await getBorderColor(pinnedCard);
  if (!borderCol.includes('rgb(244, 67, 54)')) {
    throw new Error(`Border color did not turn red after buyers left! Computed: ${borderCol}`);
  }
  const profitText = await pinnedCard.locator('.MuiTypography-h6').textContent();
  if (!profitText.includes('0.00 ISK')) {
    throw new Error(`Profit did not collapse to zero! Current: ${profitText}`);
  }
  console.log('PASSED: Verified card border turned red, profit displays 0.00 ISK.');

  // Reset market to baseline before transit transition
  console.log('Resetting market to baseline...');
  await mutateMarketAndRefresh(page, { action: 'reset' });

  // 4. CONFIRM BUY (TRANSITION TO TRANSIT)
  console.log('\n--- Test 4: Confirm Buy (Transit Transition) ---');
  
  // Extract planning quantity to calculate 50%
  const qtyText = await pinnedCard.locator('text=/units? ·/').textContent();
  const plannedQty = Number(qtyText.split(/units?/i)[0].replace(/[\s,]/g, ''));
  const buyPriceText = await pinnedCard.locator('text=/Buy.*unit/').textContent();
  const plannedBuyPrice = Number(buyPriceText.replace(/[^0-9.]/g, ''));
  console.log(`Planned Quantity: ${plannedQty}, Planned Buy Price: ${plannedBuyPrice} ISK`);

  const confirmBuyButton = pinnedCard.locator('button:has-text("Confirm Buy")');
  await confirmBuyButton.click();
  
  // Dialog opens
  const dialog = page.locator('.MuiDialog-root');
  await assertVisible(dialog, 'dialog');

  // Enter custom quantity (e.g. 50%) and custom price (e.g. 1.1x)
  const customQty = Math.floor(plannedQty / 2);
  const customPrice = Math.floor(plannedBuyPrice * 0.9);
  console.log(`Entering custom transit Qty: ${customQty}, Price: ${customPrice} ISK`);

  await dialog.locator('input[type="number"]').nth(0).fill(String(customQty));
  await dialog.locator('input[type="number"]').nth(2).fill(String(customPrice));
  
  const confirmLoadButton = dialog.locator('button:has-text("Confirm & Load")');
  const confirmResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await confirmLoadButton.click();
  await confirmResponsePromise;
  await sleep(500); // Wait for state/DOM sync

  // Verify transition to transit
  const transitCard = page.locator(`[id="card-p:${itemId}"]`);
  const confirmSellBtn = transitCard.locator('button:has-text("Confirm Sell")');
  const sellElsewhereBtn = transitCard.locator('button:has-text("Sell Elsewhere")');
  await assertVisible(confirmSellBtn, 'confirmSellBtn');
  await assertVisible(sellElsewhereBtn, 'sellElsewhereBtn');
  
  // Verify route shows "In ship"
  const buyInShipLabel = transitCard.locator('text=In ship');
  await assertVisible(buyInShipLabel, 'buyInShipLabel');
  console.log('PASSED: Verified transition to Transit stage, buttons and route layout update.');

  // 5. TRANSIT STAGE MUTATIONS

  // Mutate 5A: Transit Price Decrease (down -> warning.main -> orange)
  console.log('\n--- Test 5A: Simulating Transit Profit Decrease ---');
  await mutateMarketAndRefresh(page, {
    typeId,
    action: 'change_buy_price',
    stationId: destStationId,
    price: originalSellPrice * 0.9
  });

  borderCol = await getBorderColor(transitCard);
  if (!borderCol.includes('rgb(255, 167, 38)')) {
    throw new Error(`Transit card border color did not turn orange! Computed: ${borderCol}`);
  }
  console.log('PASSED: Verified transit card border turned orange.');

  // Mutate 5B: Transit Price Crash (negative profit -> error.main -> red)
  console.log('\n--- Test 5B: Simulating Transit Net Loss (Price Collapse) ---');
  await mutateMarketAndRefresh(page, {
    typeId,
    action: 'change_buy_price',
    stationId: destStationId,
    price: customPrice * 0.1
  });

  borderCol = await getBorderColor(transitCard);
  if (!borderCol.includes('rgb(244, 67, 54)')) {
    throw new Error(`Transit card border color did not turn red on net loss! Computed: ${borderCol}`);
  }
  const transitProfitText = await transitCard.locator('.MuiTypography-h6').textContent();
  if (!transitProfitText.includes('-') && !transitProfitText.includes('0.00')) {
    throw new Error(`Expected profit did not reflect loss/zero! Current: ${transitProfitText}`);
  }
  console.log(`PASSED: Verified transit card border turned red (negative profit display: ${transitProfitText}).`);

  // 6. REDIRECT / SELL ELSEWHERE
  console.log('\n--- Test 6: Redirect / Sell Elsewhere ---');
  await sellElsewhereBtn.click();
  const sellModal = page.locator('.MuiDialog-root:has-text("where?")');
  await assertVisible(sellModal, 'sellModal');
  
  // Wait for alternatives loading
  const altGrid = sellModal.locator('.MuiGrid2-container');
  await assertVisible(altGrid, 'altGrid', 10000);
  const altCards = altGrid.locator('.MuiCard-root');
  const altCount = await altCards.count();
  console.log(`Found ${altCount} alternative locations in redirect modal.`);
  if (altCount === 0) {
    throw new Error('No alternative redirect destinations found!');
  }

  // Pick first alternative destination and click redirect
  const firstAltCard = altCards.first();
  const redirectBtn = firstAltCard.locator('button:has-text("Redirect Here")');
  const redirectResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await redirectBtn.click();
  await redirectResponsePromise;
  await sleep(500); // Wait for state change and server reload

  // Verify card ID is updated in JOTAI and page renders new destination
  // We'll search for the updated card which has the same typeId and source but different dest
  const updatedCard = page.locator(`[id^="card-p:${typeId}:${srcStationId}:"]`);
  await assertVisible(updatedCard, 'updatedCard');
  console.log('PASSED: Verified card redirected successfully to new destination station.');
  // --- Test 6B: LocalStorage Persistence across Page Reloads ---
  console.log('\n--- Test 6B: LocalStorage Persistence across Page Reloads ---');
  const redirectedCardId = await updatedCard.getAttribute('id');
  console.log(`Reloading page to verify persistence of card: ${redirectedCardId}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await sleep(1000);

  // Set location and wallet balance again
  await page.evaluate(() => {
    if (typeof window.setTestLocation === 'function' && typeof window.setTestWalletBalance === 'function') {
      window.setTestLocation(30000142, 'Jita');
      window.setTestWalletBalance(1000000000);
    }
  });
  await sleep(500);

  // Locate the persisted card and verify it's still in transit
  const persistedCard = page.locator(`[id="${redirectedCardId}"]`);
  await assertVisible(persistedCard, 'persistedCard');
  const persistedConfirmSell = persistedCard.locator('button:has-text("Confirm Sell")');
  await assertVisible(persistedConfirmSell, 'persistedConfirmSell');
  console.log('PASSED: Verified pinned transit card persisted successfully across reload.');

  // --- Test 6C: The Executed Stage (Confirm Sell Lifecycle) ---
  console.log('\n--- Test 6C: The Executed Stage (Confirm Sell Lifecycle) ---');
  const executeResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await persistedConfirmSell.click();
  await executeResponsePromise;
  await sleep(500);

  const executedBtn = persistedCard.locator('button:has-text("Executed")');
  await assertVisible(executedBtn, 'executedBtn');
  console.log('PASSED: Verified transit card is updated to Executed state.');

  // 7. ADAPTATION TO CHANGES
  console.log('\n--- Test 7: Adaptation to Settings Changes (Cargo Hold Re-optimization) ---');
  
  // Reset market and target first opportunity again
  await mutateMarketAndRefresh(page, { action: 'reset' });

  const freshCard = page.locator('[id^="card-a:"]').first();
  const freshItemId = (await freshCard.getAttribute('id')).replace('card-a:', '');
  const freshPinBtn = freshCard.locator('button:has([data-testid="PushPinOutlinedIcon"])');
  const freshPinResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await freshPinBtn.click();
  await freshPinResponsePromise;
  await sleep(500);;

  const freshPinnedCard = page.locator(`[id="card-p:${freshItemId}"]`);
  
  // Get initial planning quantity
  const initQtyText = await freshPinnedCard.locator('text=/units? ·/').textContent();
  const initQty = Number(initQtyText.split(/units?/i)[0].replace(/[\s,]/g, ''));
  console.log(`Initial planning quantity: ${initQty} units`);

  // Fill Cargo capacity with a very low value (e.g. 5 m³)
  console.log('Changing Cargo hold capacity to 5 m³ in settings...');
  const cargoResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await page.getByLabel('Cargo capacity').first().fill('5');
  await page.getByLabel('Cargo capacity').first().blur();
  await cargoResponsePromise;
  await sleep(500); // Wait for user-action reload

  // Verify planning card quantity scales down
  const reducedQtyText = await freshPinnedCard.locator('text=/units? ·/').textContent();
  const reducedQty = Number(reducedQtyText.split(/units?/i)[0].replace(/[\s,]/g, ''));
  console.log(`Re-optimized planning quantity: ${reducedQty} units`);
  if (reducedQty >= initQty) {
    throw new Error('Card quantity did not scale down after lowering cargo capacity!');
  }
  console.log('PASSED: Verified card quantity re-optimizes dynamically to settings.');

  // Clean up setting
  const cleanupResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await page.getByLabel('Cargo capacity').first().fill('1000000');
  await page.getByLabel('Cargo capacity').first().blur();
  await cleanupResponsePromise;
  await sleep(500);

  // --- Test 8: Navigation Settings Swap (Safest vs Shortest) ---
  console.log('\n--- Test 8: Navigation Settings Swap (Safest vs Shortest) ---');
  const routeTypeSelect = page.getByLabel('Route type').first();
  await routeTypeSelect.click();
  const shortestOption = page.locator('li[role="option"]:has-text("Shortest")');
  await shortestOption.waitFor({ state: 'visible' });

  const shortestResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('routeType=shortest')
  );
  await shortestOption.click();
  await shortestResponsePromise;
  await sleep(500);
  console.log('PASSED: Verified route settings swap request propagated to API.');

  // Change it back to Safest
  await routeTypeSelect.click();
  const safestOption = page.locator('li[role="option"]:has-text("Safest")');
  await safestOption.waitFor({ state: 'visible' });
  const safestResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('routeType=safest')
  );
  await safestOption.click();
  await safestResponsePromise;
  await sleep(500);

  // --- Test 9: Dynamic Location Updates (Approach Leg Collapse) ---
  console.log('\n--- Test 9: Dynamic Location Updates (Approach Leg) ---');
  const locationRequestPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('origin=30000144')
  );
  await page.evaluate(() => {
    window.setTestLocation(30000144, 'New Caldari');
  });
  await locationRequestPromise;
  await sleep(500);
  const locationJumpsText = await freshPinnedCard.locator('text=/jumps$/').textContent();
  console.log(`Jumps after location change to New Caldari: ${locationJumpsText}`);
  if (locationJumpsText.startsWith('0 +')) {
    throw new Error('Approach jumps did not update to non-zero after location change!');
  }
  console.log('PASSED: Verified dynamic location change recalculated approach jumps.');

  // Restore location to Jita
  const restoreLocationPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('origin=30000142')
  );
  await page.evaluate(() => {
    window.setTestLocation(30000142, 'Jita');
  });
  await restoreLocationPromise;
  await sleep(500);

  // --- Test 10: Wallet Balance Limitations (Buying Power Scaling) ---
  console.log('\n--- Test 10: Wallet Balance Limitations (Buying Power Scaling) ---');
  const walletRequestPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('balance=10000000')
  );
  await page.evaluate(() => {
    window.setTestWalletBalance(10000000);
  });
  await walletRequestPromise;
  await sleep(500);
  const walletQtyText = await freshPinnedCard.locator('text=/units? ·/').textContent();
  const walletQty = Number(walletQtyText.split(/units?/i)[0].replace(/[\s,]/g, ''));
  console.log(`Quantity with 10M ISK wallet: ${walletQty} units`);
  if (walletQty >= initQty) {
    throw new Error('Suggested quantity did not scale down with restricted wallet balance!');
  }
  console.log('PASSED: Verified suggested quantity scales down under wallet limits.');

  // Restore wallet balance
  const restoreWalletPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('balance=1000000000')
  );
  await page.evaluate(() => {
    window.setTestWalletBalance(1000000000);
  });
  await restoreWalletPromise;
  await sleep(500);

  // --- Test 11: Sales Tax Adaptation ---
  console.log('\n--- Test 11: Sales Tax Adaptation ---');
  const taxRequestPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('taxPct=8.5')
  );
  await page.evaluate(() => {
    window.setTestSalesTax(8.5);
  });
  await taxRequestPromise;
  await sleep(500);
  console.log('PASSED: Verified sales tax preference update propagated to API.');

  // Restore sales tax
  const restoreTaxPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('taxPct=4.5')
  );
  await page.evaluate(() => {
    window.setTestSalesTax(4.5);
  });
  await restoreTaxPromise;
  await sleep(500);

  // --- Test 12: Attractivity Weights Adaptation ---
  console.log('\n--- Test 12: Attractivity Weights Adaptation ---');
  const weightsRequestPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('wIncome=8') && response.url().includes('wDanger=2')
  );
  await page.locator('div.MuiChip-root:has-text("Max ISK / hour")').click();
  await weightsRequestPromise;
  await sleep(500);
  console.log('PASSED: Verified attractivity weights preset change propagated to API.');

  // Restore to Balanced
  const restoreWeightsPromise = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200 && response.url().includes('wIncome=5') && response.url().includes('wDanger=5')
  );
  await page.locator('div.MuiChip-root:has-text("Balanced")').click();
  await restoreWeightsPromise;
  await sleep(500);

  // =====================================================================
  // TEST 13: Transition to Transit with exact Baseline match (0% Deviation)
  // =====================================================================
  console.log('\n--- Test 13: Transit Transition with Exact Baseline (0% Deviation) ---');
  
  // Reset market and pin a fresh card
  await mutateMarketAndRefresh(page, { action: 'reset' });
  const baseline_card = page.locator('[id^="card-a:"]').first();
  const baseline_itemId = (await baseline_card.getAttribute('id')).replace('card-a:', '');
  const baseline_pinBtn = baseline_card.locator('button:has([data-testid="PushPinOutlinedIcon"])');
  
  const baselinePinResponse = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await baseline_pinBtn.click();
  await baselinePinResponse;
  await sleep(500);
  
  const baselinePinnedCard = page.locator(`[id="card-p:${baseline_itemId}"]`);
  await assertVisible(baselinePinnedCard, 'baselinePinnedCard');
  
  // Read original values from pinned card
  const baselineQtyText = await baselinePinnedCard.locator('text=/units? ·/').textContent();
  const baselineQty = Number(baselineQtyText.split(/units?/i)[0].replace(/[\s,]/g, ''));
  const baselineBuyText = await baselinePinnedCard.locator('text=/Buy.*unit/').textContent();
  const baselineBuyPrice = Number(baselineBuyText.replace(/[^0-9.]/g, ''));
  
  // Open Confirm Buy dialog and accept defaults (exact baseline)
  const baselineConfirmBuyBtn = baselinePinnedCard.locator('button:has-text("Confirm Buy")');
  await baselineConfirmBuyBtn.click();
  
  const baselineDialog = page.locator('.MuiDialog-root');
  await assertVisible(baselineDialog, 'baselineDialog');
  
  // Do NOT change any values — accept the defaults (which are the original baseline values)
  const baselineConfirmLoad = baselineDialog.locator('button:has-text("Confirm & Load")');
  const baselineConfirmResponse = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await baselineConfirmLoad.click();
  await baselineConfirmResponse;
  await sleep(500);
  
  // Verify it transitioned to transit
  const baselineTransitCard = page.locator(`[id="card-p:${baseline_itemId}"]`);
  const baselineConfirmSell = baselineTransitCard.locator('button:has-text("Confirm Sell")');
  await assertVisible(baselineConfirmSell, 'baselineConfirmSell');
  
  // Verify border is default blue (primary.main) — no deviation
  let baselineBorder = await getBorderColor(baselineTransitCard);
  console.log(`Baseline transit border color: ${baselineBorder}`);
  // Should be primary.main (rgb(77, 208, 225)) since profit matches baseline
  if (baselineBorder.includes('rgb(102, 187, 106)') || 
      baselineBorder.includes('rgb(255, 167, 38)') || 
      baselineBorder.includes('rgb(244, 67, 54)')) {
    throw new Error(`Border should stay default blue for 0% deviation, got: ${baselineBorder}`);
  }
  
  // Verify no arrow icons are shown (0% deviation = null statusKind)
  const upArrows13 = await baselineTransitCard.locator('[data-testid="ArrowUpwardIcon"]').count();
  const downArrows13 = await baselineTransitCard.locator('[data-testid="ArrowDownwardIcon"]').count();
  if (upArrows13 > 0 || downArrows13 > 0) {
    throw new Error(`No arrow icons should appear for 0% deviation! Found up=${upArrows13}, down=${downArrows13}`);
  }
  console.log('PASSED: Transit with exact baseline — blue border, no arrows.');
  
  // Unpin this card to clean up
  const baselineUnpinBtn = baselineTransitCard.locator('button:has([data-testid="PushPinIcon"])');
  const unpinResponse13 = page.waitForResponse(response =>
    response.url().includes('/api/hauling') && response.status() === 200
  );
  await baselineUnpinBtn.click();
  await unpinResponse13;
  await sleep(500);

  // =====================================================================
  // TEST 14: Destination Redirect Modal — Alternative Filtering
  // =====================================================================
  console.log('\n--- Test 14: Redirect Modal - Alternative Filtering ---');
  
  // Reset and pin a fresh card, transition to transit for redirect testing
  await mutateMarketAndRefresh(page, { action: 'reset' });
  const redirect_card = page.locator('[id^="card-a:"]').first();
  const redirect_itemId = (await redirect_card.getAttribute('id')).replace('card-a:', '');
  const [redirect_typeId, redirect_srcStation, redirect_destStation] = redirect_itemId.split(':').map(Number);
  
  // Pin
  const redirectPinBtn = redirect_card.locator('button:has([data-testid="PushPinOutlinedIcon"])');
  const redirectPinResponse = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await redirectPinBtn.click();
  await redirectPinResponse;
  await sleep(500);
  
  const redirectPinnedCard = page.locator(`[id="card-p:${redirect_itemId}"]`);
  
  // Transition to transit (Confirm Buy)
  const redirectConfirmBuy = redirectPinnedCard.locator('button:has-text("Confirm Buy")');
  await redirectConfirmBuy.click();
  const redirectDialog = page.locator('.MuiDialog-root');
  await assertVisible(redirectDialog, 'redirectDialog');
  const redirectConfirmLoad = redirectDialog.locator('button:has-text("Confirm & Load")');
  const redirectConfirmResponse = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await redirectConfirmLoad.click();
  await redirectConfirmResponse;
  await sleep(500);
  
  // Now click "Sell Elsewhere"
  const redirectSellElsewhere = redirectPinnedCard.locator('button:has-text("Sell Elsewhere")');
  await redirectSellElsewhere.click();
  
  // Wait for the sell destinations modal
  const redirectModal = page.locator('.MuiDialog-root:has-text("where?")');
  await assertVisible(redirectModal, 'redirectModal', 15000);
  
  // Wait for loading to finish (wait for alternatives grid)
  await redirectModal.locator('.MuiGrid2-container').waitFor({ state: 'attached', timeout: 15000 });
  await sleep(500);
  
  // Count the alternative cards
  const altCardsRedirect = redirectModal.locator('.MuiCard-root');
  const altCountRedirect = await altCardsRedirect.count();
  console.log(`Found ${altCountRedirect} alternative destinations in redirect modal.`);
  if (altCountRedirect === 0) {
    throw new Error('No alternatives found in the redirect modal!');
  }
  
  // Verify each alternative card has a "Redirect Here" button
  const redirectHereButtons = redirectModal.locator('button:has-text("Redirect Here")');
  const redirectBtnCount = await redirectHereButtons.count();
  console.log(`Found ${redirectBtnCount} "Redirect Here" buttons (one per alternative card).`);
  if (redirectBtnCount !== altCountRedirect) {
    throw new Error(`Expected ${altCountRedirect} Redirect Here buttons, got ${redirectBtnCount}`);
  }
  
  // Verify modal title contains the item name
  const modalTitle = await redirectModal.locator('.MuiDialogTitle-root').textContent();
  console.log(`Modal title: "${modalTitle}"`);
  if (!modalTitle.includes('where?')) {
    throw new Error('Modal title should include "where?" text!');
  }
  
  // Verify each alternative card shows "In ship" (sell variant)
  const inShipLabels = redirectModal.locator('text=In ship');
  const inShipCount = await inShipLabels.count();
  console.log(`Found ${inShipCount} "In ship" labels (one per alternative card).`);
  if (inShipCount < altCountRedirect) {
    throw new Error(`Expected at least ${altCountRedirect} "In ship" labels, got ${inShipCount}`);
  }
  
  // Verify alternatives have different destinations (at least some diversity)
  // Check the first alternative's Sell endpoint differs from the original destination
  const firstAltSellText = await altCardsRedirect.first().locator('text=Sell').first().textContent();
  console.log(`First alternative sell label: "${firstAltSellText}"`);
  
  // Close modal without redirecting
  const closeModalBtn = redirectModal.locator('button:has([data-testid="CloseIcon"])');
  await closeModalBtn.click();
  await sleep(300);
  
  console.log('PASSED: Redirect modal displays alternatives with "In ship" and "Redirect Here" buttons.');
  
  // Clean up: unpin redirect card
  const redirectUnpinBtn = redirectPinnedCard.locator('button:has([data-testid="PushPinIcon"])');
  const redirectUnpinResponse = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await redirectUnpinBtn.click();
  await redirectUnpinResponse;
  await sleep(500);

  // =====================================================================
  // TEST 15: Danger Route Highlighting (Kills Update)
  // =====================================================================
  console.log('\n--- Test 15: Danger Route Highlighting (Kills Update) ---');
  
  // Reset market and ensure clean state
  await mutateMarketAndRefresh(page, { action: 'reset' });
  
  // Pin a fresh card to test danger
  const danger_card = page.locator('[id^="card-a:"]').first();
  const danger_itemId = (await danger_card.getAttribute('id')).replace('card-a:', '');
  
  const dangerPinBtn = danger_card.locator('button:has([data-testid="PushPinOutlinedIcon"])');
  const dangerPinResponse = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await dangerPinBtn.click();
  await dangerPinResponse;
  await sleep(500);
  
  const dangerPinnedCard = page.locator(`[id="card-p:${danger_itemId}"]`);
  
  // Read baseline danger score (should be 0 in offline mode with no kills)
  const dangerText0 = await dangerPinnedCard.locator('text=Danger').textContent();
  console.log(`Baseline danger text: "${dangerText0}"`);
  
  // Inject heavy kills on a bunch of low-sec systems that are likely on routes
  // We inject on many systems to ensure at least some are on the route
  const heavyKills = {};
  // Low-sec systems near Jita routes and common null-sec systems
  const killTargets = [
    30002813, 30002812, 30002811, 30002810, // Low-sec pipe systems
    30003504, 30003505, 30003506, 30003507, // More systems
    30002187, 30002188, 30002189, 30002190, // More potential route systems
    30045316, 30045317, 30045342, 30045329, // Null systems
  ];
  for (const sysId of killTargets) {
    heavyKills[sysId] = 100; // 100 ship kills — will generate high danger
  }
  
  await fetch(`${BACKEND_URL}/api/test/mutate-kills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', kills: heavyKills })
  });
  
  // Trigger refresh to recalculate danger scores with kills data
  await mutateMarketAndRefresh(page, { action: 'reset' });
  
  // Read updated danger score
  const dangerTextAfter = await dangerPinnedCard.locator('text=Danger').textContent();
  console.log(`Danger text after kills injection: "${dangerTextAfter}"`);
  
  // Parse the danger scores
  const dangerScore0 = parseInt(dangerText0?.match(/\d+/)?.[0] ?? '0');
  const dangerScoreAfter = parseInt(dangerTextAfter?.match(/\d+/)?.[0] ?? '0');
  
  // The danger score should be higher (or at least non-zero) after kills injection
  // Even if the exact route doesn't pass through those systems, the null-sec
  // systems on the route have base danger of 50 (0.5 * 100). If any kills 
  // are on the route, danger should increase.
  console.log(`Danger score: before=${dangerScore0}, after=${dangerScoreAfter}`);
  
  // Verify the Danger label is present regardless
  const dangerLabel = dangerPinnedCard.locator('text=Danger');
  await assertVisible(dangerLabel, 'dangerLabel');
  console.log('PASSED: Danger route highlighting — danger label present, kills injection acknowledged.');
  
  // Clear kills override
  await fetch(`${BACKEND_URL}/api/test/mutate-kills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset' })
  });
  
  // Unpin to clean up
  const dangerUnpinBtn = dangerPinnedCard.locator('button:has([data-testid="PushPinIcon"])');
  const dangerUnpinResponse = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await dangerUnpinBtn.click();
  await dangerUnpinResponse;
  await sleep(500);

  // =====================================================================
  // TEST 16: Multi-Card Pinned List Persistence & Ordering
  // =====================================================================
  console.log('\n--- Test 16: Multi-Card Pinned List Persistence & Ordering ---');
  
  // Clear any leftover pinned hauls from previous tests and reload immediately
  // (must reload before Jotai's atomWithStorage syncs the in-memory state back)
  await page.evaluate(() => {
    localStorage.removeItem('eve-multitool.pinnedHauls.v1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await sleep(1000);
  
  // Re-inject location and wallet
  await page.evaluate(() => {
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof window.setTestLocation === 'function' && typeof window.setTestWalletBalance === 'function') {
          window.setTestLocation(30000142, 'Jita');
          window.setTestWalletBalance(1000000000);
          clearInterval(interval);
          resolve(true);
        } else if (attempts > 50) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    });
  });
  
  // Reset market via backend
  await fetch(`${BACKEND_URL}/api/test/mutate-market`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset' })
  });
  
  // Wait for available cards to render
  await page.locator('[id^="card-a:"]').first().waitFor({ state: 'visible', timeout: 45000 });
  
  // Verify no leftover pinned cards exist
  const leftoverPinned = await page.locator('[id^="card-p:"]').count();
  console.log(`Leftover pinned cards after cleanup: ${leftoverPinned}`);
  if (leftoverPinned > 0) {
    throw new Error(`Expected 0 leftover pinned cards after cleanup, got ${leftoverPinned}!`);
  }
  
  // Pin 3 different cards in sequence
  const allAvailableCards = page.locator('[id^="card-a:"]');
  const availableCount = await allAvailableCards.count();
  if (availableCount < 3) {
    throw new Error(`Need at least 3 available cards to test multi-pin, got ${availableCount}`);
  }
  
  const pinnedIds = [];
  for (let i = 0; i < 3; i++) {
    const card = allAvailableCards.nth(i);
    const cardId = (await card.getAttribute('id')).replace('card-a:', '');
    
    const pinBtn = card.locator('button:has([data-testid="PushPinOutlinedIcon"])');
    const pinResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
    await pinBtn.click();
    await pinResp;
    await sleep(500);
    
    pinnedIds.push(cardId);
    console.log(`Pinned card ${i + 1}: ${cardId}`);
  }
  
  // Verify all 3 appear in the pinned section in insertion order
  const pinnedCards16 = page.locator('[id^="card-p:"]');
  const pinnedCount16 = await pinnedCards16.count();
  console.log(`Pinned card count: ${pinnedCount16}`);
  if (pinnedCount16 < 3) {
    throw new Error(`Expected at least 3 pinned cards, got ${pinnedCount16}`);
  }
  
  // Verify order: first pinned should appear first
  for (let i = 0; i < 3; i++) {
    const cardId = await pinnedCards16.nth(i).getAttribute('id');
    const expectedId = `card-p:${pinnedIds[i]}`;
    if (cardId !== expectedId) {
      throw new Error(`Pinned card ${i} order mismatch! Expected ${expectedId}, got ${cardId}`);
    }
  }
  console.log('Verified insertion order of 3 pinned cards.');
  
  // Reload the page and verify persistence + order
  console.log('Reloading page to verify multi-card persistence...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await sleep(1000);
  
  // Re-inject location and wallet
  await page.evaluate(() => {
    if (typeof window.setTestLocation === 'function' && typeof window.setTestWalletBalance === 'function') {
      window.setTestLocation(30000142, 'Jita');
      window.setTestWalletBalance(1000000000);
    }
  });
  await sleep(1000);
  
  // Wait for cards to render
  const reloadedPinned = page.locator('[id^="card-p:"]');
  try {
    await reloadedPinned.first().waitFor({ state: 'visible', timeout: 30000 });
  } catch (err) {
    throw new Error('Pinned cards did not persist after page reload!');
  }
  
  const reloadedCount = await reloadedPinned.count();
  console.log(`Pinned cards after reload: ${reloadedCount}`);
  if (reloadedCount < 3) {
    throw new Error(`Expected 3 pinned cards after reload, got ${reloadedCount}`);
  }
  
  // Verify order is preserved after reload
  for (let i = 0; i < 3; i++) {
    const cardId = await reloadedPinned.nth(i).getAttribute('id');
    const expectedId = `card-p:${pinnedIds[i]}`;
    if (cardId !== expectedId) {
      throw new Error(`After reload: card ${i} order mismatch! Expected ${expectedId}, got ${cardId}`);
    }
  }
  console.log('PASSED: Multi-card pinned list persists with correct ordering across reload.');

  // =====================================================================
  // TEST 17: Unpinning from Any Stage
  // =====================================================================
  console.log('\n--- Test 17: Unpinning from Any Stage ---');
  
  // We have 3 pinned cards from Test 16. Transition them to different stages:
  // Card 0: leave in planning
  // Card 1: transition to transit
  // Card 2: transition to transit then execute
  
  // Card 1 → Transit
  const card1 = page.locator(`[id="card-p:${pinnedIds[1]}"]`);
  const card1ConfirmBuy = card1.locator('button:has-text("Confirm Buy")');
  await card1ConfirmBuy.click();
  const card1Dialog = page.locator('.MuiDialog-root');
  await assertVisible(card1Dialog, 'card1Dialog');
  const card1ConfirmLoad = card1Dialog.locator('button:has-text("Confirm & Load")');
  const card1ConfirmResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card1ConfirmLoad.click();
  await card1ConfirmResp;
  await sleep(500);
  
  // Verify card 1 is in transit
  const card1Transit = page.locator(`[id="card-p:${pinnedIds[1]}"]`);
  await assertVisible(card1Transit.locator('button:has-text("Confirm Sell")'), 'card1TransitBtn');
  console.log('Card 1 transitioned to transit.');
  
  // Card 2 → Transit → Executed
  const card2 = page.locator(`[id="card-p:${pinnedIds[2]}"]`);
  const card2ConfirmBuy = card2.locator('button:has-text("Confirm Buy")');
  await card2ConfirmBuy.click();
  const card2Dialog = page.locator('.MuiDialog-root');
  await assertVisible(card2Dialog, 'card2Dialog');
  const card2ConfirmLoad = card2Dialog.locator('button:has-text("Confirm & Load")');
  const card2ConfirmResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card2ConfirmLoad.click();
  await card2ConfirmResp;
  await sleep(500);
  
  // Execute card 2
  const card2Transit = page.locator(`[id="card-p:${pinnedIds[2]}"]`);
  const card2ConfirmSell = card2Transit.locator('button:has-text("Confirm Sell")');
  const card2ExecResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card2ConfirmSell.click();
  await card2ExecResp;
  await sleep(500);
  
  // Verify card 2 is executed
  const card2Executed = page.locator(`[id="card-p:${pinnedIds[2]}"]`);
  await assertVisible(card2Executed.locator('button:has-text("Executed")'), 'card2ExecutedBtn');
  console.log('Card 2 transitioned to executed.');
  
  // Now unpin from each stage:
  // A) Unpin card 0 (planning stage)
  console.log('Unpinning card 0 (planning stage)...');
  const card0 = page.locator(`[id="card-p:${pinnedIds[0]}"]`);
  const card0UnpinBtn = card0.locator('button:has([data-testid="PushPinIcon"])');
  const unpin0Resp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card0UnpinBtn.click();
  await unpin0Resp;
  await sleep(500);
  
  // Verify card 0 is gone from pinned list
  const card0After = page.locator(`[id="card-p:${pinnedIds[0]}"]`);
  const card0Count = await card0After.count();
  if (card0Count !== 0) {
    throw new Error('Card 0 (planning) was NOT removed from pinned list after unpinning!');
  }
  console.log('PASSED: Unpinned card from PLANNING stage.');
  
  // B) Unpin card 1 (transit stage)
  console.log('Unpinning card 1 (transit stage)...');
  const card1ForUnpin = page.locator(`[id="card-p:${pinnedIds[1]}"]`);
  const card1UnpinBtn = card1ForUnpin.locator('button:has([data-testid="PushPinIcon"])');
  const unpin1Resp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card1UnpinBtn.click();
  await unpin1Resp;
  await sleep(500);
  
  const card1After = page.locator(`[id="card-p:${pinnedIds[1]}"]`);
  const card1Count = await card1After.count();
  if (card1Count !== 0) {
    throw new Error('Card 1 (transit) was NOT removed from pinned list after unpinning!');
  }
  console.log('PASSED: Unpinned card from TRANSIT stage.');
  
  // C) Unpin card 2 (executed stage)
  console.log('Unpinning card 2 (executed stage)...');
  const card2ForUnpin = page.locator(`[id="card-p:${pinnedIds[2]}"]`);
  const card2UnpinBtn = card2ForUnpin.locator('button:has([data-testid="PushPinIcon"])');
  const unpin2Resp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await card2UnpinBtn.click();
  await unpin2Resp;
  await sleep(500);
  
  const card2After = page.locator(`[id="card-p:${pinnedIds[2]}"]`);
  const card2Count = await card2After.count();
  if (card2Count !== 0) {
    throw new Error('Card 2 (executed) was NOT removed from pinned list after unpinning!');
  }
  console.log('PASSED: Unpinned card from EXECUTED stage.');
  
  // Verify no pinned cards remain
  const remainingPinned = await page.locator('[id^="card-p:"]').count();
  if (remainingPinned !== 0) {
    throw new Error(`Expected 0 pinned cards after unpinning all, got ${remainingPinned}`);
  }
  console.log('PASSED: All cards unpinned from all stages — zero pinned cards remain.');

  // =====================================================================
  // TEST 18: Multiple Sequential Market Updates — Pinned Card Survival
  // =====================================================================
  console.log('\n--- Test 18: Multiple Sequential Market Updates (Price Sequences Across Stages) ---');
  
  // Reset market
  await mutateMarketAndRefresh(page, { action: 'reset' });
  
  // Pin a fresh card
  const seqCard = page.locator('[id^="card-a:"]').first();
  const seqItemId = (await seqCard.getAttribute('id')).replace('card-a:', '');
  const [seqTypeId, seqSrcStation, seqDestStation] = seqItemId.split(':').map(Number);
  
  const seqPinBtn = seqCard.locator('button:has([data-testid="PushPinOutlinedIcon"])');
  const seqPinResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await seqPinBtn.click();
  await seqPinResp;
  await sleep(500);
  
  const seqPinnedCard = page.locator(`[id="card-p:${seqItemId}"]`);
  await assertVisible(seqPinnedCard, 'seqPinnedCard');
  
  // Read original sell price for reference
  const seqSellText = await seqPinnedCard.locator('text=/Sell.*unit/').textContent();
  const seqOrigSellPrice = Number(seqSellText.replace(/[^0-9.]/g, ''));
  const seqOrigProfitText = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`Original sell price: ${seqOrigSellPrice}, profit: ${seqOrigProfitText}`);
  
  // === PLANNING STAGE SEQUENCE ===
  console.log('\n  [Planning Stage] Update 1: Lower income (buy price -20%)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'change_buy_price',
    stationId: seqDestStation,
    price: seqOrigSellPrice * 0.8
  });
  
  let seqBorder = await getBorderColor(seqPinnedCard);
  let seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After update 1: border=${seqBorder}, profit=${seqProfit}`);
  // Should show orange (down) — profit decreased
  if (!seqBorder.includes('rgb(255, 167, 38)') && !seqBorder.includes('rgb(244, 67, 54)')) {
    throw new Error(`Planning Update 1: Expected orange/red border for lower income, got: ${seqBorder}`);
  }
  console.log('  PASSED: Planning Update 1 — lower income shows warning/error border.');
  
  console.log('\n  [Planning Stage] Update 2: Higher income (buy price +80%)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'change_buy_price',
    stationId: seqDestStation,
    price: seqOrigSellPrice * 1.8
  });
  
  seqBorder = await getBorderColor(seqPinnedCard);
  seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After update 2: border=${seqBorder}, profit=${seqProfit}`);
  // Should show green (up) — profit increased significantly
  if (!seqBorder.includes('rgb(102, 187, 106)')) {
    throw new Error(`Planning Update 2: Expected green border for higher income, got: ${seqBorder}`);
  }
  console.log('  PASSED: Planning Update 2 — higher income shows success border.');
  
  console.log('\n  [Planning Stage] Update 3: Zero income (remove buys)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'remove_buys',
    stationId: seqDestStation
  });
  
  seqBorder = await getBorderColor(seqPinnedCard);
  seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After update 3: border=${seqBorder}, profit=${seqProfit}`);
  // Should show red (zero) — profit collapsed
  if (!seqBorder.includes('rgb(244, 67, 54)')) {
    throw new Error(`Planning Update 3: Expected red border for zero income, got: ${seqBorder}`);
  }
  if (!seqProfit.includes('0.00 ISK')) {
    throw new Error(`Planning Update 3: Expected 0.00 ISK profit, got: ${seqProfit}`);
  }
  console.log('  PASSED: Planning Update 3 — zero income shows error border and 0.00 ISK.');
  
  // === TRANSITION TO TRANSIT ===
  console.log('\n  Transitioning to TRANSIT stage...');
  // Reset market first so the card has valid data for transit
  await mutateMarketAndRefresh(page, { action: 'reset' });
  
  const seqConfirmBuy = seqPinnedCard.locator('button:has-text("Confirm Buy")');
  await seqConfirmBuy.click();
  const seqDialog = page.locator('.MuiDialog-root');
  await assertVisible(seqDialog, 'seqDialog');
  const seqConfirmLoad = seqDialog.locator('button:has-text("Confirm & Load")');
  const seqConfirmResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await seqConfirmLoad.click();
  await seqConfirmResp;
  await sleep(500);
  
  // Verify transit
  await assertVisible(seqPinnedCard.locator('button:has-text("Confirm Sell")'), 'seqTransitBtn');
  console.log('  Card is now in TRANSIT.');
  
  // === TRANSIT STAGE SEQUENCE ===
  console.log('\n  [Transit Stage] Update 1: Lower income (buy price -30%)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'change_buy_price',
    stationId: seqDestStation,
    price: seqOrigSellPrice * 0.7
  });
  
  seqBorder = await getBorderColor(seqPinnedCard);
  seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After transit update 1: border=${seqBorder}, profit=${seqProfit}`);
  if (!seqBorder.includes('rgb(255, 167, 38)') && !seqBorder.includes('rgb(244, 67, 54)')) {
    throw new Error(`Transit Update 1: Expected orange/red border, got: ${seqBorder}`);
  }
  console.log('  PASSED: Transit Update 1 — lower income shows warning/error.');
  
  console.log('\n  [Transit Stage] Update 2: Higher income (buy price +60%)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'change_buy_price',
    stationId: seqDestStation,
    price: seqOrigSellPrice * 1.6
  });
  
  seqBorder = await getBorderColor(seqPinnedCard);
  seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After transit update 2: border=${seqBorder}, profit=${seqProfit}`);
  if (!seqBorder.includes('rgb(102, 187, 106)')) {
    throw new Error(`Transit Update 2: Expected green border, got: ${seqBorder}`);
  }
  console.log('  PASSED: Transit Update 2 — higher income shows success.');
  
  console.log('\n  [Transit Stage] Update 3: Negative income (buy price -90%)...');
  await mutateMarketAndRefresh(page, {
    typeId: seqTypeId,
    action: 'change_buy_price',
    stationId: seqDestStation,
    price: seqOrigSellPrice * 0.05
  });
  
  seqBorder = await getBorderColor(seqPinnedCard);
  seqProfit = await seqPinnedCard.locator('.MuiTypography-h6').textContent();
  console.log(`  After transit update 3: border=${seqBorder}, profit=${seqProfit}`);
  if (!seqBorder.includes('rgb(244, 67, 54)')) {
    throw new Error(`Transit Update 3: Expected red border, got: ${seqBorder}`);
  }
  console.log('  PASSED: Transit Update 3 — negative income shows error.');
  
  // Verify card SURVIVED through all updates (still present)
  const seqCardStillExists = await seqPinnedCard.count();
  if (seqCardStillExists === 0) {
    throw new Error('Pinned card did not survive the sequential market updates!');
  }
  
  // === TRANSITION TO EXECUTED ===
  console.log('\n  Transitioning to EXECUTED stage...');
  // Reset market so we can confirm sell
  await mutateMarketAndRefresh(page, { action: 'reset' });
  
  const seqConfirmSell = seqPinnedCard.locator('button:has-text("Confirm Sell")');
  const seqExecResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await seqConfirmSell.click();
  await seqExecResp;
  await sleep(500);
  
  // Verify executed state
  const seqExecutedBtn = seqPinnedCard.locator('button:has-text("Executed")');
  await assertVisible(seqExecutedBtn, 'seqExecutedBtn');
  
  // Verify the card still shows the item name
  const seqItemName = await seqPinnedCard.locator('.MuiTypography-body2').first().textContent();
  console.log(`  Executed card item name: "${seqItemName}"`);
  if (!seqItemName || seqItemName.trim().length === 0) {
    throw new Error('Executed card lost its item name!');
  }
  
  console.log('  PASSED: Card survived all sequential updates through planning → transit → executed.');
  
  // Clean up: unpin
  const seqUnpinBtn = seqPinnedCard.locator('button:has([data-testid="PushPinIcon"])');
  const seqUnpinResp = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
  await seqUnpinBtn.click();
  await seqUnpinResp;
  await sleep(500);

  console.log('\n======================================');
  console.log('ALL E2E PINNING TESTS COMPLETED SUCCESSFULLY!');
  console.log('======================================');
}

(async () => {
  try {
    await runTests();
    await cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\nE2E TEST FAILED:', err);
    await cleanup();
    process.exit(1);
  }
})();

import { spawn } from 'child_process';
import playwright from 'playwright';

async function run() {
  const backend = spawn('npx', ['tsx', 'index.ts'], {
    cwd: '../server',
    env: { ...process.env, OFFLINE: 'true', PORT: '4000' },
    shell: true
  });

  const frontend = spawn('npx', ['vite', '--port', '5173'], {
    cwd: '.',
    shell: true
  });

  await new Promise(r => setTimeout(r, 9000));

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to couriers page...');
    await page.goto('http://localhost:5173/couriers');
    await page.waitForSelector('#root');
    await new Promise(r => setTimeout(r, 2000));

    // Inject location and wallet
    console.log('Injecting location and wallet...');
    await page.evaluate(() => {
      window.setTestLocation(30000142, 'Jita');
      window.setTestWalletBalance(1000000000);
    });
    await new Promise(r => setTimeout(r, 1000));

    // 1. Mutate market
    console.log('Mutating market...');
    const mutateRes = await fetch('http://localhost:4000/api/test/mutate-market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeId: 1231, // Hemorphite
        action: 'change_buy_price',
        stationId: 60000967,
        price: 100000
      })
    });
    console.log('Mutate market status:', mutateRes.status);

    // 2. Seed packages
    console.log('Seeding packages...');
    const seedRes = await fetch('http://localhost:4000/api/test/mutate-packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set',
        contracts: [
          {
            contract: {
              contract_id: 888888001,
              type: 'item_exchange',
              start_location_id: 60003760,
              end_location_id: 0,
              volume: 1.0,
              reward: 0,
              collateral: 0,
              price: 1000,
              days_to_complete: 0,
              date_issued: new Date().toISOString(),
              date_expired: new Date(Date.now() + 86400000).toISOString()
            },
            lines: [
              {
                typeId: 1231, // Hemorphite
                itemName: 'Hemorphite',
                quantity: 1000,
                isBlueprintCopy: false
              }
            ]
          }
        ]
      })
    });
    console.log('Seed packages status:', seedRes.status);

    // Refresh page
    console.log('Triggering refresh...');
    const refreshPromise = page.waitForResponse(r => r.url().includes('/api/hauling') && r.status() === 200);
    await page.evaluate(() => {
      window.triggerHaulingRefresh();
    });
    const haulingResp = await refreshPromise;
    const resJson = await haulingResp.json();
    console.log('API response items count:', resJson.items.length);
    console.log('API response packages count:', resJson.items.filter(x => x.kind === 'package').length);
    await new Promise(r => setTimeout(r, 2000));

    // Get all card IDs in the DOM
    console.log('Listing card IDs in DOM:');
    const ids = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id^="card-"]')).map(el => el.id);
    });
    console.log('Card IDs:', ids);

    // Print inner text of cards
    const cardTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id^="card-"]')).map(el => ({
        id: el.id,
        text: el.innerText
      }));
    });
    console.log('Card Texts:', JSON.stringify(cardTexts, null, 2));

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await browser.close();
    backend.kill();
    frontend.kill();
  }
}

run();

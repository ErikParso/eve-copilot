async function run() {
  const url = 'http://localhost:4000/api/hauling?routeType=safest&origin=30000142&balance=1000000000&taxPct=4.5&limit=1000';
  console.log('Fetching', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      weights: { income: 5, totalJumps: 5, danger: 5 },
      hauls: [],
      packages: []
    })
  });
  console.log('Status:', res.status);
  const data = await res.json() as any;
  console.log('Items count:', data.items?.length);
  console.log('Arbitrage count:', data.items?.filter((i: any) => i.kind === 'arbitrage').length);
  console.log('First 5 items:', JSON.stringify(data.items?.slice(0, 5), null, 2));
}
run();

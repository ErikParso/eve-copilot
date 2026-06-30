# sell contracts (Packages)

App should provide opportunities form Sell contracts. Sell contracts can be bought only whole, the price is fixed and its package containing multiple items of different type.

Te opportunity should be resolved same as Arbitrage item, except it will contain multiple items of different type to trade. Uer will sell all items in one station with order depth. If if items or partition of items cannot be sold there, its unit price is resolved as 0. 

All other functionalities are almost same as on arbitreage opportunities.

## pinning package cards and lifetime

planning stage - exactly same as on arbitreage card. Keep same update logic. Except the sell price is static, buy orders in destination can change and order depth has multiple items of different type. 

Transfering stage - by clicking on confirm buy button. Package content and price is static, so no confirmation modal with amounts and prices updaters. In transfering stage the content is in the ship (same route logic as on other card types).The buy orders in destination can change, resulting in increased, decreased ornegative income (same as arbitrage). User can click "sell elsewhere" and reroute to different destination (same as on arbitrage)

Finished stage - same as arbitrage, user click confirm sell and card enters the static mode. 

NOTES:
The functionality is identical with arbitrage opportiunities, except it "sell contract" has fixed price and fixed content and contains multiple item types to transfer and trade elsewhere. Try to leverage this existing functionality and logic as much as possible to reduce the codebase.

Fo package card use card-package.jpg

If possible, reuse crawlers to minimize 429 errors and throttles. If its better to make dedicated algorithm for sell contracts do so.
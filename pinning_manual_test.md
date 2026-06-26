1. courier contracts, when in transit stage are green 
green border should indicate the income increase, accepting courier contract does not increase income. should stay neutral color (blue).

2. confirming buy with much higher price results in negative income, but i see income 0 on card, even when tooltip says "Income dropped to zero: 1.8 M ISK → -12.2 M ISK. You can still confirm the buy/price you actually paid."
income 0 indicates player can get rid of items without lose but reality is he will lose 12mil. This is misleading, in transit state it should show negative value and not cap at 0.
further explanation:
in planning stage - update algorhitm caps at 0, no matching orders producing income = 0 amount and 0 income. This is valid there is no opportunity with income user can unpin this item.
in transfering stage - the items are already bought. User wants to sell them in set destination even with negative income (loss). Or can select alternative destination.

3. Pinned items affect each other, it should be separate independent entities. When i pin card with item X from station A to B. And pin second card With same item X from same Station A to station C. The card is immediately red. Probably because if shared orders between those cards. Don't want that for now. No shared orders.

// fix
// update the pinning.md
// update pinning_e2e_tests.md 
// make tests, confirm its working
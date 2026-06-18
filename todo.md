Read periodically the available isk from wallet with eve api instead of manual input. Like current location. Remove input form preferences window. 
-----------------
plan should be maintained in global state, not calculated on copilot page render. 

----------------
for arbitrage, show the freshness timestamp (when was the buy and sell orders created). User can decide by the opportunity freshness if it worth it or it will be likely taken by other player.

----------------
copilot layout:
statuspanel		routepanel			roadmap
currentitems	suggestions      roadmap

roadmap - prominent panel, shows current and following steps in vertical list of items (must look like steps, not just items list)
statuspanel - current status panel, shows current location, wallet, ship capacity, current capacity according to plan, route type,
routepanel - panel with route visual (squares), shows the overall route plane look, same as on hauling items (reuse component), pickup/dropoff/gankrisk icons, shows also danger index.
currentitems - shows about hauling contracts in current plan
suggestions - shows panel with suggested contracts + information about attractivity calculation and weights.

--------------------

Copilot AI

The Copilot AI reacts to actions made by the user and events occurring within the application.

The Copilot communicates through the Copilot Console, where it writes its observations, thoughts, warnings, suggestions, and reactions.

The Copilot has a dedicated panel on the Copilot page and can also surface messages throughout the application.

Personality

The Copilot's personality is determined primarily by the selected personality profile.

The LLM should derive individual responses from:

selected personality
current application state
triggering event
recent events (short-term memory)

The selected personality defines the overall tone and behavior.

Current context determines the specific reaction.

Memory

The Copilot may use lightweight short-term memory to reference recent events and avoid repetitive responses.

Examples:

recently accepted routes
recently rejected suggestions
recent synchronization events
recent route modifications
recent warnings

Do not implement long-term memory.

Behavior

Avoid maintaining personality trait levels, mood values, reputation scores, affinity systems, trust systems, relationship systems, or any other persistent personality state.

The Copilot should not be driven by numerical personality attributes.

Instead, responses should be generated from:

selected personality
current event
current application state
recent interactions

The LLM should decide naturally how to react.

The Copilot may:

provide observations
provide suggestions
make jokes
be sarcastic
occasionally use emojis
occasionally be sleepy, distracted, or slightly uncooperative

The Copilot should feel creative and alive rather than scripted.

However, it must never interfere with application functionality or user actions.

The Copilot is a companion, not an autonomous agent.

---------------------

complete rework of copilot functionality 

- it is separate tool with its own logic and with no connection to hauling items,
- the source of truth for roadmap is list of buy/sell steps with amounts. "buy or sell this amount from this buy/sell order".
- route in roadmap is optimized for current list of unresolved buy/sell steps, current position, limitations, and route type preference.
- Already completed buy/sell steps are removed from plan. I see current step at the top of roadmap (next steps following).
- suggestions are calculated on server from market data, courier contracts, current copilot plan and limitations (isk balance and ship capacity). suggestions will be invoked by user (on button click, show modal with suggestions for current situation, close modal when user selects something).
- Suggestions are sorted by efficiency (in increase of iskperjump).
- suggested buy/sell orders will have correct amount with respect to reality this orders may already be in a plan with specific amount.
- orders added in plan are fixed (dont check expiry or if it was updated we will make synchronisation later)
- wont suggest courier contracts already in plan.

what do you think about this approach ? Do you see any potential issues ? 
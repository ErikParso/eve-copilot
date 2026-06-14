istead arrow between pickup and dropoff, just add labels 
from: pickup name
to: dropoff name
show the total income value at the top of card. 

is the next update time correct ? How is it calculated ?

the filter inputs responsivity is too slow when there are results loaded. The value change causes rerender of results thats not good.
what do you suggest ?
A) make separate atoms for current filters and applied filters. Applied filter will be initialized to current filter and app will load results at start and whenever value in applied filter atom changes. On search click it will set current filters into applied filters atom, which will cause to reload items.
B) another better/simpler suggestion ??

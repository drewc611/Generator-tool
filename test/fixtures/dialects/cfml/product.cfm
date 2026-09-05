<cfoutput><h1>#product.name#</h1>
<cfif product.stock EQ 0><p class="out">Sold out</p><cfelseif product.stock LT 5><p class="low">Only #product.stock# left</p><cfelse><p>In stock</p></cfif>
<ul><cfloop array="#product.tags#" index="tag"><li>#tag#</li></cfloop><cfif ArrayIsEmpty(product.tags)><li class="none">No tags</li></cfif></ul></cfoutput>

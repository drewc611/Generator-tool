<cfsetting enablecfoutputonly="false">
<cfsilent>
  <cfset low = 5>
  <cfset title = "Shop: " & product.name>
  <cfparam name="url.q" default="">
</cfsilent>
<cfquery name="reviews" datasource="shop">
  SELECT body, author FROM reviews WHERE product_id = <cfqueryparam value="#product.id#" cfsqltype="cf_sql_integer">
</cfquery>
<cfscript>
  visits = visits + 1;
</cfscript>
<!DOCTYPE html>
<html>
<head><title><cfoutput>#title#</cfoutput></title></head>
<body>
<cfinclude template="includes/nav.cfm">
<main>
  <cfoutput>
  <h1>#product.name#</h1>
  <cfif product.stock EQ 0>
    <p class="out">Sold out</p>
  <cfelseif product.stock LT low>
    <p class="low">Only #product.stock# left</p>
  <cfelse>
    <p>In stock</p>
  </cfif>
  <p class="price">#DollarFormat(product.price)# #UCase(currency)#</p>
  <ul class="tags">
    <cfloop array="#product.tags#" item="tag" index="i">
      <li class="<cfif i EQ 1>first</cfif>">#i#/#ArrayLen(product.tags)#: #tag.name#</li>
    </cfloop>
    <cfif ArrayIsEmpty(product.tags)><li class="none">No tags</li></cfif>
  </ul>
  <cfswitch expression="#product.type#">
    <cfcase value="shoe,boot"><span class="badge">Footwear</span></cfcase>
    <cfcase value="hat"><span class="badge">Headwear</span></cfcase>
    <cfdefaultcase><span class="badge">#product.type#</span></cfdefaultcase>
  </cfswitch>
  <cfloop list="#product.colors#" index="color"><i class="swatch">#color#</i></cfloop>
  <p class="first">First tag: #product.tags[1].name#</p>
  <p class="q">Search: #HTMLEditFormat(url.q)#</p>
  <a class="buy" href="/cart/add?id=#product.id#" <cfif product.stock EQ 0>disabled</cfif>>Buy</a>
  <div class="description">#product.descriptionHtml#</div>
  </cfoutput>
  <cfoutput query="reviews">
    <blockquote>#body# - #author# (#currentRow# of #recordCount#)</blockquote>
  </cfoutput>
  <cfif reviews.recordCount EQ 0><p>No reviews yet.</p></cfif>
  <cfform action="/reviews" method="post">
    <cfinput type="text" name="body" required="yes" message="Say something">
    <cfinput type="submit" name="go" value="Send">
  </cfform>
  <cf_footer year="2020">Custom footer content</cf_footer>
  <p>Price: ##not an expression##</p>
  <p>Free shipping on every order.</p>
</main>
</body>
</html>

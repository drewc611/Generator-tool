<#ftl output_format="HTML">
<#-- the product page -->
<#import "/lib/utils.ftl" as u>
<#assign discounted = product.price lt product.list>
<#macro badge text><span class="badge">${text}</span></#macro>
<#include "includes/nav.ftlh">
<h1>${product.name}</h1>
<#if product.stock == 0>
  <p class="out">Sold out</p>
<#elseif product.stock lt 5>
  <p class="low">Only ${product.stock} left</p>
<#else>
  <p>In stock</p>
</#if>
<ul>
  <#list product.tags as tag>
    <li>${tag?upper_case}</li>
  <#else>
    <li class="none">No tags</li>
  </#list>
</ul>
<p>${product.tags?size} tags, ${product.note!"no note"}</p>
<#switch product.type>
  <#case "shoe"><p>Footwear</p><#break>
  <#default><p>Other</p>
</#switch>
<@badge text=product.type/>
<dl><#list product.specs as key, value><dt>${key}</dt><dd>${value}</dd></#list></dl>

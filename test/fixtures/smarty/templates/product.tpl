{extends file='layout.tpl'}
{* the product page *}
{block name=title}{$product.name|escape} - {$smarty.block.parent}{/block}
{block name=content}
  <h1>{$product.name}</h1>
  {assign var='low' value=5}
  {if $product.stock == 0}
    <p class="out">Sold out</p>
  {elseif $product.stock lt $low}
    <p class="low">Only {$product.stock} left</p>
  {else}
    <p>In stock</p>
  {/if}
  <p class="price">{$product.price|number_format:2} {$currency|default:'EUR'}</p>
  <ul class="tags">
  {foreach $product.tags as $tag}
    <li class="{if $tag@first}first{/if}{if $tag@last} last{/if}">{$tag@iteration}/{$tag@total}: {$tag.name|upper}</li>
  {foreachelse}
    <li class="none">No tags</li>
  {/foreach}
  </ul>
  {section name=i loop=$reviews}
    <blockquote>{$reviews[i].body|truncate:80} - {$reviews[i].author}</blockquote>
  {sectionelse}
    <p>No reviews yet.</p>
  {/section}
  {foreach from=$specs item=spec key=k name=specs}
    <dl><dt>{$k}</dt><dd>{$spec} ({$smarty.foreach.specs.iteration})</dd></dl>
  {/foreach}
  <p class="q">Search: {$smarty.get.q|escape}</p>
  {html_options name=size options=$sizes selected=$size}
  <p class="brace">Use { braces } freely; {ldelim}literal{rdelim}</p>
  {if $product.tags|@count gt 0 and $user}<a class="buy" href="/cart/add/{$product.id}">Buy</a>{/if}
{/block}
{block name=footer prepend}<span class="tel">Call us</span>{/block}

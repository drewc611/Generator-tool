<h1>{$product.name}</h1>
{if $product.stock == 0}<p class="out">Sold out</p>{elseif $product.stock < 5}<p class="low">Only {$product.stock} left</p>{else}<p>In stock</p>{/if}
<ul>{foreach $product.tags as $tag}<li>{$tag}</li>{foreachelse}<li class="none">No tags</li>{/foreach}</ul>

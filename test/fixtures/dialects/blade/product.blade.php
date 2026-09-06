<h1>{{ $product->name }}</h1>
@if($product->stock == 0)<p class="out">Sold out</p>@elseif($product->stock < 5)<p class="low">Only {{ $product->stock }} left</p>@else<p>In stock</p>@endif
<ul>@forelse($product->tags as $tag)<li>{{ $tag }}</li>@empty<li class="none">No tags</li>@endforelse</ul>

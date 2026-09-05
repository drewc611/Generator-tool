@extends('layouts.app')
@section('title', $product->name)
@section('content')
  {{-- the product page --}}
  <h1>{{ $product->name }}</h1>
  @if($product->stock === 0)
    <p class="out">Sold out</p>
  @elseif($product->stock < 5)
    <p class="low">Only {{ $product->stock }} left</p>
  @else
    <p>In stock</p>
  @endif
  @unless($product->active)<p class="hidden">Hidden</p>@endunless
  <ul>
    @forelse($product->tags as $tag)
      <li class="{{ $loop->first ? 'first' : '' }}">{{ strtoupper($tag) }}</li>
    @empty
      <li class="none">No tags</li>
    @endforelse
  </ul>
  @switch($product->type)
    @case('shoe') <p>Footwear</p> @break
    @default <p>Other</p>
  @endswitch
  @can('update', $product)<a href="{{ route('products.edit', $product) }}">Edit</a>@endcan
  <form method="post">@csrf @method('PUT')<button type="submit">Save</button></form>
  {!! $product->description_html !!}
  @error('name')<p class="error">{{ $message }}</p>@enderror
@endsection

<nav><a href="{{ route('home') }}">Home</a>@auth<span class="who">{{ auth()->user()->name }}</span>@endauth</nav>

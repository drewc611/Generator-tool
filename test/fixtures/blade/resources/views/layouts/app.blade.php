<!doctype html>
<html lang="en">
<head><title>@yield('title', config('app.name'))</title></head>
<body>
  @include('partials.nav')
  <main>@yield('content')</main>
</body>
</html>

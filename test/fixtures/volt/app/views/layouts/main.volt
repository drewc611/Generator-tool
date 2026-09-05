<!DOCTYPE html>
<html lang="en">
  <head><title>Shop</title></head>
  <body>
    {{ partial('partials/nav') }}
    <main>{{ content() }}</main>
    {{ flash.output() }}
  </body>
</html>

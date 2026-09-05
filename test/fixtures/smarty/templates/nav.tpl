<nav>
  <a href="/">Home</a>
  {if $user}<span class="who">{$user->name|escape}</span>{/if}
</nav>

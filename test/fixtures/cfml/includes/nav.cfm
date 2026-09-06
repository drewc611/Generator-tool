<!--- the shared navigation --->
<cfparam name="url.section" default="home">
<nav>
  <a href="/">Home</a>
  <cfif IsDefined("session.user")><cfoutput><span class="who">#session.user.name#</span></cfoutput></cfif>
</nav>

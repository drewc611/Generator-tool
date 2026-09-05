<%@ include file="header.jspf" %>
<nav>
  <a href="${ctx}/">Home</a>
  <c:if test="${not empty user}"><span class="who"><c:out value="${user.name}" /></span></c:if>
</nav>

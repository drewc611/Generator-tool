<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ include file="includes/header.jspf" %>
<%-- the product page --%>
<!DOCTYPE html>
<html>
<head><title><fmt:message key="product.title" /></title></head>
<body>
<jsp:include page="includes/nav.jsp"><jsp:param name="active" value="shop" /></jsp:include>
<% int visits = 1; %>
<main>
  <h1>${product.name}</h1>
  <c:set var="low" value="5" />
  <c:choose>
    <c:when test="${product.stock eq 0}"><p class="out"><fmt:message key="product.soldout" /></p></c:when>
    <c:when test="${product.stock lt low}"><p class="low">Only ${product.stock} left</p></c:when>
    <c:otherwise><p>In stock</p></c:otherwise>
  </c:choose>
  <p class="price"><fmt:formatNumber value="${product.price}" type="currency" /> ${currency}</p>
  <ul class="tags">
    <c:forEach var="tag" items="${product.tags}" varStatus="st">
      <li class="${st.first ? 'first' : ''}">${st.count}/${fn:length(product.tags)}: ${fn:toUpperCase(tag.name)}</li>
    </c:forEach>
    <c:if test="${empty product.tags}"><li class="none">No tags</li></c:if>
  </ul>
  <c:url var="buyUrl" value="/cart/add"><c:param name="id" value="${product.id}" /></c:url>
  <a class="buy" href="${buyUrl}" ${product.stock == 0 ? 'disabled' : ''}>Buy</a>
  <div class="description"><c:out value="${product.descriptionHtml}" escapeXml="false" /></div>
  <p class="q">Search: <c:out value="${param.q}" default="nothing" /></p>
  <form:form modelAttribute="review" action="/reviews" method="post">
    <form:label path="rating">Rating</form:label>
    <form:input path="rating" type="number" />
    <form:textarea path="body" cssClass="wide" />
    <form:select path="size" items="${sizes}" itemValue="id" itemLabel="label" />
    <form:errors path="body" cssClass="error" />
    <button type="submit"><fmt:message key="review.submit" /></button>
  </form:form>
  <p>Visits: <%= visits %></p>
  <my:widget id="w1">Custom tag content</my:widget>
  <p>Free shipping on every order.</p>
</main>
<footer><small>&copy; ${fn:substring(year, 0, 4)}</small></footer>
</body>
</html>

<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<h1>${product.name}</h1>
<c:choose><c:when test="${product.stock == 0}"><p class="out">Sold out</p></c:when><c:when test="${product.stock < 5}"><p class="low">Only ${product.stock} left</p></c:when><c:otherwise><p>In stock</p></c:otherwise></c:choose>
<ul><c:forEach var="tag" items="${product.tags}"><li>${tag}</li></c:forEach><c:if test="${empty product.tags}"><li class="none">No tags</li></c:if></ul>

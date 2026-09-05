<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:variable name="shop" select="/catalog/@name"/>
  <xsl:template match="/">
    <html>
      <head><title><xsl:value-of select="$shop"/></title></head>
      <body>
        <h1><xsl:value-of select="/catalog/@name"/></h1>
        <xsl:if test="count(/catalog/item) = 0"><p class="empty">Nothing for sale</p></xsl:if>
        <ul>
          <xsl:for-each select="/catalog/item">
            <xsl:sort select="price"/>
            <li>
              <xsl:attribute name="class"><xsl:value-of select="@kind"/></xsl:attribute>
              <a href="{@url}"><xsl:value-of select="name"/></a>
              <xsl:choose>
                <xsl:when test="price &gt; 100">dear</xsl:when>
                <xsl:when test="price &gt; 10">fair</xsl:when>
                <xsl:otherwise>cheap</xsl:otherwise>
              </xsl:choose>
              <xsl:call-template name="badge"/>
            </li>
          </xsl:for-each>
        </ul>
        <xsl:apply-templates select="/catalog/note"/>
      </body>
    </html>
  </xsl:template>
  <xsl:template name="badge"><span class="badge"><xsl:value-of select="position()"/></span></xsl:template>
  <xsl:template match="note"><p class="note"><xsl:value-of select="."/></p></xsl:template>
</xsl:stylesheet>

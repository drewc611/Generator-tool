/**
 * Which requests the console answers at all. A page on any other site can reach a
 * loopback server two ways: the browser sends a cross site request on the visitor's
 * behalf, or the page's own hostname is re pointed at 127.0.0.1 (DNS rebinding) so its
 * script reads the answers as if they were its own. The Host header gives the second
 * away, since the browser still sends the attacker's name, and Origin and Sec-Fetch-Site
 * give the first away. Returns the reason a request is refused, or null.
 *
 * In loopback mode the Host must be a loopback name on the port actually bound, because
 * nothing else guards that mode. With --lan the token guards every route and a phone
 * reaches the console by an address no list could name, so the Host is not listed; the
 * cross site rules below still hold, and the token check that follows is untouched.
 */
export function refuseRequest({ method = "GET", host, origin, secFetchSite, localPort, lan = false }) {
  const hostHeader = String(host ?? "").toLowerCase();
  if (!lan) {
    const allowed = ["localhost", "127.0.0.1", "[::1]"].map((name) => `${name}:${localPort}`);
    if (!allowed.includes(hostHeader)) return "the Host header is not a loopback address for this console";
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (secFetchSite !== undefined && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return "a request from another site cannot change this console";
  }
  if (origin !== undefined) {
    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      sameOrigin = parsed.protocol === "http:" && parsed.host.toLowerCase() === hostHeader;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return "a request from another origin cannot change this console";
  }
  return null;
}

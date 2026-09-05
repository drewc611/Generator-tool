// A little legacy behavior that sets cookies and never asks.
document.cookie = "session_id=abc123; path=/; Secure; SameSite=Strict";
document.cookie = "consent_seen=1; Secure";

if (window.Cookies) {
  Cookies.set("tracking_uid", "xyz789", { expires: 365 });
}

// A consent banner the site loaded but wired to nothing here.
window.cookieconsent && window.cookieconsent.initialise({});

// Legacy behavior that leaks onto the global object and left its debug output in.
window.APP_CONFIG = { env: "prod" };
window.trackEvent = function (name) {
  console.log("tracking", name);
};

var sharedCounter = 0;

function updateCounter() {
  sharedCounter += 1;
  console.debug("counter is", sharedCounter);
  debugger;
}

if (window.jQuery) {
  jQuery.fn.wobble = function () {
    console.warn("wobble is deprecated");
    return this;
  };
}

document.getElementById("go").addEventListener("click", function () {
  updateCounter();
  window.trackEvent("go");
});

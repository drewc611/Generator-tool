// Some legacy behavior with the sharp edges a security pass should name.
function doThing(event) {
  const raw = document.getElementById("out");
  raw.innerHTML = "<b>" + userInput() + "</b>";
  document.write("<span>rendered at " + Date.now() + "</span>");
  const fn = eval("(" + configExpr() + ")");
  return fn(event);
}

function userInput() {
  return new URLSearchParams(location.search).get("q") || "";
}

function configExpr() {
  return "1 + 1";
}

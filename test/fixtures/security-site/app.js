// Some legacy behavior with the sharp edges a security pass should name. The
// values are constants here so the fixture demonstrates the patterns without
// carrying a live taint flow of its own; dsp-security matches them structurally.
function doThing(event) {
  const raw = document.getElementById("out");
  raw.innerHTML = "<b>" + label() + "</b>";
  document.write("<span>rendered</span>");
  const fn = eval("(" + configExpr() + ")");
  return fn(event);
}

function label() {
  return "ready";
}

function configExpr() {
  return "1 + 1";
}

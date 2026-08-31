/**
 * Functions that run inside the page. Playwright serialises the source, so each
 * one has to be self contained: no imports, no closure over this module.
 */

/** What is on screen right now, in enough detail to tell two screens apart. */
export const SNAPSHOT = () => {
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const target = document.getElementById(labelled);
      if (target) return target.textContent.trim();
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    const closestLabel = el.closest("label");
    if (closestLabel) return closestLabel.textContent.trim();
    const text = (el.textContent || "").trim();
    if (text) return text.slice(0, 80);
    const alt = el.getAttribute("alt") || el.getAttribute("title");
    return alt ? alt.trim() : "";
  };

  const selectorFor = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += "." + [...node.classList].map((c) => CSS.escape(c)).join(".");
      const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const INTERACTIVE = "button, a[href], input, select, textarea, [role=button], [role=link], [onclick], [tabindex]";
  // A table row with a click handler attached in script matches no selector at
  // all. What it does have is cursor: pointer, which is the only signal a
  // legacy app reliably leaves behind that something is clickable.
  const CANDIDATE = INTERACTIVE + ", tr, li, [class*=row], [class*=item], [class*=card]";
  const clickable = (el) =>
    el.matches(INTERACTIVE) || window.getComputedStyle(el).cursor === "pointer";
  const elements = [...document.querySelectorAll(CANDIDATE)]
    .filter((el) => visible(el) && clickable(el))
    .slice(0, 120)
    .map((el) => {
      const box = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || null,
        role: el.getAttribute("role") || null,
        id: el.id || null,
        name: nameOf(el),
        selector: selectorFor(el),
        href: el.getAttribute("href") || null,
        placeholder: el.getAttribute("placeholder") || null,
        required: el.hasAttribute("required"),
        disabled: Boolean(el.disabled),
        // Whether a label element actually points at this control, which is
        // what a screen reader needs and a placeholder does not provide.
        labelled: Boolean(
          el.getAttribute("aria-label") ||
            el.getAttribute("aria-labelledby") ||
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
            el.closest("label")
        ),
        // Position and tab index make the focus order checkable offline: the
        // reading order comes from x and y, the tab order from the DOM and
        // any explicit tabindex.
        box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
        tabindex: el.hasAttribute("tabindex") ? parseInt(el.getAttribute("tabindex"), 10) : null,
        color: style.color,
        background: style.backgroundColor,
        fontSize: parseFloat(style.fontSize),
      };
    });

  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .filter(visible)
    .map((el) => el.textContent.trim())
    .slice(0, 20);

  const regions = [...document.querySelectorAll("section, main, form, [role=region], [role=main]")]
    .filter(visible)
    .map((el) => el.id || el.getAttribute("role") || el.tagName.toLowerCase())
    .slice(0, 20);

  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200);

  const styleSample = [...document.querySelectorAll("body, h1, h2, h3, p, td, th, label, button, input, li, span")]
    .filter(visible)
    .slice(0, 400)
    .map((el) => {
      const s = window.getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        fontSize: parseFloat(s.fontSize),
        fontWeight: s.fontWeight,
        color: s.color,
        background: s.backgroundColor,
        radius: parseFloat(s.borderTopLeftRadius) || 0,
        padY: parseFloat(s.paddingTop) || 0,
        height: Math.round(el.getBoundingClientRect().height),
      };
    });

  const rowHeights = [...document.querySelectorAll("tr")]
    .filter(visible)
    .slice(0, 60)
    .map((r) => Math.round(r.getBoundingClientRect().height));

  const table = [...document.querySelectorAll("table")].filter(visible)[0] || null;
  const collection = table
    ? {
        columns: [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim()),
        rows: table.querySelectorAll("tbody tr").length,
      }
    : null;

  return {
    url: location.pathname + location.search,
    title: document.title,
    headings,
    regions,
    elements,
    collection,
    text,
    font: window.getComputedStyle(document.body).fontFamily,
    pageBackground: window.getComputedStyle(document.body).backgroundColor,
    sample: styleSample,
    rowHeights,
  };
};

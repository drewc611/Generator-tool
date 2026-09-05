import m from "mithril";

export function Badge() {
  return {
    view: ({ attrs }) => m("span.badge", { title: attrs.label }, attrs.label),
  };
}

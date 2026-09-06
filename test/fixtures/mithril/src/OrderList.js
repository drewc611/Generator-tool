import m from "mithril";
import { Badge } from "./Badge.js";

const state = { q: "", orders: [], loaded: false };

export const OrderList = {
  oninit(vnode) {
    m.request({ method: "GET", url: "/api/orders" }).then((rows) => { state.orders = rows; state.loaded = true; });
  },
  view(vnode) {
    return m("section.orders#main", { role: "region" }, [
      m("h1", vnode.attrs.title),
      m("input", { type: "search", value: state.q, oninput: (e) => { state.q = e.target.value; } }),
      state.loaded ? m("p.count", state.orders.length, " orders") : null,
      m("ul", state.orders.map((order, i) =>
        m("li", { key: order.id, class: order.late ? "late" : "", onclick: () => vnode.attrs.onPick(order) }, [
          m("span.n", i),
          m(Badge, { label: order.status, onClear: () => vnode.attrs.onClear(order) }),
          order.note && m("em", order.note),
          m.trust(order.html),
        ]))),
      m("button", { disabled: !state.loaded, onclick: () => vnode.attrs.onRefresh() }, "Refresh"),
    ]);
  },
};

import m from "mithril";
import { OrderList } from "./OrderList.js";

m.mount(document.body, { view: () => m(OrderList, { title: "Orders", onPick: () => {}, onClear: () => {}, onRefresh: () => {} }) });

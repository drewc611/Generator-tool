// Depends back on orders, closing the cycle. Also a long promise chain a port
// could read as a sequence of awaits.
import { placeOrder } from "./orders.js";
import { format } from "./util.js";

export function charge(order, done) {
  fetch("/rate")
    .then((r) => r.json())
    .then((rate) => applyRate(order, rate))
    .then((amount) => settle(amount))
    .then((receipt) => done(null, format(receipt)))
    .catch((err) => done(err));
}

export function retry(order) {
  return placeOrder(order, () => {});
}

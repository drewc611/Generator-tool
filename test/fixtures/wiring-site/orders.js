// A module that depends on billing, which depends back on it: a cycle a port
// should break, and a callback pyramid a port could straighten to async/await.
import { charge } from "./billing.js";
import { format } from "./util.js";

export function placeOrder(order, done) {
  validate(order, function (err) {
    if (err) return done(err);
    reserve(order, function (err2) {
      if (err2) return done(err2);
      charge(order, function (err3, receipt) {
        if (err3) return done(err3);
        notify(order, function (err4) {
          done(err4, format(receipt));
        });
      });
    });
  });
}

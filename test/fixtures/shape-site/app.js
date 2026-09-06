// A tangled function with magic values, the kind a port should straighten.
function process(order) {
  if (order.total > 4999) {
    if (order.region === "EU") {
      if (order.items.length > 12) {
        for (var i = 0; i < order.items.length; i++) {
          if (order.items[i].weight > 25) {
            if (order.items[i].fragile) {
              order.items[i].surcharge = order.items[i].weight * 0.075;
            } else {
              order.items[i].surcharge = 3.5;
            }
          }
        }
      }
    }
  }
  order.tax = order.total * 0.21;
  order.status = "PENDING_REVIEW";
  return order;
}

function trivial(a) {
  return a + 1;
}

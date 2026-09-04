function OrderDesk() {
  var self = this;
  self.q = ko.observable("");
  self.loading = ko.observable(false);
  self.orders = ko.observableArray([]);

  self.reload = function () {
    self.loading(true);
    $.getJSON("/api/v4/orders", function (rows) {
      self.orders(rows);
      self.loading(false);
    });
  };

  self.pick = function (o) {
    $.post("/api/v4/orders/pick", { id: o.id });
  };

  self.reload();
}
ko.applyBindings(new OrderDesk());

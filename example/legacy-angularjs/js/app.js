angular.module("orderDesk", [])
  .controller("OrdersCtrl", function ($scope, $http) {
    $scope.orders = [];
    $scope.chosen = null;
    $scope.loading = false;

    $scope.reload = function () {
      $scope.loading = true;
      $http.get("/api/v3/orders").then(function (res) {
        $scope.orders = res.data;
        $scope.loading = false;
      });
    };

    $scope.pick = function (o) {
      $scope.chosen = o.id;
      $http.post("/api/v3/orders/seen", { id: o.id });
    };

    $scope.reload();
  })
  .component("orderBadge", {
    bindings: { count: "<", onClear: "&" },
    template: "<span class=\"badge\" ng-click=\"$ctrl.onClear()\">{{ $ctrl.count }}</span>",
  });

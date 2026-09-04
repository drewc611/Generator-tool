// Order Desk, circa whenever this was somebody's whole week.
$(function () {
  function load() {
    $.ajax({
      url: "/api/v1/orders",
      type: "GET",
      data: { q: $("#q").val() },
      success: function (rows) {
        $("#rows").html(rows.map(rowHtml).join(""));
        $("#count").text(rows.length);
      },
    });
  }

  function rowHtml(o) {
    return "<tr data-id='" + o.id + "'><td>" + o.id + "</td><td>" + o.total + "</td></tr>";
  }

  $("#refresh").on("click", function () { load(); });
  $("#q").on("change", function () { load(); });

  $("#order-form").on("submit", function (e) {
    e.preventDefault();
    $("#form-error").hide();
    $.post("/api/v1/orders", { customer: $("#customer").val() })
      .fail(function () { $("#form-error").text("Could not save").show(); });
  });

  window.onhashchange = function () { load(); };
  load();
});

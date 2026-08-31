// A stand in for a legacy system that is still running and whose source is
// gone. Zero dependencies so it starts anywhere the tool does.
import { createServer } from "node:http";

const ORDERS = [
  { id: "A-1001", customer: "Northwind", status: "open", total: 4210.5, region: "us-east" },
  { id: "A-1002", customer: "Contoso", status: "shipped", total: 118.0, region: "us-east" },
  { id: "A-1003", customer: "Fabrikam", status: "open", total: 990.25, region: "us-west" },
];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Orders Portal</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 14px; color: #1b1f24; background: #fbfaf8; margin: 0; }
  header { background: #004b87; color: #fff; padding: 12px 20px; font-size: 18px; }
  main { padding: 20px; max-width: 900px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th { text-align: left; color: #6b675f; font-size: 13px; padding: 10px; }
  td { padding: 12px 10px; border-top: 1px solid #e3dfd8; }
  tr { height: 44px; }
  tbody tr { cursor: pointer; }
  .muted { color: #bbbbbb; font-size: 12px; }
  .pill { background: #f4f2ee; border-radius: 6px; padding: 2px 8px; color: #004b87; }
  button { background: #004b87; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; }
  .icon { width: 24px; height: 24px; padding: 0; font-size: 12px; }
  input { border: 1px solid #e3dfd8; border-radius: 6px; padding: 8px; font-size: 14px; }
  .err { color: #a3231f; font-size: 13px; }
  .hide { display: none; }
</style></head>
<body>
<header>Orders Portal</header>
<main>
  <section id="list-screen">
    <!-- an input with no label, only a placeholder -->
    <input id="q" placeholder="Filter by customer" />
    <button id="search">Search</button>
    <!-- a button whose only content is a glyph: no accessible name -->
    <button class="icon" id="refresh">&#8635;</button>
    <p id="loading" class="muted">Loading orders…</p>
    <table id="orders" class="hide">
      <thead><tr><th>Reference</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <p class="muted">Showing orders for the current account.</p>
    <button id="new-order">New order</button>
  </section>

  <section id="create-screen" class="hide">
    <h2>New order</h2>
    <label for="customer">Customer</label>
    <input id="customer" />
    <p id="customer-err" class="err hide">Customer is required</p>
    <button id="submit">Create order</button>
    <button id="cancel">Cancel</button>
  </section>

  <section id="detail-screen" class="hide">
    <h2 id="detail-title"></h2>
    <p id="detail-body" class="muted"></p>
    <button id="back">Back to orders</button>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const show = (id) => $(id).classList.remove("hide");
  const hide = (id) => $(id).classList.add("hide");

  async function load(q) {
    show("loading"); hide("orders");
    // No error branch at all: a failed fetch leaves the spinner up forever.
    const res = await fetch("/api/v1/orders" + (q ? "?q=" + encodeURIComponent(q) : ""));
    const data = await res.json();
    const rows = $("rows");
    rows.innerHTML = "";
    for (const o of data) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td>' + o.id + '</td><td>' + o.customer +
        '</td><td><span class="pill">' + o.status + '</span></td><td>' + o.total + '</td>';
      tr.addEventListener("click", () => openDetail(o.id));
      rows.appendChild(tr);
    }
    hide("loading"); show("orders");
    // When data is empty the table simply renders no rows and says nothing.
  }

  async function openDetail(id) {
    const res = await fetch("/api/v1/orders/" + id);
    const o = await res.json();
    $("detail-title").textContent = "Order " + o.id;
    $("detail-body").textContent = o.customer + " — " + o.status + " — " + o.total;
    hide("list-screen"); show("detail-screen");
  }

  $("search").addEventListener("click", () => load($("q").value));
  $("refresh").addEventListener("click", () => load($("q").value));
  $("new-order").addEventListener("click", () => { hide("list-screen"); show("create-screen"); });
  $("cancel").addEventListener("click", () => { hide("create-screen"); show("list-screen"); });
  $("back").addEventListener("click", () => { hide("detail-screen"); show("list-screen"); });
  $("submit").addEventListener("click", async () => {
    const name = $("customer").value.trim();
    if (!name) { show("customer-err"); return; }
    hide("customer-err");
    await fetch("/api/v1/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer: name }),
    });
    hide("create-screen"); show("list-screen"); load("");
  });

  load("");
</script>
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/orders") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(PAGE);
  }
  if (url.pathname === "/api/v1/orders" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const out = q ? ORDERS.filter((o) => o.customer.toLowerCase().includes(q)) : ORDERS;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(out));
  }
  if (url.pathname.startsWith("/api/v1/orders/") && req.method === "GET") {
    const id = url.pathname.split("/").pop();
    const found = ORDERS.find((o) => o.id === id);
    res.writeHead(found ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(found || { error: "not found" }));
  }
  if (url.pathname === "/api/v1/orders" && req.method === "POST") {
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "A-1004", status: "open" }));
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const port = Number(process.argv[2] || 8731);
server.listen(port, () => process.stdout.write(`blackbox app on http://127.0.0.1:${port}\n`));

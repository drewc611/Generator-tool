/**
 * The labelled training corpus, one miniature per archetype.
 *
 * These are the same eleven miniatures the calibration fixtures hold, embedded
 * here so the model is self contained: the plugin trains from its own data at
 * run time without reaching into the test tree. test/learn.test.js asserts this
 * copy stays byte equal to test/fixtures/corpus, so the two can never drift.
 *
 * Each label is a human judgment, not a measurement. The model learns to place a
 * new screen among these; it does not decide what the labels should be.
 */

export const CORPUS = [
  {
    label: "calendar",
    html: '<button>Previous week</button><button>Next week</button><table><tr><th>Monday</th><th>Tuesday</th><th>Wednesday</th></tr><tr><td *ngFor="let day of week">{{day.total}}</td></tr></table>',
    calls: [{ method: "GET", path: "/api/events?from=2024-01-01&to=2024-01-07" }],
    model: { screens: [{ kind: "grid" }], endpoints: [{ method: "GET", path: "/api/events", query: ["from", "to"] }] },
  },
  {
    label: "chat",
    html: '<ul><li *ngFor="let m of messages">{{m.text}}</li></ul><form (submit)="send()"><input [(ngModel)]="draft" placeholder="Message"><button type="submit">Send</button></form>',
    calls: [{ method: "GET", path: "/api/messages" }, { method: "POST", path: "/api/messages" }],
  },
  {
    label: "crud-table",
    html: '<table><tr *ngFor="let o of orders"><td>{{o.id}}</td><td><button (click)="remove(o)">Delete</button></td></tr></table>',
    calls: [
      { method: "GET", path: "/api/orders" },
      { method: "POST", path: "/api/orders" },
      { method: "DELETE", path: "/api/orders/${id}" },
    ],
  },
  {
    label: "dashboard",
    html: "<h2>Revenue</h2><canvas></canvas><h2>Signups</h2><canvas></canvas><h2>Errors</h2><canvas></canvas><h2>Latency</h2>",
    calls: [
      { method: "GET", path: "/api/metrics/revenue" },
      { method: "GET", path: "/api/metrics/signups" },
      { method: "GET", path: "/api/metrics/errors" },
    ],
  },
  {
    label: "editor",
    html: '<h1>{{doc.title}}</h1><div contenteditable="true">{{doc.body}}</div><button (click)="save()">Save draft</button><span *ngIf="savedAt">Saved</span>',
    calls: [{ method: "PUT", path: "/api/documents/:id" }],
    model: { screens: [{ kind: "document" }] },
  },
  {
    label: "form-entry",
    html: '<form (submit)="save()"><input [(ngModel)]="name"><input [(ngModel)]="email"><select [(ngModel)]="country"></select><button type="submit">Submit</button></form>',
    calls: [{ method: "POST", path: "/api/applications" }],
  },
  {
    label: "kanban",
    html: '<div *ngFor="let col of board"><h3>{{col.name}}</h3><div *ngFor="let card of col.cards">{{card.title}}</div></div><p>Backlog, In Progress, Done</p>',
    calls: [{ method: "GET", path: "/api/cards" }, { method: "PUT", path: "/api/cards/${id}/status" }],
  },
  {
    label: "master-detail",
    html: '<ul><li *ngFor="let c of customers"><a [routerLink]="c.id">{{c.name}}</a></li></ul><a href="/archive">archive</a>',
    calls: [{ method: "GET", path: "/api/customers" }, { method: "GET", path: "/api/customers/${id}" }],
  },
  {
    label: "search-and-filter",
    html: '<input [(ngModel)]="q" placeholder="Search products"><select [(ngModel)]="category"></select><ul><li *ngFor="let p of results">{{p.name}}</li></ul>',
    calls: [{ method: "GET", path: "/api/products?q=term&category=x&sort=asc" }],
  },
  {
    label: "selector-soup",
    html: '<div id="app"><div id="toolbar"></div><div id="rows"></div><div id="count"></div></div>',
    calls: [{ method: "GET", path: "/api/rows" }],
    widgets: [
      { selector: "#refresh", events: ["click"], writes: [] },
      { selector: "#rows", events: [], writes: ["html"] },
      { selector: "#count", events: [], writes: ["text"] },
      { selector: "#toolbar .filter", events: ["change"], writes: [] },
      { selector: "#rows tr", events: ["click"], writes: [] },
      { selector: "#status", events: [], writes: ["text"] },
    ],
    components: 0,
    model: null,
  },
  {
    label: "wizard",
    html: '<p>Step 2 of 4</p><p>Step</p><input [(ngModel)]="ssn"><input [(ngModel)]="dob"><button>Continue</button>',
    calls: [{ method: "POST", path: "/api/enrollment" }],
    model: { screens: [{ kind: "form" }, { kind: "form" }, { kind: "form" }], transitions: [{ from: "a", to: "b" }, { from: "b", to: "c" }] },
  },
];

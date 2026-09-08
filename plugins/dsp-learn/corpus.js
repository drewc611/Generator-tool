/**
 * The labelled training corpus, three miniatures per archetype.
 *
 * These are the same miniatures the calibration fixtures hold, embedded here so
 * the model is self contained: the plugin trains from its own data at run time
 * without reaching into the test tree. Two per class was what first made a leave
 * one out cross validation defined; a third per class is the corpus growing per
 * ROADMAP.md's own plan, and it makes that validation less brittle, since a held
 * out exemplar now leaves two siblings of its class behind rather than one.
 * test/learn.test.js asserts this copy stays equal to test/fixtures/corpus, so
 * the two can never drift.
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
  // A second labelled miniature per archetype, so a held out cross validation is
  // defined: with two examples per class, leaving one out still leaves its class
  // represented. Each also classifies as its label under the rule based reader.
  {"label":"crud-table","html":"<table><tr *ngFor=\"let u of users\"><td>{{u.name}}</td><td><button (click)=\"edit(u)\">Edit</button><button (click)=\"remove(u)\">Delete</button></td></tr></table>","calls":[{"method":"GET","path":"/api/users"},{"method":"PUT","path":"/api/users/${id}"},{"method":"DELETE","path":"/api/users/${id}"}]},
  {"label":"master-detail","html":"<ul><li *ngFor=\"let p of products\"><a [routerLink]=\"p.id\">{{p.title}}</a></li></ul><a href=\"/all\">all products</a>","calls":[{"method":"GET","path":"/api/products"},{"method":"GET","path":"/api/products/${id}"}]},
  {"label":"search-and-filter","html":"<input [(ngModel)]=\"term\" placeholder=\"Search jobs\"><select [(ngModel)]=\"location\"></select><select [(ngModel)]=\"level\"></select><ul><li *ngFor=\"let j of jobs\">{{j.title}}</li></ul>","calls":[{"method":"GET","path":"/api/jobs?term=x&location=y&level=z&sort=recent"}]},
  {"label":"form-entry","html":"<form (submit)=\"submit()\"><input [(ngModel)]=\"fullName\"><input [(ngModel)]=\"phone\"><textarea [(ngModel)]=\"message\"></textarea><button type=\"submit\">Send</button></form>","calls":[{"method":"POST","path":"/api/contact"}]},
  {"label":"wizard","html":"<p>Step 3 of 5</p><p>Step</p><input [(ngModel)]=\"card\"><input [(ngModel)]=\"expiry\"><button>Continue</button>","calls":[{"method":"POST","path":"/api/checkout"}],"model":{"screens":[{"kind":"form"},{"kind":"form"},{"kind":"form"},{"kind":"form"}],"transitions":[{"from":"a","to":"b"},{"from":"b","to":"c"},{"from":"c","to":"d"}]}},
  {"label":"dashboard","html":"<h2>Active users</h2><canvas></canvas><h2>Sessions</h2><svg></svg><h2>Bounce rate</h2><canvas></canvas><h2>Conversions</h2>","calls":[{"method":"GET","path":"/api/stats/active"},{"method":"GET","path":"/api/stats/sessions"},{"method":"GET","path":"/api/stats/bounce"}]},
  {"label":"kanban","html":"<div *ngFor=\"let lane of lanes\"><h3>{{lane.title}}</h3><div *ngFor=\"let task of lane.tasks\">{{task.name}}</div></div><p>Todo, Doing, Done lanes</p>","calls":[{"method":"GET","path":"/api/tasks"},{"method":"PUT","path":"/api/tasks/${id}/lane"}]},
  {"label":"calendar","html":"<button>Previous month</button><button>Next month</button><table><tr><th>Sunday</th><th>Monday</th><th>Tuesday</th></tr><tr><td *ngFor=\"let d of days\">{{d.count}}</td></tr></table>","calls":[{"method":"GET","path":"/api/bookings?start=2024-02-01&end=2024-02-29"}],"model":{"screens":[{"kind":"grid"}],"endpoints":[{"method":"GET","path":"/api/bookings","query":["start","end"]}]}},
  {"label":"chat","html":"<ul><li *ngFor=\"let m of thread\">{{m.body}}</li></ul><form (submit)=\"reply()\"><input [(ngModel)]=\"text\" placeholder=\"Reply\"><button type=\"submit\">Send</button></form>","calls":[{"method":"GET","path":"/api/thread"},{"method":"POST","path":"/api/thread"}]},
  {"label":"editor","html":"<h1>{{note.title}}</h1><div contenteditable=\"true\">{{note.body}}</div><button (click)=\"save()\">Save draft</button><span *ngIf=\"savedAt\">Autosaved</span>","calls":[{"method":"PUT","path":"/api/notes/:id"}],"model":{"screens":[{"kind":"document"}]}},
  {"label":"selector-soup","html":"<div id=\"root\"><div id=\"header\"></div><div id=\"list\"></div><div id=\"footer\"></div></div>","calls":[{"method":"GET","path":"/api/list"}],"widgets":[{"selector":"#reload","events":["click"],"writes":[]},{"selector":"#list","events":[],"writes":["html"]},{"selector":"#footer","events":[],"writes":["text"]},{"selector":"#header .search","events":["keyup"],"writes":[]},{"selector":"#list .row","events":["click"],"writes":[]},{"selector":"#total","events":[],"writes":["text"]}],"components":0,"model":null},
  // A third labelled miniature per archetype. Two made a leave one out cross
  // validation defined; a third makes it less brittle, since a held out
  // exemplar now leaves two siblings of its own class behind rather than one.
  // Each of these also classifies as its label under the rule based reader.
  {"label":"crud-table","html":"<table><tr *ngFor=\"let t of tasks\"><td>{{t.title}}</td><td><button (click)=\"toggle(t)\">Complete</button><button (click)=\"remove(t)\">Delete</button></td></tr></table>","calls":[{"method":"GET","path":"/api/tasks"},{"method":"PUT","path":"/api/tasks/${id}"},{"method":"DELETE","path":"/api/tasks/${id}"}]},
  {"label":"master-detail","html":"<ul><li *ngFor=\"let a of articles\"><a [routerLink]=\"a.id\">{{a.title}}</a></li></ul><a href=\"/drafts\">drafts</a>","calls":[{"method":"GET","path":"/api/articles"},{"method":"GET","path":"/api/articles/${id}"}]},
  {"label":"search-and-filter","html":"<input [(ngModel)]=\"keyword\" placeholder=\"Search flights\"><select [(ngModel)]=\"origin\"></select><select [(ngModel)]=\"destination\"></select><ul><li *ngFor=\"let f of flights\">{{f.route}}</li></ul>","calls":[{"method":"GET","path":"/api/flights?keyword=x&origin=y&destination=z&sort=price"}]},
  {"label":"form-entry","html":"<form (submit)=\"apply()\"><input [(ngModel)]=\"firstName\"><input [(ngModel)]=\"lastName\"><input [(ngModel)]=\"email\"><button type=\"submit\">Apply</button></form>","calls":[{"method":"POST","path":"/api/candidates"}]},
  {"label":"wizard","html":"<p>Step 1 of 3</p><p>Step</p><input [(ngModel)]=\"company\"><input [(ngModel)]=\"taxId\"><button>Continue</button>","calls":[{"method":"POST","path":"/api/onboarding"}],"model":{"screens":[{"kind":"form"},{"kind":"form"},{"kind":"form"}],"transitions":[{"from":"a","to":"b"},{"from":"b","to":"c"}]}},
  {"label":"dashboard","html":"<h2>Traffic</h2><canvas></canvas><h2>Conversions</h2><canvas></canvas><h2>Refunds</h2><svg></svg><h2>Uptime</h2>","calls":[{"method":"GET","path":"/api/metrics/traffic"},{"method":"GET","path":"/api/metrics/conversions"},{"method":"GET","path":"/api/metrics/refunds"}]},
  {"label":"kanban","html":"<div *ngFor=\"let stage of pipeline\"><h3>{{stage.name}}</h3><div *ngFor=\"let deal of stage.deals\">{{deal.name}}</div></div><p>Backlog, Active, Done board</p>","calls":[{"method":"GET","path":"/api/deals"},{"method":"PUT","path":"/api/deals/${id}/column"}]},
  {"label":"calendar","html":"<button>Previous week</button><button>Next week</button><table><tr><th>Room A</th><th>Room B</th><th>Room C</th></tr><tr><td *ngFor=\"let slot of slots\">{{slot.status}}</td></tr></table>","calls":[{"method":"GET","path":"/api/reservations?date=2024-03-01&room=all"}],"model":{"screens":[{"kind":"grid"}],"endpoints":[{"method":"GET","path":"/api/reservations","query":["date","room"]}]}},
  {"label":"chat","html":"<ul><li *ngFor=\"let n of notes\">{{n.body}}</li></ul><form (submit)=\"post()\"><input [(ngModel)]=\"draft\" placeholder=\"Reply to thread\"><button type=\"submit\">Send</button></form>","calls":[{"method":"GET","path":"/api/notes"},{"method":"POST","path":"/api/notes"}]},
  {"label":"editor","html":"<h1>{{page.title}}</h1><div contenteditable=\"true\">{{page.body}}</div><button (click)=\"publish()\">Save draft</button><span *ngIf=\"savedAt\">Saved</span>","calls":[{"method":"PUT","path":"/api/pages/:id"}],"model":{"screens":[{"kind":"document"}]}},
  {"label":"selector-soup","html":"<div id=\"shell\"><div id=\"nav\"></div><div id=\"grid\"></div><div id=\"summary\"></div></div>","calls":[{"method":"GET","path":"/api/grid"}],"widgets":[{"selector":"#refresh-grid","events":["click"],"writes":[]},{"selector":"#grid","events":[],"writes":["html"]},{"selector":"#summary","events":[],"writes":["text"]},{"selector":"#nav .tab","events":["click"],"writes":[]},{"selector":"#grid .cell","events":["click"],"writes":[]},{"selector":"#status","events":[],"writes":["text"]}],"components":0,"model":null},
];

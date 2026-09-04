import { Component, Input } from "@angular/core";
@Component({
  selector: "app-inbox",
  template: `<p>You have {{ count }} unread messages</p><p>Total: {{ items.length * 2 }} rows</p>`,
})
export class InboxComponent { @Input() count = 0; @Input() items: any[] = []; }

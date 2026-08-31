import { Component, Input, Output, EventEmitter } from "@angular/core";

@Component({
  selector: "order-row",
  template: `<tr (click)="pick()"><td>{{ order.id }}</td><td>{{ order.total }}</td></tr>`,
})
export class OrderRowComponent {
  @Input() order: any;
  @Output() selected = new EventEmitter<any>();
  pick() { this.selected.emit(this.order); }
}

import { Component, Input } from "@angular/core";

@Component({
  selector: "orders-list",
  template: `
    <table>
      <order-row *ngFor="let o of orders" [order]="o" (selected)="open($event)"></order-row>
    </table>
    <mystery-widget [thing]="x"></mystery-widget>
  `,
})
export class OrdersListComponent {
  @Input() orders: any[] = [];
  open(o: any) {}
  x = 1;
}

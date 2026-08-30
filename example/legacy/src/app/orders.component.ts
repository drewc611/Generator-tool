import { Component, Input, Output, EventEmitter } from '@angular/core';
import { switchMap, debounceTime, BehaviorSubject } from 'rxjs';

@Component({
  selector: 'app-orders',
  template: `
    <div *ngIf="loading">Loading</div>
    <table><tr *ngFor="let o of orders"><td>{{o.id}}</td></tr></table>
    <input [(ngModel)]="query" />
  `,
})
export class OrdersComponent {
  @Input() accountId: string;
  @Output() selected = new EventEmitter<string>();
}

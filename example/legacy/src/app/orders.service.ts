import { Injectable } from '@angular/core';
import { HttpClient, HttpInterceptor } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  constructor(private http: HttpClient) {}
  list(accountId: string) { return this.http.get<Order[]>('/api/v1/accounts/orders'); }
  create(body: any) { return this.http.post('/api/v1/orders', body); }
  cancel(id: string) { return this.http.delete('/api/v1/orders/cancel'); }
}

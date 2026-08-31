import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";
import { OrdersComponent } from "./orders.component";

const routes: Routes = [
  { path: "", redirectTo: "orders", pathMatch: "full" },
  { path: "orders", component: OrdersComponent },
  { path: "admin", loadChildren: () => import("./admin/admin.module").then((m) => m.AdminModule) },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}

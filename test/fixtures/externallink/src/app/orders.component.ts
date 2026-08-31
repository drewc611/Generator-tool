import { Component } from '@angular/core';

@Component({
  selector: 'app-external',
  // A documentation link is not an endpoint. The gate must not refuse this.
  template: `<a href="https://docs.example.com/orders">Help</a>`,
})
export class ExternalComponent {}

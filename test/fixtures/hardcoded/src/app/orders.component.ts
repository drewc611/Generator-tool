import { Component } from '@angular/core';

@Component({
  selector: 'app-hardcoded',
  // The defect this fixture exists for: the template links straight at the
  // endpoint, so the path would be baked into the ported component.
  template: `
    <a href="https://docs.example.com/orders">Help</a>
    <a href="/api/v1/orders">Download all orders</a>
  `,
})
export class HardcodedComponent {}

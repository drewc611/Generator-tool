import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";

export default class UserCard extends Component {
  @tracked query = "";
  @tracked busy = false;
  @tracked selected = null;
  @tracked error = null;

  get loading() { return this.args.users == null; }

  @action pick(user) { this.selected = user; this.args.onPick?.(user); }
  @action save() { this.busy = true; fetch("/api/users").then(() => { this.busy = false; }); this.args.onSave(this.query); }
  @action cancel() { this.query = ""; }
}

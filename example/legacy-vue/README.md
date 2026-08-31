# example/legacy-vue

The same orders screen as `example/legacy`, written in Vue instead of Angular.

It exists to prove the claim the plugin classes make: `input-vue` puts the same
shape on the context that `input-angular` does, and the template translator, the
endpoint map and the React emitter were all written against Angular without
knowing this file would ever exist.

# Changelog

## Unreleased
- Fix: a component whose controller detaches its element before it returns (a controller write that re-renders the parent removes it) stops that attach and disposes the controller. It used to go on with no scope and throw "Cannot read properties of undefined (reading 'subscribe')" from its first binding.
- Tests use `+` for string concatenation: `@punyts/expression` removed `+++`.
- A bound `style` attribute is written through `element.style.cssText` instead of `setAttribute`, so it applies under a Content-Security-Policy whose `style-src` has no `'unsafe-inline'` (the preview runtime page). Before, every bound `style` was refused there, which left `--sui-count`, field widths, progress values and grid spans unset.
- An expression evaluation reads its scope's base object from the store once, however many names it looks up there.

## 0.2.0
- Fix (AMM-1808): `<sui-node>` removes its child without a `SUI-NODE-MISSING` report when the node it rendered is deleted (the value at its path is gone). A node that never rendered, a node that exists with a missing or empty `component`, a resolver failure and an unknown component are still reported.
- **Dynamic indexers.** `$.a[$.k].b` subscribes to the entry `$.k` currently selects and moves the subscription when `$.k` changes, so a change inside the entry updates the binding; no wildcard listener is added (AMM-1645).
- Requires `@punyts/expression` 1.4.0 (grouping and JavaScript precedence).

## 0.1.0
- **Row scoping.** `state="{{ $v }}"` is accepted when the whole value is one iterator local, so a component in a `repeat` takes its row as its base path and is re-scoped when a keyed row moves (AMM-1640).
- **`<sui-node>`.** Renders the component the node at its `state` path names, through the resolver set with `setNodeResolver`, and replaces it when `component` changes; a missing node reports `SUI-NODE-MISSING` (AMM-1641).
- **Node presentation.** `<sui-node>` writes `placement`, `layout`, `theme` (through the mapper set with `setNodeOptions`) and the properties `reflect` names as attributes and custom properties on the element it creates (AMM-1643).
- Requires `@punyts/state` 1.2.0.

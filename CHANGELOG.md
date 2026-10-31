# Changelog

## 0.2.0
- **Dynamic indexers.** `$.a[$.k].b` subscribes to the entry `$.k` currently selects and moves the subscription when `$.k` changes, so a change inside the entry updates the binding; no wildcard listener is added (AMM-1645).
- Requires `@punyts/expression` 1.4.0 (grouping and JavaScript precedence).

## 0.1.0
- **Row scoping.** `state="{{ $v }}"` is accepted when the whole value is one iterator local, so a component in a `repeat` takes its row as its base path and is re-scoped when a keyed row moves (AMM-1640).
- **`<sui-node>`.** Renders the component the node at its `state` path names, through the resolver set with `setNodeResolver`, and replaces it when `component` changes; a missing node reports `SUI-NODE-MISSING` (AMM-1641).
- **Node presentation.** `<sui-node>` writes `placement`, `layout`, `theme` (through the mapper set with `setNodeOptions`) and the properties `reflect` names as attributes and custom properties on the element it creates (AMM-1643).
- Requires `@punyts/state` 1.2.0.

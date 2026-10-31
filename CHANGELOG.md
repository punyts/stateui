# Changelog

## 0.1.0
- **Row scoping.** `state="{{ $v }}"` is accepted when the whole value is one iterator local, so a component in a `repeat` takes its row as its base path and is re-scoped when a keyed row moves (AMM-1640).
- **`<sui-node>`.** Renders the component the node at its `state` path names, through the resolver set with `setNodeResolver`, and replaces it when `component` changes; a missing node reports `SUI-NODE-MISSING` (AMM-1641).
- **Node presentation.** `<sui-node>` writes `placement`, `layout`, `theme` (through the mapper set with `setNodeOptions`) and the properties `reflect` names as attributes and custom properties on the element it creates (AMM-1643).
- Requires `@punyts/state` 1.2.0.

# @punyts/stateui

A state-driven, browser-based user interface system. Components are custom elements whose templates and styles bind to
a [`@punyts/state`](https://github.com/punyts/state) store. A write to the store patches the DOM before the write
returns, and StateUI never reads layout.

```ts
import { createStore } from '@punyts/state';
import { defineComponent, mount } from '@punyts/stateui';

defineComponent({
    tag: 'todo-list',
    template: `
        <h2>{{ $.title }}</h2>
        <ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.text }}</li></ul>
        <p if="{{ $.items.length == 0 }}">Nothing to do</p>`,
    styles: 'h2 { color: {{ $.accent }}; }',
});

const store = createStore({ title: 'Today', accent: 'teal', items: [] });
mount(document.querySelector('#app')!, store);
document.querySelector('#app')!.append(document.createElement('todo-list'));
store.state.items.push({ id: 1, text: 'Write the README' }); // the <li> exists when this line returns
```

## Install and build

StateUI is developed inside the ai-minion workspace, where `libraries/*` are npm workspaces (`bin/setup.sh` clones
them).

- Build `@punyts/state` and `@punyts/expression` first. StateUI consumes them through their `dist/` output, so on a
  fresh checkout run `npm run build` at the ai-minion root, which builds every library in dependency order.
- `npm run build` in `libraries/stateui` typechecks the package and emits `dist/`.
- The browser test suite needs Playwright's Chromium: `npx playwright install chromium`, which downloads browser
  binaries.

### Required dependency versions

| Package | Range in `package.json` | Why |
| --- | --- | --- |
| `@punyts/state` | `^1.1.0` | 1.1.0 has the reactive-emit fixes (AMM-1582) and the array-mutator fixes through proxies (AMM-1584). |
| `@punyts/expression` | `^1.3.0` | 1.1.0 has the `$`-named iterator locals in `filter` and `sort` (AMM-1583). The exported `CompiledExpression` type (AMM-1586) and object literals and `?:` arrive by 1.3.0, which StateUI's templates use. |
| `@punyts/core` | `^1.0.0` | The reporter that every StateUI error goes through. |

## Template syntax

Templates are XHTML strings. `{{ … }}` holds a `@punyts/expression` expression; `$` is the component's base path
in the store (see [The `state` attribute](#the-state-attribute)).

| Construct | Example | Notes |
| --- | --- | --- |
| Text | `<p>Hi {{ $.name }}</p>` | Text nodes only; values are never parsed as HTML. |
| Attribute | `<a title="{{ $.tip }}" href="/u/{{ $.id }}">` | A string, number or boolean is written as an attribute; `null`/`undefined`/`false` removes it and `true` sets it to `""`. `javascript:` URLs in `href`, `src`, `action` and `formaction` are refused. |
| Property | `<my-card item="{{ $.item }}">` | An object or function value is assigned as a property (`el.item`), names camel-cased. |
| Event | `<button onclick="{{ $.save }}">` | One native listener; a bind function such as `{{ ($v) => $.select }}` is called with its bound arguments, then the event. |
| Conditionals | `<b if="{{ $.a }}">a</b><i ifelse="{{ $.b }}">b</i><u else="">c</u>` | Adjacent siblings form one chain; only the first true branch is in the DOM. |
| Repeat | `<li repeat="{{ $k,$i,$v in $.items }}">{{ $v.name }}</li>` | `$k` key, `$i` position, `$v` value. `for` instead of `in` counts: `{{ $k,$i for $.count }}`. |
| Keyed repeat | `repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}"` | Items are moved, not re-rendered, when the order changes. `in` also iterates a plain object map (`$k` the key, `$v` the entry, insertion order): `repeat="{{ $k,$i,$v in $.map }}" key="{{ $k }}"`. |
| Sort and filter | `repeat="{{ $k,$i,$v in $.items sort $v.price desc filter $v.stock > 0 }}"` | `sort` takes a field name (`sort name`) or an iterator-local path (`sort $v.price`), then optionally `asc` (default) or `desc`. |
| Two-way binding | `<input value="{{ $.name }}" bind="value" />` | `bind` names a sibling `{{ }}` attribute: `value`, `checked` or `valueAsNumber`. Input and change events write the variable's store path. |
| Mixin | `<div tooltip="{{ $.help }}">` | A registered attribute directive; see [Mixins](#mixins). |

`<script>` and `<style>` are refused in templates. Styles go through the `styles` option.

### XHTML escaping rules

Templates are parsed as strict XML, which trips up anyone used to HTML:

- Escape `<` as `&lt;` and `&` as `&amp;` in text and attribute values, also inside `{{ }}`:
  `{{ $.a &lt; 3 &amp;&amp; $.b }}`.
- Self-close void elements: `<input />`, `<br />`, `<img />`.
- Only the five XML entities exist: `&lt; &gt; &amp; &quot; &apos;`. Write `&nbsp;` as `&#160;`.

A parse error is a `TemplateParseError` with the line, the column and the offending source line, thrown by
`defineComponent`.

## Components and controller

```ts
defineComponent({
    tag: 'user-card',           // lowercase, with a hyphen
    template: '<p>{{ $.name }} <button onclick="{{ greet }}">Hi</button></p>',
    shadow: 'open',             // 'open' (default), 'closed', or false for light DOM
    styles: ':host { display: block; }',
    controller: ({ element, store, basePath, scope, state }) => ({
        greet: () => console.log(`Hello ${state.name}`),
        dispose: () => { /* runs on detach */ },
    }),
});
```

- The template and styles are compiled once, at `defineComponent`. Template and style errors surface there as
  `TemplateCompileError` and `StyleCompileError`.
- The controller runs on every attach, before the template is instantiated. Its members (except `dispose`) become
  scope locals, so the template references them without `$.`. A member that shadows a state property is reported,
  and the local wins.
- A controller that throws is reported and the component renders nothing; its siblings are unaffected.

## `mount`, `unmount` and store discovery

`mount(host, store, path = '$')` makes `host` a root. A component finds its store by walking up from itself,
crossing shadow roots, to the nearest mounted root or attached component, and takes that root's or component's
base path. A component connected before any root is above it waits, then attaches as soon as one is mounted.

`unmount(host)` detaches every component scoped from that root: bindings are disposed, rendered nodes removed, and
still-connected components wait for a root again. Removing a component from the DOM detaches it the same way.

## The `state` attribute

`<user-card state="…">` sets the component's base path relative to its parent's:

| Value | Base path |
| --- | --- |
| *(none)* | the parent's base path |
| `$.users.0` | absolute |
| `.owner` | a child of the parent's base path |
| `..sibling` | a sibling: one dot more goes one level up |

The value is a literal path, with one exception: inside a `repeat`, `state="{{ $v }}"` (the whole value is one iterator
local) scopes the component to that entry's absolute store path, e.g. `$.map.k42` or `$.list.3`. A row that moves
(keyed repeat) is re-scoped to its new path. The local must have a store path (an entry of a store collection in a
repeat without `filter` on primitives); otherwise the error is reported and the component renders nothing. Any other
`{{ }}` in `state`, including `{{ $v.owner }}`, throws `TemplateCompileError`. Changing the attribute re-scopes the
component synchronously. An invalid path is reported and the component renders nothing.

## `<sui-node>`: render the component a node names

`<sui-node state="$.nodes.a">` renders whatever the node at its `state` path names. It reads `component` at that path,
asks the node resolver for a tag, and creates that element as its only child with the same absolute `state` path, so
the child scopes exactly as if a template had named it. When `component` changes the child is removed (and disposed)
and a new one is created; a change to any other property is left to the child's own bindings, and nothing is
re-rendered. `<sui-node>` is defined by the library and sets `display: contents`, so the element it creates is the grid
or flex item of the container that holds it. Stylesheets select it as `[layout=region] > sui-node > [region=nw]`.
It nests inside component templates (slots, keyed-map `repeat` with `state="{{ $v }}"`), and removing it disposes the
child.

The component library is not known to StateUI: the application registers the resolver once.

```ts
import { setNodeResolver } from '@punyts/stateui';

setNodeResolver((name) => name === 'button' ? 'ui-button' : undefined); // name => tag | undefined
```

A path with no node, a node with no `component`, or a name the resolver does not know renders nothing and reports
`SUI-NODE-MISSING` through the `@punyts/core` reporter, with the state path. `setNodeResolver(undefined)` removes the
resolver. A node already rendered keeps its element until its `component` changes or it is re-attached.

## Styles

The `styles` option takes component CSS with native nesting. In shadow DOM every instance of a class shares one
constructed sheet (a `<style>` per instance where constructable sheets aren't available). Light-DOM components get
their CSS nested under the tag in one counted `<style>` per document or shadow root, with `:host` rewritten to `&`.
Comments are dropped.

**Declaration values: the custom-property model.** A declaration whose value contains `{{ }}` is emitted as
`property: var(--sui-<classId>-<n>)`, and the whole composed value is set on the host as that custom property, one
variable per declaration. `margin: {{ $.y }}px 0` works because the variable holds `10px 0`, not `10`.

```css
.card { border: 1px solid {{ $.accent }}; padding: {{ $.gap }}px; }
```

`{{` inside a CSS string is still an expression: `content: "{{ $.label }}"`.

**Dynamic selectors and preludes.** A selector with `{{ }}`, or an `@media`, `@supports` or `@container` prelude with
`{{ }}`, renders into a sheet per instance, adopted after the shared sheet. Only that rule is rebuilt when its
values change.

```css
.item-{{ $.selected }} { font-weight: 700; }
@media (min-width: {{ $.breakpoint }}px) { .grid { columns: 2; } }
```

- Selector values are escaped as CSS identifiers, so a value can never add rules.
- Prelude values may contain only letters, digits, `_ . % ( ) : -` and spaces. Otherwise the rule is skipped and
  reported.
- In light DOM the instance gets a `data-sui` attribute, and its rules are scoped by it.

**Iterator rules: `@each`.** The only iterator-rule syntax is the custom at-rule
`@each {{ $k,$i,$v in … }} { … }`. It is never emitted to a stylesheet; its body is rendered once per item, in item
order, in the per-instance sheet.

```css
@each {{ $k,$i,$v in $.rows }} {
    .row-{{ $v.id }} { background: {{ $v.color }}; }
}
```

- Selectors and declaration values may use the iterator locals.
- Item values become custom properties `--sui-<classId>-<n>-<position>` on the host. Positions past the end are
  removed when the collection shrinks.
- An empty collection renders no rules and no properties.
- `@each` can't nest, and at-rule preludes inside `@each` can't contain `{{ }}`.

`{{ }}` is never allowed in a property name, a comment, or anywhere in `@keyframes`, `@font-face`, `@import`, `@charset`
or `@namespace`. Those errors, and `{{ }}` in any other at-rule prelude (`@for {{ … }}`), throw `StyleCompileError`
with the line. In light DOM, `@keyframes`, `@font-face` and similar at-rules stay at the top level, so their names are
global to the document or shadow root they are in.

## Mixins

```ts
import { registerMixin } from '@punyts/stateui';

registerMixin('tooltip', (element, attrs, scope) => {
    element.setAttribute('aria-label', String(attrs.tooltip));
    //for reactivity: listen to store variables through the scope, and stop on dispose
    const subscription = scope.subscribe(['$.help'], () => element.setAttribute('aria-label', String(scope.store.get(`${scope.basePath}.help`))));
    return () => subscription.dispose();
});
```

- Register mixins before `defineComponent`. Templates are matched against the registry when compiled, so a later
  registration doesn't apply to templates already compiled.
- `attrs` is a record of every registered-mixin attribute of the element: the evaluated value for `{{ }}` attributes,
  the literal text otherwise. It is evaluated once, at attach.
- A mixin that wants changes subscribes itself through `scope.subscribe` and returns a disposer, which runs once on
  dispose.
- A mixin name can't be a built-in (`if`, `ifelse`, `else`, `repeat`, `key`, `bind`, `state`) or start with `on`.

## The synchronous and write-only contract

- **Synchronous.** Every store write form (`store.state.x = …`, `store.set`, `store.delete`, `store.replace`,
  `proxy.__set`, `proxy.__apply`, `proxy.__replace`) has patched the DOM, the custom properties and the dynamic sheets
  before it returns. There is no scheduler, microtask or animation frame, and a `display:none` subtree is patched like
  any other.
- **Write-only.** StateUI never reads layout (`offset*`, `client*`, `scroll*`, `getBoundingClientRect`,
  `getComputedStyle`) and never uses `innerHTML` or `eval`. A binding writes only when its value changed
  (`Object.is`).
- **Isolated errors.** A binding whose expression throws is reported through the `@punyts/core` reporter and keeps
  its last value; the other bindings on the same path still update in the same emit.
- **Quiet otherwise.** A write to a path nothing is bound to, or to a tree that has been unmounted, causes no DOM
  mutation.

`src/guarantees.browser.test.ts` checks each of these in Chromium; `src/guarantees.test.ts` scans the source for
layout reads, async code, `eval` and `innerHTML`.

## Known limitations and costs

- **Write cost.** StateUI registers no wildcard listeners, except one `<collection>.$all` listener for each repeat that
  uses `sort` or `filter`. `@punyts/state` still scans every registered wildcard on each emit, so a write costs
  O(wildcards + listeners on the path).
- **Array mutators.** `push`, `splice`, `sort` and the other mutators emit once per index they touch, so observers
  (including `repeat`) see intermediate states during one call. For bulk changes prefer `proxy.__replace(newArray)`,
  `store.replace(path, newArray)` or `store.set` of the whole array. The array-mutator bugs recorded by Epic 2 are
  fixed in `@punyts/state` 1.1.0; no follow-up limitation remains.
- **Multiple emits.** One store call can notify a binding more than once (`delete('a.b')` emits `$.a.b` and then
  `$.a`); the equality check keeps the DOM from being written twice.
- **Dynamic indexers.** `$.a[$.k].b` subscribes to `$.a`, its ancestors and `$.k`. It updates when `$.k` changes or the
  entry (or an ancestor) is replaced, but not when only `$.a.<k>.b` changes inside the entry.
- **Object-valued properties.** A property binding holding an object (`item="{{ $.item }}"`) doesn't re-run when only
  fields inside the object change, because the store emits only on the changed leaves. It re-runs when the object or
  an ancestor is replaced or deleted.
- **Custom-property values.** A value that is invalid for the property using it makes that declaration `unset` (the
  browser's invalid-at-computed-value-time rule). A value the browser rejects outright, such as one with `}`, leaves
  the previous value in place.
- **Duplicate `repeat` keys.** With `key`, the first entry with a given key owns it. Later entries with the same key
  get a fresh item on every update, and a duplicate key from different objects is reported once per update; duplicate
  primitive keys are always reported.
- **Sort and filter cost.** A repeat with `sort` or `filter` re-runs when any item field changes.
- **Mixin attributes** are evaluated once, at attach.
- **Removing a middle `@each` item** rewrites the rules after it, because the item properties are named by position.
- **Light-DOM `:host(…)`** is rewritten to `&…` only when the argument has no `{{ }}`.

## Tests

```bash
npm test              # unit tests in happy-dom
npm run test:browser  # browser tests in headless Chromium (needs: npx playwright install chromium)
```

From the ai-minion root: `npm test -w @punyts/stateui` and `npm run test:browser -w @punyts/stateui`. The root
`npm test` doesn't run library suites, and CI doesn't run the browser suite.

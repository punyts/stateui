import { addListener, removeListener, type ListenerFn } from '@punyts/core';
import { createStore, type Store } from '@punyts/state';
import { mount, unmount } from './component/context.js';
import { defineComponent } from './component/define.js';
import type { StateUIElement } from './component/StateUIElement.js';

/**
 * Runtime guarantees in a real browser: every write form patches the DOM before it returns, hidden subtrees are
 * patched too, no layout is read, a throwing binding is isolated, and unbound or unmounted paths cause no mutation.
 * Every DOM assertion after a write is the next statement: no await, Promise or timer in between
 */

let counter = 0;
const nextTag = () => `x-guarantee-${++counter}`;

//one of every confirmed construct: text, attribute, property, if/else, keyed repeat, custom-property style,
//dynamic-selector style and @each style
const TEMPLATE = `
<span class="text">{{ $.title }}</span>
<span class="attr" title="{{ $.title }}"></span>
<span class="prop" config="{{ $.config }}"></span>
<b class="branch" if="{{ $.show }}">yes</b><i class="branch" else="">no</i>
<ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.name }}</li></ul>
<p class="sel-a">a</p>
`;
const STYLES = `
p { color: {{ $.color }}; }
.sel-{{ $.sel }} { font-weight: 700; }
@each {{ $k,$i,$v in $.items }} { .row-{{ $v.id }} { outline-color: {{ $v.tint }}; } }
`;

const initialState = () => ({
    title: 'one',
    config: { size: 1 },
    show: true,
    items: [{ id: 'a', name: 'A', tint: 'red' }, { id: 'b', name: 'B', tint: 'blue' }],
    color: 'red',
    sel: 'a',
    unrelated: 0,
});

interface Fixture {
    store: Store<any>;
    host: HTMLElement;
    element: StateUIElement;
    root: ShadowRoot;
    text: () => string;
    attr: () => string | null;
    prop: () => unknown;
    branch: () => string;
    list: () => string[];
    colorProperty: () => string;
    selectors: () => string[];
}

const createFixture = (container: HTMLElement = document.body, template = TEMPLATE): Fixture => {
    const tag = nextTag();
    defineComponent({ tag, template, styles: STYLES });
    const store = createStore<any>(initialState());
    const host = container.appendChild(document.createElement('div'));
    mount(host, store);
    const element = host.appendChild(document.createElement(tag)) as StateUIElement;
    const root = element.shadowRoot!;
    const classId = (customElements.get(tag) as typeof StateUIElement).classId!;
    const query = (selector: string) => root.querySelector(selector)!;
    return {
        store,
        host,
        element,
        root,
        text: () => query('.text').textContent!,
        attr: () => query('.attr').getAttribute('title'),
        prop: () => (query('.prop') as unknown as { config: unknown }).config,
        branch: () => query('.branch').textContent!,
        list: () => Array.from(root.querySelectorAll('li'), (item) => item.textContent!),
        colorProperty: () => element.style.getPropertyValue(`--sui-${classId}-0`),
        selectors: () => Array.from(root.adoptedStyleSheets.at(-1)!.cssRules, (rule) => (rule as CSSStyleRule).selectorText),
    };
};

describe('runtime guarantees in Chromium', () => {
    afterEach(() => {
        for (const host of Array.from(document.body.querySelectorAll('div'))) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    describe('every write form patches the DOM before it returns', () => {
        it('should render the fixture with every construct', () => {
            // Arrange & Act
            const fixture = createFixture();

            // Assert
            expect(fixture.text()).toBe('one');
            expect(fixture.attr()).toBe('one');
            expect((fixture.prop() as { size: number }).size).toBe(1);
            expect(fixture.branch()).toBe('yes');
            expect(fixture.list()).toEqual(['A', 'B']);
            expect(fixture.colorProperty()).toBe('red');
            expect(fixture.selectors()).toEqual(['.sel-a', '.row-a', '.row-b']);
        });

        it('should patch on store.state.x = …', () => {
            const { store, text, attr } = createFixture();

            store.state.title = 'two';
            expect(text()).toBe('two');
            expect(attr()).toBe('two');
        });

        it('should patch on store.set', () => {
            const { store, branch, colorProperty, selectors } = createFixture();

            store.set('show', false);
            expect(branch()).toBe('no');
            store.set('color', 'blue');
            expect(colorProperty()).toBe('blue');
            store.set('sel', 'z');
            expect(selectors()[0]).toBe('.sel-z');
        });

        it('should patch on proxy.__set', () => {
            const { store, list, selectors } = createFixture();

            //a leading dot makes the path relative to the proxy
            store.state.items.__set('.1.name', 'B2');
            expect(list()).toEqual(['A', 'B2']);
            store.state.items.__set('.1.id', 'c');
            expect(selectors()).toEqual(['.sel-a', '.row-a', '.row-c']);
        });

        it('should patch on proxy.__apply', () => {
            const { store, prop } = createFixture();

            store.state.config.__apply({ size: 2 });
            expect((prop() as { size: number }).size).toBe(2);
        });

        it('should patch on proxy.__replace', () => {
            const { store, list, selectors } = createFixture();

            store.state.items.__replace([{ id: 'c', name: 'C', tint: 'green' }]);
            expect(list()).toEqual(['C']);
            expect(selectors()).toEqual(['.sel-a', '.row-c']);
        });

        it('should patch on store.replace', () => {
            const { store, prop, list } = createFixture();

            store.replace('config', { size: 3 });
            expect((prop() as { size: number }).size).toBe(3);
            store.replace('items', [{ id: 'z', name: 'Z', tint: 'red' }]);
            expect(list()).toEqual(['Z']);
        });

        it('should patch on store.delete', () => {
            const { store, text, colorProperty } = createFixture();

            store.delete('title');
            expect(text()).toBe('');
            store.delete('color');
            expect(colorProperty()).toBe('');
        });
    });

    it('should patch a display:none subtree synchronously and show the current values when made visible', () => {
        // Arrange
        const container = document.body.appendChild(document.createElement('section'));
        container.style.display = 'none';
        const { store, root, text, branch, list, colorProperty } = createFixture(container);

        // Act
        store.set('title', 'hidden');
        store.set('show', false);
        store.state.items.push({ id: 'c', name: 'C', tint: 'green' });
        store.set('color', 'blue');

        // Assert
        expect(text()).toBe('hidden');
        expect(branch()).toBe('no');
        expect(list()).toEqual(['A', 'B', 'C']);
        expect(colorProperty()).toBe('blue');
        container.style.display = '';
        expect((root.querySelector('.text') as HTMLElement).innerText).toBe('hidden');
        expect(getComputedStyle(root.querySelector('p')!).color).toBe('rgb(0, 0, 255)');
        expect(root.querySelectorAll('li')).toHaveLength(3);
    });

    describe('no layout reads', () => {
        const restores: Array<() => void> = [];
        const counts = new Map<string, number>();

        const countCalls = (target: object, name: string, label: string) => {
            const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
            counts.set(label, 0);
            const bump = () => counts.set(label, counts.get(label)! + 1);
            if (descriptor.get) {
                const get = descriptor.get;
                Object.defineProperty(target, name, { ...descriptor, get(this: unknown) { bump(); return get.call(this); } });
            }
            else {
                const value = descriptor.value as (...args: unknown[]) => unknown;
                Object.defineProperty(target, name, { ...descriptor, value(this: unknown, ...args: unknown[]) { bump(); return value.apply(this, args); } });
            }
            restores.push(() => Object.defineProperty(target, name, descriptor));
        };

        afterEach(() => {
            restores.splice(0).forEach((restore) => restore());
            counts.clear();
        });

        it('should read no layout during 50+ writes covering every binding kind', () => {
            // Arrange
            const { store } = createFixture();
            for (const name of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) {
                countCalls(HTMLElement.prototype, name, name);
            }
            for (const name of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft', 'getBoundingClientRect', 'getClientRects']) {
                countCalls(Element.prototype, name, name);
            }
            countCalls(window, 'getComputedStyle', 'getComputedStyle');

            // Act
            for (let index = 0; index < 10; index++) {
                store.set('title', `t${index}`);
                store.set('config', { size: index });
                store.set('show', index % 2 === 0);
                store.set('items', [{ id: `i${index}`, name: `N${index}`, tint: 'red' }, { id: 'b', name: 'B', tint: 'blue' }]);
                store.set('color', index % 2 ? 'red' : 'blue');
                store.set('sel', `s${index}`);
            }

            // Assert
            expect(Object.fromEntries(counts)).toEqual(Object.fromEntries(Array.from(counts.keys(), (name) => [name, 0])));
        });
    });

    it('should report a throwing binding and still update its siblings on the same path in the same emit', () => {
        // Arrange
        const errors: string[] = [];
        const listener: ListenerFn = (_timestamp, _category, message) => {
            errors.push(String(message));
        };
        addListener(listener, 'error');
        const { store, root, text } = createFixture(document.body, `${TEMPLATE}<em class="bad">{{ $.title.missing() }}</em>`);
        errors.length = 0;

        try {
            // Act
            store.set('title', 'next');

            // Assert
            expect(text()).toBe('next');
            expect(root.querySelector('.attr')!.getAttribute('title')).toBe('next');
            expect(errors).toHaveLength(1);
        }
        finally {
            removeListener(listener, 'error');
        }
    });

    describe('no DOM mutation without a bound path', () => {
        const observe = (fixture: Fixture) => {
            const observer = new MutationObserver(() => undefined);
            const options: MutationObserverInit = { subtree: true, childList: true, attributes: true, characterData: true };
            observer.observe(document.body, options);
            observer.observe(fixture.root, options);
            return observer;
        };

        it('should not mutate the DOM for a write to a path nothing is bound to', () => {
            // Arrange
            const fixture = createFixture();
            const observer = observe(fixture);

            // Act
            fixture.store.set('unrelated', 1);

            // Assert
            expect(observer.takeRecords()).toEqual([]);
            observer.disconnect();
        });

        it('should not patch an unmounted tree', () => {
            // Arrange
            const fixture = createFixture();
            const { root } = fixture;
            const observer = observe(fixture);
            unmount(fixture.host);
            observer.takeRecords();

            // Act
            fixture.store.set('title', 'after');
            fixture.store.set('show', false);
            fixture.store.set('items', []);
            fixture.store.set('color', 'blue');

            // Assert
            expect(observer.takeRecords()).toEqual([]);
            expect(root.querySelector('.text')).toBeNull();
            observer.disconnect();
        });
    });
});

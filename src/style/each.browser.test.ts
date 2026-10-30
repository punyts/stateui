import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import { StyleCompileError } from '../errors.js';
import { escapeIdent } from './escape.js';

let counter = 0;
//a unique tag per test, since custom elements can't be redefined
const nextTag = (name: string) => `x-each-${name}-${++counter}`;

const ROW_STYLES = '@each {{ $k,$i,$v in $.items }} { .row-{{ $v.id }} { color: {{ $v.color }}; } }';
const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

//the item-scoped custom properties on a host, by name
const itemProperties = (element: HTMLElement) => Array.from(element.style).filter((name) => name.startsWith('--sui-'));
const selectors = (sheet: CSSStyleSheet) => Array.from(sheet.cssRules, (rule) => (rule as CSSStyleRule).selectorText);

const items = (...ids: string[]) => ids.map((id, position) => ({ id, color: position % 2 ? 'blue' : 'red' }));

describe('@each iterator-generated rules in Chromium', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    const render = (state: Record<string, unknown>, template = '<p class="row-a">a</p><p class="row-b">b</p><p class="row-c">c</p>') => {
        const tag = nextTag('rows');
        defineComponent({ tag, template, styles: ROW_STYLES });
        const { store, host } = createRoot(state);
        const element = host.appendChild(document.createElement(tag));
        const [dynamic] = element.shadowRoot!.adoptedStyleSheets;
        const color = (id: string) => getComputedStyle(element.shadowRoot!.querySelector(`.row-${id}`)!).color;
        return { store, element, dynamic, color };
    };

    it('should generate one rule per item in item order, each reading its own item-scoped property', () => {
        // Arrange & Act
        const { element, dynamic, color } = render({ items: items('a', 'b', 'c') });

        // Assert
        expect(selectors(dynamic)).toEqual(['.row-a', '.row-b', '.row-c']);
        expect(itemProperties(element)).toHaveLength(3);
        expect(color('a')).toBe(RED);
        expect(color('b')).toBe(BLUE);
        expect(color('c')).toBe(RED);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should add one rule and one property when an item is appended, before the write returns', () => {
        // Arrange
        const { store, element, dynamic, color } = render({ items: items('a', 'b') });
        expect(dynamic.cssRules).toHaveLength(2);

        // Act
        store.set('items', items('a', 'b', 'c'));

        // Assert
        expect(selectors(dynamic)).toEqual(['.row-a', '.row-b', '.row-c']);
        expect(itemProperties(element)).toHaveLength(3);
        expect(color('c')).toBe(RED);
    });

    it('should remove the last rule and property when an item is removed', () => {
        // Arrange
        const { store, element, dynamic } = render({ items: items('a', 'b', 'c') });
        const [first] = Array.from(dynamic.cssRules);

        // Act
        store.set('items', items('a', 'c'));

        // Assert
        expect(selectors(dynamic)).toEqual(['.row-a', '.row-c']);
        expect(dynamic.cssRules[0]).toBe(first);
        expect(itemProperties(element)).toHaveLength(2);
        expect(element.style.getPropertyValue(itemProperties(element)[0].replace(/-\d+$/, '-2'))).toBe('');
    });

    it('should re-render only the item whose field changed', () => {
        // Arrange
        const { store, dynamic, color } = render({ items: items('a', 'b', 'c') });
        const [first, , third] = Array.from(dynamic.cssRules);

        // Act
        store.set('items.1.id', 'c');

        // Assert
        expect(selectors(dynamic)).toEqual(['.row-a', '.row-c', '.row-c']);
        expect(dynamic.cssRules[0]).toBe(first);
        expect(dynamic.cssRules[2]).toBe(third);
        expect(color('b')).toBe('rgb(0, 0, 0)');
    });

    it('should escape hostile ids into a single rule per item', () => {
        // Arrange
        const hostile = 'x{}body{display:none}';

        // Act
        const { element, dynamic } = render({ items: [{ id: hostile, color: 'red' }, { id: '1st', color: 'blue' }] });

        // Assert
        //the escaped leading digit is valid mid-identifier, and Chromium serialises it unescaped
        expect(selectors(dynamic)).toEqual([`.row-${escapeIdent(hostile)}`, '.row-1st']);
        expect(selectors(dynamic).some((selector) => selector.includes('body') && !selector.startsWith('.row-'))).toBe(false);
        expect(getComputedStyle(document.body).display).not.toBe('none');
        expect(itemProperties(element)).toHaveLength(2);
    });

    it('should produce no rules and no item properties for an empty collection, without error', () => {
        // Arrange
        const { store, element, dynamic } = render({ items: items('a', 'b') });

        // Act
        store.set('items', []);

        // Assert
        expect(dynamic.cssRules).toHaveLength(0);
        expect(itemProperties(element)).toHaveLength(0);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should report a missing collection and keep the last rendered items, as repeat does', () => {
        // Arrange
        const { store, element, dynamic } = render({ items: items('a', 'b') });

        // Act
        store.set('items', undefined);

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(dynamic.cssRules).toHaveLength(2);
        expect(itemProperties(element)).toHaveLength(2);
    });

    it('should keep static item rules, ancestors and the light-DOM instance prefix', () => {
        // Arrange
        const tag = nextTag('light');
        defineComponent({
            tag,
            shadow: false,
            template: '<p class="row-a">a</p>',
            styles: '@media screen { @each {{ $k,$i,$v in $.items }} { :host .row-{{ $v.id }} { color: {{ $v.color }}; } } }',
        });
        const { host } = createRoot({ items: items('a') });

        // Act
        const element = host.appendChild(document.createElement(tag));

        // Assert
        const id = element.getAttribute('data-sui')!;
        const style = document.head.querySelector<HTMLStyleElement>(`style[data-sui-dynamic="${id}"]`)!;
        expect(style.sheet!.cssRules).toHaveLength(1);
        expect(style.sheet!.cssRules[0].cssText).toContain(`[data-sui="${id}"]`);
        expect(getComputedStyle(element.querySelector('.row-a')!).color).toBe(RED);
        element.remove();
        expect(itemProperties(element)).toHaveLength(0);
        expect(document.head.querySelector(`style[data-sui-dynamic="${id}"]`)).toBeNull();
    });

    it('should remove the item properties and release every listener on detach', () => {
        // Arrange
        const tag = nextTag('dispose');
        defineComponent({ tag, template: '<p>x</p>', styles: ROW_STYLES });
        const { store, host } = createRoot({ items: items('a', 'b') });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const element = host.appendChild(document.createElement(tag));
        expect(itemProperties(element)).toHaveLength(2);

        // Act
        element.remove();

        // Assert
        expect(itemProperties(element)).toHaveLength(0);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
    });

    it('should throw StyleCompileError at defineComponent for a nested @each or {{ }} in a body at-rule prelude', () => {
        expect(() => defineComponent({
            tag: nextTag('nested'),
            template: '<p></p>',
            styles: '@each {{ $k,$i,$v in $.a }} { @each {{ $x,$y,$z in $.b }} { .x { color: red; } } }',
        })).toThrow(StyleCompileError);
        expect(() => defineComponent({
            tag: nextTag('prelude'),
            template: '<p></p>',
            styles: '@each {{ $k,$i,$v in $.a }} { @media (min-width: {{ $v.w }}px) { .x { color: red; } } }',
        })).toThrow(StyleCompileError);
        expect(() => defineComponent({ tag: nextTag('for'), template: '<p></p>', styles: '@for {{ $.x }} { .x { color: red; } }' })).toThrow(StyleCompileError);
    });
});

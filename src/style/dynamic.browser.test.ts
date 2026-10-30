import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import { escapeIdent } from './escape.js';

let counter = 0;
//a unique tag per test, since custom elements can't be redefined
const nextTag = (name: string) => `x-dyn-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

describe('per-instance dynamic style rules in Chromium', () => {
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
        document.head.querySelectorAll('style[data-sui-dynamic]').forEach((style) => style.remove());
    });

    it('should adopt its own sheet after the shared one and update the selector before the write returns', () => {
        // Arrange
        const tag = nextTag('sync');
        defineComponent({
            tag,
            template: '<p class="item-a">a</p><p class="item-b">b</p>',
            styles: 'p { color: blue; } .item-{{ $.sel }} { color: red; }',
        });
        const { store, host } = createRoot({ sel: 'a' });
        const element = host.appendChild(document.createElement(tag));
        const [shared, dynamic] = element.shadowRoot!.adoptedStyleSheets;
        const color = (name: string) => getComputedStyle(element.shadowRoot!.querySelector(`.item-${name}`)!).color;
        expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(2);
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe('.item-a');
        expect(color('a')).toBe(RED);

        // Act
        store.set('sel', 'b');

        // Assert
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe('.item-b');
        expect(color('a')).toBe(BLUE);
        expect(color('b')).toBe(RED);
        expect(shared.cssRules).toHaveLength(1);
    });

    it('should give each instance its own sheet', () => {
        // Arrange
        const tag = nextTag('instances');
        defineComponent({ tag, template: '<p class="item-a">a</p>', styles: '.item-{{ $.sel }} { color: red; }' });
        const { host } = createRoot({ sel: 'a' });

        // Act
        const first = host.appendChild(document.createElement(tag));
        const second = host.appendChild(document.createElement(tag));

        // Assert
        expect(first.shadowRoot!.adoptedStyleSheets[0]).not.toBe(second.shadowRoot!.adoptedStyleSheets[0]);
    });

    it('should rebuild only the rule whose variables changed', () => {
        // Arrange
        const tag = nextTag('only');
        defineComponent({ tag, template: '<p>x</p>', styles: 'p { margin: 0; } .a-{{ $.x }} { color: red; } .b-{{ $.y }} { color: blue; }' });
        const { store, host } = createRoot({ x: 1, y: 2 });
        const element = host.appendChild(document.createElement(tag));
        const [shared, dynamic] = element.shadowRoot!.adoptedStyleSheets;
        const untouched = dynamic.cssRules[1];
        const sharedRule = shared.cssRules[0];
        const insert = vi.spyOn(CSSStyleSheet.prototype, 'insertRule');
        const remove = vi.spyOn(CSSStyleSheet.prototype, 'deleteRule');
        const replace = vi.spyOn(CSSStyleSheet.prototype, 'replaceSync');

        // Act
        store.set('x', 'z');

        // Assert
        expect(insert).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(replace).not.toHaveBeenCalled();
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe('.a-z');
        expect(dynamic.cssRules[1]).toBe(untouched);
        expect(shared.cssRules[0]).toBe(sharedRule);
    });

    it('should escape a hostile value into a single rule with an escaped identifier', () => {
        // Arrange
        const tag = nextTag('hostile');
        defineComponent({ tag, template: '<p>x</p>', styles: '.item-{{ $.sel }} { color: red; }' });
        const { store, host } = createRoot({ sel: 'a' });
        const element = host.appendChild(document.createElement(tag));
        const [dynamic] = element.shadowRoot!.adoptedStyleSheets;
        const hostile = 'x{}body{display:none}';

        // Act
        store.set('sel', hostile);

        // Assert
        expect(dynamic.cssRules).toHaveLength(1);
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe(`.item-${escapeIdent(hostile)}`);
        expect(Array.from(dynamic.cssRules).some((rule) => (rule as CSSStyleRule).selectorText === 'body')).toBe(false);
        expect(getComputedStyle(document.body).display).not.toBe('none');
    });

    it('should report a rule the browser rejects, skip it and keep the other rules', () => {
        // Arrange
        const tag = nextTag('invalid');
        defineComponent({ tag, template: '<p>x</p>', styles: '.a-{{ $.x }}:not-a-pseudo { color: red; } .b-{{ $.y }} { color: blue; }' });
        const { store, host } = createRoot({ x: 1, y: 'ok' });

        // Act
        const element = host.appendChild(document.createElement(tag));
        const [dynamic] = element.shadowRoot!.adoptedStyleSheets;

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(dynamic.cssRules).toHaveLength(1);
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe('.b-ok');
        store.set('y', 'next');
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect((dynamic.cssRules[0] as CSSStyleRule).selectorText).toBe('.b-next');
    });

    it('should interpolate a safe @media prelude value and skip the rule for an unsafe one', () => {
        // Arrange
        const tag = nextTag('media');
        defineComponent({ tag, template: '<p>x</p>', styles: '@media (min-width: {{ $.w }}px) { p { color: red; } }' });
        const { store, host } = createRoot({ w: 1 });
        const element = host.appendChild(document.createElement(tag));
        const [dynamic] = element.shadowRoot!.adoptedStyleSheets;
        expect(getComputedStyle(element.shadowRoot!.querySelector('p')!).color).toBe(RED);

        // Act
        store.set('w', '1) , all and (min-width: 0');

        // Assert
        expect(dynamic.cssRules).toHaveLength(0);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        store.set('w', 2);
        expect((dynamic.cssRules[0] as CSSMediaRule).conditionText).toBe('(min-width: 2px)');
    });

    it('should prefix light-DOM rules with the instance attribute and remove the <style> and attribute on detach', () => {
        // Arrange
        const tag = nextTag('light');
        defineComponent({ tag, shadow: false, template: '<p class="item-a">a</p>', styles: ':host .item-{{ $.sel }} { color: red; }' });
        const { store, host } = createRoot({ sel: 'a' });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');

        // Act
        const first = host.appendChild(document.createElement(tag));
        const second = host.appendChild(document.createElement(tag));

        // Assert
        const id = first.getAttribute('data-sui')!;
        expect(id).toBeTruthy();
        expect(second.getAttribute('data-sui')).not.toBe(id);
        const style = document.head.querySelector<HTMLStyleElement>(`style[data-sui-dynamic="${id}"]`)!;
        expect(style.sheet!.cssRules[0].cssText).toContain(`[data-sui="${id}"]`);
        expect(getComputedStyle(first.querySelector('.item-a')!).color).toBe(RED);
        first.remove();
        second.remove();
        expect(document.head.querySelector('style[data-sui-dynamic]')).toBeNull();
        expect(first.hasAttribute('data-sui')).toBe(false);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
    });

    it('should remove the instance sheet and release its listeners on detach', () => {
        // Arrange
        const tag = nextTag('dispose');
        defineComponent({ tag, template: '<p>x</p>', styles: '.item-{{ $.sel }} { color: red; }' });
        const { store, host } = createRoot({ sel: 'a' });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const element = host.appendChild(document.createElement(tag));

        // Act
        element.remove();

        // Assert
        expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(0);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
    });
});

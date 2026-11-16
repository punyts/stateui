import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import type { StateUIElement } from '../component/StateUIElement.js';

let counter = 0;
//a unique tag per test, since custom elements can't be redefined
const nextTag = (name: string) => `x-prop-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

const variable = (tag: string, n = 0) => `--sui-${(customElements.get(tag) as typeof StateUIElement).classId}-${n}`;

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';
const GREEN = 'rgb(0, 128, 0)';

describe('custom-property style bindings in Chromium', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    it('should set the properties on the host before the content is appended', () => {
        // Arrange
        const probeTag = nextTag('probe');
        const tag = nextTag('early');
        const seen: string[] = [];
        customElements.define(probeTag, class extends HTMLElement {
            connectedCallback() {
                seen.push(((this.getRootNode() as ShadowRoot).host as HTMLElement).style.getPropertyValue(variable(tag)));
            }
        });
        defineComponent({ tag, template: `<p><${probeTag}></${probeTag}></p>`, styles: 'p { color: {{ $.fg }}; }' });
        const { host } = createRoot({ fg: 'red' });

        // Act
        host.appendChild(document.createElement(tag));

        // Assert
        expect(seen).toEqual(['red']);
    });

    it('should apply the bound value in shadow and light DOM and update it synchronously while hidden', () => {
        // Arrange
        const shadowTag = nextTag('shadow');
        const lightTag = nextTag('light');
        defineComponent({ tag: shadowTag, template: '<p>x</p>', styles: 'p { color: {{ $.theme.fg }}; }' });
        defineComponent({ tag: lightTag, shadow: false, template: '<p>x</p>', styles: 'p { color: {{ $.theme.fg }}; }' });
        const { store, host } = createRoot({ theme: { fg: 'red' } });
        const shadowHost = host.appendChild(document.createElement(shadowTag));
        const lightHost = host.appendChild(document.createElement(lightTag));
        expect(getComputedStyle(shadowHost.shadowRoot!.querySelector('p')!).color).toBe(RED);
        expect(getComputedStyle(lightHost.querySelector('p')!).color).toBe(RED);
        host.style.display = 'none';

        // Act
        store.state.theme.fg = 'blue';

        // Assert
        expect(shadowHost.style.getPropertyValue(variable(shadowTag))).toBe('blue');
        expect(lightHost.style.getPropertyValue(variable(lightTag))).toBe('blue');
        host.style.display = '';
        expect(getComputedStyle(shadowHost.shadowRoot!.querySelector('p')!).color).toBe(BLUE);
        expect(getComputedStyle(lightHost.querySelector('p')!).color).toBe(BLUE);
    });

    it('should skip setProperty for an unrelated write and call removeProperty for an empty value', () => {
        // Arrange
        const tag = nextTag('skip');
        defineComponent({ tag, template: '<p>x</p>', styles: 'p { color: {{ $.fg }}; }' });
        const { store, host } = createRoot({ fg: 'red', other: 1 });
        const element = host.appendChild(document.createElement(tag));
        const set = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        const remove = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty');

        // Act
        store.set('other', 2);
        store.set('fg', '');

        // Assert
        expect(set).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith(variable(tag));
        expect(element.style.getPropertyValue(variable(tag))).toBe('');
    });

    it('should give two classes nested in each other different variable names and their own colours', () => {
        // Arrange
        const innerTag = nextTag('inner');
        const outerTag = nextTag('outer');
        defineComponent({ tag: innerTag, template: '<p class="in">i</p>', styles: '.in { color: {{ $.inner }}; }' });
        defineComponent({ tag: outerTag, template: `<div><p class="out">o</p><${innerTag}></${innerTag}></div>`, styles: '.out { color: {{ $.outer }}; }' });
        const { host } = createRoot({ outer: 'red', inner: 'blue' });

        // Act
        const outer = host.appendChild(document.createElement(outerTag));

        // Assert
        const inner = outer.shadowRoot!.querySelector(innerTag)!;
        expect(variable(innerTag)).not.toBe(variable(outerTag));
        expect(getComputedStyle(outer.shadowRoot!.querySelector('.out')!).color).toBe(RED);
        expect(getComputedStyle(inner.shadowRoot!.querySelector('.in')!).color).toBe(BLUE);
    });

    it('should give a component nested in itself its own value, never the ancestor one', () => {
        // Arrange
        const tag = nextTag('recursive');
        defineComponent({
            tag,
            template: `<div><p class="box">{{ $.name }}</p><${tag} if="{{ $.child }}" state=".child"></${tag}></div>`,
            styles: '.box { color: {{ $.color }}; }',
        });
        const { store, host } = createRoot({ name: 'outer', color: 'red', child: { name: 'inner', color: 'green' } });

        // Act
        const outer = host.appendChild(document.createElement(tag));

        // Assert
        const inner = outer.shadowRoot!.querySelector(tag) as HTMLElement;
        expect(inner.style.getPropertyValue(variable(tag))).toBe('green');
        expect(getComputedStyle(inner.shadowRoot!.querySelector('.box')!).color).toBe(GREEN);
        expect(getComputedStyle(outer.shadowRoot!.querySelector('.box')!).color).toBe(RED);
        store.set('child.color', 'blue');
        expect(getComputedStyle(inner.shadowRoot!.querySelector('.box')!).color).toBe(BLUE);
        expect(getComputedStyle(outer.shadowRoot!.querySelector('.box')!).color).toBe(RED);
    });

    it('should let the browser reject hostile values without adding declarations or touching the shared sheet', () => {
        // Arrange
        const tag = nextTag('hostile');
        defineComponent({ tag, template: '<p>x</p>', styles: 'p { color: {{ $.c }}; }' });
        const { store, host } = createRoot({ c: 'red' });
        const element = host.appendChild(document.createElement(tag));
        const sheet = element.shadowRoot!.adoptedStyleSheets[0];
        const rulesBefore = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
        const lengthBefore = element.style.length;

        // Act
        store.set('c', 'red; background: url(//x)');
        store.set('c', 'red} body{display:none');

        // Assert
        expect(element.style.length).toBe(lengthBefore);
        expect(element.style.getPropertyValue('background')).toBe('');
        expect(Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')).toBe(rulesBefore);
        expect(getComputedStyle(document.body).display).not.toBe('none');
    });

    it('should release every listener and remove the properties when the component detaches', () => {
        // Arrange
        const tag = nextTag('dispose');
        defineComponent({ tag, template: '<p>x</p>', styles: 'p { color: {{ $.fg }}; background: {{ $.bg }}; }' });
        const { store, host } = createRoot({ fg: 'red', bg: 'blue' });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const element = host.appendChild(document.createElement(tag));
        expect(on).toHaveBeenCalled();

        // Act
        element.remove();

        // Assert
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
        expect(element.style.length).toBe(0);
    });
});

import { createStore } from '@punyts/state';
import { StateUIError, TemplateParseError } from '../errors.js';
import { mount, unmount } from './context.js';
import { defineComponent } from './define.js';
import { StateUIElement } from './StateUIElement.js';

let counter = 0;
//a unique tag per test, since custom elements can't be redefined
const nextTag = (name: string) => `x-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

describe('defineComponent and StateUIElement in Chromium', () => {
    afterEach(() => {
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    describe('define', () => {
        it('should register and return a StateUIElement subclass that observes state', () => {
            // Act
            const tag = nextTag('define');
            const Component = defineComponent({ tag, template: '<p>x</p>' });

            // Assert
            expect(customElements.get(tag)).toBe(Component);
            expect(Component.prototype).toBeInstanceOf(StateUIElement);
            expect(Component.observedAttributes).toEqual(['state']);
        });

        it('should reject an invalid tag, an existing tag and a bad template at define time', () => {
            // Arrange
            const tag = nextTag('dup');
            defineComponent({ tag, template: '<p>x</p>' });

            // Act / Assert
            expect(() => defineComponent({ tag: 'NoHyphen', template: '<p>x</p>' })).toThrow(StateUIError);
            expect(() => defineComponent({ tag: '1-bad', template: '<p>x</p>' })).toThrow(StateUIError);
            expect(() => defineComponent({ tag, template: '<p>x</p>' })).toThrow(StateUIError);
            expect(() => defineComponent({ tag: nextTag('bad'), template: '<p>unclosed' })).toThrow(TemplateParseError);
        });
    });

    describe('rendering', () => {
        it('should render the mounted store value into an open shadow root unreachable from document.querySelector', () => {
            // Arrange
            const tag = nextTag('greeting');
            defineComponent({ tag, template: '<p class="greeting">Hello {{ $.name }}</p>' });
            const { store, host } = createRoot({ name: 'Jo' });

            // Act
            const element = host.appendChild(document.createElement(tag));

            // Assert
            expect(element.shadowRoot?.querySelector('.greeting')?.textContent).toBe('Hello Jo');
            expect(document.querySelector('.greeting')).toBeNull();
            store.set('name', 'Max');
            expect(element.shadowRoot?.querySelector('.greeting')?.textContent).toBe('Hello Max');
        });

        it('should render into the host in light-DOM mode', () => {
            // Arrange
            const tag = nextTag('light');
            defineComponent({ tag, template: '<span class="light">{{ $.n }}</span>', shadow: false });
            const { host } = createRoot({ n: 3 });

            // Act
            const element = host.appendChild(document.createElement(tag));

            // Assert
            expect(element.shadowRoot).toBeNull();
            expect(element.querySelector('.light')?.textContent).toBe('3');
            expect(document.querySelector('.light')).not.toBeNull();
        });

        it('should insert the rendered fragment with exactly one DOM call per attach', () => {
            // Arrange
            const tag = nextTag('single');
            defineComponent({ tag, template: '<p>{{ $.a }}</p><p>{{ $.b }}</p><p>c</p>' });
            const { host } = createRoot({ a: 1, b: 2 });
            const append = vi.spyOn(ShadowRoot.prototype, 'append');
            const appendChild = vi.spyOn(ShadowRoot.prototype, 'appendChild');

            try {
                // Act
                host.appendChild(document.createElement(tag));

                // Assert
                expect(append.mock.calls.length + appendChild.mock.calls.length).toBe(1);
            }
            finally {
                append.mockRestore();
                appendChild.mockRestore();
            }
        });
    });

    describe('lifecycle', () => {
        it('should dispose every listener on remove and re-attach from scratch on append', () => {
            // Arrange
            const tag = nextTag('cycle');
            defineComponent({ tag, template: '<p>{{ $.a.b }} {{ $.c }}</p>' });
            const { store, host } = createRoot({ a: { b: 'x' }, c: 'y' });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const element = host.appendChild(document.createElement(tag));

            // Act
            element.remove();

            // Assert
            expect(on.mock.calls.length).toBeGreaterThan(0);
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
            expect(element.shadowRoot?.childNodes.length).toBe(0);

            host.appendChild(element);
            store.set('c', 'z');
            expect(element.shadowRoot?.textContent).toBe('x z');
            expect(element.shadowRoot?.querySelectorAll('p').length).toBe(1);
        });

        it('should remove the light-DOM nodes it added on disconnect', () => {
            // Arrange
            const tag = nextTag('lightcycle');
            defineComponent({ tag, template: '<i>{{ $.v }}</i>', shadow: false });
            const { host } = createRoot({ v: 1 });
            const element = host.appendChild(document.createElement(tag));
            expect(element.children.length).toBe(1);

            // Act
            element.remove();

            // Assert
            expect(element.children.length).toBe(0);
        });

        it('should wait for a mount when connected before one exists', () => {
            // Arrange
            const tag = nextTag('waiting');
            defineComponent({ tag, template: '<b>{{ $.v }}</b>' });
            const host = document.body.appendChild(document.createElement('div'));
            const element = host.appendChild(document.createElement(tag)) as StateUIElement;
            expect(element.scope).toBeUndefined();

            // Act
            mount(host, createStore<any>({ v: 'late' }));

            // Assert
            expect(element.shadowRoot?.textContent).toBe('late');
        });

        it('should give nested components the parent component\'s scope', () => {
            // Arrange
            const child = nextTag('child');
            const parent = nextTag('parent');
            defineComponent({ tag: child, template: '<em>{{ $.title }}</em>' });
            defineComponent({ tag: parent, template: `<div><${child}></${child}></div>` });
            const { host } = createRoot({ title: 'nested' });

            // Act
            const element = host.appendChild(document.createElement(parent));

            // Assert
            const nested = element.shadowRoot!.querySelector(child)!;
            expect(nested.shadowRoot?.textContent).toBe('nested');
        });
    });
});

import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { TemplateCompileError } from '../errors.js';
import { mount, unmount } from './context.js';
import { defineComponent } from './define.js';
import type { StateUIElement } from './StateUIElement.js';

let counter = 0;
const nextTag = (name: string) => `x-state-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

/**
 * Creates <tag state="..."> under parent
 * @param parent
 * @param tag
 * @param state
 */
const addComponent = (parent: Node, tag: string, state?: string) => {
    const element = document.createElement(tag) as StateUIElement;
    if (state !== undefined) {
        element.setAttribute('state', state);
    }
    return parent.appendChild(element);
};

describe('state attribute scoping in Chromium', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    it('should resolve absolute, .child and ..sibling paths and inherit without a state attribute', () => {
        // Arrange
        const tag = nextTag('name');
        defineComponent({ tag, template: '<p>{{ $.name }}</p>' });
        const { host } = createRoot({ name: 'root', users: { current: { name: 'current', owner: { name: 'owner' } }, previous: { name: 'previous' } } });
        const scoped = addComponent(host, tag, 'users.current');

        // Act
        const plain = addComponent(host, tag);
        const child = addComponent(scoped.shadowRoot!, tag, '.owner');
        const sibling = addComponent(scoped.shadowRoot!, tag, '..previous');

        // Assert
        expect(scoped.scope?.basePath).toBe('$.users.current');
        expect(plain.shadowRoot!.textContent).toBe('root');
        expect(scoped.shadowRoot!.querySelector('p')!.textContent).toBe('current');
        expect(child.shadowRoot!.textContent).toBe('owner');
        expect(sibling.shadowRoot!.textContent).toBe('previous');
    });

    it('should bind three nesting levels to $.users.current.owner.address', () => {
        // Arrange
        const grandchild = nextTag('grandchild');
        const child = nextTag('child');
        const parent = nextTag('parent');
        defineComponent({ tag: grandchild, template: '<i>{{ $.city }}</i>' });
        defineComponent({ tag: child, template: `<${grandchild} state=".address"></${grandchild}>` });
        defineComponent({ tag: parent, template: `<${child} state=".owner"></${child}>` });
        const { store, host } = createRoot({ users: { current: { owner: { address: { city: 'Oslo' } } } } });

        // Act
        const top = addComponent(host, parent, 'users.current');
        const leaf = top.shadowRoot!.querySelector(child)!.shadowRoot!.querySelector(grandchild) as StateUIElement;

        // Assert
        expect(leaf.scope?.basePath).toBe('$.users.current.owner.address');
        expect(leaf.shadowRoot!.textContent).toBe('Oslo');
        store.set('$.users.current.owner.address.city', 'Bergen');
        expect(leaf.shadowRoot!.textContent).toBe('Bergen');
    });

    it('should re-scope synchronously when the state attribute changes, without leaking listeners', () => {
        // Arrange
        const tag = nextTag('rescope');
        defineComponent({ tag, template: '<p>{{ $.label }}</p>' });
        const { store, host } = createRoot({ a: { label: 'A' }, b: { label: 'B' } });
        const element = addComponent(host, tag, 'a');
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');

        // Act
        element.setAttribute('state', 'b');

        // Assert
        expect(element.shadowRoot!.textContent).toBe('B');
        expect(on.mock.calls.length).toBe(off.mock.calls.length);
        store.set('$.a.label', 'A2');
        expect(element.shadowRoot!.textContent).toBe('B');
        store.set('$.b.label', 'B2');
        expect(element.shadowRoot!.textContent).toBe('B2');
    });

    it('should only store the value when the attribute changes before connection', () => {
        // Arrange
        const tag = nextTag('early');
        defineComponent({ tag, template: '<p>{{ $.label }}</p>' });
        const { host } = createRoot({ a: { label: 'A' }, b: { label: 'B' } });
        const element = document.createElement(tag) as StateUIElement;
        element.setAttribute('state', 'a');
        element.setAttribute('state', 'b');

        // Act
        host.appendChild(element);

        // Assert
        expect(element.shadowRoot!.textContent).toBe('B');
    });

    it('should report an invalid path once, render nothing and leave siblings rendering', () => {
        // Arrange
        const tag = nextTag('invalid');
        defineComponent({ tag, template: '<p>{{ $.label }}</p>' });
        const { host } = createRoot({ label: 'ok' });

        // Act
        const broken = addComponent(host, tag, 'has space');
        const healthy = addComponent(host, tag);

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('has space');
        expect(broken.shadowRoot?.childNodes.length ?? 0).toBe(0);
        expect(healthy.shadowRoot!.textContent).toBe('ok');
    });

    it('should render a missing path as empty and update when it is created', () => {
        // Arrange
        const tag = nextTag('missing');
        defineComponent({ tag, template: '<p>[{{ $.name }}]</p>' });
        const { store, host } = createRoot({});
        const element = addComponent(host, tag, 'later.profile');
        expect(element.shadowRoot!.textContent).toBe('[]');

        // Act
        store.set('later', { profile: { name: 'appeared' } });

        // Assert
        expect(element.shadowRoot!.textContent).toBe('[appeared]');
    });

    it('should update when the object at the scope path is replaced with an unprefixed path', () => {
        // Arrange
        const tag = nextTag('replace');
        defineComponent({ tag, template: '<p>{{ $.name }}</p>' });
        const { store, host } = createRoot({ users: { current: { name: 'old' } } });
        const element = addComponent(host, tag, 'users.current');

        // Act
        store.replace('users.current', { name: 'new' });

        // Assert
        expect(element.shadowRoot!.textContent).toBe('new');
    });

    it('should reject {{ }} in a state attribute at defineComponent time', () => {
        // Act / Assert
        expect(() => defineComponent({ tag: nextTag('dynamic'), template: '<div><x-any state="{{ $.path }}"></x-any></div>' }))
            .toThrow(TemplateCompileError);
    });
});

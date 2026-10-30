import { createStore } from '@punyts/state';
import { StateUIError } from '../errors.js';
import { findParentScope, mount, unmount } from './context.js';
import type { ScopeConsumer } from './types.js';
import { connectConsumer, disconnectConsumer } from './waiting.js';

/**
 * A plain custom element implementing the consumer interface: it attaches through connectConsumer and records what
 * findParentScope gave it
 */
class ProbeConsumer extends HTMLElement implements ScopeConsumer {
    readonly element: Element = this;
    attachCount = 0;
    detachCount = 0;
    resolved?: ReturnType<typeof findParentScope>;

    connectedCallback() {
        connectConsumer(this);
    }

    disconnectedCallback() {
        disconnectConsumer(this);
    }

    attach() {
        this.attachCount++;
        this.resolved = findParentScope(this);
    }

    detach() {
        this.detachCount++;
        this.resolved = undefined;
    }
}
customElements.define('x-scope-probe', ProbeConsumer);

const createRoot = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return host;
};

describe('mount, unmount and scope discovery in Chromium', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('should resolve the outer mount through nested shadow roots', () => {
        // Arrange: host > shadow > element > shadow > probe
        const store = createStore<any>({ users: { current: { name: 'Jo' } } });
        const host = createRoot();
        mount(host, store, 'users.current');
        const middle = document.createElement('div');
        host.attachShadow({ mode: 'open' }).appendChild(middle);
        const probe = document.createElement('x-scope-probe') as ProbeConsumer;

        // Act
        middle.attachShadow({ mode: 'open' }).appendChild(probe);

        // Assert
        expect(probe.attachCount).toBe(1);
        expect(probe.resolved).toEqual({ store, basePath: '$.users.current' });
    });

    it('should resolve two roots with different stores independently', () => {
        // Arrange
        const storeA = createStore<any>({ a: 1 });
        const storeB = createStore<any>({ b: 2 });
        const hostA = createRoot();
        const hostB = createRoot();
        mount(hostA, storeA);
        mount(hostB, storeB, '$.b');

        // Act
        const probeA = hostA.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;
        const probeB = hostB.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;

        // Assert
        expect(probeA.resolved).toEqual({ store: storeA, basePath: '$' });
        expect(probeB.resolved).toEqual({ store: storeB, basePath: '$.b' });
    });

    it('should attach a consumer connected before mount when mount runs, and detach it on unmount', () => {
        // Arrange
        const host = createRoot();
        const probe = host.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;
        expect(probe.attachCount).toBe(0);
        const store = createStore<any>({});

        // Act / Assert
        mount(host, store);
        expect(probe.attachCount).toBe(1);
        expect(probe.resolved?.store).toBe(store);

        unmount(host);
        expect(probe.detachCount).toBe(1);
        expect(findParentScope(probe)).toBeUndefined();

        //still connected, so it waits again and a new mount re-attaches it
        mount(host, store, '$.again');
        expect(probe.attachCount).toBe(2);
        expect(probe.resolved?.basePath).toBe('$.again');
    });

    it('should leave consumers of a nested mount attached when the outer root is unmounted', () => {
        // Arrange
        const outer = createRoot();
        const inner = outer.appendChild(document.createElement('section'));
        mount(outer, createStore<any>({}));
        const innerStore = createStore<any>({});
        mount(inner, innerStore);
        const probe = inner.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;

        // Act
        unmount(outer);

        // Assert
        expect(probe.detachCount).toBe(0);
        expect(probe.resolved?.store).toBe(innerStore);
    });

    it('should stop waiting when a consumer disconnects before any mount', () => {
        // Arrange
        const host = createRoot();
        const probe = host.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;

        // Act
        probe.remove();
        mount(host, createStore<any>({}));

        // Assert
        expect(probe.attachCount).toBe(0);
    });

    it('should throw when mounting twice or with an invalid path', () => {
        // Arrange
        const host = createRoot();
        mount(host, createStore<any>({}));

        // Act / Assert
        expect(() => mount(host, createStore<any>({}))).toThrow(StateUIError);
        expect(() => mount(createRoot(), createStore<any>({}), 'has space')).toThrow(StateUIError);
    });

    it('should resolve a component that provides a scope before reaching the mount', () => {
        // Arrange
        const store = createStore<any>({ x: { y: 1 } });
        const host = createRoot();
        mount(host, store);
        const provider = document.createElement('div') as HTMLDivElement & { scope?: unknown };
        provider.scope = { store, basePath: '$.x' };
        host.appendChild(provider);

        // Act
        const probe = provider.appendChild(document.createElement('x-scope-probe')) as ProbeConsumer;

        // Assert
        expect(probe.resolved).toEqual({ store, basePath: '$.x' });
    });
});

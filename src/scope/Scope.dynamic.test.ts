import Expression from '@punyts/expression';
import { createStore } from '@punyts/state';
import { Scope } from './Scope.js';

const subscribeTo = (scope: Scope, source: string) => {
    const listener = vi.fn();
    const subscription = scope.subscribe(Expression(source).variables, listener);
    return { listener, subscription };
};

describe('Scope.subscribe dynamic indexers', () => {
    it('should notify when a field changes inside the entry the indexer selects', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 }, y: { b: 2 } }, k: 'x' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.set('a.x.b', 5);

        // Assert
        expect(listener).toHaveBeenCalled();
    });

    it('should not notify for a change inside an entry the indexer does not select', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 }, y: { b: 2 } }, k: 'x' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.set('a.y.b', 5);

        // Assert
        expect(listener).not.toHaveBeenCalled();
    });

    it('should move the subscription to the new entry when the key changes', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 }, y: { b: 2 } }, k: 'x' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.set('k', 'y');
        listener.mockClear();
        store.set('a.x.b', 7);
        const afterOld = listener.mock.calls.length;
        store.set('a.y.b', 8);

        // Assert
        expect(afterOld).toBe(0);
        expect(listener).toHaveBeenCalled();
    });

    it('should notify when the selected entry is removed', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 } }, k: 'x' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.delete('a.x');

        // Assert
        expect(listener).toHaveBeenCalled();
    });

    it('should notify when a missing entry appears under the selected key', () => {
        // Arrange
        const store = createStore<any>({ a: {}, k: 'x' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.set('a.x', { b: 3 });

        // Assert
        expect(listener).toHaveBeenCalled();
    });

    it('should follow nested indexers and move when either changes', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { p: { b: 1 }, q: { b: 2 } }, y: { p: { b: 3 } } }, k: 'x', j: 'p' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.a[$.k][$.j].b');

        // Act
        store.set('a.x.p.b', 10);
        const inner = listener.mock.calls.length;
        store.set('j', 'q');
        listener.mockClear();
        store.set('a.x.p.b', 11);
        const stale = listener.mock.calls.length;
        store.set('a.x.q.b', 12);
        const moved = listener.mock.calls.length;
        store.set('k', 'y');
        store.set('j', 'p');
        listener.mockClear();
        store.set('a.y.p.b', 13);

        // Assert
        expect(inner).toBeGreaterThan(0);
        expect(stale).toBe(0);
        expect(moved).toBeGreaterThan(0);
        expect(listener).toHaveBeenCalled();
    });

    it('should resolve the indexer next to other variables in the same expression', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 }, y: { b: 2 } }, k: 'x', t: 'T' });
        const { listener } = subscribeTo(new Scope(store, '$'), '$.t + $.a[$.k].b');

        // Act
        store.set('a.x.b', 5);

        // Assert
        expect(listener).toHaveBeenCalled();
    });

    it('should read a repeat local as the indexer', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 }, y: { b: 2 } } });
        const scope = new Scope(store, '$').child({ $k: { value: 'y' } });
        const { listener } = subscribeTo(scope, '$.a[$k].b');

        // Act
        store.set('a.x.b', 5);
        const other = listener.mock.calls.length;
        store.set('a.y.b', 6);

        // Assert
        expect(other).toBe(0);
        expect(listener).toHaveBeenCalled();
    });

    it('should remove the entry and indexer listeners on dispose', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 } }, k: 'x' });
        const { listener, subscription } = subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        subscription.dispose();
        store.set('a.x.b', 2);
        store.set('k', 'y');

        // Assert
        expect(listener).not.toHaveBeenCalled();
    });

    it('should never register a wildcard path for an unsafe key', () => {
        // Arrange
        const store = createStore<any>({ a: { x: { b: 1 } }, k: 'x' });
        const on = vi.spyOn(store, 'on');
        subscribeTo(new Scope(store, '$'), '$.a[$.k].b');

        // Act
        store.set('k', '*');
        store.set('k', '$every');
        store.set('k', 'x');

        // Assert
        for (const [path] of on.mock.calls) {
            expect(path).not.toMatch(/[$*]\w|\*/);
        }
    });
});

import Expression from '@punyts/expression';
import { createStore, type EventListenerFn } from '@punyts/state';
import { Scope } from './Scope.js';

//no wildcard tokens ($every, $all, *) may ever reach store.on
const SAFE_PATH = /^\$(\.[^.$*]+)+$|^\$$/;

const createMatrixStore = () => createStore<any>({ a: { b: { c: 1, d: 9 } }, items: ['x', 'y'], title: 'T' });

/**
 * Wraps store.on/off in spies that still call through, returning them for assertions
 * @param store
 */
const spyOnSubscriptions = (store: ReturnType<typeof createStore<any>>) => ({
    on: vi.spyOn(store, 'on'),
    off: vi.spyOn(store, 'off'),
});

const registeredPaths = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(([path]) => path);

describe('Scope.subscribe', () => {
    describe('registered paths', () => {
        it('should register the variable path and each ancestor down to its first segment in a root scope', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);

            // Act
            new Scope(store, '$').subscribe(['$.a.b.c'], vi.fn());

            // Assert
            expect(registeredPaths(spies.on)).toEqual(['$.a.b.c', '$.a.b', '$.a']);
        });

        it('should include the scope base object and stop at the base path\'s first segment', () => {
            // Arrange
            const store = createStore<any>({ users: { current: { name: 'Jo' } } });
            const spies = spyOnSubscriptions(store);

            // Act
            new Scope(store, '$.users.current').subscribe(['$.name'], vi.fn());

            // Assert
            expect(registeredPaths(spies.on)).toEqual(['$.users.current.name', '$.users.current', '$.users']);
        });

        it('should stop at the item path in a repeat item scope and use the first segment for paths outside it', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const item = new Scope(store, '$').child({ $v: { path: '$.items.1' } }, { ancestorFloor: '$.items.1' });

            // Act
            item.subscribe(['$v.name', '$.title'], vi.fn());

            // Assert
            expect(registeredPaths(spies.on)).toEqual(['$.items.1.name', '$.items.1', '$.title']);
        });

        it('should register each distinct path once and skip locals without a store path', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const scope = new Scope(store, '$', { locals: { select: { value: () => undefined } } });

            // Act
            scope.subscribe(['$.a.b', '$.a.b.c', '$.a.b', '$.select'], vi.fn());

            // Assert
            expect(registeredPaths(spies.on)).toEqual(['$.a.b', '$.a', '$.a.b.c']);
        });

        it('should subscribe a dynamic variable through its prefix and indexer, never literally', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);

            // Act
            new Scope(store, '$').subscribe(Expression('$.a[$.k].b').variables, vi.fn());

            // Assert
            expect(registeredPaths(spies.on)).toEqual(['$.k', '$.a']);
        });

        it('should only ever register wildcard-free paths across a range of expressions', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const root = new Scope(store, '$', { locals: { select: { value: () => undefined } } });
            const item = root.child({ $v: { path: '$.items.0' }, $k: { value: '0' }, $i: { value: 0 } }, { ancestorFloor: '$.items.0' });
            const expressions = [
                '$.a.b.c', '$.a.b +++ $.title', '$.fn($.a.b)', '$.a.method($.title)', '($v)=>$.select',
                '$k,$i,$v in $.items sort name filter $v.age > 1', '$.a[$.k].b', "$.a['lit'].b", '$my.variable',
                '$.a.b.c ? $.title : $.a.b.d', '$v.name', '$.a.$all', '$',
            ];

            // Act
            for (const expression of expressions) {
                root.subscribe(Expression(expression).variables, vi.fn());
                item.subscribe(Expression(expression).variables, vi.fn());
            }

            // Assert
            const paths = registeredPaths(spies.on);
            expect(paths.length).toBeGreaterThan(20);
            for (const path of paths) {
                expect(path).toMatch(SAFE_PATH);
            }
        });
    });

    describe('dispose', () => {
        it('should call store.off once per registered path, stop notifications and be idempotent', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const listener = vi.fn();
            const subscription = new Scope(store, '$').subscribe(['$.a.b.c'], listener);

            // Act
            subscription.dispose();
            subscription.dispose();
            store.set('a.b.c', 2);

            // Assert
            expect(registeredPaths(spies.off)).toEqual(['$.a.b.c', '$.a.b', '$.a']);
            expect(spies.off.mock.calls.every(([, fn]) => fn === listener)).toBe(true);
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('resubscribe', () => {
        it('should only remove dropped paths and only add new ones', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const subscription = new Scope(store, '$').subscribe(['$.a.b.c', '$.title'], vi.fn());
            spies.on.mockClear();
            spies.off.mockClear();

            // Act: keeps $.a.b and $.a, drops $.a.b.c and $.title, adds $.a.b.d and $.items
            subscription.resubscribe(['$.a.b.d', '$.items']);

            // Assert
            expect(registeredPaths(spies.off).sort()).toEqual(['$.a.b.c', '$.title']);
            expect(registeredPaths(spies.on).sort()).toEqual(['$.a.b.d', '$.items']);
        });

        it('should re-classify against the scope\'s current locals', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const item = new Scope(store, '$').child({ $v: { path: '$.items.0' } }, { ancestorFloor: '$.items' });
            const subscription = item.subscribe(['$v'], vi.fn());
            spies.on.mockClear();
            spies.off.mockClear();

            // Act
            item.locals.set('$v', { path: '$.items.1' });
            subscription.resubscribe(['$v']);

            // Assert: $.items (the floor) stays registered
            expect(registeredPaths(spies.off)).toEqual(['$.items.0']);
            expect(registeredPaths(spies.on)).toEqual(['$.items.1']);
        });

        it('should do nothing after dispose', () => {
            // Arrange
            const store = createMatrixStore();
            const spies = spyOnSubscriptions(store);
            const subscription = new Scope(store, '$').subscribe(['$.a'], vi.fn());
            subscription.dispose();
            spies.on.mockClear();

            // Act
            subscription.resubscribe(['$.title']);

            // Assert
            expect(spies.on).not.toHaveBeenCalled();
        });
    });

    describe('integration matrix against a real store', () => {
        /*
         * Every mutation reaches a binding on $.a.b.c at least once. Some store calls emit on more than one subscribed
         * path in sequence (the changed path, then insert-child/delete-child or a final update on an ancestor), so the
         * listener runs once per such emit; Story 6b's equality skip keeps the extra evaluations from touching the DOM
         */
        const matrix: ReadonlyArray<readonly [string, (store: ReturnType<typeof createMatrixStore>) => void, readonly string[]]> = Object.freeze([
            ['set a.b.c', (store) => store.set('a.b.c', 2), ['$.a.b.c update']],
            ['replace a.b', (store) => store.replace('a.b', { c: 5 }), ['$.a.b replace']],
            ['replace a with an unprefixed path', (store) => store.replace('a', { b: { c: 5 } }), ['$.a replace']],
            ['set a.b merging the same keys', (store) => store.set('a.b', { c: 2, d: 9 }), ['$.a.b.c update', '$.a.b update']],
            ['set a.b merging fewer keys', (store) => store.set('a.b', { c: 2 }), ['$.a.b.c update', '$.a.b delete-child', '$.a.b update']],
            ['set a replacing a composite', (store) => store.set('a', { b: { c: 3 } }), ['$.a.b.c update', '$.a.b delete-child', '$.a update']],
            ['set a.b onto a missing b', (store) => { store.delete('a.b'); store.set('a.b', { c: 4 }); }, ['$.a.b insert', '$.a insert-child']],
            ['delete a.b', (store) => store.delete('a.b'), ['$.a.b delete', '$.a delete-child']],
            ['delete a', (store) => store.delete('a'), ['$.a delete']],
        ]);

        for (const [name, mutate, expected] of matrix) {
            it(`should notify a $.a.b.c binding for ${name}`, () => {
                // Arrange
                const store = createMatrixStore();
                if (name === 'set a.b onto a missing b') {
                    store.delete('a.b');
                }
                const emits: string[] = [];
                new Scope(store, '$').subscribe(['$.a.b.c'], (path, _value, _old, action) => { emits.push(`${path} ${action}`); });

                // Act
                if (name === 'set a.b onto a missing b') {
                    store.set('a.b', { c: 4 });
                }
                else {
                    mutate(store);
                }

                // Assert
                expect(emits.length).toBeGreaterThanOrEqual(1);
                expect(emits).toEqual(expected);
            });
        }

        const arrayMatrix: ReadonlyArray<readonly [string, string, (store: ReturnType<typeof createMatrixStore>) => void, readonly string[]]> = Object.freeze([
            ['$.items.length', 'push of a primitive', (store) => { store.state.items.push('z'); }, ['$.items insert-child']],
            ['$.items.length', 'delete of an item', (store) => { store.delete('$.items.0'); }, ['$.items delete-child']],
            ['$.items', 'push of a primitive', (store) => { store.state.items.push('z'); }, ['$.items insert-child']],
            ['$.items', 'delete of an item', (store) => { store.delete('$.items.0'); }, ['$.items delete-child']],
        ]);

        for (const [variable, name, mutate, expected] of arrayMatrix) {
            it(`should notify a ${variable} binding exactly once for ${name}`, () => {
                // Arrange
                const store = createMatrixStore();
                const emits: string[] = [];
                new Scope(store, '$').subscribe([variable], (path, _value, _old, action) => { emits.push(`${path} ${action}`); });

                // Act
                mutate(store);

                // Assert
                expect(emits).toEqual(expected);
            });
        }
    });

    describe('listeners added during an emit', () => {
        it('should not invoke a listener subscribed during an emit on the same path until the next emit', () => {
            // Arrange
            const store = createMatrixStore();
            const scope = new Scope(store, '$');
            const late: EventListenerFn = vi.fn();
            let subscribedLate = false;
            scope.subscribe(['$.title'], () => {
                if (!subscribedLate) {
                    subscribedLate = true;
                    scope.subscribe(['$.title'], late);
                }
            });

            // Act
            store.set('title', 'first');

            // Assert
            expect(late).not.toHaveBeenCalled();
            store.set('title', 'second');
            expect(late).toHaveBeenCalledTimes(1);
        });
    });
});

import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';

const KEYED_LIST = '<ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.id }}</li></ul>';

const ids = (root: Element) => Array.from(root.children).map((child) => child.textContent);

describe('keyed repeat edge cases', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    describe('duplicate keys', () => {
        it('should let the first entry own the key, recreate later duplicates and report once per reconcile', () => {
            // Arrange
            const store = createStore<any>({ items: [{ id: 1, n: 'a' }, { id: 1, n: 'b' }, { id: 2, n: 'c' }] });
            const instance = instantiate(
                compileTemplate('<ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.n }}</li></ul>'),
                new Scope(store, '$')
            );
            const root = instance.fragment.firstChild as Element;
            expect(Array.from(root.children).map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toContain('duplicate key 1');
            const [owner, duplicate] = Array.from(root.children);

            // Act
            store.state.items.push({ id: 3, n: 'd' });

            // Assert
            expect(errorSpy).toHaveBeenCalledTimes(2);
            expect(root.children[0]).toBe(owner);
            expect(root.children[1]).not.toBe(duplicate);
            expect(Array.from(root.children).map((li) => li.textContent)).toEqual(['a', 'b', 'c', 'd']);
        });
    });

    describe('array mutators through the proxy (intermediate states)', () => {
        const mutators: ReadonlyArray<readonly [string, (items: any[]) => unknown]> = Object.freeze([
            ['push', (items) => items.push({ id: 4 })],
            ['splice(1, 1)', (items) => items.splice(1, 1)],
            ['unshift', (items) => items.unshift({ id: 0 })],
            ['reverse', (items) => items.reverse()],
            ['sort', (items) => items.sort((a: { id: number }, b: { id: number }) => b.id - a.id)],
        ]);

        for (const [name, mutate] of mutators) {
            it(`should end with the DOM matching the array after ${name}, report nothing and leak no listeners`, () => {
                // Arrange
                const store = createStore<any>({ items: [] });
                const on = vi.spyOn(store, 'on');
                const off = vi.spyOn(store, 'off');
                const instance = instantiate(compileTemplate(KEYED_LIST), new Scope(store, '$'));
                const root = instance.fragment.firstChild as Element;
                const baseline = on.mock.calls.length - off.mock.calls.length;
                store.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }]);

                // Act
                mutate(store.state.items);

                // Assert
                const expected = store.get<any[]>('$.items').map((item: { id: number }) => String(item.id));
                expect(ids(root)).toEqual(expected);
                expect(errorSpy).not.toHaveBeenCalled();
                store.get('items').__replace([]);
                expect(root.children).toHaveLength(0);
                expect(on.mock.calls.length - off.mock.calls.length).toBe(baseline);
            });
        }

        it('should match the array after a whole-array __replace and store.set', () => {
            // Arrange
            const store = createStore<any>({ items: [{ id: 1 }, { id: 2 }] });
            const root = instantiate(compileTemplate(KEYED_LIST), new Scope(store, '$')).fragment.firstChild as Element;

            // Act / Assert
            store.get('items').__replace([{ id: 9 }, { id: 1 }]);
            expect(ids(root)).toEqual(['9', '1']);
            store.set('items', [{ id: 5 }, { id: 6 }, { id: 7 }]);
            expect(ids(root)).toEqual(['5', '6', '7']);
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });

    describe('if and repeat on one element', () => {
        it('should evaluate if first, dispose the whole repeat when hidden and re-render it when shown', () => {
            // Arrange
            const store = createStore<any>({ show: true, items: [{ id: 1 }, { id: 2 }] });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const instance = instantiate(
                compileTemplate('<ul><li if="{{ $.show }}" repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.id }}</li></ul>'),
                new Scope(store, '$')
            );
            const root = instance.fragment.firstChild as Element;
            expect(ids(root)).toEqual(['1', '2']);

            // Act
            store.set('show', false);
            const hiddenOutstanding = on.mock.calls.length - off.mock.calls.length;
            store.set('show', true);

            // Assert
            expect(ids(root)).toEqual(['1', '2']);
            store.set('show', false);
            expect(root.children).toHaveLength(0);
            expect(on.mock.calls.length - off.mock.calls.length).toBe(hiddenOutstanding);
            store.state.items.push({ id: 3 });
            expect(root.children).toHaveLength(0);
            store.set('show', true);
            expect(ids(root)).toEqual(['1', '2', '3']);
        });
    });
});

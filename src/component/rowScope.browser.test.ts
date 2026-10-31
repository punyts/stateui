import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from './context.js';
import { defineComponent } from './define.js';
import type { StateUIElement } from './StateUIElement.js';

let counter = 0;
const nextTag = (name: string) => `x-row-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

/**
 * Defines a stateful row component (a text and an editable field over its own base path) and a list component that
 * repeats it over collection, and mounts the list
 * @param state
 * @param collection
 * @param key
 */
const setup = (state: Record<string, unknown>, collection: string, key: string) => {
    const row = nextTag('row');
    const list = nextTag('list');
    defineComponent({ tag: row, template: '<span><b>{{ $.name }}</b><input value="{{ $.name }}" bind="value" /></span>' });
    defineComponent({
        tag: list,
        template: `<ul><li repeat="{{ $k,$i,$v in ${collection} }}" key="{{ ${key} }}"><${row} state="{{ $v }}"></${row}></li></ul>`,
    });
    const { store, host } = createRoot(state);
    const element = host.appendChild(document.createElement(list)) as StateUIElement;
    const rows = () => Array.from(element.shadowRoot!.querySelectorAll(row)) as StateUIElement[];
    const names = () => rows().map((item) => item.shadowRoot!.querySelector('b')!.textContent);
    return { store, host, element, rows, names };
};

describe('row scoping and keyed-map repeat in Chromium', () => {
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

    describe('a keyed object map', () => {
        it('should scope each row component to $.map.<key>, in insertion order, and write edits back to that entry', () => {
            // Arrange
            const { store, rows, names } = setup({ map: { b: { name: 'Bee' }, a: { name: 'Ay' } } }, '$.map', '$k');

            // Act
            const input = rows()[1].shadowRoot!.querySelector('input')!;
            input.value = 'Ay!';
            input.dispatchEvent(new Event('input'));

            // Assert
            expect(rows().map((item) => item.scope?.basePath)).toEqual(['$.map.b', '$.map.a']);
            expect(store.get('$.map.a.name')).toBe('Ay!');
            expect(store.get('$.map.b.name')).toBe('Bee');
            expect(names()).toEqual(['Bee', 'Ay!']);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('should add a row for an added key and dispose the row of a removed key, keeping the others', () => {
            // Arrange
            const { store, rows, names } = setup({ map: { a: { name: 'A' }, b: { name: 'B' } } }, '$.map', '$k');
            const [first, second] = rows();

            // Act
            store.set('map.c', { name: 'C' });
            const afterAdd = names();
            store.delete('map.a');

            // Assert
            expect(afterAdd).toEqual(['A', 'B', 'C']);
            expect(names()).toEqual(['B', 'C']);
            expect(rows()[0]).toBe(second);
            expect(first.isConnected).toBe(false);
            expect(first.scope).toBeUndefined();
        });

        it('should keep a row component per surviving key when the map is replaced and re-scope it to the new entry', () => {
            // Arrange
            const { store, rows, names } = setup({ map: { a: { name: 'A' }, b: { name: 'B' } } }, '$.map', '$k');
            const [rowA, rowB] = rows();

            // Act
            store.replace('map', { b: { name: 'B2' }, c: { name: 'C2' } });

            // Assert
            expect(names()).toEqual(['B2', 'C2']);
            expect(rows()[0]).toBe(rowB);
            expect(rowA.isConnected).toBe(false);
            expect(rows().map((item) => item.scope?.basePath)).toEqual(['$.map.b', '$.map.c']);
            expect(store.get('$.map.b.name')).toBe('B2');
        });
    });

    describe('an array', () => {
        it('should scope each row component to $.list.<i> and write edits back to that element', () => {
            // Arrange
            const { store, rows } = setup({ list: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] }, '$.list', '$v.id');

            // Act
            const input = rows()[1].shadowRoot!.querySelector('input')!;
            input.value = 'deux';
            input.dispatchEvent(new Event('change'));

            // Assert
            expect(rows().map((item) => item.scope?.basePath)).toEqual(['$.list.0', '$.list.1']);
            expect(store.get('$.list.1.name')).toBe('deux');
            expect(store.get('$.list.0.name')).toBe('one');
        });

        it('should move a keyed row component, re-scope it to its new index and drop a removed one', () => {
            // Arrange
            const { store, rows, names } = setup({ list: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }, { id: 3, name: 'three' }] }, '$.list', '$v.id');
            const [one, two, three] = rows();

            // Act
            store.replace('list', [{ id: 3, name: 'three' }, { id: 1, name: 'one' }]);

            // Assert
            expect(names()).toEqual(['three', 'one']);
            expect(rows()).toEqual([three, one]);
            expect(rows().map((item) => item.scope?.basePath)).toEqual(['$.list.0', '$.list.1']);
            expect(two.isConnected).toBe(false);
        });

        it('should re-scope a row whose entry holds an equal primitive at a new path', () => {
            // Arrange
            const row = nextTag('prim');
            const list = nextTag('primlist');
            defineComponent({ tag: row, template: '<i>row</i>' });
            defineComponent({ tag: list, template: `<ul><li repeat="{{ $k,$i,$v in $.list }}" key="{{ $k }}"><${row} state="{{ $v }}"></${row}></li></ul>` });
            const { store, host } = createRoot({ list: ['x', 'x'] });
            const element = host.appendChild(document.createElement(list));
            const items = () => Array.from(element.shadowRoot!.querySelectorAll(row)) as StateUIElement[];

            // Act
            store.replace('list', ['y', 'x', 'x']);

            // Assert
            expect(items().map((item) => item.scope?.basePath)).toEqual(['$.list.0', '$.list.1', '$.list.2']);
        });
    });

    describe('listeners', () => {
        it('should release every listener it registered once the list is unmounted', () => {
            // Arrange
            const store = createStore<any>({ map: { a: { name: 'A' }, b: { name: 'B' } } });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const row = nextTag('row');
            const list = nextTag('list');
            defineComponent({ tag: row, template: '<b>{{ $.name }}</b>' });
            defineComponent({ tag: list, template: `<ul><li repeat="{{ $k,$i,$v in $.map }}" key="{{ $k }}"><${row} state="{{ $v }}"></${row}></li></ul>` });
            const host = document.body.appendChild(document.createElement('div'));
            mount(host, store);
            host.appendChild(document.createElement(list));
            store.set('map.c', { name: 'C' });
            store.delete('map.a');
            store.replace('map', { b: { name: 'B2' }, d: { name: 'D' } });

            // Act
            unmount(host);

            // Assert
            expect(on.mock.calls.length).toBeGreaterThan(0);
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
        });
    });

    describe('a local without a store path', () => {
        it('should report it and render nothing for the row instead of scoping to the parent', () => {
            // Arrange
            const row = nextTag('row');
            const list = nextTag('list');
            defineComponent({ tag: row, template: '<b>{{ $.name }}</b>' });
            defineComponent({ tag: list, template: `<ul><li repeat="{{ $k,$i,$v in $.items filter $v }}"><${row} state="{{ $v }}"></${row}></li></ul>` });
            const { host } = createRoot({ name: 'root', items: ['p', 'q'] });

            // Act
            const element = host.appendChild(document.createElement(list));

            // Assert
            expect(errorSpy).toHaveBeenCalled();
            expect(element.shadowRoot!.querySelector(row)?.shadowRoot?.textContent ?? '').toBe('');
        });
    });
});

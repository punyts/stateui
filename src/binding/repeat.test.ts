import { createStore } from '@punyts/state';
import { TemplateCompileError } from '../errors.js';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';
import { createBinding } from './Binding.js';
import { registerBindingKind } from './registry.js';

const render = (source: string, state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const instance = instantiate(compileTemplate(source), new Scope(store, '$'));
    const root = instance.fragment.firstChild as Element;
    return { store, instance, root };
};

const texts = (root: Element) => Array.from(root.children).map((child) => child.textContent);

//counts applies per item, labelled by the item's name at render time
const applyCounts: Record<string, number> = {};
registerBindingKind('repeat-probe', {
    match: (attr) => attr.name === 'x-count',
    compile: ({ nodePath, parts }) => ({ nodePath, kind: 'repeat-probe', parts }),
    attach: (node, entry, scope) => createBinding({
        scope,
        expressions: entry.parts,
        kind: 'repeat-probe',
        nodePath: entry.nodePath,
        apply: () => {
            //read at apply time: the data-id attribute binding attaches after this specific kind
            const label = (node as Element).getAttribute('data-id') ?? '?';
            applyCounts[label] = (applyCounts[label] ?? 0) + 1;
        },
    }),
});

describe('repeat', () => {
    describe('compile', () => {
        it('should replace the element with an anchor and compile it, minus repeat and key, as the item template', () => {
            // Act
            const { template, plan } = compileTemplate('<ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $v.name }}</li><li>tail</li></ul>');
            const ul = template.content.firstChild as Element;

            // Assert
            expect(ul.firstChild!.nodeType).toBe(Node.COMMENT_NODE);
            expect(ul.children).toHaveLength(1);
            const entry = plan[0] as typeof plan[0] & { item: { template: HTMLTemplateElement }; collection: string };
            expect(entry.kind).toBe('repeat');
            expect(entry.collection).toBe('$.items');
            const li = entry.item.template.content.firstChild as Element;
            expect(li.hasAttribute('repeat')).toBe(false);
            expect(li.hasAttribute('key')).toBe(false);
        });

        const bad: Readonly<Record<string, string>> = Object.freeze({
            'a literal value': '<ul><li repeat="items">x</li></ul>',
            'mixed text': '<ul><li repeat="x {{ $k in $.items }}">x</li></ul>',
            'a non-iterator expression': '<ul><li repeat="{{ $.items }}">x</li></ul>',
            'a computed collection': '<ul><li repeat="{{ $k,$i,$v in $.fn($.items) }}">x</li></ul>',
        });
        for (const [name, source] of Object.entries(bad)) {
            it(`should throw TemplateCompileError for ${name}`, () => {
                // Act / Assert
                expect(() => compileTemplate(source)).toThrow(TemplateCompileError);
            });
        }
    });

    describe('rendering', () => {
        it('should render one item per entry with key, index and value locals', () => {
            // Act
            const { root } = render('<ul><li repeat="{{ $k,$i,$v in $.items }}">{{ $k }}/{{ $i }}/{{ $v.name }}</li></ul>', {
                items: [{ name: 'a' }, { name: 'b' }],
            });

            // Assert
            expect(texts(root)).toEqual(['0/0/a', '1/1/b']);
        });

        it('should render a for iterator count with no store path', () => {
            // Act
            const { store, root } = render('<ul><li repeat="{{ $k,$i for $.count }}">{{ $i }}</li></ul>', { count: 3 });

            // Assert
            expect(texts(root)).toEqual(['0', '1', '2']);
            store.set('count', 1);
            expect(texts(root)).toEqual(['0']);
        });

        it('should re-sort synchronously when a sort field changes on an item', () => {
            // Arrange
            const { store, root } = render('<ul><li repeat="{{ $k,$i,$v in $.items sort name }}">{{ $v.name }}</li></ul>', {
                items: [{ name: 'c' }, { name: 'a' }, { name: 'b' }],
            });
            expect(texts(root)).toEqual(['a', 'b', 'c']);

            // Act
            store.set('items.1.name', 'z');

            // Assert
            expect(texts(root)).toEqual(['b', 'c', 'z']);
        });

        it('should only update the bindings of the item whose path changed', () => {
            // Arrange
            const { store } = render(
                '<ul><li repeat="{{ $k,$i,$v in $.items }}" data-id="{{ $v.id }}" x-count="{{ $v.name }}">x</li></ul>',
                { items: [{ id: 'i0', name: 'a' }, { id: 'i1', name: 'b' }, { id: 'i2', name: 'c' }] }
            );
            for (const key of Object.keys(applyCounts)) {
                delete applyCounts[key];
            }

            // Act
            store.set('$.items.1.name', 'B');

            // Assert
            expect(applyCounts).toEqual({ i1: 1 });
        });

        it('should give filtered array items their real store paths and update the right node', () => {
            // Arrange
            const { store, root } = render(
                '<ul><li repeat="{{ $k,$i,$v in $.items filter $v.age > 1 }}">{{ $v.age }}</li></ul>',
                { items: [{ age: 1 }, { age: 2 }, { age: 3 }] }
            );
            expect(texts(root)).toEqual(['2', '3']);

            // Act
            store.set('$.items.2.age', 30);

            // Assert
            expect(texts(root)).toEqual(['2', '30']);
            store.set('$.items.0.age', 5);
            expect(texts(root)).toEqual(['5', '2', '30']);
        });

        it('should add items on push and keep the earlier items in place', () => {
            // Arrange
            const { store, root } = render('<ul><li repeat="{{ $k,$i,$v in $.items }}">{{ $v }}</li></ul>', { items: ['a', 'b'] });
            const first = root.firstElementChild;

            // Act
            store.state.items.push('c');

            // Assert
            expect(texts(root)).toEqual(['a', 'b', 'c']);
            expect(root.firstElementChild).toBe(first);
        });
    });

    describe('removal and disposal', () => {
        it('should leave no item roots or item listeners after replacing the collection with []', () => {
            // Arrange
            const store = createStore<any>({ items: [] });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const instance = instantiate(compileTemplate('<ul><li repeat="{{ $k,$i,$v in $.items }}">{{ $v.name }}</li></ul>'), new Scope(store, '$'));
            const root = instance.fragment.firstChild as Element;
            const baseline = on.mock.calls.length - off.mock.calls.length;
            store.set('items', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
            expect(root.children).toHaveLength(3);

            // Act
            store.get('items').__replace([]);

            // Assert
            expect(root.children).toHaveLength(0);
            expect(root.firstChild!.nodeType).toBe(Node.COMMENT_NODE);
            expect(on.mock.calls.length - off.mock.calls.length).toBe(baseline);
        });

        it('should release every listener on dispose, including the sort listener', () => {
            // Arrange
            const store = createStore<any>({ items: [{ name: 'b' }, { name: 'a' }] });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const instance = instantiate(compileTemplate('<ul><li repeat="{{ $k,$i,$v in $.items sort name }}">{{ $v.name }}</li></ul>'), new Scope(store, '$'));

            // Act
            instance.dispose();

            // Assert
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
        });
    });
});

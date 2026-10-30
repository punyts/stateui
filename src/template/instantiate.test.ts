import { createStore } from '@punyts/state';
import { createBinding } from '../binding/Binding.js';
import { registerBindingKind } from '../binding/registry.js';
import { StateUIError } from '../errors.js';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from './compile.js';
import { instantiate } from './instantiate.js';

const order: string[] = [];

//a throwaway kind matching x-order attributes; it records attach order and binds the attribute's expression
registerBindingKind('test-order', {
    match: (attr) => attr.name === 'x-order',
    compile: ({ nodePath, parts, attr }) => ({ nodePath, kind: 'test-order', parts, attrName: attr!.name }),
    attach: (node, entry, scope) => {
        order.push((node as Element).localName);
        return createBinding({
            scope,
            expressions: entry.parts,
            apply: (value) => (node as Element).setAttribute('data-value', String(value)),
            kind: 'test-order',
            nodePath: entry.nodePath,
        });
    },
});

registerBindingKind('test-unattached', {
    match: (attr) => attr.name === 'x-unattached',
    compile: ({ nodePath, parts }) => ({ nodePath, kind: 'test-unattached', parts }),
});

describe('instantiate', () => {
    beforeEach(() => {
        order.length = 0;
    });

    it('should return a detached fragment and leave the document unchanged', () => {
        // Arrange
        const store = createStore<any>({ a: 1 });
        const before = document.body.innerHTML;

        // Act
        const instance = instantiate(compileTemplate('<div x-order="{{ $.a }}"><span>x</span></div>'), new Scope(store, '$'));

        // Assert
        expect(instance.fragment.isConnected).toBe(false);
        expect(document.body.innerHTML).toBe(before);
        expect((instance.fragment.firstChild as Element).getAttribute('data-value')).toBe('1');
    });

    it('should attach bindings in document order, parents before children', () => {
        // Arrange
        const compiled = compileTemplate('<section x-order="{{ $.a }}"><article x-order="{{ $.a }}"><em x-order="{{ $.a }}">e</em></article><aside x-order="{{ $.a }}" /></section>');

        // Act
        instantiate(compiled, new Scope(createStore<any>({ a: 1 }), '$'));

        // Assert
        expect(order).toEqual(['section', 'article', 'em', 'aside']);
    });

    it('should throw StateUIError naming a kind without an attach step', () => {
        // Arrange
        const compiled = compileTemplate('<p x-unattached="{{ $.a }}">x</p>');

        // Act / Assert
        expect(() => instantiate(compiled, new Scope(createStore<any>({ a: 1 }), '$'))).toThrow(StateUIError);
        expect(() => instantiate(compiled, new Scope(createStore<any>({ a: 1 }), '$'))).toThrow('test-unattached');
    });

    it('should dispose bindings already attached when a later attach fails', () => {
        // Arrange
        const store = createStore<any>({ a: 1 });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const compiled = compileTemplate('<div x-order="{{ $.a }}"><p x-unattached="{{ $.a }}">x</p></div>');

        // Act
        expect(() => instantiate(compiled, new Scope(store, '$'))).toThrow(StateUIError);

        // Assert
        expect(on.mock.calls.length).toBeGreaterThan(0);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
    });

    it('should dispose every binding once, balance store.on with store.off and stop applying', () => {
        // Arrange
        const store = createStore<any>({ a: 1, b: { c: 2 } });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const instance = instantiate(compileTemplate('<div x-order="{{ $.a }}"><b x-order="{{ $.b.c }}">x</b></div>'), new Scope(store, '$'));
        const div = instance.fragment.firstChild as Element;

        // Act
        instance.dispose();
        instance.dispose();
        store.set('a', 99);

        // Assert
        expect(on.mock.calls.length).toBeGreaterThan(0);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
        expect(div.getAttribute('data-value')).toBe('1');
    });

    it('should keep updating a live instance before dispose', () => {
        // Arrange
        const store = createStore<any>({ a: 1 });
        const instance = instantiate(compileTemplate('<i x-order="{{ $.a +++ \'!\' }}">x</i>'), new Scope(store, '$'));

        // Act
        store.set('a', 2);

        // Assert
        expect((instance.fragment.firstChild as Element).getAttribute('data-value')).toBe('2!');
    });
});

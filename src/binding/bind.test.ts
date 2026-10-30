import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { TemplateCompileError } from '../errors.js';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';

/**
 * Compiles and instantiates source, returning the store, the instance and the first input element
 * @param source
 * @param state
 * @param scopeOf
 */
const render = (source: string, state: Record<string, unknown>, scopeOf?: (scope: Scope) => Scope) => {
    const store = createStore<any>(state);
    const root = new Scope(store, '$');
    const instance = instantiate(compileTemplate(source), scopeOf ? scopeOf(root) : root);
    const input = (instance.fragment.firstChild as Element).localName === 'input'
        ? instance.fragment.firstChild as HTMLInputElement
        : (instance.fragment.firstChild as Element).querySelector('input')!;
    return { store, instance, input };
};

describe('bind (two-way)', () => {
    describe('compile', () => {
        it('should remove the bind attribute and the claimed sibling from the template content', () => {
            // Act
            const { template, plan } = compileTemplate('<input value="{{ $.name }}" bind="value" />');
            const input = template.content.firstChild as Element;

            // Assert
            expect(input.hasAttribute('bind')).toBe(false);
            expect(input.hasAttribute('value')).toBe(false);
            expect(plan).toEqual([expect.objectContaining({ kind: 'bind', property: 'value', variable: '$.name' })]);
        });

        const bad: Readonly<Record<string, string>> = Object.freeze({
            'an unsupported property': '<input value="{{ $.name }}" bind="innerHTML" />',
            'a missing sibling': '<input bind="value" />',
            'a literal sibling': '<input value="fixed" bind="value" />',
            'a mixed sibling': '<input value="a {{ $.name }}" bind="value" />',
            'a sibling that is not a pure path': '<input value="{{ $.first +++ $.last }}" bind="value" />',
        });
        for (const [name, source] of Object.entries(bad)) {
            it(`should throw TemplateCompileError for ${name}`, () => {
                // Act / Assert
                expect(() => compileTemplate(source)).toThrow(TemplateCompileError);
            });
        }

        it('should throw TemplateCompileError at attach for a local without a store path', () => {
            // Arrange
            const compiled = compileTemplate('<input value="{{ $.draft }}" bind="value" />');
            const scope = new Scope(createStore<any>({}), '$', { locals: { draft: { value: 'x' } } });

            // Act / Assert
            expect(() => instantiate(compiled, scope)).toThrow(TemplateCompileError);
        });
    });

    describe('text input', () => {
        it('should render state, write user input back once and never rewrite the field during the round trip', () => {
            // Arrange
            const { store, input } = render('<input value="{{ $.name }}" bind="value" />', { name: 'Jo' });
            expect(input.value).toBe('Jo');
            input.value = 'Joe';
            const setSpy = vi.spyOn(store, 'set');
            const valueSetter = vi.spyOn(input, 'value', 'set');

            // Act
            input.dispatchEvent(new Event('input'));

            // Assert
            expect(store.get('$.name')).toBe('Joe');
            expect(setSpy).toHaveBeenCalledTimes(1);
            expect(valueSetter).not.toHaveBeenCalled();
        });

        it('should write state changes to the field', () => {
            // Arrange
            const { store, input } = render('<input value="{{ $.name }}" bind="value" />', { name: 'Jo' });

            // Act
            store.set('name', 'Max');

            // Assert
            expect(input.value).toBe('Max');
        });

        it('should write back through a local with a store path', () => {
            // Arrange
            const { store, input } = render(
                '<div><input value="{{ $v.name }}" bind="value" /></div>',
                { items: [{ name: 'a' }, { name: 'b' }] },
                (root) => root.child({ $v: { path: '$.items.1' } }, { ancestorFloor: '$.items.1' })
            );

            // Act
            input.value = 'B!';
            input.dispatchEvent(new Event('change'));

            // Assert
            expect(store.get('$.items.1.name')).toBe('B!');
            expect(store.get('$.items.0.name')).toBe('a');
        });
    });

    describe('checkbox', () => {
        it('should bind checked both ways', () => {
            // Arrange
            const { store, input } = render('<input type="checkbox" checked="{{ $.done }}" bind="checked" />', { done: false });
            expect(input.checked).toBe(false);

            // Act
            input.checked = true;
            input.dispatchEvent(new Event('change'));
            store.set('done', false);

            // Assert
            expect(input.checked).toBe(false);
            expect(store.get('$.done')).toBe(false);
        });
    });

    describe('number input', () => {
        it('should bind valueAsNumber and not loop on an empty field (NaN)', () => {
            // Arrange
            const { store, input } = render('<input type="number" valueAsNumber="{{ $.qty }}" bind="valueAsNumber" />', { qty: 2 });
            expect(input.valueAsNumber).toBe(2);
            input.value = '';
            const setSpy = vi.spyOn(store, 'set');

            // Act
            input.dispatchEvent(new Event('input'));

            // Assert
            expect(Number.isNaN(store.get('$.qty'))).toBe(true);
            expect(setSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('failed write-back', () => {
        it('should report, not throw, when the parent path does not exist', () => {
            // Arrange
            const errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
            const { input } = render('<input value="{{ $.missing.name }}" bind="value" />', {});
            input.value = 'x';

            try {
                // Act / Assert
                expect(() => input.dispatchEvent(new Event('input'))).not.toThrow();
                expect(errorSpy).toHaveBeenCalledTimes(1);
                expect(errorSpy.mock.calls[0][0]).toContain('could not write value');
            }
            finally {
                errorSpy.mockRestore();
            }
        });
    });
});

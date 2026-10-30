import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';
import { tokenize } from '../template/tokenize.js';
import { attachAttribute, isUnsafeUrl, toCamelCase } from './attribute.js';

/**
 * Compiles and instantiates a template against a fresh store, returning the store and the first element
 * @param source
 * @param state
 */
const render = (source: string, state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const instance = instantiate(compileTemplate(source), new Scope(store, '$'));
    return { store, instance, element: instance.fragment.firstChild as HTMLElement };
};

describe('text binding', () => {
    it('should render null and undefined as empty and everything else with String()', () => {
        // Act
        const { element } = render('<p>{{ $.a }}|{{ $.b }}|{{ $.c }}|{{ $.d }}</p>', { a: null, c: 0, d: false });

        // Assert
        expect(element.textContent).toBe('||0|false');
    });

    it('should update synchronously: the text reads the new value as soon as the write returns', () => {
        // Arrange
        const { store, element } = render('<h1>{{ $.title }}</h1>', { title: 'a' });

        // Act
        store.state.title = 'b';

        // Assert (no await)
        expect(element.textContent).toBe('b');
    });

    it('should not write textContent when an unrelated part of the state changes', () => {
        // Arrange
        const { store, element } = render('<p>{{ $.a.b }}</p>', { a: { b: 'same', c: 1 } });
        const textNode = element.firstChild as Text;
        const setter = vi.spyOn(textNode, 'textContent', 'set');

        // Act: the merge emits on $.a.c and $.a, so the binding re-evaluates but its value is unchanged
        store.set('a', { b: 'same', c: 2 });

        // Assert
        expect(setter).not.toHaveBeenCalled();
        expect(element.textContent).toBe('same');
    });
});

describe('attribute binding', () => {
    it('should always write a multi-part value as a string', () => {
        // Arrange
        const { store, element } = render(`<div class="card {{ $.sel ? 'on' : '' }}">x</div>`, { sel: true });
        expect(element.getAttribute('class')).toBe('card on');

        // Act
        store.set('sel', false);

        // Assert
        expect(element.getAttribute('class')).toBe('card ');
    });

    const singleExpressionCases: ReadonlyArray<readonly [string, unknown, (element: HTMLElement) => void]> = Object.freeze([
        ['a string', 'hello', (el) => expect(el.getAttribute('data-item-id')).toBe('hello')],
        ['a number', 42, (el) => expect(el.getAttribute('data-item-id')).toBe('42')],
        ['true', true, (el) => expect(el.getAttribute('data-item-id')).toBe('')],
        ['false', false, (el) => expect(el.hasAttribute('data-item-id')).toBe(false)],
        ['null', null, (el) => expect(el.hasAttribute('data-item-id')).toBe(false)],
        ['undefined', undefined, (el) => expect(el.hasAttribute('data-item-id')).toBe(false)],
        ['an object', { id: 7 }, (el) => {
            expect((el as any).dataItemId).toEqual({ id: 7 });
            expect(el.hasAttribute('data-item-id')).toBe(false);
        }],
        ['a function', () => 'fn', (el) => {
            expect(typeof (el as any).dataItemId).toBe('function');
            expect(el.hasAttribute('data-item-id')).toBe(false);
        }],
    ]);

    for (const [name, value, assert] of singleExpressionCases) {
        it(`should apply a single expression evaluating to ${name}`, () => {
            // Arrange
            const { store, element } = render('<div data-item-id="{{ $.value }}">x</div>', { value: 'initial' });
            expect(element.getAttribute('data-item-id')).toBe('initial');

            // Act
            store.set('value', value);

            // Assert
            assert(element);
        });
    }

    it('should clear the property when switching from property mode back to attribute mode', () => {
        // Arrange
        const { store, element } = render('<div data-item-id="{{ $.value }}">x</div>', { value: { id: 1 } });
        expect((element as any).dataItemId).toEqual({ id: 1 });

        // Act
        store.set('value', 'text');

        // Assert
        expect((element as any).dataItemId).toBeUndefined();
        expect(element.getAttribute('data-item-id')).toBe('text');
    });

    it('should never write an on* attribute, whatever the value', () => {
        // Arrange: compile routes on* to the event kind; this checks the attribute binding's own guard
        const button = document.createElement('button');
        const store = createStore<any>({ handler: 'alert(1)', other: () => undefined });
        const scope = new Scope(store, '$');
        const string = attachAttribute(button, { nodePath: [0], kind: 'attribute', attrName: 'onclick', parts: tokenize('{{ $.handler }}').parts }, scope);
        const fn = attachAttribute(button, { nodePath: [0], kind: 'attribute', attrName: 'OnMouseOver', parts: tokenize('{{ $.other }}').parts }, scope);

        // Act
        string.update();
        fn.update();

        // Assert
        expect(button.hasAttribute('onclick')).toBe(false);
        expect(button.hasAttribute('onmouseover')).toBe(false);
        expect(button.onclick).toBeNull();
        expect(button.onmouseover).toBeNull();
    });

    describe('javascript: URLs', () => {
        let errorSpy: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        });
        afterEach(() => {
            errorSpy.mockRestore();
        });

        const urls: ReadonlyArray<readonly [string, boolean]> = Object.freeze([
            ['javascript:alert(1)', false],
            [' JaVa\tScRiPt:x', false],
            ['https://x', true],
        ]);

        for (const [url, allowed] of urls) {
            it(`should ${allowed ? 'allow' : 'refuse'} ${JSON.stringify(url)} in href`, () => {
                // Act
                const { element } = render('<a href="{{ $.url }}">x</a>', { url });

                // Assert
                expect(element.getAttribute('href')).toBe(allowed ? url : null);
                expect(errorSpy).toHaveBeenCalledTimes(allowed ? 0 : 1);
            });
        }

        it('should refuse javascript: in src, action and formaction, including in a multi-part value', () => {
            // Act / Assert
            expect(isUnsafeUrl('src', 'javascript:x')).toBe(true);
            expect(isUnsafeUrl('ACTION', '\u0000javascript:x')).toBe(true);
            expect(isUnsafeUrl('formaction', 'JAVASCRIPT:x')).toBe(true);
            expect(isUnsafeUrl('title', 'javascript:x')).toBe(false);
            const { element } = render('<a href="java{{ $.rest }}">x</a>', { rest: 'script:alert(1)' });
            expect(element.hasAttribute('href')).toBe(false);
            expect(errorSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('should convert dashed attribute names to camelCase properties', () => {
        // Act / Assert
        expect(toCamelCase('data-item-id')).toBe('dataItemId');
        expect(toCamelCase('value')).toBe('value');
    });
});

import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { StateUIError } from '../errors.js';
import { registerMixin, unregisterMixin } from '../mixin/registry.js';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';

let counter = 0;
const nextName = (base: string) => `x-${base}-${++counter}`;

describe('mixins', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    const registered: string[] = [];

    const register = (base: string, fn: Parameters<typeof registerMixin>[1]) => {
        const name = nextName(base);
        registerMixin(name, fn);
        registered.push(name);
        return name;
    };

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
        registered.splice(0).forEach(unregisterMixin);
    });

    describe('registry', () => {
        it('should reject a duplicate, invalid or reserved name', () => {
            // Arrange
            const name = register('dup', () => undefined);

            // Act / Assert
            expect(() => registerMixin(name, () => undefined)).toThrow(StateUIError);
            expect(() => registerMixin('1bad', () => undefined)).toThrow(StateUIError);
            expect(() => registerMixin('has space', () => undefined)).toThrow(StateUIError);
            for (const reserved of ['if', 'ifelse', 'else', 'repeat', 'key', 'bind', 'state', 'onclick', 'OnHover']) {
                expect(() => registerMixin(reserved, () => undefined)).toThrow(StateUIError);
            }
        });
    });

    describe('attach and dispose', () => {
        it('should call the mixin once with the element, literal and evaluated attrs and the scope', () => {
            // Arrange
            const calls: Array<{ element: Element; attrs: Readonly<Record<string, unknown>>; scope: Scope }> = [];
            const tooltip = register('tooltip', (element, attrs, scope) => { calls.push({ element, attrs, scope }); });
            const store = createStore<any>({ text: 'hello', size: 3 });
            const scope = new Scope(store, '$');

            // Act
            const instance = instantiate(compileTemplate(`<span ${tooltip}="{{ $.text }}" data-x="1">s</span>`), scope);

            // Assert
            expect(calls).toHaveLength(1);
            expect(calls[0].element).toBe(instance.fragment.firstChild);
            expect(calls[0].attrs).toEqual({ [tooltip]: 'hello' });
            expect(calls[0].scope).toBe(scope);
        });

        it('should give two mixins on one element both attribute values, literal and expression', () => {
            // Arrange
            const seen: Array<Record<string, unknown>> = [];
            const first = register('first', (_element, attrs) => { seen.push({ ...attrs }); });
            const second = register('second', (_element, attrs) => { seen.push({ ...attrs }); });

            // Act
            instantiate(compileTemplate(`<div ${first}="literal" ${second}="n={{ $.n }}">x</div>`), new Scope(createStore<any>({ n: 7 }), '$'));

            // Assert
            expect(seen).toEqual([
                { [first]: 'literal', [second]: 'n=7' },
                { [first]: 'literal', [second]: 'n=7' },
            ]);
        });

        it('should call the disposer exactly once even when dispose is called twice', () => {
            // Arrange
            const disposer = vi.fn();
            const name = register('disposable', () => disposer);
            const instance = instantiate(compileTemplate(`<i ${name}="x">i</i>`), new Scope(createStore<any>({}), '$'));

            // Act
            instance.dispose();
            instance.dispose();

            // Assert
            expect(disposer).toHaveBeenCalledTimes(1);
        });
    });

    describe('reactivity', () => {
        it('should not re-invoke the mixin or change its attrs on a later state write', () => {
            // Arrange
            const mixin = vi.fn();
            const name = register('static', mixin);
            const store = createStore<any>({ v: 'first' });
            instantiate(compileTemplate(`<p ${name}="{{ $.v }}">p</p>`), new Scope(store, '$'));
            const attrs = mixin.mock.calls[0][1];

            // Act
            store.set('v', 'second');

            // Assert
            expect(mixin).toHaveBeenCalledTimes(1);
            expect(attrs).toEqual({ [name]: 'first' });
            expect(Object.isFrozen(attrs)).toBe(true);
        });

        it('should let a mixin subscribe itself and stop receiving writes after dispose', () => {
            // Arrange
            const received: unknown[] = [];
            const name = register('reactive', (_element, _attrs, scope) => {
                const subscription = scope.subscribe(['$.v'], () => received.push(scope.store.get('$.v')));
                return () => subscription.dispose();
            });
            const store = createStore<any>({ v: 1 });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const instance = instantiate(compileTemplate(`<b ${name}="x">b</b>`), new Scope(store, '$'));

            // Act
            store.set('v', 2);
            instance.dispose();
            store.set('v', 3);

            // Assert
            expect(received).toEqual([2]);
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
        });
    });

    describe('compile-time registration and errors', () => {
        it('should not apply a mixin registered after the template was compiled', () => {
            // Arrange
            const name = nextName('late');
            const compiled = compileTemplate(`<s ${name}="x">s</s>`);
            const late = vi.fn();
            registerMixin(name, late);
            registered.push(name);

            // Act
            instantiate(compiled, new Scope(createStore<any>({}), '$'));

            // Assert
            expect(late).not.toHaveBeenCalled();
        });

        it('should report a throwing mixin and still attach the other bindings and mixins', () => {
            // Arrange
            const after = vi.fn();
            const broken = register('broken', () => { throw new Error('mixin boom'); });
            const healthy = register('healthy', after);

            // Act
            const instance = instantiate(
                compileTemplate(`<div><a ${broken}="x">{{ $.t }}</a><b ${healthy}="y">b</b></div>`),
                new Scope(createStore<any>({ t: 'text' }), '$')
            );

            // Assert
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toContain('mixin boom');
            expect(after).toHaveBeenCalledTimes(1);
            expect((instance.fragment.firstChild as Element).querySelector('a')!.textContent).toBe('text');
        });
    });
});

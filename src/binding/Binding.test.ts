import { report } from '@punyts/core';
import Expression from '@punyts/expression';
import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { tokenize } from '../template/tokenize.js';
import { createBinding, type Binding } from './Binding.js';

const createItemsStore = () => createStore<any>({
    title: 'T',
    count: 1,
    items: [{ name: 'a' }, { name: 'b' }],
});

describe('createBinding', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    describe('update', () => {
        it('should not apply on creation and apply the evaluated value on the first update', () => {
            // Arrange
            const apply = vi.fn();
            const binding = createBinding({ scope: new Scope(createItemsStore(), '$'), expressions: Expression('$.title'), apply, kind: 'text', nodePath: [0] });

            // Act / Assert
            expect(apply).not.toHaveBeenCalled();
            binding.update();
            expect(apply).toHaveBeenCalledWith('T');
        });

        it('should re-apply synchronously when the store changes and skip unchanged values', () => {
            // Arrange
            const store = createItemsStore();
            const apply = vi.fn();
            createBinding({ scope: new Scope(store, '$'), expressions: Expression('$.count > 1'), apply, kind: 'attribute', nodePath: [0, 1] }).update();
            apply.mockClear();

            // Act
            store.set('count', 0);
            store.set('count', 2);
            store.set('count', 3);

            // Assert: false -> false is skipped, false -> true applies, true -> true is skipped
            expect(apply.mock.calls).toEqual([[true]]);
        });

        it('should compose tokenize parts into a string and keep a single expression\'s raw value', () => {
            // Arrange
            const store = createItemsStore();
            const scope = new Scope(store, '$');
            const text = vi.fn();
            const raw = vi.fn();
            createBinding({ scope, expressions: tokenize('Hi {{ $.title }} ({{ $.missing }})').parts, apply: text, kind: 'text', nodePath: [0] }).update();
            createBinding({ scope, expressions: tokenize('{{ $.count }}').parts, apply: raw, kind: 'attribute', nodePath: [1] }).update();

            // Assert
            expect(text).toHaveBeenCalledWith('Hi T ()');
            expect(raw).toHaveBeenCalledWith(1);
        });
    });

    describe('dispose', () => {
        it('should unsubscribe every path it registered, stop applying and be idempotent', () => {
            // Arrange
            const store = createItemsStore();
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const apply = vi.fn();
            const binding = createBinding({ scope: new Scope(store, '$'), expressions: Expression('$.items.0.name +++ $.title'), apply, kind: 'text', nodePath: [0] });

            // Act
            binding.dispose();
            binding.dispose();
            store.set('$.items.0.name', 'z');
            binding.update();

            // Assert
            expect(on.mock.calls.length).toBeGreaterThan(0);
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
            expect(binding.disposed).toBe(true);
            expect(apply).not.toHaveBeenCalled();
        });
    });

    describe('rebind and Scope.setLocals', () => {
        it('should follow a local to its new store path and stop listening to the old one', () => {
            // Arrange
            const store = createItemsStore();
            const item = new Scope(store, '$').child({ $v: { path: '$.items.0' } }, { ancestorFloor: '$.items.0' });
            const apply = vi.fn();
            createBinding({ scope: item, expressions: Expression('$v.name'), apply, kind: 'text', nodePath: [0] }).update();
            expect(apply).toHaveBeenLastCalledWith('a');

            // Act
            item.setLocals({ $v: { path: '$.items.1' } }, { ancestorFloor: '$.items.1' });

            // Assert: the forced update rendered the new item
            expect(apply).toHaveBeenLastCalledWith('b');
            apply.mockClear();
            store.set('$.items.0.name', 'changed 0');
            expect(apply).not.toHaveBeenCalled();
            store.set('$.items.1.name', 'changed 1');
            expect(apply).toHaveBeenCalledWith('changed 1');
            expect(item.ancestorFloor).toBe('$.items.1');
        });

        it('should keep other locals and not rebind a binding disposed before setLocals', () => {
            // Arrange
            const store = createItemsStore();
            const item = new Scope(store, '$').child({ $v: { path: '$.items.0' }, $i: { value: 0 } });
            const live = createBinding({ scope: item, expressions: Expression('$v.name'), apply: vi.fn(), kind: 'text', nodePath: [0] });
            const gone = createBinding({ scope: item, expressions: Expression('$v.name'), apply: vi.fn(), kind: 'text', nodePath: [1] });
            const liveRebind = vi.spyOn(live, 'rebind');
            const goneRebind = vi.spyOn(gone, 'rebind');
            gone.dispose();

            // Act
            item.setLocals({ $v: { path: '$.items.1' } });

            // Assert
            expect(liveRebind).toHaveBeenCalledTimes(1);
            expect(goneRebind).not.toHaveBeenCalled();
            expect(item.locals.get('$i')).toEqual({ value: 0 });
        });
    });

    describe('re-entrancy', () => {
        it('should skip a binding disposed by an earlier binding in the same emit', () => {
            // Arrange
            const store = createItemsStore();
            const scope = new Scope(store, '$');
            const applyB = vi.fn();
            const applyC = vi.fn();
            let bindingB: Binding | undefined;
            createBinding({ scope, expressions: Expression('$.title'), apply: () => bindingB?.dispose(), kind: 'text', nodePath: [0] });
            bindingB = createBinding({ scope, expressions: Expression('$.title'), apply: applyB, kind: 'text', nodePath: [1] });
            createBinding({ scope, expressions: Expression('$.title'), apply: applyC, kind: 'text', nodePath: [2] });

            // Act
            store.set('title', 'changed');

            // Assert
            expect(applyB).not.toHaveBeenCalled();
            expect(applyC).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });

    describe('error isolation', () => {
        it('should report a throwing expression once per update with kind and node path and keep other bindings updating', () => {
            // Arrange
            const store = createItemsStore();
            const scope = new Scope(store, '$', { locals: { boom: { value: () => { throw new Error('kaboom'); } } } });
            const failing = vi.fn();
            const healthy = vi.fn();
            createBinding({ scope, expressions: Expression('$.boom($.title)'), apply: failing, kind: 'attribute', nodePath: [2, 0] });
            createBinding({ scope, expressions: Expression('$.title'), apply: healthy, kind: 'text', nodePath: [3] });

            // Act
            store.set('title', 'first');
            store.set('title', 'second');

            // Assert
            expect(failing).not.toHaveBeenCalled();
            expect(healthy.mock.calls).toEqual([['first'], ['second']]);
            expect(errorSpy).toHaveBeenCalledTimes(2);
            const [message] = errorSpy.mock.calls[0];
            expect(message).toContain('attribute');
            expect(message).toContain('[2,0]');
            expect(message).toContain('kaboom');
        });

        it('should report a throwing apply and retry it on the next change', () => {
            // Arrange
            const store = createItemsStore();
            const apply = vi.fn()
                .mockImplementationOnce(() => { throw new Error('dom write failed'); })
                .mockImplementation(() => undefined);
            createBinding({ scope: new Scope(store, '$'), expressions: Expression('$.title'), apply, kind: 'text', nodePath: [4] });

            // Act
            store.set('title', 'x');
            store.set('title', 'y');

            // Assert
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toContain('apply failed');
            expect(apply.mock.calls).toEqual([['x'], ['y']]);
        });
    });
});

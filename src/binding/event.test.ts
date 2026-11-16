import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';

describe('event binding', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let addSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        //spy where elements actually get addEventListener from (happy-dom defines it below EventTarget.prototype)
        let owner: object = HTMLButtonElement.prototype;
        while (!Object.prototype.hasOwnProperty.call(owner, 'addEventListener')) {
            owner = Object.getPrototypeOf(owner);
        }
        addSpy = vi.spyOn(owner as EventTarget, 'addEventListener');
    });

    afterEach(() => {
        errorSpy.mockRestore();
        addSpy.mockRestore();
    });

    it('should keep one native listener while the handler re-resolves, and remove it on dispose', () => {
        // Arrange
        const store = createStore<any>({ items: [{ name: 'a' }], n: 0 });
        const select = vi.fn();
        const item = new Scope(store, '$', { locals: { select: { value: select } } })
            .child({ $v: { path: '$.items.0' } }, { ancestorFloor: '$.items.0' });
        const instance = instantiate(compileTemplate('<button onclick="{{ ($v)=>$.select }}">x</button>'), item);
        const button = instance.fragment.firstChild as HTMLButtonElement;

        // Act: three writes that re-resolve the bound handler
        store.set('$.items.0.name', 'b');
        store.set('$.items.0.name', 'c');
        store.set('$.items.0.name', 'd');
        button.dispatchEvent(new Event('click'));

        // Assert
        expect(addSpy.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
        expect(select).toHaveBeenCalledTimes(1);
        instance.dispose();
        button.dispatchEvent(new Event('click'));
        expect(select).toHaveBeenCalledTimes(1);
    });

    it('should listen for the attribute name minus "on" with its case preserved', () => {
        // Arrange
        const handler = vi.fn();
        const instance = instantiate(
            compileTemplate('<div onItemPicked="{{ $.picked }}">x</div>'),
            new Scope(createStore<any>({}), '$', { locals: { picked: { value: handler } } })
        );

        // Act
        (instance.fragment.firstChild as Element).dispatchEvent(new Event('ItemPicked'));
        (instance.fragment.firstChild as Element).dispatchEvent(new Event('itempicked'));

        // Assert
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should call a bind function with bound args first, the event last and this === null', () => {
        // Arrange: select is a controller-member local, pick is a function held in the store; $v is a store-path local
        const calls: Array<{ self: unknown; args: unknown[] }> = [];
        function record(this: unknown, ...args: unknown[]) {
            calls.push({ self: this, args });
        }
        const store = createStore<any>({ items: [{ name: 'a' }, { name: 'b' }], pick: record });
        const item = new Scope(store, '$', { locals: { select: { value: record } } })
            .child({ $v: { path: '$.items.1' } }, { ancestorFloor: '$.items.1' });
        const instance = instantiate(
            compileTemplate('<div><button onclick="{{ ($v)=>$.select }}">s</button><button onclick="{{ ($v)=>$.pick }}">p</button></div>'),
            item
        );
        const [selectButton, pickButton] = Array.from((instance.fragment.firstChild as Element).children);
        const click = new Event('click');

        // Act
        selectButton.dispatchEvent(click);
        pickButton.dispatchEvent(click);

        // Assert
        expect(calls).toHaveLength(2);
        for (const { self, args } of calls) {
            expect(self).toBeNull();
            expect((args[0] as { name: string }).name).toBe('b');
            expect(args[args.length - 1]).toBe(click);
        }
    });

    it('should do nothing and report once when the expression is not a function', () => {
        // Arrange
        const instance = instantiate(compileTemplate('<button onclick="{{ $.notAFunction }}">x</button>'), new Scope(createStore<any>({ notAFunction: 3 }), '$'));
        const button = instance.fragment.firstChild as HTMLButtonElement;

        // Act
        button.dispatchEvent(new Event('click'));
        button.dispatchEvent(new Event('click'));

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('did not resolve to a function');
    });

    it('should report a throwing handler and still run the element\'s other listeners', () => {
        // Arrange: a failing bound handler and a second, native listener for the same event on the same element
        const scope = new Scope(createStore<any>({}), '$', {
            locals: { fail: { value: () => { throw new Error('handler broke'); } } },
        });
        const instance = instantiate(compileTemplate('<button onclick="{{ $.fail }}">x</button>'), scope);
        const button = instance.fragment.firstChild as HTMLButtonElement;
        const native = vi.fn();
        button.addEventListener('click', native);

        // Act
        button.dispatchEvent(new Event('click'));

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('handler broke');
        expect(native).toHaveBeenCalledTimes(1);
    });
});

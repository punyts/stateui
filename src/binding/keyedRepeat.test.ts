import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from '../template/compile.js';
import { instantiate } from '../template/instantiate.js';
import { reconcileKeyed } from './reconcile.js';

const KEYED_LIST = '<ul><li repeat="{{ $k,$i,$v in $.items }}" key="{{ $v.id }}">{{ $i }}:{{ $v.id }}</li></ul>';

const render = (items: unknown[]) => {
    const store = createStore<any>({ items });
    const instance = instantiate(compileTemplate(KEYED_LIST), new Scope(store, '$'));
    return { store, root: instance.fragment.firstChild as Element, instance };
};

const texts = (root: Element) => Array.from(root.children).map((child) => child.textContent);

/**
 * Spies on the prototype that actually owns a DOM method (happy-dom defines some below Node.prototype)
 * @param method
 */
const spyOnDom = (method: 'insertBefore' | 'removeChild') => {
    let owner: object = HTMLLIElement.prototype;
    while (!Object.prototype.hasOwnProperty.call(owner, method)) {
        owner = Object.getPrototypeOf(owner);
    }
    return vi.spyOn(owner as Node, method);
};

const hundred = () => Array.from({ length: 100 }, (_unused, id) => ({ id }));

describe('reconcileKeyed', () => {
    it('should reuse, create and remove by key and keep the longest in-order run stable', () => {
        // Arrange
        const existing = ['a', 'b', 'c', 'd'];

        // Act
        const plan = reconcileKeyed(existing, ['d', 'a', 'c', 'x'], (item) => item);

        // Assert
        expect(plan.matches).toEqual(['d', 'a', 'c', undefined]);
        expect(plan.removed).toEqual(['b']);
        expect([...plan.stable].sort()).toEqual(['a', 'c']);
    });

    it('should match keys by SameValueZero', () => {
        // Act
        const plan = reconcileKeyed([NaN, 0], [NaN, -0], (item) => item);

        // Assert
        expect(plan.removed).toEqual([]);
        expect(plan.matches).toEqual([NaN, 0]);
    });
});

describe('keyed repeat', () => {
    let insertBefore: ReturnType<typeof spyOnDom>;
    let removeChild: ReturnType<typeof spyOnDom>;

    beforeEach(() => {
        insertBefore = spyOnDom('insertBefore');
        removeChild = spyOnDom('removeChild');
    });

    afterEach(() => {
        insertBefore.mockRestore();
        removeChild.mockRestore();
    });

    it('should remove one of 100 items with 1 removal, 0 insertions, and retarget the shifted items', () => {
        // Arrange
        const { store, root } = render(hundred());
        const second = root.children[1];
        insertBefore.mockClear();
        removeChild.mockClear();

        // Act
        store.delete('$.items.0');

        // Assert
        expect(removeChild).toHaveBeenCalledTimes(1);
        expect(insertBefore).not.toHaveBeenCalled();
        expect(root.children).toHaveLength(99);
        expect(root.children[0]).toBe(second);
        expect(root.children[0].textContent).toBe('0:1');
    });

    it('should move the last item to the front with exactly 1 insertion and no removals', () => {
        // Arrange
        const items = hundred();
        const { store, root } = render(items);
        const last = root.children[99];
        insertBefore.mockClear();
        removeChild.mockClear();

        // Act
        store.replace('items', [items[99], ...items.slice(0, 99)]);

        // Assert
        expect(insertBefore).toHaveBeenCalledTimes(1);
        expect(removeChild).not.toHaveBeenCalled();
        expect(root.children[0]).toBe(last);
        expect(root.children[0].textContent).toBe('0:99');
        expect(root.children[1].textContent).toBe('1:0');
    });

    it('should append one item with 1 insertion, synchronously', () => {
        // Arrange
        const { store, root } = render([{ id: 1 }, { id: 2 }, { id: 3 }]);
        insertBefore.mockClear();

        // Act
        store.state.items.push({ id: 4 });

        // Assert (no await)
        expect(insertBefore).toHaveBeenCalledTimes(1);
        expect(texts(root)).toEqual(['0:1', '1:2', '2:3', '3:4']);
    });

    it('should keep item DOM nodes when the same keys are reordered', () => {
        // Arrange
        const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const { store, root } = render(items);
        const [a, b, c] = Array.from(root.children);

        // Act
        store.replace('items', [items[2], items[0], items[1]]);

        // Assert
        expect(Array.from(root.children)).toEqual([c, a, b]);
        expect(texts(root)).toEqual(['0:c', '1:a', '2:b']);
    });

    it('should keep updating a moved item through its new path', () => {
        // Arrange
        const items = [{ id: 'a' }, { id: 'b' }];
        const { store, root } = render(items);
        store.replace('items', [items[1], items[0]]);

        // Act
        store.set('$.items.0.id', 'b2');

        // Assert
        expect(texts(root)).toEqual(['0:b2', '1:a']);
    });
});

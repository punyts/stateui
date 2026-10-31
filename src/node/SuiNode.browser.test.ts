import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import { setNodeResolver } from './options.js';
import { SuiNode } from './SuiNode.js';

let counter = 0;
const nextTag = (name: string) => `x-node-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

const addNode = (parent: Node, state: string) => {
    const node = document.createElement('sui-node') as SuiNode;
    node.setAttribute('state', state);
    return parent.appendChild(node);
};

describe('<sui-node> in Chromium', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        setNodeResolver(undefined);
        errorSpy.mockRestore();
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    it('should be defined by the library', () => {
        // Assert
        expect(customElements.get('sui-node')).toBe(SuiNode);
    });

    it('should render the element the resolver names with the same absolute state path', () => {
        // Arrange
        const label = nextTag('label');
        defineComponent({ tag: label, template: '<b>{{ $.text }}</b>' });
        setNodeResolver((name) => name === 'label' ? label : undefined);
        const { store, host } = createRoot({ nodes: { a: { component: 'label', text: 'hi' } } });

        // Act
        const node = addNode(host, 'nodes.a');

        // Assert
        const child = node.firstElementChild as HTMLElement;
        expect(child.localName).toBe(label);
        expect(child.getAttribute('state')).toBe('$.nodes.a');
        expect(child.shadowRoot!.textContent).toBe('hi');
        store.set('nodes.a.text', 'bye');
        expect(child.shadowRoot!.textContent).toBe('bye');
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should replace the child when component changes and release the old one', () => {
        // Arrange
        const dispose = vi.fn();
        const first = nextTag('first');
        const second = nextTag('second');
        defineComponent({ tag: first, template: '<b>{{ $.text }}</b>', controller: () => ({ dispose }) });
        defineComponent({ tag: second, template: '<i>{{ $.text }}</i>' });
        setNodeResolver((name) => ({ first, second })[name as 'first' | 'second']);
        const { store, host } = createRoot({ n: { component: 'first', text: 'x' } });
        const node = addNode(host, 'n');
        const old = node.firstElementChild!;

        // Act
        store.set('n.component', 'second');

        // Assert
        expect(old.isConnected).toBe(false);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(node.children).toHaveLength(1);
        expect(node.firstElementChild!.localName).toBe(second);
        expect(node.firstElementChild!.shadowRoot!.textContent).toBe('x');
    });

    it('should not recreate the child when another property changes', () => {
        // Arrange
        const tag = nextTag('stable');
        defineComponent({ tag, template: '<b>{{ $.text }}</b>' });
        setNodeResolver(() => tag);
        const { store, host } = createRoot({ n: { component: 'c', text: 'x' } });
        const node = addNode(host, 'n');
        const child = node.firstElementChild;

        // Act
        store.set('n.text', 'y');

        // Assert
        expect(node.firstElementChild).toBe(child);
    });

    it('should render nothing and report SUI-NODE-MISSING for a path with no node', () => {
        // Arrange
        setNodeResolver(() => 'x-any');
        const { host } = createRoot({ nodes: {} });

        // Act
        const node = addNode(host, 'nodes.gone');

        // Assert
        expect(node.children).toHaveLength(0);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SUI-NODE-MISSING'), expect.objectContaining({ state: '$.nodes.gone' }));
    });

    it('should render nothing and report SUI-NODE-MISSING for a node with no component', () => {
        // Arrange
        setNodeResolver(() => 'x-any');
        const { host } = createRoot({ n: { text: 'x' } });

        // Act
        const node = addNode(host, 'n');

        // Assert
        expect(node.children).toHaveLength(0);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SUI-NODE-MISSING'), expect.objectContaining({ code: 'SUI-NODE-MISSING', state: '$.n' }));
    });

    it('should render nothing and report SUI-NODE-MISSING for a name the resolver does not know', () => {
        // Arrange
        setNodeResolver(() => undefined);
        const { host } = createRoot({ n: { component: 'mystery' } });

        // Act
        const node = addNode(host, 'n');

        // Assert
        expect(node.children).toHaveLength(0);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('mystery'), expect.objectContaining({ code: 'SUI-NODE-MISSING', state: '$.n' }));
    });

    it('should render once the node appears', () => {
        // Arrange
        const tag = nextTag('late');
        defineComponent({ tag, template: '<b>{{ $.text }}</b>' });
        setNodeResolver(() => tag);
        const { store, host } = createRoot({});
        const node = addNode(host, 'n');

        // Act
        store.set('n', { component: 'c', text: 'here' });

        // Assert
        expect(node.firstElementChild!.shadowRoot!.textContent).toBe('here');
    });

    it('should render nested nodes three deep and dispose them with the outermost', () => {
        // Arrange
        const dispose = vi.fn();
        const leaf = nextTag('leaf');
        const mid = nextTag('mid');
        const top = nextTag('top');
        defineComponent({ tag: leaf, template: '<b>{{ $.text }}</b>', controller: () => ({ dispose }) });
        defineComponent({ tag: mid, template: '<sui-node state=".child"></sui-node>' });
        defineComponent({ tag: top, template: '<sui-node state=".child"></sui-node>' });
        setNodeResolver((name) => ({ top, mid, leaf })[name as 'top' | 'mid' | 'leaf']);
        const { host } = createRoot({ a: { component: 'top', child: { component: 'mid', child: { component: 'leaf', text: 'deep' } } } });

        // Act
        const outer = addNode(host, 'a');

        // Assert
        const topEl = outer.firstElementChild!;
        const midEl = topEl.shadowRoot!.querySelector('sui-node')!.firstElementChild!;
        const leafEl = midEl.shadowRoot!.querySelector('sui-node')!.firstElementChild!;
        expect(midEl.localName).toBe(mid);
        expect(leafEl.getAttribute('state')).toBe('$.a.child.child');
        expect(leafEl.shadowRoot!.textContent).toBe('deep');
        outer.remove();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should render a keyed-map repeat of nodes through state="{{ $v }}"', () => {
        // Arrange
        const tag = nextTag('row');
        const list = nextTag('list');
        defineComponent({ tag, template: '<b>{{ $.text }}</b>' });
        defineComponent({ tag: list, template: '<sui-node repeat="{{ $k,$i,$v in $.items }}" key="{{ $k }}" state="{{ $v }}"></sui-node>' });
        setNodeResolver(() => tag);
        const { store, host } = createRoot({ items: { a: { component: 'r', text: 'A' }, b: { component: 'r', text: 'B' } } });

        // Act
        const element = host.appendChild(document.createElement(list));
        store.set('items.c', { component: 'r', text: 'C' });

        // Assert
        const texts = Array.from(element.shadowRoot!.querySelectorAll('sui-node')).map((node) => node.firstElementChild!.shadowRoot!.textContent);
        expect(texts).toEqual(['A', 'B', 'C']);
    });

    it('should stop reacting and remove the child on unmount', () => {
        // Arrange
        const tag = nextTag('gone');
        defineComponent({ tag, template: '<b>{{ $.text }}</b>' });
        setNodeResolver(() => tag);
        const { store, host } = createRoot({ n: { component: 'c', text: 'x' } });
        const node = addNode(host, 'n');

        // Act
        unmount(host);
        store.set('n.component', 'd');

        // Assert
        expect(node.children).toHaveLength(0);
    });

    it('should be display: contents so the created element is a direct layout item of a grid parent', () => {
        // Arrange
        const tag = nextTag('cell');
        defineComponent({ tag, template: '<b>x</b>' });
        setNodeResolver(() => tag);
        const { host } = createRoot({ n: { component: 'c' } });
        const grid = host.appendChild(document.createElement('div'));
        grid.style.cssText = 'display: grid; grid-template-columns: 100px 200px; width: 300px';

        // Act
        const node = addNode(grid, 'n');
        const child = node.firstElementChild as HTMLElement;
        child.style.display = 'block';
        child.style.gridColumn = '2';
        const rect = child.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();

        // Assert
        expect(getComputedStyle(node).display).toBe('contents');
        expect(rect.left - gridRect.left).toBe(100);
        expect(rect.width).toBe(200);
    });
});

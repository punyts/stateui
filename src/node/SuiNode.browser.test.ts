import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import { setNodeOptions, setNodeResolver } from './options.js';
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
        setNodeOptions(undefined);
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

    describe('presentation', () => {
        const plain = (state: Record<string, unknown>, template = '<b>x</b>') => {
            const tag = nextTag('p');
            defineComponent({ tag, template });
            setNodeResolver(() => tag);
            const root = createRoot({ n: { component: 'c', ...state } });
            const node = addNode(root.host, 'n');
            return { ...root, node, child: node.firstElementChild as HTMLElement };
        };

        it('should write placement as kebab-case attributes, skip _ keys and ignore objects', () => {
            // Arrange
            const placement = { region: 'nw', col: 1, rowSpan: 2, span: true, _tab: 'Tab', nested: { a: 1 }, gone: false };

            // Act
            const { child } = plain({ placement });

            // Assert
            expect(child.getAttribute('region')).toBe('nw');
            expect(child.getAttribute('col')).toBe('1');
            expect(child.getAttribute('row-span')).toBe('2');
            expect(child.getAttribute('span')).toBe('');
            expect(child.hasAttribute('_tab')).toBe(false);
            expect(child.hasAttribute('nested')).toBe(false);
            expect(child.hasAttribute('gone')).toBe(false);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('should update placement in place and remove an attribute when its key goes away or becomes null', () => {
            // Arrange
            const { store, child } = plain({ placement: { region: 'nw', col: 1, span: 2 } });

            // Act
            store.set('n.placement.region', 'se');

            // Assert
            expect(child.getAttribute('region')).toBe('se');

            // Act
            store.set('n.placement.col', null);

            // Assert
            expect(child.hasAttribute('col')).toBe(false);
            store.delete('n.placement.span');
            expect(child.hasAttribute('span')).toBe(false);
            expect(child.hasAttribute('span')).toBe(false);
            store.delete('n.placement');
            expect(child.hasAttribute('region')).toBe(false);
        });

        it('should write layout as attributes and custom properties on the layout-host in the shadow root', () => {
            // Arrange / Act
            const { child } = plain({ layout: { type: 'grid', collapseBelow: 'md', columns: 3 } }, '<div layout-host="" />');
            const layoutHost = child.shadowRoot!.querySelector('[layout-host]') as HTMLElement;

            // Assert
            expect(layoutHost.getAttribute('layout')).toBe('grid');
            expect(layoutHost.getAttribute('layout-collapse-below')).toBe('md');
            expect(layoutHost.style.getPropertyValue('--layout-collapse-below')).toBe('md');
            expect(layoutHost.getAttribute('layout-columns')).toBe('3');
            expect(layoutHost.style.getPropertyValue('--layout-columns')).toBe('3');
            expect(child.hasAttribute('layout')).toBe(false);
        });

        it('should write layout on the created element when it has no layout-host', () => {
            // Arrange / Act
            const { child } = plain({ layout: { type: 'row', gap: 'md' } });

            // Assert
            expect(child.getAttribute('layout')).toBe('row');
            expect(child.getAttribute('layout-gap')).toBe('md');
            expect(child.style.getPropertyValue('--layout-gap')).toBe('md');
        });

        it('should update layout in place and remove settings that disappear', () => {
            // Arrange
            const { store, child } = plain({ layout: { type: 'grid', columns: 3 } });

            // Act
            store.set('n.layout.type', 'row');
            store.delete('n.layout.columns');

            // Assert
            expect(child.getAttribute('layout')).toBe('row');
            expect(child.hasAttribute('layout-columns')).toBe(false);
            expect(child.style.getPropertyValue('--layout-columns')).toBe('');
            store.delete('n.layout');
            expect(child.hasAttribute('layout')).toBe(false);
        });

        it('should flatten theme through the mapper, calling it for nested paths, and update and remove leaves', () => {
            // Arrange
            const property = vi.fn((path: string[]) => `--ui-${path.join('-')}`);
            const value = vi.fn((text: string) => text.replace(/\{([^}]+)\}/g, (_match, ref: string) => `var(--ui-${ref.replace(/\./g, '-')})`));
            setNodeOptions({ theme: { property, value } });

            // Act
            const { store, child } = plain({ theme: { color: { accent: { base: '#2f6f4f', soft: '{color.success.soft}' } }, button: { radius: '4px' } } });

            // Assert
            expect(property).toHaveBeenCalledWith(['color', 'accent', 'base']);
            expect(child.style.getPropertyValue('--ui-color-accent-base')).toBe('#2f6f4f');
            expect(child.style.getPropertyValue('--ui-color-accent-soft')).toBe('var(--ui-color-success-soft)');
            expect(child.style.getPropertyValue('--ui-button-radius')).toBe('4px');

            // Act
            store.set('n.theme.color.accent.base', '#000000');
            store.delete('n.theme.button');

            // Assert
            expect(child.style.getPropertyValue('--ui-color-accent-base')).toBe('#000000');
            expect(child.style.getPropertyValue('--ui-button-radius')).toBe('');
        });

        it('should not write theme without a mapper', () => {
            // Arrange / Act
            const { child } = plain({ theme: { color: { x: '1' } } });

            // Assert
            expect(child.getAttribute('style')).toBeNull();
        });

        it('should skip theme leaves the mapper declines', () => {
            // Arrange
            setNodeOptions({ theme: { property: (path) => path[0] === 'skip' ? undefined : `--t-${path.join('-')}`, value: (text) => text } });

            // Act
            const { child } = plain({ theme: { skip: { a: '1' }, keep: { b: '2' } } });

            // Assert
            expect(child.style.getPropertyValue('--t-keep-b')).toBe('2');
            expect(child.style.getPropertyValue('--t-skip-a')).toBe('');
        });

        it('should reflect only the listed properties, with boolean, number and removal rules', () => {
            // Arrange
            const reflect = vi.fn(() => ['textRole', 'tone', 'busy', 'size', 'off']);
            setNodeOptions({ reflect });

            // Act
            const { store, child } = plain({ textRole: 'heading', tone: 'danger', busy: true, size: 2, off: false, secret: { a: 1 }, label: 'no' });

            // Assert
            expect(reflect).toHaveBeenCalledWith('c');
            expect(child.getAttribute('text-role')).toBe('heading');
            expect(child.getAttribute('tone')).toBe('danger');
            expect(child.getAttribute('busy')).toBe('');
            expect(child.getAttribute('size')).toBe('2');
            expect(child.hasAttribute('off')).toBe(false);
            expect(child.hasAttribute('secret')).toBe(false);
            expect(child.hasAttribute('label')).toBe(false);

            // Act
            store.set('n.tone', 'info');
            store.set('n.busy', false);
            store.set('n.textRole', null);

            // Assert
            expect(child.getAttribute('tone')).toBe('info');
            expect(child.hasAttribute('busy')).toBe(false);
            expect(child.hasAttribute('text-role')).toBe(false);
        });

        it('should ignore unsafe names and report them', () => {
            // Arrange
            setNodeOptions({ reflect: () => ['ok', 'bad name', 'x"y'] });

            // Act
            const { child } = plain({ ok: 'v', placement: { 'a b': 1, region: 'n', 'x=y': 2 }, layout: { type: 'grid', 'bad key': 1 } });

            // Assert
            expect(child.getAttribute('ok')).toBe('v');
            expect(child.getAttribute('region')).toBe('n');
            expect(child.getAttribute('layout')).toBe('grid');
            const codes = errorSpy.mock.calls.map((call) => (call[1] as { code?: string }).code);
            expect(codes.filter((code) => code === 'SUI-NODE-NAME')).toHaveLength(5);
            expect(Array.from(child.attributes).map((attribute) => attribute.name).sort()).toEqual(['layout', 'ok', 'region', 'state']);
        });

        it('should ignore a theme property name that is not a custom property', () => {
            // Arrange
            setNodeOptions({ theme: { property: () => 'color', value: (text) => text } });

            // Act
            const { child } = plain({ theme: { a: 'red' } });

            // Assert
            expect(child.style.color).toBe('');
            expect(errorSpy).toHaveBeenCalledTimes(1);
        });

        it('should rebind to the new child when component changes', () => {
            // Arrange
            setNodeOptions({ reflect: (name) => name === 'c' ? ['tone'] : [] });
            const { store, node, child } = plain({ tone: 'danger', placement: { region: 'nw' } });

            // Act
            store.set('n.component', 'd');
            const next = node.firstElementChild as HTMLElement;
            store.set('n.placement.region', 'se');

            // Assert
            expect(next).not.toBe(child);
            expect(next.hasAttribute('tone')).toBe(false);
            expect(next.getAttribute('region')).toBe('se');
            expect(child.hasAttribute('region')).toBe(false);
        });

        it('should stop updating once the node is removed', () => {
            // Arrange
            const { store, node, child } = plain({ placement: { region: 'nw' } });

            // Act
            node.remove();
            store.set('n.placement.region', 'se');

            // Assert
            expect(child.hasAttribute('region')).toBe(false);
        });
    });
});

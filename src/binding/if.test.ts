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

const visibleTags = (root: Element) => Array.from(root.children).map((child) => child.localName);

describe('if / ifelse / else chains', () => {
    describe('compile', () => {
        it('should replace the chain with one anchor and keep sibling paths stable', () => {
            // Act
            const { template, plan } = compileTemplate('<div><a if="{{ $.x }}">a</a>\n  <!-- c -->\n  <b ifelse="{{ $.y }}">b</b> <i else="">i</i><p>{{ $.after }}</p></div>');
            const div = template.content.firstChild as Element;

            // Assert
            expect(Array.from(div.childNodes).map((node) => node.nodeType === Node.COMMENT_NODE ? '#anchor' : node.nodeName.toLowerCase())).toEqual(['#anchor', 'p']);
            expect(plan.map((entry) => [entry.kind, entry.nodePath])).toEqual([['if', [0, 0]], ['text', [0, 1, 0]]]);
            const branches = plan[0].branches as Array<{ template: { template: HTMLTemplateElement } }>;
            expect(branches).toHaveLength(3);
            expect((branches[0].template.template.content.firstChild as Element).hasAttribute('if')).toBe(false);
        });

        it('should end a chain at any other node', () => {
            // Act
            const { plan } = compileTemplate('<div><a if="{{ $.x }}">a</a><span>stop</span><b if="{{ $.y }}">b</b></div>');

            // Assert
            expect(plan.filter((entry) => entry.kind === 'if')).toHaveLength(2);
        });

        const bad: Readonly<Record<string, string>> = Object.freeze({
            'ifelse without a preceding member': '<div><b ifelse="{{ $.y }}">b</b></div>',
            'else without a preceding member': '<div><b else="">b</b></div>',
            'a second else': '<div><a if="{{ $.x }}">a</a><b else="">b</b><i else="">i</i></div>',
            'an if that is not a single expression': '<div><a if="x {{ $.x }}">a</a></div>',
            'a literal if': '<div><a if="true">a</a></div>',
            'an else with a value': '<div><a if="{{ $.x }}">a</a><b else="{{ $.y }}">b</b></div>',
        });
        for (const [name, source] of Object.entries(bad)) {
            it(`should throw TemplateCompileError with a node path for ${name}`, () => {
                // Act
                let error: unknown;
                try {
                    compileTemplate(source);
                }
                catch (caught) {
                    error = caught;
                }

                // Assert
                expect(error).toBeInstanceOf(TemplateCompileError);
                expect((error as TemplateCompileError).nodePath).toBeDefined();
            });
        }
    });

    describe('rendering', () => {
        it('should render the first truthy branch and swap synchronously', () => {
            // Arrange
            const { store, root } = render('<div><a if="{{ $.show }}">{{ $.label }}</a><b ifelse="{{ $.alt }}">alt</b><i else="">none</i></div>', { show: true, alt: false, label: 'L' });
            expect(visibleTags(root)).toEqual(['a']);
            expect(root.textContent).toBe('L');

            // Act / Assert (no await)
            store.state.show = false;
            expect(visibleTags(root)).toEqual(['i']);
            store.state.alt = true;
            expect(visibleTags(root)).toEqual(['b']);
            store.state.show = true;
            expect(visibleTags(root)).toEqual(['a']);
        });

        it('should render nothing when no branch matches and there is no else', () => {
            // Act
            const { store, root } = render('<div><a if="{{ $.show }}">a</a></div>', { show: false });

            // Assert
            expect(visibleTags(root)).toEqual([]);
            store.state.show = true;
            expect(visibleTags(root)).toEqual(['a']);
        });

        it('should not touch the DOM when a write keeps the same branch', () => {
            // Arrange
            const { store, root } = render('<div><a if="{{ $.n > 1 }}">big</a><i else="">small</i></div>', { n: 5 });
            const shown = root.firstElementChild;

            // Act
            store.set('n', 6);

            // Assert
            expect(root.firstElementChild).toBe(shown);
        });

        it('should insert the branch before the anchor, keeping its place among siblings', () => {
            // Act
            const { store, root } = render('<ul><li>first</li><li if="{{ $.show }}">middle</li><li>last</li></ul>', { show: false });
            store.state.show = true;

            // Assert
            expect(Array.from(root.children).map((li) => li.textContent)).toEqual(['first', 'middle', 'last']);
        });
    });

    describe('re-entrancy and disposal', () => {
        it('should never apply branch A bindings in the emit that switches to B, render B with the new state and call later siblings once', () => {
            // Arrange: a probe kind counts applies per element
            const applies: string[] = [];
            registerBindingKind('if-probe', {
                match: (attr) => attr.name === 'x-probe',
                compile: ({ nodePath, parts, attr }) => ({ nodePath, kind: 'if-probe', parts, label: attr!.value }),
                attach: (node, entry, scope) => createBinding({
                    scope,
                    expressions: entry.parts,
                    kind: 'if-probe',
                    nodePath: entry.nodePath,
                    apply: (value) => applies.push(`${(node as Element).localName}=${String(value)}`),
                }),
            });
            const { store, root } = render(
                '<div><a if="{{ $.mode == \'a\' }}" x-probe="{{ $.mode }}">A</a><b else="" x-probe="{{ $.mode }}">B</b><s x-probe="{{ $.mode }}">sib</s></div>',
                { mode: 'a' }
            );
            applies.length = 0;

            // Act
            store.set('mode', 'b');

            // Assert
            expect(visibleTags(root)).toEqual(['b', 's']);
            expect(applies.filter((entry) => entry.startsWith('a='))).toEqual([]);
            expect(applies.filter((entry) => entry.startsWith('b='))).toEqual(['b=b']);
            expect(applies.filter((entry) => entry.startsWith('s='))).toEqual(['s=b']);
        });

        it('should release every listener, branches included, when the owning instance is disposed', () => {
            // Arrange
            const store = createStore<any>({ show: true, x: 1, y: 2 });
            const on = vi.spyOn(store, 'on');
            const off = vi.spyOn(store, 'off');
            const instance = instantiate(
                compileTemplate('<div><a if="{{ $.show }}">{{ $.x }}</a><b else="">{{ $.y }}</b></div>'),
                new Scope(store, '$')
            );
            store.set('show', false);
            store.set('show', true);

            // Act
            instance.dispose();

            // Assert
            expect(on.mock.calls.length).toBeGreaterThan(0);
            expect(off.mock.calls.length).toBe(on.mock.calls.length);
        });
    });
});

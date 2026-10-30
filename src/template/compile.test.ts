import { registerBindingKind } from '../binding/registry.js';
import { TemplateCompileError } from '../errors.js';
import { compileTemplate } from './compile.js';
import * as parseModule from './parse.js';

vi.mock('./parse.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./parse.js')>();
    return { ...actual, parseTemplate: vi.fn(actual.parseTemplate) };
});

const expressionOf = (part: unknown) => (part as { original: string }).original;

/**
 * Resolves a node path against the template content
 * @param root
 * @param path
 */
const nodeAt = (root: Node, path: number[]) => path.reduce<Node>((node, index) => node.childNodes[index], root);

const allElements = (root: DocumentFragment) => Array.from(root.querySelectorAll('*'));

describe('compileTemplate', () => {
    it('should cache by template string and parse only once', () => {
        // Arrange
        const source = '<p class="cache">{{ $.a }}</p>';
        vi.mocked(parseModule.parseTemplate).mockClear();

        // Act
        const first = compileTemplate(source);
        const second = compileTemplate(source);

        // Assert
        expect(second).toBe(first);
        expect(parseModule.parseTemplate).toHaveBeenCalledTimes(1);
        expect(first.template).toBeInstanceOf(HTMLTemplateElement);
    });

    it('should split text so each expression has its own text node, recording paths after splitting', () => {
        // Act
        const { template, plan } = compileTemplate('<p>Hello {{ $.a }}!</p><div><b>x</b>{{ $.b }} and {{ $.c }}</div>');

        // Assert
        const paragraph = template.content.childNodes[0];
        expect(Array.from(paragraph.childNodes).map((node) => node.textContent)).toEqual(['Hello ', '', '!']);
        expect(plan.map((entry) => [entry.kind, entry.nodePath, expressionOf(entry.parts[0])])).toEqual([
            ['text', [0, 1], '$.a'],
            ['text', [1, 1], '$.b'],
            ['text', [1, 3], '$.c'],
        ]);
        expect(nodeAt(template.content, [1, 2]).textContent).toBe(' and ');
        expect(nodeAt(template.content, [1, 3]).nodeType).toBe(Node.TEXT_NODE);
    });

    it('should remove every {{ }} attribute from the content and record it in the plan', () => {
        // Act
        const { template, plan } = compileTemplate('<div><img src="{{ $.url }}" alt="x {{ $.alt }}" title="plain" /></div>');

        // Assert
        for (const element of allElements(template.content)) {
            for (const attr of Array.from(element.attributes)) {
                expect(attr.value).not.toContain('{{');
            }
        }
        const img = nodeAt(template.content, [0, 0]) as Element;
        expect(img.hasAttribute('src')).toBe(false);
        expect(img.getAttribute('title')).toBe('plain');
        expect(plan.map((entry) => [entry.kind, entry.attrName, entry.nodePath])).toEqual([
            ['attribute', 'src', [0, 0]],
            ['attribute', 'alt', [0, 0]],
        ]);
        expect(plan[1].parts.map((part) => typeof part === 'string' ? part : expressionOf(part))).toEqual(['x ', '$.alt']);
    });

    it('should remove on* attributes, record them as event entries and never create an inline handler', () => {
        // Act
        const { template, plan } = compileTemplate('<button onclick="{{ ($v)=>$.select }}">Go</button>');
        const instance = template.content.cloneNode(true) as DocumentFragment;
        const button = instance.firstChild as HTMLButtonElement;

        // Assert
        expect(button.hasAttribute('onclick')).toBe(false);
        expect(button.onclick).toBeNull();
        expect(plan).toEqual([expect.objectContaining({ kind: 'event', attrName: 'onclick', eventName: 'click', nodePath: [0] })]);
    });

    const badEvents = Object.freeze({
        'a literal handler': '<button onclick="alert(1)">x</button>',
        'literal text mixed with an expression': '<button onclick="go {{ $.a }}">x</button>',
    });
    for (const [name, source] of Object.entries(badEvents)) {
        it(`should throw TemplateCompileError for ${name} in an on* attribute`, () => {
            // Act / Assert
            expect(() => compileTemplate(source)).toThrow(TemplateCompileError);
        });
    }

    it('should throw TemplateCompileError with the node path for {{ }} in a state attribute', () => {
        // Act
        let error: unknown;
        try {
            compileTemplate('<div><x-card state="{{ $.path }}"></x-card></div>');
        }
        catch (caught) {
            error = caught;
        }

        // Assert
        expect(error).toBeInstanceOf(TemplateCompileError);
        expect((error as TemplateCompileError).nodePath).toEqual([0, 0]);
    });

    const badNames = Object.freeze({
        'an element name': '<div>\n<x-{{ $.tag }}></x-{{ $.tag }}></div>',
        'an attribute name': '<div>\n<p data-{{ $.k }}="1"></p></div>',
    });
    for (const [name, source] of Object.entries(badNames)) {
        it(`should throw TemplateCompileError with the line for {{ }} in ${name}`, () => {
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
            expect((error as TemplateCompileError).line).toBe(2);
        });
    }

    it('should emit a plan entry from a kind registered later, ahead of the generic attribute kind', () => {
        // Arrange
        registerBindingKind('test-kind', {
            match: (attr) => attr.name === 'x-test',
            compile: ({ nodePath, parts, attr }) => ({ nodePath, kind: 'test-kind', parts, attrName: attr!.name, custom: true }),
        });

        // Act
        const { plan } = compileTemplate('<section><i x-test="{{ $.flag }}" literal-x="no"></i></section>');

        // Assert
        expect(plan).toEqual([expect.objectContaining({ kind: 'test-kind', attrName: 'x-test', nodePath: [0, 0], custom: true })]);
    });

    it('should list entries in document order with parent attributes before child text', () => {
        // Act
        const { plan } = compileTemplate('<ul class="{{ $.cls }}"><li title="{{ $.t }}">{{ $.n }}</li></ul>');

        // Assert
        expect(plan.map((entry) => entry.nodePath)).toEqual([[0], [0, 0], [0, 0, 0]]);
    });
});

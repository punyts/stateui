import { ATTRIBUTE_KIND, EVENT_KIND, TEXT_KIND, isEventAttribute } from '../binding/builtins.js';
import { getBindingKind, getBindingKinds } from '../binding/registry.js';
import type { BindingKind, PlanEntry } from '../binding/types.js';
import { TemplateCompileError } from '../errors.js';
import { parseTemplate } from './parse.js';
import { tokenize } from './tokenize.js';

export interface CompiledTemplate {
    //content holds the static DOM; every {{ }} and on* attribute has been removed and every text expression has its
    //own empty text node
    template: HTMLTemplateElement;
    //bindings in document order
    plan: PlanEntry[];
}

//one compile per template string (per component class), never per instance
const compiledTemplates: Map<string, CompiledTemplate> = new Map();

//a start or end tag, with quoted attribute values kept whole so a ">" inside a value doesn't end the tag
const PATT_TAG = /<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
const PATT_QUOTED = /"[^"]*"|'[^']*'/g;
const STATE_ATTRIBUTE = 'state';

/**
 * Throws a TemplateCompileError when {{ }} appears in an element or attribute name. The XML parser would reject the
 * "{" first with a less helpful message, so tags are checked on the source: any {{ left in a tag once its quoted
 * attribute values are removed sits in a name. Comments and declarations (<!...>) are skipped
 * @param source
 */
const assertNoExpressionInNames = (source: string) => {
    PATT_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATT_TAG.exec(source)) !== null) {
        const tag = match[0];
        if (tag.startsWith('<!') || !tag.replace(PATT_QUOTED, '').includes('{{')) {
            continue;
        }
        const line = source.slice(0, match.index).split(/\r\n|\r|\n/).length;
        throw new TemplateCompileError(
            `{{ }} is not allowed in an element or attribute name (line ${line}): ${tag}`,
            { line }
        );
    }
};

/**
 * Finds the kind for an attribute: registered kinds in registration order (event first among the built-ins), with
 * the generic attribute kind as the fallback, so kinds registered later (if, repeat, mixin) win over it
 * @param attr
 * @param element
 */
const findAttributeKind = (attr: Attr, element: Element): [string, BindingKind] | undefined => {
    for (const [name, kind] of getBindingKinds()) {
        if (name === TEXT_KIND || name === ATTRIBUTE_KIND) {
            continue;
        }
        if (kind.match(attr, element)) {
            return [name, kind];
        }
    }
    const fallback = getBindingKind(ATTRIBUTE_KIND)!;
    return fallback.match(attr, element) ? [ATTRIBUTE_KIND, fallback] : undefined;
};

/**
 * Records plan entries for an element's attributes and removes every {{ }} and on* attribute from the content
 * @param element
 * @param nodePath
 * @param template
 * @param plan
 */
const compileAttributes = (element: Element, nodePath: number[], template: HTMLTemplateElement, plan: PlanEntry[]) => {
    //snapshot: attributes are removed while iterating
    for (const attr of Array.from(element.attributes)) {
        const hasExpression = attr.value.includes('{{');

        if (attr.name === STATE_ATTRIBUTE && hasExpression) {
            throw new TemplateCompileError(
                `{{ }} is not allowed in the state attribute: it takes a literal path (${attr.value})`,
                { nodePath }
            );
        }

        const isEvent = isEventAttribute(attr.name);
        const parts = hasExpression ? tokenize(attr.value).parts : [attr.value];
        if (isEvent && !(hasExpression && tokenize(attr.value).isSingleExpression)) {
            throw new TemplateCompileError(
                `${attr.name}="${attr.value}" must be exactly one {{ }} expression; inline handler text is not allowed`,
                { nodePath }
            );
        }

        const found = findAttributeKind(attr, element);
        if (found) {
            const [, kind] = found;
            plan.push(kind.compile({ node: element, element, attr, nodePath, parts, template }));
        }

        //never leave placeholder text or handler source in the content: a clone entering a live document must not
        //fetch src="{{ ... }}" or build an inline handler from it
        if (hasExpression || isEvent) {
            element.removeAttribute(attr.name);
        }
    }
};

/**
 * Replaces a text node holding {{ }} with one text node per part (literals keep their text, each expression gets an
 * empty node), records a text entry per expression and returns how many nodes now stand in its place
 * @param text
 * @param parentPath
 * @param index
 * @param template
 * @param plan
 */
const compileText = (text: Text, parentPath: number[], index: number, template: HTMLTemplateElement, plan: PlanEntry[]) => {
    const { parts } = tokenize(text.data);
    const parent = text.parentNode!;
    const textKind = getBindingKind(TEXT_KIND)!;

    parts.forEach((part, offset) => {
        const node = text.ownerDocument.createTextNode(typeof part === 'string' ? part : '');
        parent.insertBefore(node, text);
        if (typeof part !== 'string') {
            plan.push(textKind.compile({ node, nodePath: [...parentPath, index + offset], parts: [part], template }));
        }
    });
    parent.removeChild(text);
    return parts.length;
};

/**
 * Walks the children of parent in document order, recording plan entries; element entries come before their
 * children's, so parents attach first
 * @param parent
 * @param parentPath
 * @param template
 * @param plan
 */
const compileChildren = (parent: Node, parentPath: number[], template: HTMLTemplateElement, plan: PlanEntry[]) => {
    let index = 0;
    while (index < parent.childNodes.length) {
        const node = parent.childNodes[index];
        const nodePath = [...parentPath, index];

        if (node.nodeType === Node.TEXT_NODE && (node as Text).data.includes('{{')) {
            index += compileText(node as Text, parentPath, index, template, plan);
            continue;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            compileAttributes(node as Element, nodePath, template, plan);
            compileChildren(node, nodePath, template, plan);
        }
        index++;
    }
};

/**
 * Compiles a template string once into a <template> whose content is the static DOM and a binding plan of
 * node paths; later calls with the same string return the identical cached object
 * @param source
 * @throws TemplateParseError for malformed XHTML
 * @throws TemplateCompileError for script/style, {{ }} in names or in state, or a malformed on* attribute
 */
export const compileTemplate = (source: string): CompiledTemplate => {
    const cached = compiledTemplates.get(source);
    if (cached) {
        return cached;
    }

    assertNoExpressionInNames(source);
    const template = document.createElement('template');
    for (const element of parseTemplate(source)) {
        //the parsed nodes live in an XML document; import them into the HTML document
        template.content.appendChild(document.importNode(element, true));
    }

    const plan: PlanEntry[] = [];
    compileChildren(template.content, [], template, plan);

    const compiled: CompiledTemplate = { template, plan };
    compiledTemplates.set(source, compiled);
    return compiled;
};

export { ATTRIBUTE_KIND, EVENT_KIND, TEXT_KIND };

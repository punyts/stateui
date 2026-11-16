import type { CompiledExpression } from '@punyts/expression';
import type { PlanEntry } from '../binding/types.js';
import { TemplateCompileError } from '../errors.js';
import type { CompiledTemplate } from './compile.js';
import { tokenize } from './tokenize.js';

export const IF_KIND = 'if';
const IF = 'if';
const IFELSE = 'ifelse';
const ELSE = 'else';

export interface ChainBranch {
    //undefined for else
    condition?: CompiledExpression;
    template: CompiledTemplate;
}

const isSkippable = (node: Node) => {
    return node.nodeType === Node.COMMENT_NODE
        || (node.nodeType === Node.TEXT_NODE && !(node as Text).data.trim());
};

/**
 * Returns the single compiled expression of an if/ifelse value, or throws
 * @param element
 * @param name
 * @param nodePath
 */
const compileCondition = (element: Element, name: string, nodePath: number[]) => {
    const value = element.getAttribute(name)!;
    const tokens = value.includes('{{') ? tokenize(value) : undefined;
    if (!tokens?.isSingleExpression) {
        throw new TemplateCompileError(`${name}="${value}" must be exactly one {{ }} expression`, { nodePath });
    }
    return tokens.parts[0] as CompiledExpression;
};

/**
 * When element starts an if chain, compiles the chain: the element with if, then its immediately following sibling
 * elements with ifelse (any number) and else (at most one, last); whitespace-only text and comments between members
 * are removed, any other node ends the chain. Each member is moved into its own compiled template (its if/ifelse/else
 * attribute removed, its other attributes, a repeat included, compiled there), and the chain is replaced by one comment
 * anchor so sibling node paths stay stable. Returns the chain's plan entry, or undefined when element starts no chain
 * @param element
 * @param nodePath - the element's path, which the anchor takes over
 * @param compileNodes - compiles moved nodes into a CompiledTemplate (passed in to avoid an import cycle)
 * @throws TemplateCompileError for ifelse/else without a preceding member, a second else, a non-expression condition
 * or an else with a value
 */
export const compileChain = (
    element: Element,
    nodePath: number[],
    compileNodes: (nodes: readonly Node[]) => CompiledTemplate
): PlanEntry | undefined => {
    if (element.hasAttribute(IFELSE) || element.hasAttribute(ELSE)) {
        if (!element.hasAttribute(IF)) {
            throw new TemplateCompileError(`<${element.localName}> has ${element.hasAttribute(IFELSE) ? IFELSE : ELSE} without a preceding if or ifelse`, { nodePath });
        }
    }
    if (!element.hasAttribute(IF)) {
        return undefined;
    }

    const members: Array<{ element: Element; attribute: string }> = [{ element, attribute: IF }];
    const between: Node[] = [];
    let cursor = element.nextSibling;
    let pending: Node[] = [];
    while (cursor) {
        if (isSkippable(cursor)) {
            pending.push(cursor);
            cursor = cursor.nextSibling;
            continue;
        }
        if (cursor.nodeType !== Node.ELEMENT_NODE) {
            break;
        }
        const sibling = cursor as Element;
        const attribute = sibling.hasAttribute(IFELSE) ? IFELSE : sibling.hasAttribute(ELSE) ? ELSE : undefined;
        if (!attribute) {
            break;
        }
        if (members[members.length - 1].attribute === ELSE) {
            throw new TemplateCompileError(`<${sibling.localName}> ${attribute} after else: else must be the last member of a chain`, { nodePath });
        }
        members.push({ element: sibling, attribute });
        between.push(...pending);
        pending = [];
        cursor = sibling.nextSibling;
    }

    const anchor = element.ownerDocument.createComment(' if ');
    element.parentNode!.insertBefore(anchor, element);
    for (const node of between) {
        node.parentNode?.removeChild(node);
    }

    const branches: ChainBranch[] = members.map(({ element: member, attribute }) => {
        let condition: CompiledExpression | undefined;
        if (attribute === ELSE) {
            if (member.getAttribute(ELSE)!.trim()) {
                throw new TemplateCompileError(`else must have no value (found else="${member.getAttribute(ELSE)}")`, { nodePath });
            }
        }
        else {
            condition = compileCondition(member, attribute, nodePath);
        }
        member.removeAttribute(attribute);
        //moving the member into its own template removes it from the parent content
        return { condition, template: compileNodes([member]) };
    });

    return { nodePath, kind: IF_KIND, parts: [], branches };
};

import type { Scope } from '../scope/Scope.js';
import type { TokenPart } from '../template/tokenize.js';
import type { Binding } from './Binding.js';

/**
 * One binding in a compiled template. nodePath is the childNodes index path from the template content root, recorded
 * after text nodes are split; plan entries are in document order, so parents attach before children
 */
export interface PlanEntry {
    nodePath: number[];
    kind: string;
    parts: TokenPart[];
    //the attribute the entry came from (removed from the template content when it held {{ }} or was on*)
    attrName?: string;
    //kind-specific data
    [key: string]: unknown;
}

/**
 * What a binding kind's compile step receives. For an attribute entry, attr is set (and its value tokenized into
 * parts); for a text entry it is undefined and node is the split text node
 */
export interface CompileContext {
    node: Node;
    element?: Element;
    attr?: Attr;
    nodePath: number[];
    parts: TokenPart[];
    template: HTMLTemplateElement;
}

export interface BindingKind {
    //true when this kind handles the attribute; never called for text nodes
    match: (attr: Attr, element: Element) => boolean;
    compile: (context: CompileContext) => PlanEntry;
    //turns a plan entry into a live binding on the cloned node; registered by the story that implements the kind
    attach?: (node: Node, entry: PlanEntry, scope: Scope) => Binding;
}

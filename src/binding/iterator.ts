import type { CompiledExpression } from '@punyts/expression';
import { TemplateCompileError } from '../errors.js';
import type { CompiledTemplate } from '../template/compile.js';
import { tokenize } from '../template/tokenize.js';
import type { PlanEntry } from './types.js';

export const REPEAT_KIND = 'repeat';
const REPEAT = 'repeat';
const KEY = 'key';

//the iterator grammar of @punyts/expression: k[,i[,v]] in|for <collection> [sort <by> [asc|desc]] [filter <expr>]
export const PATT_ITERATOR = /^([A-Za-z0-9$_]+)(?:, ?([A-Za-z0-9$_]+))?(?:, ?([A-Za-z0-9$_]+))? (in|for) (.+?)(?: sort ([A-z0-9$._[\]]+)(?: (desc|asc))?)?(?: filter (.+))?$/i;

export interface RepeatEntryData {
    iterator: CompiledExpression;
    operator: 'in' | 'for';
    //the collection variable for "in" iterators (a store path or a local with a store path)
    collection?: string;
    //sort or filter read item fields, so item-level writes must re-run the repeat
    readsItems: boolean;
    //filter compacts array keys, so <collection>.<key> is not an item path
    filtered: boolean;
    item: CompiledTemplate;
    key?: CompiledExpression;
}

/**
 * When element has repeat="{{ k,i,v in collection ... }}", compiles it: the element, minus repeat and key, becomes
 * the item template, and a comment anchor takes its place (items are inserted before it). Returns the plan entry, or
 * undefined when element has no repeat
 * @param element
 * @param nodePath
 * @param compileNodes - compiles moved nodes into a CompiledTemplate (passed in to avoid an import cycle)
 * @throws TemplateCompileError when the value isn't a single iterator expression, or an "in" collection isn't a
 * plain variable
 */
export const compileRepeat = (
    element: Element,
    nodePath: number[],
    compileNodes: (nodes: readonly Node[]) => CompiledTemplate
): PlanEntry | undefined => {
    if (!element.hasAttribute(REPEAT)) {
        return undefined;
    }

    const value = element.getAttribute(REPEAT)!;
    const tokens = value.includes('{{') ? tokenize(value) : undefined;
    const iterator = tokens?.isSingleExpression ? tokens.parts[0] as CompiledExpression : undefined;
    const match = iterator ? PATT_ITERATOR.exec(iterator.original.trim()) : null;
    if (!iterator || !match) {
        throw new TemplateCompileError(`repeat="${value}" must be one {{ }} iterator, e.g. {{ $k,$i,$v in $.items }}`, { nodePath });
    }

    const operator = match[4].toLowerCase() as 'in' | 'for';
    const collection = operator === 'in' ? match[5].trim() : undefined;
    if (collection !== undefined && collection !== iterator.variables[0]) {
        throw new TemplateCompileError(`repeat collection "${collection}" must be a store path or a local with a store path`, { nodePath });
    }

    let key: CompiledExpression | undefined;
    if (element.hasAttribute(KEY)) {
        const keyTokens = tokenize(element.getAttribute(KEY)!);
        if (!keyTokens.isSingleExpression) {
            throw new TemplateCompileError(`key="${element.getAttribute(KEY)}" must be one {{ }} expression`, { nodePath });
        }
        key = keyTokens.parts[0] as CompiledExpression;
    }

    const anchor = element.ownerDocument.createComment(' repeat ');
    element.parentNode!.insertBefore(anchor, element);
    element.removeAttribute(REPEAT);
    element.removeAttribute(KEY);

    const data: RepeatEntryData = {
        iterator,
        operator,
        collection,
        readsItems: match[6] !== undefined || match[8] !== undefined,
        filtered: match[8] !== undefined,
        //moving the element into its own template removes it from the parent content
        item: compileNodes([element]),
        key,
    };
    //the iterator's own locals (used in filter) are not store paths of the enclosing scope, so the repeat binding
    //subscribes through a copy whose variables leave them out
    const locals = new Set([match[1], match[2], match[3]].filter((name): name is string => !!name));
    const subscribed: CompiledExpression = {
        ...iterator,
        variables: iterator.variables.filter((variable) => !locals.has(variable.split(/[.[]/)[0])),
    };
    return { nodePath, kind: REPEAT_KIND, parts: [subscribed], ...data };
};

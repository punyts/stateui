import { report } from '@punyts/core';
import { getMixin, isMixin, type Disposer } from '../mixin/registry.js';
import type { Scope } from '../scope/Scope.js';
import { tokenize, type TokenPart } from '../template/tokenize.js';
import type { Binding } from './Binding.js';
import type { CompileContext, PlanEntry } from './types.js';

export const MIXIN_KIND = 'mixin';

interface MixinAttribute {
    name: string;
    parts: TokenPart[];
}

/**
 * True when the attribute names a mixin registered right now (i.e. at compile time)
 * @param attr
 */
export const matchMixin = (attr: Attr) => isMixin(attr.name);

/**
 * Records the mixin and every registered-mixin attribute of its element, as written, so attach can build attrs
 * @param context
 */
export const compileMixin = (context: CompileContext): PlanEntry => {
    const attrs: MixinAttribute[] = context.attributes
        .filter(({ name }) => isMixin(name))
        .map(({ name, value }) => ({ name, parts: value.includes('{{') ? tokenize(value).parts : [value] }));
    return { nodePath: context.nodePath, kind: MIXIN_KIND, parts: [], attrName: context.attr!.name, mixin: context.attr!.name, attrs };
};

/**
 * Evaluates one mixin attribute: a single {{ }} keeps its value, mixed parts become a string, a literal stays as written
 * @param scope
 * @param parts
 */
const evaluateAttribute = (scope: Scope, parts: TokenPart[]) => {
    if (parts.length === 1 && typeof parts[0] !== 'string') {
        return scope.evaluate(parts[0]);
    }
    return parts.map((part) => {
        if (typeof part === 'string') {
            return part;
        }
        const value = scope.evaluate(part);
        return value === null || value === undefined ? '' : String(value);
    }).join('');
};

/**
 * Calls the mixin once, on the first update, with the element, a frozen attrs record evaluated at that moment and the
 * scope; later updates and rebinds never re-invoke it. dispose calls its disposer once. A throwing mixin (or disposer)
 * is reported and never aborts the rest of the instance
 * @param node
 * @param entry
 * @param scope
 */
export const attachMixin = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const name = entry.mixin as string;
    let invoked = false;
    let disposed = false;
    let disposer: Disposer | void;

    const update = () => {
        if (invoked || disposed) {
            return;
        }
        invoked = true;
        const mixin = getMixin(name);
        if (!mixin) {
            return;
        }
        try {
            const attrs: Record<string, unknown> = {};
            for (const attribute of entry.attrs as MixinAttribute[]) {
                attrs[attribute.name] = evaluateAttribute(scope, attribute.parts);
            }
            disposer = mixin(node as Element, Object.freeze(attrs), scope);
        }
        catch (error) {
            report.error(`[mixin ${name} at node path ${JSON.stringify(entry.nodePath)}] failed: ${error instanceof Error ? error.message : String(error)}`, {
                kind: entry.kind,
                nodePath: entry.nodePath,
                error,
            });
        }
    };

    return {
        get disposed() {
            return disposed;
        },
        update,
        rebind: () => undefined,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            if (typeof disposer === 'function') {
                try {
                    disposer();
                }
                catch (error) {
                    report.error(`[mixin ${name}] disposer failed: ${error instanceof Error ? error.message : String(error)}`, { error });
                }
            }
        },
    };
};

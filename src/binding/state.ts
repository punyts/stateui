import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import type { Scope } from '../scope/Scope.js';
import type { Binding } from './Binding.js';
import type { PlanEntry } from './types.js';

export const STATE_KIND = 'state';
export const STATE_ATTRIBUTE = 'state';

//one local variable name: $v, row, _item; a bare "$" is the scope's base object, not a local
const PATT_LOCAL = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * True when a compiled expression is exactly one local variable name ($v), the only {{ }} a state attribute accepts
 * @param expression
 */
export const isLocalExpression = (expression: CompiledExpression) => {
    const text = expression.original.trim();
    return text !== '$' && PATT_LOCAL.test(text);
};

/**
 * Binds state="{{ $v }}": the element's state attribute holds the absolute store path of the local, so the component
 * is scoped to that entry. There is no store listener: the path only changes when the scope's locals are retargeted
 * (a keyed row that moved), which rebinds. The attribute is written on every update, not only when the local's value
 * changed, because a moved row can hold an equal value at a new path. A local with no store path (a primitive in a
 * filtered or counted repeat, or a controller member) is reported and the attribute is set empty, so the component
 * renders nothing instead of silently scoping to its parent
 * @param node
 * @param entry
 * @param scope
 */
export const attachState = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const element = node as Element;
    const expression = entry.parts[0] as CompiledExpression;
    const name = expression.original.trim();
    let disposed = false;

    const update = () => {
        if (disposed) {
            return;
        }
        const path = scope.findLocal(name)?.path;
        if (path === undefined) {
            report.error(`state="{{ ${name} }}" needs a local with a store path (an entry of a store collection in a repeat without filter)`, { kind: entry.kind, nodePath: entry.nodePath, local: name });
            element.setAttribute(STATE_ATTRIBUTE, '');
            return;
        }
        if (element.getAttribute(STATE_ATTRIBUTE) !== path) {
            element.setAttribute(STATE_ATTRIBUTE, path);
        }
    };

    const binding: Binding = {
        get disposed() {
            return disposed;
        },
        update,
        rebind: update,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            scope.unregisterBinding(binding);
        },
    };
    scope.registerBinding(binding);
    return binding;
};

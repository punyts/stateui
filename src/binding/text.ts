import type { Scope } from '../scope/Scope.js';
import { createBinding, type Binding } from './Binding.js';
import type { PlanEntry } from './types.js';

/**
 * Binds one expression to its dedicated text node (compile split the text so each expression has its own node).
 * Only textContent is ever written: null and undefined render as "", anything else as String(value)
 * @param node
 * @param entry
 * @param scope
 */
export const attachText = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    return createBinding({
        scope,
        expressions: entry.parts,
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: (value) => {
            node.textContent = value === null || value === undefined ? '' : String(value);
        },
    });
};

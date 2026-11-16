import type { BindingKind } from './types.js';

//insertion-ordered, so compileTemplate asks kinds in registration order
const kinds: Map<string, BindingKind> = new Map();

/**
 * Registers a binding kind, or adds to an existing one: a later story can register only attach for a kind whose
 * match/compile are already registered (e.g. registerBindingKind('text', { attach })). Re-registering keeps the
 * kind's original position in the order
 * @param kind
 * @param definition
 */
export const registerBindingKind = (kind: string, definition: Partial<BindingKind>): void => {
    const existing = kinds.get(kind);
    const merged = { ...existing, ...definition };
    if (!merged.match || !merged.compile) {
        throw new Error(`Binding kind "${kind}" needs match and compile`);
    }
    kinds.set(kind, merged as BindingKind);
};

export const getBindingKind = (kind: string): BindingKind | undefined => kinds.get(kind);

/**
 * Returns the registered kinds in registration order
 */
export const getBindingKinds = (): ReadonlyArray<readonly [string, BindingKind]> => [...kinds.entries()];

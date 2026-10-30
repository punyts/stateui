import type { CompiledExpression, ExecuteOptions } from '@punyts/expression';
import type { Scope } from '../scope/Scope.js';
import type { ChainBranch } from '../template/chain.js';
import { instantiate, type TemplateInstance } from '../template/instantiate.js';
import { createBinding, type Binding } from './Binding.js';
import type { PlanEntry } from './types.js';

/**
 * Builds the expression an if chain binds to: its variables are the union of the branch conditions', and it evaluates
 * to the index of the first branch whose condition is truthy (else always is), or -1 for none. The base binding's
 * Object.is skip then means "nothing happens while the chosen branch stays the same"
 * @param branches
 */
const createBranchSelector = (branches: readonly ChainBranch[]): CompiledExpression => ({
    original: 'if chain',
    variables: [...new Set(branches.flatMap((branch) => branch.condition?.variables ?? []))],
    execute: (context: object, options?: ExecuteOptions) => {
        return branches.findIndex((branch) => !branch.condition || !!branch.condition.execute(context, options));
    },
});

/**
 * Binds an if/ifelse/else chain to its anchor comment. When the chosen branch changes, the old branch is disposed
 * (bindings and nodes) before the new one is instantiated against the same scope and inserted before the anchor in one
 * operation. Branch bindings register on the chain's scope, so Scope.setLocals (a moved repeat item) rebinds them too
 * @param node - the anchor comment
 * @param entry
 * @param scope
 */
export const attachIf = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const branches = entry.branches as ChainBranch[];
    let active: { instance: TemplateInstance; nodes: Node[] } | undefined;

    const clear = () => {
        if (!active) {
            return;
        }
        active.instance.dispose();
        for (const branchNode of active.nodes) {
            branchNode.parentNode?.removeChild(branchNode);
        }
        active = undefined;
    };

    const binding = createBinding<number>({
        scope,
        expressions: createBranchSelector(branches),
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: (index) => {
            clear();
            if (index < 0) {
                return;
            }
            const instance = instantiate(branches[index].template, scope);
            const nodes = Array.from(instance.fragment.childNodes);
            node.parentNode!.insertBefore(instance.fragment, node);
            active = { instance, nodes };
        },
    });

    return {
        get disposed() {
            return binding.disposed;
        },
        update: () => binding.update(),
        rebind: () => binding.rebind(),
        dispose: () => {
            if (binding.disposed) {
                return;
            }
            binding.dispose();
            clear();
        },
    };
};

import type { Binding } from '../binding/Binding.js';
import { getBindingKind } from '../binding/registry.js';
import { StateUIError } from '../errors.js';
import type { Scope } from '../scope/Scope.js';
import type { CompiledTemplate } from './compile.js';

export interface TemplateInstance {
    //detached until the caller inserts it, so every binding has rendered once before the instance is visible
    fragment: DocumentFragment;
    //disposes every binding of the instance; safe to call more than once
    dispose(): void;
}

/**
 * Resolves a childNodes index path against a root node
 * @param root
 * @param path
 */
const resolveNodePath = (root: Node, path: number[]) => {
    let node: Node = root;
    for (const index of path) {
        node = node.childNodes[index];
    }
    return node;
};

/**
 * Clones a compiled template for one instance and attaches its bindings against scope. Nodes are created with
 * document.importNode, so nested custom elements are already upgraded when their bindings attach. Bindings attach in
 * plan (document) order, parents before children, and each renders once (update()) while the fragment is detached
 * @param compiled
 * @param scope
 * @throws StateUIError when a plan entry's kind has no registered attach step
 */
export const instantiate = (compiled: CompiledTemplate, scope: Scope): TemplateInstance => {
    const fragment = document.importNode(compiled.template.content, true);

    //resolve every node before attaching: attaching a structural kind (if, repeat) may move nodes
    const nodes = compiled.plan.map((entry) => resolveNodePath(fragment, entry.nodePath));
    const bindings: Binding[] = [];

    const disposeAll = () => {
        for (const binding of bindings) {
            binding.dispose();
        }
    };

    try {
        compiled.plan.forEach((entry, index) => {
            const attach = getBindingKind(entry.kind)?.attach;
            if (!attach) {
                throw new StateUIError(`No binding kind "${entry.kind}" with an attach step is registered (node path ${JSON.stringify(entry.nodePath)})`);
            }
            const binding = attach(nodes[index], entry, scope);
            bindings.push(binding);
            binding.update();
        });
    }
    catch (error) {
        //never leave half an instance subscribed to the store
        disposeAll();
        throw error;
    }

    let disposed = false;
    return {
        fragment,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            disposeAll();
        },
    };
};

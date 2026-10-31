import { report } from '@punyts/core';
import Expression from '@punyts/expression';
import { createBinding, type Binding } from '../binding/Binding.js';
import { findParentScope } from '../component/context.js';
import type { ScopeConsumer, ScopeProvider } from '../component/types.js';
import { connectConsumer, disconnectConsumer } from '../component/waiting.js';
import { resolveScopePath } from '../scope/path.js';
import { Scope } from '../scope/Scope.js';
import { getNodeResolver } from './options.js';

export const NODE_TAG = 'sui-node';
export const NODE_MISSING = 'SUI-NODE-MISSING';

const STATE_ATTRIBUTE = 'state';

//the node's component name, read at the element's base path
const COMPONENT = Expression('$.component');

/**
 * Renders the component the node at its state path names. It reads `component`, asks the node resolver for a tag and
 * creates that element with the same absolute state path as its only child; when `component` changes the child is
 * replaced, and nothing else is re-rendered (the child's own bindings handle every other property). A missing node,
 * a missing `component` or a name the resolver does not know renders nothing and is reported as SUI-NODE-MISSING.
 * The element is display: contents, so the child it creates is the layout item of the container that holds it
 */
export class SuiNode extends HTMLElement implements ScopeProvider, ScopeConsumer {
    static observedAttributes = [STATE_ATTRIBUTE];

    scope?: Scope;
    #attached = false;
    #binding?: Binding;
    #child?: Element;

    get element(): Element {
        return this;
    }

    connectedCallback(): void {
        this.style.display = 'contents';
        connectConsumer(this);
    }

    disconnectedCallback(): void {
        disconnectConsumer(this);
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name !== STATE_ATTRIBUTE || oldValue === newValue || !this.#attached) {
            return;
        }
        this.detach();
        this.attach();
    }

    /**
     * Resolves the base path like a component does: the state attribute against the parent's base path, or the
     * parent's unchanged. An invalid path is reported and yields undefined, so nothing renders
     * @param parentBasePath
     */
    #resolveBasePath(parentBasePath: string): string | undefined {
        const state = this.getAttribute(STATE_ATTRIBUTE);
        if (state === null) {
            return parentBasePath;
        }
        try {
            return resolveScopePath(parentBasePath, state);
        }
        catch (error) {
            report.error(`<${NODE_TAG}> state="${state}" is not a valid path: ${error instanceof Error ? error.message : String(error)}`, { state });
            return undefined;
        }
    }

    attach(): void {
        const context = findParentScope(this);
        if (!context) {
            return;
        }
        this.#attached = true;
        const basePath = this.#resolveBasePath(context.basePath);
        if (basePath === undefined) {
            return;
        }
        //the scope is set before the first render, so the created child finds it when it connects
        this.scope = new Scope(context.store, basePath);
        this.#binding = createBinding({
            scope: this.scope,
            expressions: COMPONENT,
            kind: 'node',
            nodePath: [],
            apply: (component) => this.#render(component, basePath),
        });
        this.#binding.update();
    }

    detach(): void {
        this.#attached = false;
        this.#binding?.dispose();
        this.#binding = undefined;
        this.#removeChild();
        this.scope = undefined;
    }

    #removeChild(): void {
        this.#child?.remove();
        this.#child = undefined;
    }

    /**
     * Replaces the child with the element the resolver names for component. The binding calls it only when the
     * component value changed, so an unrelated change under the node never recreates the child
     * @param component
     * @param basePath
     */
    #render(component: unknown, basePath: string): void {
        this.#removeChild();
        if (typeof component !== 'string' || component === '') {
            report.error(`${NODE_MISSING}: no node or no component at ${basePath}`, { code: NODE_MISSING, state: basePath });
            return;
        }
        let tag: string | undefined;
        try {
            tag = getNodeResolver()?.(component);
        }
        catch (error) {
            report.error(`${NODE_MISSING}: the node resolver failed for "${component}" at ${basePath}: ${error instanceof Error ? error.message : String(error)}`, { code: NODE_MISSING, state: basePath, component });
            return;
        }
        if (!tag) {
            report.error(`${NODE_MISSING}: no element for component "${component}" at ${basePath}`, { code: NODE_MISSING, state: basePath, component });
            return;
        }
        const child = document.createElement(tag);
        child.setAttribute(STATE_ATTRIBUTE, basePath);
        this.#child = child;
        this.append(child);
    }
}

if (!customElements.get(NODE_TAG)) {
    customElements.define(NODE_TAG, SuiNode);
}

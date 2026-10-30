import { Scope } from '../scope/Scope.js';
import type { CompiledTemplate } from '../template/compile.js';
import { instantiate, type TemplateInstance } from '../template/instantiate.js';
import { findParentScope } from './context.js';
import type { ScopeConsumer, ScopeProvider } from './types.js';
import { connectConsumer, disconnectConsumer } from './waiting.js';

export type ShadowMode = 'open' | 'closed' | false;

/**
 * Base class of every element defineComponent creates. On connect it scopes itself from the nearest mounted root or
 * parent component (or waits for one), instantiates its compiled template detached and inserts it in one call; on
 * disconnect it disposes everything and removes what it added. defineComponent sets the static compiled template and
 * shadow mode on the generated subclass
 */
export class StateUIElement extends HTMLElement implements ScopeProvider, ScopeConsumer {
    static compiled?: CompiledTemplate;
    static shadowMode: ShadowMode = 'open';
    static observedAttributes = ['state'];

    scope?: Scope;
    #instance?: TemplateInstance;
    #shadowRoot?: ShadowRoot;
    #lightNodes: Node[] = [];

    get element(): Element {
        return this;
    }

    connectedCallback(): void {
        connectConsumer(this);
    }

    disconnectedCallback(): void {
        disconnectConsumer(this);
    }

    attributeChangedCallback(): void {
        //re-scoping on a state change arrives with the state attribute (E5.3)
    }

    /**
     * Builds the scope, renders the template detached and inserts it with a single DOM call. The scope is set before
     * the insertion, so nested components find it when they connect
     */
    attach(): void {
        const { compiled, shadowMode } = this.constructor as typeof StateUIElement;
        const context = findParentScope(this);
        if (!compiled || !context) {
            return;
        }

        this.scope = new Scope(context.store, context.basePath);
        this.#instance = instantiate(compiled, this.scope);

        const fragment = this.#instance.fragment;
        if (shadowMode === false) {
            this.#lightNodes = Array.from(fragment.childNodes);
            this.append(fragment);
            return;
        }
        this.#shadowRoot ??= this.attachShadow({ mode: shadowMode });
        this.#shadowRoot.append(fragment);
    }

    /**
     * Disposes every binding and removes the nodes this instance added, so a reconnect renders from scratch
     */
    detach(): void {
        this.#instance?.dispose();
        this.#instance = undefined;
        for (const node of this.#lightNodes) {
            node.parentNode?.removeChild(node);
        }
        this.#lightNodes = [];
        this.#shadowRoot?.replaceChildren();
        this.scope = undefined;
    }
}

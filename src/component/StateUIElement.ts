import { report } from '@punyts/core';
import { Scope } from '../scope/Scope.js';
import type { CompiledTemplate } from '../template/compile.js';
import { instantiate, type TemplateInstance } from '../template/instantiate.js';
import { findParentScope } from './context.js';
import type { Controller, ControllerContext, ScopeConsumer, ScopeProvider } from './types.js';
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
    static controller?: Controller;
    static observedAttributes = ['state'];

    scope?: Scope;
    #instance?: TemplateInstance;
    #disposeController?: () => void;
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
        //the controller runs before instantiate, so its members are locals when bindings attach
        if (!this.#runController(this.scope)) {
            return;
        }
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
     * Runs the component's controller, if any, and layers its members (except dispose) onto the scope as locals.
     * Returns false when the controller threw: the error is reported and the component renders nothing, so sibling
     * components are unaffected. A member that shadows a property of the scope's state object is reported; the local
     * still wins, as locals always do
     * @param scope
     */
    #runController(scope: Scope): boolean {
        const { controller } = this.constructor as typeof StateUIElement;
        if (!controller) {
            return true;
        }

        const { store, basePath } = scope;
        const context: ControllerContext = {
            element: this,
            store,
            basePath,
            scope,
            get state() {
                return store.get(basePath);
            },
        };

        let result: ReturnType<typeof controller>;
        try {
            result = controller(context);
        }
        catch (error) {
            report.error(`<${this.localName}> controller failed: ${error instanceof Error ? error.message : String(error)}`, { error });
            return false;
        }

        const base: unknown = store.get(basePath);
        for (const [name, value] of Object.entries(result ?? {})) {
            if (name === 'dispose') {
                continue;
            }
            if (base !== null && typeof base === 'object' && name in base) {
                report.error(`<${this.localName}> controller member "${name}" shadows the state path ${basePath}.${name}`, { member: name });
            }
            scope.locals.set(name, { value });
        }
        this.#disposeController = typeof result?.dispose === 'function' ? result.dispose : undefined;
        return true;
    }

    /**
     * Disposes every binding and removes the nodes this instance added, so a reconnect renders from scratch
     */
    detach(): void {
        this.#instance?.dispose();
        this.#instance = undefined;
        const disposeController = this.#disposeController;
        this.#disposeController = undefined;
        if (disposeController) {
            try {
                disposeController();
            }
            catch (error) {
                report.error(`<${this.localName}> controller dispose failed: ${error instanceof Error ? error.message : String(error)}`, { error });
            }
        }
        for (const node of this.#lightNodes) {
            node.parentNode?.removeChild(node);
        }
        this.#lightNodes = [];
        this.#shadowRoot?.replaceChildren();
        this.scope = undefined;
    }
}

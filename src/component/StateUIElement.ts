import { report } from '@punyts/core';
import { resolveScopePath } from '../scope/path.js';
import { Scope } from '../scope/Scope.js';
import { attachLightDynamicRules, attachShadowDynamicRules } from '../style/dynamic.js';
import { acquireLightStyles } from '../style/light.js';
import { attachStyleProperties } from '../style/properties.js';
import { adoptStyles } from '../style/shared.js';
import type { StyleProgram } from '../style/types.js';
import type { CompiledTemplate } from '../template/compile.js';
import { instantiate, type TemplateInstance } from '../template/instantiate.js';
import { findParentScope } from './context.js';
import type { Controller, ControllerContext, ScopeConsumer, ScopeProvider } from './types.js';
import { connectConsumer, disconnectConsumer } from './waiting.js';

export type ShadowMode = 'open' | 'closed' | false;

const STATE_ATTRIBUTE = 'state';

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
    //c<N>, allocated by defineComponent and used in the class's custom-property names
    static classId?: string;
    //the scanned styles option; undefined when the component has no styles
    static styleProgram?: StyleProgram;
    static observedAttributes = ['state'];

    scope?: Scope;
    #attached = false;
    #instance?: TemplateInstance;
    #disposeController?: () => void;
    #shadowRoot?: ShadowRoot;
    #lightNodes: Node[] = [];
    #releaseStyles?: () => void;
    #disposeStyleProperties?: () => void;
    #disposeDynamicRules?: () => void;

    get element(): Element {
        return this;
    }

    connectedCallback(): void {
        connectConsumer(this);
    }

    disconnectedCallback(): void {
        disconnectConsumer(this);
    }

    /**
     * A state change while attached re-scopes synchronously: the current instance is disposed and a new one attached
     * against the new path. Before attach, the attribute is simply read when attach runs
     * @param name
     * @param oldValue
     * @param newValue
     */
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name !== STATE_ATTRIBUTE || oldValue === newValue || !this.#attached) {
            return;
        }
        this.detach();
        this.attach();
    }

    /**
     * Resolves this component's base path: its state attribute against the parent's base path (absolute, .child or
     * ..sibling), or the parent's base path unchanged when there is no state attribute. An invalid path is reported
     * and yields undefined, so the component renders nothing instead of throwing out of a lifecycle callback
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
            report.error(`<${this.localName}> state="${state}" is not a valid path: ${error instanceof Error ? error.message : String(error)}`, { state });
            return undefined;
        }
    }

    /**
     * Builds the scope, renders the template detached and inserts it with a single DOM call. The scope is set before
     * the insertion, so nested components find it when they connect
     */
    attach(): void {
        const { compiled, shadowMode, styleProgram } = this.constructor as typeof StateUIElement;
        const context = findParentScope(this);
        if (!compiled || !context) {
            return;
        }
        this.#attached = true;

        const basePath = this.#resolveBasePath(context.basePath);
        if (basePath === undefined) {
            return;
        }
        this.scope = new Scope(context.store, basePath);
        //the controller runs before instantiate, so its members are locals when bindings attach
        if (!this.#runController(this.scope)) {
            return;
        }
        this.#instance = instantiate(compiled, this.scope);

        //styles and their custom properties go in before the content, so it never renders unstyled
        if (styleProgram?.declarations.length) {
            this.#disposeStyleProperties = attachStyleProperties(this, styleProgram, this.scope);
        }
        const fragment = this.#instance.fragment;
        if (shadowMode === false) {
            this.#releaseStyles = styleProgram && acquireLightStyles(this, styleProgram);
            this.#disposeDynamicRules = styleProgram && attachLightDynamicRules(this, styleProgram, this.scope);
            this.#lightNodes = Array.from(fragment.childNodes);
            this.append(fragment);
            return;
        }
        this.#shadowRoot ??= this.attachShadow({ mode: shadowMode });
        this.#releaseStyles = styleProgram && adoptStyles(this.#shadowRoot, styleProgram);
        this.#disposeDynamicRules = styleProgram && attachShadowDynamicRules(this.#shadowRoot, styleProgram, this.scope);
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
        this.#attached = false;
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
        this.#disposeStyleProperties?.();
        this.#disposeStyleProperties = undefined;
        this.#disposeDynamicRules?.();
        this.#disposeDynamicRules = undefined;
        this.#releaseStyles?.();
        this.#releaseStyles = undefined;
        for (const node of this.#lightNodes) {
            node.parentNode?.removeChild(node);
        }
        this.#lightNodes = [];
        this.#shadowRoot?.replaceChildren();
        this.scope = undefined;
    }
}

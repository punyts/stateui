import { report } from '@punyts/core';
import Expression from '@punyts/expression';
import { createBinding, type Binding } from '../binding/Binding.js';
import { findParentScope } from '../component/context.js';
import type { ScopeConsumer, ScopeProvider } from '../component/types.js';
import { connectConsumer, disconnectConsumer } from '../component/waiting.js';
import { resolveScopePath } from '../scope/path.js';
import { Scope } from '../scope/Scope.js';
import {
    AppliedWrites, attributeText, isSafePropertyKey, layoutWrites, placementAttributes, reportUnsafeName, themeProperties, toKebab,
    type Desired,
} from './articulation.js';
import { getNodeOptions, getNodeResolver } from './options.js';

export const NODE_TAG = 'sui-node';
export const NODE_MISSING = 'SUI-NODE-MISSING';

const STATE_ATTRIBUTE = 'state';

//the node's component name, read at the element's base path
const COMPONENT = Expression('$.component');
const PLACEMENT = Expression('$.placement');
const LAYOUT = Expression('$.layout');
const THEME = Expression('$.theme');

//the element a layout is written on: the one marked layout-host in the child's shadow root, else the child itself
const findLayoutHost = (child: Element): Element => child.shadowRoot?.querySelector('[layout-host]') ?? child;

/**
 * Renders the component the node at its state path names. It reads `component`, asks the node resolver for a tag and
 * creates that element with the same absolute state path as its only child; when `component` changes the child is
 * replaced, and nothing else is re-rendered (the child's own bindings handle every other property). A missing node,
 * a missing `component` or a name the resolver does not know renders nothing and is reported as SUI-NODE-MISSING.
 * The element is display: contents, so the child it creates is the layout item of the container that holds it.
 *
 * It also writes, reactively and write-only, the node's presentation onto the child: `placement` as attributes
 * (`region="nw"`, `row-span="2"`), `layout` as attributes and `--layout-*` custom properties on the child's
 * `layout-host` (or the child), `theme` as custom properties named by the theme mapper, and the properties the
 * `reflect` option lists for the component as attributes. Names that are not safe are reported as SUI-NODE-NAME
 */
export class SuiNode extends HTMLElement implements ScopeProvider, ScopeConsumer {
    static observedAttributes = [STATE_ATTRIBUTE];

    scope?: Scope;
    #attached = false;
    #binding?: Binding;
    #child?: Element;
    #subscriptions: Array<() => void> = [];
    #placement = new AppliedWrites();
    #theme = new AppliedWrites();
    #reflected = new AppliedWrites();
    #layout = new AppliedWrites();

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
        for (const dispose of this.#subscriptions) {
            dispose();
        }
        this.#subscriptions = [];
        this.#placement.clear();
        this.#theme.clear();
        this.#reflected.clear();
        this.#layout.clear();
        this.#child?.remove();
        this.#child = undefined;
    }

    /**
     * Writes now and again whenever any of the variables' paths change, and for each name in objects also when
     * anything below that property changes (a listener on `$.placement` is not told about `$.placement.region`, so
     * the path below it is listened to with the store's `$all` wildcard). The writes read the current values
     * @param scope
     * @param variables
     * @param objects
     * @param write
     */
    #watch(scope: Scope, variables: string[], objects: string[], write: () => void): void {
        const listener = () => write();
        const subscription = scope.subscribe(variables, listener);
        const deep = objects.map((name) => `${scope.basePath}.${name}.$all`);
        for (const path of deep) {
            scope.store.on(path, listener);
        }
        this.#subscriptions.push(() => {
            subscription.dispose();
            for (const path of deep) {
                scope.store.off(path, listener);
            }
        });
        write();
    }

    /**
     * Lists the properties the reflect option names for the component, dropping (and reporting) unsafe ones.
     * A failing option is reported and reflects nothing
     * @param component
     */
    #reflectedProperties(component: string): string[] {
        const reflect = getNodeOptions().reflect;
        if (!reflect) {
            return [];
        }
        try {
            return reflect(component).filter((name) => {
                const safe = isSafePropertyKey(name);
                if (!safe) {
                    reportUnsafeName('property', name);
                }
                return safe;
            });
        }
        catch (error) {
            report.error(`<${NODE_TAG}> the reflect option failed for "${component}": ${error instanceof Error ? error.message : String(error)}`, { component });
            return [];
        }
    }

    /**
     * Binds placement, theme and reflected properties to the child. It runs before the child is attached, so its
     * own first render already sees the attributes
     * @param scope
     * @param child
     * @param component
     */
    #bindArticulation(scope: Scope, child: Element, component: string): void {
        this.#watch(scope, PLACEMENT.variables, ['placement'], () => {
            this.#placement.sync(child, placementAttributes(scope.evaluate(PLACEMENT)), new Map());
        });
        const mapper = getNodeOptions().theme;
        if (mapper) {
            this.#watch(scope, THEME.variables, ['theme'], () => {
                this.#theme.sync(child, new Map(), themeProperties(scope.evaluate(THEME), mapper));
            });
        }
        const names = this.#reflectedProperties(component);
        if (names.length > 0) {
            const reads = names.map((name) => ({ attribute: toKebab(name), expression: Expression(`$.${name}`) }));
            this.#watch(scope, reads.flatMap(({ expression }) => expression.variables), [], () => {
                const desired: Desired = new Map();
                for (const { attribute, expression } of reads) {
                    const text = attributeText(scope.evaluate(expression));
                    if (text !== undefined) {
                        desired.set(attribute, text);
                    }
                }
                this.#reflected.sync(child, desired, new Map());
            });
        }
    }

    /**
     * Binds layout to the child's layout host. It runs after the child is attached, because the host lives in the
     * child's shadow root
     * @param scope
     * @param child
     */
    #bindLayout(scope: Scope, child: Element): void {
        this.#watch(scope, LAYOUT.variables, ['layout'], () => {
            const { attributes, properties } = layoutWrites(scope.evaluate(LAYOUT));
            this.#layout.sync(findLayoutHost(child), attributes, properties);
        });
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
        const scope = this.scope;
        if (scope) {
            this.#bindArticulation(scope, child, component);
        }
        this.append(child);
        if (scope) {
            this.#bindLayout(scope, child);
        }
    }
}

if (!customElements.get(NODE_TAG)) {
    customElements.define(NODE_TAG, SuiNode);
}

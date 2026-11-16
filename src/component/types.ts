import type { Store } from '@punyts/state';
import type { Scope } from '../scope/Scope.js';

/**
 * An element that provides a scope to its descendants once attached (StateUIElement implements it, E5.2a)
 */
export interface ScopeProvider {
    scope?: Scope;
}

/**
 * What findParentScope resolves: the store and $.-form base path a descendant scopes itself from
 */
export interface MountContext {
    store: Store<any>;
    basePath: string;
}

/**
 * Something that needs a parent scope to work, typically a component: attach() runs once a scope is resolvable,
 * detach() when its mounted root is unmounted
 */
export interface ScopeConsumer {
    element: Element;
    attach(): void;
    detach(): void;
}

/**
 * What a component's controller receives. state is a getter that calls store.get(basePath) on every access, so it
 * stays correct after Store.replace() swaps the object under the path
 */
export interface ControllerContext {
    readonly element: Element;
    readonly store: Store<any>;
    readonly basePath: string;
    readonly scope: Scope;
    readonly state: unknown;
}

/**
 * What a controller returns: every member except dispose becomes a scope local by its exact name
 * (e.g. select, used as ($v)=>$.select); dispose runs once when the component detaches
 */
export interface ControllerResult {
    dispose?: () => void;
    [member: string]: unknown;
}

export type Controller = (context: ControllerContext) => ControllerResult | void;

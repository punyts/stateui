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

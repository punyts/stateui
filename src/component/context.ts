import type { Store } from '@punyts/state';
import { StateUIError } from '../errors.js';
import { normalizePath } from '../scope/path.js';
import type { MountContext, ScopeProvider } from './types.js';
import { attachWaitingBeneath, detachAttachedOwnedBy } from './waiting.js';

//mounted roots; nothing is stored on the elements themselves
const mounts: WeakMap<Element, MountContext> = new WeakMap();

/**
 * Returns the parent of a node for scope lookup, crossing from a shadow root to its host
 * @param node
 */
const getScopeParent = (node: Node): Node | null => {
    const parent = node.parentNode;
    if (parent instanceof ShadowRoot) {
        return parent.host;
    }
    return parent;
};

const getProvidedScope = (element: Element) => (element as Element & ScopeProvider).scope;

/**
 * Walks up from el's parent (crossing shadow roots) to the first mounted root or attached component, returning the
 * element that provides the scope and the context it provides
 * @param el
 */
const findScopeOwner = (el: Element): { owner: Element; context: MountContext } | undefined => {
    for (let node = getScopeParent(el); node; node = getScopeParent(node)) {
        if (!(node instanceof Element)) {
            continue;
        }
        const mounted = mounts.get(node);
        if (mounted) {
            return { owner: node, context: mounted };
        }
        const scope = getProvidedScope(node);
        if (scope) {
            return { owner: node, context: { store: scope.store, basePath: scope.basePath } };
        }
    }
    return undefined;
};

/**
 * Finds the store and base path a descendant scopes itself from: the nearest mounted root (its mount path) or
 * component with an attached scope (its scope's base path), walking parentNode upward through shadow roots
 * @param el
 */
export const findParentScope = (el: Element): MountContext | undefined => findScopeOwner(el)?.context;

/**
 * Returns the nearest mounted root above el (crossing shadow roots), ignoring components in between: an attached
 * component got its own scope from that same root
 * @param el
 */
export const findMountRoot = (el: Element): Element | undefined => {
    for (let node = getScopeParent(el); node; node = getScopeParent(node)) {
        if (node instanceof Element && mounts.has(node)) {
            return node;
        }
    }
    return undefined;
};

/**
 * True when el is host or below it, crossing shadow roots
 * @param el
 * @param host
 */
export const isBeneath = (el: Element, host: Element): boolean => {
    for (let node: Node | null = el; node; node = getScopeParent(node)) {
        if (node === host) {
            return true;
        }
    }
    return false;
};

/**
 * Makes host a root: descendants (through shadow roots) scope themselves from store at path. Consumers waiting
 * below host attach immediately
 * @param host
 * @param store
 * @param path - defaults to the store root
 * @throws StateUIError when host is already mounted or path is invalid
 */
export const mount = (host: Element, store: Store<any>, path = '$'): void => {
    if (mounts.has(host)) {
        throw new StateUIError(`<${host.localName}> is already mounted; unmount it first`);
    }
    mounts.set(host, { store, basePath: normalizePath(path) });
    attachWaitingBeneath(host);
};

/**
 * Detaches every consumer whose nearest mounted root is host, forgets the mount and puts still-connected consumers
 * back in the waiting set
 * @param host
 */
export const unmount = (host: Element): void => {
    if (!mounts.has(host)) {
        return;
    }
    detachAttachedOwnedBy(host, () => mounts.delete(host));
};

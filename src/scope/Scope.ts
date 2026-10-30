import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import type { EventListenerFn, Store } from '@punyts/state';
import { normalizePath } from './path.js';
import { classifyVariable } from './variables.js';

export interface Subscription {
    //removes every listener this subscription registered; safe to call more than once
    dispose(): void;
    //re-classifies against the scope's current locals and only adds or removes the paths that changed
    resubscribe(variables: string[]): void;
}

//a path segment that EventManager would treat as a wildcard ($every, $all) or that isn't a plain property name
const PATT_UNSAFE_SEGMENT = /[$*]/;

/**
 * A variable layered on top of the store: a repeat local ($k, $i, $v) or a controller context member.
 * A local with a path points into the store and is read fresh on every access; otherwise value is returned as-is
 */
export interface LocalEntry {
    path?: string;
    value?: unknown;
}

export interface ScopeOptions {
    parent?: Scope;
    locals?: Record<string, LocalEntry>;
    ancestorFloor?: string;
}

export interface ChildScopeOptions {
    basePath?: string;
    ancestorFloor?: string;
}

/**
 * Returns the first segment of a $.-form path as its own path: "$.users.current" -> "$.users", "$" -> "$"
 * @param basePath
 */
const getFirstSegmentPath = (basePath: string) => {
    if (basePath === '$') {
        return basePath;
    }
    return `$.${basePath.slice(2).split('.')[0]}`;
};

const isObjectLike = (value: unknown): value is object => {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
};

/**
 * Cuts a $.-form path before its first wildcard-like segment, so "$.a.$every.b" -> "$.a" and "$.$all" -> "$".
 * EventManager compiles $every and $all as wildcards, so such a segment must never reach store.on
 * @param path
 */
const truncateAtWildcard = (path: string) => {
    if (path === '$') {
        return path;
    }
    const segments = path.slice(2).split('.');
    const safe: string[] = [];
    for (const segment of segments) {
        if (PATT_UNSAFE_SEGMENT.test(segment)) {
            break;
        }
        safe.push(segment);
    }
    return safe.length ? `$.${safe.join('.')}` : '$';
};

/**
 * Adds path and each proper ancestor down to and including the floor. The floor applies when path sits under it;
 * otherwise (and for a "$" floor) the path's own first segment is the floor, so "$" itself is never subscribed
 * for a nested path
 * @param paths
 * @param path
 * @param floor
 */
const addWithAncestors = (paths: Set<string>, path: string, floor: string) => {
    if (path === '$') {
        paths.add(path);
        return;
    }
    const segments = path.slice(2).split('.');
    const underFloor = floor !== '$' && (path === floor || path.startsWith(`${floor}.`));
    const floorDepth = underFloor ? floor.slice(2).split('.').length : 1;
    for (let depth = segments.length; depth >= floorDepth; depth--) {
        paths.add(`$.${segments.slice(0, depth).join('.')}`);
    }
};

/**
 * The store, base path and locals that a component's or repeat item's bindings evaluate against.
 * Scope never keeps a store proxy: Store.replace() swaps the raw object under a proxy, so every read calls
 * store.get(path) afresh
 */
export class Scope {
    readonly store: Store<any>;
    //always $.-form
    readonly basePath: string;
    readonly parent?: Scope;
    readonly locals: Map<string, LocalEntry>;
    //the shallowest ancestor path bindings in this scope subscribe to (used by Scope.subscribe, Story 6a)
    readonly ancestorFloor: string;

    #context?: object;

    constructor(store: Store<any>, basePath: string, options: ScopeOptions = {}) {
        this.store = store;
        this.basePath = normalizePath(basePath);
        this.parent = options.parent;
        this.locals = new Map(Object.entries(options.locals ?? {}));
        this.ancestorFloor = options.ancestorFloor
            ?? options.parent?.ancestorFloor
            ?? getFirstSegmentPath(this.basePath);
    }

    /**
     * Creates a scope that layers locals over this one. It keeps this scope's base path and ancestor floor
     * unless options override them (a repeat item scope sets its item path as the floor)
     * @param locals
     * @param options
     */
    child(locals: Record<string, LocalEntry>, options: ChildScopeOptions = {}): Scope {
        return new Scope(this.store, options.basePath ?? this.basePath, {
            parent: this,
            locals,
            ancestorFloor: options.ancestorFloor ?? this.ancestorFloor,
        });
    }

    /**
     * Finds a local by exact name in this scope, then in each parent scope
     * @param name
     */
    findLocal(name: string): LocalEntry | undefined {
        let scope: Scope | undefined = this;
        while (scope) {
            const local = scope.locals.get(name);
            if (local) {
                return local;
            }
            scope = scope.parent;
        }
        return undefined;
    }

    /**
     * Returns the current value of a local: a fresh store read for a local with a path, otherwise its value
     * @param local
     */
    #readLocal(local: LocalEntry) {
        return local.path !== undefined
            ? this.store.get(local.path)
            : local.value;
    }

    /**
     * Creates the expression evaluation context: a StateUI-owned Proxy that resolves locals first and then the
     * scope's base object. It is neither the store proxy nor inherits from it, because the store proxy's set trap
     * ignores the receiver and would write the iterator's $k/$i/$v (assigned onto Object.create(context)) into state.
     * Expressions can never write state through it
     */
    createContext(): object {
        //a null-prototype target, so nothing is inherited from Object.prototype
        const target = Object.create(null) as object;
        const context: object = new Proxy(target, {
            get: (_target, prop) => {
                if (typeof prop !== 'string') {
                    return undefined;
                }
                const local = this.findLocal(prop);
                if (local) {
                    return this.#readLocal(local);
                }
                const base: unknown = this.store.get(this.basePath);
                return isObjectLike(base)
                    ? (base as Record<string, unknown>)[prop]
                    : undefined;
            },
            has: (_target, prop) => {
                if (typeof prop !== 'string') {
                    return false;
                }
                if (this.findLocal(prop)) {
                    return true;
                }
                const base: unknown = this.store.get(this.basePath);
                return isObjectLike(base) && prop in base;
            },
            set: (_target, prop, value, receiver) => {
                //an Object.create(context) child, e.g. the executor assigning iterator locals: keep it on the child
                if (receiver !== context) {
                    return Reflect.defineProperty(receiver, prop, {
                        value,
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    });
                }
                report.warning('Expressions cannot write state', { property: String(prop), basePath: this.basePath });
                return false;
            },
            defineProperty: (_target, prop) => {
                report.warning('Expressions cannot write state', { property: String(prop), basePath: this.basePath });
                return false;
            },
            deleteProperty: (_target, prop) => {
                report.warning('Expressions cannot delete state', { property: String(prop), basePath: this.basePath });
                return false;
            },
        });
        return context;
    }

    /**
     * Returns the distinct store paths a binding over these variables must listen to: each variable's path and
     * every ancestor down to the ancestor floor, so a replace or delete of any ancestor (including the object the
     * scope is based on) re-evaluates the binding. Locals without a store path add nothing.
     *
     * A dynamic variable ($.a[$.k].b gives $.a.$every.b) is never registered literally, because EventManager treats
     * $every as a wildcard: its prefix ($.a) and that prefix's ancestors are subscribed, and the indexer ($.k) is
     * subscribed through its own variable entry. Limitation: a change nested inside the dynamically-indexed entry
     * ($.a.x.b changing while $.k is "x") does not notify unless the entry itself, or an ancestor, is replaced
     * @param variables
     */
    #getSubscriptionPaths(variables: string[]) {
        const paths: Set<string> = new Set();
        for (const variable of variables) {
            const classified = classifyVariable(variable, this);
            if (!classified || classified.kind === 'local') {
                continue;
            }
            const path = classified.kind === 'dynamic'
                ? classified.prefix
                : classified.path;
            addWithAncestors(paths, truncateAtWildcard(path), this.ancestorFloor);
        }
        return paths;
    }

    /**
     * Listens to every store path the variables depend on. Each distinct path is registered once with
     * store.on(path, listener), because EventManager.removeListener only removes the first occurrence
     * @param variables - a CompiledExpression's variables
     * @param listener
     */
    subscribe(variables: string[], listener: EventListenerFn): Subscription {
        let registered: Set<string> = new Set();
        let disposed = false;

        const apply = (next: Set<string>) => {
            for (const path of registered) {
                if (!next.has(path)) {
                    this.store.off(path, listener);
                }
            }
            for (const path of next) {
                if (!registered.has(path)) {
                    this.store.on(path, listener);
                }
            }
            registered = next;
        };

        apply(this.#getSubscriptionPaths(variables));

        return {
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                apply(new Set());
            },
            resubscribe: (nextVariables: string[]) => {
                if (disposed) {
                    return;
                }
                apply(this.#getSubscriptionPaths(nextVariables));
            },
        };
    }

    /**
     * Evaluates a compiled expression against this scope. Missing paths evaluate to undefined instead of throwing,
     * so a base path that doesn't exist yet renders empty and updates when it appears
     * @param compiled
     */
    evaluate(compiled: CompiledExpression): unknown {
        //the context reads locals and the store on every access, so one per scope is enough
        this.#context ??= this.createContext();
        return compiled.execute(this.#context, { quiet: true });
    }
}

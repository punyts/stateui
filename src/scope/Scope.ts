import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import type { EventListenerFn, Store } from '@punyts/state';
import { normalizePath } from './path.js';
import { bindEverySegments, classifyVariable, countEverySegments, readVariable } from './variables.js';

//the part of a Binding (src/binding/Binding.ts) that Scope.setLocals needs; declared here to keep scope/ free of binding/
export interface RebindableBinding {
    readonly disposed: boolean;
    rebind(): void;
}

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

    #ancestorFloor: string;
    #context?: object;
    //bindings attached in this scope, rebound by setLocals
    readonly #bindings: Set<RebindableBinding> = new Set();

    constructor(store: Store<any>, basePath: string, options: ScopeOptions = {}) {
        this.store = store;
        this.basePath = normalizePath(basePath);
        this.parent = options.parent;
        this.locals = new Map(Object.entries(options.locals ?? {}));
        this.#ancestorFloor = options.ancestorFloor
            ?? options.parent?.ancestorFloor
            ?? getFirstSegmentPath(this.basePath);
    }

    /**
     * The shallowest ancestor path bindings in this scope subscribe to (used by subscribe). A repeat item scope
     * uses its item path, and setLocals can move it when the item moves
     */
    get ancestorFloor(): string {
        return this.#ancestorFloor;
    }

    /**
     * Registers a binding so setLocals rebinds it. createBinding calls this; dispose unregisters
     * @param binding
     */
    registerBinding(binding: RebindableBinding): void {
        this.#bindings.add(binding);
    }

    unregisterBinding(binding: RebindableBinding): void {
        this.#bindings.delete(binding);
    }

    /**
     * Re-targets this scope in place, e.g. when a repeat item's index or store path changes: sets the given locals
     * (other locals are kept), optionally moves the ancestor floor, then rebinds every live binding registered on
     * this scope so it subscribes to the new paths and re-renders once
     * @param locals
     * @param options
     */
    setLocals(locals: Record<string, LocalEntry>, options: { ancestorFloor?: string } = {}): void {
        for (const [name, local] of Object.entries(locals)) {
            this.locals.set(name, local);
        }
        if (options.ancestorFloor !== undefined) {
            this.#ancestorFloor = normalizePath(options.ancestorFloor);
        }
        //snapshot: a rebind may dispose other bindings in this scope
        for (const binding of [...this.#bindings]) {
            if (!binding.disposed) {
                binding.rebind();
            }
        }
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
     * $every as a wildcard. Its prefix ($.a) and that prefix's ancestors are subscribed, and so is the entry the
     * indexer values currently select ($.a.x.b and its ancestors while $.k is "x"). The indexer variables are listed
     * before the dynamic variable, so they are the nearest preceding variables, one per $every segment; the variables
     * that follow in the same group are prefixes of the first one and use its first indexers. When the indexers can't
     * be matched or hold no usable key, only the prefix is subscribed.
     *
     * Also returns the paths of the indexer variables, which subscribe() watches to move the entry subscription
     * @param variables
     */
    #getSubscriptionPaths(variables: string[]) {
        const paths: Set<string> = new Set();
        const indexerPaths: Set<string> = new Set();
        const addVariable = (target: Set<string>, variable: string) => {
            const classified = classifyVariable(variable, this);
            if (classified?.kind === 'store') {
                addWithAncestors(target, truncateAtWildcard(classified.path), this.ancestorFloor);
            }
        };

        let preceding: string[] = [];
        let group: { first: string; indexers: string[] } | undefined;
        for (const variable of variables) {
            const classified = classifyVariable(variable, this);
            if (classified?.kind !== 'dynamic') {
                preceding.push(variable);
                addVariable(paths, variable);
                continue;
            }

            addWithAncestors(paths, truncateAtWildcard(classified.prefix), this.ancestorFloor);
            const count = countEverySegments(variable);
            let indexers: string[] | undefined;
            if (group && (group.first === variable || group.first.startsWith(`${variable}.`)) && count <= group.indexers.length) {
                indexers = group.indexers.slice(0, count);
            }
            else if (preceding.length >= count) {
                indexers = preceding.slice(preceding.length - count);
                group = { first: variable, indexers };
                preceding = [];
            }
            if (!indexers) {
                continue;
            }

            for (const indexer of indexers) {
                addVariable(indexerPaths, indexer);
            }
            const entry = bindEverySegments(variable, indexers.map((indexer) => readVariable(indexer, this)), this);
            if (entry) {
                addWithAncestors(paths, truncateAtWildcard(entry), this.ancestorFloor);
            }
        }
        return { paths, indexerPaths };
    }

    /**
     * Listens to every store path the variables depend on. Each distinct path is registered once with
     * store.on(path, listener), because EventManager.removeListener only removes the first occurrence.
     * When a variable has a dynamic indexer, an internal listener on the indexer variables moves the entry
     * subscription whenever an indexer value changes, so no wildcard is ever registered
     * @param variables - a CompiledExpression's variables
     * @param listener
     */
    subscribe(variables: string[], listener: EventListenerFn): Subscription {
        let registered: Set<string> = new Set();
        let registeredIndexers: Set<string> = new Set();
        let currentVariables = variables;
        let disposed = false;

        const sync = (current: Set<string>, next: Set<string>, fn: EventListenerFn) => {
            for (const path of current) {
                if (!next.has(path)) {
                    this.store.off(path, fn);
                }
            }
            for (const path of next) {
                if (!current.has(path)) {
                    this.store.on(path, fn);
                }
            }
            return next;
        };

        //runs when an indexer value may have changed; the binding's own listener re-evaluates independently
        const moveEntries: EventListenerFn = () => {
            if (!disposed) {
                refresh();
            }
        };

        const refresh = () => {
            const next = this.#getSubscriptionPaths(currentVariables);
            registered = sync(registered, next.paths, listener);
            registeredIndexers = sync(registeredIndexers, next.indexerPaths, moveEntries);
        };

        refresh();

        return {
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                registered = sync(registered, new Set(), listener);
                registeredIndexers = sync(registeredIndexers, new Set(), moveEntries);
            },
            resubscribe: (nextVariables: string[]) => {
                if (disposed) {
                    return;
                }
                currentVariables = nextVariables;
                refresh();
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

import { report } from '@punyts/core';
import { normalizePath } from './path.js';
import type { LocalEntry, Scope } from './Scope.js';

export type VariableClass =
    //a store path to subscribe to, in $.-form
    | { kind: 'store'; path: string }
    //a local without a store path (e.g. a controller member): nothing to subscribe to
    | { kind: 'local' }
    //contains $every: never registered literally, because EventManager treats $every as a wildcard;
    //the prefix (an absolute store path), its ancestors and the indexer variables are subscribed instead
    | { kind: 'dynamic'; prefix: string };

const PATT_FIRST_SEGMENT = /^[^.[]+/;
const PATT_STRIP_ROOT = /^\$\.?/;
const EVERY_SEGMENT = '.$every';

//unclassifiable variables are reported once each, not on every compile
const reportedVariables: Set<string> = new Set();

/**
 * Appends rest (a ".a.b" suffix or "") to a $.-form path
 * @param path
 * @param rest
 */
const joinPath = (path: string, rest: string) => {
    return rest ? `${path}${rest}` : path;
};

/**
 * Classifies a local match: a local with a store path resolves to that path plus the rest of the variable
 * @param local
 * @param rest
 */
const classifyLocal = (local: LocalEntry, rest: string): VariableClass => {
    if (local.path === undefined) {
        return { kind: 'local' };
    }
    return { kind: 'store', path: normalizePath(joinPath(normalizePath(local.path), rest)) };
};

/**
 * Resolves a variable without $every to a store or local class, the same way @punyts/expression's lookupPath reads it:
 * the exact first segment ($v) first, then the first segment after stripping a leading $. or $ (so $.select finds the
 * controller member select), otherwise a path under the scope's base path
 * @param variable
 * @param scope
 * @throws StateUIError (from normalizePath) when the resulting path is invalid
 */
const resolve = (variable: string, scope: Scope): VariableClass => {
    if (variable === '$') {
        return { kind: 'store', path: scope.basePath };
    }

    const exactFirst = variable.match(PATT_FIRST_SEGMENT)?.[0];
    if (exactFirst) {
        const local = scope.findLocal(exactFirst);
        if (local) {
            return classifyLocal(local, variable.slice(exactFirst.length));
        }
    }

    const stripped = variable.replace(PATT_STRIP_ROOT, '');
    const strippedFirst = stripped.match(PATT_FIRST_SEGMENT)?.[0];
    if (strippedFirst) {
        const local = scope.findLocal(strippedFirst);
        if (local) {
            return classifyLocal(local, stripped.slice(strippedFirst.length));
        }
    }

    return {
        kind: 'store',
        path: normalizePath(stripped ? joinPath(scope.basePath, `.${stripped}`) : scope.basePath),
    };
};

/**
 * Maps a CompiledExpression variable (raw, as written; see variables.characterisation.test.ts) to what a binding
 * subscribes to. Returns null, after reporting it once, for a variable that can't be classified
 * @param variable
 * @param scope
 */
export const classifyVariable = (variable: string, scope: Scope): VariableClass | null => {
    try {
        const everyIndex = variable.indexOf(EVERY_SEGMENT);
        if (everyIndex !== -1) {
            const prefix = resolve(variable.slice(0, everyIndex), scope);
            if (prefix.kind !== 'store') {
                throw new Error('the $every prefix does not point into the store');
            }
            return { kind: 'dynamic', prefix: prefix.path };
        }
        return resolve(variable, scope);
    }
    catch (error) {
        if (!reportedVariables.has(variable)) {
            reportedVariables.add(variable);
            report.warning('StateUI cannot classify an expression variable; it will not be subscribed', {
                variable,
                basePath: scope.basePath,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
        return null;
    }
};

/**
 * Counts the $every segments of a dynamic variable ($.a.$every.b.$every.c -> 2)
 * @param variable
 */
export const countEverySegments = (variable: string) => {
    return variable.split(EVERY_SEGMENT).length - 1;
};

//an indexer value that can stand in for one path segment without being read as a wildcard or a nested path
const PATT_SAFE_KEY = /^[^.$*[\]\s]+$/;
const PATT_ACCESSOR = /[.[\]]+/;

/**
 * Replaces each $every segment of a dynamic variable with the matching indexer value, in order, and classifies the
 * resulting concrete variable. Returns null when a value can't be a path segment or the result isn't a store path
 * @param variable - a dynamic variable ($.a.$every.b)
 * @param keys - one indexer value per $every segment
 * @param scope
 */
export const bindEverySegments = (variable: string, keys: unknown[], scope: Scope): string | null => {
    const parts = variable.split(EVERY_SEGMENT);
    let concrete = parts[0];
    for (let index = 1; index < parts.length; index++) {
        const key = keys[index - 1];
        const text = typeof key === 'string' || typeof key === 'number' ? String(key) : '';
        if (!PATT_SAFE_KEY.test(text)) {
            return null;
        }
        concrete = `${concrete}.${text}${parts[index]}`;
    }
    const classified = classifyVariable(concrete, scope);
    return classified?.kind === 'store' ? classified.path : null;
};

/**
 * Reads the current value of an indexer variable: a store path is read fresh, a local without a store path is
 * read from its value. Returns undefined for anything that can't be read
 * @param variable
 * @param scope
 */
export const readVariable = (variable: string, scope: Scope): unknown => {
    const classified = classifyVariable(variable, scope);
    if (!classified || classified.kind === 'dynamic') {
        return undefined;
    }
    if (classified.kind === 'store') {
        return scope.store.get(classified.path);
    }
    for (const candidate of [variable, variable.replace(PATT_STRIP_ROOT, '')]) {
        const first = candidate.match(PATT_FIRST_SEGMENT)?.[0];
        const local = first ? scope.findLocal(first) : undefined;
        if (first && local) {
            let value: unknown = local.value;
            for (const segment of candidate.slice(first.length).split(PATT_ACCESSOR).filter(Boolean)) {
                if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
                    return undefined;
                }
                value = (value as Record<string, unknown>)[segment];
            }
            return value;
        }
    }
    return undefined;
};

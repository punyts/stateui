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

import { resolveRelativePath, validatePath } from '@punyts/state';
import { StateUIError } from '../errors.js';

/**
 * Returns the canonical $.-prefixed form of a store path. @punyts/state emits $.-prefixed paths, while proxies from
 * get("users") carry an unprefixed __path, so every base path and listener path goes through here before store.on/off.
 * "users.current" -> "$.users.current"; "$.users" and "$" are unchanged
 * @param path
 * @throws StateUIError for an empty path or one that fails validatePath
 */
export const normalizePath = (path: string): string => {
    if (!path) {
        throw new StateUIError('Invalid state path: the path is empty');
    }
    if (!validatePath(path)) {
        throw new StateUIError(`Invalid state path "${path}"`);
    }

    return path === '$' || path.startsWith('$.')
        ? path
        : `$.${path}`;
};

/**
 * Resolves a state path against a base path and returns its $.-prefixed form. ".child" is relative to basePath,
 * "..sibling" to its parent and each extra dot climbs one more level; any other path is absolute
 * @param basePath - the $.-form base path of the parent scope
 * @param statePath
 * @throws StateUIError when the result is empty or invalid, e.g. when a relative path climbs above the root
 */
export const resolveScopePath = (basePath: string, statePath: string): string => {
    //resolveRelativePath rewrites the array it is given, so hand it a fresh one
    const [resolved] = resolveRelativePath(basePath, [statePath]);
    return normalizePath(resolved);
};

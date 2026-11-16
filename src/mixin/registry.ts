import { StateUIError } from '../errors.js';
import type { Scope } from '../scope/Scope.js';

export type Disposer = () => void;

/**
 * A mixin: called once when an element carrying its attribute is instantiated. attrs holds every registered-mixin
 * attribute of that element (the evaluated value for {{ }} attributes, the literal text otherwise), evaluated once;
 * a mixin that wants reactivity subscribes itself with scope.subscribe. The returned disposer runs once on dispose
 */
export type Mixin = (element: Element, attrs: Readonly<Record<string, unknown>>, scope: Scope) => Disposer | void;

const mixins: Map<string, Mixin> = new Map();

const PATT_ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED: ReadonlySet<string> = new Set(['if', 'ifelse', 'else', 'repeat', 'key', 'bind', 'state']);

/**
 * Registers a global attribute directive. Templates are matched against the registry when they are compiled, so a
 * mixin registered after a template (or the defineComponent that compiled it) is not applied to that template
 * @param name - a valid XML attribute name that isn't a built-in (if, ifelse, else, repeat, key, bind, state, on*)
 * @param fn
 * @throws StateUIError for an invalid, reserved or already-registered name
 */
export const registerMixin = (name: string, fn: Mixin): void => {
    if (!PATT_ATTRIBUTE_NAME.test(name)) {
        throw new StateUIError(`Invalid mixin name "${name}": it must be a valid XML attribute name`);
    }
    if (RESERVED.has(name) || /^on/i.test(name)) {
        throw new StateUIError(`Mixin name "${name}" collides with a built-in attribute`);
    }
    if (mixins.has(name)) {
        throw new StateUIError(`A mixin named "${name}" is already registered`);
    }
    mixins.set(name, fn);
};

/**
 * Removes a mixin (mainly for tests); templates already compiled keep their plan
 * @param name
 */
export const unregisterMixin = (name: string): void => {
    mixins.delete(name);
};

export const getMixin = (name: string): Mixin | undefined => mixins.get(name);

export const isMixin = (name: string): boolean => mixins.has(name);

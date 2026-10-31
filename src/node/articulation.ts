import { report } from '@punyts/core';
import type { NodeThemeMapper } from './options.js';

export const NODE_NAME = 'SUI-NODE-NAME';

//the only names written as attributes: lower-case letters, digits and "-", starting with a letter
const PATT_SAFE_ATTRIBUTE = /^[a-z][a-z0-9-]*$/;
//the only names written as custom properties
const PATT_SAFE_PROPERTY = /^--[A-Za-z0-9-]+$/;
//a node property the reflect option may name
const PATT_SAFE_PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

export type Desired = Map<string, string>;

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const toKebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const isSafePropertyKey = (name: string): boolean => PATT_SAFE_PROPERTY_KEY.test(name);

//a string or a finite number as its text; undefined for everything else
const scalarText = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
        return value;
    }
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

/**
 * The attribute text for a value: a string or number as its text, true as "", and undefined (remove) for everything
 * else (false, null, undefined, objects, functions)
 * @param value
 */
export const attributeText = (value: unknown): string | undefined => value === true ? '' : scalarText(value);

export const reportUnsafeName = (kind: string, name: string): void => {
    report.error(`${NODE_NAME}: "${name}" is not a safe ${kind} name and was ignored`, { code: NODE_NAME, name });
};

/**
 * Adds the attribute for key (camelCase to kebab-case, after the prefix) when its name is safe and the value asks
 * for one; an unsafe name is reported and left out. Returns the attribute name when it was safe
 */
const addAttribute = (desired: Desired, prefix: string, key: string, value: unknown): string | undefined => {
    const name = `${prefix}${toKebab(key)}`;
    if (!PATT_SAFE_ATTRIBUTE.test(name)) {
        reportUnsafeName('attribute', key);
        return undefined;
    }
    const text = attributeText(value);
    if (text !== undefined) {
        desired.set(name, text);
    }
    return name;
};

/**
 * The attributes a `placement` object asks for. A key starting with "_" is content, not placement, and is skipped
 * @param placement
 */
export const placementAttributes = (placement: unknown): Desired => {
    const desired: Desired = new Map();
    if (!isPlainObject(placement)) {
        return desired;
    }
    for (const [key, value] of Object.entries(placement)) {
        if (!key.startsWith('_')) {
            addAttribute(desired, '', key, value);
        }
    }
    return desired;
};

/**
 * The attributes and custom properties a `layout` object asks for: `type` becomes `layout`, any other setting
 * becomes `layout-<setting>` and, when it is a string or a number, `--layout-<setting>`
 * @param layout
 */
export const layoutWrites = (layout: unknown): { attributes: Desired; properties: Desired } => {
    const attributes: Desired = new Map();
    const properties: Desired = new Map();
    if (!isPlainObject(layout)) {
        return { attributes, properties };
    }
    for (const [key, value] of Object.entries(layout)) {
        if (key === 'type') {
            addAttribute(attributes, '', 'layout', value);
            continue;
        }
        const name = addAttribute(attributes, 'layout-', key, value);
        const text = scalarText(value);
        if (name !== undefined && text !== undefined) {
            properties.set(`--${name}`, text);
        }
    }
    return { attributes, properties };
};

/**
 * The custom properties a `theme` object asks for: each string or number leaf, named by mapper.property and valued by
 * mapper.value. A leaf the mapper skips is not written; a name that is not a custom property is reported and skipped
 * @param theme
 * @param mapper
 */
export const themeProperties = (theme: unknown, mapper: NodeThemeMapper): Desired => {
    const desired: Desired = new Map();
    const walk = (value: unknown, path: string[]): void => {
        if (isPlainObject(value)) {
            for (const [key, child] of Object.entries(value)) {
                walk(child, [...path, key]);
            }
            return;
        }
        const text = scalarText(value);
        if (path.length === 0 || text === undefined) {
            return;
        }
        const name = mapper.property(path);
        if (name === undefined) {
            return;
        }
        if (!PATT_SAFE_PROPERTY.test(name)) {
            reportUnsafeName('custom property', name);
            return;
        }
        desired.set(name, mapper.value(text));
    };
    walk(theme, []);
    return desired;
};

/**
 * Keeps one element's attributes and custom properties equal to a desired set: writes what changed, removes what is
 * no longer asked for, and moves everything when the target element changes. It records what it wrote, so it never
 * reads the DOM
 */
export class AppliedWrites {
    #target?: Element;
    #attributes: Desired = new Map();
    #properties: Desired = new Map();

    sync(target: Element, attributes: Desired, properties: Desired): void {
        if (this.#target !== target) {
            this.clear();
            this.#target = target;
        }
        for (const name of this.#attributes.keys()) {
            if (!attributes.has(name)) {
                target.removeAttribute(name);
            }
        }
        for (const [name, text] of attributes) {
            if (this.#attributes.get(name) !== text) {
                target.setAttribute(name, text);
            }
        }
        this.#attributes = new Map(attributes);
        const style = (target as HTMLElement).style;
        for (const name of this.#properties.keys()) {
            if (!properties.has(name)) {
                style.removeProperty(name);
            }
        }
        for (const [name, text] of properties) {
            if (this.#properties.get(name) !== text) {
                style.setProperty(name, text);
            }
        }
        this.#properties = new Map(properties);
    }

    clear(): void {
        const target = this.#target;
        if (target) {
            for (const name of this.#attributes.keys()) {
                target.removeAttribute(name);
            }
            for (const name of this.#properties.keys()) {
                (target as HTMLElement).style.removeProperty(name);
            }
        }
        this.#target = undefined;
        this.#attributes = new Map();
        this.#properties = new Map();
    }
}

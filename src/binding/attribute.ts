import { report } from '@punyts/core';
import type { Scope } from '../scope/Scope.js';
import { createBinding, type Binding } from './Binding.js';
import type { PlanEntry } from './types.js';

//attributes a browser navigates to or loads from: a javascript: URL in them would run script
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'src', 'action', 'formaction']);
//browsers ignore control characters and spaces inside a scheme, so "java\tscript:" still runs
const PATT_IGNORED_URL_CHARS = /[\u0000- ]/g;
const PATT_EVENT_ATTRIBUTE = /^on/i;

/**
 * "data-item-id" -> "dataItemId"
 * @param name
 */
export const toCamelCase = (name: string) => name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/**
 * True when a string written to a URL attribute would be a javascript: URL
 * @param name
 * @param value
 */
export const isUnsafeUrl = (name: string, value: string) => {
    return URL_ATTRIBUTES.has(name.toLowerCase())
        && value.replace(PATT_IGNORED_URL_CHARS, '').toLowerCase().startsWith('javascript:');
};

const isPropertyValue = (value: unknown) => {
    return typeof value === 'function' || (typeof value === 'object' && value !== null);
};

/**
 * Binds an attribute value. A value made of several parts always renders as a string attribute. A single {{ }} is
 * applied by type on every update: an object or function becomes a property (el[camelCase(name)], and the attribute
 * is removed); null, undefined and false remove the attribute; true sets it to ""; any other primitive sets
 * String(value). Leaving property mode first assigns undefined to the property. on* attributes are never written
 * here (they belong to the event binding), and javascript: URLs in href, src, action and formaction are refused
 * @param node
 * @param entry
 * @param scope
 */
export const attachAttribute = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const element = node as Element;
    const name = entry.attrName!;
    const property = toCamelCase(name);
    const isSingleExpression = entry.parts.length === 1 && typeof entry.parts[0] !== 'string';
    let propertyMode = false;

    const writeAttribute = (value: string) => {
        if (isUnsafeUrl(name, value)) {
            element.removeAttribute(name);
            report.error(`Refused a javascript: URL for the ${name} attribute`, { attribute: name, nodePath: entry.nodePath });
            return;
        }
        element.setAttribute(name, value);
    };

    const leavePropertyMode = () => {
        if (propertyMode) {
            (element as unknown as Record<string, unknown>)[property] = undefined;
            propertyMode = false;
        }
    };

    return createBinding({
        scope,
        expressions: entry.parts,
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: (value) => {
            if (PATT_EVENT_ATTRIBUTE.test(name)) {
                return;
            }
            if (!isSingleExpression) {
                writeAttribute(value as string);
                return;
            }
            if (isPropertyValue(value)) {
                (element as unknown as Record<string, unknown>)[property] = value;
                propertyMode = true;
                element.removeAttribute(name);
                return;
            }
            leavePropertyMode();
            if (value === null || value === undefined || value === false) {
                element.removeAttribute(name);
            }
            else if (value === true) {
                element.setAttribute(name, '');
            }
            else {
                writeAttribute(String(value));
            }
        },
    });
};

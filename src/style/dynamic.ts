import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import { createBinding, type Binding } from '../binding/Binding.js';
import type { Scope } from '../scope/Scope.js';
import type { TokenPart } from '../template/tokenize.js';
import { escapeIdent } from './escape.js';
import { rewriteHost, styleContainer } from './light.js';
import type { DynamicRule, StyleProgram } from './types.js';

const DYNAMIC_KIND = 'style-rule';
//a value interpolated into an @media/@supports/@container prelude must match this, or the rule is skipped
const PATT_SAFE_PRELUDE = /^[A-Za-z0-9_.%()\s:-]*$/;
//separates expression values in a binding's change key, so ["a", "b"] and ["ab", ""] differ
const KEY_SEPARATOR = '\u0000';

let instanceCounter = 0;

/**
 * Where a rule's text goes: one slot per top-level dynamic rule, each holding zero or one rule of the sheet
 */
interface RuleSlots {
    set(index: number, text: string | null): void;
}

/**
 * Applies the slots to a CSSStyleSheet with deleteRule + insertRule at the slot's index. Each insert runs in its own
 * try/catch: an invalid rule is reported (once per distinct text) and its slot stays empty, other slots are untouched
 * @param sheet
 * @param count
 */
const sheetSlots = (sheet: CSSStyleSheet, count: number): RuleSlots => {
    const occupied: boolean[] = new Array(count).fill(false);
    const rejected: Array<string | null> = new Array(count).fill(null);

    return {
        set: (index, text) => {
            const position = occupied.slice(0, index).filter(Boolean).length;
            if (occupied[index]) {
                sheet.deleteRule(position);
                occupied[index] = false;
            }
            if (text === null) {
                return;
            }
            try {
                sheet.insertRule(text, position);
                occupied[index] = true;
                rejected[index] = null;
            }
            catch (error) {
                if (rejected[index] !== text) {
                    report.error(`Skipped an invalid dynamic style rule "${text}": ${error instanceof Error ? error.message : String(error)}`, { error });
                }
                rejected[index] = text;
            }
        },
    };
};

/**
 * Applies the slots to a <style> element: through its sheet when it has one, else by rewriting its text
 * @param style
 * @param count
 */
const styleSlots = (style: HTMLStyleElement, count: number): RuleSlots => {
    if (style.sheet) {
        return sheetSlots(style.sheet, count);
    }
    const texts: Array<string | null> = new Array(count).fill(null);
    return {
        set: (index, text) => {
            texts[index] = text;
            style.textContent = texts.filter((entry) => entry !== null).join('');
        },
    };
};

/**
 * Every expression in a rule's selector or prelude and in those of the dynamic rules nested in its body
 * @param rule
 */
const ruleExpressions = (rule: DynamicRule): CompiledExpression[] => [
    ...[...rule.selectorParts, ...rule.preludeParts].filter((part): part is CompiledExpression => typeof part !== 'string'),
    ...rule.body.dynamicRules.flatMap(ruleExpressions),
];

/**
 * Renders a selector or prelude: literal parts as written (through literal), expression values escaped as
 * identifiers in a selector, or verbatim in a prelude when they match PATT_SAFE_PRELUDE. Returns undefined when a
 * prelude value is unsafe (the rule is then skipped)
 */
const renderHeader = (parts: TokenPart[], prelude: boolean, scope: Scope, literal: (text: string) => string): string | undefined => {
    let text = '';
    for (const part of parts) {
        if (typeof part === 'string') {
            text += literal(part);
            continue;
        }
        const value = scope.evaluate(part);
        const string = value === null || value === undefined ? '' : String(value);
        if (!prelude) {
            text += escapeIdent(string);
            continue;
        }
        if (!PATT_SAFE_PRELUDE.test(string)) {
            report.error(`Skipped a dynamic style rule: the value "${string}" is not allowed in an at-rule prelude`, { value: string });
            return undefined;
        }
        text += string;
    }
    return text;
};

/**
 * Renders a dynamic rule, wrapped in its static ancestors: its header, then its body's static CSS and nested
 * dynamic rules. Values only ever appear as escaped identifiers (selectors) or as checked prelude text, and the body
 * only references var(--sui-<classId>-<n>) declarations. Returns undefined when the rule is skipped
 * @param rule
 * @param scope
 * @param literal - transforms static text (rewrites :host in light DOM)
 */
export const renderDynamicRule = (rule: DynamicRule, scope: Scope, literal: (text: string) => string = (text) => text): string | undefined => {
    const isPrelude = rule.selectorParts.length === 0;
    const header = renderHeader(isPrelude ? rule.preludeParts : rule.selectorParts, isPrelude, scope, literal);
    if (header === undefined) {
        return undefined;
    }
    const nested = rule.body.dynamicRules.map((child) => renderDynamicRule(child, scope, literal) ?? '').join('');
    const inner = `${header}{${literal(rule.body.staticCss)}${nested}}`;
    return rule.ancestors.reduceRight((text, ancestor) => `${literal(ancestor)}{${text}}`, inner);
};

/**
 * Binds every dynamic rule of the program to its own slot: a write to any variable of a rule's selector or prelude
 * (or a nested one) rebuilds that rule only
 */
const bindRules = (program: StyleProgram, scope: Scope, slots: RuleSlots, render: (rule: DynamicRule) => string | undefined): Binding[] => {
    return program.dynamicRules.map((rule, index) => {
        const expressions = ruleExpressions(rule);
        const key: TokenPart[] = expressions.flatMap((expression, position) => position === 0 ? [expression] : [KEY_SEPARATOR, expression]);
        const binding = createBinding({
            scope,
            expressions: key.length ? key : [''],
            kind: DYNAMIC_KIND,
            nodePath: [index],
            apply: () => slots.set(index, render(rule) ?? null),
        });
        binding.update();
        return binding;
    });
};

/**
 * Renders a shadow component's dynamic rules into its own sheet, adopted after the shared sheet (or, without
 * constructable sheets, a second <style> appended to the shadow root). Returns the function that disposes the
 * bindings and removes the sheet; a program without dynamic rules adds nothing
 * @param root
 * @param program
 * @param scope
 */
export const attachShadowDynamicRules = (root: ShadowRoot, program: StyleProgram, scope: Scope): (() => void) => {
    const count = program.dynamicRules.length;
    if (!count) {
        return () => undefined;
    }

    let slots: RuleSlots;
    let remove: () => void;
    if (typeof CSSStyleSheet === 'function' && Array.isArray((root as { adoptedStyleSheets?: unknown }).adoptedStyleSheets)) {
        const sheet = new CSSStyleSheet();
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        slots = sheetSlots(sheet, count);
        remove = () => {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter((entry) => entry !== sheet);
        };
    }
    else {
        const style = root.ownerDocument.createElement('style');
        root.append(style);
        slots = styleSlots(style, count);
        remove = () => style.remove();
    }

    const bindings = bindRules(program, scope, slots, (rule) => renderDynamicRule(rule, scope));
    return () => {
        bindings.forEach((binding) => binding.dispose());
        remove();
    };
};

/**
 * Renders a light-DOM component's dynamic rules into a <style> of its own (in document.head or its shadow root),
 * each nested in [data-sui="<instanceId>"] with :host rewritten to &; data-sui is set on the element. Returns the
 * function that disposes the bindings and removes the <style> and the attribute
 * @param element
 * @param program
 * @param scope
 */
export const attachLightDynamicRules = (element: Element, program: StyleProgram, scope: Scope): (() => void) => {
    const count = program.dynamicRules.length;
    const container = styleContainer(element);
    if (!count || !container) {
        return () => undefined;
    }

    const instanceId = `i${++instanceCounter}`;
    element.setAttribute('data-sui', instanceId);
    const style = element.ownerDocument.createElement('style');
    style.setAttribute('data-sui-dynamic', instanceId);
    container.append(style);
    const slots = styleSlots(style, count);

    const prefix = `[data-sui="${instanceId}"]`;
    const bindings = bindRules(program, scope, slots, (rule) => {
        const text = renderDynamicRule(rule, scope, rewriteHost);
        return text === undefined ? undefined : `${prefix}{${text}}`;
    });
    return () => {
        bindings.forEach((binding) => binding.dispose());
        style.remove();
        if (element.getAttribute('data-sui') === instanceId) {
            element.removeAttribute('data-sui');
        }
    };
};

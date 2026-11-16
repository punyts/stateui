import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import type { Scope } from '../scope/Scope.js';
import type { TokenPart } from '../template/tokenize.js';
import { escapeIdent } from './escape.js';
import type { DynamicRule } from './types.js';

//a value interpolated into an @media/@supports/@container prelude must match this, or the rule is skipped
const PATT_SAFE_PRELUDE = /^[A-Za-z0-9_.%()\s:-]*$/;

//separates expression values in a binding's change key, so ["a", "b"] and ["ab", ""] differ
const KEY_SEPARATOR = '\u0000';

/**
 * The parts of a binding that changes when any of the expressions' values change: the expressions interleaved with
 * a separator, or [''] (a constant) when there are none
 * @param expressions
 */
export const changeKey = (expressions: CompiledExpression[]): TokenPart[] => {
    const key = expressions.flatMap((expression, position): TokenPart[] => position === 0 ? [expression] : [KEY_SEPARATOR, expression]);
    return key.length ? key : [''];
};

/**
 * Every expression in a rule's selector or prelude and in those of the dynamic rules nested in its body
 * @param rule
 */
export const ruleExpressions = (rule: DynamicRule): CompiledExpression[] => [
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
 * @param literal - transforms static text (rewrites :host in light DOM, item-suffixes var names in @each)
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

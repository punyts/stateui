import type { CompiledExpression } from '@punyts/expression';
import { createBinding, type Binding } from '../binding/Binding.js';
import { PATT_ITERATOR } from '../binding/iterator.js';
import { getItemPath, isIterator } from '../binding/repeat.js';
import type { LocalEntry, Scope } from '../scope/Scope.js';
import { classifyVariable } from '../scope/variables.js';
import { topLevelItems } from './light.js';
import { applyProperty } from './properties.js';
import { changeKey, renderDynamicRule, ruleExpressions } from './render.js';
import type { RuleSlots } from './slots.js';
import type { EachRule } from './types.js';

const EACH_KIND = 'style-each';
const ITEM_KIND = 'style-each-item';
const PROPERTY_KIND = 'style';

interface EachItem {
    texts: Array<string | null>;
    bindings: Binding[];
}

export interface EachRuleOptions {
    //the element the item-scoped custom properties are set on
    host: HTMLElement;
    slots: RuleSlots;
    //the slot the group's rules go in
    index: number;
    //transforms static text (rewrites :host in light DOM)
    literal: (text: string) => string;
    //wraps each generated rule (the light-DOM instance prefix)
    wrap: (text: string) => string;
}

/**
 * Rewrites var(--sui-<classId>-<n>) of the @each body's declarations to the item's own var(--sui-<classId>-<n>-<position>)
 * @param rule
 * @param position
 */
const itemVariables = (rule: EachRule, position: number): ((text: string) => string) => {
    const names = rule.body.declarations.map(({ name }) => name);
    if (!names.length) {
        return (text) => text;
    }
    const pattern = new RegExp(`var\\(--(${names.join('|')})\\)`, 'g');
    return (text) => text.replace(pattern, (_, name: string) => `var(--${name}-${position})`);
};

/**
 * Binds an @each block: its iterator is evaluated in the component scope, and every item gets a child scope with the
 * iterator locals (as repeat items do), its own custom properties (--sui-<classId>-<n>-<position> on the host) and its
 * rules (the body's static rules and dynamic rules, with var names suffixed by the position), in item order in the
 * group's slot. Any collection change rebuilds the group's items, rewrites only the group's rules that changed and
 * removes the properties of positions past the end; a change read by one item's selectors re-renders that item only.
 * Returns the function that disposes the bindings and removes the rules and properties
 * @param rule
 * @param scope
 * @param options
 */
export const bindEachRule = (rule: EachRule, scope: Scope, options: EachRuleOptions): (() => void) => {
    const { host, slots, index, literal, wrap } = options;
    //the scanner guarantees one iterator expression in the @each grammar
    const iterator = rule.iteratorParts[0] as CompiledExpression;
    const match = PATT_ITERATOR.exec(iterator.original.trim())!;
    const iteratorLocals = new Set([match[1], match[2], match[3]].filter((name): name is string => !!name));
    //the iterator's own locals are not store paths of the component scope
    const subscribed: CompiledExpression = {
        ...iterator,
        variables: iterator.variables.filter((variable) => !iteratorLocals.has(variable.split(/[.[]/)[0])),
    };
    const collection = match[4].toLowerCase() === 'in' ? match[5].trim() : undefined;
    const filtered = match[8] !== undefined;
    const ruleExpressionKey = changeKey(rule.body.dynamicRules.flatMap(ruleExpressions));

    let items: EachItem[] = [];
    let building = false;

    const publish = () => slots.set(index, items.flatMap((item) => item.texts));

    const resolveCollectionPath = () => {
        if (collection === undefined) {
            return undefined;
        }
        const classified = classifyVariable(collection, scope);
        return classified?.kind === 'store' ? classified.path : undefined;
    };

    const renderItem = (itemScope: Scope, position: number): Array<string | null> => {
        const variables = itemVariables(rule, position);
        const itemLiteral = (text: string) => variables(literal(text));
        const texts = [
            ...topLevelItems(rule.body.staticCss).map(itemLiteral),
            ...rule.body.dynamicRules.map((child) => renderDynamicRule(child, itemScope, itemLiteral) ?? null),
        ];
        return texts.map((text) => text === null ? null : wrap(rule.ancestors.reduceRight((inner, ancestor) => `${literal(ancestor)}{${inner}}`, text)));
    };

    const createItem = (itemScope: Scope, position: number): EachItem => {
        const item: EachItem = { texts: [], bindings: [] };
        for (const { name, parts } of rule.body.declarations) {
            const property = `--${name}-${position}`;
            const binding = createBinding({
                scope: itemScope,
                expressions: parts,
                kind: PROPERTY_KIND,
                nodePath: [index, position],
                apply: (value) => applyProperty(host, property, value),
            });
            binding.update();
            item.bindings.push(binding);
        }
        const binding = createBinding({
            scope: itemScope,
            expressions: ruleExpressionKey,
            kind: ITEM_KIND,
            nodePath: [index, position],
            apply: () => {
                item.texts = renderItem(itemScope, position);
                if (!building) {
                    publish();
                }
            },
        });
        binding.update();
        item.bindings.push(binding);
        return item;
    };

    const disposeItems = () => {
        for (const item of items) {
            item.bindings.forEach((binding) => binding.dispose());
        }
    };

    const removeProperties = (from: number, to: number) => {
        for (let position = from; position < to; position++) {
            for (const { name } of rule.body.declarations) {
                host.style.removeProperty(`--${name}-${position}`);
            }
        }
    };

    const rebuild = (value: unknown) => {
        const evaluated = isIterator(value) ? value : undefined;
        const collectionPath = resolveCollectionPath();
        const previous = items.length;
        disposeItems();
        building = true;
        items = (evaluated?.keys ?? []).map((key, position) => {
            const itemValue = evaluated!.collection[key];
            const path = getItemPath(itemValue, key, collectionPath, filtered);
            const { lookup } = evaluated!;
            const locals: Record<string, LocalEntry> = { [lookup.key]: { value: key } };
            if (lookup.index) {
                locals[lookup.index] = { value: position };
            }
            if (lookup.value) {
                locals[lookup.value] = path !== undefined ? { path } : { value: itemValue };
            }
            return createItem(scope.child(locals, path !== undefined ? { ancestorFloor: path } : {}), position);
        });
        building = false;
        removeProperties(items.length, previous);
        publish();
    };

    const binding = createBinding({ scope, expressions: [subscribed], kind: EACH_KIND, nodePath: [index], apply: rebuild });
    binding.update();

    return () => {
        binding.dispose();
        disposeItems();
        removeProperties(0, items.length);
        items = [];
        slots.set(index, []);
    };
};

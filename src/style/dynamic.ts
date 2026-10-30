import { createBinding, type Binding } from '../binding/Binding.js';
import type { Scope } from '../scope/Scope.js';
import { bindEachRule } from './each.js';
import { rewriteHost, styleContainer } from './light.js';
import { changeKey, renderDynamicRule, ruleExpressions } from './render.js';
import { sheetSlots, styleSlots, type RuleSlots } from './slots.js';
import type { DynamicRule, StyleProgram } from './types.js';

export { renderDynamicRule } from './render.js';

const DYNAMIC_KIND = 'style-rule';

let instanceCounter = 0;

interface RuleTransforms {
    //transforms static text (rewrites :host in light DOM)
    literal: (text: string) => string;
    //wraps each rule (the light-DOM instance prefix)
    wrap: (text: string) => string;
}

const identity = (text: string) => text;

/**
 * Binds every dynamic rule of the program to its own slot (a write to any variable of a rule's selector or prelude,
 * or a nested one, rebuilds that rule only), then every @each group to the slots after them. Returns the function
 * that disposes them all
 */
const bindRules = (program: StyleProgram, scope: Scope, host: HTMLElement, slots: RuleSlots, transforms: RuleTransforms): (() => void) => {
    const { literal, wrap } = transforms;
    const render = (rule: DynamicRule) => {
        const text = renderDynamicRule(rule, scope, literal);
        return text === undefined ? [] : [wrap(text)];
    };
    const bindings: Binding[] = program.dynamicRules.map((rule, index) => {
        const binding = createBinding({
            scope,
            expressions: changeKey(ruleExpressions(rule)),
            kind: DYNAMIC_KIND,
            nodePath: [index],
            apply: () => slots.set(index, render(rule)),
        });
        binding.update();
        return binding;
    });
    const offset = program.dynamicRules.length;
    const disposeEach = program.eachRules.map((rule, position) => bindEachRule(rule, scope, { host, slots, index: offset + position, literal, wrap }));

    return () => {
        bindings.forEach((binding) => binding.dispose());
        disposeEach.forEach((dispose) => dispose());
    };
};

const slotCount = (program: StyleProgram) => program.dynamicRules.length + program.eachRules.length;

/**
 * Renders a shadow component's dynamic rules and @each groups into its own sheet, adopted after the shared sheet
 * (or, without constructable sheets, a second <style> appended to the shadow root). Returns the function that
 * disposes the bindings and removes the sheet and the item properties; a program without either adds nothing
 * @param root
 * @param program
 * @param scope
 */
export const attachShadowDynamicRules = (root: ShadowRoot, program: StyleProgram, scope: Scope): (() => void) => {
    const count = slotCount(program);
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

    const dispose = bindRules(program, scope, root.host as HTMLElement, slots, { literal: identity, wrap: identity });
    return () => {
        dispose();
        remove();
    };
};

/**
 * Renders a light-DOM component's dynamic rules and @each groups into a <style> of its own (in document.head or its
 * shadow root), each nested in [data-sui="<instanceId>"] with :host rewritten to &; data-sui is set on the element.
 * Returns the function that disposes the bindings and removes the <style>, the attribute and the item properties
 * @param element
 * @param program
 * @param scope
 */
export const attachLightDynamicRules = (element: HTMLElement, program: StyleProgram, scope: Scope): (() => void) => {
    const count = slotCount(program);
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
    const dispose = bindRules(program, scope, element, slots, { literal: rewriteHost, wrap: (text) => `${prefix}{${text}}` });
    return () => {
        dispose();
        style.remove();
        if (element.getAttribute('data-sui') === instanceId) {
            element.removeAttribute('data-sui');
        }
    };
};

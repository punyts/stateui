import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import { TemplateCompileError } from '../errors.js';
import type { Scope } from '../scope/Scope.js';
import { classifyVariable } from '../scope/variables.js';
import { tokenize } from '../template/tokenize.js';
import { createBinding, type Binding } from './Binding.js';
import type { CompileContext, PlanEntry } from './types.js';

export const BIND_KIND = 'bind';
export const BIND_ATTRIBUTE = 'bind';

type BindProperty = 'value' | 'checked' | 'valueAsNumber';
const BIND_PROPERTIES: ReadonlySet<string> = new Set<BindProperty>(['value', 'checked', 'valueAsNumber']);
const WRITE_BACK_EVENTS = Object.freeze(['input', 'change']);

/**
 * Compiles bind="<prop>": prop must be value, checked or valueAsNumber, and the element must have a sibling <prop>
 * attribute holding a single {{ }} that is a pure store path ({{ $.name }}, {{ $v.name }}). The entry claims that
 * sibling, so the generic attribute binding never writes it; this binding owns both directions
 * @param context
 */
export const compileBind = (context: CompileContext): PlanEntry => {
    const { attr, attributes, nodePath } = context;
    const property = attr!.value.trim();
    if (!BIND_PROPERTIES.has(property)) {
        throw new TemplateCompileError(`bind="${attr!.value}" must be value, checked or valueAsNumber`, { nodePath });
    }

    const sibling = attributes.find(({ name }) => name === property);
    const tokens = sibling ? tokenize(sibling.value) : undefined;
    const compiled = tokens?.isSingleExpression ? tokens.parts[0] as CompiledExpression : undefined;
    if (!compiled || compiled.variables.length !== 1 || compiled.original.trim() !== compiled.variables[0]) {
        throw new TemplateCompileError(
            `bind="${property}" needs a sibling ${property}="{{ path }}" holding a single store path (found ${sibling ? `"${sibling.value}"` : 'none'})`,
            { nodePath }
        );
    }

    return {
        nodePath,
        kind: BIND_KIND,
        parts: [compiled],
        attrName: BIND_ATTRIBUTE,
        property,
        variable: compiled.variables[0],
        claims: [property],
    };
};

/**
 * Converts a state value to what the DOM property holds, so the Object.is guard compares like with like
 * @param property
 * @param value
 */
const toPropertyValue = (property: BindProperty, value: unknown) => {
    if (property === 'checked') {
        return Boolean(value);
    }
    if (property === 'valueAsNumber') {
        return value === null || value === undefined ? NaN : Number(value);
    }
    return value === null || value === undefined ? '' : String(value);
};

/**
 * Two-way binding. State to DOM writes element[prop] only when !Object.is(element[prop], next), so typing never
 * rewrites the field and an empty number field (NaN, which the store re-emits because NaN !== NaN) can't loop.
 * DOM to state listens to input and change and calls store.set on the variable's absolute store path, resolved at
 * event time so a rebound repeat item writes to its current item; a failed set (missing parent) is reported
 * @param node
 * @param entry
 * @param scope
 * @throws TemplateCompileError when the variable is a local without a store path
 */
export const attachBind = (node: Node, entry: PlanEntry, scope: Scope): Binding => {
    const element = node as unknown as Record<string, unknown> & Element;
    const property = entry.property as BindProperty;
    const variable = entry.variable as string;

    const resolvePath = () => {
        const classified = classifyVariable(variable, scope);
        return classified?.kind === 'store' ? classified.path : undefined;
    };
    if (!resolvePath()) {
        throw new TemplateCompileError(`bind="${property}" needs a store path, but "${variable}" is a local without one`, { nodePath: entry.nodePath });
    }

    const writeBack = () => {
        const path = resolvePath();
        const written = path !== undefined && scope.store.set<string | number | boolean>(path, element[property] as string | number | boolean);
        if (!written) {
            report.error(`[bind binding at node path ${JSON.stringify(entry.nodePath)}] could not write ${property} to ${path ?? variable}`, {
                kind: entry.kind,
                nodePath: entry.nodePath,
                path,
            });
        }
    };

    const binding = createBinding({
        scope,
        expressions: entry.parts,
        kind: entry.kind,
        nodePath: entry.nodePath,
        apply: (value) => {
            const next = toPropertyValue(property, value);
            if (!Object.is(element[property], next)) {
                element[property] = next;
            }
        },
    });
    for (const type of WRITE_BACK_EVENTS) {
        element.addEventListener(type, writeBack);
    }

    return {
        get disposed() {
            return binding.disposed;
        },
        update: () => binding.update(),
        rebind: () => binding.rebind(),
        dispose: () => {
            if (binding.disposed) {
                return;
            }
            binding.dispose();
            for (const type of WRITE_BACK_EVENTS) {
                element.removeEventListener(type, writeBack);
            }
        },
    };
};

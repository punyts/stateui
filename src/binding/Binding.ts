import { report } from '@punyts/core';
import type { CompiledExpression } from '@punyts/expression';
import type { Scope, Subscription } from '../scope/Scope.js';
import type { TokenPart } from '../template/tokenize.js';

/**
 * What a binding evaluates: one compiled expression, or tokenize() parts. A parts array with a single expression
 * yields that expression's raw value; mixed parts are joined into a string (null and undefined become "")
 */
export type BindingExpressions = CompiledExpression | TokenPart[];

export interface BindingOptions<T = unknown> {
    scope: Scope;
    expressions: BindingExpressions;
    //writes the value to the DOM; called only when the value differs (Object.is) from the last one applied
    apply: (value: T) => void;
    //the binding kind (text, attribute, event, ...) and the node's childNodes path, for error reports
    kind: string;
    nodePath: number[];
}

export interface Binding {
    readonly disposed: boolean;
    //evaluates and applies when the value changed; never throws (errors are reported)
    update(): void;
    //unsubscribes and unregisters from the scope; safe to call more than once
    dispose(): void;
    //re-subscribes against the scope's current locals and updates once
    rebind(): void;
}

const isCompiledExpression = (value: BindingExpressions): value is CompiledExpression => !Array.isArray(value);

/**
 * Returns the variables every expression of the binding depends on
 * @param expressions
 */
const getVariables = (expressions: BindingExpressions) => {
    if (isCompiledExpression(expressions)) {
        return expressions.variables;
    }
    return expressions.flatMap((part) => typeof part === 'string' ? [] : part.variables);
};

/**
 * Evaluates the binding's expressions against the scope
 * @param scope
 * @param expressions
 */
const evaluate = (scope: Scope, expressions: BindingExpressions): unknown => {
    if (isCompiledExpression(expressions)) {
        return scope.evaluate(expressions);
    }
    if (expressions.length === 1 && typeof expressions[0] !== 'string') {
        return scope.evaluate(expressions[0]);
    }
    return expressions
        .map((part) => {
            if (typeof part === 'string') {
                return part;
            }
            const value = scope.evaluate(part);
            return value === null || value === undefined ? '' : String(value);
        })
        .join('');
};

/**
 * Creates the base behaviour every binding kind shares: it subscribes to the expressions' store paths through the
 * scope, re-evaluates synchronously on each emit, skips apply when the value is unchanged, and isolates errors so one
 * failing binding never stops the others in the same emit. It does not apply on creation; the attaching code calls
 * update() for the first render
 * @param options
 */
export const createBinding = <T = unknown>(options: BindingOptions<T>): Binding => {
    const { scope, expressions, apply, kind, nodePath } = options;
    const variables = getVariables(expressions);
    const label = `[${kind} binding at node path ${JSON.stringify(nodePath)}]`;

    let disposed = false;
    let hasApplied = false;
    let lastApplied: unknown;

    const update = () => {
        if (disposed) {
            return;
        }

        let value: unknown;
        try {
            value = evaluate(scope, expressions);
        }
        catch (error) {
            report.error(`${label} expression failed: ${error instanceof Error ? error.message : String(error)}`, { kind, nodePath, error });
            return;
        }

        if (hasApplied && Object.is(value, lastApplied)) {
            return;
        }

        try {
            apply(value as T);
        }
        catch (error) {
            report.error(`${label} apply failed: ${error instanceof Error ? error.message : String(error)}`, { kind, nodePath, error });
            return;
        }
        hasApplied = true;
        lastApplied = value;
    };

    //the disposed check comes first: a binding disposed earlier in the same emit is still in the emit's snapshot
    const subscription: Subscription = scope.subscribe(variables, () => {
        if (disposed) {
            return;
        }
        update();
    });

    const binding: Binding = {
        get disposed() {
            return disposed;
        },
        update,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            subscription.dispose();
            scope.unregisterBinding(binding);
        },
        rebind: () => {
            if (disposed) {
                return;
            }
            subscription.resubscribe(variables);
            update();
        },
    };

    scope.registerBinding(binding);
    return binding;
};

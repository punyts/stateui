import Expression from '@punyts/expression';
import type { CompiledExpression } from '@punyts/expression';
import { TemplateCompileError } from '../errors.js';

export type TokenPart = string | CompiledExpression;

export interface TokenizeResult {
    parts: TokenPart[];
    //true only when the whole value is exactly one {{ }} with nothing around it, not even whitespace
    isSingleExpression: boolean;
    hasExpressions: boolean;
}

/**
 * Compiled expressions by trimmed expression text. Unbounded on purpose: it only fills at template compile time
 * (once per component class), never per update
 */
const expressionCache: Map<string, CompiledExpression> = new Map();

const QUOTES: ReadonlySet<string> = new Set(["'", '"', '`']);

/**
 * Compiles a trimmed expression once and returns the cached result afterwards
 * @param expression
 * @param value - the whole text or attribute value, for error messages
 */
const compile = (expression: string, value: string): CompiledExpression => {
    const cached = expressionCache.get(expression);
    if (cached) {
        return cached;
    }

    let compiled: CompiledExpression;
    try {
        compiled = Expression(expression);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TemplateCompileError(
            `Invalid expression "${expression}" in "${value}": ${reason}`,
            { cause: error }
        );
    }
    expressionCache.set(expression, compiled);
    return compiled;
};

/**
 * Splits a text or attribute value into literal strings and compiled {{ }} expressions.
 *
 * Inside an expression the first }} outside a '...', "..." or `...` string literal closes it, so a }} that would
 * close an object literal must be written with a space: {{ {a:1} }}, not {{ {a:1}}}. The unspaced form leaves an
 * unbalanced { in the expression and throws.
 * @param value - an entity-decoded text or attribute value (so &lt; has already become <)
 * @throws TemplateCompileError for unbalanced {{ or }}, an empty {{ }}, or an expression the parser rejects
 */
export const tokenize = (value: string): TokenizeResult => {
    const parts: TokenPart[] = [];
    let literal = '';
    let index = 0;

    const pushLiteral = () => {
        if (literal) {
            parts.push(literal);
            literal = '';
        }
    };

    while (index < value.length) {
        const pair = value.slice(index, index + 2);

        if (pair === '}}') {
            throw new TemplateCompileError(`Unbalanced "}}" in "${value}": there is no "{{" to close`);
        }

        if (pair !== '{{') {
            literal += value[index];
            index++;
            continue;
        }

        //scan the expression body after the opening {{
        const start = index + 2;
        let cursor = start;
        let quote: string | null = null;
        let braceDepth = 0;
        let end = -1;

        while (cursor < value.length) {
            const char = value[cursor];

            if (quote) {
                if (char === '\\') {
                    cursor += 2;
                    continue;
                }
                if (char === quote) {
                    quote = null;
                }
                cursor++;
                continue;
            }

            if (QUOTES.has(char)) {
                quote = char;
                cursor++;
                continue;
            }

            const next = value.slice(cursor, cursor + 2);
            if (next === '}}') {
                end = cursor;
                break;
            }
            if (next === '{{') {
                throw new TemplateCompileError(`Unbalanced "{{" in "${value}": an expression cannot contain "{{"`);
            }
            if (char === '{') {
                braceDepth++;
            }
            else if (char === '}') {
                braceDepth--;
            }
            cursor++;
        }

        if (end === -1) {
            throw new TemplateCompileError(`Unbalanced "{{" in "${value}": the expression is never closed with "}}"`);
        }

        const expression = value.slice(start, end).trim();
        if (braceDepth !== 0) {
            throw new TemplateCompileError(
                `Unbalanced brace in expression "${expression}" in "${value}": `
                + 'write a "}}" that closes an object literal as "} }", e.g. {{ {a:1} }}'
            );
        }
        if (!expression) {
            throw new TemplateCompileError(`Empty expression "{{ }}" in "${value}"`);
        }

        pushLiteral();
        parts.push(compile(expression, value));
        index = end + 2;
    }

    pushLiteral();

    //a literal-only value (including "") is always exactly one string part
    if (parts.length === 0) {
        parts.push(value);
    }

    const hasExpressions = parts.some((part) => typeof part !== 'string');
    return {
        parts,
        isSingleExpression: parts.length === 1 && hasExpressions,
        hasExpressions,
    };
};

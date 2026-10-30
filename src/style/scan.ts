import { StyleCompileError } from '../errors.js';
import { tokenize, type TokenPart } from '../template/tokenize.js';
import type { DeclarationBinding, StyleProgram } from './types.js';

/**
 * Nested CSS scanner. Splits component styles into static CSS and one custom-property binding per declaration whose
 * value contains {{ }}; never touches the DOM.
 *
 * - The scanner understands strings, comments, parentheses, { } nesting, ;, at-rules with and without blocks and
 *   native nesting (declarations and nested rules interleaved, &). Comments are dropped from the output.
 * - A {{ }} is one token: its braces never open or close a CSS block, and its first }} outside a quoted string closes
 *   it (as in templates).
 * - {{ inside a CSS string literal is still an expression: content: "{{ $.label }}" binds the label, quotes included.
 * - {{ }} is never allowed in a property name, a comment, or anywhere in @keyframes, @font-face, @import, @charset and
 *   @namespace. Selectors and at-rule preludes with {{ }} and @each are not supported until Story 1b.
 */

const PATT_IMPORTANT = /\s*!\s*important\s*$/i;
const PATT_AT_RULE = /^@(-?[A-Za-z][-\w]*)/;
const PATT_VENDOR = /^-[a-z]+-/;
//at-rules whose prelude and body never accept {{ }}
const NO_EXPRESSIONS: ReadonlySet<string> = new Set(['keyframes', 'font-face', 'import', 'charset', 'namespace']);
const UNTIL_1B = 'not supported until Story 1b';

type Terminator = '{' | ';' | '}' | '';

interface Chunk {
    //the source text up to the terminator, comments replaced by a space
    text: string;
    //index of the first non-whitespace character, -1 when the chunk is blank
    contentAt: number;
    //index of the first {{, -1 when there is none
    expressionAt: number;
    //index just after the terminator
    end: number;
    terminator: Terminator;
}

/**
 * Index just after the }} that closes the {{ at start: the first }} outside a quoted string
 * @param text
 * @param start - index of the {{
 * @returns -1 when the expression is never closed
 */
const expressionEnd = (text: string, start: number): number => {
    let quote: string | null = null;
    for (let cursor = start + 2; cursor < text.length; cursor++) {
        const char = text[cursor];
        if (quote) {
            if (char === '\\') {
                cursor++;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
        }
        else if (char === '}' && text[cursor + 1] === '}') {
            return cursor + 2;
        }
    }
    return -1;
};

/**
 * Index of the first : outside {{ }} and strings, -1 when there is none
 * @param text
 */
const declarationColon = (text: string): number => {
    let quote: string | null = null;
    for (let cursor = 0; cursor < text.length; cursor++) {
        const char = text[cursor];
        if (quote) {
            if (char === '\\') {
                cursor++;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '{' && text[cursor + 1] === '{') {
            cursor = expressionEnd(text, cursor) - 1;
            if (cursor < 0) {
                return -1;
            }
        }
        else if (char === "'" || char === '"') {
            quote = char;
        }
        else if (char === ':') {
            return cursor;
        }
    }
    return -1;
};

/**
 * Splits component CSS into static CSS and declaration bindings
 * @param css - the component's styles option
 * @param classId - the per-class id allocated by defineComponent (c<N>), used in custom-property names
 * @throws StyleCompileError, with the 1-based line, for {{ }} where it is not allowed and for anything unbalanced
 */
export const scanStyles = (css: string, classId: string): StyleProgram => {
    const declarations: DeclarationBinding[] = [];
    let position = 0;

    const lineAt = (index: number) => css.slice(0, Math.max(0, index)).split('\n').length;
    const fail = (message: string, index: number, cause?: unknown): never => {
        throw new StyleCompileError(message, { line: lineAt(index), cause });
    };

    const skipExpression = (start: number) => {
        const end = expressionEnd(css, start);
        return end === -1 ? fail('Unbalanced "{{": the expression is never closed with "}}"', start) : end;
    };

    /**
     * Reads up to the next {, ; or } outside strings, comments, parentheses and {{ }}
     */
    const readChunk = (): Chunk => {
        let text = '';
        let contentAt = -1;
        let expressionAt = -1;
        let parens = 0;
        let parenAt = -1;

        const append = (value: string, at: number) => {
            if (contentAt === -1 && value.trim()) {
                contentAt = at;
            }
            text += value;
        };

        while (position < css.length) {
            const char = css[position];

            if (char === '/' && css[position + 1] === '*') {
                const close = css.indexOf('*/', position + 2);
                if (close === -1) {
                    fail('Unclosed comment: "/*" is never closed with "*/"', position);
                }
                const inner = css.indexOf('{{', position + 2);
                if (inner !== -1 && inner < close) {
                    fail('{{ }} is not allowed in a comment', inner);
                }
                text += ' ';
                position = close + 2;
                continue;
            }

            if (char === '"' || char === "'") {
                let cursor = position + 1;
                while (cursor < css.length && css[cursor] !== char) {
                    if (css[cursor] === '\\') {
                        cursor += 2;
                        continue;
                    }
                    if (css[cursor] === '\n') {
                        fail(`Unclosed string: ${char} is never closed`, position);
                    }
                    if (css.startsWith('{{', cursor)) {
                        expressionAt = expressionAt === -1 ? cursor : expressionAt;
                        cursor = skipExpression(cursor);
                        continue;
                    }
                    cursor++;
                }
                if (cursor >= css.length) {
                    fail(`Unclosed string: ${char} is never closed`, position);
                }
                append(css.slice(position, cursor + 1), position);
                position = cursor + 1;
                continue;
            }

            if (css.startsWith('{{', position)) {
                expressionAt = expressionAt === -1 ? position : expressionAt;
                const end = skipExpression(position);
                append(css.slice(position, end), position);
                position = end;
                continue;
            }

            if (char === '(') {
                parenAt = parens === 0 ? position : parenAt;
                parens++;
            }
            else if (char === ')') {
                if (parens === 0) {
                    fail('Unbalanced ")": there is no "(" to close', position);
                }
                parens--;
            }
            else if (char === '{' || char === ';' || char === '}') {
                if (parens > 0 && char !== ';') {
                    fail('Unbalanced "(": it is never closed with ")"', parenAt);
                }
                if (parens === 0) {
                    position++;
                    return { text, contentAt, expressionAt, end: position, terminator: char };
                }
            }
            append(char, position);
            position++;
        }

        if (parens > 0) {
            fail('Unbalanced "(": it is never closed with ")"', parenAt);
        }
        return { text, contentAt, expressionAt, end: position, terminator: '' };
    };

    const tokenizeValue = (value: string, at: number): TokenPart[] => {
        try {
            return tokenize(value).parts;
        }
        catch (error) {
            return fail(error instanceof Error ? error.message : String(error), at, error);
        }
    };

    /**
     * Emits a declaration; a value with {{ }} becomes `<property>: var(--sui-<classId>-<n>)` plus a binding
     * @param chunk
     * @param forbidden - the enclosing at-rule that never accepts {{ }}, if any
     */
    const declaration = (chunk: Chunk, forbidden: string | null): string => {
        const source = chunk.text.trim();
        const colon = declarationColon(source);
        if (colon === -1) {
            return chunk.expressionAt === -1
                ? fail(`Expected a declaration "property: value" but found "${source}"`, chunk.contentAt)
                : fail('{{ }} is not allowed in a property name', chunk.expressionAt);
        }
        const property = source.slice(0, colon).trim();
        if (property.includes('{{')) {
            fail('{{ }} is not allowed in a property name', chunk.expressionAt);
        }
        if (chunk.expressionAt === -1) {
            return `${source};`;
        }
        if (forbidden) {
            fail(`{{ }} is not allowed in @${forbidden}`, chunk.expressionAt);
        }

        let value = source.slice(colon + 1).trim();
        const important = PATT_IMPORTANT.test(value);
        if (important) {
            value = value.replace(PATT_IMPORTANT, '');
        }
        const name = `sui-${classId}-${declarations.length}`;
        declarations.push({ name, parts: tokenizeValue(value, chunk.expressionAt), important });
        return `${property}: var(--${name})${important ? ' !important' : ''};`;
    };

    /**
     * Emits an at-rule with or without a block
     */
    const atRule = (chunk: Chunk, depth: number, forbidden: string | null): string => {
        const source = chunk.text.trim();
        const match = PATT_AT_RULE.exec(source);
        if (!match) {
            return fail(`Invalid at-rule "${source}"`, chunk.contentAt);
        }
        const name = match[1].toLowerCase();
        const base = name.replace(PATT_VENDOR, '');
        if (base === 'each') {
            fail(`@each is ${UNTIL_1B}`, chunk.contentAt);
        }
        const inner = forbidden ?? (NO_EXPRESSIONS.has(base) ? name : null);
        if (chunk.expressionAt !== -1) {
            fail(inner ? `{{ }} is not allowed in @${inner}` : `{{ }} in an at-rule prelude is ${UNTIL_1B}`, chunk.expressionAt);
        }
        if (chunk.terminator !== '{') {
            return `${source};`;
        }
        return `${source}{${block(depth + 1, inner, chunk.end - 1)}}`;
    };

    /**
     * Emits the items of one block (or the top level) up to its closing }
     * @param depth - 0 for the top level
     * @param forbidden - the enclosing at-rule that never accepts {{ }}, if any
     * @param openAt - index of the { that opened this block, for the unclosed-block error
     */
    const block = (depth: number, forbidden: string | null, openAt: number): string => {
        let output = '';
        for (;;) {
            const chunk = readChunk();
            const blank = chunk.contentAt === -1;

            if (chunk.terminator === '' || chunk.terminator === '}') {
                if (chunk.terminator === '' && depth > 0) {
                    fail('Unbalanced "{": the block is never closed with "}"', openAt);
                }
                if (chunk.terminator === '}' && depth === 0) {
                    fail('Unbalanced "}": there is no "{" to close', chunk.end - 1);
                }
                if (!blank) {
                    output += chunk.text.trim().startsWith('@') ? atRule(chunk, depth, forbidden) : declaration(chunk, forbidden);
                }
                return output;
            }

            if (chunk.terminator === ';') {
                if (!blank) {
                    output += chunk.text.trim().startsWith('@') ? atRule(chunk, depth, forbidden) : declaration(chunk, forbidden);
                }
                continue;
            }

            //a { opens a nested block: an at-rule or a rule
            if (blank) {
                fail('A block "{" needs a selector or at-rule before it', chunk.end - 1);
            }
            const source = chunk.text.trim();
            if (source.startsWith('@')) {
                output += atRule(chunk, depth, forbidden);
                continue;
            }
            if (chunk.expressionAt !== -1) {
                fail(forbidden ? `{{ }} is not allowed in @${forbidden}` : `{{ }} in a selector is ${UNTIL_1B}`, chunk.expressionAt);
            }
            output += `${source}{${block(depth + 1, forbidden, chunk.end - 1)}}`;
        }
    };

    const staticCss = block(0, null, 0);
    return { staticCss, declarations, dynamicRules: [], eachRules: [] };
};

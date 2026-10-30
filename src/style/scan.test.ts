import type { CompiledExpression } from '@punyts/expression';
import { createStore } from '@punyts/state';
import { StyleCompileError } from '../errors.js';
import { Scope } from '../scope/Scope.js';
import type { TokenPart } from '../template/tokenize.js';
import { scanStyles } from './scan.js';

//collapses whitespace and drops it around { } ; so round-trips compare structure, not formatting
const normalise = (css: string) => css.replace(/\s*([{};])\s*/g, '$1').replace(/\s+/g, ' ').trim();

const evaluateParts = (parts: ReadonlyArray<TokenPart>, state: Record<string, unknown>) => {
    const scope = new Scope(createStore<any>(state), '$');
    return parts.map((part) => typeof part === 'string' ? part : String(scope.evaluate(part as CompiledExpression))).join('');
};

const expectStyleError = (css: string, message: string | RegExp, line: number) => {
    let caught: unknown;
    try {
        scanStyles(css, 'c1');
    }
    catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(StyleCompileError);
    expect((caught as StyleCompileError).message).toMatch(message);
    expect((caught as StyleCompileError).line).toBe(line);
};

describe('scanStyles', () => {
    describe('static CSS', () => {
        it('should round-trip nested CSS without {{ }} apart from whitespace', () => {
            // Arrange
            const css = `
                :host(.x) { display: block; }
                .card {
                    color: red;
                    background: url("a;b") no-repeat;
                    &:hover { color: blue; }
                    content: "x ; y";
                    @media (min-width: 600px) {
                        & .title { font-size: calc(1rem + 2px); }
                    }
                    .nested & { margin: 0; }
                }
                @import url(theme.css);
            `;

            // Act
            const program = scanStyles(css, 'c1');

            // Assert
            expect(normalise(program.staticCss)).toBe(normalise(css));
            expect(program.declarations).toEqual([]);
            expect(program.dynamicRules).toEqual([]);
            expect(program.eachRules).toEqual([]);
        });

        it('should drop comments and keep unquoted url() with ; and static @keyframes and @font-face', () => {
            // Arrange
            const css = '/* top */ a { b: url(x;y); /* in */ } @keyframes spin { from { opacity: 0; } to { opacity: 1; } } @font-face { font-family: X; }';

            // Act
            const { staticCss } = scanStyles(css, 'c1');

            // Assert
            expect(staticCss).toBe('a{b: url(x;y);}@keyframes spin{from{opacity: 0;}to{opacity: 1;}}@font-face{font-family: X;}');
        });

        it('should treat a last declaration without ; as a declaration', () => {
            // Act / Assert
            expect(scanStyles('a { color: red }', 'c1').staticCss).toBe('a{color: red;}');
        });
    });

    describe('declaration bindings', () => {
        it('should replace a {{ }} value with var(--sui-<classId>-<n>) and record the binding', () => {
            // Act
            const program = scanStyles('.a { color: {{ $.fg }}; padding: 2px; }', 'c7');

            // Assert
            expect(program.staticCss).toBe('.a{color: var(--sui-c7-0);padding: 2px;}');
            expect(program.declarations).toHaveLength(1);
            expect(program.declarations[0].name).toBe('sui-c7-0');
            expect(program.declarations[0].important).toBe(false);
            expect(evaluateParts(program.declarations[0].parts, { fg: 'red' })).toBe('red');
        });

        it('should keep !important outside the parts', () => {
            // Act
            const program = scanStyles('.a { color: {{ $.fg }} ! IMPORTANT; }', 'c1');

            // Assert
            expect(program.staticCss).toBe('.a{color: var(--sui-c1-0) !important;}');
            expect(program.declarations[0].important).toBe(true);
            expect(evaluateParts(program.declarations[0].parts, { fg: 'red' })).toBe('red');
        });

        it('should compose several expressions and literals into one value', () => {
            // Act
            const program = scanStyles('.a { margin: {{ $.a }}px {{ $.b }}px; }', 'c1');

            // Assert
            expect(program.staticCss).toBe('.a{margin: var(--sui-c1-0);}');
            expect(program.declarations).toHaveLength(1);
            expect(program.declarations[0].parts).toHaveLength(4);
            expect(evaluateParts(program.declarations[0].parts, { a: 10, b: 20 })).toBe('10px 20px');
        });

        it('should treat {{ inside a CSS string literal as an expression, keeping the quotes as literal parts', () => {
            // Act
            const program = scanStyles('.a::before { content: "{{ $.label }}"; }', 'c1');

            // Assert
            expect(program.staticCss).toBe('.a::before{content: var(--sui-c1-0);}');
            expect(evaluateParts(program.declarations[0].parts, { label: 'hi' })).toBe('"hi"');
        });

        it('should not let braces and quotes inside {{ }} open, close or end anything', () => {
            // Act
            const program = scanStyles('.a { color: {{ $.on ? \'}\' : "{" }}; }', 'c1');

            // Assert
            expect(program.staticCss).toBe('.a{color: var(--sui-c1-0);}');
            expect(evaluateParts(program.declarations[0].parts, { on: true })).toBe('}');
        });

        it('should number declarations in source order across nested rules and at-rules', () => {
            // Arrange
            const css = `
                :host { --gap: {{ $.gap }}; }
                .a {
                    color: {{ $.c1 }};
                    & .b { color: {{ $.c2 }}; }
                    @media (min-width: 1px) { .c { color: {{ $.c3 }}; } }
                    border-color: {{ $.c4 }};
                }
            `;

            // Act
            const program = scanStyles(css, 'c3');

            // Assert
            expect(program.declarations.map(({ name }) => name)).toEqual(['sui-c3-0', 'sui-c3-1', 'sui-c3-2', 'sui-c3-3', 'sui-c3-4']);
            expect(program.declarations.map(({ parts }) => evaluateParts(parts, { gap: 0, c1: 1, c2: 2, c3: 3, c4: 4 }))).toEqual(['0', '1', '2', '3', '4']);
            expect(normalise(program.staticCss)).toBe(normalise(`
                :host{--gap: var(--sui-c3-0);}
                .a{color: var(--sui-c3-1);& .b{color: var(--sui-c3-2);}@media (min-width: 1px){.c{color: var(--sui-c3-3);}}border-color: var(--sui-c3-4);}
            `));
        });
    });

    describe('errors', () => {
        it('should reject {{ }} in a property name', () => {
            expectStyleError('a {\n  {{ $.p }}: red;\n}', /property name/, 2);
            expectStyleError('a {\n  border-{{ $.side }}: 1px;\n}', /property name/, 2);
        });

        it('should reject {{ }} in a comment', () => {
            expectStyleError('a { color: red; }\n/* {{ $.x }} */', /comment/, 2);
        });

        it('should reject {{ }} in the prelude or body of @keyframes, @font-face, @import, @charset and @namespace', () => {
            expectStyleError('@keyframes {{ $.name }} { from { opacity: 0; } }', /@keyframes/, 1);
            expectStyleError('@keyframes spin {\n  from { opacity: {{ $.o }}; }\n}', /@keyframes/, 2);
            expectStyleError('@-webkit-keyframes spin { to { left: {{ $.x }}; } }', /@-webkit-keyframes/, 1);
            expectStyleError('@font-face {\n  font-family: {{ $.f }};\n}', /@font-face/, 2);
            expectStyleError('@import url({{ $.u }});', /@import/, 1);
            expectStyleError('@charset "{{ $.c }}";', /@charset/, 1);
            expectStyleError('@namespace svg "{{ $.n }}";', /@namespace/, 1);
        });

        it('should reject anything unbalanced', () => {
            expectStyleError('a {\n  color: red;\n', /Unbalanced "\{"/, 1);
            expectStyleError('a { color: red; }\n}', /Unbalanced "\}"/, 2);
            expectStyleError('a { content: "abc; }', /Unclosed string/, 1);
            expectStyleError('a { color: red; }\n/* never closed', /Unclosed comment/, 2);
            expectStyleError('a { color: {{ $.x ; }', /Unbalanced "\{\{"/, 1);
            expectStyleError('a { b: url(x; }', /Unbalanced "\("/, 1);
            expectStyleError('a { b: x); }', /Unbalanced "\)"/, 1);
        });

        it('should report an invalid expression as a StyleCompileError with its cause', () => {
            // Act
            let caught: unknown;
            try {
                scanStyles('a {\n  color: {{ $.a + }};\n}', 'c1');
            }
            catch (error) {
                caught = error;
            }

            // Assert
            expect(caught).toBeInstanceOf(StyleCompileError);
            expect((caught as StyleCompileError).line).toBe(2);
            expect((caught as StyleCompileError).cause).toBeDefined();
        });

        it('should reject a selector or at-rule prelude with {{ }} and any @each until Story 1b', () => {
            expectStyleError('.item-{{ $.sel }} { color: red; }', /not supported until Story 1b/, 1);
            expectStyleError('a {\n  & .x-{{ $.y }} { color: red; }\n}', /not supported until Story 1b/, 2);
            expectStyleError('@media (min-width: {{ $.w }}px) { a { color: red; } }', /not supported until Story 1b/, 1);
            expectStyleError('@each {{ $k,$i,$v in $.items }} { .row { color: red; } }', /not supported until Story 1b/, 1);
        });

        it('should reject a block without a selector and text that is not a declaration', () => {
            expectStyleError('{ color: red; }', /needs a selector/, 1);
            expectStyleError('a { color; }', /Expected a declaration/, 1);
        });
    });
});

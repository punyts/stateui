import type { CompiledExpression } from '@punyts/expression';
import { TemplateCompileError } from '../errors.js';
import { tokenize } from './tokenize.js';

//wrap the real Expression in a spy so compile counts can be asserted
vi.mock('@punyts/expression', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@punyts/expression')>();
    return { default: vi.fn(actual.default) };
});

const { default: ExpressionSpy } = await import('@punyts/expression');

/**
 * Runs fn and returns the TemplateCompileError it threw, failing the test otherwise
 * @param fn
 */
const captureCompileError = (fn: () => unknown): TemplateCompileError => {
    try {
        fn();
    }
    catch (error) {
        expect(error).toBeInstanceOf(TemplateCompileError);
        return error as TemplateCompileError;
    }
    throw new Error('expected the call to throw');
};

const isCompiled = (part: unknown): part is CompiledExpression => typeof part !== 'string';

describe('tokenize', () => {
    describe('splitting', () => {
        it('should split mixed text into literal, expression, literal', () => {
            // Act
            const result = tokenize('Hello {{ $.name }}!');

            // Assert
            expect(result.parts).toHaveLength(3);
            expect(result.parts[0]).toBe('Hello ');
            expect(isCompiled(result.parts[1]) && result.parts[1].original).toBe('$.name');
            expect(result.parts[2]).toBe('!');
            expect(result.hasExpressions).toBe(true);
            expect(result.isSingleExpression).toBe(false);
        });

        it('should split adjacent expressions without empty literals between them', () => {
            // Act
            const result = tokenize('{{ $.a }}{{ $.b }}');

            // Assert
            expect(result.parts.map((part) => isCompiled(part) ? part.original : part)).toEqual(['$.a', '$.b']);
            expect(result.isSingleExpression).toBe(false);
        });

        it('should trim whitespace around the expression text', () => {
            // Act
            const result = tokenize('{{   $.trimmed.value   }}');

            // Assert
            const [part] = result.parts;
            expect(isCompiled(part) && part.original).toBe('$.trimmed.value');
            expect(result.isSingleExpression).toBe(true);
        });

        it('should return one string part and no expressions for a literal-only value', () => {
            // Act
            const result = tokenize('just text { with } braces');
            const empty = tokenize('');

            // Assert
            expect(result.parts).toEqual(['just text { with } braces']);
            expect(result.hasExpressions).toBe(false);
            expect(result.isSingleExpression).toBe(false);
            expect(empty.parts).toEqual(['']);
            expect(empty.hasExpressions).toBe(false);
        });

        it('should only flag a single expression when nothing surrounds it, not even whitespace', () => {
            // Act / Assert
            expect(tokenize('{{ $.a }}').isSingleExpression).toBe(true);
            expect(tokenize(' {{ $.a }}').isSingleExpression).toBe(false);
            expect(tokenize('{{ $.a }} ').isSingleExpression).toBe(false);
        });

        it('should compile an already entity-decoded comparison', () => {
            // Arrange: the template had $.a &lt; 3, which the DOM decodes before tokenizing
            const result = tokenize('{{ $.a < 3 }}');

            // Act
            const [part] = result.parts;
            const value = isCompiled(part) ? part.execute({ a: 2 }) : undefined;

            // Assert
            expect(value).toBe(true);
        });
    });

    describe('expression cache', () => {
        it('should compile each trimmed expression once and return the identical object', () => {
            // Arrange
            vi.mocked(ExpressionSpy).mockClear();

            // Act
            const first = tokenize('{{ $.cache.identity }}').parts[0];
            const second = tokenize('a {{    $.cache.identity }} b').parts[1];

            // Assert
            expect(second).toBe(first);
            expect(vi.mocked(ExpressionSpy).mock.calls.filter(([text]) => text === '$.cache.identity')).toHaveLength(1);
        });
    });

    describe('string literals and braces', () => {
        const quoted: Readonly<Record<string, string>> = Object.freeze({
            'single quotes': "{{ 'a}}b' }}",
            'double quotes': '{{ "a}}b" }}',
            'backticks': '{{ `a}}b` }}',
        });

        for (const [name, value] of Object.entries(quoted)) {
            it(`should ignore }} inside ${name}`, () => {
                // Act
                const [part] = tokenize(value).parts;

                // Assert
                expect(isCompiled(part) && part.execute({})).toBe('a}}b');
            });
        }

        it('should compile a spaced object literal whole', () => {
            // Act
            const result = tokenize('{{ {a:1} }}');

            // Assert
            const [part] = result.parts;
            expect(result.isSingleExpression).toBe(true);
            expect(isCompiled(part) && part.original).toBe('{a:1}');
            expect(isCompiled(part) && part.execute({})).toEqual({ a: 1 });
        });

        it('should compile a nested object literal written with "} }"', () => {
            // Act
            const [part] = tokenize('{{ {a: $.x, b: {c: 2} } }}').parts;

            // Assert
            expect(isCompiled(part) && part.execute({ x: 'y' })).toEqual({ a: 'y', b: { c: 2 } });
        });

        it('should raise the unbalanced-brace error for an unspaced object literal close', () => {
            // Act
            const error = captureCompileError(() => tokenize('{{ {a:1}}}'));

            // Assert
            expect(error.message).toContain('Unbalanced brace');
            expect(error.message).toContain('"} }"');
            expect(error.message).toContain('{{ {a:1}}}');
        });
    });

    describe('errors', () => {
        const unbalanced: Readonly<Record<string, string>> = Object.freeze({
            'an unclosed {{': 'Hello {{ $.name',
            'a stray }}': 'Hello $.name }}',
            'a {{ inside an expression': '{{ $.a {{ $.b }}',
            'an empty {{ }}': 'a {{   }} b',
        });

        for (const [name, value] of Object.entries(unbalanced)) {
            it(`should throw TemplateCompileError naming the value for ${name}`, () => {
                // Act
                const error = captureCompileError(() => tokenize(value));

                // Assert
                expect(error.message).toContain(value);
            });
        }

        it('should wrap an expression parser error with the expression text and the original error as cause', () => {
            // Act
            const error = captureCompileError(() => tokenize('Total: {{ $.a === }}'));

            // Assert
            expect(error.message).toContain('$.a ===');
            expect(error.message).toContain('Total: {{ $.a === }}');
            expect(error.cause).toBeInstanceOf(Error);
            expect((error.cause as Error).message).toContain('Invalid Expression');
        });
    });
});

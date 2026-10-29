import { TemplateCompileError, TemplateParseError } from '../errors.js';
import { PARSE_HINT, parseTemplate } from './parse.js';

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * Runs fn and returns what it threw, failing the test if it didn't throw
 * @param fn
 */
const captureError = (fn: () => unknown): unknown => {
    try {
        fn();
    }
    catch (error) {
        return error;
    }
    throw new Error('expected the call to throw');
};

describe('parseTemplate', () => {
    describe('valid templates', () => {
        it('should return the top-level elements in the XHTML namespace', () => {
            // Arrange
            const source = '<div class="a"><span>{{ $.name }}</span><input /></div>\n<p>b</p>';

            // Act
            const elements = parseTemplate(source);

            // Assert
            expect(elements.map((element) => element.localName)).toEqual(['div', 'p']);
            expect(elements.every((element) => element.namespaceURI === XHTML_NAMESPACE)).toBe(true);
            expect(Array.from(elements[0].children).map((element) => element.localName)).toEqual(['span', 'input']);
            expect(elements[0].getAttribute('class')).toBe('a');
        });

        it('should accept escaped ampersands, character references and a bare & inside a comment', () => {
            // Arrange
            const source = '<p title="{{ $.a &lt; 3 &amp;&amp; $.b }}">a&#160;b&#xA0;c<!-- a & b --></p>';

            // Act
            const [paragraph] = parseTemplate(source);

            // Assert: attribute values come back entity-decoded for the expression tokenizer
            expect(paragraph.getAttribute('title')).toBe('{{ $.a < 3 && $.b }}');
            expect(paragraph.textContent).toBe('a b c');
        });

        it('should return an empty array for an empty template', () => {
            // Act
            const elements = parseTemplate('');

            // Assert
            expect(elements).toEqual([]);
        });
    });

    describe('malformed templates', () => {
        const malformed: Readonly<Record<string, string>> = Object.freeze({
            'an unclosed tag': '<div><span>a</div>',
            'an unescaped &': '<p>a & b</p>',
            'an unescaped & in an attribute': '<p title="a && b">x</p>',
            '&nbsp;': '<p>a&nbsp;b</p>',
        });

        for (const [name, source] of Object.entries(malformed)) {
            it(`should throw TemplateParseError with the parse hint for ${name}`, () => {
                // Act
                const error = captureError(() => parseTemplate(source));

                // Assert: never the engine's message text, which differs between happy-dom and Chromium
                expect(error).toBeInstanceOf(TemplateParseError);
                expect((error as TemplateParseError).hint).toBe(PARSE_HINT);
            });
        }

        it('should report the exact position of an unescaped & relative to the caller\'s string', () => {
            // Arrange
            const source = '<div>\n  <p>a & b</p>\n</div>';

            // Act
            const error = captureError(() => parseTemplate(source)) as TemplateParseError;

            // Assert
            expect(error.line).toBe(2);
            expect(error.column).toBe(8);
            expect(error.excerpt).toBe('  <p>a & b</p>');
        });

        it('should include the offending source line as the excerpt', () => {
            // Arrange
            const source = '<div>\n<span>a</div>';

            // Act
            const error = captureError(() => parseTemplate(source)) as TemplateParseError;

            // Assert
            expect(error.line).toBe(2);
            expect(typeof error.column).toBe('number');
            expect(error.excerpt).toBe('<span>a</div>');
        });
    });

    describe('hint', () => {
        it('should mention escaping, self-closing void elements and the five XML entities', () => {
            // Assert
            expect(PARSE_HINT).toContain('&lt;');
            expect(PARSE_HINT).toContain('&amp;');
            expect(PARSE_HINT).toContain('<input />');
            expect(PARSE_HINT).toContain('five XML entities');
            expect(PARSE_HINT).toContain('&#160;');
        });
    });

    describe('forbidden elements', () => {
        const forbidden: Readonly<Record<string, string>> = Object.freeze({
            script: '<div><p><script>alert(1)</script></p></div>',
            style: '<div><style>p { color: red; }</style></div>',
        });

        for (const [name, source] of Object.entries(forbidden)) {
            it(`should throw TemplateCompileError naming <${name}> at any depth`, () => {
                // Act
                const error = captureError(() => parseTemplate(source));

                // Assert
                expect(error).toBeInstanceOf(TemplateCompileError);
                expect((error as TemplateCompileError).message).toContain(`<${name}>`);
            });
        }

        it('should record the childNodes path to the forbidden element', () => {
            // Arrange: root > div (0) > [text (0), p (1)] > script (0)
            const source = '<div> <p><script>x</script></p></div>';

            // Act
            const error = captureError(() => parseTemplate(source)) as TemplateCompileError;

            // Assert
            expect(error.nodePath).toEqual([0, 1, 0]);
        });
    });
});

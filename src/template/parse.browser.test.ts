import { TemplateParseError } from '../errors.js';
import { parseTemplate } from './parse.js';

/**
 * Runs fn and returns the TemplateParseError it threw, failing the test otherwise
 * @param fn
 */
const captureParseError = (fn: () => unknown): TemplateParseError => {
    try {
        fn();
    }
    catch (error) {
        expect(error).toBeInstanceOf(TemplateParseError);
        return error as TemplateParseError;
    }
    throw new Error('expected the call to throw');
};

describe('parseTemplate in Chromium', () => {
    it('should report line 3 and a numeric column for an unclosed element on line 3', () => {
        // Arrange
        const source = '<div>\n  <p>ok</p>\n  <span>open</div>';

        // Act
        const error = captureParseError(() => parseTemplate(source));

        // Assert
        expect(error.line).toBe(3);
        expect(typeof error.column).toBe('number');
        expect(error.excerpt).toBe('  <span>open</div>');
    });

    it('should report the line where the mismatch is detected and name the opening line in the message', () => {
        // Arrange: <span> opens on line 3 but the mismatch is only detectable at </div> on line 4
        const source = '<div>\n  <p>ok</p>\n  <span>open\n</div>';

        // Act
        const error = captureParseError(() => parseTemplate(source));

        // Assert
        expect(error.line).toBe(4);
        expect(error.excerpt).toBe('</div>');
        expect(error.message).toContain('line 3');
    });

    it('should report a first-line column relative to the caller\'s string, without the wrapper offset', () => {
        // Arrange
        const source = '<div><span>a</div>';

        // Act
        const error = captureParseError(() => parseTemplate(source));

        // Assert: the wrapper prefix is 43 characters, so an uncorrected column would exceed the source length
        expect(error.line).toBe(1);
        expect(error.column).toBeGreaterThanOrEqual(1);
        expect(error.column).toBeLessThanOrEqual(source.length + 1);
        expect(error.excerpt).toBe(source);
    });

    it('should reject &nbsp; with a parse error from the engine', () => {
        // Act
        const error = captureParseError(() => parseTemplate('<p>a&nbsp;b</p>'));

        // Assert
        expect(error.line).toBe(1);
        expect(typeof error.column).toBe('number');
    });

    it('should parse a valid template into XHTML elements', () => {
        // Act
        const elements = parseTemplate('<ul><li>a</li><li>b</li></ul><input />');

        // Assert
        expect(elements.map((element) => element.localName)).toEqual(['ul', 'input']);
        expect(elements[0].namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    });
});

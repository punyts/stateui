import { StateUIError, TemplateCompileError, TemplateParseError } from './errors.js';
import * as stateui from './index.js';

describe('errors', () => {
    it('should make TemplateParseError a StateUIError and an Error with its own name and fields', () => {
        // Act
        const error = new TemplateParseError('bad', Object.freeze({ line: 3, column: 7, excerpt: '<p>', hint: 'h' }));

        // Assert
        expect(error).toBeInstanceOf(TemplateParseError);
        expect(error).toBeInstanceOf(StateUIError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('TemplateParseError');
        expect(error.message).toBe('bad');
        expect([error.line, error.column, error.excerpt, error.hint]).toEqual([3, 7, '<p>', 'h']);
    });

    it('should make TemplateCompileError a StateUIError with optional nodePath and line', () => {
        // Act
        const withPath = new TemplateCompileError('nope', Object.freeze({ nodePath: [0, 2], line: 4 }));
        const bare = new TemplateCompileError('nope');

        // Assert
        expect(withPath).toBeInstanceOf(StateUIError);
        expect(withPath.name).toBe('TemplateCompileError');
        expect(withPath.nodePath).toEqual([0, 2]);
        expect(withPath.line).toBe(4);
        expect(bare.nodePath).toBeUndefined();
        expect(bare.line).toBeUndefined();
    });

    it('should re-export the error classes and parseTemplate from the package entry', () => {
        // Assert
        expect(stateui.StateUIError).toBe(StateUIError);
        expect(stateui.TemplateParseError).toBe(TemplateParseError);
        expect(stateui.TemplateCompileError).toBe(TemplateCompileError);
        expect(typeof stateui.parseTemplate).toBe('function');
    });
});

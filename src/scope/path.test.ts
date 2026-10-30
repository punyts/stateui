import { StateUIError } from '../errors.js';
import { normalizePath, resolveScopePath } from './path.js';

describe('normalizePath', () => {
    it('should return the root unchanged', () => {
        // Act / Assert
        expect(normalizePath('$')).toBe('$');
    });

    it('should prefix an absolute path with $.', () => {
        // Act / Assert
        expect(normalizePath('users.current')).toBe('$.users.current');
        expect(normalizePath('users')).toBe('$.users');
    });

    it('should return an already-prefixed path unchanged', () => {
        // Act / Assert
        expect(normalizePath('$.users.current')).toBe('$.users.current');
    });

    it('should throw StateUIError for an empty path', () => {
        // Act / Assert
        expect(() => normalizePath('')).toThrow(StateUIError);
    });

    const invalid = Object.freeze(['users..current', 'users.', '.users', 'has space', 'a.b.']);
    for (const path of invalid) {
        it(`should throw StateUIError naming the path for the invalid path "${path}"`, () => {
            // Act / Assert
            expect(() => normalizePath(path)).toThrow(StateUIError);
            expect(() => normalizePath(path)).toThrow(path);
        });
    }
});

describe('resolveScopePath', () => {
    const base = '$.users.current';

    it('should resolve .a as a child of the base path', () => {
        // Act / Assert
        expect(resolveScopePath(base, '.owner')).toBe('$.users.current.owner');
    });

    it('should resolve ..a as a sibling of the base path', () => {
        // Act / Assert
        expect(resolveScopePath(base, '..previous')).toBe('$.users.previous');
    });

    it('should resolve ...a two levels up', () => {
        // Act / Assert
        expect(resolveScopePath(base, '...settings')).toBe('$.settings');
    });

    it('should normalise an absolute path and ignore the base path', () => {
        // Act / Assert
        expect(resolveScopePath(base, 'settings.theme')).toBe('$.settings.theme');
        expect(resolveScopePath(base, '$.settings.theme')).toBe('$.settings.theme');
    });

    it('should resolve a relative path against an unprefixed root-level base', () => {
        // Act / Assert
        expect(resolveScopePath('$', '.users')).toBe('$.users');
    });

    it('should throw StateUIError for an invalid path', () => {
        // Act / Assert
        expect(() => resolveScopePath(base, 'has space')).toThrow(StateUIError);
        expect(() => resolveScopePath(base, '')).toThrow(StateUIError);
    });

    it('should throw StateUIError when a relative path climbs above the root', () => {
        // Act / Assert
        expect(() => resolveScopePath('$', '..up')).toThrow(StateUIError);
    });

    it('should not mutate the caller\'s values', () => {
        // Arrange
        const paths = Object.freeze(['..previous', '.owner']);
        const basePath = base;

        // Act
        const resolved = paths.map((path) => resolveScopePath(basePath, path));

        // Assert: frozen input survived, and the strings are what the caller passed
        expect(paths).toEqual(['..previous', '.owner']);
        expect(basePath).toBe('$.users.current');
        expect(resolved).toEqual(['$.users.previous', '$.users.current.owner']);
    });
});

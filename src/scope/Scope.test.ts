import { report } from '@punyts/core';
import Expression from '@punyts/expression';
import { createStore } from '@punyts/state';
import { StateUIError } from '../errors.js';
import { Scope } from './Scope.js';

const PEOPLE = Object.freeze([
    Object.freeze({ name: 'Cara', age: 3 }),
    Object.freeze({ name: 'Abe', age: 1 }),
    Object.freeze({ name: 'Bo', age: 2 }),
]);

const createPeopleStore = () => createStore<any>({
    title: 'People',
    items: JSON.parse(JSON.stringify(PEOPLE)),
    users: { current: { name: 'Jo', settings: { theme: 'dark' } } },
});

const evaluate = (scope: Scope, expression: string) => scope.evaluate(Expression(expression));

/**
 * Collects every exact path in a plain value, $.-prefixed, e.g. $.items, $.items.0, $.items.0.name
 * @param value
 * @param path
 */
const collectPaths = (value: unknown, path = '$'): string[] => {
    if (value === null || typeof value !== 'object') {
        return [path];
    }
    return [path, ...Object.keys(value).flatMap((key) => collectPaths((value as Record<string, unknown>)[key], `${path}.${key}`))];
};

describe('Scope', () => {
    describe('construction', () => {
        it('should normalise the base path to its $. form', () => {
            // Act
            const scope = new Scope(createPeopleStore(), 'users.current');

            // Assert
            expect(scope.basePath).toBe('$.users.current');
        });

        it('should reject an invalid base path', () => {
            // Act / Assert
            expect(() => new Scope(createPeopleStore(), 'has space')).toThrow(StateUIError);
        });

        it('should default the ancestor floor to the first path segment for a root scope', () => {
            // Arrange
            const store = createPeopleStore();

            // Act / Assert
            expect(new Scope(store, '$.users.current').ancestorFloor).toBe('$.users');
            expect(new Scope(store, '$.title').ancestorFloor).toBe('$.title');
            expect(new Scope(store, '$').ancestorFloor).toBe('$');
            expect(new Scope(store, '$.users', { ancestorFloor: '$.users' }).ancestorFloor).toBe('$.users');
        });

        it('should keep the parent base path and floor in a child unless overridden', () => {
            // Arrange
            const root = new Scope(createPeopleStore(), '$.users.current');

            // Act
            const inherited = root.child({ $v: { path: '$.items.0' } });
            const item = root.child({ $v: { path: '$.items.0' } }, { ancestorFloor: '$.items.0' });
            const rebased = root.child({}, { basePath: 'items' });

            // Assert
            expect(inherited.parent).toBe(root);
            expect(inherited.basePath).toBe('$.users.current');
            expect(inherited.ancestorFloor).toBe('$.users');
            expect(item.ancestorFloor).toBe('$.items.0');
            expect(rebased.basePath).toBe('$.items');
            expect(inherited.locals.get('$v')).toEqual({ path: '$.items.0' });
        });
    });

    describe('evaluate', () => {
        it('should read store-rooted variables relative to the base path', () => {
            // Arrange
            const scope = new Scope(createPeopleStore(), '$.users.current');

            // Act / Assert
            expect(evaluate(scope, '$.name')).toBe('Jo');
            expect(evaluate(scope, 'settings.theme')).toBe('dark');
            expect(evaluate(scope, "$.name +++ '!'")).toBe('Jo!');
        });

        it('should never cache a proxy: after store.replace the next evaluate sees the new object', () => {
            // Arrange
            const store = createPeopleStore();
            const scope = new Scope(store, '$.users.current');
            expect(evaluate(scope, '$.name')).toBe('Jo');

            // Act
            store.replace('$.users.current', { name: 'Max', settings: { theme: 'light' } });

            // Assert
            expect(evaluate(scope, '$.name')).toBe('Max');
            expect(evaluate(scope, '$.settings.theme')).toBe('light');
        });

        it('should evaluate store-rooted variables to undefined when the base path does not exist yet', () => {
            // Arrange
            const scope = new Scope(createPeopleStore(), '$.not.there.yet');

            // Act / Assert
            expect(() => evaluate(scope, '$.anything.deep')).not.toThrow();
            expect(evaluate(scope, '$.anything.deep')).toBeUndefined();
            expect(evaluate(scope, '$.name')).toBeUndefined();
        });

        it('should resolve locals by exact name before the store', () => {
            // Arrange
            const root = new Scope(createPeopleStore(), '$');
            const scope = root.child({ $v: { path: '$.items.1' }, $i: { value: 1 }, title: { value: 'Local title' } });

            // Act / Assert
            expect(evaluate(scope, '$v.name')).toBe('Abe');
            expect(evaluate(scope, '$i')).toBe(1);
            expect(evaluate(scope, '$.title')).toBe('Local title');
        });

        it('should re-read a local with a path from the store on every evaluation', () => {
            // Arrange
            const store = createPeopleStore();
            const scope = new Scope(store, '$').child({ $v: { path: '$.items.0' } });
            expect(evaluate(scope, '$v.name')).toBe('Cara');

            // Act
            store.set('$.items.0.name', 'Cora');

            // Assert
            expect(evaluate(scope, '$v.name')).toBe('Cora');
        });

        it('should see parent locals in a child scope and let the child shadow them', () => {
            // Arrange
            const root = new Scope(createPeopleStore(), '$', { locals: { select: { value: () => 'selected' } } });
            const outer = root.child({ $v: { path: '$.items.0' } });
            const inner = outer.child({ $v: { path: '$.items.2' } });

            // Act / Assert
            expect(evaluate(outer, '$v.name')).toBe('Cara');
            expect(evaluate(inner, '$v.name')).toBe('Bo');
            expect(evaluate(inner, '$.select()')).toBe('selected');
        });
    });

    describe('createContext', () => {
        it('should return an owned proxy that is neither the store proxy nor inherits from it', () => {
            // Arrange
            const store = createPeopleStore();
            const scope = new Scope(store, '$');

            // Act
            const context = scope.createContext();

            // Assert
            expect(context).not.toBe(store.state);
            expect(Object.getPrototypeOf(context)).toBeNull();
            expect('items' in context).toBe(true);
            expect('missing' in context).toBe(false);
        });

        it('should report and refuse a direct write, leaving state untouched', () => {
            // Arrange
            const store = createPeopleStore();
            const context = new Scope(store, '$').createContext() as Record<string, unknown>;
            const warning = vi.spyOn(report, 'warning').mockImplementation(() => undefined);

            try {
                // Act: modules run in strict mode, so a refused write throws
                const write = () => { context.title = 'Hacked'; };

                // Assert
                expect(write).toThrow(TypeError);
                expect(warning).toHaveBeenCalledWith('Expressions cannot write state', expect.objectContaining({ property: 'title' }));
                expect(store.get('$.title')).toBe('People');
            }
            finally {
                warning.mockRestore();
            }
        });

        it('should define an assignment made on an Object.create(context) child on that child', () => {
            // Arrange
            const store = createPeopleStore();
            const context = new Scope(store, '$').createContext();
            const child = Object.create(context) as Record<string, unknown>;

            // Act
            child.$v = 'local value';
            child.title = 'shadowed';

            // Assert
            expect(Object.getOwnPropertyNames(child)).toEqual(['$v', 'title']);
            expect(child.$v).toBe('local value');
            expect(child.title).toBe('shadowed');
            expect(store.get('$.title')).toBe('People');
            expect(store.get('$.$v')).toBeUndefined();
        });
    });

    describe('iterator locals never reach the store', () => {
        it('should leave state and every exact-path listener untouched when an iterator with a filter runs', () => {
            // Arrange
            const store = createPeopleStore();
            const initial = JSON.parse(JSON.stringify(store.get('$')));
            const listener = vi.fn();
            const paths = collectPaths(initial);
            store.on(paths, listener);
            const scope = new Scope(store, '$');

            // Act: evaluate, then drain the iterator, which assigns $k/$i/$v onto Object.create(context)
            const iterator = evaluate(scope, '$k,$i,$v in $.items filter $v.age > 1') as { next: () => any };
            const rows: any[] = [];
            for (let row = iterator.next(); row !== undefined; row = iterator.next()) {
                rows.push(row);
            }

            // Assert
            expect(rows.map((row) => row.$v.name)).toEqual(['Cara', 'Bo']);
            expect(JSON.parse(JSON.stringify(store.get('$')))).toEqual(initial);
            expect(listener).not.toHaveBeenCalled();
            expect(paths.length).toBeGreaterThan(10);
        });
    });
});

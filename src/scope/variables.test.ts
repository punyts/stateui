import { report } from '@punyts/core';
import Expression from '@punyts/expression';
import { createStore } from '@punyts/state';
import { Scope } from './Scope.js';
import { classifyVariable } from './variables.js';

const createScope = (basePath = '$.users.current') => new Scope(
    createStore<any>({ users: { current: { name: 'Jo' } }, items: [{ name: 'a' }] }),
    basePath
);

describe('classifyVariable', () => {
    describe('store-rooted variables', () => {
        it('should resolve $ to the base path', () => {
            // Act / Assert
            expect(classifyVariable('$', createScope())).toEqual({ kind: 'store', path: '$.users.current' });
            expect(classifyVariable('$', createScope('$'))).toEqual({ kind: 'store', path: '$' });
        });

        it('should resolve $.x.y, x.y and $x.y under the base path', () => {
            // Arrange
            const scope = createScope();

            // Act / Assert
            expect(classifyVariable('$.settings.theme', scope)).toEqual({ kind: 'store', path: '$.users.current.settings.theme' });
            expect(classifyVariable('settings.theme', scope)).toEqual({ kind: 'store', path: '$.users.current.settings.theme' });
            expect(classifyVariable('$my.variable', scope)).toEqual({ kind: 'store', path: '$.users.current.my.variable' });
        });

        it('should resolve under a root base path without a doubled prefix', () => {
            // Act / Assert
            expect(classifyVariable('$.items', createScope('$'))).toEqual({ kind: 'store', path: '$.items' });
        });

        it('should classify every variable of a compiled expression', () => {
            // Arrange
            const scope = createScope('$');
            const { variables } = Expression("$.flag ? $.a.b : $.c +++ 'x'");

            // Act
            const classes = variables.map((variable) => classifyVariable(variable, scope));

            // Assert
            expect(classes).toEqual([
                { kind: 'store', path: '$.flag' },
                { kind: 'store', path: '$.a.b' },
                { kind: 'store', path: '$.c' },
            ]);
        });
    });

    describe('locals', () => {
        it('should resolve a local with a path to that store path plus the rest of the variable', () => {
            // Arrange
            const scope = createScope('$').child({ $v: { path: '$.items.3' } });

            // Act / Assert
            expect(classifyVariable('$v.name', scope)).toEqual({ kind: 'store', path: '$.items.3.name' });
            expect(classifyVariable('$v', scope)).toEqual({ kind: 'store', path: '$.items.3' });
        });

        it('should classify a local without a path, such as a controller member, as local', () => {
            // Arrange
            const scope = createScope().child({ select: { value: () => undefined }, $i: { value: 2 } });

            // Act / Assert: $.select resolves to select after stripping $. , as the executor's lookupPath does
            expect(classifyVariable('$.select', scope)).toEqual({ kind: 'local' });
            expect(classifyVariable('select', scope)).toEqual({ kind: 'local' });
            expect(classifyVariable('$i', scope)).toEqual({ kind: 'local' });
        });

        it('should match the exact first segment before the stripped one', () => {
            // Arrange: both $v and v exist; the exact $v wins
            const scope = createScope('$').child({ $v: { path: '$.items.0' }, v: { value: 'other' } });

            // Act / Assert
            expect(classifyVariable('$v.name', scope)).toEqual({ kind: 'store', path: '$.items.0.name' });
        });

        it('should see parent locals in nested child scopes and let the nearest scope win', () => {
            // Arrange
            const root = createScope('$');
            const outer = root.child({ $v: { path: '$.lists.0' }, select: { value: () => undefined } });
            const inner = outer.child({ $v: { path: '$.lists.0.items.4' } });

            // Act / Assert
            expect(classifyVariable('$v.name', inner)).toEqual({ kind: 'store', path: '$.lists.0.items.4.name' });
            expect(classifyVariable('$v.title', outer)).toEqual({ kind: 'store', path: '$.lists.0.title' });
            expect(classifyVariable('$.select', inner)).toEqual({ kind: 'local' });
            expect(classifyVariable('$.other', inner)).toEqual({ kind: 'store', path: '$.other' });
        });
    });

    describe('dynamic variables', () => {
        it('should classify $every variables as dynamic with the resolved prefix', () => {
            // Arrange
            const scope = createScope();
            const { variables } = Expression('$.a[$.k].b');

            // Act
            const classes = variables.map((variable) => classifyVariable(variable, scope));

            // Assert
            expect(classes).toEqual([
                { kind: 'store', path: '$.users.current.k' },
                { kind: 'dynamic', prefix: '$.users.current.a' },
                { kind: 'dynamic', prefix: '$.users.current.a' },
                { kind: 'store', path: '$.users.current.a' },
            ]);
        });

        it('should resolve a local-rooted $every prefix through the local path', () => {
            // Arrange
            const scope = createScope('$').child({ $v: { path: '$.items.0' } });

            // Act / Assert
            expect(classifyVariable('$v.tags.$every', scope)).toEqual({ kind: 'dynamic', prefix: '$.items.0.tags' });
        });
    });

    describe('unclassifiable variables', () => {
        it('should report an unclassifiable variable once and return null', () => {
            // Arrange
            const scope = createScope();
            const warning = vi.spyOn(report, 'warning').mockImplementation(() => undefined);

            try {
                // Act
                const first = classifyVariable('$.has space', scope);
                const second = classifyVariable('$.has space', scope);
                const localDynamic = classifyVariable('select.$every', scope.child({ select: { value: [] } }));

                // Assert
                expect(first).toBeNull();
                expect(second).toBeNull();
                expect(localDynamic).toBeNull();
                expect(warning.mock.calls.filter(([, details]) => (details as { variable: string }).variable === '$.has space')).toHaveLength(1);
                expect(warning.mock.calls.filter(([, details]) => (details as { variable: string }).variable === 'select.$every')).toHaveLength(1);
            }
            finally {
                warning.mockRestore();
            }
        });
    });
});

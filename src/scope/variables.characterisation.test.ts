import Expression from '@punyts/expression';
import type { CompiledExpression } from '@punyts/expression';

/*
 * Characterisation of CompiledExpression.variables (@punyts/expression 1.2.0). Story 5b's classifyVariable maps these
 * strings to store subscriptions, so this test is the source of truth for their format. Recorded facts:
 * - entries are the raw, as-written strings ($.a.b, $v.age, $my.variable), not normalised
 * - iterator lookup names ($k, $i, $v) and the sort key are not included; locals used inside filter are
 * - a call includes the function path, before its arguments
 * - a bind function lists its target path before its argument locals: ($v)=>$.select gives $.select, $v
 * - a dynamic indexer yields the indexer variable, then $.a.$every.b, $.a.$every and $.a
 * - a literal indexer is folded into a dotted path ($.a['lit'].b -> $.a.lit.b)
 * - conditionals are comparisons and &&/|| chains; there is no ?: operator (it fails to compile)
 */
const CASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    '$.a.b': ['$.a.b'],
    '$.a.b +++ $.c': ['$.a.b', '$.c'],
    '$.fn($.x)': ['$.fn', '$.x'],
    '$.obj.method($.x)': ['$.obj.method', '$.x'],
    '($v)=>$.select': ['$.select', '$v'],
    '$k,$i,$v in $.items sort name filter $v.age > 1': ['$.items', '$v.age'],
    '$.a[$.k].b': ['$.k', '$.a.$every.b', '$.a.$every', '$.a'],
    "$.a['lit'].b": ['$.a.lit.b'],
    '$my.variable': ['$my.variable'],
    '$.a == $.b': ['$.a', '$.b'],
    '$.a && $.b || $.c': ['$.a', '$.b', '$.c'],
    "$.flag && 'on' || ''": ['$.flag'],
});

describe('CompiledExpression.variables (characterisation)', () => {
    for (const [source, expected] of Object.entries(CASES)) {
        it(`should list ${JSON.stringify(expected)} for ${source}`, () => {
            // Act
            const compiled: CompiledExpression = Expression(source);

            // Assert
            expect(compiled.variables).toEqual(expected);
        });
    }

    it('should not compile a ?: conditional, which the expression language lacks', () => {
        // Act / Assert: write $.a && $.b || $.c instead (falls through to $.c when $.b is falsy)
        expect(() => Expression('$.a ? $.b : $.c')).toThrow('Invalid Expression');
    });
});

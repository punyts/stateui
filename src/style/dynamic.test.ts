import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { attachShadowDynamicRules, renderDynamicRule } from './dynamic.js';
import { escapeIdent } from './escape.js';
import { rewriteHost } from './light.js';
import { scanStyles } from './scan.js';

describe('escapeIdent', () => {
    const table: ReadonlyArray<readonly [string, string]> = Object.freeze([
        ['abc', 'abc'],
        ['', ''],
        ['1a', '\\31 a'],
        ['-1', '-\\31 '],
        ['-', '\\-'],
        ['--a', '--a'],
        ['\0x', '�x'],
        ['\u0001', '\\1 '],
        ['\u007f', '\\7f '],
        ['}', '\\}'],
        ['a b', 'a\\ b'],
        ['"\'', '\\"\\\''],
        ['x{}body{display:none}', 'x\\{\\}body\\{display\\:none\\}'],
        ['é_-z9', 'é_-z9'],
    ]);

    for (const [input, expected] of table) {
        it(`should escape ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
            expect(escapeIdent(input)).toBe(expected);
        });
    }
});

describe('renderDynamicRule', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    const scopeOf = (state: Record<string, unknown>) => new Scope(createStore<any>(state), '$');

    it('should escape selector values and wrap the rule in its static ancestors', () => {
        // Arrange
        const [rule] = scanStyles('.card { @media print { & .item-{{ $.sel }} { color: {{ $.fg }}; } } }', 'c1').dynamicRules;

        // Act
        const text = renderDynamicRule(rule, scopeOf({ sel: 'x{}body{display:none}', fg: 'red' }));

        // Assert
        expect(text).toBe('.card{@media print{& .item-x\\{\\}body\\{display\\:none\\}{color: var(--sui-c1-0);}}}');
    });

    it('should interpolate safe prelude values verbatim and render nested dynamic rules', () => {
        // Arrange
        const [rule] = scanStyles('@media (min-width: {{ $.w }}px) { .a { color: red; } .b-{{ $.c }} { color: blue; } }', 'c1').dynamicRules;

        // Act
        const text = renderDynamicRule(rule, scopeOf({ w: 600, c: '1' }));

        // Assert
        expect(text).toBe('@media (min-width: 600px){.a{color: red;}.b-\\31 {color: blue;}}');
    });

    it('should skip and report a rule whose prelude value is unsafe', () => {
        // Arrange
        const [rule] = scanStyles('@media (min-width: {{ $.w }}) { .a { color: red; } }', 'c1').dynamicRules;

        // Act
        const text = renderDynamicRule(rule, scopeOf({ w: '1px), all { body' }));

        // Assert
        expect(text).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should rewrite :host in static text only when given the light-DOM literal transform', () => {
        // Arrange
        const [rule] = scanStyles(':host .x-{{ $.v }} { color: red; }', 'c1').dynamicRules;

        // Act
        const text = renderDynamicRule(rule, scopeOf({ v: ':host' }), rewriteHost);

        // Assert
        expect(text).toBe('& .x-\\:host{color: red;}');
    });

    it('should fall back to a <style> appended to the shadow root and remove it on dispose', () => {
        // Arrange
        vi.stubGlobal('CSSStyleSheet', undefined);
        const root = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
        const program = scanStyles('.item-{{ $.sel }} { color: red; }', 'c1');

        // Act
        const dispose = attachShadowDynamicRules(root, program, scopeOf({ sel: 'a' }));

        // Assert
        const style = root.querySelector('style')!;
        expect(style).not.toBeNull();
        const css = Array.from(style.sheet?.cssRules ?? [], (rule) => rule.cssText).join('') || style.textContent;
        expect(css).toContain('.item-a');
        dispose();
        expect(root.querySelector('style')).toBeNull();
    });
});

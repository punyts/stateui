import { createStore } from '@punyts/state';
import { createBinding } from '../binding/Binding.js';
import { registerBindingKind } from '../binding/registry.js';
import { Scope } from '../scope/Scope.js';
import { compileTemplate } from './compile.js';
import { instantiate } from './instantiate.js';

class UpgradeProbe extends HTMLElement {
    received: unknown;
}
customElements.define('x-upgrade-probe', UpgradeProbe);

const seenAtAttach: boolean[] = [];

//a property-binding stand-in: records whether the node was already upgraded when its binding attached
registerBindingKind('test-prop', {
    match: (attr) => attr.name === 'x-prop',
    compile: ({ nodePath, parts }) => ({ nodePath, kind: 'test-prop', parts }),
    attach: (node, entry, scope) => {
        seenAtAttach.push(node instanceof UpgradeProbe);
        return createBinding({
            scope,
            expressions: entry.parts,
            apply: (value) => { (node as UpgradeProbe).received = value; },
            kind: 'test-prop',
            nodePath: entry.nodePath,
        });
    },
});

describe('instantiate in Chromium', () => {
    it('should upgrade nested custom elements before their bindings attach', () => {
        // Arrange
        const compiled = compileTemplate('<div><x-upgrade-probe x-prop="{{ $.value }}"></x-upgrade-probe></div>');

        // Act
        const instance = instantiate(compiled, new Scope(createStore<any>({ value: 42 }), '$'));

        // Assert
        const probe = instance.fragment.querySelector('x-upgrade-probe');
        expect(seenAtAttach).toEqual([true]);
        expect(probe).toBeInstanceOf(UpgradeProbe);
        expect((probe as UpgradeProbe).received).toBe(42);
        expect(instance.fragment.isConnected).toBe(false);
    });
});

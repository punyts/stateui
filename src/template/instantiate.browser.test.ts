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

    it('should build HTML elements, keep an explicit SVG namespace and apply a static style through the CSSOM', () => {
        // Arrange
        const compiled = compileTemplate('<div style="color: rgb(255, 0, 0)"><button onclick="{{ $.press }}">Go</button><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" /></svg></div>');

        // Act
        const instance = instantiate(compiled, new Scope(createStore<any>({ press: () => undefined }), '$'));

        // Assert
        const div = instance.fragment.querySelector('div')!;
        expect(div).toBeInstanceOf(HTMLDivElement);
        expect(div.style.color).toBe('rgb(255, 0, 0)');
        expect(instance.fragment.querySelector('button')).toBeInstanceOf(HTMLButtonElement);
        expect(instance.fragment.querySelector('button')!.hasAttribute('onclick')).toBe(false);
        expect(instance.fragment.querySelector('svg')).toBeInstanceOf(SVGSVGElement);
        expect(instance.fragment.querySelector('path')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
});

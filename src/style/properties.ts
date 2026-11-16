import { createBinding, type Binding } from '../binding/Binding.js';
import type { Scope } from '../scope/Scope.js';
import type { StyleProgram } from './types.js';

const STYLE_KIND = 'style';

/**
 * Sets a custom property on the host to a bound value (null and undefined become ""); an empty value removes it
 * @param host
 * @param property - the custom property, -- included
 * @param value
 */
export const applyProperty = (host: HTMLElement, property: string, value: unknown): void => {
    const text = value === null || value === undefined ? '' : String(value);
    if (text === '') {
        host.style.removeProperty(property);
    }
    else {
        host.style.setProperty(property, text);
    }
};

/**
 * Binds every {{ }} declaration of a component's styles to a custom property on its host
 * (--sui-<classId>-<n>), set synchronously and before the caller inserts the content. The value is the parts
 * concatenated (null and undefined become ""); an empty value removes the property. Values only ever reach the
 * browser through setProperty on a custom property, so a value that is not valid CSS is rejected by the browser and
 * cannot add declarations or rules. Returns the function that disposes the bindings and removes the properties
 * @param host - the component element, in shadow and light DOM alike
 * @param program
 * @param scope
 */
export const attachStyleProperties = (host: HTMLElement, program: StyleProgram, scope: Scope): (() => void) => {
    const bindings: Binding[] = program.declarations.map(({ name, parts }) => {
        const property = `--${name}`;
        const binding = createBinding({
            scope,
            expressions: parts,
            kind: STYLE_KIND,
            nodePath: [],
            apply: (value) => applyProperty(host, property, value),
        });
        binding.update();
        return binding;
    });

    return () => {
        for (const binding of bindings) {
            binding.dispose();
        }
        for (const { name } of program.declarations) {
            host.style.removeProperty(`--${name}`);
        }
    };
};

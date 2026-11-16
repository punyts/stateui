import { createStore } from '@punyts/state';
import { Scope } from '../scope/Scope.js';
import { attachStyleProperties } from './properties.js';
import { scanStyles } from './scan.js';

describe('attachStyleProperties', () => {
    it('should set each declaration as a custom property on the host, composed from its parts', () => {
        // Arrange
        const host = document.createElement('div');
        const program = scanStyles('.a { color: {{ $.fg }}; margin: {{ $.y }}px {{ $.x }}px; }', 'c9');
        const store = createStore<any>({ fg: 'red', y: 1, x: 2 });

        // Act
        attachStyleProperties(host, program, new Scope(store, '$'));

        // Assert
        expect(host.style.getPropertyValue('--sui-c9-0')).toBe('red');
        expect(host.style.getPropertyValue('--sui-c9-1')).toBe('1px 2px');
        store.set('x', 5);
        expect(host.style.getPropertyValue('--sui-c9-1')).toBe('1px 5px');
    });

    it('should remove the property for an empty, null or undefined value', () => {
        // Arrange
        const host = document.createElement('div');
        const store = createStore<any>({ fg: 'red' });
        attachStyleProperties(host, scanStyles('.a { color: {{ $.fg }}; }', 'c9'), new Scope(store, '$'));
        const remove = vi.spyOn(host.style, 'removeProperty');

        // Act / Assert
        store.set('fg', '');
        expect(remove).toHaveBeenCalledWith('--sui-c9-0');
        expect(host.style.getPropertyValue('--sui-c9-0')).toBe('');
        store.set('fg', 'blue');
        expect(host.style.getPropertyValue('--sui-c9-0')).toBe('blue');
        store.set('fg', null);
        expect(host.style.getPropertyValue('--sui-c9-0')).toBe('');
    });

    it('should not call setProperty for an unrelated write', () => {
        // Arrange
        const host = document.createElement('div');
        const store = createStore<any>({ fg: 'red', other: 1 });
        attachStyleProperties(host, scanStyles('.a { color: {{ $.fg }}; }', 'c9'), new Scope(store, '$'));
        const set = vi.spyOn(host.style, 'setProperty');

        // Act
        store.set('other', 2);

        // Assert
        expect(set).not.toHaveBeenCalled();
    });

    it('should stop updating, remove the properties and release every listener on dispose', () => {
        // Arrange
        const host = document.createElement('div');
        const store = createStore<any>({ fg: 'red', bg: 'blue' });
        const on = vi.spyOn(store, 'on');
        const off = vi.spyOn(store, 'off');
        const dispose = attachStyleProperties(host, scanStyles('.a { color: {{ $.fg }}; background: {{ $.bg }}; }', 'c9'), new Scope(store, '$'));

        // Act
        dispose();
        store.set('fg', 'green');

        // Assert
        expect(host.style.length).toBe(0);
        expect(off.mock.calls.length).toBe(on.mock.calls.length);
    });
});

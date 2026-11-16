import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { findParentScope, mount, unmount } from './context.js';
import type { ScopeConsumer } from './types.js';
import { connectConsumer, disconnectConsumer } from './waiting.js';

//make the base report() callable as a spy while keeping its category methods (error, warning, ...)
vi.mock('@punyts/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@punyts/core')>();
    return { ...actual, report: Object.assign(vi.fn(), actual.report) };
});

const consumerFor = (element: Element) => ({
    element,
    attach: vi.fn(),
    detach: vi.fn(),
}) satisfies ScopeConsumer;

describe('mount and the waiting set (happy-dom)', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.mocked(report).mockClear();
    });

    it('should park a consumer with no context, report it once as debug (not an error) and attach it on mount', () => {
        // Arrange
        const errorSpy = vi.spyOn(report, 'error');
        const host = document.body.appendChild(document.createElement('div'));
        const consumer = consumerFor(host.appendChild(document.createElement('span')));

        // Act
        connectConsumer(consumer);
        connectConsumer(consumer);

        // Assert
        expect(consumer.attach).not.toHaveBeenCalled();
        expect(vi.mocked(report).mock.calls.filter(([category]) => category === 'stateui-waiting')).toHaveLength(1);
        expect(errorSpy).not.toHaveBeenCalled();
        mount(host, createStore<any>({}));
        expect(consumer.attach).toHaveBeenCalledTimes(1);
        disconnectConsumer(consumer);
        expect(consumer.detach).toHaveBeenCalledTimes(1);
        unmount(host);
        errorSpy.mockRestore();
    });

    it('should not add properties to the mounted element', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const before = Object.keys(host);

        // Act
        mount(host, createStore<any>({}), 'a.b');

        // Assert
        expect(Object.keys(host)).toEqual(before);
        expect(findParentScope(host.appendChild(document.createElement('i')))?.basePath).toBe('$.a.b');
        unmount(host);
    });
});

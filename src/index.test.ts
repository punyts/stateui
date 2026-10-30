import * as stateui from './index.js';
import type { ComponentOptions, ControllerContext, MountContext, ScopeConsumer, ScopeProvider, ShadowMode } from './index.js';

describe('stateui', () => {
    it('should export a version string', () => {
        // Assert
        expect(stateui.STATEUI_VERSION).toBe('0.0.0');
    });

    it('should export the public API from the package entry', () => {
        // Arrange: type-level imports; this only compiles if the names are exported
        const options: ComponentOptions = { tag: 'x-a', template: '<p>x</p>', shadow: false satisfies ShadowMode };
        const types: Array<ControllerContext | MountContext | ScopeConsumer | ScopeProvider | undefined> = [undefined];

        // Assert
        for (const name of ['defineComponent', 'mount', 'unmount', 'StateUIElement', 'StateUIError', 'TemplateParseError', 'TemplateCompileError'] as const) {
            expect(stateui[name]).toBeTypeOf('function');
        }
        expect(options.tag).toBe('x-a');
        expect(types).toHaveLength(1);
    });
});

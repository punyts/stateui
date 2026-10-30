import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, unmount } from './context.js';
import { defineComponent } from './define.js';
import type { ControllerContext } from './types.js';

let counter = 0;
const nextTag = (name: string) => `x-ctl-${name}-${++counter}`;

const createRoot = (state: Record<string, unknown>) => {
    const store = createStore<any>(state);
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    return { store, host };
};

describe('component controllers in Chromium', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    it('should give the controller its context and expose its members to bindings', () => {
        // Arrange
        const tag = nextTag('members');
        let received: ControllerContext | undefined;
        const select = vi.fn();
        defineComponent({
            tag,
            template: '<div><b>{{ $.label() }}</b><button onclick="{{ ($.title)=>$.select }}">go</button></div>',
            controller: (context) => {
                received = context;
                return { select, label: () => `label for ${(context.state as { title: string }).title}` };
            },
        });
        const { store, host } = createRoot({ title: 'T' });

        // Act
        const element = host.appendChild(document.createElement(tag));
        element.shadowRoot!.querySelector('button')!.dispatchEvent(new Event('click'));

        // Assert
        expect(received?.element).toBe(element);
        expect(received?.store).toBe(store);
        expect(received?.basePath).toBe('$');
        expect(received?.scope).toBe((element as unknown as { scope: unknown }).scope);
        expect(element.shadowRoot!.querySelector('b')!.textContent).toBe('label for T');
        expect(select).toHaveBeenCalledTimes(1);
        expect(select.mock.calls[0][0]).toBe('T');
    });

    it('should read state fresh on every access, so it stays correct after replace', () => {
        // Arrange
        const tag = nextTag('fresh');
        let context: ControllerContext | undefined;
        defineComponent({ tag, template: '<p>x</p>', controller: (ctx) => { context = ctx; } });
        const { store, host } = createRoot({ user: { name: 'a' } });
        host.appendChild(document.createElement(tag));

        // Act
        store.replace('$.user', { name: 'b' });

        // Assert
        expect((context!.state as { user: { name: string } }).user.name).toBe('b');
    });

    it('should call dispose exactly once per attach across reconnects', () => {
        // Arrange
        const tag = nextTag('dispose');
        const dispose = vi.fn();
        defineComponent({ tag, template: '<p>x</p>', controller: () => ({ dispose }) });
        const { host } = createRoot({});

        // Act
        const element = host.appendChild(document.createElement(tag));
        element.remove();
        host.appendChild(element);
        element.remove();

        // Assert
        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('should report a throwing controller, render nothing for it and leave siblings rendering', () => {
        // Arrange
        const broken = nextTag('broken');
        const healthy = nextTag('healthy');
        defineComponent({ tag: broken, template: '<p>{{ $.v }}</p>', controller: () => { throw new Error('controller boom'); } });
        defineComponent({ tag: healthy, template: '<p>{{ $.v }}</p>' });
        const { host } = createRoot({ v: 'ok' });

        // Act
        const brokenElement = host.appendChild(document.createElement(broken));
        const healthyElement = host.appendChild(document.createElement(healthy));

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('controller boom');
        expect(brokenElement.shadowRoot?.childNodes.length ?? 0).toBe(0);
        expect(healthyElement.shadowRoot!.textContent).toBe('ok');
    });

    it('should report a member that shadows a state path', () => {
        // Arrange
        const tag = nextTag('shadowing');
        defineComponent({ tag, template: '<p>{{ $.title }}</p>', controller: () => ({ title: 'from controller' }) });
        const { host } = createRoot({ title: 'from state' });

        // Act
        const element = host.appendChild(document.createElement(tag));

        // Assert
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('shadows');
        expect(element.shadowRoot!.textContent).toBe('from controller');
    });

    it('should update a hidden (display:none) component synchronously', () => {
        // Arrange
        const tag = nextTag('hidden');
        defineComponent({ tag, template: '<p>{{ $.v }}</p>' });
        const { store, host } = createRoot({ v: 1 });
        const element = host.appendChild(document.createElement(tag)) as HTMLElement;
        element.style.display = 'none';

        // Act
        store.set('v', 2);

        // Assert (no await)
        expect(element.shadowRoot!.textContent).toBe('2');
    });
});

import { createStore } from '@punyts/state';
import { mount, unmount } from '../component/context.js';
import { defineComponent } from '../component/define.js';
import { StyleCompileError } from '../errors.js';
import { adoptStyles } from './shared.js';

let counter = 0;
//a unique tag per test, since custom elements can't be redefined
const nextTag = (name: string) => `x-style-${name}-${++counter}`;

const createRoot = () => {
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, createStore<any>({ label: 'x' }));
    return host;
};

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

describe('component styles in Chromium', () => {
    afterEach(() => {
        for (const host of Array.from(document.body.children)) {
            unmount(host);
        }
        document.body.replaceChildren();
    });

    describe('shadow components', () => {
        it('should share one adopted sheet between instances and apply it, including native nesting', () => {
            // Arrange
            const tag = nextTag('shared');
            defineComponent({
                tag,
                template: '<div class="card"><p class="title">t</p></div>',
                styles: '.card { color: red; & .title { color: blue; } }',
            });
            const host = createRoot();

            // Act
            const first = host.appendChild(document.createElement(tag));
            const second = host.appendChild(document.createElement(tag));

            // Assert
            expect(first.shadowRoot!.adoptedStyleSheets).toHaveLength(1);
            expect(first.shadowRoot!.adoptedStyleSheets[0]).toBe(second.shadowRoot!.adoptedStyleSheets[0]);
            expect(getComputedStyle(first.shadowRoot!.querySelector('.card')!).color).toBe(RED);
            expect(getComputedStyle(first.shadowRoot!.querySelector('.title')!).color).toBe(BLUE);
        });

        it('should remove the sheet on detach and adopt it again on reconnect', () => {
            // Arrange
            const tag = nextTag('detach');
            defineComponent({ tag, template: '<p>x</p>', styles: 'p { color: red; }' });
            const host = createRoot();
            const element = host.appendChild(document.createElement(tag));

            // Act
            element.remove();

            // Assert
            expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(0);
            host.appendChild(element);
            expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(1);
            expect(getComputedStyle(element.shadowRoot!.querySelector('p')!).color).toBe(RED);
        });

        it('should keep existing adopted sheets when adopting and releasing', () => {
            // Arrange
            const root = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
            const existing = new CSSStyleSheet();
            root.adoptedStyleSheets = [existing];

            // Act
            const release = adoptStyles(root, { staticCss: 'p{color: red;}', declarations: [], dynamicRules: [], eachRules: [] });

            // Assert
            expect(root.adoptedStyleSheets).toHaveLength(2);
            expect(root.adoptedStyleSheets[0]).toBe(existing);
            release();
            expect(root.adoptedStyleSheets).toEqual([existing]);
        });

        it('should create no sheet and no <style> for a component without styles', () => {
            // Arrange
            const tag = nextTag('plain');
            defineComponent({ tag, template: '<p>x</p>' });
            const host = createRoot();

            // Act
            const element = host.appendChild(document.createElement(tag));

            // Assert
            expect(element.shadowRoot!.adoptedStyleSheets).toHaveLength(0);
            expect(element.shadowRoot!.querySelector('style')).toBeNull();
            expect(document.head.querySelector('style[data-sui-style]')).toBeNull();
        });

        it('should throw StyleCompileError at define time for bad styles', () => {
            // Act / Assert
            expect(() => defineComponent({ tag: nextTag('bad'), template: '<p>x</p>', styles: 'p { color: red;' })).toThrow(StyleCompileError);
        });
    });

    describe('light-DOM components', () => {
        it('should share one <style> in document.head, apply :host as & and remove it after the last instance', () => {
            // Arrange
            const tag = nextTag('light');
            defineComponent({
                tag,
                shadow: false,
                template: '<p class="text">x</p>',
                styles: ':host { display: block; color: blue; } .text { color: red; }',
            });
            const host = createRoot();

            // Act
            const elements = [1, 2, 3].map(() => host.appendChild(document.createElement(tag)));

            // Assert
            expect(document.head.querySelectorAll(`style[data-sui-style="${tag}"]`)).toHaveLength(1);
            expect(getComputedStyle(elements[0]).display).toBe('block');
            expect(getComputedStyle(elements[0]).color).toBe(BLUE);
            expect(getComputedStyle(elements[0].querySelector('.text')!).color).toBe(RED);
            elements[0].remove();
            elements[1].remove();
            expect(document.head.querySelectorAll(`style[data-sui-style="${tag}"]`)).toHaveLength(1);
            elements[2].remove();
            expect(document.head.querySelectorAll(`style[data-sui-style="${tag}"]`)).toHaveLength(0);
        });
    });
});

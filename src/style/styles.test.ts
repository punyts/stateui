import { acquireLightStyles, wrapLightCss } from './light.js';
import { adoptStyles } from './shared.js';
import type { StyleProgram } from './types.js';

const program = (staticCss: string): StyleProgram => Object.freeze({ staticCss, declarations: [], dynamicRules: [], eachRules: [] });

describe('component styles', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.head.replaceChildren();
        document.body.replaceChildren();
    });

    describe('adoptStyles fallback', () => {
        it('should prepend one <style> with the static CSS when constructable sheets are unavailable, and remove it on release', () => {
            // Arrange
            vi.stubGlobal('CSSStyleSheet', undefined);
            const root = document.createElement('div').attachShadow({ mode: 'open' });
            root.append(document.createElement('p'));

            // Act
            const release = adoptStyles(root, program('p{color: red;}'));

            // Assert
            expect(root.firstChild).toBeInstanceOf(HTMLStyleElement);
            expect(root.firstChild!.textContent).toBe('p{color: red;}');
            expect(root.querySelectorAll('style')).toHaveLength(1);
            release();
            expect(root.querySelectorAll('style')).toHaveLength(0);
            expect(root.childNodes).toHaveLength(1);
        });

        it('should add nothing for a program without static CSS', () => {
            // Arrange
            vi.stubGlobal('CSSStyleSheet', undefined);
            const root = document.createElement('div').attachShadow({ mode: 'open' });

            // Act
            adoptStyles(root, program(''));

            // Assert
            expect(root.childNodes).toHaveLength(0);
        });
    });

    describe('wrapLightCss', () => {
        it('should nest the CSS in the tag and rewrite top-level :host and :host(<sel>)', () => {
            // Act
            const css = wrapLightCss(':host{display: block;}:host(.x) .b{color: red;}.a{color: blue;}', 'x-card');

            // Assert
            expect(css).toBe('x-card{&{display: block;}&.x .b{color: red;}.a{color: blue;}}');
        });

        it('should keep top-level-only at-rules outside the wrapper and leave :host inside strings alone', () => {
            // Act
            const css = wrapLightCss(
                '@import url(a.css);@keyframes spin{to{opacity: 1;}}.a{content: ":host";}@font-face{font-family: X;}@media (min-width: 1px){:host{color: red;}}',
                'x-card'
            );

            // Assert
            expect(css).toBe(
                '@import url(a.css);@keyframes spin{to{opacity: 1;}}@font-face{font-family: X;}'
                + 'x-card{.a{content: ":host";}@media (min-width: 1px){&{color: red;}}}'
            );
        });
    });

    describe('acquireLightStyles', () => {
        it('should share one <style data-sui-style> per tag in document.head and remove it after the last release', () => {
            // Arrange
            const styles = program('.a{color: red;}');
            const elements = [1, 2, 3].map(() => document.body.appendChild(document.createElement('x-light')));

            // Act
            const releases = elements.map((element) => acquireLightStyles(element, styles));

            // Assert
            const shared = document.head.querySelectorAll('style[data-sui-style="x-light"]');
            expect(shared).toHaveLength(1);
            expect(shared[0].textContent).toBe('x-light{.a{color: red;}}');
            releases[0]();
            releases[0]();
            releases[1]();
            expect(document.head.querySelectorAll('style')).toHaveLength(1);
            releases[2]();
            expect(document.head.querySelectorAll('style')).toHaveLength(0);
        });

        it('should put the <style> in the owning shadow root, separately from the document', () => {
            // Arrange
            const styles = program('.a{color: red;}');
            const root = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
            const inShadow = root.appendChild(document.createElement('x-light'));
            const inDocument = document.body.appendChild(document.createElement('x-light'));

            // Act
            const releaseShadow = acquireLightStyles(inShadow, styles);
            acquireLightStyles(inDocument, styles);

            // Assert
            expect(root.querySelectorAll('style[data-sui-style="x-light"]')).toHaveLength(1);
            expect(document.head.querySelectorAll('style[data-sui-style="x-light"]')).toHaveLength(1);
            releaseShadow();
            expect(root.querySelectorAll('style')).toHaveLength(0);
            expect(document.head.querySelectorAll('style')).toHaveLength(1);
        });

        it('should add nothing for a program without static CSS', () => {
            // Arrange
            const element = document.body.appendChild(document.createElement('x-light'));

            // Act
            acquireLightStyles(element, program(''));

            // Assert
            expect(document.head.querySelectorAll('style')).toHaveLength(0);
        });
    });
});

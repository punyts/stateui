import type { StyleProgram } from './types.js';

//one constructed sheet per component class, created on the first attach
const sheets: WeakMap<StyleProgram, CSSStyleSheet> = new WeakMap();

/**
 * Feature test for constructable, adoptable stylesheets (never user-agent sniffing)
 * @param root
 */
const supportsAdoptedSheets = (root: ShadowRoot): boolean => typeof CSSStyleSheet === 'function'
    && typeof CSSStyleSheet.prototype.replaceSync === 'function'
    && Array.isArray((root as { adoptedStyleSheets?: unknown }).adoptedStyleSheets);

/**
 * Adds a component class's static CSS to an instance's shadow root: the class's shared sheet is appended to
 * adoptedStyleSheets (existing entries kept), or, without constructable sheets, a <style> is prepended to the root.
 * Returns the function that removes it again; a program without static CSS adds nothing
 * @param root
 * @param program
 */
export const adoptStyles = (root: ShadowRoot, program: StyleProgram): (() => void) => {
    if (!program.staticCss) {
        return () => undefined;
    }

    if (supportsAdoptedSheets(root)) {
        let sheet = sheets.get(program);
        if (!sheet) {
            sheet = new CSSStyleSheet();
            sheet.replaceSync(program.staticCss);
            sheets.set(program, sheet);
        }
        const adopted = sheet;
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, adopted];
        return () => {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter((entry) => entry !== adopted);
        };
    }

    const style = root.ownerDocument.createElement('style');
    style.textContent = program.staticCss;
    root.prepend(style);
    return () => style.remove();
};

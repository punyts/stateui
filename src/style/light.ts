import type { StyleProgram } from './types.js';

interface SharedStyle {
    style: HTMLStyleElement;
    count: number;
}

//per owning root (a document or shadow root): one counted <style> per component tag
const roots: WeakMap<Node, Map<string, SharedStyle>> = new WeakMap();
//the wrapped CSS per component class
const wrapped: WeakMap<StyleProgram, string> = new WeakMap();

//at-rules that are only valid at the top level of a sheet, so they are kept outside the <tag> { … } wrapper
const PATT_TOP_LEVEL_ONLY = /^@(-[a-z]+-)?(keyframes|font-face|import|charset|namespace|property|layer\s*[^{]*;)/i;
const PATT_STRING = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;
const PATT_HOST_FUNCTION = /:host\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const PATT_HOST = /:host(?![-\w(])/g;

/**
 * Splits CSS into its top-level rules and statements, respecting strings, parentheses and nesting
 * @param css - scanner output (comments already removed)
 */
export const topLevelItems = (css: string): string[] => {
    const items: string[] = [];
    let start = 0;
    let depth = 0;
    let parens = 0;
    let quote: string | null = null;

    for (let index = 0; index < css.length; index++) {
        const char = css[index];
        if (quote) {
            if (char === '\\') {
                index++;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
        }
        else if (char === '(') {
            parens++;
        }
        else if (char === ')') {
            parens--;
        }
        else if (char === '{' && parens === 0) {
            depth++;
        }
        else if (char === '}' && parens === 0) {
            depth--;
            if (depth === 0) {
                items.push(css.slice(start, index + 1).trim());
                start = index + 1;
            }
        }
        else if (char === ';' && depth === 0 && parens === 0) {
            items.push(css.slice(start, index + 1).trim());
            start = index + 1;
        }
    }
    const rest = css.slice(start).trim();
    if (rest) {
        items.push(rest);
    }
    return items.filter(Boolean);
};

/**
 * Rewrites :host to & and :host(<sel>) to &<sel> outside string literals
 * @param css
 */
export const rewriteHost = (css: string): string => css
    .split(PATT_STRING)
    .map((segment, index) => index % 2 === 1 ? segment : segment.replace(PATT_HOST_FUNCTION, '&$1').replace(PATT_HOST, '&'))
    .join('');

/**
 * The light-DOM form of a component's static CSS: everything nested in `<tag> { … }` (native nesting) with :host
 * rewritten to &, except the at-rules that are only valid at the top level (@keyframes, @font-face, @import, …),
 * which are kept before the wrapper unchanged
 * @param staticCss
 * @param tag
 */
export const wrapLightCss = (staticCss: string, tag: string): string => {
    const hoisted: string[] = [];
    const nested: string[] = [];
    for (const item of topLevelItems(staticCss)) {
        (PATT_TOP_LEVEL_ONLY.test(item) ? hoisted : nested).push(item);
    }
    const body = nested.length ? `${tag}{${rewriteHost(nested.join(''))}}` : '';
    return hoisted.join('') + body;
};

/**
 * Where a light-DOM element's <style> elements go: document.head for the document, its shadow root otherwise, null
 * when it is not in either
 * @param element
 */
export const styleContainer = (element: Element): ParentNode | null => {
    const root = element.getRootNode();
    const document = element.ownerDocument;
    return root === document ? document.head : root instanceof ShadowRoot ? root : null;
};

/**
 * Shares one <style data-sui-style="<tag>"> per owning root (document.head for the document, the shadow root
 * otherwise) between every light-DOM instance of a component: counted up here, and removed by the returned function
 * once the last instance in that root releases it. A program without static CSS adds nothing
 * @param element - the component host, connected
 * @param program
 */
export const acquireLightStyles = (element: Element, program: StyleProgram): (() => void) => {
    const root = element.getRootNode();
    const document = element.ownerDocument;
    const container = styleContainer(element);
    if (!program.staticCss || !container) {
        return () => undefined;
    }

    const tag = element.localName;
    let styles = roots.get(root);
    if (!styles) {
        styles = new Map();
        roots.set(root, styles);
    }
    let shared = styles.get(tag);
    if (!shared) {
        let css = wrapped.get(program);
        if (css === undefined) {
            css = wrapLightCss(program.staticCss, tag);
            wrapped.set(program, css);
        }
        const style = document.createElement('style');
        style.setAttribute('data-sui-style', tag);
        style.textContent = css;
        container.append(style);
        shared = { style, count: 0 };
        styles.set(tag, shared);
    }
    shared.count++;

    let released = false;
    const entry = shared;
    const owner = styles;
    return () => {
        if (released) {
            return;
        }
        released = true;
        entry.count--;
        if (entry.count === 0) {
            entry.style.remove();
            owner.delete(tag);
        }
    };
};

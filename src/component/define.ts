import { StateUIError } from '../errors.js';
import { compileTemplate } from '../template/compile.js';
import { StateUIElement, type ShadowMode } from './StateUIElement.js';
import type { Controller } from './types.js';

export interface ComponentOptions {
    //a valid custom element name: lowercase, starts with a letter, contains a hyphen
    tag: string;
    //an XHTML template string; compiled once here, so parse and compile errors surface at define time
    template: string;
    //'open' (default), 'closed', or false to render into the host's light DOM
    shadow?: ShadowMode;
    //runs before the template is instantiated; its members become scope locals and its dispose runs on detach
    controller?: Controller;
}

const PATT_TAG = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

/**
 * Compiles the template and registers a custom element for it
 * @param options
 * @throws StateUIError for an invalid or already-defined tag
 * @throws TemplateParseError or TemplateCompileError for a bad template
 */
export const defineComponent = (options: ComponentOptions): typeof StateUIElement => {
    const { tag, template, shadow = 'open', controller } = options;
    if (!PATT_TAG.test(tag)) {
        throw new StateUIError(`Invalid component tag "${tag}": use lowercase letters, digits, ".", "_" and at least one "-", starting with a letter`);
    }
    if (customElements.get(tag)) {
        throw new StateUIError(`A custom element named "${tag}" is already defined`);
    }

    const compiled = compileTemplate(template);
    const Component = class extends StateUIElement {
        static override compiled = compiled;
        static override shadowMode: ShadowMode = shadow;
        static override controller = controller;
    };
    customElements.define(tag, Component);
    return Component;
};

import { attachAttribute } from './attribute.js';
import { BIND_ATTRIBUTE, BIND_KIND, attachBind, compileBind } from './bind.js';
import { attachEvent } from './event.js';
import { registerBindingKind } from './registry.js';
import { IF_KIND } from '../template/chain.js';
import { attachIf } from './if.js';
import { REPEAT_KIND } from './iterator.js';
import { MIXIN_KIND, attachMixin, compileMixin, matchMixin } from './mixin.js';
import { attachRepeat } from './repeat.js';
import { attachText } from './text.js';

/*
 * Built-in kinds. compileTemplate treats them specially: text is used for split text nodes (it never matches an
 * attribute), event handles every on* attribute, and attribute is the fallback for any other attribute holding {{ }}
 * once no other registered kind matched it. Each registers its attach step here (text and attribute: E3.2, event: E3.3a)
 */
export const TEXT_KIND = 'text';
export const EVENT_KIND = 'event';
export const ATTRIBUTE_KIND = 'attribute';

const PATT_EVENT_ATTRIBUTE = /^on/i;

export const isEventAttribute = (name: string) => PATT_EVENT_ATTRIBUTE.test(name);

registerBindingKind(TEXT_KIND, {
    match: () => false,
    compile: ({ nodePath, parts }) => ({ nodePath, kind: TEXT_KIND, parts }),
    attach: attachText,
});

registerBindingKind(EVENT_KIND, {
    match: (attr) => isEventAttribute(attr.name),
    compile: ({ nodePath, parts, attr }) => ({
        nodePath,
        kind: EVENT_KIND,
        parts,
        attrName: attr!.name,
        eventName: attr!.name.slice(2),
    }),
    attach: attachEvent,
});

registerBindingKind(ATTRIBUTE_KIND, {
    match: (attr) => attr.value.includes('{{'),
    compile: ({ nodePath, parts, attr }) => ({ nodePath, kind: ATTRIBUTE_KIND, parts, attrName: attr!.name }),
    attach: attachAttribute,
});

registerBindingKind(BIND_KIND, {
    match: (attr) => attr.name === BIND_ATTRIBUTE,
    compile: compileBind,
    removeAttribute: true,
    attach: attachBind,
});

//if chains are compiled structurally by template/chain.ts (never by attribute matching); only attach is used
registerBindingKind(IF_KIND, {
    match: () => false,
    compile: ({ nodePath }) => ({ nodePath, kind: IF_KIND, parts: [] }),
    attach: attachIf,
});

//repeat is compiled structurally by binding/iterator.ts (never by attribute matching); only attach is used
registerBindingKind(REPEAT_KIND, {
    match: () => false,
    compile: ({ nodePath }) => ({ nodePath, kind: REPEAT_KIND, parts: [] }),
    attach: attachRepeat,
});

//matches attributes whose names are registered mixins when the template compiles
registerBindingKind(MIXIN_KIND, {
    match: matchMixin,
    compile: compileMixin,
    attach: attachMixin,
});

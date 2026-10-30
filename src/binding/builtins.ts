import { registerBindingKind } from './registry.js';

/*
 * Built-in kinds. compileTemplate treats them specially: text is used for split text nodes (it never matches an
 * attribute), event handles every on* attribute, and attribute is the fallback for any other attribute holding {{ }}
 * once no other registered kind matched it. Their attach steps are registered by the stories that implement them
 */
export const TEXT_KIND = 'text';
export const EVENT_KIND = 'event';
export const ATTRIBUTE_KIND = 'attribute';

const PATT_EVENT_ATTRIBUTE = /^on/i;

export const isEventAttribute = (name: string) => PATT_EVENT_ATTRIBUTE.test(name);

registerBindingKind(TEXT_KIND, {
    match: () => false,
    compile: ({ nodePath, parts }) => ({ nodePath, kind: TEXT_KIND, parts }),
});

registerBindingKind(EVENT_KIND, {
    match: (attr) => isEventAttribute(attr.name),
    compile: ({ nodePath, parts, attr }) => ({
        nodePath,
        kind: EVENT_KIND,
        parts,
        attrName: attr!.name,
        eventName: attr!.name.slice(2).toLowerCase(),
    }),
});

registerBindingKind(ATTRIBUTE_KIND, {
    match: (attr) => attr.value.includes('{{'),
    compile: ({ nodePath, parts, attr }) => ({ nodePath, kind: ATTRIBUTE_KIND, parts, attrName: attr!.name }),
});

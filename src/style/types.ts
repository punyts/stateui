import type { TokenPart } from '../template/tokenize.js';

/**
 * One declaration whose value contains {{ }}. The declaration is emitted into the static CSS as
 * `<property>: var(--<name>)` and the composed value (parts concatenated) is set on the host as that custom property
 */
export interface DeclarationBinding {
    //sui-<classId>-<n>, n counting {{ }} declarations in source order
    name: string;
    //the value without !important: literal strings and compiled expressions, composed into one value
    parts: TokenPart[];
    important: boolean;
}

/**
 * A rule or at-rule whose selector or prelude contains {{ }}; it and everything nested in it are left out of the
 * static CSS and rendered per instance. Declarations in its body are bound like any other (their bindings are in the
 * enclosing program's declarations, or the @each body's)
 */
export interface DynamicRule {
    //the static selectors and at-rule preludes enclosing the rule, outermost first, relative to the program it is in
    ancestors: string[];
    //the selector of a style rule; [] for an at-rule
    selectorParts: TokenPart[];
    //the whole header of an at-rule (@media, @supports or @container, name included); [] for a style rule
    preludeParts: TokenPart[];
    //the rule's content: static CSS plus any nested dynamic rules and @each blocks
    body: StyleProgram;
}

/**
 * An @each {{ <iterator> }} { … } block: its body is rendered once per collection item, never into the static CSS.
 * The body has its own declarations (they may read the iterator locals, so they are bound per item)
 */
export interface EachRule {
    //the static selectors and at-rule preludes enclosing the block, outermost first, relative to the program it is in
    ancestors: string[];
    //the single iterator expression, e.g. $k,$i,$v in $.items
    iteratorParts: TokenPart[];
    body: StyleProgram;
}

/**
 * The compiled form of a component's styles
 */
export interface StyleProgram {
    staticCss: string;
    declarations: DeclarationBinding[];
    dynamicRules: DynamicRule[];
    eachRules: EachRule[];
}

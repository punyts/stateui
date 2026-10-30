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
 * A rule or at-rule whose selector or prelude contains {{ }} (populated by Story 1b)
 */
export interface DynamicRule {
    selectorParts: TokenPart[];
    preludeParts: TokenPart[];
    body: StyleProgram;
}

/**
 * An @each {{ iterator }} { … } block (populated by Story 1b)
 */
export interface EachRule {
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

/**
 * Base class for every error StateUI throws, so callers can catch them all with one instanceof check
 */
export class StateUIError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
        //keep instanceof working when the class is down-levelled or extended
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface TemplateParseErrorDetails {
    line?: number;
    column?: number;
    excerpt: string;
    hint: string;
}

/**
 * The template source is not well-formed XHTML. line and column are 1-based and relative to the caller's string
 */
export class TemplateParseError extends StateUIError {
    readonly line?: number;
    readonly column?: number;
    readonly excerpt: string;
    readonly hint: string;

    constructor(message: string, details: TemplateParseErrorDetails) {
        super(message);
        this.line = details.line;
        this.column = details.column;
        this.excerpt = details.excerpt;
        this.hint = details.hint;
    }
}

export interface TemplateCompileErrorDetails {
    nodePath?: number[];
    line?: number;
    //the underlying error, e.g. from the expression parser
    cause?: unknown;
}

/**
 * The template parsed but uses something StateUI does not allow (e.g. a script or style element, or an invalid
 * {{ }} expression). nodePath is the childNodes index path from the template root to the offending node
 */
export class TemplateCompileError extends StateUIError {
    readonly nodePath?: number[];
    readonly line?: number;

    constructor(message: string, details: TemplateCompileErrorDetails = {}) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.nodePath = details.nodePath;
        this.line = details.line;
    }
}

export interface StyleCompileErrorDetails {
    //1-based line in the component's styles string
    line: number;
    //the underlying error, e.g. from the expression parser
    cause?: unknown;
}

/**
 * The component styles use {{ }} where it is never allowed (a property name, a comment, @keyframes, @font-face,
 * @import, @charset, @namespace) or are not balanced ({ }, strings, comments, parentheses, {{ }})
 */
export class StyleCompileError extends StateUIError {
    readonly line: number;

    constructor(message: string, details: StyleCompileErrorDetails) {
        super(`${message} (line ${details.line})`, details.cause === undefined ? undefined : { cause: details.cause });
        this.line = details.line;
    }
}

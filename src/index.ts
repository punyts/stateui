export const STATEUI_VERSION = "0.0.0";

export { StateUIError, TemplateParseError, TemplateCompileError } from "./errors.js";
export type { TemplateParseErrorDetails, TemplateCompileErrorDetails } from "./errors.js";
export { parseTemplate, PARSE_HINT } from "./template/parse.js";
export { tokenize } from "./template/tokenize.js";
export type { TokenPart, TokenizeResult } from "./template/tokenize.js";
export { mount, unmount, findParentScope } from "./component/context.js";
export type { MountContext, ScopeConsumer, ScopeProvider } from "./component/types.js";
export { defineComponent } from "./component/define.js";
export type { ComponentOptions } from "./component/define.js";
export { StateUIElement } from "./component/StateUIElement.js";
export type { ShadowMode } from "./component/StateUIElement.js";

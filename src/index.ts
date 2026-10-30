export const STATEUI_VERSION = "0.0.0";

export { StateUIError, TemplateParseError, TemplateCompileError, StyleCompileError } from "./errors.js";
export type { TemplateParseErrorDetails, TemplateCompileErrorDetails, StyleCompileErrorDetails } from "./errors.js";
export { parseTemplate, PARSE_HINT } from "./template/parse.js";
export { tokenize } from "./template/tokenize.js";
export type { TokenPart, TokenizeResult } from "./template/tokenize.js";
export { mount, unmount, findParentScope } from "./component/context.js";
export type { Controller, ControllerContext, ControllerResult, MountContext, ScopeConsumer, ScopeProvider } from "./component/types.js";
export { defineComponent } from "./component/define.js";
export type { ComponentOptions } from "./component/define.js";
export { StateUIElement } from "./component/StateUIElement.js";
export type { ShadowMode } from "./component/StateUIElement.js";
export { registerMixin, unregisterMixin } from "./mixin/registry.js";
export type { Disposer, Mixin } from "./mixin/registry.js";

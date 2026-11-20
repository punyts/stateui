/**
 * Maps the component name a node holds (`component`) to the custom element tag that renders it, or undefined when the
 * name is unknown. The application supplies it, so StateUI knows nothing about the component library
 */
export type NodeResolver = (name: string) => string | undefined;

/**
 * Turns a node's `theme` override into custom properties. `property` receives the path of a leaf below `theme`
 * (`['color', 'accent', 'base']`) and returns the custom property name to write (`--ui-color-accent-base`), or
 * undefined to skip the leaf; `value` receives the leaf as text and returns the CSS value to write (resolving token
 * references, for example). The application supplies it, so StateUI knows neither a prefix nor a reference syntax
 */
export interface NodeThemeMapper {
    property(path: string[]): string | undefined;
    value(text: string): string;
}

export interface NodeOptions {
    //flattens a node's `theme` into custom properties on the created element; without it `theme` is never written
    theme?: NodeThemeMapper;
    //names the node properties (camelCase) a component reflects as host attributes; without it none are written
    reflect?: (componentName: string) => string[];
}

/** What the nodes below a mounted root render with: the resolver of component names to tags, and the node options */
export interface NodeSettings {
    readonly resolver?: NodeResolver;
    readonly options: NodeOptions;
}

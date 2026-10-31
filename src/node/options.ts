/**
 * Maps the component name a node holds (`component`) to the custom element tag that renders it, or undefined when the
 * name is unknown. The application supplies it, so StateUI knows nothing about the component library
 */
export type NodeResolver = (name: string) => string | undefined;

let nodeResolver: NodeResolver | undefined;

/**
 * Registers the resolver every <sui-node> asks for a tag. A node already rendered keeps its element until its
 * `component` changes or it is re-attached; pass undefined to remove the resolver
 * @param resolver
 */
export const setNodeResolver = (resolver: NodeResolver | undefined): void => {
    nodeResolver = resolver;
};

export const getNodeResolver = (): NodeResolver | undefined => nodeResolver;

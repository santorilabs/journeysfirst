/** @type {readonly import("../agent.js").AgentAdapter[]} */
export declare const adapters: readonly import("../agent.js").AgentAdapter[];
/** @param {string | undefined} name @param {string | undefined} container */
export declare function selectAdapter(name: string | undefined, container: string | undefined): import("../agent.js").AgentAdapter | undefined;

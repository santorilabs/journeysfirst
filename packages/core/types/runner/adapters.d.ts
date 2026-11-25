/** @param {string | undefined} name @param {string | undefined} container */
export declare function selectAdapter(name: string | undefined, container: string | undefined): {
    name: string;
    setup: string;
    detect: (container?: string) => boolean;
    authProbe: () => boolean;
    sandboxArgs: ({ work, home, auth, container, hostHome, loginFile, runtime, node }: {
        work: string;
        home: string;
        auth: string;
        container?: string;
        hostHome?: string;
        loginFile?: string;
        runtime?: string;
        node: string;
    }) => string[];
    mcpConfig: (config: Record<string, string[]>, sandbox: string[], state: string, work: string, runtime: string, node: string) => {
        args: string[];
        names: string[];
    };
    start: typeof import("./codex.js").runCodex;
} | undefined;

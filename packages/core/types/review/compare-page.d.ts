export type Comparison = import("./compare.js").Comparison;
export type Links = {
    file: (name: string | undefined) => string | undefined;
    mainFile: (name: string | undefined) => string | undefined;
    run: string;
    all: string;
    shown?: Shown;
    folder?: string;
};
export type Shown = {
    journey?: {
        name?: string;
        title?: string;
    };
    promise?: string;
};
/**
 * The page for a change: every journey that ran, each with one sentence for each user.
 * @param {Comparison[]} all
 * @param {(c: Comparison) => string} url the compare page of one journey
 * @param {(c: Comparison) => Shown | undefined} [shown] the run with its journey's title, when known
 */
export declare function changePage(all: Comparison[], url: (c: Comparison) => string, shown?: (c: Comparison) => Shown | undefined): string;
/**
 * The page for one journey of a change.
 * @param {Comparison} c
 * @param {Links} links
 */
export declare function comparePage(c: Comparison, links: Links): string;

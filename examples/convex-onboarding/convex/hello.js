import { queryGeneric as query } from "convex/server";

export const first = query({
  args: {},
  handler: () => "hello from Convex",
});

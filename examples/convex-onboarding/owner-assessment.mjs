export function understandsHandoff(owner, path) {
  const text = owner.toLowerCase();
  return !/\?|\b(?:not sure|unsure|unclear|need(?:s|ing)? clarification)\b/.test(text)
    && text.includes(path.toLowerCase())
    && text.includes("hello from convex")
    && (path === "MCP" || /mcp (?:is |still )?(?:blocked|not connected)/.test(text))
    && /\b(?:no (?:login|sign-in) (?:is )?(?:needed|required)|(?:don't|do not) need to (?:log|sign) in)\b/.test(text);
}

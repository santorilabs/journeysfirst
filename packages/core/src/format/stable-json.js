/**
 * JSON with object keys sorted, so equal values always give equal text.
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => /** @type {Record<string, unknown>} */ (value)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(/** @type {Record<string, unknown>} */ (value)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

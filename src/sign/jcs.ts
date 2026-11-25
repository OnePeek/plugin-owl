// RFC 8785 (JSON Canonicalization Scheme) for the subset records use: objects, arrays, strings, booleans and safe
// integers. Floats and null are refused, exactly as the contract's canonical-form rules require.
export function canonicalize(value: unknown): string {
  if (value === null) throw new Error("null is not allowed in a record");
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("only integers in [0, 2^53-1] are allowed");
      return String(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(); // UTF-16 code unit order, as the RFC requires
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
    }
    default:
      throw new Error("unsupported value");
  }
}

export type BooleanSearchNode =
  | { type: "term"; value: string }
  | { type: "not"; child: BooleanSearchNode }
  | { type: "and" | "or"; left: BooleanSearchNode; right: BooleanSearchNode };

export function parseBooleanSearch(query: string): BooleanSearchNode | null {
  const normalisedQuery = query.replace(/[“”]/g, '"');
  const tokens = normalisedQuery.match(/"[^"]+"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) || [];
  let index = 0;
  const peek = () => tokens[index]?.toUpperCase();
  const parsePrimary = (): BooleanSearchNode | null => {
    if (peek() === "NOT") {
      index++;
      const child = parsePrimary();
      return child ? { type: "not", child } : null;
    }
    if (tokens[index] === "(") {
      index++;
      const expression = parseOr();
      if (tokens[index] === ")") index++;
      return expression;
    }
    const token = tokens[index++];
    if (!token || /^(AND|OR|NOT)$/i.test(token)) return null;
    return { type: "term", value: token.replace(/^["“”]|["“”]$/g, "").toLowerCase() };
  };
  const parseAnd = (): BooleanSearchNode | null => {
    let left = parsePrimary();
    while (left && (peek() === "AND" || (tokens[index] && tokens[index] !== ")" && peek() !== "OR"))) {
      if (peek() === "AND") index++;
      const right = parsePrimary();
      if (!right) break;
      left = { type: "and", left, right };
    }
    return left;
  };
  const parseOr = (): BooleanSearchNode | null => {
    let left = parseAnd();
    while (left && peek() === "OR") {
      index++;
      const right = parseAnd();
      if (!right) break;
      left = { type: "or", left, right };
    }
    return left;
  };
  return parseOr();
}

export function matchesBooleanSearch(query: string, text: string): boolean {
  const expression = parseBooleanSearch(query);
  if (!expression) return false;
  const haystack = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const evaluate = (node: BooleanSearchNode): boolean => {
    if (node.type === "term") {
      const term = node.value.replace(/\s+/g, " ").trim();
      return haystack.includes(term);
    }
    if (node.type === "not") return !evaluate(node.child);
    if (node.type === "and") return evaluate(node.left) && evaluate(node.right);
    return evaluate(node.left) || evaluate(node.right);
  };
  return evaluate(expression);
}

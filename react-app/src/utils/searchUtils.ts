export type BooleanSearchNode =
  | { type: "term"; value: string }
  | { type: "not"; child: BooleanSearchNode }
  | { type: "and" | "or"; left: BooleanSearchNode; right: BooleanSearchNode };

// ── Kotlin-compatible normalization & matching ────────────────────────────────
// The Kotlin app normalises both text and query the same way before matching:
//   1. NFD diacritic decomposition → strip combining marks
//   2. Replace everything except Unicode letters, digits, spaces with a space
//   3. Collapse whitespace, trim, lowercase
// This aligns the local matcher with the server's own normalisation so that
// punctuation/diacritic differences no longer silently drop valid results.

const DIACRITICS_RE = /[\u0300-\u036f]/g;
const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RE = /\s+/g;

/**
 * Normalise text exactly as the Kotlin `containsPhraseOrAllTokens` does:
 * lowercase → NFD diacritic strip → remove non-alnum → collapse whitespace.
 */
function normaliseText(s: string): string {
  const noDiacritics = s
    .normalize("NFD")
    .replace(DIACRITICS_RE, "");
  return noDiacritics
    .replace(PUNCT_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

/**
 * Word-boundary phrase / token match, mirroring the Kotlin
 * `containsPhraseOrAllTokens` logic.
 *
 * - If the full normalised query appears at a word boundary in the normalised
 *   text → match.
 * - Otherwise split into tokens and require each at a word boundary.
 * - For 2-token queries the Kotlin app also checks proximity (≤50 words); we
 *   match that behaviour.
 */
function containsPhraseOrAllTokens(text: string, query: string): boolean {
  const textNorm = normaliseText(text);
  const queryNorm = normaliseText(query);
  if (!queryNorm) return false;

  // Phrase match at a word boundary
  if (textNorm.includes(queryNorm)) {
    const re = new RegExp(`\\b${escapeRegex(queryNorm)}`, "i");
    if (re.test(textNorm)) return true;
  }

  const tokens = queryNorm.split(WHITESPACE_RE).filter(Boolean);
  if (tokens.length <= 1) return false;

  // All tokens at word boundaries
  for (const tok of tokens) {
    const re = new RegExp(`\\b${escapeRegex(tok)}`, "i");
    if (!re.test(textNorm)) return false;
  }

  // Proximity check for 2-token queries (Kotlin: ≤50 words)
  if (tokens.length === 2) {
    const words = textNorm.split(WHITESPACE_RE);
    const firstIdx = words.findIndex((w) => w.startsWith(tokens[0]));
    const secondIdx = words.findIndex((w) => w.startsWith(tokens[1]));
    if (firstIdx < 0 || secondIdx < 0) return false;
    return Math.abs(firstIdx - secondIdx) <= 50;
  }

  // 3+ tokens: all present is sufficient
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Boolean parser (unchanged) ────────────────────────────────────────────────

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

/**
 * True when a query needs client-side enforcement of semantics the backend
 * does not understand: quoted phrases, grouping, or explicit AND/OR/NOT.
 *
 * Plain multi-term queries are already ANDed by the search endpoint, so they
 * must be trusted as-is. Re-filtering them locally can silently drop valid
 * results because the backend normalises diacritics/punctuation whereas the
 * local matcher only does a literal substring check.
 */
export function isAdvancedBooleanQuery(query: string): boolean {
  if (/[“”"()]/.test(query)) return true;
  return /(^|\s)(AND|OR|NOT)(\s|$)/i.test(query);
}

/**
 * Strip NOT terms (`-term` or `NOT term`) from a query so the server is not
 * asked to match them literally. NOT enforcement is applied locally after
 * results come back, mirroring the Kotlin `extractPositiveQuery`.
 */
export function extractPositiveQuery(query: string): string {
  return query
    .replace(/\bNOT\s+(\S+)/gi, "")
    .replace(/(^|\s)-(\S+)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Return true if *text* does NOT contain any of the given NOT terms at a word
 * boundary (mirrors Kotlin `textPassesNotFilter`).
 */
export function passesNotFilter(text: string, notTerms: string[]): boolean {
  if (notTerms.length === 0) return true;
  const norm = normaliseText(text);
  for (const term of notTerms) {
    const normTerm = normaliseText(term);
    if (normTerm && new RegExp(`\\b${escapeRegex(normTerm)}`).test(norm)) return false;
  }
  return true;
}

/**
 * Unified episode match check, mirroring the Kotlin `episodeMatchesQuery`.
 * For advanced queries: enforce NOT terms against title, description and
 * podcast name. For simple queries: normalised word-boundary match on title
 * OR description.
 */
export function episodeMatchesQuery(
  episodeTitle: string,
  episodeDesc: string,
  podcastName: string,
  query: string
): boolean {
  if (isAdvancedBooleanQuery(query)) {
    const notTerms = extractNotTerms(query);
    if (notTerms.length > 0) {
      if (!passesNotFilter(episodeTitle, notTerms)) return false;
      if (!passesNotFilter(episodeDesc, notTerms)) return false;
      if (!passesNotFilter(podcastName, notTerms)) return false;
    }
    return true;
  }
  return containsPhraseOrAllTokens(episodeTitle, query) ||
         containsPhraseOrAllTokens(episodeDesc, query);
}

/**
 * NOT term extraction. Returns the plain term values after stripping leading
 * `-` or `NOT ` prefix.
 */
function extractNotTerms(query: string): string[] {
  const terms: string[] = [];
  for (const token of query.match(/\S+/g) || []) {
    if (token.startsWith("-") && token.length > 1) {
      terms.push(token.slice(1));
    } else if (/^NOT$/i.test(token)) {
      // next token is the NOT term
    }
  }
  // Also handle "NOT term" form
  const notRe = /\bNOT\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = notRe.exec(query)) !== null) {
    const term = m[1].replace(/^["“”]|["“”]$/g, "");
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

/**
 * Main matching function, now using Kotlin-compatible normalisation for plain
 * queries and the Boolean AST for advanced ones.
 */
export function matchesBooleanSearch(query: string, text: string): boolean {
  const expression = parseBooleanSearch(query);
  if (!expression) return false;
  const advanced = isAdvancedBooleanQuery(query);

  if (!advanced) {
    // Simple query: use the normalised word-boundary matcher that mirrors the
    // Kotlin app (strips punctuation/diacritics, then does \b matching).
    return containsPhraseOrAllTokens(text, query);
  }

  // Advanced: strip HTML and collapse whitespace like before, but also
  // normalise so the local filter aligns with the server's normalisation.
  const haystack = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const evaluate = (node: BooleanSearchNode): boolean => {
    if (node.type === "term") {
      const term = node.value.replace(/\s+/g, " ").trim();
      // Use normalised matching even for AST terms so punctuation/diacritics
      // don't cause false drops.
      const normHaystack = normaliseText(haystack);
      const normTerm = normaliseText(term);
      return new RegExp(`\\b${escapeRegex(normTerm)}`).test(normHaystack);
    }
    if (node.type === "not") return !evaluate(node.child);
    if (node.type === "and") return evaluate(node.left) && evaluate(node.right);
    return evaluate(node.left) || evaluate(node.right);
  };
  return evaluate(expression);
}

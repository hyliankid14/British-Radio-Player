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

// ── Boolean parser ───────────────────────────────────────────────────────────

// Operators are recognised only in UPPERCASE, the convention every mainstream
// search engine uses. Case-insensitive matching made ordinary English words
// into operators: "More or Less" parsed as `more OR less` and matched almost
// every podcast, burying the real one. Lowercase and/or/not are words.
export function parseBooleanSearch(query: string): BooleanSearchNode | null {
  const normalisedQuery = query.replace(/[“”]/g, '"');
  const tokens = normalisedQuery.match(/"[^"]+"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/g) || [];
  let index = 0;
  const peek = () => tokens[index];
  const parsePrimary = (): BooleanSearchNode | null => {
    if (peek() === "NOT") {
      index++;
      const child = parsePrimary();
      return child ? { type: "not", child } : null;
    }
    // `-term` is the shorthand every mainstream search engine accepts for
    // exclusion. Unhandled, the dash stayed inside the term and the term became
    // a required literal, so "podcast -nfl" matched nothing at all rather than
    // every episode that is not about NFL.
    //
    // Only an attached dash is an operator. A dash with spaces around it is
    // punctuation — "Top 40 - The Countdown Show" is a title, not an exclusion —
    // and keeps working as the literal query the user typed.
    if (peek() && peek().length > 1 && peek().startsWith("-")) {
      let negated = peek().slice(1);
      index++;
      // The dash sticks to whatever follows, so `-"a phrase"` arrives as the
      // token `-"a` plus the rest of the phrase. Rejoin it before negating.
      if (negated.startsWith('"')) {
        const parts = [negated];
        while (index < tokens.length && !parts[parts.length - 1].endsWith('"')) {
          parts.push(tokens[index++]);
        }
        negated = parts.join(" ").replace(/^"|"$/g, "");
      }
      return { type: "not", child: { type: "term", value: negated.toLowerCase() } };
    }
    if (tokens[index] === "(") {
      index++;
      const expression = parseOr();
      if (tokens[index] === ")") index++;
      return expression;
    }
    const token = tokens[index++];
    if (!token || /^(AND|OR|NOT)$/.test(token)) return null;
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
  if (/(^|\s)(AND|OR|NOT)(\s|$)/.test(query)) return true;
  // An attached `-term` is an exclusion, which the plain multi-term path cannot
  // express. A spaced dash ("Top 40 - Countdown") is title punctuation and stays
  // an ordinary query.
  return /(^|\s)-\S/.test(query);
}

/**
 * Strip NOT terms (`-term` or `NOT term`) from a query so the server is not
 * asked to match them literally. NOT enforcement is applied locally after
 * results come back, mirroring the Kotlin `extractPositiveQuery`.
 *
 * A leading `-term` is always an exclusion; bare `NOT` only when uppercase.
 */
export function extractPositiveQuery(query: string): string {
  return query
    .replace(/\bNOT\s+(\S+)/g, "")
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
 *
 * For advanced queries the parsed expression is evaluated against title and
 * description, and NOT terms are additionally checked against the podcast name.
 * For simple queries: normalised word-boundary match on title OR description.
 *
 * The expression must be evaluated for advanced queries too, not just its NOT
 * terms. The episode index tokenises and ANDs every token, so it cannot honour
 * quotes, OR or grouping — it hands back a superset. Returning `true` for the
 * positive part made every candidate pass, so `"Public Service Broadcasting"`
 * reported its count but listed unfiltered results.
 *
 * Title and description are concatenated rather than tested separately: a
 * phrase must not have to fit inside one field, and an exclusion has to see
 * both fields the way `passesNotFilter` does.
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
    return matchesBooleanSearch(query, `${episodeTitle} ${episodeDesc}`);
  }
  return containsPhraseOrAllTokens(episodeTitle, query) ||
         containsPhraseOrAllTokens(episodeDesc, query);
}

/**
 * Drop live-suggestion entries that merely echo the query back at the user.
 *
 * The matching podcast is already the top result in the list below, and a
 * single suggestion drawn in the same rounded box as the search field is
 * indistinguishable from a second search box sitting under the first.
 */
export function filterSuggestions<T extends { title: string }>(
  suggestions: T[],
  query: string
): T[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return [];
  return suggestions.filter((s) => s.title.trim().toLowerCase() !== typed);
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
    } else if (/^NOT$/.test(token)) {
      // next token is the NOT term
    }
  }
  // Also handle "NOT term" form (uppercase only, so "not" stays a word)
  const notRe = /\bNOT\s+(\S+)/g;
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

  // Advanced: strip HTML and normalise so the local filter aligns with the
  // server's normalisation. Normalising once up front matters — a long
  // description was being re-normalised for every leaf term in the expression.
  const haystack = normaliseText(
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
  );

  const evaluate = (node: BooleanSearchNode): boolean => {
    if (node.type === "term") {
      const normTerm = normaliseText(node.value);
      // An empty term matches nothing rather than every word boundary.
      if (!normTerm) return false;
      // Use normalised matching even for AST terms so punctuation/diacritics
      // don't cause false drops.
      return new RegExp(`\\b${escapeRegex(normTerm)}`).test(haystack);
    }
    if (node.type === "not") return !evaluate(node.child);
    if (node.type === "and") return evaluate(node.left) && evaluate(node.right);
    return evaluate(node.left) || evaluate(node.right);
  };
  return evaluate(expression);
}

/**
 * Backend-ready queries that between them cover everything a boolean
 * expression can match.
 *
 * The episode index tokenises its query and ANDs the tokens: it has no notion
 * of quotes, OR, grouping or exclusion, so it always answers with a superset.
 * Asking for the positive leaves one at a time and unioning the pages keeps
 * that superset intact for the operators the index cannot express; the
 * client-side evaluator then narrows it to what was actually typed.
 *
 * A multi-word leaf is a phrase. The index ranks its words individually, so one
 * small page can rank out exact-phrase matches — asking per word reaches them.
 *
 * Excluded leaves are never requested. `maxCandidates` bounds how many extra
 * requests one keystroke can fan out to.
 */
export function booleanSearchCandidateQueries(
  query: string,
  maxCandidates: number = 6
): string[] {
  const positives: string[] = [];
  const collect = (node: BooleanSearchNode): void => {
    if (node.type === "term") {
      const value = node.value.replace(/\s+/g, " ").trim();
      if (value && !positives.includes(value)) positives.push(value);
      return;
    }
    if (node.type === "not") return;
    collect(node.left);
    collect(node.right);
  };
  const expression = parseBooleanSearch(query);
  if (expression) collect(expression);

  const candidates: string[] = [];
  const add = (value: string) => {
    const clean = value.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };
  for (const leaf of positives) {
    add(leaf);
    for (const word of leaf.split(" ")) add(word);
  }
  return candidates.slice(0, Math.max(1, maxCandidates));
}

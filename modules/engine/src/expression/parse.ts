/**
 * Tiny expression DSL for JSON-friendly conditions in {@link Composition}s and triggers, and for
 * the computed lengths of `responsive` rules (`LengthExpr`).
 *
 * Grammar (precedence low → high):
 *
 * ```
 *   expr     := or
 *   or       := and ('OR'  and)*
 *   and      := not ('AND' not)*
 *   not      := 'NOT' not | cmp
 *   cmp      := add (('==' | '!=' | '<' | '<=' | '>' | '>=') add)?
 *   add      := mul (('+' | '-') mul)*
 *   mul      := primary (('*' | '/' | '%') primary)*
 *   primary  := number | string | 'true' | 'false' | 'null' | call | identifier | '(' expr ')'
 *   call     := ('min' | 'max') '(' expr (',' expr)* ')'
 * ```
 *
 * Arithmetic (`+ - * / %`) is supported, so expressions can compute values
 * (`roll * bet`), not just predicates. `+` concatenates when either operand is a
 * string. The evaluator returns the computed value (number/string/boolean).
 *
 * Identifiers are resolved through a caller-supplied {@link LookupFn}, so the
 * same parser is used for both step-level `if` conditions (looks up against
 * the run's `vars` map) and trigger `whenExpr` (looks up against the event
 * payload). Strings: `'literal'` or `"literal"`. Numbers: decimal floats.
 * Keywords `AND`, `OR`, `NOT`, `true`, `false`, `null` are case-sensitive.
 *
 * `min` / `max` are `Math.min` / `Math.max` over numbers — added for responsive lengths
 * (2026-10-08). A bare `min` / `max` **not** followed by `(` is still an identifier, so a director
 * var of that name reads as it always did; every input that parsed before parses to the same thing.
 *
 * @example
 * ```ts
 * const eval$ = parseExpression('netGain >= betAmount AND won');
 * const vars = new Map([['netGain', 200], ['betAmount', 100], ['won', true]]);
 * eval$((name) => vars.get(name));   // → true
 * ```
 */

/** Identifier namespace — `$` for vars, `#` for event payload, `undefined` for bare. */
export type IdentifierPrefix = '$' | '#';

/**
 * Caller-supplied identifier resolver. Receives the identifier name and an
 * optional `prefix` (`$` / `#`) indicating which namespace was requested.
 * Bare identifiers (no prefix) are dispatched with `prefix = undefined` —
 * the caller decides which namespace bare identifiers default to (step
 * context defaults to vars; trigger context defaults to event payload).
 */
export type LookupFn = (name: string, prefix?: IdentifierPrefix) => unknown;

/** Compiled predicate — call with a {@link LookupFn} to evaluate. */
export type ExpressionEvaluator = (lookup: LookupFn) => unknown;

/** Thrown when the input cannot be parsed. */
export class ExpressionParseError extends Error {
    constructor(message: string, public readonly input: string, public readonly position: number) {
        super(`[Director] expression parse error at ${position}: ${message} — '${input}'`);
        this.name = 'ExpressionParseError';
    }
}

/** The functions a `call` may name — only what a converted site uses. */
const FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> = {
    min: Math.min,
    max: Math.max,
};

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Tok =
    | { kind: 'num'; value: number; pos: number }
    | { kind: 'str'; value: string; pos: number }
    | { kind: 'ident'; value: string; prefix?: IdentifierPrefix; pos: number }
    | { kind: 'op'; value: string; pos: number }
    | { kind: 'eof'; pos: number };

function isIdentStart(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
}
function isIdentBody(c: string): boolean {
    return isIdentStart(c) || (c >= '0' && c <= '9');
}

const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=']);

/** Keywords the grammar owns — rejected as `$var` / `#payload` names and as bare identifiers. */
const RESERVED = new Set(['AND', 'OR', 'NOT', 'true', 'false', 'null']);

function tokenize(input: string): Tok[] {
    const tokens: Tok[] = [];
    let i = 0;
    while (i < input.length) {
        const c = input[i];

        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

        // Number (no leading sign — negation must be written as `0 - x`)
        if (c >= '0' && c <= '9') {
            const start = i;
            while (i < input.length && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) i++;
            const text = input.slice(start, i);
            const value = parseFloat(text);
            if (Number.isNaN(value)) throw new ExpressionParseError(`invalid number '${text}'`, input, start);
            tokens.push({ kind: 'num', value, pos: start });
            continue;
        }

        // String literal
        if (c === "'" || c === '"') {
            const quote = c;
            const start = i;
            i++;
            const valueStart = i;
            while (i < input.length && input[i] !== quote) i++;
            if (i >= input.length) throw new ExpressionParseError(`unterminated string`, input, start);
            tokens.push({ kind: 'str', value: input.slice(valueStart, i), pos: start });
            i++; // skip closing quote
            continue;
        }

        // Prefixed identifier — `$name` (vars) or `#name` (event payload)
        if (c === '$' || c === '#') {
            if (i + 1 >= input.length || !isIdentStart(input[i + 1])) {
                throw new ExpressionParseError(`'${c}' must be followed by an identifier`, input, i);
            }
            const prefix = c as IdentifierPrefix;
            const prefixPos = i;
            i++; // skip prefix
            const start = i;
            while (i < input.length && isIdentBody(input[i])) i++;
            const name = input.slice(start, i);
            if (RESERVED.has(name)) {
                throw new ExpressionParseError(`'${prefix}${name}' uses reserved keyword '${name}'`, input, prefixPos);
            }
            tokens.push({ kind: 'ident', value: name, prefix, pos: prefixPos });
            continue;
        }

        // Bare identifier / keyword
        if (isIdentStart(c)) {
            const start = i;
            while (i < input.length && isIdentBody(input[i])) i++;
            tokens.push({ kind: 'ident', value: input.slice(start, i), pos: start });
            continue;
        }

        // Two-char operator
        if (i + 1 < input.length && TWO_CHAR_OPS.has(input.slice(i, i + 2))) {
            tokens.push({ kind: 'op', value: input.slice(i, i + 2), pos: i });
            i += 2;
            continue;
        }

        // Single-char operator (comparison, grouping, arithmetic)
        if (c === '<' || c === '>' || c === '(' || c === ')' || c === ',' || c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
            tokens.push({ kind: 'op', value: c, pos: i });
            i++;
            continue;
        }

        if (c === '=') throw new ExpressionParseError(`'=' alone — did you mean '=='?`, input, i);
        if (c === '!') throw new ExpressionParseError(`'!' alone — use NOT instead`, input, i);

        throw new ExpressionParseError(`unexpected character '${c}'`, input, i);
    }
    tokens.push({ kind: 'eof', pos: input.length });
    return tokens;
}

// ─── Parser (recursive descent) ──────────────────────────────────────────────

function parse(input: string, tokens: Tok[]): ExpressionEvaluator {
    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function fail(t: Tok, msg: string): never {
        throw new ExpressionParseError(msg, input, t.pos);
    }

    function parseOr(): ExpressionEvaluator {
        let left = parseAnd();
        while (peek().kind === 'ident' && (peek() as { value: string }).value === 'OR') {
            consume();
            const right = parseAnd();
            const l = left;
            left = (lookup) => Boolean(l(lookup)) || Boolean(right(lookup));
        }
        return left;
    }

    function parseAnd(): ExpressionEvaluator {
        let left = parseNot();
        while (peek().kind === 'ident' && (peek() as { value: string }).value === 'AND') {
            consume();
            const right = parseNot();
            const l = left;
            left = (lookup) => Boolean(l(lookup)) && Boolean(right(lookup));
        }
        return left;
    }

    function parseNot(): ExpressionEvaluator {
        if (peek().kind === 'ident' && (peek() as { value: string }).value === 'NOT') {
            consume();
            const operand = parseNot();
            return (lookup) => !operand(lookup);
        }
        return parseCmp();
    }

    function parseCmp(): ExpressionEvaluator {
        const left = parseAdd();
        const t = peek();
        if (t.kind === 'op' && (t.value === '==' || t.value === '!=' || t.value === '<' || t.value === '<=' || t.value === '>' || t.value === '>=')) {
            consume();
            const right = parseAdd();
            const op = t.value;
            return (lookup) => {
                const lv = left(lookup);
                const rv = right(lookup);
                switch (op) {
                    case '==': return lv === rv;
                    case '!=': return lv !== rv;
                    case '<':  return (lv as number) < (rv as number);
                    case '<=': return (lv as number) <= (rv as number);
                    case '>':  return (lv as number) > (rv as number);
                    case '>=': return (lv as number) >= (rv as number);
                    default: return false;
                }
            };
        }
        return left;
    }

    // Arithmetic sits between comparison and primary: `a * b + c >= d` parses as expected.
    // `+` concatenates when either side is a string, matching JS `+`.
    function parseAdd(): ExpressionEvaluator {
        let left = parseMul();
        while (peek().kind === 'op' && ((peek() as { value: string }).value === '+' || (peek() as { value: string }).value === '-')) {
            const op = (consume() as { value: string }).value;
            const right = parseMul();
            const l = left;
            left = (lookup) => {
                const a = l(lookup);
                const b = right(lookup);
                if (op === '+') return (typeof a === 'string' || typeof b === 'string') ? `${a}${b}` : (a as number) + (b as number);
                return (a as number) - (b as number);
            };
        }
        return left;
    }

    function parseMul(): ExpressionEvaluator {
        let left = parsePrimary();
        while (peek().kind === 'op' && ['*', '/', '%'].includes((peek() as { value: string }).value)) {
            const op = (consume() as { value: string }).value;
            const right = parsePrimary();
            const l = left;
            left = (lookup) => {
                const a = l(lookup) as number;
                const b = right(lookup) as number;
                if (op === '*') return a * b;
                if (op === '/') return a / b;
                return a % b;
            };
        }
        return left;
    }

    function parsePrimary(): ExpressionEvaluator {
        const t = peek();
        if (t.kind === 'num') { consume(); const v = t.value; return () => v; }
        if (t.kind === 'str') { consume(); const v = t.value; return () => v; }
        if (t.kind === 'ident') {
            const name = t.value;
            const prefix = t.prefix;
            // Literal keywords are only literal when bare (no `$` / `#`).
            if (!prefix) {
                if (name === 'true')  { consume(); return () => true; }
                if (name === 'false') { consume(); return () => false; }
                if (name === 'null')  { consume(); return () => null; }
                if (RESERVED.has(name)) fail(t, `unexpected keyword '${name}'`);
                const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
                const open = tokens[pos + 1];
                if (fn && open.kind === 'op' && open.value === '(') {
                    consume();
                    consume();
                    const args: ExpressionEvaluator[] = [parseOr()];
                    while (peek().kind === 'op' && (peek() as { value: string }).value === ',') {
                        consume();
                        args.push(parseOr());
                    }
                    const close = peek();
                    if (close.kind !== 'op' || close.value !== ')') fail(close, `expected ',' or ')' in ${name}(…)`);
                    consume();
                    return (lookup) => fn(...args.map((arg) => arg(lookup) as number));
                }
            }
            consume();
            return (lookup) => lookup(name, prefix);
        }
        if (t.kind === 'op' && t.value === '(') {
            consume();
            const inner = parseOr();
            const close = peek();
            if (close.kind !== 'op' || close.value !== ')') fail(close, `expected ')'`);
            consume();
            return inner;
        }
        return fail(t, `unexpected token`);
    }

    const result = parseOr();
    const last = peek();
    if (last.kind !== 'eof') fail(last, `trailing input`);
    return result;
}

/** Parse `input` into a compiled {@link ExpressionEvaluator}. Throws {@link ExpressionParseError} on malformed input. */
export function parseExpression(input: string): ExpressionEvaluator {
    return parse(input, tokenize(input));
}

// ─── Compile cache ───────────────────────────────────────────────────────────

const _cache = new Map<string, ExpressionEvaluator>();

/**
 * Parse `input` once and reuse the compiled evaluator on subsequent calls.
 * Director's `if` step and trigger `whenExpr` go through this helper to avoid
 * paying tokenize/parse cost on every fire.
 *
 * The cache is process-wide and unbounded. Composition sets in a game are
 * finite and tiny in practice; if that ever changes, swap for an LRU.
 */
export function compileExpression(input: string): ExpressionEvaluator {
    let e = _cache.get(input);
    if (!e) {
        e = parseExpression(input);
        _cache.set(input, e);
    }
    return e;
}

/** Drop the parse cache. Useful in HMR / test teardown. */
export function clearExpressionCache(): void {
    _cache.clear();
}

// ─── Lexer / Tokenizer ───────────────────────────────────────────────────────

const TT = {
    NUM: 'NUM', STR: 'STR', BOOL: 'BOOL', NULL: 'NULL',
    IDENT: 'IDENT',
    LET: 'let', FN: 'fn', RETURN: 'return', IF: 'if', ELSEIF: 'elseif', ELSE: 'else',
    END: 'end', LOOP: 'loop', WHILE: 'while', FOR: 'for', IN: 'in', ON: 'on',
    BREAK: 'break', CONTINUE: 'continue', AND: 'and', OR: 'or', NOT: 'not',
    PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', PERCENT: '%',
    EQ: '==', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=',
    ASSIGN: '=', LPAREN: '(', RPAREN: ')', LBRACKET: '[', RBRACKET: ']',
    LBRACE: '{', RBRACE: '}', COMMA: ',', DOT: '.', COLON: ':', QUESTION: '?',
    EOF: 'EOF'
}

const KEYWORDS = new Set([
    'let', 'fn', 'return', 'if', 'elseif', 'else', 'end', 'loop', 'while', 'for', 'in',
    'on', 'break', 'continue', 'and', 'or', 'not', 'true', 'false', 'null'
])

class Token {
    constructor(type, value, line, col) {
        this.type = type; this.value = value
        this.line = line; this.col = col
    }
}

class LexError extends Error {
    constructor(msg, line, col) {
        super(msg); this.line = line; this.col = col; this.isLangError = true
    }
}

/**
 * Tokenize source code into tokens
 * @param {string} src - Source code to tokenize
 * @returns {Token[]} Array of tokens
 */
function lex(src) {
    const tokens = []
    let i = 0, line = 1, col = 1

    const peek = (off = 0) => src[i + off]
    const adv = () => { const c = src[i++]; if (c === '\n') { line++; col = 1 } else { col++ }; return c }

    while (i < src.length) {
        const c = peek()

        // whitespace
        if (c === ' ' || c === '\t' || c === '\r') { adv(); continue }
        if (c === '\n') { adv(); continue }

        // comment
        if (c === '-' && peek(1) === '-') {
            while (i < src.length && peek() !== '\n') adv()
            continue
        }

        const sl = line, sc = col

        // number
        const prevType = tokens[tokens.length - 1]?.type
        const unaryCtx = !prevType || ['PLUS', 'MINUS', 'STAR', 'SLASH', 'PERCENT', 'ASSIGN',
            'EQ', 'NEQ', 'LT', 'GT', 'LTE', 'GTE', 'LPAREN', 'LBRACKET', 'COMMA', 'COLON'].includes(prevType)
        if (c >= '0' && c <= '9' || (c === '-' && peek(1) >= '0' && peek(1) <= '9' && unaryCtx)) {
            let num = adv()
            while (i < src.length && peek() >= '0' && peek() <= '9') num += adv()
            if (peek() === '.' && peek(1) >= '0' && peek(1) <= '9') {
                num += adv()
                while (i < src.length && peek() >= '0' && peek() <= '9') num += adv()
            }
            tokens.push(new Token(TT.NUM, parseFloat(num), sl, sc))
            continue
        }

        // string
        if (c === '"' || c === "'") {
            const q = adv(); let str = ''
            while (i < src.length && peek() !== q) {
                if (peek() === '\\') {
                    adv()
                    const esc = adv()
                    str += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" }[esc] || esc)
                } else str += adv()
            }
            if (i >= src.length) throw new LexError('Unterminated string', sl, sc)
            adv()
            tokens.push(new Token(TT.STR, str, sl, sc))
            continue
        }

        // identifier / keyword
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
            let id = adv()
            while (i < src.length && ((peek() >= 'a' && peek() <= 'z') || (peek() >= 'A' && peek() <= 'Z') ||
                (peek() >= '0' && peek() <= '9') || peek() === '_')) id += adv()
            if (id === 'true' || id === 'false') tokens.push(new Token(TT.BOOL, id === 'true', sl, sc))
            else if (id === 'null') tokens.push(new Token(TT.NULL, null, sl, sc))
            else if (KEYWORDS.has(id)) tokens.push(new Token(id, id, sl, sc))
            else tokens.push(new Token(TT.IDENT, id, sl, sc))
            continue
        }

        // two-char operators
        if (c === '=' && peek(1) === '=') { adv(); adv(); tokens.push(new Token(TT.EQ, '==', sl, sc)); continue }
        if (c === '!' && peek(1) === '=') { adv(); adv(); tokens.push(new Token(TT.NEQ, '!=', sl, sc)); continue }
        if (c === '<' && peek(1) === '=') { adv(); adv(); tokens.push(new Token(TT.LTE, '<=', sl, sc)); continue }
        if (c === '>' && peek(1) === '=') { adv(); adv(); tokens.push(new Token(TT.GTE, '>=', sl, sc)); continue }

        // single-char operators
        const single = {
            '+': TT.PLUS, '-': TT.MINUS, '*': TT.STAR, '/': TT.SLASH, '%': TT.PERCENT,
            '=': TT.ASSIGN, '<': TT.LT, '>': TT.GT,
            '(': TT.LPAREN, ')': TT.RPAREN, '[': TT.LBRACKET, ']': TT.RBRACKET,
            '{': TT.LBRACE, '}': TT.RBRACE, ',': TT.COMMA, '.': TT.DOT,
            ':': TT.COLON, '?': TT.QUESTION
        }
        if (single[c]) { adv(); tokens.push(new Token(single[c], c, sl, sc)); continue }

        throw new LexError(`Unexpected character: '${c}'`, sl, sc)
    }

    tokens.push(new Token(TT.EOF, '', line, col))
    return tokens
}

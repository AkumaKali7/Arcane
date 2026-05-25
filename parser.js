// ─── Token Types ─────────────────────────────────────────────────────────────

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
// ─── AST Node factory ────────────────────────────────────────────────────────

const N = (type, props = {}) => ({ type, ...props })
// ─── Parse Error ─────────────────────────────────────────────────────────────

class ParseError extends Error {
    constructor(msg, token) {
        super(msg)
        this.token = token; this.isLangError = true
        this.line = token?.line; this.col = token?.col
    }
}
// ─── Parser ──────────────────────────────────────────────────────────────────

class Parser {
    constructor(tokens) { this.tokens = tokens; this.i = 0 }

    peek(off = 0) { return this.tokens[Math.min(this.i + off, this.tokens.length - 1)] }
    cur() { return this.peek() }
    adv() { return this.tokens[this.i++] }
    check(t) { return this.cur().type === t }
    atEnd() { return this.check(TT.EOF) }
    match(...types) { if (types.includes(this.cur().type)) return this.adv(); return null }

    eat(type) {
        if (!this.check(type))
            throw new ParseError(
                `Expected '${type}' but got '${this.cur().type}' ('${this.cur().value}')`,
                this.cur()
            )
        return this.adv()
    }

    parse() {
        const stmts = []
        while (!this.atEnd()) stmts.push(this.statement())
        return N('Program', { body: stmts })
    }

    statement() {
        const t = this.cur()
        if (t.type === TT.LET) return this.letStmt()
        if (t.type === TT.FN) return this.fnStmt()
        if (t.type === TT.RETURN) return this.returnStmt()
        if (t.type === TT.IF) return this.ifStmt()
        if (t.type === TT.LOOP) return this.loopStmt()
        if (t.type === TT.WHILE) return this.whileStmt()
        if (t.type === TT.FOR) return this.forStmt()
        if (t.type === TT.ON) return this.onStmt()
        if (t.type === TT.BREAK) { this.adv(); return N('Break', { line: t.line }) }
        if (t.type === TT.CONTINUE) { this.adv(); return N('Continue', { line: t.line }) }
        return this.exprStmt()
    }

    letStmt() {
        const tok = this.eat(TT.LET)
        const name = this.eat(TT.IDENT).value
        this.eat(TT.ASSIGN)
        const val = this.expr()
        return N('Let', { name, val, line: tok.line })
    }

    fnStmt() {
        const tok = this.eat(TT.FN)
        const name = this.eat(TT.IDENT).value
        this.eat(TT.LPAREN)
        const params = []
        if (!this.check(TT.RPAREN)) {
            params.push(this.eat(TT.IDENT).value)
            while (this.match(TT.COMMA)) params.push(this.eat(TT.IDENT).value)
        }
        this.eat(TT.RPAREN)
        const body = this.block()
        this.eat(TT.END)
        return N('Fn', { name, params, body, line: tok.line })
    }

    returnStmt() {
        const tok = this.eat(TT.RETURN)
        const stopTypes = new Set([TT.END, TT.ELSE, TT.ELSEIF, TT.EOF])
        const val = !stopTypes.has(this.cur().type) ? this.expr() : null
        return N('Return', { val, line: tok.line })
    }

    ifStmt() {
        const tok = this.eat(TT.IF)
        const cond = this.expr()
        const body = this.block()
        const elseifs = []
        while (this.check(TT.ELSEIF)) {
            this.adv()
            elseifs.push({ cond: this.expr(), body: this.block() })
        }
        const elseBody = this.match(TT.ELSE) ? this.block() : null
        this.eat(TT.END)
        return N('If', { cond, body, elseifs, elseBody, line: tok.line })
    }

    loopStmt() {
        const tok = this.eat(TT.LOOP)
        const body = this.block()
        this.eat(TT.END)
        return N('Loop', { body, line: tok.line })
    }

    whileStmt() {
        const tok = this.eat(TT.WHILE)
        const cond = this.expr()
        const body = this.block()
        this.eat(TT.END)
        return N('While', { cond, body, line: tok.line })
    }

    forStmt() {
        const tok = this.eat(TT.FOR)
        const name = this.eat(TT.IDENT).value
        this.eat(TT.IN)
        const iter = this.expr()
        const body = this.block()
        this.eat(TT.END)
        return N('For', { name, iter, body, line: tok.line })
    }

    onStmt() {
        const tok = this.eat(TT.ON)
        const event = this.eat(TT.IDENT).value
        const body = this.block()
        this.eat(TT.END)
        return N('On', { event, body, line: tok.line })
    }

    block() {
        const stmts = []
        const stop = new Set([TT.END, TT.ELSE, TT.ELSEIF, TT.EOF])
        while (!stop.has(this.cur().type)) stmts.push(this.statement())
        return stmts
    }

    exprStmt() {
        const e = this.expr()
        return N('ExprStmt', { expr: e, line: e.line })
    }

    // ── Expressions (precedence climbing) ────────────────────────────────────

    expr() { return this.assignment() }

    assignment() {
        const e = this.ternary()
        if (this.check(TT.ASSIGN)) {
            this.adv()
            const val = this.expr()
            if (e.type === 'Ident') return N('Assign', { name: e.name, val, line: e.line })
            if (e.type === 'Index') return N('IndexAssign', { obj: e.obj, key: e.key, val, line: e.line })
            if (e.type === 'Field') return N('FieldAssign', { obj: e.obj, field: e.field, val, line: e.line })
            throw new ParseError('Invalid assignment target', this.cur())
        }
        return e
    }

    ternary() {
        const e = this.orExpr()
        if (this.match(TT.QUESTION)) {
            const then = this.expr()
            this.eat(TT.COLON)
            const else_ = this.expr()
            return N('Ternary', { cond: e, then, else_, line: e.line })
        }
        return e
    }

    orExpr() {
        let e = this.andExpr()
        while (this.check(TT.OR)) { this.adv(); e = N('BinOp', { op: 'or', left: e, right: this.andExpr(), line: e.line }) }
        return e
    }

    andExpr() {
        let e = this.notExpr()
        while (this.check(TT.AND)) { this.adv(); e = N('BinOp', { op: 'and', left: e, right: this.notExpr(), line: e.line }) }
        return e
    }

    notExpr() {
        if (this.check(TT.NOT)) { const t = this.adv(); return N('UnaryOp', { op: 'not', expr: this.notExpr(), line: t.line }) }
        return this.compareExpr()
    }

    compareExpr() {
        let e = this.addExpr()
        const ops = [TT.EQ, TT.NEQ, TT.LT, TT.GT, TT.LTE, TT.GTE]
        while (ops.includes(this.cur().type)) {
            const op = this.adv().type
            e = N('BinOp', { op, left: e, right: this.addExpr(), line: e.line })
        }
        return e
    }

    addExpr() {
        let e = this.mulExpr()
        while (this.check(TT.PLUS) || this.check(TT.MINUS)) {
            const op = this.adv().value
            e = N('BinOp', { op, left: e, right: this.mulExpr(), line: e.line })
        }
        return e
    }

    mulExpr() {
        let e = this.unaryExpr()
        while (this.check(TT.STAR) || this.check(TT.SLASH) || this.check(TT.PERCENT)) {
            const op = this.adv().value
            e = N('BinOp', { op, left: e, right: this.unaryExpr(), line: e.line })
        }
        return e
    }

    unaryExpr() {
        if (this.check(TT.MINUS)) { const t = this.adv(); return N('UnaryOp', { op: '-', expr: this.callExpr(), line: t.line }) }
        return this.callExpr()
    }

    callExpr() {
        let e = this.primary()
        while (true) {
            if (this.check(TT.LPAREN)) {
                this.adv()
                const args = []
                if (!this.check(TT.RPAREN)) {
                    args.push(this.expr())
                    while (this.match(TT.COMMA)) args.push(this.expr())
                }
                this.eat(TT.RPAREN)
                e = N('Call', { callee: e, args, line: e.line })
            } else if (this.check(TT.LBRACKET)) {
                this.adv()
                const key = this.expr()
                this.eat(TT.RBRACKET)
                e = N('Index', { obj: e, key, line: e.line })
            } else if (this.check(TT.DOT)) {
                this.adv()
                const field = this.eat(TT.IDENT).value
                e = N('Field', { obj: e, field, line: e.line })
            } else break
        }
        return e
    }

    primary() {
        const t = this.cur()
        if (t.type === TT.NUM) { this.adv(); return N('Literal', { val: t.value, line: t.line }) }
        if (t.type === TT.STR) { this.adv(); return N('Literal', { val: t.value, line: t.line }) }
        if (t.type === TT.BOOL) { this.adv(); return N('Literal', { val: t.value, line: t.line }) }
        if (t.type === TT.NULL) { this.adv(); return N('Literal', { val: null, line: t.line }) }
        if (t.type === TT.IDENT) { this.adv(); return N('Ident', { name: t.value, line: t.line }) }

        // anonymous function expression: fn() ... end  or  fn(a, b) ... end
        if (t.type === TT.FN) {
            this.adv()
            this.eat(TT.LPAREN)
            const params = []
            if (!this.check(TT.RPAREN)) {
                params.push(this.eat(TT.IDENT).value)
                while (this.match(TT.COMMA)) params.push(this.eat(TT.IDENT).value)
            }
            this.eat(TT.RPAREN)
            const body = this.block()
            this.eat(TT.END)
            return N('Lambda', { params, body, line: t.line })
        }

        if (t.type === TT.LPAREN) {
            this.adv(); const e = this.expr(); this.eat(TT.RPAREN); return e
        }

        if (t.type === TT.LBRACKET) {
            this.adv()
            const items = []
            if (!this.check(TT.RBRACKET)) {
                items.push(this.expr())
                while (this.match(TT.COMMA) && !this.check(TT.RBRACKET)) items.push(this.expr())
            }
            this.eat(TT.RBRACKET)
            return N('Array', { items, line: t.line })
        }

        if (t.type === TT.LBRACE) {
            this.adv()
            const pairs = []
            if (!this.check(TT.RBRACE)) {
                const parseKey = () => {
                    if (this.check(TT.IDENT) || this.check(TT.STR)) return this.adv().value
                    throw new ParseError('Expected map key', this.cur())
                }
                const k = parseKey(); this.eat(TT.COLON); const v = this.expr(); pairs.push({ k, v })
                while (this.match(TT.COMMA) && !this.check(TT.RBRACE)) {
                    const k2 = parseKey(); this.eat(TT.COLON); const v2 = this.expr(); pairs.push({ k: k2, v: v2 })
                }
            }
            this.eat(TT.RBRACE)
            return N('Map', { pairs, line: t.line })
        }

        throw new ParseError(`Unexpected token '${t.value}' (${t.type})`, t)
    }
}

// ─── Control flow signals ────────────────────────────────────────────────────

class ReturnSignal { constructor(val) { this.val = val } }
class BreakSignal { }
class ContinueSignal { }

// ─── Runtime Error ───────────────────────────────────────────────────────────

class RuntimeError extends Error {
    constructor(msg, node) {
        super(msg); this.node = node; this.isLangError = true; this.line = node?.line
    }
}
// ─── Environment (scope chain) ───────────────────────────────────────────────

class Env {
    constructor(parent = null) { this.vars = new Map(); this.parent = parent }

    get(name) {
        if (this.vars.has(name)) return this.vars.get(name)
        return this.parent?.get(name)
    }
    has(name) { return this.vars.has(name) || (this.parent?.has(name) ?? false) }
    set(name, val) {
        if (this.vars.has(name)) { this.vars.set(name, val); return }
        if (this.parent?.has(name)) { this.parent.set(name, val); return }
        this.vars.set(name, val)
    }
    def(name, val) { this.vars.set(name, val) }

    snapshot() {
        const out = {}
        for (const [k, v] of this.vars) out[k] = v
        return out
    }
}
// ─── Interpreter ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 100_000
const MAX_CALL_DEPTH = 200

class Interpreter {
    constructor(context = {}, outputFn = (t, msg) => { console.log(t, msg) }) {
        this.outputFn = outputFn    // (type:'out'|'err'|'info'|'warn', msg:string) => void
        this.context = context
        this.triggers = {}          // event → [bodyStatements[]]
        this.callDepth = 0
        this.iterations = 0
        this.globalEnv = new Env()

        // inject caller-supplied context
        for (const [k, v] of Object.entries(context)) this.globalEnv.def(k, v);

        // built-in functions
        this._registerBuiltins()
    }

    _registerBuiltins() {
        const e = this.globalEnv
        const interp = this

        e.def('fire', (ev, eventData) => { interp.fire(ev, eventData
            
        )})
        e.def('print', (...a) => { interp.outputFn('out', a.map(x => interp.display(x)).join(' ')); return null })
        e.def('len', v => { if (Array.isArray(v) || typeof v === 'string') return v.length; if (v && typeof v === 'object') return Object.keys(v).length; return 0 })
        e.def('type', v => { if (v === null) return 'null'; if (Array.isArray(v)) return 'array'; return typeof v })
        e.def('push', (arr, v) => { if (!Array.isArray(arr)) throw new RuntimeError('push requires array', null); arr.push(v); return arr })
        e.def('pop', arr => { if (!Array.isArray(arr)) throw new RuntimeError('pop requires array', null); return arr.pop() ?? null })
        e.def('keys', obj => { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new RuntimeError('keys requires map', null); return Object.keys(obj) })
        e.def('values', obj => { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new RuntimeError('values requires map', null); return Object.values(obj) })
        e.def('range', (a, b) => { const s = b === undefined ? 0 : a, end = b === undefined ? a : b; const r = []; for (let i = s; i < end; i++) r.push(i); return r })
        e.def('str', v => interp.display(v))
        e.def('num', v => { const n = Number(v); return isNaN(n) ? null : n })
        e.def('floor', v => Math.floor(v))
        e.def('ceil', v => Math.ceil(v))
        e.def('round', v => Math.round(v))
        e.def('abs', v => Math.abs(v))
        e.def('min', (a, b) => Math.min(a, b))
        e.def('max', (a, b) => Math.max(a, b))
        e.def('rand', (a, b) => b === undefined ? Math.random() : Math.floor(Math.random() * (b - a)) + a)
        e.def('sqrt', v => Math.sqrt(v))
        e.def('contains', (col, v) => { if (Array.isArray(col) || typeof col === 'string') return col.includes(v); return false })
        e.def('slice', (a, s, e2) => { if (!Array.isArray(a) && typeof a !== 'string') return null; return a.slice(s, e2) })
        e.def('join', (arr, sep = '') => { if (!Array.isArray(arr)) return ''; return arr.join(sep) })
        e.def('split', (s, sep) => { if (typeof s !== 'string') return []; return s.split(sep) })
        e.def('upper', s => typeof s === 'string' ? s.toUpperCase() : s)
        e.def('lower', s => typeof s === 'string' ? s.toLowerCase() : s)
        e.def('trim', s => typeof s === 'string' ? s.trim() : s)
    }

    // Run a full program AST, returns snapshot of global vars
    run(ast) {
        this.triggers = {}
        this.iterations = 0
        this.callDepth = 0
        this.exec(ast, this.globalEnv)
        return this.globalEnv.snapshot()
    }

    // Fire a named trigger with optional event data
    fire(event, eventData = {}) {
        if (!this.triggers[event]) return
        const env = new Env(this.globalEnv)
        env.def('event', eventData)
        for (const body of this.triggers[event]) this.execBlock(body, env)
    }

    // ── Statement execution ──────────────────────────────────────────────────

    exec(node, env) {
        switch (node.type) {
            case 'Program': return this.execBlock(node.body, env)
            case 'Let': { env.def(node.name, this.eval(node.val, env)); return null }
            case 'Assign': { env.set(node.name, this.eval(node.val, env)); return null }
            case 'IndexAssign': {
                const obj = this.eval(node.obj, env), key = this.eval(node.key, env), val = this.eval(node.val, env)
                if (Array.isArray(obj) || typeof obj === 'object' && obj !== null) { obj[key] = val; return null }
                throw new RuntimeError('Cannot index non-collection', node)
            }
            case 'FieldAssign': {
                const obj = this.eval(node.obj, env), val = this.eval(node.val, env)
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new RuntimeError('Cannot set field on non-map', node)
                obj[node.field] = val; return null
            }
            case 'Fn': { env.def(node.name, this._makeFunc(node, env)); return null }
            case 'Return': throw new ReturnSignal(node.val ? this.eval(node.val, env) : null)
            case 'Break': throw new BreakSignal()
            case 'Continue': throw new ContinueSignal()
            case 'If': return this._execIf(node, env)
            case 'Loop': return this._execLoop(node, env)
            case 'While': return this._execWhile(node, env)
            case 'For': return this._execFor(node, env)
            case 'On': {
                if (!this.triggers[node.event]) this.triggers[node.event] = []
                this.triggers[node.event].push(node.body)
                return null
            }
            case 'ExprStmt': return this.eval(node.expr, env)
            default: throw new RuntimeError(`Unknown statement type: ${node.type}`, node)
        }
    }

    execBlock(stmts, env) {
        for (const s of stmts) {
            const r = this.exec(s, env)
            if (r instanceof ReturnSignal || r instanceof BreakSignal || r instanceof ContinueSignal) return r
        }
        return null
    }

    _execIf(node, env) {
        if (this.truthy(this.eval(node.cond, env))) return this.execBlock(node.body, new Env(env))
        for (const ei of node.elseifs)
            if (this.truthy(this.eval(ei.cond, env))) return this.execBlock(ei.body, new Env(env))
        if (node.elseBody) return this.execBlock(node.elseBody, new Env(env))
        return null
    }

    _execLoop(node, env) {
        while (true) {
            this._tick(node)
            try {
                const r = this.execBlock(node.body, new Env(env))
            } catch (e){
                if (e instanceof BreakSignal) break
                if (e instanceof ContinueSignal) continue
                if (e instanceof ReturnSignal) throw e
                throw e  // Re-throw unknown errors
            }
        }
        return null
    }

    _execWhile(node, env) {
        while (this.truthy(this.eval(node.cond, env))) {
            this._tick(node)
            try {
                const r = this.execBlock(node.body, new Env(env))
                
            } catch (e) {
                if (e instanceof BreakSignal) break
                if (e instanceof ContinueSignal) continue
                if (e instanceof ReturnSignal) throw r
                throw e  // Re-throw unknown errors
                
            }
        }
        return null
    }

    _execFor(node, env) {
        const iter = this.eval(node.iter, env)
        const items = Array.isArray(iter) ? iter
            : typeof iter === 'string' ? [...iter]
                : Object.keys(iter)
        for (const item of items) {
            this._tick(node)
            const loopEnv = new Env(env)
            loopEnv.def(node.name, item)
            try {
                const r = this.execBlock(node.body, loopEnv)
                
            } catch (e) {
                if (e instanceof BreakSignal) break
                if (e instanceof ContinueSignal) continue
                if (e instanceof ReturnSignal) throw r
                throw e
            }
        }
        return null
    }

    _tick(node) {
        if (++this.iterations > MAX_ITERATIONS)
            throw new RuntimeError('Iteration limit exceeded — possible infinite loop', node)
    }

    _makeFunc(node, closureEnv) {
        const interp = this

        return function (...args) {
            if (++interp.callDepth > MAX_CALL_DEPTH){
                throw new RuntimeError('Call stack overflow', node)
            } 
            const fnEnv = new Env(closureEnv)

            node.params.forEach((p, i) => fnEnv.def(p, args[i] ?? null))

            let result = null
            
            try { 
                result = interp.execBlock(node.body, fnEnv)
            }
            catch (e) { if (e instanceof ReturnSignal) result = e.val; else throw e }
            finally { interp.callDepth-- }
            return result
        }
    }

    // ── Expression evaluation ────────────────────────────────────────────────

    eval(node, env) {
        switch (node.type) {
            // assignments can appear as expressions (e.g. wrapped in ExprStmt)
            case 'Assign': { const v = this.eval(node.val, env); env.set(node.name, v); return v }
            case 'IndexAssign': {
                const obj = this.eval(node.obj, env), key = this.eval(node.key, env), val = this.eval(node.val, env)
                if (obj && (Array.isArray(obj) || typeof obj === 'object')) { obj[key] = val; return val }
                throw new RuntimeError('Cannot index non-collection', node)
            }
            case 'FieldAssign': {
                const obj = this.eval(node.obj, env), val = this.eval(node.val, env)
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new RuntimeError('Cannot set field on non-map', node)
                obj[node.field] = val; return val
            }
            case 'Literal': return node.val
            case 'Lambda': return this._makeFunc(node, env)
            case 'Ident': {
                const v = env.get(node.name)
                if (v === undefined) throw new RuntimeError(`Undefined variable '${node.name}'`, node)
                return v
            }
            case 'Array': return node.items.map(i => this.eval(i, env))
            case 'Map': {
                const m = {}
                for (const { k, v } of node.pairs) m[k] = this.eval(v, env)
                return m
            }
            case 'BinOp': return this._evalBinOp(node, env)
            case 'UnaryOp': {
                const v = this.eval(node.expr, env)
                if (node.op === '-') return -v
                if (node.op === 'not') return !this.truthy(v)
                throw new RuntimeError(`Unknown unary op: ${node.op}`, node)
            }
            case 'Ternary':
                return this.truthy(this.eval(node.cond, env))
                    ? this.eval(node.then, env)
                    : this.eval(node.else_, env)
            case 'Call': {
                const fn = this.eval(node.callee, env)
                if (typeof fn !== 'function') throw new RuntimeError(`'${this.display(fn)}' is not callable`, node)
                const args = node.args.map(a => this.eval(a, env))
                try { return fn(...args) ?? null }
                catch (e) {
                    if (e.isLangError || e instanceof ReturnSignal) throw e;
                    throw new RuntimeError(e.message, node)
                }
            }
            case 'Index': {
                const obj = this.eval(node.obj, env)
                const key = this.eval(node.key, env)
                if (Array.isArray(obj) || typeof obj === 'string') { const v = obj[key]; return v === undefined ? null : v }
                if (obj && typeof obj === 'object') { const v = obj[key]; return v === undefined ? null : v }
                throw new RuntimeError('Cannot index non-collection', node)
            }
            case 'Field': {
                const obj = this.eval(node.obj, env)
                if (obj === null || obj === undefined) throw new RuntimeError(`Cannot access field '${node.field}' on null`, node)
                if (typeof obj === 'string' && node.field === 'length') return obj.length
                if (Array.isArray(obj) && node.field === 'length') return obj.length
                if (typeof obj === 'object') return obj[node.field] ?? null
                throw new RuntimeError(`Cannot access field '${node.field}'`, node)
            }
            default: throw new RuntimeError(`Cannot evaluate node type: ${node.type}`, node)
        }
    }

    _evalBinOp(node, env) {
        const op = node.op
        // short-circuit
        if (op === 'and') return this.truthy(this.eval(node.left, env)) && this.truthy(this.eval(node.right, env))
        if (op === 'or') return this.truthy(this.eval(node.left, env)) || this.truthy(this.eval(node.right, env))
        const l = this.eval(node.left, env)
        const r = this.eval(node.right, env)
        switch (op) {
            case '+': return (typeof l === 'string' || typeof r === 'string') ? String(l) + String(r) : l + r
            case '-': return l - r
            case '*': return l * r
            case '/': if (r === 0) throw new RuntimeError('Division by zero', node); return l / r
            case '%': return l % r
            case '==': return l === r
            case '!=': return l !== r
            case '<': return l < r
            case '>': return l > r
            case '<=': return l <= r
            case '>=': return l >= r
        }
        throw new RuntimeError(`Unknown operator: ${op}`, node)
    }

    truthy(v) { return v !== null && v !== false && v !== 0 && v !== '' && v !== undefined }

    display(v) {
        if (v === null) return 'null'
        if (typeof v === 'function') return '[function]'
        if (Array.isArray(v)) return '[' + v.map(x => this.display(x)).join(', ') + ']'
        if (typeof v === 'object') return '{' + Object.entries(v).map(([k, vv]) => `${k}: ${this.display(vv)}`).join(', ') + '}'
        return String(v)
    }
}
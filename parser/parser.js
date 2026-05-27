// ─── Parser - AST Construction ───────────────────────────────────────────────

// AST Node factory
const N = (type, props = {}) => ({ type, ...props })

class ParseError extends Error {
    constructor(msg, token) {
        super(msg)
        this.token = token; this.isLangError = true
        this.line = token?.line; this.col = token?.col
    }
}

/**
 * Parser class for converting tokens to AST
 */
class Parser {
    constructor(tokens) { 
        this.tokens = tokens
        this.i = 0 
    }

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

        // anonymous function expression
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

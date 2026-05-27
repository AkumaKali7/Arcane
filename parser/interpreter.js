// ─── Interpreter - AST Execution ─────────────────────────────────────────────

// Control flow signals
class ReturnSignal { constructor(val) { this.val = val } }
class BreakSignal { }
class ContinueSignal { }

class RuntimeError extends Error {
    constructor(msg, node) {
        super(msg); this.node = node; this.isLangError = true; this.line = node?.line
    }
}

/**
 * Environment (scope chain) for variable storage
 */
class Env {
    constructor(parent = null) { 
        this.vars = new Map()
        this.parent = parent 
    }

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

// Limits
const MAX_ITERATIONS = 100_000
const MAX_CALL_DEPTH = 200

/**
 * Interpreter class for executing AST nodes
 */
class Interpreter {
    constructor(context = {}, outputFn = (t, msg) => { console.log(t, msg) }) {
        this.outputFn = outputFn
        this.context = context
        this.triggers = {}
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

        e.def('fire', (ev, eventData) => { interp.fire(ev, eventData) })
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

    run(ast) {
        this.triggers = {}
        this.iterations = 0
        this.callDepth = 0
        this.exec(ast, this.globalEnv)
        return this.globalEnv.snapshot()
    }

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
                throw e
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
                throw e
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

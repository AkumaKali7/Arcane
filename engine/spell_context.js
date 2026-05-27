// ─── Spell Context and Casting System ────────────────────────────────────────
// Injects spell-casting builtins into the Arcane interpreter.
// The engine enforces all rules — scripts can only express intent.

/**
 * Creates the spell context with all available functions for spell scripts
 * @param {SpellEngine} engine - The spell engine instance
 * @param {function} outputFn - Output function for logging
 */
function makeSpellContext(engine, outputFn) {
    return {
        // ── Mana sources (passed as values to gather()) ──
        pool: 'pool',
        env: 'env',
        self: engine.projectile,
        // ── Core spell builtins ──

        gather(source, amount) {
            return engine.gather(source, amount)
        },

        shape(form, size) {
            return engine.shape(form, size ?? 1)
        },

        attribute(attr) {
            return engine.attribute(attr)
        },

        speed(units) {
            return engine.speed(units)
        },

        follow(target) {
            return engine.follow(target)
        },

        reserve(amount) {
            return engine.reserve(amount)
        },

        explode() {
            return engine.explode()
        },

        // cast another scroll as a sub-spell
        // surcharge and mana routing are engine-enforced
        cast(scrollName) {
            return engine.cast(scrollName)
        },

        // ── Hook registration ──
        // Scripts call these to register event handlers.
        // Config is a map, fn is a callable.

        on_hit(fn) {
            engine.registerHook('on_hit', {}, fn)
        },

        on_deplete(fn) {
            engine.registerHook('on_deplete', {}, fn)
        },

        on_check(config, fn) {
            // on_check({every: 2}, fn)
            engine.registerHook('on_check', config, fn)
        },

        on_low_mana(config, fn) {
            // on_low_mana({threshold: 100}, fn)
            engine.registerHook('on_low_mana', config, fn)
        },

        // ── Query functions (read-only spell state) ──

        mana_pool() {
            return engine.pool.mana
        },

        self_mana() {
            return engine.mana
        },

        self_reserved() {
            return engine.reserved
        },

        // Simulated world queries
        // In the real game these query the actual scene
        enemy_nearby(target) {
            return engine.enemy_nearby(target)
        },

        // ── Resize (called from hooks) ──
        resize(newSize) {
            engine.size = newSize
            this.outputFn('engine', `spell resized to <b>${newSize}</b>`)
            if (engine.onStateChange) engine.onStateChange()
        },

        // ── Utility ──
        log(msg) {
            this.outputFn('out', String(msg))
            return null
        },

        print(...args) {
            this.outputFn('out', args.join(' '))
            return null
        },

        // Standard builtins also available in spell scripts
        rand: (a, b) => b === undefined ? Math.random() : Math.floor(Math.random() * (b - a)) + a,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
        str: v => String(v),
        num: v => { const n = Number(v); return isNaN(n) ? null : n },
    }
}

/**
 * Try to compile a spell source string
 * @param {string} src - Spell source code
 * @returns {string|null} Error message or null if successful
 */
function tryCompile(src) {
    try { 
        const t = lex(src)
        new Parser(t).parse()
        return null 
    } catch (e) { 
        return e.message + (e.line ? ` (line ${e.line})` : '') 
    }
}

/**
 * Run a spell AST with the given engine
 * @param {object} ast - Parsed AST
 * @param {SpellEngine} engine - Spell engine instance
 * @returns {boolean} Success status
 */
function runScroll(ast, engine) {
    try {
        const ctx = makeSpellContext(engine)
        const interp = new Interpreter(ctx, engine.outputFn)
        interp.run(ast)
        const spell = engine.start()

        if (spell.gatherSource == 'pool') {
            engine.phase = 'active'
        } else if (spell.gatherSource == 'env') {
            engine.phase = 'gathering'
        }
        return true
    } catch (e) {
        showMsg(e.message + (e.line ? ` (line ${e.line})` : ''))
        return false
    }
}

/**
 * Spawn a projectile for a spell
 * @param {*} from - Starting position
 * @param {*} to - Target position
 * @param {SpellEngine} engine - Spell engine instance
 * @returns {Projectile} Created projectile
 */
function SpawnProj(from, to, engine){
    const snap = engine.snapshot()
    
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = dx / dist
    const ny = dy / dist

    const proj = new Projectile(
        from,
        nx * (snap.speed * 40),
        ny * (snap.speed * 40),
        engine,
        snap
    )
    if(snap.shape === 'nova') { proj.vx = 0; proj.vy = 0 }
    return proj
}

/**
 * Cast a spell at the target location
 * @param {number} tx - Target X coordinate
 * @param {number} ty - Target Y coordinate
 */
function castSpell(tx, ty) {
    const ast = scrollAST[selectedScroll]

    if (!ast) { showMsg('Slot locked'); return }

    if (scrollErrors[selectedScroll]) { showMsg('Scroll has errors — open Grimoire to fix'); return }

    const engine = new SpellEngine({
        outputFn: (type, msg) => {
            console.log(type, msg)
        }, poolRef: pool
    })

    for (const p of projectiles) {
        if (p.engine.phase === 'gathering') return
    }

    if (!runScroll(ast, engine)) return
    if (engine.phase === 'idle' || engine.phase === 'dead') return

    const proj = SpawnProj(player, {x:tx, y:ty}, engine)

    const snap = engine.snapshot()
    const dx = tx - player.x, dy = ty - player.y, dist = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = dx / dist, ny = dy / dist
    const isNova = snap.shape === 'nova', isBeam = snap.shape === 'beam'

    engine.projectile = proj
    if (isNova) { proj.vx = 0; proj.vy = 0 }
    projectiles.push(proj)
}

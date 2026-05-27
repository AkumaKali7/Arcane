// ─── Spell Engine - Mana Economy and Spell Lifecycle ────────────────────────
// Manages the mana economy for a running spell.
// The interpreter runs the spell script; the engine enforces the rules.
// Scripts express intent — the engine handles consequences.

/**
 * SpellEngine - Manages the mana economy and lifecycle for a running spell.
 */
class SpellEngine {
    constructor({ outputFn, onStateChange, poolMana = 500, envMana = Infinity, nestDepth = 0, poolRef }) {
        this.outputFn = outputFn       // (type, msg) => void
        this.onStateChange = onStateChange  // () => void  — UI refresh hook
        this.nestDepth = nestDepth      // sub-spell nesting level

        // ── Mana sources ──
        this.pool = poolRef ? poolRef : new Pool(poolMana)   // player's personal mana pool (shared resource)
        this.envMana = envMana    // environment mana (unlimited but slow)
        
        // ── Spell state ──
        this.mana = 0          // current mana budget for this spell
        this.reserved = 0      // locked mana (for explosions, sub-payloads)
        this.upfront = 0       // total upfront cost spent
        this.drainRate = 0     // mana/sec ongoing drain

        // ── Properties ──
        this.spellShape = null
        this.size = 1
        this.attributes = []
        this.spellSpeed = 0
        this.following = false

        // ── Lifecycle ──
        this.phase = 'idle'     // idle | gathering | active | dead
        this.elapsed = 0
        this.gatherDuration = 0     // how long gathering takes (0 = instant)
        this.gatherElapsed = 0
        this.progress = 0

        // ── Hooks (registered by script) ──
        this.hooks = {
            on_hit: null,
            on_deplete: null,
            on_check: null,   // { every: N, fn: () }
            on_low_mana: null,   // { threshold: N, fn: () }
        }
        this._checkAccum = 0
        this._lowManaCooldown = 0
        this._lowManaPulsed = false

        // ── Sub-spell registry ──
        this._scrolls = {}
    }

    /**
     * Returns the current spell state for script access
     */
    start() {
        return {
            gatherAmount: this.gatherAmount,
            gatherSource: this.gatherSource,
            shape: this.spellShape,
            size: this.size,
            attribute: this.attributes,
            speed: this.spellSpeed,
            drainRate: this.drainRate,
            follow: this.following,
            reserved: this.reserved,
            active: this.active,
        }
    }

    /**
     * Gather mana from a source (pool or environment)
     * @param {string} source - 'pool' | 'env'
     * @param {number} amount - Amount of mana to gather
     * @returns {boolean} Success status
     */
    gather(source, amount) {
        const surcharge = this._nestSurcharge()
        const actual = Math.ceil(amount * surcharge)
        this.gatherAmount = amount
        this.gatherSource = source
        
        if (source === 'pool') {
            if (this.pool.mana < actual) {
                this._err(`not enough pool mana — need ${actual}, have ${Math.round(this.pool.mana)}`)
                this.active = false
                return false
            }
            this.pool.mana -= actual
            this.mana = actual
            this.active = true
            return true

        } else if (source === 'env') {
            // env gathering takes time proportional to amount
            this.gatherDuration = Math.max(1, actual / 200)
            this.mana = actual
            this.phase = 'gathering'
            return true

        } else {
            return this._err(`unknown source "${source}" — use "pool" or "env"`)
        }
    }

    /**
     * Set the spell shape and optional size
     * @param {string} form - Shape type (ball, cone, beam, nova, wall)
     * @param {number} size - Size multiplier (default: 1)
     * @returns {boolean} Success status
     */
    shape(form, size = 1) {
        if (!this._requireActive('shape()')) return false
        const cost = (SPELL_COSTS.shape[form] ?? 10) +
                     (size > 1 ? SPELL_COSTS.sizePerUnit * (size - 1) : 0)

        if (!this._spend(cost, `shape("${form}"${size > 1 ? ', size=' + size : ''})`)) return false
        this.spellShape = form
        this.size = size
        return true
    }

    /**
     * Add an attribute to the spell
     * @param {string} attr - Attribute type (fire, light, ice, shadow, arcane, void)
     * @returns {boolean} Success status
     */
    attribute(attr) {
        if (!this._requireActive('attribute()')) return false
        const cost = SPELL_COSTS.attribute[attr] ?? 8
        if (!this._spend(cost, `attribute("${attr}")`)) return false
        this.attributes.push(attr)
        return true
    }

    /**
     * Set spell speed (affects ongoing mana drain)
     * @param {number} units - Speed units
     * @returns {boolean} Success status
     */
    speed(units) {
        if (!this._requireActive('speed()')) return false
        const mult = this.following ? SPELL_COSTS.speedFollowMult : 1
        const drain = units * SPELL_COSTS.speedPerUnit * mult
        this.spellSpeed = units
        this.drainRate += drain
        return true
    }

    /**
     * Make spell follow a target instead of flying straight
     * @param {string} target - Target to follow
     * @returns {boolean} Success status
     */
    follow(target) {
        this.following = true
        return true
    }

    /**
     * Reserve mana for a triggered payload (e.g., explosion)
     * @param {number} amount - Amount to reserve
     * @returns {boolean} Success status
     */
    reserve(amount) {
        const free = this.mana - this.reserved
        if (amount > free) {
            return this._err(`cannot reserve ${amount} — only ${Math.round(free)} free mana`)
        }
        this.reserved += amount
        return true
    }

    /**
     * Cast a sub-spell from a scroll using this spell's mana as its pool
     * @param {string} scrollName - Name of scroll to cast
     * @returns {boolean} Success status
     */
    cast(scrollName) {
        if (!this._requireActive('cast()')) return false
        
        const src = scrollSrc[0]
        if (!src) return this._err(`scroll "${scrollName}" not found in inventory`)
        
        const tokens = lex(src)
        const ast = new Parser(tokens).parse()
        
        // Run the sub-spell with this spell's remaining free mana as its pool
        const freePool = this.mana - this.reserved
        
        const subEngine = new SpellEngine({
            outputFn: this.outputFn,
            onStateChange: this.onStateChange,
            poolMana: freePool,
            nestDepth: this.nestDepth + 1,
        })
        
        subEngine._scrolls = this._scrolls

        try {
            if (!runScroll(ast, subEngine)) return
            
            // Simplification: track upfront costs spent in sub-spell
            const subCost = subEngine.upfront
            if (subCost > 0) {
                this.mana = Math.max(this.reserved, this.mana - subCost)
                this._log('mana', `sub-spell <b>${scrollName}</b> cost <em>${subCost}</em> mana from parent`)
            }

            const proj = SpawnProj(this.projectile, this.target ? this.target : player, subEngine)
            subEngine.projectile = proj
            projectiles.push(proj)
        } catch (e) {
            this._err(`sub-spell "${scrollName}" error: ${e.message}`)
        }
        return true
    }

    /**
     * Release reserved mana as AoE damage
     * @returns {boolean} Success status
     */
    explode() {
        if (this.reserved <= 0) {
            return false
        }
        const power = this.reserved
        this.mana -= this.reserved
        this.reserved = 0
        this._kill()
        return true
    }

    /**
     * Register a hook for spell events
     * @param {string} name - Hook name (on_hit, on_deplete, on_check, on_low_mana)
     * @param {object} config - Hook configuration
     * @param {function} fn - Callback function
     */
    registerHook(name, config, fn) {
        if (name === 'on_hit') { this.hooks.on_hit = fn; return }
        if (name === 'on_deplete') { this.hooks.on_deplete = fn; return }
        if (name === 'on_check') { 
            this.hooks.on_check = { every: config.every ?? 2, fn }
            return 
        }
        if (name === 'on_low_mana') { 
            this.hooks.on_low_mana = { threshold: config.threshold ?? 100, fn }
            return 
        }
        this._err(`unknown hook: "${name}"`)
    }

    /**
     * Detect enemies near target (player or caster)
     * @param {*} target - Target to check around
     * @returns {boolean} True if enemy found
     */
    enemy_nearby(target) {
        target = target !== undefined ? target : this.projectile
        let found = false
        enemies.some(e => {
            const dx = e.x - target.x
            const dy = e.y - target.y
            if (Math.sqrt(dx * dx + dy * dy) < 180) {
                this.target = e
                found = true
            }
            return found
        })
        return found
    }

    /**
     * Simulation tick (called by sandbox every 100ms)
     * @param {number} dt - Delta time in seconds
     */
    tick(dt) {
        if (this.phase === 'dead') return

        // Gathering phase
        if (this.phase === 'gathering') {
            this.gatherElapsed += dt
            if (this.gatherElapsed >= this.gatherDuration) {
                this.phase = 'active'
                this.projectile.x = player.x
                this.projectile.y = player.y
                this._notifyChange()
            } else {
                this.progress = Math.round((this.gatherElapsed / this.gatherDuration) * 100) + 2
                this._notifyChange()
                return
            }
        }

        if (this.phase !== 'active') return

        this.elapsed += dt

        // Ongoing drain
        if (this.drainRate > 0) {
            const free = this.mana - this.reserved
            if (free > 0) {
                const drain = Math.min(free, this.drainRate * dt)
                this.mana -= drain
            }
        }

        // on_check hook
        if (this.hooks.on_check) {
            this._checkAccum += dt
            if (this._checkAccum >= this.hooks.on_check.every) {
                this._checkAccum = 0
                try { 
                    this.hooks.on_check.fn() 
                } catch (e) { 
                    console.log(e)
                    this._err(e.message) 
                }
            }
        }

        // on_low_mana hook
        if (this.hooks.on_low_mana && !this._lowManaPulsed) {
            if (this.mana < this.hooks.on_low_mana.threshold && this._lowManaCooldown <= 0) {
                this._lowManaPulsed = true
                this._lowManaCooldown = 3
                try { 
                    this.hooks.on_low_mana.fn() 
                } catch (e) { 
                    this._err(e.message) 
                }
                setTimeout(() => { this._lowManaPulsed = false }, 3000)
            }
        }
        if (this._lowManaCooldown > 0) this._lowManaCooldown -= dt

        // Deplete check
        const free = this.mana - this.reserved
        if (this.drainRate > 0 && free <= 0.1) {
            if (this.hooks.on_deplete) {
                try { this.hooks.on_deplete() } catch (e) { this._err(e.message) }
            }
            if (this.phase !== 'dead') this._kill()
        }

        this._notifyChange()
    }

    /**
     * Trigger hit event (called when projectile hits target)
     */
    triggerHit() {
        if (this.hooks.on_hit) {
            try { this.hooks.on_hit() } catch (e) { this._err(e.message) }
        }
        if (this.phase !== 'dead') this._kill()
    }

    // ═══════════════════════════════════════════════════════
    //  PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════

    _spend(cost, label) {
        const free = this.mana - this.reserved
        if (cost > free) {
            return this._err(`not enough mana for ${label} — need ${cost}, free ${Math.round(free)}`)
        }
        this.mana -= cost
        this.upfront += cost
        return true
    }

    _requireActive(name) {
        return true
    }

    _nestSurcharge() {
        return 1 + SPELL_COSTS.nestSurcharge * this.nestDepth
    }

    _kill() {
        this.phase = 'dead'
        this._notifyChange()
    }

    _log(type, msg) {
        this.outputFn(type, msg)
    }

    _err(msg) {
        showMsg(msg)
        return false
    }

    _notifyChange() {
        if (this.onStateChange) this.onStateChange()
    }

    /**
     * Get snapshot for UI rendering
     * @returns {object} Current spell state
     */
    snapshot() {
        const total = this.mana + this.upfront
        const free = Math.max(0, this.mana - this.reserved)
        const durSec = this.drainRate > 0 ? (free / this.drainRate) : Infinity
        return {
            phase: this.phase,
            mana: this.mana,
            reserved: this.reserved,
            free,
            upfront: this.upfront,
            drainRate: this.drainRate,
            elapsed: this.elapsed,
            shape: this.spellShape,
            size: this.size,
            attributes: [...this.attributes],
            speed: this.spellSpeed,
            following: this.following,
            gatherPct: this.gatherDuration > 0
                ? Math.min(1, this.gatherElapsed / this.gatherDuration)
                : (this.phase !== 'idle' ? 1 : 0),
            durSec: isFinite(durSec) ? durSec : null,
            total,
        }
    }
}
